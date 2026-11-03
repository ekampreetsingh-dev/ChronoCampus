/**
 * ChronoConnect — who may do what inside a class-section group.
 *
 * Every rule here is a pure function of (profile, group, membership, settings)
 * so the exact same decision can be lifted into a Postgres RLS policy without
 * rewriting the screens. Nothing in this file trusts a role a client sent: the
 * membership row is looked up from the store, never handed to us by the caller.
 */

export const GROUP_ROLE = { manager: 'manager', teacher: 'teacher', student: 'student' }

/** Stable ids: a group belongs to a section, not to its label. */
export const groupIdFor = (sectionId) => `grp-${String(sectionId).replace(/^sec-/, '')}`
export const membershipId = (groupId, userId) => `gmb-${groupId}-${userId}`

/** The section's own group, or null when the class has none yet. */
export function groupForSection(groups, sectionIdOrName) {
  const key = String(sectionIdOrName || '')
  return (
    (groups || []).find((g) => g.id === key) ||
    (groups || []).find((g) => g.class_section_id === key) ||
    (groups || []).find((g) => g.class_section === key) ||
    null
  )
}

export function membershipOf(members, userId) {
  if (!userId) return null
  return (members || []).find((m) => m.active !== false && String(m.user_id) === String(userId)) || null
}

/**
 * What this person is *in this group*, resolved from data rather than asserted:
 * an admin is outside the membership table but outranks it, the class teacher is
 * the manager because the section says so, and everyone else is exactly what
 * their active membership row records.
 */
export function groupRoleOf({ profile, group, member, isAdmin }) {
  if (!group) return null
  if (isAdmin || profile?.role === 'admin') return 'admin'
  if (group.class_teacher_id && String(group.class_teacher_id) === String(profile?.id)) return GROUP_ROLE.manager
  const row = member || membershipOf(group.members, profile?.id)
  if (!row) return null
  return row.role
}

/** A group is read-only once its class is archived: history stays, writing stops. */
export const isLocked = (group) => !group || group.is_active === false

export const can = {
  /** Open the group at all. */
  view({ role }) {
    return Boolean(role)
  },
  /** Add or remove teachers. Only the class teacher and the admin. */
  manageTeachers({ role }) {
    return role === 'admin' || role === GROUP_ROLE.manager
  },
  /** Write something into the feed. */
  post({ role, group, settings, studentMayPost }) {
    if (isLocked(group)) return false
    if (role === 'admin' || role === GROUP_ROLE.manager || role === GROUP_ROLE.teacher) return true
    if (role === GROUP_ROLE.student) return Boolean(settings?.students_can_post ?? studentMayPost)
    return false
  },
  /** Speak in a thread. */
  comment({ role, group, settings }) {
    if (isLocked(group)) return false
    if (role === 'admin' || role === GROUP_ROLE.manager || role === GROUP_ROLE.teacher) return true
    if (role === GROUP_ROLE.student) return Boolean(settings?.students_can_comment)
    return false
  },
  /** React. */
  react({ role, group, settings }) {
    if (isLocked(group)) return false
    if (role === 'admin' || role === GROUP_ROLE.manager || role === GROUP_ROLE.teacher) return true
    return role === GROUP_ROLE.student && Boolean(settings?.students_can_react)
  },
  /** Pin, unpin or delete somebody else's post. */
  moderate({ role }) {
    return role === 'admin' || role === GROUP_ROLE.manager
  },
  /** Change the group's own settings. */
  settings({ role }) {
    return role === 'admin' || role === GROUP_ROLE.manager
  },
  /** Change who the official class teacher is — admin only, always. */
  assignClassTeacher({ isAdmin }) {
    return Boolean(isAdmin)
  },
  /** Archive / restore a group. */
  archive({ isAdmin }) {
    return Boolean(isAdmin)
  },
}

/**
 * The label a member is shown by. The class teacher is never just another
 * teacher in the list, so the distinction is carried here rather than at each
 * call site.
 */
export function memberBadge(role) {
  return role === GROUP_ROLE.manager ? 'Class Teacher' : role === GROUP_ROLE.teacher ? 'Group teacher' : 'Student'
}

/** Where a membership came from — this is what makes an import look honest. */
export function memberSource(row) {
  if (row?.source === 'class_teacher') return 'assigned as class teacher'
  if (row?.source === 'timetable') return 'teaches this class'
  if (row?.source === 'enrolment') return 'enrolled in this class'
  return row?.added_by_name ? `added by ${row.added_by_name}` : 'added by the school'
}
