import { useCallback, useMemo, useRef, useState } from 'react'
import { AlertCircle, ClipboardPaste, Download, FileUp, UploadCloud } from 'lucide-react'
import { downloadCSV, parseTable, readFileText, toCSV } from '../lib/csv'
import { useApp } from '../context/AppContext'
import { DataTable } from './ui/DataTable'
import {
  Alert,
  Button,
  Card,
  CardHead,
  Chip,
  Field,
  Select,
  Textarea,
} from './ui/primitives'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const pretty = (f) => String(f).replace(/_/g, ' ')

/**
 * Spreadsheet intake shared by all three directories: drop a CSV, or paste
 * straight from Excel/Sheets (tab separated), map the columns, review, then upsert.
 */
export default function ImportPanel({ title, fields, template, sample, filename, onImport }) {
  const { pushToast } = useApp()
  const [raw, setRaw] = useState('')
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [mapping, setMapping] = useState(null)
  const [fileName, setFileName] = useState('')
  const input = useRef(null)

  const analyse = useCallback(
    (text, name = '') => {
      setRaw(text)
      setFileName(name)
      if (!text.trim()) return setParsed(null)
      const result = parseTable(text, fields)
      setParsed(result)
      if (result.header) setMapping(null)
      else setMapping(Object.fromEntries(fields.map((f, i) => [f, i])))
    },
    [fields],
  )

  const applyMapping = (map) => {
    setMapping(map)
    const lines = raw.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim())
    const delim = parsed?.delimiter === 'tab' ? '\t' : parsed?.delimiter || (lines[0]?.includes('\t') ? '\t' : ',')
    const body = lines.slice(parsed?.header ? 1 : 0)
    const rows = []
    let skipped = 0
    for (const line of body) {
      const cells = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''))
      const row = {}
      for (const f of fields) row[f] = cells[map[f]] ?? ''
      if (!row.email || !row.full_name || !EMAIL_RE.test(row.email)) {
        skipped++
        continue
      }
      rows.push({ ...row, email: row.email.toLowerCase() })
    }
    setParsed({ ...parsed, rows, skipped, mapped: true })
  }

  const handleFiles = async (files) => {
    const list = Array.from(files || [])
    if (!list.length) return
    try {
      const text = (await Promise.all(list.map(readFileText))).join('\n')
      analyse(text, list[0]?.name)
    } catch (err) {
      pushToast({ tone: 'danger', title: 'Could not read the file', message: err.message })
    }
  }

  const commit = async () => {
    if (!parsed?.rows.length) return
    setBusy(true)
    try {
      const res = await onImport(parsed)
      pushToast({
        tone: 'success',
        title: `${res.count} record${res.count === 1 ? '' : 's'} imported`,
        message: `${parsed.updated || 0} updated · ${parsed.skipped || 0} skipped. Deactivated records stay deactivated.`,
      })
      setRaw('')
      setParsed(null)
      setFileName('')
      setMapping(null)
    } catch (err) {
      pushToast({ tone: 'danger', title: 'Import failed', message: err.message })
    } finally {
      setBusy(false)
    }
  }

  const detected = parsed?.header ? fields.length : mapping ? Object.values(mapping).filter((v) => v >= 0).length : 0
  const columnCount = parsed?.headers?.length || 8
  const slug = String(title || 'import').toLowerCase().replace(/[^a-z0-9]+/g, '-')

  /* The parser only reports how many rows it dropped; the office needs to know
     which ones and why, so the refused lines are read back off the same text. */
  const rejected = useMemo(() => {
    if (!parsed) return []
    const lines = raw.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim())
    if (!lines.length) return []
    const offset = parsed.header ? 1 : 0
    const body = lines.slice(offset)
    const delim = parsed.delimiter === 'tab' ? '\t' : parsed.delimiter
    const accepted = new Set(parsed.rows.map((r) => String(r.email).toLowerCase()))
    const out = []
    body.forEach((line, i) => {
      const cells = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''))
      if (cells.every((c) => !c)) return
      if (cells.some((c) => accepted.has(c.toLowerCase()))) return
      const emailCell = cells.find((c) => c.includes('@'))
      const reason = !emailCell
        ? 'no email address in this row'
        : !EMAIL_RE.test(emailCell)
          ? `“${emailCell}” is not a valid address`
          : 'a valid address but no name beside it'
      out.push({ n: i + 1 + offset, reason, text: line.slice(0, 70) })
    })
    return out
  }, [raw, parsed])

  return (
    <Card className="p-4">
      <CardHead
        title={title}
        sub="Drop a CSV, or paste rows straight out of Excel or Google Sheets. Nothing is written until you press import."
        icon={FileUp}
        right={
          <Button size="sm" icon={Download} onClick={() => downloadCSV(filename, toCSV(sample, template))}>
            Template
          </Button>
        }
      />

      <div className="px-1">
        <div
          role="button"
          tabIndex={0}
          aria-label={`Upload a CSV file for ${title}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              input.current?.click()
            }
          }}
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            handleFiles(e.dataTransfer.files)
          }}
          className="well px-4 py-6 text-center cursor-pointer hover:bg-[color:var(--well-hover)] transition-colors"
        >
          <input
            ref={input}
            type="file"
            accept=".csv,.txt,.tsv"
            multiple
            className="hidden"
            aria-label={`Choose files for ${title}`}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <UploadCloud size={20} className="mx-auto mb-2 t3" aria-hidden />
          <p className="text-sm font-semibold t1">Drop a CSV here, or click to browse</p>
          <p className="meta mt-1">Columns: {template.map((t) => t.label).join(' · ')}</p>
          {fileName ? <p className="text-2xs t3 mt-1.5">Reading {fileName}</p> : null}
        </div>

        <Field className="mt-3" label="Or paste rows" htmlFor={`${slug}-paste`} hint="Tab or comma separated; a header row is detected automatically.">
          <Textarea
            id={`${slug}-paste`}
            className="min-h-[84px] font-mono text-2xs"
            placeholder={'Name\tEmail\tDesignation\nGurpreet Singh\tgurpreet@school.edu.in\tSenior Teacher'}
            value={raw}
            onChange={(e) => analyse(e.target.value)}
          />
        </Field>
        <p className="meta mt-1.5 inline-flex items-center gap-1.5">
          <ClipboardPaste size={12} aria-hidden /> {raw.trim() ? `${raw.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim()).length} lines read` : 'no rows pasted yet'}
        </p>

        {parsed && parsed.rows.length + parsed.skipped > 0 ? (
          <div className="rise mt-3 grid gap-3">
            <div className="flex flex-wrap gap-1.5">
              <Chip tone="success" dot>
                {parsed.rows.length} ready
              </Chip>
              {parsed.skipped ? (
                <Chip tone="danger" dot>
                  {parsed.skipped} refused
                </Chip>
              ) : null}
              <Chip tone={parsed.header ? 'brand' : 'neutral'}>
                {parsed.header ? 'header matched' : 'no header found'} · {detected}/{fields.length} mapped
              </Chip>
              <Chip tone="neutral">{parsed.delimiter === 'tab' ? 'tab' : 'comma'} separated</Chip>
            </div>

            {!parsed.header ? (
              <div className="card-flat p-3.5">
                <p className="field-label">Column mapping</p>
                <p className="lede mb-2.5">
                  We could not read a header row, so point each field at the column that holds it.
                </p>
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {fields.map((f) => (
                    <Field key={f} label={pretty(f)} htmlFor={`${slug}-map-${f}`}>
                      <Select
                        id={`${slug}-map-${f}`}
                        value={mapping?.[f] ?? ''}
                        onChange={(e) => applyMapping({ ...mapping, [f]: Number(e.target.value) })}
                      >
                        <option value="" disabled>
                          not mapped…
                        </option>
                        {(parsed.headers || Array.from({ length: columnCount }, (_, i) => `Column ${i + 1}`)).map((h, i) => (
                          <option key={i} value={i}>
                            {h || `Column ${i + 1}`}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                </div>
              </div>
            ) : null}

            <DataTable
              columns={fields.map((f) => ({
                key: f,
                header: pretty(f),
                sortable: true,
                render: (r) => r[f] || <span className="t3">—</span>,
              }))}
              rows={parsed.rows}
              pageSize={8}
              searchPlaceholder="Search the rows about to be written"
              maxHeight="320px"
            />

            {rejected.length ? (
              <Alert tone="danger" title={`${rejected.length} line${rejected.length === 1 ? '' : 's'} refused`} icon={AlertCircle}>
                <ul className="list-none m-0 p-0 mt-1 grid gap-1">
                  {rejected.slice(0, 12).map((r) => (
                    <li key={r.n} className="flex items-start gap-2 text-xs min-w-0">
                      <span className="num text-2xs t3 shrink-0">line {r.n}</span>
                      <span className="min-w-0">
                        {r.reason} — <span className="t3 break-all">{r.text}</span>
                      </span>
                    </li>
                  ))}
                  {rejected.length > 12 ? <li className="text-xs t3">…and {rejected.length - 12} more.</li> : null}
                </ul>
              </Alert>
            ) : null}

            {!parsed.rows.length ? (
              <Alert tone="warning" title="Nothing usable in that text">
                Every row needs at least a name and a valid email address. If the columns are in a different order, set the
                mapping above.
              </Alert>
            ) : (
              <Button block variant="primary" icon={UploadCloud} loading={busy} disabled={busy} onClick={commit}>
                {busy ? 'Writing…' : `Import ${parsed.rows.length} record${parsed.rows.length === 1 ? '' : 's'}`}
              </Button>
            )}

            <p className="meta leading-relaxed">
              Existing addresses are updated in place; new ones are added. Nothing is deleted, and a deactivated record stays
              deactivated until you restore it.
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  )
}
