/**
 * Spreadsheet ingestion. Handles .csv files and raw copy-paste from Excel /
 * Google Sheets, which arrive tab-separated, with or without a header row.
 */

const splitLine = (line, delim) => {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else inQuotes = !inQuotes
    } else if (ch === delim && !inQuotes) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

const detectDelimiter = (firstLine) => {
  if (firstLine.includes('\t')) return '\t'
  const commas = (firstLine.match(/,/g) || []).length
  const semis = (firstLine.match(/;/g) || []).length
  return semis > commas ? ';' : ','
}

const HEADER_WORDS = {
  name: ['name', 'full name', 'fullname', 'teacher', 'admin'],
  email: ['email', 'e-mail', 'mail', 'id'],
  designation: ['designation', 'post', 'role', 'title'],
  subject: ['subject', 'department', 'dept'],
  phone: ['phone', 'mobile', 'contact', 'number'],
}

/**
 * @param {string} raw   file contents or clipboard text
 * @param {string[]} fields  e.g. ['full_name','email','designation']
 * @param {Object}   aliases field -> accepted header words
 */
export function parseTable(raw, fields) {
  const lines = String(raw)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim())
  if (!lines.length) return { rows: [], skipped: 0, header: false }

  const delim = detectDelimiter(lines[0])
  const first = splitLine(lines[0], delim)
  const lower = first.map((h) => h.toLowerCase().replace(/\s+/g, ' '))

  const headerLooksRight = fields.every((f) => {
    const words = Object.entries(HEADER_WORDS).find(([, v]) => v.includes(f))?.[1] || []
    const key = { full_name: 'name', email: 'email', designation: 'designation', subject: 'subject', phone: 'phone' }[f]
    return words.some((w) => lower.includes(w)) || lower.includes(key) || lower.includes(f)
  })

  const columns = headerLooksRight
    ? fields.map((f) => {
        const words =
          {
            full_name: ['name', 'full name', 'full_name', 'fullname', 'teacher', 'admin'],
            email: ['email', 'e-mail', 'mail', 'email address'],
            designation: ['designation', 'post', 'role', 'title'],
            subject: ['subject', 'department', 'dept', 'subjects'],
            phone: ['phone', 'mobile', 'contact', 'phone number'],
          }[f] || []
        const idx = lower.findIndex((h) => words.some((w) => h === w || h.includes(w)))
        return idx
      })
    : fields.map((_, i) => i)

  const body = headerLooksRight ? lines.slice(1) : lines
  const rows = []
  let skipped = 0

  for (const line of body) {
    const cells = splitLine(line, delim)
    if (cells.every((c) => !c)) continue
    const row = {}
    fields.forEach((f, i) => {
      const at = columns[i]
      row[f] = at >= 0 ? (cells[at] || '').trim() : ''
    })
    if (!row.email || !row.full_name) {
      skipped++
      continue
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) {
      skipped++
      continue
    }
    row.email = row.email.toLowerCase()
    rows.push(row)
  }

  return { rows, skipped, header: headerLooksRight, headers: first, delimiter: delim === '\t' ? 'tab' : delim }
}

export function toCSV(rows, headers) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.map((h) => esc(h.label)).join(','), ...rows.map((r) => headers.map((h) => esc(r[h.key])).join(','))].join(
    '\n',
  )
}

export const downloadCSV = (filename, content) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const readFileText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    reader.readAsText(file)
  })
