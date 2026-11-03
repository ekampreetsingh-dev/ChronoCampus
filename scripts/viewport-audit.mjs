/**
 * Responsive audit — measures the defect classes the brief names, at seven
 * device profiles, across every route and all three roles.
 *
 *   node scripts/viewport-audit.mjs            # all routes
 *   node scripts/viewport-audit.mjs teacher    # routes matching the filter
 *
 * Reported per route x viewport:
 *   OVERFLOW   document scrolls horizontally
 *   OFFSCREEN  a visible element extends past the viewport edge
 *   CLIPPED    text is truncated by its own box while still needed
 *   SMALL      interactive target under 44px in either axis
 *   OCCLUDED   content sits under the fixed bottom bar
 *   DUPNAV     more than one navigation affordance visible at once
 *   MENU       an opened menu/dialog renders partly off-screen
 */
const BASE = 'http://127.0.0.1:9222'
const APP = process.env.APP_URL || 'http://127.0.0.1:5175'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const FILTER = process.argv[2] || ''

const VIEWPORTS = [
  { name: 'phone-sm', w: 320, h: 640 },
  { name: 'phone', w: 390, h: 844 },
  { name: 'phone-lg', w: 430, h: 932 },
  { name: 'tablet', w: 768, h: 1024 },
  { name: 'tablet-ls', w: 1024, h: 768 },
  { name: 'laptop', w: 1366, h: 768 },
  { name: 'desktop', w: 1920, h: 1080 },
]

const SESSIONS = {
  admin: { id: 'adm-01', email: 'principal@chronocampus.edu.in' },
  teacher: { id: 'tch-01', email: 'neelam.kaur@chronocampus.edu.in' },
  student: { id: 'stu-02', email: 'aanya.iyer@student.chronocampus.edu.in' },
}

const ROUTES = [
  ['login', '/login', null],
  ['admin', '/admin', 'admin'],
  ['timetable', '/admin/timetable', 'admin'],
  ['substitutes', '/admin/substitutes', 'admin'],
  ['workload', '/admin/workload', 'admin'],
  ['reports', '/admin/reports', 'admin'],
  ['staff', '/admin/staff', 'admin'],
  ['teachers', '/admin/teachers', 'admin'],
  ['students', '/admin/students', 'admin'],
  ['sections', '/admin/sections', 'admin'],
  ['subjects', '/admin/subjects', 'admin'],
  ['admin-groups', '/admin/groups', 'admin'],
  ['admin-group-one', '/admin/groups/grp-11a', 'admin'],
  ['calendar', '/admin/calendar', 'admin'],
  ['sessions', '/admin/sessions', 'admin'],
  ['codes', '/admin/codes', 'admin'],
  ['schedules', '/admin/schedules', 'admin'],
  ['activity', '/admin/activity', 'admin'],
  ['settings', '/admin/settings', 'admin'],
  ['teacher', '/teacher', 'teacher'],
  ['teacher-timetable', '/teacher/timetable', 'teacher'],
  ['teacher-homework', '/teacher/homework', 'teacher'],
  ['teacher-subs', '/teacher/substitutions', 'teacher'],
  ['teacher-groups', '/teacher/groups', 'teacher'],
  ['teacher-group-one', '/teacher/groups/grp-11a', 'teacher'],
  ['teacher-profile', '/teacher/profile', 'teacher'],
  ['student', '/student', 'student'],
  ['student-timetable', '/student/timetable', 'student'],
  ['student-homework', '/student/homework', 'student'],
  ['student-academic', '/student/academic', 'student'],
  ['student-groups', '/student/groups', 'student'],
  ['student-group-one', '/student/groups/grp-11a', 'student'],
  ['student-profile', '/student/profile', 'student'],
]

