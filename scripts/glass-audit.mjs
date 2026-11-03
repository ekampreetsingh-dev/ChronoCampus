import fs from 'fs'

const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const sleep = (m) => new Promise((r) => setTimeout(r, m))

const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(APP + '/admin')}`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
const errs = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || '').split('\n')[0])
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console: ' + m.params.args.map(a => a.description || a.value).join(' ').slice(0, 140))
})
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: `(${expr})`, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails) return { __err: (r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 140) }
  return r?.result?.value
}
const shot = async (n) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`shots/${n}.png`, Buffer.from(data, 'base64')) }

await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 657, deviceScaleFactor: 1, mobile: false })
await ev(`localStorage.clear()`)
await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({id:'adm-01',email:'principal@chronocampus.edu.in'}))`)
await send('Page.navigate', { url: APP + '/admin' }); await sleep(3200)

console.log('=== GLASS AUDIT (admin overview) ===')
console.log(JSON.stringify(await ev(`(function(){
  const g = (sel) => { const el = document.querySelector(sel); if(!el) return 'MISSING';
    const c = getComputedStyle(el);
    return { blur: c.backdropFilter || c.webkitBackdropFilter, bg: c.backgroundColor, border: c.borderColor, shadow: c.boxShadow.slice(0,34) } }
  return {
    sidebar:  g('aside.sidebar'),
    appbar:   g('header.appbar'),
    panel:    g('.panel'),
    orbs:     document.querySelectorAll('.orb').length,
    orbAnim:  getComputedStyle(document.querySelector('.orb')).animationName,
    cursor:   { dot: !!document.querySelector('.cursor-dot'), ring: !!document.querySelector('.cursor-ring'), hiddenNative: document.body.classList.contains('has-custom-cursor') },
    atmosphere: !!document.querySelector('.atmosphere')
  }
})()`), null, 1))

await send('Page.navigate', { url: APP + '/admin/timetable' }); await sleep(2800)
console.log('\n=== TIMETABLE (cells must NOT each blur) ===')
console.log(JSON.stringify(await ev(`(function(){
  const board = document.querySelector('.board');
  const cells = Array.from(document.querySelectorAll('.cell'));
  const blurred = cells.filter(c => (getComputedStyle(c).backdropFilter||'none') !== 'none').length;
  const bc = getComputedStyle(board);
  return {
    board: { blur: bc.backdropFilter, bg: bc.backgroundColor, radius: bc.borderRadius },
    cells: cells.length,
    cellsWithBackdropFilter: blurred,
    todayTinted: document.querySelectorAll('.cell-today').length,
    live: document.querySelectorAll('.cell-live').length,
    interludes: document.querySelectorAll('.interlude').length,
    overflow: document.documentElement.scrollWidth > 1368
  }
})()`), null, 1))
await shot('glass-timetable')

console.log('\n=== DROPDOWN / MODAL GLASS ===')
await ev(`(function(){var b=Array.from(document.querySelectorAll('header button')).find(x=>/Demo|Live/.test(x.textContent)); b&&b.click()})()`)
await sleep(700)
console.log('switcher panel:', JSON.stringify(await ev(`(function(){
  const p = Array.from(document.querySelectorAll('.modal')).find(m=>/Environment/.test(m.innerText));
  if(!p) return 'not found'; const c=getComputedStyle(p);
  return { blur:c.backdropFilter, bg:c.backgroundColor, border:c.borderColor } })()`)))
await ev(`document.body.click()`)
await sleep(400)

// modal + dialog glass
await ev(`(function(){var b=document.querySelector('.board td button'); b&&b.click()})()`)
await sleep(900)
console.log('slot dialog:', JSON.stringify(await ev(`(function(){
  const d=document.querySelector('[role=dialog]'); if(!d) return 'no dialog'; const c=getComputedStyle(d);
  return { blur:c.backdropFilter, bg:c.backgroundColor, shadow:c.boxShadow.slice(0,40), title:(d.querySelector('h3')||{}).textContent } })()`)))
await shot('glass-modal')
await ev(`(function(){var b=Array.from(document.querySelectorAll('[role=dialog] button')).find(x=>/Cancel/.test(x.textContent)); b&&b.click()})()`)

// contrast spot-check on glass
console.log('\n=== CONTRAST (text on glass) ===')
console.log(JSON.stringify(await ev(`(function(){
  const lum = (c) => { const m=c.match(/\\d+(\\.\\d+)?/g).map(Number); const f=m.slice(0,3).map(v=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});
    return 0.2126*f[0]+0.7152*f[1]+0.0722*f[2] }
  const ratio = (a,b) => { const l1=lum(a), l2=lum(b); return +(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2)) }
  const out = [];
  for (const el of document.querySelectorAll('.chip, .label, .eyebrow, h1, h2, td, .panel p')) {
    const c = getComputedStyle(el); if (c.display==='none' || !el.textContent.trim()) continue;
    const host = el.closest('.panel,.modal,.board,.appbar') || document.body;
    const hb = getComputedStyle(host).backgroundColor;
    if (!/rgba?\\(0, 0, 0, 0\\)|transparent/.test(hb) === false) continue;
    out.push({ t: el.textContent.trim().slice(0,18), r: ratio(c.color, 'rgb(238,242,232)') });
    if (out.length > 7) break
  }
  return out
})()`)))

// mobile: cursor must be off, orbs reduced
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true, hasTouch: true })
await send('Page.navigate', { url: APP + '/admin' }); await sleep(2800)
console.log('\n=== MOBILE 390 (touch) ===')
console.log(JSON.stringify(await ev(`({
  cursorMounted: !!document.querySelector('.cursor-dot'),
  nativeCursorHidden: document.body.classList.contains('has-custom-cursor'),
  visibleOrbs: Array.from(document.querySelectorAll('.orb')).filter(o=>getComputedStyle(o).display!=='none').length,
  pageOverflow: document.documentElement.scrollWidth > 392,
  sidebarHidden: getComputedStyle(document.querySelector('aside.sidebar')||document.body).display
})`), null, 1))
await shot('glass-mobile')

// reduced motion
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 657, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: APP + '/admin' }); await sleep(2600)
console.log('\n=== REDUCED MOTION ===')
console.log(JSON.stringify(await ev(`({
  orbAnimation: getComputedStyle(document.querySelector('.orb')).animationName,
  cursorMounted: !!document.querySelector('.cursor-dot'),
  glassStillApplied: getComputedStyle(document.querySelector('.panel')).backdropFilter
})`)))
await send('Emulation.setEmulatedMedia', { features: [] })

console.log('\nerrors:', errs.slice(0, 4).join(' || ') || 'none')
await send('Target.closeTarget', { targetId: t.id })
process.exit(0)
