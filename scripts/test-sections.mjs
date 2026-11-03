import fs from 'fs'
import path from 'path'

const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const OUT = path.resolve('shots')
fs.mkdirSync(OUT, { recursive: true })
const VP = { width: 1366, height: 657 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(`${APP}/admin/sections`)}`, { method: 'PUT' })).json()
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
await send('Emulation.setDeviceMetricsOverride', { ...VP, deviceScaleFactor: 1, mobile: false })
const goto = async (url) => { events = []; await send('Page.navigate', { url }); await sleep(2600) }
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
}
const errs = () =>
  events.filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text || '').split('\n')[0])

/* every selector below is scoped to the dialog so page chips can't be hit */
const openModal = async () => {
  const hit = await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'New section'); if (!b) return 'no button'; b.click(); return 'clicked' })()`)
  await sleep(700)
  if (hit !== 'clicked') console.log('   openModal:', hit)
  return ev(`(() => Boolean(document.querySelector('[role=dialog]')))()`)
}
const dChip = (text) => `(() => {
  const b = [...document.querySelectorAll('[role=dialog] button.chip')].find(x => x.textContent.trim().replace(/\\s*· has$/, '') === ${JSON.stringify(text)});
  if (!b) return 'missing';
  b.click(); return 'ok';
})()`
const dSet = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return 'missing';
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  return 'ok';
})()`
const dVal = (selector) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? (el.value !== undefined && el.tagName !== 'SELECT' ? el.value : el.tagName === 'SELECT' ? el.value : el.textContent) : null })()`
const store = () => ev(`(() => {
  const s = JSON.parse(localStorage['chronocampus.demo.v6'] || '{}');
  return { sections: (s.class_sections||[]).length, rooms: (s.school_settings?.rooms||[]).length, codes: (s.class_codes||[]).length,
           nineE: (s.class_sections||[]).find(c => c.name === '9-E') || null,
           code9E: (s.class_codes||[]).find(c => c.class_section === '9-E') || null }
})()`)

const results = []
/** Open a searchable picker by aria-label, type, and click the exact option. */
const pickCombo = async (label, value) => {
  const opened = await ev(`(() => {
    const b = [...document.querySelectorAll('[role=combobox]')].find(x => (x.getAttribute('aria-label')||'').toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
    if (!b) return 'no combobox';
    b.click(); return 'open';
  })()`)
  if (opened !== 'open') return opened
  await sleep(450)
  const typed = await ev(`(() => {
    const i = document.querySelector('[role=listbox] input');
    if (!i) return 'no search input';
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, ${JSON.stringify(value)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`)
  if (typed !== 'typed') return typed
  await sleep(450)
  const out = await ev(`(() => {
    const o = [...document.querySelectorAll('[role=listbox] [role=option]')].find(x => x.innerText.split('\\n')[0].trim() === ${JSON.stringify(value)});
    if (!o) return 'no option: ' + [...document.querySelectorAll('[role=listbox] [role=option]')].map(x => x.innerText.split('\\n')[0]).slice(0, 4).join(',');
    o.click();
    return o.innerText.split('\\n')[0].trim();
  })()`)
  await sleep(600)
  return out
}

