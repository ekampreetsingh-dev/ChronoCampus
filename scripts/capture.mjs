const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
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
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 657, deviceScaleFactor: 1, mobile: false })
await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({id:'adm-01',email:'principal@chronocampus.edu.in'}))`)

const go = async (path, name, wait = 3200) => {
  events = []
  await send('Page.navigate', { url: APP + path })
  await sleep(wait)
  const info = await ev(`(() => { const de=document.documentElement; return { h: (document.querySelector('h1,h2')||{}).textContent||null, scrollW: de.scrollWidth, overflow: de.scrollWidth > 1368, cells: document.querySelectorAll('td').length, btns: document.querySelectorAll('button').length, err: null } })()`)
  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception?.description || '').split('\n')[0])
  console.log(path.padEnd(18), JSON.stringify(info), errs.length ? 'ERRORS: ' + errs.join(' | ') : '')
  await shot(name)
}

await go('/admin/workload', 'page-analytics')
await go('/admin/timetable', 'board-cells')
await go('/admin/subjects', 'page-subjects')
await go('/admin/calendar', 'page-calendar')
await go('/admin/activity', 'page-activity')

// global palette
await send('Page.navigate', { url: APP + '/admin' })
await sleep(3000)
console.log('trigger present:', await ev(`Boolean(document.querySelector('[aria-keyshortcuts*="K"]'))`))
await ev(`(() => { const b=document.querySelector('[aria-keyshortcuts*="K"]'); b&&b.click() })()`)
await sleep(900)
console.log('palette:', await ev(`(() => { const d=[...document.querySelectorAll('[role=dialog]')].find(x=>/Search/.test(x.innerText)); return d ? { options: d.querySelectorAll('[role=option]').length, groups: [...d.querySelectorAll('.label')].map(l=>l.textContent.trim()).slice(0,8), text: d.innerText.slice(0,120).replace(/\\n+/g,' | ') } : 'not open' })()`))
await shot('palette-open')
await ev(`(() => { const i=document.querySelector('[role=dialog] input'); if(!i) return; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'neelam'); i.dispatchEvent(new Event('input',{bubbles:true})) })()`)
await sleep(800)
console.log('after query:', await ev(`(() => { const d=[...document.querySelectorAll('[role=dialog]')].pop(); return { options: d.querySelectorAll('[role=option]').length, first: d.querySelector('[role=option]')?.innerText.replace(/\\n/g,' · ') } })()`))
await shot('palette-query')
await ev(`(() => { const o=document.querySelector('[role=dialog] [role=option]'); o&&o.click() })()`)
await sleep(2000)
console.log('navigated to:', await ev(`location.pathname`))
ws.close()
await fetch(`${BASE}/json/close/${t.id}`)
