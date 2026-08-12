import {
  ComposedChart, Line, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import { format } from 'date-fns'
import { price as fmtPrice, lots as fmtLots, CHART } from '../../lib/format'
import { TooltipShell } from './ChartTooltip'

const KIND_STYLE = {
  entry: { color: '#3b82f6', shape: 'triangle', label: 'Entry (scale-in)' },
  tp: { color: CHART.profit, shape: 'circle', label: 'Take profit' },
  sl: { color: CHART.loss, shape: 'cross', label: 'Stop loss' },
  close: { color: '#94a3b8', shape: 'diamond', label: 'Close' },
}

// Honest execution map: each fill plotted at (time, price). No fabricated candles —
// reference lines show avg entry / stop / planned targets; a faint line links the
// executions in time order. (Real candles arrive with cTrader sync — see README.)
export default function TradeMap({ trade, decimals = 2, height = 340 }) {
  const fills = (trade.fills || []).map((f) => ({
    t: new Date(f.executed_at).getTime(),
    price: f.price,
    lots: f.lots,
    kind: f.kind,
    note: f.note,
  })).sort((a, b) => a.t - b.t)

  if (fills.length === 0) {
    return <div className="h-[200px] flex items-center justify-center text-sm text-slate-600">No fills to plot.</div>
  }

  const byKind = { entry: [], tp: [], sl: [], close: [] }
  fills.forEach((f) => (byKind[f.kind] || byKind.close).push(f))

  const prices = fills.map((f) => f.price)
  const extra = [trade.avg_entry, trade.initial_stop, ...(trade.planned_targets || []).map((t) => t.price)].filter((v) => v != null)
  const lo = Math.min(...prices, ...extra)
  const hi = Math.max(...prices, ...extra)
  const pad = (hi - lo) * 0.12 || hi * 0.01
  const spanDays = (fills[fills.length - 1].t - fills[0].t) > 86400_000

  const CustomTip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const p = payload[0].payload
    const st = KIND_STYLE[p.kind] || KIND_STYLE.close
    return (
      <TooltipShell
        title={st.label + (p.note ? ` · ${p.note}` : '')}
        rows={[
          { label: 'Price', value: fmtPrice(p.price, decimals) },
          { label: 'Size', value: `${fmtLots(p.lots)} lots` },
          { label: 'Time', value: format(new Date(p.t), 'dd MMM HH:mm') },
        ]}
      />
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={fills} margin={{ top: 10, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid stroke={CHART.grid} />
        <XAxis
          type="number" dataKey="t" domain={['dataMin', 'dataMax']} scale="time"
          tickFormatter={(t) => format(new Date(t), spanDays ? 'dd MMM HH:mm' : 'HH:mm')}
          tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} minTickGap={50}
        />
        <YAxis
          type="number" dataKey="price" domain={[lo - pad, hi + pad]}
          tickFormatter={(v) => fmtPrice(v, decimals)} tick={{ fill: CHART.axis, fontSize: 11 }}
          stroke={CHART.grid} width={78}
        />
        <ZAxis dataKey="lots" range={[50, 320]} />
        <Tooltip content={<CustomTip />} cursor={{ stroke: CHART.axis, strokeDasharray: '3 3' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />

        {trade.avg_entry != null && (
          <ReferenceLine y={trade.avg_entry} stroke="#3b82f6" strokeDasharray="5 4"
            label={{ value: `avg ${fmtPrice(trade.avg_entry, decimals)}`, fill: '#3b82f6', fontSize: 10, position: 'insideLeft' }} />
        )}
        {trade.initial_stop != null && (
          <ReferenceLine y={trade.initial_stop} stroke={CHART.loss} strokeDasharray="5 4"
            label={{ value: `stop ${fmtPrice(trade.initial_stop, decimals)}`, fill: CHART.loss, fontSize: 10, position: 'insideLeft' }} />
        )}
        {(trade.planned_targets || []).map((tgt, i) => (
          <ReferenceLine key={i} y={tgt.price} stroke={CHART.profit} strokeOpacity={0.35} strokeDasharray="2 4" />
        ))}

        {/* execution path */}
        <Line dataKey="price" stroke={CHART.axis} strokeWidth={1} strokeDasharray="4 4" dot={false} legendType="none" isAnimationActive={false} />

        {Object.entries(byKind).map(([kind, pts]) => pts.length > 0 && (
          <Scatter key={kind} name={KIND_STYLE[kind].label} data={pts}
            fill={KIND_STYLE[kind].color} shape={KIND_STYLE[kind].shape} line={false} isAnimationActive={false} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
