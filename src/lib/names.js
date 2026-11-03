/** Honorifics that must never become someone's greeting name. */
const HONORIFICS = /^(dr|prof|professor|col|colonel|capt|captain|maj|major|lt|lieutenant|shri|smt|srimati|mr|mrs|ms|md|ca|adv|rev|fr|hon)\.?$/i

/** The name a greeting should use: the first word that is actually a name. */
export function firstName(full) {
  const parts = String(full || '').trim().split(/[\s.\-]+/).filter(Boolean)
  return parts.find((p) => !HONORIFICS.test(p)) || parts[0] || ''
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
