import { money } from '../../lib/format'
import { Tooltip } from '../Tooltip'

const NEUTRAL = [32, 42, 61]
const PROFIT = [22, 199, 132]
const LOSS = [234, 57, 67]
const lerp = (a, b, t) => Math.round(a + (b - a) * t)
const mix = (base, tgt, t) => `rgb(${lerp(base[0], tgt[0], t)},${lerp(base[1], tgt[1], t)},${lerp(base[2], tgt[2], t)})`

function cellColor(pnl, maxAbs) {
  if (pnl == null) return 'rgb(20,26,40)'
  if (maxAbs <= 0 || Math.abs(pnl) < 1e-9) return mix(NEUTRAL, NEUTRAL, 0)
  const t = 0.2 + 0.8 * Math.min(Math.abs(pnl) / maxAbs, 1)
  return mix(NEUTRAL, pnl > 0 ? PROFIT : LOSS, t)
}

// Net PnL by hour of day (opened). `data` is distribution(by:'hour') rows: {key:'HH:00', net_pnl, trades, win_rate}.
export default function HourHeatmap({ data }) {
  const byHour = {}
  ;(data || []).forEach((d) => { byHour[parseInt(d.key, 10)] = d })
  const hasData = (data || []).length > 0
  const maxAbs = Math.max(...(data || []).map((d) => Math.abs(d.net_pnl)), 1)

  if (!hasData) {
    return <div className="h-16 flex items-center justify-center text-sm text-slate-600">No closed trades in range.</div>
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1 min-w-[720px]">
        {Array.from({ length: 24 }, (_, h) => {
          const rec = byHour[h]
          return (
            <Tooltip
              key={h}
              label={rec
                ? `${String(h).padStart(2, '0')}:00 · ${rec.trades} trade${rec.trades === 1 ? '' : 's'} · ${money(rec.net_pnl, { sign: true })} · ${Math.round(rec.win_rate)}% win`
                : `${String(h).padStart(2, '0')}:00 · no trades`}
            >
              <div className="flex flex-col items-center gap-1">
                <div className="rounded-md cursor-pointer hover:ring-1 hover:ring-slate-400" style={{ width: 26, height: 40, background: cellColor(rec?.net_pnl, maxAbs) }} />
                <span className="text-[9px] text-slate-600 tabular-nums">{String(h).padStart(2, '0')}</span>
              </div>
            </Tooltip>
          )
        })}
      </div>
      <div className="mt-2 text-[10px] text-slate-600">Hour of day (opened, UTC) · green = net profit, red = net loss</div>
    </div>
  )
}
