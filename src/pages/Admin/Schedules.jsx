import { Fragment, useMemo, useState } from 'react'
import {
  CalendarClock,
  Check,
  Clock4,
  Copy,
  DoorOpen,
  MoreVertical,
  Plus,
  Power,
  Save,
  Trash2,
} from 'lucide-react'
import { db } from '../../lib/supabase'
import { useApp } from '../../context/AppContext'
import { useSchoolData } from '../../hooks/useSchool'
import {
  DAYS,
  EARLY_YEARS,
  fmtClock,
  interludesFor,
  to12h,
  toMinutes,
  validatePeriods,
  weekCapacity,
} from '../../lib/bellSchedule'
import {
  Alert,
  Button,
  Chip,
  ConfirmDialog,
  Dropdown,
  EmptyState,
  Field,
  IconButton,
  Input,
  MenuItem,
  Modal,
  PageHeader,
  SectionTitle,
  Select,
  SkeletonRows,
  cx,
} from '../../components/ui/primitives'

/* ------------------------------------------------------------------ meta */

const SEASONS = ['regular', 'summer', 'winter', 'exam']

const BANDS = {
  all: { label: 'Whole school', tone: 'brand', hint: 'Every class follows this day.' },
  senior: { label: 'Senior · classes 11–12', tone: 'accent', hint: 'The shorter senior day.' },
  junior: { label: 'Junior · classes 1–10', tone: 'sky', hint: 'The junior school day.' },
  early: { label: 'Early years', tone: 'rose', hint: `The short wing day: ${EARLY_YEARS.join(' · ')}.` },
}
const BAND_ORDER = ['early', 'junior', 'senior', 'all']
const bandOf = (key) => BANDS[key] || { label: key || 'unassigned', tone: 'neutral', hint: 'Applies to an unrecognised group.' }

const blankPeriod = (n, startMin = 540) => ({
  n,
  label: n === 0 ? '0' : `P${n}`,
  start: fmtClock(startMin),
  end: fmtClock(startMin + 40),
})

/* ------------------------------------------------------------------ list row */

