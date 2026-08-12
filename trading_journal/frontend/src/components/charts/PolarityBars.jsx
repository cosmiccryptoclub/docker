import clsx from 'clsx'
import { money, pnlClass, CHART } from '../../lib/format'
import { Tooltip } from '../Tooltip'

// Horizontal bars diverging from a zero center line. Fill color = polarity
// (profit/loss); an optional per-row dot carries identity (e.g. account color).
export default function PolarityBars({ rows, formatValue = money, emptyLabel = 'No data' }) {
  if (!rows || rows.length === 0) {
    return <div className="h-24 flex items-center justify-center text-sm text-slate-600">{emptyLabel}</div>
  }
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)), 1)

  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const pos = r.value >= 0
        const w = (Math.abs(r.value) / maxAbs) * 50
        return (
          <div key={i} className="flex items-center gap-3 text-sm">
            <div className="w-28 shrink-0 flex items-center gap-1.5">
              {r.dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.dot }} />}
              <span className="truncate text-slate-300" title={r.label}>{r.label}</span>
            </div>
            <Tooltip
              className="flex-1"
              label={`${r.label} · ${formatValue(r.value, { sign: true })}${r.sub !== undefined ? ` · ${r.subLabel || ''} ${r.sub}` : ''}`}
            >
              <div className="relative w-full h-5">
                <div className="absolute inset-y-0 left-1/2 w-px bg-ink-600" />
                <div
                  className="absolute inset-y-[3px] rounded-[4px]"
                  style={{ [pos ? 'left' : 'right']: '50%', width: `${w}%`, background: pos ? CHART.profit : CHART.loss }}
                />
              </div>
            </Tooltip>
            <div className={clsx('w-24 text-right tabular-nums shrink-0', pnlClass(r.value))}>
              {formatValue(r.value, { sign: true })}
            </div>
            {r.sub !== undefined && (
              <div className="w-14 text-right text-xs text-slate-500 shrink-0 tabular-nums">{r.sub}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
