import fs from 'fs'
import path from 'path'

const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const OUT = path.resolve('shots')
fs.mkdirSync(OUT, { recursive: true })
const VP = { width: 1366, height: 657 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(`${APP}/login`)}`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
let events = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id).resolve(m.result)
    pending.delete(m.id)
  } else if (m.method) events.push(m)
})
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value

await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { ...VP, deviceScaleFactor: 1, mobile: false })

const goto = async (url) => {
  events = []
  await send('Page.navigate', { url })
  await sleep(2200)
}
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
}
const probe = () =>
  ev(
    `(() => {
      const de=document.documentElement, b=document.body;
      const over = de.scrollWidth > ${VP.width} + 2;
      const empty = b.innerText.trim().length < 40;
      return { scrollW: de.scrollWidth, scrollH: de.scrollHeight, over, empty,
               h: (b.querySelector('h1,h2')||{}).textContent?.trim().slice(0,52) || null,
               cells: b.querySelectorAll('table td').length, btns: b.querySelectorAll('button').length };
    })()`,
  )

const errors = () =>
  events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text || '').split('\n')[0])
    .concat(
      events
        .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
        .map((e) => e.params.args.map((a) => a.description || a.value).join(' ').slice(0, 160)),
    )

const SESSIONS = {
  admin: { id: 'adm-01', email: 'principal@chronocampus.edu.in' },
  teacher: { id: 'tch-01', email: 'neelam.kaur@chronocampus.edu.in' },
  student: { id: 'stu-01', email: 'gurpreet.sandhu@student.chronocampus.edu.in' },
}

async function as(role) {
  await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify(${JSON.stringify(SESSIONS[role])}))`)
}

const ROUTES = [
  ['login', '/login', null],
  ['admin-overview', '/admin', 'admin'],
  ['admin-timetable', '/admin/timetable', 'admin'],
  ['admin-substitutes', '/admin/substitutes', 'admin'],
  ['admin-workload', '/admin/workload', 'admin'],
  ['admin-reports', '/admin/reports', 'admin'],
  ['admin-staff', '/admin/staff', 'admin'],
  ['admin-teachers', '/admin/teachers', 'admin'],
  ['admin-students', '/admin/students', 'admin'],
  ['admin-sections', '/admin/sections', 'admin'],
  ['admin-subjects', '/admin/subjects', 'admin'],
  ['admin-calendar', '/admin/calendar', 'admin'],
  ['admin-activity', '/admin/activity', 'admin'],
  ['admin-sessions', '/admin/sessions', 'admin'],
  ['admin-codes', '/admin/codes', 'admin'],
  ['admin-settings', '/admin/settings', 'admin'],
  ['teacher-overview', '/teacher', 'teacher'],
  ['teacher-timetable', '/teacher/timetable', 'teacher'],
  ['teacher-homework', '/teacher/homework', 'teacher'],
  ['teacher-subs', '/teacher/substitutions', 'teacher'],
  ['teacher-profile', '/teacher/profile', 'teacher'],
  ['student-gate', '/student', 'student'],
]

let fails = 0
console.log('route                     size            h1/cells/btns')
for (const [name, url, role] of ROUTES) {
  if (role) await as(role)
  else await ev(`localStorage.removeItem('chronocampus.session.v2')`)
  await goto(APP + url)
  const p = await probe()
  const errs = errors()
  const bad = p.over || p.empty || errs.length
  if (bad) fails++
  console.log(
    `${name.padEnd(22)} ${String(p.scrollW + 'x' + p.scrollH).padEnd(11)} ${String(p.cells + 'c/' + p.btns + 'b').padEnd(8)} ${(p.h || '').slice(0, 34)}` +
      (bad ? `\n    !! ${[p.over && 'horizontal overflow', p.empty && 'blank render', ...errs].filter(Boolean).join(' | ')}` : ''),
  )
  await shot(name)
}

