import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  ChevronLeft,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  MoveRight,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sun,
  User,
  X,
} from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { NAV, findCrumb } from '../../config/navigation'
import { db } from '../../lib/supabase'
import Brand from '../Brand'
import CommandPalette from './CommandPalette'
import NotificationPanel, { useNotifications } from './NotificationPanel'
import { Avatar, Button, Dropdown, IconButton, MenuItem, Tooltip } from '../ui/primitives'

const RAIL_KEY = 'chronocampus.rail'
const ShellCtx = createContext(null)
export const useShell = () => useContext(ShellCtx) || {}

const isApple = () => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '')

/* ------------------------------------------------------------------ sidebar */

function NavList({ items, collapsed, role }) {
  return (
    <nav aria-label={`${role} navigation`} className="flex-1 min-h-0 overflow-y-auto scroll px-3 pb-3">
      {items.map((group) => (
        <div key={group.group} className="mb-5 last:mb-2">
          {collapsed ? (
            <div className="h-px bg-[color:var(--color-line)] mx-1 mb-3" aria-hidden />
          ) : (
            <p className="nav-group-label">{group.group}</p>
          )}
          <ul className="space-y-1 list-none m-0 p-0">
            {group.items.map((it) => {
              const link = (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}
                >
                  <it.icon size={18} aria-hidden />
                  {collapsed ? null : <span className="truncate">{it.label}</span>}
                  {collapsed ? null : it.badge ? <span className="badge ml-auto">{it.badge}</span> : null}
                </NavLink>
              )
              return (
                <li key={it.to}>
                  {collapsed ? (
                    <Tooltip content={it.label} side="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function Sidebar({ role, collapsed, onToggle, onNavigate, mobile }) {
  const { profile, demoOn, signOut } = useApp()
  const items = NAV[role] || []

  return (
    <aside
      className={
        mobile
          ? 'flex flex-col h-full w-full bg-[color:var(--glass-3)] backdrop-blur-2xl'
          : `shrink-0 flex flex-col border-r border-[color:var(--color-line-soft)] bg-[color:var(--well)] transition-[width] duration-300 ease-[cubic-bezier(.22,1,.36,1)] ${
              collapsed ? 'w-[74px]' : 'w-[254px]'
            }`
      }
      aria-label="Primary"
    >
      <div className={`flex items-center gap-2 px-3 h-[62px] shrink-0 overflow-hidden border-b border-[color:var(--color-line-soft)] ${collapsed && !mobile ? 'justify-center' : 'justify-between'}`}>
        <Brand compact={collapsed && !mobile} showWord={!collapsed || mobile} />
        {mobile ? (
          <IconButton label="Close menu" icon={X} onClick={onNavigate} />
        ) : collapsed ? null : (
          <IconButton
            label="Collapse sidebar"
            icon={PanelLeftClose}
            size="sm"
            onClick={onToggle}
          />
        )}
      </div>

      {/* Collapsed, the 74px column cannot hold the mark and the button side by
          side — and hiding the button left no way back to the expanded rail. */}
      {collapsed && !mobile ? (
        <div className="flex justify-center py-2 shrink-0 border-b border-[color:var(--color-line-soft)]">
          <Tooltip content="Expand sidebar" side="right">
            <IconButton label="Expand sidebar" icon={PanelLeftOpen} size="sm" onClick={onToggle} />
          </Tooltip>
        </div>
      ) : null}

      <NavList items={items} collapsed={collapsed && !mobile} role={role} />

      <div className="shrink-0 border-t border-[color:var(--color-line-soft)] p-3 space-y-2.5">
        {demoOn && !(collapsed && !mobile) ? (
          <span className="demo-flag w-full justify-center" data-tone="warning" title="This build runs on seeded local demo data.">
            <span className="dot" aria-hidden /> Demo data
          </span>
        ) : null}
        <div className={`flex items-center gap-2.5 min-w-0 ${collapsed && !mobile ? 'justify-center' : ''}`}>
          <Avatar name={profile?.full_name || 'Guest'} size="sm" tone="brand" />
          {collapsed && !mobile ? null : (
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold t1 truncate">{profile?.full_name || 'Not signed in'}</span>
              <span className="block text-2xs t3 capitalize truncate">{profile?.role || 'guest'}</span>
            </span>
          )}
          {collapsed && !mobile ? null : (
            <IconButton label="Sign out" icon={LogOut} size="sm" onClick={signOut} />
          )}
        </div>
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------ topbar */

function Topbar({ role, onOpenMenu, onOpenSearch, onOpenPalette }) {
  const { pathname } = useLocation()
  const { profile, theme, toggleTheme, demoOn } = useApp()
  const navigate = useNavigate()
  const [notices, setNotices] = useState(false)
  const { unread } = useNotifications(role, { enabled: demoOn || true })
  const crumb = useMemo(() => findCrumb(role, pathname), [role, pathname])

  return (
    <header className="topbar-glass sticky top-0 z-40 shrink-0 h-[62px] flex items-center gap-2 sm:gap-3 px-3 sm:px-5 border-b border-[color:var(--color-line-soft)] bg-[color:var(--glass-1)] backdrop-blur-xl">
      {/* Tablet only: the drawer is the tablet strategy, and on phones the bottom
          bar plus More already own navigation — two menu buttons would compete. */}
      <IconButton label="Open navigation" icon={Menu} className="hidden md:inline-flex lg:hidden" onClick={onOpenMenu} />

      <div className="min-w-0 flex-1">
        <p className="eyebrow truncate leading-none mb-1">{crumb?.group || role}</p>
        <h1 className="display text-md font-extrabold leading-none truncate">{crumb?.label || 'ChronoCampus'}</h1>
      </div>

      <button
        type="button"
        onClick={onOpenPalette}
        className="hidden md:flex items-center gap-2 h-9 pl-3 pr-2 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--well)] text-sm t3 hover:bg-[color:var(--well-hover)] hover:t2 transition-colors min-w-[200px]"
      >
        <Search size={15} aria-hidden />
        <span className="flex-1 text-left">Search the school…</span>
        <span className="meta px-1.5 py-0.5 rounded-md border border-[color:var(--color-line)] bg-[color:var(--glass-2)]">
          {isApple() ? '⌘K' : 'Ctrl K'}
        </span>
      </button>
      <IconButton label="Search" icon={Search} className="md:hidden" onClick={onOpenPalette} />

      <div className="relative">
        <IconButton
          label={`Notifications${unread ? `, ${unread} unread` : ''}`}
          icon={Bell}
          active={notices}
          onClick={() => setNotices((o) => !o)}
        />
        {unread ? (
          <span className="badge badge-count absolute -top-1 -right-1 pointer-events-none" aria-hidden>
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
        {notices ? <NotificationPanel role={role} onClose={() => setNotices(false)} /> : null}
      </div>

      <IconButton
        label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        icon={theme === 'dark' ? Sun : Moon}
        onClick={toggleTheme}
      />

      <Dropdown
        align="end"
        width="w-56"
        trigger={({ open, toggle }) => (
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Account menu"
            onClick={toggle}
            className="flex items-center gap-0 h-10 p-1 xl:gap-2 xl:pr-2 rounded-xl border border-[color:var(--color-line-soft)] bg-[color:var(--well)] hover:bg-[color:var(--well-hover)] transition-colors"
          >
            <Avatar name={profile?.full_name || 'Guest'} size="sm" tone="accent" />
            <span className="hidden xl:block text-xs font-bold t1 max-w-[110px] truncate">
              {profile?.full_name || 'Account'}
            </span>
            <ChevronLeft size={14} className="t3 hidden xl:block rotate-[-90deg]" aria-hidden />
          </button>
        )}
      >
        {({ close }) => (
          <>
            <div className="px-3 pt-2 pb-2 border-b border-[color:var(--color-line-soft)] mb-1">
              <p className="text-sm font-bold t1 truncate">{profile?.full_name}</p>
              <p className="text-2xs t3 truncate">{profile?.email}</p>
            </div>
            <MenuItem
              icon={User}
              onClick={() => {
                close()
                navigate(`/${role}/profile`)
              }}
            >
              My profile
            </MenuItem>
            {role === 'admin' ? (
              <MenuItem
                icon={Settings}
                onClick={() => {
                  close()
                  navigate('/admin/settings')
                }}
              >
                School settings
              </MenuItem>
            ) : null}
            <MenuItem
              icon={MoveRight}
              danger
              onClick={async () => {
                close()
                await db.signOut()
                navigate('/login', { replace: true })
              }}
            >
              Sign out
            </MenuItem>
          </>
        )}
      </Dropdown>
    </header>
  )
}

/* ------------------------------------------------------------------ mobile nav */

/** "My Timetable" → "Timetable": the first word alone is meaningless in a tab bar. */
const shortLabel = (label) => String(label).replace(/^(My|Master)\s+/i, '').split(' ')[0] || label

/** Locks the page behind an open overlay so the sheet and drawer never scroll
    the document underneath them. */
function useScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [active])
}

/**
 * Mobile: a fixed bottom bar carries the three primary destinations, and More
 * opens a grouped sheet with everything else. There is deliberately no hamburger
 * here — two controls that both open "the menu" is the thing this replaces.
 */
function MobileNav({ role }) {
  const groups = NAV[role] || []
  const flat = useMemo(() => groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group }))), [groups])
  const primary = flat.slice(0, 3)
  const rest = useMemo(() => {
    const byGroup = []
    for (const g of groups) {
      const items = g.items.filter((i) => !primary.some((p) => p.to === i.to))
      if (items.length) byGroup.push({ group: g.group, items })
    }
    return byGroup
  }, [groups, primary])
  const [more, setMore] = useState(false)
  const { pathname } = useLocation()
  const sheet = useRef(null)

  useScrollLock(more)

  useEffect(() => {
    if (!more) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setMore(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    sheet.current?.focus?.()
    return () => document.removeEventListener('keydown', onKey, true)
  }, [more])

  // leaving the route closes the sheet, so a selection never leaves it hanging
  useEffect(() => setMore(false), [pathname])

  return (
    <>
      <nav aria-label="Primary mobile" className="bottombar md:hidden">
        {primary.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) => `bottombar-item ${isActive ? 'is-active' : ''}`}
          >
            <it.icon size={20} aria-hidden />
            <span className="bottombar-label">{shortLabel(it.label)}</span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMore(true)}
          aria-haspopup="dialog"
          aria-expanded={more}
          className={`bottombar-item ${more ? 'is-active' : ''}`}
        >
          <MoreHorizontal size={20} aria-hidden />
          <span className="bottombar-label">More</span>
        </button>
      </nav>

      {more ? (
        <div className="fixed inset-0 z-[60] md:hidden">
          <div className="scrim" onClick={() => setMore(false)} aria-hidden />
          <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-label="All sections" tabIndex={-1}>
            <span className="sheet-grabber" aria-hidden />
            <div className="flex items-center justify-between gap-3 px-4 pt-1 pb-3 shrink-0">
              <h2 className="display text-lg font-bold">All sections</h2>
              <IconButton label="Close menu" icon={X} onClick={() => setMore(false)} />
            </div>
            <div className="scroll overflow-y-auto px-4 pb-2 min-h-0">
              {rest.map((g) => (
                <div key={g.group} className="mb-4">
                  <p className="nav-group-label">{g.group}</p>
                  <ul className="list-none m-0 p-0 space-y-1">
                    {g.items.map((it) => (
                      <li key={it.to}>
                        <NavLink
                          to={it.to}
                          end={it.end}
                          className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
                          aria-current={undefined}
                        >
                          <it.icon size={19} aria-hidden />
                          <span className="truncate">{it.label}</span>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {!rest.length ? <p className="text-sm t3 pb-3">Everything is already on the bar.</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

/* ------------------------------------------------------------------ shell */

export default function AppShell({ role, children, actions }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === '1'
    } catch {
      return false
    }
  })
  const [mobileMenu, setMobileMenu] = useState(false)
  const [palette, setPalette] = useState(false)
  const location = useLocation()
  const shellRef = useRef(null)

  const toggleRail = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(RAIL_KEY, c ? '0' : '1')
      } catch {
        /* storage disabled */
      }
      return !c
    })
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    setMobileMenu(false)
    shellRef.current?.scrollTo?.({ top: 0 })
  }, [location.pathname])

  // the tablet drawer behaves like a dialog: Escape closes it, page locks behind it
  useEffect(() => {
    if (!mobileMenu) return undefined
    const onKey = (e) => e.key === 'Escape' && setMobileMenu(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileMenu])

  useScrollLock(mobileMenu)

  const value = useMemo(
    () => ({ openPalette: () => setPalette(true), openMenu: () => setMobileMenu(true) }),
    [],
  )

  return (
    <ShellCtx.Provider value={value}>
      <div className="relative z-10 lg:p-3 2xl:p-4">
        {/* On desktop the shell is exactly the viewport tall and only <main>
            scrolls. With min-height instead, a long page grew the shell and the
            sidebar scrolled away with it — the rail ended up above the viewport. */}
        <div className="shell flex lg:h-[calc(100dvh-24px)] lg:overflow-hidden 2xl:lg:h-[calc(100dvh-32px)]">
          <div className="hidden lg:flex h-full">
            <Sidebar role={role} collapsed={collapsed} onToggle={toggleRail} />
          </div>

          {mobileMenu ? (
            <div className="fixed inset-0 z-[60] hidden md:block lg:hidden">
              <div className="scrim" onClick={() => setMobileMenu(false)} aria-hidden />
              <div className="nav-drawer absolute inset-y-0 left-0">
                <Sidebar role={role} mobile onNavigate={() => setMobileMenu(false)} onToggle={toggleRail} />
              </div>
            </div>
          ) : null}

          <div className="flex-1 min-w-0 flex flex-col lg:overflow-hidden">
            <Topbar
              role={role}
              onOpenMenu={() => setMobileMenu(true)}
              onOpenPalette={() => setPalette(true)}
            />
            {actions ? (
              <div className="px-4 sm:px-6 pt-4 flex flex-wrap items-center gap-2">{actions}</div>
            ) : null}
            <main
              ref={shellRef}
              key={location.pathname}
              className="flex-1 min-w-0 min-h-0 px-4 sm:px-6 lg:px-7 py-5 pb-[calc(var(--nav-bar-h)+28px)] md:pb-8 lg:pb-8 lg:overflow-y-auto rise"
            >
              {children ?? <Outlet />}
            </main>
          </div>
        </div>
      </div>

      <MobileNav role={role} />

      {palette ? <CommandPalette onClose={() => setPalette(false)} /> : null}
    </ShellCtx.Provider>
  )
}
