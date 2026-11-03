import { useMemo, useState } from 'react'
import {
  Activity,
  BarChart3,
  Building2,
  CalendarDays,
  FlaskConical,
  Printer,
  ShieldAlert,
  Users2,
} from 'lucide-react'
import { DAYS, PERIODS, periodsFor } from '../../lib/bellSchedule'
import { auditConflicts, normRoom, roomUtilisation, teacherLoad } from '../../lib/conflicts'
import { roomIsLab, subjectTone } from '../../lib/subjects'
import { isPrePrimary } from '../../lib/schoolSeed'
import { NoticeBoardSheet, PrintLayer } from '../../components/NoticeBoardSheet'
import { DataTable } from '../../components/ui/DataTable'
import {
  AreaLine,
  BarChart,
  ChartCard,
  DonutChart,
  HBarList,
  HeatGrid,
  ProgressBar,
  Ring,
} from '../../components/ui/charts'
import {
  Alert,
  Button,
  Card,
  CardHead,
  Chip,
  EmptyState,
  Modal,
  Panel,
  SearchSelect,
  SectionTitle,
  Segmented,
  SkeletonBoard,
  Stat,
} from '../../components/ui/primitives'

const WEEK_SLOTS = DAYS.length * PERIODS.length

const DAY_SHORT = (d) => String(d).slice(0, 3)

/**
 * Every figure here is counted from the slots and sections handed down — the
 * filters narrow the same source, so a chart can never disagree with the board.
 */
const BANDS = [
  { key: 'all', label: 'Whole school', short: 'All', test: () => true },
  { key: 'early', label: 'Early years', short: 'Early', test: (s) => isPrePrimary(s.grade) },
  { key: 'junior', label: 'Classes 1–5', short: '1–5', test: (s) => s.grade >= 1 && s.grade <= 5 },
  { key: 'middle', label: 'Classes 6–8', short: '6–8', test: (s) => s.grade >= 6 && s.grade <= 8 },
  { key: 'secondary', label: 'Classes 9–10', short: '9–10', test: (s) => s.grade >= 9 && s.grade <= 10 },
  { key: 'senior', label: 'Classes 11–12', short: '11–12', test: (s) => s.grade >= 11 },
]

const DAY_FILTERS = [
  { id: 'all', label: 'Mon–Sat' },
  { id: 'week', label: 'Mon–Fri' },
]

/** Cells a set of sections could hold on the days in play — its own bells, not the default day. */
const capacityOf = (sections, dayCount) =>
  sections.reduce((n, s) => n + dayCount * (periodsFor(s.name).length || 0), 0)

