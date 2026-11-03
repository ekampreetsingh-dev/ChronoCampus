import { createClient } from '@supabase/supabase-js'
import { DAYS, PERIODS, configureSchedule, nowInTimezone } from './bellSchedule.js'
import { normRoom } from './conflicts.js'
import { groupIdFor, membershipId } from './groups.js'
import { pitchStore, DEMO_CODES, TEACHERS } from './pitchStore.js'

/* ==========================================================================
   Client
   ========================================================================== */

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && /^https?:\/\//.test(SUPABASE_URL),
)

/** Demo mode is an explicit environment, never a silent fallback for a failure. */
export const ENABLE_PITCH_MODE = true

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    })
  : null

const DEMO_SESSION_KEY = 'chronocampus.session.v2'
const DEMO_ROOMS = ['Room 101', 'Room 102', 'Room 103', 'Physics Lab', 'Chemistry Lab', 'CS Lab']

let forcedDemo = ENABLE_PITCH_MODE && !isSupabaseConfigured
const mode = () => (forcedDemo || !supabase ? 'demo' : 'live')
const isDemo = () => mode() === 'demo'

const read = () => pitchStore.get()
const write = (fn) => pitchStore.mutate(fn)

/** Timestamps alone collide when a batch issues several rows in one millisecond. */
let uidSeq = 0
const uid = (prefix) => `${prefix}-${Date.now()}-${(uidSeq += 1)}`

const periodLabelOf = (n) => PERIODS.find((p) => Number(p.n) === Number(n))?.label || `P${n}`

export const UNREGISTERED_MESSAGE =
  'Your email address is not registered with this school. Please contact the school administration.'

const DEMO_IDENTITIES = {
  admin: { email: 'principal@chronocampus.edu.in' },
  teacher: { email: 'neelam.kaur@chronocampus.edu.in' },
  student: { email: 'gurpreet.sandhu@student.chronocampus.edu.in' },
}

const loadSession = () => {
  try {
    return JSON.parse(localStorage.getItem(DEMO_SESSION_KEY) || 'null')
  } catch {
    return null
  }
}
const saveSession = (s) => {
  try {
    if (s) localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(s))
    else localStorage.removeItem(DEMO_SESSION_KEY)
  } catch {
    /* ignore */
  }
  return s
}

const normEmail = (e = '') => String(e).trim().toLowerCase()

/** The address shape the office accepts, shared with the directory forms. */
export const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/* --------------------------------------------------------------------------
   Directories. Three tables, one row per person, and whichever table holds an
   address is what that person can do.
   -------------------------------------------------------------------------- */
const DIRECTORY_TABLE = { admin: 'allowed_admins', teacher: 'allowed_teachers', student: 'allowed_students' }

/**
 * What the office may set about a person. `role` and `is_active` are absent on
 * purpose: the first follows from the directory holding the row, the second
 * belongs to the activate / withdraw control.
 */
const DIRECTORY_FIELDS = {
  admin: ['full_name', 'email', 'designation'],
  teacher: ['full_name', 'email', 'subject', 'phone', 'employee_id'],
  student: ['full_name', 'email', 'admission_number'],
}

/**
 * The one shape for seating a student in a class: the active enrollment is
 * superseded rather than rewritten, and the new row records where it came from —
 * the same mechanics `verifyClassCode` runs when a student does it themselves.
 * Mutates the draft state, so callers run it inside `write`.
 */
function enrollInDemo(st, { student, section, session, action, actor_id }) {
  const prev = st.student_enrollments.find(
    (e) => String(e.student_id) === String(student.id) && e.enrollment_status === 'active',
  )
  st.student_enrollments = st.student_enrollments.map((e) =>
    String(e.student_id) === String(student.id) && e.enrollment_status === 'active' ? { ...e, enrollment_status: 'superseded' } : e,
  )
  const row = {
    id: uid('enr'),
    student_id: student.id,
    academic_session_id: session.id,
    class_section_id: section.id,
    class_section: section.name,
    enrollment_status: 'active',
    enrolled_at: new Date().toISOString(),
    promoted_from_enrollment_id: prev?.id || null,
  }
  st.student_enrollments.push(row)
  const pi = st.profiles.findIndex((p) => String(p.id) === String(student.id))
  if (pi >= 0) st.profiles[pi].class_section = section.name
  syncStudentGroup(st, {
    student,
    section,
    previousSectionId: prev?.class_section_id || null,
    actor_id,
    actor_name: personName(st, actor_id) || 'the school',
  })
  st.audit_logs.unshift({
    id: uid('aud'),
    actor_id,
    actor_role: 'admin',
    action,
    target: section.name,
    metadata: { session: session.name, from: prev?.class_section || null, to: section.name, student: student.email },
    at: new Date().toISOString(),
  })
  return {
    from: prev?.class_section || null,
    to: section.name,
    session_name: session.name,
    superseded_enrollment_id: prev?.id || null,
    enrollment_id: row.id,
  }
}

const refusal = (message, code) => {
  const err = new Error(message)
  err.code = code
  return err
}

/* --------------------------------------------------------------------------
   ChronoConnect — one community group per class-section.
   These helpers mutate the store inside a single write(), so a group and its
   members can never be left half-provisioned.
   -------------------------------------------------------------------------- */

const GROUP_DEFAULTS = { students_can_comment: true, students_can_react: true, students_can_post: false }
const nowIso = () => new Date().toISOString()

function logAction(st, { actor_id, actor_role = 'admin', action, target, metadata }) {
  st.audit_logs.unshift({ id: uid('aud'), actor_id, actor_role, action, target, metadata, at: nowIso() })
}

function personName(st, id) {
  const key = String(id || '')
  if (!key) return null
  const p = (st.profiles || []).find((x) => String(x.id) === key)
  if (p) return p.full_name
  const t = (st.teachers || []).find((x) => String(x.id) === key)
  return t?.full_name || null
}

/**
 * Add or reactivate a membership. A teacher added twice must not appear twice,
 * so an existing row — even a removed one — is reused and the fresh grant is
 * recorded on top of it.
 */
function grantMembership(st, { group_id, user_id, role, source, added_by, added_by_name, note }) {
  st.group_members = st.group_members || []
  const existing = st.group_members.find((m) => m.group_id === group_id && String(m.user_id) === String(user_id))
  if (existing) {
    const changed = existing.active === false || existing.role !== role
    existing.active = true
    existing.role = role
    existing.source = source || existing.source
    existing.added_by = added_by
    existing.added_by_name = added_by_name
    existing.added_at = nowIso()
    existing.removed_at = null
    existing.removed_by = null
    if (note) existing.note = note
    return { row: existing, changed }
  }
  const row = {
    id: membershipId(group_id, user_id),
    group_id,
    user_id,
    role,
    source: source || 'manual',
    added_by,
    added_by_name,
    added_at: nowIso(),
    removed_at: null,
    removed_by: null,
    active: true,
    note: note || null,
  }
  st.group_members.push(row)
  return { row, changed: true }
}

function revokeMembership(st, { group_id, user_id, removed_by, removed_by_name }) {
  const row = (st.group_members || []).find((m) => m.group_id === group_id && String(m.user_id) === String(user_id))
  if (!row || row.active === false) return null
  row.active = false
  row.removed_at = nowIso()
  row.removed_by = removed_by
  row.removed_by_name = removed_by_name
  return row
}

/**
 * The group a section owns, created if it has none. The class teacher is read
 * from the section every time — the group never keeps a manager of its own
 * choosing, so changing the class teacher in one place cannot drift.
 */
function ensureGroupRow(st, section, { actor_id = 'system', actor_name = 'the school', actor_role = 'system' } = {}) {
  st.class_groups = st.class_groups || []
  let group = st.class_groups.find((g) => g.id === groupIdFor(section.id) || String(g.class_section_id) === String(section.id))
  if (!group) {
    group = {
      id: groupIdFor(section.id),
      class_section_id: section.id,
      class_section: section.name,
      class_teacher_id: section.mentor_teacher_id || null,
      is_active: section.is_active !== false,
      settings: { ...GROUP_DEFAULTS },
      created_at: nowIso(),
      archived_at: section.is_active === false ? nowIso() : null,
    }
    st.class_groups.push(group)
    logAction(st, { actor_id, actor_role, action: 'group.create', target: section.name, metadata: { from: 'class-section' } })
  }

  if (String(group.class_teacher_id || '') !== String(section.mentor_teacher_id || '')) {
    const previous = group.class_teacher_id
    // The old manager held the group by virtue of the office, not because anyone
    // added them, so the row goes back the way it came.
    if (previous) revokeMembership(st, { group_id: group.id, user_id: previous, removed_by: actor_id, removed_by_name: actor_name })
    group.class_teacher_id = section.mentor_teacher_id || null
    logAction(st, {
      actor_id,
      actor_role,
      action: 'group.manager',
      target: group.class_section,
      metadata: { from: personName(st, previous), to: personName(st, group.class_teacher_id) },
    })
  }

  if (group.class_teacher_id) {
    grantMembership(st, {
      group_id: group.id,
      user_id: group.class_teacher_id,
      role: 'manager',
      source: 'class_teacher',
      added_by: actor_id,
      added_by_name: actor_name,
    })
  }
  if (group.class_section !== section.name) group.class_section = section.name
  if (group.is_active !== section.is_active) {
    group.is_active = section.is_active !== false
    group.archived_at = group.is_active ? null : nowIso()
  }
  return group
}

/** A student belongs to exactly the group of the class they are enrolled in. */
function syncStudentGroup(st, { student, section, previousSectionId, actor_id, actor_name }) {
  if (previousSectionId && String(previousSectionId) !== String(section?.id)) {
    const oldGroup = (st.class_groups || []).find((g) => String(g.class_section_id) === String(previousSectionId))
    if (oldGroup) revokeMembership(st, { group_id: oldGroup.id, user_id: student.id, removed_by: actor_id, removed_by_name: actor_name })
  }
  if (!section) return
  const group = ensureGroupRow(st, section, { actor_id, actor_name })
  grantMembership(st, {
    group_id: group.id,
    user_id: student.id,
    role: 'student',
    source: 'enrolment',
    added_by: actor_id,
    added_by_name: 'enrolment',
  })
}

/**
 * Who this person is *inside* one group, resolved from the store. An admin is
 * not a member of anything and still outranks the table; the class teacher is
 * the manager because the group records them as such, not because a screen said
 * so. Every group call in the service layer goes through this.
 */
function groupAccess(st, groupId, actorId) {
  const group = (st.class_groups || []).find((g) => g.id === groupId || String(g.class_section_id) === String(groupId))
  if (!group) throw refusal('That class group does not exist.', 'no_group')
  const isAdmin = (st.allowed_admins || []).some((a) => String(a.id) === String(actorId))
  const member = (st.group_members || []).find(
    (m) => m.group_id === group.id && String(m.user_id) === String(actorId) && m.active !== false,
  )
  const isManager = group.class_teacher_id && String(group.class_teacher_id) === String(actorId)
  const role = isAdmin ? 'admin' : isManager ? 'manager' : member?.role || null
  return { group, member, role, isAdmin, inGroup: isAdmin || Boolean(member) }
}

const actorOf = (st, supplied) => {
  if (supplied?.id) return supplied
  const id = loadSession()?.id
  return { id, name: personName(st, id) || 'Someone', role: null }
}

/** A teacher resolved to their directory record — subject, code, active flag. */
function teacherProfile(st, teacherId) {
  const key = String(teacherId || '')
  const t = (st.teachers || []).find((x) => String(x.id) === key) || (st.allowed_teachers || []).find((x) => String(x.id) === key)
  if (!t) return null
  return {
    id: t.id,
    full_name: t.full_name,
    subject: t.subject || null,
    extra: t.extra || [],
    employee_id: t.employee_id || null,
    email: t.email || null,
    designation: t.designation || null,
    is_active: t.is_active !== false,
  }
}

const shapeGroup = (st, group, actorId) => {
  const members = (st.group_members || []).filter((m) => m.group_id === group.id && m.active !== false)
  const posts = (st.group_posts || []).filter((p) => p.group_id === group.id && !p.removed_at)
  const mine = members.find((m) => String(m.user_id) === String(actorId))
  const isAdmin = (st.allowed_admins || []).some((a) => String(a.id) === String(actorId))
  const manager = group.class_teacher_id ? teacherProfile(st, group.class_teacher_id) : null
  const last = posts.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
  return {
    id: group.id,
    class_section_id: group.class_section_id,
    class_section: group.class_section,
    is_active: group.is_active !== false,
    settings: group.settings || GROUP_DEFAULTS,
    class_teacher: manager,
    teacher_count: members.filter((m) => m.role === 'teacher').length,
    student_count: members.filter((m) => m.role === 'student').length,
    member_count: members.length,
    post_count: posts.filter((p) => !p.parent_id).length,
    last_post_at: last?.created_at || null,
    my_role: isAdmin ? 'admin' : String(group.class_teacher_id || '') === String(actorId) ? 'manager' : mine?.role || null,
  }
}

/* --------------------------------------------------------------------------
   Authorization. Admin > teacher > student, and never a guess: an email in
   two directories is a conflict, an email in none is denied.
   -------------------------------------------------------------------------- */
