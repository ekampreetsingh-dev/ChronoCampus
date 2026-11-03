import { createContext, useContext, useMemo, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  ArrowRight,
  ArrowRightLeft,
  BookOpenText,
  CalendarX2,
  Clock4,
  DoorOpen,
  GraduationCap,
  MapPin,
  ShieldCheck,
  Unlock,
  UserRound,
  Users,
} from 'lucide-react'
import AppShell from '../components/shell/AppShell'
import ClassCodeModal from '../components/ClassCodeModal'
import { TimetableBoard } from '../components/timetable/Board'
import { useApp } from '../context/AppContext'
import { useMyClass, useSchool } from '../hooks/useSchool'
import {
  currentInterlude,
  currentPeriodIndex,
  isSchoolDay,
  nextPeriod,
  periodAt,
  periodProgress,
  periodsFor,
  toMinutes,
} from '../lib/bellSchedule'
import { roomShort, subjectShort, subjectTone } from '../lib/subjects'
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHead,
  Chip,
  EmptyState,
  KeyValue,
  Modal,
  PageHeader,
  SkeletonRows,
  Stat,
} from '../components/ui/primitives'
import { ProgressBar } from '../components/ui/charts'

const StudentCtx = createContext(null)
export const useStudentData = () => useContext(StudentCtx)

export function StudentLayout() {
  const { profile, setProfile } = useApp()
  const school = useSchool()
  const cls = useMyClass()
  const [gate, setGate] = useState(null)
  const needsCode = profile?.role === 'student' && !profile?.class_section

  const value = { ...school, classSlots: cls.slots, loading: cls.loading || school.loading, reload: cls.reload }

  return (
    <StudentCtx.Provider value={value}>
      <AppShell
        role="student"
        actions={
          /* While the class gate is mandatory the sheet is already on screen, so a
             second button that only re-opens it would be a dead control. */
          needsCode ? null : (
            <Button size="sm" variant="quiet" tone="accent" icon={Unlock} onClick={() => setGate({ mode: 'promote' })}>
              Change class
            </Button>
          )
        }
      >
        {needsCode ? <Unverified /> : <Outlet />}
        <ClassCodeModal
          open={Boolean(gate) || needsCode}
          onClose={needsCode ? undefined : () => setGate(null)}
          mode={gate?.mode || 'verify'}
          onSuccess={({ class_section }) => {
            setProfile({ class_section })
            setGate(null)
          }}
        />
      </AppShell>
    </StudentCtx.Provider>
  )
}

function Unverified() {
  return (
    <Card className="p-8 max-w-[580px] mx-auto text-center">
      <span className="avatar avatar-lg mx-auto mb-4" data-tone="accent" aria-hidden>
        <Unlock size={22} />
      </span>
      <h2 className="display text-lg font-bold">Your class is not verified yet</h2>
      <p className="lede mt-2 mx-auto">
        The access code is on your class notice and in the letter the office sent home. It is checked against the school's own
        records — guessing only shows an error, and five wrong attempts lock the form for ten minutes.
      </p>
      <p className="meta mt-3">The verification sheet is open above.</p>
    </Card>
  )
}

/* ---------------------------------------------------------- live now hero -- */

