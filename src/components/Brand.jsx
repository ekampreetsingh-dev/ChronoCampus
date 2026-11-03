import { NavLink } from 'react-router-dom'

/** ChronoCampus mark: a clock face cut by the day/night meridian. */
export function Mark({ size = 34, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={className}
      role="img"
      aria-label="ChronoCampus"
    >
      <defs>
        <linearGradient id="cc-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#668FD6" />
          <stop offset="55%" stopColor="#7E86DE" />
          <stop offset="100%" stopColor="#9B91E5" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill="url(#cc-mark)" />
      <rect width="40" height="40" rx="12" fill="none" stroke="rgba(255,255,255,.4)" strokeWidth="1" />
      <circle cx="20" cy="20" r="10.5" fill="none" stroke="rgba(255,255,255,.85)" strokeWidth="2" />
      <path d="M20 13.5V20l4.8 2.9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="20" cy="20" r="1.9" fill="#fff" />
    </svg>
  )
}

export default function Brand({ compact, to = '/', showWord = true }) {
  // A compact rail must never paint its wordmark: the 74px column squeezes the
  // text box to nothing while the glyphs overflow and land on the header.
  const word = showWord && !compact
  return (
    <NavLink
      to={to}
      className={`flex items-center gap-2.5 min-w-0 rounded-xl px-1 ${word ? 'overflow-hidden' : ''}`}
      aria-label="ChronoCampus home"
    >
      <Mark size={compact ? 30 : 34} className="shrink-0" />
      {word ? (
        <span className="min-w-0 overflow-hidden">
          <span className="block display text-md font-extrabold leading-none tracking-tight t1 whitespace-nowrap">
            Chrono<span style={{ color: 'var(--text-accent)' }}>Campus</span>
          </span>
          <span className="block text-2xs t3 font-semibold tracking-[0.09em] uppercase mt-1 whitespace-nowrap">
            Academic Ops
          </span>
        </span>
      ) : null}
    </NavLink>
  )
}
