/**
 * Rebuild audit — measures the defect classes the brief calls out, on every route,
 * for every role, at two viewports. Nothing here is an opinion: each check either
 * happens in the DOM or it is not reported.
 *
 *   node scripts/audit-app.mjs            # all routes
 *   node scripts/audit-app.mjs admin      # only routes whose name matches
 */
const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const FILTER = process.argv[2] || ''

const SESSIONS = {
  admin: { id: 'adm-01', email: 'principal@chronocampus.edu.in' },
  teacher: { id: 'tch-01', email: 'neelam.kaur@chronocampus.edu.in' },
  student: { id: 'stu-01', email: 'gurpreet.sandhu@student.chronocampus.edu.in' },
  enrolled: { id: 'stu-02', email: 'aanya.iyer@student.chronocampus.edu.in' },
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
  ['teacher-profile', '/teacher/profile', 'teacher'],
  ['teacher-groups', '/teacher/groups', 'teacher'],
  ['teacher-group-one', '/teacher/groups/grp-11a', 'teacher'],
  ['student-groups', '/student/groups', 'enrolled'],
  ['student-group-one', '/student/groups/grp-11a', 'enrolled'],
  ['student-unverified', '/student', 'student'],
  ['student', '/student', 'student'],
  ['student-timetable', '/student/timetable', 'student'],
  ['student-homework', '/student/homework', 'student'],
  ['student-academic', '/student/academic', 'student'],
  ['student-profile', '/student/profile', 'student'],
]
const VIEWPORTS = [
  { name: 'laptop', w: 1366, h: 657 },
  { name: 'phone', w: 390, h: 780 },
]

