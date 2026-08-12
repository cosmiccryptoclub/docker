import { useState } from 'react'
import { Plus, Trash2, GripVertical, Check } from 'lucide-react'
import { useApi } from '../lib/useApi'
import { api } from '../api'
import TagImportExport from '../components/TagImportExport'
import { Spinner, Center } from '../components/ui'

const PALETTE = ['#3b82f6', '#a855f7', '#22d3ee', '#ec4899', '#eab308', '#f97316', '#14b8a6', '#8b5cf6', '#64748b']

function ColorDot({ color, onPick }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="w-3.5 h-3.5 rounded-full ring-1 ring-white/20" style={{ background: color }} />
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 mt-1 card p-2 flex gap-1.5 flex-wrap w-40">
            {PALETTE.map((c) => (
              <button key={c} onClick={() => { onPick(c); setOpen(false) }} className="w-5 h-5 rounded-full" style={{ background: c }}>
                {c === color && <Check size={12} className="text-white mx-auto" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function OptionRow({ opt, onRename, onDelete }) {
  return (
    <div className="group flex items-center gap-2 px-2 py-1.5 rounded-lg bg-ink-850 border border-ink-800">
      <GripVertical size={14} className="text-slate-700" />
      <input
        defaultValue={opt.name}
        onBlur={(e) => { if (e.target.value.trim() && e.target.value !== opt.name) onRename(e.target.value.trim()) }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
        className="flex-1 bg-transparent text-sm focus:outline-none"
      />
      {opt.count > 0 && <span className="text-[10px] text-slate-600 tabular-nums">{opt.count}</span>}
      <button onClick={onDelete} className="text-slate-700 hover:text-loss opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button>
    </div>
  )
}

function CategoryCard({ cat, reload }) {
  const [adding, setAdding] = useState('')
  const addOption = async () => {
    if (!adding.trim()) return
    await api.createOption(cat.id, { name: adding.trim() })
    setAdding(''); reload()
  }
  return (
    <div className="card p-3">
      <div className="flex items-center gap-2 mb-3">
        <ColorDot color={cat.color} onPick={(c) => api.updateCategory(cat.id, { color: c }).then(reload)} />
        <input
          defaultValue={cat.name}
          onBlur={(e) => { if (e.target.value.trim() && e.target.value !== cat.name) api.updateCategory(cat.id, { name: e.target.value.trim() }).then(reload) }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
          className="flex-1 bg-transparent font-medium text-sm focus:outline-none"
        />
        <button
          onClick={() => api.updateCategory(cat.id, { multi: !cat.multi }).then(reload)}
          className={`text-[10px] px-1.5 py-0.5 rounded border ${cat.multi ? 'border-accent/50 text-accent' : 'border-ink-600 text-slate-500'}`}
          title="Toggle single vs multi select"
        >
          {cat.multi ? 'multi' : 'single'}
        </button>
        <button onClick={() => { if (confirm(`Delete category "${cat.name}" and its tags?`)) api.deleteCategory(cat.id).then(reload) }}
          className="text-slate-700 hover:text-loss"><Trash2 size={14} /></button>
      </div>
      <div className="space-y-1.5">
        {cat.options.map((o) => (
          <OptionRow key={o.id} opt={o}
            onRename={(name) => api.updateOption(o.id, { name }).then(reload)}
            onDelete={() => api.deleteOption(o.id).then(reload)} />
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input value={adding} onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addOption() }}
          placeholder="Add tag…" className="input flex-1 text-sm" />
        <button onClick={addOption} className="btn px-2"><Plus size={14} /></button>
      </div>
    </div>
  )
}

export default function TagsConfig() {
  const { data: cats, loading, reload } = useApi(() => api.tags(), [])

  const addCategory = async () => {
    await api.createCategory({ name: 'New category', color: PALETTE[Math.floor((cats?.length || 0)) % PALETTE.length] })
    reload()
  }

  if (loading && !cats) return <Center className="h-64"><Spinner className="w-6 h-6" /></Center>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Tags</h1>
          <p className="text-sm text-slate-500">Configure grouped tags, then apply them to trades and drill into performance on Tag Insights.</p>
        </div>
        <button className="btn btn-primary" onClick={addCategory}><Plus size={15} /> New category</button>
      </div>
      <TagImportExport reload={reload} />

      {(cats || []).length === 0 && (
        <div className="card p-8 text-center">
          <div className="text-slate-300 font-medium">No tag groups yet</div>
          <p className="text-sm text-slate-500 mt-1">
            Add a group manually, or open <b>Import / export</b> above and paste your list —
            grouped headings with bullet items work as-is.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {(cats || []).map((c) => <CategoryCard key={c.id} cat={c} reload={reload} />)}
      </div>
    </div>
  )
}
