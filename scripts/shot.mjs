import fs from 'fs'
import path from 'path'

const BASE = 'http://127.0.0.1:9222'
const OUT = path.resolve('shots')
fs.mkdirSync(OUT, { recursive: true })

const VIEWPORT = { width: 1366, height: 657, dsf: 1 }

const jget = async (p) => (await fetch(BASE + p)).json()

async function newTarget(url) {
  const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json()
  return t
}

class Session {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.events = []
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      } else if (msg.method) {
        this.events.push(msg)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  waitEvent(method, timeout = 25000) {
    const existing = this.events.find((e) => e.method === method)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeout)
      const listener = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.method === method) {
          clearTimeout(t)
          this.ws.removeEventListener('message', listener)
          resolve(msg)
        }
      }
      this.ws.addEventListener('message', listener)
    })
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function open(url) {
  const t = await newTarget(url)
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r, n) => {
    ws.addEventListener('open', r)
    ws.addEventListener('error', n)
  })
  const s = new Session(ws)
  await s.send('Page.enable')
  await s.send('Runtime.enable')
  await s.send('Log.enable')
  await s.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: VIEWPORT.dsf,
    mobile: false,
  })
  return { s, id: t.id }
}

async function go(s, url) {
  const w = s.waitEvent('Page.loadEventFired').catch(() => null)
  await s.send('Page.navigate', { url })
  await w
  await sleep(1400)
}

async function evalJS(s, expression) {
  const r = await s.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r.result?.value
}

async function shot(s, name) {
  const { data } = await s.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const file = path.join(OUT, `${name}.png`)
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}

/** Horizontal-overflow, vertical-budget, console-error and broken-image audit. */
async function audit(s, label) {
  const report = await evalJS(
    s,
    `(() => {
      const de = document.documentElement, b = document.body;
      const wide = [...b.querySelectorAll('*')].filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > ${VIEWPORT.width} + 2 || r.left < -2) && getComputedStyle(el).position !== 'fixed';
      }).slice(0, 6).map(el => el.tagName + '.' + String(el.className).slice(0, 70));
      const imgs = [...b.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src'));
      const h1 = b.querySelector('h1,h2');
      return {
        scrollW: de.scrollWidth, clientW: de.clientWidth,
        scrollH: de.scrollHeight, clientH: de.clientHeight,
        offenders: wide, brokenImages: imgs,
        firstHeading: h1 ? h1.textContent.trim().slice(0, 70) : null,
        cellCount: b.querySelectorAll('table td').length,
        buttons: b.querySelectorAll('button').length,
      };
    })()`,
  )
  if (!report) {
    console.log(`${label.padEnd(26)} AUDIT EVAL FAILED`)
    s.events = []
    return { report: null, problems: ['audit eval failed'] }
  }
  const errs = s.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text || '').split('\n')[0])
  const consoleErrs = s.events
    .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
    .map((e) => e.params.args.map((a) => a.description || a.value).join(' ').slice(0, 220))

  const problems = []
  s.events = [] // drain so each page reports only its own errors
  if (report.scrollW > VIEWPORT.width + 2) problems.push(`horizontal overflow ${report.scrollW}px`)
  if (errs.length) problems.push(...errs.slice(0, 3))
  if (consoleErrs.length) problems.push(...consoleErrs.slice(0, 4))
  if (report.brokenImages.length) problems.push(`broken images: ${report.brokenImages.join(', ')}`)

  console.log(
    `${label.padEnd(26)} ${report.scrollW}x${report.scrollH} (view ${VIEWPORT.width}x${VIEWPORT.height})` +
      ` cells=${report.cellCount} btn=${report.buttons}` +
      (problems.length ? `\n    !! ${problems.join(' | ')}` : '\n    ok'),
  )
  if (report.offenders.length) console.log('    wide:', report.offenders.join(' ; '))
  return { report, problems }
}

const SESSIONS = {
  admin: { id: 'adm-01', email: 'principal@chronocampus.edu.in' },
  teacher: { id: 'tch-01', email: 'neelam.kaur@chronocampus.edu.in' },
  student: { id: 'stu-01', email: 'student@chronocampus.edu.in' },
  verified: { id: 'stu-9', email: 'gurpreet.sandhu@student.chronocampus.edu.in' },
}

const APP = 'http://127.0.0.1:5175'

