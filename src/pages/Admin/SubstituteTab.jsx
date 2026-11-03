import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRightLeft,
  CalendarX2,
  CheckCircle2,
  Clock4,
  Search,
  ShieldAlert,
  UserX2,
  Users2,
} from 'lucide-react'
import { db } from '../../lib/supabase'
import { DAYS, PERIODS, currentPeriodIndex, periodAt } from '../../lib/bellSchedule'
import { checkSlot, explain, freeTeachersFor, isSubstitution } from '../../lib/conflicts'
import { subjectShort, subjectTone } from '../../lib/subjects'
import { useApp } from '../../context/AppContext'
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHead,
  Chip,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  SectionTitle,
  Segmented,
  Select,
  SkeletonRows,
  cx,
} from '../../components/ui/primitives'

const teachesSubject = (t, subject) => Boolean(subject) && [t.subject, ...(t.extra || [])].includes(subject)

/** Subject matches first, then alphabetically — the same order the server uses. */
const rank = (list, subject) =>
  [...list]
    .map((t) => ({ ...t, matches_subject: teachesSubject(t, subject), reason: teachesSubject(t, subject) ? 'Teaches this subject' : 'Free at this bell' }))
    .sort((a, b) => Number(b.matches_subject) - Number(a.matches_subject) || a.full_name.localeCompare(b.full_name))

