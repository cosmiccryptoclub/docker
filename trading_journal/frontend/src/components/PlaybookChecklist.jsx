import { useState } from 'react'
import { Check } from 'lucide-react'
import { useApi } from '../lib/useApi'
import { api } from '../api'

// Select a playbook + tick its pre-trade rules; shows adherence %. Saves on change.
export default function PlaybookChecklist({ trade, onSaved }) {
  const { data: pbs } = useApi(() => api.playbooks(), [])
  const [pbId, setPbId] = useState(trade.playbook_id || '')
  const [checklist, setChecklist] = useState(trade.checklist || [])

  const persist = (id, cl) => api.updateTrade(trade.id, { playbook_id: id || null, checklist: cl }).then(onSaved)

  const selectPb = (val) => {
    const id = val ? +val : ''
    const pb = (pbs || []).find((p) => p.id === id)
    let cl = []
    if (pb) {
      cl = (id === trade.playbook_id && (trade.checklist || []).length)
        ? trade.checklist
        : pb.rules.map((r) => ({ rule: r, checked: false }))
    }
    setPbId(id); setChecklist(cl); persist(id, cl)
  }

  const toggle = (i) => {
    const cl = checklist.map((c, j) => (j === i ? { ...c, checked: !c.checked } : c))
    setChecklist(cl); persist(pbId, cl)
  }

  const checked = checklist.filter((c) => c.checked).length
  const adher = checklist.length ? Math.round((checked / checklist.length) * 100) : null
  const adherColor = adher >= 80 ? 'text-profit' : adher >= 50 ? 'text-amber-400' : 'text-loss'

  return (
    <div>
      <select value={pbId} onChange={(e) => selectPb(e.target.value)} className="input w-full mb-2">
        <option value="">No playbook</option>
        {(pbs || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {checklist.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-2 text-xs">
            <span className="text-slate-500">Adherence</span>
            <span className={`tabular-nums font-medium ${adherColor}`}>{adher}% ({checked}/{checklist.length})</span>
          </div>
          <div className="space-y-1">
            {checklist.map((c, i) => (
              <button key={i} onClick={() => toggle(i)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink-800 text-sm text-left">
                <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${c.checked ? 'bg-profit border-profit' : 'border-ink-600'}`}>
                  {c.checked && <Check size={12} className="text-white" />}
                </span>
                <span className={c.checked ? '' : 'text-slate-400'}>{c.rule}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
