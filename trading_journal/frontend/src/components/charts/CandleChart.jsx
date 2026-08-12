import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, ColorType, LineStyle, CrosshairMode } from 'lightweight-charts'
import { Play, Pause, RotateCcw, SkipForward } from 'lucide-react'
import { format } from 'date-fns'

const SPEEDS = [0.5, 1, 2, 4]

// Candlestick chart with a green/red profit-zone fill relative to avg entry,
// entry/TP/SL price lines + labelled markers, and optional bar-by-bar replay.
const SHOW_ALL = { news: true, entries: true, exits: true, levels: true, zone: true }

export default function CandleChart({ data, direction = 'long', decimals = 2, height = 500, enableReplay = true, show = SHOW_ALL }) {
  const vis = { ...SHOW_ALL, ...(show || {}) }
  const showKey = JSON.stringify(vis)
  const ref = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const baselineRef = useRef(null)
  const fullRef = useRef({ candles: [], markers: [] })

  const [idx, setIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  useEffect(() => {
    const el = ref.current
    if (!el || !data?.candles?.length) return
    const lv = data.levels || {}
    const fp = (p) => (p == null ? '' : Number(p).toFixed(decimals))
    const fl = (l) => (l == null ? '' : Number(l).toFixed(2))

    const chart = createChart(el, {
      autoSize: true, height,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8296b8', fontFamily: 'Inter, system-ui, sans-serif' },
      grid: { vertLines: { color: 'rgba(35,45,66,0.5)' }, horzLines: { color: 'rgba(35,45,66,0.5)' } },
      rightPriceScale: { borderColor: '#232d42', scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: {
        borderColor: '#232d42', timeVisible: true, secondsVisible: false,
        // lightweight-charts renders UTC by default; format so the axis shows local
        // wall-clock time (matches the timestamps everywhere else in the app), and
        // pick the granularity from the span — a multi-day trade needs dates, not
        // the same "03:54" repeated across every tick.
        tickMarkFormatter: (t) => {
          const spanDays = (data.candles[data.candles.length - 1].time - data.candles[0].time) / 86400
          const fmt = spanDays > 5 ? 'dd MMM' : spanDays > 1 ? 'dd MMM HH:mm' : 'HH:mm'
          return format(new Date(t * 1000), fmt)
        },
      },
      localization: { timeFormatter: (t) => format(new Date(t * 1000), 'dd MMM HH:mm') },
      crosshair: { mode: CrosshairMode.Normal },
    })

    // only highlight the move while the trade is live (open -> fully closed); for open
    // trades close_time is null so it runs to the latest candle.
    const openT = lv.open_time ?? null
    const closeT = lv.close_time ?? null
    const inTrade = (t) => (openT == null || t >= openT) && (closeT == null || t <= closeT)
    const baselineData = (candles) => candles.map((c) => (inTrade(c.time) ? { time: c.time, value: c.close } : { time: c.time }))

    // green/red zone relative to avg entry (drawn behind the candles)
    let baseline = null
    if (lv.avg_entry != null && vis.zone) {
      baseline = chart.addBaselineSeries({
        baseValue: { type: 'price', price: lv.avg_entry },
        topLineColor: 'rgba(22,199,132,0)', topFillColor1: 'rgba(22,199,132,0.22)', topFillColor2: 'rgba(22,199,132,0.03)',
        bottomLineColor: 'rgba(234,57,67,0)', bottomFillColor1: 'rgba(234,57,67,0.03)', bottomFillColor2: 'rgba(234,57,67,0.22)',
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      })
      baseline.setData(baselineData(data.candles))
    }

    const series = chart.addCandlestickSeries({
      upColor: '#16c784', downColor: '#ea3943', wickUpColor: '#16c784', wickDownColor: '#ea3943',
      borderVisible: false, priceFormat: { type: 'price', precision: decimals, minMove: Math.pow(10, -decimals) },
    })
    series.setData(data.candles)

    const long = direction === 'long'
    const markers = []
    if (vis.entries) (lv.entries || []).forEach((e) => markers.push({ time: e.time, position: long ? 'belowBar' : 'aboveBar', color: '#3b82f6', shape: long ? 'arrowUp' : 'arrowDown', text: `Entry ${fl(e.lots)} @ ${fp(e.price)}` }))
    if (vis.exits) (lv.tps || []).forEach((t, i) => markers.push({ time: t.time, position: long ? 'aboveBar' : 'belowBar', color: '#16c784', shape: long ? 'arrowDown' : 'arrowUp', text: `${t.note || 'TP' + (i + 1)} ${fl(t.lots)} @ ${fp(t.price)}` }))
    if (vis.exits) (lv.sls || []).forEach((t) => markers.push({ time: t.time, position: 'aboveBar', color: '#ea3943', shape: 'circle', text: `SL ${fl(t.lots)} @ ${fp(t.price)}` }))
    if (vis.exits) (lv.closes || []).forEach((t) => markers.push({ time: t.time, position: 'aboveBar', color: '#94a3b8', shape: 'circle', text: `Close ${fl(t.lots)} @ ${fp(t.price)}` }))

    // economic-calendar events (snap to nearest candle so the marker renders)
    const times = data.candles.map((c) => c.time)
    const snap = (t) => times.reduce((b, ct) => (Math.abs(ct - t) < Math.abs(b - t) ? ct : b), times[0])
    const shortTitle = (s) => (s.length > 20 ? s.slice(0, 19) + '…' : s)
    if (vis.news) (data.events || []).forEach((ev) => markers.push({
      time: snap(ev.time), position: 'aboveBar',
      color: ev.impact === 'High' ? '#f43f5e' : ev.impact === 'Medium' ? '#f59e0b' : '#64748b',
      shape: 'circle', text: `📰 ${ev.currency} ${shortTitle(ev.title)}`,
    }))
    markers.sort((a, b) => a.time - b.time)
    series.setMarkers(markers)

    // right-axis price tags
    if (vis.levels && lv.avg_entry != null) series.createPriceLine({ price: lv.avg_entry, color: '#3b82f6', lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: (lv.entries || []).length > 1 ? 'AVG ENTRY' : 'ENTRY' })
    if (vis.levels && lv.initial_stop != null) series.createPriceLine({ price: lv.initial_stop, color: '#ea3943', lineWidth: 2, lineStyle: lv.stop_is_avg ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: true, title: lv.stop_is_avg ? 'AVG STOP LOSS' : 'STOP LOSS' })
    if (vis.levels) (lv.tps || []).forEach((t, i) => series.createPriceLine({ price: t.price, color: '#e879f9', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `TP ${i + 1}` }))

    chart.timeScale().fitContent()
    chartRef.current = chart
    seriesRef.current = series
    baselineRef.current = baseline
    fullRef.current = { candles: data.candles, markers, openT, closeT }
    setIdx(-1); setPlaying(false)
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; baselineRef.current = null }
  }, [data, direction, decimals, height, showKey])   // eslint-disable-line react-hooks/exhaustive-deps

  // replay slice
  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    const { candles, markers, openT, closeT } = fullRef.current
    const bd = (arr) => arr.map((c) => (((openT == null || c.time >= openT) && (closeT == null || c.time <= closeT)) ? { time: c.time, value: c.close } : { time: c.time }))
    if (idx < 0) {
      series.setData(candles)
      series.setMarkers(markers)
      baselineRef.current?.setData(bd(candles))
    } else {
      const n = Math.min(idx + 1, candles.length)
      const cutoff = candles[n - 1]?.time ?? Infinity
      const slice = candles.slice(0, n)
      series.setData(slice)
      series.setMarkers(markers.filter((m) => m.time <= cutoff))
      baselineRef.current?.setData(bd(slice))
    }
  }, [idx])

  useEffect(() => {
    if (!playing) return
    const total = fullRef.current.candles.length
    const id = setInterval(() => {
      setIdx((i) => {
        const next = (i < 0 ? 0 : i) + 1
        if (next >= total - 1) { setPlaying(false); return total - 1 }
        return next
      })
    }, 500 / speed)
    return () => clearInterval(id)
  }, [playing, speed])

  const startReplay = useCallback(() => { setIdx(0); setPlaying(true) }, [])
  const total = fullRef.current.candles.length
  const curTime = idx >= 0 && fullRef.current.candles[idx] ? fullRef.current.candles[idx].time : null

  return (
    <div>
      <div ref={ref} style={{ height }} className="w-full" />
      {enableReplay && total > 2 && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          {!playing
            ? <button className="btn px-2 py-1" onClick={() => (idx < 0 || idx >= total - 1 ? startReplay() : setPlaying(true))} title="Replay"><Play size={13} /></button>
            : <button className="btn px-2 py-1" onClick={() => setPlaying(false)}><Pause size={13} /></button>}
          <button className="btn px-2 py-1" onClick={() => { setIdx(0); setPlaying(false) }} title="Restart"><RotateCcw size={13} /></button>
          <input type="range" min={0} max={total - 1} value={idx < 0 ? total - 1 : idx}
            onChange={(e) => { setPlaying(false); setIdx(+e.target.value) }} className="flex-1 accent-accent" />
          <span className="tabular-nums text-slate-500 w-32 text-right">{curTime ? format(new Date(curTime * 1000), 'dd MMM HH:mm') : 'full'}</span>
          <select value={speed} onChange={(e) => setSpeed(+e.target.value)} className="input py-0.5 px-1 text-xs">
            {SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
          </select>
          <button className="btn px-2 py-1" onClick={() => { setIdx(-1); setPlaying(false) }} title="Show full"><SkipForward size={13} /></button>
        </div>
      )}
    </div>
  )
}
