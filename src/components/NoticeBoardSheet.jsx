import { createPortal } from 'react-dom'
import { DAYS, interludesFor, periodsFor } from '../lib/bellSchedule'
import { roomShort } from '../lib/subjects'

/**
 * Paper output for the notice board. A translucent screen UI would waste a
 * teacher's ink, so this sheet is deliberately light: ink colours from the
 * token set (`--color-ink`, `--color-shell`), a real table, and the class's own
 * bell schedule — including its breaks — read off the data, not remembered.
 *
 * It renders identically on screen (preview) and on paper, because the only
 * thing that changes at print time is which wrapper is visible.
 */

const initialsOf = (name = '') =>
  String(name)
    .split(' ')
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0].toUpperCase())
    .join('')

export function NoticeBoardSheet({
  classSection,
  slots = [],
  school = 'ChronoCampus Public School',
  session = 'Session 2026–27',
}) {
  const rows = periodsFor(classSection)
  const gaps = interludesFor(rows)
  /* A sheet is one class's: whatever it is handed is narrowed to that section, so
     paper can never carry another class's period. */
  const own = slots.filter((s) => !s.class_section || s.class_section === classSection)
  const byCell = new Map(own.map((s) => [`${s.day}|${Number(s.period)}`, s]))
  const placed = own.length
  const assigned = rows.length * DAYS.length

  return (
    <div className="print-sheet bg-shell text-ink w-full min-w-[680px] max-w-[1120px] mx-auto rounded-[10px] px-4 py-3">
      <header className="print-head flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-2 border-[color:var(--color-line-strong)] pb-2 mb-2">
        <div className="min-w-0">
          <h2 className="display text-lg font-extrabold leading-none tracking-tight">{school}</h2>
          <p className="text-2xs mt-1 leading-none">
            Weekly Timetable · <strong>{classSection || 'Unassigned class'}</strong>
          </p>
        </div>
        <div className="text-right min-w-0">
          <p className="num text-2xs leading-none">{session}</p>
          <p className="num text-2xs leading-none mt-1">
            Printed {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          </p>
          <p className="num text-2xs leading-none mt-1">
            {rows.length} bells × {DAYS.length} days · {placed} of {assigned} cells filled
          </p>
        </div>
      </header>

      <table className="w-full border-collapse">
        <caption className="sr-only">
          Weekly timetable for {classSection || 'this class'} — {rows.length} periods across {DAYS.length} days
        </caption>
        <thead>
          <tr>
            <th scope="col" className="w-[74px] border border-[color:var(--color-line-strong)] bg-[color:var(--cell-empty)] px-1 py-1 text-2xs">
              Bell / Time
            </th>
            {DAYS.map((d) => (
              <th key={d} scope="col" className="border border-[color:var(--color-line-strong)] bg-[color:var(--cell-empty)] px-1 py-1 text-2xs">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <PrintRow
              key={p.n}
              period={p}
              next={rows[i + 1]}
              gap={gaps.find((g) => g.after === p.n)}
              byCell={byCell}
            />
          ))}
        </tbody>
      </table>

      <footer className="mt-3 pt-2 border-t border-[color:var(--color-line-strong)] flex flex-wrap items-end justify-between gap-3">
        <p className="text-2xs leading-snug max-w-[62ch] min-w-0">
          Substitutions are marked <em>SUB</em> and override the printed teacher. Room changes are effective until rescinded by
          the office. A blank cell is a free period, not a missing one.
        </p>
        <div className="flex gap-6 shrink-0">
          <span className="text-2xs">
            <span className="block w-[92px] border-b border-[color:var(--color-line-strong)] mb-1" aria-hidden />
            Class Teacher
          </span>
          <span className="text-2xs">
            <span className="block w-[92px] border-b border-[color:var(--color-line-strong)] mb-1" aria-hidden />
            Principal
          </span>
        </div>
      </footer>
    </div>
  )
}

function PrintRow({ period, next, gap, byCell }) {
  const interlude = gap ? (gap.minutes >= 40 ? 'Lunch' : 'Break') : null
  const cell = 'border border-[color:var(--color-line-strong)] align-top px-1.5 py-1 text-2xs leading-tight'

  return (
    <>
      <tr>
        <th scope="row" className={`${cell} text-center font-semibold whitespace-nowrap`}>
          <span className="num block">{period.label || `P${period.n}`}</span>
          <span className="num block font-normal">{period.start}</span>
        </th>
        {DAYS.map((d) => {
          const s = byCell.get(`${d}|${period.n}`)
          return (
            <td key={d} className={cell}>
              {s ? (
                <>
                  <span className="block font-bold">{s.subject}</span>
                  <span className="block">
                    {s.is_substitution
                      ? `SUB ${initialsOf(s.substitute_teacher_name)} · ${s.substitute_teacher_name}`
                      : `${initialsOf(s.teacher_name)} · ${s.teacher_name || 'unassigned'}`}
                  </span>
                  {s.room ? <span className="block">{roomShort(s.room)}</span> : null}
                </>
              ) : (
                <span aria-hidden>—</span>
              )}
            </td>
          )
        })}
      </tr>
      {interlude ? (
        <tr>
          <td colSpan={DAYS.length + 1} className="border border-[color:var(--color-line-strong)] bg-[color:var(--cell-empty)] px-2 py-0.5 text-center">
            <span className="text-2xs font-bold uppercase tracking-[0.18em]">
              {interlude} · {period.end} → {next?.start || ''} · {gap.minutes} min
            </span>
          </td>
        </tr>
      ) : null}
    </>
  )
}

/**
 * Body-level print target. On screen it is hidden; in print it is the only thing
 * left standing, so what reaches the paper is the sheet and nothing else — no
 * glass, no chrome, no duplicated preview.
 */
export function PrintLayer({ job }) {
  if (!job) return null
  return createPortal(
    <>
      <style>{`@media print {
        @page { size: A4 landscape; margin: 12mm; }
        #print-root { display: block !important; }
        #root, .modal, .scrim, .drawer, .toast { display: none !important; }
        body { background: #fff; }
      }`}</style>
      <div id="print-root" style={{ display: 'none' }}>
        <NoticeBoardSheet {...job} />
      </div>
    </>,
    document.body,
  )
}
