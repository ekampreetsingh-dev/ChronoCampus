/**
 * Contrast audit: every visible text element on the main routes, in both themes,
 * measured against the background it actually sits on (the first opaque ancestor,
 * composited over the page canvas). Reports the worst offenders per WCAG AA —
 * 4.5:1 for body text, 3:1 for 18px+ or 14px+ bold.
 */
const BASE = 'http://127.0.0.1:9222'
const APP = 'http://127.0.0.1:5175'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ROUTES = [
  ['login', '/login', null],
  ['admin', '/admin', 'admin'],
  ['timetable', '/admin/timetable', 'admin'],
  ['sections', '/admin/sections', 'admin'],
  ['analytics', '/admin/workload', 'admin'],
  ['codes', '/admin/codes', 'admin'],
  ['teacher', '/teacher/timetable', 'teacher'],
  ['student', '/student', 'student'],
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
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id).resolve(m.result)
    pending.delete(m.id)
  }
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

const PROBE = `(() => {
  const hex = (v) => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v).trim());
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  };
  const parse = (c) => {
    const hx = hex(c);
    if (hx) return hx;
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (m) {
      const p = m[1].split(',').map((x) => parseFloat(x));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    // color-mix() reports back as color(srgb 0.1 0.2 0.3 / 0.6), which browsers
    // return verbatim from getComputedStyle — read it or the whole board looks transparent.
    const s = String(c).match(/color\\(\\s*srgb\\s+([^)]+)\\)/);
    if (s) {
      const parts = s[1].trim().split(/\\s*\\/\\s*|\\s+/).filter(Boolean).map(Number);
      const ch = parts.slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
      return { r: ch[0], g: ch[1], b: ch[2], a: parts.length > 3 ? parts[3] : 1 };
    }
    return null;
  };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) };
  const root = getComputedStyle(document.documentElement);
  // A transparent background still parses to an object, so take the first opaque one.
  const canvas =
    [parse(getComputedStyle(document.body).backgroundColor), parse(getComputedStyle(document.documentElement).backgroundColor), parse(root.getPropertyValue('--color-canvas'))]
      .find((c) => c && c.a > 0.9) || { r: 234, g: 242, b: 248, a: 1 };

  const out = [];
  const seen = new Set();
  // A modal dims the page behind it on purpose, so only the dialog's own text is measured
  const dlg = document.querySelector('[role=dialog]');
  for (const el of document.querySelectorAll('body *')) {
    if (dlg && !el.closest('[role=dialog]')) continue;
    const txt = (el.textContent || '').trim();
    if (!txt || el.children.length) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.15) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3 || r.bottom < 0 || r.top > innerHeight * 3) continue;
    const fg = parse(cs.color);
    if (!fg) continue;

    // Layers must be composited root-first: walking child→root and painting as
    // you go puts a modal's own scrim on top of the dialog, which is backwards.
    const layers = [];
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const c = parse(getComputedStyle(a).backgroundColor);
      if (c && c.a > 0) layers.push(c);
    }
    let bg = { r: canvas.r, g: canvas.g, b: canvas.b, a: 1 };
    for (const c of layers.reverse()) bg = over(c, bg);
    const ink = over(fg, bg);
    const size = parseFloat(cs.fontSize) || 12;
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const got = ratio(ink, bg);
    if (got >= need) continue;
    const key = el.className + '|' + txt.slice(0, 18);
    if (seen.has(key)) continue;
    seen.add(key);
    void 0; out.push({ fg: JSON.stringify(fg), bg: JSON.stringify(bg), canvas: JSON.stringify(canvas), ratio: Math.round(got * 100) / 100, need, size: Math.round(size), txt: txt.slice(0, 26), cls: String(el.className).slice(0, 40) });
  }
  return out.sort((a, b) => a.ratio - b.ratio).slice(0, 8);
})()`

let total = 0
const worst = []
for (const theme of ['light', 'dark']) {
  for (const [name, path, role] of ROUTES) {
    if (role) await ev(`localStorage.setItem('chronocampus.session.v2', JSON.stringify(${JSON.stringify(SESSIONS[role])}))`)
    // the app owns the theme attribute and writes it from storage on mount, so the
    // theme is chosen where the app chooses it — not by setting the attribute here
    await ev(`localStorage.setItem('chronocampus.theme', ${JSON.stringify(theme)})`)
    await send('Page.navigate', { url: `${APP}${path}` })
    for (let i = 0; i < 30; i += 1) {
      await sleep(400)
      if (await ev(`document.body.innerText.trim().length > 60`)) break
    }
    await sleep(900)
    const applied = (await ev(`document.documentElement.getAttribute('data-theme')`)) || 'light'
    if (applied !== theme) {
      console.log(`${theme.padEnd(6)} ${name.padEnd(12)} SKIPPED (app is on "${applied}")`)
      continue
    }
    const bad = (await ev(PROBE)) || []
    total += bad.length
    if (bad.length) {
      console.log(`\n${theme} · ${name}`)
      bad.forEach((b) => console.log(`   ${String(b.ratio).padStart(5)}:1 ${b.size}px "${b.txt}" fg=${b.fg} bg=${b.bg}`))
      bad.forEach((b) => worst.push(`${theme}/${name}: ${b.ratio}:1 "${b.txt}"`))
    } else {
      console.log(`${theme.padEnd(6)} ${name.padEnd(12)} clean`)
    }
  }
}
console.log(`\n${total} elements below AA across ${ROUTES.length * 2} page/theme combinations`)
ws.close()
await fetch(`${BASE}/json/close/${t.id}`)
