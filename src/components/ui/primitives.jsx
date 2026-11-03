import { useCallback, cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Info,
  Loader2,
  Search,
  X,
} from 'lucide-react'
import { subjectShort, subjectTone, roomShort, roomTone } from '../../lib/subjects'

/* ------------------------------------------------------------------ helpers */

export const cx = (...parts) => parts.filter(Boolean).join(' ')

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]:not([type=hidden])),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Escape, focus trap, focus restore and scroll lock — every overlay shares this. */
function useOverlay({ open, onClose, containerRef }) {
  const restore = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    restore.current = document.activeElement
    const node = containerRef.current
    const first = node?.querySelector(FOCUSABLE)
    ;(first || node)?.focus?.()

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose?.()
        return
      }
      if (e.key !== 'Tab' || !node) return
      const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null)
      if (!items.length) return
      const i = items.indexOf(document.activeElement)
      if (e.shiftKey && (i <= 0)) {
        e.preventDefault()
        items[items.length - 1].focus()
      } else if (!e.shiftKey && i === items.length - 1) {
        e.preventDefault()
        items[0].focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
      if (restore.current && document.contains(restore.current)) restore.current.focus?.()
    }
  }, [open, onClose, containerRef])
}

export function useClickAway(onAway, active = true) {
  const ref = useRef(null)
  useEffect(() => {
    if (!active) return undefined
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onAway()
    }
    const onKey = (e) => e.key === 'Escape' && onAway()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onAway, active])
  return ref
}

/* ------------------------------------------------------------------ surfaces */

export function Panel({ as: Tag = 'section', tone, className, children, style, ...rest }) {
  return (
    <Tag className={cx('glass rounded-[22px]', className)} data-tone={tone} style={style} {...rest}>
      {children}
    </Tag>
  )
}

export function Card({ as: Tag = 'div', tone, hover, className, children, style, ...rest }) {
  return (
    <Tag
      className={cx('card', hover && 'card-raise', className)}
      data-tone={tone}
      style={style}
      {...rest}
    >
      {children}
    </Tag>
  )
}

