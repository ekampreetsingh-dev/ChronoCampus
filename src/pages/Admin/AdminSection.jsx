import { useEffect, useMemo, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  BookOpenText,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  History,
  KeyRound,
  Layers,
  Printer,
  ScanLine,
  School,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  TrendingUp,
  UserCheck,
  Users,
  Users2,
} from 'lucide-react'
import AppShell from '../../components/shell/AppShell'
import { db } from '../../lib/supabase'
import { useApp } from '../../context/AppContext'
import { SchoolProvider, useSchoolData } from '../../hooks/useSchool'
import {
  DAYS,
  PERIODS,
  currentPeriodIndex,
  dayIndex,
  periodAt,
  periodRows,
  periodsFor,
  weekCapacity,
} from '../../lib/bellSchedule'
import { auditConflicts, normPeriod } from '../../lib/conflicts'
import { allSubjects, roomShort } from '../../lib/subjects'
import { AreaLine, ChartCard, DonutChart, ProgressBar } from '../../components/ui/charts'
import TimetableBoard, { BoardLegend, LiveRail } from '../../components/timetable/Board'
import SlotEditor from '../../components/SlotEditor'
import BoardTools from '../../components/BoardTools'
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHead,
  Chip,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchSelect,
  SectionTitle,
  Segmented,
  Select,
  Skeleton,
  Stat,
  cx,
} from '../../components/ui/primitives'
import SubstituteTab from './SubstituteTab'
import AnalyticsTab from './AnalyticsTab'
import { CodesPage, DirectoryPage, SectionsPage, SessionsPage } from './Records'
import BellSchedulesPage from './Schedules'
import { firstName } from '../../lib/names'
import { NoticeBoardSheet, PrintLayer } from '../../components/NoticeBoardSheet'

/* ------------------------------------------------------ thin record pages -- */

export const AdminStaffDirectory = () => <DirectoryPage kind="admin" />
export const AdminTeachers = () => <DirectoryPage kind="teacher" />
export const AdminStudents = () => <DirectoryPage kind="student" />
export const AdminSections = () => <SectionsPage />
export const AdminSessions = () => <SessionsPage />
export const AdminCodes = () => <CodesPage />
export const AdminBellSchedules = () => <BellSchedulesPage />

/* ------------------------------------------------------------------ layout -- */

export function AdminLayout() {
  return (
    <SchoolProvider>
      <AppShell role="admin">
        <Outlet />
      </AppShell>
    </SchoolProvider>
  )
}

/* ------------------------------------------------------- shared tab props -- */

function useTabProps() {
  const school = useSchoolData()
  const { pushToast } = useApp()
  return {
    ...school,
    classSections: school.sections.filter((s) => s.is_active).map((s) => s.name),
    rooms: school.settings?.rooms || [],
    pushToast,
  }
}

/* ----------------------------------------------------------------- overview -- */