const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(`${APP}/login`)}`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
let events = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id).resolve(m.result)
    pending.delete(m.id)
    return
  }
  if (m.method) events.push(m)
})
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, { resolve: res })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }))?.result?.value

const PROBE = `(() => {
  const de = document.documentElement;
  const vis = (e) => {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.1) return false;
    const r = e.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const desc = (e) => {
    const cls = String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className || '').slice(0, 46);
    return (e.tagName.toLowerCase() + (cls ? '.' + cls.replace(/\\s+/g, ' ') : '') + ' «' + (e.textContent || '').trim().slice(0, 22) + '»');
  };
  const all = [...document.querySelectorAll('body *')].filter(vis);

  const tiny = all.filter((e) => !e.children.length && (e.textContent || '').trim() && parseFloat(getComputedStyle(e).fontSize) < 11)
    .map((e) => Math.round(parseFloat(getComputedStyle(e).fontSize) * 10) / 10 + ' ' + desc(e));

  // A tone class that matched no rule leaves the element with no background and
  // no border colour of its own — the chip renders grey and nobody notices.
  const deadTone = all.filter((e) => /(^|\\s)tone-[a-z-]+/.test(String(e.className || '')))
    .filter((e) => {
      const s = getComputedStyle(e);
      return s.backgroundColor === 'rgba(0, 0, 0, 0)' && s.borderTopColor === s.borderBottomColor && /0, 0, 0/.test(s.borderTopColor);
    })
    .map((e) => String(e.className).match(/tone-[a-z-]+/)[0] + ' ' + desc(e));

  const nameless = [...document.querySelectorAll('button')].filter((b) => vis(b))
    .filter((b) => !(b.textContent || '').trim() && !b.getAttribute('aria-label') && !b.title && !b.getAttribute('aria-labelledby'))
    .map(desc);

  const fakeLinks = [...document.querySelectorAll('a')].filter((a) => vis(a))
    .filter((a) => { const h = a.getAttribute('href'); return h === null || h === '#' || h === '' || h === 'javascript:void(0)' })
    .map(desc);

  const unlabelled = [...document.querySelectorAll('input, select, textarea')].filter(vis).filter((f) => {
    if (f.getAttribute('aria-label') || f.getAttribute('placeholder') || f.id && document.querySelector('label[for="' + f.id + '"]')) return false
    return !f.closest('label')
  }).map((f) => f.tagName.toLowerCase() + '.' + String(f.className).slice(0, 30));

  const brokenImg = [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src.slice(0, 60));

  const focusable = document.querySelector('.btn, .field');
  let focusRing = null;
  if (focusable) {
    const before = getComputedStyle(focusable);
    focusable.focus();
    const after = getComputedStyle(focusable);
    focusRing = before.boxShadow !== after.boxShadow || before.outlineStyle !== after.outlineStyle || after.outlineWidth !== '0px';
    focusable.blur();
  }

  return {
    overflow: de.scrollWidth > de.clientWidth + 1 ? de.scrollWidth - de.clientWidth : 0,
    tiny: [...new Set(tiny)],
    deadTone: [...new Set(deadTone)],
    nameless: [...new Set(nameless)],
    fakeLinks: [...new Set(fakeLinks)],
    unlabelled: [...new Set(unlabelled)],
    brokenImg,
    focusRing,
    buttons: [...document.querySelectorAll('button')].filter(vis).length,
    text: document.body.innerText.trim().length,
  };
})()`

// Click every non-destructive control and see whether *anything* changed.
// Controls are re-queried by label before every click: React unmounts conditional
// overlays, so a node captured up front would be detached and read as "dead".
const DEAD_SWEEP = `(async () => {
  const SKIP = /delete|remove|archive|reset|sign out|clear|wipe|restore|activate|import|publish|send|assign|save/i;
  const vis = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && r.width > 1 && r.height > 1 }
  const snap = () => location.pathname + '|' + document.body.innerHTML.length + '|' + Boolean(document.querySelector('[role=dialog], .pop, [role=menu], [role=listbox]'))
  const out = []
  const seen = new Set()
  const labels = [...document.querySelectorAll('button')].filter(vis).filter((b) => !b.disabled)
    .filter((b) => !SKIP.test(b.textContent || '') && !SKIP.test(b.getAttribute('aria-label') || ''))
    .map((b) => (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 28))
    .filter((k) => k && !seen.has(k) && seen.add(k))
  for (const key of labels.slice(0, 22)) {
    // leave any overlay a previous click opened before measuring the next control
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    document.dispatchEvent(esc); await new Promise(r => setTimeout(r, 120))
    const closer = [...document.querySelectorAll('[role=dialog] button, .pop button')].find((x) => /cancel|close|done/i.test(x.textContent || '') || x.getAttribute('aria-label') === 'Close')
    if (closer) { closer.click(); await new Promise(r => setTimeout(r, 260)) }
    const b = [...document.querySelectorAll('button')].filter(vis).find((x) => ((x.textContent || x.getAttribute('aria-label') || '').trim().slice(0, 28)) === key)
    if (!b) { out.push(key + ' (gone)'); continue }
    const before = snap()
    b.click()
    await new Promise(r => setTimeout(r, 900))
    if (snap() === before) out.push(key)
  }
  return out
})()`

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')

const report = []
for (const vp of VIEWPORTS) {
  await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w < 700 })
  for (const [name, path, role] of ROUTES) {
    if (FILTER && !name.includes(FILTER)) continue
    /* The dead-control sweep writes to the demo store (absence toggles, filters).
       Re-seed before every route so each one is measured from the same baseline. */
    await send('Page.navigate', { url: `${APP}/login` })
    await sleep(1200)
    await ev(`(() => { try { localStorage.removeItem('chronocampus.demo.v7') } catch (e) {} return 1 })()`)
    if (role) await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify(${JSON.stringify(SESSIONS[role])}))`)
    else await ev(`localStorage.removeItem('chronocampus.session.v2')`)
    events = []
    await send('Page.navigate', { url: `${APP}${path}` })
    let ready = false
    for (let i = 0; i < 34 && !ready; i += 1) {
      await sleep(400)
      ready = await ev(`document.body.innerText.trim().length > 40`)
    }
    await sleep(900)
    const r = (await ev(PROBE)) || {}
    const errs = events
      .filter((e) => e.method === 'Runtime.exceptionThrown')
      .map((e) => (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text || '').split('\n')[0])
      .concat(
        events
          .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
          .map((e) => e.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 120)),
      )
      .filter((x) => !/Download is starting|favicon|manifest|ResizeObserver/.test(x))
    const dead = vp.name === 'laptop' ? (await ev(DEAD_SWEEP)) || [] : []
    const issues = {
      errors: [...new Set(errs)],
      overflow: r.overflow || 0,
      tiny: r.tiny || [],
      deadTone: r.deadTone || [],
      nameless: r.nameless || [],
      fakeLinks: r.fakeLinks || [],
      unlabelled: r.unlabelled || [],
      brokenImg: r.brokenImg || [],
      focusRing: r.focusRing,
      dead,
      empty: (r.text || 0) < 40,
    }
    const score =
      issues.errors.length + issues.overflow + issues.tiny.length + issues.deadTone.length + issues.nameless.length +
      issues.fakeLinks.length + issues.unlabelled.length + issues.brokenImg.length + issues.dead.length + (issues.empty ? 1 : 0) +
      (issues.focusRing === false ? 1 : 0)
    report.push({ vp: vp.name, route: name, ...issues, score })
    console.log(
      `${vp.name.padEnd(7)} ${name.padEnd(19)} ${String(score).padStart(3)}  ` +
        [
          issues.errors.length && `${issues.errors.length} console`,
          issues.overflow && `overflow +${issues.overflow}px`,
          issues.tiny.length && `${issues.tiny.length} sub-11px`,
          issues.deadTone.length && `${issues.deadTone.length} dead tone`,
          issues.nameless.length && `${issues.nameless.length} nameless btn`,
          issues.fakeLinks.length && `${issues.fakeLinks.length} fake link`,
          issues.unlabelled.length && `${issues.unlabelled.length} unlabelled`,
          issues.brokenImg.length && `${issues.brokenImg.length} broken img`,
          issues.focusRing === false && 'no focus ring',
          issues.dead.length && `${issues.dead.length} dead btn`,
          issues.empty && 'EMPTY',
        ]
          .filter(Boolean)
          .join(' · ') || 'clean',
    )
  }
}

