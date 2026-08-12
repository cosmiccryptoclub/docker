// Shared tooltip shell used by the recharts charts.
export function TooltipShell({ title, rows }) {
  return (
    <div className="rounded-lg bg-ink-700 border border-ink-600 px-3 py-2 shadow-xl text-xs">
      {title && <div className="font-medium text-slate-200 mb-1">{title}</div>}
      <div className="space-y-0.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="text-slate-400">{r.label}</span>
            <span className={`tabular-nums font-medium ${r.className || 'text-slate-200'}`}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
