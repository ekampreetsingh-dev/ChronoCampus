/**
 * Directory editing, driven through the real browser: add, edit, delete with the
 * consequence named, the two refusals, and a student promotion that keeps history.
 */
import fs from 'fs'
import path from 'path'

const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const KEY = 'chronocampus.demo.v6'
const OUT = path.resolve('shots')
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(`${APP}/admin/teachers`)}`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
let events = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id) }
  else if (m.method) events.push(m)
})
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value

await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 760, deviceScaleFactor: 1, mobile: false })
/**
 * A fixed sleep is not enough: this school re-reads a megabyte of JSON and
 * rebuilds 2,265 periods on every navigation, so wait for the table instead.
 */
const waitFor = async (expr, ms = 20000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if ((await ev(`(() => Boolean(${expr}))()`)) === true) return true
    await sleep(350)
  }
  return false
}
const goto = async (url) => {
  events = []
  await send('Page.navigate', { url })
  await sleep(1200)
  const ready = await waitFor(`document.querySelectorAll('tbody tr').length > 0 || document.querySelectorAll('.modal').length > 0`)
  await sleep(400)
  return ready
}
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
}

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

/* ------------------------------------------------------------- primitives -- */
/** Run a plain function against the persisted demo school, inside the page. */
const readStore = (fn, arg) =>
  ev(`(() => {
    const s = JSON.parse(localStorage[${JSON.stringify(KEY)}] || '{}');
    const f = (${fn.toString()});
    return ${arg === undefined ? 'f(s)' : `f(${JSON.stringify(arg)})(s)`};
  })()`)

const setField = (ariaLabel, value) => `(() => {
  const el = document.querySelector('[role=dialog] [aria-label="${ariaLabel}"]');
  if (!el) return 'missing field: ${ariaLabel}';
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  return 'ok';
})()`
const dialogCount = () => ev(`(() => document.querySelectorAll('[role=dialog]').length)()`)
const dialogOpen = async () => (await dialogCount()) > 0
/** A mutation closes its dialog once the school has been re-read. */
const dialogClosed = () => waitFor(`document.querySelectorAll('[role=dialog]').length === 0`, 15000)
const dialogText = () => ev(`(() => document.querySelector('[role=dialog]')?.innerText || '')()`)
const dialogButton = (re) => ev(`(() => {
  const b = [...document.querySelectorAll('[role=dialog] button')].find((x) => new RegExp(${JSON.stringify(re)}).test(x.textContent.trim()));
  return b ? { text: b.textContent.trim(), disabled: b.disabled } : null;
})()`)
const clickDialogButton = (re) => ev(`(() => {
  const b = [...document.querySelectorAll('[role=dialog] button')].find((x) => new RegExp(${JSON.stringify(re)}).test(x.textContent.trim()));
  if (!b) return 'no button';
  if (b.disabled) return 'disabled';
  b.click(); return 'clicked';
})()`)
const clickPageButton = (re) => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => !x.closest('[role=dialog]') && new RegExp(${JSON.stringify(re)}).test(x.textContent.trim()));
  if (!b) return 'no button';
  b.click(); return 'clicked';
})()`)
/** Click a named action in the row that mentions this person. */
const rowAction = (rowText, ariaStart) => ev(`(() => {
  const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(${JSON.stringify(rowText)}));
  if (!tr) return 'no row';
  const b = [...tr.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').startsWith(${JSON.stringify(ariaStart)}));
  if (!b) return 'no action: ' + [...tr.querySelectorAll('button')].map((x) => x.getAttribute('aria-label')).join('|');
  b.click(); return 'clicked';
})()`)
const bodyText = () => ev(`(() => document.body.innerText)()`)

const pickCombo = async (label, value) => {
  const opened = await ev(`(() => {
    const b = [...document.querySelectorAll('[role=dialog] [role=combobox]')].find((x) => (x.getAttribute('aria-label') || '').toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
    if (!b) return 'no combobox';
    b.click(); return 'open';
  })()`)
  if (opened !== 'open') return opened
  await sleep(450)
  const typed = await ev(`(() => {
    const i = document.querySelector('[role=listbox] input');
    if (!i) return 'no search input';
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`)
  if (typed !== 'typed') return typed
  await sleep(450)
  const out = await ev(`(() => {
    const o = [...document.querySelectorAll('[role=listbox] [role=option]')].find((x) => x.innerText.split('\\n')[0].trim() === ${JSON.stringify(value)});
    if (!o) return 'no option: ' + [...document.querySelectorAll('[role=listbox] [role=option]')].map((x) => x.innerText.split('\\n')[0]).slice(0, 4).join(',');
    o.click();
    return o.innerText.split('\\n')[0].trim();
  })()`)
  await sleep(600)
  return out
}