// student verification flow — pick by visible label, never by option index
await as('student')
await goto(APP + '/student')
// the gate's class list is a searchable picker; wait for the directories to load
for (let i = 0; i < 10; i += 1) {
  if (await ev(`(() => [...document.querySelectorAll('[role=combobox]')].some(b => /class and section/i.test(b.getAttribute('aria-label')||'')))()`)) break
  await sleep(700)
}
const picked = await ev(`(() => {
  const b = [...document.querySelectorAll('[role=combobox]')].find(x => /class and section/i.test(x.getAttribute('aria-label')||''));
  if (!b) return { err: 'no class picker' };
  b.click();
  return new Promise((res) => setTimeout(() => {
    const i = document.querySelector('[role=listbox] input');
    if (!i) return res({ err: 'no search input' });
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, '11-A');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(() => {
      const opts = [...document.querySelectorAll('[role=listbox] [role=option]')].map(o => o.innerText.split('\\n')[0]);
      const o = [...document.querySelectorAll('[role=listbox] [role=option]')].find(x => x.innerText.trim().startsWith('11-A Science'));
      if (!o) return res({ err: 'no 11-A Science option', opts });
      o.click();
      res({ options: opts.length, section: o.innerText.split('\\n')[0] });
    }, 400);
  }, 400));
})()`)
console.log('gate selections     ->', JSON.stringify(picked))
await sleep(400)
await ev(`(() => {
  const inp=document.querySelector('[role=dialog] input.field');
  const setI=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  setI.call(inp,'WRONG-CODE'); inp.dispatchEvent(new Event('input',{bubbles:true}));
})()`)
await sleep(300)
await ev(`[...document.querySelectorAll('button')].find(b=>/Verify and unlock/.test(b.textContent))?.click()`)
await sleep(1200)
const rejected = await ev(`(() => ({ msg: (document.querySelector('.chip.tone-conflict span')||{}).textContent || 'none', locked: /Too many failed/.test(document.body.innerText) }))()`)
console.log('wrong code rejected ->', JSON.stringify(rejected))
await shot('student-rejected')

await ev(`(() => {
  const inp=document.querySelector('[role=dialog] input.field');
  const setI=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  setI.call(inp,'SCI11A-2026-K7Q'); inp.dispatchEvent(new Event('input',{bubbles:true}));
})()`)
await sleep(200)
await ev(`[...document.querySelectorAll('button')].find(b=>/Verify and unlock/.test(b.textContent))?.click()`)
await sleep(1800)
const enrolled = await probe()
console.log('after valid code    ->', JSON.stringify(enrolled), errors().join(' | ') || 'no errors')
await shot('student-enrolled')
for (const [name, url] of [['student-timetable', '/student/timetable'], ['student-homework', '/student/homework'], ['student-academic', '/student/academic']]) {
  await goto(APP + url)
  const p = await probe()
  const errs = errors()
  if (p.over || p.empty || errs.length) fails++
  console.log(`${name.padEnd(22)} ${String(p.scrollW + 'x' + p.scrollH).padEnd(11)} ${String(p.cells + 'c/' + p.btns + 'b').padEnd(8)} ${(p.h || '').slice(0, 34)}` + (p.over || p.empty || errs.length ? `\n    !! ${errs.join(' | ')}` : ''))
  await shot(name)
}

// dark mode
await goto(APP + '/admin')
await ev(`localStorage.setItem('chronocampus.theme','dark')`)
await goto(APP + '/admin')
await shot('admin-dark')

// mobile
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true })
await goto(APP + '/admin/timetable')
const mob = await probe()
console.log('\nmobile 390w admin/timetable ->', JSON.stringify(mob), errors().join(' | ') || 'no errors')
await shot('mobile-timetable')

console.log(`\n${fails ? fails + ' route(s) with problems' : 'all routes clean'}`)
await send('Target.closeTarget', { targetId: t.id })
process.exit(0)
