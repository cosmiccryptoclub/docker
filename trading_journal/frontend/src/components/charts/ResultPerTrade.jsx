import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'
import { CHART, num, money } from '../../lib/format'
import { TooltipShell } from './ChartTooltip'

// Each closed trade in sequence as an R bar (blue/green up, red down).
export default function ResultPerTrade({ equity, height = 200 }) {
  const rows = (equity || [])
    .filter((p) => p.trade_id != null)
    .map((p, i) => ({ n: i + 1, r: p.r ?? 0, pnl: p.pnl, symbol: p.symbol, trade_id: p.trade_id }))

  if (rows.length < 2) {
    return <div className="h-[200px] flex items-center justify-center text-sm text-slate-600">Not enough closed trades yet.</div>
  }

  const CustomTip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const p = payload[0].payload
    return (
      <TooltipShell
        title={`Trade #${p.trade_id} · ${p.symbol || ''}`}
        rows={[
          { label: 'R', value: `${p.r >= 0 ? '+' : ''}${num(p.r, 2)}R`, className: p.r >= 0 ? 'text-profit' : 'text-loss' },
          { label: 'PnL', value: money(p.pnl, { sign: true }), className: p.pnl >= 0 ? 'text-profit' : 'text-loss' },
        ]}
      />
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="n" tick={{ fill: CHART.axis, fontSize: 10 }} stroke={CHART.grid} interval="preserveStartEnd" minTickGap={30} />
        <YAxis tickFormatter={(v) => `${v}R`} tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} width={36} />
        <Tooltip content={<CustomTip />} cursor={{ fill: '#ffffff08' }} />
        <ReferenceLine y={0} stroke={CHART.axis} strokeOpacity={0.5} />
        <Bar dataKey="r" radius={[2, 2, 0, 0]}>
          {rows.map((r, i) => <Cell key={i} fill={r.r >= 0 ? '#3b82f6' : CHART.loss} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