const NEW_EMAIL = 'harnaman.sethi@chronocampus.edu.in'
const NEW_TEACHER = { name: 'Dr. Harnaman Sethi', email: NEW_EMAIL, subject: 'History' }

/** Clearing storage only sticks once a real document owns the origin. */
const wipe = async () => {
  await send('Page.navigate', { url: `${APP}/login` })
  await sleep(2500)
  await ev(`Object.keys(localStorage).filter((k) => k.startsWith('chronocampus.')).forEach((k) => localStorage.removeItem(k))`)
  await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({ id: 'adm-01', email: 'principal@chronocampus.edu.in' }))`)
}
await wipe()

/* ------------------------------------------------------ 1. add a teacher ---- */
await goto(`${APP}/admin/teachers`)
const seeded = await readStore((s) => ({
  teachers: (s.allowed_teachers || []).length,
  roster: (s.teachers || []).length,
  students: (s.allowed_students || []).length,
}))
check('directory reads the seeded school', seeded.teachers > 10 && seeded.students === 5, JSON.stringify(seeded))

const openedAdd = await clickPageButton('^Add teacher$')
await sleep(800)
check('add form opens from the header', openedAdd === 'clicked' && (await dialogOpen()) === true)
const blank = await dialogText()
check('form fields come from the config', /main subject/i.test(blank) && /employee id/i.test(blank) && /add a teacher/i.test(blank), String(blank.split('\n').slice(0, 4).join(' / ')))

await ev(setField('Name', NEW_TEACHER.name))
await sleep(300)
await ev(setField('Email', 'harnaman.sethi@chronocampus'))
await sleep(500)
const badEmail = await dialogButton('^Add teacher$')
const badText = await dialogText()
check('an invalid email blocks the submit', badEmail && badEmail.disabled === true, JSON.stringify(badEmail))
check('the bad field explains itself inline', /name@school\.edu\.in/.test(badText), String(badText.match(/[^\n]*name@school[^\n]*/)?.[0] || 'no message'))
await shot('directories-invalid-email')

await ev(setField('Email', NEW_TEACHER.email))
await sleep(400)
const noSubject = await dialogButton('^Add teacher$')
check('a teacher needs a subject', noSubject && noSubject.disabled === true, JSON.stringify(noSubject))

await ev(setField('Main subject', NEW_TEACHER.subject))
await ev(setField('Phone', '+91 98765 41000'))
await sleep(400)
const ready = await dialogButton('^Add teacher$')
check('a valid form can be submitted', ready && ready.disabled === false, JSON.stringify(ready))
await clickDialogButton('^Add teacher$')
await dialogClosed()
await sleep(400)

const added = await readStore((email) => (s) => {
  const dir = (s.allowed_teachers || []).find((x) => x.email === email) || null
  const mirror = (s.teachers || []).find((x) => x.email === email) || null
  const profile = (s.profiles || []).find((x) => x.email === email) || null
  return { dir, mirror, profile, dupes: (s.allowed_teachers || []).filter((x) => x.email === email).length }
}, NEW_EMAIL)
check('teacher written to the directory', added.dir?.full_name === NEW_TEACHER.name && added.dir?.subject === NEW_TEACHER.subject, JSON.stringify(added.dir && { id: added.dir.id, subject: added.dir.subject, is_active: added.dir.is_active }))
check('exactly one row for that address', added.dupes === 1, `${added.dupes} rows`)
check('the roster mirror follows', added.mirror?.subject === NEW_TEACHER.subject, JSON.stringify(added.mirror && added.mirror.full_name))
check('the profile carries the directory role', added.profile?.role === 'teacher' && added.profile?.is_active === true, JSON.stringify(added.profile && { role: added.profile.role, active: added.profile.is_active }))
check('no second row was forked', (await readStore((s) => s.allowed_teachers.length)) === seeded.teachers + 1, `${seeded.teachers} -> ${await readStore((s) => s.allowed_teachers.length)}`)

const listed = await readStore((s) => (s.audit_logs || [])[0])
check('the write is audited', listed?.action === 'directory.create' && /allowed_teachers/.test(String(listed?.target)), JSON.stringify(listed && { action: listed.action, target: listed.target }))

/* ---------------------------------------------------- 2. it survives a reload */
await goto(`${APP}/admin/teachers`)
const rowSeen = await ev(`(() => [...document.querySelectorAll('tbody tr')].some((r) => r.innerText.includes(${JSON.stringify(NEW_TEACHER.name)})))()`)
check('the new teacher is on the table after a reload', rowSeen === true)

/* -------------------------------------------------------- 3. edit a subject - */
const started = await rowAction(NEW_TEACHER.name, 'Edit ')
await sleep(800)
check('edit opens pre-filled', started === 'clicked' && (await ev(`(() => document.querySelector('[role=dialog] [aria-label="Email"]')?.value)()`)) === NEW_EMAIL)
const prefill = await ev(`(() => ({ name: document.querySelector('[role=dialog] [aria-label="Name"]')?.value, subject: document.querySelector('[role=dialog] [aria-label="Main subject"]')?.value, phone: document.querySelector('[role=dialog] [aria-label="Phone"]')?.value }))()`)
check('the row is the starting point', prefill.name === NEW_TEACHER.name && prefill.subject === NEW_TEACHER.subject && prefill.phone === '+91 98765 41000', JSON.stringify(prefill))

await ev(setField('Main subject', 'Political Science'))
await sleep(300)
await clickDialogButton('^Save changes$')
await dialogClosed()
await sleep(400)
const edited = await readStore((email) => (s) => {
  const rows = (s.allowed_teachers || []).filter((x) => x.email === email)
  return { count: rows.length, subject: rows[0]?.subject, mirror: (s.teachers || []).find((x) => x.email === email)?.subject }
}, NEW_EMAIL)
check('the edit saves over the same record', edited.count === 1 && edited.subject === 'Political Science', JSON.stringify(edited))
check('the roster mirror follows the edit', edited.mirror === 'Political Science', String(edited.mirror))
await shot('directories-teacher-edited')

/* ------------------------------------------------ 4. the row on a phone ----- */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 760, deviceScaleFactor: 1, mobile: true })
await sleep(800)
const narrow = await ev(`(() => ({
  pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  add: Boolean([...document.querySelectorAll('button')].find((b) => /Add teacher/.test(b.textContent))),
  edits: document.querySelectorAll('tbody tr button[aria-label^="Edit "]').length,
}))()`)
check('no horizontal page overflow at 390px', narrow.pageOverflow <= 1, JSON.stringify(narrow))
check('every row keeps its actions', narrow.add === true && narrow.edits > 10, JSON.stringify({ add: narrow.add, edits: narrow.edits }))
await shot('directories-390px')
await clickPageButton('^Add teacher$')
await sleep(900)
const narrowForm = await ev(`(() => {
  const d = document.querySelector('[role=dialog]');
  return d ? { fits: d.getBoundingClientRect().right <= window.innerWidth + 1, close: Boolean(d.querySelector('button[aria-label="Close"]')) } : null;
})()`)
check('the form fits a phone and can be closed', narrowForm?.fits === true && narrowForm?.close === true, JSON.stringify(narrowForm))
await ev(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })()`)
await sleep(500)
check('Escape closes the dialog', (await dialogOpen()) === false)
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 760, deviceScaleFactor: 1, mobile: false })
await sleep(800)

