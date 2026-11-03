import { createContext, useContext, useMemo, useState } from 'react'
import { Outlet } from 'react-router-dom'
import {
  ArrowRightLeft,
  BookOpenText,
  CalendarClock,
  CheckCircle2,
  Clock4,
  DoorOpen,
  GraduationCap,
  Save,
  ShieldCheck,
  TriangleAlert,
  Users,
} from 'lucide-react'
import AppShell from '../components/shell/AppShell'
import { LiveRail, TimetableBoard } from '../components/timetable/Board'
import { db } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useSchool } from '../hooks/useSchool'
import { DAYS, currentPeriodIndex, periodAt, periodsFor, weekCapacity } from '../lib/bellSchedule'
import { roomShort, subjectShort, subjectTone } from '../lib/subjects'
import { firstName } from '../lib/names'
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHead,
  Chip,
  Drawer,
  EmptyState,
  Field,
  KeyValue,
  PageHeader,
  SectionTitle,
  Segmented,
  SkeletonRows,
  Stat,
  Textarea,
} from '../components/ui/primitives'

const isMine = (slot, p) =>
  p && (String(slot.teacher_id) === String(p.id) || (Boolean(p.full_name) && slot.teacher_name === p.full_name))
const isMySub = (slot, p) => Boolean(p?.full_name) && slot.is_substitution && slot.substitute_teacher_name === p.full_name

const TeacherCtx = createContext(null)
export const useTeacher = () => useContext(TeacherCtx)

export function TeacherLayout() {
  const { profile } = useApp()
  const school = useSchool()
  const mine = useMemo(() => school.slots.filter((s) => isMine(s, profile) || isMySub(s, profile)), [school.slots, profile])
  const classes = useMemo(() => [...new Set(mine.map((s) => s.class_section))].sort(), [mine])

  return (
    <TeacherCtx.Provider value={{ ...school, mine, classes }}>
      <AppShell role="teacher">
        <Outlet />
      </AppShell>
    </TeacherCtx.Provider>
  )
}

/* --------------------------------------------------------------- overview -- */

