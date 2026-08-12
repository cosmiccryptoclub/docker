import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'
import { CHART } from '../../lib/format'
import { TooltipShell } from './ChartTooltip'

// Histogram of R-multiples; bar color = polarity (win vs loss R).
export default function RHistogram({ data, height = 220 }) {
  if (!data || data.length === 0) {
    return <div className="h-[220px] flex items-center justify-center text-sm text-slate-600">No R-multiples (set an initial stop on trades to compute R).</div>
  }
  const rows = data.map((d) => ({ ...d, label: `${d.r > 0 ? '+' : ''}${d.r}R` }))

  const CustomTip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const p = payload[0].payload
    return <TooltipShell title={p.label} rows={[{ label: 'Trades', value: p.count }]} />
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="label" tick={{ fill: CHART.axis, fontSize: 10 }} stroke={CHART.grid} interval={0} angle={-30} textAnchor="end" height={44} />
        <YAxis allowDecimals={false} tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} width={28} />
        <Tooltip content={<CustomTip />} cursor={{ fill: '#ffffff08' }} />
        <ReferenceLine x="0R" stroke={CHART.axis} strokeOpacity={0.4} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={34}>
          {rows.map((r, i) => (
            <Cell key={i} fill={r.r >= 0 ? CHART.profit : CHART.loss} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
