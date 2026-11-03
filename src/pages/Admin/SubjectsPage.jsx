import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, FlaskConical, RefreshCw, Users } from 'lucide-react'
import { db } from '../../lib/supabase'
import { useSchoolData } from '../../hooks/useSchool'
import { allSubjects, LAB_FOR, roomShort, subjectTone } from '../../lib/subjects'
import { DataTable } from '../../components/ui/DataTable'
import { ProgressBar } from '../../components/ui/charts'
import {
  Alert,
  Avatar,
  Button,
  Chip,
  CopyButton,
  EmptyState,
  Modal,
  PageHeader,
  Segmented,
  Stat,
  SubjectChip,
  cx,
} from '../../components/ui/primitives'

const SORTS = [
  { id: 'demand', label: 'Weekly demand' },
  { id: 'name', label: 'Name' },
  { id: 'gap', label: 'Coverage gap' },
]

const coverage = (c) => (c.weekly ? Math.min(100, Math.round((c.scheduled / c.weekly) * 100)) : 0)
const coverageTone = (c) => (c.scheduled === 0 ? 'danger' : coverage(c) >= 100 ? 'success' : 'warning')

export function SubjectsPage() {
  const { teachers, slots } = useSchoolData()
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState(null)
  const [error, setError] = useState('')
  const [sort, setSort] = useState('demand')
  const [open, setOpen] = useState(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    setCatalog(null)
    setError('')
    db
      .listSubjectCatalog()
      .then((rows) => alive && setCatalog(rows))
      .catch((err) => alive && setError(err.message || 'The catalogue could not be read.'))
    return () => {
      alive = false
    }
  }, [nonce])

  const nameOf = useMemo(() => {
    const map = new Map(teachers.map((t) => [String(t.id), t]))
    return (id) => map.get(String(id)) || null
  }, [teachers])

  const rows = useMemo(() => {
    if (!catalog) return []
    const copy = [...catalog]
    if (sort === 'name') copy.sort((a, b) => a.subject.localeCompare(b.subject))
    else if (sort === 'gap') copy.sort((a, b) => b.weekly - b.scheduled - (a.weekly - a.scheduled) || b.weekly - a.weekly)
    else copy.sort((a, b) => b.weekly - a.weekly || a.subject.localeCompare(b.subject))
    return copy
  }, [catalog, sort])

  const totalWeekly = (catalog || []).reduce((n, c) => n + c.weekly, 0)
  const totalScheduled = (catalog || []).reduce((n, c) => n + c.scheduled, 0)
  const unstaffed = (catalog || []).filter((c) => !c.teacherIds.length).length

  const tsv = useMemo(() => {
    const head = ['subject', 'weekly demanded', 'scheduled', 'coverage %', 'classes', 'staff able to teach', 'lab room'].join('\t')
    return [
      head,
      ...rows.map((c) =>
        [c.subject, c.weekly, c.scheduled, `${coverage(c)}%`, c.classes.length, c.teacherIds.length, LAB_FOR[c.subject] || ''].join('\t'),
      ),
    ].join('\n')
  }, [rows])

  const detail = open ? catalog?.find((c) => c.subject === open) || null : null

  const columns = [
    { key: 'subject', header: 'Subject', strong: true, render: (r) => <SubjectChip subject={r.subject} /> },
    { key: 'weekly', header: 'Weekly demand', sortable: true, render: (r) => <span className="num tabular-nums t1 font-semibold">{r.weekly}</span> },
    { key: 'scheduled', header: 'Scheduled', sortable: true, render: (r) => <span className="num tabular-nums t2">{r.scheduled}</span> },
    {
      key: 'coverage',
      header: 'Coverage',
      sortable: true,
      sortValue: (r) => coverage(r),
      width: '168px',
      render: (r) => <ProgressBar value={coverage(r)} max={100} tone={coverageTone(r)} height={6} label={`${coverage(r)}% bell`} showPct={false} />,
    },
    { key: 'classes', header: 'Classes', sortable: true, sortValue: (r) => r.classes.length, render: (r) => <span className="num tabular-nums t2">{r.classes.length}</span> },
    {
      key: 'staff',
      header: 'Staff',
      sortable: true,
      sortValue: (r) => r.teacherIds.length,
      render: (r) =>
        r.teacherIds.length ? (
          <span className="inline-flex items-center gap-1.5 t1 tabular-nums">
            <Users size={13} className="t3" aria-hidden />
            <span className="text-2xs font-semibold">{r.teacherIds.length}</span>
          </span>
        ) : (
          <Chip tone="danger">unstaffed</Chip>
        ),
    },
    {
      key: 'lab',
      header: 'Lab room',
      render: (r) =>
        LAB_FOR[r.subject] ? (
          <Chip tone="info" icon={FlaskConical}>
            {roomShort(LAB_FOR[r.subject])}
          </Chip>
        ) : (
          <span className="t3">—</span>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Academics · catalogue"
        title="Subject catalogue"
        sub="Every subject the school actually teaches, derived from the published curricula of its classes — so this list can never drift from timetable demand. Click a row for the classes and staff behind it."
        breadcrumbs={[{ label: 'Home', to: '/admin' }, { label: 'Academics' }, { label: 'Subject Catalogue' }]}
        actions={
          <>
            <CopyButton value={tsv} label="Copy catalogue" />
            <Button icon={RefreshCw} onClick={() => setNonce((n) => n + 1)}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <Stat label="Subjects demanded" value={catalog ? catalog.length : '—'} sub={`of ${allSubjects.length} recognised`} tone="brand" />
        <Stat label="Weekly periods" value={catalog ? totalWeekly : '—'} sub="across every class curriculum" tone="info" />
        <Stat
          label="Scheduled so far"
          value={catalog ? `${totalScheduled}/${totalWeekly}` : '—'}
          sub={catalog && totalWeekly ? `${Math.round((totalScheduled / (totalWeekly || 1)) * 100)}% of demand has a bell` : 'awaiting the timetable'}
          tone={catalog && totalScheduled < totalWeekly ? 'warning' : 'success'}
        />
        <Stat
          label="Unstaffed subjects"
          value={catalog ? unstaffed : '—'}
          sub={unstaffed ? 'no staff lists these subjects' : 'every subject has qualified staff'}
          tone={unstaffed ? 'danger' : 'neutral'}
        />
      </div>

      {error ? (
        <div className="card p-5 mb-4">
          <Alert tone="danger" title="Could not read the catalogue" icon={BookOpen}>
            {error}
            <div className="mt-2">
              <Button size="sm" icon={RefreshCw} onClick={() => setNonce((n) => n + 1)}>
                Try again
              </Button>
            </div>
          </Alert>
        </div>
      ) : catalog && !catalog.length ? (
        <EmptyState
          icon={BookOpen}
          title="No subjects on the register yet"
          hint="The catalogue is built from the weekly subject load published on each class. Nothing has been published yet, so no subject is demanded."
          action={
            <Button variant="primary" onClick={() => navigate('/admin/sections')}>
              Publish curricula in Classes &amp; sections
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(r) => r.subject}
          loading={!catalog}
          pageSize={20}
          searchPlaceholder="Search subject or class"
          searchKeys={(r, q) => `${r.subject} ${r.classes.map((c) => c.name).join(' ')}`.toLowerCase().includes(q)}
          onRowClick={(r) => setOpen(r.subject)}
          toolbar={
            <>
              <Segmented items={SORTS} value={sort} onChange={setSort} label="Sort subjects" />
              <span data-tone="neutral" className="chip ml-auto">
                <span className="num tabular-nums">{catalog ? `${rows.length} of ${catalog.length}` : '…'}</span> subjects
              </span>
            </>
          }
          empty={
            <EmptyState
              icon={BookOpen}
              title="Nothing on the register yet"
              hint="Publish a weekly subject load on a class and it appears here immediately."
            />
          }
        />
      )}

      <SubjectModal
        entry={detail}
        onClose={() => setOpen(null)}
        scheduledFor={(className) => (detail ? slots.filter((s) => s.class_section === className && s.subject === detail.subject).length : 0)}
        teacherOf={(id) => nameOf(id)}
      />
    </>
  )
}

function SubjectModal({ entry, onClose, scheduledFor, teacherOf }) {
  const tone = entry ? subjectTone(entry.subject) : 'neutral'
  const qualified = entry ? entry.teacherIds.map(teacherOf).filter(Boolean) : []
  return (
    <Modal
      open={Boolean(entry)}
      onClose={onClose}
      icon={BookOpen}
      tone={tone}
      title={entry ? entry.subject : ''}
      sub={
        entry
          ? `${entry.classes.length} ${entry.classes.length === 1 ? 'class' : 'classes'} take it · ${entry.weekly} periods demanded per week · ${entry.scheduled} scheduled so far`
          : undefined
      }
      footer={
        entry ? (
          <>
            <CopyButton
              value={entry.classes.map((c) => `${c.name}\t${c.weekly}\t${scheduledFor(c.name)}`).join('\n')}
              label="Copy class sheet"
              className="mr-auto"
            />
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </>
        ) : null
      }
    >
      {entry ? (
        <div className="flex flex-col gap-5">
          {LAB_FOR[entry.subject] ? (
            <div data-tone="info" className="well px-4 py-3 flex items-center gap-2.5">
              <FlaskConical size={16} className="shrink-0" aria-hidden />
              <p className="text-sm t1 min-w-0">
                Practical sessions belong in <strong>{LAB_FOR[entry.subject]}</strong> — the board books it as{' '}
                <Chip tone="info" className={cx('align-middle')}>
                  {roomShort(LAB_FOR[entry.subject])}
                </Chip>
              </p>
            </div>
          ) : null}

          <section aria-label="Classes taking this subject" className="min-w-0">
            <p className="field-label">Classes taking {entry.subject}</p>
            <div className="card-flat overflow-hidden">
              <div className="scroll overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th scope="col">Class</th>
                      <th scope="col" className="text-right">
                        Per week
                      </th>
                      <th scope="col" className="text-right">
                        On the board
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.classes.map((c) => {
                      const onBoard = scheduledFor(c.name)
                      return (
                        <tr key={c.name}>
                          <td data-strong className="truncate max-w-[220px]">
                            {c.name}
                          </td>
                          <td className="text-right num tabular-nums">{c.weekly}</td>
                          <td className="text-right num tabular-nums">
                            {onBoard ? <span className="t1">{onBoard}</span> : <span data-tone="danger" className="chip">not scheduled</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section aria-label="Staff qualified to teach this subject">
            <p className="field-label">Staff qualified to teach it</p>
            {qualified.length ? (
              <ul className="m-0 p-0 list-none mt-1.5 flex flex-col gap-2">
                {qualified.map((t) => (
                  <li key={t.id} className="well px-3 py-2.5 flex flex-wrap items-center gap-2 min-w-0">
                    <Avatar name={t.full_name} size="sm" aria-hidden />
                    <span className="text-sm font-semibold t1 truncate">{t.full_name}</span>
                    <Chip tone={subjectTone(t.subject)}>{t.subject}</Chip>
                    {(t.extra || []).map((x) => (
                      <Chip key={x} tone="neutral">
                        {x}
                      </Chip>
                    ))}
                  </li>
                ))}
              </ul>
            ) : (
              <Alert tone="warning" title="Nobody on staff lists this subject">
                Periods for {entry.subject} can only be matched by availability, not subject fit. Consider hiring or widening a staff
                member’s recorded subjects in the teacher directory.
              </Alert>
            )}
          </section>
        </div>
      ) : null}
    </Modal>
  )
}

export default SubjectsPage
