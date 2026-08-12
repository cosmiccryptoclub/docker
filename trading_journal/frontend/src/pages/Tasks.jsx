import { useEffect, useState, useCallback, useRef } from 'react'
import { Timer, Play, RefreshCw, CheckCircle2, XCircle, CircleDashed } from 'lucide-react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import clsx from 'clsx'
import { api } from '../api'
import { Center, Spinner, EmptyState } from '../components/ui'

function rel(ts) {
  if (!ts) return '—'
  try { return formatDistanceToNowStrict(new Date(ts * 1000), { addSuffix: true }) } catch { return '—' }
}

function StatusIcon({ status }) {
  if (status === 'ok') return <CheckCircle2 size={15} className="text-profit" />
  if (status === 'error') return <XCircle size={15} className="text-loss" />
  return <CircleDashed size={15} className="text-slate-600" />
}

export default function Tasks() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState('')
  const timer = useRef(null)

  const load = useCallback(() => {
    api.tasks().then((d) => { setData(d); setErr(null) }).catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    load()
    timer.current = setInterval(load, 8000)
    return () => clearInterval(timer.current)
  }, [load])

  const runNow = async (id) => {
    setBusy(id)
    try { await api.runTask(id); setTimeout(load, 1500) } catch { /* noop */ }
    finally { setTimeout(() => setBusy(''), 1500) }
  }

  if (!data && !err) return <Center className="h-64"><Spinner className="w-6 h-6" /></Center>
  if (err) return <EmptyState title="Failed to load tasks" hint={err} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Timer size={20} className="text-accent" />
          <h1 className="text-lg font-semibold">Scheduled tasks</h1>
          <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', data.running ? 'bg-profit/15 text-profit' : 'bg-loss/15 text-loss')}>
            {data.running ? 'scheduler running' : 'scheduler stopped'}
          </span>
        </div>
        <button className="btn px-2 py-1 text-xs" onClick={load}><RefreshCw size={13} /></button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {data.jobs.map((j) => (
          <div key={j.id} className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <StatusIcon status={j.last_status} />
              <h2 className="font-medium">{j.label}</h2>
              <span className={clsx('text-[10px] px-1.5 py-0.5 rounded ml-auto', j.scheduled ? 'bg-accent/15 text-accent' : 'bg-ink-700 text-slate-500')}>
                {j.scheduled ? 'scheduled' : 'off'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="flex justify-between"><span className="text-slate-500">Next run</span><span className="text-slate-300">{j.scheduled ? rel(j.next_run) : '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Last run</span><span className="text-slate-300">{rel(j.last_run)}</span></div>
            </div>
            {j.last_message && (
              <div className="mt-2 text-xs text-slate-400 bg-ink-850 rounded p-2">
                <span className={clsx(j.last_status === 'error' ? 'text-loss' : 'text-slate-400')}>{j.last_message}</span>
                {j.last_duration != null && <span className="text-slate-600"> · {j.last_duration.toFixed(1)}s</span>}
                {j.last_run && <span className="text-slate-600"> · {format(new Date(j.last_run * 1000), 'dd MMM HH:mm:ss')}</span>}
              </div>
            )}
            <button className="btn btn-primary mt-3 py-1 text-xs" disabled={busy === j.id} onClick={() => runNow(j.id)}>
              <Play size={13} /> {busy === j.id ? 'Started…' : 'Run now'}
            </button>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-600">Tasks run in the background. Intervals are configured on the <a href="/settings" className="text-accent hover:underline">Settings</a> page; "Run now" triggers a task immediately.</p>
    </div>
  )
}
