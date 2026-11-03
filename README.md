# ChronoCampus

Timetable and academic operations for a school: one weekly board, three doors (principal, teacher, student), built with React + Vite, Tailwind CSS v4, Framer Motion, Lucide and Supabase.

Runs fully interactive with **no backend configured** — Pitch Mode loads a complete demo school. Add Supabase keys and the same screens read and write live rows.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5175  — Pitch Mode, demo school
```

To go live:

```bash
cp .env.example .env # paste VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
# run supabase/schema.sql once in the Supabase SQL editor
npm run dev
```

Flip between the two at any time with the **Pitch Mode / Live Mode** switch in the navbar.

## Routes

| Route | Who | What |
| --- | --- | --- |
| `/login` | anyone | Google OAuth or email/password. Role is never chosen here. |
| `/admin` | admin | 4 tabs: Timetable Builder, Substitutes, Staff & Class Codes, Workload & Print |
| `/teacher` | teacher | Own week, free periods, substitution banner, homework drawer |
| `/student` | student | Read-only class board, Live Now & Up Next, homework per period |

Role comes from `public.profiles`, which a database trigger fills from `allowed_admins` / `allowed_teachers` on first sign-in. Everyone else lands as a student and must verify a class code before the board unlocks.

## The parts worth knowing

**Conflict engine** — `src/lib/conflicts.js` is pure over a slot array, so it behaves identically against Supabase rows and demo data. `checkSlot()` runs before every save and returns the exact clash plus the free teachers and rooms; `auditConflicts()` scans a whole imported board. The same rule is enforced again in Postgres by the `slot_conflict_guard` trigger, so a bad write cannot bypass the UI.

**Substitutions** — marking a teacher absent lists their periods for the day, and each row offers only teachers whose timetable is empty at that exact bell, subject-matches first.

**Class codes** — `verify_student_class_code(p_class_section, p_access_code)` compares the code server-side and updates the profile only on a match. Codes are never readable by students. The same modal is reused for promotion.

**Pitch Mode** — `src/lib/pitchStore.js` builds the week with a most-needed-first scheduler, so the seeded timetable is clash-free by construction and persisted to `localStorage`. Outside real school hours the navbar clock runs a labelled `SIM` day so the live rail is always demoable; the switcher can jump it to any period.

**Print** — `PrintLayer` renders the notice board into a body-level `#print-root`; `@media print` hides the app and shows only that paper sheet, ink-first, A4 landscape.

## Design tokens

`src/index.css` holds the token layer. Surfaces are layered near-black (`void #080b14` → `surface #101625` → `elevated #161d2f`) with low-alpha white hairlines instead of hard borders. Indigo `#4f46e5` carries brand actions; gold `#f2b33d` is reserved for **time** — the live rail, the bell countdown, the period progress. Type is Space Grotesk (display), Manrope (body), JetBrains Mono (periods, codes, rooms).

Semantic badges: cyan = science and labs, purple = core academic, emerald = free period, rose = conflict, amber = substitution.

## Scripts

```bash
npm run dev      # vite
npm run build    # production build to dist/
npm run preview  # serve the build
```

Verification harnesses live in `scripts/`:

```bash
npx esbuild scripts/check-engine.mjs --bundle --platform=node --format=esm --outfile=engine.mjs && node engine.mjs   # conflict engine, 14 assertions
npx esbuild scripts/check-seed.mjs   --bundle --platform=node --format=esm --outfile=seed.mjs   && node seed.mjs     # demo school integrity report
node scripts/shot.mjs        # drives a Chrome on :9222, screenshots every portal at 1366x657, audits overflow + console errors
node scripts/print-check.mjs # emulates print media and writes shots/notice-board.pdf
```
