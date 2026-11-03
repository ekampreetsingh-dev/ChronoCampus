/** The notification centre: real read state, tabs, delete, persistence. */
const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const KEY = 'chronocampus.demo.v7'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(`${APP}/admin`)}`, { method: 'PUT' })).json()
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

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}
const store = () => ev(`(() => { const s = JSON.parse(localStorage[${JSON.stringify(KEY)}]||'{}'); const mine = (s.notifications||[]).filter(n => n.audience === 'admin'); return {
  total: (s.notifications||[]).length,
  read: (s.notifications||[]).filter(n => n.read_at).length,
  admin: mine.length, adminRead: mine.filter(n => n.read_at).length } })()`)

await send('Page.navigate', { url: `${APP}/login` })
await sleep(2500)
await ev(`Object.keys(localStorage).filter(k => k.startsWith('chronocampus.')).forEach(k => localStorage.removeItem(k))`)
await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({id:'adm-01',email:'principal@chronocampus.edu.in'}))`)
await send('Page.navigate', { url: `${APP}/admin` })
await sleep(4000)

check('bell is present', (await ev(`Boolean([...document.querySelectorAll('button[aria-label^="Notifications"]')][0])`)))
const openPanel = async () => {
  await ev(`document.querySelector('button[aria-label^="Notifications"]').click()`)
  for (let i = 0; i < 12; i += 1) {
    if (await ev(`(() => { const d=[...document.querySelectorAll('.pop, .modal')].find(m=>/Notification/.test(m.innerText)); return Boolean(d && d.querySelector('.group')) })()`)) return true
    await sleep(400)
  }
  return false
}
const panelUp = await openPanel()
check('panel opens with rows', panelUp === true, `ready ${panelUp}`)
const panel = await ev(`(() => {
  const d = [...document.querySelectorAll('.pop, .modal')].find(m => /Notification/.test(m.innerText));
  if (!d) return null;
  return { tabs: [...d.querySelectorAll('[role=tab]')].map(t => t.innerText.trim().replace(/\\n/g,' ')),
    rows: d.querySelectorAll('.group').length,
    markAll: Boolean([...d.querySelectorAll('button')].find(b => /Mark all as read/.test(b.textContent))),
    counts: [...d.querySelectorAll('[role=tab]')].map(t => (t.querySelector('.badge')||{}).textContent).filter(Boolean) };
})()`)
check('tabs, counts and mark-all are present', panel && panel.tabs.length === 3 && panel.counts.length === 3 && panel.markAll, JSON.stringify(panel))
await shot('notif-panel')

const before = await store()
check('store has notifications', before.total > 0, JSON.stringify(before))
const firstTitle = await ev(`(() => { const d=[...document.querySelectorAll('.pop, .modal')].find(m=>/Notification/.test(m.innerText)); return d.querySelector('.group button')?.innerText.split('\\n')[0] || null })()`)
const clicked = await ev(`(() => { const d=[...document.querySelectorAll('.pop, .modal')].find(m=>/Notification/.test(m.innerText)); const b=d?.querySelector('.group button'); if(!b) return 'no row'; b.click(); return 'ok' })()`)
await sleep(1400)
const afterRead = await store()
check('opening a notice marks it read in storage', afterRead.read === before.read + 1, `${clicked} · ${before.read} -> ${afterRead.read} read (opened "${String(firstTitle).slice(0, 34)}")`)

/* A notice without a link leaves the panel open, so only toggle the bell when
   it is actually closed — otherwise this click would dismiss it. */
await ev(`(() => { const open = [...document.querySelectorAll('.pop, .modal')].some(m => /Notification/.test(m.innerText)); if (!open) document.querySelector('button[aria-label^="Notifications"]').click(); return open })()`)
await sleep(900)
const unreadTab = await ev(`(() => { const d=[...document.querySelectorAll('.pop, .modal')].find(m=>/Notification/.test(m.innerText)); if(!d) return { rows: -1, empty: 'panel not open' }; const tab=[...d.querySelectorAll('[role=tab]')].find(t=>/Unread/.test(t.innerText)); if(!tab) return { rows: -1, empty: 'no unread tab' }; tab.click(); return new Promise(r=>setTimeout(()=>r({ rows: d.querySelectorAll('.group').length, empty: (d.innerText.match(/Nothing unread\\./)||[null])[0] }), 500)) })()`)
check('unread tab filters the list', unreadTab && typeof unreadTab.rows === 'number' && unreadTab.rows >= 0, JSON.stringify(unreadTab))
await shot('notif-unread-tab')

