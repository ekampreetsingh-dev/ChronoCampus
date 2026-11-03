import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, KeyRound, LogOut, ShieldCheck, Sparkles } from 'lucide-react'
import { db } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import {
  Alert,
  Button,
  Chip,
  Field,
  Input,
  Modal,
  SearchSelect,
  Select,
} from './ui/primitives'

/**
 * Mandatory for any student without an active enrollment, and reused for
 * promotion. Live mode calls verify_and_enroll(), which takes the identity from
 * auth.uid() — the browser never submits a user id.
 *
 * A stored code is a bcrypt hash and is never rendered here: the plaintext only
 * exists at issue time (one screen, one copy) and in the seeded demo codes below,
 * which are demo data rather than a leaked column.
 */
export default function ClassCodeModal({ open, onClose, mode = 'verify', onSuccess }) {
  const { profile, demoOn, pushToast, setProfile, signOut } = useApp()
  const [sections, setSections] = useState([])
  const [sessions, setSessions] = useState([])
  const [session, setSession] = useState('')
  const [section, setSection] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [locked, setLocked] = useState(false)
  const [showCodes, setShowCodes] = useState(false)

  const mandatory = mode === 'verify' && !profile?.class_section
  const demoCodes = useMemo(() => (demoOn ? db.demoClassCodes() : []), [demoOn])

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    Promise.all([db.listSections(), db.listSessions()])
      .then(([secs, sess]) => {
        if (!alive) return
        setSections(secs || [])
        const active = (sess || []).find((s) => s.is_active) || (sess || []).find((s) => s.status === 'upcoming')
        setSessions(sess || [])
        setSession((s) => s || active?.name || '')
      })
      .catch((err) => alive && setError(err.message || 'The school directory could not be read.'))
    return () => {
      alive = false
    }
  }, [open])

  const canSubmit = Boolean(section && session && code.trim().length >= 4 && !busy && !locked)

  const submit = async (e) => {
    e?.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const result = await db.verifyClassCode(section, code, { sessionName: session })
      if (!result.ok) {
        setError(result.error || 'That code does not match the section.')
        setLocked(Boolean(result.locked))
        pushToast({ tone: 'danger', title: 'Class not verified', message: `${section} stayed locked.` })
        return
      }
      setProfile({ class_section: result.class_section })
      pushToast({
        tone: 'success',
        title: mode === 'promote' ? 'Moved to your new class' : 'Class verified',
        message: `Timetable unlocked for ${result.class_section} · ${result.session_name}.`,
      })
      onSuccess?.(result)
      onClose?.()
    } catch (err) {
      setError(err.message || 'Verification failed. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={mandatory ? undefined : onClose}
      icon={ShieldCheck}
      tone="brand"
      title={mode === 'promote' ? 'Promote / Change Class' : 'Welcome to ChronoCampus'}
      sub={
        mode === 'promote'
          ? 'Enter the code for your new class. Your previous enrollment stays on your academic record.'
          : 'Verify your class and section to access your academic timetable.'
      }
      width="max-w-[460px]"
      footer={
        <>
          {mandatory ? (
            <Button variant="quiet" icon={LogOut} className="mr-auto" onClick={signOut}>
              Not {profile?.full_name?.split(' ')[0] || 'you'}?
            </Button>
          ) : null}
          {locked ? (
            <Button variant="ghost" onClick={() => { setLocked(false); setError(null) }}>
              Try again
            </Button>
          ) : null}
          <Button variant="primary" icon={locked ? AlertTriangle : ShieldCheck} loading={busy} disabled={!canSubmit} onClick={submit}>
            {locked ? 'Locked by the school' : mode === 'promote' ? 'Update my class' : 'Verify and unlock'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {profile?.class_section && mode === 'verify' ? (
          <div className="card-flat px-3 py-2.5 flex flex-wrap items-center gap-2">
            <span className="text-sm t2">Currently enrolled in</span>
            <Chip tone="brand" dot>
              {profile.class_section}
            </Chip>
          </div>
        ) : null}

        <Field label="Academic session" required htmlFor="cc-session">
          <Select id="cc-session" value={session} onChange={(e) => setSession(e.target.value)}>
            {sessions.length ? (
              sessions.map((s) => (
                <option key={s.id} value={s.name} disabled={s.status === 'closed'}>
                  {s.name}
                  {s.is_active ? ' · current' : s.status === 'upcoming' ? ' · opening soon' : ' · closed'}
                </option>
              ))
            ) : (
              <option value="">No sessions on record</option>
            )}
          </Select>
        </Field>

        <SearchSelect
          label="Class & section"
          required
          value={section}
          onChange={(v) => {
            setSection(v)
            setError(null)
            setLocked(false)
          }}
          options={sections.map((s) => ({
            value: s.name,
            label: s.name,
            hint: s.mentor_teacher_name ? `class teacher ${s.mentor_teacher_name}` : 'no class teacher recorded',
          }))}
          placeholder="Select your section…"
          searchPlaceholder="Search your class, e.g. 11-A"
          emptyText="No class by that name. Check the letter, or ask your class teacher."
        />

        <Field
          label="Class access code"
          required
          htmlFor="cc-code"
          hint="Issued by the school office. It changes when you are promoted."
        >
          <div className="relative">
            <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 t3 pointer-events-none" aria-hidden />
            <Input
              id="cc-code"
              className="pl-9 uppercase tracking-[0.12em] font-mono font-semibold"
              placeholder="SCI11A-2026-K7Q"
              value={code}
              invalid={Boolean(error)}
              aria-describedby={error ? 'cc-code-help' : undefined}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase())
                setError(null)
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </Field>

        {error ? (
          <div id="cc-code-help" role="alert" aria-live="assertive">
            <Alert tone={locked ? 'danger' : 'warning'} title={locked ? 'Too many failed attempts' : 'That code was refused'}>
              {error}
              {locked ? ' The form unlocks after ten minutes; until then the school will not check another attempt.' : ' Nothing changed on your record.'}
            </Alert>
          </div>
        ) : null}

        {demoOn && demoCodes.length ? (
          <div className="card-flat p-3" data-tone="accent">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between"
              icon={Sparkles}
              iconRight={ChevronDown}
              aria-expanded={showCodes}
              onClick={() => setShowCodes((s) => !s)}
            >
              Demo environment · {demoCodes.length} sample access codes
            </Button>
            {showCodes ? (
              <ul className="list-none m-0 mt-2 p-0 grid gap-1.5">
                {demoCodes.map((c) => (
                  <li key={c.class_section} className="flex items-center justify-between gap-2 min-w-0">
                    <Button
                      size="sm"
                      variant="quiet"
                      tone="accent"
                      onClick={() => {
                        setSection(c.class_section)
                        setCode(c.access_code)
                        setError(null)
                        setLocked(false)
                      }}
                    >
                      <span className="truncate">{c.class_section}</span>
                    </Button>
                    <span className="num text-2xs t2 truncate" title="Seeded demo plaintext — a live school stores only a hash">
                      {c.access_code}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="meta mt-1.5 leading-snug">
                In a live school these are bcrypt hashes shown exactly once, at issue. Nobody — including this screen — can read
                them back.
              </p>
            )}
          </div>
        ) : null}
      </form>
    </Modal>
  )
}
