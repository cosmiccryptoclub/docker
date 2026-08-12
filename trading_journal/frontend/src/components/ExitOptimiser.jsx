import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'
import { Target } from 'lucide-react'
import { useStore } from '../store'
import { useApi } from '../lib/useApi'
import { api } from '../api'
import { InfoTip } from './Tooltip'
import { TooltipShell } from './charts/ChartTooltip'
import { CHART, num, pct } from '../lib/format'

export default function ExitOptimiser() {
  const { apiFilters } = useStore()
  const { data } = useApi(() => api.exitOptimiser(apiFilters), [JSON.stringify(apiFilters)])
  if (!data || !data.count) return null

  const rows = data.targets.map((r) => ({ ...r, label: `${r.target_r}R` }))
  const best = data.best
  const current = data.current_expectancy_r
  const improves = best && current != null && best.expectancy_r > current + 0.02

  const CustomTip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const p = payload[0].payload
    return <TooltipShell title={`Target ${p.label}`} rows={[
      { label: 'Expectancy', value: `${num(p.expectancy_r, 2)}R`, className: p.expectancy_r >= 0 ? 'text-profit' : 'text-loss' },
      { label: 'Win rate', value: pct(p.win_rate) },
    ]} />
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-300 mb-1">
        <Target size={15} className="text-accent" /> Exit optimiser
        <InfoTip label="For each fixed take-profit target (in R), simulates every closed trade with a fixed 1R stop: stop if MAE hit 1R, else bank the target if MFE reached it, else your actual result. Shows which fixed target would maximise expectancy." />
        <span className="text-xs text-slate-600">· {data.count} trades</span>
      </div>
      <div className="text-xs text-slate-500 mb-3">
        {improves
          ? <>A fixed <b className="text-accent">{best.target_r}R</b> target → expectancy <b className="text-profit">{num(best.expectancy_r, 2)}R</b> vs your current <b>{num(current, 2)}R</b>. You keep <b>{data.avg_capture != null ? `${num(data.avg_capture, 0)}%` : '—'}</b> of an average <b className="text-profit">+{num(data.avg_mfe_r, 1)}R</b> peak, taking <b className="text-loss">{num(data.avg_mae_r, 2)}R</b> heat.</>
          : <>Your current exits (avg <b>{current != null ? `${num(current, 2)}R` : '—'}</b>) are already close to optimal across fixed targets. Avg peak <b className="text-profit">+{num(data.avg_mfe_r, 1)}R</b>, avg heat <b className="text-loss">{num(data.avg_mae_r, 2)}R</b>.</>}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} />
          <YAxis tickFormatter={(v) => `${v}R`} tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} width={36} />
          <Tooltip content={<CustomTip />} cursor={{ fill: '#ffffff08' }} />
          {current != null && <ReferenceLine y={current} stroke={CHART.axis} strokeDasharray="4 4" label={{ value: 'current', fill: CHART.axis, fontSize: 10, position: 'insideTopRight' }} />}
          <Bar dataKey="expectancy_r" radius={[3, 3, 0, 0]}>
            {rows.map((r, i) => (
              <Cell key={i} fill={best && r.target_r === best.target_r ? '#3b82f6' : r.expectancy_r >= 0 ? CHART.profit : CHART.loss} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
