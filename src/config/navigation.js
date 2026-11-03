import {
  BarChart3,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  Layers,
  NotebookPen,
  Printer,
  ScrollText,
  Settings,
  ShieldCheck,
  Table2,
  User,
  Users,
} from 'lucide-react'

/**
 * One source of truth for navigation. Every entry points at a route that
 * actually renders — nothing is listed that has no page behind it.
 */

export const NAV = {
  admin: [
    {
      group: 'Academic operations',
      items: [
        { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
        { to: '/admin/timetable', label: 'Master Timetable', icon: LayoutGrid },
        { to: '/admin/substitutes', label: 'Substitute Desk', icon: ClipboardList },
        { to: '/admin/workload', label: 'Workload Analytics', icon: BarChart3 },
        { to: '/admin/reports', label: 'Reports & Printing', icon: Printer },
      ],
    },
    {
      group: 'People',
      items: [
        { to: '/admin/staff', label: 'Administrators', icon: ShieldCheck },
        { to: '/admin/teachers', label: 'Teachers', icon: Users },
        { to: '/admin/students', label: 'Students', icon: GraduationCap },
      ],
    },
    {
      group: 'ChronoConnect',
      items: [{ to: '/admin/groups', label: 'Class Groups', icon: Users }],
    },
    {
      group: 'Structure',
      items: [
        { to: '/admin/sections', label: 'Classes & Sections', icon: Layers },
        { to: '/admin/subjects', label: 'Subjects', icon: BookOpen },
        { to: '/admin/calendar', label: 'Academic Calendar', icon: CalendarDays },
        { to: '/admin/sessions', label: 'Academic Sessions', icon: CalendarRange },
        { to: '/admin/codes', label: 'Class Access Codes', icon: KeyRound },
      ],
    },
    {
      group: 'Configuration',
      items: [
        { to: '/admin/schedules', label: 'Bell Timings', icon: CalendarClock },
        { to: '/admin/activity', label: 'Activity Log', icon: ScrollText },
        { to: '/admin/settings', label: 'School Settings', icon: Settings },
      ],
    },
  ],

  teacher: [
    {
      group: 'My week',
      items: [
        { to: '/teacher', label: 'Overview', icon: LayoutDashboard, end: true },
        { to: '/teacher/timetable', label: 'My Timetable', icon: Table2 },
        { to: '/teacher/homework', label: 'Homework & Notes', icon: NotebookPen },
        { to: '/teacher/substitutions', label: 'Substitutions', icon: CalendarClock },
      ],
    },
    {
      group: 'ChronoConnect',
      items: [{ to: '/teacher/groups', label: 'My Class Groups', icon: Users }],
    },
    {
      group: 'Account',
      items: [{ to: '/teacher/profile', label: 'Profile', icon: User }],
    },
  ],

  student: [
    {
      group: 'My studies',
      items: [
        { to: '/student', label: 'Overview', icon: LayoutDashboard, end: true },
        { to: '/student/timetable', label: 'My Timetable', icon: Table2 },
        { to: '/student/homework', label: 'Homework', icon: NotebookPen },
        { to: '/student/academic', label: 'Academic Record', icon: ShieldCheck },
      ],
    },
    {
      group: 'ChronoConnect',
      items: [{ to: '/student/groups', label: 'My Class Group', icon: Users }],
    },
    {
      group: 'Account',
      items: [{ to: '/student/profile', label: 'Profile', icon: User }],
    },
  ],
}

export const findCrumb = (role, pathname) => {
  const flat = []
  for (const g of NAV[role] || []) for (const it of g.items) flat.push({ ...it, group: g.group })
  const exact = flat.find((i) => (i.end ? i.to === pathname : pathname === i.to || pathname.startsWith(`${i.to}/`)))
  return exact || flat[0]
}