console.log('\n================ detail ================')
for (const r of report.filter((x) => x.score)) {
  console.log(`\n### ${r.vp} ${r.route} (${r.score})`)
  if (r.errors.length) console.log('  console:  ', r.errors.slice(0, 3).join(' | '))
  if (r.tiny.length) console.log('  tiny:     ', r.tiny.slice(0, 6).join(' | '))
  if (r.deadTone.length) console.log('  dead tone:', r.deadTone.slice(0, 6).join(' | '))
  if (r.nameless.length) console.log('  nameless: ', r.nameless.slice(0, 6).join(' | '))
  if (r.fakeLinks.length) console.log('  fake link:', r.fakeLinks.slice(0, 4).join(' | '))
  if (r.unlabelled.length) console.log('  unlabelled:', r.unlabelled.slice(0, 4).join(' | '))
  if (r.brokenImg.length) console.log('  broken img:', r.brokenImg.join(' | '))
  if (r.dead.length) console.log('  dead btns:', r.dead.slice(0, 8).join(' | '))
}
const totals = report.reduce(
  (a, r) => ({
    routes: a.routes + 1,
    withIssues: a.withIssues + (r.score ? 1 : 0),
    console: a.console + r.errors.length,
    overflow: a.overflow + (r.overflow ? 1 : 0),
    tiny: a.tiny + r.tiny.length,
    deadTone: a.deadTone + r.deadTone.length,
    nameless: a.nameless + r.nameless.length,
    fakeLinks: a.fakeLinks + r.fakeLinks.length,
    unlabelled: a.unlabelled + r.unlabelled.length,
    dead: a.dead + r.dead.length,
    focus: a.focus + (r.focusRing === false ? 1 : 0),
  }),
  { routes: 0, withIssues: 0, console: 0, overflow: 0, tiny: 0, deadTone: 0, nameless: 0, fakeLinks: 0, unlabelled: 0, dead: 0, focus: 0 },
)
console.log('\n================ totals ================')
console.log(JSON.stringify(totals, null, 1))
await ev(`localStorage.removeItem('chronocampus.demo.v7')`)
ws.close()
await fetch(`${BASE}/json/close/${t.id}`)
