import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  BookOpen,
  CalendarRange,
  Clock,
  KeyRound,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  UserCog,
} from 'lucide-react'
import { db, EMAIL_SHAPE } from '../../lib/supabase'
import { useApp } from '../../context/AppContext'
import { useSchoolData } from '../../hooks/useSchool'
import { DAYS, periodsFor, scheduleFor, weekCapacity } from '../../lib/bellSchedule'
import { allSubjects } from '../../lib/subjects'
import { CLASS_CHOICES, GRADES, PRE_PRIMARY, STREAMS, curriculumForStream, homeRoomFor, isPrePrimary, letterOptions, sectionMeta, sectionName } from '../../lib/schoolSeed'
import {
  Alert,
  Avatar,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  CopyButton,
  Divider,
  Dropdown,
  EmptyState,
  Field,
  IconButton,
  Input,
  KeyValue,
  MenuItem,
  Modal,
  PageHeader,
  SearchInput,
  SearchSelect,
  SectionTitle,
  Select,
  Stat,
  cx,
} from '../../components/ui/primitives'
import { DataTable } from '../../components/ui/DataTable'
import { ProgressBar } from '../../components/ui/charts'
import ImportPanel from '../../components/ImportPanel'

/* ------------------------------------------------------------- directories -- */

const SIGN_IN_HINT = 'The address they sign in with, so it has to be the one their identity provider returns.'

/**
 * Everything the directory screen does is driven from this map: the columns, the
 * spreadsheet fields and the form fields. A new directory is an entry here, not a
 * second page.
 */
