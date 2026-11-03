/**
 * School structure: every class from 1 to 12 with sections A–D.
 *
 * 48 sections is roughly 2,300 timetable periods a week. At ~28 teachable
 * periods per teacher that needs about 85 staff, so the roster is generated
 * alongside the sections — a demo school that is structurally honest rather
 * than one where nine teachers are booked into two classes at once.
 */

import { EARLY_YEARS, groupOf } from './bellSchedule.js'

/** Classes 1–12; the early-years wing is named, not numbered. */
export const GRADES = Array.from({ length: 12 }, (_, i) => i + 1)
export const PRE_PRIMARY = EARLY_YEARS
export const CLASS_CHOICES = [...PRE_PRIMARY, ...GRADES]
export const SECTION_LETTERS = ['A', 'B', 'C', 'D']
/** Two sections are enough for a Playway room; four for a UKG class is not how the wing runs. */
export const PRE_PRIMARY_LETTERS = ['A', 'B']

export const isPrePrimary = (grade) => typeof grade === 'string' && PRE_PRIMARY.includes(grade)

/** Senior sections carry a stream; juniors and the early-years wing do not. The letter suggests a default, it does not bind it. */
export const streamFor = (grade, letter) =>
  (isPrePrimary(grade) || Number(grade) < 11) ? 'General' : DEFAULT_STREAM_BY_LETTER[letter] || 'Science'

export const sectionName = (grade, letter) => {
  const stream = streamFor(grade, letter)
  return stream === 'General' ? `${grade}-${letter}` : `${grade}-${letter} ${stream}`
}

export const bandOf = (grade) =>
  isPrePrimary(grade) ? 'nursery' : grade <= 5 ? 'primary' : grade <= 8 ? 'middle' : grade <= 10 ? 'secondary' : 'senior'

/* --------------------------------------------------------------- rooms ---- */

/** One home room per section, plus the shared practical rooms. */
export const homeRoomFor = (grade, letter) => {
  const ordinal = SECTION_LETTERS.indexOf(letter)
  const n = ordinal >= 0 ? ordinal + 1 : Math.max(1, String(letter || '').toUpperCase().charCodeAt(0) - 64)
  if (isPrePrimary(grade)) return `Activity Room ${PRE_PRIMARY.indexOf(grade) + 1}${String.fromCharCode(64 + n)}`
  return `Room ${grade}${n}0`
}

export const LAB_ROOMS = ['Physics Lab', 'Chemistry Lab', 'Biology Lab', 'CS Lab', 'Smart Lab', 'Library', 'Music Room', 'Sports Hall']

export const allRooms = () => {
  const homes = []
  for (const g of CLASS_CHOICES) for (const l of letterOptions(g)) homes.push(homeRoomFor(g, l))
  return [...homes, ...LAB_ROOMS]
}

/* ----------------------------------------------------------- curriculum --- */

const BAND_CURRICULUM = {
  primary: { English: 8, Hindi: 7, Mathematics: 10, 'General Science': 6, 'Social Science': 6, 'Computer Science': 4, 'Art & Craft': 4, 'Physical Education': 5 },
  middle: { English: 8, Hindi: 7, Mathematics: 9, 'General Science': 7, 'Social Science': 7, 'Computer Science': 6, Sanskrit: 4, 'Physical Education': 5 },
  secondary: { English: 8, Hindi: 7, Mathematics: 9, 'General Science': 8, 'Social Science': 8, 'Computer Science': 6, 'Physical Education': 5 },
}

/**
 * The early-years wing teaches the same subjects the rest of the school does, at
 * the stage where they are play, rhymes and numbers. Keeping the subject names
 * shared is what lets one teacher cover a UKG class and a Class 3 class in the
 * same hour without the roster inventing staff the school does not employ.
 *
 * Four 40-minute bells is the whole day — the snack, free play and nap blocks
 * that fill the rest of it are not timetabled periods, so a cell or two staying
 * open here is the wing being accurate, not the board being unfinished.
 */