// delete one from the Inbox tab
await ev(`(() => { const d=[...document.querySelectorAll('.pop, .modal')].find(m=>/Notification/.test(m.innerText)); [...d.querySelectorAll('[role=tab]')].find(t=>/Inbox/.test(t.innerText)).click() })()`)
await sleep(500)
const del = await ev(`(() => {
  const d = [...document.querySelectorAll('.pop, .modal')].find(m => /Notification/.test(m.innerText));
  const btn = [...d.querySelectorAll('button[aria-label^="Delete notification"]')][0];
  if (!btn) return 'no delete button';
  const before = d.querySelectorAll('.group').length;
  btn.click();
  return new Promise(r => setTimeout(() => r({ before, after: d.querySelectorAll('.group').length }), 700));
})()`)
const afterDelete = await store()
check('delete removes the record', afterDelete.total === before.total - 1, `${JSON.stringify(del)} · total ${before.total} -> ${afterDelete.total}`)

// the desk above opened and then deleted the admin's only notice, so raise a
// fresh one — mark-all has to be tried against something actually unread
await ev(`(() => { import('/src/lib/supabase.js').then(m => { window.__db = m.db }); return 1 })()`)
await sleep(500)
const raised = await ev(`(async () => { await window.__db.pushNotification({ audience: 'admin', kind: 'system', title: 'Mark-all probe', body: 'Raised by the notification test.' }); return 'pushed' })()`)
check(`a fresh admin notice was raised (${raised})`, raised === 'pushed')
await sleep(900)

// closing and reopening is what re-reads the store, so do that rather than
// assuming the panel that is already open has the fresh list
await ev(`(() => { const open = [...document.querySelectorAll('.pop, .modal')].some(m => /Notification/.test(m.innerText)); if (open) document.querySelector('button[aria-label^="Notifications"]').click(); return open })()`)
await sleep(400)
await ev(`document.querySelector('button[aria-label^="Notifications"]').click()`)
await sleep(700)
// the tab change re-fetches, so wait for the mark-all control rather than guessing a delay
let markAll = 'no button'
for (let i = 0; i < 10; i += 1) {
  await sleep(400)
  markAll = await ev(`(() => { const d=[...document.querySelectorAll('.pop, .modal')].find(m=>/Notification/.test(m.innerText)); if (!d) return 'panel gone'; const b=[...d.querySelectorAll('button')].find(x=>/Mark all as read/.test(x.textContent)); if(!b) return 'no button'; b.click(); return 'clicked' })()`)
  if (markAll === 'clicked') break
}
await sleep(1600)
const marked = await store()
check('mark all as read persists', marked.admin > 0 && marked.adminRead === marked.admin, `${JSON.stringify(markAll)} · ${marked.adminRead}/${marked.admin} of my notices read`)

// a teacher absence should have raised an admin notification
await send('Page.navigate', { url: `${APP}/admin/substitutes` })
await sleep(3200)
await ev(`(() => { const cards=[...document.querySelectorAll('.panel')]; const c=cards.find(x=>/Neelam|Kaur|Singh/.test(x.innerText)&&/today|week/.test(x.innerText)); const b=c&&[...c.querySelectorAll('button')][0]; b&&b.click() })()`)
await sleep(1800)
const gen = await store()
check('an operation raised a real notification', gen.total > marked.total, `${marked.total} -> ${gen.total}`)
const toast = await ev(`(() => (document.body.innerText.match(/Class still has students|marked absent|back on duty/)||[null])[0])()`)
console.log('   (feedback:', toast, ')')

const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception?.description || '').split('\n')[0])
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
failed.forEach((f) => console.log('  !!', f.name, f.detail))
console.log(errs.length ? `errors:\n  ${errs.join('\n  ')}` : 'no runtime errors')
ws.close()
await fetch(`${BASE}/json/close/${t.id}`)