const DIRECTORY_CONFIG = {
  admin: {
    table: 'allowed_admins',
    title: 'Administrator directory',
    eyebrow: 'People · administrators',
    sub: 'Anyone on this list becomes an admin the moment they first sign in. Removing a name withdraws access without deleting history.',
    singular: 'administrator',
    fields: ['full_name', 'email', 'designation'],
    template: [
      { key: 'full_name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'designation', label: 'Designation' },
    ],
    sample: [
      { full_name: 'Col. S. S. Gill (Retd.)', email: 'principal@school.edu.in', designation: 'Principal' },
      { full_name: 'Harjit Kaur Sekhon', email: 'vp@school.edu.in', designation: 'Vice Principal' },
    ],
    columns: [['full_name', 'Name'], ['designation', 'Designation']],
    form: [
      { key: 'full_name', label: 'Name', required: true, placeholder: 'Harjit Kaur Sekhon' },
      { key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'vp@chronocampus.edu.in', hint: SIGN_IN_HINT },
      { key: 'designation', label: 'Designation', placeholder: 'Vice Principal' },
    ],
    icon: UserCog,
  },
  teacher: {
    table: 'allowed_teachers',
    title: 'Teacher directory',
    eyebrow: 'People · teaching staff',
    sub: 'The subject column drives free-substitute matching and workload analytics, so it is worth getting right.',
    singular: 'teacher',
    fields: ['full_name', 'email', 'subject', 'phone', 'employee_id'],
    template: [
      { key: 'full_name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'subject', label: 'Subject' },
      { key: 'phone', label: 'Phone' },
      { key: 'employee_id', label: 'Employee ID' },
    ],
    sample: [
      { full_name: 'Dr. Neelam Kaur', email: 'neelam.kaur@school.edu.in', subject: 'Physics', phone: '+91 98765 43210', employee_id: 'CC-T-0141' },
      { full_name: 'Amarjeet Kaur', email: 'amarjeet.kaur@school.edu.in', subject: 'Mathematics', phone: '+91 98765 43212', employee_id: 'CC-T-0108' },
    ],
    columns: [['full_name', 'Name'], ['subject', 'Subject'], ['employee_id', 'Staff ID'], ['phone', 'Phone']],
    form: [
      { key: 'full_name', label: 'Name', required: true, placeholder: 'Dr. Neelam Kaur' },
      { key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'neelam.kaur@chronocampus.edu.in', hint: SIGN_IN_HINT },
      {
        key: 'subject',
        label: 'Main subject',
        type: 'subject',
        required: true,
        requiredText: 'A teacher with no subject cannot be matched to a free period.',
        placeholder: 'Physics',
        hint: 'What they teach first. Substitute matching and workload both read this.',
      },
      { key: 'phone', label: 'Phone', placeholder: '+91 98765 43210' },
      { key: 'employee_id', label: 'Employee ID', placeholder: 'CC-T-0141' },
    ],
    icon: BadgeCheck,
  },
  student: {
    table: 'allowed_students',
    title: 'Student directory',
    eyebrow: 'People · students',
    sub: 'Students authenticate with these addresses. A name here is necessary but not sufficient — they must still verify a class code.',
    singular: 'student',
    promote: true,
    fields: ['full_name', 'email', 'admission_number'],
    template: [
      { key: 'full_name', label: 'Name' },
      { key: 'email', label: 'School Email' },
      { key: 'admission_number', label: 'Admission Number' },
    ],
    sample: [
      { full_name: 'Gurpreet Singh Sandhu', email: 'gurpreet.sandhu@student.school.edu.in', admission_number: 'CC-2024-1187' },
      { full_name: 'Aanya Iyer', email: 'aanya.iyer@student.school.edu.in', admission_number: 'CC-2024-1102' },
    ],
    columns: [['full_name', 'Name'], ['admission_number', 'Admission no.'], ['class_section', 'Class']],
    form: [
      { key: 'full_name', label: 'Name', required: true, placeholder: 'Aanya Iyer' },
      { key: 'email', label: 'School Email', type: 'email', required: true, placeholder: 'aanya.iyer@student.chronocampus.edu.in', hint: SIGN_IN_HINT },
      { key: 'admission_number', label: 'Admission number', placeholder: 'CC-2024-1102' },
      {
        key: 'class_section_id',
        label: 'Class',
        type: 'section',
        required: true,
        requiredText: 'Pick the class this student sits in.',
        hint: 'Seating a student here enrols them for the open session, and is written to the audit log exactly as a verified class code is.',
      },
    ],
    icon: Layers,
  },
}

const joinList = (list = []) => (list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`)

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

const blankValues = (cfg) => ({ grade: '', ...Object.fromEntries(cfg.form.map((f) => [f.key, ''])) })

/** The row is the form's starting point; the class comes back through the enrollment the directory exposes. */
const valuesFromRow = (cfg, row, sections) => {
  const values = blankValues(cfg)
  for (const f of cfg.form) values[f.key] = row[f.key] == null ? '' : String(row[f.key])
  const seated = sections.find((s) => s.name === row.class_section)
  if (seated) {
    values.grade = String(seated.grade)
    values.class_section_id = seated.id
  }
  return values
}

function formErrors(cfg, values) {
  const errors = {}
  for (const f of cfg.form) {
    const v = String(values[f.key] ?? '').trim()
    if (f.required && !v) {
      errors[f.key] = f.requiredText || `${f.label} is required.`
      continue
    }
    if (f.type === 'email' && v && !EMAIL_SHAPE.test(v))
      errors[f.key] = 'This needs the form name@school.edu.in — nothing can be authorized against it as typed.'
  }
  return errors
}

export function DirectoryPage({ kind }) {
  const cfg = DIRECTORY_CONFIG[kind]
  const { admins, teachers, studentDirectory, sections, sessions, activeSession, slots, loading, reload } = useSchoolData()
  const { pushToast } = useApp()
  const rows = kind === 'admin' ? admins : kind === 'teacher' ? teachers : studentDirectory
  const [confirm, setConfirm] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [removal, setRemoval] = useState(null)
  const [promoting, setPromoting] = useState(null)
  const [busy, setBusy] = useState(false)

  const activeSections = useMemo(() => sections.filter((s) => s.is_active), [sections])

  const onImport = useCallback(
    async (parsed) => {
      const res = await db.upsertDirectory(kind, parsed.rows)
      await reload()
      return res
    },
    [kind, reload],
  )

  const toggleActive = async (row) => {
    await db.setDirectoryActive(kind, row.email, row.is_active === false)
    await reload()
    pushToast({
      tone: 'success',
      title: row.is_active === false ? 'Access restored' : 'Access withdrawn',
      message: `${row.full_name} ${row.is_active === false ? 'can sign in again' : 'can no longer sign in'}. Academic history was kept.`,
    })
    setConfirm(null)
  }

  /**
   * What still points at this person, read off the data the page already holds,
   * so the dialog can name the consequence before it happens. The service counts
   * it again at deletion time and refuses what a school cannot survive.
   */
  const impactOf = useCallback(
    (row) => {
      if (kind === 'teacher')
        return {
          periods: slots.filter((x) => String(x.teacher_id) === String(row.id)).length,
          mentor_of: sections.filter((c) => String(c.mentor_teacher_id) === String(row.id) && c.is_active).map((c) => c.name),
        }
      if (kind === 'student') return { enrolled: row.class_section || null, session: row.academic_session || null }
      return { admins_left: admins.filter((a) => a.is_active !== false && String(a.id) !== String(row.id)).length }
    },
    [kind, slots, sections, admins],
  )

  const removalBody = (row, impact) => {
    if (kind === 'teacher') {
      const lines = [
        impact.periods
          ? `${row.full_name} holds ${plural(impact.periods, 'period', 'periods')} this week. Deleting them leaves those ${impact.periods} ${impact.periods === 1 ? 'cell' : 'cells'} on the board with no teacher assigned — the class keeps the bell slot and someone has to be booked into it again.`
          : `${row.full_name} holds no periods this week, so nothing on the board changes.`,
      ]
      if (impact.mentor_of.length)
        lines.push(`They are the class teacher of ${joinList(impact.mentor_of)}. Those home rooms go empty until you name someone else.`)
      lines.push('Their leave records and cover assignments go with them; periods already taught are not rewritten.')
      return lines
    }
    if (kind === 'student') {
      if (impact.enrolled)
        return [
          `${row.full_name} is enrolled in ${impact.enrolled}${impact.session ? ` for ${impact.session}` : ''}.`,
        ]
      return [
        `${row.full_name} has no active enrollment, so no class record depends on this row.`,
        'Deleting is permanent — deactivating closes the same door and can be undone.',
      ]
    }
    return [
      `${row.full_name} loses admin sign-in for good.`,
      impact.admins_left
        ? `${plural(impact.admins_left, 'active administrator remains', 'active administrators remain')} on the directory.`
        : '',
    ].filter(Boolean)
  }

  const refusalOf = (row, impact) => {
    if (kind === 'student' && impact.enrolled)
      return `${row.full_name} is enrolled in ${impact.enrolled}. Deleting a student deletes the enrollment history their academic record is made of, so this school only lets you deactivate one.`
    if (kind === 'admin' && row.is_active !== false && !impact.admins_left)
      return 'This is the only active administrator. Deleting it would leave the school with nobody who can administer it — add another administrator first.'
    return null
  }

  const askRemove = (row) => setRemoval({ row, impact: impactOf(row), refusal: null })

  const confirmRemove = async () => {
    const { row } = removal
    setBusy(true)
    try {
      const done = await db.deleteDirectoryRow(kind, row.id)
      await reload()
      setRemoval(null)
      pushToast({
        tone: 'warning',
        title: `${done.full_name} removed from the ${cfg.title.toLowerCase()}`,
        message:
          done.kind === 'teacher'
            ? done.periods
              ? `${plural(done.periods, 'period', 'periods')} stayed on the board with no teacher assigned${done.mentor_of?.length ? `, and ${plural(done.mentor_of.length, 'home room', 'home rooms')} lost their class teacher` : ''}.`
              : 'They held no periods, so nothing on the board changed.'
            : done.kind === 'student'
              ? done.enrollments
                ? `${plural(done.enrollments, 'enrollment record', 'enrollment records')} went with them.`
                : 'They had no enrollment records.'
              : `${plural(done.admins_left, 'active administrator', 'active administrators')} left on the directory.`,
      })
    } catch (err) {
      setRemoval((r) => ({ ...r, refusal: err.message }))
    } finally {
      setBusy(false)
    }
  }

  const startAdd = () => setSheet({ mode: 'add', values: blankValues(cfg), touched: {} })
  const startEdit = (row) => setSheet({ mode: 'edit', id: row.id, values: valuesFromRow(cfg, row, sections), touched: {} })
  const closeSheet = () => setSheet(null)
  const setValue = (key, v) => setSheet((s) => ({ ...s, values: { ...s.values, [key]: v }, touched: { ...s.touched, [key]: true }, serverError: null }))

  const errors = sheet ? formErrors(cfg, sheet.values) : {}
  const canSave = Boolean(sheet) && !Object.keys(errors).length && !busy

  const submitSheet = async () => {
    if (!canSave) return
    setBusy(true)
    try {
      const res = await db.saveDirectoryRow(kind, { ...sheet.values, id: sheet.id || undefined })
      await reload()
      setSheet(null)
      const seated = res.enrolled && res.enrolled.from !== res.enrolled.to
      pushToast({
        tone: 'success',
        title: res.created ? `${cfg.singular[0].toUpperCase()}${cfg.singular.slice(1)} added` : `${cfg.singular[0].toUpperCase()}${cfg.singular.slice(1)} updated`,
        message: seated
          ? `${res.row.full_name} is seated in ${res.enrolled.to} for ${res.enrolled.session_name}${res.enrolled.from ? `, having left ${res.enrolled.from}` : ''}.`
          : `${res.row.full_name} is on the ${cfg.title.toLowerCase()}. ${res.created ? 'They can sign in as soon as their address matches.' : 'The change applies the next time the school reads the directory.'}`,
      })
    } catch (err) {
      setSheet((s) => ({ ...s, serverError: err.message }))
    } finally {
      setBusy(false)
    }
  }

  const emailCounts = useMemo(() => {
    const seen = new Map()
    for (const r of rows) {
      const k = String(r.email).toLowerCase()
      seen.set(k, (seen.get(k) || 0) + 1)
    }
    return [...seen.values()].filter((n) => n > 1).length
  }, [rows])

  const columns = cfg.columns.map(([key, label], i) => ({
    key,
    header: label,
    sortable: true,
    strong: i === 0,
    render:
      i === 0
        ? (r) => (
            <span className="flex items-center gap-2.5 min-w-0">
              <Avatar name={r.full_name} size="sm" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold t1 truncate">{r.full_name || '—'}</span>
                {key !== 'full_name' && r[key] ? <span className="block meta truncate">{r[key]}</span> : null}
              </span>
            </span>
          )
        : (r) => (r[key] ? <span className="text-sm t2 block max-w-[220px] truncate" title={String(r[key])}>{r[key]}</span> : <span className="t3">—</span>),
  }))
  columns.push({
    key: 'email',
    header: 'Email',
    sortable: true,
    render: (r) => (
      <span className="block text-2xs t2 truncate max-w-[240px]" style={{ fontFamily: 'var(--font-mono)' }} title={r.email}>
        {r.email}
      </span>
    ),
  })
  columns.push({
    key: 'access',
    header: 'Access',
    align: 'center',
    render: (r) =>
      r.is_active === false ? (
        <Chip tone="danger" dot>
          inactive
        </Chip>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-2xs t3">
          <span className="dot" data-tone="success" aria-hidden />
          active
        </span>
      ),
  })
  columns.push({
    key: 'actions',
    header: '',
    align: 'right',
    render: (r) => (
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {cfg.promote && r.is_active !== false ? (
          <IconButton
            label={`Change ${r.full_name}'s class`}
            icon={ArrowUpRight}
            size="sm"
            tone="brand"
            onClick={() => setPromoting(r)}
          />
        ) : null}
        <IconButton label={`Edit ${r.full_name}`} icon={Pencil} size="sm" onClick={() => startEdit(r)} />
        <IconButton label={`Delete ${r.full_name} from the ${cfg.title.toLowerCase()}`} icon={Trash2} size="sm" tone="danger" onClick={() => askRemove(r)} />
        <Button
          size="sm"
          variant={r.is_active === false ? 'default' : 'danger'}
          onClick={() => setConfirm(r)}
        >
          {r.is_active === false ? 'Restore' : 'Deactivate'}
        </Button>
      </div>
    ),
  })

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={cfg.eyebrow}
        title={cfg.title}
        sub={cfg.sub}
        icon={cfg.icon}
        breadcrumbs={[{ label: 'Home', to: '/admin' }, { label: 'People' }, { label: cfg.title }]}
        actions={
          <Button variant="primary" icon={Plus} onClick={startAdd}>
            Add {cfg.singular}
          </Button>
        }
      />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-3">
        <Stat label="Records" value={rows.length} sub={`in public.${cfg.table}`} tone="brand" />
        <Stat label="Active" value={rows.filter((r) => r.is_active !== false).length} sub="can sign in" tone="success" />
        <Stat
          label="Deactivated"
          value={rows.filter((r) => r.is_active === false).length}
          sub="access withdrawn"
          tone={rows.some((r) => r.is_active === false) ? 'danger' : 'neutral'}
        />
        <Stat label="Duplicate emails" value={emailCounts} sub={emailCounts ? 'resolve these' : 'none found'} tone={emailCounts ? 'warning' : 'neutral'} />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-3 items-start">
        <div className="min-w-0">
          <SectionTitle
            title="Directory records"
            sub="Deactivating keeps the person's academic history intact — it only closes the door. Deleting is permanent and is refused where it would cost the school a record."
            right={<Chip tone="neutral">{plural(rows.length, 'row', 'rows')}</Chip>}
          />
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            getRowId={(r) => r.email || r.id}
            searchKeys={Array.from(new Set([...cfg.fields, 'class_section', 'academic_session']))}
            searchPlaceholder={`Search ${cfg.singular}s`}
            initialSort={{ key: 'full_name', dir: 'asc' }}
            empty={
              <Card className="px-4 py-2">
                <EmptyState
                  icon={cfg.icon}
                  title="This directory is empty"
                  hint="Import a spreadsheet on the right, or add one name above. Until then no address in it can be authorized."
                  action={
                    <Button variant="primary" icon={Plus} onClick={startAdd}>
                      Add {cfg.singular}
                    </Button>
                  }
                />
              </Card>
            }
          />
        </div>

        <ImportPanel
          title={`Import ${cfg.title.toLowerCase()}`}
          fields={cfg.fields}
          template={cfg.template}
          sample={cfg.sample}
          filename={`chrono-campus-${kind}-template.csv`}
          onImport={onImport}
        />
      </div>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => toggleActive(confirm)}
        title={confirm?.is_active === false ? 'Restore access?' : 'Withdraw access?'}
        body={
          <div className="flex flex-col gap-2.5">
            <p>
              {confirm?.is_active === false
                ? `${confirm?.full_name} will be able to sign in again with their existing role.`
                : `${confirm?.full_name} will be denied at sign-in from now on. Their timetable, homework and enrollment history are not deleted.`}
            </p>
            <p className="meta">Deactivating is reversible; nothing academic is lost either way.</p>
          </div>
        }
        confirmLabel={confirm?.is_active === false ? 'Restore access' : 'Withdraw access'}
      />

      {sheet ? (
        <DirectorySheet
          cfg={cfg}
          sheet={sheet}
          errors={errors}
          canSave={canSave}
          busy={busy}
          sections={sections}
          setValue={setValue}
          onClose={closeSheet}
          onSubmit={submitSheet}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(removal)}
        onClose={() => { setRemoval(null); setBusy(false) }}
        onConfirm={confirmRemove}
        tone="danger"
        busy={busy}
        confirmLabel={removal && refusalOf(removal.row, removal.impact) ? 'Try deleting anyway' : 'Delete permanently'}
        title={`Delete ${removal?.row.full_name || ''}?`}
        body={
          removal ? (
            <div className="flex flex-col gap-2.5">
              {removalBody(removal.row, removal.impact).map((line) => (
                <p key={line} className="m-0">
                  {line}
                </p>
              ))}
              {refusalOf(removal.row, removal.impact) || removal.refusal ? (
                <Alert tone="danger" title={removal.refusal ? 'Nothing was deleted' : 'This record cannot be deleted'}>
                  {removal.refusal || refusalOf(removal.row, removal.impact)}
                </Alert>
              ) : null}
              <p className="meta">Deactivating the record instead closes the same door and can be undone.</p>
            </div>
          ) : null
        }
      />

      <PromoteSheet
        student={promoting}
        sections={activeSections}
        sessions={sessions}
        activeSession={activeSession}
        onClose={() => setPromoting(null)}
        onMoved={async (moved) => {
          await reload()
          pushToast({
            tone: 'success',
            title: `${moved.student.full_name} moved to ${moved.to}`,
            message: moved.from
              ? `Their ${moved.from} enrollment for ${moved.session_name} was superseded, not deleted — the history is still there.`
              : `Seated in ${moved.to} for ${moved.session_name}. They had no class before this.`,
          })
          setPromoting(null)
        }}
      />
    </div>
  )
}