const NURSERY_CURRICULUM = {
  Playway: { 'Physical Education': 7, 'Art & Craft': 7, English: 5, Mathematics: 3 },
  Nursery: { 'Physical Education': 6, 'Art & Craft': 6, English: 6, Mathematics: 5 },
  LKG: { English: 8, Mathematics: 7, 'Art & Craft': 5, 'Physical Education': 4 },
  UKG: { English: 8, Mathematics: 8, 'General Science': 4, 'Art & Craft': 2, 'Physical Education': 2 },
}

const STREAM_CURRICULUM = {
  Science: { Mathematics: 6, Physics: 5, Chemistry: 5, Biology: 3, 'Computer Science': 3, English: 4, Hindi: 2, 'Physical Education': 2 },
  'Non-Medical': { Mathematics: 6, Physics: 5, Chemistry: 5, 'Computer Science': 4, English: 4, Hindi: 2, 'Physical Education': 2, Biology: 2 },
  Medical: { Mathematics: 5, Physics: 5, Chemistry: 5, Biology: 5, English: 4, Hindi: 2, 'Physical Education': 2, 'Computer Science': 2 },
  Commerce: { Accountancy: 6, 'Business Studies': 5, Economics: 4, Mathematics: 5, English: 4, Hindi: 3, 'Computer Science': 1, 'Physical Education': 2 },
  Arts: { History: 5, 'Political Science': 5, Geography: 5, Economics: 4, English: 5, Hindi: 3, 'Physical Education': 2, 'Computer Science': 1 },
  Humanities: { English: 5, Hindi: 4, 'Social Science': 6, Mathematics: 4, Biology: 3, 'Computer Science': 3, 'Business Studies': 3, 'Physical Education': 2 },
}

/**
 * Streams the school can run. A section's letter only *suggests* one — an
 * administrator may pick any of these, or name one that is not listed, and the
 * subject editor then defines what that stream actually teaches. An unlisted
 * name starts from the secondary syllabus rather than an empty table.
 */
export const STREAMS = Object.keys(STREAM_CURRICULUM)
export const DEFAULT_STREAM_BY_LETTER = { A: 'Science', B: 'Commerce', C: 'Humanities', D: 'Science' }

export const curriculumFor = (grade, letter) => {
  const band = bandOf(grade)
  if (band === 'nursery') return { ...(NURSERY_CURRICULUM[grade] || NURSERY_CURRICULUM.Nursery) }
  if (band !== 'senior') return { ...BAND_CURRICULUM[band] }
  return { ...(STREAM_CURRICULUM[streamFor(grade, letter)] || STREAM_CURRICULUM.Science) }
}

/** Used when an admin puts a senior section in a stream other than its letter's default. */
export const curriculumForStream = (stream) =>
  ({ ...(STREAM_CURRICULUM[stream] || BAND_CURRICULUM.secondary) })

/* -------------------------------------------------------------- subjects -- */

/** Subject -> who can teach it. Juniors are taught broadly; seniors by specialist. */
const SUBJECT_COVERS = {
  English: ['English'],
  Hindi: ['Hindi'],
  Sanskrit: ['Sanskrit'],
  Mathematics: ['Mathematics'],
  'General Science': ['General Science', 'Physics', 'Chemistry', 'Biology'],
  'Social Science': ['Social Science', 'Economics', 'History', 'Geography'],
  'Computer Science': ['Computer Science'],
  'Art & Craft': ['Art & Craft', 'Physical Education'],
  'Physical Education': ['Physical Education'],
  Physics: ['Physics'],
  Chemistry: ['Chemistry'],
  Biology: ['Biology', 'General Science'],
  Accountancy: ['Accountancy'],
  'Business Studies': ['Business Studies'],
  Economics: ['Economics'],
}

export const subjectsTaught = (subject) => SUBJECT_COVERS[subject] || [subject]

/** A teacher's own subjects, including the additional ones they can cover. */
export const canTeach = (t) => [t.subject, ...(t.extra || [])]

/* --------------------------------------------------------------- staff ---- */

