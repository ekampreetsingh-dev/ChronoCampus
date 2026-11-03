import fs from 'fs'

const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(`${APP}/admin`)}`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))

let id = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id).resolve(m.result)
    pending.delete(m.id)
  }
})
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id
    pending.set(i, { resolve })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const evalJS = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 657, deviceScaleFactor: 1, mobile: false })
await send('Runtime.evaluate', {
  expression: `localStorage.setItem('chronocampus.session.v1', JSON.stringify({id:'adm-01',email:'principal@chronocampus.edu.in'}))`,
})
await send('Page.navigate', { url: `${APP}/admin` })
await sleep(2600)

// open the workload tab and the print preview
await evalJS(`[...document.querySelectorAll('button.tab')].find(b=>b.textContent.includes('Workload & Print'))?.click()`)
await sleep(1400)
await evalJS(`[...document.querySelectorAll('button')].find(b=>/Print view/.test(b.textContent))?.click()`)
await sleep(1400)

const onScreen = await evalJS(
  `(() => { const s=document.querySelector('.print-sheet'); const cs=getComputedStyle(s);
     return { sheets: document.querySelectorAll('.print-sheet').length, bg: cs.backgroundColor, color: cs.color,
              rows: s.querySelectorAll('tbody tr').length, cols: s.querySelectorAll('thead th').length,
              printRoot: !!document.getElementById('print-root') }; })()`,
)
console.log('screen preview:', JSON.stringify(onScreen))

const png = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(`shots/${name}.png`, Buffer.from(data, 'base64'))
}
await png('20-print-preview-screen')

// now emulate the printer
await send('Emulation.setEmulatedMedia', { media: 'print' })
await sleep(700)
const printed = await evalJS(
  `(() => {
    const root = document.getElementById('root');
    const pr = document.getElementById('print-root');
    const sheet = pr?.querySelector('.print-sheet');
    const cs = sheet ? getComputedStyle(sheet) : null;
    return {
      rootDisplay: getComputedStyle(root).display,
      printRootDisplay: pr ? getComputedStyle(pr).display : 'missing',
      sheetBg: cs?.backgroundColor, sheetColor: cs?.color,
      navVisible: getComputedStyle(document.querySelector('.glass-nav') || document.body).display,
      textSample: pr?.innerText?.replace(/\\s+/g,' ').slice(0, 130),
    };
  })()`,
)
console.log('print emulation:', JSON.stringify(printed, null, 1))
await png('21-print-emulated')

const pdf = await send('Page.printToPDF', { landscape: true, printBackground: false, paperWidth: 11.69, paperHeight: 8.27 })
fs.writeFileSync('shots/notice-board.pdf', Buffer.from(pdf.data, 'base64'))
console.log('pdf bytes:', fs.statSync('shots/notice-board.pdf').size)

await send('Emulation.setEmulatedMedia', { media: '' })
await send('Target.closeTarget', { targetId: t.id })
process.exit(0)
