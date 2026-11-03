import { useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { db } from '../../lib/supabase'
import { useSchoolData } from '../../hooks/useSchool'
import { useApp } from '../../context/AppContext'
import {
  Alert,
  Button,
  Chip,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SectionTitle,
  Select,
  SkeletonRows,
  Textarea,
  cx,
} from '../../components/ui/primitives'

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const KIND_META = {
  holiday: { label: 'Holiday', tone: 'danger' },
  exam: { label: 'Exam', tone: 'warning' },
  event: { label: 'Event', tone: 'accent' },
  break: { label: 'Break', tone: 'success' },
}
const KIND_ORDER = ['holiday', 'exam', 'event', 'break']
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

const pad = (n) => String(n).padStart(2, '0')
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseISO = (s) => {
  const [y, m, d] = String(s).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
const fmtDate = (x) => new Date(x).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
const fmtDay = (iso) => fmtDate(parseISO(iso))

export function CalendarPage() {
  const { sessions } = useSchoolData()
  const { pushToast, now } = useApp()
  const [events, setEvents] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState(() => {
    const d = new Date(now || Date.now())
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  const [form, setForm] = useState(null)
  const [touched, setTouched] = useState({})
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)

  const todayIso = isoLocal(new Date(now || Date.now()))

  const refresh = async () => {
    setError('')
    try {
      const rows = await db.listCalendar()
      setEvents(
        rows.map((e) => ({
          id: e.id,
          title: e.title || e.name || 'Untitled',
          kind: KIND_META[e.kind] ? e.kind : 'event',
          date: String(e.date).slice(0, 10),
          ends_on: e.ends_on ? String(e.ends_on).slice(0, 10) : '',
          note: e.note || '',
        })),
      )
    } catch (err) {
      setError(err.message || 'The calendar could not be read.')
    }
  }

  useEffect(() => {
    refresh()
    /* eslint-disable-next-line */
  }, [])

  const list = events || []
  const filtered = useMemo(() => (filter === 'all' ? list : list.filter((e) => e.kind === filter)), [list, filter])

  const countsByKind = useMemo(() => {
    const map = {}
    for (const e of list) map[e.kind] = (map[e.kind] || 0) + 1
    return map
  }, [list])

  /* Multi-day entries occupy every day from date..ends_on — one walk, capped so a bad range cannot hang a month grid. */
  const byDay = useMemo(() => {
    const map = new Map()
    for (const e of filtered) {
      const until = e.ends_on && e.ends_on > e.date ? e.ends_on : e.date
      let iso = e.date
      let guard = 0
      while (iso <= until && guard < 62) {
        if (!map.has(iso)) map.set(iso, [])
        map.get(iso).push(e)
        const d = parseISO(iso)
        d.setDate(d.getDate() + 1)
        iso = isoLocal(d)
        guard += 1
      }
    }
    return map
  }, [filtered])

  const activeSession = sessions.find((s) => s.is_active) || null
  const nextHoliday = list.filter((e) => e.kind === 'holiday' && (e.ends_on || e.date) >= todayIso).sort((a, b) => a.date.localeCompare(b.date))[0]
  const nextExam = list.filter((e) => e.kind === 'exam' && (e.ends_on || e.date) >= todayIso).sort((a, b) => a.date.localeCompare(b.date))[0]
  const termLabel = activeSession ? `in ${activeSession.name}` : 'in the next 90 days'
  const termEnd = isoLocal(new Date(parseISO(todayIso).getTime() + 90 * 86400000))
  const termCount = list.filter((e) =>
    activeSession
      ? e.date >= String(activeSession.start_date).slice(0, 10) && e.date <= String(activeSession.end_date).slice(0, 10)
      : e.date >= todayIso && e.date <= termEnd,
  ).length

  const openAdd = (date) => {
    setTouched({})
    setForm({ id: null, title: '', date, kind: 'event', note: '', ends_on: '' })
  }
  const openEdit = (e) => {
    setTouched({})
    setForm({ ...e })
  }

  const rangeConflict = Boolean(form?.ends_on && ISO_RE.test(form.ends_on) && form.ends_on < form.date)
  const canSave = Boolean(form && form.title.trim() && ISO_RE.test(form.date) && !rangeConflict && !busy)

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    try {
      await db.saveCalendarEvent({
        id: form.id || undefined,
        date: form.date,
        title: form.title.trim(),
        kind: form.kind,
        note: form.note.trim(),
        ends_on: form.ends_on || null,
      })
      await refresh()
      setForm(null)
      pushToast({
        tone: 'success',
        title: form.id ? 'Calendar entry updated' : `${KIND_META[form.kind].label} added`,
        message: `${form.title.trim()} — ${fmtDay(form.date)}${form.ends_on ? ` → ${fmtDay(form.ends_on)}` : ''}. Every portal now reads it from the calendar table.`,
      })
    } catch (err) {
      pushToast({ tone: 'error', title: 'Could not save the entry', message: err.message })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const e = confirmDel
    setConfirmDel(null)
    try {
      await db.deleteCalendarEvent(e.id)
      await refresh()
      pushToast({ tone: 'warning', title: 'Entry removed', message: `“${e.title}” is off the academic calendar.` })
    } catch (err) {
      pushToast({ tone: 'error', title: 'Could not delete the entry', message: err.message })
    }
  }

  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
  const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7
  const monthLabel = new Date(view.y, view.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const shiftMonth = (delta) => {
    const d = new Date(view.y, view.m + delta, 1)
    setView({ y: d.getFullYear(), m: d.getMonth() })
  }
  const jumpToday = () => {
    const d = new Date(now || Date.now())
    setView({ y: d.getFullYear(), m: d.getMonth() })
  }

  const groups = useMemo(() => {
    const sorted = [...filtered].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
    const map = new Map()
    for (const e of sorted) {
      const d = parseISO(e.date)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      if (!map.has(key)) map.set(key, { label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), rows: [] })
      map.get(key).rows.push(e)
    }
    return [...map.values()]
  }, [filtered])

  const upcoming = groups.flatMap((g) => g.rows).filter((e) => (e.ends_on || e.date) >= todayIso)

  const filterItems = [
    { id: 'all', label: `all kinds · ${list.length}` },
    ...KIND_ORDER.map((k) => ({ id: k, label: `${KIND_META[k].label.toLowerCase()} · ${countsByKind[k] || 0}` })),
  ]

  return (
    <>
      <PageHeader
        eyebrow="Academics · calendar"
        title="Academic calendar"
        sub="Holidays, exams and school events in one register. The month grid marks what the school commits to on each day; the entries below are what the portals read."
        breadcrumbs={[{ label: 'Home', to: '/admin' }, { label: 'Academics' }, { label: 'Academic Calendar' }]}
        actions={
          <>
            <Button icon={RefreshCw} onClick={refresh}>
              Reload
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => openAdd(todayIso)}>
              New entry
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <NextUpCard label="Next holiday" event={nextHoliday} todayIso={todayIso} emptyHint="No holiday is due" tone="danger" />
        <NextUpCard label="Next exam" event={nextExam} todayIso={todayIso} emptyHint="No exam block scheduled" tone="warning" />
        <div data-tone={activeSession ? 'brand' : 'neutral'} className="card p-4 flex flex-col gap-1.5 min-w-0">
          <p className="field-label mb-0">Events {termLabel}</p>
          <p className="num text-2xl font-extrabold t1 leading-none mt-1.5">{events ? termCount : '—'}</p>
          <p className="meta">
            {upcoming.length} {upcoming.length === 1 ? 'entry remains' : 'entries remain'} from today
            {activeSession ? '' : ' · no active session, so the next quarter is used'}
          </p>
        </div>
      </div>

      <div className="card px-4 py-3 mb-4 flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter entries by kind">
          {filterItems.map((it) => {
            const on = filter === it.id
            const tone = it.id === 'all' ? 'brand' : KIND_META[it.id].tone
            return (
              <button
                key={it.id}
                type="button"
                aria-pressed={on}
                data-tone={tone}
                onClick={() => setFilter(on ? 'all' : it.id)}
                className={cx(
                  'chip cursor-pointer transition-colors',
                  on ? '!bg-[color:var(--tone)] !border-[color:var(--tone)] text-white' : 'hover:border-[color:var(--tone-line)]',
                )}
              >
                {it.id !== 'all' && <span className="dot" aria-hidden />}
                {it.label}
              </button>
            )
          })}
        </div>
        <span className="meta ml-auto hidden sm:block">Legend: kind colours match the day grid and the entry list.</span>
      </div>

      {error ? (
        <div className="card p-5 mb-4">
          <Alert tone="danger" title="Could not read the calendar" icon={CalendarDays}>
            {error}
            <div className="mt-2">
              <Button size="sm" icon={RefreshCw} onClick={refresh}>
                Try again
              </Button>
            </div>
          </Alert>
        </div>
      ) : !events ? (
        <SkeletonRows rows={6} className="max-w-2xl" />
      ) : (
        <>
          <section aria-label="Month grid" className="card p-5 mb-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="display text-lg font-bold">{monthLabel}</h2>
              <div className="flex items-center gap-1.5">
                <IconButton label="Previous month" icon={ChevronLeft} size="sm" onClick={() => shiftMonth(-1)} />
                <Button size="sm" onClick={jumpToday}>
                  Today
                </Button>
                <IconButton label="Next month" icon={ChevronRight} size="sm" onClick={() => shiftMonth(1)} />
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-1" role="presentation">
              {WEEK.map((w) => (
                <div key={w} className="eyebrow text-center">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: lead }, (_, i) => (
                <div key={`blank-${i}`} aria-hidden />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const iso = `${view.y}-${pad(view.m + 1)}-${pad(i + 1)}`
                const entries = byDay.get(iso) || []
                const isToday = iso === todayIso
                return (
                  <div
                    key={iso}
                    data-tone={isToday ? 'brand' : 'neutral'}
                    className={cx(
                      'well min-w-0 min-h-[76px] flex flex-col gap-1 p-1.5 transition-colors',
                      isToday && '!bg-[color:var(--tone-soft)] !border-[color:var(--tone-line)]',
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={cx('num text-2xs tabular-nums', isToday ? 'font-extrabold text-[color:var(--tone-ink)]' : 't3')}>
                        {i + 1}
                      </span>
                      <IconButton
                        label={`Add an entry on ${fmtDay(iso)}`}
                        icon={Plus}
                        size="sm"
                        className="!w-6 !h-6 opacity-50 hover:opacity-100"
                        onClick={() => openAdd(iso)}
                      />
                    </div>
                    <ul className="m-0 p-0 list-none flex flex-col gap-0.5 min-w-0">
                      {entries.slice(0, 3).map((e, j) => (
                        <li key={`${e.id}-${j}`} className="min-w-0">
                          <button
                            type="button"
                            data-tone={KIND_META[e.kind].tone}
                            onClick={() => openEdit(e)}
                            title={`${KIND_META[e.kind].label} · ${e.title}`}
                            aria-label={`Edit ${KIND_META[e.kind].label} “${e.title}” on ${fmtDay(iso)}`}
                            className="w-full flex items-center gap-1.5 rounded-md px-1 py-0.5 text-2xs text-left hover:bg-[color:var(--tone-soft)] transition-colors"
                          >
                            <span className="dot !w-1.5 !h-1.5 shrink-0" aria-hidden />
                            <span className="truncate t1 font-medium">{e.title}</span>
                          </button>
                        </li>
                      ))}
                      {entries.length > 3 ? <li className="meta pl-1">+{entries.length - 3} more</li> : null}
                    </ul>
                  </div>
                )
              })}
            </div>
            <p className="meta mt-3">Use the plus on any day to add an entry, or click a marked entry to edit it.</p>
          </section>

          {!filtered.length ? (
            <EmptyState
              icon={CalendarDays}
              title={filter === 'all' ? 'The calendar is empty' : `No ${KIND_META[filter].label.toLowerCase()} entries yet`}
              hint={
                filter === 'all'
                  ? 'Add the year’s holidays, exam blocks and school events so every portal reads them from the same register.'
                  : 'Nothing of this kind is scheduled. Clear the filter to see the rest of the calendar.'
              }
              action={
                filter === 'all' ? (
                  <Button variant="primary" icon={Plus} onClick={() => openAdd(todayIso)}>
                    Add the first entry
                  </Button>
                ) : (
                  <Button onClick={() => setFilter('all')}>Clear filter</Button>
                )
              }
            />
          ) : (
            <section aria-label="All calendar entries" className="card p-5">
              <SectionTitle
                title="All entries, in date order"
                sub="Past entries stay — the calendar is the school’s record, not just its plan."
                right={<Chip tone="neutral">{filtered.length} shown</Chip>}
              />
              <div className="flex flex-col gap-5">
                {groups.map((g) => (
                  <div key={g.label} className="min-w-0">
                    <p className="eyebrow mb-1.5">{g.label}</p>
                    <ul className="m-0 p-0 list-none">
                      {g.rows.map((e) => {
                        const past = (e.ends_on || e.date) < todayIso
                        return (
                          <li
                            key={`${e.id}${e.date}`}
                            className={cx(
                              'flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[color:var(--color-line-soft)] last:border-0 py-2.5 min-w-0',
                              past && 'opacity-60',
                            )}
                          >
                            <span className="font-mono text-2xs t3 w-[104px] shrink-0 tabular-nums">
                              {e.date === e.ends_on || !e.ends_on ? fmtDay(e.date) : `${fmtDate(parseISO(e.date)).slice(0, 6)} → ${fmtDay(e.ends_on)}`}
                            </span>
                            <Chip tone={KIND_META[e.kind].tone} dot className="shrink-0">
                              {KIND_META[e.kind].label}
                            </Chip>
                            <span className="text-sm font-semibold t1 truncate max-w-[260px]">{e.title}</span>
                            {e.note ? <span className="meta truncate max-w-[220px] hidden md:inline">{e.note}</span> : null}
                            <span className="ml-auto flex items-center gap-1 shrink-0">
                              <Button size="sm" variant="ghost" icon={Pencil} onClick={() => openEdit(e)}>
                                Edit
                              </Button>
                              <Button size="sm" variant="ghost" icon={Trash2} tone="danger" onClick={() => setConfirmDel(e)}>
                                Delete
                              </Button>
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <Modal
        open={Boolean(form)}
        onClose={() => setForm(null)}
        icon={CalendarDays}
        tone={form ? KIND_META[form.kind].tone : 'brand'}
        title={form?.id ? `Edit “${form.title}”` : 'New calendar entry'}
        sub="Entries land in the shared calendar table the portals read — holidays block attendance, exam blocks frame the report cards."
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" icon={BadgeCheck} onClick={save} disabled={!canSave} loading={busy}>
              {form?.id ? 'Save changes' : 'Add to calendar'}
            </Button>
          </>
        }
      >
        {form ? (
          <div className="flex flex-col gap-4">
            <Field
              label="Title"
              htmlFor="cal-title"
              required
              error={touched.title && !form.title.trim() ? 'A short title is required — it appears on every portal.' : undefined}
            >
              <Input
                id="cal-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, title: true }))}
                placeholder="Mid-term examinations"
                invalid={Boolean(touched.title && !form.title.trim())}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Starts" htmlFor="cal-date" required error={touched.date && !ISO_RE.test(form.date) ? 'Pick the start date.' : undefined}>
                <Input
                  id="cal-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, date: true }))}
                  invalid={Boolean(touched.date && !ISO_RE.test(form.date))}
                />
              </Field>
              <Field label="Kind" htmlFor="cal-kind">
                <Select id="cal-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  {KIND_ORDER.map((k) => (
                    <option key={k} value={k}>
                      {KIND_META[k].label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Ends on" htmlFor="cal-ends" hint="Optional — leave empty for a single day. Used for exam blocks and holiday breaks.">
              <Input id="cal-ends" type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} />
            </Field>
            <Field label="Note" htmlFor="cal-note" hint="Shown to staff alongside the entry; keep it short.">
              <Textarea id="cal-note" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Syllabus: units 1–5" />
            </Field>
            {rangeConflict ? (
              <Alert tone="danger" title="The end date falls before the start">
                A multi-day entry must end on {fmtDay(form.date)} or later. Clear “Ends on” or move it forward.
              </Alert>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmDel)}
        onClose={() => setConfirmDel(null)}
        onConfirm={remove}
        tone="danger"
        confirmLabel="Delete entry"
        title={confirmDel ? `Delete “${confirmDel.title}”?` : 'Delete this entry?'}
        body={
          confirmDel ? (
            <span>
              {confirmDel.title} ({KIND_META[confirmDel.kind].label.toLowerCase()}, {fmtDay(confirmDel.date)}
              {confirmDel.ends_on ? ` → ${fmtDay(confirmDel.ends_on)}` : ''}) disappears from the academic calendar for every portal. This
              cannot be undone from this screen.
            </span>
          ) : (
            ''
          )
        }
      />
    </>
  )
}

function NextUpCard({ label, event, todayIso, emptyHint, tone }) {
  if (!event) {
    return (
      <div data-tone="neutral" className="card p-4 flex flex-col gap-1.5 min-w-0">
        <p className="field-label mb-0">{label}</p>
        <p className="display text-md font-bold t3 mt-1">—</p>
        <p className="meta">{emptyHint}</p>
      </div>
    )
  }
  const ongoing = event.date < todayIso && event.ends_on >= todayIso
  const days = Math.round((parseISO(event.date).getTime() - parseISO(todayIso).getTime()) / 86400000)
  return (
    <div data-tone={tone} className="card p-4 flex flex-col gap-1.5 min-w-0">
      <p className="field-label mb-0">{label}</p>
      <p className="display text-md font-bold t1 mt-1 truncate">{event.title}</p>
      <p className="meta tabular-nums">
        <span className="font-bold text-[color:var(--tone-ink)]">
          {ongoing ? 'in progress · ' : days === 0 ? 'today · ' : `in ${days} ${days === 1 ? 'day' : 'days'} · `}
        </span>
        {fmtDay(event.date)}
        {event.ends_on && event.ends_on !== event.date ? ` → ${fmtDay(event.ends_on)}` : ''}
      </p>
    </div>
  )
}

export default CalendarPage
