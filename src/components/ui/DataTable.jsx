import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, Search, X } from 'lucide-react'
import { Button, IconButton, Skeleton } from './primitives'

const asNumber = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : null)
const asTime = (v) => (v instanceof Date ? v.getTime() : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(v.trim()) ? Date.parse(v) : null)

/** Numbers, dates and locale-aware strings — digits inside text order the way a
    person reads them, so Room 9 sorts before Room 10. */
function compare(a, b) {
  if (a == null || b == null) return a == null && b == null ? 0 : a == null ? 1 : -1
  const x = asNumber(a)
  const y = asNumber(b)
  if (x != null && y != null) return x - y
  const ta = asTime(a)
  const tb = asTime(b)
  if (ta != null && tb != null) return ta - tb
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

const align = (a) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left')
const text = (v) => (v == null ? '' : typeof v === 'object' ? (Array.isArray(v) ? v.map(text).join(' ') : '') : String(v))

/** 1 … 4 [5] 6 … 20 */
function pageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out = [1]
  if (current > 3) out.push('gap-lo')
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i += 1) out.push(i)
  if (current < total - 2) out.push('gap-hi')
  out.push(total)
  return out
}

export function DataTable({
  columns = [],
  rows = [],
  getRowId,
  empty,
  pageSize = 25,
  initialSort,
  onRowClick,
  toolbar,
  searchKeys,
  searchPlaceholder = 'Search rows',
  searchable,
  stickyHeader = true,
  loading = false,
  maxHeight,
}) {
  const [typed, setTyped] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(initialSort || null)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const t = setTimeout(() => setQuery(typed), 180)
    return () => clearTimeout(t)
  }, [typed])
  useEffect(() => setPage(1), [query, sort])

  const keys = useMemo(
    () => (Array.isArray(searchKeys) ? searchKeys : typeof searchKeys === 'function' ? null : columns.map((c) => c.key).filter(Boolean)),
    [searchKeys, columns],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    if (typeof searchKeys === 'function') return rows.filter((r) => searchKeys(r, q))
    const terms = q.split(/\s+/)
    return rows.filter((r) => {
      const hay = keys.map((k) => text(r[k])).join(' \u0001 ').toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }, [rows, query, keys, searchKeys])

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key)
    if (!col) return filtered
    const val = (row) => (col.sortValue ? col.sortValue(row) : row[col.key])
    const dir = sort.dir === 'desc' ? -1 : 1
    return [...filtered].sort((a, b) => dir * compare(val(a), val(b)))
  }, [filtered, sort, columns])

  const paginates = pageSize > 0 && sorted.length > pageSize
  const pages = paginates ? Math.ceil(sorted.length / pageSize) : 1
  const at = Math.min(page, pages)
  const shown = paginates ? sorted.slice((at - 1) * pageSize, at * pageSize) : sorted
  const from = sorted.length ? (at - 1) * pageSize + 1 : 0
  const searching = Boolean(query.trim())
  const showSearch = searchable === false ? false : Boolean(searchKeys) || rows.length > 8
  const toggleSort = (col) =>
    setSort((s) => (!s || s.key !== col.key ? { key: col.key, dir: 'asc' } : s.dir === 'asc' ? { key: col.key, dir: 'desc' } : null))

  if (loading) {
    return (
      <div className="card p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full mb-2.5 last:mb-0" />
        ))}
      </div>
    )
  }

  if (!rows.length) return empty || null

  return (
    <div className="card overflow-hidden min-w-0">
      {toolbar || showSearch ? (
        <div className="flex flex-wrap items-center gap-2.5 px-3.5 py-3 border-b border-[color:var(--color-line-soft)]">
          {toolbar}
          {showSearch ? (
            /* Full width on a phone, right-aligned from small screens up — a fixed
               190px box pushed to the right left a stranded gap under the title. */
            <div className="flex items-center gap-2.5 w-full sm:w-auto order-last sm:ml-auto">
              {searching ? (
                <span className="num text-2xs t3 tabular-nums whitespace-nowrap">
                  {filtered.length} of {rows.length}
                </span>
              ) : null}
              <div className="relative flex-1 sm:flex-none">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 t3 pointer-events-none" aria-hidden />
                <input
                  className="input !h-9 !py-0 pl-8 pr-8 text-xs w-full sm:w-[190px]"
                  placeholder={searchPlaceholder}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  aria-label={searchPlaceholder}
                />
                {typed ? (
                  <IconButton
                    label={`Clear ${searchPlaceholder}`}
                    icon={X}
                    size="sm"
                    className="!absolute !w-6 !h-6 right-1.5 top-1/2 -translate-y-1/2"
                    onClick={() => setTyped('')}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!sorted.length ? (
        <div className="px-5 py-10 text-center">
          <p className="display text-md font-bold">Nothing matches that search</p>
          <p className="lede mt-1.5 mx-auto">
            No row contains “{query.trim()}”. Try a shorter term, or clear it to see all {rows.length} rows.
          </p>
          <Button className="mt-4" size="sm" icon={X} onClick={() => setTyped('')}>
            Reset search
          </Button>
        </div>
      ) : (
        <div
          className="scroll min-w-0 overflow-x-auto overflow-y-auto"
          style={stickyHeader ? { maxHeight: maxHeight || 'min(70vh, 640px)' } : undefined}
        >
          <table className="tbl">
            <thead>
              <tr>
                {columns.map((col) => {
                  const on = sort && sort.key === col.key
                  return (
                    <th
                      key={col.key || col.header}
                      scope="col"
                      data-sortable={col.sortable || undefined}
                      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : col.sortable ? 'none' : undefined}
                      className={align(col.align)}
                      style={col.width ? { width: col.width } : undefined}
                    >
                      {col.sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col)}
                          className={`inline-flex items-center gap-1 w-full ${align(col.align)} hover:t1 transition-colors`}
                        >
                          {col.header}
                          {on ? (
                            sort.dir === 'asc' ? (
                              <ChevronUp size={12} aria-hidden className="text-[color:var(--color-brand-strong)]" />
                            ) : (
                              <ChevronDown size={12} aria-hidden className="text-[color:var(--color-brand-strong)]" />
                            )
                          ) : (
                            <ChevronsUpDown size={11} aria-hidden className="opacity-45" />
                          )}
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, i) => {
                const clickable = typeof onRowClick === 'function'
                return (
                  <tr
                    key={getRowId ? getRowId(row, i) : i}
                    data-clickable={clickable || undefined}
                    onClick={clickable ? () => onRowClick(row) : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              onRowClick(row)
                            }
                          }
                        : undefined
                    }
                  >
                    {columns.map((col) => (
                      <td key={col.key || col.header} className={align(col.align)} data-strong={col.strong || undefined}>
                        {col.render ? col.render(row) : text(row[col.key]) || <span className="t3">—</span>}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {sorted.length && paginates ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3 border-t border-[color:var(--color-line-soft)]">
          <span className="num text-2xs t3 tabular-nums">
            Showing {from}–{from + shown.length - 1} of {sorted.length}
            {searching && rows.length !== sorted.length ? ` · filtered from ${rows.length}` : ''}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <IconButton label="Previous page" icon={ChevronLeft} size="sm" disabled={at <= 1} onClick={() => setPage(at - 1)} />
            {pageWindow(at, pages).map((p) =>
              typeof p === 'string' ? (
                <span key={p} className="px-1 t3" aria-hidden>
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  aria-current={p === at ? 'page' : undefined}
                  aria-label={`Page ${p}`}
                  className={`seg-item num tabular-nums min-w-[32px] ${p === at ? 'is-active' : ''}`}
                >
                  {p}
                </button>
              ),
            )}
            <IconButton label="Next page" icon={ChevronRight} size="sm" disabled={at >= pages} onClick={() => setPage(at + 1)} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default DataTable
