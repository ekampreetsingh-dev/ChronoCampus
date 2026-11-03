import { useId, useMemo, useState } from 'react'
import { Copy, Download, Layers, Repeat2, TriangleAlert } from 'lucide-react'
import { db } from '../lib/supabase'
import { checkSlot } from '../lib/conflicts'
import { DAYS, periodAt, periodsFor } from '../lib/bellSchedule'
import { downloadCSV, toCSV } from '../lib/csv'
import {
  Alert,
  Button,
  Card,
  Chip,
  Modal,
  SearchSelect,
  Segmented,
  Switch,
  cx,
} from './ui/primitives'

const DAY_LABEL = (d) => String(d).slice(0, 3)

/** The bell a class actually runs at, so the label matches its own board. */
function bell(classSection, n) {
  const list = periodsFor(classSection)
  return list.find((p) => Number(p.n) === Number(n)) || periodAt(n) || { label: `P${n}`, start: '', end: '' }
}

const bellLabel = (classSection, n) => bell(classSection, n).label
const bellTime = (classSection, n) => {
  const p = bell(classSection, n)
  return p.start && p.end ? `${p.start}–${p.end}` : ''
}

/** Cells of `classSection` on `day`, in bell order — the same view the board shows. */
function dayCells(slots, classSection, day) {
  return slots
    .filter((s) => s.class_section === classSection && s.day === day)
    .sort((a, b) => Number(a.period) - Number(b.period))
}

/** Green only when the whole day fits; amber when part of it will be refused. */
const fitTone = (can, total) => (!can ? 'danger' : can === total ? 'success' : 'warning')
const fitText = (can, total) =>
  cx(
    'font-semibold',
    fitTone(can, total) === 'danger'
      ? 'text-[color:var(--color-danger-ink)]'
      : fitTone(can, total) === 'success'
        ? 'text-[color:var(--color-success-ink)]'
        : 'text-[color:var(--color-warning-ink)]',
  )

function DayPicker({ value, onChange, exclude, name, counts, total = 0 }) {
  return (
    <Segmented
      label={name}
      value={value}
      onChange={onChange}
      className="flex-wrap"
      items={DAYS.filter((d) => d !== exclude).map((d) => ({
        id: d,
        label: (
          <span className="inline-flex items-center gap-1.5">
            {DAY_LABEL(d)}
            {counts && counts[d] !== undefined ? (
              <span className={cx('num tabular-nums', fitText(counts[d], total))} title={`${counts[d]} of ${total} bells fit here`}>
                {counts[d]}
              </span>
            ) : null}
          </span>
        ),
      }))}
    />
  )
}