function LiveHero({ slots, todayName, now, section }) {
  const periods = periodsFor(section)
  const livePeriod = currentPeriodIndex(now, periods)
  const interlude = currentInterlude(now, periods)
  const walkIn = nextPeriod(now, periods)
  const today = useMemo(() => slots.slice().sort((a, b) => Number(a.period) - Number(b.period)), [slots])
  const current = livePeriod >= 0 ? today.find((s) => Number(s.period) === livePeriod) : null
  const upcoming = today.filter((s) => Number(s.period) > livePeriod)
  const rest = current ? upcoming : today.slice(1)
  const next = current ? upcoming[0] : today[0]
  const progress = periodProgress(now, periods)
  const liveDef = periodAt(livePeriod, periods)
  const pStart = liveDef.start
  const pEnd = liveDef.end

  if (!today.length) {
    return (
      <Card>
        <EmptyState
          icon={CalendarX2}
          title="No periods published for your class"
          hint="Your class is verified, but the office has not assigned periods to it yet."
        />
      </Card>
    )
  }

  if (!isSchoolDay(now)) {
    return (
      <Card>
        <EmptyState
          icon={CalendarX2}
          title="The campus is shut today"
          hint={walkIn ? `Next bell is ${walkIn.day} ${walkIn.period.label} at ${walkIn.period.start}.` : 'Classes run Monday to Saturday.'}
        />
      </Card>
    )
  }

  return (
    <div className="grid lg:grid-cols-[1.35fr_1fr] gap-3 items-start">
      <Card tone={current ? subjectTone(current.subject) : 'neutral'} className="p-5 h-full">
        {current ? (
          <>
            <div className="flex items-center gap-2.5 mb-3">
              <span className="dot" data-tone="danger" aria-hidden />
              <span className="eyebrow" style={{ color: 'var(--tone-ink)' }}>
                Live now · {periodAt(livePeriod, periods).label} {periodAt(livePeriod, periods).start}–{periodAt(livePeriod, periods).end}
              </span>
            </div>
            <h2 className="display text-2xl font-extrabold leading-none">{current.subject}</h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-sm t2">
              <span className="flex items-center gap-1.5 t1">
                <UserRound size={14} className="t3" aria-hidden />
                {current.is_substitution ? (
                  <>
                    <span className="font-semibold" style={{ color: 'var(--color-accent-ink)' }}>{current.substitute_teacher_name}</span>
                    <span className="t3">for {current.teacher_name}</span>
                  </>
                ) : (
                  current.teacher_name
                )}
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin size={14} className="t3" aria-hidden />
                <span className="num">{current.room || 'No room set'}</span>
              </span>
            </div>

            <div className="mt-5">
              <ProgressBar
                value={Math.round(progress * 100)}
                tone={subjectTone(current.subject)}
                label="Period progress"
                sub={progress >= 1 ? 'Period finished' : `${Math.max(1, Math.round((1 - progress) * (toMinutes(pEnd) - toMinutes(pStart))))} minutes left`}
              />
            </div>

            <div className="well px-4 py-3 mt-4 flex items-start gap-2.5">
              <BookOpenText size={15} className="t3 shrink-0 mt-0.5" aria-hidden />
              <p className="text-sm t1 leading-relaxed">
                {current.homework_note || <span className="t3">No homework published for this period yet.</span>}
              </p>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-4 h-full">
            <span className="avatar shrink-0" data-tone="accent" aria-hidden>
              <Clock4 size={20} />
            </span>
            <div className="min-w-0">
              <p className="eyebrow mb-1">{interlude || 'Between periods'}</p>
              <h2 className="display text-lg font-bold leading-tight">
                {walkIn ? `${walkIn.period.label} starts at ${walkIn.period.start}` : 'Board is clear'}
              </h2>
              <p className="lede mt-1.5">{interlude ? 'Break time — the next bell is' : 'Nothing is ringing right now.'}</p>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <ArrowRight size={15} className="text-[color:var(--color-brand-strong)]" aria-hidden />
          <span className="eyebrow">Up next</span>
        </div>
        {next ? (
          <div className="mb-4">
            <Chip tone={subjectTone(next.subject)} large>
              {next.subject}
            </Chip>
            <p className="text-sm t1 mt-2">{next.is_substitution ? next.substitute_teacher_name : next.teacher_name}</p>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="flex items-center gap-1.5 meta">
                <DoorOpen size={13} aria-hidden /> {roomShort(next.room) || '—'}
              </span>
              <span className="num text-2xs t3">
                {periodAt(Number(next.period), periods).label} · {periodAt(Number(next.period), periods).start}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm t3 mb-4">Last bell of the day is done.</p>
        )}

        <hr className="divider my-3" />
        <p className="field-label mb-2">Rest of {todayName}</p>
        <ul className="list-none m-0 p-0 space-y-1.5 max-h-[190px] overflow-y-auto scroll pr-1">
          {rest.map((s) => (
            <li key={s.id} className="flex items-center gap-2 min-w-0">
              <span className="num text-2xs t3 w-[42px] shrink-0">{periodAt(Number(s.period), periods).start}</span>
              <Chip tone={subjectTone(s.subject)}>{subjectShort(s.subject)}</Chip>
              <span className="text-xs t3 truncate">{s.teacher_name}</span>
              {s.is_substitution ? (
                <Chip tone="accent" className="ml-auto shrink-0">
                  sub
                </Chip>
              ) : null}
            </li>
          ))}
          {!rest.length ? <li className="text-sm t3">Nothing left on the board today.</li> : null}
        </ul>
      </Card>
    </div>
  )
}

/* --------------------------------------------------------------- overview -- */

export function StudentOverview() {
  const { profile, now, todayName } = useApp()
  const { classSlots, loading } = useStudentData()
  const today = classSlots.filter((s) => s.day === todayName)
  const withHomework = classSlots.filter((s) => s.homework_note).length

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={`${profile?.class_section || 'Unverified'} · read only`}
        title={`This week, ${profile?.full_name?.split(' ')[0] || 'friend'}`}
        sub="Set by the office. Open any period for the homework your teacher published and the room it is held in."
        breadcrumbs={[{ label: 'Student' }, { label: 'Overview' }]}
      />
      {loading ? (
        <SkeletonRows rows={5} />
      ) : (
        <>
          <LiveHero slots={today} todayName={todayName} now={now} section={profile?.class_section} />
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <Stat label="Periods this week" value={classSlots.length} icon={CalendarX2} tone="brand" />
            <Stat label="Today" value={today.length} sub={todayName} icon={Clock4} tone="accent" />
            <Stat
              label="With homework set"
              value={withHomework}
              sub={`${Math.round((withHomework / Math.max(1, classSlots.length)) * 100)}% of your week`}
              icon={BookOpenText}
              tone="success"
            />
            <Stat
              label="Substituted"
              value={classSlots.filter((s) => s.is_substitution).length}
              sub="teachers changed"
              icon={ArrowRightLeft}
              tone="warning"
            />
          </div>
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------------------- timetable -- */

export function StudentTimetable() {
  const { profile, now, todayName } = useApp()
  const { classSlots, loading } = useStudentData()
  const [peek, setPeek] = useState(null)
  const periods = periodsFor(profile?.class_section)

  const legend = useMemo(() => [...new Set(classSlots.map((s) => s.subject))].sort().slice(0, 10), [classSlots])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="My studies"
        title="My timetable"
        sub="Your verified class only, for the active session."
        breadcrumbs={[{ label: 'Student', to: '/student' }, { label: 'My Timetable' }]}
      />
      {loading ? (
        <SkeletonRows rows={8} />
      ) : (
        <>
          <TimetableBoard
            slots={classSlots}
            mode="class"
            periods={periods}
            liveDay={todayName}
            livePeriod={currentPeriodIndex(now, periods)}
            onCellClick={({ slot }) => slot && setPeek(slot)}
            emptyTitle="No periods on your board yet"
            emptyHint="The office has verified your class but has not published periods to it."
          />
          {legend.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="field-label mb-0 mr-1">Subjects on your board</span>
              {legend.map((s) => (
                <Chip key={s} tone={subjectTone(s)}>
                  {subjectShort(s)}
                </Chip>
              ))}
            </div>
          ) : null}
        </>
      )}

      <Modal
        open={Boolean(peek)}
        onClose={() => setPeek(null)}
        title={peek ? `${peek.subject} · ${periodAt(Number(peek.period), periods).label}` : ''}
        sub={peek ? `${peek.day} · ${periodAt(Number(peek.period), periods).start}–${periodAt(Number(peek.period), periods).end}` : ''}
        width="max-w-md"
      >
        {peek ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={subjectTone(peek.subject)} large>
                {peek.subject}
              </Chip>
              {peek.room ? (
                <Chip tone="info" icon={MapPin}>
                  {peek.room}
                </Chip>
              ) : null}
              {peek.is_substitution ? (
                <Chip tone="accent" icon={ArrowRight}>
                  Substituted
                </Chip>
              ) : null}
            </div>

            {peek.is_substitution ? (
              <Alert tone="accent" icon={ArrowRightLeft} title="A substitute is holding this period">
                {peek.teacher_name} is off. {peek.sub_notes || 'The office will confirm the reason.'}
              </Alert>
            ) : null}

            <KeyValue
              rows={[
                ['Teacher', peek.is_substitution ? peek.substitute_teacher_name : peek.teacher_name],
                ['Class', peek.class_section],
                ['Room', peek.room || 'Not assigned'],
              ]}
            />

            <div className="well px-4 py-3">
              <p className="field-label mb-1.5 flex items-center gap-1.5">
                <BookOpenText size={13} aria-hidden /> Homework & topic
              </p>
              <p className="text-sm t1 leading-relaxed">
                {peek.homework_note || <span className="t3">Nothing published for this period yet.</span>}
              </p>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

/* ---------------------------------------------------------------- homework -- */

export function StudentHomework() {
  const { profile } = useApp()
  const { classSlots, loading } = useStudentData()
  const periods = periodsFor(profile?.class_section)

  const grouped = useMemo(() => {
    const map = new Map()
    for (const s of classSlots) {
      if (!s.homework_note) continue
      if (!map.has(s.subject)) map.set(s.subject, [])
      map.get(s.subject).push(s)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [classSlots])

  const withNotes = classSlots.filter((s) => s.homework_note)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="My studies"
        title="Homework"
        sub="Everything your teachers have published for this week's periods, grouped by subject."
        breadcrumbs={[{ label: 'Student', to: '/student' }, { label: 'Homework' }]}
        actions={
          <Chip tone={withNotes.length ? 'success' : 'neutral'} dot>
            {withNotes.length} published
          </Chip>
        }
      />
      {loading ? (
        <SkeletonRows rows={6} />
      ) : grouped.length === 0 ? (
        <Card>
          <EmptyState
            icon={BookOpenText}
            title="No homework set yet"
            hint="Notes appear here as soon as a teacher publishes one against one of your periods."
          />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          {grouped.map(([subject, list]) => (
            <Card key={subject}>
              <CardHead
                title={subject}
                sub={`${list.length} note${list.length === 1 ? '' : 's'} this week`}
                right={<Chip tone={subjectTone(subject)}>{subjectShort(subject)}</Chip>}
              />
              <ul className="px-4 pb-4 m-0 list-none space-y-2">
                {list
                  .sort((a, b) => DAYS_INDEX(a) - DAYS_INDEX(b) || Number(a.period) - Number(b.period))
                  .map((s) => (
                    <li key={s.id} className="well px-3.5 py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="num text-2xs t3 shrink-0">
                          {s.day.slice(0, 3)} · {periodAt(Number(s.period), periods).label}
                        </span>
                        <span className="text-xs t3 truncate">· {s.teacher_name}</span>
                        {s.is_substitution ? (
                          <Chip tone="accent" className="ml-auto shrink-0">
                            sub
                          </Chip>
                        ) : null}
                      </div>
                      <p className="text-sm t1 mt-1.5 leading-relaxed">{s.homework_note}</p>
                    </li>
                  ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAYS_INDEX = (s) => DAY_ORDER.indexOf(s.day)

/* ------------------------------------------------------- academic history -- */

export function StudentAcademic() {
  const { profile } = useApp()
  const { enrollments = [], sessions, activeSession, classSlots } = useStudentData()

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="My studies"
        title="Academic information"
        sub="Your enrollment history. Moving up never erases the year you came from."
        breadcrumbs={[{ label: 'Student', to: '/student' }, { label: 'Academic Record' }]}
      />
      <div className="grid lg:grid-cols-[1fr_360px] gap-4 items-start">
        <Card>
          <CardHead title="Enrollment history" sub={`${enrollments.length} record${enrollments.length === 1 ? '' : 's'} on file`} icon={GraduationCap} />
          <div className="px-4 pb-4">
            {enrollments.length ? (
              <ol className="list-none m-0 p-0 space-y-2">
                {enrollments.map((e) => (
                  <li key={e.id} className="card-flat px-3.5 py-3 flex items-center gap-3">
                    <span className="dot shrink-0" data-tone={e.enrollment_status === 'active' ? 'success' : 'neutral'} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold t1 truncate">{e.class_section}</p>
                      <p className="meta mt-0.5">
                        {e.session_name} · {new Date(e.enrolled_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <Chip tone={e.enrollment_status === 'active' ? 'success' : 'neutral'}>{e.enrollment_status}</Chip>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm t3">No enrollment records yet.</p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="display text-md font-bold mb-3">Current standing</h3>
          <KeyValue
            rows={[
              ['Student', profile?.full_name],
              ['Admission no.', profile?.admission_number],
              ['Email', profile?.email],
              ['Class', profile?.class_section],
              ['Session', activeSession?.name],
              ['Periods / week', classSlots.length],
            ]}
          />
          <hr className="divider my-4" />
          <p className="field-label mb-2">Sessions on record</p>
          <div className="flex flex-wrap gap-1.5">
            {sessions.map((s) => (
              <Chip key={s.id} tone={s.is_active ? 'success' : 'neutral'} dot>
                {s.name}
              </Chip>
            ))}
            {!sessions.length ? <span className="text-sm t3">No sessions configured.</span> : null}
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- profile -- */

export function StudentProfile() {
  const { profile, settings } = useApp()
  const { classSlots } = useStudentData()

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Account"
        title="Profile"
        sub="Verified against the school's student directory. Admission numbers and class records are maintained by the office."
        breadcrumbs={[{ label: 'Student', to: '/student' }, { label: 'Profile' }]}
      />
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center gap-4 mb-5">
            <Avatar name={profile?.full_name || ''} size="lg" tone="sage" />
            <div className="min-w-0">
              <h2 className="display text-lg font-bold truncate">{profile?.full_name}</h2>
              <p className="lede">
                {profile?.class_section || 'Class not verified'} · {classSlots.length} periods a week
              </p>
            </div>
          </div>
          <KeyValue
            cols={2}
            rows={[
              ['Name', profile?.full_name],
              ['School email', profile?.email],
              ['Admission number', profile?.admission_number],
              ['Class', profile?.class_section],
              ['Role', profile?.role],
              ['School', settings?.school_name],
            ]}
          />
          <Alert tone="info" icon={ShieldCheck} className="mt-5">
            Something wrong here? Only an administrator can change a directory record — ask the office.
          </Alert>
        </Card>

        <Card className="p-5">
          <h3 className="display text-md font-bold mb-3">Your week</h3>
          <ul className="list-none m-0 p-0 space-y-2.5">
            {Object.entries(
              classSlots.reduce((acc, s) => {
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
            {!classSlots.length ? <li className="text-sm t3">No periods published to your class yet.</li> : null}
          </ul>
          <div className="mt-4 flex items-center gap-2">
            <Users size={14} className="t3" aria-hidden />
            <NavLink to="/student/groups" className="text-xs font-bold">
              Open your class group
            </NavLink>
          </div>
        </Card>
      </div>
    </div>
  )
}