function resolveDemoAuthorization(email, userId) {
  const s = read()
  const e = normEmail(email)
  const admins = (s.allowed_admins || []).filter((r) => normEmail(r.email) === e)
  const teachers = (s.allowed_teachers || []).filter((r) => normEmail(r.email) === e)
  const students = (s.allowed_students || []).filter((r) => normEmail(r.email) === e)

  const matches = [
    admins.length && 'admin',
    teachers.length && 'teacher',
    students.length && 'student',
  ].filter(Boolean)

  if (!matches.length) return { access: 'denied', reason: 'unregistered', role: null, message: UNREGISTERED_MESSAGE }
  if (matches.length > 1)
    return {
      access: 'conflict',
      reason: 'duplicate_identity',
      role: null,
      message: `This email appears in more than one school directory (${matches.join(' and ')}). An administrator must resolve it before you can sign in.`,
    }

  const role = matches[0]
  const record = (admins[0] || teachers[0] || students[0]) || {}
  if (record.is_active === false)
    return {
      access: 'denied',
      reason: 'inactive',
      role,
      message: `This ${role} record has been deactivated by the school, so access has been withdrawn.`,
    }

  const profile = s.profiles.find((p) => String(p.id) === String(userId) || normEmail(p.email) === e) || {}
  const enrollment = s.student_enrollments.find(
    (en) => String(en.student_id) === String(record.id) && en.enrollment_status === 'active',
  )

  return {
    access: 'granted',
    role,
    profile: {
      id: record.id,
      email: record.email,
      full_name: record.full_name || profile.full_name,
      role,
      subject: teachers[0]?.subject || profile.subject || null,
      designation: admins[0]?.designation || null,
      employee_id: teachers[0]?.employee_id || null,
      admission_number: students[0]?.admission_number || null,
      class_section: enrollment?.class_section || null,
      enrollment_id: enrollment?.id || null,
      academic_session_id: enrollment?.academic_session_id || null,
      is_active: true,
    },
  }
}

/* ==========================================================================
   Service layer — every method works in both environments.
   ========================================================================== */

/** A grade is a number for classes 1–12 and a name for the early-years wing. */
const gradeValue = (g) => (Number.isFinite(Number(g)) && String(g).trim() !== '' ? Number(g) : String(g || ''))

