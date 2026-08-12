import { useEffect, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, CalendarDays, StickyNote, AlertTriangle,
  Ban, Check, X,
} from 'lucide-react'
import {
  format, addMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isToday, parseISO,
} from 'date-fns'
import clsx from 'clsx'
import { useStore } from '../store'
import { api } from '../api'
import { money, num, pnlClass, rMultiple } from '../lib/format'
import { DirectionBadge, Spinner } from '../components/ui'
import GoalsCard from '../components/Goals'

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MOODS = ['', 'calm', 'focused', 'confident', 'anxious', 'fomo', 'revenge', 'tilted', 'bored']

function cellBg(rec) {
  if (!rec || !rec.trades) return 'bg-ink-850/40 border-transparent'
  if (rec.pnl > 1e-9) return 'bg-profit/10 hover:bg-profit/20 border-profit/25'
  if (rec.pnl < -1e-9) return 'bg-loss/10 hover:bg-loss/20 border-loss/25'
  return 'bg-ink-800 hover:bg-ink-700 border-ink-700'
}

function Stars({ value, onChange }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onChange(value === n ? null : n)} className="text-lg leading-none">
          <span className={n <= (value || 0) ? 'text-amber-400' : 'text-slate-700 hover:text-slate-500'}>★</span>
        </button>
      ))}
    </div>
  )
}

