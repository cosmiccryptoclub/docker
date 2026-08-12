import { ShieldAlert } from 'lucide-react'
import { useStore } from '../store'
import { InfoTip } from './Tooltip'
import { RiskBar, RiskBadge, ProfitBar } from './RiskBar'
import { money, pnlClass } from '../lib/format'

// Prop-firm rule status across accounts that have limits configured.
export default function PropRules() {
  const { accounts, setAccountId } = useStore()
  const withRules = accounts.filter((a) => a.stats?.risk)
  if (withRules.length === 0) return null

  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-300 mb-3">
        <ShieldAlert size={15} className="text-amber-400" /> Prop-firm rules
        <InfoTip label="Live status vs each account's daily-loss / max-drawdown / profit-target limits. Includes today's realized + floating PnL." />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {withRules.map((a) => {
          const r = a.stats.risk
          return (
            <div key={a.id} className="bg-ink-850 rounded-lg p-3 space-y-2.5 cursor-pointer hover:bg-ink-800" onClick={() => setAccountId(a.id)}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-medium truncate">
                  <span className="w-2 h-2 rounded-full" style={{ background: a.color }} />{a.name}
                </span>
                <RiskBadge status={r.status} />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Today</span>
                <span className={`tabular-nums ${pnlClass(r.today_pnl)}`}>{money(r.today_pnl, { sign: true })}</span>
              </div>
              <RiskBar label="Daily loss" rule={r.daily} />
              <RiskBar label={`Max drawdown${r.trailing_dd ? ' (trailing)' : ''}`} rule={r.max_loss} />
              <ProfitBar profit={r.profit} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
