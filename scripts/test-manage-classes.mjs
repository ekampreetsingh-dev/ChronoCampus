/**
 * Managing an existing class: the assign dialog's subject list and automatic
 * room, renaming a section, publishing its syllabus, and removing it.
 */
import fs from 'fs'
import path from 'path'

const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const OUT = path.resolve('shots')
const KEY = 'chronocampus.demo.v6'
const VP = { width: 1366, height: 657 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(`${APP}/login`)}`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
let events = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id) }
  else if (m.method) events.push(m)
})
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value

await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { ...VP, deviceScaleFactor: 1, mobile: false })
const goto = async (url) => { events = []; await send('Page.navigate', { url }); await sleep(2800) }
const shot = async (n) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `${n}.png`), Buffer.from(data, 'base64')) }
const errs = () => events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception?.description || '').split('\n')[0])

const store = () => ev(`(() => JSON.parse(localStorage[${JSON.stringify(KEY)}] || '{}'))()`).then((s) => ({
  sections: (s.class_sections || []).length,
  slots: (s.timetable_slots || []).length,
  byName: (name) => (s.timetable_slots || []).filter((x) => x.class_section === name).length,
  section: (name) => (s.class_sections || []).find((c) => c.name === name) || null,
  codeFor: (id) => (s.class_codes || []).find((c) => c.class_section_id === id) || null,
}))
const click = (sel) => ev(`(() => { const b=[...document.querySelectorAll(${sel})]; const x=b[0]; if(!x) return 'missing'; x.click(); return 'ok' })()`)
const clickText = (text, scope = 'button') =>
  ev(`(() => { const b=[...document.querySelectorAll(${JSON.stringify('[role=dialog] ' + scope + ', ' + scope)})].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)})); if(!b) return 'missing'; b.click(); return 'ok' })()`)
const pickSelect = (label, value) => ev(`(() => {
  const sels=[...document.querySelectorAll('[role=dialog] select.field')];
  const sel=sels.find(s => [...s.options].some(o => o.value === ${JSON.stringify(value)}));
  if (!sel) return 'no select with ' + ${JSON.stringify(value)};
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sel, ${JSON.stringify(value)});
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`)

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** The first visit seeds 56 classes, 2,459 periods and 56 hashed codes — give it room. */
const waitSeed = async () => {
  for (let i = 0; i < 20; i += 1) {
    const s = await store()
    if (s.sections === 56) return s
    await sleep(700)
  }
  return store()
}
const waitDialog = async () => {
  for (let i = 0; i < 10; i += 1) {
    if (await ev(`Boolean(document.querySelector('[role=dialog]'))`)) return true
    await sleep(500)
  }
  return false
}

await send('Page.navigate', { url: `${APP}/login` })
await sleep(2500)
await ev(`Object.keys(localStorage).filter(k => k.startsWith('chronocampus.')).forEach(k => localStorage.removeItem(k))`)
await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({id:'adm-01',email:'principal@chronocampus.edu.in'}))`)

/* ------------------------------------------- 1. the assign dialog --------- */
await goto(`${APP}/admin/timetable`)
const before = await waitSeed()
check('56 sections and 2,459 periods seeded', before.sections === 56 && before.slots === 2459, `${before.sections}/${before.slots}`)

// The board opens on the first class in the register — that is Playway-A now, and
// the early-years day has no zero period. This suite is about a junior class.
await ev(`(() => { const b = document.querySelector('[aria-label="Class board"]'); if (b) b.click(); return Boolean(b) })()`)
await sleep(500)
await ev(`(() => {
  const i = document.querySelector('[role=listbox] input');
  if (!i) return 'no input';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, '1-A');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()`)
await sleep(500)
const switched = await ev(`(() => {
  const o = [...document.querySelectorAll('[role=listbox] [role=option]')].find(x => x.innerText.trim().startsWith('1-A'));
  if (!o) return 'no option';
  o.click(); return o.innerText.split('\\n')[0].trim();
})()`)
check('the board can be switched to a junior class', switched === '1-A', String(switched))
await sleep(1200)

// the 08:00 zero period — the cell this school opens the day with
const opened = await ev(`(() => {
  const cell = [...document.querySelectorAll('table tbody td button')].find(c => /Monday 0,/.test(c.getAttribute('aria-label') || ''));
  if (!cell) return 'no P0 cell';
  cell.click(); return 'clicked';
})()`)
const dialogUp = await waitDialog()
check('P0 cell opens the editor', opened === 'clicked' && dialogUp, `${opened}, dialog ${dialogUp}`)