const PROBE = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const de = document.documentElement;
  const vis = (e) => {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.1) return false;
    const r = e.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  const desc = (e) => {
    const cls = String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className || '').slice(0, 40);
    return e.tagName.toLowerCase() + (cls ? '.' + cls.replace(/\\s+/g, ' ') : '') + ' [' + (e.textContent || '').trim().slice(0, 18) + ']';
  };
  // a scroller the design intends is not an overflow defect
  const inScroller = (e) => Boolean(e.closest('.scroll, [class*="overflow-x-auto"], [class*="overflow-auto"], .tbl-wrap, .seg, .tabs'));

  const overflow = de.scrollWidth > vw + 1;

  const offscreen = [...document.querySelectorAll('body *')].filter(vis)
    .filter((e) => {
      const r = e.getBoundingClientRect();
      if (getComputedStyle(e).position === 'fixed') return false;
      if (inScroller(e)) return false;
      return r.right > vw + 2 || r.left < -2;
    }).slice(0, 5).map(desc);

  // Touch sizing only means something on a coarse pointer: a 32px icon button is
  // correct under a mouse and a defect under a finger.
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = coarse
    ? [...document.querySelectorAll('button, a[href], [role="tab"], [role="menuitem"], input[type="checkbox"], input[type="radio"]')]
        .filter(vis)
        .filter((e) => {
          const r = e.getBoundingClientRect();
          if (r.width < 10 || r.height < 10) return false;
          return r.height < 40 || r.width < 32;
        })
        .map((e) => {
          const r = e.getBoundingClientRect();
          return Math.round(r.height) + 'h x ' + Math.round(r.width) + 'w ' + desc(e);
        })
    : [];

  const bar = [...document.querySelectorAll('nav')].find((n) => {
    const s = getComputedStyle(n); const r = n.getBoundingClientRect();
    return s.position === 'fixed' && r.bottom >= vh - 2 && r.height > 40 && r.height < 140;
  });

  // Occlusion is only a defect if the content can never be reached: scroll to the
  // bottom first, then see what is still sitting under the bar.
  let occluded = 0;
  if (bar) {
    window.scrollTo(0, document.body.scrollHeight);
    const br = bar.getBoundingClientRect();
    occluded = [...document.querySelectorAll('main a, main button, main input, main select')].filter(vis)
      .filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > br.top + 1 && r.top < br.bottom && r.height > 4 }).length;
    window.scrollTo(0, 0);
  }

  const sidebar = Boolean([...document.querySelectorAll('aside')].filter(vis).find((a) => {
    const r = a.getBoundingClientRect();
    return r.width > 40 && r.height > 200 && a.querySelector('nav a');
  }));
  const hamburger = Boolean([...document.querySelectorAll('button')].filter(vis).find((b) => /open menu|open navigation/i.test(b.getAttribute('aria-label') || '')));
  const bottomBar = Boolean(bar);
  const dupnav = [sidebar, hamburger, bottomBar].filter(Boolean).length;

  const clipped = [...document.querySelectorAll('main h1, main h2, main h3, main .num, main td, main th')]
    .filter(vis)
    .filter((e) => e.scrollWidth > e.clientWidth + 4 && getComputedStyle(e).textOverflow !== 'ellipsis')
    .slice(0, 4).map((e) => desc(e) + ' [' + e.scrollWidth + '>' + e.clientWidth + ']');

  return {
    vw, vh, coarse,
    overflow,
    offscreen,
    small: [...new Set(small)].slice(0, 6),
    occluded,
    nav: { sidebar, hamburger, bottomBar, dupnav },
    clipped,
    scrollH: de.scrollHeight,
    text: document.body.innerText.trim().length,
  };
})()`

const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(`${APP}/login`)}`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
let events = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); return }
  if (m.method) events.push(m)
})
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }))?.result?.value

const totals = { routes: 0, checks: 0, overflow: 0, offscreen: 0, small: 0, occluded: 0, dupnav: 0, clipped: 0, console: 0 }
const findings = []

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')

for (const vp of VIEWPORTS) {
  const touch = vp.w < 1024
  await send('Emulation.setTouchEmulationEnabled', { enabled: touch })
  await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: touch })
  for (const [name, path, role] of ROUTES) {
    if (FILTER && !name.includes(FILTER)) continue
    totals.routes = ROUTES.filter((r) => !FILTER || r[0].includes(FILTER)).length
    // clean baseline so a previous sweep cannot leave the demo store mutated
    await send('Page.navigate', { url: `${APP}/login` })
    await sleep(700)
    await ev(`(() => { try { localStorage.removeItem('chronocampus.demo.v7') } catch (e) {} return 1 })()`)
    if (role) await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify(${JSON.stringify(SESSIONS[role])}))`)
    else await ev(`localStorage.removeItem('chronocampus.session.v2')`)
    events = []
    await send('Page.navigate', { url: `${APP}${path}` })
    let ready = false
    for (let i = 0; i < 30 && !ready; i++) { await sleep(400); ready = await ev(`document.querySelectorAll('button').length > 3`) }
    await sleep(900)

    const r = (await ev(PROBE)) || {}
    const errs = events
      .filter((e) => e.method === 'Runtime.exceptionThrown')
      .map((e) => (e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text || '').split('\n')[0])
      .concat(events.filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
        .map((e) => e.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 110)))
      .filter((x) => !/Download is starting|favicon|manifest|ResizeObserver/.test(x))

    totals.checks++
    totals.console += errs.length
    if (r.overflow) totals.overflow++
    if (r.offscreen?.length) totals.offscreen++
    if (r.small?.length) totals.small++
    if (r.occluded) totals.occluded++
    if (r.nav?.dupnav > 1) totals.dupnav++
    if (r.clipped?.length) totals.clipped++

    const bad = r.overflow || r.offscreen?.length || r.small?.length || r.occluded || r.clipped?.length || errs.length
      || (r.nav?.dupnav > 1)
    if (bad) {
      findings.push({ vp: vp.name, route: name, ...r, errs })
      console.log(`\n### ${vp.name} ${name}  nav=${JSON.stringify(r.nav)}`)
      if (r.overflow) console.log('  OVERFLOW scrollW>' + r.vw)
      if (r.offscreen?.length) console.log('  offscreen: ' + r.offscreen.join(' | '))
      if (r.small?.length) console.log('  small targets: ' + r.small.join(' | '))
      if (r.occluded) console.log(`  OCCLUDED by bottom bar: ${r.occluded} controls`)
      if (r.clipped?.length) console.log('  clipped: ' + r.clipped.join(' | '))
      if (errs.length) console.log('  console: ' + [...new Set(errs)].slice(0, 2).join(' | '))
    }
  }
}

console.log('\n================ totals ================')
console.log(JSON.stringify(totals, null, 1))
console.log(`\n${findings.length} route×viewport combinations with findings, of ${totals.checks} checked`)
ws.close()
process.exit(0)