function DayPanel({ date, accountId, onSaved }) {
  const [data, setData] = useState(null)
  const [note, setNote] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setData(null); setNote(null)
    if (!date) return
    api.journalDay(date, accountId).then((d) => { setData(d); setNote(d.note) }).catch(() => {})
  }, [date, accountId])

  const save = useCallback(async (patch) => {
    const next = { ...note, ...patch }
    setNote(next)
    try {
      await api.saveJournalDay(date, patch)
      setSaved(true); setTimeout(() => setSaved(false), 1200)
      onSaved && onSaved()
    } catch { /* noop */ }
  }, [note, date, onSaved])

  if (!date) {
    return <div className="card p-6 text-sm text-slate-500 text-center">Select a day to journal it.</div>
  }
  if (!data) return <div className="card p-6 flex justify-center"><Spinner /></div>

  const s = data.stats
  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{format(parseISO(date), 'EEEE, dd MMM yyyy')}</h2>
        {saved && <span className="text-xs text-profit">Saved</span>}
      </div>

      {/* day stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-ink-850 rounded-lg p-2">
          <div className="text-[11px] text-slate-500">Net P&L</div>
          <div className={clsx('font-semibold tabular-nums', pnlClass(s.net_pnl))}>{money(s.net_pnl, { sign: true })}</div>
        </div>
        <div className="bg-ink-850 rounded-lg p-2">
          <div className="text-[11px] text-slate-500">Trades</div>
          <div className="font-semibold tabular-nums">{s.trade_count} <span className="text-xs text-slate-500">· {num(s.win_rate, 0)}% W</span></div>
        </div>
        <div className="bg-ink-850 rounded-lg p-2">
          <div className="text-[11px] text-slate-500">Total R</div>
          <div className={clsx('font-semibold tabular-nums', pnlClass(s.total_r))}>{s.total_r != null ? rMultiple(s.total_r) : '—'}</div>
        </div>
      </div>

      {(data.flags?.over_trades || data.flags?.broke_daily_loss) && (
        <div className="flex flex-wrap gap-2">
          {data.flags.over_trades && <span className="inline-flex items-center gap-1 text-xs bg-amber-500/15 text-amber-400 px-2 py-1 rounded"><AlertTriangle size={12} /> Over trade limit</span>}
          {data.flags.broke_daily_loss && <span className="inline-flex items-center gap-1 text-xs bg-loss/15 text-loss px-2 py-1 rounded"><Ban size={12} /> Broke daily-loss cap</span>}
        </div>
      )}

      {/* trades */}
      <div>
        <div className="text-xs text-slate-500 mb-1.5">Trades ({data.trades.length})</div>
        {data.trades.length === 0 && <div className="text-sm text-slate-600">No closed trades.</div>}
        <div className="space-y-1 max-h-52 overflow-auto pr-1">
          {data.trades.map((t) => (
            <Link key={t.id} to={`/trades/${t.id}`} className="flex items-center gap-2 bg-ink-850 hover:bg-ink-800 rounded-lg px-2 py-1.5 text-sm">
              <span className="text-slate-500 text-xs tabular-nums w-12">{format(parseISO(t.closed_at), 'HH:mm')}</span>
              <span className="font-medium">{t.symbol}</span>
              <DirectionBadge direction={t.direction} />
              {t.setup && <span className="text-xs text-slate-500 truncate hidden sm:inline">{t.setup}</span>}
              <span className={clsx('ml-auto tabular-nums text-xs', pnlClass(t.r_multiple))}>{t.r_multiple != null ? rMultiple(t.r_multiple) : ''}</span>
              <span className={clsx('tabular-nums font-medium w-20 text-right', pnlClass(t.realized_pnl))}>{money(t.realized_pnl, { sign: true })}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* journal editor */}
      <div className="border-t border-ink-800 pt-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Discipline</span>
            <Stars value={note?.rating} onChange={(v) => save({ rating: v })} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500 mr-1">Followed plan?</span>
            <button onClick={() => save({ followed_plan: note?.followed_plan === true ? null : true })}
              className={clsx('p-1 rounded', note?.followed_plan === true ? 'bg-profit/20 text-profit' : 'bg-ink-800 text-slate-500 hover:text-slate-300')}><Check size={14} /></button>
            <button onClick={() => save({ followed_plan: note?.followed_plan === false ? null : false })}
              className={clsx('p-1 rounded', note?.followed_plan === false ? 'bg-loss/20 text-loss' : 'bg-ink-800 text-slate-500 hover:text-slate-300')}><X size={14} /></button>
          </div>
        </div>

        <label className="text-xs text-slate-500 block">Mood
          <select className="input w-full mt-1" value={note?.mood || ''} onChange={(e) => save({ mood: e.target.value })}>
            {MOODS.map((m) => <option key={m} value={m}>{m ? m[0].toUpperCase() + m.slice(1) : '—'}</option>)}
          </select>
        </label>

        <label className="text-xs text-slate-500 block">Pre-market plan / bias
          <textarea className="input w-full mt-1 h-16 text-sm" placeholder="What's the plan today? Key levels, bias, what you'll trade / avoid…"
            value={note?.plan || ''} onChange={(e) => setNote({ ...note, plan: e.target.value })} onBlur={(e) => save({ plan: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500 block">Journal
          <textarea className="input w-full mt-1 h-20 text-sm" placeholder="How did the session go? Mindset, execution, what happened…"
            value={note?.notes || ''} onChange={(e) => setNote({ ...note, notes: e.target.value })} onBlur={(e) => save({ notes: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500 block">Lessons / to improve
          <textarea className="input w-full mt-1 h-16 text-sm" placeholder="One thing to do better next session…"
            value={note?.lessons || ''} onChange={(e) => setNote({ ...note, lessons: e.target.value })} onBlur={(e) => save({ lessons: e.target.value })} />
        </label>
      </div>
    </div>
  )
}

export default function Calendar() {
  const { accountId } = useStore()
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))
  const [monthData, setMonthData] = useState(null)
  const [selected, setSelected] = useState(null)

  const year = cursor.getFullYear()
  const month = cursor.getMonth() + 1

  const loadMonth = useCallback(() => {
    api.journalMonth(year, month, accountId).then(setMonthData).catch(() => {})
  }, [year, month, accountId])

  useEffect(() => { loadMonth() }, [loadMonth])

  const byDate = useMemo(() => {
    const m = new Map()
    ;(monthData?.days || []).forEach((d) => m.set(d.date, d))
    return m
  }, [monthData])

  const weeks = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 })
    const days = eachDayOfInterval({ start, end })
    const out = []
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7))
    return out
  }, [cursor])

  const totals = monthData?.totals
  const monthR = (monthData?.days || []).reduce((s, d) => s + (d.r || 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={20} className="text-accent" />
          <h1 className="text-lg font-semibold">Calendar &amp; Journal</h1>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn px-2" onClick={() => setCursor((c) => addMonths(c, -1))}><ChevronLeft size={16} /></button>
          <span className="min-w-[130px] text-center font-medium">{format(cursor, 'MMMM yyyy')}</span>
          <button className="btn px-2" onClick={() => setCursor((c) => addMonths(c, 1))}><ChevronRight size={16} /></button>
          <button className="btn text-xs" onClick={() => { setCursor(startOfMonth(new Date())); setSelected(format(new Date(), 'yyyy-MM-dd')) }}>Today</button>
        </div>
      </div>

      <GoalsCard accountId={accountId} placeholder />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] gap-4 items-start">
        {/* calendar */}
        <div className="card p-4">
          {/* month totals */}
          {totals && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-3 text-sm">
              <span className={clsx('font-semibold tabular-nums', pnlClass(totals.net_pnl))}>{money(totals.net_pnl, { sign: true })}</span>
              <span className="text-slate-500">{totals.trade_count} trades</span>
              <span className="text-slate-500">{num(totals.win_rate, 0)}% win</span>
              <span className={clsx('tabular-nums', pnlClass(monthR))}>{rMultiple(monthR)}</span>
            </div>
          )}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WD.map((d) => <div key={d} className="text-[11px] text-slate-500 text-center py-1">{d}</div>)}
          </div>
          <div className="space-y-1">
            {weeks.map((wk, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1">
                {wk.map((day) => {
                  const iso = format(day, 'yyyy-MM-dd')
                  const rec = byDate.get(iso)
                  const dim = !isSameMonth(day, cursor)
                  const sel = selected === iso
                  return (
                    <button key={iso} onClick={() => setSelected(iso)}
                      className={clsx(
                        'relative aspect-square rounded-lg border p-1.5 text-left transition-colors flex flex-col',
                        cellBg(rec),
                        dim && 'opacity-35',
                        sel && 'ring-2 ring-accent',
                        isToday(day) && !sel && 'ring-1 ring-slate-500',
                      )}>
                      <div className="flex items-start justify-between">
                        <span className={clsx('text-[11px] tabular-nums', isToday(day) ? 'text-accent font-semibold' : 'text-slate-500')}>{format(day, 'd')}</span>
                        <span className="flex items-center gap-0.5">
                          {rec?.over_trades && <AlertTriangle size={10} className="text-amber-400" />}
                          {rec?.broke_daily_loss && <Ban size={10} className="text-loss" />}
                          {rec?.has_note && <StickyNote size={10} className="text-accent" />}
                        </span>
                      </div>
                      {rec?.trades > 0 && (
                        <div className="mt-auto">
                          <div className={clsx('text-[12px] font-semibold tabular-nums leading-tight', pnlClass(rec.pnl))}>{money(rec.pnl, { sign: true, decimals: 0 })}</div>
                          <div className="text-[10px] text-slate-500 leading-tight">{rec.trades} trade{rec.trades === 1 ? '' : 's'}</div>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* day panel */}
        <div className="lg:sticky lg:top-0">
          <DayPanel date={selected} accountId={accountId} onSaved={loadMonth} />
        </div>
      </div>
    </div>
  )
}
