import { checkSlot, auditConflicts, explain } from '../src/lib/conflicts.js'
import { pitchStore, TEACHERS } from '../src/lib/pitchStore.js'

const slots = pitchStore.get().slots
const teachers = pitchStore.get().teachers
let pass = 0
let fail = 0
const t = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log('  ok  ', name)
  } else {
    fail++
    console.log('  FAIL', name, extra)
  }
}

const base = slots.find((s) => s.day === 'Monday' && Number(s.period) === 1)
console.log('\nsubject under test:', base.class_section, base.day, 'P1', base.subject, base.teacher_name, base.room)

// 1. moving that same teacher into a different class at the same bell must block
const other = slots.find((s) => s.day === 'Monday' && Number(s.period) === 1 && s.class_section !== base.class_section)
const clashTeacher = checkSlot(
  slots,
  { ...other, teacher_id: base.teacher_id, teacher_name: base.teacher_name, room: other.room },
  teachers,
)
t('blocks a teacher already on duty', !clashTeacher.ok && clashTeacher.conflicts[0].kind === 'teacher', JSON.stringify(clashTeacher.conflicts))
t('names the clashing class', /1[12]-[ABC]/.test(clashTeacher.conflicts[0]?.message || ''), clashTeacher.conflicts[0]?.message)

// 2. same room, different teacher must block
const third = slots.filter((s) => s.day === 'Monday' && Number(s.period) === 1)
const victim = third[2] || third[1]
const clashRoom = checkSlot(slots, { ...victim, room: base.room, teacher_id: 'tch-07', teacher_name: 'Meenakshi Dogra' }, teachers)
t('blocks a room already in use', !clashRoom.ok && clashRoom.conflicts.some((c) => c.kind === 'room'), JSON.stringify(clashRoom.conflicts))

// 3. a genuinely free teacher + free room at that same bell must pass
const free = explain(slots, { day: 'Monday', period: 1, class_section: base.class_section })
const freeT = teachers.find((x) => !free.teacherIds.has(String(x.id)))
const clean = checkSlot(
  slots,
  { day: 'Monday', period: 1, class_section: base.class_section, subject: 'Physics', teacher_id: freeT.id, teacher_name: freeT.full_name, room: 'Library' },
  teachers,
)
t('allows a clean assignment', clean.ok, JSON.stringify(clean.conflicts))
t('reports free teachers', clean.freeTeachers.length > 0 && clean.freeTeachers.length < teachers.length, `${clean.freeTeachers.length}/${teachers.length}`)
t('two clashes are both reported', checkSlot(slots, { ...victim, teacher_id: base.teacher_id, teacher_name: base.teacher_name, room: base.room }, teachers).conflicts.length === 2)

// 4. the audit finds a deliberately injected double-booking
const corrupted = [...slots, { ...base, id: 'inject-1', class_section: '12-A Science', teacher_id: base.teacher_id, room: 'Library' }]
const issues = auditConflicts(corrupted)
t('audit detects the injected clash', issues.some((i) => i.kind === 'teacher' && i.ids.includes('inject-1')), JSON.stringify(issues.slice(0, 2)))
t('clean seed has no clashes', auditConflicts(slots).length === 0)

// 5. substitutes offered to an absent teacher are free at that bell
const absentId = 'tch-04'
const affected = slots.filter((s) => s.day === 'Friday' && String(s.teacher_id) === absentId)
for (const s of affected) {
  const busy = explain(slots, { day: s.day, period: s.period, class_section: s.class_section }).teacherIds
  const offered = teachers.filter((x) => !busy.has(String(x.id)) && String(x.id) !== absentId)
  t(`Friday P${s.period} ${s.class_section}: ${offered.length} substitutes offered`, offered.length > 0)
  t(`Friday P${s.period}: absent teacher not offered`, !offered.some((o) => String(o.id) === absentId))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
