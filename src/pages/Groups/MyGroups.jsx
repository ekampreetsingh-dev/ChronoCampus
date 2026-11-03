import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarClock, GraduationCap, Lock, Search, Users, UserSquare2 } from 'lucide-react'
import { db } from '../../lib/supabase'
import { useApp } from '../../context/AppContext'
import { pitchStore } from '../../lib/pitchStore'
import { GROUP_ROLE, memberBadge } from '../../lib/groups'
import {
  Avatar,
  Chip,
  EmptyState,
  PageHeader,
  SearchInput,
  Segmented,
  SkeletonRows,
  Stat,
} from '../../components/ui/primitives'

const ROLE_TONE = { admin: 'brand', manager: 'accent', teacher: 'sage', student: 'info' }

/**
 * "My Class Groups" for a teacher or a student. Teachers see every group they
 * manage or were added to, with the role they hold in each; students see only
 * their own class. Nothing here is hardcoded — the list is the membership table.
 */
export default function MyGroups() {
  const { profile, role, pushToast } = useApp()
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')

  const load = async () => {
    try {
      setGroups(await db.listGroups({ profile }))
    } catch (e) {
      pushToast({ tone: 'error', title: 'Could not read your groups', message: e.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [profile?.id])

  useEffect(() => pitchStore.subscribe(load), [profile?.id])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return groups
      .filter((g) => (filter === 'all' ? true : filter === 'managed' ? g.my_role === GROUP_ROLE.manager : g.my_role !== GROUP_ROLE.manager))
      .filter((g) => !q || `${g.class_section} ${g.class_teacher?.full_name || ''}`.toLowerCase().includes(q))
  }, [groups, query, filter])

  const managed = groups.filter((g) => g.my_role === GROUP_ROLE.manager).length

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="ChronoConnect"
        title={role === 'student' ? 'My class group' : 'My class groups'}
        sub={
          role === 'student'
            ? 'The group for the class you are enrolled in. Announcements from your class teacher and your subject teachers land here.'
            : 'Every group you manage or have been added to. Your role in each one decides what you can do inside it.'
        }
        breadcrumbs={[{ label: role ? role[0].toUpperCase() + role.slice(1) : 'Home', to: `/${role}` }, { label: 'Class Groups' }]}
      />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat label="Groups you belong to" value={groups.length} icon={Users} tone="brand" />
        {role === 'teacher' ? (
          <Stat label="As class teacher" value={managed} sub="you manage membership here" icon={UserSquare2} tone="accent" />
        ) : (
          <Stat label="Added by a teacher" value={groups.length - managed} icon={GraduationCap} tone="sage" />
        )}
        <Stat
          label="Students reached"
          value={groups.reduce((n, g) => n + (g.student_count || 0), 0)}
          sub="across your groups"
          icon={GraduationCap}
          tone="info"
        />
        <Stat
          label="Archived"
          value={groups.filter((g) => g.is_active === false).length}
          sub="read-only history"
          icon={Lock}
          tone="neutral"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {role === 'teacher' ? (
          <Segmented
            label="Filter groups"
            value={filter}
            onChange={setFilter}
            items={[
              { id: 'all', label: 'All' },
              { id: 'managed', label: 'I manage' },
              { id: 'added', label: 'Added to' },
            ]}
          />
        ) : null}
        <SearchInput className="flex-1 min-w-[200px] max-w-[320px]" value={query} onChange={setQuery} placeholder="Search by class or group name" />
      </div>

      {loading ? (
        <SkeletonRows rows={4} />
      ) : shown.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Search}
            title={groups.length ? 'No group matches that filter' : 'You are not in a class group yet'}
            hint={
              groups.length
                ? 'Clear the search or choose another filter to see the rest.'
                : role === 'student'
                  ? 'Verify a class code first — the group for your class is created automatically when the class exists.'
                  : 'Groups appear when you are assigned as a class teacher, or when one adds you. The office can also add you.'
            }
          />
        </div>
      ) : (
        <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 list-none m-0 p-0">
          {shown.map((g) => (
            <li key={g.id}>
              <GroupCard group={g} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function GroupCard({ group }) {
  const roleLabel = memberBadge(group.my_role === 'admin' ? GROUP_ROLE.manager : group.my_role)
  const tone = ROLE_TONE[group.my_role] || 'neutral'

  return (
    <Link
      to={groupLink(group)}
      data-tone={tone}
      className="card card-raise p-4 flex flex-col gap-3 h-full min-w-0"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="display text-lg font-extrabold t1 truncate">{group.class_section}</p>
          <p className="meta mt-0.5 truncate">
            {group.post_count || 0} post{group.post_count === 1 ? '' : 's'} in the feed
          </p>
        </div>
        <Chip tone={tone}>{roleLabel}</Chip>
      </div>

      <div className="flex items-center gap-2 min-w-0">
        <Avatar name={group.class_teacher?.full_name || 'Unassigned'} size="sm" tone="accent" />
        <div className="min-w-0">
          <p className="text-xs font-bold t1 truncate">{group.class_teacher?.full_name || 'No class teacher assigned'}</p>
          <p className="meta truncate">Class teacher</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-auto">
        <Chip tone="sage" icon={Users}>
          {group.teacher_count ?? 0} teachers
        </Chip>
        <Chip tone="info" icon={GraduationCap}>
          {group.student_count ?? 0} students
        </Chip>
        {group.is_active === false ? (
          <Chip tone="neutral" icon={Lock}>
            archived
          </Chip>
        ) : null}
        {group.last_post_at ? (
          <Chip tone="neutral" icon={CalendarClock}>
            last post {new Date(group.last_post_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </Chip>
        ) : null}
      </div>

      <span className="flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--tone-ink)' }}>
        Open group <ArrowRight size={13} aria-hidden />
      </span>
    </Link>
  )
}

/** The group lives under the role that owns the view. */
export function groupLink(group, base) {
  const root = base || (typeof window !== 'undefined' && window.location.pathname.startsWith('/student') ? '/student' : '/teacher')
  return `${root}/groups/${encodeURIComponent(group.id)}`
}
