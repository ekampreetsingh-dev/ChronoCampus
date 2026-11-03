/**
 * ChronoConnect — service-level rules for class groups.
 *
 * These are the ten scenarios from the brief, driven against the real data
 * layer in the browser (so localStorage, the seed and the permission helpers all
 * behave the way the app will see them), plus the lifecycle cases: a new class
 * gets a group, an archived class keeps its history, an enrolled student moves.
 */
const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
const fails = []
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const t = await (await fetch(`${BASE}/json/new?${encodeURIComponent(`${APP}/login`)}`, { method: 'PUT' })).json()
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id).resolve(m.result)
    pending.delete(m.id)
    return
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] || '')
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description || '').join(' '))
})
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, { resolve: res })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false })
await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify({id:'adm-01',email:'principal@chronocampus.edu.in'}))`)
await ev(`localStorage.removeItem('chronocampus.demo.v7')`)
await send('Page.navigate', { url: `${APP}/admin` })
await sleep(4200)
await ev(`(() => { import('/src/lib/supabase.js').then(m => { window.__db = m.db }); return 1 })()`)
await sleep(700)

/**
 * Read the store straight out of localStorage. Importing pitchStore a second
 * time gives a *different* module instance with its own seed, which would make
 * every assertion below read a copy nobody wrote to.
 */
const KEY = 'chronocampus.demo.v7'
const store = () => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))`)

/* ------------------------------------------------------------- 1. coverage */
console.log('\n— every class-section has exactly one group —')
const cov = await ev(`(async () => {
  const s = JSON.parse(localStorage.getItem('chronocampus.demo.v7'))
  const ids = s.class_groups.map(g => g.class_section_id)
  const dupes = ids.filter((x, i) => ids.indexOf(x) !== i)
  return { sections: s.class_sections.length, groups: s.class_groups.length, dupes, orphan: s.class_groups.filter(g => !s.class_sections.some(c => String(c.id) === String(g.class_section_id))).length }
})()`)
ok('one group per section', cov.groups === cov.sections && !cov.dupes.length && !cov.orphan, `${cov.groups} groups / ${cov.sections} sections`)
const mgr = await ev(`(async () => {
  const s = JSON.parse(localStorage.getItem('chronocampus.demo.v7'))
  const wrong = s.class_groups.filter(g => {
    const sec = s.class_sections.find(c => String(c.id) === String(g.class_section_id))
    return String(g.class_teacher_id || '') !== String(sec?.mentor_teacher_id || '')
  })
  const noManagerRow = s.class_groups.filter(g => g.class_teacher_id && !s.group_members.some(m => m.group_id === g.id && String(m.user_id) === String(g.class_teacher_id) && m.role === 'manager' && m.active !== false))
  return { wrong: wrong.length, noManagerRow: noManagerRow.length }
})()`)
ok('the group manager mirrors the class teacher', mgr.wrong === 0, `${mgr.wrong} out of step`)
ok('every class teacher holds a manager membership', mgr.noManagerRow === 0, `${mgr.noManagerRow} missing`)

/* --------------------------------------------------- 2 & 3. assign + manage */
const target = await ev(`(async () => {
  const s = JSON.parse(localStorage.getItem('chronocampus.demo.v7'))
  const sec = s.class_sections.find(c => c.name === '11-A Science')
  const chemistry = s.teachers.find(t => t.subject === 'Chemistry' && !s.group_members.some(m => m.group_id === 'grp-11a' && String(m.user_id) === String(t.id) && m.active !== false))
  // An existing teacher member is the right person to try to manage with: they can
  // see the group but the brief says they must not be able to change its roster.
  const memberRow = s.group_members.find(m => m.group_id === 'grp-11a' && m.role === 'teacher' && m.active !== false)
  const member = s.teachers.find(t => String(t.id) === String(memberRow?.user_id))
  return { sectionId: sec.id, name: sec.name, groupId: 'grp-11a', mentor: sec.mentor_teacher_id, mentorName: (s.teachers.find(t => String(t.id) === String(sec.mentor_teacher_id))||{}).full_name, chemistry: chemistry && { id: chemistry.id, name: chemistry.full_name, subject: chemistry.subject }, physics: member && { id: member.id, name: member.full_name } }
})()`)
console.log(`\n— scenario: assign the class teacher of ${target.name} (${target.mentorName}) —`)
const assigned = await ev(`(async () => {
  try { return await window.__db.setClassTeacher(${JSON.stringify(target.sectionId)}, ${JSON.stringify(target.mentor)}, { actor: { id: 'adm-01', name: 'Col. S. S. Gill' } }) }
  catch (e) { return { error: e.message } }
})()`)
ok('admin can (re)assign the class teacher', !assigned.error && assigned.teacher === target.mentorName, JSON.stringify(assigned))

