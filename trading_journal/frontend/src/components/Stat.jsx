import clsx from 'clsx'
import { InfoTip } from './Tooltip'

export function Stat({ label, value, sub, tip, valueClass, accent }) {
  return (
    <div className="card p-4 relative overflow-hidden">
      {accent && <div className="absolute left-0 top-0 h-full w-1" style={{ background: accent }} />}
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 uppercase tracking-wide">
        <span>{label}</span>
        {tip && <InfoTip label={tip} />}
      </div>
      <div className={clsx('mt-1.5 text-2xl font-semibold tabular-nums', valueClass)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  )
}
