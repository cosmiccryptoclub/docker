import { useState } from 'react'
import { ChevronDown, ChevronUp, Check, X } from 'lucide-react'
import clsx from 'clsx'
import { useApi } from '../lib/useApi'
import { api } from '../api'

function CategoryDropdown({ cat, selected, toggle, forceOpen }) {
  const [openSelf, setOpenSelf] = useState(false)
  const open = forceOpen === null ? openSelf : forceOpen
  const setOpen = (v) => setOpenSelf(typeof v === 'function' ? v(open) : v)
  const selCount = cat.options.filter((o) => selected.has(o.id)).length
  return (
    <div className={forceOpen ? "" : "relative"}>
      <button onClick={() => setOpen((v) => !v)} className="input w-full flex items-center justify-between">
        <span className="flex items-center gap-2 truncate">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cat.color }} />
          <span className="text-slate-300 truncate">{cat.name}</span>
          {selCount > 0 && <span className="text-xs text-accent">· {selCount}</span>}
          {!cat.multi && <span className="text-[10px] text-slate-600">single</span>}
        </span>
        <ChevronDown size={14} className="text-slate-500 shrink-0" />
      </button>
      {open && (
        <>
          {/* self-opened: float over the page with a click-away backdrop.
              expand-all: render inline so the groups stack instead of overlapping. */}
          {!forceOpen && <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />}
          <div className={clsx(
            'card p-1 max-h-64 overflow-auto',
            forceOpen ? 'mt-1' : 'absolute z-40 mt-1 w-full shadow-2xl',
          )}>
            {cat.options.filter((o) => o.is_active).map((o) => {
              const on = selected.has(o.id)
              return (
                <button key={o.id} onClick={() => toggle(cat, o.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink-800 text-sm text-left">
                  <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-accent border-accent' : 'border-ink-600'}`}>
                    {on && <Check size={12} className="text-white" />}
                  </span>
                  <span className="truncate">{o.name}</span>
                </button>
              )
            })}
            {cat.options.filter((o) => o.is_active).length === 0 && (
              <div className="px-2 py-2 text-xs text-slate-600">No tags — add on the Tags page.</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function TagPicker({ value = [], onChange }) {
  const { data: cats, loading } = useApi(() => api.tags(), [])
  const [allOpen, setAllOpen] = useState(null)     // null = each dropdown decides
  const selected = new Set(value)

  const toggle = (cat, id) => {
    const next = new Set(value)
    if (next.has(id)) {
      next.delete(id)
    } else {
      if (!cat.multi) cat.options.forEach((o) => next.delete(o.id)) // single-select: clear others
      next.add(id)
    }
    onChange([...next])
  }

  if (loading) return <div className="text-sm text-slate-600">Loading tags…</div>
  const active = (cats || []).filter((c) => c.is_active)
  if (active.length === 0) return <div className="text-sm text-slate-600">No tag categories yet — configure them on the Tags page.</div>

  // everything currently ticked, with the group it came from (for the summary row)
  const chosen = []
  active.forEach((c) => c.options.forEach((o) => {
    if (selected.has(o.id)) chosen.push({ ...o, cat: c })
  }))

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="flex-1 min-w-0 flex flex-wrap gap-1.5">
          {chosen.length === 0
            ? <span className="text-xs text-slate-600 py-1">Nothing selected yet.</span>
            : chosen.map((o) => (
              <span key={o.id}
                className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-full text-xs border"
                style={{ borderColor: `${o.cat.color}55`, background: `${o.cat.color}1a` }}
                title={o.cat.name}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: o.cat.color }} />
                <span className="text-slate-200">{o.name}</span>
                <button
                  onClick={() => toggle(o.cat, o.id)}
                  className="rounded-full p-0.5 text-slate-500 hover:text-loss hover:bg-ink-700"
                  title={`Remove ${o.name}`}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {chosen.length > 0 && (
            <button className="btn px-2 py-1 text-xs" onClick={() => onChange([])} title="Remove all selected tags">
              Clear
            </button>
          )}
          <button
            className="btn px-2 py-1 text-xs"
            onClick={() => setAllOpen((v) => (v === true ? false : true))}
            title={allOpen === true ? 'Collapse all groups' : 'Expand all groups'}
          >
            {allOpen === true ? <><ChevronUp size={12} /> Collapse all</> : <><ChevronDown size={12} /> Expand all</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {active.map((c) => (
          <CategoryDropdown key={c.id} cat={c} selected={selected} toggle={toggle} forceOpen={allOpen} />
        ))}
      </div>
    </div>
  )
}