function ScheduleRow({ s, selected, onEdit, onClone, onActivate }) {
  const band = bandOf(s.applies_to)
  const first = s.periods?.[0]
  const last = s.periods?.[s.periods.length - 1]
  return (
    <div
      data-tone={band.tone}
      className={cx(
        'card-flat flex items-stretch gap-1 transition-colors',
        selected && 'bg-[color:var(--tone-soft)] border-[color:var(--tone-line)]',
      )}
    >
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left px-3 py-2.5 cursor-pointer">
        <span className="flex items-start justify-between gap-2">
          <span className="block text-sm font-semibold t1 truncate">{s.name}</span>
          {s.is_active ? (
            <Chip tone="success" dot>
              live
            </Chip>
          ) : (
            <Chip tone="neutral">{s.status || 'draft'}</Chip>
          )}
        </span>
        <span className="block font-mono text-2xs t3 mt-1 tabular-nums">
          {first ? `${first.start} – ${last?.end}` : 'no periods'}
          {s.departure ? ` · out ${s.departure}` : ''}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 mt-2">
          <Chip tone={band.tone}>{band.label.split(' · ')[0]}</Chip>
          <Chip tone={s.season === 'winter' ? 'info' : s.season === 'summer' ? 'warning' : 'neutral'}>{s.season}</Chip>
          <span className="num text-2xs t3 tabular-nums ml-auto">
            {s.periods?.length || 0} pd · from {s.effective_from || '—'}
          </span>
        </span>
      </button>
      <div className="flex items-center pr-1">
        <Dropdown
          label={`Actions for ${s.name}`}
          trigger={<MoreVertical size={16} />}
        >
          {({ close }) => (
            <>
              <MenuItem
                icon={CalendarClock}
                onClick={() => {
                  onEdit()
                  close()
                }}
              >
                Edit timings
              </MenuItem>
              <MenuItem
                icon={Copy}
                onClick={() => {
                  onClone()
                  close()
                }}
              >
                Duplicate for a season
              </MenuItem>
              <MenuItem
                icon={Power}
                disabled={Boolean(s.is_active)}
                onClick={() => {
                  onActivate()
                  close()
                }}
              >
                {s.is_active ? 'Already active' : 'Activate'}
              </MenuItem>
            </>
          )}
        </Dropdown>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ page */

export default function BellSchedulesPage() {
  const { schedules, loading, reload } = useSchoolData()
  const { settings, pushToast } = useApp()
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirmActivate, setConfirmActivate] = useState(null)
  const [cloneSrc, setCloneSrc] = useState(null)
  const [clone, setClone] = useState({ name: '', season: 'winter', effective_from: '' })
  const [newOpen, setNewOpen] = useState(false)
  const [newsch, setNewsch] = useState({ name: '', applies_to: 'junior', season: 'regular', effective_from: '' })

  const selected = schedules.find((s) => s.id === selectedId) || null

  /* Keep the draft in sync with the loaded row — derived-state-during-render,
     so a save/reload never leaves stale period times in the editor. */
  const signature = selected ? `${selected.id}|${JSON.stringify(selected.periods)}` : ''
  const [sig, setSig] = useState('')
  if (signature !== sig) {
    setSig(signature)
    if (selected) setDraft({ ...selected, periods: (selected.periods || []).map((p) => ({ ...p })) })
    else setDraft(null)
  }

  const errors = useMemo(() => (draft ? validatePeriods(draft.periods) : []), [draft])

  const grouped = useMemo(() => {
    const map = new Map()
    for (const s of schedules) {
      const key = s.applies_to || 'all'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(s)
    }
    const keys = [...map.keys()].sort((a, b) => {
      const ia = BAND_ORDER.indexOf(a)
      const ib = BAND_ORDER.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
    })
    return keys.map((k) => ({ band: k, meta: bandOf(k), rows: map.get(k) }))
  }, [schedules])

  const setPeriod = (i, patch) =>
    setDraft((d) => ({ ...d, periods: d.periods.map((p, j) => (i === j ? { ...p, ...patch } : p)) }))

  const addRow = () =>
    setDraft((d) => {
      const next = (d.periods.at(-1)?.n ?? -1) + 1
      const startMin = toMinutes(d.periods.at(-1)?.end || '08:00')
      return {
        ...d,
        periods: [...d.periods, blankPeriod(next, startMin)],
      }
    })

  const removeRow = (i) => setDraft((d) => ({ ...d, periods: d.periods.filter((_, j) => j !== i) }))

  const focusNamed = async (name) => {
    const all = await db.listSchedules()
    const made = all
      .filter((s) => s.name === name)
      .sort((a, b) => String(b.effective_from || '').localeCompare(String(a.effective_from || '')))[0]
    if (made) setSelectedId(made.id)
  }

  const save = async () => {
    if (errors.length) return
    setBusy(true)
    try {
      await db.saveSchedule({ ...draft, periods: draft.periods })
      await reload()
      pushToast({
        tone: 'success',
        title: 'Timings saved',
        message: `${draft.name} updated — every board and clock now follows it.`,
      })
    } catch (e) {
      pushToast({ tone: 'error', title: 'Not saved', message: e.message })
    } finally {
      setBusy(false)
    }
  }

  const activate = async () => {
    setBusy(true)
    try {
      await db.activateSchedule(confirmActivate.id)
      await reload()
      pushToast({
        tone: 'warning',
        title: `${confirmActivate.name} is now live`,
        message: `Boards for ${bandOf(confirmActivate.applies_to).label} classes switched to these timings.`,
      })
    } catch (e) {
      pushToast({ tone: 'error', title: 'Could not activate', message: e.message })
    } finally {
      setBusy(false)
      setConfirmActivate(null)
    }
  }

  const openClone = (s) => {
    setCloneSrc(s)
    setClone({ name: `${s.name} · ${s.season === 'winter' ? 'Summer' : 'Winter'}`, season: s.season === 'winter' ? 'summer' : 'winter', effective_from: '' })
  }

  const doClone = async () => {
    if (!clone.name.trim() || !clone.effective_from || busy) return
    setBusy(true)
    try {
      await db.cloneSchedule(cloneSrc.id, { ...clone, name: clone.name.trim() })
      await reload()
      await focusNamed(clone.name.trim())
      setCloneSrc(null)
      pushToast({ tone: 'success', title: 'Draft copy created', message: 'Edit the times, then activate it when the season starts.' })
    } catch (e) {
      pushToast({ tone: 'error', title: 'Could not duplicate', message: e.message })
    } finally {
      setBusy(false)
    }
  }

  const createSchedule = async () => {
    if (!newsch.name.trim() || !newsch.effective_from || busy) return
    setBusy(true)
    const name = newsch.name.trim()
    try {
      await db.saveSchedule({
        name,
        applies_to: newsch.applies_to,
        season: newsch.season,
        effective_from: newsch.effective_from,
        is_active: false,
        status: 'upcoming',
        periods: Array.from({ length: 6 }, (_, i) => blankPeriod(i + 1, 540 + i * 40)),
      })
      await reload()
      await focusNamed(name)
      setNewOpen(false)
      pushToast({ tone: 'success', title: 'Schedule created', message: `${name} starts as a draft with six starter periods.` })
    } catch (e) {
      pushToast({ tone: 'error', title: 'Could not create', message: e.message })
    } finally {
      setBusy(false)
    }
  }

  const gaps = draft ? interludesFor(draft.periods) : []

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Bell timings"
        sub="Each class group runs its own day, and each day has seasonal variants. Edit the times here — nothing about the school’s schedule is fixed in code."
        breadcrumbs={[{ label: 'Command Center', to: '/admin' }, { label: 'Configuration' }, { label: 'Bell Timings' }]}
        actions={
          <>
            <Button icon={Plus} onClick={() => setNewOpen(true)}>
              New schedule
            </Button>
            {draft ? (
              <>
                <Button icon={Copy} onClick={() => openClone(selected)}>
                  Duplicate for another season
                </Button>
                {!selected?.is_active ? (
                  <Button variant="tone" tone="accent" icon={Power} onClick={() => setConfirmActivate(selected)}>
                    Activate
                  </Button>
                ) : null}
                <Button
                  variant="primary"
                  icon={Save}
                  onClick={save}
                  disabled={Boolean(errors.length) || busy}
                  title={errors.length ? errors[0] : undefined}
                >
                  {busy ? 'Saving…' : 'Save timings'}
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {loading ? (
        <SkeletonRows rows={6} className="max-w-xl" />
      ) : !schedules.length ? (
        <EmptyState
          icon={Clock4}
          title="No bell schedules yet"
          hint="Add the school’s period times for each class group before building a timetable."
          action={
            <Button variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>
              Create the first schedule
            </Button>
          }
        />
      ) : (
        <div className="grid lg:grid-cols-[300px_minmax(0,1fr)] gap-4 items-start">
          <nav aria-label="Bell schedules by class band" className="card p-3.5 flex flex-col gap-4">
            {grouped.map((g) => (
              <div key={g.band}>
                <p className="field-label mb-2">{g.meta.label}</p>
                <div className="flex flex-col gap-1.5">
                  {g.rows.length ? (
                    g.rows.map((s) => (
                      <ScheduleRow
                        key={s.id}
                        s={s}
                        selected={s.id === selectedId}
                        onEdit={() => setSelectedId(s.id)}
                        onClone={() => openClone(s)}
                        onActivate={() => setConfirmActivate(s)}
                      />
                    ))
                  ) : (
                    <p className="text-2xs t3 px-1">None yet.</p>
                  )}
                </div>
              </div>
            ))}
          </nav>

          {draft ? (
            <div className="card p-5 rise min-w-0">
              <SectionTitle
                title={draft.name}
                sub={`${draft.periods.length} periods · first bell ${to12h(draft.periods[0]?.start || '08:00')} · ${gaps.length} break${
                  gaps.length === 1 ? '' : 's'
                } detected automatically from the gaps`}
                right={
                  <>
                    <Chip tone={bandOf(draft.applies_to).tone} dot>
                      {bandOf(draft.applies_to).label}
                    </Chip>
                    <Chip tone={draft.is_active ? 'success' : 'neutral'} dot={draft.is_active}>
                      {draft.is_active ? 'live now' : draft.status || 'draft'}
                    </Chip>
                  </>
                }
              />

              <p className="meta mb-4">
                {weekCapacity(draft.periods)} timetable slots a week ({DAYS.length} working days × {draft.periods.length} periods) ·{' '}
                {bandOf(draft.applies_to).hint}
              </p>

              {errors.length ? (
                <div className="mb-3">
                  <Alert tone="danger" title="Fix these before saving">
                    <ul className="m-0 p-0 pl-4 list-disc">
                      {errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </Alert>
                </div>
              ) : null}

              <div className="tbl-wrap">
                <table className="tbl">
                  <caption className="sr-only">Editable period timings for {draft.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Number</th>
                      <th scope="col">Label</th>
                      <th scope="col">Starts</th>
                      <th scope="col">Ends</th>
                      <th scope="col">Length</th>
                      <th scope="col" className="text-right">
                        <span className="sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.periods.map((p, i) => {
                      const prev = draft.periods[i - 1]
                      const gap = prev ? toMinutes(p.start) - toMinutes(prev.end) : 0
                      const isBreak = gap >= 12
                      const mins = toMinutes(p.end) - toMinutes(p.start)
                      return (
                        <Fragment key={`${p.n}-${i}`}>
                          {isBreak ? (
                            <tr>
                              <td colSpan={6} className="p-1.5">
                                <div className="interlude">
                                  <span>{gap >= 40 ? 'Lunch' : 'Break'}</span>
                                  <span className="h-px flex-1 bg-[color:var(--color-line)]" />
                                  <span className="num tabular-nums normal-case tracking-normal">
                                    {prev.end} → {p.start} · {gap} min
                                  </span>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                          <tr>
                            <td>
                              <Input
                                type="number"
                                aria-label={`Period number for ${p.label}`}
                                value={p.n}
                                onChange={(e) => setPeriod(i, { n: Number(e.target.value) })}
                                style={{ minHeight: 0, height: 36, width: 68 }}
                                className="font-mono tabular-nums !text-xs"
                              />
                            </td>
                            <td>
                              <Input
                                aria-label={`Label for period ${p.n}`}
                                value={p.label}
                                onChange={(e) => setPeriod(i, { label: e.target.value })}
                                style={{ minHeight: 0, height: 36, width: 90 }}
                                className="!text-xs"
                              />
                            </td>
                            <td>
                              <Input
                                type="time"
                                aria-label={`Start time for ${p.label}`}
                                value={p.start}
                                onChange={(e) => setPeriod(i, { start: e.target.value })}
                                style={{ minHeight: 0, height: 36, width: 118 }}
                                className="font-mono tabular-nums !text-xs"
                              />
                            </td>
                            <td>
                              <Input
                                type="time"
                                aria-label={`End time for ${p.label}`}
                                value={p.end}
                                onChange={(e) => setPeriod(i, { end: e.target.value })}
                                style={{ minHeight: 0, height: 36, width: 118 }}
                                className="font-mono tabular-nums !text-xs"
                              />
                            </td>
                            <td>
                              <span className="num text-xs t2 tabular-nums">{mins > 0 ? `${mins} min` : '—'}</span>
                              <span className="block meta">{to12h(p.start)}</span>
                            </td>
                            <td className="text-right">
                              <IconButton label={`Remove ${p.label}`} icon={Trash2} size="sm" tone="danger" onClick={() => removeRow(i)} />
                            </td>
                          </tr>
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-end gap-3 mt-4">
                <Button icon={Plus} onClick={addRow}>
                  Add period
                </Button>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 ml-auto w-full sm:w-auto">
                  <Field label="Applies to" htmlFor="sch-band">
                    <Select id="sch-band" value={draft.applies_to || 'all'} onChange={(e) => setDraft({ ...draft, applies_to: e.target.value })}>
                      {BAND_ORDER.map((b) => (
                        <option key={b} value={b}>
                          {BANDS[b].label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Season" htmlFor="sch-season">
                    <Select id="sch-season" value={draft.season || 'regular'} onChange={(e) => setDraft({ ...draft, season: e.target.value })}>
                      {SEASONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Departure" htmlFor="sch-departure" hint="Bus bell, optional">
                    <Input id="sch-departure" type="time" value={draft.departure || ''} onChange={(e) => setDraft({ ...draft, departure: e.target.value })} />
                  </Field>
                  <Field label="Effective from" htmlFor="sch-effective">
                    <Input id="sch-effective" type="date" value={draft.effective_from || ''} onChange={(e) => setDraft({ ...draft, effective_from: e.target.value })} />
                  </Field>
                </div>
              </div>

              <p className="text-2xs t3 mt-4 leading-relaxed flex items-start gap-2">
                <DoorOpen size={14} className="shrink-0 mt-0.5" aria-hidden />
                Breaks are read from the gaps between periods, not configured separately — lengthen a gap and the board shows the break row on
                its own. {settings?.timezone ? `Clocks run on ${settings.timezone}.` : ''}
              </p>
            </div>
          ) : (
            <EmptyState icon={CalendarClock} title="Pick a schedule to edit" hint="Choose one on the left, or create a new bell schedule for a class band." className="card" />
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmActivate)}
        onClose={() => setConfirmActivate(null)}
        onConfirm={activate}
        busy={busy}
        tone="brand"
        title={`Switch ${bandOf(confirmActivate?.applies_to).label} classes to these timings?`}
        body={
          <>
            <strong>{confirmActivate?.name}</strong> becomes the live schedule for that group and the previous one is archived. Existing
            timetable rows keep their period numbers — only the clock times change.
          </>
        }
        confirmLabel="Activate timings"
      />

      <Modal
        open={Boolean(cloneSrc)}
        onClose={() => setCloneSrc(null)}
        title={`Copy “${cloneSrc?.name || ''}” to a new season`}
        sub="Starts as a draft with the same periods, so you only change what the season moves."
        icon={Copy}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCloneSrc(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" icon={Check} onClick={doClone} loading={busy} disabled={!clone.name.trim() || !clone.effective_from}>
              Create draft copy
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Name" htmlFor="clone-name" required hint="Give it a name that says what it replaces.">
            <Input id="clone-name" value={clone.name} onChange={(e) => setClone({ ...clone, name: e.target.value })} placeholder="Classes 1–10 · Winter" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Season" htmlFor="clone-season">
              <Select id="clone-season" value={clone.season} onChange={(e) => setClone({ ...clone, season: e.target.value })}>
                {SEASONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Starts on" htmlFor="clone-date" required>
              <Input id="clone-date" type="date" value={clone.effective_from} onChange={(e) => setClone({ ...clone, effective_from: e.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New bell schedule"
        sub="Starts as a draft with six starter periods — edit the times, then activate when the day is right."
        icon={Plus}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" icon={Check} onClick={createSchedule} loading={busy} disabled={!newsch.name.trim() || !newsch.effective_from}>
              Create schedule
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Name" htmlFor="new-name" required hint="e.g. Senior school · Winter">
            <Input id="new-name" value={newsch.name} onChange={(e) => setNewsch({ ...newsch, name: e.target.value })} placeholder="Junior school · Regular" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Applies to" htmlFor="new-band" hint={bandOf(newsch.applies_to).hint}>
              <Select id="new-band" value={newsch.applies_to} onChange={(e) => setNewsch({ ...newsch, applies_to: e.target.value })}>
                {BAND_ORDER.map((b) => (
                  <option key={b} value={b}>
                    {BANDS[b].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Season" htmlFor="new-season">
              <Select id="new-season" value={newsch.season} onChange={(e) => setNewsch({ ...newsch, season: e.target.value })}>
                {SEASONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Effective from" htmlFor="new-date" required>
            <Input id="new-date" type="date" value={newsch.effective_from} onChange={(e) => setNewsch({ ...newsch, effective_from: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </>
  )
}
