/**
 * Board tools: copy a day, duplicate a week, export CSV.
 * Drives the real UI for the buttons and the real data layer for the invariants.
 *
 * The seeded school is a tight timetable — one teacher covers a subject across
 * many sections — so a bulk copy lands some bells and is refused others. That is
 * the behaviour under test: what lands must match the source exactly, what is
 * refused must come back with a reason, and the board must never gain a clash.
 */
const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
const fails = []
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(`${APP}/login`)}`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id).resolve(m.result)
    pending.delete(m.id)
    return
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] || '')
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description || '').join(' '))
})
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, { resolve: res })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value

const btnSrc = (re) => `[...document.querySelectorAll('button')].find(b => ${re}.test((b.innerText || '').trim()))`
const has = async (re) => Boolean(await ev(`Boolean(${btnSrc(re)})`))
const clickBtn = (re) => `() => ${btnSrc(re)}`
const clickIn = (re) => `() => [...document.querySelectorAll('[role=dialog] button')].find(b => ${re}.test((b.innerText || '').trim()))`
const click = async (fnSrc) => {
  const r = await ev(
    `(() => { const e = (${fnSrc})(); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return {x: Math.round(b.x + b.width/2), y: Math.round(b.y + b.height/2)} })()`,
  )
  if (!r) return false
  await sleep(160)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  return true
}
const txt = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText.trim() : null })()`

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({id:'adm-01',email:'principal@chronocampus.edu.in'}))`)
// The copies rewrite real rows, so start from a pristine seed and leave one behind.
await ev(`localStorage.removeItem('chronocampus.demo.v6')`)
await send('Page.navigate', { url: `${APP}/admin/timetable` })
await sleep(3600)
await ev(`(() => { import('/src/lib/supabase.js').then(m => { window.__db = m.db }); return 1 })()`)
await sleep(700)

/* ------------------------------------------------------------------ the UI */
console.log('\n— the builder exposes the tools —')
ok(
  'Board tools heading rendered',
  Boolean(await ev(`Boolean([...document.querySelectorAll('.label')].find(e => /board tools/i.test(e.innerText)))`)),
)
for (const label of ['Copy a day', 'Duplicate a week', 'Export CSV']) ok(`${label} button`, await has(`/^${label}/`))

console.log('\n— the copy-a-day dialog —')
await click(clickBtn(/^Copy a day/))
await sleep(700)
const dlgTitle = await ev(txt('[role=dialog] h2, [role=dialog] h3'))
ok('dialog opens with its title', /Copy one day/.test(String(dlgTitle)), dlgTitle)
const preview = (await ev(txt('[role=dialog] .inset')) || '').replace(/\s+/g, ' ')
ok('dialog previews the class the board is showing', /periods on Monday \d+ already on/.test(preview), preview.slice(0, 96))
ok('the dialog says how many bells will actually fit', /can go to \w+day without moving anyone/.test(preview), preview.slice(96, 190))
const destChips = await ev(`[...document.querySelectorAll('[role=dialog] [aria-label="Destination day"] button')].map(b => b.innerText.trim().replace(/\\s*\\d+$/, ''))`)
ok('the destination picker offers the other five days', destChips.length === 5 && !destChips.includes('Monday'), destChips.join(','))
await click(`() => [...document.querySelectorAll('[role=dialog] [aria-label="Destination day"] button')].find(b => /^Thursday/.test(b.innerText.trim()))`)
await sleep(300)
ok(
  'destination day chip takes the click',
  (await ev(`(() => { const b = [...document.querySelectorAll('[role=dialog] [aria-label="Destination day"] button')].find(x => /^Thursday/.test(x.innerText.trim())); return b && b.getAttribute('aria-pressed') })()`)) === 'true',
)
await click(clickIn(/Replace the/))
await sleep(300)
const fitLine = (await ev(txt('[role=dialog] .inset')) || '').replace(/\s+/g, ' ')
const promised = Number(fitLine.match(/(\d+) of \d+ can go to Thursday/)?.[1] ?? -1)
ok('the fit count is shown for the chosen day', promised >= 0, fitLine.slice(96, 190))
await click(clickIn(/^Copy \d+ of \d+ periods/))
await sleep(2800)
const outcome = await ev(`(() => [...document.querySelectorAll('[role=dialog] .chip')].map(x => x.innerText.trim()).join(' | '))()`)
ok('the run reports written and blocked in the dialog', /written/.test(outcome) && /blocked|no conflicts/.test(outcome), outcome)
const wrote = Number(outcome.match(/(\d+) written/)?.[1] ?? -1)
ok('what the dialog promised is what the copy delivered', wrote === promised, `promised ${promised}, wrote ${wrote}`)
const toast = await ev(`(() => { const e = [...document.querySelectorAll('div')].find(x => /copied onto/.test(x.innerText || '') && x.innerText.length < 200); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : null })()`)
ok('a toast names the two days', /Monday copied onto Thursday/.test(String(toast)), String(toast).slice(0, 90))
await click(clickIn(/^Close/))
await sleep(900)
const stillOpen = await ev(`(() => { const d = document.querySelector('[role=dialog]'); return d ? (d.getAttribute('aria-label') || d.className).slice(0, 60) : null })()`)
ok('the dialog closes', !stillOpen, String(stillOpen))

/* -------------------------------------------------------------- data layer */
const board = (cls, day) =>
  ev(`(async () => {
    const s = await window.__db.listSlots({ class_section: ${JSON.stringify(cls)}${day ? `, day: ${JSON.stringify(day)}` : ''} })
    return s.map(x => ({ p: Number(x.period), d: x.day, sub: x.subject, t: String(x.teacher_id || ''), r: String(x.room || ''), note: x.homework_note || '', cls: x.class_section }))
      .sort((a, b) => a.p - b.p || a.cls.localeCompare(b.cls))
  })()`)
const clear = (cls, day) =>
  ev(`(async () => {
    const db = window.__db
    const rows = await db.listSlots({ class_section: ${JSON.stringify(cls)}${day ? `, day: ${JSON.stringify(day)}` : ''} })
    for (const r of rows) await db.deleteSlot(r.id)
    return rows.length
  })()`)
const clashCount = () => ev(`(async () => { const { auditConflicts } = await import('/src/lib/conflicts.js'); return auditConflicts(await window.__db.listSlots()).length })()`)

const CLS = await ev(`(async () => { const s = await window.__db.listSlots(); return [...new Set(s.map(x => x.class_section))].sort()[0] })()`)
const mon = await board(CLS, 'Monday')
const startClashes = await clashCount()

console.log(`\n— copy ${CLS} Monday onto an emptied Wednesday, staff included —`)
await clear(CLS, 'Wednesday')
const c1 = await ev(`(async () => await window.__db.copyDayBoard({ classSection: ${JSON.stringify(CLS)}, fromDay: 'Monday', toDay: 'Wednesday', overwrite: false }))()`)
const wed = await board(CLS, 'Wednesday')
ok('every bell was decided, none dropped', c1.written + c1.blocked.length === mon.length, `${c1.written} written / ${c1.blocked.length} blocked of ${mon.length}`)
ok('every bell that landed matches Monday exactly', wed.every((x) => mon.some((m) => m.p === x.p && m.sub === x.sub && m.t === x.t)), `${wed.length} on Wednesday`)
ok('every refusal explains itself', c1.blocked.every((b) => /is already teaching|is occupied|already holds/.test(b.reason)), c1.blocked[0]?.reason)
ok('refusals name the bell they were for', c1.blocked.every((b) => Number.isFinite(Number(b.period)) && !!b.day))
ok('notes did not travel', wed.every((x) => !x.note), `${wed.filter((x) => x.note).length} carried`)
const after1 = await clashCount()
ok('the copy cannot leave a clash behind', after1 === startClashes, `${after1} vs ${startClashes} before`)

console.log(`\n— the same day laid out without staff —`)
await clear(CLS, 'Wednesday')
const c1b = await ev(`(async () => await window.__db.copyDayBoard({ classSection: ${JSON.stringify(CLS)}, fromDay: 'Monday', toDay: 'Wednesday', overwrite: false, withStaff: false }))()`)
const wedB = await board(CLS, 'Wednesday')
ok('leaving the staff out lets far more bells land', c1b.written > c1.written && c1b.written + c1b.blocked.length === mon.length, `${c1.written} with staff → ${c1b.written} without, of ${mon.length}`)
ok('those bells arrive waiting for a teacher', wedB.length === c1b.written && wedB.every((x) => !x.t), `${wedB.filter((x) => !x.t).length}/${wedB.length} unassigned`)
ok('the subjects still mirror Monday', wedB.every((w) => mon.some((m) => m.p === w.p && m.sub === w.sub)))
ok('what is still refused is the room, not the teacher', c1b.blocked.every((b) => /is occupied|double-booked|already holds/.test(b.reason)), c1b.blocked[0]?.reason)
ok('still clash-free', (await clashCount()) === startClashes)

console.log('\n— replacing that day, with notes carried —')
const c2 = await ev(`(async () => await window.__db.copyDayBoard({ classSection: ${JSON.stringify(CLS)}, fromDay: 'Monday', toDay: 'Wednesday', overwrite: true, carryNotes: true, withStaff: false }))()`)
const wed2 = await board(CLS, 'Wednesday')
ok('a second run replaces what it wrote before', c2.replaced === c1b.written, `${c2.written} written / ${c2.replaced} replaced`)
ok(
  'carryNotes brings Monday homework with it',
  mon.filter((m) => wed2.some((w) => w.p === m.p)).every((m) => (wed2.find((w) => w.p === m.p)?.note || '') === m.note) && wed2.some((x) => x.note),
  `${wed2.filter((x) => x.note).length} notes carried`,
)
ok('a bell that was refused keeps what it had', c2.blocked.every((b) => !wed2.some((w) => w.p === Number(b.period) && w.sub === b.subject && w.note)))
ok('still clash-free', (await clashCount()) === startClashes)

console.log('\n— copying onto a full day is refused bell by bell —')
const c3 = await ev(`(async () => await window.__db.copyDayBoard({ classSection: ${JSON.stringify(CLS)}, fromDay: 'Monday', toDay: 'Tuesday', overwrite: false }))()`)
ok('nothing was written', c3.written === 0, JSON.stringify(c3).slice(0, 90))
ok('every bell came back as already-holds', c3.blocked.length === mon.length && c3.blocked.every((b) => /already holds/.test(b.reason)), c3.blocked[0]?.reason)
ok('the untouched day is unchanged', (await board(CLS, 'Tuesday')).length > 0)

console.log('\n— duplicate a whole week onto another class —')
const ALL = await ev(`(async () => [...new Set((await window.__db.listSlots()).map(x => x.class_section))].sort())()`)
const TO = ALL[1]
const srcWeek = await board(CLS)
const clearedTo = await clear(TO)
const c4 = await ev(`(async () => await window.__db.copyClassBoard({ fromSection: ${JSON.stringify(CLS)}, toSection: ${JSON.stringify(TO)}, overwrite: false }))()`)
ok(`the destination was emptied first (${clearedTo} periods)`, clearedTo > 0)
ok(`with staff, every bell was decided and none dropped (${CLS} → ${TO})`, c4.written + c4.blocked.length === srcWeek.length, `${c4.written} written / ${c4.blocked.length} blocked of ${srcWeek.length}`)
ok(
  'a saturated school refuses the staffed clone with teacher reasons',
  c4.written === 0 ? c4.blocked.every((b) => /is already teaching|is occupied/.test(b.reason)) : true,
  c4.blocked[0]?.reason,
)
const c5 = await ev(`(async () => await window.__db.copyClassBoard({ fromSection: ${JSON.stringify(CLS)}, toSection: ${JSON.stringify(TO)}, overwrite: false, withStaff: false }))()`)
const dstStaffless = await board(TO)
ok(`without staff most of the week lays down (${c5.written}/${srcWeek.length})`, c5.written > c4.written && c5.written + c5.blocked.length === srcWeek.length, `${c5.written} written / ${c5.blocked.length} blocked`)
ok('every cloned bell is unassigned, waiting for the office', dstStaffless.length === c5.written && dstStaffless.every((x) => !x.t), `${dstStaffless.filter((x) => !x.t).length}/${dstStaffless.length} blank`)
ok('the clone moved into the destination’s own room', dstStaffless.every((x) => x.r === dstStaffless[0]?.r), [...new Set(dstStaffless.map((x) => x.r))].join(','))
ok('the subjects match the source bell for bell', dstStaffless.every((x) => srcWeek.some((s) => s.p === x.p && s.d === x.d && s.sub === x.sub)))
const after4 = await clashCount()
ok('a bulk copy cannot create a clash anywhere on the board', after4 === startClashes, `${after4}`)
const logged = await ev(`(async () => (await window.__db.listAudit(14)).filter(l => l.action === 'timetable.copy').map(l => l.metadata))()`)
ok('each copy that wrote something left one audit row', Array.isArray(logged) && logged.length >= 3 && logged.every((m) => 'written' in m && 'blocked' in m), JSON.stringify(logged?.[0] || logged))

console.log('\n— refusals are refused —')
const refusals = await ev(`(async () => {
  const db = window.__db
  const out = []
  for (const call of [
    () => db.copyDayBoard({ classSection: ${JSON.stringify(CLS)}, fromDay: 'Monday', toDay: 'Monday' }),
    () => db.copyClassBoard({ fromSection: ${JSON.stringify(CLS)}, toSection: ${JSON.stringify(CLS)} }),
    () => db.copyDayBoard({ classSection: '99-Z', fromDay: 'Monday', toDay: 'Friday' }),
    () => db.copyClassBoard({ fromSection: ${JSON.stringify(CLS)}, toSection: '99-Z' }),
    () => db.copyDayBoard({ fromDay: 'Monday', toDay: 'Friday' }),
  ]) {
    try { await call(); out.push('resolved') } catch (e) { out.push(e.message) }
  }
  return out
})()`)
ok('same-day copy refused', /same/i.test(refusals[0]), refusals[0])
ok('same-class copy refused', /same/i.test(refusals[1]), refusals[1])
ok('copy from an unknown class refused', /no periods/i.test(refusals[2]), refusals[2])
ok('copy onto an unregistered class refused', /not a registered section/i.test(refusals[3]), refusals[3])
ok('copy with no class chosen refused', /Choose a class/i.test(refusals[4]), refusals[4])

/* ----------------------------------------------------------------- the CSV */
console.log('\n— CSV export —')
await ev(`(() => {
  window.__csv = null
  window.__clicked = 0
  const orig = URL.createObjectURL
  URL.createObjectURL = (blob) => { blob.text().then(x => { window.__csv = x }); return orig(blob) }
  const clickOrig = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () { window.__clicked++; return clickOrig.apply(this, arguments) }
  return 1
})()`)
await click(clickBtn(/Export CSV/))
await sleep(700)
ok('export dialog opens', /Export the board/.test(String(await ev(txt('[role=dialog] h2, [role=dialog] h3')))), String(await ev(txt('[role=dialog] h2, [role=dialog] h3'))))
await click(clickIn(/Whole school/))
await sleep(1400)
const csv = await ev(`window.__csv`)
const total = await ev(`(async () => (await window.__db.listSlots()).length)()`)
ok('a file was handed to the browser', (await ev('window.__clicked')) === 1)
if (csv) {
  const lines = csv.trim().split('\n')
  ok('header names every column', lines[0] === 'Class,Day,Period,Time,Subject,Teacher,Room,Substitute,Homework', lines[0].slice(0, 80))
  ok('one row per period on the board', lines.length - 1 === total, `${lines.length - 1} rows vs ${total} slots`)
  ok('rows carry day, bell, clock time and subject', /^[^,]+,\w+day,P?\d+,\d{2}:\d{2}–\d{2}:\d{2},[^,]+,[^,]*,/.test(lines[1]), lines[1].slice(0, 78))
} else {
  ok('csv produced', false, 'nothing captured')
}
await click(clickIn(/^Close/))
await sleep(300)

const realErrors = errors.filter((e) => !/Download is starting|chrome:\/\/|blob:/.test(e))
ok('no console errors while using the tools', realErrors.length === 0, realErrors.slice(0, 2).join(' / '))

await ev(`(() => { localStorage.removeItem('chronocampus.demo.v6'); return 1 })()`)
console.log(`\n${pass + fails.length} checks, ${fails.length} failed`)
fails.forEach((f) => console.log(`  !! ${f}`))
ws.close()
await fetch(`${BASE}/json/close/${t.id}`)
process.exit(fails.length ? 1 : 0)
