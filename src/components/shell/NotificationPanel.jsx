import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Inbox, MailOpen, Trash2 } from 'lucide-react'
import { db } from '../../lib/supabase'
import { useApp } from '../../context/AppContext'
import { pitchStore } from '../../lib/pitchStore'
import { Avatar, Button, EmptyState, IconButton, Skeleton, Tabs } from '../ui/primitives'

const KIND_TONE = {
  timetable: 'brand',
  substitution: 'warning',
  homework: 'accent',
  group: 'sage',
  enrollment: 'info',
  approval: 'success',
  system: 'neutral',
  absence: 'danger',
  calendar: 'clay',
}

const TABS = [
  { id: 'all', label: 'Inbox', icon: Inbox },
  { id: 'unread', label: 'Unread' },
  { id: 'read', label: 'Read' },
]

export function useNotifications(role, { enabled = true } = {}) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!role) return
    setLoading(true)
    try {
      setItems(await db.listNotifications(role, { limit: 60, tab: 'all' }))
    } finally {
      setLoading(false)
    }
  }, [role])

  useEffect(() => {
    if (!enabled) return undefined
    load()
  }, [load, enabled])

  useEffect(() => {
    if (!enabled) return undefined
    return pitchStore.subscribe(load)
  }, [load, enabled])

  const unread = useMemo(() => items.filter((n) => !n.read).length, [items])
  return { items, unread, loading, reload: load }
}

/**
 * Floating glass notification panel — inbox, unread and read filters,
 * per-item read, mark-all, and a jump to the record the notice came from.
 */
export default function NotificationPanel({ role, onClose, onCountChange }) {
  const navigate = useNavigate()
  const { items, unread, loading, reload } = useNotifications(role)
  const [tab, setTab] = useState('all')
  const box = useRef(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    const onDown = (e) => {
      if (box.current && !box.current.contains(e.target)) onClose?.()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const shown = useMemo(
    () => (tab === 'unread' ? items.filter((n) => !n.read) : tab === 'read' ? items.filter((n) => n.read) : items),
    [items, tab],
  )

  const counts = useMemo(
    () => ({ all: items.length, unread, read: items.length - unread }),
    [items.length, unread],
  )

  const open = async (n) => {
    if (!n.read) {
      await db.markNotification(n.id, true)
      await reload()
      onCountChange?.()
    }
    if (n.link) {
      onClose?.()
      navigate(n.link)
    }
  }

  const markAll = async () => {
    await db.markAllNotifications(role)
    await reload()
    onCountChange?.()
  }

  const drop = async (id) => {
    await db.deleteNotification(id)
    await reload()
    onCountChange?.()
  }

  return (
    <div
      ref={box}
      role="dialog"
      aria-label="Notifications"
      className="pop absolute right-0 top-[calc(100%+10px)] z-50 w-[min(420px,calc(100vw-24px))] overflow-hidden"
    >
      <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          <Bell size={17} className="text-[color:var(--color-brand-strong)]" aria-hidden />
          <h2 className="display text-md font-bold">Notification</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={CheckCheck}
          onClick={markAll}
          disabled={!unread}
          title={unread ? `Mark ${unread} as read` : 'Nothing unread'}
        >
          Mark all as read
        </Button>
      </header>

      <div className="px-4">
        <Tabs
          label="Notification filters"
          value={tab}
          onChange={setTab}
          items={TABS.map((t) => ({ ...t, count: counts[t.id], tone: t.id === 'unread' ? 'danger' : 'neutral' }))}
        />
      </div>

      <div className="scroll max-h-[min(460px,60vh)] overflow-y-auto px-3 py-3">
        {loading ? (
          <div className="space-y-2.5" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-[14px]" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={tab === 'unread' ? MailOpen : Bell}
            title={tab === 'unread' ? 'Nothing unread' : tab === 'read' ? 'Nothing read yet' : 'No notifications'}
            hint={
              tab === 'all'
                ? 'Notices appear here when a timetable, group or enrollment changes.'
                : 'This filter has no entries right now.'
            }
            className="py-8"
          />
        ) : (
          <ul className="space-y-1.5 list-none m-0 p-0">
            {shown.map((n) => (
              <li key={n.id}>
                <div
                  data-tone={KIND_TONE[n.kind] || 'neutral'}
                  className={`group flex gap-3 rounded-[14px] border p-3 transition-colors ${
                    n.read ? 'border-transparent' : 'border-[color:var(--tone-line)] bg-[color:var(--tone-soft)]'
                  } hover:bg-[color:var(--hovered)]`}
                >
                  <Avatar name={n.kind || 'system'} size="sm" className="mt-0.5">
                    {n.kind?.[0]}
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="meta uppercase tracking-[0.07em]" style={{ color: 'var(--tone-ink)' }}>
                        {n.kind || 'system'}
                      </span>
                      <span className="meta">·</span>
                      <time className="meta">{n.when}</time>
                      {!n.read ? <span className="dot" aria-label="Unread" /> : null}
                    </div>
                    <button
                      type="button"
                      className="block text-left w-full mt-1"
                      onClick={() => open(n)}
                    >
                      <span className="block text-sm font-bold t1 leading-snug">{n.title}</span>
                      {n.body ? <span className="block text-xs t2 mt-1 line-clamp-3">{n.body}</span> : null}
                      {n.link ? (
                        <span className="block text-2xs font-bold mt-1.5" style={{ color: 'var(--tone-ink)' }}>
                          Open record →
                        </span>
                      ) : null}
                    </button>
                  </div>
                  <div className="flex flex-col items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    {!n.read ? (
                      <IconButton
                        label="Mark as read"
                        icon={MailOpen}
                        size="sm"
                        onClick={async () => {
                          await db.markNotification(n.id, true)
                          await reload()
                          onCountChange?.()
                        }}
                      />
                    ) : null}
                    <IconButton
                      label="Delete notification"
                      icon={Trash2}
                      size="sm"
                      onClick={() => drop(n.id)}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
