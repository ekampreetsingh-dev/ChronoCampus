/** At 390px: does the searchable picker's panel stay inside the viewport? */
const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const VP = { width: 390, height: 780 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(`${APP}/login`)}`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const p = new Map()
let events = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && p.has(m.id)) { p.get(m.id).resolve(m.result); p.delete(m.id) }
  else if (m.method) events.push(m)
})
const send = (method, params = {}) => new Promise((res) => { const i = ++id; p.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value
import fs from 'fs'
const shot = async (n) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`shots/${n}.png`, Buffer.from(data, 'base64')) }
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { ...VP, deviceScaleFactor: 1, mobile: true })
const goto = async (u) => { events = []; await send('Page.navigate', { url: u }); await sleep(4500) }

const probe = () => ev(`(() => {
  const panel = document.querySelector('[role=listbox]');
  const de = document.documentElement;
  if (!panel) return { panel: false, scrollW: de.scrollWidth };
  const r = panel.getBoundingClientRect();
  return { panel: true, left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom),
    fits: r.left >= 0 && r.right <= ${VP.width} && r.bottom <= ${VP.height},
    pageOverflow: de.scrollWidth > ${VP.width} };
})()`)

await send('Page.navigate', { url: `${APP}/login` })
await sleep(2500)
await ev(`Object.keys(localStorage).filter(k => k.startsWith('chronocampus.')).forEach(k => localStorage.removeItem(k))`)
await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({id:'adm-01',email:'principal@chronocampus.edu.in'}))`)

await goto(`${APP}/admin/timetable`)
console.log('class picker  ->', JSON.stringify(await ev(`(() => { document.querySelectorAll('[role=combobox]')[0].click(); return 'open' })()`)))
await sleep(500)
console.log('              ', JSON.stringify(await probe()))
await shot('m-picker-class')

await goto(`${APP}/admin/substitutes`)
const has = await ev(`(() => { const b=[...document.querySelectorAll('[role=combobox]')]; return b.length })()`)
console.log('substitute    -> comboboxes:', has)
if (has) {
  await ev(`(() => { const b=[...document.querySelectorAll('[role=combobox]')]; b[b.length-1].click() })()`)
  await sleep(500)
  console.log('              ', JSON.stringify(await probe()))
  await shot('m-picker-substitute')
}

await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({id:'stu-01',email:'gurpreet.sandhu@student.chronocampus.edu.in'}))`)
await goto(`${APP}/student`)
let gateOpen = 'none'
for (let i = 0; i < 12; i += 1) {
  gateOpen = await ev(`(() => { const b=[...document.querySelectorAll('[role=combobox]')].find(x=>/class and section/i.test(x.getAttribute('aria-label')||'')); if(!b) return 'none'; b.click(); return 'open' })()`)
  if (gateOpen === 'open') break
  await sleep(700)
}
await sleep(700)
console.log('student gate  ->', gateOpen, JSON.stringify(await probe()))
await shot('m-picker-gate')

const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception?.description || '').split('\n')[0])
console.log(errs.length ? `errors: ${errs.join(' | ')}` : 'no runtime errors')
ws.close()
await fetch(`${BASE}/json/close/${t.id}`)
