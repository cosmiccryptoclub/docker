import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, Search, X, EyeOff, Eye, ArrowUpDown, Check } from 'lucide-react'
import clsx from 'clsx'
import { useStore } from '../store'
import { useToast } from '../components/Toast'
import { useApi } from '../lib/useApi'
import { api } from '../api'
import { Spinner, Center, EmptyState, DirectionBadge } from '../components/ui'
import { money, rMultiple, dt, pnlClass } from '../lib/format'

const SORTS = [
  { value: 'missing', label: 'Most missing' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'pnl', label: 'Biggest P&L' },
]

function Meter({ label, value, total, tone = 'accent' }) {
  const pct = total ? (value / total) * 100 : 0
  const bar = tone === 'profit' ? 'bg-profit' : tone === 'amber' ? 'bg-amber-400' : 'bg-accent'
  return (
    <div className="bg-ink-850 rounded-lg p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</span>
        <span className="text-lg font-semibold tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-ink-700 overflow-hidden mt-2">
        <div className={clsx('h-full rounded-full', bar)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  )
}

export default function MissingData() {
  const { apiFilters } = useStore()
  const navigate = useNavigate()
  const toast = useToast()
  const [showIgnored, setShowIgnored] = useState(false)
  const [field, setField] = useState('')      // only trades missing this field
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('missing')
  const [busy, setBusy] = useState(null)

  const query = { ...apiFilters, include_ignored: showIgnored || undefined }
  const key = JSON.stringify(query)
  const { data, loading, error, reload } = useApi(() => api.missingData(query), [key])

  const label = useMemo(
    () => Object.fromEntries((data?.fields || []).map((f) => [f.key, f.label])),
    [data],
  )

  const rows = useMemo(() => {
    let r = data?.rows || []
    if (field) r = r.filter((x) => x.missing.includes(field))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      r = r.filter((x) => `${x.symbol} ${x.account || ''}`.toLowerCase().includes(q))
    }
    const by = {
      missing: (a, b) => b.missing_count - a.missing_count || (b.opened_at || '').localeCompare(a.opened_at || ''),
      newest: (a, b) => (b.opened_at || '').localeCompare(a.opened_at || ''),
      oldest: (a, b) => (a.opened_at || '').localeCompare(b.opened_at || ''),
      pnl: (a, b) => Math.abs(b.realized_pnl || 0) - Math.abs(a.realized_pnl || 0),
    }
    return [...r].sort(by[sort] || by.missing)
  }, [data, field, search, sort])

  const setIgnored = async (id, value) => {
    setBusy(id)
    try {
      await api.updateTrade(id, { data_ignored: value })
      reload()
      toast.success(value ? 'Trade ignored' : 'Trade tracked again')
    } catch (e) { toast.error(e) } finally { setBusy(null) }
  }

  if (loading && !data) return <Center className="h-64"><Spinner className="w-6 h-6" /></Center>
  if (error) return <EmptyState title="Failed to load" hint={error.message} />

  const total = data.total_trades || 0

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <ClipboardList size={20} className="text-accent" />
        <h1 className="text-lg font-semibold">Missing data</h1>
        <span className="text-sm text-slate-500">
          Trades with journal fields left blank — fill them in from one place.
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Meter label="Trades in range" value={total} total={total} />
        <Meter label="Complete" value={data.complete} total={total} tone="profit" />
        <Meter label="Incomplete" value={data.incomplete} total={total} tone="amber" />
        <Meter label="Ignored" value={data.ignored} total={total} />
      </div>

      {/* which field is missing most — click to filter */}
      <div className="card p-3">
        <div className="text-xs text-slate-500 mb-2">Missing by field — click to filter</div>
        <div className="flex flex-wrap gap-1.5">
          {(data.fields || []).map((f) => {
            const n = data.counts?.[f.key] || 0
            const on = field === f.key
            return (
              <button
                key={f.key}
                onClick={() => setField(on ? '' : f.key)}
                disabled={!n && !on}
                className={clsx(
                  'px-2.5 py-1 rounded-lg text-xs border transition-colors',
                  on ? 'bg-accent/15 border-accent/50 text-accent'
                     : n ? 'bg-ink-850 border-ink-700 text-slate-300 hover:border-slate-500'
                         : 'bg-ink-850 border-ink-800 text-slate-600 cursor-default',
                )}
              >
                {f.label} <span className="tabular-nums">{n}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="card p-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input pl-8 w-52" placeholder="Symbol or account…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>Sort: {s.label}</option>)}
        </select>
        <button className={clsx('btn text-xs', showIgnored && 'text-accent')} onClick={() => setShowIgnored((v) => !v)}>
          {showIgnored ? <Eye size={13} /> : <EyeOff size={13} />} {showIgnored ? 'Showing ignored' : 'Hiding ignored'}
        </button>
        {(field || search) && (
          <button className="btn btn-danger text-xs" onClick={() => { setField(''); setSearch('') }}>
            <X size={13} /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-slate-500">{rows.length} shown</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={data.incomplete === 0 ? 'Everything is filled in' : 'Nothing matches these filters'}
          hint={data.incomplete === 0
            ? 'Every trade in range has a setup, timeframe, rating, notes, stop, playbook and tags.'
            : 'Try clearing the field filter or the search.'}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead><tr>
              <th className="th">Opened</th>
              <th className="th">Symbol</th>
              <th className="th">Account</th>
              <th className="th text-right">P&amp;L</th>
              <th className="th text-right">R</th>
              <th className="th">Missing</th>
              <th className="th"></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={clsx('hover:bg-ink-800/40', r.data_ignored && 'opacity-45')}>
                  <td className="td whitespace-nowrap text-slate-400 text-xs cursor-pointer"
                    onClick={() => navigate(`/trades/${r.id}`)}>
                    {dt(r.opened_at, 'dd MMM yyyy HH:mm')}
                  </td>
                  <td className="td font-medium cursor-pointer" onClick={() => navigate(`/trades/${r.id}`)}>
                    <span className="flex items-center gap-2">{r.symbol} <DirectionBadge direction={r.direction} /></span>
                  </td>
                  <td className="td text-xs text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: r.account_color }} />
                      {r.account}
                    </span>
                  </td>
                  <td className={clsx('td text-right tabular-nums', pnlClass(r.realized_pnl))}>
                    {money(r.realized_pnl, { sign: true })}
                  </td>
                  <td className={clsx('td text-right tabular-nums', pnlClass(r.r_multiple))}>
                    {r.r_multiple != null ? rMultiple(r.r_multiple) : '—'}
                  </td>
                  <td className="td">
                    <span className="flex flex-wrap gap-1">
                      {r.missing.length === 0
                        ? <span className="inline-flex items-center gap-1 text-xs text-profit"><Check size={12} /> complete</span>
                        : r.missing.map((m) => (
                          <span key={m} className="px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 text-[11px]">
                            {label[m] || m}
                          </span>
                        ))}
                    </span>
                  </td>
                  <td className="td text-right">
                    <button
                      className="btn px-2 py-1 text-xs"
                      disabled={busy === r.id}
                      onClick={() => setIgnored(r.id, !r.data_ignored)}
                      title={r.data_ignored ? 'Track this trade again' : "Ignore — don't chase this one"}
                    >
                      {r.data_ignored ? <><Eye size={12} /> Unignore</> : <><EyeOff size={12} /> Ignore</>}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