const notAdmin = await ev(`(async () => {
  try { await window.__db.setClassTeacher(${JSON.stringify(target.sectionId)}, null, { actor: { id: ${JSON.stringify(target.mentor)}, name: 'x' } }); return 'allowed' }
  catch (e) { return e.code }
})()`)
ok('the class teacher cannot change their own official role', notAdmin === 'not_admin', String(notAdmin))

console.log('\n— the class teacher opens Manage Group —')
const candidates = await ev(`(async () => {
  const r = await window.__db.groupCandidateTeachers(${JSON.stringify(target.groupId)}, { profile: { id: ${JSON.stringify(target.mentor)}, role: 'teacher' } })
  return { count: r.length, members: r.filter(x => x.is_member).length, chemistry: r.find(x => String(x.id) === ${JSON.stringify(target.chemistry?.id)}) || null }
})()`)
ok('the manager sees the registered directory', candidates.count > 50, `${candidates.count} staff, ${candidates.members} already in`)
ok('the directory marks who is already a member', candidates.members >= 1, `${candidates.members}`)
ok('the Chemistry teacher is offered as addable', candidates.chemistry && !candidates.chemistry.is_member, JSON.stringify(candidates.chemistry))

const added = await ev(`(async () => {
  try { return await window.__db.addGroupTeachers(${JSON.stringify(target.groupId)}, [${JSON.stringify(target.chemistry?.id)}], { actor: { id: ${JSON.stringify(target.mentor)}, name: ${JSON.stringify(target.mentorName)} } }) }
  catch (e) { return { error: e.message, code: e.code } }
})()`)
ok('the manager adds the Chemistry teacher', added.added?.length === 1, JSON.stringify(added))
const again = await ev(`(async () => await window.__db.addGroupTeachers(${JSON.stringify(target.groupId)}, [${JSON.stringify(target.chemistry?.id)}], { actor: { id: ${JSON.stringify(target.mentor)}, name: ${JSON.stringify(target.mentorName)} } }))()`)
ok('adding the same teacher twice does not duplicate', again.already?.length === 1 && !again.added?.length, JSON.stringify(again))
const dupeRows = await ev(`(async () => {
  const s = JSON.parse(localStorage.getItem('chronocampus.demo.v7'))
  return s.group_members.filter(m => m.group_id === ${JSON.stringify(target.groupId)} && String(m.user_id) === ${JSON.stringify(target.chemistry?.id)}).length
})()`)
ok('the membership table holds one row for them', dupeRows === 1, `${dupeRows} rows`)
const notice = await ev(`(() => {
  const s = JSON.parse(localStorage.getItem('chronocampus.demo.v7'))
  const n = (s.notifications || []).find(x => x.kind === 'group' && String(x.user_id) === ${JSON.stringify(target.chemistry?.id)})
  return n ? { audience: n.audience, user_id: n.user_id, title: n.title, link: n.link } : null
})()`)
ok('the added teacher is told about it', notice?.audience === 'teacher' && /group/i.test(String(notice.title)), JSON.stringify(notice))

const provenance = await ev(`(async () => {
  const s = JSON.parse(localStorage.getItem('chronocampus.demo.v7'))
  const m = s.group_members.find(x => x.group_id === ${JSON.stringify(target.groupId)} && String(x.user_id) === ${JSON.stringify(target.chemistry?.id)})
  return { added_by: m.added_by_name, at: m.added_at, role: m.role, source: m.source }
})()`)
ok('the membership records who added it and when', provenance.added_by === target.mentorName && Boolean(provenance.at) && provenance.role === 'teacher', JSON.stringify(provenance))
const log = await ev(`(async () => await window.__db.groupMembershipLog(${JSON.stringify(target.groupId)}, { profile: { id: ${JSON.stringify(target.mentor)} } }))()`)
ok('the membership log shows the change', log.some(l => l.action === 'teacher.add' && l.teacher === target.chemistry?.name), JSON.stringify(log.slice(0, 2)))