/** One form for all three directories, laid out from cfg.form. */
function DirectorySheet({ cfg, sheet, errors, canSave, busy, sections, setValue, onClose, onSubmit }) {
  const editing = sheet.mode === 'edit'
  // An archived class cannot take a new student, but it has to stay visible when
  // the record being edited is still seated there.
  const open = sections.filter((s) => s.is_active || String(s.id) === String(sheet.values.class_section_id))
  // Grades are labels, not numbers: the early-years wing sits in the same list as 1–12.
  const grades = CLASS_CHOICES.map((g) => String(g)).filter((g) => open.some((s) => String(s.grade) === g))
  const chosen = open.find((s) => String(s.id) === String(sheet.values.class_section_id))

  return (
    <Modal
      open
      onClose={onClose}
      icon={cfg.icon}
      tone="brand"
      width="max-w-md"
      title={editing ? `Edit ${sheet.values.full_name || cfg.singular}` : `Add a ${cfg.singular}`}
      sub={
        editing
          ? `Saves over the existing ${cfg.singular} record — the row is matched by id, so nothing is duplicated.`
          : `A new ${cfg.singular} can sign in with this address as soon as the row exists.`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={BadgeCheck} onClick={onSubmit} disabled={!canSave}>
            {busy ? 'Writing…' : editing ? 'Save changes' : `Add ${cfg.singular}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {cfg.form.map((f) =>
          f.type === 'section' ? (
            <div key={f.key} className="flex flex-col gap-2">
              <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2 items-end">
                <Field label="Class" required={f.required}>
                  <Select
                    aria-label="Class grade"
                    value={sheet.values.grade}
                    onChange={(e) => {
                      const grade = e.target.value
                      setValue('grade', grade)
                      if (grade && chosen && String(chosen.grade) !== String(grade)) setValue('class_section_id', '')
                    }}
                  >
                    <option value="">Class…</option>
                    {grades.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </Select>
                </Field>
                <SearchSelect
                  label="Section"
                  required={f.required}
                  value={sheet.values.class_section_id}
                  onChange={(v) => setValue('class_section_id', v)}
                  options={open
                    .filter((s) => !sheet.values.grade || String(s.grade) === String(sheet.values.grade))
                    .map((s) => ({
                      value: s.id,
                      label: `${s.section}${s.stream && s.stream !== 'General' ? ` · ${s.stream}` : ''}`,
                      hint: `${s.default_room || 'no room'} · ${s.enrolled ?? 0} enrolled`,
                    }))}
                  placeholder={sheet.values.grade ? 'Which section…' : 'Pick a class first'}
                  searchPlaceholder="Search section or room"
                  emptyText="No open class carries that letter."
                  error={sheet.touched[f.key] ? errors[f.key] : undefined}
                />
              </div>
              <p className="field-hint !mt-0">
                {f.required && !sheet.values[f.key] && !sheet.touched[f.key] ? f.requiredText || f.hint : f.hint}
              </p>
            </div>
          ) : (
            <Field
              key={f.key}
              label={f.label}
              required={f.required}
              hint={f.required && !sheet.values[f.key] && !sheet.touched[f.key] ? f.requiredText || f.hint : f.hint}
              error={sheet.touched[f.key] ? errors[f.key] : undefined}
            >
              <Input
                type={f.type === 'email' ? 'email' : 'text'}
                list={f.type === 'subject' ? 'cc-directory-subjects' : undefined}
                value={sheet.values[f.key]}
                placeholder={f.placeholder}
                invalid={Boolean(sheet.touched[f.key] && errors[f.key])}
                onChange={(e) => setValue(f.key, e.target.value)}
              />
            </Field>
          )
        )}

        {cfg.form.some((f) => f.type === 'subject') ? (
          <datalist id="cc-directory-subjects">
            {allSubjects.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        ) : null}

        {sheet.serverError ? (
          <Alert tone="danger" title="The school did not accept that">
            {sheet.serverError}
          </Alert>
        ) : null}
      </div>
    </Modal>
  )
}

/** Move an enrolled student to another class without touching their history. */
function PromoteSheet({ student, sections, sessions, activeSession, onClose, onMoved }) {
  const [target, setTarget] = useState('')
  const [session, setSession] = useState(activeSession?.name || '')
  const [refusal, setRefusal] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!student) return
    setTarget('')
    setSession(activeSession?.name || '')
    setRefusal(null)
    setBusy(false)
  }, [student, activeSession])

  if (!student) return null

  const invalid = !target || !session
  const current = student.class_section || null

  const move = async () => {
    if (invalid) return
    setBusy(true)
    try {
      const moved = await db.promoteStudent(student.id, { sectionName: target, sessionName: session })
      await onMoved(moved)
    } catch (err) {
      setRefusal(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      icon={ArrowUpRight}
      tone="brand"
      width="max-w-md"
      title={`Change class · ${student.full_name}`}
      sub="Their enrollment history stays where it is: the current one is marked superseded and a new one opens in the class you pick."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={ArrowUpRight} onClick={move} disabled={invalid || busy}>
            {busy ? 'Moving…' : 'Move student'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Card tone="brand" className="p-4">
          <KeyValue
            cols={1}
            rows={[
              ['Student', student.full_name],
              ['Now in', current ? `${current}${student.academic_session ? ` · ${student.academic_session}` : ''}` : 'no class — not verified yet'],
              student.admission_number ? ['Admission', student.admission_number] : null,
            ]}
          />
        </Card>

        <SearchSelect
          label="New class"
          required
          value={target}
          onChange={(v) => { setTarget(v); setRefusal(null) }}
          options={sections.map((s) => ({ value: s.name, label: s.name, hint: s.default_room || 'no home room' }))}
          placeholder="Which class are they moving into…"
          searchPlaceholder="Search class or room"
          emptyText="No open class matches that name."
          error={!target && refusal ? refusal : undefined}
        />

        <Field label="Academic session" required hint="A new session is how a student moves up a year; the class alone is a mid-year re-seat.">
          <Select value={session} onChange={(e) => { setSession(e.target.value); setRefusal(null) }} aria-label="Academic session">
            {!sessions.some((s) => s.name === session) ? <option value="">Session…</option> : null}
            {sessions.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
                {s.is_active ? ' · open' : s.status === 'closed' ? ' · closed' : ''}
              </option>
            ))}
          </Select>
        </Field>

        {refusal && target ? (
          <Alert tone="danger" title="The student did not move">
            {refusal}
          </Alert>
        ) : null}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------- classes/sections --- */

const BLANK = { id: null, name: '', grade: '', section: '', stream: '', mentor_teacher_id: '' }

/** One line for a card: the group, how many bells, and when the class leaves. */
function bellSummary(name) {
  const s = scheduleFor(name)
  if (!s) return 'the school default day'
  const out = s.departure || s.departure_time ? ` · out ${String(s.departure || s.departure_time).slice(0, 5)}` : ''
  const group = s.applies_to === 'early' ? 'early years' : s.applies_to === 'senior' ? 'senior' : 'junior'
  return `${group} · ${s.periods?.length || 0} bells${out}`
}

/**
 * What the class's bell schedule actually says, rather than what the screen
 * remembers: the early-years wing, the junior day and the senior day all differ,
 * and an administrator may have edited any of them.
 */
function bellFacts(name) {
  const s = scheduleFor(name)
  if (!s?.periods?.length) return { label: 'the school default day', length: '—', breakLine: '—' }
  const rows = s.periods
  const gapAt = rows.findIndex((p, i) => i > 0 && p.start > rows[i - 1].end)
  return {
    label: s.name,
    length: `${rows.length} periods · out ${s.departure || '—'}`,
    breakLine:
      gapAt > 0
        ? `after period ${rows[gapAt - 1].n} · ${rows[gapAt - 1].end}–${rows[gapAt].start}`
        : 'none — one continuous day',
  }
}

export function SectionsPage() {
  const { sections, teachers, slots, reload } = useSchoolData()
  const { pushToast } = useApp()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [gradeFilter, setGradeFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [subjectsFor, setSubjectsFor] = useState(null)
  const [customStream, setCustomStream] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [usage, setUsage] = useState(null)

  const editing = Boolean(form.id)
  const existing = useMemo(() => sections.filter((s) => s.id !== form.id).map((s) => s.name), [sections, form.id])
  const duplicate = Boolean(form.name && existing.includes(form.name))

  /* A grade is either a number (1–12) or one of the early-years class names. */
  const grade = isPrePrimary(form.grade) ? form.grade : Number(form.grade) || 1
  const prePrimary = isPrePrimary(grade)
  const senior = !prePrimary && Number(grade) >= 11

  /** Two sections that share a letter cannot share a room, so walk to the next free one. */
  const nextFreeRoom = (g, letter, exceptId = null) => {
    const used = new Set(sections.filter((s) => s.id !== exceptId).map((s) => s.default_room))
    if (isPrePrimary(g)) {
      const wing = PRE_PRIMARY.indexOf(g) + 1
      let n = Math.max(1, String(letter).toUpperCase().charCodeAt(0) - 64)
      let room = homeRoomFor(g, letter)
      while (used.has(room)) room = `Activity Room ${wing}${String.fromCharCode(64 + (n += 1))}`
      return room
    }
    let n = Math.max(1, String(letter).toUpperCase().charCodeAt(0) - 64)
    let room = `Room ${g}${n}0`
    while (used.has(room)) room = `Room ${g}${(n += 1)}0`
    return room
  }

  const derivedRoom = form.grade && form.section ? nextFreeRoom(grade, form.section, form.id) : ''
  const derivedStream = sectionMeta(grade, form.section || 'A').stream
  const bell = bellFacts(sectionName(grade, form.section || 'A'))

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    return CLASS_CHOICES.map((g) => ({
      grade: g,
      rows: sections
        .filter((s) => String(s.grade) === String(g))
        .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.default_room || '').toLowerCase().includes(q))
        .sort((a, b) => String(a.section).localeCompare(String(b.section))),
    })).filter((g) => g.rows.length && (gradeFilter === 'all' || gradeFilter === String(g.grade)))
  }, [sections, gradeFilter, query])

  const reset = () => setForm(BLANK)

  const start = () => {
    reset()
    setCustomStream(false)
    setOpen(true)
  }

  const edit = (s) => {
    setCustomStream(Boolean(s.stream && s.stream !== 'General' && !STREAMS.includes(s.stream)))
    setForm({
      id: s.id,
      name: s.name,
      grade: String(s.grade),
      section: s.section,
      stream: s.stream === 'General' ? '' : s.stream,
      mentor_teacher_id: s.mentor_teacher_id || '',
    })
    setOpen(true)
  }

  const save = async () => {
    const meta = sectionMeta(grade, form.section)
    const stream = senior ? form.stream || meta.stream : 'General'
    const previous = form.id ? sections.find((s) => s.id === form.id) : null
    // Two streams can share a letter (11-D Science and 11-D Humanities), so the
    // id has to leave the letter when the stream is not the one that letter implies.
    const payload = {
      ...meta,
      id: form.id || (stream === meta.stream ? meta.id : `${meta.id}-${stream.slice(0, 3).toLowerCase()}`),
      name: form.name.trim() || meta.name,
      stream,
      // Editing the same row must not silently reset a syllabus the office already published.
      curriculum:
        stream !== meta.stream
          ? curriculumForStream(stream)
          : previous?.curriculum && previous.stream === stream
            ? previous.curriculum
            : meta.curriculum,
      mentor_teacher_id: form.mentor_teacher_id || null,
      default_room: nextFreeRoom(grade, meta.section, form.id),
      is_active: true,
    }
    await db.saveSection(payload)
    await reload()
    setOpen(false)
    reset()
    const renamed = previous && previous.name !== payload.name
    pushToast({
      tone: 'success',
      title: renamed ? 'Class renamed' : editing ? 'Class updated' : 'Class saved',
      message: renamed
        ? `${previous.name} is now ${payload.name}. Its ${slots.filter((x) => x.class_section === previous.name).length} weekly periods, access code and enrollments followed the new name.`
        : `${payload.name} is on the register with ${payload.grade >= 11 ? 'the 11–12 bell' : 'the 1–10 bell'} and room ${payload.default_room}.${editing ? '' : ' Issue it an access code from Class access codes.'}`,
    })
  }

  const archive = async (s) => {
    await db.saveSection({ ...s, is_active: false })
    await reload()
    pushToast({ tone: 'warning', title: 'Class archived', message: `${s.name} no longer accepts enrollments. Its timetable is preserved.` })
  }

  const unarchive = async (s) => {
    await db.saveSection({ ...s, is_active: true })
    await reload()
    pushToast({ tone: 'success', title: 'Class restored', message: `${s.name} is back on the register and accepting enrollments.` })
  }

  const askDelete = async (s) => {
    setConfirmDelete(s)
    setUsage(null)
    setUsage(await db.sectionUsage(s.id))
  }

  const remove = async () => {
    const s = confirmDelete
    setConfirmDelete(null)
    try {
      const gone = await db.deleteSection(s.id)
      await reload()
      pushToast({
        tone: 'warning',
        title: 'Class removed',
        message: `${s.name} and its ${gone.slots} weekly ${gone.slots === 1 ? 'period' : 'periods'} were deleted. ${gone.codes ? `Its ${gone.codes} access code was revoked.` : 'It had no access code.'}`,
      })
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Class still has students',
        message:
          err.code === 'section_has_students'
            ? `${s.name} has enrollment history. Archive it instead — deleting would erase records students still need.`
            : err.message,
      })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Structure"
        title="Classes & sections"
        sub="A section is the join between a grade, a stream and a room. Timetable rows, enrollments and access codes all point at these ids rather than at a label."
        icon={Layers}
        breadcrumbs={[{ label: 'Home', to: '/admin' }, { label: 'Structure' }, { label: 'Classes & Sections' }]}
        actions={
          <Button variant="primary" icon={Plus} onClick={start}>
            New section
          </Button>
        }
      />

      <Card className="px-4 py-3.5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchInput
            className="w-full sm:w-[240px]"
            value={query}
            onChange={setQuery}
            placeholder="Search class or room"
            aria-label="Search classes"
          />
          <p className="meta ml-auto hidden sm:block">
            {plural(sections.filter((s) => s.is_active).length, 'open class', 'open classes')} · {plural(sections.filter((s) => !s.is_active).length, 'archived class', 'archived classes')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by class">
          <button
            type="button"
            aria-pressed={gradeFilter === 'all'}
            onClick={() => setGradeFilter('all')}
            data-tone={gradeFilter === 'all' ? 'brand' : 'neutral'}
            className="chip cursor-pointer"
          >
            All classes
            <span className="num tabular-nums opacity-70">{sections.length}</span>
          </button>
          {CLASS_CHOICES.map((g) => {
            const n = sections.filter((s) => String(s.grade) === String(g)).length
            if (!n) return null
            const sel = gradeFilter === String(g)
            return (
              <button
                key={g}
                type="button"
                aria-pressed={sel}
                onClick={() => setGradeFilter(String(g))}
                data-tone={sel ? 'brand' : 'neutral'}
                className="chip num cursor-pointer tabular-nums"
              >
                {g}
                <span className="opacity-70">{n}</span>
              </button>
            )
          })}
        </div>
      </Card>

      {sections.length ? (
        grouped.length ? (
          <div className="flex flex-col gap-6">
            {grouped.map(({ grade: g, rows }) => {
              const streams = [...new Set(rows.map((s) => s.stream).filter((x) => x !== 'General'))]
              const scheduled = rows.reduce((n, s) => n + slots.filter((x) => x.class_section === s.name).length, 0)
              return (
                <section key={g}>
                  <SectionTitle
                    title={isPrePrimary(g) ? g : `Class ${g}`}
                    sub={`Sections ${rows.map((s) => s.section).join(', ')}${streams.length ? ` · ${streams.join(' / ')}` : ''} · ${
                      bellFacts(rows[0].name).label
                    } · ${scheduled} ${scheduled === 1 ? 'period' : 'periods'} scheduled`}
                  />
                  <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {rows.map((s) => (
                      <SectionCard
                        key={s.id}
                        section={s}
                        periods={slots.filter((x) => x.class_section === s.name).length}
                        onEdit={edit}
                        onSubjects={setSubjectsFor}
                        onArchive={archive}
                        onUnarchive={unarchive}
                        onDelete={askDelete}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        ) : (
          <p className="lede">No class matches “{query || gradeFilter}”.</p>
        )
      ) : (
        <Card>
          <EmptyState
            icon={Layers}
            title="No class sections yet"
            hint="Create the sections the school runs. Access codes and enrollments depend on them."
            action={
              <Button variant="primary" icon={Plus} onClick={start}>
                New section
              </Button>
            }
          />
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => { setOpen(false); reset() }}
        icon={Layers}
        tone="brand"
        title={editing ? `Edit ${sections.find((s) => s.id === form.id)?.name || 'class'}` : 'Add a section'}
        sub={
          editing
            ? 'Changing the class or letter renames it everywhere — timetable, access code and enrollment records follow.'
            : 'Pick the class and the letter — stream, bell schedule and home room follow automatically.'
        }
        width="max-w-lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setOpen(false); reset() }}>
              Cancel
            </Button>
            <Button variant="primary" icon={editing ? BadgeCheck : Plus} onClick={save} disabled={!form.name || !form.grade || !form.section || duplicate}>
              {editing ? 'Save changes' : 'Create section'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <div role="group" aria-label="Class">
            <p className="field-label">Class</p>
            <div className="grid grid-cols-4 gap-1.5 mb-1.5">
              {PRE_PRIMARY.map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={form.grade === g}
                  onClick={() => setForm({ ...form, grade: g, name: sectionName(g, form.section || 'A') })}
                  data-tone={form.grade === g ? 'brand' : 'neutral'}
                  className="chip justify-center cursor-pointer"
                >
                  {g}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {GRADES.map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={String(form.grade) === String(g)}
                  onClick={() => setForm({ ...form, grade: String(g), name: sectionName(g, form.section || 'A') })}
                  data-tone={String(form.grade) === String(g) ? 'brand' : 'neutral'}
                  className="chip justify-center cursor-pointer tabular-nums"
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div role="group" aria-label="Section letter">
            <p className="field-label">Section</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {letterOptions(grade).map((l) => {
                const taken = existing.includes(sectionName(grade, l))
                return (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={form.section === l}
                    title={taken ? `${sectionName(grade, l)} already exists` : undefined}
                    onClick={() => setForm({ ...form, section: l, name: sectionName(grade, l) })}
                    data-tone={form.section === l ? 'brand' : 'neutral'}
                    className={cx('chip justify-center cursor-pointer', taken && 'opacity-55')}
                  >
                    {l}
                    {taken ? <span className="opacity-70">· has</span> : null}
                  </button>
                )
              })}
              <div className="ml-auto w-20">
                <Input
                  aria-label="Section letter"
                  className="uppercase text-center"
                  maxLength={2}
                  value={form.section}
                  onChange={(e) => {
                    const l = e.target.value.toUpperCase()
                    setForm({ ...form, section: l, name: sectionName(grade, l || 'A') })
                  }}
                />
              </div>
            </div>
          </div>

          <Card tone="info" className="p-4">
            <p className="field-label">Follows the class</p>
            <KeyValue
              rows={[
                ['Bell schedule', bell.label],
                ['Day length', bell.length],
                ['Break', bell.breakLine],
                ['Home room', derivedRoom || '—'],
              ]}
            />
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {senior ? (
              <Field label="Stream" hint={customStream ? 'A stream not on the list starts from the Class 9–10 syllabus; edit its subjects next.' : 'The letter suggests a default — picking another is allowed.'}>
                <Select
                  value={customStream ? '__other' : form.stream || derivedStream}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '__other') {
                      setForm({ ...form, stream: '' })
                      setCustomStream(true)
                      return
                    }
                    setCustomStream(false)
                    setForm({ ...form, stream: v, name: `${grade}-${form.section || 'A'} ${v}` })
                  }}
                >
                  {STREAMS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                      {s === derivedStream ? ' · default for this letter' : ''}
                    </option>
                  ))}
                  <option value="__other">Other — name it…</option>
                </Select>
                {customStream ? (
                  <Input
                    className="mt-1.5"
                    autoFocus
                    list="cc-stream-options"
                    aria-label="Custom stream name"
                    placeholder="e.g. Design & Technology"
                    value={form.stream}
                    onChange={(e) =>
                      setForm({ ...form, stream: e.target.value, name: `${grade}-${form.section || 'A'} ${e.target.value}` })
                    }
                  />
                ) : null}
                <datalist id="cc-stream-options">
                  {STREAMS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
            ) : (
              <Field label="Curriculum band">
                <Input value={sectionMeta(grade, form.section || 'A').band} readOnly />
              </Field>
            )}
            <div className="sm:order-3">
              <SearchSelect
                label="Class teacher"
                value={form.mentor_teacher_id}
                onChange={(v) => setForm({ ...form, mentor_teacher_id: v })}
                options={[{ value: '', label: 'Not assigned' }, ...teachers.map((t) => ({ value: t.id, label: t.full_name, hint: [t.subject, ...(t.extra || [])].join(' · ') }))]}
                placeholder="Not assigned"
                searchPlaceholder="Search staff by name or subject"
                emptyText="Nobody on staff matches that name."
              />
            </div>
            <div className="sm:col-span-2 sm:order-4">
              <Field label="Display name" required>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="11-D Science" invalid={duplicate} />
              </Field>
            </div>
          </div>

          {duplicate ? (
            <Alert tone="danger" title="That section already exists">
              {form.name} is already on the register, so creating it again would give the timetable two rows with the same label.
            </Alert>
          ) : null}
        </div>
      </Modal>

      <SubjectsModal
        section={subjectsFor}
        onClose={() => setSubjectsFor(null)}
        onSaved={async () => {
          await reload()
          pushToast({ tone: 'success', title: 'Syllabus saved', message: `${subjectsFor.name} now carries its own weekly subject load.` })
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => { setConfirmDelete(null); setUsage(null) }}
        onConfirm={remove}
        tone="danger"
        confirmLabel={usage?.enrollments ? 'Delete anyway' : 'Delete permanently'}
        title={`Remove ${confirmDelete?.name || ''}?`}
        body={
          !usage ? (
            <p className="lede">Checking what hangs off this class…</p>
          ) : usage.enrollments ? (
            <p>
              {usage.enrollments} {usage.enrollments === 1 ? 'student is' : 'students are'} enrolled here. Deleting removes their enrollment
              history, which is part of an academic record — archive the class instead and the record stays intact.
            </p>
          ) : (
            <p>
              This deletes {usage.slots ? `${usage.slots} weekly ${usage.slots === 1 ? 'period' : 'periods'}` : 'no timetable periods'}
              {usage.codes ? ` and revokes ${usage.codes} access code` : ''}. Archiving keeps the timetable and simply stops new enrollments.
            </p>
          )
        }
      />
    </div>
  )
}

function SectionCard({ section: s, periods, onEdit, onSubjects, onArchive, onUnarchive, onDelete }) {
  const subjects = Object.entries(s.curriculum || {})
  const load = subjects.reduce((n, [, v]) => n + v, 0)
  return (
    <Card hover tone={s.is_active ? 'brand' : 'neutral'} className={cx('p-4 flex flex-col gap-3 min-w-0', !s.is_active && 'opacity-75')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="display text-md font-bold truncate t1">{s.name}</div>
          <div className="meta mt-0.5">
            Grade {s.grade} · {s.section} · {s.stream}
          </div>
        </div>
        {!s.is_active ? <Chip tone="neutral" dot>archived</Chip> : null}
      </div>
      <KeyValue
        cols={2}
        rows={[
          ['Class teacher', s.mentor_teacher_name || '—'],
          ['Home room', s.default_room || '—'],
          ['Bell', bellSummary(s.name)],
          ['Subjects', subjects.length ? `${subjects.length} · ${load} periods` : 'none published'],
          ['Enrolled', String(s.enrolled ?? 0)],
          ['Periods / week', String(periods)],
        ]}
      />
      <Divider className="!my-0" />
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" icon={Pencil} onClick={() => onEdit(s)}>
          Edit class
        </Button>
        <Button size="sm" icon={BookOpen} onClick={() => onSubjects(s)}>
          Subjects
        </Button>
        {s.is_active ? (
          <Button size="sm" variant="quiet" tone="warning" icon={Archive} onClick={() => onArchive(s)}>
            Archive
          </Button>
        ) : (
          <Button size="sm" variant="quiet" tone="success" icon={RotateCcw} onClick={() => onUnarchive(s)}>
            Restore
          </Button>
        )}
        <Button size="sm" variant="quiet" tone="danger" icon={Trash2} onClick={() => onDelete(s)}>
          Remove
        </Button>
      </div>
    </Card>
  )
}

/** Weekly subject load for one class. The builder offers these first. */
function SubjectsModal({ section, onClose, onSaved }) {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const capacity = weekCapacity(periodsFor(section?.name))

  useEffect(() => {
    if (!section) return
    let alive = true
    db.listSectionSubjects(section.id).then((r) => alive && setRows(r.length ? r : [{ subject: '', weekly_periods: 0 }]))
    return () => {
      alive = false
    }
  }, [section])

  if (!section) return null

  const total = rows.reduce((n, r) => n + (Number(r.weekly_periods) || 0), 0)
  const blank = rows.filter((r) => !String(r.subject).trim() || !(Number(r.weekly_periods) > 0)).length
  const dupes = new Set(rows.map((r) => r.subject.trim().toLowerCase()).filter(Boolean)).size !== rows.filter((r) => r.subject.trim()).length
  const over = total > capacity

  const set = (i, patch) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const add = () => setRows((prev) => [...prev, { subject: '', weekly_periods: 1 }])
  const drop = (i) => setRows((prev) => prev.filter((_, j) => j !== i))

  const save = async () => {
    setBusy(true)
    try {
      await db.saveSectionSubjects(section.id, rows)
      await onSaved()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      icon={BookOpen}
      tone="brand"
      title={`Subjects · ${section.name}`}
      sub={`${capacity} periods a week at this class's bell (${periodsFor(section.name).length} × ${DAYS.length} days). The builder lists these subjects first.`}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="quiet" tone="brand" icon={Plus} className="mr-auto" onClick={add}>
            Add subject
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={BadgeCheck} onClick={save} disabled={busy || !rows.length || blank > 1 || dupes || over}>
            {busy ? 'Saving…' : 'Save syllabus'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)_112px_40px] gap-2">
          <p className="field-label mb-0">Subject</p>
          <p className="field-label mb-0 text-right">Periods / week</p>
          <span aria-hidden />
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_112px_40px] gap-2 items-center">
            <Input
              list="cc-subject-options"
              aria-label={`Subject ${i + 1}`}
              value={r.subject}
              placeholder="Physics"
              onChange={(e) => set(i, { subject: e.target.value })}
            />
            <Input
              className="text-right tabular-nums"
              type="number"
              min="1"
              max="20"
              aria-label={`Periods per week for ${r.subject.trim() || `subject ${i + 1}`}`}
              value={r.weekly_periods || ''}
              onChange={(e) => set(i, { weekly_periods: Number(e.target.value) })}
            />
            <IconButton label={`Remove ${r.subject.trim() || 'this row'}`} icon={Trash2} size="sm" tone="danger" onClick={() => drop(i)} />
          </div>
        ))}
        <datalist id="cc-subject-options">
          {allSubjects.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        <Card tone={over ? 'danger' : total === capacity ? 'success' : 'accent'} className="mt-2 p-4 flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="field-label mb-0">Weekly load</p>
            <p className="num text-sm font-bold t2 tabular-nums">
              {total} of {capacity} periods
            </p>
          </div>
          <ProgressBar
            value={total}
            max={capacity}
            tone={over ? 'danger' : total === capacity ? 'success' : 'accent'}
            showPct={false}
          />
        </Card>

        {over ? (
          <Alert tone="danger" title="That is more than the week holds">
            {total - capacity} {total - capacity === 1 ? 'period' : 'periods'} over. Reduce a subject or move the surplus into an assembly or free period.
          </Alert>
        ) : dupes ? (
          <Alert tone="warning" title="A subject is listed twice">
            Each subject appears once per class, with one weekly count.
          </Alert>
        ) : null}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------- academic sessions -- */

export function SessionsPage() {
  const { sessions, reload } = useSchoolData()
  const { pushToast } = useApp()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', start_date: '', end_date: '' })

  const save = async () => {
    await db.saveSession_({ ...form, status: 'upcoming', is_active: false })
    await reload()
    setOpen(false)
    pushToast({ tone: 'success', title: 'Session created', message: `${form.name} is ready. Activating it will close the current one.` })
  }

  const activate = async (s) => {
    await db.saveSession_({ ...s, is_active: true, status: 'active' })
    await reload()
    pushToast({ tone: 'warning', title: `${s.name} is now the active session`, message: 'Previous enrollments are preserved; students verify a code for the new year.' })
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Structure"
        title="Academic sessions"
        sub="One session is open at a time. Closing a year never rewrites the records underneath it — timetables, enrollments and homework stay readable."
        icon={CalendarRange}
        breadcrumbs={[{ label: 'Home', to: '/admin' }, { label: 'Structure' }, { label: 'Academic Sessions' }]}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
            New session
          </Button>
        }
      />

      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {sessions.map((s) => (
          <Card
            key={s.id}
            hover
            tone={s.is_active ? 'success' : s.status === 'closed' ? 'neutral' : 'info'}
            className={cx('p-4 flex flex-col gap-2 min-w-0', s.is_active && 'border-[color:var(--tone-line)]')}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="display text-lg font-extrabold tabular-nums t1 truncate">{s.name}</div>
                <div className="meta mt-1 tabular-nums">
                  {s.start_date} → {s.end_date}
                </div>
              </div>
              <Chip tone={s.is_active ? 'success' : s.status === 'closed' ? 'neutral' : 'info'} dot>
                {s.is_active ? 'active' : s.status}
              </Chip>
            </div>
            {!s.is_active ? (
              <Button block className="mt-2" icon={CalendarRange} onClick={() => activate(s)}>
                Activate this session
              </Button>
            ) : (
              <p className="lede mt-2">New timetable rows and enrollments land here.</p>
            )}
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        icon={CalendarRange}
        tone="brand"
        title="New academic session"
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={!form.name || !form.start_date || !form.end_date}>
              Create session
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Name" required hint="Use the school's own label, e.g. 2027–28.">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="2027–28" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Starts" required>
              <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </Field>
            <Field label="Ends" required>
              <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------- class codes -- */

export function CodesPage() {
  const { codes, sections, activeSession, reload } = useSchoolData()
  const { pushToast, demoOn } = useApp()
  const [issued, setIssued] = useState([])
  const [confirmRotate, setConfirmRotate] = useState(null)
  const [batchBusy, setBatchBusy] = useState(false)

  const missing = useMemo(
    () => sections.filter((s) => s.is_active && !codes.some((c) => c.class_section_id === s.id)),
    [sections, codes],
  )

  const issue = async (section, existing) => {
    const res = await db.generateClassCode(section.id, { sessionName: activeSession?.name })
    await reload()
    setIssued((prev) => [res, ...prev])
    pushToast({
      tone: 'warning',
      title: existing ? 'Class code rotated' : 'Class code generated',
      message: `${res.class_section} — copy it now, it is shown only this once.`,
    })
    return res
  }

  const issueAll = async () => {
    setBatchBusy(true)
    try {
      const batch = missing.slice()
      const fresh = []
      for (const s of batch) {
        const res = await db.generateClassCode(s.id, { sessionName: activeSession?.name })
        fresh.push(res)
      }
      await reload()
      setIssued((prev) => [...fresh, ...prev])
      pushToast({
        tone: 'warning',
        title: `${batch.length} class codes generated`,
        message: 'Copy them from the banner now — once dismissed, only the hint remains.',
      })
    } finally {
      setBatchBusy(false)
    }
  }

  const setStatus = async (code, status) => {
    await db.setCodeStatus(code.id, status)
    await reload()
    pushToast({ tone: status === 'active' ? 'success' : 'warning', title: `Code ${status}`, message: `${code.class_section}'s code is ${status}.` })
  }

  const setExpiry = async (code, days) => {
    await db.setCodeExpiry(code.id, new Date(Date.now() + days * 86400000).toISOString())
    await reload()
    pushToast({ tone: 'success', title: 'Expiry updated', message: `${code.class_section} expires in ${days} days.` })
  }

  const fmtDate = (v, opts) =>
    v ? new Date(v).toLocaleDateString('en-GB', opts) : null

  const columns = [
    { key: 'class_section', header: 'Class section', sortable: true, strong: true },
    { key: 'session_name', header: 'Session', sortable: true, render: (c) => <span className="num text-sm t2 tabular-nums whitespace-nowrap">{c.session_name || '—'}</span> },
    { key: 'code_hint', header: 'Code', render: (c) => <span className="block text-2xs t2 truncate max-w-[160px]" style={{ fontFamily: 'var(--font-mono)' }} title={c.code_hint}>{c.code_hint}</span> },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      align: 'center',
      render: (c) => {
        const expired = c.expires_at && new Date(c.expires_at) < new Date()
        return (
          <Chip tone={expired ? 'danger' : c.status === 'active' ? 'success' : 'neutral'} dot>
            {expired ? 'expired' : c.status}
          </Chip>
        )
      },
    },
    {
      key: 'expires_at',
      header: 'Expires',
      sortable: true,
      render: (c) => <span className="text-sm t2 tabular-nums whitespace-nowrap">{fmtDate(c.expires_at, { day: '2-digit', month: 'short', year: 'numeric' }) || 'never'}</span>,
    },
    {
      key: 'last_regenerated_at',
      header: 'Last rotated',
      sortable: true,
      render: (c) => <span className="text-sm t2 tabular-nums whitespace-nowrap">{fmtDate(c.last_regenerated_at, { day: '2-digit', month: 'short' }) || 'never'}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (c) => {
        const section = sections.find((s) => s.id === c.class_section_id)
        return (
          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
            <Dropdown
              label={`Set expiry for ${c.class_section}`}
              trigger={({ toggle, open: dropOpen }) => (
                <Button size="sm" variant="ghost" icon={Clock} aria-expanded={dropOpen} aria-haspopup="menu" onClick={toggle}>
                  Expiry
                </Button>
              )}
            >
              {({ close }) => (
                <>
                  {[
                    [30, '30 days'],
                    [90, '90 days'],
                    [180, '6 months'],
                    [365, '1 year'],
                  ].map(([days, label]) => (
                    <MenuItem
                      key={days}
                      icon={Clock}
                      onClick={() => {
                        close()
                        setExpiry(c, days)
                      }}
                    >
                      {label}
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>
            {c.status === 'active' ? (
              <Button size="sm" variant="quiet" tone="warning" onClick={() => setStatus(c, 'deactivated')}>
                Deactivate
              </Button>
            ) : (
              <Button size="sm" variant="quiet" tone="success" onClick={() => setStatus(c, 'active')}>
                Reactivate
              </Button>
            )}
            <Button size="sm" icon={RefreshCw} onClick={() => setConfirmRotate({ c, section })}>
              Rotate
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Structure"
        title="Class access codes"
        sub="Codes are stored as bcrypt hashes. The plaintext appears once, at generation, and cannot be read back — not by an admin, not from the table."
        icon={KeyRound}
        breadcrumbs={[{ label: 'Home', to: '/admin' }, { label: 'Structure' }, { label: 'Class Access Codes' }]}
        actions={
          <CopyButton value={codes.map((c) => `${c.class_section}\t${c.code_hint}`).join('\n')} label="Copy status sheet" />
        }
      />

      {issued.length ? (
        <Card tone="success" className="p-4 sm:p-5">
          <div className="flex items-start gap-3" data-tone="success">
            <span className="avatar avatar-sm shrink-0" data-tone="success" aria-hidden>
              <KeyRound size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="display text-md font-bold t1">
                {issued.length === 1 ? `Code created for ${issued[0].class_section}` : `${issued.length} class codes created`}
              </h3>
              <p className="lede mt-1">This is the only time these are shown. Hand each to its class teacher for the notice board.</p>
              <ul className="m-0 p-0 list-none mt-3 flex flex-col gap-2">
                {issued.map((i) => (
                  <li key={i.class_section + i.plaintext} className="card-flat flex flex-wrap items-center gap-2 sm:gap-3 px-3 py-2.5 min-w-0">
                    <span className="text-sm font-semibold shrink-0 t1">{i.class_section}</span>
                    <span className="num text-lg font-extrabold tracking-[0.12em] t1">{i.plaintext}</span>
                    <CopyButton value={i.plaintext} label="Copy code" className="ml-auto" />
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2.5 mt-3">
                <Button size="sm" variant="quiet" tone="brand" onClick={() => setIssued([])}>
                  Dismiss
                </Button>
                <CopyButton value={issued.map((i) => `${i.class_section}\t${i.plaintext}`).join('\n')} label="Copy all as sheet" />
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {missing.length ? (
        <Card tone="warning" className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2" data-tone="warning">
                <AlertTriangle size={16} className="shrink-0" style={{ color: 'var(--tone-ink)' }} aria-hidden />
                <h3 className="display text-md font-bold t1">
                  {missing.length} {missing.length === 1 ? 'class has' : 'classes have'} no access code
                </h3>
              </div>
              <p className="lede mt-1.5">
                Students cannot join a class until its code exists. Each plaintext is displayed once, here, and stored only as a hash.
              </p>
            </div>
            <Button variant="primary" icon={KeyRound} loading={batchBusy} onClick={issueAll}>
              Issue all {missing.length}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {missing.map((s) => (
              <button key={s.id} type="button" data-tone="neutral" className="chip cursor-pointer" onClick={() => issue(s)}>
                {s.name}
                <Plus size={11} aria-hidden />
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      <SectionTitle
        title="Issued codes"
        sub="The hint is all that is stored — the plaintext was shown once, at generation."
        right={<Chip tone="neutral">{plural(codes.length, 'code', 'codes')}</Chip>}
      />
      <DataTable
        columns={columns}
        rows={codes}
        getRowId={(c) => c.id}
        initialSort={{ key: 'class_section', dir: 'asc' }}
        searchPlaceholder="Search class or session"
        empty={
          <Card className="px-4 py-2">
            <EmptyState
              icon={KeyRound}
              title="No codes issued yet"
              hint="Generate one per section for the active session. Students cannot verify without it."
            />
          </Card>
        }
      />

      <div className="grid sm:grid-cols-2 gap-3">
        {sections
          .filter((s) => s.is_active && !codes.some((c) => c.class_section_id === s.id && c.status === 'active'))
          .map((s) => (
            <Card key={s.id} tone="warning" hover className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="display text-md font-bold t1 truncate">{s.name}</div>
                <p className="meta mt-0.5">No active code — students cannot join this class.</p>
              </div>
              <Button variant="primary" size="sm" icon={KeyRound} onClick={() => issue(s)}>
                Generate
              </Button>
            </Card>
          ))}
      </div>

      {demoOn ? (
        <p className="lede">
          Demo note: sample codes are listed in the student verification sheet so the enrollment journey can be walked
          through. A live deployment never exposes them anywhere.
        </p>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmRotate)}
        onClose={() => setConfirmRotate(null)}
        onConfirm={async () => {
          await issue(confirmRotate.section, confirmRotate.c)
          setConfirmRotate(null)
        }}
        title="Rotate this code?"
        body={
          confirmRotate
            ? `${confirmRotate.c.class_section}'s current code stops working immediately. Anyone who has not enrolled yet will need the new one.`
            : ''
        }
        confirmLabel="Rotate code"
      />
    </div>
  )
}
