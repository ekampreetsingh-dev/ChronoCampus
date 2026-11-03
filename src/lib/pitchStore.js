import { DAYS, PERIODS } from './bellSchedule.js'
import { LAB_FOR } from './subjects.js'
import { buildGroups } from './groupSeed.js'
import { allRooms, assignMentors, buildSections, buildTeachers, PRE_PRIMARY } from './schoolSeed.js'

/**
 * Demo school. Mirrors the live Postgres shape one-for-one — three approved
 * directories, academic sessions, class sections, enrollments, hashed access
 * codes, audit log and notifications — so the UI exercises the real code paths
 * instead of a simplified copy of them.
 *
 * Demo data lives in localStorage and can never reach a school database.
 */

const SEED_VERSION = 7
const STORAGE_KEY = `chronocampus.demo.v${SEED_VERSION}`
const MAX_PERIODS_PER_DAY = 9 // juniors sit nine periods including the zero period

/* ------------------------------------------------------------------ seed --- */

export const SESSION_2627 = 'sess-2627'
export const SESSION_2728 = 'sess-2728'

const ACADEMIC_SESSIONS = [
  {
    id: SESSION_2627,
    name: '2026–27',
    start_date: '2026-04-01',
    end_date: '2027-03-31',
    status: 'active',
    is_active: true,
  },
  {
    id: SESSION_2728,
    name: '2027–28',
    start_date: '2027-04-01',
    end_date: '2028-03-31',
    status: 'upcoming',
    is_active: false,
  },
  {
    id: 'sess-2526',
    name: '2025–26',
    start_date: '2025-04-01',
    end_date: '2026-03-31',
    status: 'closed',
    is_active: false,
  },
]

/** Every section the school runs: the early-years wing, then classes 1–12. */
const CLASS_SECTIONS = buildSections()
export const SECTIONS = CLASS_SECTIONS.map((s) => s.name)
export const HOME_ROOM = Object.fromEntries(CLASS_SECTIONS.map((s) => [s.name, s.default_room]))
const CURRICULUM = Object.fromEntries(CLASS_SECTIONS.map((s) => [s.name, s.curriculum]))
const ROOMS = allRooms()
export const ALL_ROOMS = ROOMS

/**
 * The school's real bell times, as given: seniors sit a short day with a
 * 60-minute zero period and no break; juniors run to 2:20 pm with a break
 * after period 3. Winter variants are cloned and edited from the admin page.
 */
const BELL_SCHEDULES = [
  {
    id: 'bell-senior',
    name: 'Classes 11–12 · Regular',
    applies_to: 'senior',
    season: 'regular',
    is_active: true,
    effective_from: '2026-04-01',
    effective_to: null,
    departure: '11:40',
    periods: [
      { n: 0, label: '0', start: '08:00', end: '09:00' },
      { n: 1, label: 'P1', start: '09:00', end: '09:40' },
      { n: 2, label: 'P2', start: '09:40', end: '10:20' },
      { n: 3, label: 'P3', start: '10:20', end: '11:00' },
      { n: 4, label: 'P4', start: '11:00', end: '11:40' },
    ],
  },
  {
    id: 'bell-junior',
    name: 'Classes 1–10 · Regular',
    applies_to: 'junior',
    season: 'regular',
    is_active: true,
    effective_from: '2026-04-01',
    effective_to: null,
    departure: '14:20',
    periods: [
      { n: 0, label: '0', start: '08:00', end: '09:00' },
      { n: 1, label: 'P1', start: '09:00', end: '09:40' },
      { n: 2, label: 'P2', start: '09:40', end: '10:20' },
      { n: 3, label: 'P3', start: '10:20', end: '11:00' },
      { n: 4, label: 'P4', start: '11:20', end: '12:00' },
      { n: 5, label: 'P5', start: '12:00', end: '12:40' },
      { n: 6, label: 'P6', start: '12:40', end: '13:20' },
      { n: 7, label: 'P7', start: '13:20', end: '14:00' },
      { n: 8, label: 'P8', start: '14:00', end: '14:20' },
    ],
  },
  {
    id: 'bell-early',
    name: 'Early years · Regular',
    applies_to: 'early',
    season: 'regular',
    is_active: true,
    effective_from: '2026-04-01',
    effective_to: null,
    departure: '11:30',
    periods: [
      { n: 1, label: 'P1', start: '08:45', end: '09:20' },
      { n: 2, label: 'P2', start: '09:20', end: '09:55' },
      { n: 3, label: 'P3', start: '10:15', end: '10:50' },
      { n: 4, label: 'P4', start: '10:50', end: '11:25' },
    ],
  },
]

