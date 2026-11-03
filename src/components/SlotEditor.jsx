import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MapPin,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import { db } from '../lib/supabase'
import { checkSlot, explain, normRoom } from '../lib/conflicts'
import { periodAt } from '../lib/bellSchedule'
import {
  Alert,
  Button,
  Chip,
  ConfirmDialog,
  Field,
  Modal,
  SearchSelect,
  Textarea,
  cx,
} from './ui/primitives'

/** Practical subjects are bound to their lab; everything else wants the class's own room. */
const LAB_ROOM = {
  Physics: 'Physics Lab',
  Chemistry: 'Chemistry Lab',
  'Computer Science': 'CS Lab',
}

export default function SlotEditor({
  open,
  onClose,
  target,
  classSection,
  allSlots = [],
  teachers = [],
  rooms = [],
  homeRoom = '',
  subjects = [],
  onSaved,
  onDeleted,
}) {
  const [subject, setSubject] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const day = target?.day
  const period = target?.period
  const existing = target?.slot
  // Period 0 is a real bell in this school, so presence has to be tested
  // explicitly — `period &&` would treat the zero period as no period at all.
  const hasPeriod = period !== undefined && period !== null && period !== ''

  useEffect(() => {
    if (!open || !target) return
    setSubject(existing?.subject || '')
    setTeacherId(existing?.teacher_id ? String(existing.teacher_id) : '')
    setNote(existing?.homework_note || '')
    setTouched(false)
    setShowAll(false)
    setConfirmingDelete(false)
  }, [open, target, existing])

  // Who and what is already sitting at this bell — independent of the room we
  // are about to choose, so the room can be picked from it without a loop.
  const busy = useMemo(
    () =>
      day && hasPeriod
        ? explain(allSlots, { day, period, class_section: classSection, id: existing?.id })
        : null,
    [allSlots, day, period, classSection, existing],
  )

  /**
   * The room is a consequence of the subject and the class, not a decision the
   * office makes twice a week: a practical goes to its lab, everything else to
   * the class's own room, and if both are taken at this bell the first free one.
   */
  const roomPick = useMemo(() => {
    if (!subject) return { room: existing?.room || '', reason: '' }
    const taken = busy?.roomNames || new Set()
    const lab = LAB_ROOM[subject]
    const wanted = [lab, homeRoom, ...rooms].filter(Boolean)
    const seen = new Set()
    for (const r of wanted) {
      if (seen.has(r)) continue
      seen.add(r)
      if (taken.has(normRoom(r))) continue
      const reason =
        r === lab
          ? 'lab for this subject'
          : r === homeRoom
            ? lab && taken.has(normRoom(lab))
              ? `${lab} is busy at this bell`
              : "class's own room"
            : 'first free at this bell'
      return { room: r, reason }
    }
    return { room: wanted[0] || existing?.room || '', reason: 'every preferred room is busy' }
  }, [subject, busy, homeRoom, rooms, existing])
  const room = roomPick.room

  const candidate = useMemo(
    () => ({
      id: existing?.id,
      day,
      period,
      class_section: classSection,
      subject,
      teacher_id: teacherId,
      teacher_name: teachers.find((t) => String(t.id) === String(teacherId))?.full_name || '',
      room,
    }),
    [existing, day, period, classSection, subject, teacherId, room, teachers],
  )

  const verdict = useMemo(
    () =>
      subject && teacherId && day && hasPeriod
        ? checkSlot(allSlots, candidate, teachers, { maxPeriodsPerDay: 7 })
        : null,
    [allSlots, candidate, teachers, subject, teacherId, day, period],
  )

  const matchesSubject = (t, s = subject) => [t.subject, ...(t.extra || [])].includes(s)

  const subjectOptions = useMemo(
    () =>
      subjects.map((s) => ({
        value: s,
        label: s,
        hint: `${teachers.filter((t) => matchesSubject(t, s)).length} on staff`,
      })),
    [subjects, teachers],
  )

  /**
   * A 73-name list is not a picker. Offer the people who can actually take this
   * subject first, let a search reach everyone else, and mark who is already on
   * duty — choosing a busy teacher reveals the exact clash and blocks the save.
   */
  const able = useMemo(() => (subject ? teachers.filter((t) => matchesSubject(t)) : []), [teachers, subject])

  const teacherOptions = useMemo(() => {
    const busyIds = busy?.teacherIds || new Set()
    const busySlotOf = (t) => busy?.slots?.find((s) => String(s.teacher_id) === String(t.id))
    const pool = showAll || !able.length ? teachers : able
    return pool
      .slice()
      .sort(
        (a, b) =>
          Number(busyIds.has(String(a.id))) - Number(busyIds.has(String(b.id))) ||
          a.full_name.localeCompare(b.full_name),
      )
      .map((t) => {
        const busySlot = busySlotOf(t)
        const teaches = matchesSubject(t)
        const subjectsLine = [t.subject, ...(t.extra || [])].filter(Boolean).join(' · ')
        return {
          value: String(t.id),
          label: t.full_name,
          hint: busySlot
            ? `Busy · ${busySlot.class_section}`
            : `${teaches ? 'Free · teaches it' : 'Free'}${subjectsLine ? ` — ${subjectsLine}` : ''}`,
        }
      })
  }, [busy, teachers, able, showAll, subject])

  const onSubjectChange = (next) => {
    setSubject(next)
    setTouched(true)
    // Auto-place the school's obvious answer: the free teacher who owns the subject.
    const current = teachers.find((t) => String(t.id) === String(teacherId))
    if (!current || !matchesSubject(current, next)) {
      const freeT = teachers.find(
        (t) => matchesSubject(t, next) && !busy?.teacherIds.has(String(t.id)),
      )
      if (freeT) setTeacherId(String(freeT.id))
    }
  }

  const blocked = verdict && !verdict.ok
  const clashes = verdict?.conflicts || []
  const canSave = Boolean(subject && teacherId && day && hasPeriod && !blocked && !saving)

  const save = async () => {
    setTouched(true)
    if (!canSave) return
    setSaving(true)
    try {
      const row = await db.saveSlot({
        ...(existing || {}),
        day,
        period,
        class_section: classSection,
        subject,
        teacher_id: teacherId,
        teacher_name: candidate.teacher_name,
        room,
        homework_note: note,
        is_substitution: Boolean(existing?.is_substitution),
        substitute_teacher_name: existing?.substitute_teacher_name ?? null,
      })
      onSaved?.(row)
      onClose?.()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!existing) return
    setSaving(true)
    try {
      await db.deleteSlot(existing.id)
      onDeleted?.(existing)
      setConfirmingDelete(false)
      onClose?.()
    } finally {
      setSaving(false)
    }
  }

  if (!target) return null

  const bell = hasPeriod ? periodAt(period) : null
  const dutyCount = busy?.teacherIds.size || 0

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        width="max-w-[560px]"
        tone="brand"
        icon={Clock}
        title={existing ? 'Edit period' : 'Assign period'}
        sub={
          <span className="num text-2xs">
            {classSection} · {day} · {bell ? `${bell.label} ${bell.start}–${bell.end}` : '—'}
          </span>
        }
        footer={
          <>
            {existing ? (
              <Button
                variant="danger"
                size="sm"
                icon={Trash2}
                className="mr-auto"
                onClick={() => setConfirmingDelete(true)}
                disabled={saving}
              >
                Clear period
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={save}
              disabled={!canSave}
              loading={saving}
              icon={blocked ? AlertTriangle : CheckCircle2}
              title={blocked ? 'Resolve the conflict first' : undefined}
            >
              {saving ? 'Saving…' : existing ? 'Save changes' : 'Assign slot'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 min-w-0">
          <div data-tone="brand" className="well px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            {[
              ['Class', classSection],
              ['Day', day],
              ['Period', bell ? `${bell.label} · ${bell.start}–${bell.end}` : '—'],
            ].map(([k, v]) => (
              <span key={k} className="flex items-baseline gap-2 min-w-0">
                <span className="field-label mb-0">{k}</span>
                <span className="num text-xs t1 truncate">{v}</span>
              </span>
            ))}
            {existing ? (
              <span className="ml-auto chip" data-tone="neutral" title={existing.id}>
                editing
              </span>
            ) : (
              <span className="ml-auto chip" data-tone="success">
                empty cell
              </span>
            )}
          </div>

          <Field label="Subject" required>
            <SearchSelect
              value={subject}
              onChange={onSubjectChange}
              options={subjectOptions}
              placeholder="Choose a subject…"
              searchPlaceholder="Search a subject"
              emptyText="No subject by that name is on the school's list."
            />
          </Field>

          {touched && clashes.length ? (
            <Alert tone="danger" title="Double booking blocked">
              <ul className="m-0 mt-1.5 list-none p-0 space-y-1.5">
                {clashes.map((c, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-snug">
                    <span className="chip shrink-0" data-tone="danger">
                      {c.kind}
                    </span>
                    <span className="min-w-0">{c.message}</span>
                  </li>
                ))}
              </ul>
            </Alert>
          ) : subject && teacherId && !clashes.length ? (
            <Alert tone="success" title="No clash">
              This teacher and room are free on {day} at {bell ? bell.label : 'this bell'}.
            </Alert>
          ) : null}

          <Field
            label={subject ? `Teacher · ${dutyCount} already on duty this period` : 'Teacher'}
            hint="Free teachers are listed first. Choosing one already standing in another class shows the exact clash and blocks the save."
          >
            <div className="flex flex-col gap-2">
              <SearchSelect
                value={teacherId}
                onChange={(v) => {
                  setTeacherId(String(v || ''))
                  setTouched(true)
                }}
                options={teacherOptions}
                placeholder={subject ? 'Choose a teacher…' : 'Pick a subject first'}
                searchPlaceholder="Search staff by name or subject"
                emptyText={
                  subject
                    ? 'Nobody here is free — try the full staff list.'
                    : 'Pick a subject to see who is available.'
                }
                disabled={!subject && !showAll}
              />
              {subject && able.length ? (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Button variant="quiet" size="sm" icon={Users} onClick={() => setShowAll((v) => !v)}>
                    {showAll ? `Only ${subject} teachers` : `Show all ${teachers.length} staff`}
                  </Button>
                  <span className="meta tabular-nums">
                    {able.length} teach {subject} · {Math.max(0, teachers.length - dutyCount)} free at this bell
                  </span>
                </div>
              ) : null}
            </div>
          </Field>

          <div className="well px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-2 min-w-0">
              <MapPin size={14} className="t3 shrink-0" aria-hidden />
              <span className="field-label mb-0">Room</span>
              <span className="num text-xs t1">{room || 'unassigned'}</span>
            </span>
            {roomPick.reason ? (
              <span className="chip ml-auto" data-tone="info">
                <Sparkles size={12} aria-hidden /> {roomPick.reason}
              </span>
            ) : null}
          </div>

          <Field label="Homework / topic note" hint="Shown to students when they tap this period, and in the teacher drawer.">
            <Textarea
              placeholder="Complete NCERT Ex 3.2 & bring the lab manual"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </Field>

          {subject ? (
            <div className={cx('flex items-center gap-2 flex-wrap min-w-0')}>
              <Chip tone="neutral">{subject}</Chip>
              {candidate.teacher_name ? <span className="meta truncate">{candidate.teacher_name}</span> : null}
              {room ? <span className="meta truncate">@ {room}</span> : null}
            </div>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={remove}
        busy={saving}
        title="Clear this period?"
        confirmLabel="Clear period"
        cancelLabel="Keep it"
        body={
          existing ? (
            <span>
              {existing.subject} with {existing.teacher_name || 'unassigned'} on {existing.day}{' '}
              at {periodAt(existing.period).label} will be removed from {classSection}. The cell
              opens again for a new assignment.
            </span>
          ) : null
        }
      />
    </>
  )
}
