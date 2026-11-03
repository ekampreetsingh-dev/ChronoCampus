import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  BarChart3,
  BookOpen,
  CalendarClock,
  ClipboardList,
  CornerDownLeft,
  GraduationCap,
  KeyRound,
  Layers,
  LayoutGrid,
  NotebookPen,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Sparkles,
  Table2,
  User,
  Users,
} from 'lucide-react'
import { db } from '../../lib/supabase'
import { useApp } from '../../context/AppContext'
import { useSchoolData } from '../../hooks/useSchool'
import { roomShort } from '../../lib/subjects'
import { Avatar, Chip, IconButton, Skeleton } from '../ui/primitives'

const RECENT_KEY = 'chronocampus.search.recent'
const SHORTCUTS = 'Shortcuts'
const CAP = { Classes: 6, Teachers: 6, Students: 6, Subjects: 6, Timetable: 8, Homework: 6, [SHORTCUTS]: 8 }

const KIND_ICON = {
  class: Layers,
  teacher: Users,
  student: GraduationCap,
  subject: BookOpen,
  slot: LayoutGrid,
  homework: NotebookPen,
  action: Sparkles,
}

const clip = (s, n = 74) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}

const readRecent = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((r) => r && r.to && r.label).slice(0, 5) : []
  } catch {
    return []
  }
}

const writeRecent = (item) => {
  const next = [{ id: item.id, kind: item.kind, label: item.label, sub: item.sub, to: item.to, group: item.group }]
  for (const r of readRecent()) {
    if (next.length >= 5) break
    if (!next.some((n) => n.id === r.id || n.to === r.to)) next.push(r)
  }
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* storage disabled */
  }
  return next
}

/**
 * One palette over every record the signed-in role may see. Results come from the
 * school load the shell already holds, so a jump always lands on a real row.
 */