export function CardHead({ title, sub, right, icon: Icon, className }) {
  return (
    <div className={cx('flex items-start justify-between gap-4 px-5 pt-5 pb-3', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {Icon ? <Icon size={16} className="t3 shrink-0" aria-hidden /> : null}
          <h3 className="display text-md font-bold truncate">{title}</h3>
        </div>
        {sub ? <p className="lede mt-1">{sub}</p> : null}
      </div>
      {right ? <div className="flex items-center gap-2 shrink-0">{right}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ buttons */

const VARIANTS = {
  default: '',
  primary: 'btn-primary',
  accent: 'btn-accent',
  tone: 'btn-tone',
  quiet: 'btn-quiet',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
}

export function Button({
  variant = 'default',
  size,
  tone,
  icon: Icon,
  iconRight: IconRight,
  loading,
  block,
  className,
  children,
  type = 'button',
  ...rest
}) {
  return (
    <button
      type={type}
      data-tone={tone}
      className={cx(
        'btn',
        VARIANTS[variant] ?? '',
        size === 'sm' && 'btn-sm',
        size === 'lg' && 'btn-lg',
        block && 'btn-block',
        className,
      )}
      disabled={rest.disabled || loading}
      {...rest}
    >
      {loading ? (
        <Loader2 size={size === 'sm' ? 14 : 16} className="spin" aria-hidden />
      ) : Icon ? (
        <Icon size={size === 'sm' ? 14 : 16} aria-hidden />
      ) : null}
      {children}
      {IconRight ? <IconRight size={size === 'sm' ? 14 : 16} aria-hidden /> : null}
    </button>
  )
}

export function IconButton({ label, icon: Icon, size = 'md', tone, active, className, ...rest }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-tone={tone}
      aria-pressed={active === undefined ? undefined : !!active}
      className={cx('icon-btn', size === 'sm' && 'icon-btn-sm', active && 'is-on', className)}
      {...rest}
    >
      <Icon size={size === 'sm' ? 16 : 18} aria-hidden />
    </button>
  )
}

/* ------------------------------------------------------------------ forms */

export function Field({ label, hint, error, required, htmlFor, children, className }) {
  const auto = useId()
  const id = htmlFor || auto
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined
  /* Bind the generated id into the control so label[for] actually resolves. */
  const bound = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id || id,
        'aria-describedby': children.props['aria-describedby'] || describedBy,
        'aria-invalid': children.props['aria-invalid'] ?? (error ? true : undefined),
      })
    : children
  return (
    <div className={cx('min-w-0', className)}>
      {label ? (
        <label className="field-label" htmlFor={id}>
          {label}
          {required ? <span aria-hidden> *</span> : null}
        </label>
      ) : null}
      {bound}
      {error ? (
        <p className="field-error" id={`${id}-err`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export const Input = ({ className, invalid, ...rest }) => (
  <input className={cx('input', className)} aria-invalid={invalid || undefined} {...rest} />
)

export const Textarea = ({ className, invalid, ...rest }) => (
  <textarea className={cx('textarea', className)} aria-invalid={invalid || undefined} {...rest} />
)

export function Select({ className, invalid, children, ...rest }) {
  return (
    <select className={cx('select', className)} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Search', className, id, ...rest }) {
  const auto = useId()
  const inputId = id || auto
  return (
    <div className={cx('relative min-w-0', className)}>
      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 t3 pointer-events-none" aria-hidden />
      <input
        id={inputId}
        type="search"
        role="searchbox"
        className="input pl-10"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        {...rest}
      />
    </div>
  )
}

export function Checkbox({ label, hint, className, ...rest }) {
  const auto = useId()
  const id = rest.id || auto
  return (
    <div className={cx('flex items-start gap-2.5', className)}>
      <input id={id} type="checkbox" className="check mt-0.5" {...rest} />
      <label htmlFor={id} className="text-sm font-medium t1 cursor-pointer">
        {label}
        {hint ? <span className="block text-2xs t3 font-normal">{hint}</span> : null}
      </label>
    </div>
  )
}

export function Switch({ checked, onChange, label, hint, id, className }) {
  const auto = useId()
  const inputId = id || auto
  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
      <label htmlFor={inputId} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-semibold t1">{label}</span>
        {hint ? <span className="block text-xs t3 mt-0.5">{hint}</span> : null}
      </label>
      <button
        id={inputId}
        type="button"
        role="switch"
        aria-checked={!!checked}
        aria-label={label}
        className="switch"
        onClick={() => onChange?.(!checked)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ chips */

export function Chip({ tone = 'neutral', icon: Icon, dot, large, className, children, ...rest }) {
  return (
    <span data-tone={tone} className={cx('chip', dot && 'chip-dot', large && 'chip-lg', className)} {...rest}>
      {Icon ? <Icon size={13} aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </span>
  )
}

export function SubjectChip({ subject, short = false, className }) {
  return (
    <Chip tone={subjectTone(subject)} className={className} title={subject}>
      {short ? subjectShort(subject) : subject}
    </Chip>
  )
}

export function RoomChip({ room, className }) {
  if (!room) return null
  return (
    <Chip tone={roomTone(room)} className={className} title={room}>
      {roomShort(room)}
    </Chip>
  )
}

export function Badge({ tone = 'danger', count, className, children }) {
  return (
    <span data-tone={tone} className={cx('badge', count != null && 'badge-count', className)}>
      {children ?? count}
    </span>
  )
}

const AVATAR_TONES = ['brand', 'accent', 'info', 'sage', 'clay', 'rose', 'sky']

export function Avatar({ name = '', initials, size = 'md', tone, src, className }) {
  const text =
    initials ||
    String(name)
      .split(/[\s.\-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('') ||
    '•'
  const auto = tone || AVATAR_TONES[[...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length]
  return (
    <span
      data-tone={auto}
      className={cx('avatar', size === 'sm' && 'avatar-sm', size === 'lg' && 'avatar-lg', src && 'avatar-photo', className)}
      style={src ? { backgroundImage: `url(${src})` } : undefined}
      title={name || undefined}
    >
      {src ? <span className="sr-only">{name}</span> : text}
    </span>
  )
}

/* ------------------------------------------------------------------ navigation */

export function Tabs({ items = [], value, onChange, className, label }) {
  const refs = useRef([])
  const move = (from, dir) => {
    const n = items.length
    const next = (from + dir + n) % n
    onChange?.(items[next].id ?? items[next].to)
    requestAnimationFrame(() => refs.current[next]?.focus())
  }
  return (
    <div className={cx('tabs', className)} role="tablist" aria-label={label}>
      {items.map((it, i) => {
        const active = (it.id ?? it.to) === value
        return (
          <button
            key={it.id ?? it.to}
            ref={(el) => (refs.current[i] = el)}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={cx('tab', active && 'is-active')}
            onClick={() => onChange?.(it.id ?? it.to)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') move(i, 1)
              if (e.key === 'ArrowLeft') move(i, -1)
            }}
          >
            {it.icon ? <it.icon size={15} aria-hidden /> : null}
            {it.label}
            {it.count != null ? (
              <span className={cx('badge', active ? '' : 'opacity-70')} data-tone={it.tone || 'brand'}>
                {it.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export function Segmented({ items = [], value, onChange, className, label = 'View' }) {
  return (
    <div className={cx('seg', className)} role="group" aria-label={label}>
      {items.map((it) => {
        const id = it.id ?? it.value ?? it
        const on = id === value
        return (
          <button
            key={id}
            type="button"
            role={it.role || undefined}
            aria-pressed={on}
            className={cx('seg-item', on && 'is-active')}
            onClick={() => onChange?.(id)}
          >
            {it.icon ? <it.icon size={14} aria-hidden /> : null}
            {it.label ?? it}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ overlays */

export function Modal({ open, onClose, title, sub, icon: Icon, children, footer, width = 'max-w-xl', tone }) {
  const box = useRef(null)
  useOverlay({ open, onClose, containerRef: box })
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="scrim" onClick={onClose} aria-hidden />
      <div
        ref={box}
        data-tone={tone}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Dialog'}
        tabIndex={-1}
        className={cx('modal rounded-b-none sm:rounded-[24px] max-h-[92vh] flex flex-col', width)}
      >
        <header className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-[color:var(--color-line-soft)] shrink-0">
          {Icon ? (
            <span className="avatar avatar-sm shrink-0" data-tone={tone || 'brand'}>
              <Icon size={16} aria-hidden />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 className="display text-lg font-bold leading-snug">{title}</h2>
            {sub ? <p className="lede mt-1">{sub}</p> : null}
          </div>
          {onClose ? <IconButton label="Close" icon={X} size="sm" onClick={onClose} /> : null}
        </header>
        <div className="scroll overflow-y-auto px-5 py-5 flex-1 min-h-0">{children}</div>
        {footer ? (
          <footer className="px-5 py-4 border-t border-[color:var(--color-line-soft)] flex flex-wrap items-center justify-end gap-2 shrink-0 bg-[color:var(--well)]">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

export function Drawer({ open, onClose, title, sub, children, footer, width = 'sm:w-[460px]', tone }) {
  const box = useRef(null)
  useOverlay({ open, onClose, containerRef: box })
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="scrim" onClick={onClose} aria-hidden />
      <div
        ref={box}
        data-tone={tone}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Panel'}
        tabIndex={-1}
        className={cx('drawer w-full max-w-[520px] flex flex-col', width)}
      >
        <header className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-[color:var(--color-line-soft)] shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="display text-lg font-bold leading-snug truncate">{title}</h2>
            {sub ? <p className="lede mt-1">{sub}</p> : null}
          </div>
          {onClose ? <IconButton label="Close" icon={X} size="sm" onClick={onClose} /> : null}
        </header>
        <div className="scroll overflow-y-auto px-5 py-5 flex-1 min-h-0">{children}</div>
        {footer ? (
          <footer className="px-5 py-4 border-t border-[color:var(--color-line-soft)] flex items-center justify-end gap-2 shrink-0 bg-[color:var(--well)]">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      icon={tone === 'danger' ? AlertTriangle : Check}
      tone={tone}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm t2 leading-relaxed">{body}</div>
    </Modal>
  )
}

/** Anchored menu. `children` receives a close() through render-prop. */
export function Dropdown({ trigger, children, align = 'end', width = 'w-56', label }) {
  const [open, setOpen] = useState(false)
  const ref = useClickAway(() => setOpen(false), open)
  return (
    <div className="relative shrink-0" ref={ref}>
      {typeof trigger === 'function' ? trigger({ open, toggle: () => setOpen((o) => !o) }) : (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          className="icon-btn"
          onClick={() => setOpen((o) => !o)}
        >
          {trigger}
        </button>
      )}
      {open ? (
        <div
          role="menu"
          className={cx('pop absolute top-[calc(100%+8px)] z-50 p-1.5', align === 'end' ? 'right-0' : 'left-0', width)}
        >
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      ) : null}
    </div>
  )
}

export function MenuItem({ icon: Icon, children, danger, active, onClick, ...rest }) {
  return (
    <button
      type="button"
      role="menuitem"
      data-danger={danger || undefined}
      data-active={active || undefined}
      className={cx('menu-item w-full', active && 'bg-[color:var(--hovered)] t1 font-semibold')}
      onClick={onClick}
      {...rest}
    >
      {Icon ? <Icon size={15} aria-hidden className="shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </button>
  )
}

export function Tooltip({ content, children, side = 'top' }) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const anchor = useRef(null)
  const place = useCallback(() => {
    const r = anchor.current?.getBoundingClientRect()
    if (!r) return
    const x = r.left + r.width / 2
    const y = side === 'bottom' ? r.bottom + 8 : side === 'right' ? r.top + r.height / 2 : r.top - 8
    setPos({ x, y })
  }, [side])

  return (
    <span
      ref={anchor}
      className="inline-flex min-w-0"
      onMouseEnter={() => {
        place()
        setShow(true)
      }}
      onMouseLeave={() => setShow(false)}
      onFocus={() => {
        place()
        setShow(true)
      }}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && content ? (
        <span
          role="tooltip"
          className="tip"
          style={{
            left: pos.x,
            top: pos.y,
            transform:
              side === 'bottom' ? 'translate(-50%, 0)' : side === 'right' ? 'translate(12px, -50%)' : 'translate(-50%, -100%)',
          }}
        >
          {content}
        </span>
      ) : null}
    </span>
  )
}

/* ------------------------------------------------------------------ combobox */

export function SearchSelect({
  label,
  value,
  onChange,
  options = [],
  placeholder = 'Choose…',
  searchPlaceholder = 'Type to filter',
  disabled,
  required,
  error,
  hint,
  emptyText = 'No matches',
  clearable,
  className,
  maxList = 240,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const box = useRef(null)
  const input = useRef(null)
  const list = useRef(null)
  const auto = useId()

  const norm = (o) => (typeof o === 'string' ? { value: o, label: o } : o)
  const all = useMemo(() => options.map(norm), [options])
  const selected = all.find((o) => String(o.value) === String(value)) || null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (o) =>
        String(o.label).toLowerCase().includes(q) ||
        String(o.value).toLowerCase().includes(q) ||
        String(o.hint || '').toLowerCase().includes(q) ||
        String(o.search || '').toLowerCase().includes(q),
    )
  }, [all, query])

  useEffect(() => setActive(0), [query, open])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!open || !list.current) return
    const el = list.current.querySelector(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const pick = (opt) => {
    onChange?.(opt.value)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className={cx('relative min-w-0', className)} ref={box}>
      {label ? (
        <label className="field-label" htmlFor={auto}>
          {label}
          {required ? <span aria-hidden> *</span> : null}
        </label>
      ) : null}
      <button
        type="button"
        id={auto}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={error || undefined}
        className={cx('input flex items-center justify-between gap-2 text-left', !selected && 't3 font-normal', disabled && 'opacity-60 cursor-not-allowed')}
        onClick={() => {
          if (disabled) return
          setOpen((o) => !o)
          requestAnimationFrame(() => input.current?.focus())
        }}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        {clearable && selected ? (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Clear ${label || 'selection'}`}
            className="t3 hover:t1 p-0.5 rounded"
            onClick={(e) => {
              e.stopPropagation()
              onChange?.('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                e.preventDefault()
                onChange?.('')
              }
            }}
          >
            <X size={14} />
          </span>
        ) : (
          <ChevronDown size={15} className={cx('t3 shrink-0 transition-transform', open && 'rotate-180')} />
        )}
      </button>

      {open ? (
        <div className="pop absolute left-0 right-0 top-[calc(100%+6px)] z-40 p-1.5">
          <div className="relative mb-1.5">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 t3" aria-hidden />
            <input
              ref={input}
              className="input py-2 pl-8 text-sm"
              placeholder={searchPlaceholder}
              value={query}
              role="combobox"
              aria-controls={`${auto}-list`}
              aria-expanded="true"
              aria-autocomplete="list"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActive((a) => Math.min(a + 1, filtered.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((a) => Math.max(a - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  if (filtered[active]) pick(filtered[active])
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setOpen(false)
                }
              }}
            />
          </div>
          <ul
            ref={list}
            id={`${auto}-list`}
            role="listbox"
            className="scroll overflow-y-auto"
            style={{ maxHeight: maxList }}
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm t3">{emptyText}</li>
            ) : (
              filtered.map((o, i) => {
                const on = i === active
                const chosen = String(o.value) === String(value)
                return (
                  <li key={String(o.value)} role="option" aria-selected={chosen} data-idx={i}>
                    <button
                      type="button"
                      className={cx(
                        'menu-item w-full',
                        on && 'bg-[color:var(--hovered)]',
                        chosen && 't1 font-semibold',
                        o.disabled && 'opacity-50 cursor-not-allowed',
                      )}
                      disabled={o.disabled}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(o)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{o.label}</span>
                        {o.hint ? <span className="block text-2xs t3 truncate font-normal">{o.hint}</span> : null}
                      </span>
                      {chosen ? <Check size={15} className="shrink-0 text-[color:var(--color-brand-strong)]" aria-hidden /> : null}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ feedback */

export function Spinner({ size = 16, label = 'Loading' }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm t3">
      <Loader2 size={size} className="spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function Skeleton({ className, style }) {
  return <div className={cx('skel', className)} style={style} aria-hidden />
}

export function SkeletonRows({ rows = 4, className }) {
  return (
    <div className={cx('space-y-2.5', className)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  )
}

export function SkeletonBoard() {
  return (
    <div className="board p-4 space-y-3" aria-hidden>
      <Skeleton className="h-8 w-40" />
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {Array.from({ length: 18 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-[11px]" />
        ))}
      </div>
    </div>
  )
}

export function EmptyState({ icon: Icon, title, hint, action, tone = 'neutral', className }) {
  return (
    <div data-tone={tone} className={cx('flex flex-col items-center text-center py-12 px-6 gap-3', className)}>
      {Icon ? (
        <span className="avatar avatar-lg" data-tone={tone}>
          <Icon size={22} aria-hidden />
        </span>
      ) : null}
      <div>
        <h3 className="display text-md font-bold">{title}</h3>
        {hint ? <p className="lede mt-1.5 mx-auto max-w-md">{hint}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function Alert({ tone = 'warning', title, children, icon, action, className }) {
  const Glyph = icon || (tone === 'danger' || tone === 'warning' ? AlertTriangle : Info)
  return (
    <div data-tone={tone} role={tone === 'danger' ? 'alert' : 'note'} className={cx('alert', className)}>
      <Glyph size={17} className="shrink-0 mt-0.5" aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-bold text-sm">{title}</p> : null}
        {children ? <div className="text-sm opacity-95 mt-0.5">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function Toaster({ toasts = [], onDismiss }) {
  return createPortal(
    <div className="fixed z-[80] bottom-4 right-4 left-4 sm:left-auto flex flex-col items-stretch sm:items-end gap-2.5 pointer-events-none"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div key={t.id} data-tone={t.tone || 'brand'} className="toast pointer-events-auto">
          <span className="shrink-0 mt-0.5" aria-hidden>
            {t.tone === 'error' || t.tone === 'danger' ? (
              <AlertTriangle size={17} className="text-[color:var(--tone-ink)]" />
            ) : t.tone === 'success' ? (
              <Check size={17} className="text-[color:var(--tone-ink)]" />
            ) : (
              <Info size={17} className="text-[color:var(--tone-ink)]" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="display text-sm font-bold t1">{t.title}</p>
            {t.message ? <p className="text-xs t2 mt-0.5 break-words">{t.message}</p> : null}
            {t.action?.label ? (
              <button
                type="button"
                className="mt-2 text-xs font-bold text-[color:var(--tone-ink)] inline-flex items-center gap-1"
                onClick={t.action.onClick}
              >
                {t.action.label}
                <ArrowUpRight size={13} aria-hidden />
              </button>
            ) : null}
          </div>
          <IconButton label="Dismiss" icon={X} size="sm" onClick={() => onDismiss?.(t.id)} />
        </div>
      ))}
    </div>,
    document.body,
  )
}

export function CopyButton({ value, label = 'Copy', className }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      icon={done ? Check : Copy}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(String(value))
        } catch {
          const el = document.createElement('textarea')
          el.value = String(value)
          document.body.appendChild(el)
          el.select()
          document.execCommand('copy')
          el.remove()
        }
        setDone(true)
        setTimeout(() => setDone(false), 1600)
      }}
    >
      {done ? 'Copied' : label}
    </Button>
  )
}

/* ------------------------------------------------------------------ page furniture */

export function Breadcrumbs({ items = [], className }) {
  return (
    <nav aria-label="Breadcrumb" className={cx('min-w-0', className)}>
      <ol className="flex items-center gap-1 flex-wrap text-2xs font-semibold t3 list-none m-0 p-0">
        {items.map((it, i) => (
          <li key={`${it.label}-${i}`} className="flex items-center gap-1">
            {i > 0 ? <ChevronRight size={12} aria-hidden className="opacity-60" /> : null}
            {it.to && i < items.length - 1 ? (
              <NavLink to={it.to} className="hover:t1 transition-colors">
                {it.label}
              </NavLink>
            ) : (
              <span className={cx(i === items.length - 1 && 't2')} aria-current={i === items.length - 1 ? 'page' : undefined}>
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function PageHeader({ eyebrow, title, sub, actions, breadcrumbs, icon: Icon, className }) {
  return (
    <header className={cx('flex flex-col gap-4', className)}>
      {breadcrumbs?.length ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
          <div className="flex items-center gap-3 min-w-0">
            {Icon ? (
              <span className="avatar shrink-0" aria-hidden>
                <Icon size={19} />
              </span>
            ) : null}
            <h1 className="display text-xl sm:text-2xl font-extrabold truncate">{title}</h1>
          </div>
          {sub ? <p className="lede mt-2">{sub}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
      </div>
    </header>
  )
}

export function SectionTitle({ eyebrow, title, sub, right, className }) {
  return (
    <div className={cx('flex flex-wrap items-end justify-between gap-3 mb-3.5', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h2 className="display text-lg font-bold">{title}</h2>
        {sub ? <p className="lede mt-1">{sub}</p> : null}
      </div>
      {right ? <div className="flex items-center gap-2 flex-wrap">{right}</div> : null}
    </div>
  )
}

export function Stat({ label, value, sub, tone = 'brand', trend, icon: Icon, className }) {
  const up = typeof trend === 'number' && trend > 0
  const down = typeof trend === 'number' && trend < 0
  return (
    <div data-tone={tone} className={cx('card p-4 flex flex-col gap-2 min-w-0', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="field-label mb-0">{label}</p>
        {Icon ? (
          <span className="avatar avatar-sm" data-tone={tone} aria-hidden>
            <Icon size={15} />
          </span>
        ) : null}
      </div>
      <p className="num text-2xl font-extrabold t1 leading-none">{value}</p>
      <div className="flex items-center gap-2 flex-wrap min-h-[18px]">
        {typeof trend === 'number' ? (
          <span
            className={cx('text-2xs font-bold', up && 'text-[color:var(--color-success-ink)]', down && 'text-[color:var(--color-danger-ink)]')}
            data-tone={up ? 'success' : down ? 'danger' : 'neutral'}
          >
            {up ? '▲' : down ? '▼' : '■'} {Math.abs(trend)}%
          </span>
        ) : null}
        {sub ? <span className="meta truncate">{sub}</span> : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ misc */

export function KeyValue({ rows = [], className, cols = 1 }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-3', cols === 2 ? 'sm:grid-cols-2' : '', className)}>
      {rows.filter(Boolean).map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="field-label mb-1">{k}</dt>
          <dd className="text-sm font-semibold t1 m-0 truncate" title={typeof v === 'string' ? v : undefined}>
            {v ?? '—'}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function Divider({ className }) {
  return <hr className={cx('divider my-4', className)} />
}