const head = await ev(`(() => {
  const d = document.querySelector('[role=dialog]');
  return { text: d ? d.innerText.slice(0, 220).replace(/\\n+/g, ' | ') : null };
})()`)
check('the zero period is labelled, not blank', Boolean(head.text) && /08:00/.test(head.text) && !/PERIOD \| —/.test(head.text), JSON.stringify(head.text?.slice(0, 96)))

/** Open a searchable picker inside the dialog by aria-label and click an exact option. */
const pickCombo = async (label, value) => {
  const opened = await ev(`(() => {
    const b = [...document.querySelectorAll('[role=dialog] [role=combobox]')].find(x => (x.getAttribute('aria-label')||'').toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
    if (!b) return 'no combobox';
    b.click(); return 'open';
  })()`)
  if (opened !== 'open') return opened
  await sleep(450)
  const count = await ev(`(() => document.querySelectorAll('[role=listbox] [role=option]').length)()`)
  if (value === null) {
    // a real Escape on the focused search field closes the panel only
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
    await sleep(450)
    return {
      count,
      panelClosed: await ev(`Boolean(!document.querySelector('[role=listbox]'))`),
      dialogOpen: await ev(`document.querySelectorAll('[role=dialog]').length`),
    }
  }
  const typed = await ev(`(() => {
    const i = document.querySelector('[role=listbox] input');
    if (!i) return 'no input';
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, ${JSON.stringify(value)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`)
  if (typed !== 'typed') return typed
  await sleep(450)
  const out = await ev(`(() => {
    const o = [...document.querySelectorAll('[role=listbox] [role=option]')].find(x => x.innerText.split('\\n')[0].trim() === ${JSON.stringify(value)});
    if (!o) return 'no option';
    o.click(); return o.innerText.split('\\n')[0].trim();
  })()`)
  await sleep(600)
  return { count, chosen: out }
}

const subjectState = await pickCombo('Subject', null)
check('subject menu is populated', subjectState.count > 5, `${JSON.stringify(subjectState.count)} subjects in the picker`)
const roomChips = await ev(`document.querySelectorAll('[role=dialog] button.chip').length`)
check('room picker removed', roomChips === 0, `${roomChips} room chips left`)
await shot('assign-p0-editor')

const chosen = await pickCombo('Subject', 'Physics')
await sleep(400)
const afterPick = await ev(`(() => {
  const d = document.querySelector('[role=dialog]');
  if (!d) return { err: 'dialog gone' };
  const box = [...d.querySelectorAll('.inset')].find(e => /^room/i.test(e.innerText.trim()));
  return {
    room: box?.querySelector('.font-mono')?.textContent.trim() || null,
    why: (box?.innerText.match(/lab for this subject|class's own room|first free at this bell|is busy at this bell|every preferred room is busy/)||[null])[0],
    label: [...d.querySelectorAll('button')].map(b=>b.textContent.trim()).find(t=>/Assign slot|Save changes/.test(t)),
    disabled: [...d.querySelectorAll('button')].find(b => /Assign slot|Save changes/.test(b.textContent))?.disabled,
  };
})()`)
check('a room is chosen and explained', Boolean(afterPick.room) && Boolean(afterPick.why), JSON.stringify(afterPick))
check('escape closes the panel, not the dialog', subjectState.panelClosed === true && subjectState.dialogOpen === 1, JSON.stringify({ closed: subjectState.panelClosed, dialogs: subjectState.dialogOpen }))
check('the badge matches the room it got', (afterPick.why === 'lab for this subject') === /Lab/.test(afterPick.room || ''), `room ${afterPick.room} · ${afterPick.why}`)
check('the zero period can be saved', afterPick.disabled === false, `"${afterPick.label}" disabled=${afterPick.disabled}, chosen=${chosen}`)