function Row({ slot, slots, teachers, absentIds, onDone, pushToast }) {
  const p = periodAt(Number(slot.period))
  const filled = isSubstitution(slot)
  const at = { day: slot.day, period: slot.period, class_section: slot.class_section, id: slot.id }
  const [serverList, setServerList] = useState(null)
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  /* Local first: the whole board is already loaded, so freeTeachersFor answers
     instantly. db.availableSubstitutes then confirms it against the live rows. */
  const local = useMemo(
    () => rank(freeTeachersFor(slots, teachers, at, { absentIds }), slot.subject),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slots, teachers, slot.day, slot.period, slot.class_section, slot.id, slot.subject, absentIds],
  )

  useEffect(() => {
    let alive = true
    setServerList(null)
    db.availableSubstitutes({ day: slot.day, period: slot.period, class_section: slot.class_section, subject: slot.subject })
      .then((list) => alive && setServerList(rank(list, slot.subject)))
      .catch(() => alive && setServerList([]))
    return () => {
      alive = false
    }
  }, [slot.day, slot.period, slot.class_section, slot.subject])

  const options = serverList ?? local
  const busyAtBell = explain(slots, at).teacherIds.size
  const matched = options.filter((o) => o.matches_subject)
  const chosen = options.find((o) => String(o.id) === String(picked)) || null

  const assign = useCallback(async () => {
    if (!chosen) return
    setBusy(true)
    setNote(null)
    // The same engine a single-cell edit uses: covering a period cannot put the
    // substitute in two rooms at once.
    const verdict = checkSlot(slots, { ...slot, teacher_id: chosen.id, teacher_name: chosen.full_name }, teachers, {
      maxPeriodsPerDay: 7,
    })
    if (!verdict.ok) {
      setNote({ tone: 'danger', title: 'Not written', body: verdict.conflicts.map((c) => c.message).join(' ') })
      setBusy(false)
      return
    }
    try {
      await db.applySubstitution(slot, chosen)
      await onDone?.()
      setPicked('')
      setNote({
        tone: verdict.soft?.length ? 'warning' : 'success',
        title: 'Cover confirmed',
        body: `${chosen.full_name} now holds ${slot.class_section} · ${slot.day} ${p.label} (${p.start}–${p.end}).${
          verdict.soft?.length ? ` ${verdict.soft.join(' ')}` : ''
        }`,
      })
      pushToast?.({
        tone: 'success',
        title: 'Substitute assigned',
        message: `${chosen.full_name} covers ${slot.class_section} · ${slot.day} ${p.label}.`,
      })
    } catch (err) {
      setNote({ tone: 'danger', title: 'The school refused this cover', body: err.message || 'Nothing was written.' })
      pushToast?.({ tone: 'danger', title: 'Substitute not assigned', message: err.message || 'Nothing was written.' })
    } finally {
      setBusy(false)
    }
  }, [chosen, onDone, p, pushToast, slot, slots, teachers])

  const revert = useCallback(async () => {
    setBusy(true)
    setNote(null)
    try {
      await db.clearSubstitution(slot)
      await onDone?.()
      setNote({ tone: 'info', title: 'Restored', body: `${slot.teacher_name} is back on this period.` })
      pushToast?.({ tone: 'success', title: 'Restored', message: `${slot.teacher_name} is back on this period.` })
    } catch (err) {
      setNote({ tone: 'danger', title: 'Could not restore', body: err.message || 'Nothing was written.' })
      pushToast?.({ tone: 'danger', title: 'Could not restore', message: err.message || 'Nothing was written.' })
    } finally {
      setBusy(false)
    }
  }, [onDone, pushToast, slot])

  return (
    <Card
      tone={filled ? 'accent' : 'warning'}
      className={cx('p-3.5', filled && 'border-dashed')}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-[64px] shrink-0">
          <p className="num text-xs font-extrabold t1 leading-tight">{p.start}</p>
          <p className="meta leading-tight">{p.label}</p>
          <p className="meta leading-tight opacity-80">{p.end}</p>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone={subjectTone(slot.subject)}>{subjectShort(slot.subject)}</Chip>
            <span className="text-sm font-bold t1">{slot.class_section}</span>
            <span className="meta">{slot.day}</span>
            {slot.room ? <Chip tone="info">{slot.room}</Chip> : null}
          </div>
          <p className="text-xs t2 mt-1.5 min-w-0">
            {filled ? (
              <>
                covered by <strong className="t1">{slot.substitute_teacher_name}</strong>
                <span className="t3"> instead of {slot.teacher_name}</span>
              </>
            ) : (
              <>
                <strong className="text-[color:var(--color-danger-ink)]">{slot.teacher_name}</strong> is absent — this bell needs
                cover
              </>
            )}
          </p>
        </div>

        <div className="shrink-0 ml-auto">
          {filled ? (
            <Button size="sm" icon={CheckCircle2} loading={busy} disabled={busy} onClick={revert}>
              Restore {slot.teacher_name}
            </Button>
          ) : null}
        </div>
      </div>

      {!filled ? (
        <div className="mt-3 pt-3 border-t border-[color:var(--color-line-soft)] grid gap-2.5">
          {options.length ? (
            <div className="grid sm:grid-cols-[1fr_auto] gap-2.5 items-end">
              <Field
                label={`Substitute · ${slot.day} ${p.label}`}
                htmlFor={`sub-pick-${slot.id}`}
                hint={`${busyAtBell} of ${teachers.length} staff are already teaching another class at ${p.start}–${p.end}. ${
                  matched.length ? `${matched.length} of the ${options.length} free teachers also teach ${subjectShort(slot.subject)}` : `none of the ${options.length} free teachers teach ${subjectShort(slot.subject)}`
                }${serverList === null ? ' · confirming the free list with the server…' : ''}`}
              >
                <Select
                  id={`sub-pick-${slot.id}`}
                  value={picked}
                  onChange={(e) => setPicked(e.target.value)}
                >
                  <option value="">
                    {matched.length ? `Choose a free teacher — ${matched.length} teach ${subjectShort(slot.subject)}` : 'Choose any free teacher'}
                  </option>
                  {matched.map((o) => (
                    <option key={o.id} value={String(o.id)}>
                      {o.full_name} — {o.reason}
                    </option>
                  ))}
                  {options
                    .filter((o) => !o.matches_subject)
                    .map((o) => (
                      <option key={o.id} value={String(o.id)}>
                        {o.full_name} — free, teaches another subject
                      </option>
                    ))}
                </Select>
              </Field>
              <Button variant="primary" icon={ArrowRightLeft} loading={busy} disabled={!picked || busy} onClick={assign}>
                Assign cover
              </Button>
            </div>
          ) : serverList === null ? (
            <SkeletonRows rows={1} />
          ) : (
            <Alert tone="danger" title="No teacher is free at this bell" icon={ShieldAlert}>
              {busyAtBell} of {teachers.length} staff are already teaching another class at {p.start}–{p.end}. Either drop this
              period for the day or move one of those classes first.
            </Alert>
          )}

          {note ? (
            <Alert tone={note.tone} title={note.title}>
              {note.body}
            </Alert>
          ) : null}
        </div>
      ) : note ? (
        <div className="mt-3">
          <Alert tone={note.tone} title={note.title}>
            {note.body}
          </Alert>
        </div>
      ) : null}
    </Card>
  )
}

