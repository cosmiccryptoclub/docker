import { useEffect, useState, useCallback, useRef } from 'react'
import { ScrollText, RefreshCw, Pause, Play } from 'lucide-react'
import { format } from 'date-fns'
import clsx from 'clsx'
import { api } from '../api'
import { Segmented, Center, Spinner, EmptyState } from '../components/ui'

const LEVELS = [
  { value: '', label: 'All' },
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warnings' },
  { value: 'error', label: 'Errors' },
]

const LEVEL_CLS = {
  info: 'bg-ink-700 text-slate-300',
  success: 'bg-profit/15 text-profit',
  warning: 'bg-amber-400/15 text-amber-400',
  error: 'bg-loss/15 text-loss',
}

export default function Logs() {
  const [level, setLevel] = useState('')
  const [source, setSource] = useState('')
  const [data, setData] = useState(null)
  const [live, setLive] = useState(true)
  const [err, setErr] = useState(null)
  const timer = useRef(null)

  const load = useCallback(() => {
    api.logs({ level, source, limit: 400 }).then((d) => { setData(d); setErr(null) }).catch((e) => setErr(e.message))
  }, [level, source])

  useEffect(() => {
    load()
    if (live) { timer.current = setInterval(load, 5000); return () => clearInterval(timer.current) }
  }, [load, live])

  if (!data && !err) return <Center className="h-64"><Spinner className="w-6 h-6" /></Center>

  const entries = data?.entries || []
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ScrollText size={20} className="text-accent" />
          <h1 className="text-lg font-semibold">Logs</h1>
          <span className="text-xs text-slate-600">{entries.length} events</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Segmented size="sm" value={level} onChange={setLevel} options={LEVELS} />
          <select className="input py-1 text-xs" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            {(data?.sources || []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn px-2 py-1 text-xs" onClick={() => setLive((v) => !v)} title={live ? 'Pause auto-refresh' : 'Resume'}>
            {live ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button className="btn px-2 py-1 text-xs" onClick={load}><RefreshCw size={13} /></button>
        </div>
      </div>

      {err && <EmptyState title="Failed to load logs" hint={err} />}

      <div className="card p-0 overflow-hidden">
        {entries.length === 0 && <div className="p-8 text-center text-sm text-slate-600">No log entries yet.</div>}
        <div className="divide-y divide-ink-800/60">
          {entries.map((e) => (
            <div key={e.id} className="flex items-start gap-3 px-4 py-2 text-sm hover:bg-ink-800/30">
              <span className="text-slate-500 text-xs tabular-nums w-20 shrink-0 pt-0.5">{format(new Date(e.ts * 1000), 'HH:mm:ss')}</span>
              <span className={clsx('text-[10px] px-1.5 py-0.5 rounded uppercase font-medium shrink-0 w-16 text-center', LEVEL_CLS[e.level] || LEVEL_CLS.info)}>{e.level}</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-ink-800 text-slate-400 shrink-0">{e.source}</span>
              <span className="text-slate-300 break-words min-w-0">{e.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