/* ------------------------------------------------ 5. delete a loaded teacher - */
const victim = await readStore((s) => {
  const counts = {}
  for (const x of s.timetable_slots) counts[x.teacher_id] = (counts[x.teacher_id] || 0) + 1
  const mentors = new Set(s.class_sections.map((c) => c.mentor_teacher_id))
  const named = new Set(['tch-01', 'tch-02', 'tch-03', 'tch-04', 'tch-05', 'tch-06', 'tch-07', 'tch-08', 'tch-09', 'tch-10'])
  const pool = s.allowed_teachers
    .filter((x) => counts[x.id] > 0 && !named.has(x.id))
    .sort((a, b) => Number(mentors.has(b.id)) - Number(mentors.has(a.id)) || counts[b.id] - counts[a.id])
  const pick = pool[0]
  return {
    id: pick.id,
    name: pick.full_name,
    periods: counts[pick.id],
    mentor_of: s.class_sections.filter((c) => c.mentor_teacher_id === pick.id).map((c) => c.name),
    slotsBefore: s.timetable_slots.length,
  }
})
check('a loaded teacher found to delete', victim.periods > 0, JSON.stringify(victim))

await rowAction(victim.name, 'Delete ')
await sleep(900)
const warn = await dialogText()
const named = warn.match(/holds (\d+) periods? this week/)
check('the dialog names the period count', named && Number(named[1]) === victim.periods, String(named && named[0]))
check('and says what happens to those cells', /with no teacher assigned/.test(warn), String(warn.match(/[^\n]*no teacher assigned[^\n]*/)?.[0] || 'missing'))
if (victim.mentor_of.length)
  check('a class teacher is told their room goes empty', warn.includes(victim.mentor_of[0]), String(warn.match(/[^\n]*class teacher of[^\n]*/)?.[0] || 'missing'))
