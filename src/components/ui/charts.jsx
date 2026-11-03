import { useMemo } from 'react'
import { useId } from 'react'
import { Card } from './primitives'

/* ------------------------------------------------------------------ helpers */

const safe = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0)
const clampPct = (n) => Math.max(0, Math.min(100, safe(n)))

const niceMax = (max) => {
  if (max <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(max))
  const stepped = Math.ceil(max / mag) * mag
  return stepped === 0 ? mag : stepped
}

const path = (points) => points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')

/* ------------------------------------------------------------------ cards */

export function ChartCard({ title, sub, right, children, footer, className, tone }) {
  return (
    <Card tone={tone} className={`flex flex-col ${className || ''}`}>
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div className="min-w-0">
          <h3 className="display text-sm font-bold t1 truncate">{title}</h3>
          {sub ? <p className="meta mt-0.5">{sub}</p> : null}
        </div>
        {right ? <div className="shrink-0 flex items-center gap-2">{right}</div> : null}
      </div>
      <div className="px-4 pb-4 flex-1 min-w-0">{children}</div>
      {footer ? (
        <div className="px-4 py-3 border-t border-[color:var(--color-line-soft)] text-xs t3">{footer}</div>
      ) : null}
    </Card>
  )
}

/* ------------------------------------------------------------------ progress */

export function ProgressBar({ value = 0, max = 100, tone = 'brand', label, sub, height = 7, className, showPct = true }) {
  const pct = clampPct((safe(value) / (safe(max) || 1)) * 100)
  return (
    <div data-tone={tone} className={className}>
      {label ? (
        <div className="flex items-baseline justify-between gap-3 mb-1.5">
          <span className="text-xs font-semibold t2 truncate">{label}</span>
          {showPct ? <span className="num text-2xs t3 tabular-nums">{Math.round(pct)}%</span> : null}
        </div>
      ) : null}
      <div className="bar-track" style={{ height }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label || sub || 'Progress'}>
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      {sub ? <p className="meta mt-1.5">{sub}</p> : null}
    </div>
  )
}

