import { useEffect, useState, useCallback, useRef, Fragment } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Radio, RefreshCw, Activity, ChevronRight, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import { useStore } from '../store'
import { api } from '../api'
import { money, num, price as fprice, lots as flots, pnlClass, priceDecimals } from '../lib/format'
import { DirectionBadge, EmptyState, Center, Spinner } from '../components/ui'

const REFRESH_MS = 5000

function Metric({ label, value, cls, sub }) {
  return (
    <div className="bg-ink-850 rounded-lg p-3">
      <div className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={clsx('text-lg font-semibold tabular-nums mt-0.5', cls)}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function marginLevelCls(lvl) {
  if (lvl == null) return 'text-slate-400'
  if (lvl >= 200) return 'text-profit'
  if (lvl >= 100) return 'text-amber-400'
  return 'text-loss'
}

function RiskBar({ label, r }) {
  if (!r) return null
  const cls = r.status === 'breach' ? 'bg-loss' : r.status === 'warning' ? 'bg-amber-400' : 'bg-profit'
  return (
    <div className="flex-1 min-w-[150px]">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-slate-400">{label}</span>
        <span className="tabular-nums text-slate-300">{money(r.used, { decimals: 0 })} / {money(r.limit, { decimals: 0 })}</span>
      </div>
      <div className="h-1.5 rounded-full bg-ink-700 overflow-hidden">
        <div className={clsx('h-full rounded-full', cls)} style={{ width: `${Math.min(r.pct, 100)}%` }} />
      </div>
    </div>
  )
}

// Roll the broker's raw positions up by symbol+direction, the way the Trades page rolls
// scale-ins into one trade. Lots/margin/swap/PnL sum; entry is lots-weighted.
function groupPositions(positions) {
  const by = new Map()
  positions.forEach((p) => {
    const key = `${p.symbol}|${p.direction}`
    const g = by.get(key) || {
      key, symbol: p.symbol, direction: p.direction, items: [],
      lots: 0, margin: 0, swap: 0, unrealized: 0, notional: 0, mark: p.mark, live: p.live,
    }
    g.items.push(p)
    g.lots += p.lots || 0
    g.margin += p.margin || 0
    g.swap += p.swap || 0
    g.unrealized += p.unrealized || 0
    g.notional += (p.entry || 0) * (p.lots || 0)
    g.mark = p.mark
    g.live = g.live || p.live
    by.set(key, g)
  })
  return [...by.values()]
    .map((g) => ({ ...g, avgEntry: g.lots > 0 ? g.notional / g.lots : g.items[0]?.entry }))
    .sort((a, b) => a.unrealized - b.unrealized)
}

function AccountLive({ a }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState({})
  const toggle = (k) => setExpanded((p) => ({ ...p, [k]: !p[k] }))
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: a.color }} />
        <h2 className="font-semibold">{a.name}</h2>
        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', a.source === 'ctrader' ? 'bg-profit/15 text-profit' : 'bg-ink-700 text-slate-400')}>
          {a.source === 'ctrader' ? 'broker live' : 'local estimate'}
        </span>
        <span className="ml-auto text-xs text-slate-500">{a.open_count} open · {a.leverage ? `1:${a.leverage}` : 'no leverage'}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        <Metric label="Balance" value={money(a.balance)} />
        <Metric label="Equity" value={money(a.equity)} cls={pnlClass(a.floating_pnl)} />
        <Metric label="Floating P&L" value={money(a.floating_pnl, { sign: true })} cls={pnlClass(a.floating_pnl)} />
        <Metric label="Used margin" value={money(a.used_margin)} />
        <Metric label="Free margin" value={money(a.free_margin)} cls={a.free_margin < 0 ? 'text-loss' : ''} />
        <Metric label="Margin level" value={a.margin_level != null ? `${num(a.margin_level, 0)}%` : '—'} cls={marginLevelCls(a.margin_level)} />
      </div>

      {a.risk && (a.risk.daily || a.risk.max_loss) && (
        <div className="flex flex-wrap gap-4 mt-3">
          <RiskBar label="Daily loss" r={a.risk.daily} />
          <RiskBar label="Max drawdown" r={a.risk.max_loss} />
        </div>
      )}

      {a.positions.length > 0 ? (
        <div className="overflow-x-auto mt-3">
          <table className="w-full min-w-[560px]">
            <thead><tr>
              <th className="th w-6"></th>
              <th className="th">Symbol</th><th className="th">Dir</th>
              <th className="th text-right">Lots</th><th className="th text-right">Avg entry</th>
              <th className="th text-right">Mark</th><th className="th text-right">Margin</th>
              <th className="th text-right">Swap</th><th className="th text-right">Unrealized</th>
            </tr></thead>
            <tbody>
              {groupPositions(a.positions).map((g) => {
                const many = g.items.length > 1
                const isOpen = !!expanded[g.key]
                return (
                  <Fragment key={g.key}>
                    <tr
                      className={clsx('hover:bg-ink-800/40', (many || g.items[0].trade_id) && 'cursor-pointer')}
                      onClick={() => {
                        if (many) toggle(g.key)
                        else if (g.items[0].trade_id) navigate(`/trades/${g.items[0].trade_id}`)
                      }}
                    >
                      <td className="td text-center text-slate-500">
                        {many && (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
                      </td>
                      <td className="td font-medium">
                        {g.symbol}
                        {many && <span className="ml-1.5 text-[10px] text-slate-500">{g.items.length} positions</span>}
                      </td>
                      <td className="td"><DirectionBadge direction={g.direction} /></td>
                      <td className="td text-right tabular-nums">{flots(g.lots)}</td>
                      <td className="td text-right tabular-nums">{fprice(g.avgEntry, priceDecimals(g.symbol, g.avgEntry))}</td>
                      <td className="td text-right tabular-nums">
                        <span className="inline-flex items-center gap-1 justify-end">
                          {g.live && <Radio size={9} className="text-profit" />}
                          {fprice(g.mark, priceDecimals(g.symbol, g.mark))}
                        </span>
                      </td>
                      <td className="td text-right tabular-nums text-slate-400">{money(g.margin, { decimals: 0 })}</td>
                      <td className="td text-right tabular-nums text-slate-500">{g.swap ? money(g.swap, { sign: true, decimals: 0 }) : '—'}</td>
                      <td className={clsx('td text-right tabular-nums font-medium', pnlClass(g.unrealized))}>{money(g.unrealized, { sign: true })}</td>
                    </tr>
                    {many && isOpen && g.items.map((p, i) => (
                      <tr key={i} className={clsx('bg-ink-850/40 text-xs', p.trade_id && 'cursor-pointer hover:bg-ink-800/40')}
                        onClick={() => p.trade_id && navigate(`/trades/${p.trade_id}`)}>
                        <td className="td"></td>
                        <td className="td text-slate-500">position</td>
                        <td className="td"></td>
                        <td className="td text-right tabular-nums text-slate-400">{flots(p.lots)}</td>
                        <td className="td text-right tabular-nums text-slate-400">{fprice(p.entry, priceDecimals(p.symbol, p.entry))}</td>
                        <td className="td"></td>
                        <td className="td text-right tabular-nums text-slate-500">{money(p.margin, { decimals: 0 })}</td>
                        <td className="td text-right tabular-nums text-slate-500">{p.swap ? money(p.swap, { sign: true, decimals: 0 }) : '—'}</td>
                        <td className={clsx('td text-right tabular-nums', pnlClass(p.unrealized))}>{money(p.unrealized, { sign: true })}</td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-sm text-slate-600 mt-3">No open positions.</div>
      )}
    </div>
  )
}

export default function Live() {
  const { accountId, activeAccount } = useStore()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef(null)

  const load = useCallback((fresh = false) => {
    api.liveAccount(accountId, fresh).then((d) => { setData(d); setErr(null) }).catch((e) => setErr(e.message))
  }, [accountId])

  useEffect(() => {
    load()
    timer.current = setInterval(() => load(false), REFRESH_MS)
    return () => clearInterval(timer.current)
  }, [load])

  const refresh = async () => { setBusy(true); await load(true); setBusy(false) }

  if (!data && !err) return <Center className="h-64"><Spinner className="w-6 h-6" /></Center>
  if (err) return <EmptyState title="Failed to load live data" hint={err} />

  const t = data.totals
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Activity size={20} className="text-accent" />
          <h1 className="text-lg font-semibold">Live</h1>
          <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', data.source === 'ctrader' ? 'bg-profit/15 text-profit' : 'bg-ink-700 text-slate-400')}>
            {data.source === 'ctrader' ? 'broker live' : 'local estimate'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 flex items-center gap-1"><Radio size={11} className="text-profit animate-pulse" /> auto every {REFRESH_MS / 1000}s</span>
          <button className="btn text-xs" disabled={busy} onClick={refresh}><RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Sync from cTrader</button>
        </div>
      </div>

      {/* aggregate strip (all-accounts view) */}
      {!accountId && data.accounts.length > 1 && (
        <div className="card p-4">
          <div className="text-sm font-medium text-slate-300 mb-3">All accounts</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
            <Metric label="Balance" value={money(t.balance)} />
            <Metric label="Equity" value={money(t.equity)} cls={pnlClass(t.floating_pnl)} />
            <Metric label="Floating P&L" value={money(t.floating_pnl, { sign: true })} cls={pnlClass(t.floating_pnl)} />
            <Metric label="Used margin" value={money(t.used_margin)} />
            <Metric label="Free margin" value={money(t.free_margin)} cls={t.free_margin < 0 ? 'text-loss' : ''} />
            <Metric label="Open positions" value={t.open_count} />
          </div>
        </div>
      )}

      {data.accounts.length === 0 && (
        <EmptyState title="No accounts" hint="Add an account or sync from cTrader to see live stats." action={<Link to="/settings" className="btn btn-primary">Go to Settings</Link>} />
      )}

      {data.accounts.map((a) => <AccountLive key={a.account_id} a={a} />)}

      {data.source !== 'ctrader' && data.accounts.length > 0 && (
        <p className="text-xs text-slate-600">
          Showing local estimates (open positions from your last sync; margin estimated from account leverage).
          Connect cTrader and keep auto-sync on for exact broker positions, margin and balance.
        </p>
      )}
    </div>
  )
}
