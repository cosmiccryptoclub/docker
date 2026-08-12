import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { format } from 'date-fns'
import { money, num, CHART } from '../../lib/format'
import { TooltipShell } from './ChartTooltip'

// Single series over time; mode 'money' (equity) or 'r' (cumulative R = risk-normalized).
export default function EquityChart({ data, startingBalance = 0, mode = 'money', height = 300 }) {
  if (!data || data.length < 2) {
    return <div className="h-[300px] flex items-center justify-center text-sm text-slate-600">Not enough closed trades to plot a curve yet.</div>
  }
  const isR = mode === 'r'
  const key = isR ? 'cum_r' : 'equity'
  const baseline = isR ? 0 : startingBalance
  const fmt = isR ? (v) => `${num(v, 1)}R` : (v) => money(v, { decimals: 0 })

  const dataVals = data.map((d) => d[key])
  const values = dataVals.concat(baseline)
  const yMin = Math.min(...values)
  const yMax = Math.max(...values)
  const yPad = (yMax - yMin) * 0.12 || Math.abs(yMax) * 0.02 || 1

  // Split colouring at the baseline: green while in profit, red while in drawdown.
  // Gradients use objectBoundingBox, so offsets are computed against each shape's own
  // bbox: the area spans [yMin,yMax] (baseline included above); the stroke spans the
  // data range only.
  const clamp01 = (v) => Math.max(0, Math.min(1, v))
  const fillOff = yMax === yMin ? 0.5 : clamp01((yMax - baseline) / (yMax - yMin))
  const dMin = Math.min(...dataVals)
  const dMax = Math.max(...dataVals)
  const strokeOff = dMax === dMin ? (dMax >= baseline ? 1 : 0) : clamp01((dMax - baseline) / (dMax - dMin))

  // intraday curves get time ticks instead of six copies of the same date
  const spanMs = new Date(data[data.length - 1].t) - new Date(data[0].t)
  const tickFmt = spanMs < 2 * 86400_000 ? 'HH:mm' : spanMs < 8 * 86400_000 ? 'EEE dd' : 'dd MMM'

  const CustomTip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const p = payload[0].payload
    return (
      <TooltipShell
        title={format(new Date(p.t), 'dd MMM yyyy, HH:mm')}
        rows={isR ? [
          { label: 'Cumulative R', value: `${num(p.cum_r, 2)}R`, className: p.cum_r >= 0 ? 'text-profit' : 'text-loss' },
          ...(p.r != null ? [{ label: `Trade #${p.trade_id}`, value: `${num(p.r, 2)}R`, className: p.r >= 0 ? 'text-profit' : 'text-loss' }] : []),
        ] : [
          { label: 'Equity', value: money(p.equity) },
          { label: 'Cumulative', value: money(p.cum_pnl, { sign: true }), className: p.cum_pnl >= 0 ? 'text-profit' : 'text-loss' },
          ...(p.trade_id ? [{ label: `Trade #${p.trade_id} (${p.symbol || ''})`, value: money(p.pnl, { sign: true }), className: p.pnl >= 0 ? 'text-profit' : 'text-loss' }] : []),
        ]}
      />
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id={`eqFill-${mode}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset={0} stopColor={CHART.profit} stopOpacity={0.32} />
            <stop offset={fillOff} stopColor={CHART.profit} stopOpacity={0.04} />
            <stop offset={fillOff} stopColor={CHART.loss} stopOpacity={0.04} />
            <stop offset={1} stopColor={CHART.loss} stopOpacity={0.32} />
          </linearGradient>
          <linearGradient id={`eqStroke-${mode}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset={strokeOff} stopColor={CHART.profit} />
            <stop offset={strokeOff} stopColor={CHART.loss} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="t" tickFormatter={(t) => format(new Date(t), tickFmt)} tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} minTickGap={40} />
        <YAxis domain={[yMin - yPad, yMax + yPad]} tickFormatter={fmt} tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} width={isR ? 48 : 72} allowDecimals={false} />
        <Tooltip content={<CustomTip />} cursor={{ stroke: CHART.axis, strokeDasharray: '3 3' }} />
        <ReferenceLine y={baseline} stroke={CHART.axis} strokeDasharray="4 4" strokeOpacity={0.5} />
        <Area type="monotone" dataKey={key} baseValue={baseline} stroke={`url(#eqStroke-${mode})`} strokeWidth={2} fill={`url(#eqFill-${mode})`} dot={false} activeDot={{ r: 4, fill: '#e2e8f0' }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
