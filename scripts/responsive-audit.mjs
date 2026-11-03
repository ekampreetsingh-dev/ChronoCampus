/**
 * Responsive audit: page-level overflow at six widths, across the routes that
 * hold tables, boards and dialogs. A wide table inside its own scroller is fine;
 * a wide page is not.
 */
const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const WIDTHS = [
  { w: 360, h: 740, name: 'phone' },
  { w: 390, h: 844, name: 'phone-lg' },
  { w: 768, h: 1024, name: 'tablet' },
  { w: 1024, h: 768, name: 'laptop-sm' },
  { w: 1366, h: 657, name: 'laptop' },
  { w: 1920, h: 1080, name: 'desktop' },
]
const ROUTES = [
  ['login', '/login', null],
  ['admin', '/admin', 'admin'],
  ['timetable', '/admin/timetable', 'admin'],
  ['substitutes', '/admin/substitutes', 'admin'],
  ['workload', '/admin/workload', 'admin'],
  ['sections', '/admin/sections', 'admin'],
  ['subjects', '/admin/subjects', 'admin'],
  ['calendar', '/admin/calendar', 'admin'],
  ['activity', '/admin/activity', 'admin'],
  ['codes', '/admin/codes', 'admin'],
  ['teachers', '/admin/teachers', 'admin'],
  ['settings', '/admin/settings', 'admin'],
  ['teacher', '/teacher', 'teacher'],
  ['teacher-timetable', '/teacher/timetable', 'teacher'],
  ['teacher-groups', '/teacher/groups', 'teacher'],
  ['teacher-group-one', '/teacher/groups/grp-11a', 'teacher'],
  ['admin-groups', '/admin/groups', 'admin'],
  ['admin-group-one', '/admin/groups/grp-11a', 'admin'],
  ['student', '/student', 'student'],
  ['student-timetable', '/student/timetable', 'student'],
]
const SESSIONS = {
  admin: { id: 'adm-01', email: 'principal@chronocampus.edu.in' },
  teacher: { id: 'tch-01', email: 'neelam.kaur@chronocampus.edu.in' },
  student: { id: 'stu-01', email: 'gurpreet.sandhu@student.chronocampus.edu.in' },
}

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

await send('Page.enable'); await send('Runtime.enable')
const problems = []

for (const vp of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w < 768 })
  for (const [name, path, role] of ROUTES) {
    /* Re-seed per route: an earlier sweep can leave the demo store in a state that
       denies authorization, which would measure the wrong screen. */
    await send('Page.navigate', { url: APP + '/login' })
    await sleep(900)
    await ev(`(() => { try { localStorage.removeItem('chronocampus.demo.v7') } catch (e) {} return 1 })()`)
    if (role) await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify(${JSON.stringify(SESSIONS[role])}))`)
    else await ev(`localStorage.removeItem('chronocampus.session.v2')`)
    events = []
    await send('Page.navigate', { url: APP + path })
    // The demo school is a few megabytes of localStorage, so first paint is not
    // instant. Wait for content instead of guessing a sleep length, then measure.
    // /login has no shell, so only the signed-in routes wait for a nav control.
    const budget = vp.w >= 1024 ? 2200 : 2600
    const navSel = vp.w < 1024 ? 'button[aria-label="Open menu"]' : 'aside nav'
    const readyExpr = role
      ? `document.body.innerText.trim().length > 40 && Boolean(document.querySelector('${navSel}'))`
      : `document.body.innerText.trim().length > 40`
    let waited = 0
    let ready = false
    while (waited < 12000 && !ready) {
      await sleep(400)
      waited += 400
      ready = await ev(readyExpr)
    }
    if (waited < budget) await sleep(budget - waited)
    const r = await ev(`(() => {
      const de = document.documentElement;
      const over = de.scrollWidth > ${vp.w} + 1;
      const wide = over
        ? [...document.querySelectorAll('body *')]
            .filter(e => e.getBoundingClientRect().width > ${vp.w} + 1)
            .slice(0, 3)
            .map(e => (e.className ? String(e.className).slice(0, 44) : e.tagName) + '=' + Math.round(e.getBoundingClientRect().width))
        : [];
      const nav = ${role ? `Boolean(document.querySelector('${navSel}'))` : 'true'};
      const empty = document.body.innerText.trim().length < 40;
      return { over, wide, nav, empty, ms: ${waited}, h: (document.querySelector('h1,h2')||{}).textContent?.slice(0, 34) || null };
    })()`)
    const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception?.description || '').split('\n')[0])
    const bad = r.over || r.empty || !r.nav || errs.length
    if (bad) problems.push({ vp: vp.name, route: name, ...r, errs })
    console.log(`${vp.name.padEnd(10)} ${name.padEnd(18)} ${r.over ? 'OVERFLOW ' : '          '}${r.empty ? 'EMPTY ' : '      '}${r.nav ? '' : 'NO-NAV '}${errs.length ? 'ERR ' : '   '} ${String(r.ms).padStart(5)}ms  ${r.h || ''}`)
  }
}

console.log(`\n${WIDTHS.length * ROUTES.length} checks, ${problems.length} problems`)
problems.forEach((x) => console.log(`  !! ${x.vp} ${x.route} ${JSON.stringify({ wide: x.wide, nav: x.nav, empty: x.empty, errs: x.errs })}`))
ws.close()
await fetch(`${BASE}/json/close/${t.id}`)
process.exit(problems.length ? 1 : 0)
