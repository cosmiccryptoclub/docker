import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trophy, TrendingDown, Filter } from 'lucide-react'
import { useStore } from '../store'
import { useApi } from '../lib/useApi'
import { api } from '../api'
import { Spinner, Center, EmptyState } from '../components/ui'
import { InfoTip } from '../components/Tooltip'
import { money, pct, num, rMultiple, profitFactor, pnlClass } from '../lib/format'

function WinBar({ value }) {
  return (
    <div className="w-16 h-1.5 rounded-full bg-ink-700 overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${Math.min(value, 100)}%`, background: value >= 50 ? '#16c784' : '#ea3943' }} />
    </div>
  )
}

export default function TagInsights() {
  const { apiFilters, setTagOptionIds } = useStore()
  const navigate = useNavigate()
  // Show a tag as soon as it has ONE closed trade; the threshold is a client-side
  // filter so the page can tell "nothing tagged" apart from "filtered out".
  const [minTrades, setMinTrades] = useState(1)
  const query = { ...apiFilters, min_trades: 1 }
  const { data, loading, error } = useApi(() => api.tagPerformance(query), [JSON.stringify(query)])

  const viewTrades = (optId) => { setTagOptionIds([optId]); navigate('/trades') }

  if (loading && !data) return <Center className="h-64"><Spinner className="w-6 h-6" /></Center>
  if (error) return <EmptyState title="Failed to load tag insights" hint={error.message} />

  const flat = data?.flat || []
  const ranked = [...flat].filter((o) => o.trades >= minTrades)
  const best = [...ranked].sort((a, b) => b.win_rate - a.win_rate).slice(0, 5)
  const worst = [...ranked].sort((a, b) => a.win_rate - b.win_rate).slice(0, 5)

  if (flat.length === 0) {
    // Tagged trades exist but none has closed yet — stats need a realized result.
    if (data?.open_tagged > 0) {
      return (
        <EmptyState
          title={`${data.open_tagged} tagged trade${data.open_tagged === 1 ? '' : 's'} — still open`}
          hint="Tag performance is measured on realized results, so trades only appear here once they're closed. Your tags are saved and will show up automatically."
        />
      )
    }
    return <EmptyState title="No tagged trades in range" hint="Apply analysis tags to trades (on the trade page), then come back to see which tags perform best. Only closed trades are counted." />
  }

  // Tags exist, but the minimum-trades threshold hides them all — say so, and offer
  // the fix, instead of showing a blank page.
  if (ranked.length === 0) {
    return (
      <EmptyState
        title={`No tag has ${minTrades}+ closed trades yet`}
        hint={`${flat.length} tag${flat.length === 1 ? ' has' : 's have'} results, but fewer than ${minTrades} trades each — not enough to rank on. Lower the threshold to see them.`}
        action={<button className="btn btn-primary" onClick={() => setMinTrades(1)}>Show every tag</button>}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Tag Insights</h1>
          <p className="text-sm text-slate-500">Which tags and setups actually make money. Filter by account/date up top.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          Min trades
          <input type="number" min={1} value={minTrades} onChange={(e) => setMinTrades(Math.max(1, +e.target.value || 1))} className="input w-16" />
        </label>
      </div>

      {/* leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-profit mb-3"><Trophy size={15} /> Best win rate <InfoTip label={`Tags with the highest win rate (min ${minTrades} trades) in the current view.`} /></div>
          <div className="space-y-2">
            {best.map((o) => (
              <button key={o.option_id} onClick={() => viewTrades(o.option_id)} className="w-full flex items-center gap-3 text-sm hover:bg-ink-800/50 rounded px-1 py-1">
                <span className="flex-1 text-left truncate text-slate-300">{o.name}</span>
                <WinBar value={o.win_rate} />
                <span className="w-10 text-right tabular-nums text-slate-300">{num(o.win_rate, 0)}%</span>
                <span className="w-14 text-right tabular-nums text-slate-500">{o.trades}t</span>
                <span className={`w-20 text-right tabular-nums ${pnlClass(o.net_pnl)}`}>{money(o.net_pnl, { sign: true, decimals: 0 })}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-loss mb-3"><TrendingDown size={15} /> Worst win rate <InfoTip label="Tags that are dragging your results down — candidates to avoid or fix." /></div>
          <div className="space-y-2">
            {worst.map((o) => (
              <button key={o.option_id} onClick={() => viewTrades(o.option_id)} className="w-full flex items-center gap-3 text-sm hover:bg-ink-800/50 rounded px-1 py-1">
                <span className="flex-1 text-left truncate text-slate-300">{o.name}</span>
                <WinBar value={o.win_rate} />
                <span className="w-10 text-right tabular-nums text-slate-300">{num(o.win_rate, 0)}%</span>
                <span className="w-14 text-right tabular-nums text-slate-500">{o.trades}t</span>
                <span className={`w-20 text-right tabular-nums ${pnlClass(o.net_pnl)}`}>{money(o.net_pnl, { sign: true, decimals: 0 })}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* per-category tables */}
      {(data?.categories || []).map((cat) => (
        <div key={cat.category_id} className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: cat.color }} />
            <span className="font-medium text-slate-200">{cat.name}</span>
            <span className={`text-sm tabular-nums ${pnlClass(cat.net_pnl)}`}>{money(cat.net_pnl, { sign: true, decimals: 0 })}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead><tr>
                <th className="th">Tag</th>
                <th className="th text-right">Trades</th>
                <th className="th text-right">Win rate</th>
                <th className="th text-right">Net PnL</th>
                <th className="th text-right">Expectancy</th>
                <th className="th text-right">Avg R</th>
                <th className="th text-right">PF</th>
                <th className="th"></th>
              </tr></thead>
              <tbody>
                {cat.options.map((o) => (
                  <tr key={o.option_id} className="hover:bg-ink-800/40">
                    <td className="td text-slate-200">{o.name}</td>
                    <td className="td text-right tabular-nums text-slate-400">{o.trades}</td>
                    <td className="td text-right tabular-nums"><span className="inline-flex items-center gap-2 justify-end"><WinBar value={o.win_rate} />{num(o.win_rate, 0)}%</span></td>
                    <td className={`td text-right tabular-nums font-medium ${pnlClass(o.net_pnl)}`}>{money(o.net_pnl, { sign: true })}</td>
                    <td className={`td text-right tabular-nums ${pnlClass(o.expectancy)}`}>{money(o.expectancy, { sign: true })}</td>
                    <td className={`td text-right tabular-nums ${pnlClass(o.avg_r)}`}>{o.avg_r != null ? rMultiple(o.avg_r) : '—'}</td>
                    <td className="td text-right tabular-nums text-slate-400">{profitFactor(o.profit_factor)}</td>
                    <td className="td text-right"><button onClick={() => viewTrades(o.option_id)} className="text-accent hover:underline text-xs inline-flex items-center gap-1"><Filter size={11} /> trades</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