export function Ring({ value = 0, max = 100, tone = 'brand', size = 84, label, sub }) {
  const pct = clampPct((safe(value) / (safe(max) || 1)) * 100)
  return (
    <div data-tone={tone} className="flex items-center gap-3">
      <span className="ring" style={{ '--pct': pct, width: size, height: size }}>
        <span className="grid place-content-center w-full h-full rounded-full bg-[color:var(--glass-2)]">
          <span className="num text-md font-extrabold t1 leading-none">{Math.round(pct)}%</span>
        </span>
      </span>
      {label ? (
        <span className="min-w-0">
          <span className="block text-sm font-bold t1">{label}</span>
          {sub ? <span className="block meta mt-0.5">{sub}</span> : null}
        </span>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ sparkline */

export function Sparkline({ points = [], width = 104, height = 30, tone = 'brand', className }) {
  const gid = useId()
  const vals = points.map(safe)
  if (vals.length < 2) return <svg width={width} height={height} className={className} aria-hidden />
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const step = width / (vals.length - 1)
  const coords = vals.map((v, i) => ({ x: i * step, y: height - 3 - ((v - min) / span) * (height - 6) }))
  const line = path(coords)

  return (
    <svg data-tone={tone} width={width} height={height} className={className} role="img" aria-label={`Trend over ${vals.length} points`}>
      <defs>
        <linearGradient id={`spark-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--tone)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--tone)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${line} ${width},${height}`} fill={`url(#spark-${gid})`} />
      <polyline points={line} fill="none" stroke="var(--tone)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r="2.4" fill="var(--tone)" />
    </svg>
  )
}

/* ------------------------------------------------------------------ bar chart */

/**
 * Pill-topped columns, the reference-5 form. `data` is [{ label, value, tone? }].
 * Heights are derived from the real maximum, so nothing is decorative.
 */
export function BarChart({ data = [], height = 220, valueFormat = (v) => v, label = 'Value', className }) {
  const rows = data.map((d) => ({ ...d, value: safe(d.value ?? d) }))
  const max = niceMax(Math.max(...rows.map((r) => r.value), 0))
  const ticks = [max, max / 2, 0]

  return (
    <figure className={`m-0 ${className || ''}`}>
      <div className="flex gap-2 h-full" style={{ height }}>
        <div className="flex flex-col justify-between w-[42px] shrink-0 text-right pb-6">
          {ticks.map((t) => (
            <span key={t} className="meta tabular-nums">
              {valueFormat(t)}
            </span>
          ))}
        </div>
        <div className="flex-1 min-w-0 flex items-end gap-1.5 sm:gap-2 border-b border-[color:var(--color-line)] pb-0">
          {rows.map((r, i) => (
            <div key={`${r.label}-${i}`} className="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-1.5">
              <div
                data-tone={r.tone || 'brand'}
                className="w-full rounded-t-full transition-[height] duration-500 ease-[cubic-bezier(.22,1,.36,1)]"
                style={{
                  height: `${(r.value / (max || 1)) * 100}%`,
                  minHeight: r.value > 0 ? 6 : 2,
                  background: 'linear-gradient(180deg, var(--tone), color-mix(in oklab, var(--tone) 62%, white))',
                  opacity: r.value > 0 ? 1 : 0.35,
                }}
                title={`${r.label}: ${valueFormat(r.value)}`}
              >
                <span className="sr-only">{`${r.label}: ${valueFormat(r.value)}`}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-1.5 sm:gap-2 pl-[50px] mt-2">
        {rows.map((r, i) => (
          <span key={`${r.label}-x-${i}`} className="flex-1 min-w-0 text-center meta truncate">
            {r.label}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  )
}

/* ------------------------------------------------------------------ donut */

export function DonutChart({ data = [], size = 180, thickness = 24, centerLabel, centerValue, className }) {
  const rows = useMemo(
    () => data.map((d) => ({ ...d, value: safe(d.value ?? d) })).filter((d) => d.value > 0),
    [data],
  )
  const total = rows.reduce((n, d) => n + d.value, 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offset = 0

  return (
    <div className={`flex flex-wrap items-center gap-5 ${className || ''}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={centerLabel || 'Distribution'} className="shrink-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--cell-empty)" strokeWidth={thickness} />
        {total > 0 &&
          rows.map((d) => {
            const frac = d.value / total
            const dash = frac * c
            const el = (
              <circle
                key={d.label}
                data-tone={d.tone || 'brand'}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke="var(--tone)"
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              >
                <title>{`${d.label}: ${d.value}`}</title>
              </circle>
            )
            offset += dash
            return el
          })}
      </svg>
      <div className="min-w-[120px] flex-1">
        <p className="num text-2xl font-extrabold t1 leading-none">{centerValue ?? total}</p>
        {centerLabel ? <p className="meta mt-1">{centerLabel}</p> : null}
        <ul className="list-none m-0 p-0 mt-3 space-y-1.5">
          {rows.map((d) => (
            <li key={d.label} data-tone={d.tone || 'brand'} className="flex items-center gap-2 min-w-0">
              <span className="dot shrink-0" aria-hidden />
              <span className="text-xs font-semibold t2 truncate">{d.label}</span>
              <span className="num text-2xs t3 ml-auto tabular-nums shrink-0">
                {total ? Math.round((d.value / total) * 100) : 0}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ h-bars */

export function HBarList({ data = [], valueFormat = (v) => v, max, className, tone = 'brand' }) {
  const rows = data.map((d) => ({ ...d, value: safe(d.value ?? d) }))
  const top = safe(max) || Math.max(...rows.map((r) => r.value), 1)
  if (!rows.length) return <p className="text-sm t3 py-2">No data yet.</p>
  return (
    <ul className={`list-none m-0 p-0 space-y-2.5 ${className || ''}`}>
      {rows.map((r, i) => (
        <li key={`${r.label}-${i}`} data-tone={r.tone || tone} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-xs font-semibold t1 truncate">{r.label}</span>
            <span className="num text-2xs t2 tabular-nums shrink-0">
              {valueFormat(r.value)}
              {r.sub ? <span className="t3 font-medium"> · {r.sub}</span> : null}
            </span>
          </div>
          <div className="bar-track" style={{ height: 6 }}>
            <div className="bar-fill" style={{ width: `${clampPct((r.value / (top || 1)) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ area line */

export function AreaLine({ series = [], xLabels = [], height = 200, yFormat = (v) => v, className }) {
  const gid = useId()
  const w = 600
  const pad = { l: 44, r: 12, t: 12, b: 24 }
  const all = series.flatMap((s) => s.values.map(safe))
  const max = niceMax(Math.max(...all, 0))
  const innerW = w - pad.l - pad.r
  const innerH = height - pad.t - pad.b
  const count = Math.max(xLabels.length, 1)
  const x = (i) => pad.l + (count === 1 ? innerW / 2 : (i / (count - 1)) * innerW)
  const y = (v) => pad.t + innerH - (safe(v) / (max || 1)) * innerH

  return (
    <figure className={`m-0 ${className || ''}`}>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} role="img" aria-label="Trend over time">
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`area-${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--tone)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--tone)" stopOpacity="0.02" />
            </linearGradient>
          ))}
        </defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={pad.l}
              x2={w - pad.r}
              y1={pad.t + innerH * f}
              y2={pad.t + innerH * f}
              stroke="var(--color-line)"
              strokeWidth="1"
              strokeDasharray={f === 1 ? '' : '3 4'}
            />
            <text x={pad.l - 8} y={pad.t + innerH * f + 4} textAnchor="end" className="meta" fill="var(--text-3)" fontSize="11">
              {yFormat(max * (1 - f))}
            </text>
          </g>
        ))}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => ({ x: x(i), y: y(v) }))
          const line = path(pts)
          return (
            <g key={s.name || si} data-tone={s.tone || 'brand'}>
              <polygon points={`${pad.l},${pad.t + innerH} ${line} ${x(s.values.length - 1)},${pad.t + innerH}`} fill={`url(#area-${gid}-${si})`} />
              <polyline points={line} fill="none" stroke="var(--tone)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="2.6" fill="var(--tone)">
                  <title>{`${s.name} · ${xLabels[i] || ''}: ${yFormat(s.values[i])}`}</title>
                </circle>
              ))}
            </g>
          )
        })}
        {xLabels.map((l, i) => (
          <text key={`${l}-${i}`} x={x(i)} y={height - 6} textAnchor="middle" className="meta" fill="var(--text-3)" fontSize="11">
            {l}
          </text>
        ))}
      </svg>
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 list-none m-0 p-0 mt-1">
          {series.map((s, i) => (
            <li key={s.name || i} data-tone={s.tone || 'brand'} className="flex items-center gap-1.5">
              <span className="dot" aria-hidden />
              <span className="meta">{s.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  )
}

/* ------------------------------------------------------------------ heat */

export function HeatCell({ value = 0, max = 1, tone = 'brand', label, className }) {
  const pct = clampPct((safe(value) / (safe(max) || 1)) * 100)
  return (
    <div
      data-tone={tone}
      className={`grid place-content-center rounded-[9px] text-2xs font-bold tabular-nums ${className || ''}`}
      style={{
        background: `color-mix(in oklab, var(--tone) ${8 + pct * 0.55}%, var(--glass-2))`,
        color: pct > 62 ? '#fff' : 'var(--tone-ink)',
        minHeight: 34,
      }}
      title={label || `${value}`}
    >
      {value}
    </div>
  )
}

/** Compact matrix: rows × columns of HeatCells with headers. */
export function HeatGrid({ rows = [], cols = [], value = (r, c) => 0, tone = 'brand', max = 1, className }) {
  return (
    <div className={`overflow-x-auto scroll ${className || ''}`}>
      <table className="border-separate" style={{ borderSpacing: 4 }}>
        <thead>
          <tr>
            <th className="text-left pr-2" aria-hidden />
            {cols.map((c) => (
              <th key={c} className="meta font-semibold px-1 pb-1 min-w-[38px]">
                {String(c).slice(0, 3)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id ?? r.label ?? r}>
              <th scope="row" className="text-right pr-2 text-2xs font-semibold t2 whitespace-nowrap">
                {r.label ?? r}
              </th>
              {cols.map((c) => (
                <td key={`${r.label}-${c}`} className="p-0">
                  <HeatCell value={value(r, c)} max={max} tone={tone} label={`${r.label ?? r} · ${c}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export { niceMax }