const INTENTIONALLY_EMPTY = new Set(['Friday|8'])

const HOMEWORK_LIBRARY = {
  Mathematics: ['NCERT Ex 5.3 — Q1 to Q12. Show construction steps.', 'Differentiation worksheet 4. Complete odd questions.', 'Practice 10 integrals from the board examples.'],
  Physics: ['HC Verma Ch 3 — objective questions 1 to 15.', 'Derive the projectile range formula. Bring the notebook.', 'Lab record: verification of Hooke’s law.'],
  Chemistry: ['NCERT Ex 3.2 full. Learn the reactivity series.', 'Balance the 12 redox equations on the handout.', 'Lab manual: titration observations signed by parent.'],
  'Computer Science': ['Build the student-record program with file handling.', 'Practice 8 SQL joins on the lab machine.', 'Read Ch 9, write pseudo-code for binary search.'],
  English: ['Essay: “Technology in the Classroom” — 300 words.', 'Summary of Chapter 6. Focus on the character arc.', 'Grammar workbook Unit 12, section B.'],
  Accountancy: ['Prepare the trial balance from the given ledger.', 'Journal entries for the March transactions, Q4 to Q9.', 'Revise depreciation methods for the Friday test.'],
  'Business Studies': ['Case study on page 88 — answer all four parts.', 'Compare sole trader and partnership in a table.', 'Notes on Fayol’s principles of management.'],
  Economics: ['Numericals on elasticity of demand, Q1 to Q10.', 'Short notes on the types of inflation.'],
  Biology: ['Diagrams of heart and nephron in the record file.', 'NCERT Ch 18 questions 1 to 6.'],
  Hindi: ['व्याकरण: संधि के उदाहरण लिखें।', 'पाठ 7 का सारांश — 150 शब्द।'],
  'Physical Education': ['Bring sports shoes and house-coloured kit.', 'Asana chart for the assessment.'],
  'General Science': ['Draw and label the diagram on page 92.', 'Complete the worksheet on states of matter.', 'Read the chapter and list five real-life examples.'],
  'Social Science': ['Map work: mark the rivers on the outline.', 'Answer questions 1 to 6 in your notebook.', 'Prepare a timeline for the chapter.'],
  'Art & Craft': ['Finish the clay model for the exhibition.', 'Bring sketch pens and a colour sheet.'],
  Sanskrit: ['Learn the shlokas by heart.', 'Write each word ten times in the copy.'],
}

/** Named demo staff first, then enough generated colleagues to cover 48 sections. */
export const TEACHERS = buildTeachers(CLASS_SECTIONS)

// Give the named demo staff something to mentor.
const MENTORS = { 'sec-11a': 'tch-01', 'sec-11b': 'tch-06', 'sec-12a': 'tch-02', 'sec-10a': 'tch-03', 'sec-9a': 'tch-05' }
for (const [id, t] of Object.entries(MENTORS)) {
  const sec = CLASS_SECTIONS.find((s) => s.id === id)
  if (sec) sec.mentor_teacher_id = t
}
// Then a class teacher for every remaining section, so no card reads "—".
assignMentors(CLASS_SECTIONS, TEACHERS)

export const teacherSubjects = (t) => [t.subject, ...(t.extra || [])].filter((s) => !s.startsWith('Class Teacher'))
export const teachersFor = (subject) => TEACHERS.filter((t) => teacherSubjects(t).includes(subject))

const ADMIN_SEED = [
  { id: 'adm-01', email: 'principal@chronocampus.edu.in', full_name: 'Col. S. S. Gill (Retd.)', designation: 'Principal', is_active: true },
  { id: 'adm-02', email: 'vp@chronocampus.edu.in', full_name: 'Harjit Kaur Sekhon', designation: 'Vice Principal', is_active: true },
  { id: 'adm-03', email: 'hod.science@chronocampus.edu.in', full_name: 'Dr. Anil Prakash Verma', designation: 'HOD, Science', is_active: true },
]