console.log('\n— scenario: the added teacher sees the group —')
const chemList = await ev(`(async () => {
  const r = await window.__db.listGroups({ profile: { id: ${JSON.stringify(target.chemistry?.id)}, role: 'teacher' } })
  const g = r.find(x => x.id === ${JSON.stringify(target.groupId)})
  return { total: r.length, found: Boolean(g), role: g?.my_role, name: g?.class_section }
})()`)
ok('it appears under their My Class Groups', chemList.found && chemList.role === 'teacher', JSON.stringify(chemList))
const manageDenied = await ev(`(async () => {
  try { await window.__db.groupCandidateTeachers(${JSON.stringify(target.groupId)}, { profile: { id: ${JSON.stringify(target.physics?.id)}, role: 'teacher' } }); return 'allowed' }
  catch (e) { return e.code }
})()`)
ok('a teacher who is not the class teacher cannot manage the list', manageDenied === 'not_manager', String(manageDenied))
const addDenied = await ev(`(async () => {
  try { await window.__db.addGroupTeachers(${JSON.stringify(target.groupId)}, [${JSON.stringify(target.physics?.id)}], { actor: { id: ${JSON.stringify(target.chemistry?.id)}, name: 'x' } }); return 'allowed' }
  catch (e) { return e.code }
})()`)
ok('an added teacher cannot add other teachers', addDenied === 'not_manager', String(addDenied))

/* ------------------------------------------------------------- 4. students */
console.log('\n— students and their own class only —')
const stuA = await ev(`(async () => {
  const s = JSON.parse(localStorage.getItem('chronocampus.demo.v7'))
  const a = s.profiles.find(p => p.email === 'aanya.iyer@student.chronocampus.edu.in')
  const b = s.profiles.find(p => p.email === 'mannat.kaur@student.chronocampus.edu.in')
  return { a: { id: a.id, cls: a.class_section }, b: { id: b.id, cls: b.class_section } }
})()`)
const studentView = await ev(`(async () => {
  const list = await window.__db.listGroups({ profile: { id: ${JSON.stringify(stuA.a.id)}, role: 'student', class_section: ${JSON.stringify(stuA.a.cls)} } })
  return { n: list.length, first: list[0]?.class_section, role: list[0]?.my_role }
})()`)
ok('a student sees only their own class group', studentView.n === 1 && studentView.role === 'student', JSON.stringify(studentView))
const outsider = await ev(`(async () => {
  try { await window.__db.getGroup(${JSON.stringify(target.groupId)}, { profile: { id: ${JSON.stringify(stuA.b.id)}, role: 'student' } }); return 'allowed' }
  catch (e) { return e.code }
})()`)
ok('a student from another class is refused', outsider === 'group_forbidden', String(outsider))
const studentThread = await ev(`(async () => {
  const note = await window.__db.postToGroup({ groupId: ${JSON.stringify(target.groupId)}, body: 'Revision sheet for this week is on the notice board.', kind: 'announcement', author: { id: ${JSON.stringify(target.mentor)}, name: ${JSON.stringify(target.mentorName)} } })
  try { return await window.__db.postToGroup({ groupId: ${JSON.stringify(target.groupId)}, parentId: note.id, body: 'Ma’am, may I submit the practical file on Monday?', author: { id: ${JSON.stringify(stuA.a.id)}, name: 'Aanya Iyer' } }) }
  catch (e) { return { code: e.code, msg: e.message } }
})()`)
ok('a student may comment on a post', !studentThread.code, JSON.stringify(studentThread).slice(0, 90))
const studentReply = await ev(`(async () => {
  const g = await window.__db.getGroup(${JSON.stringify(target.groupId)}, { profile: { id: ${JSON.stringify(stuA.a.id)}, role: 'student' } })
  const withComments = g.posts.filter(p => p.comments.length)
  return { threads: withComments.length, mine: withComments.some(p => p.comments.some(c => String(c.author_id) === ${JSON.stringify(stuA.a.id)})) }
})()`)
ok('the comment appears under the post for the student', studentReply.mine, JSON.stringify(studentReply))
const studentAnnounce = await ev(`(async () => {
  try { return await window.__db.postToGroup({ groupId: ${JSON.stringify(target.groupId)}, body: 'Everyone please read this', kind: 'announcement', author: { id: ${JSON.stringify(stuA.a.id)}, name: 'Aanya' } }) }
  catch (e) { return { code: e.code } }
})()`)
ok('a student cannot publish to the group', studentAnnounce.code === 'student_post_locked', JSON.stringify(studentAnnounce))

