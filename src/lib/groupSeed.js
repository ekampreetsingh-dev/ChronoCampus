/**
 * ChronoConnect — the demo school's community data.
 *
 * One group per class-section, generated from the sections that already exist:
 * the class teacher becomes the manager, the staff who actually teach that class
 * on the timetable become teacher members, and every enrolled student is a
 * member of their own class's group. Nothing here names a class by hand.
 */

import { GROUP_ROLE, groupIdFor, membershipId } from './groups.js'

/** Deterministic pick so the same school always seeds the same feed. */
function hash(str) {
  let h = 2166136261
  for (let i = 0; i < String(str).length; i += 1) {
    h ^= String(str).charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}
const pick = (key, list) => list[hash(key) % list.length]

const ANNOUNCEMENTS = [
  (c) => `${c} — attendance for the assembly at 08:20 is compulsory this week. Report in the school uniform with your almanac.`,
  (c) => `Half-yearly examination datesheet for ${c} is on the notice board. Syllabus is unchanged from the last revision sheet.`,
  (c) => `Parents of ${c}: the parent-teacher meeting runs 09:00 to 12:30 on Saturday. Book a slot with the class teacher before Friday.`,
  (c) => `${c} library cards are due for renewal. Students who borrowed practical manuals must return them before the break.`,
  (c) => `ID cards for ${c} are ready with the office. Collect from the reception between 11:00 and 11:20.`,
]

const HOMEWORK = [
  (s) => `${s}: complete the practice sheet from today's period. Show the working on the left page, not the rough side.`,
  (s) => `${s} — revise the last two chapters for the class test on Monday. One-page handwritten summary to be submitted.`,
  (s) => `${s}: the lab record must be signed by the subject teacher before the practical file is closed.`,
  (s) => `${s}: essay of 250 words on the topic discussed in class. Handwritten only.`,
]

const DISCUSSION = [
  (s) => `Swapping my ${s} period with the next one — the projector in that room is being serviced.`,
  (s) => `Who has the ${s} question bank for this session? The office copy is with the senior wing.`,
  (s) => `${s} remedial runs after the break on Wednesday. Please send the list of students who need it.`,
]

const COMMENTS = [
  'Noted, will inform the students.',
  'Ma’am, two students were absent for that period — should they submit it next week?',
  'Received. The room is free after period 4 if that suits better.',
  'Sharing the summary sheet with the class today.',
]

const now = () => Date.now()
const ago = (hours) => new Date(now() - hours * 3600 * 1000).toISOString()

/**
 * @returns {{ groups: Array, members: Array, posts: Array }}
 */
export function buildGroups({ sections = [], teachers = [], slots = [], enrollments = [] } = {}) {
  const groups = []
  const members = []
  const byId = new Map(teachers.map((t) => [String(t.id), t]))

  for (const sec of sections) {
    const gid = groupIdFor(sec.id)
    const teacherId = sec.mentor_teacher_id || null
    groups.push({
      id: gid,
      class_section_id: sec.id,
      class_section: sec.name,
      // Mirrored from class_sections.mentor_teacher_id — the section stays the
      // source of truth and this copy is rewritten whenever that changes.
      class_teacher_id: teacherId,
      is_active: sec.is_active !== false,
      settings: { students_can_comment: true, students_can_react: true, students_can_post: false },
      created_at: ago(24 * 120),
      archived_at: sec.is_active === false ? ago(2) : null,
    })

    const mentor = byId.get(String(teacherId))
    if (mentor) {
      members.push({
        id: membershipId(gid, mentor.id),
        group_id: gid,
        user_id: mentor.id,
        role: GROUP_ROLE.manager,
        source: 'class_teacher',
        added_by: 'system',
        added_by_name: 'the school',
        added_at: ago(24 * 120),
        active: true,
      })
    }

    // The people the class actually runs on: the staff who take the most periods
    // of this section. A middle-school class is visited by forty teachers across a
    // week, and a group that starts with all of them is a staff list, not a group —
    // the rest stay in the directory for the class teacher to add deliberately.
    const counts = new Map()
    for (const s of slots) {
      if (s.class_section_id !== sec.id && s.class_section !== sec.name) continue
      const tid = String(s.teacher_id || '')
      if (!tid || tid === String(teacherId)) continue
      counts.set(tid, (counts.get(tid) || 0) + 1)
    }
    for (const [tid, periods] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
      const t = byId.get(tid)
      if (!t) continue
      members.push({
        id: membershipId(gid, t.id),
        group_id: gid,
        user_id: t.id,
        role: GROUP_ROLE.teacher,
        source: 'timetable',
        added_by: teacherId || 'system',
        added_by_name: mentor ? mentor.full_name : 'the school',
        added_at: ago(24 * 110),
        active: true,
        note: `${periods} periods a week with this class`,
      })
    }

    for (const e of enrollments) {
      if (e.enrollment_status !== 'active') continue
      if (e.class_section_id !== sec.id) continue
      members.push({
        id: membershipId(gid, e.student_id),
        group_id: gid,
        user_id: e.student_id,
        role: GROUP_ROLE.student,
        source: 'enrolment',
        added_by: 'system',
        added_by_name: 'enrolment',
        added_at: e.enrolled_at || ago(24 * 100),
        active: true,
      })
    }
  }

  return { groups, members, posts: buildPosts({ groups, members, sections, slots }) }
}

/** Two or three plausible entries per group, written by people who are in it. */
function buildPosts({ groups = [], members = [], sections = [], slots = [] }) {
  const posts = []
  const memberOf = (gid) => members.filter((m) => m.group_id === gid && m.active !== false)

  for (const g of groups) {
    const sec = sections.find((s) => s.id === g.class_section_id)
    const staff = memberOf(g.id).filter((m) => m.role !== GROUP_ROLE.student)
    if (!staff.length) continue

    const subjects = Object.keys(sec?.curriculum || {})
    const taught = slots.filter((s) => s.class_section_id === g.class_section_id).map((s) => s.subject)
    const subject = taught[hash(g.id) % Math.max(1, taught.length)] || subjects[hash(g.id) % Math.max(1, subjects.length)] || 'revision work'

    const manager = staff.find((m) => m.role === GROUP_ROLE.manager) || staff[0]
    posts.push({
      id: `gpost-${g.id}-1`,
      group_id: g.id,
      parent_id: null,
      author_id: manager.user_id,
      author_role: manager.role,
      kind: 'announcement',
      body: pick(`${g.id}-ann`, ANNOUNCEMENTS)(sec?.name || g.class_section),
      pinned: true,
      created_at: ago(6 + (hash(g.id) % 40)),
      edited_at: null,
      removed_at: null,
      removed_by: null,
      reactions: {},
    })

    const other = staff.find((m) => m.user_id !== manager.user_id)
    if (other) {
      const homework = {
        id: `gpost-${g.id}-2`,
        group_id: g.id,
        parent_id: null,
        author_id: other.user_id,
        author_role: other.role,
        kind: 'homework',
        body: pick(`${g.id}-hw`, HOMEWORK)(subject),
        pinned: false,
        created_at: ago(2 + (hash(`${g.id}b`) % 30)),
        edited_at: null,
        removed_at: null,
        removed_by: null,
        reactions: {},
      }
      posts.push(homework)

      const student = memberOf(g.id).find((m) => m.role === GROUP_ROLE.student)
      if (student) {
        posts.push({
          id: `gpost-${g.id}-3`,
          group_id: g.id,
          parent_id: homework.id,
          author_id: student.user_id,
          author_role: GROUP_ROLE.student,
          kind: 'comment',
          body: pick(`${g.id}-c`, COMMENTS),
          pinned: false,
          created_at: ago(1 + (hash(`${g.id}c`) % 12)),
          edited_at: null,
          removed_at: null,
          removed_by: null,
          reactions: {},
        })
        homework.reactions = { [student.user_id]: '👍' }
      } else if (hash(`${g.id}d`) % 2) {
        posts.push({
          id: `gpost-${g.id}-4`,
          group_id: g.id,
          parent_id: null,
          author_id: other.user_id,
          author_role: other.role,
          kind: 'post',
          body: pick(`${g.id}-d`, DISCUSSION)(subject),
          pinned: false,
          created_at: ago(3 + (hash(`${g.id}e`) % 20)),
          edited_at: null,
          removed_at: null,
          removed_by: null,
          reactions: {},
        })
      }
    }
  }

  return posts
}
