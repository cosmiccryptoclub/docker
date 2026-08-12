import { useEffect, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { format } from 'date-fns'
import clsx from 'clsx'
import { api } from '../api'

const IMPACT = {
  High: 'bg-loss', Medium: 'bg-amber-400', Low: 'bg-slate-500', Holiday: 'bg-slate-600',
}

function isToday(ts) {
  const d = new Date(ts * 1000)
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

export default function EconNews({ hours = 168, minImpact = 'High', limit = 8, compact = false }) {
  const [events, setEvents] = useState(null)
  useEffect(() => {
    api.econUpcoming({ hours, min_impact: minImpact, limit }).then((r) => setEvents(r.events || [])).catch(() => setEvents([]))
  }, [hours, minImpact, limit])

  if (events === null) return null
  return (
    <div className={clsx('card', compact ? 'p-3' : 'p-4')}>
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock size={15} className="text-accent" />
        <h2 className="font-medium text-sm">Upcoming high-impact news</h2>
        <span className="text-xs text-slate-600">next {Math.round(hours / 24)}d</span>
      </div>
      {events.length === 0 && <div className="text-sm text-slate-600">No high-impact events scheduled.</div>}
      <div className="space-y-1 max-h-72 overflow-auto pr-1">
        {events.map((ev, i) => (
          <div key={i} className="flex items-center gap-2 text-sm py-1 border-b border-ink-800/60 last:border-0">
            <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', IMPACT[ev.impact] || 'bg-slate-500')} />
            <span className="text-slate-500 text-xs tabular-nums w-28 shrink-0">
              {isToday(ev.time) ? 'Today ' : format(new Date(ev.time * 1000), 'EEE dd ')}
              {format(new Date(ev.time * 1000), 'HH:mm')}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-ink-800 text-[10px] font-medium shrink-0">{ev.currency}</span>
            <span className="truncate">{ev.title}</span>
            {ev.forecast && <span className="ml-auto text-xs text-slate-500 shrink-0">f/c {ev.forecast}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
