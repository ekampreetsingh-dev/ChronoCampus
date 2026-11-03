/** Honorifics that must never become someone's greeting name. */
const HONORIFICS = /^(dr|prof|professor|col|colonel|capt|captain|maj|major|lt|lieutenant|shri|smt|srimati|mr|mrs|ms|md|ca|adv|rev|fr|hon)\.?$/i

/**
 * The name a greeting should use. Honorifics are skipped, and so are initials —
 * "Col. S. S. Gill" would otherwise greet someone as "S", which reads as broken.
 * With nothing real left, the surname is the safe fallback.
 */
export function firstName(full) {
  const parts = String(full || '')
    .trim()
    .split(/[\s.\-]+/)
    .filter(Boolean)
  const real = parts.filter((p) => !HONORIFICS.test(p) && p.length > 1)
  return real[0] || parts[parts.length - 1] || ''
}

/** "Dr. Neelam Kaur" → "Neelam" for a heading, full name for a record. */
export const initials = (full) =>
  String(full || '')
    .split(/[\s.\-]+/)
    .filter((w) => w && !HONORIFICS.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
