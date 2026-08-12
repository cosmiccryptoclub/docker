import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Target } from 'lucide-react'
import clsx from 'clsx'
import { num } from '../lib/format'
import { api } from '../api'

export function GoalBar({ label, value, target, unit = '', invert = false, fmt = (v) => num(v, 0), compact = false }) {
  if (!target) return null
  const ratio = Math.min(Math.abs(value) / Math.abs(target), 1)
  const over = invert ? value > target : false           // invert: value is a "bad" thing (loss / count)
  const good = invert ? !over : value >= target
  const barColor = over ? 'bg-loss' : good ? 'bg-profit' : 'bg-accent'
  return (
    <div className={clsx('bg-ink-850 rounded-lg flex-1', compact ? 'p-2 min-w-[120px]' : 'p-3 min-w-[150px]')}>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-slate-400">{label}</span>
        <span className={clsx('tabular-nums font-medium', over ? 'text-loss' : good ? 'text-profit' : 'text-slate-300')}>
          {fmt(value)}{unit} <span className="text-slate-600">/ {fmt(target)}{unit}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-ink-700 overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all', barColor)} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  )
}

function Bars({ goals, progress, compact }) {
  return (
    <div className="flex flex-wrap gap-3">
      <GoalBar label="Trades today" value={progress.trades_today} target={goals.goal_max_trades_per_day} invert compact={compact} fmt={(v) => num(v, 0)} />
      <GoalBar label="Daily loss" value={progress.daily_loss_today} target={goals.goal_max_daily_loss} invert compact={compact} fmt={(v) => `$${num(v, 0)}`} />
      <GoalBar label="Month R" value={progress.month_r} target={goals.goal_monthly_r} unit="R" compact={compact} fmt={(v) => num(v, 1)} />
      {goals.goal_min_adherence_pct > 0 && progress.adherence_pct != null && (
        <GoalBar label="Adherence" value={progress.adherence_pct} target={goals.goal_min_adherence_pct} unit="%" compact={compact} fmt={(v) => num(v, 0)} />
      )}
    </div>
  )
}

/**
 * Self-fetching discipline-goals card.
 *  - placeholder: when no goals are set, show a hint linking to Settings (else render nothing).
 *  - compact: tighter padding for the Dashboard.
 */
export default function GoalsCard({ accountId, compact = false, placeholder = false }) {
  const [data, setData] = useState(null)
  useEffect(() => { api.goals(accountId).then(setData).catch(() => {}) }, [accountId])

  if (!data) return null
  const { goals, progress } = data
  const any = goals.goal_max_trades_per_day || goals.goal_max_daily_loss || goals.goal_monthly_r || goals.goal_min_adherence_pct
  if (!any) {
    if (!placeholder) return null
    return (
      <div className="card p-4 text-sm text-slate-500 flex items-center gap-2">
        <Target size={15} className="text-slate-600" />
        No discipline goals set. Add them in <Link to="/settings" className="text-accent hover:underline">Settings → Discipline goals</Link>.
      </div>
    )
  }
  return (
    <div className={clsx('card', compact ? 'p-3' : 'p-4')}>
      <div className="flex items-center gap-2 mb-3">
        <Target size={15} className="text-accent" />
        <h2 className="font-medium text-sm">Discipline goals</h2>
        <span className="text-xs text-slate-600">this month / today</span>
        {compact && <Link to="/calendar" className="ml-auto text-xs text-accent hover:underline">Journal →</Link>}
      </div>
      <Bars goals={goals} progress={progress} compact={compact} />
    </div>
  )
}
