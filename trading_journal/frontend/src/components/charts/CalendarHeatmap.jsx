import { useMemo } from 'react'
import { format, startOfWeek, addDays, differenceInCalendarDays } from 'date-fns'
import { money } from '../../lib/format'
import { Tooltip } from '../Tooltip'

const NEUTRAL = [32, 42, 61]     // ink cell
const PROFIT = [22, 199, 132]
const LOSS = [234, 57, 67]

function lerp(a, b, t) { return Math.round(a + (b - a) * t) }
function mix(base, target, t) {
  return `rgb(${lerp(base[0], target[0], t)}, ${lerp(base[1], target[1], t)}, ${lerp(base[2], target[2], t)})`
}

// Diverging fill: loss (red) <- neutral -> profit (green), intensity by |pnl|/max.
function cellColor(pnl, maxAbs) {
  if (pnl === undefined || pnl === null) return 'rgb(20, 26, 40)'  // no trades
  if (maxAbs <= 0 || Math.abs(pnl) < 1e-9) return mix(NEUTRAL, NEUTRAL, 0)
  const t = 0.2 + 0.8 * Math.min(Math.abs(pnl) / maxAbs, 1)
  return mix(NEUTRAL, pnl > 0 ? PROFIT : LOSS, t)
}

export default function CalendarHeatmap({ data, cell = 15, gap = 3 }) {
  const { weeks, monthLabels, maxAbs, byDate } = useMemo(() => {
    const byDate = new Map(data.map((d) => [d.date, d]))
    if (data.length === 0) return { weeks: [], monthLabels: [], maxAbs: 0, byDate }
    const dates = data.map((d) => new Date(d.date))
    const min = new Date(Math.min(...dates))
    const max = new Date(Math.max(...dates))
    const start = startOfWeek(min, { weekStartsOn: 1 })
    const totalDays = differenceInCalendarDays(max, start) + 1
    const totalWeeks = Math.ceil(totalDays / 7)
    const maxAbs = Math.max(...data.map((d) => Math.abs(d.pnl)), 1)

    const weeks = []
    const monthLabels = []
    let lastMonth = -1
    for (let w = 0; w < totalWeeks; w++) {
      const col = []
      for (let d = 0; d < 7; d++) {
        const day = addDays(start, w * 7 + d)
        const key = format(day, 'yyyy-MM-dd')
        col.push({ day, key, rec: byDate.get(key) })
        if (d === 0) {
          const m = day.getMonth()
          if (m !== lastMonth) { monthLabels.push({ w, label: format(day, 'MMM') }); lastMonth = m }
        }
      }
      weeks.push(col)
    }
    return { weeks, monthLabels, maxAbs, byDate }
  }, [data])

  if (data.length === 0) {
    return <div className="h-24 flex items-center justify-center text-sm text-slate-600">No closed trades in range.</div>
  }

  const width = weeks.length * (cell + gap)
  const DOW = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: width + 30 }}>
        {/* month labels */}
        <div className="relative h-4 ml-8" style={{ width }}>
          {monthLabels.map((m) => (
            <span key={m.w} className="absolute text-[10px] text-slate-500" style={{ left: m.w * (cell + gap) }}>{m.label}</span>
          ))}
        </div>
        <div className="flex">
          {/* weekday labels */}
          <div className="flex flex-col mr-1" style={{ gap }}>
            {DOW.map((d, i) => (
              <span key={i} className="text-[9px] text-slate-600 text-right pr-1" style={{ height: cell, lineHeight: `${cell}px`, width: 22 }}>{d}</span>
            ))}
          </div>
          {/* weeks */}
          <div className="flex" style={{ gap }}>
            {weeks.map((col, wi) => (
              <div key={wi} className="flex flex-col" style={{ gap }}>
                {col.map((c) => (
                  <Tooltip
                    key={c.key}
                    label={c.rec
                      ? `${format(c.day, 'EEE dd MMM yyyy')} · ${c.rec.trades} trade${c.rec.trades === 1 ? '' : 's'} · ${money(c.rec.pnl, { sign: true })}`
                      : format(c.day, 'EEE dd MMM yyyy')}
                  >
                    <div
                      className="rounded-[3px] cursor-pointer hover:ring-1 hover:ring-slate-400"
                      style={{ width: cell, height: cell, background: cellColor(c.rec?.pnl, maxAbs) }}
                    />
                  </Tooltip>
                ))}
              </div>
            ))}
          </div>
        </div>
        {/* legend */}
        <div className="flex items-center gap-2 mt-3 ml-8 text-[10px] text-slate-500">
          <span>Loss</span>
          <div className="flex" style={{ gap: 2 }}>
            {[-1, -0.6, -0.3, 0, 0.3, 0.6, 1].map((t, i) => (
              <div key={i} className="rounded-[2px]" style={{ width: 12, height: 12, background: t === 0 ? cellColor(0, 1) : cellColor(t * maxAbs, maxAbs) }} />
            ))}
          </div>
          <span>Profit</span>
        </div>
      </div>
    </div>
  )
}
