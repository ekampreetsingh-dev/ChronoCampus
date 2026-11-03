/**
 * School timings as data, not constants.
 *
 * A school can run several bell schedules at once — senior classes (11–12) have
 * a shorter day than junior classes (1–10) — and each one has seasonal variants,
 * because the winter timings differ from the summer ones. Periods are looked up
 * by number, and the number may be 0 ("zero period" before first bell).
 */

export const DEFAULT_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** School-wide fallback: the longest junior day, used before data is loaded. */
export const DEFAULT_PERIODS = [
  { n: 0, label: '0', start: '08:00', end: '09:00' },
  { n: 1, label: 'P1', start: '09:00', end: '09:40' },
  { n: 2, label: 'P2', start: '09:40', end: '10:20' },
  { n: 3, label: 'P3', start: '10:20', end: '11:00' },
  { n: 4, label: 'P4', start: '11:20', end: '12:00' },
  { n: 5, label: 'P5', start: '12:00', end: '12:40' },
  { n: 6, label: 'P6', start: '12:40', end: '13:20' },
  { n: 7, label: 'P7', start: '13:20', end: '14:00' },
  { n: 8, label: 'P8', start: '14:00', end: '14:20' },
]

// Mutated in place so importers of DAYS/PERIODS see hydrated values.
export const DAYS = [...DEFAULT_DAYS]
export const PERIODS = [...DEFAULT_PERIODS]

export const settings = { timezone: 'Asia/Kolkata' }

/** All bell schedules loaded from the school, active and archived. */
export let SCHEDULES = []
export const setSchedules = (list) => {
  SCHEDULES = Array.isArray(list) ? list : []
  return SCHEDULES
}
export const getSchedules = () => SCHEDULES

/**
 * The early-years wing. These classes have no number, so they are matched by
 * name — and they run a shorter day than the rest of the junior school.
 */
export const EARLY_YEARS = ['Playway', 'Nursery', 'LKG', 'UKG']
export const isEarlyYears = (classSection = '') =>
  EARLY_YEARS.some((n) => String(classSection).toUpperCase().startsWith(n.toUpperCase()))

/** 11 and 12 are the senior group, the early-years wing is its own, the rest junior. */
export const groupOf = (classSection = '') => {
  if (isEarlyYears(classSection)) return 'early'
  const grade = Number((String(classSection).match(/\d+/) || [0])[0])
  return grade >= 11 ? 'senior' : 'junior'
}

const seasonRank = { active: 0, summer: 1, winter: 2, regular: 3 }

/**
 * The schedule a class is following right now: its own group, the active
 * season, and an effective date that has arrived.
 */
export function scheduleFor(classSection, at = new Date()) {
  if (!SCHEDULES.length) return null
  const group = groupOf(classSection)
  const eligible = SCHEDULES.filter((s) => {
    if (s.applies_to && s.applies_to !== 'all' && s.applies_to !== group) return false
    if (s.effective_from && new Date(s.effective_from) > at) return false
    if (s.effective_to && new Date(s.effective_to) < at) return false
    return true
  })
  if (!eligible.length) return null
  const active = eligible.filter((s) => s.is_active)
  const pool = active.length ? active : eligible
  return pool.slice().sort((a, b) => {
    const bySeason = (seasonRank[a.season] ?? 9) - (seasonRank[b.season] ?? 9)
    if (bySeason) return bySeason
    return String(b.effective_from || '').localeCompare(String(a.effective_from || ''))
  })[0]
}

export const periodsFor = (classSection, at) => {
  const s = scheduleFor(classSection, at)
  return s?.periods?.length ? s.periods : PERIODS
}

export const breakAfterFor = (classSection, at) => scheduleFor(classSection, at)?.break_after ?? null
export const lunchAfterFor = (classSection, at) => scheduleFor(classSection, at)?.lunch_after ?? null

/** Rows to render for a set of sections: the union of their period numbers. */
export function periodRows(sections = [], at) {
  if (!sections.length) return PERIODS
  const merged = new Map()
  for (const sec of sections) {
    for (const p of periodsFor(sec, at)) if (!merged.has(p.n)) merged.set(p.n, p)
  }
  return [...merged.values()].sort((a, b) => a.n - b.n)
}

export function configureSchedule(next = {}) {
  if (Array.isArray(next.working_days) && next.working_days.length) DAYS.splice(0, DAYS.length, ...next.working_days)
  if (Array.isArray(next.periods) && next.periods.length) PERIODS.splice(0, PERIODS.length, ...next.periods)
  if (Array.isArray(next.schedules)) setSchedules(next.schedules)
  if (next.timezone) settings.timezone = next.timezone
}

