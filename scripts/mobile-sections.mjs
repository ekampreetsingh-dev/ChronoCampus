/**
 * 390x780 pass over the screens that the 48-section seed changes the most:
 * the grouped class list, its filter bar, and the add-a-section modal.
 */
import fs from 'fs'
import path from 'path'

const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const OUT = path.resolve('shots')
const VP = { width: 390, height: 780 }
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

await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { ...VP, deviceScaleFactor: 1, mobile: true })
const shot = async (n) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `${n}.png`), Buffer.from(data, 'base64')) }
const goto = async (url) => { events = []; await send('Page.navigate', { url }); await sleep(3200) }
const fit = () => ev(`(() => {
  const de = document.documentElement;
  const wide = [...document.querySelectorAll('body *')]
    .filter(e => e.getBoundingClientRect().right > ${VP.width} + 1)
    .slice(0, 4)
    .map(e => (e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().right));
  return { scrollW: de.scrollWidth, over: de.scrollWidth > ${VP.width} + 1, offenders: wide };
})()`)

await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({id:'adm-01',email:'principal@chronocampus.edu.in'}))`)

await goto(`${APP}/admin/sections`)
console.log('sections list  ->', JSON.stringify(await fit()))
await shot('m-sections-list')

await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='New section'); b&&b.click() })()`)
await sleep(900)
console.log('add modal      ->', JSON.stringify(await fit()))
const modal = await ev(`(() => {
  const d = document.querySelector('[role=dialog]');
  const r = d.getBoundingClientRect();
  const chips = [...d.querySelectorAll('button.chip')].map(b => Math.round(b.getBoundingClientRect().width));
  return { w: Math.round(r.width), x: Math.round(r.x), minChip: Math.min(...chips), btn: [...d.querySelectorAll('button')].some(b=>/Create section/.test(b.textContent)) };
})()`)
console.log('               ', JSON.stringify(modal))
await shot('m-sections-modal')

// pick class 12 section E through the free-text field, the narrowest case
await ev(`(() => { const d=document.querySelector('[role=dialog]'); [...d.querySelectorAll('button.chip')].find(b=>b.textContent.trim()==='12').click() })()`)
await sleep(400)
await ev(`(() => { const el=document.querySelector('[role=dialog] [aria-label="Section letter"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'E'); el.dispatchEvent(new Event('input',{bubbles:true})) })()`)
await sleep(500)
console.log('after picking  ->', JSON.stringify(await fit()))
const filled = await ev(`(() => {
  const d = document.querySelector('[role=dialog]');
  const name = [...d.querySelectorAll('input')].find(i => /^\\d+-[A-Z]/.test(i.value));
  return { name: name?.value ?? null, roomField: Boolean(name?.placeholder), dl: [...d.querySelectorAll('.inset dd')].map(x => x.textContent.trim()) };
})()`)
console.log('               ', JSON.stringify(filled))
await shot('m-sections-modal-filled')

await ev(`(() => { [...document.querySelectorAll('[role=dialog] button')].find(b=>/Create section/.test(b.textContent)).click() })()`)
await sleep(1800)
console.log('12-E created   ->', JSON.stringify(await fit()), await ev(`(() => { const s=JSON.parse(localStorage['chronocampus.demo.v6']); const c=s.class_sections.find(x=>x.name==='12-E Science'); return c && { room: c.default_room, bell: c.bell_schedule_id, band: c.band } })()`))
await shot('m-sections-after-create')

await goto(`${APP}/admin/codes`)
console.log('codes page     ->', JSON.stringify(await fit()))
await shot('m-codes')

const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception?.description || '').split('\n')[0])
console.log(errs.length ? `\nerrors:\n  ${errs.join('\n  ')}` : '\nno runtime errors')

ws.close()
await fetch(`${BASE}/json/close/${t.id}`)