/** Students in the approved directory. Gurpreet is deliberately unenrolled. */
const STUDENT_SEED = [
  { id: 'stu-01', email: 'gurpreet.sandhu@student.chronocampus.edu.in', full_name: 'Gurpreet Singh Sandhu', admission_number: 'CC-2024-1187', is_active: true },
  { id: 'stu-02', email: 'aanya.iyer@student.chronocampus.edu.in', full_name: 'Aanya Iyer', admission_number: 'CC-2024-1102', is_active: true, section: '11-A Science' },
  { id: 'stu-03', email: 'mannat.kaur@student.chronocampus.edu.in', full_name: 'Mannat Kaur', admission_number: 'CC-2024-1131', is_active: true, section: '11-B Commerce' },
  { id: 'stu-04', email: 'arjun.nanda@student.chronocampus.edu.in', full_name: 'Arjun Nanda', admission_number: 'CC-2023-0984', is_active: true, section: '12-A Science' },
  { id: 'stu-05', email: 'zoya.khan@student.chronocampus.edu.in', full_name: 'Zoya Khan', admission_number: 'CC-2023-1009', is_active: true, section: '12-A Science' },
]

export const DEMO_STUDENT = STUDENT_SEED[0]

/**
 * Codes are stored as salted SHA-256 like production. The plaintext is kept only
 * in the demo build so the student journey stays testable, and the UI labels it
 * as demo-only everywhere it appears.
 */
/**
 * One code per section, derived deterministically from its name so the demo
 * school seeds the same way every time. The three sections the walkthroughs
 * use keep their published codes.
 */
const FIXED_CODES = {
  '11-A Science': 'SCI11A-2026-K7Q',
  '11-B Commerce': 'COM11B-2026-M4D',
  '12-A Science': 'SCI12A-2026-R9T',
}
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function codeForSection(name) {
  if (FIXED_CODES[name]) return FIXED_CODES[name]
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff
  const early = PRE_PRIMARY.find((p) => name.toUpperCase().startsWith(p.toUpperCase()))
  const grade = early ? early[0] : (name.match(/\d+/) || ['0'])[0]
  const letter = (name.match(/-(\w)/) || [, 'A'])[1].toUpperCase()
  const stream = early ? 'EY' : /science/i.test(name) ? 'SCI' : /commerce/i.test(name) ? 'COM' : /humanit/i.test(name) ? 'HUM' : grade <= 5 ? 'PRI' : 'JNR'
  const tail = Array.from({ length: 3 }, (_, i) => ALPHABET[(h >> (i * 4)) % ALPHABET.length]).join('')
  return `${stream}${grade}${letter}-2026-${tail}`
}

const CODE_SEED = CLASS_SECTIONS.map((s) => ({ section: s.name, code: codeForSection(s.name) }))

export const DEMO_CODES = CODE_SEED.map((c) => ({ class_section: c.section, access_code: c.code }))

const SCHOOL_SETTINGS = {
  school_name: 'ChronoCampus Public School',
  address: 'Sector 66, Mohali, Punjab',
  session_label: '2026–27',
  timezone: 'Asia/Kolkata',
  working_days: DAYS.slice(),
  email_password_enabled: true,
  approved_domain: 'chronocampus.edu.in',
  logo_url: null,
  rooms: ROOMS,
}

const HOLIDAYS = [
  { id: 'hol-1', date: '2026-11-01', name: 'Diwali break', kind: 'holiday' },
  { id: 'hol-2', date: '2026-12-25', name: 'Christmas', kind: 'holiday' },
]

/* --------------------------------------------------------- the scheduler --- */

const normalize = (r = '') => String(r).trim().toLowerCase()

function pickSubject(counts, taughtToday, takenTeachers, dailyLoad, day) {
  const candidates = []
  for (const [subject, left] of Object.entries(counts)) {
    if (left <= 0) continue
    const pool = teachersFor(subject).filter(
      (t) => !takenTeachers.has(t.id) && (dailyLoad.get(`${t.id}|${day}`) || 0) < MAX_PERIODS_PER_DAY,
    )
    if (!pool.length) continue
    candidates.push({ subject, left, pool, fresh: !taughtToday.has(subject) })
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => b.left - a.left || Number(b.fresh) - Number(a.fresh) || a.subject.localeCompare(b.subject))
  return candidates[0]
}