await shot('directories-delete-teacher-warning')

const confirmed = await clickDialogButton('^Delete permanently$')
await dialogClosed()
await sleep(400)
check('the deletion is confirmed', confirmed === 'clicked', String(confirmed))
const afterDelete = await readStore((tid) => (s) => ({
  gone: !(s.allowed_teachers || []).some((x) => x.id === tid),
  rosterGone: !(s.teachers || []).some((x) => x.id === tid),
  slots: s.timetable_slots.length,
  stillAssigned: s.timetable_slots.filter((x) => String(x.teacher_id) === tid).length,
  unnamed: s.timetable_slots.filter((x) => x.teacher_id === null).length,
  namedCells: s.timetable_slots.filter((x) => x.teacher_id === null && x.teacher_name).length,
  mentored: s.class_sections.filter((c) => c.mentor_teacher_id === tid).length,
  audit: s.audit_logs[0],
}), victim.id)
check('the person is off both directory and roster', afterDelete.gone && afterDelete.rosterGone)
check('their periods stay on the board', afterDelete.slots === victim.slotsBefore, `${victim.slotsBefore} -> ${afterDelete.slots} slots`)
check('no slot still points at them', afterDelete.stillAssigned === 0 && afterDelete.mentored === 0, JSON.stringify({ stillAssigned: afterDelete.stillAssigned, mentored: afterDelete.mentored }))
check(`${victim.periods} cells are now teacherless`, afterDelete.unnamed >= victim.periods && afterDelete.namedCells === 0, `${afterDelete.unnamed} teacherless, ${afterDelete.namedCells} still naming a deleted teacher`)
check('the toast repeats the count', /stayed on the board with no teacher assigned/.test(await bodyText()), String((await bodyText()).match(/[^\n]*stayed on the board[^\n]*/)?.[0] || 'no toast'))
check('the deletion is audited', afterDelete.audit?.action === 'directory.delete' && afterDelete.audit?.metadata?.periods_unassigned === victim.periods, JSON.stringify(afterDelete.audit && afterDelete.audit.metadata))

/* ------------------------------------------------ 6. an enrolled student ---- */
await goto(`${APP}/admin/students`)
const enrolled = await readStore((s) => {
  const row = s.student_enrollments.find((e) => e.enrollment_status === 'active')
  const st = s.allowed_students.find((x) => String(x.id) === String(row.student_id))
  return { id: st.id, name: st.full_name, class_section: row.class_section, enrollment_id: row.id }
})
await rowAction(enrolled.name, 'Delete ')
await sleep(900)
const blocked = await dialogText()
check('the enrolled student is warned before deleting', /is enrolled in/.test(blocked) && /only lets you deactivate/.test(blocked), String(blocked.match(/[^\n]*only lets you deactivate[^\n]*/)?.[0] || 'missing'))
const forced = await clickDialogButton('^Try deleting anyway$')
const refusedShown = await waitFor(`document.querySelector('[role=dialog]').innerText.includes('Nothing was deleted')`, 12000)
await sleep(300)
const refused = await dialogText()
check('the service refuses it', forced === 'clicked' && refusedShown === true && /Nothing was deleted/.test(refused), String(refused.match(/Nothing was deleted/) || 'no refusal'))
check('and the refusal says why', /enrollment is part of their academic record/.test(refused), String(refused.split('\n').slice(-3).join(' / ')))
const stillThere = await readStore((id) => (s) => s.allowed_students.some((x) => String(x.id) === String(id)), enrolled.id)
check('the row is kept', stillThere === true)
await shot('directories-student-refusal')
await clickDialogButton('^Cancel$')
await sleep(600)

