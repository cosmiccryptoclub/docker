import clsx from 'clsx'
import { Loader2, TrendingUp, TrendingDown } from 'lucide-react'

export function Spinner({ className = '' }) {
  return <Loader2 className={clsx('animate-spin text-slate-500', className)} size={20} />
}

export function Center({ children, className = '' }) {
  return <div className={clsx('flex items-center justify-center', className)}>{children}</div>
}

export function EmptyState({ title, hint, action }) {
  return (
    <div className="card p-10 text-center">
      <div className="text-slate-300 font-medium">{title}</div>
      {hint && <div className="mt-1 text-sm text-slate-500">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function DirectionBadge({ direction }) {
  const long = direction === 'long'
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium',
      long ? 'bg-profit/15 text-profit' : 'bg-loss/15 text-loss',
    )}>
      {long ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {long ? 'Long' : 'Short'}
    </span>
  )
}

export function StatusBadge({ status }) {
  const open = status === 'open'
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium',
      open ? 'bg-accent/15 text-accent' : 'bg-ink-700 text-slate-400',
    )}>
      <span className={clsx('w-1.5 h-1.5 rounded-full', open ? 'bg-accent animate-pulse' : 'bg-slate-500')} />
      {open ? 'Open' : 'Closed'}
    </span>
  )
}

export function Segmented({ options, value, onChange, size = 'md' }) {
  return (
    <div className="inline-flex rounded-lg border border-ink-600 bg-ink-850 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-md font-medium transition-colors',
            size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
            value === o.value ? 'bg-ink-700 text-white' : 'text-slate-400 hover:text-slate-200',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Rating({ value }) {
  if (!value) return <span className="text-slate-600">—</span>
  return (
    <span className="text-amber-400 text-xs tracking-tight">
      {'★'.repeat(value)}<span className="text-slate-700">{'★'.repeat(5 - value)}</span>
    </span>
  )
}