async function run() {
  const { s, id } = await open(`${APP}/login`)
  const results = []

  const clickTab = async (name) => {
    await evalJS(
      s,
      `[...document.querySelectorAll('button.tab')].find(b => b.textContent.includes(${JSON.stringify(name)}))?.click()`,
    )
    await sleep(1300)
  }

  await go(s, `${APP}/login`)
  await evalJS(s, 'localStorage.clear()')
  await go(s, `${APP}/login`)
  await audit(s, 'login')
  await shot(s, '01-login')

  // student verification gate on the dashboard
  await evalJS(s, `localStorage.setItem('chronocampus.session.v1', JSON.stringify(${JSON.stringify(SESSIONS.student)}))`)
  await go(s, `${APP}/student`)
  await audit(s, 'student-gate')
  await shot(s, '02-student-gate')

  // complete the class-code flow with the demo code
  await evalJS(
    s,
    `(() => {
      const sel = document.querySelector('select.field');
      const setV = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
      setV.call(sel, '11-A Science');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const inp = document.querySelector('input.field');
      const setI = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      setI.call(inp, 'SCI11A-2026');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  )
  await sleep(250)
  await evalJS(s, `[...document.querySelectorAll('button')].find(b => /Verify and unlock/i.test(b.textContent))?.click()`)
  await sleep(1500)
  await audit(s, 'student-dashboard')
  await shot(s, '03-student')

  // peek a period cell
  await evalJS(s, `document.querySelector('table tbody td button')?.click()`)
  await sleep(700)
  await shot(s, '04-student-peek')
  await evalJS(s, `document.querySelector('[aria-label=Close]')?.click()`)

  // teacher
  await evalJS(s, `localStorage.setItem('chronocampus.session.v1', JSON.stringify(${JSON.stringify(SESSIONS.teacher)}))`)
  await go(s, `${APP}/teacher`)
  await audit(s, 'teacher')
  await shot(s, '05-teacher')
  await evalJS(s, `document.querySelector('table tbody td button')?.click()`)
  await sleep(800)
  await shot(s, '06-teacher-drawer')
  await evalJS(s, `document.querySelector('[aria-label="Close drawer"]')?.click()`)
  await sleep(400)

  // admin tabs
  await evalJS(s, `localStorage.setItem('chronocampus.session.v1', JSON.stringify(${JSON.stringify(SESSIONS.admin)}))`)
  await go(s, `${APP}/admin`)
  await audit(s, 'admin-builder')
  await shot(s, '07-admin-builder')

  // conflict engine: open an assigned cell, then probe the subject/teacher/room pickers
  await evalJS(s, `document.querySelector('table tbody td button')?.click()`)
  await sleep(900)
  await shot(s, '08-admin-slot-editor')

  const subjectPicked = await evalJS(
    s,
    `(() => {
      const sel=document.querySelector('[role=dialog] select.field');
      const setV=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
      const opts=[...sel.options].slice(1).map(o=>o.value);
      setV.call(sel, opts[0]); sel.dispatchEvent(new Event('change',{bubbles:true}));
      return opts[0];
    })()`,
  )
  await sleep(800)
  await shot(s, '09-admin-subject-picked')

  const readEngine = () =>
    evalJS(
      s,
      `(() => {
        const dlg=document.querySelector('[role=dialog]'); if(!dlg) return null;
        const save=[...dlg.querySelectorAll('button')].find(b=>/Assign slot|Save changes/.test(b.textContent));
        return {
          alert: /Double booking blocked/.test(dlg.textContent),
          alertText: (dlg.textContent.match(/(is already teaching[^.]*\\.|is occupied by[^.]*\\.)/)||[''])[0].trim(),
          saveDisabled: save ? save.disabled : null,
        };
      })()`,
    )

  const clickIn = (expr) =>
    evalJS(
      s,
      `(() => { const dlg=document.querySelector('[role=dialog]'); const el=${expr}; el?.click(); return el?.textContent?.trim()?.slice(0,40) || null })()`,
    )

  const engineProbe = { before: await readEngine() }
  engineProbe.busyTeacher = await clickIn(`[...dlg.querySelectorAll('button')].find(b=>/in 1[12]-[ABC]/.test(b.textContent))`)
  await sleep(600)
  engineProbe.afterTeacher = await readEngine()
  engineProbe.takenRoom = await clickIn(`[...dlg.querySelectorAll('button.chip')].find(c=>c.className.includes('tone-rose'))`)
  await sleep(600)
  engineProbe.afterRoom = await readEngine()
  await shot(s, '10-admin-conflict')
  engineProbe.freeTeacher = await clickIn(`[...dlg.querySelectorAll('button')].find(b=>/free/.test(b.textContent)&&!b.className.includes('rose'))`)
  engineProbe.freeRoom = await clickIn(`[...dlg.querySelectorAll('button.chip')].find(c=>!c.className.includes('tone-rose')&&!c.className.includes('tone-indigo'))`)
  await sleep(600)
  engineProbe.afterFree = await readEngine()
  console.log('   engine probe:', JSON.stringify(engineProbe, null, 1), '| subject:', subjectPicked)

  await evalJS(s, `[...document.querySelectorAll('button')].find(b=>/Cancel/i.test(b.textContent))?.click()`)
  await sleep(500)

  for (const [i, tab] of ['Substitutes', 'Staff & Class Codes', 'Workload & Print'].entries()) {
    await clickTab(tab)
    await audit(s, `admin-tab-${i + 2}`)
    await shot(s, `1${i + 1}-admin-tab${i + 2}`)
  }

  // substitution desk interaction: mark a teacher absent, then look at the coverage list
  await clickTab('Substitutes')
  await evalJS(s, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/Meenakshi/.test(x.textContent)); b?.click(); return b?.textContent } )()`)
  await sleep(1300)
  await audit(s, 'substitute-workflow')
  await shot(s, '14-substitute-workflow')

  // onboarding: paste TSV into the teachers card
  await clickTab('Staff & Class Codes')
  await evalJS(
    s,
    `(() => {
      const ta=document.querySelector('textarea.field');
      const setI=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
      setI.call(ta, 'Name\\tEmail\\tSubject\\tPhone\\nGursharan Kaur\\tgursharan.kaur@chronocampus.edu.in\\tMathematics\\t+91 90000 11223\\nBalwinder Rao\\tb.balwinder@chronocampus.edu.in\\tEnglish\\t+91 90000 44556');
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      return 'pasted';
    })()`,
  )
  await sleep(1000)
  await shot(s, '15-onboarding-paste')

  // demo switcher panel
  await evalJS(s, `[...document.querySelectorAll('header button')].find(b=>/Pitch Mode|Live Mode/.test(b.textContent))?.click()`)
  await sleep(800)
  await shot(s, '16-demo-switcher')

  await s.send('Target.closeTarget', { targetId: id })
  return results
}

run()
  .then(() => {
    console.log('\nshots written to', OUT)
    process.exit(0)
  })
  .catch((e) => {
    console.error('RUN FAILED', e)
    process.exit(1)
  })