/* ------------------------------------------------- 7. a student and their class */
const NEW_STUDENT = { name: 'Baldev Singh Dhillon', email: 'baldev.dhillon@student.chronocampus.edu.in', admission: 'CC-2026-0451' }
await clickPageButton('^Add student$')
await sleep(900)
await ev(setField('Name', NEW_STUDENT.name))
await ev(setField('School Email', NEW_STUDENT.email))
await ev(setField('Admission number', NEW_STUDENT.admission))
await sleep(400)
const noClass = await dialogButton('^Add student$')
check('a student cannot be added without a class', noClass && noClass.disabled === true, JSON.stringify(noClass))
check('the class field says so', /Pick the class this student sits in/.test(await dialogText()))
await ev(setField('Class grade', '12'))
await sleep(500)
const seated = await pickCombo('Class section', 'D · Science')
check('the class picker lists the open sections', seated === 'D · Science', String(seated))
await clickDialogButton('^Add student$')
await dialogClosed()
await sleep(400)
const studentSaved = await readStore((email) => (s) => {
  const st = (s.allowed_students || []).find((x) => x.email === email) || null
  const en = (s.student_enrollments || []).filter((e) => String(e.student_id) === String(st?.id))
  return {
    row: st && { name: st.full_name, admission: st.admission_number },
    active: en.filter((e) => e.enrollment_status === 'active').map((e) => e.class_section),
    profile: s.profiles.find((p) => String(p.id) === String(st?.id))?.class_section,
    audit: s.audit_logs.filter((a) => a.action === 'student.enroll')[0]?.metadata || null,
  }
}, NEW_STUDENT.email)
check('the student is on the directory', studentSaved.row?.name === NEW_STUDENT.name && studentSaved.row?.admission === NEW_STUDENT.admission, JSON.stringify(studentSaved.row))
check('and enrolled in the class picked', studentSaved.active.length === 1 && studentSaved.active[0] === '12-D Science', JSON.stringify(studentSaved.active))
check('the profile mirrors the enrollment', studentSaved.profile === '12-D Science', String(studentSaved.profile))
check('the seating is audited with a to', studentSaved.audit?.to === '12-D Science' && studentSaved.audit?.from === null, JSON.stringify(studentSaved.audit))
const shownClass = await ev(`(() => {
  const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(${JSON.stringify(NEW_STUDENT.name)}));
  return tr ? tr.innerText.replace(/\\n/g, ' | ') : null;
})()`)
check('the table shows the new class', /12-D Science/.test(String(shownClass)), String(shownClass))

/* ------------------------------------------------------- 8. promote a student */
const target = await readStore((classSection) => (s) => {
  const sec = s.class_sections.find((c) => c.is_active && c.name !== classSection && c.grade !== 11)
  return { name: sec.name, room: sec.default_room, enrolled_before: s.student_enrollments.filter((e) => e.enrollment_status === 'active').length }
}, enrolled.class_section)
const promoteStart = await rowAction(enrolled.name, "Change ")
await sleep(800)
const promoteDialog = await dialogText()
check('the move opens with the current class shown', promoteStart === 'clicked' && promoteDialog.includes(enrolled.class_section), String(promoteDialog.split('\n').filter((l) => l.includes(enrolled.class_section)).join(' | ') || 'no current class'))
const picked = await pickCombo('New class', target.name)
check('target class is picked from the open sections', picked === target.name, String(picked))
const sessionValue = await ev(`(() => document.querySelector('[role=dialog] select[aria-label="Academic session"]')?.value)()`)
check('the session is named, not assumed', Boolean(sessionValue), String(sessionValue))
await shot('directories-promote')
await clickDialogButton('^Move student$')
await dialogClosed()
await sleep(400)