export const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export const fmtClock = (mins) => {
  const h24 = Math.floor(mins / 60) % 24
  const m = Math.floor(mins % 60)
  return `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 12-hour label for a schedule editor: 14:20 → 2:20 pm. */
export const to12h = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

export const dayIndex = (date) => (date.getDay() + 6) % 7 // Monday = 0

export function nowInTimezone(tz = settings.timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date())
    const get = (t) => parts.find((p) => p.type === t)?.value
    const d = new Date(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`)
    return Number.isNaN(d.getTime()) ? new Date() : d
  } catch {
    return new Date()
  }
}

export const periodAt = (n, periods = PERIODS) =>
  periods.find((p) => p.n === Number(n)) || periods.find((p) => String(p.label) === String(n)) || periods[0]

/** The period number running right now for a given schedule, or -1. */
export function currentPeriodIndex(now, periods = PERIODS) {
  const mins = now.getHours() * 60 + now.getMinutes()
  for (const p of periods) if (mins >= toMinutes(p.start) && mins < toMinutes(p.end)) return p.n
  return -1
}

/** First bell of a schedule — used to decide whether the day has started. */
export const firstStart = (periods = PERIODS) => (periods[0] ? toMinutes(periods[0].start) : 0)
export const lastEnd = (periods = PERIODS) => (periods.length ? toMinutes(periods[periods.length - 1].end) : 0)

/** A gap between two periods longer than this is treated as a break. */
export const BREAK_GAP_MIN = 12

/**
 * Breaks are derived from the gaps rather than configured as an index, so an
 * admin inserting a longer winter break does not have to re-point anything.
 */
export function interludesFor(periods = PERIODS) {
  const out = []
  for (let i = 0; i < periods.length - 1; i++) {
    const gap = toMinutes(periods[i + 1].start) - toMinutes(periods[i].end)
    if (gap >= BREAK_GAP_MIN) out.push({ after: periods[i].n, minutes: gap, label: gap >= 40 ? 'Lunch' : 'Break' })
  }
  return out
}

export function currentInterlude(now, periods = PERIODS) {
  const mins = now.getHours() * 60 + now.getMinutes()
  for (const g of interludesFor(periods)) {
    const a = periodAt(g.after, periods)
    const b = periodAt(periods[periods.indexOf(a) + 1].n, periods)
    if (mins >= toMinutes(a.end) && mins < toMinutes(b.start)) return g.label
  }
  return null
}

export const isSchoolDay = (now) => dayIndex(now) < DAYS.length

export function nextPeriod(now, periods = PERIODS) {
  const list = periods.length ? periods : PERIODS
  const mins = now.getHours() * 60 + now.getMinutes()
  if (isSchoolDay(now)) {
    for (const p of list) if (mins < toMinutes(p.start)) return { period: p, startsIn: toMinutes(p.start) - mins, today: true }
  }
  const di = dayIndex(now)
  for (let step = 1; step <= 7; step++) {
    const idx = (di + step) % 7
    if (idx < DAYS.length) {
      const p = list[0]
      return { period: p, day: DAYS[idx], startsIn: step * 1440 - mins + toMinutes(p.start), today: false }
    }
  }
  return null
}

export function periodProgress(now, periods = PERIODS) {
  const idx = currentPeriodIndex(now, periods)
  const p = periodAt(idx, periods)
  if (idx < 0 || !p) return 0
  const s = toMinutes(p.start)
  const e = toMinutes(p.end)
  return Math.min(1, Math.max(0, (now.getHours() * 60 + now.getMinutes() - s) / Math.max(1, e - s)))
}

export function periodMinutesLeft(now, periods = PERIODS) {
  const idx = currentPeriodIndex(now, periods)
  const p = periodAt(idx, periods)
  if (idx < 0 || !p) return 0
  return Math.max(0, toMinutes(p.end) - (now.getHours() * 60 + now.getMinutes()))
}

export const weekCapacity = (periods = PERIODS) => DAYS.length * periods.length

/** Validation for the schedule editor: ordered, non-overlapping, sane. */
export function validatePeriods(periods) {
  const errors = []
  if (!periods.length) return ['Add at least one period.']
  periods.forEach((p, i) => {
    if (!p.start || !p.end) errors.push(`${p.label || `Row ${i + 1}`}: missing a time.`)
    else if (toMinutes(p.end) <= toMinutes(p.start)) errors.push(`${p.label}: ends before it starts.`)
  })
  for (let i = 0; i < periods.length - 1; i++) {
    if (toMinutes(periods[i].end) > toMinutes(periods[i + 1].start))
      errors.push(`${periods[i].label} overlaps ${periods[i + 1].label}.`)
  }
  const nums = periods.map((p) => Number(p.n))
  if (new Set(nums).size !== nums.length) errors.push('Two rows share the same period number.')
  return errors
}
