import { useState } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { useStore } from '../store'
import { api } from '../api'
import { money, pct, num, pnlClass } from '../lib/format'
import { RiskBar, RiskBadge, ProfitBar } from '../components/RiskBar'

const TYPES = [
  { value: 'demo', label: 'Demo' },
  { value: 'prop-challenge', label: 'Prop — Challenge' },
  { value: 'prop-funded', label: 'Prop — Funded' },
  { value: 'live', label: 'Live' },
]
const COLORS = ['#3b82f6', '#a855f7', '#22d3ee', '#ec4899', '#eab308', '#f97316', '#14b8a6', '#8b5cf6']

const TYPE_BADGE = {
  'demo': 'bg-slate-700 text-slate-300',
  'prop-challenge': 'bg-amber-500/15 text-amber-400',
  'prop-funded': 'bg-profit/15 text-profit',
  'live': 'bg-accent/15 text-accent',
}

function AccountForm({ initial, onClose, onSaved }) {
  const [f, setF] = useState(initial || {
    name: '', broker: 'cTrader', account_type: 'demo', prop_firm: '',
    currency: 'USD', starting_balance: 100000, color: COLORS[0], is_active: true, leverage: '',
    daily_loss_limit: '', max_loss_limit: '', profit_target: '', trailing_dd: false,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const numOrNull = (v) => (v === '' || v == null ? null : parseFloat(v))
  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const payload = {
        ...f, starting_balance: parseFloat(f.starting_balance), prop_firm: f.prop_firm || null,
        daily_loss_limit: numOrNull(f.daily_loss_limit), max_loss_limit: numOrNull(f.max_loss_limit),
        profit_target: numOrNull(f.profit_target),
        leverage: f.leverage ? parseInt(f.leverage, 10) : null,
      }
      if (initial?.id) await api.updateAccount(initial.id, payload)
      else await api.createAccount(payload)
      onSaved()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">{initial?.id ? 'Edit account' : 'New account'}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <label className="text-xs text-slate-500 block">Name
            <input className="input w-full mt-1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-500 block">Type
              <select className="input w-full mt-1" value={f.account_type} onChange={(e) => setF({ ...f, account_type: e.target.value })}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500 block">Prop firm
              <input className="input w-full mt-1" placeholder="FundingPips / FTMO…" value={f.prop_firm || ''} onChange={(e) => setF({ ...f, prop_firm: e.target.value })} />
            </label>
            <label className="text-xs text-slate-500 block">Broker
              <input className="input w-full mt-1" value={f.broker} onChange={(e) => setF({ ...f, broker: e.target.value })} />
            </label>
            <label className="text-xs text-slate-500 block">Starting balance
              <input className="input w-full mt-1" value={f.starting_balance} onChange={(e) => setF({ ...f, starting_balance: e.target.value })} />
            </label>
            <label className="text-xs text-slate-500 block">Leverage (for margin)
              <input className="input w-full mt-1" placeholder="e.g. 100" value={f.leverage ?? ''} onChange={(e) => setF({ ...f, leverage: e.target.value })} />
            </label>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1.5">Colour</div>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setF({ ...f, color: c })}
                  className={`w-6 h-6 rounded-full ${f.color === c ? 'ring-2 ring-white' : ''}`} style={{ background: c }} />
              ))}
            </div>
          </div>
          <div className="border-t border-ink-800 pt-3">
            <div className="text-xs text-slate-400 mb-2 font-medium">Prop-firm rules (optional)</div>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs text-slate-500 block">Daily loss
                <input className="input w-full mt-1" placeholder="5000" value={f.daily_loss_limit ?? ''} onChange={(e) => setF({ ...f, daily_loss_limit: e.target.value })} />
              </label>
              <label className="text-xs text-slate-500 block">Max drawdown
                <input className="input w-full mt-1" placeholder="10000" value={f.max_loss_limit ?? ''} onChange={(e) => setF({ ...f, max_loss_limit: e.target.value })} />
              </label>
              <label className="text-xs text-slate-500 block">Profit target
                <input className="input w-full mt-1" placeholder="8000" value={f.profit_target ?? ''} onChange={(e) => setF({ ...f, profit_target: e.target.value })} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400 mt-2">
              <input type="checkbox" checked={!!f.trailing_dd} onChange={(e) => setF({ ...f, trailing_dd: e.target.checked })} /> Trailing max drawdown (from peak equity)
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active
          </label>
          {err && <div className="text-loss text-xs">{err}</div>}
          <button className="btn btn-primary w-full justify-center" onClick={save} disabled={busy || !f.name}>Save account</button>
        </div>
      </div>
    </div>
  )
}

export default function Accounts() {
  const { accounts, reloadAccounts, setAccountId } = useStore()
  const [editing, setEditing] = useState(null)   // account object or 'new'

  const refresh = async () => { await reloadAccounts(); setEditing(null) }
  const remove = async (a) => {
    if (!confirm(`Delete "${a.name}" and all its trades? This cannot be undone.`)) return
    await api.deleteAccount(a.id)
    await reloadAccounts()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Accounts</h1>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> Add account</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {accounts.map((a) => {
          const s = a.stats || {}
          return (
            <div key={a.id} className="card p-4 relative">
              <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl" style={{ background: a.color }} />
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="font-medium truncate">{a.name}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TYPE_BADGE[a.account_type] || 'bg-slate-700'}`}>{a.account_type}</span>
                    {a.prop_firm && <span className="text-xs text-slate-500">{a.prop_firm}</span>}
                    {!a.is_active && <span className="text-xs text-slate-600">inactive</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button className="btn px-2 py-1" onClick={() => setEditing(a)}><Pencil size={13} /></button>
                  <button className="btn btn-danger px-2 py-1" onClick={() => remove(a)}><Trash2 size={13} /></button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">Balance</div>
                  <div className="text-lg font-semibold tabular-nums">{money(s.balance ?? a.starting_balance)}</div>
                  <div className="text-[11px] text-slate-500">start {money(a.starting_balance, { decimals: 0 })}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">Net PnL</div>
                  <div className={`text-lg font-semibold tabular-nums ${pnlClass(s.net_pnl)}`}>{money(s.net_pnl || 0, { sign: true })}</div>
                  <div className="text-[11px] text-slate-500">{s.trade_count || 0} closed · {s.open_trades || 0} open</div>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-4 text-xs text-slate-400">
                <span>Win {s.win_rate != null ? pct(s.win_rate) : '—'}</span>
                <span>PF {s.profit_factor != null ? num(s.profit_factor, 2) : (s.trade_count ? '∞' : '—')}</span>
                <button className="ml-auto text-accent hover:underline" onClick={() => setAccountId(a.id)}>View →</button>
              </div>

              {s.risk && (
                <div className="mt-3 pt-3 border-t border-ink-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-500 uppercase tracking-wide">Prop rules</span>
                    <RiskBadge status={s.risk.status} />
                  </div>
                  <RiskBar label="Daily loss" rule={s.risk.daily} />
                  <RiskBar label={`Max drawdown${s.risk.trailing_dd ? ' (trailing)' : ''}`} rule={s.risk.max_loss} />
                  <ProfitBar profit={s.risk.profit} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {editing && <AccountForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  )
}
