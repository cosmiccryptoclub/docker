import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Trash2, Plus, Save, Upload, Image as ImageIcon, ClipboardPaste, Layers,
} from 'lucide-react'
import { useStore } from '../store'
import { useToast } from '../components/Toast'
import { useApi } from '../lib/useApi'
import { api } from '../api'
import { Spinner, Center, EmptyState, DirectionBadge, StatusBadge } from '../components/ui'
import { Stat } from '../components/Stat'
import { InfoTip } from '../components/Tooltip'
import CandleChart from '../components/charts/CandleChart'
import TradeMap from '../components/charts/TradeMap'
import TagPicker from '../components/TagPicker'
import PlaybookChecklist from '../components/PlaybookChecklist'
import {
  money, price, lots, rMultiple, num, dt, duration, pnlClass, priceDecimals,
} from '../lib/format'

// concrete chart timeframes — relative ones (HTF/MTF/LTF) already live as tags in the
// "Market structure zones" group, and a datalist still allows anything typed by hand
const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1D', '1W', '1M']

const KIND_LABEL = { entry: 'Entry', tp: 'Take profit', sl: 'Stop loss', close: 'Close' }
const KIND_COLOR = { entry: 'text-accent', tp: 'text-profit', sl: 'text-loss', close: 'text-slate-400' }

function runningRows(trade) {
  const sign = trade.direction === 'long' ? 1 : -1
  const cs = trade.contract_size || 1
  const fills = [...(trade.fills || [])].sort((a, b) => new Date(a.executed_at) - new Date(b.executed_at))
  let entryLots = 0, entryCost = 0, remaining = 0, realized = 0
  return fills.map((f) => {
    let pnl = null
    if (f.kind === 'entry') {
      entryLots += f.lots; entryCost += f.price * f.lots; remaining += f.lots
      realized -= f.fee
    } else {
      const avg = entryLots > 0 ? entryCost / entryLots : f.price
      pnl = (f.price - avg) * sign * f.lots * cs - f.fee
      realized += pnl
      remaining -= f.lots
    }
    return { ...f, pnl, remaining: Math.max(remaining, 0), realized }
  })
}

function AnalysisTiles({ analysis }) {
  if (!analysis) return null
  const pm = analysis.post_mortem
  const pmColor = pm
    ? (pm.verdict.startsWith('good') ? 'text-profit' : pm.verdict.startsWith('left') ? 'text-amber-400' : 'text-slate-300')
    : 'text-slate-500'
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat label="MFE (max favourable)" tip="The best unrealised profit the trade reached — how far price went in your favour."
        value={money(analysis.mfe_dollar, { sign: true })} valueClass="text-profit"
        sub={analysis.mfe_r != null ? `${num(analysis.mfe_r, 2)}R potential` : undefined} />
      <Stat label="MAE (max adverse)" tip="The worst unrealised drawdown during the trade — how far price went against you before you exited."
        value={money(-analysis.mae_dollar)} valueClass="text-loss"
        sub={analysis.mae_r != null ? `${num(analysis.mae_r, 2)}R heat` : undefined} />
      <Stat label="Capture" tip="Realized PnL as a % of the peak (MFE) — how much of the available move you actually kept. Winners only."
        value={analysis.captured_pct != null ? `${num(analysis.captured_pct, 0)}%` : '—'}
        valueClass={analysis.captured_pct != null ? pnlClass(analysis.captured_pct) : 'text-slate-500'} sub="of peak" />
      <Stat label="Post-mortem" tip="Looks ahead 1× the trade duration after your exit: was there more money on the table, or did price reverse (good exit)?"
        value={pm ? (pm.verdict.startsWith('good') ? 'Good exit' : pm.verdict.startsWith('left') ? 'Exited early' : 'Fair exit') : '—'}
        valueClass={pmColor}
        sub={pm ? `${money(pm.left_on_table)} left${pm.left_on_table_r != null ? ` · ${num(pm.left_on_table_r, 1)}R` : ''}` : undefined} />
    </div>
  )
}

