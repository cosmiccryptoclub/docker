import { useEffect, useRef } from 'react'
import { createChart, ColorType, LineStyle, CrosshairMode } from 'lightweight-charts'

// Backtest chart: reveals candles up to `upTo`, plots sim fills + entry/stop lines.
export default function BacktestChart({ candles, upTo, direction = 'long', fills = [], avgEntry = null, stop = null, decimals = 1, height = 420 }) {
  const ref = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const linesRef = useRef({ entry: null, stop: null })

  // build once per dataset
  useEffect(() => {
    const el = ref.current
    if (!el || !candles?.length) return
    const chart = createChart(el, {
      autoSize: true, height,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#5b6b8c', fontFamily: 'Inter, system-ui, sans-serif' },
      grid: { vertLines: { color: 'rgba(35,45,66,0.6)' }, horzLines: { color: 'rgba(35,45,66,0.6)' } },
      rightPriceScale: { borderColor: '#232d42' },
      timeScale: { borderColor: '#232d42', timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    })
    const series = chart.addCandlestickSeries({
      upColor: '#16c784', downColor: '#ea3943', wickUpColor: '#16c784', wickDownColor: '#ea3943',
      borderVisible: false, priceFormat: { type: 'price', precision: decimals, minMove: Math.pow(10, -decimals) },
    })
    chartRef.current = chart
    seriesRef.current = series
    linesRef.current = { entry: null, stop: null }
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null }
  }, [candles, decimals, height])

  // reveal bars + scroll window
  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !candles?.length) return
    const n = Math.min(upTo + 1, candles.length)
    series.setData(candles.slice(0, n))
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 90), to: n + 3 })
  }, [upTo, candles])

  // sim fill markers
  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    const long = direction === 'long'
    const markers = fills.map((f) => {
      if (f.kind === 'entry') return { time: f.time, position: long ? 'belowBar' : 'aboveBar', color: '#3b82f6', shape: long ? 'arrowUp' : 'arrowDown', text: 'E' }
      if (f.kind === 'tp') return { time: f.time, position: long ? 'aboveBar' : 'belowBar', color: '#16c784', shape: long ? 'arrowDown' : 'arrowUp', text: 'TP' }
      if (f.kind === 'sl') return { time: f.time, position: 'aboveBar', color: '#ea3943', shape: 'circle', text: 'SL' }
      return { time: f.time, position: 'aboveBar', color: '#94a3b8', shape: 'circle', text: 'C' }
    }).sort((a, b) => a.time - b.time)
    series.setMarkers(markers)
  }, [fills, direction])

  // entry / stop price lines
  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    const L = linesRef.current
    const upsert = (key, price, color, title) => {
      if (price == null) {
        if (L[key]) { series.removePriceLine(L[key]); L[key] = null }
      } else if (L[key]) {
        L[key].applyOptions({ price })
      } else {
        L[key] = series.createPriceLine({ price, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title })
      }
    }
    upsert('entry', avgEntry, '#3b82f6', 'ENTRY')
    upsert('stop', stop, '#ea3943', 'STOP')
  }, [avgEntry, stop])

  return <div ref={ref} style={{ height }} className="w-full" />
}