/** A visible label for a control set that is not a single input, kept associated. */
function PickerBlock({ label, hint, children }) {
  const id = useId()
  return (
    <div className="min-w-0">
      <p id={id} className="field-label mb-2">
        {label}
      </p>
      <div role="group" aria-labelledby={id}>
        {children}
      </div>
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}

/**
 * The three bulk operations the office actually uses on a weekly template:
 * mirror one day onto another, clone a whole week onto another section, and
 * take the board out to a spreadsheet. Everything runs through the same
 * conflict engine as a single-cell edit, so a copy can never create a
 * double-booked teacher or an occupied room.
 */
export default function BoardTools({
  slots = [],
  sections = [],
  classSections = [],
  activeClass = '',
  reload,
  pushToast,
  onCopied,
}) {
  const [tool, setTool] = useState(null)
  const [picked, setPicked] = useState('')
  const [fromDay, setFromDay] = useState(DAYS[0])
  const [toDay, setToDay] = useState(DAYS[1])
  const [pickedFrom, setPickedFrom] = useState('')
  const [toClass, setToClass] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [carryNotes, setCarryNotes] = useState(false)
  const [withStaff, setWithStaff] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const classOptions = useMemo(
    () =>
      classSections.map((name) => {
        const s = sections.find((x) => x.name === name)
        return { value: name, label: name, hint: s ? `${s.default_room} · grade ${s.grade} ${s.section}` : '' }
      }),
    [classSections, sections],
  )

  /* The board loads after this component mounts, so the class the office is
     already looking at is derived on every render — never captured once. */
  const classSection = picked || activeClass || classSections[0] || ''
  const fromClass = pickedFrom || activeClass || classSections[0] || ''

  const source = useMemo(() => dayCells(slots, classSection, fromDay), [slots, classSection, fromDay])
  const destFilled = useMemo(() => dayCells(slots, classSection, toDay), [slots, classSection, toDay])
  const classWeek = useMemo(() => slots.filter((s) => s.class_section === classSection), [slots, classSection])
  const weekSource = useMemo(() => slots.filter((s) => s.class_section === fromClass), [slots, fromClass])
  const weekTarget = useMemo(() => slots.filter((s) => s.class_section === toClass), [slots, toClass])

  /* How many of the source bells could actually land on each other day, decided
     by the same conflict rules the copy itself uses. Without this the office
     picks a day, runs the copy, and only then learns the teachers were busy. */
  const fits = useMemo(() => {
    const out = {}
    if (!source.length) return out
    for (const day of DAYS) {
      if (day === fromDay) continue
      let can = 0
      const staged = []
      for (const src of source) {
        const cand = { ...src, day, id: null }
        if (!withStaff) {
          cand.teacher_id = null
          cand.teacher_name = ''
        }
        const others = slots.filter(
          (x) => !(x.class_section === cand.class_section && x.day === day && Number(x.period) === Number(cand.period)),
        )
        if (checkSlot([...others, ...staged], cand, [], {}).ok) {
          can += 1
          staged.push(cand)
        }
      }
      out[day] = can
    }
    return out
  }, [slots, source, fromDay, withStaff])

  /* The same promise for a whole-week clone: the destination class moves into its
     own room, so the preview has to use that room, not the source’s. */
  const weekFits = useMemo(() => {
    if (!fromClass || !toClass || fromClass === toClass) return null
    const toRoom = sections.find((x) => x.name === toClass)?.default_room
    let can = 0
    const staged = []
    for (const src of weekSource) {
      const cand = { ...src, class_section: toClass, id: null, room: toRoom || src.room }
      if (!withStaff) {
        cand.teacher_id = null
        cand.teacher_name = ''
      }
      const others = slots.filter(
        (x) => !(x.class_section === toClass && x.day === cand.day && Number(x.period) === Number(cand.period)),
      )
      if (checkSlot([...others, ...staged], cand, [], {}).ok) {
        can += 1
        staged.push(cand)
      }
    }
    return can
  }, [slots, weekSource, fromClass, toClass, withStaff, sections])

  const close = () => {
    setTool(null)
    setResult(null)
    setOverwrite(false)
    setWithStaff(true)
    setCarryNotes(false)
  }

  const run = async (fn, okMessage, focusOn) => {
    setBusy(true)
    try {
      const res = await fn()
      setResult(res)
      await reload?.()
      if (!res.error && res.written) onCopied?.(focusOn)
      pushToast?.({
        tone: res.error ? 'danger' : res.blocked?.length ? 'warning' : 'success',
        title: okMessage,
        message: describe(res),
      })
    } catch (err) {
      setResult({ error: err.message || 'The copy did not run.' })
    } finally {
      setBusy(false)
    }
  }

  const exportCSV = (scope) => {
    const rows = (scope === 'school' ? slots : classWeek)
      .slice()
      .sort(
        (a, b) =>
          DAYS.indexOf(a.day) - DAYS.indexOf(b.day) ||
          Number(a.period) - Number(b.period) ||
          a.class_section.localeCompare(b.class_section),
      )
      .map((s) => ({
        class: s.class_section,
        day: s.day,
        period: bellLabel(s.class_section, s.period),
        time: bellTime(s.class_section, s.period),
        subject: s.subject,
        teacher: s.teacher_name || '',
        room: s.room || '',
        substitution: s.is_substitution ? s.substitute_teacher_name || 'yes' : '',
        homework: s.homework_note || '',
      }))
    if (!rows.length) {
      pushToast?.({ tone: 'warning', title: 'Nothing to export', message: 'That board has no periods assigned yet.' })
      return
    }
    downloadCSV(
      scope === 'school' ? 'chronocampus-whole-school.csv' : `chronocampus-${classSection.replace(/\s+/g, '-').toLowerCase()}.csv`,
      toCSV(rows, [
        { key: 'class', label: 'Class' },
        { key: 'day', label: 'Day' },
        { key: 'period', label: 'Period' },
        { key: 'time', label: 'Time' },
        { key: 'subject', label: 'Subject' },
        { key: 'teacher', label: 'Teacher' },
        { key: 'room', label: 'Room' },
        { key: 'substitution', label: 'Substitute' },
        { key: 'homework', label: 'Homework' },
      ]),
    )
    pushToast?.({ tone: 'success', title: 'CSV downloaded', message: `${rows.length} periods written to the file.` })
  }

  const dayFits = fits[toDay] ?? 0

  return (
    <>
      <div className="card-flat px-3 py-2.5 mb-3 flex flex-wrap items-center gap-2">
        <p className="eyebrow mr-1 mb-0">Board tools</p>
        <Button size="sm" variant="quiet" tone="brand" icon={Repeat2} onClick={() => setTool('day')}>
          Copy a day
        </Button>
        <Button size="sm" variant="quiet" tone="accent" icon={Copy} onClick={() => setTool('class')}>
          Duplicate a week
        </Button>
        <Button size="sm" variant="quiet" tone="info" icon={Download} onClick={() => setTool('export')}>
          Export CSV
        </Button>
        <span className="meta ml-auto">copies are conflict-checked period by period</span>
      </div>

      {/* ------------------------------------------------------- copy a day -- */}
      <Modal
        open={tool === 'day'}
        onClose={close}
        title="Copy one day onto another"
        sub={`${classSection || 'a class'} · ${fromDay} → ${toDay}. Periods are matched by bell number, so P1 lands on P1.`}
        width="max-w-[560px]"
        icon={Repeat2}
        tone="brand"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
            <Button
              variant="primary"
              className="ml-auto"
              loading={busy}
              disabled={!source.length || !classSection}
              onClick={() =>
                run(
                  () => db.copyDayBoard({ classSection, fromDay, toDay, overwrite, carryNotes, withStaff }),
                  `${fromDay} copied onto ${toDay}`,
                  classSection,
                )
              }
            >
              {busy ? 'Copying…' : `Copy ${dayFits} of ${source.length} periods`}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <SearchSelect
            label="Class"
            value={classSection}
            onChange={setPicked}
            options={classOptions}
            placeholder="Choose a class"
            searchPlaceholder="Search a class"
          />

          <PickerBlock label="From" hint="The day that already holds the periods.">
            <DayPicker value={fromDay} onChange={setFromDay} exclude={toDay} name="From" />
          </PickerBlock>

          <PickerBlock label="Onto" hint="The number beside each day is how many source bells could land there.">
            <DayPicker value={toDay} onChange={setToDay} exclude={fromDay} name="Onto" counts={fits} total={source.length} />
          </PickerBlock>

          <div className="well px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm t1">
              <span>
                <strong className="num">{source.length}</strong> periods on {fromDay}
              </span>
              <span>
                <strong className="num">{destFilled.length}</strong> already on {toDay}
              </span>
              <span className={fitText(dayFits, source.length)}>
                {dayFits} of {source.length} can go to {toDay} without moving anyone
              </span>
            </div>
            <p className="meta mt-1.5">
              {source.filter((s) => s.is_substitution).length} of them are substitutions; the copy keeps the original teacher and
              drops the cover.
            </p>
            {!dayFits && source.length ? (
              <Alert className="mt-3" tone="danger" title="Nothing fits as it stands" icon={TriangleAlert}>
                None of these teachers are free at that hour in another class. Turn “Copy the staff as well” off to lay the day
                out and assign the staff afterwards.
              </Alert>
            ) : null}
          </div>

          <div className="grid gap-2.5">
            {destFilled.length ? (
              <div className="card-flat px-3.5 py-2.5">
                <Switch
                  checked={overwrite}
                  onChange={setOverwrite}
                  label={`Replace the ${destFilled.length} periods already on ${toDay}`}
                  hint="Off: those bells are left alone and listed as skipped. On: they are overwritten, subject and teacher included."
                />
              </div>
            ) : null}
            <div className="card-flat px-3.5 py-2.5">
              <Switch
                checked={carryNotes}
                onChange={setCarryNotes}
                label="Also copy homework and topic notes"
                hint="Off keeps the new day clean — the teacher publishes notes for that bell separately."
              />
            </div>
            <div className="card-flat px-3.5 py-2.5">
              <Switch
                checked={withStaff}
                onChange={setWithStaff}
                label="Copy the staff as well"
                hint="Off lays the subjects and bells and leaves every period unassigned, so a busy week can still be mirrored. Turn it off to see how many more bells fit above."
              />
            </div>
          </div>

          {result ? <Outcome result={result} classSection={classSection} /> : null}
        </div>
      </Modal>

      {/* -------------------------------------------------- duplicate week -- */}
      <Modal
        open={tool === 'class'}
        onClose={close}
        title="Duplicate a whole week"
        sub="Clone one section's timetable onto another. Same bell schedule, same conflict rules."
        width="max-w-[560px]"
        icon={Copy}
        tone="accent"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
            <Button
              variant="primary"
              className="ml-auto"
              loading={busy}
              disabled={!fromClass || !toClass || fromClass === toClass || !weekSource.length}
              onClick={() =>
                run(
                  () => db.copyClassBoard({ fromSection: fromClass, toSection: toClass, overwrite, carryNotes, withStaff }),
                  `${toClass} rebuilt from ${fromClass}`,
                  toClass,
                )
              }
            >
              {busy ? 'Copying…' : `Copy ${weekFits ?? 0} of ${weekSource.length} periods`}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <SearchSelect
              label="Copy from"
              value={fromClass}
              onChange={setPickedFrom}
              options={classOptions}
              placeholder="Source class"
              searchPlaceholder="Search a class"
            />
            <SearchSelect
              label="Onto"
              value={toClass}
              onChange={setToClass}
              options={classOptions.filter((o) => o.value !== fromClass)}
              placeholder="Destination class"
              searchPlaceholder="Search a class"
            />
          </div>

          {fromClass && toClass && fromClass !== toClass ? (
            <div className="well px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm t1">
                <span className="inline-flex items-center gap-1.5">
                  <Layers size={14} className="t3" aria-hidden />
                  <strong className="num">{weekSource.length}</strong> periods in {fromClass}
                </span>
                <span>
                  <strong className="num">{weekTarget.length}</strong> already in {toClass}
                </span>
              </div>
              <p className={cx('mt-2 text-sm', fitText(weekFits ?? 0, weekSource.length))}>
                {weekFits ?? 0} of {weekSource.length} bells can go to {toClass} without moving anyone else.
                {weekFits === 0 ? ' Turn “Copy the staff as well” off to lay the week out and assign teachers afterwards.' : ''}
              </p>
            </div>
          ) : (
            <p className="lede">Pick two different sections — the source and destination cannot be the same class.</p>
          )}

          <div className="grid gap-2.5">
            <div className="card-flat px-3.5 py-2.5">
              <Switch
                checked={overwrite}
                onChange={setOverwrite}
                label={`Replace matching periods in ${toClass || 'the destination'}`}
                hint="A period is replaced only when the same bell number already holds a period in the destination class."
              />
            </div>
            <div className="card-flat px-3.5 py-2.5">
              <Switch checked={carryNotes} onChange={setCarryNotes} label="Also copy homework and topic notes" />
            </div>
            <div className="card-flat px-3.5 py-2.5">
              <Switch
                checked={withStaff}
                onChange={setWithStaff}
                label="Copy the staff as well"
                hint="In a full school the source class’s teachers are already busy at these bells in other sections. Turn this off to lay the week out and assign the staff afterwards."
              />
            </div>
          </div>

          {result ? <Outcome result={result} classSection={toClass} /> : null}
        </div>
      </Modal>

      {/* -------------------------------------------------------- export ---- */}
      <Modal
        open={tool === 'export'}
        onClose={close}
        title="Export the board as CSV"
        sub="One row per assigned period, exactly as the board holds it — the file is built from these rows, not from a sample."
        width="max-w-[500px]"
        icon={Download}
        tone="info"
      >
        <div className="grid gap-4">
          <SearchSelect
            label="Class"
            value={classSection}
            onChange={setPicked}
            options={classOptions}
            placeholder="Choose a class"
            searchPlaceholder="Search a class"
            hint="Used for the single-class export."
          />

          <div className="grid sm:grid-cols-2 gap-2.5">
            <div className="card-flat p-3.5 flex flex-col gap-2">
              <div>
                <p className="text-sm font-bold t1">This class only</p>
                <p className="meta mt-0.5">
                  {classWeek.length} periods · {classSection || 'no class picked'}
                </p>
              </div>
              <Button block icon={Download} disabled={!classWeek.length} onClick={() => exportCSV('class')}>
                Export {classSection || 'class'}
              </Button>
            </div>
            <div className="card-flat p-3.5 flex flex-col gap-2">
              <div>
                <p className="text-sm font-bold t1">Whole school</p>
                <p className="meta mt-0.5">{slots.length} periods · every section on the board</p>
              </div>
              <Button block variant="primary" icon={Download} disabled={!slots.length} onClick={() => exportCSV('school')}>
                Export everything
              </Button>
            </div>
          </div>

          {!classWeek.length || !slots.length ? (
            <Alert tone="warning" title="Nothing to export yet">
              A scope only downloads when it holds at least one assigned period.
            </Alert>
          ) : null}

          <p className="meta leading-relaxed">
            Columns: Class, Day, Period, Time, Subject, Teacher, Room, Substitute, Homework. A substitution exports the original
            teacher in “Teacher” and the covering one in “Substitute”. Period and Time are read from each class’s own bell
            schedule, not the school default.
          </p>
        </div>
      </Modal>
    </>
  )
}

function describe(result) {
  if (result.error) return result.error
  const parts = [`${result.written} period${result.written === 1 ? '' : 's'} written`]
  if (result.replaced) parts.push(`${result.replaced} replaced`)
  if (result.blocked?.length) parts.push(`${result.blocked.length} blocked`)
  return parts.join(' · ')
}

function Outcome({ result, classSection = '' }) {
  if (result.error) {
    return (
      <Alert tone="danger" title="Nothing was written" icon={TriangleAlert}>
        {result.error}
      </Alert>
    )
  }
  return (
    <Card tone={result.blocked?.length ? 'warning' : 'success'} className="p-3.5">
      <div className="flex flex-wrap gap-1.5">
        <Chip tone="success">{result.written} written</Chip>
        {result.replaced ? <Chip tone="warning">{result.replaced} replaced</Chip> : null}
        {result.blocked?.length ? (
          <Chip tone="danger">{result.blocked.length} blocked</Chip>
        ) : (
          <Chip tone="neutral">no conflicts</Chip>
        )}
      </div>
      {result.blocked?.length ? (
        <>
          <p className="lede mt-2.5">Every refused period is listed here — nothing is dropped quietly.</p>
          <ul className="scroll list-none m-0 mt-2 p-0 max-h-[170px] overflow-y-auto space-y-1.5">
            {result.blocked.map((b, i) => (
              <li key={`${b.day}-${b.period}-${i}`} className="flex items-start gap-2 text-xs t2 min-w-0">
                <span className="num text-2xs uppercase t3 shrink-0">
                  {DAY_LABEL(b.day)} {bellLabel(classSection, b.period)}
                </span>
                <span className="min-w-0">{b.reason}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  )
}
