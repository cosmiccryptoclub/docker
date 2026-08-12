import { useEffect, useState, useCallback } from 'react'
import { Radio } from 'lucide-react'
import { api } from '../api'
import { money, lots, pnlClass } from '../lib/format'

// Live unrealized PnL strip for open positions (polls every 30s).
export default function LivePnl({ accountId }) {
  const [data, setData] = useState(null)
  const load = useCallback(() => {
    api.liveOpen(accountId).then(setData).catch(() => {})
  }, [accountId])

  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  if (!data || data.count === 0) return null
  return (
    <div className="card p-3 flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Radio size={14} className={data.has_live ? 'text-profit animate-pulse' : 'text-slate-600'} />
        {data.count} open position{data.count === 1 ? '' : 's'}
        {data.has_live && <span className="text-profit">· live BTC/ETH</span>}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-500">Open P&amp;L</span>
        <span className={`text-lg font-semibold tabular-nums ${pnlClass(data.total_unrealized)}`}>{money(data.total_unrealized, { sign: true })}</span>
      </div>
      <div className="flex-1 flex flex-wrap gap-2 justify-end">
        {data.positions.slice(0, 6).map((p) => (
          <span key={p.trade_id} className="chip text-xs">
            {p.symbol} {lots(p.remaining_lots)}
            <span className={pnlClass(p.unrealized)}>{money(p.unrealized, { sign: true, decimals: 0 })}</span>
            {p.live && <Radio size={9} className="text-profit" />}
          </span>
        ))}
      </div>
    </div>
  )
}
