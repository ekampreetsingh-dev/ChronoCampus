/**
 * Conflict engine. Pure over a slot array so it runs identically against
 * Supabase rows and the pitch-mode store.
 */

export const normRoom = (room = '') => String(room).trim().toLowerCase().replace(/\s+/g, ' ')
export const normDay = (day = '') => String(day).trim().toLowerCase()
export const normPeriod = (p) => Number(p)

const samePlace = (a = '', b = '') => normRoom(a) === normRoom(b)

/** Slots that collide with the candidate on the same day + period, other class. */
export function sameTimeSlots(slots, candidate) {
  const day = normDay(candidate.day)
  const period = normPeriod(candidate.period)
  return slots.filter(
    (s) =>
      normDay(s.day) === day &&
      normPeriod(s.period) === period &&
      String(s.class_section) !== String(candidate.class_section),
  )
}

/**
 * @returns {{ok:boolean, conflicts:Array, freeTeachers:string[], freeRooms:string[], soft:string[]}}
 */
export function checkSlot(slots, candidate, teachers = [], opts = {}) {
  const clash = sameTimeSlots(slots, candidate)
  const conflicts = []

  const teacherClash = clash.find((s) => String(s.teacher_id) === String(candidate.teacher_id))
  if (teacherClash) {
    conflicts.push({
      kind: 'teacher',
      message: `${candidate.teacher_name || 'This teacher'} is already teaching ${
        teacherClash.subject
      } to ${teacherClash.class_section} in ${teacherClash.room || 'an unassigned room'}.`,
      slot: teacherClash,
    })
  }

  const roomClash = clash.find((s) => samePlace(s.room, candidate.room))
  if (roomClash && candidate.room) {
    conflicts.push({
      kind: 'room',
      message: `${candidate.room} is occupied by ${clashRoomClass(clash, candidate)} during this period.`,
      slot: roomClash,
    })
  }

  const busy = explain(slots, candidate)

  // Two classes may not be given the same room at the same time even when the
  // teacher differs — that is the clash schools hit most often.
  const duplicateRoom = clash.filter((s) => samePlace(s.room, candidate.room) && candidate.room)
  if (!conflicts.length && duplicateRoom.length > 1) {
    conflicts.push({
      kind: 'room',
      message: `${candidate.room} is double-booked across ${duplicateRoom.length} classes.`,
      slot: duplicateRoom[1],
    })
  }

  const soft = []
  if (opts.maxPeriodsPerDay) {
    const load = slots.filter(
      (s) =>
        normDay(s.day) === normDay(candidate.day) &&
        String(s.teacher_id) === String(candidate.teacher_id) &&
        String(s.id) !== String(candidate.id),
    ).length
    if (load >= opts.maxPeriodsPerDay)
      soft.push(`${candidate.teacher_name} already has ${load} periods on ${candidate.day}.`)
  }

  return {
    ok: conflicts.length === 0,
    conflicts,
    busy,
    freeTeachers: teachers
      .filter((t) => !busy.teacherIds.has(String(t.id)))
      .map((t) => t.id),
    freeRooms: freeRoomsFor(slots, candidate).filter((r) => !busy.roomNames.has(normRoom(r))),
  }
}

const clashRoomClass = (clash, candidate) =>
  (clash.find((s) => samePlace(s.room, candidate.room)) || {}).class_section || 'another class'

/** Who/what is already taken at a given day+period, excluding this class row. */
export function explain(slots, { day, period, class_section, id }) {
  const day_ = normDay(day)
  const period_ = normPeriod(period)
  const at = slots.filter(
    (s) =>
      normDay(s.day) === day_ &&
      normPeriod(s.period) === period_ &&
      String(s.class_section) !== String(class_section) &&
      String(s.id) !== String(id),
  )
  return {
    teacherIds: new Set(at.map((s) => String(s.teacher_id))),
    roomNames: new Set(at.map((s) => normRoom(s.room))),
    slots: at,
  }
}

export function freeTeachersFor(slots, teachers, at, opts = {}) {
  const busy = explain(slots, at).teacherIds
  const absent = opts.absentIds || new Set()
  return teachers.filter((t) => !busy.has(String(t.id)) && !absent.has(String(t.id)))
}

export function freeRoomsFor(slots, at, rooms = []) {
  const busy = explain(slots, at).roomNames
  if (!rooms.length) return []
  return rooms.filter((r) => !busy.has(normRoom(r)))
}

/** Full-week load per teacher id. */
export function teacherLoad(slots) {
  const map = new Map()
  for (const s of slots) {
    if (!s.teacher_id) continue
    const k = String(s.teacher_id)
    map.set(k, (map.get(k) || 0) + 1)
  }
  return map
}

/** Utilisation per room across the whole Mon–Sat week. */
export function roomUtilisation(slots, capacity) {
  const map = new Map()
  for (const s of slots) {
    if (!s.room) continue
    const k = normRoom(s.room)
    map.set(k, (map.get(k) || 0) + 1)
  }
  const out = new Map()
  for (const [room, used] of map) out.set(room, { used, pct: capacity ? used / capacity : 0 })
  return out
}

export function isSubstitution(slot) {
  return Boolean(slot.is_substitution)
}

/**
 * Whole-board audit: finds every pre-existing teacher or room clash so the
 * builder can show the school what it inherited, not just what it is about to save.
 */
export function auditConflicts(slots = []) {
  const groups = new Map()
  for (const s of slots) {
    const k = `${normDay(s.day)}|${normPeriod(s.period)}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(s)
  }
  const issues = []
  for (const [, group] of groups) {
    const day = group[0].day
    const period = Number(group[0].period)
    const byTeacher = new Map()
    const byRoom = new Map()
    for (const s of group) {
      if (s.teacher_id) {
        const t = String(s.teacher_id)
        byTeacher.set(t, [...(byTeacher.get(t) || []), s])
      }
      if (s.room) byRoom.set(normRoom(s.room), [...(byRoom.get(normRoom(s.room)) || []), s])
    }
    for (const [t, list] of byTeacher)
      if (list.length > 1)
        issues.push({
          kind: 'teacher',
          day,
          period: Number(period),
          who: list[0].teacher_name,
          detail: list.map((s) => s.class_section).join(', '),
          ids: list.map((s) => s.id),
        })
    for (const [, list] of byRoom)
      if (list.length > 1)
        issues.push({
          kind: 'room',
          day,
          period: Number(period),
          who: list[0].room,
          detail: list.map((s) => s.class_section).join(', '),
          ids: list.map((s) => s.id),
        })
  }
  return issues
}