const saved = await ev(`(() => { const b=[...document.querySelectorAll('[role=dialog] button')].find(x=>/Assign slot|Save changes/.test(x.textContent)); if(!b||b.disabled) return 'blocked'; b.click(); return 'saved' })()`)
await sleep(1800)
const moved = await ev(`(() => {
  const s = JSON.parse(localStorage[${JSON.stringify(KEY)}]);
  const at = s.timetable_slots.filter(x => x.day === 'Monday' && Number(x.period) === 0);
  const slot = at.find(x => x.class_section === '1-A');
  const sharing = at.filter(x => x.room === slot?.room && x.class_section !== '1-A').map(x => x.class_section);
  return slot ? { subject: slot.subject, room: slot.room, teacher: slot.teacher_name, sharing } : null;
})()`)
check('the saved period carries a room of its own', saved === 'saved' && moved?.subject === 'Physics' && moved.sharing.length === 0, JSON.stringify(moved))
check('the week gained no phantom period', (await store()).slots === 2459, `${(await store()).slots} slots`)

/* ------------------------------------------------ 2. rename a class -------- */
await goto(`${APP}/admin/sections`)
const editClick = await ev(`(() => {
  const card = [...document.querySelectorAll('.panel')].find(p => p.innerText.startsWith('11-A Science'));
  const btn = [...card.querySelectorAll('button')].find(b => /Edit class/.test(b.textContent));
  if (!btn) return 'missing'; btn.click(); return 'ok';
})()`)
const editOpen = await waitDialog()
const prefilled = await ev(`(() => document.querySelector('[role=dialog] input[placeholder="11-D Science"]')?.value ?? null)()`)
check('edit opens pre-filled', editOpen && prefilled === '11-A Science', `dialog ${editOpen}, name ${JSON.stringify(prefilled)}`)
const renamed = await ev(`(() => {
  const el = document.querySelector('[role=dialog] input[placeholder="11-D Science"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, '11-A Physics Core');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value;
})()`)
await sleep(300)
const scienceBefore = (await store()).byName('11-A Science')
const saveEdit = await ev(`(() => { const b=[...document.querySelectorAll('[role=dialog] button')].find(x=>/Save changes/.test(x.textContent)); if(!b||b.disabled) return 'blocked'; b.click(); return 'ok' })()`)
await sleep(1800)
const after = await store()
check('rename saved', saveEdit === 'ok' && after.section('11-A Physics Core') !== null, `typed ${renamed}, save ${saveEdit}`)
check('every period followed the new name', after.byName('11-A Physics Core') === scienceBefore && after.byName('11-A Science') === 0, `${scienceBefore} periods moved, ${after.byName('11-A Science')} left under the old name`)
check('access code followed', (after.codeFor(after.section('11-A Physics Core')?.id)?.class_section || null) === '11-A Physics Core', JSON.stringify(after.codeFor('sec-11a')?.class_section))
check('section count unchanged', after.sections === 56, `${after.sections}`)
await shot('renamed-section-card')

/* ------------------------------------------------ 3. publish a syllabus ---- */
await ev(`(() => {
  const card = [...document.querySelectorAll('.panel')].find(p => p.innerText.startsWith('11-A Physics Core'));
  [...card.querySelectorAll('button')].find(b => /Subjects/.test(b.textContent)).click();
})()`)
await waitDialog()
const sheet = await ev(`(() => {
  const d = document.querySelector('[role=dialog]');
  const rows = [...d.querySelectorAll('input[type=number]')].map(i => Number(i.value));
  return { rows: rows.length, total: rows.reduce((a,b)=>a+b,0), meter: (d.innerText.match(/(\\d+) of (\\d+) periods/)||[]).slice(1) };
})()`)
check('syllabus editor loads the class plan', sheet.rows === 8 && sheet.total === 30, `${sheet.rows} subjects, ${sheet.total} of ${sheet.meter?.[1]} periods`)

