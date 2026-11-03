import { pitchStore, TEACHERS, SECTIONS } from '../src/lib/pitchStore.js'
import { auditConflicts, teacherLoad } from '../src/lib/conflicts.js'
import { DAYS, groupOf, periodsFor, weekCapacity, configureSchedule } from '../src/lib/bellSchedule.js'

const t0 = Date.now()
const state = await pitchStore.ready()
const ms = Date.now() - t0
configureSchedule({ schedules: state.bell_schedules || [] })

const slots = state.timetable_slots
console.log(`seeded in ${ms}ms`)
console.log(`sections: ${SECTIONS.length}  teachers: ${TEACHERS.length}  slots: ${slots.length}`)
console.log(`sample names: ${SECTIONS.slice(0, 4).join(', ')} … ${SECTIONS.slice(-3).join(', ')}`)
console.log(
  `by bell group — senior ${SECTIONS.filter((s) => groupOf(s) === 'senior').length} / junior ${
    SECTIONS.filter((s) => groupOf(s) === 'junior').length
  } / early years ${SECTIONS.filter((s) => groupOf(s) === 'early').length}`,
)

const issues = auditConflicts(slots)
console.log(`\nclashes: ${issues.length}`)
issues.slice(0, 5).forEach((i) => console.log('  ', i.kind, i.day, 'P' + i.period, i.who, '|', i.detail))

// per-section fill
const perSection = SECTIONS.map((s) => ({ s, n: slots.filter((x) => x.class_section === s).length }))
const empty = perSection.filter((p) => p.n === 0)
const fill = perSection.map((p) => ({ ...p, cap: weekCapacity(periodsFor(p.s)) }))
const totalCap = fill.reduce((n, p) => n + p.cap, 0)
const low = fill.filter((p) => p.n / p.cap < 0.8)
console.log(`sections with no timetable: ${empty.length}${empty.length ? ' → ' + empty.slice(0, 6).map((e) => e.s).join(', ') : ''}`)
console.log(`board fill: ${slots.length} of ${totalCap} cells (${Math.round((slots.length / totalCap) * 100)}%)`)
console.log(`sections below 80% of their own week: ${low.length}${low.length ? ' → ' + low.slice(0, 8).map((p) => `${p.s} ${p.n}/${p.cap}`).join(', ') : ''}`)

// capacity check: no teacher double-booked at a bell, none overloaded
const loads = teacherLoad(slots)
const arr = [...loads.values()].sort((a, b) => b - a)
console.log(`\nteacher weekly load: max ${arr[0]}, min ${arr[arr.length - 1]}, median ${arr[Math.floor(arr.length / 2)]}`)
console.log(`teachers never scheduled: ${TEACHERS.filter((t) => !loads.has(String(t.id))).length}`)

// room concurrency at the busiest bell
const at = new Map()
for (const s of slots) {
  const k = `${s.day}|${s.period}`
  at.set(k, (at.get(k) || 0) + 1)
}
const peak = Math.max(...at.values())
const rooms = new Set(state.school_settings.rooms)
console.log(`peak simultaneous classes at one bell: ${peak} (rooms available: ${rooms.size})`)

// storage footprint
const bytes = JSON.stringify(state).length
console.log(`localStorage payload: ${(bytes / 1024).toFixed(0)} KB`)

// every section needs a class teacher, and no teacher may hold two classes
const mentors = state.class_sections.map((s) => s.mentor_teacher_id)
const dupes = mentors.filter(Boolean).length - new Set(mentors.filter(Boolean)).size
console.log(`sections without a class teacher: ${mentors.filter((m) => !m).length}`)
console.log(`teachers mentoring more than one class: ${dupes}`)