function AddFillForm({ tradeId, onDone }) {
  const [form, setForm] = useState({ kind: 'tp', price: '', lots: '', fee: '0', executed_at: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async () => {
    if (!form.price || !form.lots) { setErr('Price and lots are required'); return }
    setBusy(true); setErr(null)
    try {
      await api.addFill(tradeId, {
        kind: form.kind, price: parseFloat(form.price), lots: parseFloat(form.lots),
        fee: parseFloat(form.fee || '0'),
        executed_at: form.executed_at ? new Date(form.executed_at).toISOString() : undefined,
      })
      onDone()
      setForm({ kind: 'tp', price: '', lots: '', fee: '0', executed_at: '' })
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 p-2 bg-ink-850 rounded-lg">
      <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
        <option value="entry">Entry (scale-in)</option>
        <option value="tp">Take profit</option>
        <option value="sl">Stop loss</option>
        <option value="close">Close</option>
      </select>
      <input className="input w-28" placeholder="Price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
      <input className="input w-20" placeholder="Lots" value={form.lots} onChange={(e) => setForm({ ...form, lots: e.target.value })} />
      <input className="input w-20" placeholder="Fee" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
      <input className="input" type="datetime-local" value={form.executed_at} onChange={(e) => setForm({ ...form, executed_at: e.target.value })} />
      <button className="btn btn-primary" onClick={submit} disabled={busy}><Plus size={14} /> Add fill</button>
      {err && <span className="text-loss text-xs">{err}</span>}
    </div>
  )
}

function Stars({ value, onChange, title }) {
  return (
    <div className="mt-1.5 flex gap-1" title={title}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onChange(n === value ? 0 : n)}
          className={n <= (value || 0) ? 'text-amber-400' : 'text-slate-700 hover:text-slate-500'}>
          ★
        </button>
      ))}
    </div>
  )
}

