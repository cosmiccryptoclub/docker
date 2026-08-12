import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react'
import { startOfWeek, endOfWeek, addWeeks, addDays, format, isSameWeek } from 'date-fns'
import { useStore } from '../store'
import { useApi } from '../lib/useApi'
import { api } from '../api'
import { Stat } from '../components/Stat'
import { Spinner, Center, EmptyState, DirectionBadge } from '../components/ui'
import PolarityBars from '../components/charts/PolarityBars'
import { money, pct, num, rMultiple, pnlClass, dt } from '../lib/format'

function TradeRow({ t }) {
  return (
    <Link to={`/trades/${t.id}`} className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-ink-800/60 text-sm">
      <span className="font-medium w-16">{t.symbol}</span>
      <DirectionBadge direction={t.direction} />
      <span className="text-slate-500 text-xs flex-1 truncate">{t.setup || '—'} · {dt(t.closed_at, 'EEE HH:mm')}</span>
      <span className={`tabular-nums ${pnlClass(t.realized_pnl)}`}>{money(t.realized_pnl, { sign: true })}</span>
      <span className={`tabular-nums text-xs w-14 text-right ${pnlClass(t.r_multiple)}`}>{t.r_multiple != null ? rMultiple(t.r_multiple) : ''}</span>
    </Link>
  )
}

export default function Review() {
  const { accountId, activeAccount } = useStore()
  const [offset, setOffset] = useState(0)

  const { start, end, days } = useMemo(() => {
    const base = addWeeks(new Date(), offset)
    const s = startOfWeek(base, { weekStartsOn: 1 })
    const e = endOfWeek(base, { weekStartsOn: 1 })
    return { start: s, end: e, days: Array.from({ length: 7 }, (_, i) => addDays(s, i)) }
  }, [offset])

  const filters = { start: start.toISOString(), end: end.toISOString() }
  if (accountId) filters.account_id = accountId
  const { data, loading } = useApi(() => api.review(filters), [JSON.stringify(filters)])

  const calByDate = useMemo(() => Object.fromEntries((data?.calendar || []).map((d) => [d.date, d])), [data])
  const isThisWeek = isSameWeek(new Date(), start, { weekStartsOn: 1 })

  if (loading && !data) return <Center className="h-64"><Spinner className="w-6 h-6" /></Center>
  const s = data?.summary

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Weekly review</h1>
          <p className="text-sm text-slate-500">{activeAccount ? activeAccount.name : 'All accounts'} · {format(start, 'dd MMM')} – {format(end, 'dd MMM yyyy')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn px-2" onClick={() => setOffset((o) => o - 1)}><ChevronLeft size={15} /></button>
          <button className="btn" onClick={() => setOffset(0)} disabled={isThisWeek}>This week</button>
          <button className="btn px-2" onClick={() => setOffset((o) => o + 1)} disabled={offset >= 0}><ChevronRight size={15} /></button>
        </div>
      </div>

      {!s || s.trade_count === 0 ? (
        <EmptyState title="No closed trades this week" hint="Use the arrows to review a different week." />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
            <Stat label="Net PnL" value={money(s.net_pnl, { sign: true })} valueClass={pnlClass(s.net_pnl)} />
            <Stat label="Win rate" value={pct(s.win_rate)} sub={`${s.wins}W / ${s.losses}L`} />
            <Stat label="Trades" value={s.trade_count} sub={`${data.open_count} still open`} />
            <Stat label="Expectancy" value={money(s.expectancy, { sign: true })} valueClass={pnlClass(s.expectancy)} sub="per trade" />
            <Stat label="Avg R" value={s.avg_r != null ? rMultiple(s.avg_r) : '—'} valueClass={pnlClass(s.avg_r)} />
            <Stat label="Profit factor" value={s.profit_factor != null ? num(s.profit_factor, 2) : '∞'} />
          </div>

          {/* per-day strip */}
          <div className="card p-4">
            <div className="text-sm font-medium text-slate-300 mb-3">Days</div>
            <div className="grid grid-cols-7 gap-2">
              {days.map((d) => {
                const rec = calByDate[format(d, 'yyyy-MM-dd')]
                const pnl = rec?.pnl
                return (
                  <div key={d.toISOString()} className="bg-ink-850 rounded-lg p-2 text-center">
                    <div className="text-[10px] text-slate-500 uppercase">{format(d, 'EEE')}</div>
                    <div className="text-[10px] text-slate-600">{format(d, 'dd')}</div>
                    <div className={`text-sm tabular-nums mt-1 ${pnl == null ? 'text-slate-700' : pnlClass(pnl)}`}>
                      {pnl == null ? '—' : money(pnl, { sign: true, decimals: 0 })}
                    </div>
                    {rec && <div className="text-[10px] text-slate-600">{rec.trades}t</div>}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-4">
              <div className="flex items-center gap-1.5 text-sm font-medium text-profit mb-2"><TrendingUp size={15} /> Best trades</div>
              {data.best_trades.map((t) => <TradeRow key={t.id} t={t} />)}
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-1.5 text-sm font-medium text-loss mb-2"><TrendingDown size={15} /> Worst trades</div>
              {data.worst_trades.map((t) => <TradeRow key={t.id} t={t} />)}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-4">
              <div className="text-sm font-medium text-slate-300 mb-3">By setup</div>
              <PolarityBars rows={(data.by_setup || []).map((d) => ({ label: d.key, value: d.net_pnl, sub: `${Math.round(d.win_rate)}%`, subLabel: 'win' }))} emptyLabel="No setups tagged" />
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-300 mb-3"><AlertTriangle size={15} className="text-amber-400" /> Mistakes this week</div>
              {data.mistakes.length === 0
                ? <div className="text-sm text-slate-600">No mistakes logged — nice.</div>
                : (
                  <div className="space-y-1.5">
                    {data.mistakes.map((m) => (
                      <div key={m.mistake} className="flex items-center justify-between text-sm">
                        <span className="text-slate-300">{m.mistake}</span>
                        <span className="chip">{m.count}×</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
