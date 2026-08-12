import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { useApi } from '../lib/useApi'
import { api } from '../api'
import { Stat } from '../components/Stat'
import { Center, Spinner, EmptyState, Segmented } from '../components/ui'
import { InfoTip } from '../components/Tooltip'
import LivePnl from '../components/LivePnl'
import PropRules from '../components/PropRules'
import GoalsCard from '../components/Goals'
import EconNews from '../components/EconNews'
import ExitOptimiser from '../components/ExitOptimiser'
import EquityChart from '../components/charts/EquityChart'
import CalendarHeatmap from '../components/charts/CalendarHeatmap'
import PolarityBars from '../components/charts/PolarityBars'
import RHistogram from '../components/charts/RHistogram'
import ResultPerTrade from '../components/charts/ResultPerTrade'
import HourHeatmap from '../components/charts/HourHeatmap'
import {
  money, pct, num, profitFactor, rMultiple, pnlClass, duration, dateOnly,
} from '../lib/format'

const TIP = {
  net: 'Sum of realized PnL across all closed trades in the current view (fees included).',
  winrate: 'Percentage of closed trades with positive realized PnL.',
  pf: 'Profit factor = gross profit ÷ gross loss. Above 1 is profitable; ∞ means no losing trades.',
  expectancy: 'Average realized PnL per closed trade — what you expect to make per trade on average.',
  avgr: 'Average R-multiple: realized PnL divided by the initial risk (entry→stop) per trade.',
  dd: 'Largest peak-to-trough drop of the cumulative PnL curve.',
  streak: 'Longest consecutive run of winning / losing trades.',
  fees: 'Total commissions + swap paid across closed trades.',
}

function distRows(arr) {
  return (arr || []).map((d) => ({
    label: d.key, value: d.net_pnl, sub: `${Math.round(d.win_rate)}%`, subLabel: 'win rate',
  }))
}

function dayStats(calendar) {
  const days = calendar || []
  const green = days.filter((d) => d.pnl > 0)
  const red = days.filter((d) => d.pnl < 0)
  const sum = (a) => a.reduce((s, d) => s + d.pnl, 0)
  const avg = (a) => (a.length ? sum(a) / a.length : 0)
  const tradesTotal = days.reduce((s, d) => s + d.trades, 0)
  return {
    traded: days.length,
    green: green.length,
    red: red.length,
    dayWin: days.length ? (green.length / days.length) * 100 : 0,
    avgGreen: avg(green),
    avgRed: avg(red),
    bestDay: days.reduce((m, d) => (d.pnl > (m?.pnl ?? -Infinity) ? d : m), null),
    worstDay: days.reduce((m, d) => (d.pnl < (m?.pnl ?? Infinity) ? d : m), null),
    avgTrades: days.length ? tradesTotal / days.length : 0,
  }
}

function DayStatRow({ label, value, cls, tip }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-ink-800/70 last:border-0">
      <span className="text-xs text-slate-500 flex items-center gap-1">{label}{tip && <InfoTip label={tip} />}</span>
      <span className={`text-sm tabular-nums ${cls || 'text-slate-200'}`}>{value}</span>
    </div>
  )
}

function BWCard({ label, name, sub, color }) {
  return (
    <div className="bg-ink-850 rounded-lg p-3">
      <div className="text-[10px] text-slate-500 uppercase mb-1">{label}</div>
      <div className="font-semibold leading-tight" style={{ color }}>{name || '—'}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-1">{sub}</div>}
    </div>
  )
}

