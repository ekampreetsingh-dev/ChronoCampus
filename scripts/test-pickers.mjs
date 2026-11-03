/**
 * The searchable pickers: open, filter, keyboard-navigate, choose — including
 * from inside a modal, where a non-portal list would be clipped.
 */
import fs from 'fs'
import path from 'path'

const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const OUT = path.resolve('shots')
const KEY = 'chronocampus.demo.v6'
const VP = { width: 1366, height: 657 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(`${APP}/login`)}`, { method: 'PUT' })).json()
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
const key = async (k, text) => {
  const code = k === 'Enter' ? 'Enter' : k === 'Escape' ? 'Escape' : 'ArrowDown'
  const vk = k === 'Enter' ? 13 : k === 'Escape' ? 27 : 40
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text } : {}) })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  await sleep(300)
}
/** Real per-character keystrokes: the old modal autofocus ate everything but the first. */
const typeKeys = async (text) => {
  for (const ch of text) {
    const vk = ch.toUpperCase().charCodeAt(0)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code: `Key${ch.toUpperCase()}`, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: ch })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: `Key${ch.toUpperCase()}`, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
    await sleep(120)
  }
}

await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { ...VP, deviceScaleFactor: 1, mobile: false })
const goto = async (url) => { events = []; await send('Page.navigate', { url }); await sleep(2800) }
const shot = async (n) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `${n}.png`), Buffer.from(data, 'base64')) }
const errs = () => events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception?.description || '').split('\n')[0])

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}
const waitSeed = async () => {
  for (let i = 0; i < 20; i += 1) {
    const n = await ev(`(() => (JSON.parse(localStorage[${JSON.stringify(KEY)}]||'{}').class_sections||[]).length)()`)
    if (n === 56) return n
    await sleep(700)
  }
  return 0
}
const openCombo = (label) => ev(`(() => {
  const b = [...document.querySelectorAll('[role=combobox]')].find(x => (x.getAttribute('aria-label')||'').toLowerCase().includes(${JSON.stringify(label)}.toLowerCase()) || x.textContent.trim().toLowerCase().startsWith(${JSON.stringify(label)}.toLowerCase()));
  if (!b) return 'no combobox';
  b.click(); return 'opened';
})()`)
const panel = () => ev(`(() => {
  const p = document.querySelector('[role=listbox]');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  const owner = p.closest('[role=dialog]');
  return {
    options: p.querySelectorAll('[role=option]').length,
    portalled: p.parentElement === document.body,
    clipped: owner ? true : false,
    inBody: r.bottom <= window.innerHeight + 1 && r.top >= -1,
    height: Math.round(r.height),
    footer: (p.innerText.match(/\\d+ of \\d+[^\\n]*/)||[null])[0],
    first: p.querySelector('[role=option]')?.innerText.split('\\n')[0],
    search: Boolean(p.querySelector('input')),
  };
})()`)
const typeQuery = (q) => ev(`(() => {
  const i = document.querySelector('[role=listbox] input');
  if (!i) return 'no search input';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, ${JSON.stringify(q)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()`)
const chooseFirst = () => ev(`(() => {
  const o = document.querySelector('[role=listbox] [role=option]');
  if (!o) return 'none';
  const label = o.innerText.split('\\n')[0];
  o.click();
  return label;
})()`)

await send('Page.navigate', { url: `${APP}/login` })
await sleep(2500)
await ev(`Object.keys(localStorage).filter(k => k.startsWith('chronocampus.')).forEach(k => localStorage.removeItem(k))`)
await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({id:'adm-01',email:'principal@chronocampus.edu.in'}))`)

/* ------------------------------------------------- 1. the board class picker */
await goto(`${APP}/admin/timetable`)
check('seed ready', (await waitSeed()) === 56)
check('comboboxes on the board', (await ev(`document.querySelectorAll('[role=combobox]').length`)) >= 1, `${await ev(`document.querySelectorAll('[role=combobox]').length`)}`)
console.log('open ->', await openCombo('Class board'))
let p = await panel()
check('class picker opens with all classes', p && p.options === 56 && p.search, JSON.stringify(p))
check('list is drawn outside the page flow', p?.portalled === true, `portal ${p?.portalled}`)
await shot('picker-class-open')
console.log('type ->', await typeQuery('11-'))
await sleep(400)
p = await panel()
check('typing filters the class list', p && p.options === 4 && /4 of 56/.test(p.footer || ''), JSON.stringify({ n: p?.options, footer: p?.footer }))
const pickedClass = await chooseFirst()
await sleep(1200)
check('choosing switches the board', pickedClass === '11-A Science' && (await ev(`(() => (document.querySelector('[role=combobox]')||{}).textContent)()`)).includes('11-A Science'), String(pickedClass))

/* ------------------------------------------------- 2. a picker inside a modal */
await ev(`(() => { const c=[...document.querySelectorAll('table tbody td button')]; const cell=c.find(x=>/Mathematics/.test(x.getAttribute('aria-label')||''))||c[0]; cell.click() })()`)
for (let i = 0; i < 8; i += 1) { if (await ev(`Boolean(document.querySelector('[role=dialog]'))`)) break; await sleep(400) }
console.log('open subject ->', await openCombo('Subject'))
await sleep(400)
p = await panel()
check('subject picker opens inside the modal', p && p.options > 10 && p.portalled, JSON.stringify(p))
check('the panel stays fully on screen', p?.inBody === true, `height ${p?.height}, on-screen ${p?.inBody}`)
await shot('picker-subject-in-modal')
await typeKeys('phys')
await sleep(400)
const typed = await ev(`(() => ({ value: document.querySelector('[role=listbox] input')?.value ?? null, focus: document.activeElement.tagName }))()`)
check('every keystroke lands in the search box', typed.value === 'phys', JSON.stringify(typed))
p = await panel()
check('subject search matches on the way', p && p.options <= 2 && p.options > 0, JSON.stringify({ n: p?.options, first: p?.first, footer: p?.footer }))
await key('ArrowDown')
await key('Enter', '\r')
await sleep(900)
const kb = await ev(`(() => {
  const b = [...document.querySelectorAll('[role=dialog] [role=combobox]')].find(x => /subject/i.test(x.getAttribute('aria-label') || ''));
  return { dialogs: document.querySelectorAll('[role=dialog]').length, panel: Boolean(document.querySelector('[role=listbox]')), trigger: b ? b.textContent.trim() : null };
})()`)
check('keyboard selection lands', String(kb.trigger || '').startsWith('Phys'), JSON.stringify(kb))
check('the teacher list followed the subject', (await ev(`(() => (document.body.innerText.match(/\\d+ teach [A-Za-z &]+/)||[null])[0])()`)) !== null, String(await ev(`(() => (document.body.innerText.match(/\\d+ of \\d+ staff listed[^\\n]*/)||[null])[0])()`)))
const firstName = await ev(`(() => {
  const b = [...document.querySelectorAll('[role=dialog] button')].find(x => /free|in \\d+-/.test(x.textContent));
  return b ? b.innerText.split('\\n')[0].split(' ')[0] : null;
})()`)
await ev(`(() => { document.querySelector('[role=dialog] [aria-label="Search teachers"]').focus() })()`)
await typeKeys(firstName.slice(0, 5))
await sleep(500)
const staffTyped = await ev(`(() => { const i=document.querySelector('[role=dialog] [aria-label="Search teachers"]'); return { value: i?.value ?? null, rows: [...document.querySelectorAll('[role=dialog] button')].filter(b => /free|in \\d+-/.test(b.textContent)).length } })()`)
check('the teacher search takes a whole name', staffTyped.value === firstName.slice(0, 5) && staffTyped.rows > 0 && staffTyped.rows < 12, JSON.stringify(staffTyped))
await ev(`(() => { const b=[...document.querySelectorAll('[role=dialog] button')].find(x=>x.getAttribute('aria-label')==='Close'); b&&b.click() })()`)
await sleep(500)

/* ------------------------------------------- 3. the mentor picker in records */
await goto(`${APP}/admin/sections`)
await ev(`(() => { [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='New section').click() })()`)
await sleep(800)
await ev(`(() => { [...document.querySelectorAll('[role=dialog] button.chip')].find(b=>b.textContent.trim()==='11').click() })()`)
await sleep(400)
await ev(`(() => {
  const el = document.querySelector('[role=dialog] [aria-label="Section letter"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, 'E');
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`)
await sleep(500)
check('class 11 section E drafted', (await ev(`(() => document.querySelector('[role=dialog] input[placeholder="11-D Science"]')?.value)()`)) === '11-E Science')
console.log('open mentor ->', await openCombo('Class teacher'))
await sleep(400)
p = await panel()
check('mentor picker lists all staff', p && p.options === 79 && p.options !== 0, JSON.stringify({ n: p?.options, footer: p?.footer }))
console.log('type ->', await typeQuery('Accountancy'))
await sleep(400)
p = await panel()
check('staff can be found by subject', p && p.options > 1 && p.options < 12, JSON.stringify({ n: p?.options, first: p?.first }))
const mentor = await chooseFirst()
await sleep(600)
check('chosen mentor shows on the trigger', (await ev(`(() => { const b=[...document.querySelectorAll('[role=dialog] [role=combobox]')].find(x=>/class teacher/i.test(x.getAttribute('aria-label')||'')); return b?.innerText.replace(/\\n/g,' · ') })()`)).includes(mentor), String(mentor))
await shot('picker-mentor')
await openCombo('Class teacher')
await sleep(400)
await key('Escape')
await sleep(400)
const esc = await ev(`(() => ({
  panel: Boolean(document.querySelector('[role=listbox]')),
  dialogs: document.querySelectorAll('[role=dialog]').length,
  trigger: (() => { const b=[...document.querySelectorAll('[role=dialog] [role=combobox]')].find(x=>/class teacher/i.test(x.getAttribute('aria-label')||'')); return b?.innerText.replace(/\\n/g,' · ') || null })(),
}))()`)
check('escape closes the open panel without taking the dialog with it', esc.panel === false && esc.dialogs === 1 && String(esc.trigger).includes(mentor), JSON.stringify(esc))
await ev(`(() => { [...document.querySelectorAll('[role=dialog] button')].find(b=>/Create section/.test(b.textContent)).click() })()`)
await sleep(1700)
const stored = await ev(`(() => {
  const s = JSON.parse(localStorage[${JSON.stringify(KEY)}]);
  const sec = s.class_sections.find(x => x.name === '11-E Science');
  const t = s.teachers.find(x => x.id === sec?.mentor_teacher_id);
  return { created: Boolean(sec), mentor: t?.full_name || null, subject: t?.subject || null, total: s.class_sections.length };
})()`)
check('the mentor was saved with the class', stored.created && Boolean(stored.mentor), JSON.stringify(stored))

/* --------------------------------------- 4. a student finding their own class */
await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({id:'stu-01',email:'gurpreet.sandhu@student.chronocampus.edu.in'}))`)
await goto(`${APP}/student`)
for (let i = 0; i < 10; i += 1) { if ((await ev(`document.querySelectorAll('[role=combobox]').length`)) >= 1) break; await sleep(600) }
console.log('open class ->', await openCombo('Class and section'))
await sleep(400)
p = await panel()
check('the gate offers a searchable class list', p && p.options >= 56, JSON.stringify({ n: p?.options }))
console.log('type ->', await typeQuery('11-A'))
await sleep(400)
check('a student can find their section in two keystrokes', ((await panel())?.options || 0) === 1, JSON.stringify((await panel())?.footer))
await chooseFirst()
await sleep(500)
await ev(`(() => {
  const el = document.querySelector('[role=dialog] input.field');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, 'SCI11A-2026-K7Q');
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`)
await sleep(300)
await ev(`(() => { [...document.querySelectorAll('button')].find(b=>/Verify and unlock/.test(b.textContent))?.click() })()`)
await sleep(2000)
const unlocked = await ev(`(() => (document.querySelector('h1,h2')||{}).textContent||'')()`)
check('enrolment still works through the new picker', !/not verified/.test(unlocked), unlocked)

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
failed.forEach((f) => console.log('  !!', f.name, f.detail))
const e = errs()
console.log(e.length ? `runtime errors:\n  ${e.join('\n  ')}` : 'no runtime errors')

ws.close()
await fetch(`${BASE}/json/close/${t.id}`)
process.exit(failed.length || e.length ? 1 : 0)
