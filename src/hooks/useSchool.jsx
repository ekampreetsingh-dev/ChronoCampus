import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { db } from '../lib/supabase'
import { pitchStore } from '../lib/pitchStore'
import { useApp } from '../context/AppContext'
import { DAYS, PERIODS } from '../lib/bellSchedule'
import { auditConflicts } from '../lib/conflicts'

const SchoolContext = createContext(null)

/** Shares one load of the whole school across the admin section. */
export function SchoolProvider({ children }) {
  const school = useSchool({ withStudents: true })
  return <SchoolContext.Provider value={school}>{children}</SchoolContext.Provider>
}

export const useSchoolData = () => useContext(SchoolContext) || useSchool({ withStudents: true })

/** Loads everything a portal needs, and stays live with the demo store. */
export function useSchool({ withStudents = false } = {}) {
  const { demoOn, pushToast, profile } = useApp()
  const [data, setData] = useState({
    slots: [],
    teachers: [],
    admins: [],
    studentDirectory: [],
    sections: [],
    sessions: [],
    codes: [],
    absences: [],
    enrollments: [],
    schedules: [],
    audit: [],
    settings: null,
  })
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      const [slots, teachers, admins, sections, sessions, codes, absences, settings, schedules] = await Promise.all([
        db.listSlots(),
        db.teachers(),
        db.listAdmins(),
        db.listSections(true),
        db.listSessions(),
        db.listClassCodes(),
        db.listAbsences(),
        db.getSettings(),
        db.listSchedules(),
      ])
      const [studentDirectory, audit, enrollments] = await Promise.all([
        withStudents || profile?.role === 'admin' ? db.listStudentDirectory() : Promise.resolve([]),
        profile?.role === 'admin' ? db.listAudit(30) : Promise.resolve([]),
        profile?.role === 'student' ? db.listEnrollments(profile.id) : Promise.resolve([]),
      ])
      setData({ slots, teachers, admins, studentDirectory, sections, sessions, codes, absences, settings, schedules, audit, enrollments })
    } catch (err) {
      pushToast({ tone: 'error', title: 'Could not read school data', message: err.message })
    } finally {
      setLoading(false)
    }
  }, [pushToast, withStudents, profile?.role, profile?.id])

  useEffect(() => {
    reload()
  }, [reload, demoOn])

  useEffect(() => {
    if (!demoOn) return
    return pitchStore.subscribe(() => reload())
  }, [demoOn, reload])

  const subjects = useMemo(() => {
    const fromStaff = teachers2Subjects(data.teachers)
    const fromBoard = data.slots.map((s) => s.subject)
    return [...new Set([...fromStaff, ...fromBoard])].filter(Boolean).sort()
  }, [data.teachers, data.slots])

  const conflicts = useMemo(() => auditConflicts(data.slots), [data.slots])

  const activeSession = data.sessions.find((s) => s.is_active) || null

  return {
    ...data,
    subjects,
    conflicts,
    activeSession,
    loading,
    reload,
    weekCapacity: DAYS.length * PERIODS.length,
  }
}

const teachers2Subjects = (teachers = []) => teachers.flatMap((t) => [t.subject, ...(t.extra || [])])

/** The student's own timetable, scoped to their verified section. */
export function useMyClass() {
  const { profile, demoOn } = useApp()
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!profile?.class_section) {
      setSlots([])
      setLoading(false)
      return
    }
    setSlots(await db.listSlots({ class_section: profile.class_section }))
    setLoading(false)
  }, [profile?.class_section])

  useEffect(() => {
    reload()
  }, [reload, demoOn])

  useEffect(() => {
    if (!demoOn) return
    return pitchStore.subscribe(() => reload())
  }, [demoOn, reload])

  return { slots, loading, reload }
}