function assignRoom(subject, classSection, busyRooms) {
  const lab = LAB_FOR[subject]
  if (lab && !busyRooms.has(normalize(lab))) return lab
  const home = HOME_ROOM[classSection]
  if (!busyRooms.has(normalize(home))) return home
  return ROOMS.find((r) => !busyRooms.has(normalize(r))) || home
}

/** Period numbers a section actually sits, from its bell schedule. */
function periodSetFor(classSection) {
  const sec = CLASS_SECTIONS.find((c) => c.name === classSection)
  const bell = BELL_SCHEDULES.find((b) => b.id === sec?.bell_schedule_id) || BELL_SCHEDULES[0]
  return new Set((bell?.periods || []).map((p) => Number(p.n)))
}

const ALL_PERIOD_NUMBERS = [...new Set(BELL_SCHEDULES.flatMap((b) => b.periods.map((p) => Number(p.n))))].sort((a, b) => a - b)

export function generateSlots() {
  const slots = []
  const remaining = Object.fromEntries(Object.entries(CURRICULUM).map(([k, v]) => [k, { ...v }]))
  const dailyLoad = new Map()
  const periodSets = Object.fromEntries(Object.keys(CURRICULUM).map((c) => [c, periodSetFor(c)]))

  for (const period of ALL_PERIOD_NUMBERS) {
    for (const day of DAYS) {
      const taken = new Set()
      const busyRooms = new Set()
      for (const cls of Object.keys(CURRICULUM)) {
        // Seniors have no period 5-8, so those rows stay empty for them.
        if (!periodSets[cls].has(period)) continue
        if (INTENTIONALLY_EMPTY.has(`${day}|${period}`)) continue
        const taughtToday = new Set(slots.filter((s) => s.day === day && s.class_section === cls).map((s) => s.subject))
        const pick = pickSubject(remaining[cls], taughtToday, taken, dailyLoad, day)
        if (!pick) continue
        const teacher = pick.pool[0]
        const room = assignRoom(pick.subject, cls, busyRooms)
        taken.add(teacher.id)
        busyRooms.add(normalize(room))
        dailyLoad.set(`${teacher.id}|${day}`, (dailyLoad.get(`${teacher.id}|${day}`) || 0) + 1)
        remaining[cls][pick.subject] -= 1

        const notes = HOMEWORK_LIBRARY[pick.subject]
        const periodic = (period + DAYS.indexOf(day)) % 3 === 0
        slots.push({
          id: `slot-${day.slice(0, 3)}-${period}-${cls.replace(/[^0-9A-Za-z]/g, '')}`,
          day,
          period,
          class_section: cls,
          class_section_id: CLASS_SECTIONS.find((c) => c.name === cls)?.id || null,
          academic_session_id: SESSION_2627,
          subject: pick.subject,
          teacher_id: teacher.id,
          teacher_name: teacher.full_name,
          room,
          homework_note: notes && (periodic || pick.subject === 'Mathematics') ? notes[(period + DAYS.indexOf(day)) % notes.length] : '',
          is_substitution: false,
          substitute_teacher_id: null,
          substitute_teacher_name: null,
          sub_notes: null,
        })
      }
    }
  }
  return slots
}

