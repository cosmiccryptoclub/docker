import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Play, Pause, StepForward, RotateCcw, TrendingUp, TrendingDown, Save, X } from 'lucide-react'
import { useStore } from '../store'
import { api } from '../api'
import { Spinner } from '../components/ui'
import BacktestChart from '../components/charts/BacktestChart'
import { money, price as fmtPrice, lots as fmtLots, num, pnlClass } from '../lib/format'

const SPEEDS = [1, 2, 4, 8]
const iso = (sec) => new Date(sec * 1000).toISOString()
const decFor = (s) => (s === 'BTCUSD' ? 1 : 2)

function defaultStart() {
  const d = new Date(Date.now() - 7 * 86400_000)
  d.setUTCHours(8, 0, 0, 0)
  return d.toISOString().slice(0, 16)
}

export default function Backtest() {
  const { accounts, reloadAccounts } = useStore()
  const [form, setForm] = useState({ symbol: 'BTCUSD', start: defaultStart(), interval: '1m', size: 0.2 })
  const [loaded, setLoaded] = useState(null)     // {candles, interval_seconds}
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(2)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [pos, setPos] = useState(null)           // {direction, entries[], exits[], stop}
  const [stopInput, setStopInput] = useState('')
  const [tpSize, setTpSize] = useState(0.1)
  const [savedMsg, setSavedMsg] = useState(null)
  const posRef = useRef(pos); posRef.current = pos

  const dec = decFor(form.symbol)
  const candles = loaded?.candles || []
  const bar = candles[idx]

  const load = async () => {
    setBusy(true); setErr(null); setPos(null); setSavedMsg(null)
    try {
      const startIso = new Date(form.start).toISOString()
      const data = await api.backtestCandles({ symbol: form.symbol, start: startIso, interval: form.interval, limit: 600 })
      setLoaded(data)
      setIdx(Math.min(40, data.candles.length - 1))
      setPlaying(false)
    } catch (e) { setErr(e.message); setLoaded(null) } finally { setBusy(false) }
  }

  // derived position stats
  const stats = useMemo(() => {
    if (!pos) return null
    const sign = pos.direction === 'long' ? 1 : -1
    const entryLots = pos.entries.reduce((s, e) => s + e.lots, 0)
    const exitLots = pos.exits.reduce((s, x) => s + x.lots, 0)
    const remaining = Math.max(entryLots - exitLots, 0)
    const avgEntry = entryLots > 0 ? pos.entries.reduce((s, e) => s + e.price * e.lots, 0) / entryLots : null
    let realized = 0
    if (avgEntry != null) pos.exits.forEach((x) => { realized += (x.price - avgEntry) * sign * x.lots })
    const floating = (remaining > 0 && avgEntry != null && bar) ? (bar.close - avgEntry) * sign * remaining : 0
    const closed = entryLots > 0 && remaining <= 1e-9
    return { sign, entryLots, exitLots, remaining, avgEntry, realized, floating, closed }
  }, [pos, bar])

  // auto stop-out check when stepping
  const applyStopCheck = useCallback((candle) => {
    const p = posRef.current
    if (!p || !candle) return
    const sign = p.direction === 'long' ? 1 : -1
    const entryLots = p.entries.reduce((s, e) => s + e.lots, 0)
    const exitLots = p.exits.reduce((s, x) => s + x.lots, 0)
    const remaining = entryLots - exitLots
    if (remaining <= 1e-9 || p.stop == null) return
    const hit = sign > 0 ? candle.low <= p.stop : candle.high >= p.stop
    if (hit) {
      setPos((cur) => ({ ...cur, exits: [...cur.exits, { time: candle.time, price: p.stop, lots: remaining, kind: 'sl' }] }))
    }
  }, [])

  const step = useCallback(() => {
    setIdx((i) => {
      const next = Math.min(i + 1, candles.length - 1)
      applyStopCheck(candles[next])
      return next
    })
  }, [candles, applyStopCheck])

  // playback timer
  useEffect(() => {
    if (!playing) return
    if (idx >= candles.length - 1) { setPlaying(false); return }
    const id = setInterval(() => {
      setIdx((i) => {
        if (i >= candles.length - 1) { setPlaying(false); return i }
        applyStopCheck(candles[i + 1])
        return i + 1
      })
    }, 700 / speed)
    return () => clearInterval(id)
  }, [playing, speed, candles, idx, applyStopCheck])

  const enter = (direction) => {
    if (!bar) return
    if (stats && !stats.closed && pos && pos.direction !== direction && stats.remaining > 0) { setErr('Close the current position before flipping direction.'); return }
    setErr(null)
    setPos((cur) => {
      if (!cur || (stats && stats.closed)) return { direction, entries: [{ time: bar.time, price: bar.close, lots: +form.size }], exits: [], stop: stopInput ? +stopInput : null }
      return { ...cur, entries: [...cur.entries, { time: bar.time, price: bar.close, lots: +form.size }] }
    })
  }
  const takeProfit = () => {
    if (!bar || !stats || stats.remaining <= 0) return
    setPos((cur) => ({ ...cur, exits: [...cur.exits, { time: bar.time, price: bar.close, lots: Math.min(+tpSize, stats.remaining), kind: 'tp' }] }))
  }
  const closeAll = () => {
    if (!bar || !stats || stats.remaining <= 0) return
    setPos((cur) => ({ ...cur, exits: [...cur.exits, { time: bar.time, price: bar.close, lots: stats.remaining, kind: 'close' }] }))
  }
  const setStop = () => setPos((cur) => (cur ? { ...cur, stop: stopInput ? +stopInput : null } : cur))

  const save = async () => {
    if (!pos || !stats?.closed) return
    setBusy(true)
    try {
      let acct = accounts.find((a) => a.is_backtest)
      if (!acct) {
        acct = await api.createAccount({ name: 'Backtest', account_type: 'demo', is_backtest: true, starting_balance: 100000, color: '#8b5cf6' })
        await reloadAccounts()
      }
      const fills = [
        ...pos.entries.map((e) => ({ kind: 'entry', price: e.price, lots: e.lots, executed_at: iso(e.time), fee: 0 })),
        ...pos.exits.map((x) => ({ kind: x.kind, price: x.price, lots: x.lots, executed_at: iso(x.time), fee: 0 })),
      ]
      await api.createTrade({
        account_id: acct.id, symbol: form.symbol, direction: pos.direction,
        opened_at: iso(pos.entries[0].time), contract_size: 1, initial_stop: pos.stop,
        external_id: `bt-${pos.entries[0].time}`, setup: 'Backtest', fills,
      })
      setSavedMsg('Saved to journal (Backtest account).')
      setPos(null); setStopInput('')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const chartFills = pos ? [...pos.entries.map((e) => ({ ...e, kind: 'entry' })), ...pos.exits] : []
  const progress = candles.length ? Math.round((idx / (candles.length - 1)) * 100) : 0

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Backtest sandbox</h1>
        <p className="text-sm text-slate-500">Replay real historical candles with the future hidden, place simulated trades, and save them to the journal.</p>
      </div>

      {/* setup */}
      <div className="card p-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-500">Symbol
          <select className="input w-full mt-1" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })}>
            <option value="BTCUSD">BTCUSD</option><option value="ETHUSD">ETHUSD</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">Start (UTC)
          <input type="datetime-local" className="input w-full mt-1" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500">Timeframe
          <select className="input w-full mt-1" value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value })}>
            {['1m', '5m', '15m', '1h'].map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" onClick={load} disabled={busy}>{busy ? <Spinner className="w-4 h-4" /> : 'Load candles'}</button>
        {err && <span className="text-loss text-xs">{err}</span>}
        {savedMsg && <span className="text-profit text-xs">{savedMsg}</span>}
      </div>

      {loaded && (
        <>
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2 text-xs text-slate-500">
              <span>{form.symbol} · {form.interval} · bar {idx + 1}/{candles.length}{bar ? ` · ${new Date(bar.time * 1000).toISOString().slice(0, 16).replace('T', ' ')}` : ''}</span>
              <span className="tabular-nums text-slate-300">{bar ? fmtPrice(bar.close, dec) : ''}</span>
            </div>
            <BacktestChart candles={candles} upTo={idx} direction={pos?.direction || 'long'} fills={chartFills} avgEntry={stats?.avgEntry ?? null} stop={pos?.stop ?? null} decimals={dec} />
            {/* playback */}
            <div className="mt-2 flex items-center gap-2 text-xs">
              {!playing
                ? <button className="btn px-2 py-1" onClick={() => setPlaying(true)} disabled={idx >= candles.length - 1}><Play size={13} /></button>
                : <button className="btn px-2 py-1" onClick={() => setPlaying(false)}><Pause size={13} /></button>}
              <button className="btn px-2 py-1" onClick={step} disabled={idx >= candles.length - 1}><StepForward size={13} /></button>
              <input type="range" min={0} max={candles.length - 1} value={idx} onChange={(e) => { setPlaying(false); setIdx(+e.target.value) }} className="flex-1 accent-accent" />
              <span className="tabular-nums text-slate-500 w-10 text-right">{progress}%</span>
              <select value={speed} onChange={(e) => setSpeed(+e.target.value)} className="input py-0.5 px-1 text-xs">
                {SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
              </select>
            </div>
          </div>

          {/* trade panel */}
          <div className="card p-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
              <div><div className="text-[10px] text-slate-500 uppercase">Position</div><div className="text-sm font-medium">{pos ? `${pos.direction} ${fmtLots(stats.remaining)}` : '—'}</div></div>
              <div><div className="text-[10px] text-slate-500 uppercase">Avg entry</div><div className="text-sm tabular-nums">{stats?.avgEntry != null ? fmtPrice(stats.avgEntry, dec) : '—'}</div></div>
              <div><div className="text-[10px] text-slate-500 uppercase">Floating</div><div className={`text-sm tabular-nums ${pnlClass(stats?.floating)}`}>{stats ? money(stats.floating, { sign: true }) : '—'}</div></div>
              <div><div className="text-[10px] text-slate-500 uppercase">Realized</div><div className={`text-sm tabular-nums ${pnlClass(stats?.realized)}`}>{stats ? money(stats.realized, { sign: true }) : '—'}</div></div>
              <div><div className="text-[10px] text-slate-500 uppercase">Stop</div><div className="text-sm tabular-nums text-loss">{pos?.stop != null ? fmtPrice(pos.stop, dec) : '—'}</div></div>
            </div>

            {stats?.closed ? (
              <div className="flex items-center gap-3">
                <span className={`font-semibold ${pnlClass(stats.realized)}`}>Trade closed · {money(stats.realized, { sign: true })}</span>
                <button className="btn btn-primary" onClick={save} disabled={busy}><Save size={14} /> Save to journal</button>
                <button className="btn btn-danger" onClick={() => setPos(null)}><X size={14} /> Discard</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-slate-500">Size<input className="input w-20 mt-1" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} /></label>
                <button className="btn" style={{ color: '#16c784' }} onClick={() => enter('long')}><TrendingUp size={14} /> Long</button>
                <button className="btn" style={{ color: '#ea3943' }} onClick={() => enter('short')}><TrendingDown size={14} /> Short</button>
                <div className="w-px h-8 bg-ink-700 mx-1" />
                <label className="text-xs text-slate-500">TP size<input className="input w-20 mt-1" value={tpSize} onChange={(e) => setTpSize(e.target.value)} /></label>
                <button className="btn" onClick={takeProfit} disabled={!stats || stats.remaining <= 0}>Take profit</button>
                <button className="btn" onClick={closeAll} disabled={!stats || stats.remaining <= 0}>Close</button>
                <div className="w-px h-8 bg-ink-700 mx-1" />
                <label className="text-xs text-slate-500">Stop price<input className="input w-24 mt-1" value={stopInput} onChange={(e) => setStopInput(e.target.value)} placeholder={bar ? fmtPrice(bar.close, dec) : ''} /></label>
                <button className="btn" onClick={setStop}>Set stop</button>
              </div>
            )}
            <p className="mt-3 text-xs text-slate-600">Step forward with ▶ / the slider. Long/Short opens at the current bar close (repeat to scale in); a stop auto-closes if a later bar hits it. Saved trades land in a dedicated <b>Backtest</b> account (excluded from your global stats).</p>
          </div>
        </>
      )}
    </div>
  )
}