export function AdminOverview() {
  const {
    slots,
    teachers,
    admins,
    studentDirectory,
    sections,
    codes,
    absences,
    conflicts,
    audit,
    loading,
    activeSession,
  } = useSchoolData()
  const { now, todayName, profile } = useApp()
  const navigate = useNavigate()
  const livePeriod = currentPeriodIndex(now)

  const [calendar, setCalendar] = useState([])
  useEffect(() => {
    let alive = true
    db.listCalendar()
      .then((rows) => alive && setCalendar(rows))
      .catch(() => alive && setCalendar([]))
    return () => {
      alive = false
    }
  }, [])

  const active = sections.filter((s) => s.is_active)
  const today = slots.filter((s) => s.day === todayName)
  const absentIds = new Set(absences.map((a) => String(a.teacher_id)))
  // A bell today whose teacher is marked absent and nobody has covered yet.
  const uncovered = today.filter((s) => absentIds.has(String(s.teacher_id)) && !s.is_substitution)
  const unverified = studentDirectory.filter((s) => !s.class_section)
  const unstarted = active.filter((s) => !slots.some((x) => x.class_section === s.name))
  const classesRunning = new Set(active.map((s) => String(s.grade))).size
  // Each class is measured against its own bell schedule, so completion means what it says.
  const cells = active.reduce((n, s) => n + weekCapacity(periodsFor(s.name)), 0)
  const filledPct = cells ? Math.round((slots.length / cells) * 100) : 0
  const recentCount = (audit || []).length
  const presentCount = Math.max(0, teachers.length - absences.length)

  /* Weekly activity from two real sources: bells placed on the board, and
     privileged changes recorded in the audit log, both grouped by weekday. */
  const week = useMemo(() => {
    const placed = DAYS.map((d) => slots.filter((s) => s.day === d).length)
    const logged = DAYS.map(() => 0)
    for (const a of audit || []) {
      const di = dayIndex(new Date(a.at))
      if (di >= 0 && di < DAYS.length) logged[di] += 1
    }
    return { placed, logged }
  }, [slots, audit])

  const upcoming = useMemo(() => {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return calendar
      .filter((e) => e.date && new Date(e.date) >= start)
      .slice(0, 6)
  }, [calendar, now])

  const absentTeachers = absences
    .map((a) => ({ id: a.teacher_id, reason: a.reason, teacher: teachers.find((t) => String(t.id) === String(a.teacher_id)) }))
    .filter((x) => x.teacher)

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <PageHeader
        eyebrow={`${activeSession?.name || 'No active session'} · ${todayName}`}
        title={`Good ${greeting()}, ${firstName(profile?.full_name) || 'Principal'}`}
        sub="Everything the school needs decided today, gathered from the live board, the directory and the audit log."
        actions={
          <>
            <Chip tone={conflicts.length ? 'danger' : 'success'} icon={conflicts.length ? AlertTriangle : CheckCircle2}>
              {conflicts.length ? `${conflicts.length} timetable clash${conflicts.length > 1 ? 'es' : ''}` : 'timetable is clean'}
            </Chip>
            <Button variant="primary" icon={Layers} onClick={() => navigate('/admin/timetable')}>
              Open timetable
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
        <Stat label="Students" value={studentDirectory.length} sub={activeSession ? `in ${activeSession.name}` : 'no active session'} tone="brand" icon={Users2} />
        <Stat label="Teaching staff" value={teachers.length} sub={`${admins.length} administrators`} tone="info" icon={Users} />
        <Stat label="Classes & sections" value={active.length} sub={`${sections.length} on record · ${classesRunning} grades`} tone="accent" icon={School} />
        <Stat
          label="Timetable completion"
          value={`${Number.isFinite(filledPct) ? filledPct : 0}%`}
          sub={`${slots.length} of ${cells} bells assigned`}
          tone={filledPct >= 90 ? 'success' : 'warning'}
          icon={TrendingUp}
        />
        <Stat
          label="Uncovered periods"
          value={uncovered.length}
          sub={`${today.length} bells scheduled today`}
          tone={uncovered.length ? 'danger' : 'success'}
          icon={ArrowRightLeft}
        />
        <Stat
          label="Teachers absent today"
          value={absences.length}
          sub={`of ${teachers.length} on staff`}
          tone={absences.length ? 'warning' : 'neutral'}
          icon={UserCheck}
        />
        <Stat
          label="Pending code verifications"
          value={unverified.length}
          sub="students without a class"
          tone={unverified.length ? 'warning' : 'success'}
          icon={KeyRound}
        />
        <Stat label="Recent changes" value={recentCount} sub="last 30 privileged edits" tone="neutral" icon={History} />
      </div>

      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-3 items-start">
        <ChartCard
          title="Weekly activity"
          sub="Bells placed on the board against privileged changes logged, counted from real data for each weekday."
          right={<Chip tone="brand">{slots.length} bells this week</Chip>}
          footer={`${filledPct}% of the ${cells || 0} bells the active sections run`}
        >
          <AreaLine
            xLabels={DAYS.map((d) => d.slice(0, 3))}
            height={200}
            series={[
              { name: 'Bells placed', values: week.placed, tone: 'brand' },
              { name: 'Changes logged', values: week.logged, tone: 'accent' },
            ]}
          />
        </ChartCard>

        <Card className="p-0">
          <CardHead title="Completion & coverage" sub="How much of the school week has a subject, teacher and room behind it." icon={Layers} />
          <div className="px-5 pb-5 flex flex-col gap-4">
            <ProgressBar
              value={slots.length}
              max={cells}
              tone={filledPct >= 90 ? 'success' : 'warning'}
              label="Bells assigned"
              sub={`${Math.max(0, cells - slots.length)} still open`}
              height={10}
            />
            <ul className="flex flex-col gap-2 m-0 p-0 list-none text-sm">
              <CoverageRow label="Classes with no timetable" value={unstarted.length} tone={unstarted.length ? 'warning' : 'success'} />
              <CoverageRow label="Sections without a class teacher" value={active.filter((s) => !s.mentor_teacher_id).length} tone="info" />
              <CoverageRow label="Covered by a substitute today" value={today.filter((s) => s.is_substitution).length} tone="accent" />
              <CoverageRow label="Bells needing a decision" value={uncovered.length + unstarted.length + conflicts.length} tone="danger" />
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-3 items-start">
        <Card className="p-0">
          <CardHead
            title={`Today · ${todayName}`}
            sub={livePeriod >= 0 ? `${periodAt(livePeriod).label} is running now.` : 'Between bells.'}
            icon={Clock}
            right={<Chip tone={livePeriod >= 0 ? 'accent' : 'neutral'} dot>{livePeriod >= 0 ? 'in progress' : 'no period running'}</Chip>}
          />
          <div className="px-4 pb-4">
            {loading ? (
              <Skeleton className="h-40 w-full rounded-[12px]" />
            ) : !today.length ? (
              <EmptyState icon={CalendarClock} title="Nothing scheduled today" hint="Either the day is open or the timetable has not been built for it yet." />
            ) : (
              <ul className="flex flex-col gap-1 m-0 p-0 list-none">
                {today
                  .slice()
                  .sort((a, b) => Number(a.period) - Number(b.period))
                  .map((s) => {
                    const isNow = Number(s.period) === livePeriod
                    const subbed = s.is_substitution
                    const absent = absentIds.has(String(s.teacher_id))
                    return (
                      <li key={s.id} className={cx('flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] min-w-0', isNow ? 'well' : 'hover:bg-[color:var(--hovered)] transition-colors')}>
                        <span className="num text-2xs t3 w-[46px] shrink-0 tabular-nums">{periodAt(Number(s.period), periodsFor(s.class_section)).start}</span>
                        <span className="text-xs font-semibold t1 w-[92px] shrink-0 truncate max-w-[92px]">{s.class_section}</span>
                        <span className="text-sm t2 truncate flex-1 min-w-0">
                          {s.subject} · {subbed ? s.substitute_teacher_name : s.teacher_name}
                        </span>
                        <span className="num text-2xs t3 shrink-0 hidden sm:inline">{roomShort(s.room)}</span>
                        {subbed ? (
                          <Chip tone="accent" className="shrink-0">covered</Chip>
                        ) : absent ? (
                          <Chip tone="danger" className="shrink-0">uncovered</Chip>
                        ) : null}
                      </li>
                    )
                  })}
              </ul>
            )}
          </div>
        </Card>

        <div className="flex flex-col gap-3 min-w-0">
          <Card className="p-0">
            <CardHead title="Teacher attendance" sub="Derived from the absences recorded for today." icon={UserCheck} />
            <div className="px-5 pb-5">
              <DonutChart
                size={140}
                centerLabel="on staff today"
                centerValue={`${presentCount}/${teachers.length}`}
                data={[
                  { label: 'Present', value: presentCount, tone: 'success' },
                  { label: 'Absent', value: absences.length, tone: 'danger' },
                ]}
              />
              {absentTeachers.length ? (
                <ul className="flex flex-col gap-1.5 m-0 mt-3 p-0 list-none">
                  {absentTeachers.slice(0, 4).map(({ id, teacher, reason }) => (
                    <li key={String(id)} className="flex items-center gap-2.5 min-w-0">
                      <Avatar name={teacher.full_name} size="sm" tone="danger" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold t1 truncate">{teacher.full_name}</span>
                        <span className="block meta truncate">{reason || 'Marked absent'}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm t3 mt-3">Everyone on staff is present.</p>
              )}
            </div>
          </Card>

          <Card className="p-0">
            <CardHead title="Upcoming calendar" sub="Next events and holidays from the academic calendar." icon={CalendarDays} />
            <div className="px-4 pb-4">
              {upcoming.length ? (
                <ul className="flex flex-col gap-1.5 m-0 p-0 list-none">
                  {upcoming.map((e) => (
                    <li key={e.id} className="flex items-center gap-2.5 px-1.5 py-1.5 min-w-0">
                      <span className="chip shrink-0" data-tone={e.kind === 'holiday' ? 'clay' : 'sky'}>
                        {formatDay(e.date)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold t1 truncate">{e.title}</span>
                        {e.note ? <span className="block meta truncate">{e.note}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm t3 px-1.5 py-2">No upcoming events on the calendar.</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.35fr] gap-3 items-start">
        <Card className="p-0">
          <CardHead title="Alerts" sub="Inherited clashes across the whole board, from the conflict audit." icon={AlertTriangle} />
          <div className="px-5 pb-5 flex flex-col gap-2">
            {conflicts.length ? (
              <>
                <Alert tone="danger" title={`${conflicts.length} clash${conflicts.length > 1 ? 'es' : ''} on the board`}>
                  <ul className="m-0 mt-1.5 list-none p-0 space-y-1.5">
                    {conflicts.slice(0, 6).map((c, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm min-w-0">
                        <span className="chip shrink-0" data-tone="danger">{c.day.slice(0, 3)} P{normPeriod(c.period)}</span>
                        <span className="truncate">
                          {c.kind === 'teacher' ? c.who : c.who} — {c.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Alert>
                <Button variant="tone" tone="danger" size="sm" iconRight={ArrowRight} onClick={() => navigate('/admin/timetable')} className="self-start">
                  Resolve on the timetable
                </Button>
              </>
            ) : (
              <Alert tone="success" title="Board is clean">
                No teacher or room is double-booked anywhere on the timetable.
              </Alert>
            )}
          </div>
        </Card>

        <Card className="p-0">
          <CardHead title="Recent activity" sub="Every privileged change is written to the audit log." icon={Activity} />
          <div className="px-4 pb-4">
            {audit?.length ? (
              <ul className="flex flex-col gap-1 m-0 p-0 list-none">
                {audit.slice(0, 7).map((a) => (
                  <li key={a.id} className="flex items-start gap-2.5 text-sm min-w-0 py-1">
                    <span className="num text-2xs t3 w-[52px] shrink-0 tabular-nums">{shortTime(a.at)}</span>
                    <span className="text-2xs t3 shrink-0 capitalize">{a.actor_role || 'system'}</span>
                    <span className="text-xs font-semibold t1 shrink-0">{a.action}</span>
                    <span className="t2 truncate min-w-0">{a.target}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm t3 py-2">Nothing recorded yet.</p>
            )}
          </div>
        </Card>
      </div>

      <Card className="p-0">
        <CardHead title="Quick actions" sub="Jump straight to the desk that handles it." icon={Sparkles} />
        <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
          <QuickAction icon={Layers} title="Build timetable" sub="Assign and edit periods" onClick={() => navigate('/admin/timetable')} />
          <QuickAction icon={ArrowRightLeft} title="Substitute desk" sub="Cover absent teachers" onClick={() => navigate('/admin/substitutes')} />
          <QuickAction icon={TrendingUp} title="Workload analytics" sub="Balance across staff" onClick={() => navigate('/admin/workload')} />
          <QuickAction icon={KeyRound} title="Class codes" sub={`${codes.filter((c) => c.status === 'active').length} active`} onClick={() => navigate('/admin/codes')} />
          <QuickAction icon={Users2} title="Student directory" sub={`${unverified.length} unverified`} onClick={() => navigate('/admin/students')} />
          <QuickAction icon={Printer} title="Print reports" sub="A4 timetable sheets" onClick={() => navigate('/admin/reports')} />
          <QuickAction icon={Building2} title="Sections" sub={`${active.length} running`} onClick={() => navigate('/admin/sections')} />
          <QuickAction icon={SettingsIcon} title="School settings" sub="Days & timings" onClick={() => navigate('/admin/settings')} />
        </div>
      </Card>
    </div>
  )
}

function CoverageRow({ label, value, tone }) {
  return (
    <li className="flex items-center justify-between gap-3 min-w-0">
      <span className="text-sm t2 truncate">{label}</span>
      <Chip tone={value ? tone : 'neutral'}>{value}</Chip>
    </li>
  )
}

function QuickAction({ icon: Icon, title, sub, onClick }) {
  return (
    <button type="button" onClick={onClick} className="card card-raise text-left p-3.5 flex items-center gap-3 min-w-0">
      <span className="avatar avatar-sm shrink-0" data-tone="brand" aria-hidden>
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold t1 truncate">{title}</span>
        <span className="block meta truncate">{sub}</span>
      </span>
      <ArrowRight size={15} className="t3 shrink-0" aria-hidden />
    </button>
  )
}

/* ---------------------------------------------------------------- timetable -- */

const VIEWS = [
  { id: 'class', label: 'Class', icon: Building2 },
  { id: 'teacher', label: 'Teacher', icon: Users },
  { id: 'room', label: 'Room', icon: ScanLine },
]

export function AdminTimetable() {
  const { slots, teachers, sections, settings, conflicts, reload, loading, classSections, rooms, pushToast } = useTabProps()
  const { now, todayName } = useApp()
  const [mode, setMode] = useState('class')
  const [value, setValue] = useState(classSections[0] || '')
  const [target, setTarget] = useState(null)
  const [chooser, setChooser] = useState(null)

  const livePeriod = currentPeriodIndex(now)

  const options = mode === 'class' ? classSections : mode === 'teacher' ? teachers : rooms
  const activeValue =
    mode === 'teacher'
      ? (teachers.find((t) => String(t.id) === String(value))?.id ?? teachers[0]?.id ?? '')
      : options.includes(value)
        ? value
        : options[0] ?? ''

  const pickerOptions = useMemo(() => {
    if (mode === 'teacher')
      return teachers.map((t) => ({ value: String(t.id), label: t.full_name, hint: [t.subject, ...(t.extra || [])].join(' · ') }))
    if (mode === 'room')
      return rooms.map((r) => ({ value: r, label: r, hint: /lab|library|hall|studio/i.test(r) ? 'practical room' : 'class room' }))
    return classSections.map((name) => {
      const s = sections.find((x) => x.name === name)
      return { value: name, label: name, hint: s ? s.default_room : '' }
    })
  }, [mode, teachers, rooms, classSections, sections])

  const editorClass = target?.slot?.class_section || (mode === 'class' ? activeValue : '')
  const editorSection = sections.find((s) => s.name === editorClass)
  // A class only ever needs the subjects it actually teaches; until a syllabus is
  // published for it, the whole-school list keeps the editor usable.
  const subjectOptions = useMemo(() => {
    const plan = editorSection?.curriculum
    const owned = plan ? Object.entries(plan).sort((a, b) => b[1] - a[1]).map(([s]) => s) : []
    return owned.length ? [...new Set([...owned, ...allSubjects])] : allSubjects
  }, [editorSection])

  const filtered = useMemo(() => {
    if (mode === 'class') return slots.filter((s) => s.class_section === activeValue)
    if (mode === 'teacher') return slots.filter((s) => String(s.teacher_id) === String(activeValue))
    return slots.filter((s) => s.room === activeValue)
  }, [slots, mode, activeValue])

  const boardPeriods = mode === 'class' ? periodsFor(activeValue) : periodRows(classSections)
  const capacity = weekCapacity(boardPeriods)
  const label = mode === 'teacher' ? teachers.find((t) => String(t.id) === String(activeValue))?.full_name : String(activeValue)
  const legendSubjects = useMemo(() => [...new Set(filtered.map((s) => s.subject))].filter(Boolean).sort(), [filtered])

  const onCell = ({ day, period, slot }) => {
    if (slot) return setTarget({ day, period, slot })
    if (mode === 'class') return setTarget({ day, period, slot: null })
    setChooser({ day, period }) // teacher / room views must still learn which class this is
  }

  const filledPct = capacity ? Math.round((filtered.length / capacity) * 100) : 0

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <PageHeader
        eyebrow="Academic operations"
        title="Master timetable"
        sub="Click any cell to assign or edit. Before saving, the same day and period is checked across every other class — a teacher or room collision blocks the write in the browser and again in Postgres."
        actions={<Chip tone={conflicts.length ? 'danger' : 'success'} icon={conflicts.length ? AlertTriangle : CheckCircle2}>{conflicts.length ? `${conflicts.length} clash${conflicts.length > 1 ? 'es' : ''} on the board` : 'board is clean'}</Chip>}
      />

      {conflicts.length ? (
        <Alert tone="danger" title="Inherited conflicts on the whole board" icon={AlertTriangle}>
          <ul className="m-0 mt-1.5 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5 list-none p-0">
            {conflicts.slice(0, 6).map((c, i) => (
              <li key={i} className="flex items-center gap-2 text-sm min-w-0">
                <span className="chip shrink-0" data-tone="danger">{c.day.slice(0, 3)} P{normPeriod(c.period)}</span>
                <span className="truncate">{c.who} — {c.detail}</span>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card className="p-0">
        <CardHead
          title="Board"
          sub={`${mode === 'class' ? 'Class' : mode === 'teacher' ? 'Teacher' : 'Room'} reading · ${filtered.length}/${capacity} bells placed (${filledPct}%).`}
          icon={Layers}
          right={<Segmented label="Reading mode" value={mode} onChange={(id) => { setMode(id); setValue('') }} items={VIEWS} />}
        />
        <div className="px-5 pb-5 flex flex-col gap-4">
          <div className="grid lg:grid-cols-[1fr_1.1fr] gap-4 items-end">
            <Field label="Show" className="min-w-0">
              <SearchSelect
                value={String(activeValue)}
                onChange={(v) => setValue(v)}
                options={pickerOptions}
                placeholder={mode === 'teacher' ? 'Choose a teacher' : mode === 'room' ? 'Choose a room' : 'Choose a class'}
                searchPlaceholder={mode === 'teacher' ? 'Search staff by name or subject' : mode === 'room' ? 'Search rooms and labs' : 'Search a class'}
                emptyText="Nothing matches that name."
              />
            </Field>

            <BoardTools
              slots={slots}
              sections={sections}
              classSections={classSections}
              activeClass={mode === 'class' ? activeValue : ''}
              reload={reload}
              pushToast={pushToast}
              onCopied={(name) => {
                setMode('class')
                setValue(name)
              }}
            />
          </div>

          {mode === 'class' && activeValue ? (
            <LiveRail slots={filtered} now={now} periods={boardPeriods} compact />
          ) : null}

          <div className="min-w-0">
            <TimetableBoard
              slots={filtered}
              mode={mode === 'teacher' ? 'teacher' : 'class'}
              liveDay={todayName}
              livePeriod={livePeriod}
              onCellClick={onCell}
              editable
              showClass={mode !== 'class'}
              periods={boardPeriods}
            />
          </div>

          <BoardLegend subjects={legendSubjects} />
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
        <Stat label="Open cells" value={Math.max(0, capacity - filtered.length)} sub="click to assign" tone="brand" icon={Layers} />
        <Stat label="Substitutions live" value={slots.filter((s) => s.is_substitution).length} sub="across the week" tone="accent" icon={ArrowRightLeft} />
        <Stat
          label="Homework notes"
          value={slots.filter((s) => s.homework_note).length}
          sub={`${Math.round((slots.filter((s) => s.homework_note).length / Math.max(1, slots.length)) * 100)}% of slots`}
          tone="info"
          icon={BookOpenText}
        />
        <Stat label="Staff on the board" value={new Set(slots.map((s) => s.teacher_id)).size} sub={`of ${teachers.length} in directory`} tone="success" icon={Users} />
      </div>

      <SlotEditor
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        target={target}
        classSection={editorClass}
        allSlots={slots}
        teachers={teachers}
        rooms={rooms}
        homeRoom={editorSection?.default_room || ''}
        subjects={subjectOptions}
        onSaved={(row) =>
          pushToast({ tone: 'success', title: target?.slot ? 'Period updated' : 'Period assigned', message: `${row.subject} · ${row.day} P${row.period} → ${row.class_section}` })
        }
        onDeleted={() => pushToast({ tone: 'warning', title: 'Period cleared', message: 'The cell is open again.' })}
      />

      <Modal
        open={Boolean(chooser)}
        onClose={() => setChooser(null)}
        title="Which class takes this period?"
        sub={`${chooser?.day} · ${chooser ? periodAt(chooser.period, boardPeriods).label : ''} is open for ${label}. Choose the section to assign.`}
        icon={Building2}
        width="max-w-[400px]"
      >
        <div className="grid gap-1.5">
          {classSections.map((c) => (
            <button
              key={c}
              onClick={() => {
                setTarget({ day: chooser.day, period: chooser.period, slot: null })
                setChooser(null)
                setValue(c)
                setMode('class')
              }}
              className="well px-3.5 py-2.5 text-left flex items-center gap-2 hover:bg-[color:var(--well-hover)] transition-colors"
            >
              <Building2 size={14} className="t3" />
              <span className="text-sm font-semibold t1">{c}</span>
              <ArrowRight size={14} className="ml-auto t3" />
            </button>
          ))}
        </div>
      </Modal>
    </div>
  )
}

/* -------------------------------------------------------------- thin tabs --- */

export function AdminSubstitutes() {
  const p = useTabProps()
  return (
    <>
      <PageHeader
        eyebrow="Academic operations"
        title="Substitute manager"
        sub="Mark a teacher absent and their periods appear here with only the staff who are genuinely free at that bell — subject matches listed first."
      />
      <SubstituteTab {...p} />
    </>
  )
}

export function AdminWorkload() {
  const p = useTabProps()
  return (
    <>
      <PageHeader
        eyebrow="Academic operations"
        title="Workload analytics"
        sub="Period load per teacher, how much of the week each room holds, and where the balance has drifted."
      />
      <AnalyticsTab {...p} />
    </>
  )
}

/* ----------------------------------------------------------------- reports -- */

export function AdminReports() {
  const { slots, sections, settings } = useSchoolData()
  const { pushToast } = useApp()
  const active = sections.filter((s) => s.is_active)
  const [target, setTarget] = useState(active[0]?.name || '')
  const [job, setJob] = useState(null)

  const build = (section) => ({ classSection: section, slots: slots.filter((s) => s.class_section === section), school: settings?.school_name })

  const print = () => {
    if (!target) return
    setJob(build(target))
    setTimeout(() => window.print(), 120)
    pushToast({ tone: 'success', title: 'Sent to print', message: `${target} laid out for A4 landscape.` })
  }

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <PageHeader
        eyebrow="Academic operations"
        title="Reports & printing"
        sub="One class per A4 landscape sheet. The glass and chrome drop away — what reaches the printer is ink on paper."
        actions={<Button variant="primary" icon={Printer} onClick={print} disabled={!target}>Print now</Button>}
      />

      <Card className="p-0">
        <CardHead title="Choose a class" sub="The sheet carries the school name, session, signature lines and the substitution marker." icon={Printer} />
        <div className="px-5 pb-5 flex flex-wrap gap-1.5">
          {active.map((s) => {
            const count = slots.filter((x) => x.class_section === s.name).length
            return (
              <button
                key={s.id}
                onClick={() => {
                  setTarget(s.name)
                  setJob(build(s.name))
                }}
                className={cx('seg-item', target === s.name && 'is-active')}
              >
                {s.name}
                <span className="num tabular-nums opacity-70">{count}</span>
              </button>
            )
          })}
        </div>
      </Card>

      {job ? (
        <div className="overflow-x-auto scroll rounded-[18px] border border-[color:var(--color-line-soft)] bg-[color:var(--glass-2)]">
          <NoticeBoardSheet {...job} />
        </div>
      ) : (
        <Card>
          <EmptyState icon={Printer} title="Pick a class to preview" hint="The preview below is exactly what the printer receives." />
        </Card>
      )}

      <PrintLayer job={job} />
    </div>
  )
}

/* ---------------------------------------------------------------- settings -- */

export function AdminSettings() {
  const { settings, reload, sections } = useSchoolData()
  const { pushToast } = useApp()
  const [form, setForm] = useState(settings || {})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setForm(settings || {})
  }, [settings])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const save = async () => {
    setBusy(true)
    try {
      await db.saveSettings(form)
      await db.applySchedule()
      await reload()
      pushToast({ tone: 'success', title: 'Settings saved', message: 'Timings now flow to every timetable screen from here, not from code.' })
    } finally {
      setBusy(false)
    }
  }

  const workingDays = form.working_days || DAYS

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <PageHeader
        eyebrow="Configuration"
        title="School settings"
        sub="Working days, bell gaps and the school's identity. The live clock reads the configured timezone, so a school in another zone behaves correctly."
        actions={<Button variant="primary" icon={Download} loading={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</Button>}
      />

      <div className="grid lg:grid-cols-2 gap-3 items-start">
        <Card className="p-0">
          <CardHead title="Identity" sub="Printed on every report sheet and shown across the portal." icon={School} />
          <div className="px-5 pb-5 flex flex-col gap-3 min-w-0">
            <Field label="School name">
              <Input value={form.school_name || ''} onChange={(e) => set({ school_name: e.target.value })} placeholder="ChronoCampus Public School" />
            </Field>
            <Field label="Address">
              <Input value={form.address || ''} onChange={(e) => set({ address: e.target.value })} />
            </Field>
            <Field label="Approved email domain" hint="Supplementary only — a matching domain never replaces the directory check.">
              <Input value={form.approved_domain || ''} onChange={(e) => set({ approved_domain: e.target.value })} placeholder="school.edu.in" />
            </Field>
          </div>
        </Card>

        <Card className="p-0">
          <CardHead title="Schedule" sub="These values drive every timetable, the live rail and the print sheet." icon={CalendarClock} />
          <div className="px-5 pb-5 flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Timezone">
                <Input value={form.timezone || ''} onChange={(e) => set({ timezone: e.target.value })} placeholder="Asia/Kolkata" />
              </Field>
              <Field label="Email + password sign-in" hint="Off means Google only.">
                <Select value={String(Boolean(form.email_password_enabled))} onChange={(e) => set({ email_password_enabled: e.target.value === 'true' })}>
                  <option value="true">Allowed</option>
                  <option value="false">Disabled</option>
                </Select>
              </Field>
              <Field label="Break after period">
                <Input type="number" min="1" max={PERIODS.length - 1} value={form.break_after ?? 2} onChange={(e) => set({ break_after: Number(e.target.value) })} />
              </Field>
              <Field label="Lunch after period">
                <Input type="number" min="1" max={PERIODS.length - 1} value={form.lunch_after ?? 4} onChange={(e) => set({ lunch_after: Number(e.target.value) })} />
              </Field>
            </div>

            <div>
              <p className="field-label">Working days</p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {DAYS.map((d) => {
                  const on = workingDays.includes(d)
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        set({
                          working_days: on
                            ? workingDays.filter((x) => x !== d)
                            : [...workingDays, d].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b)),
                        })
                      }
                      className={cx('seg-item', on && 'is-active')}
                    >
                      {d.slice(0, 3)}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="well px-4 py-3 text-sm t2 leading-relaxed flex flex-wrap items-center gap-x-5 gap-y-1.5">
              <span className="flex items-center gap-1.5"><Sun size={13} className="t3" /> {PERIODS.length} periods</span>
              <span className="flex items-center gap-1.5"><Clock size={13} className="t3" /> {weekCapacity()} slots per class per week</span>
              <span className="flex items-center gap-1.5"><CalendarDays size={13} className="t3" /> {workingDays.length} working days</span>
              <span className="flex items-center gap-1.5"><Building2 size={13} className="t3" /> {sections.filter((s) => s.is_active).length} active sections</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------------- bits -- */

const greeting = () => {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

const shortTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

const formatDay = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
