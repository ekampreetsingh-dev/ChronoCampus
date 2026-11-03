import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowRight, Lock, Mail, ShieldCheck, Sparkles, UserRoundPlus } from 'lucide-react'
import { db, isSupabaseConfigured } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import Brand from '../components/Brand'
import { Button, Chip, Field, Input, Spinner, Segmented } from '../components/ui/primitives'
import { DAYS, currentPeriodIndex, periodsFor } from '../lib/bellSchedule'
import { roomShort, subjectShort, subjectTone } from '../lib/subjects'

const PREVIEW_CLASS = '11-A Science'

const DEMO_EMAILS = {
  admin: 'principal@chronocampus.edu.in',
  teacher: 'neelam.kaur@chronocampus.edu.in',
  student: 'gurpreet.sandhu@student.chronocampus.edu.in',
}

const GoogleMark = () => (
  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.9z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C15.5 15.1 19.4 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C40.9 35.4 44 30.2 44 24c0-1.3-.1-2.7-.4-3.9z" />
  </svg>
)

/** A quiet slice of the real week — the product's own artifact is the hero. */
function BoardPreview() {
  const [slots, setSlots] = useState([])
  const { now } = useApp()

  useEffect(() => {
    let alive = true
    db.listSlots({ class_section: PREVIEW_CLASS })
      .then((s) => alive && setSlots(s))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const map = useMemo(() => new Map(slots.map((s) => [`${s.day}|${Number(s.period)}`, s])), [slots])
  const periods = periodsFor(PREVIEW_CLASS)
  const livePeriod = currentPeriodIndex(now, periods)
  const liveDay = DAYS[Math.min((now.getDay() + 6) % 7, DAYS.length - 1)]
  const days = DAYS.slice(0, 5)

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3.5">
        <span className="eyebrow">{PREVIEW_CLASS} · this week</span>
        <span className="num text-2xs t3">
          {periods.length} periods × {days.length} days
        </span>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `44px repeat(${days.length}, minmax(0,1fr))` }}>
        <div aria-hidden />
        {days.map((d) => (
          <div
            key={d}
            data-tone={d === liveDay ? 'brand' : 'neutral'}
            className={`num text-2xs font-bold text-center py-1.5 rounded-[9px] border ${
              d === liveDay ? 'bg-[color:var(--tone)] text-white border-transparent' : 't3 border-[color:var(--color-line-soft)] bg-[color:var(--well)]'
            }`}
          >
            {d.slice(0, 3)}
          </div>
        ))}
        {periods.map((row) => (
          <div key={row.n} className="contents">
            <div className={`num text-2xs text-right pr-2 self-center tabular-nums ${livePeriod === row.n ? 'text-[color:var(--color-brand-ink)] font-bold' : 't3'}`}>
              {row.start}
            </div>
            {days.map((day) => {
              const slot = map.get(`${day}|${row.n}`)
              const live = livePeriod === row.n && liveDay === day
              return (
                <div
                  key={day}
                  data-tone={slot ? subjectTone(slot.subject) : 'neutral'}
                  className={`h-[42px] rounded-[10px] border px-2 py-1 flex flex-col justify-center overflow-hidden min-w-0 ${
                    live
                      ? 'bg-[color:var(--tone)] border-transparent text-white'
                      : slot
                        ? 'bg-[color:var(--tone-soft)] border-[color:var(--tone-line)]'
                        : 'border-dashed border-[color:var(--color-line-strong)] bg-[color:var(--cell-empty)]'
                  }`}
                  title={slot ? `${slot.subject} · ${slot.teacher_name}` : `${day} ${row.label} — free`}
                >
                  <span className={`text-2xs font-bold truncate ${slot && !live ? 't1' : ''}`}>{slot ? subjectShort(slot.subject) : ''}</span>
                  <span className="num text-2xs opacity-75 truncate">{slot ? roomShort(slot.room) : ''}</span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

const PROMISES = [
  'Three approved directories decide who gets in — never a self-selected role.',
  'Teacher and room clashes are blocked while you build the week.',
  'Absence re-flows into only the staff who are genuinely free at that bell.',
  'Class codes are stored hashed, expire, and can be rotated in one click.',
]

export default function Login() {
  const { booting, profile, access, denial, refreshSession, pushToast, demoOn } = useApp()
  const navigate = useNavigate()
  const [tab, setTab] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!booting && access === 'granted' && profile?.role) navigate(`/${profile.role}`, { replace: true })
  }, [booting, access, profile?.role, navigate])

  if (booting) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="flex flex-col items-center gap-3">
          <Brand showWord={false} />
          <Spinner label="Opening the campus…" size={18} />
        </div>
      </div>
    )
  }

  if (access === 'granted' && profile?.role) return <Navigate to={`/${profile.role}`} replace />

  const afterAuth = async (notice) => {
    const s = await refreshSession()
    if (s.access === 'granted') {
      navigate(`/${s.profile.role}`, { replace: true })
      return true
    }
    setError(s.message || denial?.message || 'We could not authorize this account.')
    if (notice) pushToast(notice)
    return false
  }

  const google = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await db.signInWithGoogle()
      if (r.demo) {
        await afterAuth({
          tone: 'warning',
          title: 'Demo environment session',
          message: 'Google OAuth needs a Supabase project. You were signed into the sample school as the principal.',
        })
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const demoSignIn = async (role) => {
    setBusy(true)
    setError(null)
    try {
      await db.signInWithEmail(DEMO_EMAILS[role], 'demo')
      await afterAuth()
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = tab === 'signin' ? await db.signInWithEmail(email, password) : await db.signUpWithEmail(email, password, fullName)
      if (r.error) {
        setError(/invalid login credentials/i.test(r.error.message) ? 'That email and password do not match a school account.' : r.error.message)
        return
      }
      if (tab === 'signup' && !demoOn) {
        setError('Check your school email to finish verifying this address, then sign in.')
        setTab('signin')
        return
      }
      await afterAuth()
    } catch (e) {
      setError(e.message || 'Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-3 sm:p-5">
      <div className="shell w-full max-w-[1180px] grid lg:grid-cols-[1.15fr_.85fr] overflow-hidden">
        {/* -------------------------------------------------------------- left */}
        <section className="hidden lg:flex flex-col justify-between p-8 xl:p-10 border-r border-[color:var(--color-line-soft)]">
          <div>
            <Brand />
            <div className="mt-10">
              <p className="eyebrow mb-3">Academic operations platform</p>
              <h1 className="display text-3xl xl:text-[38px] font-extrabold leading-[1.08] max-w-[17ch]">
                Academic operations,
                <br />
                <span style={{ color: 'var(--text-accent)' }}>in perfect order.</span>
              </h1>
              <p className="lede mt-4 max-w-[50ch] text-sm">
                One connected workspace for school schedules, staff coordination and everyday academic operations — built for
                the principal's desk, the staff room and the classroom.
              </p>
            </div>
          </div>

          <div className="card-flat p-5 mt-8">
            <BoardPreview />
          </div>

          <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs t2 m-0 p-0 list-none">
            {PROMISES.map((t) => (
              <li key={t} className="flex items-start gap-2 leading-snug">
                <ShieldCheck size={14} className="text-[color:var(--color-brand-strong)] shrink-0 mt-0.5" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------------------------------------- right */}
        <section className="flex flex-col justify-center p-6 sm:p-8 xl:p-10">
          <div className="w-full max-w-[380px] mx-auto">
            <div className="lg:hidden mb-7">
              <Brand />
            </div>

            <h2 className="display text-xl font-extrabold leading-tight lg:hidden mb-2">
              Academic operations, in perfect order.
            </h2>
            <p className="eyebrow mb-2">Sign in</p>
            <p className="text-sm t2 leading-relaxed">
              Access comes from your address matching one of the school's approved directories. There is no role to choose
              here.
            </p>

            <Button block size="lg" className="mt-6" onClick={google} disabled={busy}>
              <GoogleMark />
              Continue with Google
            </Button>

            {demoOn ? (
              <p className="flex items-center gap-2 mt-3 text-xs t3">
                <Sparkles size={13} className="text-[color:var(--color-accent-ink)]" aria-hidden />
                Demo environment — sample school data, no live records.
              </p>
            ) : null}

            {isSupabaseConfigured ? (
              <>
                <Or />
                <Segmented
                  className="w-full mb-4"
                  label="Authentication mode"
                  value={tab}
                  onChange={setTab}
                  items={[
                    { id: 'signin', label: 'Sign in' },
                    { id: 'signup', label: 'First time' },
                  ]}
                />

                <form onSubmit={submit} className="flex flex-col gap-3">
                  {tab === 'signup' ? (
                    <Field label="Full name" required htmlFor="login-name">
                      <Input
                        id="login-name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="As it appears on the school record"
                        required
                        autoComplete="name"
                      />
                    </Field>
                  ) : null}

                  <Field label="School email" required htmlFor="login-email">
                    <Input
                      id="login-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@school.edu.in"
                      required
                      autoComplete="email"
                    />
                  </Field>

                  <Field label="Password" required htmlFor="login-password">
                    <Input
                      id="login-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
                    />
                  </Field>

                  <ErrorNote error={error} />

                  <Button type="submit" variant="primary" block size="lg" disabled={!email || !password} loading={busy} iconRight={ArrowRight}>
                    {tab === 'signin' ? 'Enter ChronoCampus' : 'Create account'}
                  </Button>
                </form>

                {tab === 'signup' ? (
                  <p className="text-xs t3 mt-3 leading-relaxed">
                    Creating an account does not grant access. A role exists only once an administrator has added your address
                    to the staff or student directory.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <Or />
                <form onSubmit={submit} className="flex flex-col gap-3">
                  <Field label="School email" required htmlFor="login-email" hint="In the demo environment any directory address signs you in.">
                    <Input
                      id="login-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@chronocampus.edu.in"
                      required
                      autoComplete="email"
                    />
                  </Field>
                  <Field label="Password" required htmlFor="login-password">
                    <Input
                      id="login-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      autoComplete="current-password"
                    />
                  </Field>
                  <ErrorNote error={error} />
                  <Button type="submit" variant="primary" block disabled={!email} loading={busy} iconRight={ArrowRight}>
                    Enter ChronoCampus
                  </Button>
                </form>

                <div className="card-flat px-4 py-4 mt-5">
                  <p className="flex items-center gap-2 text-xs font-bold mb-2.5" data-tone="warning" style={{ color: 'var(--tone-ink)' }}>
                    <span className="dot" data-tone="warning" aria-hidden /> Demo environment · sample school
                  </p>
                  <p className="text-xs t2 leading-relaxed">
                    Add <code className="num text-ink">VITE_SUPABASE_URL</code> and{' '}
                    <code className="num text-ink">VITE_SUPABASE_ANON_KEY</code> to <code className="num text-ink">.env</code>{' '}
                    and restart to work against your live database. Email/password sign-in is hidden until then.
                  </p>
                  <div className="grid grid-cols-3 gap-2 mt-3.5">
                    {[
                      { r: 'admin', l: 'Principal' },
                      { r: 'teacher', l: 'Teacher' },
                      { r: 'student', l: 'Student' },
                    ].map((d) => (
                      <Button key={d.r} size="sm" onClick={() => demoSignIn(d.r)} disabled={busy}>
                        {d.l}
                      </Button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {access === 'denied' || access === 'conflict' ? <ErrorNote error={denial?.message} className="mt-4" /> : null}

            <div className="flex flex-wrap items-center gap-1.5 mt-7">
              <Chip tone="neutral">Google OAuth</Chip>
              <Chip tone="neutral">Directory authorization</Chip>
              <Chip tone="neutral">Row level security</Chip>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

const Or = () => (
  <div className="flex items-center gap-3 my-5">
    <span className="h-px flex-1 bg-[color:var(--color-line)]" />
    <span className="eyebrow">or use school email</span>
    <span className="h-px flex-1 bg-[color:var(--color-line)]" />
  </div>
)

const ErrorNote = ({ error, className }) =>
  error ? (
    <div data-tone="danger" role="alert" className={`alert ${className || ''}`}>
      <AlertCircle size={17} className="shrink-0 mt-0.5" aria-hidden />
      <span className="text-sm">{error}</span>
    </div>
  ) : null
