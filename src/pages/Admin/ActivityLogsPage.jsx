import { useEffect, useMemo, useState } from 'react'
import { Download, History, RefreshCw } from 'lucide-react'
import { db } from '../../lib/supabase'
import { useSchoolData } from '../../hooks/useSchool'
import { downloadCSV, toCSV } from '../../lib/csv'
import { DataTable } from '../../components/ui/DataTable'
import {
  Alert,
  Avatar,
  Button,
  Chip,
  EmptyState,
  PageHeader,
  SkeletonRows,
  Stat,
  cx,
} from '../../components/ui/primitives'

const ROLE_ORDER = ['admin', 'teacher', 'student', 'system']
const ROLE_TONE = { admin: 'brand', teacher: 'info', student: 'sage', system: 'neutral' }

/* Anything that even looks like a credential never reaches the screen or the export. */
const SECRET_KEY = /(password|passwd|secret|token|otp|hash|plaintext|pin|credential|salt|private)/i
const SECRET_VALUE = /^(\$2[aby]\$|eyJ|[a-f0-9]{24,}$)/i

const rel = (iso) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`
  if (mins < 10080) return `${Math.round(mins / 1440)}d ago`
  return `${Math.round(mins / 10080)}w ago`
}

const fmtDate = (x) => new Date(x).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

const metaPairs = (metadata) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return []
  return Object.entries(metadata)
    .filter(([k, v]) => v != null && !SECRET_KEY.test(k) && !SECRET_VALUE.test(String(v)))
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(' / ') : typeof v === 'object' ? Object.keys(v).join(' + ') : String(v)])
    .map(([k, v]) => [k, v.length > 42 ? `${v.slice(0, 42)}…` : v])
}

export function ActivityLogsPage() {
  const { audit, teachers, admins, sections } = useSchoolData()
  const [logs, setLogs] = useState(null)
  const [error, setError] = useState('')
  const [kind, setKind] = useState('all')
  const [role, setRole] = useState('all')
  const [nonce, setNonce] = useState(0)

  // The shared school load caps the audit trail at 30 rows; the desk page needs the deep history.
  useEffect(() => {
    let alive = true
    setError('')
    setLogs(null)
    db
      .listAudit(500)
      .then((rows) => alive && setLogs(rows))
      .catch((err) => alive && setError(err.message || 'The audit trail could not be read.'))
    return () => {
      alive = false
    }
  }, [nonce])

  /* One merged, de-duplicated view of every entry we know about — newest first,
     flattened into plain fields so DataTable can search and sort it. */
  const rows = useMemo(() => {
    const byId = new Map()
    for (const r of [...(logs || []), ...(audit || [])]) if (r?.id && !byId.has(r.id)) byId.set(r.id, r)
    const t = new Map(teachers.map((x) => [String(x.id), x.full_name]))
    const a = new Map(admins.map((x) => [String(x.id), x.full_name]))
    const m = new Map(sections.map((s) => [String(s.mentor_teacher_id), s.mentor_teacher_name]))
    const actorName = (row) =>
      t.get(String(row.actor_id)) ||
      a.get(String(row.actor_id)) ||
      m.get(String(row.actor_id)) ||
      (row.actor_role === 'system' ? 'System' : row.actor_id || 'unknown')
    return [...byId.values()]
      .sort((x, y) => String(y.at).localeCompare(String(x.at)))
      .map((r) => ({
        id: r.id,
        at: String(r.at),
        actor: actorName(r),
        role: r.actor_role || 'unknown',
        kind: String(r.action || '').split('.')[0] || 'other',
        action: String(r.action || ''),
        target: r.target || '',
        pairs: metaPairs(r.metadata),
      }))
  }, [logs, audit, teachers, admins, sections])

  const kinds = useMemo(() => {
    const map = new Map()
    for (const r of rows) map.set(r.kind, (map.get(r.kind) || 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])

  const roles = useMemo(() => {
    const present = new Set(rows.map((r) => r.role))
    return [...ROLE_ORDER.filter((x) => present.has(x)), ...[...present].filter((x) => !ROLE_ORDER.includes(x))]
  }, [rows])

  const filtered = useMemo(
    () => rows.filter((r) => (kind === 'all' || r.kind === kind) && (role === 'all' || r.role === role)),
    [rows, kind, role],
  )

  const exportCSV = () => {
    const body = filtered.map((r) => ({
      at: r.at,
      actor: r.actor,
      role: r.role,
      kind: r.kind,
      action: r.action,
      target: r.target,
      details: r.pairs.map(([k, v]) => `${k}: ${v}`).join('; '),
    }))
    downloadCSV(
      `chrono-campus-activity-${fmtDate(Date.now()).replace(/\s/g, '-')}.csv`,
      toCSV(body, [
        { key: 'at', label: 'When' },
        { key: 'actor', label: 'Actor' },
        { key: 'role', label: 'Role' },
        { key: 'kind', label: 'Kind' },
        { key: 'action', label: 'Action' },
        { key: 'target', label: 'Target' },
        { key: 'details', label: 'Details' },
      ]),
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  const todayCount = rows.filter((r) => r.at.slice(0, 10) === today).length
  const actorCount = new Set(rows.map((r) => `${r.role}:${r.actor}`)).size

  const columns = [
    {
      key: 'at',
      header: 'When',
      sortable: true,
      sortValue: (r) => Date.parse(r.at),
      render: (r) => (
        <span title={new Date(r.at).toLocaleString('en-GB')} className="block whitespace-nowrap">
          <span className="num text-2xs t1 font-semibold tabular-nums">{rel(r.at)}</span>
          <span className="block meta tabular-nums">{fmtDate(r.at)}</span>
        </span>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      sortable: true,
      render: (r) => (
        <span className="flex items-center gap-2 min-w-0 max-w-[210px]">
          <Avatar name={r.actor} size="sm" aria-hidden />
          <span className="min-w-0">
            <span className="block text-sm font-medium t1 truncate">{r.actor}</span>
            <Chip tone={ROLE_TONE[r.role] || 'neutral'} className="mt-0.5">
              {r.role}
            </Chip>
          </span>
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      sortable: true,
      render: (r) => (
        <span className="font-mono text-2xs t1 whitespace-nowrap" title={r.action}>
          {r.action}
        </span>
      ),
    },
    {
      key: 'target',
      header: 'Target',
      sortable: true,
      render: (r) => (r.target ? <span className="block t2 truncate max-w-[220px]" title={r.target}>{r.target}</span> : <span className="t3">—</span>),
    },
    {
      key: 'pairs',
      header: 'Details',
      render: (r) =>
        r.pairs.length ? (
          <span className="flex flex-wrap gap-1 max-w-[320px]">
            {r.pairs.slice(0, 4).map(([k, v]) => (
              <span key={k} data-tone="neutral" className="well px-1.5 py-0.5 font-mono text-2xs t2 truncate max-w-[150px]">
                {k} · {v}
              </span>
            ))}
            {r.pairs.length > 4 ? <span className="meta">+{r.pairs.length - 4} more</span> : null}
          </span>
        ) : (
          <span className="meta">no details</span>
        ),
    },
  ]

  const chipButton = (on, tone, onClick, children) => (
    <button
      key={`${tone}-${String(children)}`}
      type="button"
      aria-pressed={on}
      data-tone={on ? tone : 'neutral'}
      onClick={onClick}
      className={cx(
        'chip cursor-pointer transition-colors',
        on ? '!bg-[color:var(--tone)] !border-[color:var(--tone)] text-white' : 'hover:border-[color:var(--tone-line)]',
      )}
    >
      {children}
    </button>
  )

  return (
    <>
      <PageHeader
        eyebrow="Governance · audit"
        title="Activity logs"
        sub="Every privileged change — codes, directories, timetables, homework, calendar — is written here with its actor and timestamp. Credential-shaped values are never rendered or exported."
        breadcrumbs={[{ label: 'Home', to: '/admin' }, { label: 'Governance' }, { label: 'Activity Logs' }]}
        actions={
          <>
            <Button icon={Download} onClick={exportCSV} disabled={!filtered.length}>
              Export CSV
            </Button>
            <Button icon={RefreshCw} onClick={() => setNonce((n) => n + 1)}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <Stat label="Entries kept" value={rows.length || '—'} sub="newest first" tone="brand" />
        <Stat label="Today" value={rows.length ? todayCount : '—'} sub="changes since midnight" tone={todayCount ? 'success' : 'neutral'} />
        <Stat label="Distinct actors" value={rows.length ? actorCount : '—'} sub="across all roles" tone="info" />
        <Stat
          label="Activity kinds"
          value={kinds.length || '—'}
          sub={kinds.length ? kinds.map(([k]) => k).slice(0, 3).join(' · ') : 'nothing recorded'}
          tone="accent"
        />
      </div>

      {error ? (
        <div className="card p-5 mb-4">
          <Alert tone="danger" title="The audit trail could not be read" icon={History}>
            {error}
            <div className="mt-2">
              <Button size="sm" icon={RefreshCw} onClick={() => setNonce((n) => n + 1)}>
                Try again
              </Button>
            </div>
          </Alert>
        </div>
      ) : null}

      {!logs && !error ? (
        <SkeletonRows rows={8} className="max-w-3xl" />
      ) : !rows.length && !error ? (
        <EmptyState
          icon={History}
          title="Nothing has been recorded yet"
          hint="The trail starts the moment privileged changes are made — issuing a class code, importing a directory, saving a timetable row."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          getRowId={(r) => r.id}
          pageSize={25}
          initialSort={{ key: 'at', dir: 'desc' }}
          searchPlaceholder="Search action, target or actor"
          searchKeys={(r, q) => `${r.action} ${r.target} ${r.actor} ${r.role} ${r.kind}`.toLowerCase().includes(q)}
          toolbar={
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              {chipButton(role === 'all', 'brand', () => setRole('all'), 'all roles')}
              {roles.map((x) => chipButton(role === x, ROLE_TONE[x] || 'brand', () => setRole(role === x ? 'all' : x), x))}
              <span className="w-px self-stretch my-1 bg-[color:var(--color-line)] mx-1 hidden sm:block" aria-hidden />
              {chipButton(kind === 'all', 'brand', () => setKind('all'), `all kinds · ${rows.length}`)}
              {kinds.map(([k, n]) => chipButton(kind === k, 'accent', () => setKind(kind === k ? 'all' : k), `${k} · ${n}`))}
            </div>
          }
          empty={
            <EmptyState
              icon={History}
              title="No entry matches the current filters"
              hint="Widen the role or kind filter, or clear the search to see the rest of the trail."
              action={
                <Button
                  onClick={() => {
                    setKind('all')
                    setRole('all')
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          }
        />
      )}
    </>
  )
}

export default ActivityLogsPage
