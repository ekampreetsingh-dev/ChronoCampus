import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  GraduationCap,
  Lock,
  Megaphone,
  Search,
  UserPlus,
  Users,
} from 'lucide-react'
import { db } from '../../lib/supabase'
import { useApp } from '../../context/AppContext'
import { pitchStore } from '../../lib/pitchStore'
import { GROUP_ROLE, memberBadge, memberSource } from '../../lib/groups'
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHead,
  Chip,
  ConfirmDialog,
  Dropdown,
  EmptyState,
  Field,
  IconButton,
  MenuItem,
  Modal,
  PageHeader,
  SearchInput,
  Segmented,
  SkeletonRows,
  Stat,
} from '../../components/ui/primitives'
import { DataTable } from '../../components/ui/DataTable'
import { ProgressBar } from '../../components/ui/charts'
import ManageTeachers from '../Groups/ManageTeachers'

const ago = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'no posts yet'

/**
 * The school-wide view of ChronoConnect. Every group here exists because a class
 * section exists — the admin never creates a group by hand, only repairs the
 * structure behind it.
 */
export default function AdminGroupsPage() {
  const { profile, pushToast } = useApp()
  const navigate = useNavigate()
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [manage, setManage] = useState(null)
  const [fullGroup, setFullGroup] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  /* The manager needs the real roster, which listGroups does not carry. */
  const openManager = async (g) => {
    setManage(g)
    setFullGroup(null)
    try {
      setFullGroup(await db.getGroup(g.id, { profile }))
    } catch (e) {
      pushToast({ tone: 'error', title: 'Could not open the roster', message: e.message })
    }
  }

  const load = useCallback(async () => {
    try {
      setGroups(await db.listGroups({ profile }))
    } catch (e) {
      pushToast({ tone: 'error', title: 'Could not read the groups', message: e.message })
    } finally {
      setLoading(false)
    }
  }, [profile, pushToast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => pitchStore.subscribe(load), [load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return groups
      .filter((g) => (filter === 'all' ? true : filter === 'archived' ? g.is_active === false : g.is_active !== false))
      .filter((g) => !q || `${g.class_section} ${g.class_teacher?.full_name || ''}`.toLowerCase().includes(q))
  }, [groups, query, filter])

  const totalStudents = groups.reduce((n, g) => n + (g.student_count || 0), 0)
  const totalTeachers = groups.reduce((n, g) => n + (g.teacher_count || 0), 0)
  const noTeacher = groups.filter((g) => !g.class_teacher).length
  const archived = groups.filter((g) => g.is_active === false).length

  const setArchive = async (group, active) => {
    setBusy(true)
    try {
      await db.setGroupActive(group.id, active, { actor: { id: profile?.id, name: profile?.full_name } })
      pushToast({
        tone: 'success',
        title: active ? 'Group reopened' : 'Group archived',
        message: `${group.class_section} — every post and comment was kept.`,
      })
      setConfirm(null)
      await load()
    } catch (e) {
      pushToast({ tone: 'error', title: 'Could not change the group', message: e.message })
    } finally {
      setBusy(false)
    }
  }

  const columns = [
    {
      key: 'class_section',
      header: 'Class',
      sortable: true,
      strong: true,
      render: (g) => (
        <div className="min-w-0">
          <Link to={`/admin/groups/${encodeURIComponent(g.id)}`} className="text-sm font-bold t1 hover:underline block truncate">
            {g.class_section}
          </Link>
          <span className="meta">{g.member_count ?? 0} members · {g.post_count ?? 0} posts</span>
        </div>
      ),
    },
    {
      key: 'class_teacher_name',
      header: 'Class teacher',
      sortable: true,
      render: (g) =>
        g.class_teacher?.full_name ? (
          <span className="flex items-center gap-2 min-w-0">
            <Avatar name={g.class_teacher?.full_name} size="sm" tone="accent" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold t1 truncate">{g.class_teacher?.full_name}</span>
              <span className="block meta truncate">{g.class_teacher?.subject || 'Manager of this group'}</span>
            </span>
          </span>
        ) : (
          <Chip tone="warning" icon={Lock}>
            unassigned
          </Chip>
        ),
    },
    {
      key: 'teacher_count',
      header: 'Teachers',
      align: 'right',
      sortable: true,
      sortValue: (g) => g.teacher_count || 0,
      render: (g) => <span className="num tabular-nums">{g.teacher_count ?? 0}</span>,
    },
    {
      key: 'student_count',
      header: 'Students',
      align: 'right',
      sortable: true,
      sortValue: (g) => g.student_count || 0,
      render: (g) => <span className="num tabular-nums">{g.student_count ?? 0}</span>,
    },
    {
      key: 'post_count',
      header: 'Activity',
      sortable: true,
      sortValue: (g) => String(g.last_post_at || ''),
      render: (g) => (
        <span className="flex items-center gap-2 min-w-0">
          <span className="meta whitespace-nowrap">{ago(g.last_post_at)}</span>
          {g.is_active === false ? (
            <Chip tone="neutral" icon={Archive}>
              archived
            </Chip>
          ) : null}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (g) => (
        <div className="flex items-center justify-end gap-1.5">
          <IconButton label={`Manage teachers for ${g.class_section}`} icon={UserPlus} size="sm" onClick={() => openManager(g)} />
          <Dropdown
            align="end"
            width="w-60"
            label={`More actions for ${g.class_section}`}
            trigger={<Search size={16} />}
          >
            {({ close }) => (
              <>
                <MenuItem
                  icon={ExternalLink}
                  onClick={() => {
                    close()
                    navigate(`/admin/groups/${encodeURIComponent(g.id)}`)
                  }}
                >
                  Open the group
                </MenuItem>
                <MenuItem
                  icon={Users}
                  onClick={() => {
                    close()
                    navigate(`/admin/sections?class=${encodeURIComponent(g.class_section_id || '')}`)
                  }}
                >
                  Change class teacher
                </MenuItem>
                <MenuItem
                  icon={g.is_active === false ? ArchiveRestore : Archive}
                  danger={g.is_active !== false}
                  onClick={() => {
                    close()
                    setConfirm(g)
                  }}
                >
                  {g.is_active === false ? 'Reopen group' : 'Archive group'}
                </MenuItem>
              </>
            )}
          </Dropdown>
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="ChronoConnect"
        title="Class group management"
        sub="One private group per class-section, generated from the classes themselves. Assign a class teacher on the class and they gain manager rights here automatically."
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Class Groups' }]}
        actions={
          <Button variant="quiet" tone="brand" onClick={() => navigate('/admin/sections')}>
            Classes &amp; sections
          </Button>
        }
      />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat label="Groups live" value={groups.length - archived} sub={`${groups.length} classes with a group`} icon={Megaphone} tone="brand" />
        <Stat label="Teachers inside groups" value={totalTeachers} sub="class teachers plus added staff" icon={Users} tone="sage" />
        <Stat label="Students reached" value={totalStudents} sub="from the enrollment roll" icon={GraduationCap} tone="info" />
        <Stat label="Needs a class teacher" value={noTeacher} sub="group has no manager" icon={Lock} tone={noTeacher ? 'warning' : 'neutral'} />
      </div>

      {noTeacher ? (
        <Alert tone="warning" title={`${noTeacher} group${noTeacher === 1 ? '' : 's'} have no class teacher`}>
          Nobody can manage their membership until the office assigns one on the class register.{' '}
          <Link to="/admin/sections" className="font-bold underline">
            Assign a class teacher
          </Link>
        </Alert>
      ) : null}

      <Card>
        <CardHead
          title="Every class group"
          sub={`${shown.length} of ${groups.length} shown`}
          right={
            <>
              <Segmented
                label="Filter"
                value={filter}
                onChange={setFilter}
                items={[
                  { id: 'all', label: 'All' },
                  { id: 'active', label: 'Active' },
                  { id: 'archived', label: 'Archived' },
                ]}
              />
              <SearchInput className="w-[190px]" value={query} onChange={setQuery} placeholder="Search class or teacher" />
            </>
          }
        />
        <div className="px-4 pb-4">
          {loading ? (
            <SkeletonRows rows={6} />
          ) : groups.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="No class groups yet"
              hint="A group is created the moment a class-section exists. Add a class and its group appears here."
              action={
                <Button variant="primary" onClick={() => navigate('/admin/sections')}>
                  Create a class
                </Button>
              }
            />
          ) : shown.length === 0 ? (
            <EmptyState icon={Search} title="Nothing matches that filter" hint="Clear the search or switch back to All." />
          ) : (
            <DataTable columns={columns} rows={shown} getRowId={(g) => g.id} pageSize={15} searchable={false} stickyHeader={false} />
          )}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="display text-md font-bold mb-3">Membership coverage</h3>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {groups.slice(0, 9).map((g) => {
            const total = (g.teacher_count || 0) + (g.student_count || 0)
            return (
              <ProgressBar
                key={g.id}
                label={g.class_section}
                value={g.student_count || 0}
                max={Math.max(1, total)}
                tone="info"
                sub={`${g.teacher_count ?? 0} teachers · ${g.student_count ?? 0} students`}
              />
            )
          })}
        </div>
        <p className="meta mt-4">
          Bars show how much of each group is the class roll rather than added staff. Student membership always comes from
          enrollment, so it can never be padded from this screen.
        </p>
      </Card>

      {manage ? (
        <ManageTeachers open onClose={() => setManage(null)} group={fullGroup || manage} onChanged={load} />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => setArchive(confirm, confirm?.is_active === false)}
        busy={busy}
        tone={confirm?.is_active === false ? 'success' : 'danger'}
        title={confirm?.is_active === false ? `Reopen ${confirm?.class_section}?` : `Archive ${confirm?.class_section}?`}
        body={
          confirm?.is_active === false
            ? 'Members regain the right to post. Nothing is restored that was deleted while it was closed.'
            : 'The group becomes read-only for everyone. Announcements, posts and comments are all kept — this is how a passed-out class stays on record.'
        }
        confirmLabel={confirm?.is_active === false ? 'Reopen group' : 'Archive group'}
      />
    </div>
  )
}

/** The full member roster for one group, used by the admin drill-in. */
export function GroupMembersInline({ group }) {
  if (!group?.teachers?.length) return null
  return (
    <ul className="list-none m-0 p-0 space-y-2">
      {group.teachers.map((m) => (
        <li key={m.user_id} className="flex items-center gap-2.5 min-w-0">
          <Avatar name={m.person?.full_name || ''} size="sm" tone={m.role === GROUP_ROLE.manager ? 'accent' : 'sage'} />
          <span className="text-sm t1 truncate flex-1">{m.person?.full_name}</span>
          <span className="meta shrink-0">{memberSource(m)}</span>
          <Chip tone={m.role === GROUP_ROLE.manager ? 'accent' : 'neutral'}>{memberBadge(m.role)}</Chip>
        </li>
      ))}
    </ul>
  )
}