/* ---------------------------------------------------------------- 5. posts */
console.log('\n— the feed —')
const feed = await ev(`(async () => {
  const g = await window.__db.getGroup(${JSON.stringify(target.groupId)}, { profile: { id: ${JSON.stringify(target.mentor)}, role: 'teacher' } })
  return { posts: g.posts.length, pinned: g.posts.filter(p => p.pinned).length, teachers: g.teachers.length, students: g.students.length, kinds: [...new Set(g.posts.map(p => p.kind))].join(','), comments: g.posts.reduce((n, p) => n + p.comments.length, 0) }
})()`)
ok('the group opens with its feed', feed.posts > 0, JSON.stringify(feed))
const made = await ev(`(async () => await window.__db.postToGroup({ groupId: ${JSON.stringify(target.groupId)}, body: 'Physics practical is moved to the Smart Lab on Thursday — bring the observation sheet.', kind: 'announcement', author: { id: ${JSON.stringify(target.mentor)}, name: ${JSON.stringify(target.mentorName)} } }))()`)
ok('the class teacher publishes', Boolean(made.id), made.kind)
const pinned = await ev(`(async () => await window.__db.setPostPinned(${JSON.stringify(made.id)}, true, { actor: { id: ${JSON.stringify(target.mentor)}, name: 'x' } }))()`)
ok('the class teacher pins an announcement', pinned.pinned === true)
const pinDenied = await ev(`(async () => {
  try { await window.__db.setPostPinned(${JSON.stringify(made.id)}, false, { actor: { id: ${JSON.stringify(target.chemistry?.id)}, name: 'x' } }); return 'allowed' }
  catch (e) { return e.code }
})()`)
ok('an added teacher cannot pin', pinDenied === 'not_moderator', String(pinDenied))
const reacted = await ev(`(async () => await window.__db.reactToPost(${JSON.stringify(made.id)}, { actor: { id: ${JSON.stringify(target.chemistry?.id)}, name: 'x' } }))()`)
ok('members can react', Object.keys(reacted.reactions || {}).length >= 1, JSON.stringify(reacted.reactions))
const removed = await ev(`(async () => await window.__db.removePost(${JSON.stringify(made.id)}, { actor: { id: ${JSON.stringify(target.mentor)}, name: 'x' } }))()`)
ok('the class teacher can take down a post', removed.removed === true)
const goneFromFeed = await ev(`(async () => {
  const g = await window.__db.getGroup(${JSON.stringify(target.groupId)}, { profile: { id: ${JSON.stringify(target.mentor)} } })
  return g.posts.some(p => p.id === ${JSON.stringify(made.id)})
})()`)
ok('a removed post leaves the feed', goneFromFeed === false)
const keptRow = await ev(`(async () => {
  const s = JSON.parse(localStorage.getItem('chronocampus.demo.v7'))
  const p = s.group_posts.find(x => x.id === ${JSON.stringify(made.id)})
  return { exists: Boolean(p), removed_at: Boolean(p?.removed_at) }
})()`)
ok('but the row is kept for moderation history', keptRow.exists && keptRow.removed_at)

/* ------------------------------------------------------------ 6. lifecycle */
console.log('\n— a new class-section gets its group —')
const fresh = await ev(`(async () => {
  const meta = { id: 'sec-9e-test', name: '9-E Test', grade: 9, section: 'E', stream: 'General', band: 'secondary', group: 'junior', bell_schedule_id: 'bell-junior', mentor_teacher_id: ${JSON.stringify(target.physics?.id)}, default_room: 'Room 950', is_active: true, curriculum: { English: 6 } }
  await window.__db.saveSection(meta)
  const s = JSON.parse(localStorage.getItem('chronocampus.demo.v7'))
  const g = s.class_groups.find(x => String(x.class_section_id) === 'sec-9e-test')
  const m = s.group_members.filter(x => x.group_id === g?.id && x.active !== false)
  return { group: Boolean(g), manager: m.some(x => x.role === 'manager' && String(x.user_id) === ${JSON.stringify(target.physics?.id)}) }
})()`)
ok('saving a section provisions its group', fresh.group, JSON.stringify(fresh))
ok('and makes its class teacher the manager', fresh.manager)

const moved = await ev(`(async () => {
  const out = await window.__db.setClassTeacher('sec-9e-test', ${JSON.stringify(target.chemistry?.id)}, { actor: { id: 'adm-01', name: 'Col. S. S. Gill' } })
  const s = JSON.parse(localStorage.getItem('chronocampus.demo.v7'))
  const g = s.class_groups.find(x => String(x.class_section_id) === 'sec-9e-test')
  const rows = s.group_members.filter(m => m.group_id === g.id)
  return { out, teacher: g.class_teacher_id, oldActive: rows.find(m => String(m.user_id) === ${JSON.stringify(target.physics?.id)})?.active, newActive: rows.find(m => String(m.user_id) === ${JSON.stringify(target.chemistry?.id)})?.active }
})()`)
ok('reassigning moves the manager role', moved.teacher === target.chemistry?.id && moved.newActive === true && moved.oldActive === false, JSON.stringify(moved))

