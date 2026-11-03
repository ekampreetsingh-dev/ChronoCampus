import fs from 'fs'

const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const sleep = (m) => new Promise((r) => setTimeout(r, m))
const KEY = 'chronocampus.demo.v6'

const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(APP + '/admin/schedules')}`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
const errs = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || '').split('\n')[0])
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console: ' + m.params.args.map((a) => a.description || a.value).join(' ').slice(0, 160))
})
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: `(${expr})`, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails) return { __err: (r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 160) }
  return r?.result?.value
}
const shot = async (n) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`shots/${n}.png`, Buffer.from(data, 'base64')) }

await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 657, deviceScaleFactor: 1, mobile: false })
await ev(`localStorage.clear()`)
await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({id:'adm-01',email:'principal@chronocampus.edu.in'}))`)
await send('Page.navigate', { url: APP + '/admin/schedules' })
await sleep(3000)

const dump = () => ev(`(JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})||'{}').bell_schedules||[]).map(s=>({id:s.id,name:s.name,season:s.season,active:s.is_active,status:s.status,p1:s.periods[1]&&s.periods[1].start}))`)

console.log('before:', JSON.stringify(await dump()))

// 1. EDIT — change the selected (senior) schedule's P1 start, then save
await ev(`(()=>{
  const ins = document.querySelectorAll('input[type=time]');
  const t = ins[2];                       // period index 1, start time
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(t,'09:05');
  t.dispatchEvent(new Event('input',{bubbles:true})); t.dispatchEvent(new Event('change',{bubbles:true}));
  return t.value })()`)
await sleep(400)
const saveState = await ev(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>/Save timings/.test(x.textContent));return {found:!!b, disabled:b&&b.disabled}})()`)
console.log('save button:', JSON.stringify(saveState))
await ev(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>/Save timings/.test(x.textContent));b&&b.click()})()`)
await sleep(1800)
console.log('after edit :', JSON.stringify(await dump()))

// 2. CLONE for winter
await ev(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>/Duplicate for another season/.test(x.textContent));b&&b.click()})()`)
await sleep(900)
const dialog = await ev(`(()=>{const d=document.querySelector('[role=dialog]');return d?{inputs:d.querySelectorAll('input').length, selects:d.querySelectorAll('select').length, btn:!!Array.from(d.querySelectorAll('button')).find(x=>/Create draft copy/.test(x.textContent))}:'no dialog'})()`)
console.log('clone dialog:', JSON.stringify(dialog))
await ev(`(()=>{
  const d=document.querySelector('[role=dialog]');
  const set=(el,v)=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el.constructor).prototype===Object.prototype?HTMLInputElement.prototype:(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype),'value')};
  const name=d.querySelector('input:not([type=date]):not([type=time])');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(name,'Classes 11–12 · Winter');
  name.dispatchEvent(new Event('input',{bubbles:true}));
  const dt=d.querySelector('input[type=date]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(dt,'2026-11-01');
  dt.dispatchEvent(new Event('input',{bubbles:true})); dt.dispatchEvent(new Event('change',{bubbles:true}));
  return {name:name.value, date:dt.value}})()`)
await sleep(500)
await ev(`(()=>{const b=Array.from(document.querySelectorAll('[role=dialog] button')).find(x=>/Create draft copy/.test(x.textContent));b&&b.click()})()`)
await sleep(2000)
console.log('after clone:', JSON.stringify(await dump()))

// 3. ACTIVATE the winter draft
await ev(`(()=>{const c=Array.from(document.querySelectorAll('button')).find(b=>/Winter/.test(b.textContent)&&b.className.includes('panel'));c&&c.click()})()`)
await sleep(900)
const actBtn = await ev(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='Activate');return b?{found:true,disabled:b.disabled}:'no activate button'})()`)
console.log('activate btn:', JSON.stringify(actBtn))
await ev(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='Activate');b&&b.click()})()`)
await sleep(900)
await ev(`(()=>{const b=Array.from(document.querySelectorAll('[role=dialog] button')).find(x=>/Activate timings/.test(x.textContent));b&&b.click()})()`)
await sleep(2000)
console.log('after activate:', JSON.stringify(await dump()))
await shot('sched-final')

// 4. Does the board follow the switched schedule?
await send('Page.navigate', { url: APP + '/admin/timetable' })
await sleep(2600)
// the class picker is a searchable combobox now, not a select
await ev(`(() => { const b = document.querySelector('[aria-label="Class board"]'); if (b) b.click(); return Boolean(b) })()`)
await sleep(500)
await ev(`(() => { const i = document.querySelector('[role=listbox] input'); if (!i) return 'no input';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, '11-A');
  i.dispatchEvent(new Event('input', { bubbles: true })); return 'typed' })()`)
await sleep(500)
const switched = await ev(`(() => { const o = [...document.querySelectorAll('[role=listbox] [role=option]')].find(x => x.innerText.trim().startsWith('11-A')); if (!o) return 'no option'; o.click(); return o.innerText.split('\\n')[0].trim() })()`)
await sleep(1400)
console.log('senior board:', JSON.stringify(await ev(`({
  picked: ${JSON.stringify(switched)},
  rows: Array.from(document.querySelectorAll('table tbody th[scope=row]')).map(t=>t.innerText.replace(/\\n/g,' ')),
  count: document.querySelectorAll('table tbody th[scope=row]').length })`)))

console.log('errors:', errs.slice(0, 4).join(' || ') || 'none')
await send('Target.closeTarget', { targetId: t.id })
process.exit(0)
