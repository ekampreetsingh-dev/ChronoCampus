/**
 * Inventory of "choose one of many" controls: native selects, custom lists and
 * the scroll containers they live in. Reports what a user actually gets.
 */
const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(`${APP}/login`)}`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
let events = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id) }
  else if (m.method) events.push(m)
})
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value
import fs from 'fs'
const shot = async (n) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`shots/${n}.png`, Buffer.from(data, 'base64')) }

await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 657, deviceScaleFactor: 1, mobile: false })

const inventory = () => ev(`(() => {
  const out = [];
  for (const sel of document.querySelectorAll('select')) {
    const cs = getComputedStyle(sel);
    const label = sel.closest('label,div')?.querySelector('.label')?.textContent?.trim()
      || [...document.querySelectorAll('label')].find(l => l.contains(sel))?.textContent?.replace(sel.tagName,'')?.trim()
      || '(unlabelled)';
    out.push({ kind: 'select', label: label.slice(0, 34), options: sel.options.length,
      longest: Math.max(...[...sel.options].map(o => (o.textContent||'').length), 0),
      cursor: cs.cursor, size: cs.fontSize, disabled: sel.disabled });
  }
  for (const box of document.querySelectorAll('[class*=overflow-y]')) {
    const cs = getComputedStyle(box);
    out.push({ kind: 'scroll-list', items: box.children.length, clientH: box.clientHeight, scrollH: box.scrollHeight,
      maxHeight: cs.maxHeight, cursor: cs.cursor, overscroll: cs.overscrollBehaviorY });
  }
  return out;
})()`)

const routes = [
  ['admin/timetable', 'adm-01', 'principal@chronocampus.edu.in'],
  ['admin/substitutes', 'adm-01', 'principal@chronocampus.edu.in'],
  ['admin/sections', 'adm-01', 'principal@chronocampus.edu.in'],
  ['admin/students', 'adm-01', 'principal@chronocampus.edu.in'],
  ['admin/workload', 'adm-01', 'principal@chronocampus.edu.in'],
  ['admin/reports', 'adm-01', 'principal@chronocampus.edu.in'],
  ['teacher/timetable', 'tch-01', 'neelam.kaur@chronocampus.edu.in'],
]

await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({id:'adm-01',email:'principal@chronocampus.edu.in'}))`)

for (const [path, uid, email] of routes) {
  await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({id:'${uid}',email:'${email}'}))`)
  await send('Page.navigate', { url: `${APP}/${path}` })
  await sleep(2600)
  const inv = await inventory()
  console.log(`\n### /${path}`)
  for (const row of inv) console.log('   ', JSON.stringify(row))
}

/* the slot editor's teacher list, opened on a real cell */
await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({id:'adm-01',email:'principal@chronocampus.edu.in'}))`)
await send('Page.navigate', { url: `${APP}/admin/timetable` })
await sleep(2600)
await ev(`(() => { const cells=[...document.querySelectorAll('table tbody td button')]; const c=cells.find(x=>/Mathematics/.test(x.getAttribute('aria-label')||''))||cells[0]; c&&c.click() })()`)
for (let i = 0; i < 8; i += 1) { if (await ev(`Boolean(document.querySelector('[role=dialog]'))`)) break; await sleep(400) }

const shape = () => ev(`(() => {
  const d = document.querySelector('[role=dialog]');
  if (!d) return 'no dialog';
  const list = [...d.querySelectorAll('*')].find(e => getComputedStyle(e).overflowY === 'auto' && e.scrollHeight > e.clientHeight + 20);
  const rows = [...d.querySelectorAll('button')].filter(b => /free|in \\d+-/.test(b.textContent));
  const save = [...d.querySelectorAll('button')].find(x => /Save changes|Assign slot/.test(x.textContent));
  const foot = save?.closest('footer');
  return {
    teacherRows: rows.length,
    searchInputs: [...d.querySelectorAll('input')].map(i => i.placeholder).filter(Boolean),
    footerVisible: foot ? foot.getBoundingClientRect().bottom <= window.innerHeight + 1 : null,
    dialogBottom: Math.round(d.getBoundingClientRect().bottom),
    vh: window.innerHeight,
    summary: (d.innerText.match(/\\d+ of \\d+ staff listed[^\\n]*/)||[null])[0],
  };
})()`)
console.log('\n### slot editor (fresh)')
console.log(JSON.stringify(await shape(), null, 1))
await shot('picker-slot-editor')

console.log('change subject to English ->', await ev(`(() => {
  const d = document.querySelector('[role=dialog]');
  const sel = d.querySelector('select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sel, 'English');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`))
await sleep(700)
const english = await shape()
console.log('after subject change ->', JSON.stringify(english, null, 1))

await ev(`(() => {
  const d = document.querySelector('[role=dialog]');
  const inp = [...d.querySelectorAll('input')].find(i => /Search a teacher/i.test(i.placeholder||''));
  if (!inp) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inp, 'Sushil');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
})()`)
await sleep(600)
console.log('after searching "Sushil" ->', JSON.stringify(await shape(), null, 1))
await shot('picker-slot-editor-search')

// pick the searched teacher and confirm the choice registers
console.log('pick searched teacher ->', await ev(`(() => {
  const d = document.querySelector('[role=dialog]');
  const b = [...d.querySelectorAll('button')].filter(x => /free|in \\d+-/.test(x.textContent))[0];
  if (!b) return 'none';
  b.click();
  return b.textContent.trim().slice(0, 40);
})()`))
await sleep(500)
console.log('save state ->', await ev(`(() => { const b=[...document.querySelectorAll('[role=dialog] button')].find(x=>/Save changes|Assign slot/.test(x.textContent)); return { disabled: b?.disabled, footerVisible: b?.closest('footer')?.getBoundingClientRect().bottom <= window.innerHeight } })()`))

const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception?.description || '').split('\n')[0])
console.log(errs.length ? `\nerrors:\n  ${errs.join('\n  ')}` : '\nno runtime errors')


ws.close()
await fetch(`${BASE}/json/close/${t.id}`)