function LastFive({ trades }) {
  if (!trades?.length) return <span className="text-slate-600">—</span>
  return (
    <span className="flex gap-1">
      {trades.map((t, i) => (
        <span key={i} className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${t.result === 'W' ? 'bg-profit/20 text-profit' : t.result === 'L' ? 'bg-loss/20 text-loss' : 'bg-ink-700 text-slate-400'}`}>{t.result}</span>
      ))}
    </span>
  )
}

function Panel({ title, tip, children, right }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-300">
          {title}{tip && <InfoTip label={tip} />}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

export default function Dashboard() {
  const { apiFilters, accountId, activeAccount } = useStore()
  const [eqMode, setEqMode] = useState('money')
  const key = JSON.stringify(apiFilters)
  const { data, loading, error } = useApi(() => api.overview(apiFilters), [key])

  if (loading && !data) return <Center className="h-64"><Spinner className="w-6 h-6" /></Center>
  if (error) return <EmptyState title="Failed to load dashboard" hint={error.message} />

  const s = data.summary
  const empty = s.trade_count === 0 && data.open_count === 0
  if (empty) {
    return (
      <EmptyState
        title="No trades yet"
        hint="Seed realistic dummy trades to explore the app, or import from cTrader."
        action={<Link to="/settings" className="btn btn-primary">Go to Settings</Link>}
      />
    )
  }

  const scopeName = activeAccount ? activeAccount.name : 'All accounts'

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <p className="text-sm text-slate-500">{scopeName} · {s.trade_count} closed · {data.open_count} open</p>
        </div>
      </div>

      <LivePnl accountId={accountId} />
      <PropRules />
      <GoalsCard accountId={accountId} compact />

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3">
        <Stat label="Net PnL" tip={TIP.net} value={money(s.net_pnl, { sign: true })} valueClass={pnlClass(s.net_pnl)} />
        <Stat label="Win rate" tip={TIP.winrate} value={pct(s.win_rate)} sub={`${s.wins}W / ${s.losses}L`} />
        <Stat label="Profit factor" tip={TIP.pf} value={profitFactor(s.profit_factor)} />
        <Stat label="Expectancy" tip={TIP.expectancy} value={money(s.expectancy, { sign: true })} valueClass={pnlClass(s.expectancy)} sub="per trade" />
        <Stat label="Avg R" tip={TIP.avgr} value={s.avg_r != null ? rMultiple(s.avg_r) : '—'} valueClass={pnlClass(s.avg_r)} />
        <Stat label="Max drawdown" tip={TIP.dd} value={money(-s.max_drawdown)} valueClass="text-loss" sub={s.max_drawdown_pct != null ? pct(-s.max_drawdown_pct) : undefined} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3">
        <Stat label="Avg win" value={money(s.avg_win, { sign: true })} valueClass="text-profit" />
        <Stat label="Avg loss" value={money(s.avg_loss, { sign: true })} valueClass="text-loss" />
        <Stat label="Best day" value={money(s.best_day.pnl, { sign: true })} valueClass="text-profit" sub={s.best_day.date ? dateOnly(s.best_day.date) : undefined} />
        <Stat label="Worst day" value={money(s.worst_day.pnl, { sign: true })} valueClass="text-loss" sub={s.worst_day.date ? dateOnly(s.worst_day.date) : undefined} />
        <Stat label="Win/Loss streak" tip={TIP.streak} value={`${s.max_win_streak} / ${s.max_loss_streak}`} />
        <Stat label="Total fees" tip={TIP.fees} value={money(s.total_fees)} sub={s.avg_duration_hours != null ? `avg hold ${num(s.avg_duration_hours, 1)}h` : undefined} />
      </div>

      {/* Equity + R distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Panel
            title="Equity curve"
            tip="Cumulative account equity ($) or cumulative R (risk-normalized — every trade counted as its risk, removing position-size noise)."
            right={<Segmented size="sm" value={eqMode} onChange={setEqMode} options={[{ value: 'money', label: '$' }, { value: 'r', label: 'R' }]} />}
          >
            <EquityChart data={data.equity} startingBalance={data.starting_balance} mode={eqMode} />
          </Panel>
        </div>
        <Panel title="R-multiple distribution" tip="How many trades fell into each R bucket. A right-skewed shape means winners run bigger than losers.">
          <RHistogram data={data.r_distribution} />
        </Panel>
      </div>

      {/* Calendar + day stats (fills the space next to the calendar) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Panel title="Daily PnL calendar" tip="Each cell is one day; green = net profit, red = net loss, intensity scales with size.">
            <CalendarHeatmap data={data.calendar} />
          </Panel>
        </div>
        <Panel title="Day stats" tip="Performance measured per day rather than per trade — are your green days bigger than your red days?">
          {(() => {
            const ds = dayStats(data.calendar)
            return (
              <div>
                <DayStatRow label="Days traded" value={ds.traded} />
                <DayStatRow label="Green / red days" value={`${ds.green} / ${ds.red}`} />
                <DayStatRow label="Day win rate" value={pct(ds.dayWin)} cls={ds.dayWin >= 50 ? 'text-profit' : 'text-loss'} />
                <DayStatRow label="Avg green day" value={money(ds.avgGreen, { sign: true })} cls="text-profit" />
                <DayStatRow label="Avg red day" value={money(ds.avgRed, { sign: true })} cls="text-loss" />
                <DayStatRow label="Best day" value={money(ds.bestDay?.pnl || 0, { sign: true })} cls="text-profit" tip={ds.bestDay ? dateOnly(ds.bestDay.date) : undefined} />
                <DayStatRow label="Worst day" value={money(ds.worstDay?.pnl || 0, { sign: true })} cls="text-loss" tip={ds.worstDay ? dateOnly(ds.worstDay.date) : undefined} />
                <DayStatRow label="Avg trades / day" value={num(ds.avgTrades, 1)} />
              </div>
            )
          })()}
        </Panel>
      </div>

      {/* Time of day + upcoming news */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Panel title="Time of day" tip="Net PnL by the hour you opened trades — find your best and worst hours (watch for overtrading in the red ones).">
            <HourHeatmap data={data.by_hour} />
          </Panel>
        </div>
        <EconNews />
      </div>

      {/* Result per trade */}
      <Panel title="Result per trade" tip="Every closed trade in sequence as an R-multiple bar — spot your outliers and consistency.">
        <ResultPerTrade equity={data.equity} />
      </Panel>

      {/* Evaluation + Best & Worst */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Evaluation">
          {(() => {
            const ds = dayStats(data.calendar)
            return (
              <div className="grid grid-cols-2 gap-x-6">
                <div>
                  <DayStatRow label="Total trades" value={s.trade_count} />
                  <DayStatRow label="Avg per trading day" tip="Average R per day you traded." value={s.avg_r_per_day != null ? rMultiple(s.avg_r_per_day) : '—'} cls={pnlClass(s.avg_r_per_day)} />
                  <DayStatRow label="Biggest winner" value={s.biggest_winner_r != null ? rMultiple(s.biggest_winner_r) : '—'} cls="text-profit" />
                  <DayStatRow label="Biggest loser" value={s.biggest_loser_r != null ? rMultiple(s.biggest_loser_r) : '—'} cls="text-loss" />
                  <DayStatRow label="Avg hold time" value={s.avg_duration_hours != null ? `${num(s.avg_duration_hours, 1)}h` : '—'} />
                  <DayStatRow label="Win rate w/o BE" tip="Win rate excluding break-even trades." value={pct(s.win_rate_no_be)} />
                  <DayStatRow label="Break-even trades" value={s.breakeven} />
                </div>
                <div>
                  <DayStatRow label="ROI" tip="Net PnL as a % of starting balance." value={data.roi != null ? pct(data.roi) : '—'} cls={pnlClass(data.roi)} />
                  <DayStatRow label="Max drawdown" value={money(-s.max_drawdown)} cls="text-loss" />
                  <DayStatRow label="Winning / losing days" value={`${ds.green} / ${ds.red}`} />
                  <DayStatRow label="Trades per day / week" value={`${num(s.trades_per_day, 2)} / ${num(s.trades_per_week, 2)}`} />
                  <DayStatRow label="Avg planned RRR" tip="Average planned reward:risk from your entry / stop / target." value={s.avg_planned_rrr != null ? `${num(s.avg_planned_rrr, 2)}:1` : '—'} />
                  <DayStatRow label="Plan adherence" tip="Average playbook checklist adherence on trades that used one." value={s.avg_adherence != null ? pct(s.avg_adherence) : '—'} cls={s.avg_adherence >= 70 ? 'text-profit' : ''} />
                  <DayStatRow label="Last 5 trades" value={<LastFive trades={data.last5} />} />
                </div>
              </div>
            )
          })()}
        </Panel>

        <Panel title="Best & worst" tip="Best/worst setup (min 2 trades) and weekday by net PnL.">
          {(() => {
            const s2 = (data.by_setup || []).filter((d) => d.trades >= 2)
            const bestSetup = s2[0]
            const worstSetup = s2[s2.length - 1]
            const dows = data.by_dow || []
            const bestDow = dows[0]
            const worstDow = dows[dows.length - 1]
            return (
              <div className="grid grid-cols-2 gap-3">
                <BWCard label="Best setup" color="#3b82f6" name={bestSetup?.key} sub={bestSetup && `${money(bestSetup.net_pnl, { sign: true, decimals: 0 })} · ${bestSetup.trades} trades · ${Math.round(bestSetup.win_rate)}% win`} />
                <BWCard label="Worst setup" color="#ea3943" name={worstSetup && worstSetup !== bestSetup ? worstSetup.key : '—'} sub={worstSetup && worstSetup !== bestSetup && `${money(worstSetup.net_pnl, { sign: true, decimals: 0 })} · ${worstSetup.trades} trades · ${Math.round(worstSetup.win_rate)}% win`} />
                <BWCard label="Best day" color="#16c784" name={bestDow?.key} sub={bestDow && `${money(bestDow.net_pnl, { sign: true, decimals: 0 })} · ${bestDow.trades} trades · ${Math.round(bestDow.win_rate)}% win`} />
                <BWCard label="Worst day" color="#ea3943" name={worstDow && worstDow !== bestDow ? worstDow.key : '—'} sub={worstDow && worstDow !== bestDow && `${money(worstDow.net_pnl, { sign: true, decimals: 0 })} · ${worstDow.trades} trades · ${Math.round(worstDow.win_rate)}% win`} />
              </div>
            )
          })()}
        </Panel>
      </div>

      {/* Excursion analytics (MAE / MFE) */}
      {data.excursions?.count > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-300 mb-2">
            Excursion analytics
            <InfoTip label="Aggregated from each trade's candles (MAE/MFE). View a trade once to populate its metrics; synced/imported BTC trades use real candles." />
            <span className="text-xs text-slate-600">· {data.excursions.count} trades</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Avg MFE" tip="Average max favourable excursion (peak in your favour), in R." value={data.excursions.avg_mfe_r != null ? rMultiple(data.excursions.avg_mfe_r) : '—'} valueClass="text-profit" />
            <Stat label="Avg MAE" tip="Average max adverse excursion (heat taken before exit), in R." value={data.excursions.avg_mae_r != null ? `${num(data.excursions.avg_mae_r, 2)}R` : '—'} valueClass="text-loss" />
            <Stat label="Avg capture" tip="On winners, the average % of the peak (MFE) you actually kept." value={data.excursions.avg_capture != null ? `${num(data.excursions.avg_capture, 0)}%` : '—'} />
            <Stat label="Avg left on table" tip="Average favourable room still available after your exit (post-mortem), in R." value={data.excursions.avg_left_r != null ? `${num(data.excursions.avg_left_r, 2)}R` : '—'} valueClass="text-amber-400" />
            <Stat label="Exited early" tip="% of trades where more than 0.5R was still on the table after you closed." value={data.excursions.left_money_pct != null ? pct(data.excursions.left_money_pct) : '—'} />
          </div>
        </div>
      )}

      <ExitOptimiser />

      {/* Distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(!accountId && data.per_account.length > 1) && (
          <Panel title="By account" tip="Net PnL per account. The dot is the account's colour; bar direction/colour shows profit or loss.">
            <PolarityBars rows={data.per_account.map((d) => ({ label: d.name, value: d.net_pnl, dot: d.color, sub: d.trades, subLabel: 'trades' }))} />
          </Panel>
        )}
        <Panel title="By symbol" tip="Net PnL grouped by instrument.">
          <PolarityBars rows={distRows(data.by_symbol)} />
        </Panel>
        <Panel title="By setup" tip="Net PnL grouped by your tagged setup / playbook.">
          <PolarityBars rows={distRows(data.by_setup)} />
        </Panel>
        <Panel title="By session" tip="Net PnL grouped by trading session (Asia / London / New York).">
          <PolarityBars rows={distRows(data.by_session)} />
        </Panel>
        <Panel title="By day of week" tip="Net PnL grouped by the weekday the trade closed.">
          <PolarityBars rows={distRows(data.by_dow)} />
        </Panel>
      </div>
    </div>
  )
}