const archived = await ev(`(async () => {
  await window.__db.setGroupActive('grp-sec-9e-test'.replace('grp-sec-', 'grp-'), false, { actor: { id: 'adm-01', name: 'x' } })
  const s = JSON.parse(localStorage.getItem('chronocampus.demo.v7'))
  const g = s.class_groups.find(x => String(x.class_section_id) === 'sec-9e-test')
  try { await window.__db.postToGroup({ groupId: g.id, body: 'late note', author: { id: ${JSON.stringify(target.chemistry?.id)}, name: 'x' } }); return { locked: false } }
  catch (e) { return { locked: e.code === 'group_archived', gid: g.id } }
})()`)
ok('archiving a group makes it read-only', archived.locked, JSON.stringify(archived))

const afterDelete = await ev(`(async () => {
  const s = JSON.parse(localStorage.getItem('chronocampus.demo.v7'))
  const postsBefore = s.group_posts.filter(p => String(p.group_id) === ${JSON.stringify(archived.gid)}).length
  await window.__db.deleteSection('sec-9e-test')
  const s2 = JSON.parse(localStorage.getItem('chronocampus.demo.v7'))
  const g = s2.class_groups.find(x => String(x.class_section_id) === 'sec-9e-test')
  return { sectionGone: !s2.class_sections.some(c => c.id === 'sec-9e-test'), groupKept: Boolean(g), active: g?.is_active, postsBefore, postsAfter: s2.group_posts.filter(p => String(p.group_id) === ${JSON.stringify(archived.gid)}).length }
})()`)
ok('deleting the class keeps the group and its posts', afterDelete.sectionGone && afterDelete.groupKept && afterDelete.active === false && afterDelete.postsAfter === afterDelete.postsBefore, JSON.stringify(afterDelete))

/* --------------------------------------------------------------- 7. admin */
console.log('\n— the admin outranks everything —')
const adminSees = await ev(`(async () => {
  const r = await window.__db.listGroups({ profile: { id: 'adm-01', role: 'admin' } })
  return { n: r.length, withTeacher: r.filter(x => x.class_teacher).length, mine: r.filter(x => x.my_role === 'admin').length }
})()`)
ok('the admin lists every group', adminSees.n >= 56 && adminSees.mine === adminSees.n, JSON.stringify(adminSees))
ok('and sees the assigned class teacher on each', adminSees.withTeacher > 50, `${adminSees.withTeacher}`)
const adminRemove = await ev(`(async () => {
  try { return await window.__db.removeGroupTeacher(${JSON.stringify(target.groupId)}, ${JSON.stringify(target.chemistry?.id)}, { actor: { id: 'adm-01', name: 'Col. S. S. Gill' } }) }
  catch (e) { return { error: e.message } }
})()`)
ok('the admin can remove any teacher', !adminRemove.error && adminRemove.removed === target.chemistry?.name, JSON.stringify(adminRemove))
const managerRemoveSelf = await ev(`(async () => {
  try { await window.__db.removeGroupTeacher(${JSON.stringify(target.groupId)}, ${JSON.stringify(target.mentor)}, { actor: { id: 'adm-01', name: 'x' } }); return 'allowed' }
  catch (e) { return e.code }
})()`)
ok('nobody removes the class teacher through the member list', managerRemoveSelf === 'is_class_teacher', String(managerRemoveSelf))
const unregistered = await ev(`(async () => {
  const r = await window.__db.addGroupTeachers(${JSON.stringify(target.groupId)}, ['ghost-99'], { actor: { id: 'adm-01', name: 'x' } })
  return r
})()`)
ok('an unregistered teacher cannot be added at all', unregistered.rejected?.length === 1 && !unregistered.added?.length, JSON.stringify(unregistered))

const realErrors = errors.filter((e) => !/Download|favicon|blob:|ResizeObserver/.test(e))
ok('no runtime errors while running the scenarios', realErrors.length === 0, realErrors.slice(0, 2).join(' / '))

await ev(`(() => { localStorage.removeItem('chronocampus.demo.v7'); return 1 })()`)
console.log(`\n${pass + fails.length} checks, ${fails.length} failed`)
fails.forEach((f) => console.log(`  !! ${f}`))
ws.close()
await fetch(`${BASE}/json/close/${t.id}`)
process.exit(fails.length ? 1 : 0)
