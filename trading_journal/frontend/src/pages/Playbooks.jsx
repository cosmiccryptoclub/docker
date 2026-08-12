import { useState } from 'react'
import { Plus, Trash2, BookOpen } from 'lucide-react'
import { useStore } from '../store'
import { useApi } from '../lib/useApi'
import { api } from '../api'
import { Spinner, Center } from '../components/ui'
import { money, pct, num, rMultiple, pnlClass } from '../lib/format'

const COLORS = ['#3b82f6', '#22d3ee', '#a855f7', '#ec4899', '#eab308', '#f97316', '#14b8a6']

function PlaybookCard({ pb, perf, reload }) {
  const [rule, setRule] = useState('')
  const addRule = () => {
    if (!rule.trim()) return
    api.updatePlaybook(pb.id, { rules: [...pb.rules, rule.trim()] }).then(reload)
    setRule('')
  }
  const removeRule = (i) => api.updatePlaybook(pb.id, { rules: pb.rules.filter((_, j) => j !== i) }).then(reload)

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: pb.color }} />
        <input defaultValue={pb.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== pb.name) api.updatePlaybook(pb.id, { name: e.target.value.trim() }).then(reload) }}
          className="flex-1 bg-transparent font-medium focus:outline-none" />
        <button onClick={() => { if (confirm(`Delete "${pb.name}"?`)) api.deletePlaybook(pb.id).then(reload) }} className="text-slate-700 hover:text-loss"><Trash2 size={14} /></button>
      </div>

      {perf && (
        <div className="grid grid-cols-4 gap-2 mb-3 text-center">
          <div><div className="text-[10px] text-slate-500 uppercase">Net</div><div className={`text-sm tabular-nums ${pnlClass(perf.net_pnl)}`}>{money(perf.net_pnl, { sign: true, decimals: 0 })}</div></div>
          <div><div className="text-[10px] text-slate-500 uppercase">Win</div><div className="text-sm tabular-nums">{pct(perf.win_rate)}</div></div>
          <div><div className="text-[10px] text-slate-500 uppercase">Trades</div><div className="text-sm tabular-nums text-slate-400">{perf.trades}</div></div>
          <div><div className="text-[10px] text-slate-500 uppercase">Adherence</div><div className="text-sm tabular-nums text-accent">{perf.avg_adherence != null ? `${num(perf.avg_adherence, 0)}%` : '—'}</div></div>
        </div>
      )}

      <div className="space-y-1.5">
        {pb.rules.map((r, i) => (
          <div key={i} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg bg-ink-850 border border-ink-800 text-sm">
            <span className="text-slate-600">{i + 1}.</span>
            <span className="flex-1">{r}</span>
            <button onClick={() => removeRule(i)} className="text-slate-700 hover:text-loss opacity-0 group-hover:opacity-100"><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input value={rule} onChange={(e) => setRule(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addRule() }}
          placeholder="Add a rule…" className="input flex-1 text-sm" />
        <button onClick={addRule} className="btn px-2"><Plus size={14} /></button>
      </div>
    </div>
  )
}

export default function Playbooks() {
  const { apiFilters } = useStore()
  const { data: pbs, loading, reload } = useApi(() => api.playbooks(), [])
  const { data: perf } = useApi(() => api.playbookPerformance(apiFilters), [JSON.stringify(apiFilters)])

  const perfById = Object.fromEntries((perf?.playbooks || []).map((p) => [p.playbook_id, p]))
  const buckets = perf?.adherence_buckets || []

  const addPlaybook = () => api.createPlaybook({ name: 'New playbook', color: COLORS[(pbs?.length || 0) % COLORS.length], rules: [] }).then(reload)

  if (loading && !pbs) return <Center className="h-64"><Spinner className="w-6 h-6" /></Center>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Playbooks</h1>
          <p className="text-sm text-slate-500">Define your strategies + pre-trade rule checklists, then grade adherence on each trade.</p>
        </div>
        <button className="btn btn-primary" onClick={addPlaybook}><Plus size={15} /> New playbook</button>
      </div>

      {buckets.some((b) => b.trades > 0) && (
        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-300 mb-3"><BookOpen size={15} className="text-accent" /> Performance by checklist adherence</div>
          <div className="grid grid-cols-3 gap-3">
            {buckets.map((b) => (
              <div key={b.bucket} className="bg-ink-850 rounded-lg p-3 text-center">
                <div className="text-xs text-slate-500 mb-1">Adherence {b.bucket}</div>
                <div className="text-xl font-semibold tabular-nums">{b.win_rate != null ? pct(b.win_rate) : '—'}</div>
                <div className="text-[11px] text-slate-500">{b.trades} trades · <span className={pnlClass(b.net_pnl)}>{money(b.net_pnl, { sign: true, decimals: 0 })}</span></div>
                <div className={`text-[11px] ${pnlClass(b.avg_r)}`}>{b.avg_r != null ? rMultiple(b.avg_r) : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {(pbs || []).map((pb) => <PlaybookCard key={pb.id} pb={pb} perf={perfById[pb.id]} reload={reload} />)}
      </div>
    </div>
  )
}
