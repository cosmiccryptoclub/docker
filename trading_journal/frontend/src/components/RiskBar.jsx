import { money } from '../lib/format'

const C = { ok: '#16c784', warning: '#f59e0b', breach: '#ea3943' }

export function RiskBadge({ status }) {
  const label = status === 'breach' ? 'Breach' : status === 'warning' ? 'At risk' : 'OK'
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={{ background: `${C[status]}22`, color: C[status] }}>{label}</span>
  )
}

export function RiskBar({ label, rule }) {
  if (!rule) return null
  const color = C[rule.status]
  return (
    <div>
      <div className="flex justify-between text-[11px] text-slate-500 mb-0.5">
        <span>{label}</span>
        <span className="tabular-nums">{money(rule.used, { decimals: 0 })} / {money(rule.limit, { decimals: 0 })}</span>
      </div>
      <div className="h-1.5 rounded-full bg-ink-700 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${rule.pct}%`, background: color }} />
      </div>
    </div>
  )
}

export function ProfitBar({ profit }) {
  if (!profit) return null
  const color = profit.reached ? C.ok : '#3b82f6'
  return (
    <div>
      <div className="flex justify-between text-[11px] text-slate-500 mb-0.5">
        <span>Profit target{profit.reached ? ' · reached ✓' : ''}</span>
        <span className="tabular-nums">{money(profit.progress, { decimals: 0, sign: true })} / {money(profit.target, { decimals: 0 })}</span>
      </div>
      <div className="h-1.5 rounded-full bg-ink-700 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${profit.pct}%`, background: color }} />
      </div>
    </div>
  )
}