/** One teacher on leave, their first period already covered, the rest awaiting action. */
function seedAbsence(slots) {
  const now = new Date()
  const onDate = now.toISOString().slice(0, 10)
  const day = DAYS[Math.min((now.getDay() + 6) % 7, DAYS.length - 1)]
  const absent = TEACHERS.find((t) => t.id === 'tch-04')
  const affected = slots.filter((s) => s.day === day && String(s.teacher_id) === absent.id).sort((a, b) => a.period - b.period)
  if (!affected.length) return { absences: [], substitutions: [], notifications: [] }

  const busyAt = new Map()
  for (const s of slots.filter((s) => s.day === day)) {
    const p = Number(s.period)
    busyAt.set(p, new Set([...(busyAt.get(p) || []), String(s.teacher_id)]))
  }

  const first = affected[0]
  const busy = busyAt.get(Number(first.period)) || new Set()
  busy.delete(absent.id)
  const pool = TEACHERS.filter((t) => t.id !== absent.id && !busy.has(t.id))
  const sub = pool.find((t) => t.id === 'tch-01') || pool.find((t) => teacherSubjects(t).includes(first.subject)) || pool[0]

  const substitutions = []
  if (sub) {
    first.is_substitution = true
    first.substitute_teacher_id = sub.id
    first.substitute_teacher_name = sub.full_name
    first.sub_notes = `${absent.full_name} is on casual leave today.`
    busy.add(sub.id)
    substitutions.push({
      id: 'sub-1',
      slot_id: first.id,
      absent_teacher_id: absent.id,
      substitute_teacher_id: sub.id,
      substitute_teacher_name: sub.full_name,
      day: first.day,
      period: first.period,
      class_section: first.class_section,
      subject: first.subject,
      reason: 'Casual leave',
      status: 'assigned',
      assigned_at: new Date().toISOString(),
    })
  }

  return {
    absences: [{ teacher_id: absent.id, on_date: onDate, reason: 'On casual leave', marked_by: 'adm-01' }],
    substitutions,
    notifications: [
      {
        id: 'ntf-1',
        audience: 'teacher',
        user_id: sub?.id || null,
        kind: 'substitution',
        title: `Cover ${first.class_section} · ${first.day} P${first.period}`,
        body: `${absent.full_name} is on casual leave. You are assigned for ${first.subject} in ${first.room}.`,
        at: new Date(Date.now() - 3600_000).toISOString(),
      },
      {
        id: 'ntf-2',
        audience: 'admin',
        kind: 'enrollment',
        title: '1 student has not verified a class',
        body: 'Gurpreet Singh Sandhu signed in but has no active enrollment for 2026–27.',
        at: new Date(Date.now() - 7200_000).toISOString(),
      },
      {
        id: 'ntf-3',
        audience: 'student',
        kind: 'homework',
        title: 'Homework updated for 11-A Science',
        body: 'Physics — derive the projectile range formula before the next period.',
        at: new Date(Date.now() - 9000_000).toISOString(),
      },
    ],
  }
}

/* ------------------------------------------------------------- build seed -- */

