import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { db, ENABLE_PITCH_MODE, isSupabaseConfigured } from '../lib/supabase'
import { DAYS, dayIndex, isSchoolDay, lastEnd, firstStart, nowInTimezone, periodsFor, toMinutes } from '../lib/bellSchedule'

const AppContext = createContext(null)

const SIM_MINUTES_PER_SECOND = 0.5 // a full school day plays out in ~15 real minutes
const REVALIDATE_EVERY_MS = 5 * 60 * 1000

const DEMO_EMAILS = {
  admin: 'principal@chronocampus.edu.in',
  teacher: 'neelam.kaur@chronocampus.edu.in',
  student: 'gurpreet.sandhu@student.chronocampus.edu.in',
}

function seedSimClock() {
  const real = nowInTimezone()
  const base = new Date(real)
  if (!isSchoolDay(real)) base.setDate(base.getDate() + ((7 - real.getDay()) % 7 || 7))
  base.setHours(8, 0, 0, 0)
  return { date: base, offsetMinutes: 0 }
}

/**
 * The school's clock. Inside configured hours it is the real time in the school's
 * timezone; in the demo environment outside hours it plays a school day so the
 * live rail is always demonstrable — and is labelled as simulated wherever shown.
 */
function useChronoClock(demoOn, section) {
  const sim = useRef(seedSimClock())
  const [now, setNow] = useState(() => nowInTimezone())
  const [simulating, setSimulating] = useState(false)

  const periods = periodsFor(section)

  useEffect(() => {
    const tick = () => {
      const real = nowInTimezone()
      const mins = real.getHours() * 60 + real.getMinutes()
      const insideSchool = isSchoolDay(real) && mins >= toMinutes(periods[0].start) && mins < toMinutes(periods[periods.length - 1].end)

      if (demoOn && !insideSchool) {
        sim.current.offsetMinutes += SIM_MINUTES_PER_SECOND
        const d = new Date(sim.current.date.getTime() + sim.current.offsetMinutes * 60000)
        if (d.getHours() * 60 + d.getMinutes() >= toMinutes(periods[periods.length - 1].end)) sim.current.offsetMinutes = 0
        setSimulating(true)
        setNow(d)
      } else {
        setSimulating(false)
        setNow(real)
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [demoOn, section])

  const jumpTo = useCallback((day, periodNumber) => {
    const p = periods.find((x) => x.n === Number(periodNumber)) || periods[0]
    const target = nowInTimezone()
    const di = DAYS.indexOf(day)
    const currentDi = dayIndex(target)
    target.setDate(target.getDate() + ((di - currentDi + 7) % 7 || (di <= currentDi ? 7 : 0)))
    const [h, m] = p.start.split(':').map(Number)
    target.setHours(h, m + 3, 0, 0)
    sim.current = { date: target, offsetMinutes: 0 }
  }, [])

  return { now, simulating, jumpTo }
}

export function AppProvider({ children }) {
  const [session, setSession] = useState({ user: null, profile: null, access: 'anonymous' })
  const [booting, setBooting] = useState(true)
  const [demoOn, setDemoOn] = useState(() => ENABLE_PITCH_MODE && !isSupabaseConfigured)
  const [settings, setSettings] = useState(null)
  const [toasts, setToasts] = useState([])
  const [theme, setTheme] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
  )
  const toastId = useRef(0)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.setAttribute('data-theme', 'dark')
    else root.removeAttribute('data-theme')
    try {
      localStorage.setItem('chronocampus.theme', theme)
    } catch {
      /* storage disabled */
    }
  }, [theme])

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  // Motion defaults to the OS preference; 'full' is an explicit opt-in.
  const [motion, setMotion] = useState(() => {
    try {
      return localStorage.getItem('chronocampus.motion') || 'auto'
    } catch {
      return 'auto'
    }
  })
  useEffect(() => {
    const root = document.documentElement
    if (motion === 'full') root.setAttribute('data-motion', 'full')
    else root.removeAttribute('data-motion')
    try {
      localStorage.setItem('chronocampus.motion', motion)
    } catch {
      /* storage disabled */
    }
  }, [motion])
  const toggleMotion = useCallback(() => setMotion((m) => (m === 'full' ? 'auto' : 'full')), [])

  useEffect(() => {
    db.setDemoMode(demoOn)
  }, [demoOn])

  const load = useCallback(async () => {
    const [s] = await Promise.all([db.getSession(), db.applySchedule().then((x) => x && setSettings(x))])
    setSession(s)
    return s
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const s = await load()
        if (alive && s.access === 'granted') setSettings(await db.getSettings())
      } finally {
        if (alive) setBooting(false)
      }
    })()

    const off = db.onAuthChange(() => {
      load().catch(() => {})
    })
    return () => {
      alive = false
      off?.()
    }
  }, [demoOn, load])

  // Authorization can be withdrawn while someone is signed in, so it is re-checked.
  useEffect(() => {
    if (session.access !== 'granted') return
    const id = setInterval(() => db.revalidate().then((s) => s.access !== 'granted' && setSession(s)), REVALIDATE_EVERY_MS)
    const onFocus = () => db.revalidate().then((s) => s.access !== 'granted' && setSession(s))
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [session.access])

  const { now, simulating, jumpTo } = useChronoClock(demoOn, session.profile?.class_section)

  const pushToast = useCallback((toast) => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, tone: 'brand', ...toast }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), toast.ttl ?? 5200)
  }, [])

  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const setProfile = useCallback(
    (patch) => setSession((s) => ({ ...s, profile: { ...(s.profile || {}), ...patch } })),
    [],
  )

  const signInAs = useCallback(
    async (role) => {
      await db.signInWithEmail(DEMO_EMAILS[role], 'demo')
      const s = await load()
      return s
    },
    [load],
  )

  const signOut = useCallback(async () => {
    await db.signOut()
    setSession({ user: null, profile: null, access: 'anonymous' })
  }, [])

  const refreshSession = useCallback(
    async (next) => {
      const s = next || (await load())
      return s
    },
    [load],
  )

  const value = useMemo(
    () => ({
      session,
      user: session.user,
      profile: session.profile,
      role: session.profile?.role || null,
      access: session.access || 'anonymous',
      denial: session.access === 'granted' ? null : session,
      booting,
      settings,
      demoOn,
      setDemoOn,
      liveAvailable: isSupabaseConfigured,
      toasts,
      pushToast,
      dismissToast,
      setProfile,
      signInAs,
      signOut,
      refreshSession,
      theme,
      toggleTheme,
      motion,
      toggleMotion,
      now,
      simulating,
      jumpDemoTime: jumpTo,
      todayName: DAYS[Math.min(dayIndex(now), DAYS.length - 1)],
    }),
    [session, booting, settings, demoOn, toasts, pushToast, dismissToast, setProfile, signInAs, signOut, refreshSession, theme, toggleTheme, motion, toggleMotion, now, simulating, jumpTo],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export const useApp = () => {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}