export const db = {
  get mode() {
    return mode()
  },
  get isDemo() {
    return isDemo()
  },
  get liveAvailable() {
    return isSupabaseConfigured
  },
  setDemoMode(on) {
    forcedDemo = Boolean(on)
  },
  ready: () => pitchStore.ready(),

  /* ------------------------------------------------------------- session -- */
  async getSession() {
    if (isDemo()) {
      await pitchStore.ready()
      const stored = loadSession()
      if (!stored) return { user: null, profile: null, access: 'anonymous' }
      const authz = resolveDemoAuthorization(stored.email, stored.id)
      if (authz.access !== 'granted') return { user: { id: stored.id, email: stored.email }, profile: null, ...authz }
      return { user: { id: authz.profile.id, email: authz.profile.email }, profile: authz.profile, access: 'granted' }
    }
    const { data } = await supabase.auth.getSession()
    const user = data.session?.user
    if (!user) return { user: null, profile: null, access: 'anonymous' }
    const authz = await db.resolveAuthorization(user.id, user.email)
    if (authz.access !== 'granted') return { user, profile: null, ...authz }
    return { user, profile: authz.profile, access: 'granted' }
  },

  /** Live mode asks the database, which is the only party that may decide a role. */
  async resolveAuthorization(userId, email) {
    if (isDemo()) return resolveDemoAuthorization(email, userId)
    const { data, error } = await supabase.rpc('resolve_authorization')
    if (error || !data) {
      const { data: row } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
      if (!row) return { access: 'denied', reason: 'unregistered', role: null, message: UNREGISTERED_MESSAGE }
      if (!row.is_active) return { access: 'denied', reason: 'inactive', role: row.role, message: 'This account has been deactivated by the school.' }
      return { access: 'granted', role: row.role, profile: row }
    }
    if (data.status !== 'granted') return { access: data.status, reason: data.reason, role: data.role || null, message: data.message }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    return { access: 'granted', role: data.role, profile: { ...(profile || {}), role: data.role } }
  },

  /** Called on a timer and on every protected navigation. */
  async revalidate() {
    if (isDemo()) return db.getSession()
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) {
      await db.signOut()
      return { user: null, profile: null, access: 'anonymous' }
    }
    const authz = await db.resolveAuthorization(data.session.user.id, data.session.user.email)
    if (authz.access !== 'granted') {
      await db.signOut()
      return { user: null, profile: null, ...authz }
    }
    return { user: data.session.user, profile: authz.profile, access: 'granted' }
  },

  onAuthChange(callback) {
    if (isDemo()) return () => {}
    const { data } = supabase.auth.onAuthStateChange((_e, session) => callback(session?.user || null))
    return data.subscription?.unsubscribe ?? (() => {})
  },

  async signInWithGoogle() {
    if (isDemo()) {
      const s = saveSession({ id: DEMO_IDENTITIES.admin.email, email: DEMO_IDENTITIES.admin.email })
      return { data: { session: s }, error: null, demo: true }
    }
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { access_type: 'offline', prompt: 'select_account' },
      },
    })
    if (data?.url) window.location.assign(data.url)
    return { data, error }
  },

  async signInWithEmail(email, password) {
    if (isDemo()) {
      await pitchStore.ready()
      const e = normEmail(email)
      const known = read().profiles.find((p) => normEmail(p.email) === e)
      const target = known || { id: e, email: e }
      if (!known) {
        // Demo still refuses unregistered emails, exactly like production.
        saveSession({ id: e, email: e })
        return { data: { user: target }, error: null, demo: true }
      }
      saveSession({ id: target.id, email: target.email })
      return { data: { user: target }, error: null, demo: true }
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email: normEmail(email), password })
    return { data, error }
  },

  async signUpWithEmail(email, password, fullName) {
    if (isDemo()) return db.signInWithEmail(email, password)
    // No role, ever. The database derives it from the approved directories.
    const { data, error } = await supabase.auth.signUp({
      email: normEmail(email),
      password,
      options: { data: { full_name: fullName }, emailRedirectTo: `${window.location.origin}/login` },
    })
    return { data, error }
  },

  async signOut() {
    if (isDemo()) {
      saveSession(null)
      return
    }
    await supabase.auth.signOut()
  },

  async updateProfile(userId, patch) {
    if (isDemo()) {
      await write((s) => {
        const i = s.profiles.findIndex((p) => String(p.id) === String(userId))
        if (i >= 0) s.profiles[i] = { ...s.profiles[i], ...patch }
        return s
      })
      return true
    }
    // role/is_active are not client-writable; RLS rejects them too.
    const safe = { ...patch }
    delete safe.role
    delete safe.is_active
    const { error } = await supabase.from('profiles').update(safe).eq('id', userId)
    if (error) throw error
    return true
  },

  /* ------------------------------------------------------- school config -- */
  async getSettings() {
    if (isDemo()) return read().school_settings
    const { data, error } = await supabase.from('school_settings').select('*').eq('id', 1).maybeSingle()
    if (error) throw error
    return data
  },

  async saveSettings(patch) {
    if (isDemo()) {
      await write((s) => ({ ...s, school_settings: { ...s.school_settings, ...patch } }))
      await db.applySchedule()
      return true
    }
    const { error } = await supabase.from('school_settings').upsert({ id: 1, ...patch })
    if (error) throw error
    return true
  },

  async savePeriods(periods) {
    if (isDemo()) {
      await write((s) => ({ ...s, school_settings: { ...s.school_settings, periods } }))
      await db.applySchedule()
      return true
    }
    const { error } = await supabase.from('school_periods').delete().neq('id', 0)
    if (error) throw error
    const { error: e2 } = await supabase.from('school_periods').upsert(
      periods.map((p) => ({ id: p.n, period_number: p.n, label: p.label, start_time: `${p.start}:00`, end_time: `${p.end}:00` })),
    )
    if (e2) throw e2
    return true
  },

  /** Pushes configured timings into the schedule module used by every screen. */
  async applySchedule() {
    const s = await db.getSettings()
    if (!s) return
    const schedules = await db.listSchedules()
    configureSchedule({
      working_days: s.working_days,
      timezone: s.timezone,
      schedules,
    })
    return s
  },

  /* ------------------------------------------------------- bell schedules -- */
  async listSchedules() {
    if (isDemo()) return (await pitchStore.ready()).bell_schedules || []
    const { data, error } = await supabase
      .from('bell_schedules')
      .select('*, bell_periods(*)')
      .order('applies_to')
      .order('effective_from', { ascending: false })
    if (error) throw error
    return (data || []).map((s) => ({
      ...s,
      periods: (s.bell_periods || [])
        .slice()
        .sort((a, b) => a.period_number - b.period_number)
        .map((p) => ({ n: p.period_number, label: p.label, start: String(p.start_time).slice(0, 5), end: String(p.end_time).slice(0, 5) })),
    }))
  },

  async saveSchedule(schedule) {
    if (isDemo()) {
      await write((s) => {
        const id = schedule.id || `bell-${Date.now().toString(36)}`
        const i = s.bell_schedules.findIndex((b) => b.id === id)
        // Defaults apply to new rows only — editing must not downgrade an
        // active schedule's status or reset its activation.
        const defaults =
          i >= 0
            ? {}
            : { effective_from: new Date().toISOString().slice(0, 10), effective_to: null, is_active: false, status: 'upcoming', season: 'regular' }
        const row = { ...defaults, ...schedule, id }
        if (i >= 0) s.bell_schedules[i] = { ...s.bell_schedules[i], ...row }
        else s.bell_schedules.push(row)
        s.audit_logs.unshift({
          id: uid('aud'),
          actor_id: 'adm-01',
          actor_role: 'admin',
          action: i >= 0 ? 'schedule.update' : 'schedule.create',
          target: row.name,
          metadata: { periods: row.periods?.length || 0, season: row.season },
          at: new Date().toISOString(),
        })
        return s
      })
      await db.applySchedule()
      return true
    }
    const { periods, ...head } = schedule
    if (!head.id) delete head.id
    const { data, error } = await supabase.from('bell_schedules').upsert(head, { onConflict: 'id' }).select().single()
    if (error) throw error
    if (Array.isArray(periods)) {
      await supabase.from('bell_periods').delete().eq('schedule_id', data.id)
      const { error: e2 } = await supabase.from('bell_periods').insert(
        periods.map((p) => ({
          schedule_id: data.id,
          period_number: Number(p.n),
          label: p.label,
          start_time: `${p.start}:00`,
          end_time: `${p.end}:00`,
        })),
      )
      if (e2) throw e2
    }
    return true
  },

  /** Season switch: exactly one schedule per group may be active. */
  async activateSchedule(id) {
    if (isDemo()) {
      const s = await pitchStore.ready()
      const target = s.bell_schedules.find((b) => b.id === id)
      if (!target) throw new Error('Unknown schedule')
      await write((st) => ({
        ...st,
        bell_schedules: st.bell_schedules.map((b) =>
          b.applies_to === target.applies_to ? { ...b, is_active: b.id === id, status: b.id === id ? 'active' : 'archived' } : b,
        ),
      }))
      await db.applySchedule()
      return true
    }
    const { data: me, error: e1 } = await supabase.from('bell_schedules').select('applies_to').eq('id', id).single()
    if (e1) throw e1
    const { error } = await supabase.rpc('activate_bell_schedule', { p_id: id, p_applies_to: me.applies_to })
    if (error) throw error
    return true
  },

  async cloneSchedule(id, { name, season, effective_from }) {
    const all = await db.listSchedules()
    const src = all.find((s) => s.id === id)
    if (!src) throw new Error('Unknown schedule')
    const copy = {
      ...src,
      id: undefined,
      name,
      season,
      effective_from,
      is_active: false,
      status: 'upcoming',
      periods: src.periods.map((p) => ({ ...p })),
    }
    delete copy.bell_periods
    return db.saveSchedule(copy)
  },

  async listRooms() {
    if (isDemo()) return (await pitchStore.ready()).school_settings.rooms || DEMO_ROOMS
    const { data } = await supabase.from('school_rooms').select('name').order('name')
    return data?.length ? data.map((r) => r.name) : DEMO_ROOMS
  },

  async listHolidays() {
    if (isDemo()) return read().holidays || []
    const { data } = await supabase.from('school_holidays').select('*').order('date')
    return data || []
  },

  /* ---------------------------------------------------------- directories -- */
  async listAdmins() {
    if (isDemo()) return read().allowed_admins
    const { data, error } = await supabase.from('allowed_admins').select('*').order('full_name')
    if (error) throw error
    return data
  },

  async listTeacherDirectory() {
    if (isDemo()) return read().allowed_teachers.map((t) => ({ ...t, extra: TEACHERS.find((x) => x.id === t.id)?.extra || [] }))
    const { data, error } = await supabase.from('allowed_teachers').select('*').order('full_name')
    if (error) throw error
    return data
  },

  async listStudentDirectory() {
    if (isDemo()) {
      const s = read()
      return (s.allowed_students || []).map((st) => {
        const en = s.student_enrollments.find((e) => String(e.student_id) === String(st.id) && e.enrollment_status === 'active')
        return { ...st, class_section: en?.class_section || null, academic_session: s.academic_sessions.find((a) => a.id === en?.academic_session_id)?.name || null }
      })
    }
    const { data, error } = await supabase
      .from('allowed_students')
      .select('*, enrollment:student_enrollments(class_section_id, enrollment_status, academic_session_id, class_sections(name))')
      .order('full_name')
    if (error) throw error
    return (data || []).map((r) => ({
      ...r,
      class_section: r.enrollment?.class_sections?.name || null,
    }))
  },

  async teachers() {
    if (isDemo()) return read().teachers
    const { data, error } = await supabase.from('profiles').select('*').eq('role', 'teacher').order('full_name')
    if (error) throw error
    return data
  },

  async upsertDirectory(kind, rows) {
    const table = DIRECTORY_TABLE[kind]
    if (!table) throw new Error('Unknown directory')
    if (isDemo()) {
      await write((s) => {
        for (const r of rows) {
          const i = s[table].findIndex((x) => normEmail(x.email) === normEmail(r.email))
          const row = { id: i >= 0 ? s[table][i].id : `${kind[0]}-${Date.now()}-${i}`, is_active: true, ...r }
          if (i >= 0) s[table][i] = { ...s[table][i], ...row }
          else s[table].push(row)

          // keep the profile mirror in step so role resolution stays honest
          const pi = s.profiles.findIndex((p) => normEmail(p.email) === normEmail(r.email))
          const prof = {
            id: row.id,
            email: row.email,
            full_name: row.full_name,
            role: kind,
            subject: row.subject || null,
            designation: row.designation || null,
            employee_id: row.employee_id || null,
            admission_number: row.admission_number || null,
            class_section: s.profiles[pi]?.class_section || null,
            is_active: true,
          }
          if (pi >= 0) s.profiles[pi] = { ...s.profiles[pi], ...prof }
          else s.profiles.push(prof)
          if (kind === 'teacher') {
            const ti = s.teachers.findIndex((t) => normEmail(t.email) === normEmail(r.email))
            if (ti >= 0) s.teachers[ti] = { ...s.teachers[ti], ...row }
            else s.teachers.push({ ...row, extra: [], role: 'teacher', is_active: true })
          }
        }
        s.audit_logs.unshift({
          id: uid('aud'),
          actor_id: 'adm-01',
          actor_role: 'admin',
          action: 'directory.import',
          target: table,
          metadata: { rows: rows.length },
          at: new Date().toISOString(),
        })
        return s
      })
      return { count: rows.length }
    }
    const { error } = await supabase.from(table).upsert(rows, { onConflict: 'email' })
    if (error) throw error
    return { count: rows.length }
  },

  async setDirectoryActive(kind, email, active) {
    const table = DIRECTORY_TABLE[kind]
    if (isDemo()) {
      await write((s) => {
        const i = s[table].findIndex((x) => normEmail(x.email) === normEmail(email))
        if (i >= 0) s[table][i].is_active = active
        const pi = s.profiles.findIndex((p) => normEmail(p.email) === normEmail(email))
        if (pi >= 0) s.profiles[pi].is_active = active
        s.audit_logs.unshift({
          id: uid('aud'),
          actor_id: 'adm-01',
          actor_role: 'admin',
          action: active ? 'directory.activate' : 'directory.deactivate',
          target: `${table}:${email}`,
          metadata: {},
          at: new Date().toISOString(),
        })
        return s
      })
      return true
    }
    const { error } = await supabase.from(table).update({ is_active: active }).eq('email', normEmail(email))
    if (error) throw error
    return true
  },

  /**
   * Insert or update ONE person. Matched on id first and email second, so an
   * edit updates the record instead of forking it into two. A student carrying a
   * class is seated in it through the same enrollment mechanics as a verified
   * class code, so the office and the student cannot produce two shapes.
   */
  async saveDirectoryRow(kind, input = {}) {
    const table = DIRECTORY_TABLE[kind]
    if (!table) throw new Error('Unknown directory')

    const full_name = String(input.full_name || '').trim()
    const email = normEmail(input.email)
    if (!full_name) throw refusal('A directory row has to carry a name — an empty record cannot be authorized.', 'name_required')
    if (!EMAIL_SHAPE.test(email))
      throw refusal(`“${String(input.email || '').trim() || 'The email field'}” is not an address this school can send to.`, 'email_invalid')

    const clean = {}
    for (const field of DIRECTORY_FIELDS[kind]) {
      if (field === 'email') clean[field] = email
      else if (field === 'full_name') clean[field] = full_name
      else clean[field] = String(input[field] ?? '').trim() || null
    }
    const sectionRef = kind === 'student' ? input.class_section_id || input.class_section || null : null

    if (isDemo()) {
      const s = await pitchStore.ready()
      // One address, one role. A second directory row makes every sign-in an
      // unresolvable identity conflict, so it is refused before it is written.
      const otherKind = Object.keys(DIRECTORY_TABLE).find(
        (k) => k !== kind && (s[DIRECTORY_TABLE[k]] || []).some((x) => normEmail(x.email) === email && String(x.id) !== String(input.id || '')),
      )
      if (otherKind) {
        const holder = s[DIRECTORY_TABLE[otherKind]].find((x) => normEmail(x.email) === email)
        throw refusal(
          `${email} is already on the ${otherKind} directory as ${holder.full_name}. Remove that record first — one person cannot hold two roles.`,
          'email_taken',
        )
      }
      const dupe = (s[table] || []).find((x) => normEmail(x.email) === email && String(x.id) !== String(input.id || ''))
      if (dupe) throw refusal(`${email} is already on this directory as ${dupe.full_name}. Edit that record instead.`, 'email_taken')

      let section = null
      if (sectionRef) {
        section = s.class_sections.find((c) => String(c.id) === String(sectionRef) || c.name === sectionRef)
        if (!section) throw refusal(`There is no class called ${sectionRef} in this school.`, 'unknown_section')
        if (!section.is_active) throw refusal(`${section.name} is archived, so nobody can be seated in it.`, 'archived_section')
      }

      let written = null
      await write((st) => {
        const i = st[table].findIndex((x) => (input.id && String(x.id) === String(input.id)) || normEmail(x.email) === email)
        const prev = i >= 0 ? st[table][i] : null
        const row = { ...(prev || {}), ...clean, id: prev ? prev.id : uid(kind[0]) }
        if (!prev) row.is_active = true
        if (i >= 0) st[table][i] = row
        else st[table].push(row)

        // The directories are what authorization reads; the profile row is only
        // a mirror of them, and the role comes from the directory being written.
        const pi = st.profiles.findIndex((p) => String(p.id) === String(row.id) || normEmail(p.email) === email)
        const was = pi >= 0 ? st.profiles[pi] : {}
        const prof = {
          ...was,
          id: row.id,
          email: row.email,
          full_name: row.full_name,
          role: kind,
          designation: kind === 'admin' ? row.designation : null,
          subject: kind === 'teacher' ? row.subject : null,
          employee_id: kind === 'teacher' ? row.employee_id : null,
          admission_number: kind === 'student' ? row.admission_number : null,
          class_section: section ? (was.class_section || section.name) : was.class_section || null,
          is_active: row.is_active !== false,
        }
        if (pi >= 0) st.profiles[pi] = prof
        else st.profiles.push(prof)

        if (kind === 'teacher') {
          const ti = st.teachers.findIndex((t) => String(t.id) === String(row.id) || normEmail(t.email) === email)
          const mirror = { ...(ti >= 0 ? st.teachers[ti] : {}), ...row, role: 'teacher', is_active: row.is_active !== false }
          if (ti >= 0) st.teachers[ti] = mirror
          else st.teachers.push({ ...mirror, extra: [] })
        }

        st.audit_logs.unshift({
          id: uid('aud'),
          actor_id: loadSession()?.id || 'adm-01',
          actor_role: 'admin',
          action: prev ? 'directory.update' : 'directory.create',
          target: `${table}:${row.email}`,
          metadata: { fields: Object.keys(clean).filter((f) => clean[f] !== null), class_section: section?.name || null },
          at: new Date().toISOString(),
        })
        written = { created: !prev, row: { ...row } }
        return st
      })

      if (section) written.enrolled = await db._setEnrollment({ id: written.row.id, full_name, email }, { sectionId: section.id, action: 'student.enroll' })
      return written
    }

    const { data: elsewhere } = await supabase
      .from(table)
      .select('id, full_name')
      .eq('email', email)
      .neq('id', input.id || '00000000-0000-0000-0000-000000000000')
      .limit(1)
    if (elsewhere?.length)
      throw refusal(`${email} is already on this directory as ${elsewhere[0].full_name}. Edit that record instead.`, 'email_taken')
    for (const [other, otherTable] of Object.entries(DIRECTORY_TABLE)) {
      if (other === kind) continue
      const { data: clash } = await supabase.from(otherTable).select('id, full_name').eq('email', email).limit(1)
      if (clash?.length)
        throw refusal(
          `${email} is already on the ${other} directory as ${clash[0].full_name}. Remove that record first — one person cannot hold two roles.`,
          'email_taken',
        )
    }

    const { data: row, error } = await supabase
      .from(table)
      .upsert({ ...(input.id ? { id: input.id } : {}), ...clean }, { onConflict: 'email' })
      .select()
      .single()
    if (error) throw error
    let enrolled = null
    if (sectionRef) enrolled = await db._setEnrollment(row, { sectionId: sectionRef, action: 'student.enroll' })
    return { created: !input.id, row, enrolled }
  },

  /**
   * Seat a student in a class for a session. In the demo school the previous
   * enrollment is superseded and a new row is pushed. Live, `student_enrollments`
   * carries a unique (student_id, academic_session_id), so an in-year re-seat
   * updates the one row the schema allows instead of adding a second; the result
   * the UI reports — one active enrollment, in the class chosen — is the same.
   */
  async _setEnrollment(student, { sectionId = null, sectionName = null, sessionName = null, action = 'student.promote' } = {}) {
    // A class can be named by its demo slug, its live uuid or its display name,
    // so the reference is resolved by shape rather than by which parameter it came in on.
    const ref = sectionId || sectionName
    if (!ref) throw refusal('No class was chosen.', 'unknown_section')
    if (isDemo()) {
      const s = await pitchStore.ready()
      const section = s.class_sections.find((c) => String(c.id) === String(ref) || c.name === ref)
      if (!section) throw refusal(`There is no class called ${ref} in this school.`, 'unknown_section')
      if (!section.is_active) throw refusal(`${section.name} is archived, so nobody can be seated in it.`, 'archived_section')
      const session = s.academic_sessions.find((a) => (sessionName ? a.name === sessionName : a.is_active))
      if (!session) throw refusal(`No academic session called ${sessionName || 'the active one'}.`, 'unknown_session')
      const current = s.student_enrollments.find(
        (e) => String(e.student_id) === String(student.id) && e.enrollment_status === 'active',
      )
      if (current && current.class_section_id === section.id && current.academic_session_id === session.id)
        throw refusal(`${student.full_name} is already enrolled in ${section.name} for ${session.name}.`, 'same_class')

      let moved = null
      await write((st) => {
        moved = enrollInDemo(st, { student, section, session, action, actor_id: loadSession()?.id || 'adm-01' })
        return st
      })
      return { ...moved, student: { id: student.id, full_name: student.full_name, email: student.email }, in_place: false }
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(ref))
    const { data: section, error: e1 } = await supabase
      .from('class_sections')
      .select('id, name, is_active')
      .eq(isUuid ? 'id' : 'name', ref)
      .maybeSingle()
    if (e1) throw e1
    if (!section) throw refusal(`There is no class called ${ref} in this school.`, 'unknown_section')
    if (!section.is_active) throw refusal(`${section.name} is archived, so nobody can be seated in it.`, 'archived_section')
    const { data: session, error: e2 } = await supabase
      .from('academic_sessions')
      .select('id, name')
      .eq(sessionName ? 'name' : 'is_active', sessionName || true)
      .maybeSingle()
    if (e2) throw e2
    if (!session) throw refusal(`No academic session called ${sessionName || 'the active one'}.`, 'unknown_session')

    const { data: actives, error: e3 } = await supabase
      .from('student_enrollments')
      .select('id, class_section_id, academic_session_id, class_sections(name)')
      .eq('student_id', student.id)
      .eq('enrollment_status', 'active')
    if (e3) throw e3
    const current = actives?.[0] || null
    const from = current?.class_sections?.name || null
    if (current && current.class_section_id === section.id && current.academic_session_id === session.id)
      throw refusal(`${student.full_name} is already enrolled in ${section.name} for ${session.name}.`, 'same_class')

    let enrollment
    let in_place = false
    if (current && current.academic_session_id === session.id) {
      const { data: updated, error: e4 } = await supabase
        .from('student_enrollments')
        .update({ class_section_id: section.id })
        .eq('id', current.id)
        .select('id')
        .single()
      if (e4) throw e4
      enrollment = updated
      in_place = true
    } else {
      if (current) {
        const { error: e5 } = await supabase.from('student_enrollments').update({ enrollment_status: 'superseded' }).eq('id', current.id)
        if (e5) throw e5
      }
      const { data: inserted, error: e6 } = await supabase
        .from('student_enrollments')
        .insert({
          student_id: student.id,
          academic_session_id: session.id,
          class_section_id: section.id,
          enrollment_status: 'active',
          enrolled_at: new Date().toISOString(),
          promoted_from_enrollment_id: current?.id || null,
        })
        .select('id')
        .single()
      if (e6) throw e6
      enrollment = inserted
    }

    const { error: e7 } = await supabase.from('profiles').update({ class_section: section.name }).eq('id', student.id)
    if (e7) throw e7
    const { error: e8 } = await supabase.from('audit_logs').insert({
      actor_id: (await supabase.auth.getUser()).data?.user?.id || null,
      actor_role: 'admin',
      action,
      target: section.name,
      metadata: { session: session.name, from, to: section.name, student: student.email, in_place },
    })
    if (e8) throw e8
    return {
      from,
      to: section.name,
      session_name: session.name,
      superseded_enrollment_id: in_place ? null : current?.id || null,
      enrollment_id: enrollment.id,
      student: { id: student.id, full_name: student.full_name, email: student.email },
      in_place,
    }
  },

  /**
   * Move an already enrolled student to another class without losing history:
   * the active enrollment is superseded rather than deleted, the profile follows,
   * the audit row records from and to, and the office is told.
   */
  async promoteStudent(studentId, { sectionName, sessionName } = {}) {
    const table = DIRECTORY_TABLE.student
    if (isDemo()) {
      const s = await pitchStore.ready()
      const student = (s.allowed_students || []).find((x) => String(x.id) === String(studentId))
      if (!student) throw refusal('That student is no longer in the approved directory.', 'unknown_student')
      const moved = await db._setEnrollment(student, { sectionName, sessionName, action: 'student.promote' })
      await db.pushNotification({
        audience: 'admin',
        kind: 'enrollment',
        title: `${student.full_name} moved to ${moved.to}`,
        body: moved.from
          ? `Was ${moved.from}. Their ${moved.session_name} enrollment was superseded, not deleted.`
          : `Seated in ${moved.to} for ${moved.session_name} from the student directory.`,
        link: '/admin/students',
      })
      return moved
    }
    const { data: student, error } = await supabase.from(table).select('*').eq('id', studentId).maybeSingle()
    if (error) throw error
    if (!student) throw refusal('That student is no longer in the approved directory.', 'unknown_student')
    const moved = await db._setEnrollment(student, { sectionName, sessionName, action: 'student.promote' })
    await db.pushNotification({
      audience: 'admin',
      kind: 'enrollment',
      title: `${student.full_name} moved to ${moved.to}`,
      body: moved.from
        ? `Was ${moved.from}. Their ${moved.session_name} enrollment was superseded, not deleted.`
        : `Seated in ${moved.to} for ${moved.session_name} from the student directory.`,
      link: '/admin/students',
    })
    return moved
  },

  /**
   * Permanent removal of one person, counted before it happens so the UI can say
   * what breaks. A teacher's periods stay on the board: the schema nulls
   * `teacher_id`, so the class keeps its bell slot with no teacher assigned — that
   * has to be said out loud, not hidden. Two removals are refused: the last active
   * administrator, because the school could never administer itself again, and a
   * student with an active enrollment, because that record belongs to the student.
   *
   * Resolves to `{ kind, id, full_name, email, periods, mentor_of, enrollments,
   * active_enrollments, admins_left, removed }`, with the counts that do not
   * describe this kind left null.
   */
  async deleteDirectoryRow(kind, id) {
    const table = DIRECTORY_TABLE[kind]
    if (!table) throw new Error('Unknown directory')

    if (isDemo()) {
      const s = await pitchStore.ready()
      const row = (s[table] || []).find((x) => String(x.id) === String(id))
      if (!row) throw refusal('That record has already been removed.', 'unknown_row')

      const impact = {
        kind,
        id: row.id,
        full_name: row.full_name,
        email: row.email,
        periods: null,
        mentor_of: null,
        enrollments: null,
        active_enrollments: null,
        admins_left: null,
      }

      if (kind === 'teacher') {
        impact.periods = s.timetable_slots.filter((x) => String(x.teacher_id) === String(id)).length
        impact.mentor_of = s.class_sections.filter((c) => String(c.mentor_teacher_id) === String(id)).map((c) => c.name)
      } else if (kind === 'student') {
        const own = s.student_enrollments.filter((e) => String(e.student_id) === String(id))
        impact.enrollments = own.length
        impact.active_enrollments = own.filter((e) => e.enrollment_status === 'active').length
        if (impact.active_enrollments) {
          const live = own.find((e) => e.enrollment_status === 'active')
          throw refusal(
            `${row.full_name} is enrolled in ${live.class_section} and that enrollment is part of their academic record. Deactivate them instead — it withdraws sign-in and keeps the history.`,
            'student_enrolled',
          )
        }
      } else {
        impact.admins_left = s.allowed_admins.filter((a) => a.is_active !== false && String(a.id) !== String(id)).length
        if (row.is_active !== false && !impact.admins_left)
          throw refusal(
            'This is the only active administrator, so the school would have nobody left to administer it. Add another administrator first.',
            'last_admin',
          )
      }

      await write((st) => {
        st[table] = st[table].filter((x) => String(x.id) !== String(id))
        if (kind === 'teacher') {
          st.timetable_slots.forEach((x) => {
            if (String(x.teacher_id) === String(id)) {
              x.teacher_id = null
              x.teacher_name = ''
            }
            if (String(x.substitute_teacher_id) === String(id)) {
              x.is_substitution = false
              x.substitute_teacher_id = null
              x.substitute_teacher_name = null
              x.sub_notes = null
            }
          })
          st.class_sections.forEach((c) => {
            if (String(c.mentor_teacher_id) === String(id)) c.mentor_teacher_id = null
          })
          st.teachers = st.teachers.filter((t) => String(t.id) !== String(id))
          st.teacher_absences = (st.teacher_absences || []).filter((a) => String(a.teacher_id) !== String(id))
          st.timetable_substitutions = (st.timetable_substitutions || []).filter(
            (x) => String(x.absent_teacher_id) !== String(id) && String(x.substitute_teacher_id) !== String(id),
          )
        }
        if (kind === 'student') st.student_enrollments = st.student_enrollments.filter((e) => String(e.student_id) !== String(id))
        st.profiles = st.profiles.filter((p) => String(p.id) !== String(id) && normEmail(p.email) !== normEmail(row.email))
        st.audit_logs.unshift({
          id: uid('aud'),
          actor_id: loadSession()?.id || 'adm-01',
          actor_role: 'admin',
          action: 'directory.delete',
          target: `${table}:${row.email}`,
          metadata: {
            full_name: row.full_name,
            periods_unassigned: impact.periods || 0,
            home_rooms_emptied: impact.mentor_of?.length || 0,
            enrollments_removed: impact.enrollments || 0,
            admins_left: impact.admins_left,
          },
          at: new Date().toISOString(),
        })
        return st
      })
      return { ...impact, removed: true }
    }

    const { data: row, error: eRead } = await supabase.from(table).select('*').eq('id', id).maybeSingle()
    if (eRead) throw eRead
    if (!row) throw refusal('That record has already been removed.', 'unknown_row')

    const impact = {
      kind,
      id: row.id,
      full_name: row.full_name,
      email: row.email,
      periods: null,
      mentor_of: null,
      enrollments: null,
      active_enrollments: null,
      admins_left: null,
    }

    if (kind === 'teacher') {
      const { count, error: e1 } = await supabase
        .from('timetable_slots')
        .select('id', { count: 'exact', head: true })
        .eq('teacher_id', id)
      if (e1) throw e1
      impact.periods = count || 0
      const { data: rooms, error: e2 } = await supabase.from('class_sections').select('name').eq('mentor_teacher_id', id)
      if (e2) throw e2
      impact.mentor_of = (rooms || []).map((r) => r.name)
    } else if (kind === 'student') {
      const { data: own, error: e3 } = await supabase
        .from('student_enrollments')
        .select('id, enrollment_status, class_sections(name)')
        .eq('student_id', id)
      if (e3) throw e3
      const active = (own || []).filter((e) => e.enrollment_status === 'active')
      impact.enrollments = (own || []).length
      impact.active_enrollments = active.length
      if (active.length)
        throw refusal(
          `${row.full_name} is enrolled in ${active[0].class_sections?.name || 'a class'} and that enrollment is part of their academic record. Deactivate them instead — it withdraws sign-in and keeps the history.`,
          'student_enrolled',
        )
    } else {
      const { count, error: e4 } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .neq('id', id)
      if (e4) throw e4
      impact.admins_left = count || 0
      if (row.is_active !== false && !impact.admins_left)
        throw refusal(
          'This is the only active administrator, so the school would have nobody left to administer it. Add another administrator first.',
          'last_admin',
        )
    }

    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) throw error
    return { ...impact, removed: true }
  },

  /* ------------------------------------------------------------- sessions -- */
  async listSessions() {
    if (isDemo()) return read().academic_sessions
    const { data, error } = await supabase.from('academic_sessions').select('*').order('start_date', { ascending: false })
    if (error) throw error
    return data
  },

  async activeSession() {
    if (isDemo()) return read().academic_sessions.find((s) => s.is_active) || null
    const { data } = await supabase.from('academic_sessions').select('*').eq('is_active', true).maybeSingle()
    return data
  },

  async saveSession_(session) {
    if (isDemo()) {
      await write((s) => {
        const i = s.academic_sessions.findIndex((x) => x.id === session.id || x.name === session.name)
        if (i >= 0) s.academic_sessions[i] = { ...s.academic_sessions[i], ...session }
        else s.academic_sessions.push({ id: `sess-${Date.now()}`, status: 'upcoming', is_active: false, ...session })
        if (session.is_active)
          s.academic_sessions = s.academic_sessions.map((x) =>
            x.name === session.name ? x : { ...x, is_active: false, status: x.status === 'active' ? 'closed' : x.status },
          )
        return s
      })
      return true
    }
    const { error } = await supabase.from('academic_sessions').upsert(session, { onConflict: 'name' })
    if (error) throw error
    return true
  },

  /* ------------------------------------------------------------- sections -- */
  async listSections(includeArchived = false) {
    if (isDemo()) {
      const s = read()
      return (includeArchived ? s.class_sections : s.class_sections.filter((c) => c.is_active)).map((c) => ({
        ...c,
        mentor_teacher_name: s.teachers.find((t) => t.id === c.mentor_teacher_id)?.full_name || null,
        enrolled: s.student_enrollments.filter((e) => e.class_section_id === c.id && e.enrollment_status === 'active').length,
      }))
    }
    let q = supabase.from('class_sections').select('*, mentor:profiles(full_name)')
    if (!includeArchived) q = q.eq('is_active', true)
    const { data, error } = await q.order('grade').order('section')
    if (error) throw error
    return (data || []).map((r) => ({ ...r, mentor_teacher_name: r.mentor?.full_name || null }))
  },

  async saveSection(section) {
    if (isDemo()) {
      await write((s) => {
        const i = s.class_sections.findIndex((c) => c.id === section.id || c.name === section.name)
        const prev = i >= 0 ? s.class_sections[i] : null
        const row = {
          id: section.id || `sec-${String(section.name).replace(/[^0-9A-Za-z]/g, '')}`,
          name: section.name,
          grade: gradeValue(section.grade),
          section: section.section,
          stream: section.stream,
          band: section.band,
          group: section.group,
          bell_schedule_id: section.bell_schedule_id,
          mentor_teacher_id: section.mentor_teacher_id || null,
          default_room: section.default_room || null,
          is_active: section.is_active !== false,
          curriculum: section.curriculum || null,
        }
        if (i >= 0) s.class_sections[i] = { ...prev, ...row }
        else s.class_sections.push(row)
        // A brand-new home room has to be bookable in the builder.
        if (row.default_room && !s.school_settings.rooms.includes(row.default_room)) s.school_settings.rooms.push(row.default_room)
        // The demo denormalises the class label across five tables; a rename that
        // stops at class_sections would silently orphan every period it owns.
        if (prev && prev.name !== row.name) {
          const old = prev.name
          const move = (r) => {
            if (r.class_section === old) r.class_section = row.name
            if (r.class_section_id === prev.id) r.class_section_id = row.id
          }
          s.timetable_slots.forEach(move)
          s.class_codes.forEach(move)
          s.student_enrollments.forEach(move)
          s.profiles.forEach((p) => {
            if (p.class_section === old) p.class_section = row.name
          })
        }
        s.audit_logs.unshift({
          id: uid('aud'),
          actor_id: 'adm-01',
          actor_role: 'admin',
          action: !prev ? 'class.create' : row.is_active === false ? 'class.archive' : 'class.update',
          target: row.name,
          metadata: {
            grade: row.grade,
            section: row.section,
            stream: row.stream,
            room: row.default_room,
            renamed_from: prev && prev.name !== row.name ? prev.name : undefined,
          },
          at: new Date().toISOString(),
        })
        // A class without its group is a class the school cannot talk to.
        ensureGroupRow(s, row, { actor_id: 'adm-01', actor_name: personName(s, 'adm-01') || 'the school' })
        // Posts are never destroyed with a class: the group goes read-only and the
        // history stays for the students who were in it.
        if (prev && prev.id === row.id && row.is_active === false) {
          const g = s.class_groups.find((x) => String(x.class_section_id) === String(row.id))
          if (g && g.is_active !== false) {
            g.is_active = false
            g.archived_at = nowIso()
            logAction(s, { actor_id: 'adm-01', action: 'group.archive', target: row.name, metadata: { reason: 'class archived' } })
          }
        }
        return s
      })
      return true
    }
    // Live rows carry a uuid primary key, so a demo-style slug can never be sent.
    const payload = {
      name: section.name,
      grade: gradeValue(section.grade),
      section: section.section,
      stream: section.stream || null,
      mentor_teacher_id: section.mentor_teacher_id || null,
      default_room: section.default_room || null,
      is_active: section.is_active !== false,
    }
    const uuid = typeof section.id === 'string' && /^[0-9a-f]{8}-/i.test(section.id) ? section.id : null
    if (uuid) {
      const { error } = await supabase.from('class_sections').update(payload).eq('id', uuid)
      if (error) throw error
    } else {
      const { error } = await supabase.from('class_sections').insert(payload)
      if (error) throw error
    }
    return true
  },

  /** What is still hanging off a section, so removal can be explained honestly. */
  async sectionUsage(sectionId) {
    if (isDemo()) {
      const s = read()
      return {
        slots: s.timetable_slots.filter((x) => x.class_section_id === sectionId).length,
        enrollments: s.student_enrollments.filter((e) => e.class_section_id === sectionId && e.enrollment_status === 'active').length,
        history: s.student_enrollments.filter((e) => e.class_section_id === sectionId).length,
        codes: s.class_codes.filter((c) => c.class_section_id === sectionId).length,
      }
    }
    const [[slots, slotErr], [enrollments, enrErr], [codes, codeErr]] = await Promise.all([
      supabase.from('timetable_slots').select('id', { count: 'exact', head: true }).eq('class_section_id', sectionId),
      supabase.from('student_enrollments').select('id', { count: 'exact', head: true }).eq('class_section_id', sectionId),
      supabase.from('class_codes').select('id', { count: 'exact', head: true }).eq('class_section_id', sectionId),
    ])
    if (slotErr || enrErr || codeErr) throw slotErr || enrErr || codeErr
    return { slots: slots.count || 0, enrollments: enrollments.count || 0, history: enrollments.count || 0, codes: codes.count || 0 }
  },

  /**
   * Permanent removal. A section that has ever enrolled a student cannot be
   * deleted without erasing their academic record, so that case is refused and
   * the caller is expected to archive instead.
   */
  async deleteSection(sectionId) {
    const usage = await db.sectionUsage(sectionId)
    if (usage.enrollments) {
      const err = new Error('Students are still enrolled in this class.')
      err.code = 'section_has_students'
      throw err
    }
    if (isDemo()) {
      await write((s) => {
        const gone = s.class_sections.find((c) => c.id === sectionId)
        if (!gone) return s
        s.class_sections = s.class_sections.filter((c) => c.id !== sectionId)
        s.timetable_slots = s.timetable_slots.filter((x) => x.class_section_id !== sectionId)
        s.class_codes = s.class_codes.filter((c) => c.class_section_id !== sectionId)
        s.student_enrollments = s.student_enrollments.filter((e) => e.class_section_id !== sectionId)
        s.profiles.forEach((p) => {
          if (p.class_section === gone.name) p.class_section = null
        })
        // The class is gone but what was said in its group is history: the group is
        // closed and kept, never deleted with it.
        const group = (s.class_groups || []).find((g) => String(g.class_section_id) === String(sectionId))
        if (group) {
          group.is_active = false
          group.archived_at = nowIso()
          ;(s.group_members || []).forEach((m) => {
            if (m.group_id === group.id && m.source === 'enrolment') {
              m.active = false
              m.removed_at = nowIso()
              m.removed_by_name = 'class removed'
            }
          })
          s.audit_logs.unshift({
            id: uid('aud'),
            actor_id: 'adm-01',
            actor_role: 'admin',
            action: 'group.close',
            target: group.class_section,
            metadata: { posts_kept: (s.group_posts || []).filter((p) => p.group_id === group.id).length },
            at: nowIso(),
          })
        }
        s.audit_logs.unshift({
          id: uid('aud'),
          actor_id: 'adm-01',
          actor_role: 'admin',
          action: 'class.delete',
          target: gone.name,
          metadata: { slots_removed: usage.slots, codes_removed: usage.codes },
          at: new Date().toISOString(),
        })
        return s
      })
      return usage
    }
    const { error } = await supabase.from('class_sections').delete().eq('id', sectionId)
    if (error) throw error
    return usage
  },

  /* ------------------------------------------------------ section subjects -- */
  /** Weekly subject load for one class — what the timetable has to fill. */
  async listSectionSubjects(sectionId) {
    if (isDemo()) {
      const s = read()
      const sec = s.class_sections.find((c) => c.id === sectionId)
      return Object.entries(sec?.curriculum || {}).map(([subject, weekly_periods]) => ({ subject, weekly_periods }))
    }
    const { data, error } = await supabase
      .from('section_subjects')
      .select('subject, weekly_periods')
      .eq('class_section_id', sectionId)
      .order('subject')
    if (error) throw error
    return data || []
  },

  async saveSectionSubjects(sectionId, rows) {
    const clean = rows
      .map((r) => ({ subject: String(r.subject || '').trim(), weekly_periods: Number(r.weekly_periods) }))
      .filter((r) => r.subject && r.weekly_periods > 0)
    if (isDemo()) {
      await write((s) => {
        const sec = s.class_sections.find((c) => c.id === sectionId)
        if (!sec) return s
        sec.curriculum = Object.fromEntries(clean.map((r) => [r.subject, r.weekly_periods]))
        s.audit_logs.unshift({
          id: uid('aud'),
          actor_id: 'adm-01',
          actor_role: 'admin',
          action: 'class.subjects.update',
          target: sec.name,
          metadata: { subjects: clean.length, periods: clean.reduce((n, r) => n + r.weekly_periods, 0) },
          at: new Date().toISOString(),
        })
        return s
      })
      return clean
    }
    await supabase.from('section_subjects').delete().eq('class_section_id', sectionId)
    const { error } = await supabase.from('section_subjects').insert(clean.map((r) => ({ ...r, class_section_id: sectionId })))
    if (error) throw error
    return clean
  },

  async listClassNames() {
    return (await db.listSections()).map((s) => s.name)
  },

  /* ---------------------------------------------------------- enrollments -- */
  async listEnrollments(studentId) {
    if (isDemo()) {
      const s = read()
      return s.student_enrollments
        .filter((e) => String(e.student_id) === String(studentId))
        .map((e) => ({ ...e, session_name: s.academic_sessions.find((a) => a.id === e.academic_session_id)?.name || null }))
        .sort((a, b) => (a.enrolled_at < b.enrolled_at ? 1 : -1))
    }
    const { data, error } = await supabase
      .from('student_enrollments')
      .select('*, academic_sessions(name), class_sections(name)')
      .eq('student_id', studentId)
      .order('enrolled_at', { ascending: false })
    if (error) throw error
    return data || []
  },

  /* ----------------------------------------------------------- class codes */
  /** Live mode never returns a usable code — only the hint and its metadata. */
  async listClassCodes() {
    if (isDemo()) {
      const s = read()
      return s.class_codes.map((c) => ({
        ...c,
        class_section: s.class_sections.find((x) => x.id === c.class_section_id)?.name || c.class_section,
        session_name: s.academic_sessions.find((a) => a.id === c.academic_session_id)?.name || null,
      }))
    }
    const { data, error } = await supabase
      .from('class_codes')
      .select('id, class_section_id, academic_session_id, code_hint, status, generated_at, last_regenerated_at, expires_at, class_sections(name), academic_sessions(name)')
      .order('generated_at', { ascending: false })
    if (error) throw error
    return (data || []).map((r) => ({ ...r, class_section: r.class_sections?.name, session_name: r.academic_sessions?.name }))
  },

  /** Plaintext is returned exactly once, at generation time. */
  async generateClassCode(classSectionId, { sessionName, expiresInDays = 180 } = {}) {
    const raw = await db._issueCode(classSectionId, sessionName, expiresInDays)
    return raw
  },

  async _issueCode(classSectionId, sessionName, expiresInDays) {
    if (isDemo()) {
      const s = await pitchStore.ready()
      const sec = s.class_sections.find((c) => c.id === classSectionId) || s.class_sections.find((c) => c.name === classSectionId)
      const sess = s.academic_sessions.find((a) => a.name === sessionName) || s.academic_sessions.find((a) => a.is_active)
      const stream = /science/i.test(sec.name) ? 'SCI' : /commerce/i.test(sec.name) ? 'COM' : /human/i.test(sec.name) ? 'HUM' : 'GEN'
      const grade = (sec.name.match(/\d+/) || ['00'])[0]
      const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      const rand = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('')
      const plaintext = `${stream}${grade}${sec.section || 'A'}-${sess.name.slice(0, 4)}-${rand}`
      const hash = await pitchStore.hash(plaintext)
      await write((st) => {
        const i = st.class_codes.findIndex((c) => c.class_section_id === sec.id && c.academic_session_id === sess.id)
        const row = {
          id: i >= 0 ? st.class_codes[i].id : `code-${Date.now()}`,
          class_section_id: sec.id,
          class_section: sec.name,
          academic_session_id: sess.id,
          code_hash: hash,
          code_hint: `${plaintext.slice(0, 3)}••••-${plaintext.split('-')[1]}-•••`,
          demo_plaintext: plaintext,
          status: 'active',
          generated_at: new Date().toISOString(),
          last_regenerated_at: i >= 0 ? new Date().toISOString() : null,
          expires_at: new Date(Date.now() + expiresInDays * 86400000).toISOString(),
        }
        if (i >= 0) st.class_codes[i] = row
        else st.class_codes.push(row)
        st.audit_logs.unshift({
          id: uid('aud'),
          actor_id: 'adm-01',
          actor_role: 'admin',
          action: i >= 0 ? 'code.regenerate' : 'code.generate',
          target: sec.name,
          metadata: { session: sess.name, expires_in_days: expiresInDays },
          at: new Date().toISOString(),
        })
        return st
      })
      return { plaintext, hint: row2hint(plaintext), class_section: sec.name, session_name: sess.name }
    }
    const { data, error } = await supabase.rpc('generate_class_code', {
      p_class_section_id: classSectionId,
      p_expires_in_days: expiresInDays,
    })
    if (error) throw error
    return data
  },

  async setCodeStatus(codeId, status) {
    if (isDemo()) {
      await write((s) => {
        const i = s.class_codes.findIndex((c) => c.id === codeId)
        if (i >= 0) s.class_codes[i].status = status
        return s
      })
      return true
    }
    const { error } = await supabase.from('class_codes').update({ status }).eq('id', codeId)
    if (error) throw error
    return true
  },

  async setCodeExpiry(codeId, expires_at) {
    if (isDemo()) {
      await write((s) => {
        const i = s.class_codes.findIndex((c) => c.id === codeId)
        if (i >= 0) s.class_codes[i].expires_at = expires_at
        return s
      })
      return true
    }
    const { error } = await supabase.from('class_codes').update({ expires_at }).eq('id', codeId)
    if (error) throw error
    return true
  },

  /** Demo-only affordance so the student journey stays testable without keys. */
  demoClassCodes() {
    return isDemo() ? DEMO_CODES : []
  },

  /* ------------------------------------------------- student verification -- */
  /**
   * Live path calls verify_and_enroll(), which reads auth.uid() itself and
   * enforces directory membership, active status, session, expiry and rate
   * limiting. The browser never supplies a user id.
   */
  async verifyClassCode(classSection, accessCode, { sessionName } = {}) {
    if (isDemo()) {
      const s = await pitchStore.ready()
      const stored = loadSession()
      // The directories decide who is a student; a profile row is only a cache of that.
      const authz = resolveDemoAuthorization(stored?.email, stored?.id)
      const me = authz.access === 'granted' && authz.role === 'student' ? authz.profile : null
      if (!me) return { ok: false, error: 'Only an approved student can verify a class.' }

      const attempts = s.verification_attempts.filter((a) => a.email === normEmail(me.email) && Date.now() - new Date(a.at).getTime() < 10 * 60_000)
      if (attempts.length >= 5)
        return { ok: false, error: 'Too many failed attempts. Wait 10 minutes, then try again or see the office.', locked: true }

      const sec = s.class_sections.find((c) => c.name === classSection)
      const sess = s.academic_sessions.find((a) => (sessionName ? a.name === sessionName : a.is_active))
      const code = s.class_codes.find((c) => c.class_section_id === sec?.id && c.academic_session_id === sess?.id)

      const fail = async (error) => {
        await write((st) => ({ ...st, verification_attempts: [...st.verification_attempts, { email: normEmail(me.email), at: new Date().toISOString() }] }))
        return { ok: false, error }
      }

      if (!sec || !sess || !code) return fail('That class is not open for verification in the active session.')
      if (code.status !== 'active') return fail('This class code has been deactivated. Ask the office for a new one.')
      if (code.expires_at && new Date(code.expires_at) < new Date()) return fail('This class code has expired. Ask the office for a new one.')
      if ((await pitchStore.hash(accessCode)) !== code.code_hash) return fail('Invalid class code for this section.')

      const prev = s.student_enrollments.find((e) => String(e.student_id) === String(me.id) && e.enrollment_status === 'active')
      await write((st) => {
        st.student_enrollments = st.student_enrollments.map((e) =>
          String(e.student_id) === String(me.id) && e.enrollment_status === 'active' ? { ...e, enrollment_status: 'superseded' } : e,
        )
        st.student_enrollments.push({
          id: `enr-${Date.now()}`,
          student_id: me.id,
          academic_session_id: sess.id,
          class_section_id: sec.id,
          class_section: sec.name,
          enrollment_status: 'active',
          enrolled_at: new Date().toISOString(),
          promoted_from_enrollment_id: prev?.id || null,
        })
        const pi = st.profiles.findIndex((p) => String(p.id) === String(me.id))
        if (pi >= 0) st.profiles[pi].class_section = sec.name
        st.verification_attempts = st.verification_attempts.filter((a) => a.email !== normEmail(me.email))
        st.audit_logs.unshift({
          id: uid('aud'),
          actor_id: me.id,
          actor_role: 'student',
          action: prev ? 'student.promote' : 'student.verify',
          target: sec.name,
          metadata: { session: sess.name, from: prev?.class_section || null },
          at: new Date().toISOString(),
        })
        return st
      })
      return { ok: true, class_section: sec.name, session_name: sess.name, promoted: Boolean(prev) }
    }

    const { data, error } = await supabase.rpc('verify_and_enroll', {
      p_class_section: classSection,
      p_access_code: String(accessCode).trim().toUpperCase(),
      p_session_name: sessionName || null,
    })
    if (error) return { ok: false, error: error.message }
    if (!data?.ok) return { ok: false, error: data?.error || 'Verification failed.', locked: data?.locked }
    return { ok: true, class_section: data.class_section, session_name: data.session_name, promoted: data.promoted }
  },

  /* ------------------------------------------------------------ timetable -- */
  async listSlots(filters = {}) {
    if (isDemo()) {
      const s = await pitchStore.ready()
      const absences = new Set((s.teacher_absences || []).map((a) => String(a.teacher_id)))
      return s.timetable_slots.filter((slot) => {
        if (filters.class_section && slot.class_section !== filters.class_section) return false
        if (filters.class_section_id && slot.class_section_id !== filters.class_section_id) return false
        if (filters.teacher_id && String(slot.teacher_id) !== String(filters.teacher_id)) return false
        if (filters.room && normRoom(slot.room) !== normRoom(filters.room)) return false
        if (filters.day && slot.day !== filters.day) return false
        if (filters.period !== undefined && filters.period !== null && Number(slot.period) !== Number(filters.period)) return false
        if (filters.subject && slot.subject !== filters.subject) return false
        if (filters.academic_session_id && slot.academic_session_id !== filters.academic_session_id) return false
        return true
      }).map((slot) => ({
        ...slot,
        absent: absences.has(String(slot.teacher_id)),
      }))
    }
    let q = supabase.from('timetable_slots').select('*, class_sections(name)')
    if (filters.class_section_id) q = q.eq('class_section_id', filters.class_section_id)
    if (filters.class_section) q = q.eq('class_sections.name', filters.class_section)
    if (filters.teacher_id) q = q.eq('teacher_id', filters.teacher_id)
    if (filters.room) q = q.eq('room', filters.room)
    if (filters.day) q = q.eq('day', filters.day)
    if (filters.period) q = q.eq('period', filters.period)
    if (filters.subject) q = q.eq('subject', filters.subject)
    if (filters.academic_session_id) q = q.eq('academic_session_id', filters.academic_session_id)
    const { data, error } = await q
    if (error) throw error
    return (data || []).map((r) => ({ ...r, class_section: r.class_sections?.name || r.class_section }))
  },

  /**
   * Upsert through an RPC so the conflict check and the write happen in one
   * transaction — two admins saving the same bell cannot both win.
   */
  async saveSlot(slot) {
    if (isDemo()) {
      const { checkSlot } = await import('./conflicts')
      const s = await pitchStore.ready()
      const others = s.timetable_slots.filter(
        (x) => !(x.day === slot.day && Number(x.period) === Number(slot.period) && x.class_section === slot.class_section),
      )
      const verdict = checkSlot(others, slot, s.teachers, { maxPeriodsPerDay: 7 })
      if (!verdict.ok) {
        const err = new Error(verdict.conflicts.map((c) => c.message).join(' '))
        err.conflicts = verdict.conflicts
        throw err
      }
      await write((st) => {
        const i = st.timetable_slots.findIndex(
          (x) => x.day === slot.day && Number(x.period) === Number(slot.period) && x.class_section === slot.class_section,
        )
        const row = {
          ...slot,
          id: slot.id || `slot-${slot.day.slice(0, 3)}-${slot.period}-${slot.class_section.replace(/[^0-9A-Za-z]/g, '')}`,
        }
        if (i >= 0) st.timetable_slots[i] = { ...st.timetable_slots[i], ...row }
        else st.timetable_slots.push(row)
        st.audit_logs.unshift({
          id: uid('aud'),
          actor_id: 'adm-01',
          actor_role: 'admin',
          action: i >= 0 ? 'timetable.update' : 'timetable.create',
          target: `${slot.class_section} ${slot.day} P${slot.period}`,
          metadata: { subject: slot.subject, teacher: slot.teacher_name, room: slot.room },
          at: new Date().toISOString(),
        })
        return st
      })
      return slot
    }
    const { data, error } = await supabase.rpc('upsert_timetable_slot', { p_slot: slot })
    if (error) throw error
    if (!data?.ok) {
      const err = new Error(data?.conflicts?.map((c) => c.message).join(' ') || 'Conflict detected.')
      err.conflicts = data?.conflicts || []
      throw err
    }
    return data.slot
  },

  async deleteSlot(id) {
    if (isDemo()) {
      await write((s) => ({ ...s, timetable_slots: s.timetable_slots.filter((x) => String(x.id) !== String(id)) }))
      return true
    }
    const { error } = await supabase.from('timetable_slots').delete().eq('id', id)
    if (error) throw error
    return true
  },

  /**
   * Bulk copies run through the same conflict engine as a single-cell edit: each
   * period is checked against the live board *and* against the rows already
   * written in this pass, so a copy cannot double-book a teacher or hand out an
   * occupied room. Anything that fails comes back in `blocked` with a reason —
   * it is never dropped quietly.
   */
  async _copySlots({ rows, place, overwrite, carryNotes, withStaff = true, auditTarget }) {
    const { checkSlot } = await import('./conflicts')
    const s = await pitchStore.ready()
    const written = []
    const blocked = []
    let replaced = 0

    for (const src of rows) {
      const candidate = { ...src, ...place(src) }
      candidate.id = null
      candidate.is_substitution = false
      candidate.substitute_teacher_name = null
      candidate.sub_notes = null
      if (!carryNotes) {
        candidate.homework_note = ''
        candidate.topic_note = ''
      }
      if (!withStaff) {
        // The shape of the week without the people in it: a new section gets its
        // bells laid out first, then the office fills the staff into them.
        candidate.teacher_id = null
        candidate.teacher_name = ''
      }
      const at = (x) =>
        x.class_section === candidate.class_section && x.day === candidate.day && Number(x.period) === Number(candidate.period)
      const existing = s.timetable_slots.find(at)
      if (existing && !overwrite) {
        blocked.push({
          day: candidate.day,
          period: candidate.period,
          subject: src.subject,
          reason: `${candidate.day} P${candidate.period} in ${candidate.class_section} already holds ${existing.subject}.`,
        })
        continue
      }
      const verdict = checkSlot(
        [...s.timetable_slots.filter((x) => !at(x)), ...written],
        candidate,
        s.teachers,
        { maxPeriodsPerDay: 7 },
      )
      if (!verdict.ok) {
        blocked.push({
          day: candidate.day,
          period: candidate.period,
          subject: src.subject,
          reason: verdict.conflicts.map((c) => c.message).join(' '),
        })
        continue
      }
      const row = {
        ...candidate,
        id: `slot-${candidate.day.slice(0, 3)}-${candidate.period}-${String(candidate.class_section).replace(/[^0-9A-Za-z]/g, '')}`,
      }
      written.push(row)
      if (existing) replaced++
    }

    if (written.length) {
      await write((st) => {
        for (const row of written) {
          const i = st.timetable_slots.findIndex(
            (x) =>
              x.class_section === row.class_section && x.day === row.day && Number(x.period) === Number(row.period),
          )
          if (i >= 0) st.timetable_slots[i] = { ...st.timetable_slots[i], ...row }
          else st.timetable_slots.push(row)
        }
        st.audit_logs.unshift({
          id: uid('aud'),
          actor_id: loadSession()?.id || 'adm-01',
          actor_role: 'admin',
          action: 'timetable.copy',
          target: auditTarget,
          metadata: { written: written.length, replaced, blocked: blocked.length, carry_notes: carryNotes, with_staff: withStaff },
          at: new Date().toISOString(),
        })
        return st
      })
    }
    return { written: written.length, replaced, blocked }
  },

  /** Mirror one class's day onto another day of the same class. */
  async copyDayBoard({ classSection, fromDay, toDay, overwrite = false, carryNotes = false, withStaff = true } = {}) {
    if (!classSection) throw new Error('Choose a class first.')
    if (!fromDay || !toDay) throw new Error('Pick the day to copy and the day to copy it onto.')
    if (fromDay === toDay) throw new Error('The source and destination days are the same.')

    if (isDemo()) {
      const s = await pitchStore.ready()
      const rows = s.timetable_slots.filter((x) => x.class_section === classSection && x.day === fromDay)
      if (!rows.length) throw new Error(`${classSection} has no periods on ${fromDay} yet.`)
      return db._copySlots({
        rows,
        place: () => ({ day: toDay }),
        overwrite,
        carryNotes,
        withStaff,
        auditTarget: `${classSection} ${fromDay} -> ${toDay}`,
      })
    }
    const { data, error } = await supabase.rpc('copy_timetable_board', {
      p_mode: 'day',
      p_source: fromDay,
      p_target: toDay,
      p_class: classSection,
      p_overwrite: overwrite,
      p_carry_notes: carryNotes,
      p_with_staff: withStaff,
    })
    if (error) throw error
    return data
  },

  /** Clone a whole week from one section onto another. */
  async copyClassBoard({ fromSection, toSection, overwrite = false, carryNotes = false, withStaff = true } = {}) {
    if (!fromSection || !toSection) throw new Error('Choose both classes.')
    if (fromSection === toSection) throw new Error('The source and destination classes are the same.')

    if (isDemo()) {
      const s = await pitchStore.ready()
      const rows = s.timetable_slots.filter((x) => x.class_section === fromSection)
      if (!rows.length) throw new Error(`${fromSection} has no periods on the board yet.`)
      const to = await s.class_sections.find((x) => x.name === toSection)
      if (!to) throw new Error(`${toSection} is not a registered section.`)
      return db._copySlots({
        rows,
        place: (x) => ({ class_section: toSection, class_section_id: to.id, id: null, room: to.default_room || x.room }),
        overwrite,
        carryNotes,
        withStaff,
        auditTarget: `${fromSection} -> ${toSection} (whole week)`,
      })
    }
    const { data, error } = await supabase.rpc('copy_timetable_board', {
      p_mode: 'class',
      p_source: fromSection,
      p_target: toSection,
      p_class: null,
      p_overwrite: overwrite,
      p_carry_notes: carryNotes,
      p_with_staff: withStaff,
    })
    if (error) throw error
    return data
  },

  async setHomework(slotId, note) {
    let slot = null
    if (isDemo()) {
      await write((s) => {
        const t = s.timetable_slots.find((x) => String(x.id) === String(slotId))
        if (t) {
          t.homework_note = note
          slot = { ...t }
        }
        s.audit_logs.unshift({
          id: uid('aud'),
          actor_id: loadSession()?.id || 'unknown',
          actor_role: 'teacher',
          action: 'homework.update',
          target: slotId,
          metadata: { length: note.length },
          at: new Date().toISOString(),
        })
        return s
      })
    } else {
      const { data, error } = await supabase
        .from('timetable_slots')
        .update({ homework_note: note })
        .eq('id', slotId)
        .select('subject, day, period, class_sections(name)')
        .single()
      if (error) throw error
      slot = { subject: data.subject, day: data.day, class_section: data.class_sections?.name }
    }
    if (slot && note.trim()) {
      await db.pushNotification({
        audience: 'student',
        class_section: slot.class_section,
        kind: 'homework',
        title: `New homework · ${slot.subject}`,
        body: `Set for ${slot.day}. Open Homework to read what is due.`,
        link: '/student/homework',
      })
    }
    return true
  },

  /* ------------------------------------------------- absences & coverage -- */
  async listAbsences(date = new Date().toISOString().slice(0, 10)) {
    if (isDemo()) return read().teacher_absences.filter((a) => a.on_date === date)
    const { data, error } = await supabase.from('teacher_absences').select('*').eq('on_date', date)
    if (error) throw error
    return data || []
  },

  async setAbsence(teacherId, on, reason = '', date = new Date().toISOString().slice(0, 10)) {
    if (isDemo()) {
      await write((s) => ({
        ...s,
        teacher_absences: on
          ? [...s.teacher_absences.filter((a) => a.teacher_id !== teacherId || a.on_date !== date), { teacher_id: teacherId, on_date: date, reason }]
          : s.teacher_absences.filter((a) => !(a.teacher_id === teacherId && a.on_date === date)),
      }))
    } else if (on) {
      const { error } = await supabase
        .from('teacher_absences')
        .upsert({ teacher_id: teacherId, on_date: date, reason }, { onConflict: 'teacher_id,on_date' })
      if (error) throw error
    } else {
      const { error } = await supabase.from('teacher_absences').delete().eq('teacher_id', teacherId).eq('on_date', date)
      if (error) throw error
    }
    const name = (await db.teachers()).find((t) => String(t.id) === String(teacherId))?.full_name || 'A teacher'
    const dayName = DAYS[Math.min((new Date(`${date}T12:00:00`).getDay() + 6) % 7, DAYS.length - 1)]
    const open = on ? (await db.listSlots({ day: dayName })).filter((s) => String(s.teacher_id) === String(teacherId)).length : 0
    await db.pushNotification({
      audience: 'admin',
      kind: 'absence',
      title: on ? `${name} marked absent` : `${name} is back on duty`,
      body: on ? `${open} ${open === 1 ? 'period' : 'periods'} need cover on ${date}.` : `Their leave for ${date} was withdrawn.`,
      link: '/admin/substitutes',
    })
    return true
  },

  async availableSubstitutes({ day, period, class_section, subject }) {
    const [teachers, slots, absences] = await Promise.all([
      db.teachers(),
      db.listSlots({ day, period }),
      db.listAbsences(),
    ])
    const busy = new Set(slots.filter((s) => s.class_section !== class_section).map((s) => String(s.teacher_id)))
    const absent = new Set(absences.map((a) => String(a.teacher_id)))
    return teachers
      .filter((t) => !busy.has(String(t.id)) && !absent.has(String(t.id)))
      .map((t) => {
        const teaches = [t.subject, ...(t.extra || [])]
        return { ...t, matches_subject: subject ? teaches.includes(subject) : false, reason: subject && teaches.includes(subject) ? 'Teaches this subject' : 'Free period' }
      })
      .sort((a, b) => Number(b.matches_subject) - Number(a.matches_subject) || a.full_name.localeCompare(b.full_name))
  },

  async applySubstitution(slot, substitute) {
    const saved = await db.saveSlot({
      ...slot,
      is_substitution: true,
      substitute_teacher_id: substitute.id,
      substitute_teacher_name: substitute.full_name,
    })
    await db.pushNotification({
      audience: 'teacher',
      user_id: substitute.id,
      kind: 'substitution',
      title: `You are covering ${slot.class_section}`,
      body: `${slot.day} ${periodLabelOf(slot.period)} · ${slot.subject}${slot.room ? ` in ${slot.room}` : ''}.`,
      link: '/teacher/substitutions',
    })
    return saved
  },

  async clearSubstitution(slot) {
    const saved = await db.saveSlot({ ...slot, is_substitution: false, substitute_teacher_id: null, substitute_teacher_name: null })
    if (slot.substitute_teacher_id) {
      await db.pushNotification({
        audience: 'teacher',
        user_id: slot.substitute_teacher_id,
        kind: 'substitution',
        title: `Cover released · ${slot.class_section}`,
        body: `${slot.day} ${periodLabelOf(slot.period)} no longer needs you.`,
        link: '/teacher/substitutions',
      })
    }
    return saved
  },

  /* ----------------------------------------------- notifications & audit -- */
  /**
   * Notifications are written by the operations themselves — an absence, a
   * substitution, a published homework note — so the panel reflects what
   * actually happened in this school rather than a static list.
   */
  async pushNotification({ audience = 'admin', user_id = null, class_section = null, kind = 'system', title, body, link = null } = {}) {
    if (!title) return null
    const row = {
      id: uid('ntf'),
      audience,
      user_id,
      class_section,
      kind,
      title,
      body: body || '',
      link,
      at: new Date().toISOString(),
    }
    if (isDemo()) {
      await write((s) => {
        s.notifications = [row, ...(s.notifications || [])].slice(0, 200)
        return s
      })
      return row
    }
    const { data, error } = await supabase
      .from('notifications')
      .insert({ ...row, created_at: row.at })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async listNotifications(role, { limit = 40, tab = 'all' } = {}) {
    const session = loadSession()
    const userId = session?.id
    const myClass = isDemo() ? resolveDemoAuthorization(session?.email, userId).profile?.class_section || null : null
    /** A notice addressed to a person is only for that person. One addressed to a
     *  class is only for that class. Everything else reaches the whole role. */
    const forMe = (n) =>
      n.audience === role &&
      (n.user_id
        ? String(n.user_id) === String(userId)
        : n.class_section
          ? n.class_section === myClass
          : true)
    const byTab = (n) => (tab === 'unread' ? !n.read_at : tab === 'read' ? Boolean(n.read_at) : true)
    if (isDemo()) {
      const s = await pitchStore.ready()
      return (s.notifications || [])
        .filter((n) => forMe(n) && byTab(n))
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, limit)
        .map((n) => ({ ...n, when: relativeTime(n.at), read: Boolean(n.read_at) }))
    }
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('audience', role)
      .order('created_at', { ascending: false })
      .limit(200)
    return (data || [])
      .filter((n) => forMe(n) && byTab(n))
      .slice(0, limit)
      .map((n) => ({ ...n, at: n.created_at, when: relativeTime(n.created_at), read: Boolean(n.read_at) }))
  },

  async markNotification(id, read = true) {
    if (isDemo()) {
      await write((s) => {
        const n = (s.notifications || []).find((x) => String(x.id) === String(id))
        if (n) n.read_at = read ? new Date().toISOString() : null
        return s
      })
      return true
    }
    const { error } = await supabase.from('notifications').update({ read_at: read ? new Date().toISOString() : null }).eq('id', id)
    if (error) throw error
    return true
  },

  async markAllNotifications(role) {
    const userId = loadSession()?.id
    if (isDemo()) {
      const at = new Date().toISOString()
      await write((s) => {
        s.notifications = (s.notifications || []).map((n) =>
          n.audience === role && !n.read_at ? { ...n, read_at: at } : n,
        )
        return s
      })
      return true
    }
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('audience', role)
      .is('read_at', null)
    if (error) throw error
    return true
  },

  async deleteNotification(id) {
    if (isDemo()) {
      await write((s) => ({ ...s, notifications: (s.notifications || []).filter((n) => String(n.id) !== String(id)) }))
      return true
    }
    const { error } = await supabase.from('notifications').delete().eq('id', id)
    if (error) throw error
    return true
  },

  /* ------------------------------------------------------- academic calendar */
  async listCalendar() {
    if (isDemo()) {
      const s = await pitchStore.ready()
      return [...(s.calendar || []), ...(s.holidays || [])].sort((a, b) => (a.date < b.date ? -1 : 1))
    }
    const { data, error } = await supabase.from('calendar_events').select('*').order('date')
    if (error) throw error
    return data || []
  },

  async saveCalendarEvent(event) {
    const row = {
      id: event.id || uid('cal'),
      date: event.date,
      title: event.title,
      kind: event.kind || 'event',
      note: event.note || '',
      ends_on: event.ends_on || null,
    }
    if (isDemo()) {
      await write((s) => {
        s.calendar = s.calendar || []
        const i = s.calendar.findIndex((c) => c.id === row.id)
        if (i >= 0) s.calendar[i] = row
        else s.calendar.push(row)
        s.audit_logs.unshift({
          id: uid('aud'),
          actor_id: 'adm-01',
          actor_role: 'admin',
          action: i >= 0 ? 'calendar.update' : 'calendar.create',
          target: row.title,
          metadata: { date: row.date, kind: row.kind },
          at: new Date().toISOString(),
        })
        return s
      })
      return row
    }
    const { error } = await supabase.from('calendar_events').upsert(row)
    if (error) throw error
    return row
  },

  async deleteCalendarEvent(id) {
    if (isDemo()) {
      await write((s) => ({ ...s, calendar: (s.calendar || []).filter((c) => c.id !== id), holidays: (s.holidays || []).filter((h) => h.id !== id) }))
      return true
    }
    const { error } = await supabase.from('calendar_events').delete().eq('id', id)
    if (error) throw error
    return true
  },

  /* -------------------------------------------------------- subject catalog */
  /**
   * Subjects are derived from what every class actually teaches, so the
   * catalog can never drift from the timetable demand.
   */
  async listSubjectCatalog() {
    const [sections, teachers, slots] = await Promise.all([db.listSections(true), db.teachers(), db.listSlots()])
    const map = new Map()
    for (const s of sections) {
      for (const [subject, weekly] of Object.entries(s.curriculum || {})) {
        const e = map.get(subject) || { subject, weekly: 0, classes: [], teachers: new Set() }
        e.weekly += Number(weekly) || 0
        e.classes.push({ name: s.name, weekly: Number(weekly) || 0 })
        map.set(subject, e)
      }
    }
    for (const t of teachers) for (const sub of [t.subject, ...(t.extra || [])]) map.get(sub)?.teachers.add(t.id)
    for (const slot of slots) {
      const e = map.get(slot.subject)
      if (e) e.scheduled = (e.scheduled || 0) + 1
    }
    return [...map.values()]
      .map((e) => ({
        subject: e.subject,
        weekly: e.weekly,
        scheduled: e.scheduled || 0,
        classes: e.classes.sort((a, b) => b.weekly - a.weekly),
        teacherIds: [...e.teachers],
      }))
      .sort((a, b) => b.weekly - a.weekly || a.subject.localeCompare(b.subject))
  },

  /* ================================================= ChronoConnect groups === */
  /**
   * Every group this person may open. Teachers see what they manage and what they
   * were added to; a student sees only their own enrolled class — never a list of
   * the whole school.
   */
  async listGroups({ profile } = {}) {
    if (isDemo()) {
      const st = await pitchStore.ready()
      const id = profile?.id || loadSession()?.id
      const isAdmin = (st.allowed_admins || []).some((a) => String(a.id) === String(id)) || profile?.role === 'admin'
      const groups = st.class_groups || []
      if (isAdmin) return groups.map((g) => shapeGroup(st, g, id)).sort((a, b) => a.class_section.localeCompare(b.class_section))
      const mine = (st.group_members || []).filter((m) => String(m.user_id) === String(id) && m.active !== false)
      const ids = new Set(mine.map((m) => m.group_id))
      return groups
        .filter((g) => ids.has(g.id))
        .map((g) => shapeGroup(st, g, id))
        .sort((a, b) => (a.my_role === 'manager' && b.my_role !== 'manager' ? -1 : a.my_role !== 'manager' && b.my_role === 'manager' ? 1 : a.class_section.localeCompare(b.class_section)))
    }
    const id = profile?.id || (await supabase.auth.getUser()).data.user?.id
    const { data: adminRow } = await supabase.from('allowed_admins').select('id').eq('id', id).maybeSingle()
    let q = supabase
      .from('class_groups')
      .select('*, class_sections(name, is_active, mentor_teacher_id), group_members(user_id, role, active)')
    if (!adminRow?.id) q = q.eq('group_members.user_id', id)
    const { data, error } = await q
    if (error) throw error
    return (data || []).map((g) => ({
      id: g.id,
      class_section_id: g.class_section_id,
      class_section: g.class_sections?.name || g.class_section,
      is_active: g.is_active,
      settings: g.settings,
      teacher_count: (g.group_members || []).filter((m) => m.active && m.role === 'teacher').length,
      student_count: (g.group_members || []).filter((m) => m.active && m.role === 'student').length,
      member_count: (g.group_members || []).filter((m) => m.active).length,
      my_role: adminRow?.id ? 'admin' : (g.group_members || []).find((m) => String(m.user_id) === String(id) && m.active)?.role || null,
    }))
  },

  /** One group in full, refused before anything is read if the caller is not in it. */
  async getGroup(groupId, { profile } = {}) {
    if (isDemo()) {
      const st = await pitchStore.ready()
      const actorId = profile?.id || loadSession()?.id
      const { group, role, isAdmin } = groupAccess(st, groupId, actorId)
      if (!role) throw refusal('You are not a member of this class group.', 'group_forbidden')

      const members = (st.group_members || []).filter((m) => m.group_id === group.id && m.active !== false)
      const section = st.class_sections.find((s) => String(s.id) === String(group.class_section_id)) || null
      const live = (st.group_posts || []).filter((p) => p.group_id === group.id && !p.removed_at)
      // Comments are attached after the list is built: mapping over `posts` while
      // `posts` is still being assigned reads it before it exists.
      const posts = live
        .slice()
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .map((p) => ({
          ...p,
          author_name: personName(st, p.author_id) || 'Someone',
          comments: live
            .filter((c) => c.parent_id === p.id)
            .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
            .map((c) => ({ ...c, author_name: personName(st, c.author_id) || 'Someone' })),
        }))
        .filter((p) => !p.parent_id)

      return {
        ...shapeGroup(st, group, actorId),
        my_role: isAdmin ? 'admin' : role,
        section,
        members: members.map((m) => ({
          ...m,
          person: teacherProfile(st, m.user_id) || st.profiles.find((p) => String(p.id) === String(m.user_id)) || { id: m.user_id, full_name: personName(st, m.user_id) },
        })),
        teachers: members
          .filter((m) => m.role !== 'student')
          .map((m) => ({
            ...m,
            person: teacherProfile(st, m.user_id) || { id: m.user_id, full_name: personName(st, m.user_id) },
          }))
          .sort((a, b) => (a.role === 'manager' ? -1 : b.role === 'manager' ? 1 : String(a.person?.full_name).localeCompare(String(b.person?.full_name)))),
        students: members
          .filter((m) => m.role === 'student')
          .map((m) => ({ ...m, person: st.profiles.find((p) => String(p.id) === String(m.user_id)) || { id: m.user_id, full_name: personName(st, m.user_id) } })),
        posts,
        announcements: posts.filter((p) => p.kind === 'announcement' || p.pinned),
      }
    }
    const { data, error } = await supabase.rpc('get_class_group', { p_group_id: groupId })
    if (error) throw error
    if (!data?.ok) throw refusal(data?.reason || 'You are not a member of this class group.', 'group_forbidden')
    return data.group
  },

  /**
   * Registered staff this group does not have yet. Only the directory is offered:
   * someone who is not in the teacher directory cannot be added at all, which is
   * what keeps a class teacher from inventing members.
   */
  async groupCandidateTeachers(groupId, { profile } = {}) {
    if (isDemo()) {
      const st = await pitchStore.ready()
      const actorId = profile?.id || loadSession()?.id
      const { group, role } = groupAccess(st, groupId, actorId)
      if (role !== 'admin' && role !== 'manager') throw refusal('Only the class teacher or an administrator can manage this group.', 'not_manager')
      const inside = new Set((st.group_members || []).filter((m) => m.group_id === group.id && m.active !== false).map((m) => String(m.user_id)))
      const teaches = new Set(
        (st.timetable_slots || []).filter((s) => String(s.class_section_id) === String(group.class_section_id)).map((s) => String(s.teacher_id)),
      )
      return (st.teachers || [])
        .filter((t) => t.is_active !== false)
        .map((t) => ({
          id: t.id,
          full_name: t.full_name,
          subject: t.subject,
          extra: t.extra || [],
          employee_id: t.employee_id,
          is_member: inside.has(String(t.id)),
          teaches_this_class: teaches.has(String(t.id)),
        }))
        .sort((a, b) => Number(b.is_member) - Number(a.is_member) || Number(b.teaches_this_class) - Number(a.teaches_this_class) || a.full_name.localeCompare(b.full_name))
    }
    const { data, error } = await supabase.rpc('group_candidate_teachers', { p_group_id: groupId })
    if (error) throw error
    return data || []
  },

  /** Add teachers to the group. Duplicates are reported, never inserted twice. */
  async addGroupTeachers(groupId, teacherIds = [], { actor } = {}) {
    const ids = [...new Set((teacherIds || []).map(String))]
    if (!ids.length) throw refusal('Choose at least one teacher.', 'no_selection')
    if (isDemo()) {
      const st = await pitchStore.ready()
      const who = actorOf(st, actor)
      const { group, role } = groupAccess(st, groupId, who.id)
      if (role !== 'admin' && role !== 'manager') throw refusal('Only the class teacher or an administrator can add teachers.', 'not_manager')
      const result = { added: [], already: [], rejected: [] }
      await write((s) => {
        const g = ensureGroupRow(s, s.class_sections.find((c) => String(c.id) === String(group.class_section_id)) || { id: group.class_section_id, name: group.class_section, mentor_teacher_id: group.class_teacher_id, is_active: group.is_active }, { actor_id: who.id, actor_name: who.name })
        for (const tid of ids) {
          const person = teacherProfile(s, tid)
          if (!person) {
            result.rejected.push({ id: tid, reason: 'not in the teacher directory' })
            continue
          }
          if (String(person.id) === String(g.class_teacher_id)) {
            result.rejected.push({ id: tid, reason: 'is the class teacher of this group already' })
            continue
          }
          const { changed } = grantMembership(s, {
            group_id: g.id,
            user_id: person.id,
            role: 'teacher',
            source: 'manual',
            added_by: who.id,
            added_by_name: who.name,
          })
          if (!changed) {
            result.already.push(person.full_name)
            continue
          }
          result.added.push({ id: person.id, name: person.full_name })
          logAction(s, {
            actor_id: who.id,
            actor_role: role,
            action: 'group.teacher.add',
            target: g.class_section,
            metadata: { teacher: person.full_name, teacher_id: person.id },
          })
        }
        return s
      })
      await db.pushNotification({
        audience: 'teacher',
        user_id: ids.filter((i) => result.added.some((a) => a.id === i))[0] || null,
        class_section: group.class_section,
        kind: 'group',
        title: `Added to the ${group.class_section} group`,
        body: `${who.name} added you to the ChronoConnect group for ${group.class_section}.`,
        link: `/teacher/groups/${group.id}`,
      })
      return result
    }
    const { data, error } = await supabase.rpc('add_group_teachers', { p_group_id: groupId, p_teacher_ids: ids })
    if (error) throw error
    return data
  },

  /**
   * Remove a teacher. The class teacher cannot be removed by anyone through this
   * door — that is an administrative decision about who runs the class.
   */
  async removeGroupTeacher(groupId, userId, { actor } = {}) {
    if (isDemo()) {
      const st = await pitchStore.ready()
      const who = actorOf(st, actor)
      const { group, role } = groupAccess(st, groupId, who.id)
      if (role !== 'admin' && role !== 'manager') throw refusal('Only the class teacher or an administrator can remove teachers.', 'not_manager')
      if (String(group.class_teacher_id) === String(userId))
        throw refusal('The class teacher cannot be removed from their own group. Change the class teacher instead.', 'is_class_teacher')
      const target = teacherProfile(st, userId)
      const row = (st.group_members || []).find((m) => m.group_id === group.id && String(m.user_id) === String(userId) && m.active !== false)
      if (!row) throw refusal('That teacher is not in this group.', 'not_member')
      if (role === 'manager' && row.added_by !== who.id && row.source !== 'timetable') {
        // A manager may only undo what they did. Teachers added by the office or
        // by the timetable stay until an admin moves them.
        throw refusal('You can only remove teachers you added to this group.', 'not_your_addition')
      }
      await write((s) => {
        revokeMembership(s, { group_id: group.id, user_id: userId, removed_by: who.id, removed_by_name: who.name })
        logAction(s, {
          actor_id: who.id,
          actor_role: role,
          action: 'group.teacher.remove',
          target: group.class_section,
          metadata: { teacher: target?.full_name || userId, teacher_id: userId },
        })
        return s
      })
      return { removed: target?.full_name || userId }
    }
    const { data, error } = await supabase.rpc('remove_group_teacher', { p_group_id: groupId, p_teacher_id: userId })
    if (error) throw error
    return data
  },

  /** Who joined, who left, when, and on whose word. */
  async groupMembershipLog(groupId, { profile } = {}) {
    if (isDemo()) {
      const st = await pitchStore.ready()
      const actorId = profile?.id || loadSession()?.id
      const { group } = groupAccess(st, groupId, actorId)
      return (st.audit_logs || [])
        .filter((l) => (l.action === 'group.teacher.add' || l.action === 'group.teacher.remove' || l.action === 'group.manager') && l.target === group.class_section)
        .slice(0, 40)
        .map((l) => ({
          id: l.id,
          at: l.at,
          action: l.action.replace('group.', ''),
          who: personName(st, l.actor_id) || l.actor_id,
          teacher: l.metadata?.teacher || null,
          note: l.metadata?.to || null,
        }))
    }
    const { data, error } = await supabase.from('audit_logs').select('*').eq('target', groupId).order('at', { ascending: false }).limit(40)
    if (error) throw error
    return data || []
  },

  /** Admin only: move the class teacher, and the group manager follows with it. */
  async setClassTeacher(sectionId, teacherId, { actor } = {}) {
    if (isDemo()) {
      const st = await pitchStore.ready()
      const who = actorOf(st, actor)
      const isAdmin = (st.allowed_admins || []).some((a) => String(a.id) === String(who.id))
      if (!isAdmin) throw refusal('Only the school admin can change a class teacher.', 'not_admin')
      const section = st.class_sections.find((s) => String(s.id) === String(sectionId))
      if (!section) throw refusal('That class does not exist.', 'no_section')
      const person = teacherId ? teacherProfile(st, teacherId) : null
      if (teacherId && !person) throw refusal('That teacher is not in the staff directory.', 'unknown_teacher')
      await write((s) => {
        const row = s.class_sections.find((c) => String(c.id) === String(sectionId))
        row.mentor_teacher_id = teacherId || null
        ensureGroupRow(s, row, { actor_id: who.id, actor_name: personName(s, who.id) || 'the school' })
        logAction(s, {
          actor_id: who.id,
          action: 'class.teacher',
          target: row.name,
          metadata: { from: personName(s, section.mentor_teacher_id), to: person?.full_name || 'nobody' },
        })
        return s
      })
      if (person) {
        await db.pushNotification({
          audience: 'teacher',
          user_id: person.id,
          class_section: section.name,
          kind: 'group',
          title: `You are the class teacher of ${section.name}`,
          body: 'You now manage that class group: add teachers, publish notices and moderate the feed.',
          link: `/teacher/groups/${groupIdFor(sectionId)}`,
        })
      }
      return { section: section.name, teacher: person?.full_name || null }
    }
    const { data, error } = await supabase.rpc('set_class_teacher', { p_section_id: sectionId, p_teacher_id: teacherId })
    if (error) throw error
    return data
  },

  async postToGroup({ groupId, body, kind = 'post', parentId = null, author } = {}) {
    const text = String(body || '').trim()
    if (text.length < 2) throw refusal('Write something first.', 'empty')
    if (isDemo()) {
      const st = await pitchStore.ready()
      const who = actorOf(st, author)
      const { group, role } = groupAccess(st, groupId, who.id)
      const settings = group.settings || GROUP_DEFAULTS
      const allowed =
        role === 'admin' || role === 'manager' || role === 'teacher'
          ? true
          : role === 'student'
            ? parentId
              ? Boolean(settings.students_can_comment)
              : Boolean(settings.students_can_post)
            : false
      if (!role) throw refusal('You are not a member of this class group.', 'group_forbidden')
      if (!allowed)
        throw refusal(
          parentId ? 'Students cannot comment in this group.' : 'Students cannot publish to this group — only comment.',
          'student_post_locked',
        )
      if (group.is_active === false) throw refusal('This class is archived, so its group is read-only.', 'group_archived')
      const row = {
        id: uid('gpost'),
        group_id: group.id,
        parent_id: parentId,
        author_id: who.id,
        author_role: role,
        kind: parentId ? 'comment' : kind,
        body: text,
        pinned: false,
        created_at: nowIso(),
        edited_at: null,
        removed_at: null,
        removed_by: null,
        reactions: {},
      }
      await write((s) => {
        s.group_posts.push(row)
        logAction(s, { actor_id: who.id, actor_role: role, action: 'group.post', target: group.class_section, metadata: { kind: row.kind, length: text.length } })
        return s
      })
      return { ...row, author_name: who.name || personName(st, who.id) }
    }
    const { data, error } = await supabase
      .from('group_posts')
      .insert({ group_id: groupId, parent_id: parentId, body: text, kind: parentId ? 'comment' : kind })
      .select('*')
      .single()
    if (error) throw error
    return data
  },

  /** Pin is a moderation act: the class teacher and the admin only. */
  async setPostPinned(postId, pinned, { actor } = {}) {
    if (isDemo()) {
      const st = await pitchStore.ready()
      const who = actorOf(st, actor)
      const post = (st.group_posts || []).find((p) => p.id === postId)
      if (!post) throw refusal('That post is gone.', 'no_post')
      const { role } = groupAccess(st, post.group_id, who.id)
      if (role !== 'admin' && role !== 'manager') throw refusal('Only the class teacher can pin a post.', 'not_moderator')
      await write((s) => {
        const p = s.group_posts.find((x) => x.id === postId)
        p.pinned = Boolean(pinned)
        logAction(s, { actor_id: who.id, actor_role: role, action: pinned ? 'group.pin' : 'group.unpin', target: p.group_id, metadata: { post: postId } })
        return s
      })
      return { id: postId, pinned: Boolean(pinned) }
    }
    const { data, error } = await supabase.from('group_posts').update({ pinned: Boolean(pinned) }).eq('id', postId).select('id, pinned').single()
    if (error) throw error
    return data
  },

  /**
   * Removing a post. The author may take down their own; a moderator may remove
   * anyone's. The row is kept and marked, so moderation is auditable.
   */
  async removePost(postId, { actor } = {}) {
    if (isDemo()) {
      const st = await pitchStore.ready()
      const who = actorOf(st, actor)
      const post = (st.group_posts || []).find((p) => p.id === postId)
      if (!post) throw refusal('That post is gone.', 'no_post')
      const { group, role } = groupAccess(st, post.group_id, who.id)
      const mine = String(post.author_id) === String(who.id)
      if (!mine && role !== 'admin' && role !== 'manager') throw refusal('You cannot remove that post.', 'not_moderator')
      await write((s) => {
        s.group_posts
          .filter((p) => p.id === postId || p.parent_id === postId)
          .forEach((p) => {
            p.removed_at = nowIso()
            p.removed_by = who.id
          })
        logAction(s, {
          actor_id: who.id,
          actor_role: role || 'teacher',
          action: 'group.post.remove',
          target: group.class_section,
          metadata: { post: postId, own: mine, author: personName(s, post.author_id) },
        })
        return s
      })
      return { id: postId, removed: true }
    }
    const { data, error } = await supabase.rpc('remove_group_post', { p_post_id: postId })
    if (error) throw error
    return data
  },

  async reactToPost(postId, { actor } = {}) {
    if (isDemo()) {
      const st = await pitchStore.ready()
      const who = actorOf(st, actor)
      const post = (st.group_posts || []).find((p) => p.id === postId)
      if (!post) throw refusal('That post is gone.', 'no_post')
      const { role } = groupAccess(st, post.group_id, who.id)
      if (!role) throw refusal('You are not a member of this class group.', 'group_forbidden')
      await write((s) => {
        const p = s.group_posts.find((x) => x.id === postId)
        p.reactions = p.reactions || {}
        if (p.reactions[who.id]) delete p.reactions[who.id]
        else p.reactions[who.id] = '👍'
        return s
      })
      const fresh = (await pitchStore.ready()).group_posts.find((p) => p.id === postId)
      return { id: postId, reactions: fresh.reactions }
    }
    const { data, error } = await supabase.rpc('react_group_post', { p_post_id: postId })
    if (error) throw error
    return data
  },

  async saveGroupSettings(groupId, settings, { actor } = {}) {
    if (isDemo()) {
      const st = await pitchStore.ready()
      const who = actorOf(st, actor)
      const { group, role } = groupAccess(st, groupId, who.id)
      if (role !== 'admin' && role !== 'manager') throw refusal('Only the class teacher can change group settings.', 'not_manager')
      const next = { ...(group.settings || GROUP_DEFAULTS), ...settings }
      await write((s) => {
        const g = s.class_groups.find((x) => x.id === group.id)
        g.settings = next
        logAction(s, { actor_id: who.id, actor_role: role, action: 'group.settings', target: g.class_section, metadata: next })
        return s
      })
      return next
    }
    const { data, error } = await supabase.from('class_groups').update({ settings }).eq('id', groupId).select('settings').single()
    if (error) throw error
    return data?.settings
  },

  /** Archive or reopen a group. Admin only, and posts always survive both. */
  async setGroupActive(groupId, active, { actor } = {}) {
    if (isDemo()) {
      const st = await pitchStore.ready()
      const who = actorOf(st, actor)
      const { group } = groupAccess(st, groupId, who.id)
      if (!(st.allowed_admins || []).some((a) => String(a.id) === String(who.id))) throw refusal('Only the school admin can archive a group.', 'not_admin')
      await write((s) => {
        const g = s.class_groups.find((x) => x.id === group.id)
        g.is_active = Boolean(active)
        g.archived_at = active ? null : nowIso()
        logAction(s, { actor_id: who.id, action: active ? 'group.restore' : 'group.archive', target: g.class_section, metadata: { posts: (s.group_posts || []).filter((p) => p.group_id === g.id).length } })
        return s
      })
      return { id: groupId, is_active: Boolean(active) }
    }
    const { data, error } = await supabase.from('class_groups').update({ is_active: Boolean(active) }).eq('id', groupId).select('id, is_active').single()
    if (error) throw error
    return data
  },

  async listAudit(limit = 40) {
    if (isDemo()) return (await pitchStore.ready()).audit_logs.slice(0, limit)
    const { data } = await supabase.from('audit_logs').select('*').order('at', { ascending: false }).limit(limit)
    return data || []
  },

  /* --------------------------------------------------------------- demo --- */
  async resetDemo() {
    saveSession(null)
    await pitchStore.reset()
  },
  weekCapacity: () => DAYS.length * PERIODS.length,
}

const row2hint = (p) => `${p.slice(0, 3)}••••-${p.split('-')[1]}-•••`

function relativeTime(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / 1440)}d ago`
}

export { nowInTimezone }
