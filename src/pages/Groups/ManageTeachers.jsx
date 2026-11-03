import { useEffect, useMemo, useState } from 'react'
import { History, Search, UserPlus, Users, UserX } from 'lucide-react'
import { db } from '../../lib/supabase'
import { useApp } from '../../context/AppContext'
import { GROUP_ROLE, memberBadge, memberSource } from '../../lib/groups'
import {
  Alert,
  Avatar,
  Button,
  Checkbox,
  Chip,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Modal,
  SearchInput,
  SkeletonRows,
  Tabs,
} from '../../components/ui/primitives'

const when = (iso) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

/**
 * The class teacher's own tool: add registered staff to the group, remove only
 * what they added, and see who changed what. The official Class Teacher is never
 * offered here — that assignment belongs to the admin.
 */
export default function ManageTeachers({ open, onClose, group, onChanged }) {
  const { profile, pushToast } = useApp()
  const [tab, setTab] = useState('members')
  const [candidates, setCandidates] = useState([])
  const [log, setLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState([])
  const [query, setQuery] = useState('')
  const [removing, setRemoving] = useState(null)

  const load = async () => {
    if (!group?.id) return
    setLoading(true)
    try {
      const [c, l] = await Promise.all([
        db.groupCandidateTeachers(group.id, { profile }),
        db.groupMembershipLog(group.id, { profile }),
      ])
      setCandidates(c || [])
      setLog(l || [])
    } catch (e) {
      pushToast({ tone: 'error', title: 'Could not open group management', message: e.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      setPicked([])
      load()
    }
  }, [open, group?.id, profile?.id])

  const members = useMemo(() => group?.teachers || [], [group])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return candidates.filter((c) => !q || `${c.full_name} ${c.subject} ${c.employee_id} ${(c.extra || []).join(' ')}`.toLowerCase().includes(q))
  }, [candidates, query])

  const addable = filtered.filter((c) => !c.is_member)
  const inside = filtered.filter((c) => c.is_member)

  const add = async () => {
    if (!picked.length) return
    setBusy(true)
    try {
      const res = await db.addGroupTeachers(group.id, picked, {
        actor: { id: profile?.id, name: profile?.full_name },
      })
      const bits = [
        res.added?.length ? `${res.added.length} added` : '',
        res.already?.length ? `${res.already.length} already in the group` : '',
        res.rejected?.length ? `${res.rejected.length} refused (${res.rejected.map((r) => r.reason).join('; ')})` : '',
      ].filter(Boolean)
      pushToast({ tone: res.rejected?.length ? 'warning' : 'success', title: 'Group membership updated', message: bits.join(' · ') || 'Nothing changed.' })
      setPicked([])
      await load()
      await onChanged?.()
    } catch (e) {
      pushToast({ tone: 'error', title: 'Could not add teachers', message: e.message })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await db.removeGroupTeacher(group.id, removing.user_id, {
        actor: { id: profile?.id, name: profile?.full_name },
      })
      pushToast({ tone: 'success', title: 'Removed from group', message: `${removing.person?.full_name} can no longer post here.` })
      setRemoving(null)
      await load()
      await onChanged?.()
    } catch (e) {
      pushToast({ tone: 'error', title: 'Could not remove them', message: e.message })
    } finally {
      setBusy(false)
    }
  }

  /* A class teacher may remove only what they (or the admin) added by hand. */
  const removable = (row) =>
    row.role !== GROUP_ROLE.manager && row.source !== 'class_teacher' && row.source !== 'enrolment'

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Manage group · ${group?.class_section || ''}`}
        sub="Add registered staff, remove the ones you added, and see the full change trail."
        icon={UserPlus}
        tone="accent"
        width="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Done
            </Button>
            <Button variant="primary" icon={UserPlus} onClick={add} disabled={!picked.length} loading={busy}>
              Add {picked.length ? `${picked.length} teacher${picked.length > 1 ? 's' : ''}` : 'teachers'}
            </Button>
          </>
        }
      >
        <Tabs
          label="Group management"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'members', label: 'Members', icon: Users, count: members.length },
            { id: 'add', label: 'Add teachers', icon: UserPlus, count: addable.length },
            { id: 'log', label: 'Change log', icon: History, count: log.length },
          ]}
        />

        {loading ? (
          <SkeletonRows rows={5} className="mt-4" />
        ) : tab === 'members' ? (
          <div className="mt-4 space-y-2">
            {members.length === 0 ? (
              <EmptyState icon={UserPlus} title="No teachers in this group yet" hint="Use Add teachers to bring in registered staff who teach this class." />
            ) : (
              members.map((m) => (
                <div key={m.user_id} data-tone={m.role === GROUP_ROLE.manager ? 'accent' : 'sage'} className="card-flat px-3.5 py-3 flex items-center gap-3">
                  <Avatar name={m.person?.full_name || ''} size="sm" tone={m.role === GROUP_ROLE.manager ? 'accent' : 'sage'} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold t1 truncate">{m.person?.full_name || 'Unknown staff'}</p>
                    <p className="meta truncate">
                      {m.person?.subject || '—'}
                      {m.person?.employee_id ? ` · ${m.person.employee_id}` : ''} · {memberSource(m)}
                      {m.added_at ? ` · ${when(m.added_at)}` : ''}
                    </p>
                  </div>
                  <Chip tone={m.role === GROUP_ROLE.manager ? 'accent' : 'neutral'}>{memberBadge(m.role)}</Chip>
                  {removable(m) ? (
                    <IconButton
                      label={`Remove ${m.person?.full_name || 'teacher'} from the group`}
                      icon={UserX}
                      size="sm"
                      onClick={() => setRemoving(m)}
                    />
                  ) : (
                    <span className="meta shrink-0" title="This membership comes from the class structure, not from you.">
                      {m.role === GROUP_ROLE.manager ? 'official' : 'from structure'}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        ) : tab === 'add' ? (
          <div className="mt-4">
            <SearchInput value={query} onChange={setQuery} placeholder="Search by name, employee ID or subject" className="mb-3" />
            <Alert tone="info" className="mb-3">
              Only staff already in the school directory can be added. Someone who is not registered does not appear here at
              all, so a group can never gain an invented member.
            </Alert>
            {addable.length === 0 ? (
              <EmptyState
                icon={Search}
                title={query ? 'No registered teacher matches that search' : 'Every registered teacher is already in this group'}
                hint={query ? 'Try a shorter term, or search by employee ID.' : 'Use the directory to add staff to the school first.'}
              />
            ) : (
              <ul className="list-none m-0 p-0 space-y-1.5 max-h-[320px] overflow-y-auto scroll">
                {addable.map((c) => (
                  <li key={c.id} className="card-flat px-3.5 py-3">
                    <Checkbox
                      id={`add-${c.id}`}
                      checked={picked.includes(String(c.id))}
                      onChange={(e) =>
                        setPicked((p) => (e.target.checked ? [...p, String(c.id)] : p.filter((x) => x !== String(c.id))))
                      }
                      label={c.full_name}
                      hint={`${c.subject || 'No subject'}${c.employee_id ? ` · ${c.employee_id}` : ''}${c.extra?.length ? ` · also ${c.extra.join(', ')}` : ''}${c.teaches_this_class ? ' · teaches this class' : ''}`}
                    />
                  </li>
                ))}
              </ul>
            )}
            {inside.length ? (
              <div className="mt-4">
                <p className="field-label mb-2">Already in the group</p>
                <div className="flex flex-wrap gap-1.5">
                  {inside.map((c) => (
                    <Chip key={c.id} tone="neutral">
                      {c.full_name}
                    </Chip>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-4">
            {log.length === 0 ? (
              <EmptyState icon={History} title="No changes recorded" hint="Every add and removal is written down with who did it and when." />
            ) : (
              <ol className="list-none m-0 p-0 space-y-2">
                {log.map((l, i) => (
                  <li key={`${l.at}-${i}`} data-tone={l.action?.includes('remove') ? 'danger' : 'success'} className="card-flat px-3.5 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Chip tone={l.action?.includes('remove') ? 'danger' : 'success'}>{l.action}</Chip>
                      <span className="num text-2xs t3">{when(l.at)}</span>
                    </div>
                    <p className="text-sm t1 mt-1.5">
                      <span className="font-semibold">{l.teacher || l.person || 'A member'}</span>
                      {l.detail ? ` — ${l.detail}` : ''}
                    </p>
                    {l.by ? <p className="meta mt-0.5">by {l.by}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        busy={busy}
        tone="danger"
        title={`Remove ${removing?.person?.full_name || 'this teacher'} from ${group?.class_section || 'the group'}?`}
        body={
          <div className="space-y-2">
            <p>
              They stop posting to this group immediately. Their existing posts stay in the feed and are marked as written by
              a former member, so the history of the class is never rewritten.
            </p>
            {removing?.added_at ? (
              <p className="text-xs t3">
                Added {when(removing.added_at)} by {removing.added_by_name || 'the school'}.
              </p>
            ) : null}
          </div>
        }
        confirmLabel="Remove from group"
      />
    </>
  )
}
