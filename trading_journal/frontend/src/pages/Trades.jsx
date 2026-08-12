import { useState, useMemo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, ChevronRight, ChevronDown, Download, Layers } from 'lucide-react'
import { useStore } from '../store'
import { useApi } from '../lib/useApi'
import { api } from '../api'
import { Spinner, Center, EmptyState, DirectionBadge, StatusBadge, Rating } from '../components/ui'
import { money, price, lots, rMultiple, dt, pnlClass, priceDecimals } from '../lib/format'

const SORTS = [
  { value: 'opened_at', label: 'Newest' },
  { value: 'realized_pnl', label: 'PnL' },
  { value: 'r_multiple', label: 'R-multiple' },
  { value: 'symbol', label: 'Symbol' },
]

export default function Trades() {
  const { apiFilters, filters, setFilters, resetFilters, meta, accounts, tagOptionIds, setTagOptionIds } = useStore()
  const [sort, setSort] = useState('opened_at')
  const [order, setOrder] = useState('desc')
  const [expanded, setExpanded] = useState({})   // trade_id -> fills[] | 'loading'
  const [selected, setSelected] = useState([])   // trade ids picked for manual grouping
  const [groupBusy, setGroupBusy] = useState(false)
  const [groupErr, setGroupErr] = useState(null)
  const navigate = useNavigate()

  const toggleExpand = async (e, id) => {
    e.stopPropagation()
    if (expanded[id]) { setExpanded((p) => { const n = { ...p }; delete n[id]; return n }); return }
    setExpanded((p) => ({ ...p, [id]: 'loading' }))
    try {
      const full = await api.trade(id)
      setExpanded((p) => ({ ...p, [id]: full.fills || [] }))
    } catch { setExpanded((p) => ({ ...p, [id]: [] })) }
  }

  const accById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts])
  const query = { ...apiFilters, sort, order, limit: 300 }
  const key = JSON.stringify(query)
  const { data, loading, error } = useApi(() => api.trades(query), [key])

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value })
  const toggleSort = (v) => {
    if (v === sort) setOrder((o) => (o === 'desc' ? 'asc' : 'desc'))
    else { setSort(v); setOrder('desc') }
  }

  const hasFilters = Object.values(filters).some((v) => v) || tagOptionIds.length > 0

  const toggleSelect = (e, id) => {
    e.stopPropagation()
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }
  const groupSelected = async () => {
    setGroupBusy(true); setGroupErr(null)
    try {
      const merged = await api.groupTrades(selected)
      setSelected([])
      navigate(`/trades/${merged.id}`)
    } catch (err) { setGroupErr(err.message) }
    finally { setGroupBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold">Trades</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-500">{data ? `${data.total} trade${data.total === 1 ? '' : 's'}` : ''}</span>
          <a className="btn text-xs" href={api.exportTradesUrl(apiFilters, 'csv')} download title="Export the current filtered trades as CSV">
            <Download size={13} /> CSV
          </a>
          <a className="btn text-xs" href={api.exportTradesUrl(apiFilters, 'csv', true)} download title="Every fill (entries + exits) as CSV">
            <Download size={13} /> Fills
          </a>
          <a className="btn text-xs" href={api.exportTradesUrl(apiFilters, 'json')} download title="Full trades + fills as JSON">
            <Download size={13} /> JSON
          </a>
        </div>
      </div>

      {/* filter bar */}
      <div className="card p-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input pl-8 w-52" placeholder="Search notes, tags, symbol…" value={filters.search} onChange={set('search')} />
        </div>
        <select className="input" value={filters.symbol} onChange={set('symbol')}>
          <option value="">All symbols</option>
          {(meta?.used_symbols || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={filters.status} onChange={set('status')}>
          <option value="">Open + closed</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
        <select className="input" value={filters.direction} onChange={set('direction')}>
          <option value="">Long + short</option>
          <option value="long">Long</option>
          <option value="short">Short</option>
        </select>
        <select className="input" value={filters.setup} onChange={set('setup')}>
          <option value="">All setups</option>
          {(meta?.setups || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={filters.session} onChange={set('session')}>
          <option value="">All sessions</option>
          {(meta?.sessions || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={sort} onChange={(e) => toggleSort(e.target.value)}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>Sort: {s.label}</option>)}
        </select>
        {tagOptionIds.length > 0 && (
          <span className="chip bg-accent/15 border-accent/40 text-accent">
            {tagOptionIds.length} tag filter{tagOptionIds.length > 1 ? 's' : ''}
            <button onClick={() => setTagOptionIds([])} className="ml-1"><X size={12} /></button>
          </span>
        )}
        {hasFilters && (
          <button className="btn btn-danger" onClick={resetFilters}><X size={14} /> Clear</button>
        )}
      </div>

      {selected.length > 0 && (
        <div className="card p-3 flex items-center gap-3 flex-wrap ring-1 ring-accent/40">
          <span className="text-sm">{selected.length} trade{selected.length === 1 ? '' : 's'} selected</span>
          <button className="btn btn-primary text-xs" disabled={selected.length < 2 || groupBusy} onClick={groupSelected}>
            <Layers size={13} /> {groupBusy ? 'Grouping…' : 'Group into one trade'}
          </button>
          <button className="btn text-xs" onClick={() => { setSelected([]); setGroupErr(null) }}>Clear</button>
          <span className="text-xs text-slate-500">Must share account, symbol and direction. The grouping survives re-syncs.</span>
          {groupErr && <span className="text-xs text-loss">{groupErr}</span>}
        </div>
      )}

      {error && <EmptyState title="Failed to load trades" hint={error.message} />}
      {loading && !data ? (
        <Center className="h-64"><Spinner className="w-6 h-6" /></Center>
      ) : data && data.trades.length === 0 ? (
        <EmptyState title="No trades match these filters" hint="Try clearing filters or widening the date range." />
      ) : data && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[1040px]">
            <thead>
              <tr>
                <th className="th w-6"></th>
                <th className="th w-6"></th>
                <th className="th">Opened</th>
                <th className="th">Symbol</th>
                <th className="th">Account</th>
                <th className="th">Structure</th>
                <th className="th text-right">Size</th>
                <th className="th text-right">Margin</th>
                <th className="th text-right">Avg entry</th>
                <th className="th text-right">Realized</th>
                <th className="th text-right">R</th>
                <th className="th">Setup</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {data.trades.map((t) => {
                const acc = accById[t.account_id]
                const dec = priceDecimals(t.symbol, t.avg_entry)
                const margin = (t.notional || 0) / (acc?.leverage || 1)
                const fills = expanded[t.id]
                const isOpen = fills !== undefined
                return (
                  <Fragment key={t.id}>
                    <tr onClick={() => navigate(`/trades/${t.id}`)} className="cursor-pointer hover:bg-ink-800/60">
                      <td className="td text-center" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.includes(t.id)}
                          onChange={(e) => toggleSelect(e, t.id)}
                          title="Select to group with other trades" />
                      </td>
                      <td className="td text-center">
                        <button onClick={(e) => toggleExpand(e, t.id)} className="text-slate-500 hover:text-slate-200">
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                      <td className="td whitespace-nowrap text-slate-400">{dt(t.opened_at, 'dd MMM HH:mm:ss')}</td>
                      <td className="td"><div className="flex items-center gap-2"><span className="font-medium">{t.symbol}</span><DirectionBadge direction={t.direction} /></div></td>
                      <td className="td">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: acc?.color || '#888' }} />
                          <span className="text-slate-400 text-xs truncate max-w-[140px]" title={acc?.name}>{acc?.name || t.account_id}</span>
                        </span>
                      </td>
                      <td className="td whitespace-nowrap text-slate-400 text-xs">
                        <span className="text-accent">{t.entry_count ?? '—'} in</span>
                        <span className="text-slate-600"> · </span>
                        <span className="text-profit">{t.exit_count ?? '—'} out</span>
                      </td>
                      <td className="td text-right tabular-nums">{lots(t.total_entry_lots)}</td>
                      <td className="td text-right tabular-nums text-slate-400" title={`notional ${money(t.notional || 0)}`}>{money(margin, { decimals: 0 })}</td>
                      <td className="td text-right tabular-nums text-slate-400">{price(t.avg_entry, dec)}</td>
                      <td className={`td text-right tabular-nums font-medium ${pnlClass(t.realized_pnl)}`}>{money(t.realized_pnl, { sign: true })}</td>
                      <td className={`td text-right tabular-nums ${pnlClass(t.r_multiple)}`}>{t.r_multiple != null ? rMultiple(t.r_multiple) : '—'}</td>
                      <td className="td text-slate-400 text-xs truncate max-w-[140px]" title={t.setup}>{t.setup || '—'}</td>
                      <td className="td"><StatusBadge status={t.status} /></td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-ink-900/60">
                        <td></td>
                        <td className="td" colSpan={12}>
                          {fills === 'loading' ? (
                            <div className="text-xs text-slate-500 py-1">Loading fills…</div>
                          ) : fills.length === 0 ? (
                            <div className="text-xs text-slate-600 py-1">No fills.</div>
                          ) : (
                            <div className="py-1">
                              <table className="w-full max-w-[720px]">
                                <tbody>
                                  {fills.map((f) => (
                                    <tr key={f.id} className="text-xs">
                                      <td className={`py-1 pr-4 font-medium ${f.kind === 'entry' ? 'text-accent' : f.kind === 'tp' ? 'text-profit' : f.kind === 'sl' ? 'text-loss' : 'text-slate-400'}`}>
                                        {f.kind === 'entry' ? 'Entry' : f.kind === 'tp' ? 'Take profit' : f.kind === 'sl' ? 'Stop' : 'Close'}{f.note ? ` · ${f.note}` : ''}
                                      </td>
                                      <td className="py-1 pr-4 text-slate-500 whitespace-nowrap">{dt(f.executed_at, 'dd MMM HH:mm:ss')}</td>
                                      <td className="py-1 pr-4 text-right tabular-nums">{price(f.price, dec)}</td>
                                      <td className="py-1 pr-4 text-right tabular-nums">{lots(f.lots)} lots</td>
                                      <td className="py-1 text-right tabular-nums text-slate-500">fee {money(f.fee)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          {data.total > data.count && (
            <div className="p-3 text-center text-xs text-slate-500">Showing {data.count} of {data.total}. Narrow filters to see more.</div>
          )}
        </div>
      )}
    </div>
  )
}
