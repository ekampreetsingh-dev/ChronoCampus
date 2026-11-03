import { DAYS, PERIODS } from './bellSchedule.js'

/**
 * Subject colour coding. Tones here are decorative (the eleven families in
 * index.css), never the semantic status tones, so a timetable cell can never
 * be mistaken for an alert.
 */
export const SUBJECT_TONE = {
  Mathematics: 'brand',
  Physics: 'info',
  Chemistry: 'rose',
  Biology: 'sage',
  'Computer Science': 'accent',
  'General Science': 'info',
  English: 'sky',
  Hindi: 'clay',
  Sanskrit: 'clay',
  History: 'clay',
  Geography: 'sage',
  'Social Science': 'clay',
  'Political Science': 'sky',
  Economics: 'brand',
  Accountancy: 'accent',
  'Business Studies': 'rose',
  'Physical Education': 'sage',
  'Art & Craft': 'rose',
  Music: 'rose',
  Painting: 'rose',
  'Home Science': 'clay',
  'Environmental Studies': 'sage',
  'Language Compulsory': 'sky',
  'Fine Arts': 'rose',
  Psychology: 'accent',
  Sociology: 'sky',
  Philosophy: 'accent',
  'Health & Physical Education': 'sage',
  'Applied Mathematics': 'brand',
}

export const LAB_SUBJECTS = ['Physics', 'Chemistry', 'Computer Science', 'Biology']

/** Which practical room a subject belongs to. */
export const LAB_FOR = {
  Physics: 'Physics Lab',
  Chemistry: 'Chemistry Lab',
  'Computer Science': 'CS Lab',
  Biology: 'Biology Lab',
}

const FALLBACK_TONES = ['brand', 'sky', 'sage', 'clay', 'accent', 'rose', 'info']

/** Stable per-subject tone: same subject always lands on the same colour. */
export function subjectTone(subject) {
  if (!subject) return 'neutral'
  if (SUBJECT_TONE[subject]) return SUBJECT_TONE[subject]
  let h = 0
  for (let i = 0; i < subject.length; i++) h = (h * 31 + subject.charCodeAt(i)) >>> 0
  return FALLBACK_TONES[h % FALLBACK_TONES.length]
}

export const isLabSubject = (subject) => LAB_SUBJECTS.includes(subject)

/** Compact label for the tight timetable cell; full name stays in the tooltip. */
export const subjectShort = (subject) =>
  ({
    'Computer Science': 'Comp. Sci.',
    'Business Studies': 'Biz. Studies',
    'Physical Education': 'P.E.',
    'Health & Physical Education': 'H.P.E.',
    Mathematics: 'Maths',
    'Environmental Studies': 'EVS',
    'General Science': 'Gen. Sci.',
    'Social Science': 'Soc. Sci.',
    'Political Science': 'Pol. Sci.',
    'Applied Mathematics': 'Appl. Maths',
    'Language Compulsory': 'Lang.',
  })[subject] || subject

export const roomIsLab = (room = '') => /lab|library|workshop|room|field|hall|studio/i.test(room)

export const roomTone = (room = '') =>
  /physics|chemistry|biology|lab/i.test(room) ? 'info' : /library|music|art|studio/i.test(room) ? 'accent' : 'neutral'

/** Compact label for the tight timetable cell; full name stays in the tooltip. */
export const roomShort = (room = '') =>
  String(room)
    .replace('Room ', 'R')
    .replace('Physics Lab', 'Phy Lab')
    .replace('Chemistry Lab', 'Chem Lab')
    .replace('Biology Lab', 'Bio Lab')
    .replace('Computer Lab', 'CS Lab')

export const allSubjects = Object.keys(SUBJECT_TONE)
export const allRooms = [
  'Room 101',
  'Room 102',
  'Room 103',
  'Physics Lab',
  'Chemistry Lab',
  'CS Lab',
  'Biology Lab',
  'Library',
  'Music Room',
  'Art Studio',
  'Sports Field',
]

export const slotKey = (day, period, classSection) => `${day}|${period}|${classSection}`
export const inWeek = (slot) => DAYS.includes(slot.day) && PERIODS.some((p) => p.n === Number(slot.period))