async function hashCode(code) {
  const salt = 'chronocampus-demo'
  const data = new TextEncoder().encode(`${salt}:${String(code).trim().toUpperCase()}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function enrollmentRows() {
  const rows = []
  for (const s of STUDENT_SEED) {
    if (!s.section) continue
    const sec = CLASS_SECTIONS.find((c) => c.name === s.section)
    rows.push({
      id: `enr-${s.id}`,
      student_id: s.id,
      academic_session_id: SESSION_2627,
      class_section_id: sec.id,
      class_section: sec.name,
      enrollment_status: 'active',
      enrolled_at: '2026-04-08T09:00:00.000Z',
      promoted_from_enrollment_id: sec.grade === 12 ? `enr-prev-${s.id}` : null,
    })
    if (sec.grade === 12) {
      rows.push({
        id: `enr-prev-${s.id}`,
        student_id: s.id,
        academic_session_id: 'sess-2526',
        class_section_id: sec.id,
        class_section: sec.name.replace('12', '11'),
        enrollment_status: 'completed',
        enrolled_at: '2025-04-10T09:00:00.000Z',
        promoted_from_enrollment_id: null,
      })
    }
  }
  return rows
}

async function buildSeed() {
  const slots = generateSlots()
  const seeded = seedAbsence(slots)
  const enrollments = enrollmentRows()
  const community = buildGroups({ sections: CLASS_SECTIONS, teachers: TEACHERS, slots, enrollments })
  const groupData = {
    class_groups: community.groups,
    group_members: community.members,
    group_posts: community.posts,
  }
  const codes = []
  for (const c of CODE_SEED) {
    const sec = CLASS_SECTIONS.find((s) => s.name === c.section)
    codes.push({
      id: `code-${sec.id}`,
      class_section_id: sec.id,
      class_section: sec.name,
      academic_session_id: SESSION_2627,
      code_hash: await hashCode(c.code),
      code_hint: `${c.code.slice(0, 3)}••••-${c.code.split('-')[1]}-•••`,
      demo_plaintext: c.code,
      status: 'active',
      generated_at: '2026-04-01T08:00:00.000Z',
      last_regenerated_at: null,
      expires_at: '2027-03-31T23:59:59.000Z',
    })
  }

  return {
    version: SEED_VERSION,
    profiles: [
      ...ADMIN_SEED.map((a) => ({ id: a.id, email: a.email, full_name: a.full_name, role: 'admin', designation: a.designation, subject: null, admission_number: null, employee_id: null, class_section: null, is_active: true })),
      ...TEACHERS.map((t) => ({ id: t.id, email: t.email, full_name: t.full_name, role: 'teacher', designation: null, subject: t.subject, admission_number: null, employee_id: t.employee_id, class_section: null, is_active: true })),
      ...STUDENT_SEED.map((s) => ({
        id: s.id,
        email: s.email,
        full_name: s.full_name,
        role: 'student',
        designation: null,
        subject: null,
        admission_number: s.admission_number,
        employee_id: null,
        class_section: s.section || null,
        is_active: true,
      })),
    ],
    allowed_admins: ADMIN_SEED,
    allowed_teachers: TEACHERS.map((t) => ({ id: t.id, email: t.email, full_name: t.full_name, subject: t.subject, phone: t.phone, employee_id: t.employee_id, is_active: true })),
    allowed_students: STUDENT_SEED.map(({ section, ...s }) => ({ ...s })),
    academic_sessions: ACADEMIC_SESSIONS,
    class_sections: CLASS_SECTIONS,
    bell_schedules: BELL_SCHEDULES,
    student_enrollments: enrollments,
    class_codes: codes,
    timetable_slots: slots,
    ...groupData,
    teacher_absences: seeded.absences,
    timetable_substitutions: seeded.substitutions,
    notifications: seeded.notifications,
    audit_logs: [
      { id: 'aud-1', actor_id: 'adm-01', actor_role: 'admin', action: 'directory.import', target: 'allowed_teachers', metadata: { rows: 8 }, at: '2026-04-01T08:12:00.000Z' },
      { id: 'aud-2', actor_id: 'adm-01', actor_role: 'admin', action: 'code.generate', target: '11-A Science', metadata: { session: '2026–27' }, at: '2026-04-01T08:20:00.000Z' },
    ],
    school_settings: SCHOOL_SETTINGS,
    holidays: HOLIDAYS,
    verification_attempts: [],
    teachers: TEACHERS.map((t) => ({ id: t.id, email: t.email, full_name: t.full_name, subject: t.subject, phone: t.phone, employee_id: t.employee_id, extra: t.extra, role: 'teacher', is_active: true })),
  }
}

/* ------------------------------------------------------------- the store --- */

let state = null
let loading = null

function readCached() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && parsed.version === SEED_VERSION ? parsed : null
  } catch {
    return null
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* private mode — the in-memory seed still serves this session */
  }
}

/** Each reseed used to leave the previous version's ~1 MB of JSON behind. */
function dropOldKeys() {
  try {
    for (let v = 1; v < SEED_VERSION; v += 1) localStorage.removeItem(`chronocampus.demo.v${v}`)
  } catch {
    /* nothing to clean if storage is unavailable */
  }
}

const listeners = new Set()
const emit = () => listeners.forEach((l) => l())

export const pitchStore = {
  ready: async () => {
    if (state) return state
    if (!loading)
      loading = (async () => {
        state = readCached() || (await buildSeed())
        if (!readCached()) persist()
        dropOldKeys()
        return state
      })()
    return loading
  },
  get: () => state || { timetable_slots: [], teachers: [], allowed_admins: [], allowed_teachers: [], allowed_students: [], class_codes: [], academic_sessions: [], class_sections: [], student_enrollments: [], class_groups: [], group_members: [], group_posts: [], teacher_absences: [], notifications: [], audit_logs: [], school_settings: SCHOOL_SETTINGS, holidays: [] },
  subscribe(l) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  async reset() {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    state = await buildSeed()
    persist()
    emit()
  },
  async mutate(fn) {
    const base = await pitchStore.ready()
    state = fn(structuredClone(base))
    persist()
    emit()
    return state
  },
  hash: hashCode,
}

export { CLASS_SECTIONS, ACADEMIC_SESSIONS, STUDENT_SEED, ROOMS as ROOM_LIST, SCHOOL_SETTINGS, BELL_SCHEDULES }
