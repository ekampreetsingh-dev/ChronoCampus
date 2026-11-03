import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpen,
  GraduationCap,
  Lock,
  Megaphone,
  Pin,
  Search,
  Send,
  Settings2,
  ThumbsUp,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { db } from '../../lib/supabase'
import { useApp } from '../../context/AppContext'
import { pitchStore } from '../../lib/pitchStore'
import { GROUP_ROLE, can, isLocked, memberBadge } from '../../lib/groups'
import {
  Alert,
  Avatar,
  Button,
  Card,
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
  Switch,
  Textarea,
  Tooltip,
} from '../../components/ui/primitives'
import ManageTeachers from './ManageTeachers'

/** Same rule as the notification centre: a future post must not read as history. */
const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  const future = mins < 0
  const abs = Math.abs(mins)
  if (abs < 1) return 'just now'
  if (abs < 60) return future ? `in ${abs}m` : `${abs}m ago`
  if (abs < 1440) return future ? `in ${Math.round(abs / 60)}h` : `${Math.round(abs / 60)}h ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** Which portal owns this route. */
const rootFor = (role) => (role === 'admin' ? '/admin' : role === 'teacher' ? '/teacher' : '/student')

export default function GroupPage({ base } = {}) {
  const { groupId } = useParams()
  const { profile, role, pushToast } = useApp()
  const navigate = useNavigate()
  const [group, setGroup] = useState(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(null)
  const [manage, setManage] = useState(false)
  const [settings, setSettings] = useState(false)
  const [query, setQuery] = useState('')
  const [feed, setFeed] = useState('all')

  const load = useCallback(async () => {
    if (!groupId) return
    try {
      setGroup(await db.getGroup(groupId, { profile }))
      setDenied(null)
    } catch (e) {
      setDenied(e.message || 'You cannot open this group.')
    } finally {
      setLoading(false)
    }
  }, [groupId, profile])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!profile) return undefined
    return pitchStore.subscribe(load)
  }, [load, profile])

  const root = base || rootFor(role)

  if (loading) return <SkeletonRows rows={6} />

  if (denied) {
    return (
      <div className="flex flex-col gap-4">
        <Link to={`${root}/groups`} className="tapline text-sm font-bold inline-flex items-center gap-1.5 w-fit">
          <ArrowLeft size={14} aria-hidden /> Back to my groups
        </Link>
        <Card>
          <EmptyState icon={Lock} title="This group is not open to you" hint={denied} />
        </Card>
      </div>
    )
  }

  const myRole = group.my_role
  const teacher = group.class_teacher || null
  const locked = isLocked(group)
  const perms = {
    post: can.post({ role: myRole, group, settings: group.settings }),
    comment: can.comment({ role: myRole, group, settings: group.settings }),
    react: can.react({ role: myRole, group, settings: group.settings }),
    moderate: can.moderate({ role: myRole }),
    teachers: can.manageTeachers({ role: myRole }),
    settings: can.settings({ role: myRole }),
  }

  return (
    <div className="flex flex-col gap-5">
      <Link to={`${root}/groups`} className="tapline text-sm font-bold inline-flex items-center gap-1.5 w-fit">
        <ArrowLeft size={14} aria-hidden /> {role === 'student' ? 'My class group' : 'My groups'}
      </Link>

      <PageHeader
        eyebrow={`ChronoConnect · ${group.section?.stream || 'class group'}`}
        title={group.class_section}
        sub={`The private group for ${group.class_section}. Members see each other's announcements; nobody outside the class can read it.`}
        breadcrumbs={[
          { label: role ? role[0].toUpperCase() + role.slice(1) : 'Home', to: root },
          { label: 'Class Groups', to: `${root}/groups` },
          { label: group.class_section },
        ]}
        actions={
          <>
            {locked ? (
              <Chip tone="neutral" icon={Lock}>
                archived · read only
              </Chip>
            ) : null}
            {perms.settings ? (
              <IconButton label="Group settings" icon={Settings2} onClick={() => setSettings(true)} />
            ) : null}
            {perms.teachers ? (
              <Button variant="primary" icon={UserPlus} onClick={() => setManage(true)}>
                Manage teachers
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        {/* ------------------------------------------------------------ feed */}
        <div className="flex flex-col gap-4 min-w-0">
          <Card className="p-4">
            <Composer group={group} perms={perms} profile={profile} onPosted={load} />
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label="Feed filter"
              value={feed}
              onChange={setFeed}
              items={[
                { id: 'all', label: 'Everything' },
                { id: 'announcements', label: 'Announcements', icon: Megaphone },
                { id: 'pinned', label: 'Pinned', icon: Pin },
                { id: 'homework', label: 'Homework', icon: BookOpen },
              ]}
            />
            <SearchInput className="flex-1 min-w-[180px] max-w-[280px]" value={query} onChange={setQuery} placeholder="Search this group" />
          </div>

          <Feed group={group} perms={perms} profile={profile} query={query} filter={feed} onChanged={load} />
        </div>

        {/* ---------------------------------------------------------- sidebar */}
        <aside className="flex flex-col gap-4">
          <Card className="p-5">
            <p className="field-label mb-3">Class teacher</p>
            <div className="flex items-center gap-3 min-w-0">
              <Avatar name={teacher?.full_name || 'Not assigned'} size="lg" tone="accent" />
              <div className="min-w-0">
                <p className="display text-md font-bold truncate">{teacher?.full_name || 'No class teacher assigned'}</p>
                <p className="meta truncate">{teacher?.subject || 'The office assigns this'}</p>
              </div>
            </div>
            {group.section ? (
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                  <dt className="meta">Room</dt>
                  <dd className="font-bold t1 m-0">{group.section.default_room || '—'}</dd>
                </div>
                <div>
                  <dt className="meta">Bells</dt>
                  <dd className="font-bold t1 m-0">{group.section.bell_schedule_id || '—'}</dd>
                </div>
              </dl>
            ) : null}
            {myRole !== GROUP_ROLE.manager && myRole !== 'admin' ? (
              <p className="meta mt-4 leading-relaxed">
                Only the class teacher and the school admin can change who is in this group.
              </p>
            ) : null}
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="field-label mb-0">Teachers in the group</p>
              <Chip tone="sage">{group.teachers?.length || 0}</Chip>
            </div>
            <ul className="list-none m-0 p-0 space-y-2.5">
              {(group.teachers || []).slice(0, 8).map((m) => (
                <li key={m.user_id} className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={m.person?.full_name || ''} size="sm" tone={m.role === GROUP_ROLE.manager ? 'accent' : 'sage'} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold t1 truncate">{m.person?.full_name}</p>
                    <p className="meta truncate">{m.person?.subject || '—'}</p>
                  </div>
                  {m.role === GROUP_ROLE.manager ? (
                    <Tooltip content="The officially assigned class teacher">
                      <Chip tone="accent">Class teacher</Chip>
                    </Tooltip>
                  ) : (
                    <Chip tone="neutral">{memberBadge(m.role)}</Chip>
                  )}
                </li>
              ))}
              {(group.teachers || []).length === 0 ? <li className="text-sm t3">No teachers have been added beyond the class teacher.</li> : null}
            </ul>
            {perms.teachers && (group.teachers || []).length > 1 ? (
              <Button variant="quiet" tone="sage" size="sm" block className="mt-4" icon={UserPlus} onClick={() => setManage(true)}>
                Add or remove teachers
              </Button>
            ) : null}
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <p className="field-label mb-0">Students enrolled</p>
              <Chip tone="info" icon={GraduationCap}>
                {group.students?.length ?? group.student_count ?? 0}
              </Chip>
            </div>
            <p className="meta mt-2.5 leading-relaxed">
              Students join this group automatically from their enrollment record. Membership follows the class roll — it is
              not edited here.
            </p>
            {group.students?.length ? (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {group.students.slice(0, 12).map((s) => (
                  <Chip key={s.user_id} tone="neutral">
                    {s.person?.full_name || s.user_id}
                  </Chip>
                ))}
                {group.students.length > 12 ? <Chip tone="neutral">+{group.students.length - 12} more</Chip> : null}
              </div>
            ) : null}
          </Card>

          <Card className="p-5">
            <p className="field-label mb-2.5">Group rules</p>
            <ul className="list-none m-0 p-0 space-y-2 text-xs t2">
              <li className="flex items-center justify-between gap-3">
                <span>Students can publish</span>
                <Chip tone={group.settings?.students_can_post ? 'success' : 'neutral'}>
                  {group.settings?.students_can_post ? 'allowed' : 'off'}
                </Chip>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span>Students can comment</span>
                <Chip tone={group.settings?.students_can_comment ? 'success' : 'neutral'}>
                  {group.settings?.students_can_comment ? 'allowed' : 'off'}
                </Chip>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span>Students can react</span>
                <Chip tone={group.settings?.students_can_react ? 'success' : 'neutral'}>
                  {group.settings?.students_can_react ? 'allowed' : 'off'}
                </Chip>
              </li>
            </ul>
          </Card>
        </aside>
      </div>

      <ManageTeachers open={manage} onClose={() => setManage(false)} group={group} onChanged={load} />
      <GroupSettingsModal
        open={settings}
        onClose={() => setSettings(false)}
        group={group}
        profile={profile}
        onSaved={load}
        pushToast={pushToast}
        navigate={navigate}
        role={role}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ composer */

function Composer({ group, perms, profile, onPosted }) {
  const [body, setBody] = useState('')
  const [kind, setKind] = useState('post')
  const [busy, setBusy] = useState(false)
  const { pushToast } = useApp()

  if (!perms.post) {
    return (
      <Alert tone="info" icon={Lock} title="You can read this group but not publish to it">
        {isLocked(group)
          ? 'This class is archived, so the group is read-only. The history stays available.'
          : 'The class teacher has left student posts switched off. You can still comment where that is allowed.'}
      </Alert>
    )
  }

  const submit = async () => {
    setBusy(true)
    try {
      await db.postToGroup({
        groupId: group.id,
        body,
        kind,
        author: { id: profile?.id, name: profile?.full_name },
      })
      setBody('')
      setKind('post')
      await onPosted?.()
      pushToast({ tone: 'success', title: kind === 'announcement' ? 'Announcement pinned' : 'Posted', message: `Everyone in ${group.class_section} can see it.` })
    } catch (e) {
      pushToast({ tone: 'error', title: 'Could not publish', message: e.message })
    } finally {
      setBusy(false)
    }
  }

  const mayAnnounce = perms.moderate

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Avatar name={profile?.full_name || ''} size="sm" tone="brand" />
        <span className="text-sm font-bold t1 truncate">{profile?.full_name}</span>
        <span className="meta ml-auto">{memberBadge(perms.moderate ? GROUP_ROLE.manager : group.my_role)}</span>
      </div>
      <Field label={kind === 'announcement' ? 'Announcement' : 'Message to the class'} htmlFor="group-composer">
        <Textarea
          id="group-composer"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            kind === 'announcement'
              ? 'Half-yearly exam dates are confirmed. Practical files due Friday.'
              : 'Share a note with the class — homework, a reminder, or a question for your teachers.'
          }
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Post type"
          value={kind}
          onChange={setKind}
          items={[
            { id: 'post', label: 'Post', icon: Send },
            ...(mayAnnounce ? [{ id: 'announcement', label: 'Announcement', icon: Megaphone }] : []),
          ]}
        />
        <Button
          className="ml-auto"
          variant="primary"
          icon={Send}
          onClick={submit}
          loading={busy}
          disabled={body.trim().length < 2}
        >
          Publish
        </Button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------- feed */

function Feed({ group, perms, profile, query, filter, onChanged }) {
  const posts = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (group.posts || [])
      .filter((p) => (filter === 'all' ? true : filter === 'pinned' ? p.pinned : filter === 'homework' ? p.kind === 'homework' : p.kind === 'announcement'))
      .filter((p) => !q || `${p.body} ${p.author_name}`.toLowerCase().includes(q))
  }, [group.posts, query, filter])

  const pinned = posts.filter((p) => p.pinned)
  const rest = posts.filter((p) => !p.pinned)

  if (!posts.length) {
    return (
      <Card>
        <EmptyState
          icon={Search}
          title={query || filter !== 'all' ? 'Nothing matches that filter' : 'The feed is empty'}
          hint={
            query || filter !== 'all'
              ? 'Clear the search or switch back to Everything.'
              : 'The first announcement from the class teacher will appear here.'
          }
        />
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {pinned.length ? (
        <div className="flex flex-col gap-3">
          {pinned.map((p) => (
            <Post key={p.id} post={p} group={group} perms={perms} profile={profile} onChanged={onChanged} />
          ))}
        </div>
      ) : null}
      {rest.map((p) => (
        <Post key={p.id} post={p} group={group} perms={perms} profile={profile} onChanged={onChanged} />
      ))}
    </div>
  )
}

function Post({ post, group, perms, profile, onChanged }) {
  const { pushToast } = useApp()
  const [comment, setComment] = useState('')
  const [confirming, setConfirming] = useState(false)
  const reactions = Object.entries(post.reactions || {})
  const reacted = reactions.some(([id]) => String(id) === String(profile?.id))
  const tone = post.kind === 'announcement' ? 'accent' : post.kind === 'homework' ? 'brand' : 'sage'

  const act = async (fn, fail) => {
    try {
      await fn()
      await onChanged?.()
    } catch (e) {
      pushToast({ tone: 'error', title: fail, message: e.message })
    }
  }

  return (
    <article data-tone={tone} className="post" data-pinned={post.pinned || undefined}>
      <header className="flex items-center gap-3 mb-2.5">
        <Avatar name={post.author_name || ''} size="sm" tone={tone} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold t1 truncate">{post.author_name || 'Someone'}</p>
          <p className="meta truncate">
            {ago(post.created_at)}
            {post.author_role ? ` · ${memberBadge(post.author_role)}` : ''}
          </p>
        </div>
        {post.pinned ? (
          <Chip tone="accent" icon={Pin}>
            pinned
          </Chip>
        ) : null}
        {post.kind === 'announcement' ? (
          <Chip tone="accent" icon={Megaphone}>
            announcement
          </Chip>
        ) : null}
        {post.kind === 'homework' ? (
          <Chip tone="brand" icon={BookOpen}>
            homework
          </Chip>
        ) : null}
        {perms.moderate || String(post.author_id) === String(profile?.id) ? (
          <Dropdown
            align="end"
            width="w-52"
            label={`Actions for this ${post.kind} by ${post.author_name}`}
            trigger={<Settings2 size={15} />}
          >
            {({ close }) => (
              <>
                {perms.moderate ? (
                  <MenuItem
                    icon={Pin}
                    onClick={() => {
                      close()
                      act(() => db.setPostPinned(post.id, !post.pinned, { actor: { id: profile?.id, name: profile?.full_name } }), 'Could not pin')
                    }}
                  >
                    {post.pinned ? 'Unpin' : 'Pin to group'}
                  </MenuItem>
                ) : null}
                {perms.moderate || String(post.author_id) === String(profile?.id) ? (
                  <MenuItem icon={Trash2} danger onClick={() => { close(); setConfirming(true) }}>
                    Delete post
                  </MenuItem>
                ) : null}
              </>
            )}
          </Dropdown>
        ) : null}
      </header>

      <p className="feed-body">{post.body}</p>

      <footer className="flex flex-wrap items-center gap-2 mt-3">
        {perms.react ? (
          <button type="button" className="react" data-tone={tone} aria-pressed={reacted} onClick={() => act(() => db.reactToPost(post.id, { actor: { id: profile?.id, name: profile?.full_name } }), 'Could not react')}>
            <ThumbsUp size={13} aria-hidden /> {reactions.length ? reactions.length : ''} Like
          </button>
        ) : null}
        <span className="meta">
          {post.comments?.length || 0} comment{post.comments?.length === 1 ? '' : 's'}
        </span>
      </footer>

      {post.comments?.length ? (
        <ul className="list-none m-0 mt-3 pt-3 border-t border-[color:var(--color-line-soft)] space-y-2.5">
          {post.comments.map((c) => (
            <li key={c.id} className="flex gap-2.5 min-w-0">
              <Avatar name={c.author_name || ''} size="sm" tone="neutral" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold t1 truncate">
                  {c.author_name} <span className="meta font-normal">· {ago(c.created_at)}</span>
                </p>
                <p className="text-sm t2 leading-relaxed mt-0.5">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {perms.comment ? (
        <form
          className="flex items-center gap-2 mt-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (comment.trim().length < 2) return
            await act(async () => {
              await db.postToGroup({
                groupId: group.id,
                body: comment,
                parentId: post.id,
                author: { id: profile?.id, name: profile?.full_name },
              })
              setComment('')
            }, 'Could not comment')
          }}
        >
          <input
            className="input flex-1 min-w-0"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Reply to the class…"
            aria-label={`Comment on ${post.author_name}'s post`}
          />
          <Button type="submit" size="sm" icon={Send} disabled={comment.trim().length < 2}>
            Reply
          </Button>
        </form>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          await act(() => db.removePost(post.id, { actor: { id: profile?.id, name: profile?.full_name } }), 'Could not delete')
          setConfirming(false)
        }}
        title="Delete this post?"
        body="It disappears from the group feed for everyone. The class history keeps a record that it existed."
        confirmLabel="Delete post"
      />
    </article>
  )
}

/* ------------------------------------------------------------------ settings */

function GroupSettingsModal({ open, onClose, group, profile, onSaved, pushToast, navigate, role }) {
  const [draft, setDraft] = useState(group.settings || {})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setDraft(group.settings || {})
  }, [group.settings, open])

  const save = async () => {
    setBusy(true)
    try {
      await db.saveGroupSettings(group.id, draft, { actor: { id: profile?.id, name: profile?.full_name } })
      await onSaved?.()
      pushToast({ tone: 'success', title: 'Group settings saved', message: 'Every member sees the new rules immediately.' })
      onClose()
    } catch (e) {
      pushToast({ tone: 'error', title: 'Could not save settings', message: e.message })
    } finally {
      setBusy(false)
    }
  }

  const archive = async () => {
    setBusy(true)
    try {
      await db.setGroupActive(group.id, group.is_active === false, { actor: { id: profile?.id, name: profile?.full_name } })
      await onSaved?.()
      pushToast({
        tone: 'success',
        title: group.is_active === false ? 'Group reopened' : 'Group archived',
        message: 'Posts were kept either way — archiving never deletes history.',
      })
    } catch (e) {
      pushToast({ tone: 'error', title: 'Could not change the group state', message: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Group settings · ${group.class_section}`}
      sub="These rules decide what each member may do inside the group."
      icon={Settings2}
      tone="brand"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Save settings
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Switch
          label="Students can publish"
          hint="Off means students may only comment, where commenting is allowed."
          checked={Boolean(draft.students_can_post)}
          onChange={(v) => setDraft((d) => ({ ...d, students_can_post: v }))}
        />
        <Switch
          label="Students can comment"
          hint="Let students reply under a teacher's post."
          checked={Boolean(draft.students_can_comment)}
          onChange={(v) => setDraft((d) => ({ ...d, students_can_comment: v }))}
        />
        <Switch
          label="Students can react"
          hint="Show the like control to students."
          checked={Boolean(draft.students_can_react)}
          onChange={(v) => setDraft((d) => ({ ...d, students_can_react: v }))}
        />

        {role === 'admin' ? (
          <>
            <hr className="divider" />
            <div>
              <p className="field-label">Class record</p>
              <p className="text-sm t2 leading-relaxed mb-3">
                The official Class Teacher is set on the class itself, not here — changing it belongs in the class register so
                the timetable, the group and the roll stay in agreement.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="quiet" tone="brand" onClick={() => { onClose(); navigate('/admin/sections') }}>
                  Open class register
                </Button>
                <Button variant={group.is_active === false ? 'primary' : 'danger'} onClick={archive} loading={busy}>
                  {group.is_active === false ? 'Reopen group' : 'Archive group'}
                </Button>
              </div>
              <p className="meta mt-2.5">
                Archiving keeps every post and comment. Members can still read the group; nobody can write to it.
              </p>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  )
}