const firstRow = await ev(`(() => {
  const d = document.querySelector('[role=dialog]');
  const text = [...d.querySelectorAll('input[list]')][0];
  const num = [...d.querySelectorAll('input[type=number]')][0];
  return { subject: text?.value, periods: Number(num?.value) };
})()`)
await ev(`(() => {
  const d = document.querySelector('[role=dialog]');
  [...d.querySelectorAll('button')].find(b => b.title?.startsWith('Remove')).click();
})()`)
await sleep(500)
const edited = await ev(`(() => {
  const d = document.querySelector('[role=dialog]');
  const rows = [...d.querySelectorAll('input[type=number]')].map(i => Number(i.value));
  return { rows: rows.length, total: rows.reduce((a,b)=>a+b,0), disabled: [...d.querySelectorAll('button')].find(b=>/Save syllabus/.test(b.textContent))?.disabled };
})()`)
check('a subject can be dropped', edited.rows === sheet.rows - 1 && edited.total === sheet.total - firstRow.periods, `${firstRow.subject} removed → ${edited.rows} rows, ${edited.total} periods`)
check('the save stays enabled', edited.disabled === false, `disabled=${edited.disabled}`)
await ev(`(() => { [...document.querySelectorAll('[role=dialog] button')].find(b=>/Save syllabus/.test(b.textContent)).click() })()`)
await sleep(1600)
const stored = await store()
const plan = stored.section('11-A Physics Core')?.curriculum || {}
const load = Object.values(plan).reduce((a, b) => a + b, 0)
check('syllabus persisted', Object.keys(plan).length === sheet.rows - 1 && !(firstRow.subject in plan), `${Object.keys(plan).length} subjects, ${load} periods`)
check('card reports the new load', (await ev(`(() => { const c=[...document.querySelectorAll('.panel')].find(p=>p.innerText.startsWith('11-A Physics Core')); return c.innerText.replace(/\\n+/g,' ') })()`)).includes(`${Object.keys(plan).length} · ${load} periods`), `${Object.keys(plan).length} · ${load}`)

/* -------------------------------------------------- 4. remove a class ------ */
await ev(`(() => { [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='New section').click() })()`)
await sleep(800)
await ev(`(() => { [...document.querySelectorAll('[role=dialog] button.chip')].find(b=>b.textContent.trim()==='6').click() })()`)
await sleep(300)
await ev(`(() => { const el=document.querySelector('[role=dialog] [aria-label="Section letter"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'F'); el.dispatchEvent(new Event('input',{bubbles:true})) })()`)
await sleep(400)
await ev(`(() => { [...document.querySelectorAll('[role=dialog] button')].find(b=>/Create section/.test(b.textContent)).click() })()`)
await sleep(1500)
const withNew = await store()
check('throwaway class created', withNew.section('6-F') !== null && withNew.sections === 57, `${withNew.sections} sections`)

await ev(`(() => {
  const card = [...document.querySelectorAll('.panel')].find(p => p.innerText.startsWith('6-F'));
  [...card.querySelectorAll('button')].find(b => /Remove/.test(b.textContent)).click();
})()`)
await waitDialog()
const confirm = await ev(`(() => {
  const d = [...document.querySelectorAll('[role=dialog]')].pop();
  return { text: (d.innerText.match(/This deletes[^\\n]*/)||[null])[0], label: [...d.querySelectorAll('button')].find(b=>/Delete permanently/.test(b.textContent))?.textContent };
})()`)
check('removal states what it destroys', Boolean(confirm.text) && confirm.label === 'Delete permanently', JSON.stringify(confirm))
await ev(`(() => { const d=[...document.querySelectorAll('[role=dialog]')].pop(); [...d.querySelectorAll('button')].find(b=>/Delete permanently/.test(b.textContent)).click() })()`)
await sleep(1600)
const gone = await store()
check('class removed from the register', gone.section('6-F') === null && gone.sections === 56, `${gone.sections} sections`)

/* ------------------------------------ 5. a class with students is refused -- */
await ev(`(() => {
  const card = [...document.querySelectorAll('.panel')].find(p => p.innerText.startsWith('11-B Commerce'));
  [...card.querySelectorAll('button')].find(b => /Remove/.test(b.textContent)).click();
})()`)
await waitDialog()
await ev(`(() => { const d=[...document.querySelectorAll('[role=dialog]')].pop(); [...d.querySelectorAll('button')].find(b=>/Delete anyway|Delete permanently/.test(b.textContent))?.click() })()`)
await sleep(1600)
const refused = await store()
const toast = await ev(`(() => (document.body.innerText.match(/Class still has students/)||[null])[0])()`)
check('deleting a populated class is refused', refused.section('11-B Commerce') !== null && Boolean(toast), `still ${refused.sections} sections · ${toast}`)

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
failed.forEach((f) => console.log('  !!', f.name, f.detail))
const e = errs()
console.log(e.length ? `\nruntime errors:\n  ${e.join('\n  ')}` : '\nno runtime errors')

ws.close()
await fetch(`${BASE}/json/close/${t.id}`)
process.exit(failed.length || e.length ? 1 : 0)