export default function SubstituteTab({ slots = [], teachers = [], absences = [], reload, loading = false, pushToast }) {
  const { now, todayName } = useApp()
  const [scope, setScope] = useState('today')
  const [staffQuery, setStaffQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const absentIds = useMemo(() => new Set(absences.map((a) => String(a.teacher_id))), [absences])
  const livePeriod = currentPeriodIndex(now)

  const staff = useMemo(() => {
    const q = staffQuery.trim().toLowerCase()
    if (!q) return teachers
    return teachers.filter(
      (t) => t.full_name.toLowerCase().includes(q) || [t.subject, ...(t.extra || [])].some((s) => s.toLowerCase().includes(q)),
    )
  }, [teachers, staffQuery])

  const todaySlots = useMemo(() => slots.filter((s) => s.day === todayName), [slots, todayName])

  const affected = useMemo(() => {
    const pool = scope === 'today' ? todaySlots : slots
    return pool
      .filter((s) => absentIds.has(String(s.teacher_id)) || isSubstitution(s))
      .sort(
        (a, b) =>
          DAYS.indexOf(String(a.day)) - DAYS.indexOf(String(b.day)) || Number(a.period) - Number(b.period),
      )
  }, [scope, todaySlots, slots, absentIds])

  const uncovered = affected.filter((s) => !isSubstitution(s)).length

  const teacherWeek = useMemo(() => {
    const map = new Map()
    for (const s of slots) {
      const k = String(s.teacher_id)
      const e = map.get(k) || { total: 0, today: 0 }
      e.total++
      if (s.day === todayName) e.today++
      map.set(k, e)
    }
    return map
  }, [slots, todayName])

  /* Bells with fewer than three classes on the board still have a room going to waste. */
  const openCells = PERIODS.filter((p) => todaySlots.filter((s) => Number(s.period) === p.n).length < 3).length

  const toggle = useCallback(
    async (teacher) => {
      const on = !absentIds.has(String(teacher.id))
      setBusy(true)
      try {
        await db.setAbsence(teacher.id, on, on ? 'Marked absent by the principal' : '')
        await reload?.()
        pushToast?.({
          tone: on ? 'warning' : 'success',
          title: on ? `${teacher.full_name} marked absent` : `${teacher.full_name} back on duty`,
          message: on
            ? 'Their periods are listed on the right and can be covered one by one.'
            : 'Substitutions already assigned to this teacher were left as they are — restore them individually.',
        })
      } catch (err) {
        pushToast?.({ tone: 'danger', title: 'Register not updated', message: err.message })
      } finally {
        setBusy(false)
      }
    },
    [absentIds, pushToast, reload],
  )

  const clearRegister = async () => {
    setBusy(true)
    try {
      for (const a of absences) await db.setAbsence(a.teacher_id, false)
      await reload?.()
      pushToast?.({ tone: 'success', title: 'Register cleared', message: `Every teacher is back on the ${todayName} timetable.` })
      setConfirmClear(false)
    } catch (err) {
      pushToast?.({ tone: 'danger', title: 'Could not clear the register', message: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SectionTitle
        title="Substitute desk"
        sub="Mark a teacher absent and only the staff genuinely free at that bell are offered as cover. Nothing is written until the conflict engine agrees."
        right={
          <>
            <Segmented
              label="Coverage scope"
              value={scope}
              onChange={setScope}
              items={[
                { id: 'today', label: onlyTodayLabel(todayName), icon: CalendarX2 },
                { id: 'week', label: 'All week', icon: Users2 },
              ]}
            />
            <Chip tone={livePeriod >= 0 ? 'brand' : 'neutral'} icon={Clock4}>
              {livePeriod >= 0 ? `${periodAt(livePeriod).label} in progress` : 'no bell running'}
            </Chip>
          </>
        }
      />

      <div className="grid lg:grid-cols-[minmax(0,320px)_1fr] gap-3 items-start">
        <Card className="p-3.5">
          <CardHead
            title="Staff register"
            sub={`${absences.length} of ${teachers.length} marked absent`}
            className="px-0 pt-0"
            icon={Users2}
          />
          <Field label="Search the register" htmlFor="sub-staff-search" className="mb-2.5">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 t3 pointer-events-none" aria-hidden />
              <Input
                id="sub-staff-search"
                type="search"
                className="pl-9"
                placeholder={`Name or subject, ${teachers.length} staff`}
                value={staffQuery}
                onChange={(e) => setStaffQuery(e.target.value)}
              />
            </div>
          </Field>

          {loading && !teachers.length ? (
            <SkeletonRows rows={4} />
          ) : !teachers.length ? (
            <EmptyState
              icon={Users2}
              title="No staff on record"
              hint="The teacher directory is empty, so there is nothing to mark absent and nobody to call for cover."
            />
          ) : !staff.length ? (
            <p className="text-xs t3 py-2">No member of staff matches “{staffQuery}”.</p>
          ) : (
            <ul className="scroll list-none m-0 p-0 max-h-[420px] overflow-y-auto pr-1 space-y-1.5">
              {staff.map((t) => {
                const out = absentIds.has(String(t.id))
                const load = teacherWeek.get(String(t.id))
                return (
                  <li key={t.id}>
                    <div
                      className={cx(
                        'card-flat px-2.5 py-2 flex items-center gap-2.5',
                        out && 'border-[color:var(--tone-line)] bg-[color:var(--tone-soft)]',
                      )}
                      data-tone={out ? 'danger' : 'neutral'}
                    >
                      <Avatar name={t.full_name} size="sm" tone={out ? 'danger' : undefined} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold t1 truncate">{t.full_name}</span>
                        <span className="block meta truncate">
                          {t.subject} · {load?.today || 0} today / {load?.total || 0} week
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant={out ? 'default' : 'quiet'}
                        tone={out ? 'neutral' : 'danger'}
                        icon={out ? CheckCircle2 : UserX2}
                        disabled={busy}
                        onClick={() => toggle(t)}
                      >
                        {out ? 'Back' : 'Absent'}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <p className="meta mt-3 leading-relaxed">
            {openCells} bell{openCells === 1 ? '' : 's'} today still hold fewer than three classes, so a room is going spare.
          </p>
        </Card>

        <Card className="p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3">
            <div className="min-w-0">
              <h2 className="display text-md font-bold truncate">
                {scope === 'today' ? `${todayName} cover sheet` : 'Whole-week cover sheet'}
              </h2>
              <p className="lede mt-0.5">
                {affected.length ? `${uncovered} still uncovered · ${affected.length - uncovered} already covered` : 'Nothing to cover.'}
              </p>
            </div>
            <Chip tone={uncovered ? 'danger' : 'success'} icon={uncovered ? ArrowRightLeft : CheckCircle2}>
              {uncovered ? `${uncovered} to cover` : 'all periods covered'}
            </Chip>
          </div>

          {!affected.length ? (
            <EmptyState
              icon={Users2}
              title={scope === 'today' ? `Nobody needs cover on ${todayName}` : 'Nobody needs cover this week'}
              hint="Mark a name absent in the register and their periods appear here with only the staff who are genuinely free at that bell."
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {affected.map((s) => (
                <Row
                  key={s.id}
                  slot={s}
                  slots={slots}
                  teachers={teachers}
                  absentIds={absentIds}
                  onDone={reload}
                  pushToast={pushToast}
                />
              ))}
            </div>
          )}

          {absences.length ? (
            <div className="mt-3 pt-3 border-t border-[color:var(--color-line-soft)]">
              <p className="eyebrow mb-2">On the register today</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {absences.map((a) => (
                  <Chip key={a.teacher_id} tone="danger" dot>
                    {teachers.find((t) => String(t.id) === String(a.teacher_id))?.full_name || `Teacher ${a.teacher_id}`}
                  </Chip>
                ))}
                <Button className="ml-auto" size="sm" variant="ghost" icon={CalendarX2} disabled={busy} onClick={() => setConfirmClear(true)}>
                  Clear the day
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      </div>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearRegister}
        busy={busy}
        tone="warning"
        title={`Send all ${absences.length} teachers back on duty?`}
        confirmLabel="Clear the register"
        cancelLabel="Keep them absent"
        body={
          <span>
            Every absence recorded for {todayName} is withdrawn, so the cover sheet empties. Substitutions already assigned stay
            assigned until you restore them one by one.
          </span>
        }
      />
    </>
  )
}

const onlyTodayLabel = (todayName) => `${String(todayName).slice(0, 3)} only`