function ChartBand({ slots, teachers, sections, rooms, weekSlots }) {
  const [band, setBand] = useState('all')
  const [days, setDays] = useState('all')

  const byName = useMemo(() => new Map(sections.map((s) => [s.name, s])), [sections])
  const activeBand = BANDS.find((b) => b.key === band) || BANDS[0]
  const dayList = days === 'week' ? DAYS.slice(0, 5) : DAYS

  const shown = useMemo(
    () =>
      slots.filter((s) => {
        const sec = byName.get(s.class_section)
        return activeBand.test(sec || { grade: 0 }) && dayList.includes(s.day)
      }),
    [slots, byName, activeBand, dayList],
  )

  const perDayMax = Math.max(...dayList.map((d) => shown.filter((s) => s.day === d).length), 0)
  const perDay = dayList.map((d) => {
    const value = shown.filter((s) => s.day === d).length
    return { label: DAY_SHORT(d), value, tone: value && value === perDayMax ? 'accent' : 'brand' }
  })

  const inBand = useMemo(() => sections.filter((s) => activeBand.test(s)), [sections, activeBand])
  const capacity = capacityOf(inBand, dayList.length)

  const mix = useMemo(() => {
    const map = new Map()
    for (const s of shown) map.set(s.subject, (map.get(s.subject) || 0) + 1)
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1])
    const top = sorted.slice(0, 7)
    const rest = sorted.slice(7).reduce((n, [, v]) => n + v, 0)
    return [...top, ...(rest ? [['Other subjects', rest]] : [])].map(([label, value]) => ({
      label,
      value,
      tone: label === 'Other subjects' ? 'neutral' : subjectTone(label),
    }))
  }, [shown])

  const workload = useMemo(() => {
    const map = new Map()
    for (const s of shown) map.set(String(s.teacher_id), (map.get(String(s.teacher_id)) || 0) + 1)
    return [...map.entries()]
      .map(([id, value]) => ({
        label: teachers.find((t) => String(t.id) === id)?.full_name || 'Unassigned',
        value,
        sub: `${Math.round((value / Math.max(1, dayList.length * PERIODS.length)) * 100)}% of the week`,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [shown, teachers, dayList.length])

  const roomUse = useMemo(() => {
    const map = new Map()
    for (const s of shown) if (s.room) map.set(normRoom(s.room), (map.get(normRoom(s.room)) || 0) + 1)
    const max = dayList.length * weekSlots
    return [...map.entries()]
      .map(([r, value]) => ({
        label: rooms.find((x) => normRoom(x) === r) || r,
        value: Math.round((value / Math.max(1, max)) * 100),
        sub: `${value} pds`,
        tone: roomIsLab(rooms.find((x) => normRoom(x) === r) || r) ? 'info' : 'brand',
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [shown, rooms, dayList.length, weekSlots])

  const fillBySection = useMemo(
    () =>
      inBand
        .map((sec) => {
          const cap = dayList.length * (periodsFor(sec.name).length || 0)
          const used = shown.filter((s) => s.class_section === sec.name).length
          return { label: sec.name, value: cap ? Math.round((used / cap) * 100) : 0, hint: `${used} of ${cap}` }
        })
        .sort((a, b) => a.value - b.value)
        .slice(0, 24),
    [inBand, shown, dayList.length],
  )

  const unassigned = shown.filter((s) => !s.teacher_id).length
  const fillPct = capacity ? Math.round((shown.length / capacity) * 100) : 0

  return (
    <div className="grid gap-3">
      <Panel tone="brand" className="p-3.5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <p className="field-label mb-2">Class band</p>
            <Segmented label="Class band" value={band} onChange={setBand} items={BANDS.map((b) => ({ id: b.key, label: b.label }))} />
          </div>
          <div className="min-w-0">
            <p className="field-label mb-2">Days counted</p>
            <Segmented label="Days counted" value={days} onChange={setDays} items={DAY_FILTERS} />
          </div>
          <p className="num text-2xs t3 ml-auto mb-1">
            {shown.length} of {slots.length} periods · {capacity.toLocaleString('en-IN')} cells of capacity · {fillPct}% filled
          </p>
        </div>
      </Panel>

      <div className="grid lg:grid-cols-[1.15fr_1fr] gap-3 items-start">
        <ChartCard
          title="Periods scheduled per day"
          sub={`${shown.length} assignments across ${dayList.length} days`}
          footer={
            unassigned
              ? `${unassigned} period${unassigned === 1 ? '' : 's'} on the board with no teacher assigned`
              : 'every counted period has a teacher'
          }
        >
          <BarChart data={perDay} label="periods" height={216} />
        </ChartCard>

        <ChartCard title="Subject mix" sub={`${mix.length} of ${new Set(shown.map((s) => s.subject)).size} subject groups shown`}>
          {shown.length ? (
            <DonutChart data={mix} centerLabel="periods" centerValue={shown.length} />
          ) : (
            <EmptyState icon={BarChart3} title="No periods in this cut" hint="Widen the band or the days to see the mix." />
          )}
        </ChartCard>

        <ChartCard title="Teacher workload" sub="top 10 by assigned periods in this cut">
          <HBarList data={workload} max={workload[0]?.value || 1} />
        </ChartCard>

        <ChartCard title="Room utilisation" sub="percent of the timetabled week each room is booked">
          <HBarList data={roomUse} max={100} valueFormat={(v) => `${v}%`} />
        </ChartCard>

        <div className="lg:col-span-2">
          <ChartCard
            title="Board fill by class"
            sub="scheduled cells as a share of the cells each class could hold on its own bell schedule"
            footer={`${fillPct}% filled for ${activeBand.label.toLowerCase()} · ${inBand.length} section${inBand.length === 1 ? '' : 's'}`}
          >
            {fillBySection.length ? (
              <BarChart data={fillBySection} label="% filled" height={200} valueFormat={(v) => `${v}%`} />
            ) : (
              <EmptyState icon={Building2} title="No sections in this band" hint="The school has no class at this level yet." />
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  )
}

export default function AnalyticsTab({
  slots = [],
  teachers = [],
  classSections = [],
  sections = [],
  rooms = [],
  settings,
  activeSession,
  loading = false,
  pushToast,
}) {
  const [printClass, setPrintClass] = useState(classSections[0] || '')
  const [preview, setPreview] = useState(false)
  const [job, setJob] = useState(null)

  const loads = useMemo(() => teacherLoad(slots), [slots])
  const utilisation = useMemo(() => roomUtilisation(slots, WEEK_SLOTS), [slots])
  const clashes = useMemo(() => auditConflicts(slots), [slots])

  const byName = useMemo(() => new Map(sections.map((s) => [s.name, s])), [sections])
  const namedSections = useMemo(
    () => classSections.map((name) => byName.get(name) || { name, grade: 0, section: '' }),
    [classSections, byName],
  )
  const totalCapacity = useMemo(() => capacityOf(namedSections, DAYS.length), [namedSections])

  const perDay = useMemo(() => {
    const map = new Map()
    for (const s of slots) {
      const k = String(s.teacher_id)
      const arr = map.get(k) || Array(DAYS.length).fill(0)
      const di = DAYS.indexOf(s.day)
      if (di >= 0) arr[di] += 1
      map.set(k, arr)
    }
    return map
  }, [slots])

  const ranked = useMemo(
    () =>
      teachers
        .map((t) => ({
          id: t.id,
          name: t.full_name,
          subject: t.subject,
          count: loads.get(String(t.id)) || 0,
          days: perDay.get(String(t.id)) || Array(DAYS.length).fill(0),
          covers: slots.filter((s) => String(s.substitute_teacher_id) === String(t.id)).length,
          clashes: clashes.filter((c) => c.kind === 'teacher' && c.who === t.full_name).length,
        }))
        .sort((a, b) => b.count - a.count),
    [teachers, loads, perDay, slots, clashes],
  )

  const roomRows = useMemo(() => {
    const listed = rooms.length
      ? [...rooms]
      : [...new Set(slots.map((s) => s.room).filter(Boolean))]
    return listed
      .map((r) => {
        const used = utilisation.get(normRoom(r))?.used || 0
        const subjects = new Set(slots.filter((s) => normRoom(s.room || '') === normRoom(r)).map((s) => s.subject))
        return {
          room: r,
          kind: roomIsLab(r) ? 'practical' : 'classroom',
          used,
          free: WEEK_SLOTS - used,
          pct: Math.round((used / WEEK_SLOTS) * 100),
          subjects: subjects.size,
        }
      })
      .sort((a, b) => b.used - a.used)
  }, [rooms, utilisation, slots])

  const bandCoverage = useMemo(
    () =>
      BANDS.filter((b) => b.key !== 'all')
        .map((b) => {
          const own = namedSections.filter((s) => b.test(s))
          const cap = capacityOf(own, DAYS.length)
          const used = slots.filter((s) => own.some((r) => r.name === s.class_section)).length
          return {
            band: b.label,
            short: b.short,
            own,
            sectionCount: own.length,
            cap,
            used,
            pct: cap ? Math.round((used / cap) * 100) : 0,
          }
        })
        .filter((r) => r.sectionCount),
    [namedSections, slots],
  )

  const subjectRows = useMemo(() => {
    const map = new Map()
    for (const s of slots) map.set(s.subject, (map.get(s.subject) || 0) + 1)
    return [...map.entries()]
      .map(([subject, periods]) => ({
        subject,
        periods,
        classes: new Set(slots.filter((s) => s.subject === subject).map((s) => s.class_section)).size,
        staff: teachers.filter((t) => [t.subject, ...(t.extra || [])].includes(subject)).length,
      }))
      .sort((a, b) => b.periods - a.periods)
  }, [slots, teachers])

  const maxLoad = Math.max(...ranked.map((r) => r.count), 1)
  const avgLoad = Math.round(ranked.reduce((a, r) => a + r.count, 0) / Math.max(1, ranked.length))
  const carrying = ranked.filter((r) => r.count > 0).length
  const idleRooms = roomRows.filter((r) => r.used === 0).length
  const fillPct = totalCapacity ? Math.round((slots.length / totalCapacity) * 100) : 0

  const heat = useMemo(() => {
    const bands = bandCoverage.length ? bandCoverage : [{ short: 'All', own: namedSections }]
    const rows = bands.map((b) => ({ label: b.short, list: b.own }))
    const cols = DAYS
    let max = 1
    for (const r of rows) for (const c of cols) max = Math.max(max, slots.filter((s) => s.day === c && r.list.some((x) => x.name === s.class_section)).length)
    return {
      rows,
      cols,
      max,
      value: (r, c) => slots.filter((s) => s.day === c && r.list.some((x) => x.name === s.class_section)).length,
    }
  }, [bandCoverage, namedSections, slots])

  const weekCurve = useMemo(
    () => ({
      xLabels: DAYS.map(DAY_SHORT),
      series: [
        { name: 'Assigned periods', tone: 'brand', values: DAYS.map((d) => slots.filter((s) => s.day === d).length) },
        { name: 'Classes in use', tone: 'sage', values: DAYS.map((d) => new Set(slots.filter((s) => s.day === d).map((s) => s.class_section)).size) },
        { name: 'Teachers on duty', tone: 'clay', values: DAYS.map((d) => new Set(slots.filter((s) => s.day === d && s.teacher_id).map((s) => String(s.teacher_id))).size) },
      ],
    }),
    [slots],
  )

  /* classSections arrive with the board, so the class to print is derived on
     every render — never captured in state at mount. */
  const chosenClass = printClass || classSections[0] || ''

  const buildJob = (cls) => ({
    classSection: cls,
    slots: slots.filter((s) => s.class_section === cls),
    school: settings?.school_name || 'ChronoCampus Public School',
    session: activeSession?.name ? `Session ${activeSession.name}` : 'Session 2026–27',
  })

  const openPrint = () => {
    if (!chosenClass) return
    setJob(buildJob(chosenClass))
    setPreview(true)
  }

  const sendToPrinter = () => {
    if (!chosenClass) return
    setJob(buildJob(chosenClass))
    setTimeout(() => window.print(), 120)
    pushToast?.({ tone: 'brand', title: 'Print dialog opened', message: `${chosenClass} laid out as one ink-first sheet.` })
  }

  const teacherColumns = [
    { key: 'name', header: 'Teacher', sortable: true, strong: true },
    { key: 'subject', header: 'Principal subject', sortable: true },
    { key: 'count', header: 'Periods', sortable: true, align: 'right', render: (r) => <span className="num tabular-nums">{r.count}</span> },
    {
      key: 'share',
      header: 'Share of week',
      sortable: true,
      sortValue: (r) => r.count,
      align: 'right',
      render: (r) => `${Math.round((r.count / WEEK_SLOTS) * 100)}%`,
    },
    {
      key: 'days',
      header: 'Mon → Sat',
      align: 'center',
      render: (r) => (
        <span
          className="inline-flex items-center gap-1.5 justify-center"
          role="img"
          aria-label={DAYS.map((d, i) => `${d.slice(0, 3)} ${r.days[i]}`).join(', ')}
        >
          {r.days.map((n, i) => (
            <span
              key={`${r.id}-d-${i}`}
              data-tone={n === 0 ? 'neutral' : n >= 6 ? 'warning' : 'brand'}
              title={`${DAYS[i]}: ${n} period${n === 1 ? '' : 's'}`}
              className="dot"
              style={{ opacity: n === 0 ? 0.35 : 1 }}
            />
          ))}
        </span>
      ),
    },
    { key: 'covers', header: 'Covers', sortable: true, align: 'right', render: (r) => <span className="num tabular-nums">{r.covers}</span> },
    {
      key: 'clashes',
      header: 'Clashes',
      sortable: true,
      align: 'right',
      render: (r) =>
        r.clashes ? <Chip tone="danger">{r.clashes}</Chip> : <span className="t3">—</span>,
    },
  ]

  const roomColumns = [
    { key: 'room', header: 'Room', sortable: true, strong: true },
    {
      key: 'kind',
      header: 'Type',
      sortable: true,
      render: (r) => <Chip tone={r.kind === 'practical' ? 'info' : 'neutral'}>{r.kind}</Chip>,
    },
    { key: 'used', header: 'Booked', sortable: true, align: 'right', render: (r) => <span className="num tabular-nums">{r.used}</span> },
    { key: 'free', header: 'Free', sortable: true, align: 'right', render: (r) => <span className="num tabular-nums t3">{r.free}</span> },
    { key: 'subjects', header: 'Subjects', sortable: true, align: 'right', render: (r) => <span className="num tabular-nums">{r.subjects}</span> },
    {
      key: 'pct',
      header: 'Utilisation',
      sortable: true,
      align: 'right',
      render: (r) => (
        <div className="w-[150px] ml-auto">
          <ProgressBar value={r.pct} max={100} showPct={false} label={`${r.pct}% of the week booked`} tone={r.pct === 0 ? 'danger' : r.pct > 60 ? 'warning' : 'brand'} />
        </div>
      ),
    },
  ]

  if (loading && !slots.length) {
    return (
      <>
        <SectionTitle title="Workload & utilisation" sub="Reading every saved period before counting anything." />
        <Card className="p-4">
          <SkeletonBoard />
        </Card>
      </>
    )
  }

  return (
    <>
      <SectionTitle
        eyebrow={`${classSections.length} active sections · ${teachers.length} staff · ${rooms.length} rooms`}
        title="Workload & utilisation"
        sub="Nothing here is a sample: every bar, ring and row is counted from the periods currently on the board."
        right={
          <>
            <Chip tone="brand" icon={Activity}>
              avg {avgLoad} pds / teacher
            </Chip>
            <Button variant="primary" icon={Printer} onClick={openPrint} disabled={!classSections.length}>
              Print view
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3">
        <Stat
          label="Periods scheduled"
          value={slots.length}
          sub={`of ${totalCapacity.toLocaleString('en-IN')} cells the classes can hold`}
          tone="brand"
          icon={CalendarDays}
        />
        <Stat
          label="Board fill"
          value={`${fillPct}%`}
          sub={`${totalCapacity - slots.length} cells still open`}
          tone={fillPct >= 90 ? 'success' : fillPct >= 60 ? 'warning' : 'danger'}
        />
        <Stat
          label="Teachers carrying load"
          value={`${carrying}/${teachers.length}`}
          sub={teachers.length - carrying ? `${teachers.length - carrying} with no period assigned` : 'every teacher is on the board'}
          tone={teachers.length - carrying ? 'warning' : 'success'}
          icon={Users2}
        />
        <Stat
          label="Clashes on the board"
          value={clashes.length}
          sub={clashes.length ? `${clashes.filter((c) => c.kind === 'teacher').length} teacher · ${clashes.filter((c) => c.kind === 'room').length} room` : 'no double bookings'}
          tone={clashes.length ? 'danger' : 'success'}
          icon={ShieldAlert}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-3 items-start mb-3">
        <Card className="p-4">
          <CardHead icon={Building2} title="Coverage vs capacity" sub="Each class measured against its own bell schedule." className="px-0 pt-0 pb-2" />
          <div className="grid gap-3">
            {bandCoverage.length ? (
              bandCoverage.map((b) => (
                <div key={b.band} className="grid gap-1.5">
                  <Ring
                    value={b.used}
                    max={b.cap}
                    tone={b.pct >= 90 ? 'success' : b.pct >= 60 ? 'brand' : 'warning'}
                    size={68}
                    label={b.band}
                    sub={`${b.used} of ${b.cap} cells · ${b.sectionCount} section${b.sectionCount === 1 ? '' : 's'}`}
                  />
                </div>
              ))
            ) : (
              <EmptyState icon={Building2} title="No sections on record" hint="Add classes in the register to measure coverage." />
            )}
          </div>
        </Card>

        <ChartCard
          className="lg:col-span-2"
          title="The week in one line"
          sub="Assigned periods, classes actually teaching and staff on duty, day by day."
          right={<Chip tone="neutral">{WEEK_SLOTS} bells a class could hold</Chip>}
          footer={`Substitutions running this week: ${slots.filter((s) => s.is_substitution).length} · rooms never booked: ${idleRooms}`}
        >
          <AreaLine series={weekCurve.series} xLabels={weekCurve.xLabels} height={220} />
          <div className="mt-3 grid gap-2.5">
            <HeatGrid rows={heat.rows} cols={heat.cols} value={heat.value} tone="brand" max={heat.max} />
          </div>
        </ChartCard>
      </div>

      <ChartBand
        slots={slots}
        teachers={teachers}
        sections={namedSections}
        rooms={rooms}
        weekSlots={WEEK_SLOTS}
      />

      <div className="grid lg:grid-cols-[1.1fr_1fr] gap-3 items-start mt-3">
        <ChartCard title="Subject demand" sub="periods on the board against the staff who can teach them">
          <HBarList
            data={subjectRows.slice(0, 12).map((s) => ({
              label: s.subject,
              value: s.periods,
              sub: `${s.staff} staff · ${s.classes} class${s.classes === 1 ? '' : 'es'}`,
              tone: s.staff ? subjectTone(s.subject) : 'danger',
            }))}
            max={subjectRows[0]?.periods || 1}
          />
          {subjectRows.some((s) => !s.staff) ? (
            <p className="meta mt-2.5 leading-relaxed">
              {subjectRows.filter((s) => !s.staff).length} subject
              {subjectRows.filter((s) => !s.staff).length === 1 ? '' : 's'} on the board no teacher in the directory lists —
              red bars are the ones to staff.
            </p>
          ) : null}
        </ChartCard>

        <ChartCard title="Where the load sits" sub="periods per teacher, heaviest first" footer={`heaviest ${maxLoad} · average ${avgLoad} · a teacher past ${Math.round(avgLoad * 1.6)} has little slack for cover`}>
          <HBarList
            data={ranked
              .filter((r) => r.count)
              .slice(0, 12)
              .map((r) => ({
                label: r.name,
                value: r.count,
                sub: r.subject,
                tone: r.count > avgLoad * 1.6 ? 'danger' : r.count < avgLoad * 0.4 ? 'info' : 'brand',
              }))}
            max={maxLoad}
          />
        </ChartCard>
      </div>

      <div className="mt-3">
        <DataTable
          columns={teacherColumns}
          rows={ranked}
          getRowId={(r) => String(r.id)}
          searchKeys={(r, q) => `${r.name} ${r.subject}`.toLowerCase().includes(q)}
          searchPlaceholder="Search teachers"
          toolbar={
            <span className="meta min-w-0">
              one dot per day, Mon → Sat · amber = six or more periods that day, the point where a teacher has no free period
              left to give as cover
            </span>
          }
          pageSize={12}
          initialSort={{ key: 'count', dir: 'desc' }}
          empty={
            <EmptyState
              icon={Users2}
              title="No staff to measure"
              hint="The teacher directory is empty, so there is no workload to report."
            />
          }
        />
      </div>

      <div className="mt-3">
        <DataTable
          columns={roomColumns}
          rows={roomRows}
          getRowId={(r) => r.room}
          searchPlaceholder="Search rooms and labs"
          pageSize={12}
          initialSort={{ key: 'used', dir: 'desc' }}
          empty={
            <EmptyState
              icon={FlaskConical}
              title="No rooms configured"
              hint="Add rooms in school settings and their booking share appears here."
            />
          }
        />
      </div>

      {clashes.length ? (
        <Alert className="mt-3" tone="danger" title={`${clashes.length} double booking${clashes.length === 1 ? '' : 's'} inherited by the board`} icon={ShieldAlert}>
          <ul className="grid list-none m-0 p-0 gap-1 sm:grid-cols-2 lg:grid-cols-3 mt-1">
            {clashes.slice(0, 9).map((c, i) => (
              <li key={`${c.kind}-${c.day}-${c.period}-${i}`} className="flex items-start gap-2 text-xs min-w-0">
                <span className="num text-2xs uppercase t3 shrink-0">
                  {DAY_SHORT(c.day)} P{Number(c.period)}
                </span>
                <span className="min-w-0">
                  <strong className="t1">{c.who}</strong> — {c.detail}
                </span>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card className="p-4 mt-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow mb-1">Notice-board print</p>
            <h2 className="display text-lg font-bold">One class per sheet</h2>
            <p className="lede mt-1">
              The sheet is laid out from the class’s own bell schedule and its breaks. Ink first: glass, colour and app chrome
              all drop away on paper.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <SearchSelect
              className="w-full sm:w-[230px]"
              label="Class to print"
              value={chosenClass}
              onChange={setPrintClass}
              options={classSections.map((c) => ({ value: c, label: c, hint: `${slots.filter((s) => s.class_section === c).length} periods` }))}
              placeholder="Choose a class"
              searchPlaceholder="Search a class"
            />
            <Button icon={Printer} onClick={openPrint} disabled={!chosenClass}>
              Preview
            </Button>
            <Button variant="primary" icon={Printer} onClick={sendToPrinter} disabled={!chosenClass}>
              Print now
            </Button>
          </div>
        </div>
      </Card>

      <Modal
        open={preview}
        onClose={() => setPreview(false)}
        title="Print preview"
        sub={job ? `${job.classSection} · exactly what reaches the printer.` : 'Pick a class first.'}
        width="max-w-[900px]"
        icon={Printer}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(false)}>
              Close
            </Button>
            <Button variant="primary" icon={Printer} onClick={sendToPrinter}>
              Print notice board
            </Button>
          </>
        }
      >
        {job ? (
          <div className="overflow-x-auto rounded-[12px] border border-[color:var(--color-line)]">
            <NoticeBoardSheet {...job} />
          </div>
        ) : null}
      </Modal>

      <PrintLayer job={job} />
    </>
  )
}
