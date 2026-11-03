/**
 * Puts the demo school back to its seed.
 *   node scripts/reset-demo.mjs            clears every chronocampus key
 *   node scripts/reset-demo.mjs keep-theme  leaves theme and motion alone
 */
import fs from 'fs'
import path from 'path'

const KEEP = process.argv.includes('keep-theme')
const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const OUT = path.resolve('shots')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(`${APP}/login`)}`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id) }
})
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value

await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 657, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${APP}/login` })
await sleep(2500)

console.log('removed:', await ev(`(() => {
  const keep = ${JSON.stringify(KEEP ? ['chronocampus.theme', 'chronocampus.motion'] : [])};
  const gone = Object.keys(localStorage).filter(k => k.startsWith('chronocampus.') && !keep.includes(k));
  gone.forEach(k => localStorage.removeItem(k));
  return gone;
})()`))

await send('Page.navigate', { url: `${APP}/login` })
await sleep(4500)
console.log('reseeded:', await ev(`(() => {
  const key = Object.keys(localStorage).find(k => /^chronocampus\\.demo\\.v\\d+$/.test(k));
  const s = JSON.parse(localStorage[key] || '{}');
  return { key, sections: (s.class_sections||[]).length, teachers: (s.teachers||[]).length, slots: (s.timetable_slots||[]).length, codes: (s.class_codes||[]).length };
})()`))

const { data } = await send('Page.captureScreenshot', { format: 'png' })
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'reset-demo-login.png'), Buffer.from(data, 'base64'))

ws.close()
await fetch(`${BASE}/json/close/${t.id}`)
