import { Fragment, useMemo, useState } from 'react'
import {
  ArrowRightLeft,
  BookOpenText,
  CalendarDays as CalendarIcon,
  Clock,
  MapPin,
  Plus,
  Sun,
} from 'lucide-react'
import { DAYS, interludesFor, PERIODS, toMinutes, to12h } from '../../lib/bellSchedule'
import { roomShort, subjectShort, subjectTone } from '../../lib/subjects'
import { Chip, EmptyState, Segmented } from '../ui/primitives'

/**
 * The weekly board. One engine, three readings — by class, by teacher, by room —
 * and one deliberate mobile form: a day strip over a single-column agenda.
 */

function PeriodCard({ slot, day, period, periodDef, mode, liveDay, livePeriod, editable, onClick, showClass }) {
  const p = periodDef || PERIODS.find((x) => x.n === Number(period)) || { label: `P${period}`, start: '', end: '' }
  const live = liveDay === day && livePeriod === Number(period)

  if (!slot) {
    if (!editable) {
      return (
        <div className="period" data-empty="true" aria-label={`${day} ${p.label} — free period`}>
          <span className="period-title">Free</span>
        </div>
      )
    }
    return (
      <button
        type="button"
        className="period"
        data-empty="true"
        onClick={() => onClick?.({ day, period: p.n, slot: null })}
        aria-label={`Assign a class for ${day}, ${p.label}`}
      >
        <span className="period-title inline-flex items-center gap-1.5">
          <Plus size={13} strokeWidth={2.6} aria-hidden /> Assign
        </span>
        <span className="period-sub">{p.start}–{p.end}</span>
      </button>
    )
  }

  const sub = slot.is_substitution
  const tone = subjectTone(slot.subject)
  const headline = mode === 'teacher' ? slot.class_section : slot.subject
  const second =
    mode === 'teacher'
      ? slot.subject
      : sub
        ? `${slot.substitute_teacher_name} for ${slot.teacher_name}`
        : slot.teacher_name

  return (
    <button
      type="button"
      data-tone={sub ? 'accent' : tone}
      data-now={live ? 'true' : undefined}
      data-sub={sub ? 'true' : undefined}
      className="period"
      onClick={() => onClick?.({ day, period: p.n, slot })}
      aria-label={`${day}, ${p.label}: ${slot.subject} with ${second}${sub ? ' (substitute)' : ''}${slot.room ? ` in ${slot.room}` : ''}`}
    >
      <span className="period-time">{p.start}–{p.end}</span>
      <span className="period-title" title={String(headline)}>
        {subjectShort(String(headline))}
      </span>
      <span className="flex items-end justify-between gap-1.5 min-w-0">
        <span className="period-sub" title={second}>
          {sub ? <ArrowRightLeft size={11} className="inline mr-1 -mt-0.5" aria-hidden /> : null}
          {second}
          {showClass && mode !== 'teacher' ? ` · ${slot.class_section}` : ''}
        </span>
        <span className="flex items-center gap-1 shrink-0 min-w-0">
          {slot.homework_note ? <BookOpenText size={12} aria-hidden /> : null}
          {slot.room ? (
            <span className="period-time whitespace-nowrap" title={slot.room}>
              {roomShort(slot.room)}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  )
}

function Interlude({ after, before, minutes }) {
  const lunch = minutes >= 40
  return (
    <tr>
      <td colSpan={DAYS.length + 1} className="p-1.5">
        <div className="interlude">
          {lunch ? <Sun size={12} aria-hidden /> : <Clock size={12} aria-hidden />}
          <span>{lunch ? 'Lunch' : 'Break'}</span>
          <span className="h-px flex-1 bg-[color:var(--color-line)]" />
          <span className="num tabular-nums normal-case tracking-normal">
            {after} → {before} · {minutes} min
          </span>
        </div>
      </td>
    </tr>
  )
}

function DesktopBoard({ slots, byCell, rows, gaps, ...cell }) {
  return (
    <div className="board">
      <table className="w-full table-fixed border-separate border-spacing-0">
        <caption className="sr-only">Weekly timetable grid</caption>
        <thead>
          <tr className="board-head">
            <th scope="col" className="w-[74px] px-2 py-2.5 text-right">
              <span className="eyebrow">Time</span>
            </th>
            {DAYS.map((d) => {
              const today = cell.liveDay === d
              return (
                <th key={d} scope="col" className="px-1.5 py-2.5">
                  <span className={`day-head inline-flex items-center gap-1.5 ${today ? '' : ''}`} data-today={today}>
                    <span className="day-pill px-2 py-0.5 rounded-lg">{d.slice(0, 3)}</span>
                    {today ? <span className="badge" data-tone="brand">now</span> : null}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((p, ri) => {
            const gap = gaps.find((g) => g.after === p.n)
            const next = rows[ri + 1]
            return (
              <Fragment key={p.n}>
                <tr>
                  <th scope="row" className="p-0">
                    <div className="time-rail h-full flex flex-col items-end justify-center py-1">
                      <span className={cell.livePeriod === p.n ? 'text-[color:var(--color-brand-ink)]' : ''}>{p.label}</span>
                      <span className="opacity-70 font-normal">{p.start}</span>
                    </div>
                  </th>
                  {DAYS.map((d) => {
                    const slot = byCell.get(`${d}|${p.n}`)
                    return (
                      <td key={`${d}-${p.n}`} className="board-cell">
                        <PeriodCard slot={slot} day={d} period={p.n} periodDef={p} {...cell} />
                      </td>
                    )
                  })}
                </tr>
                {gap && next ? <Interlude after={p.end} before={next.start} minutes={gap.minutes} /> : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MobileAgenda({ slots, byCell, rows, gaps, liveDay, ...cell }) {
  const first = liveDay && DAYS.includes(liveDay) ? liveDay : DAYS[0]
  const [day, setDay] = useState(first)
  const shown = rows.map((p) => ({ p, slot: byCell.get(`${day}|${p.n}`) }))

  return (
    <div className="board p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 mb-3 overflow-x-auto scroll">
        <Segmented
          label="Day"
          value={day}
          onChange={setDay}
          items={DAYS.map((d) => ({ id: d, label: d.slice(0, 3), icon: liveDay === d ? Clock : undefined }))}
        />
      </div>
      <ol className="list-none m-0 p-0 space-y-2">
        {shown.map(({ p, slot }) => {
          const gap = gaps.find((g) => g.after === p.n)
          const next = rows[rows.findIndex((r) => r.n === p.n) + 1]
          return (
            <Fragment key={p.n}>
              <li className="flex gap-3 items-stretch">
                <div className="w-[54px] shrink-0 pt-2 text-right">
                  <p className="num text-2xs font-bold t1 leading-tight">{p.start}</p>
                  <p className="meta leading-tight opacity-80">{p.label}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <PeriodCard slot={slot} day={day} period={p.n} periodDef={p} liveDay={day} {...cell} />
                </div>
              </li>
              {gap && next ? (
                <li className="pl-[70px]">
                  <div className="interlude">
                    {gap.minutes >= 40 ? <Sun size={12} aria-hidden /> : <Clock size={12} aria-hidden />}
                    <span>{gap.minutes >= 40 ? 'Lunch' : 'Break'}</span>
                    <span className="h-px flex-1 bg-[color:var(--color-line)]" />
                    <span className="num normal-case tracking-normal tabular-nums">
                      {p.end} → {next.start}
                    </span>
                  </div>
                </li>
              ) : null}
            </Fragment>
          )
        })}
      </ol>
    </div>
  )
}

export function TimetableBoard({
  slots = [],
  mode = 'class',
  liveDay,
  livePeriod,
  onCellClick,
  editable = false,
  readOnly = false,
  showClass = false,
  periods,
  emptyTitle = 'Nothing on the board yet',
  emptyHint = 'The office has not published periods for this selection.',
}) {
  const rows = periods?.length ? periods : PERIODS
  const byCell = useMemo(() => new Map(slots.map((s) => [`${s.day}|${Number(s.period)}`, s])), [slots])
  const gaps = useMemo(() => interludesFor(rows), [rows])

  if (!slots.length && !editable) {
    return (
      <div className="board">
        <EmptyState icon={CalendarIcon} title={emptyTitle} hint={emptyHint} />
      </div>
    )
  }

  const cell = {
    mode,
    liveDay,
    livePeriod,
    editable: editable && !readOnly,
    onClick: onCellClick,
    showClass,
  }

  return (
    <>
      <div className="hidden lg:block">
        <DesktopBoard slots={slots} byCell={byCell} rows={rows} gaps={gaps} {...cell} />
      </div>
      <div className="lg:hidden">
        <MobileAgenda slots={slots} byCell={byCell} rows={rows} gaps={gaps} liveDay={liveDay} {...cell} />
      </div>
    </>
  )
}

const showSection = (s) => s.class_section && String(s.class_section).length <= 24
const railNow = (rows, minutes) => (rows.find((r) => toMinutes(r.start) <= minutes && toMinutes(r.end) > minutes)?.start || rows[0].start)
const railNext = (rows, minutes) => (rows.find((r) => toMinutes(r.start) > minutes)?.start || '23:59')

/** Live Now / Up Next rail shared by the teacher and student overviews. */
export function LiveRail({ slots = [], now, periods, compact }) {
  const rows = periods?.length ? periods : PERIODS
  const minutes = now.getHours() * 60 + now.getMinutes()
  const dayName = DAYS[(now.getDay() + 6) % 7]
  const onDay = slots.filter((s) => s.day === dayName)

  const current = onDay.find((s) => {
    const p = rows.find((r) => r.n === Number(s.period))
    return p && minutes >= toMinutes(p.start) && minutes < toMinutes(p.end)
  })
  const upcoming = onDay
    .filter((s) => {
      const p = rows.find((r) => r.n === Number(s.period))
      return p && toMinutes(p.start) > minutes
    })
    .sort((a, b) => toMinutes(rows.find((r) => r.n === Number(a.period))?.start || '00:00') - toMinutes(rows.find((r) => r.n === Number(b.period))?.start || '00:00'))
    .slice(0, compact ? 2 : 4)

  if (!onDay.length) {
    return (
      <div className="card p-4">
        <p className="text-sm font-semibold t2">No periods scheduled {dayName}.</p>
        <p className="meta mt-1">The board is empty for this day.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {current ? (
        (() => {
          const p = rows.find((r) => r.n === Number(current.period))
          return (
            <div data-tone={subjectTone(current.subject)} className="card p-4 flex flex-col gap-1.5">
              <span className="eyebrow" style={{ color: 'var(--tone-ink)' }}>
                Live now · {p.label}
              </span>
              <p className="display text-lg font-extrabold t1 truncate">{current.subject}</p>
              <p className="text-sm t2 truncate">
                {current.is_substitution ? current.substitute_teacher_name : current.teacher_name}
              </p>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                <Chip tone="neutral">
                  {p.start}–{p.end}
                </Chip>
                {current.room ? (
                  <Chip tone="info">
                    <MapPin size={12} aria-hidden /> {roomShort(current.room)}
                  </Chip>
                ) : null}
                {showSection(current) ? <Chip tone="brand">{current.class_section}</Chip> : null}
              </div>
            </div>
          )
        })()
      ) : (
        <div className="card p-4 flex flex-col gap-1.5">
          <span className="eyebrow">Live now</span>
          <p className="display text-lg font-bold t2">Between periods</p>
          <p className="text-sm t3">
            {to12h(railNow(rows, minutes))} — the next bell is at {to12h(railNext(rows, minutes))}
          </p>
        </div>
      )}

      <div className="card p-4">
        <span className="eyebrow mb-2 block">Up next</span>
        {upcoming.length === 0 ? (
          <p className="text-sm t3">Last period of the day.</p>
        ) : (
          <ol className="list-none m-0 p-0 space-y-2">
            {upcoming.map((s) => {
              const p = rows.find((r) => r.n === Number(s.period))
              return (
                <li key={s.id} className="flex items-center gap-2.5 min-w-0">
                  <span className="num text-2xs t3 w-[46px] shrink-0">{p?.start}</span>
                  <span className="dot shrink-0" data-tone={subjectTone(s.subject)} />
                  <span className="text-sm font-semibold t1 truncate">{s.subject}</span>
                  <span className="meta truncate ml-auto shrink-0">{roomShort(s.room) || s.class_section}</span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}

/** Legend explaining the colour coding and the substitute marker. */
export function BoardLegend({ subjects = [], className }) {
  if (!subjects.length) return null
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className || ''}`}>
      {subjects.map((s) => (
        <Chip key={s} tone={subjectTone(s)}>
          {subjectShort(s)}
        </Chip>
      ))}
    </div>
  )
}

export default TimetableBoard