export function TeacherOverview() {
  const { profile, now, todayName, simulating } = useApp()
  const { mine, loading } = useTeacher()
  const livePeriod = currentPeriodIndex(now)
  const periods = periodsFor(profile?.subject ? null : null)

  const subsToday = mine.filter((s) => isMySub(s, profile) && s.day === todayName)
  const today = mine.filter((s) => s.day === todayName).sort((a, b) => Number(a.period) - Number(b.period))
  const next = today.find((s) => Number(s.period) > livePeriod)

  return (
    <div className="flex flex-col gap-5">
      {subsToday.length ? (
        <Alert tone="accent" icon={ArrowRightLeft} title={`Covering ${subsToday.length} period${subsToday.length > 1 ? 's' : ''} today`}>
          <ul className="list-none m-0 p-0 mt-2 space-y-1.5">
            {subsToday.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="num t2 w-[52px] shrink-0">{periodAt(Number(s.period)).start}</span>
                <Chip tone={subjectTone(s.subject)}>{subjectShort(s.subject)}</Chip>
                <span className="font-bold t1">{s.class_section}</span>
                <span className="meta">{roomShort(s.room) || 'no room'}</span>
                <span className="t2">for {s.teacher_name}</span>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <PageHeader
        eyebrow={`${profile?.subject || 'Faculty'} · ${todayName}`}
        title={`Good day, ${firstName(profile?.full_name) || 'teacher'}`}
        sub="Your own periods, plus anything the office has asked you to cover. Nothing here belongs to another teacher."
        breadcrumbs={[{ label: 'Teacher' }, { label: 'Overview' }]}
        actions={
          <Chip tone={livePeriod >= 0 ? 'success' : 'neutral'} icon={Clock4} dot>
            {livePeriod >= 0 ? `${periodAt(livePeriod).label} in progress` : 'Between bells'}
            {simulating ? ' · simulated' : ''}
          </Chip>
        }
      />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat label="Periods this week" value={mine.length} sub={`${(mine.length / DAYS.length).toFixed(1)} per day`} icon={CalendarClock} tone="brand" />
        <Stat
          label="Today"
          value={today.length}
          sub={next ? `next ${periodAt(Number(next.period)).label} at ${periodAt(Number(next.period)).start}` : 'nothing left today'}
          icon={Clock4}
          tone="accent"
        />
        <Stat
          label="Covering for others"
          value={mine.filter((s) => isMySub(s, profile)).length}
          sub="assigned substitutions"
          icon={ArrowRightLeft}
          tone="warning"
        />
        <Stat label="Classes taught" value={new Set(mine.map((s) => s.class_section)).size} sub={`${new Set(mine.map((s) => s.subject)).size} subjects`} icon={Users} tone="sage" />
      </div>

      <div>
        <SectionTitle eyebrow={simulating ? 'Simulated clock' : 'Live clock'} title="Right now" sub="What is happening this period and what follows it." />
        <LiveRail slots={mine} now={now} periods={periods} />
      </div>

      <Card>
        <CardHead
          title={`Today · ${todayName}`}
          sub={loading ? 'Reading the board…' : `${today.length} period${today.length === 1 ? '' : 's'} on the schedule`}
          icon={CalendarClock}
        />
        <div className="px-4 pb-4">
          {loading ? (
            <SkeletonRows rows={4} />
          ) : today.length === 0 ? (
            <EmptyState icon={CalendarClock} title="No periods today" hint="Your next class is on another day — open My Timetable for the whole week." />
          ) : (
            <ul className="grid sm:grid-cols-2 gap-2 list-none m-0 p-0">
              {today.map((s) => (
                <li key={s.id} data-tone={Number(s.period) === livePeriod ? 'success' : subjectTone(s.subject)}>
                  <div className={`card-flat px-3 py-2.5 flex items-center gap-2.5 min-w-0 ${Number(s.period) === livePeriod ? '!border-[color:var(--tone-line)] bg-[color:var(--tone-soft)]' : ''}`}>
                    <span className="num text-2xs t3 w-[46px] shrink-0">{periodAt(Number(s.period)).start}</span>
                    <Chip tone={subjectTone(s.subject)}>{subjectShort(s.subject)}</Chip>
                    <span className="text-sm font-semibold t1 truncate">{s.class_section}</span>
                    {isMySub(s, profile) ? <ArrowRightLeft size={13} className="text-[color:var(--color-accent-ink)] shrink-0" aria-label="substitute period" /> : null}
                    <span className="meta ml-auto shrink-0">{roomShort(s.room) || '—'}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  )
}

/* -------------------------------------------------------------- timetable -- */

export function TeacherTimetable() {
  const { profile, now, todayName, pushToast } = useApp()
  const { mine, loading, reload, classes } = useTeacher()
  const { open, close, edit, draft, setDraft } = useNoteDrawer()
  const periods = periodsFor(mine[0]?.class_section)

  const save = async () => {
    if (!open) return
    try {
      await db.setHomework(open.id, draft)
      await reload()
      pushToast({
        tone: 'success',
        title: 'Note published',
        message: `${open.class_section} sees it on ${open.day} ${periodAt(Number(open.period)).label}.`,
      })
      close()
    } catch (e) {
      pushToast({ tone: 'error', title: 'Could not save', message: e.message })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="My week"
        title="My timetable"
        sub="Open any period to publish homework or a topic note for that class. Free periods stay empty on purpose."
        breadcrumbs={[{ label: 'Teacher', to: '/teacher' }, { label: 'My Timetable' }]}
        actions={
          classes.length ? (
            <span className="meta">
              {mine.length} of {weekCapacity(periods)} slots filled
            </span>
          ) : null
        }
      />

      {loading ? (
        <SkeletonRows rows={8} />
      ) : mine.length === 0 ? (
        <Card>
          <EmptyState
            icon={ArrowRightLeft}
            title="Nothing is assigned to you yet"
            hint="The office builds the board. Once a period carries your name it appears here."
          />
        </Card>
      ) : (
        <TimetableBoard
          slots={mine}
          mode="teacher"
          periods={periods}
          liveDay={todayName}
          livePeriod={currentPeriodIndex(now)}
          onCellClick={({ slot }) => slot && edit(slot)}
        />
      )}

      <Drawer
        open={Boolean(open)}
        onClose={close}
        title={open ? `${open.subject} · ${open.class_section}` : ''}
        sub={
          open
            ? `${open.day} ${periodAt(Number(open.period)).label} · ${periodAt(Number(open.period)).start}–${periodAt(Number(open.period)).end}${open.room ? ` · ${open.room}` : ''}`
            : ''
        }
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
            <Button variant="primary" icon={Save} onClick={save}>
              Save note
            </Button>
          </>
        }
      >
        {open ? (
          <div className="flex flex-col gap-5">
            {isMySub(open, profile) ? (
              <Alert tone="accent" icon={ArrowRightLeft} title="You are standing in for this period">
                {open.teacher_name} is off. {open.sub_notes || 'The office will confirm the reason.'}
              </Alert>
            ) : null}
            <Field
              label="Homework & topic note"
              htmlFor="teacher-homework-note"
              hint={`Students in ${open.class_section} see this the moment they open the period.`}
            >
              <Textarea
                id="teacher-homework-note"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Complete NCERT Ex 3.2 and bring the lab manual. Next class: numericals from page 74."
              />
            </Field>
            <KeyValue
              rows={[
                ['Room', roomShort(open.room) || 'Not assigned'],
                ['Period', periodAt(Number(open.period)).label],
                ['Time', `${periodAt(Number(open.period)).start}–${periodAt(Number(open.period)).end}`],
              ]}
              cols={3}
            />
          </div>
        ) : null}
      </Drawer>
    </div>
  )
}

/* ----------------------------------------------------------- homework list -- */

export function TeacherHomework() {
  const { mine, loading, reload, pushToast } = useTeacher()
  const { open, close, edit, draft, setDraft } = useNoteDrawer()

  const grouped = useMemo(() => {
    const map = new Map()
    for (const s of mine) {
      if (!map.has(s.subject)) map.set(s.subject, [])
      map.get(s.subject).push(s)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [mine])

  const save = async () => {
    if (!open) return
    await db.setHomework(open.id, draft)
    await reload()
    pushToast({ tone: 'success', title: 'Note saved', message: `${open.class_section} · ${periodAt(Number(open.period)).label}` })
    close()
  }

  const blank = mine.filter((s) => !String(s.homework_note || '').trim()).length

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="My week"
        title="Homework & notes"
        sub="Everything you have published, grouped by subject, with the periods still blank called out."
        breadcrumbs={[{ label: 'Teacher', to: '/teacher' }, { label: 'Homework & Notes' }]}
        actions={
          <Chip tone={blank ? 'warning' : 'success'} icon={TriangleAlert}>
            {blank} of {mine.length} periods have no note
          </Chip>
        }
      />

      {loading ? (
        <SkeletonRows rows={6} />
      ) : grouped.length === 0 ? (
        <Card>
          <EmptyState icon={BookOpenText} title="No periods yet" hint="Notes become available once the office assigns you periods." />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          {grouped.map(([subject, list]) => (
            <Card key={subject}>
              <CardHead
                title={subject}
                sub={`${list.filter((s) => s.homework_note).length} of ${list.length} periods published`}
                right={<Chip tone={subjectTone(subject)}>{subjectShort(subject)}</Chip>}
              />
              <ul className="px-3 pb-3 m-0 list-none space-y-0.5">
                {list
                  .slice()
                  .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || Number(a.period) - Number(b.period))
                  .map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => edit(s)}
                        className="w-full text-left px-3 py-2.5 rounded-[12px] hover:bg-[color:var(--hovered)] transition-colors border-0 bg-transparent cursor-pointer"
                      >
                        <span className="flex items-center gap-2.5 text-sm min-w-0">
                          <span className="num text-2xs t3 shrink-0 w-[74px]">
                            {s.day.slice(0, 3)} · {periodAt(Number(s.period)).label}
                          </span>
                          <span className="font-semibold t1 truncate">{s.class_section}</span>
                          {s.homework_note ? (
                            <CheckCircle2 size={14} className="ml-auto shrink-0 text-[color:var(--color-success-ink)]" aria-label="note published" />
                          ) : (
                            <span className="ml-auto text-2xs t3 shrink-0">no note</span>
                          )}
                        </span>
                        {s.homework_note ? (
                          <span className="block text-xs t2 mt-1.5 leading-relaxed line-clamp-2">{s.homework_note}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <Drawer
        open={Boolean(open)}
        onClose={close}
        title={open ? `${open.subject} · ${open.class_section}` : ''}
        sub={open ? `${open.day} ${periodAt(Number(open.period)).label}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" icon={Save} onClick={save}>
              Save note
            </Button>
          </>
        }
      >
        <Field label="Homework & topic note" htmlFor="hw-note">
          <Textarea
            id="hw-note"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What the class should do before the next period"
          />
        </Field>
      </Drawer>
    </div>
  )
}

/* ----------------------------------------------------------- substitutions -- */

export function TeacherSubstitutions() {
  const { profile, todayName } = useApp()
  const { mine } = useTeacher()
  const subs = mine.filter((s) => isMySub(s, profile))
  const upcoming = subs.filter((s) => DAYS.indexOf(s.day) >= DAYS.indexOf(todayName))

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="My week"
        title="Substitutions"
        sub="Periods the office has asked you to cover. Your own timetable is unchanged — these sit on top of it."
        breadcrumbs={[{ label: 'Teacher', to: '/teacher' }, { label: 'Substitutions' }]}
        actions={
          <Chip tone={subs.length ? 'warning' : 'neutral'} dot>
            {subs.length} assigned
          </Chip>
        }
      />

      {subs.length === 0 ? (
        <Card>
          <EmptyState
            icon={ShieldCheck}
            title="You are not covering anything"
            hint="When the office assigns you a substitute period it appears here and in the banner on your overview."
          />
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {subs.map((s) => (
            <Card key={s.id} tone="accent" className="p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Chip tone={subjectTone(s.subject)}>{s.subject}</Chip>
                <span className="num text-2xs" style={{ color: 'var(--tone-ink)' }}>
                  {s.day} · {periodAt(Number(s.period)).start}
                </span>
              </div>
              <p className="display text-lg font-extrabold t1 leading-none">{s.class_section}</p>
              <p className="flex items-center gap-2 text-sm t2">
                <DoorOpen size={14} aria-hidden /> {s.room || 'Room to be announced'}
              </p>
              <p className="text-xs t2 leading-relaxed">
                Standing in for <span className="font-semibold t1">{s.teacher_name}</span>.
                {s.sub_notes ? ` ${s.sub_notes}` : ''}
              </p>
            </Card>
          ))}
        </div>
      )}

      {upcoming.length ? (
        <Card className="p-4">
          <p className="text-sm t2">
            <span className="font-bold t1">{upcoming.length}</span> substitution{upcoming.length === 1 ? '' : 's'} fall in the rest of this week.
          </p>
        </Card>
      ) : null}
    </div>
  )
}

/* ----------------------------------------------------------------- profile -- */

export function TeacherProfile() {
  const { profile, settings } = useApp()
  const { mine, classes } = useTeacher()

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Account"
        title="Profile"
        sub="Maintained by the school directory. Roles and staff numbers are edited by the office, never here."
        breadcrumbs={[{ label: 'Teacher', to: '/teacher' }, { label: 'Profile' }]}
      />

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center gap-4 mb-5">
            <Avatar name={profile?.full_name || ''} size="lg" tone="brand" />
            <div className="min-w-0">
              <h2 className="display text-lg font-bold truncate">{profile?.full_name}</h2>
              <p className="lede">{profile?.designation || profile?.subject || 'Faculty'}</p>
            </div>
          </div>
          <KeyValue
            cols={2}
            rows={[
              ['School email', profile?.email],
              ['Role', profile?.role],
              ['Primary subject', profile?.subject],
              ['Staff ID', profile?.employee_id],
              ['Weekly periods', mine.length],
              ['Classes', classes.join(', ') || '—'],
              ['School', settings?.school_name],
              ['Timezone', settings?.timezone],
            ]}
          />
        </Card>

        <Card className="p-5">
          <h3 className="display text-md font-bold mb-3">Workload</h3>
          <ul className="list-none m-0 p-0 space-y-2.5">
            {Object.entries(
              mine.reduce((acc, s) => {
                acc[s.subject] = (acc[s.subject] || 0) + 1
                return acc
              }, {}),
            )
              .sort((a, b) => b[1] - a[1])
              .map(([subject, count]) => (
                <li key={subject} className="flex items-center gap-2.5 min-w-0">
                  <span className="dot shrink-0" data-tone={subjectTone(subject)} aria-hidden />
                  <span className="text-sm t1 truncate flex-1">{subject}</span>
                  <span className="num text-2xs t3 shrink-0">{count} pds</span>
                </li>
              ))}
            {!mine.length ? <li className="text-sm t3">No periods assigned yet.</li> : null}
          </ul>
        </Card>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- tiny hooks */

/** The note drawer state shared by the timetable and homework pages. */
function useNoteDrawer() {
  const [open, setOpen] = useState(null)
  const [draft, setDraft] = useState('')
  const edit = (slot) => {
    setOpen(slot)
    setDraft(slot?.homework_note || '')
  }
  return { open, close: () => setOpen(null), edit, draft, setDraft }
}