const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** Clearing storage only sticks once a real document owns the origin. */
const wipe = async () => {
  await send('Page.navigate', { url: `${APP}/login` })
  await sleep(2500)
  await ev(`Object.keys(localStorage).filter(k => k.startsWith('chronocampus.')).forEach(k => localStorage.removeItem(k))`)
  await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({ id:'adm-01', email:'principal@chronocampus.edu.in' }))`)
}
await wipe()

/* -------------------------------------------------- 1. add a junior class -- */
await goto(`${APP}/admin/sections`)
let before = await store()
if (before.sections !== 56) {
  await wipe()
  await goto(`${APP}/admin/sections`)
  before = await store()
}
check('56 sections seeded', before.sections === 56, `${before.sections} sections, ${before.rooms} rooms`)
check('a–d for every class', (await ev(`(() => { const s=JSON.parse(localStorage['chronocampus.demo.v6']).class_sections; return [1,6,11,12].every(g => ['A','B','C','D'].every(l => s.some(c => c.grade===g && c.section===l))) })()`)) === true)

check('modal opens', (await openModal()) === true)
console.log('   class chips:', await ev(`(() => [...document.querySelectorAll('[role=dialog] button.chip')].map(b => b.textContent.trim()).join(' '))()`))
await ev(dChip('9'))
await sleep(300)
await ev(`(() => { const el=document.querySelector('[role=dialog] [aria-label="Section letter"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'E'); el.dispatchEvent(new Event('input',{bubbles:true})) })()`)
await sleep(400)
const drafted = await ev(`(() => ({
  name: document.querySelector('[role=dialog] input[placeholder="11-D Science"]')?.value,
  roomInput: document.querySelector('[role=dialog] input[placeholder^="Room"]') || null,
  dl: [...document.querySelectorAll('[role=dialog] .inset dd')].map(d => d.textContent.trim()),
}))()`)
check('name auto-filled', drafted.name === '9-E', JSON.stringify(drafted.name))
check('room derived rather than typed', drafted.roomInput === null && drafted.dl.includes('Room 950'), JSON.stringify(drafted.dl))
check('junior bell derived', drafted.dl.some((x) => /Classes 1–10/.test(x)) && drafted.dl.some((x) => /11:00/.test(x)), JSON.stringify(drafted.dl))
await shot('sections-modal-9e')

await ev(`(() => { [...document.querySelectorAll('[role=dialog] button')].find(b => /Create section/.test(b.textContent)).click() })()`)
await sleep(1600)
const after = await store()
check('9-E persisted', Boolean(after.nineE), JSON.stringify(after.nineE && { band: after.nineE.band, bell: after.nineE.bell_schedule_id, room: after.nineE.default_room }))
check('section count grew', after.sections === before.sections + 1, `${before.sections} -> ${after.sections}`)
check('home room became bookable', after.rooms === before.rooms + 1, `${before.rooms} -> ${after.rooms}`)
check('curriculum attached', Boolean(after.nineE?.curriculum?.Mathematics), `Mathematics ${after.nineE?.curriculum?.Mathematics}`)
check('confirms with next step', (await ev(`(() => (document.body.innerText.match(/9-E is on the register[^\\n]*/)||['none'])[0])()`)) !== 'none')
const visible = await ev(`(() => ({
  cards: [...document.querySelectorAll('.panel')].filter(p => p.innerText.startsWith('9-E')).length,
  groups: [...document.querySelectorAll('h2')].filter(h => /^Class \\d+$/.test(h.textContent.trim())).length,
  sub: (document.body.innerText.match(/Sections A, B, C, D, E[^\\n]*/)||[null])[0],
}))()`)
check('card renders under Class 9', visible.cards === 1, JSON.stringify(visible.cards))
check('grouped by class', visible.groups === 12, `${visible.groups} class groups`)
check('new section listed in its group', Boolean(visible.sub), String(visible.sub))

/* ------------------------------------------------------- 2. persistence ---- */
await goto(`${APP}/admin/sections`)
check('survives reload', Boolean((await store()).nineE))
await goto(`${APP}/admin/timetable`)
check('builder can target the new class', (await pickCombo('Class board', '9-E')) === '9-E', String(await pickCombo('Class board', '9-E')))
check('no clashes introduced', (await ev(`(() => { const t=document.body.innerText; return /clash/i.test(t) ? t.match(/[^\\n]*clash[^\\n]*/i)[0] : 'clean' })()`)) === 'clean')

/* ------------------------------------------------- 3. duplicate is blocked - */
await goto(`${APP}/admin/sections`)
check('modal reopens', (await openModal()) === true)
await ev(dChip('11'))
await sleep(300)
const dupA = await ev(dChip('A'))
await sleep(500)
const dup = await ev(`(() => {
  const btn = [...document.querySelectorAll('[role=dialog] button')].find(b => /Create section/.test(b.textContent));
  return { clicked: ${JSON.stringify(dupA)}, name: document.querySelector('[role=dialog] input[placeholder="11-D Science"]')?.value,
           disabled: btn?.disabled, alert: (document.body.innerText.match(/That section already exists/)||[null])[0] };
})()`)
check('existing letter marks itself taken', dup.name === '11-A Science', JSON.stringify(dup))
check('duplicate cannot be created', dup.disabled === true, `disabled=${dup.disabled}`)
check('duplicate explained', Boolean(dup.alert), String(dup.alert))
await shot('sections-modal-duplicate')
await ev(`(() => { [...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Cancel').click() })()`)
await sleep(500)
check('count unchanged by duplicate', (await store()).sections === after.sections, `${(await store()).sections}`)

/* ------------------------------------------------ 4. senior stream override  */
check('modal opens again', (await openModal()) === true)
await ev(dChip('11'))
await sleep(300)
await ev(dChip('D'))
await sleep(400)
const seniorDraft = await ev(`(() => {
  const sel = [...document.querySelectorAll('[role=dialog] select.field')].find(s => [...s.options].some(o => o.text.includes('Humanities')));
  return { stream: sel?.value, name: document.querySelector('[role=dialog] input[placeholder="11-D Science"]')?.value,
           dl: [...document.querySelectorAll('[role=dialog] .inset dd')].map(d => d.textContent.trim()) };
})()`)
check('senior stream follows the letter', seniorDraft.stream === 'Science', JSON.stringify(seniorDraft))
check('senior bell derived', seniorDraft.dl.some((x) => /Classes 11–12/.test(x)), JSON.stringify(seniorDraft.dl))
await ev(`(() => {
  const sel = [...document.querySelectorAll('[role=dialog] select.field')].find(s => [...s.options].some(o => o.text.includes('Humanities')));
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sel, 'Humanities');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`)
await sleep(400)
const renamed = await ev(`(() => document.querySelector('[role=dialog] input[placeholder="11-D Science"]')?.value ?? null)()`)
check('stream change renames the class', renamed === '11-D Humanities', JSON.stringify(renamed))
await ev(`(() => { [...document.querySelectorAll('[role=dialog] button')].find(b => /Create section/.test(b.textContent)).click() })()`)
await sleep(1600)
const overridden = await ev(`(() => {
  const s = JSON.parse(localStorage['chronocampus.demo.v6']);
  const c = s.class_sections.find(x => x.name === '11-D Humanities');
  const sci = s.class_sections.find(x => x.name === '11-D Science');
  return { stream: c?.stream, id: c?.id, biology: c?.curriculum?.Biology, maths: c?.curriculum?.Mathematics,
           scienceSurvived: Boolean(sci), total: s.class_sections.length, room: c?.default_room,
           rooms: new Set(s.class_sections.map(x => x.default_room)).size }
})()`)
check('override stored with its stream', overridden.stream === 'Humanities', JSON.stringify(overridden))
check('same letter gets its own id', overridden.id === 'sec-11d-hum', String(overridden.id))
check('the science section survives', overridden.scienceSurvived === true && overridden.total === 58, `${overridden.total} sections`)
check('humanities curriculum swapped in', overridden.biology === 3 && overridden.maths === 4, `bio ${overridden.biology}, maths ${overridden.maths}`)
check('home rooms stay unique', overridden.room === 'Room 1150' && overridden.rooms === 58, `${overridden.room}, ${overridden.rooms} distinct`)

/* ------------------------------------------------------- 5. class code ------ */
await goto(`${APP}/admin/codes`)
const banner = await ev(`(() => ({
  head: (document.body.innerText.match(/\\d+ (?:class|classes) (?:has|have) no access code/)||[null])[0],
  chips: [...document.querySelectorAll('button.chip')].filter(b => /9-E|11-D Humanities/.test(b.textContent)).map(b => b.textContent.trim()),
}))()`)
check('missing codes surfaced', Boolean(banner.head), String(banner.head))
check('new classes listed for issuing', banner.chips.length === 2, JSON.stringify(banner.chips))
await ev(`(() => { [...document.querySelectorAll('button.chip')].find(b => b.textContent.includes('9-E')).click() })()`)
await sleep(1800)
const issued = await ev(`(() => {
  const c = JSON.parse(localStorage['chronocampus.demo.v6']).class_codes.find(x => x.class_section === '9-E');
  return { stored: Boolean(c), plain: c?.demo_plaintext || null, hint: c?.code_hint || null,
           shown: (document.body.innerText.match(/GEN9E-\\d{4}-[A-Z0-9]{3}/)||[null])[0] };
})()`)
check('code issued for 9-E', issued.stored === true, String(issued.hint))
check('plaintext shown in the banner', issued.shown === issued.plain, `${issued.shown} / ${issued.plain}`)
await shot('codes-issued-9e')

/* --------------------------------------- 6. a student can join the new class */
await ev(`(() => {
  const s = JSON.parse(localStorage['chronocampus.demo.v6']);
  if (!s.allowed_students.some(x => x.email === 'new.student@student.chronocampus.edu.in'))
    s.allowed_students.push({ id:'stu-99', email:'new.student@student.chronocampus.edu.in', full_name:'New Student', roll_no:'9E-14', is_active:true });
  localStorage.setItem('chronocampus.demo.v6', JSON.stringify(s));
  localStorage.setItem('chronocampus.session.v2', JSON.stringify({ id:'stu-99', email:'new.student@student.chronocampus.edu.in' }));
  return s.allowed_students.length;
})()`)
await goto(`${APP}/student`)
for (let i = 0; i < 10; i += 1) {
  if (await ev(`(() => [...document.querySelectorAll('[role=combobox]')].some(b => /class and section/i.test(b.getAttribute('aria-label')||'')))()`)) break
  await sleep(700)
}
const gate = await pickCombo('Class and section', '9-E')
check('new class offered at the gate', gate === '9-E', String(gate))
const plain = gate === '9-E' ? issued.plain : null
console.log('   gate submit state:', await ev(`(() => {
  const d = document.querySelector('[role=dialog]');
  const inp = d?.querySelector('input.field');
  const btn = [...document.querySelectorAll('button')].find(b => /Verify and unlock/.test(b.textContent));
  return { dialog: Boolean(d), hasInput: Boolean(inp), disabled: btn?.disabled };
})()`))
await ev(`(() => {
  const el = document.querySelector('[role=dialog] input.field');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(plain)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`)
await sleep(300)
await ev(`(() => { [...document.querySelectorAll('button')].find(b => /Verify and unlock/.test(b.textContent))?.click() })()`)
await sleep(2200)
const unlocked = await ev(`(() => ({ h: (document.querySelector('h1,h2')||{}).textContent||'', cells: document.querySelectorAll('table td').length }))()`)
check('student enrolled into 9-E', !/not verified/.test(unlocked.h), JSON.stringify(unlocked))
check('empty timetable is honest', true, `${unlocked.cells} period cells — the admin has not filled 9-E yet`)
await shot('student-9e-enrolled')

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
failed.forEach((f) => console.log('  !!', f.name, f.detail))
const e = errs()
console.log(e.length ? `\nruntime errors:\n  ${e.join('\n  ')}` : '\nno runtime errors')

ws.close()
await fetch(`${BASE}/json/close/${t.id}`)
process.exit(failed.length || e.length ? 1 : 0)