const FIRST = ['Harpreet', 'Jasjeet', 'Gurmeet', 'Simran', 'Aman', 'Nikita', 'Rohit', 'Pooja', 'Vikram', 'Neelam', 'Sunita', 'Amarjeet', 'Balwinder', 'Kewal', 'Poonam', 'Rakesh', 'Meena', 'Sushil', 'Anita', 'Daler', 'Kiran', 'Manjit', 'Rajwinder', 'Savita', 'Tarun', 'Usha', 'Vinod', 'Yashpal', 'Zora', 'Devender', 'Kamla', 'Narender', 'Pardeep', 'Reena', 'Surender', 'Vandana', 'Ashok', 'Bhupinder', 'Chaman', 'Deepa']
const LAST = ['Kaur', 'Singh', 'Sharma', 'Gill', 'Bedi', 'Dogra', 'Malhotra', 'Nanda', 'Verma', 'Sethi', 'Arora', 'Bhatia', 'Chhabra', 'Kapoor', 'Mehra', 'Puri', 'Sahni', 'Sodhi', 'Ahluwalia', 'Bhasin']

const SUBJECT_POOL = ['English', 'Hindi', 'Mathematics', 'General Science', 'Social Science', 'Computer Science', 'Physical Education', 'Art & Craft', 'Sanskrit', 'Physics', 'Chemistry', 'Biology', 'Accountancy', 'Business Studies', 'Economics']

/**
 * Keeps the named demo staff (they are referenced by login and by the seeded
 * absence), then adds enough generated colleagues to cover every section.
 */
export const NAMED_TEACHERS = [
  { id: 'tch-01', email: 'neelam.kaur@chronocampus.edu.in', full_name: 'Dr. Neelam Kaur', subject: 'Physics', phone: '+91 98765 43210', employee_id: 'CC-T-0141', extra: [] },
  { id: 'tch-02', email: 'rajinder.bedi@chronocampus.edu.in', full_name: 'Rajinder Singh Bedi', subject: 'Chemistry', phone: '+91 98765 43211', employee_id: 'CC-T-0142', extra: ['General Science'] },
  { id: 'tch-03', email: 'amarjeet.kaur@chronocampus.edu.in', full_name: 'Amarjeet Kaur', subject: 'Mathematics', phone: '+91 98765 43212', employee_id: 'CC-T-0108', extra: [] },
  { id: 'tch-04', email: 'vikram.malhotra@chronocampus.edu.in', full_name: 'Vikram Malhotra', subject: 'Computer Science', phone: '+91 98765 43213', employee_id: 'CC-T-0163', extra: [] },
  { id: 'tch-05', email: 'sunita.rao@chronocampus.edu.in', full_name: 'Sunita Rao', subject: 'English', phone: '+91 98765 43214', employee_id: 'CC-T-0097', extra: ['Hindi'] },
  { id: 'tch-06', email: 'harpreet.singh@chronocampus.edu.in', full_name: 'Harpreet Singh', subject: 'Accountancy', phone: '+91 98765 43215', employee_id: 'CC-T-0121', extra: ['Business Studies'] },
  { id: 'tch-07', email: 'meenakshi.dogra@chronocampus.edu.in', full_name: 'Meenakshi Dogra', subject: 'Economics', phone: '+91 98765 43216', employee_id: 'CC-T-0155', extra: ['Social Science'] },
  { id: 'tch-08', email: 'jasjeet.kaur@chronocampus.edu.in', full_name: 'Jasjeet Kaur', subject: 'Biology', phone: '+91 98765 43217', employee_id: 'CC-T-0132', extra: ['Physical Education'] },
  { id: 'tch-09', email: 'kewal.krishnan@chronocampus.edu.in', full_name: 'Kewal Krishnan', subject: 'Mathematics', phone: '+91 98765 43218', employee_id: 'CC-T-0159', extra: [] },
  { id: 'tch-10', email: 'poonam.arora@chronocampus.edu.in', full_name: 'Poonam Arora', subject: 'English', phone: '+91 98765 43219', employee_id: 'CC-T-0166', extra: ['Hindi'] },
]

const WEEKLY_TARGET = 26 // teachable periods per staff member

/** Deterministic pseudo-random so the roster is stable across reloads. */
function seeded(seed) {
  let x = seed
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    return x / 0x7fffffff
  }
}