function Journal({ trade, onSaved }) {
  const { meta, reloadMeta } = useStore()
  const [f, setF] = useState({
    setup: trade.setup || '', sessions: trade.sessions || [], timeframe: trade.timeframe || '',
    rating: trade.rating || 0, confidence: trade.confidence || 0, notes: trade.notes || '',
    tags: (trade.tags || []).join(', '), mistakes: (trade.mistakes || []).join(', '),
    initial_stop: trade.initial_stop ?? '', last_price: trade.last_price ?? '',
  })
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const save = async () => {
    setBusy(true)
    try {
      await toast.run(() => api.updateTrade(trade.id, {
        setup: f.setup || null, sessions: f.sessions, timeframe: f.timeframe || null,
        rating: f.rating || null, confidence: f.confidence || null, notes: f.notes || null,
        mistakes: f.mistakes.split(',').map((s) => s.trim()).filter(Boolean),
        initial_stop: f.initial_stop === '' ? null : parseFloat(f.initial_stop),
        last_price: f.last_price === '' ? null : parseFloat(f.last_price),
      }), 'Journal saved')
      await reloadMeta()
      onSaved()
    } catch { /* toast already showed the error */ } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-slate-500">Setup
          <input className="input w-full mt-1" value={f.setup} onChange={(e) => setF({ ...f, setup: e.target.value })} />
        </label>
        <div className="text-xs text-slate-500">Sessions
          {/* sessions overlap (London/NY), so this is multi-select */}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {(meta?.sessions || []).map((name) => {
              const on = (f.sessions || []).includes(name)
              return (
                <button
                  key={name}
                  onClick={() => setF({
                    ...f,
                    sessions: on ? f.sessions.filter((x) => x !== name) : [...(f.sessions || []), name],
                  })}
                  className={`px-2 py-1 rounded-lg text-xs border transition-colors ${
                    on ? 'bg-accent/15 border-accent/50 text-accent'
                       : 'bg-ink-850 border-ink-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {name}
                </button>
              )
            })}
          </div>
          <span className="text-[11px] text-slate-600">Filled in from the open time — tick as many as apply.</span>
        </div>
        <label className="text-xs text-slate-500">Timeframe
          <input className="input w-full mt-1" list="tf-list" placeholder="1m · 5m · 4h — or type your own"
            value={f.timeframe} onChange={(e) => setF({ ...f, timeframe: e.target.value })} />
          <datalist id="tf-list">{TIMEFRAMES.map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-500">Rating
            <Stars value={f.rating} onChange={(v) => setF({ ...f, rating: v })}
              title="How well you executed this trade" />
            <span className="text-[11px] text-slate-600">Execution</span>
          </label>
          <label className="text-xs text-slate-500">Confidence
            <Stars value={f.confidence} onChange={(v) => setF({ ...f, confidence: v })}
              title="How convinced you were when you entered" />
            <span className="text-[11px] text-slate-600">Conviction at entry</span>
          </label>
        </div>
        <label className="text-xs text-slate-500">Initial stop
          <input className="input w-full mt-1" value={f.initial_stop} onChange={(e) => setF({ ...f, initial_stop: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500">Last price (open trades)
          <input className="input w-full mt-1" value={f.last_price} onChange={(e) => setF({ ...f, last_price: e.target.value })} />
        </label>
      </div>
      <label className="text-xs text-slate-500 block">Mistakes (comma separated)
        <input className="input w-full mt-1" value={f.mistakes} onChange={(e) => setF({ ...f, mistakes: e.target.value })} />
      </label>
      <label className="text-xs text-slate-500 block">Notes
        <textarea className="input w-full mt-1 h-24 resize-y" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
      <button className="btn btn-primary" onClick={save} disabled={busy}><Save size={14} /> Save journal</button>
    </div>
  )
}

function Screenshots({ trade, onSaved }) {
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(false)

  const uploadFile = useCallback(async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const { url } = await api.upload(file)
      await api.updateTrade(trade.id, { screenshots: [...(trade.screenshots || []), url] })
      onSaved()
    } finally { setBusy(false) }
  }, [trade, onSaved])

  // paste an image from clipboard (Snipping Tool, Discord, etc.)
  useEffect(() => {
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))
      if (!item) return
      const file = item.getAsFile()
      if (file) { setFlash(true); setTimeout(() => setFlash(false), 600); uploadFile(file) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [uploadFile])

  const remove = async (url) => {
    await api.updateTrade(trade.id, { screenshots: (trade.screenshots || []).filter((s) => s !== url) })
    onSaved()
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {(trade.screenshots || []).map((url) => (
          <div key={url} className="relative group">
            <a href={url} target="_blank" rel="noreferrer">
              <img src={url} alt="" className="h-28 w-44 object-cover rounded-lg border border-ink-700" />
            </a>
            <button onClick={() => remove(url)} className="absolute top-1 right-1 bg-black/60 rounded p-1 opacity-0 group-hover:opacity-100"><Trash2 size={12} className="text-loss" /></button>
          </div>
        ))}
      </div>
      <div className={`rounded-lg border border-dashed p-4 text-center text-sm transition-colors ${flash ? 'border-profit text-profit' : 'border-ink-600 text-slate-500'}`}>
        <div className="flex items-center justify-center gap-2">
          <ClipboardPaste size={16} />
          {busy ? 'Uploading…' : flash ? 'Pasted!' : 'Paste an image anywhere (Ctrl+V) — from Snipping Tool, Discord, etc.'}
        </div>
        <label className="btn cursor-pointer w-fit mx-auto mt-3">
          <Upload size={14} /> or choose a file
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { uploadFile(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      </div>
    </div>
  )
}

const CHART_LAYERS = [
  { key: 'entries', label: 'Entries' },
  { key: 'exits', label: 'TPs / exits' },
  { key: 'levels', label: 'Levels' },
  { key: 'zone', label: 'P&L zone' },
  { key: 'news', label: 'News' },
]
const CHART_LAYERS_DEFAULT = { entries: true, exits: true, levels: true, zone: true, news: true }

export default function TradeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { accounts } = useStore()
  const { data: trade, loading, error, reload } = useApi(() => api.trade(id), [id])
  const { data: chart } = useApi(() => api.tradeChart(id), [id])
  const { data: tradeLog } = useApi(() => api.tradeLog(id), [id])

  // chart overlay toggles (remembered across trades + reloads)
  const [show, setShow] = useState(() => {
    try { return { ...CHART_LAYERS_DEFAULT, ...JSON.parse(localStorage.getItem('tj.chartLayers') || '{}') } }
    catch { return CHART_LAYERS_DEFAULT }
  })
  const toggleLayer = (k) => setShow((p) => {
    const next = { ...p, [k]: !p[k] }
    localStorage.setItem('tj.chartLayers', JSON.stringify(next))
    return next
  })

  const acc = trade && accounts.find((a) => a.id === trade.account_id)
  const dec = chart?.decimals ?? (trade ? priceDecimals(trade.symbol, trade.avg_entry) : 2)
  const rows = useMemo(() => (trade ? runningRows(trade) : []), [trade])

  const saveTags = async (ids) => {
    await api.updateTrade(id, { tag_option_ids: ids })
    reload()
  }

  if (loading && !trade) return <Center className="h-64"><Spinner className="w-6 h-6" /></Center>
  if (error) return <EmptyState title="Trade not found" hint={error.message} action={<Link className="btn" to="/trades">Back to trades</Link>} />
  if (!trade) return null

  const ungroup = async () => {
    if (!confirm('Forget this grouping? The trade splits back apart on the next sync.')) return
    const r = await api.ungroupTrade(trade.id)
    alert(r.note || 'This trade was not manually grouped.')
    reload()
  }

  const deleteTrade = async () => {
    if (!confirm('Delete this trade and all its fills?')) return
    await api.deleteTrade(trade.id)
    navigate('/trades')
  }
  const deleteFill = async (fillId) => {
    if (!confirm('Delete this fill? The trade will be recomputed.')) return
    await api.deleteFill(fillId)
    reload()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="btn"><ArrowLeft size={15} /></button>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            {trade.symbol} <DirectionBadge direction={trade.direction} /> <StatusBadge status={trade.status} />
          </h1>
          {acc && <span className="chip"><span className="w-2 h-2 rounded-full" style={{ background: acc.color }} />{acc.name}</span>}
        </div>
        {(trade.position_ids || []).length > 1 && (
          <button onClick={ungroup} className="btn" title="Forget this manual grouping — the trade splits apart on the next sync">
            <Layers size={14} /> Ungroup
          </button>
        )}
        <button onClick={deleteTrade} className="btn btn-danger"><Trash2 size={14} /> Delete</button>
      </div>

      {/* structured tag chips */}
      {(trade.tags_structured || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {/* grouped by category and tinted with the group's colour, so a glance tells
              you which kind of reason each tag is */}
          {Object.values(
            trade.tags_structured.reduce((acc, t) => {
              const k = t.category_id ?? 'x'
              acc[k] = acc[k] || { name: t.category_name, color: t.category_color || '#64748b', items: [] }
              acc[k].items.push(t)
              return acc
            }, {}),
          ).map((g, gi) => (
            <span key={gi} className="inline-flex items-center rounded-lg overflow-hidden border"
              style={{ borderColor: `${g.color}55` }} title={g.name}>
              <span className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                style={{ background: `${g.color}26`, color: g.color }}>
                {g.name}
              </span>
              <span className="flex flex-wrap gap-1 px-1.5 py-0.5 bg-ink-850">
                {g.items.map((t) => (
                  <span key={t.id} className="text-xs text-slate-200">{t.name}</span>
                ))}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="text-sm text-slate-500">
        Opened {dt(trade.opened_at, 'dd MMM yyyy, HH:mm:ss')}{trade.closed_at ? ` · closed ${dt(trade.closed_at, 'dd MMM yyyy, HH:mm:ss')}` : ''}
        {trade.duration_seconds != null && ` · held ${duration(trade.duration_seconds)}`}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Stat label="Realized PnL" value={money(trade.realized_pnl, { sign: true })} valueClass={pnlClass(trade.realized_pnl)} />
        <Stat label="R-multiple" value={trade.r_multiple != null ? rMultiple(trade.r_multiple) : '—'} valueClass={pnlClass(trade.r_multiple)} tip="Realized PnL ÷ initial risk (avg entry → stop)." />
        <Stat label="Avg entry" value={price(trade.avg_entry, dec)} sub={`${lots(trade.total_entry_lots)} lots`} />
        <Stat label="Avg exit" value={price(trade.avg_exit, dec)} sub={`${lots(trade.total_exit_lots)} lots`} />
        <Stat label="Remaining" value={`${lots(trade.remaining_lots)} lots`} valueClass={trade.remaining_lots > 0 ? 'text-accent' : 'text-slate-400'} />
        {trade.status === 'open' && trade.unrealized_pnl != null
          ? <Stat label="Unrealized" value={money(trade.unrealized_pnl, { sign: true })} valueClass={pnlClass(trade.unrealized_pnl)} sub={trade.last_price ? `@ ${price(trade.last_price, dec)}` : undefined} />
          : <Stat label="Fees" value={money(trade.fees_total)} sub={trade.return_pct != null ? `${num(trade.return_pct, 2)}% of acct` : undefined} />}
      </div>

      {/* candle chart */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-slate-300 flex items-center gap-1.5">
            Chart
            <InfoTip label="Candles with your entries, partial TPs and stop plotted. Real candles are used for synced trades on supported instruments; otherwise candles are synthesised through your fills." />
            <span className="flex items-center gap-1 ml-2 flex-wrap">
              {CHART_LAYERS.map((l) => (
                <button
                  key={l.key}
                  onClick={() => toggleLayer(l.key)}
                  title={`${show[l.key] ? 'Hide' : 'Show'} ${l.label.toLowerCase()}`}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                    show[l.key]
                      ? 'bg-accent/15 border-accent/40 text-accent'
                      : 'bg-ink-850 border-ink-700 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </span>
          </div>
          {chart?.analysis && !chart.analysis.synthetic
            ? <span className="text-[11px] text-profit flex items-center gap-1">● real candles · {chart.analysis.source} · {chart.interval / 60 >= 60 ? `${chart.interval / 3600}h` : `${chart.interval / 60}m`}</span>
            : <span className="text-[11px] text-slate-600">synthetic candles</span>}
        </div>
        {chart?.candles?.length
          ? <CandleChart data={chart} direction={trade.direction} decimals={dec} show={show} />
          : <TradeMap trade={trade} decimals={dec} />}
      </div>

      {/* economic events during the trade window */}
      {chart?.events?.length > 0 && (
        <div className="card p-4">
          <div className="text-sm font-medium text-slate-300 mb-2 flex items-center gap-1.5">
            News during this trade
            <InfoTip label="High/medium-impact economic events (ForexFactory) that fell inside the chart window for this instrument's currencies." />
          </div>
          <div className="space-y-1">
            {chart.events.map((ev, i) => (
              <div key={i} className="flex items-center gap-2 text-sm py-1 border-b border-ink-800/60 last:border-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ev.impact === 'High' ? 'bg-loss' : ev.impact === 'Medium' ? 'bg-amber-400' : 'bg-slate-500'}`} />
                <span className="text-slate-400 text-xs tabular-nums w-28 shrink-0">{dt(ev.time * 1000, 'dd MMM HH:mm')}</span>
                <span className="px-1.5 py-0.5 rounded bg-ink-800 text-[10px] font-medium shrink-0">{ev.currency}</span>
                <span className="truncate">{ev.title}</span>
                {(ev.actual || ev.forecast) && (
                  <span className="ml-auto text-xs text-slate-500 shrink-0">
                    {ev.actual ? `act ${ev.actual}` : ''}{ev.actual && ev.forecast ? ' · ' : ''}{ev.forecast ? `f/c ${ev.forecast}` : ''}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* excursion analysis */}
      {chart?.analysis && <AnalysisTiles analysis={chart.analysis} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* fills timeline */}
        <div className="card p-4">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div className="text-sm font-medium text-slate-300 flex items-center gap-1.5">
              Trade log
              <InfoTip label="Everything that happened to this trade in order: scale-in entries, partial take-profits, stop-loss moves and overnight swap / financing charges." />
              <span className="text-xs text-slate-500 font-normal">
                {trade.entry_count} scale-in{trade.entry_count === 1 ? '' : 's'} · {trade.exit_count} exit{trade.exit_count === 1 ? '' : 's'}
                {tradeLog?.totals?.stop_moves > 0 && ` · ${tradeLog.totals.stop_moves} stop move${tradeLog.totals.stop_moves === 1 ? '' : 's'}`}
              </span>
            </div>
            {tradeLog?.totals?.swap ? (
              <span className={`text-xs tabular-nums ${tradeLog.totals.swap < 0 ? 'text-loss' : 'text-profit'}`}>
                swap {money(tradeLog.totals.swap, { sign: true })}
              </span>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead><tr>
                <th className="th">Type</th><th className="th">Time</th>
                <th className="th text-right">Price</th><th className="th text-right">Lots</th>
                <th className="th text-right">Fee</th><th className="th text-right">PnL</th>
                <th className="th text-right">Rem.</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {/* stop moves + swap charges, interleaved by time */}
                {(tradeLog?.rows || []).filter((r) => r.group === 'event').map((e, i) => (
                  <tr key={`ev-${i}`} className="bg-ink-850/40">
                    <td className="td font-medium text-amber-400">
                      {e.kind === 'stop_change' ? 'Stop moved' : e.kind === 'swap' ? 'Swap' : e.kind}
                      {e.note ? <span className="text-slate-600 font-normal"> · {e.note}</span> : ''}
                    </td>
                    <td className="td whitespace-nowrap text-slate-400 text-xs">{dt(e.at, 'dd MMM HH:mm:ss')}</td>
                    <td className="td text-right tabular-nums">
                      {e.price != null ? price(e.price, dec) : '—'}
                      {e.prev_price != null && <span className="text-slate-600 text-xs"> ← {price(e.prev_price, dec)}</span>}
                    </td>
                    <td className="td"></td>
                    <td className={`td text-right tabular-nums ${e.amount ? 'text-loss' : 'text-slate-600'}`}>
                      {e.amount != null ? money(e.amount, { sign: true }) : '—'}
                    </td>
                    <td className="td"></td><td className="td"></td><td className="td"></td>
                  </tr>
                ))}
                {rows.map((f) => (
                  <tr key={f.id} className="hover:bg-ink-800/40">
                    <td className={`td font-medium ${KIND_COLOR[f.kind]}`}>{KIND_LABEL[f.kind]}{f.note ? <span className="text-slate-600 font-normal"> · {f.note}</span> : ''}</td>
                    <td className="td whitespace-nowrap text-slate-400 text-xs">{dt(f.executed_at, 'dd MMM HH:mm:ss')}</td>
                    <td className="td text-right tabular-nums">{price(f.price, dec)}</td>
                    <td className="td text-right tabular-nums">{lots(f.lots)}</td>
                    <td className="td text-right tabular-nums text-slate-500">{money(f.fee)}</td>
                    <td className={`td text-right tabular-nums ${f.pnl == null ? 'text-slate-600' : pnlClass(f.pnl)}`}>{f.pnl == null ? '—' : money(f.pnl, { sign: true })}</td>
                    <td className="td text-right tabular-nums text-slate-400">{lots(f.remaining)}</td>
                    <td className="td text-right"><button onClick={() => deleteFill(f.id)} className="text-slate-600 hover:text-loss"><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3"><AddFillForm tradeId={trade.id} onDone={reload} /></div>
        </div>

        {/* planned targets + analysis tags + journal */}
        <div className="space-y-4">
          {(trade.planned_targets || []).length > 0 && (
            <div className="card p-4">
              <div className="text-sm font-medium text-slate-300 mb-3">Planned targets (ATP)</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {trade.planned_targets.map((t, i) => (
                  <div key={i} className="bg-ink-850 rounded-lg p-2 text-center">
                    <div className="text-[10px] text-slate-500 uppercase">{t.label || `TP${i + 1}`}</div>
                    <div className="text-sm tabular-nums text-slate-200">{price(t.price, dec)}</div>
                    <div className="text-[11px] text-slate-500">{lots(t.lots)} lots</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="card p-4">
            <div className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-1.5">
              Playbook <InfoTip label="Pick a strategy and tick the pre-trade rules you actually followed. Adherence is graded against performance on the Playbooks page." />
            </div>
            <PlaybookChecklist trade={trade} onSaved={reload} />
          </div>
          <div className="card p-4">
            <div className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-1.5">
              Analysis tags <InfoTip label="Multi-select structured tags. Manage the categories on the Tags page; drill into performance on Tag Insights." />
            </div>
            <TagPicker value={trade.tag_option_ids || []} onChange={saveTags} />
          </div>
          <div className="card p-4">
            <div className="text-sm font-medium text-slate-300 mb-3">Journal</div>
            <Journal trade={trade} onSaved={reload} />
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="text-sm font-medium text-slate-300 mb-3">Screenshots</div>
        <Screenshots trade={trade} onSaved={reload} />
      </div>
    </div>
  )
}