const moved = await readStore((id) => (s) => {
  const own = s.student_enrollments.filter((e) => String(e.student_id) === String(id))
  return {
    rows: own.map((e) => ({ id: e.id, status: e.enrollment_status, class_section: e.class_section, from: e.promoted_from_enrollment_id })),
    active: own.filter((e) => e.enrollment_status === 'active').map((e) => e.class_section),
    history: own.filter((e) => e.enrollment_status === 'superseded').length,
    profile: s.profiles.find((p) => String(p.id) === String(id))?.class_section,
    audit: s.audit_logs.find((a) => a.action === 'student.promote'),
    notice: s.notifications.find((n) => n.audience === 'admin' && /moved to/.test(String(n.title))),
  }
}, enrolled.id)
check('the student now sits the new class', moved.active.length === 1 && moved.active[0] === target.name, JSON.stringify(moved.active))
check('the previous enrollment was superseded, not deleted', moved.history === 1 && moved.rows.some((r) => r.id === enrolled.enrollment_id && r.status === 'superseded'), JSON.stringify(moved.rows))
check('the new enrollment says where it came from', moved.rows.find((r) => r.status === 'active')?.from === enrolled.enrollment_id, String(moved.rows.find((r) => r.status === 'active')?.from))
check('the profile follows the move', moved.profile === target.name, String(moved.profile))
check('the audit row carries from and to', moved.audit?.metadata?.from === enrolled.class_section && moved.audit?.metadata?.to === target.name, JSON.stringify(moved.audit && moved.audit.metadata))
check('the office is told', /moved to/.test(String(moved.notice?.title)), String(moved.notice && moved.notice.title))

/* --------------------------------------------- 9. the last administrator ---- */
/* Two colleagues are set inactive in storage so the school is left with one
   active administrator; the refusal is then the interesting part, and the
   directory itself stays intact for whoever uses this demo next. */
await goto(`${APP}/admin/staff`)
await readStore((s) => {
  s.allowed_admins.forEach((a, i) => { if (i > 0) a.is_active = false })
  localStorage.setItem('chronocampus.demo.v6', JSON.stringify(s))
  return s.allowed_admins.map((a) => a.is_active)
})
await goto(`${APP}/admin/staff`)
const adminRows = await readStore((s) => ({
  active: s.allowed_admins.filter((a) => a.is_active !== false).map((a) => a.full_name),
  total: s.allowed_admins.length,
}))
check('one active administrator left to test with', adminRows.active.length === 1 && adminRows.total > 1, JSON.stringify(adminRows))
const deleteOffered = await rowAction(adminRows.active[0], 'Delete ')
await sleep(900)
const lastWarn = await dialogText()
check('the warning is shown before the attempt', /only active administrator/.test(lastWarn), String(lastWarn.match(/[^\n]*only active administrator[^\n]*/) || 'missing'))
check('and delete is offered as a refusal', deleteOffered === 'clicked' && Boolean(await dialogButton('^Try deleting anyway$')), String(deleteOffered))
await clickDialogButton('^Try deleting anyway$')
const adminRefusedShown = await waitFor(`document.querySelector('[role=dialog]').innerText.includes('Nothing was deleted')`, 12000)
await sleep(300)
const adminRefusal = await dialogText()
check('the service refuses to empty the office', adminRefusedShown === true && /only active administrator/.test(adminRefusal), String(adminRefusal.split('\n').slice(-3).join(' / ')))
const stillAdmins = await readStore((s) => s.allowed_admins.filter((a) => a.is_active !== false).length)
check('the row is kept', stillAdmins === 1)
await shot('directories-last-admin-refusal')
await clickDialogButton('^Cancel$')
await sleep(500)

/* ------------------------------------------ 10. the demo school is left clean */
await wipe()
await goto(`${APP}/admin/teachers`)
await sleep(5000)
const restored = await readStore((s) => ({
  admins: s.allowed_admins.filter((a) => a.is_active !== false).length,
  teachers: s.allowed_teachers.length,
  students: s.allowed_students.length,
}))
check('the demo school reseeds itself afterwards', restored.admins === 3 && restored.students === 5, JSON.stringify(restored))

const failed = results.filter((r) => !r.pass)
const errs = events
  .filter((e) => e.method === 'Runtime.exceptionThrown')
  .map((e) => (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text || '').split('\n')[0])
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
failed.forEach((f) => console.log('  !!', f.name, f.detail))
console.log(errs.length ? `runtime errors:\n  ${errs.join('\n  ')}` : 'no runtime errors')

ws.close()
await fetch(`${BASE}/json/close/${t.id}`)
process.exit(failed.length || errs.length ? 1 : 0)