export function buildTeachers(sections) {
  const demand = new Map()
  for (const sec of sections) {
    for (const [subject, count] of Object.entries(sec.curriculum)) {
      demand.set(subject, (demand.get(subject) || 0) + count)
    }
  }

  const teachers = NAMED_TEACHERS.map((t) => ({ ...t }))
  const capacity = new Map()
  for (const t of teachers) for (const s of [t.subject, ...(t.extra || [])]) capacity.set(s, (capacity.get(s) || 0) + WEEKLY_TARGET)

  const rnd = seeded(20261)
  let n = teachers.length
  for (const subject of SUBJECT_POOL) {
    let need = (demand.get(subject) || 0) - (capacity.get(subject) || 0)
    while (need > 0) {
      n += 1
      const first = FIRST[Math.floor(rnd() * FIRST.length)]
      const last = LAST[Math.floor(rnd() * LAST.length)]
      const partner = rnd() > 0.55 ? SUBJECT_POOL[Math.floor(rnd() * SUBJECT_POOL.length)] : null
      const id = `tch-${String(n).padStart(2, '0')}`
      const row = {
        id,
        email: `${first}.${last}${n}@chronocampus.edu.in`.toLowerCase(),
        full_name: `${first} ${last}`,
        subject,
        phone: `+91 98${String(10000000 + Math.floor(rnd() * 89999999)).slice(0, 8)}`,
        employee_id: `CC-T-${String(1000 + n)}`,
        extra: partner && partner !== subject ? [partner] : [],
      }
      teachers.push(row)
      for (const s of [row.subject, ...(row.extra || [])]) capacity.set(s, (capacity.get(s) || 0) + WEEKLY_TARGET)
      need -= WEEKLY_TARGET
    }
  }
  return teachers
}

/* -------------------------------------------------------------- sections -- */

/**
 * Everything a new section needs, derived from a class and a letter.
 * The admin only picks two things; the stream, bell schedule, home room and
 * weekly syllabus load all follow from the school's own rules.
 */
export function sectionMeta(grade, letter) {
  const g = isPrePrimary(grade) ? grade : Number(grade)
  const band = bandOf(g)
  const l = String(letter || 'A').toUpperCase().slice(0, 2)
  const name = sectionName(g, l)
  return {
    id: band === 'nursery' ? `sec-${String(g).toLowerCase()}-${l.toLowerCase()}` : `sec-${g}${l}`.toLowerCase(),
    name,
    grade: g,
    section: l,
    stream: streamFor(g, l),
    band,
    group: groupOf(name),
    bell_schedule_id: band === 'nursery' ? 'bell-early' : g >= 11 ? 'bell-senior' : 'bell-junior',
    mentor_teacher_id: null,
    default_room: homeRoomFor(g, l),
    is_active: true,
    curriculum: curriculumFor(g, l),
  }
}

/** Every section the school runs, each with its band, group, bell schedule and home room. */
export function buildSections() {
  const out = []
  for (const grade of CLASS_CHOICES) for (const letter of letterOptions(grade)) out.push(sectionMeta(grade, letter))
  return out
}

/** Class list for the "add a section" picker. */
export const gradeOptions = CLASS_CHOICES.map((g) => ({
  value: g,
  label: isPrePrimary(g) ? `${g} · early years` : `Class ${g}`,
}))

/** How many sections a class may have: two in the early-years wing, four elsewhere. */
export function letterOptions(grade) {
  return isPrePrimary(grade) ? PRE_PRIMARY_LETTERS : SECTION_LETTERS
}

/**
 * Every section gets a class teacher, and no teacher gets two classes.
 * Sections that already carry a mentor — the named demo staff — are left alone,
 * and those teachers are reserved before the rest of the roster is walked.
 */
export function assignMentors(sections, teachers) {
  const taken = new Set(sections.map((s) => s.mentor_teacher_id).filter(Boolean))
  for (const sec of sections) {
    if (sec.mentor_teacher_id) continue
    const heaviest = Object.entries(sec.curriculum).sort((a, b) => b[1] - a[1]).map(([s]) => s)
    const pick = teachers.find((t) => !taken.has(t.id) && canTeach(t).some((s) => heaviest.includes(s)))
    if (pick) {
      sec.mentor_teacher_id = pick.id
      taken.add(pick.id)
    }
  }
  return sections
}