export default function CommandPalette({ onClose }) {
  const { role, profile, demoOn } = useApp()
  const school = useSchoolData()
  const navigate = useNavigate()
  const listId = useId()

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [catalog, setCatalog] = useState(null)
  const [recent, setRecent] = useState(readRecent)
  const input = useRef(null)
  const list = useRef(null)

  const isAdmin = role === 'admin'
  const isTeacher = role === 'teacher'
  const myClass = profile?.class_section || null

  useEffect(() => {
    input.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    if (catalog) return undefined
    let alive = true
    db.listSubjectCatalog()
      .then((c) => alive && setCatalog(c || []))
      .catch(() => alive && setCatalog([]))
    return () => {
      alive = false
    }
  }, [catalog])

  const teaches = useCallback(
    (slot) =>
      String(slot.teacher_id) === String(profile?.id) ||
      (Boolean(profile?.full_name) && slot.teacher_name === profile.full_name),
    [profile],
  )

  const ownSlots = useMemo(() => {
    const all = school.slots || []
    if (isAdmin) return all
    if (isTeacher) return all.filter((s) => teaches(s) || (s.is_substitution && s.substitute_teacher_name === profile?.full_name))
    if (role === 'student') return all.filter((s) => myClass && s.class_section === myClass)
    return []
  }, [school.slots, isAdmin, isTeacher, role, teaches, myClass, profile?.full_name])

  const sources = useMemo(() => {
    const seen = new Set()
    const uniq = (id) => (seen.has(id) ? false : (seen.add(id), true))
    const classPage = isAdmin ? '/admin/sections' : isTeacher ? '/teacher/timetable' : '/student/timetable'
    const teacherPage = isAdmin ? '/admin/teachers' : '/student/timetable'
    const subjectPage = isAdmin ? '/admin/subjects' : isTeacher ? '/teacher/timetable' : '/student/timetable'
    const sections = (school.sections || []).filter((s) => (isAdmin ? true : ownSlots.some((x) => x.class_section === s.name)))
    const teacherIds = new Set(ownSlots.map((s) => String(s.teacher_id)))
    const teachers = isAdmin ? school.teachers || [] : role === 'student' ? (school.teachers || []).filter((t) => teacherIds.has(String(t.id))) : []
    const mySubjects = new Set(ownSlots.map((s) => s.subject))
    const subjects = (catalog || []).flatMap((c) => {
      if (isAdmin) return [{ c, load: c.weekly, classes: (c.classes || []).length }]
      if (role === 'student') {
        const here = (c.classes || []).filter((cl) => cl.name === myClass)
        return here.length ? [{ c, load: here.reduce((n, cl) => n + (Number(cl.weekly) || 0), 0), classes: here.length }] : []
      }
      if (!mySubjects.has(c.subject)) return []
      const held = (c.classes || []).filter((cl) => ownSlots.some((s) => s.subject === c.subject && s.class_section === cl.name))
      const load = held.reduce((n, cl) => n + (Number(cl.weekly) || 0), 0) || c.weekly
      return [{ c, load, classes: held.length || 1 }]
    })

    return [
      {
        label: 'Classes',
        items: sections.map((s) => ({
          id: `class:${s.id}`,
          kind: 'class',
          label: s.name,
          sub: clip(`${roomShort(s.default_room) || 'no room'} · ${s.stream}${s.is_active === false ? ' · archived' : ''}`),
          to: classPage,
        })),
      },
      {
        label: 'Teachers',
        items: teachers
          .filter((t) => uniq(`t:${t.id}`))
          .map((t) => ({
            id: `teacher:${t.id}`,
            kind: 'teacher',
            label: t.full_name,
            sub: clip([t.subject, ...(t.extra || [])].filter(Boolean).join('/') + (t.employee_id ? ` · ${t.employee_id}` : '')),
            to: teacherPage,
          })),
      },
      ...(isAdmin
        ? [
            {
              label: 'Students',
              items: (school.studentDirectory || []).map((s) => ({
                id: `student:${s.id || s.email}`,
                kind: 'student',
                label: s.full_name,
                sub: clip(`${s.admission_number || s.roll_number || 'no roll no.'}${s.class_section ? ` · ${s.class_section}` : ' · not enrolled'}`),
                to: '/admin/students',
              })),
            },
          ]
        : []),
      {
        label: 'Subjects',
        items: subjects.map(({ c, load, classes }) => ({
          id: `subject:${c.subject}`,
          kind: 'subject',
          label: c.subject,
          sub: clip(`${load} periods/week · ${classes} ${classes === 1 ? 'class' : 'classes'}`),
          to: subjectPage,
        })),
      },
      {
        label: 'Timetable',
        items: ownSlots.map((s) => ({
          id: `slot:${s.id}`,
          kind: 'slot',
          label: `${s.subject} · ${s.class_section}`,
          sub: clip(`${String(s.day).slice(0, 3)} · P${s.period} · ${s.is_substitution ? `${s.substitute_teacher_name} for ${s.teacher_name}` : s.teacher_name}`),
          tags: `${s.room || ''} ${s.teacher_name || ''} ${s.class_section}`,
          to: isAdmin ? '/admin/timetable' : isTeacher ? '/teacher/timetable' : '/student/timetable',
        })),
      },
      {
        label: 'Homework',
        items: ownSlots
          .filter((s) => String(s.homework_note || '').trim())
          .map((s) => ({
            id: `hw:${s.id}`,
            kind: 'homework',
            label: `${s.class_section} · ${s.subject}`,
            sub: clip(s.homework_note, 92),
            to: isAdmin ? '/admin/timetable' : isTeacher ? '/teacher/homework' : '/student/homework',
          })),
      },
      {
        label: SHORTCUTS,
        items: isAdmin
          ? [
              { id: 'go:sections', kind: 'action', icon: Plus, label: 'Add a class section', sub: 'Classes & sections register', to: '/admin/sections' },
              { id: 'go:schedules', kind: 'action', icon: CalendarClock, label: 'Open bell timings', sub: 'Early years, junior and senior', to: '/admin/schedules' },
              { id: 'go:reports', kind: 'action', icon: Printer, label: 'Print notice board', sub: 'A4 landscape class sheets', to: '/admin/reports' },
              { id: 'go:codes', kind: 'action', icon: KeyRound, label: 'Issue class access codes', sub: 'One plaintext shown once', to: '/admin/codes' },
              { id: 'go:subs', kind: 'action', icon: ClipboardList, label: 'Substitute desk', sub: 'Cover the absent teachers', to: '/admin/substitutes' },
              { id: 'go:workload', kind: 'action', icon: BarChart3, label: 'Workload analytics', sub: 'Periods per teacher and room', to: '/admin/workload' },
              ...(demoOn
                ? [
                    {
                      id: 'run:reset',
                      kind: 'action',
                      icon: RotateCcw,
                      label: 'Reset demo school',
                      sub: 'Reloads the app on the seed data',
                      run: () => {
                        db.resetDemo()
                        window.location.reload()
                      },
                    },
                  ]
                : []),
            ]
          : isTeacher
            ? [
                { id: 'go:t-timetable', kind: 'action', icon: Table2, label: 'My timetable', sub: 'The week as published', to: '/teacher/timetable' },
                { id: 'go:t-homework', kind: 'action', icon: NotebookPen, label: 'Homework & notes', sub: 'Set work period by period', to: '/teacher/homework' },
                { id: 'go:t-subs', kind: 'action', icon: CalendarClock, label: 'Substitutions', sub: 'Periods you are covering', to: '/teacher/substitutions' },
                { id: 'go:t-groups', kind: 'action', icon: Users, label: 'My class groups', sub: 'ChronoConnect', to: '/teacher/groups' },
                { id: 'go:t-profile', kind: 'action', icon: User, label: 'My profile', sub: 'Subjects and contact details', to: '/teacher/profile' },
              ]
            : [
                { id: 'go:s-timetable', kind: 'action', icon: Table2, label: 'My timetable', sub: myClass || 'Verify a class code first', to: '/student/timetable' },
                { id: 'go:s-homework', kind: 'action', icon: NotebookPen, label: 'My homework', sub: 'What each teacher set', to: '/student/homework' },
                { id: 'go:s-groups', kind: 'action', icon: Users, label: 'My class group', sub: 'ChronoConnect announcements', to: '/student/groups' },
                { id: 'go:s-academic', kind: 'action', icon: GraduationCap, label: 'Academic information', sub: 'Enrollment and session record', to: '/student/academic' },
                { id: 'go:s-profile', kind: 'action', icon: User, label: 'My profile', sub: 'Class and contact details', to: '/student/profile' },
              ],
      },
    ]
  }, [school, catalog, ownSlots, isAdmin, isTeacher, role, myClass, demoOn])

  const { groups, flat } = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const shortcutGroup = sources.find((g) => g.label === SHORTCUTS) || { label: SHORTCUTS, items: [] }
    const listing = terms.length
      ? sources.map((g) => ({
          label: g.label,
          items: g.items
            .map((it) => {
              const hay = `${it.label} ${it.sub} ${it.tags || ''} ${g.label}`.toLowerCase()
              if (!terms.every((t) => hay.includes(t))) return null
              const at = hay.indexOf(terms[0])
              return { ...it, group: g.label, score: at + (String(it.label).toLowerCase().startsWith(terms[0]) ? -20 : 0) }
            })
            .filter(Boolean)
            .sort((a, b) => a.score - b.score)
            .slice(0, CAP[g.label] || 8),
        }))
      : [
          { label: 'Recently viewed', items: recent.map((r) => ({ ...r, group: 'Recently viewed' })) },
          { label: SHORTCUTS, items: shortcutGroup.items.map((it) => ({ ...it, group: SHORTCUTS })) },
        ]

    const out = listing.filter((g) => g.items.length)
    return { groups: out, flat: out.flatMap((g) => g.items) }
  }, [sources, query, recent])

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    const el = list.current?.querySelector(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const go = useCallback(
    (item) => {
      if (!item) return
      if (item.run) {
        onClose?.()
        item.run()
        return
      }
      if (item.to) {
        setRecent(writeRecent(item))
        onClose?.()
        navigate(item.to)
      }
    },
    [navigate, onClose],
  )

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(flat[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose?.()
    }
  }

  let cursor = -1

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-3 sm:p-6 sm:pt-[12vh]">
      <div className="scrim" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search ChronoCampus"
        className="modal relative w-full max-w-[640px] max-h-[76vh] flex flex-col"
      >
        <div className="flex items-center gap-3 px-4 h-[58px] border-b border-[color:var(--color-line-soft)] shrink-0">
          <Search size={18} className="t3 shrink-0" aria-hidden />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Find a class, teacher, student, subject, period or action…"
            aria-label="Search"
            aria-controls={listId}
            aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
            role="combobox"
            aria-expanded="true"
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-md font-medium t1 placeholder:t3"
          />
          <kbd className="meta hidden sm:inline-flex px-2 py-1 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--well)]">
            Esc
          </kbd>
        </div>

        <div ref={list} id={listId} role="listbox" className="scroll overflow-y-auto p-2 flex-1 min-h-0">
          {!catalog && !query ? (
            <div className="space-y-2 p-2" aria-hidden>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-xl" />
              ))}
            </div>
          ) : flat.length === 0 ? (
            <div className="py-12 text-center">
              <p className="display text-md font-bold">No match for “{query}”</p>
              <p className="lede mt-1.5 mx-auto">Try a class name like 10-A, a teacher, a subject, or a room.</p>
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="mb-1.5">
                <p className="eyebrow px-3 pt-2 pb-1">{g.label}</p>
                <ul className="list-none m-0 p-0 space-y-0.5">
                  {g.items.map((it) => {
                    cursor += 1
                    const i = cursor
                    const on = i === active
                    const Icon = it.icon || KIND_ICON[it.kind] || Sparkles
                    return (
                      <li key={`${it.id}-${i}`} role="option" aria-selected={on} id={`${listId}-${i}`}>
                        <button
                          type="button"
                          data-idx={i}
                          onMouseEnter={() => setActive(i)}
                          onClick={() => go(it)}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors ${
                            on ? 'bg-[color:var(--selected)] shadow-[0_6px_16px_-12px_rgba(20,40,68,.5)]' : 'hover:bg-[color:var(--hovered)]'
                          }`}
                        >
                          {it.kind === 'teacher' || it.kind === 'student' ? (
                            <Avatar name={it.label} size="sm" tone={it.kind === 'teacher' ? 'brand' : 'sage'} />
                          ) : (
                            <span className="avatar avatar-sm" data-tone={it.kind === 'action' ? 'accent' : 'neutral'} aria-hidden>
                              <Icon size={15} />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-bold t1 truncate">{it.label}</span>
                            <span className="block text-2xs t3 truncate">{it.sub}</span>
                          </span>
                          {on ? (
                            <CornerDownLeft size={14} className="t3 shrink-0" aria-hidden />
                          ) : it.kind === 'class' ? (
                            <Chip tone="neutral" className="hidden sm:inline-flex">
                              class
                            </Chip>
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <footer className="shrink-0 flex items-center gap-4 px-4 h-11 border-t border-[color:var(--color-line-soft)] meta">
          <span className="inline-flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 rounded-md border border-[color:var(--color-line)] bg-[color:var(--well)]">↑↓</kbd> move
          </span>
          <span className="inline-flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 rounded-md border border-[color:var(--color-line)] bg-[color:var(--well)]">↵</kbd> open
          </span>
          <span className="ml-auto">{flat.length} result{flat.length === 1 ? '' : 's'}</span>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
