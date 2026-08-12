import { useEffect, useState, useCallback } from 'react'
import { Building2, Plus, Trash2, Download, Receipt, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import clsx from 'clsx'
import { api } from '../api'
import { money, num, pnlClass } from '../lib/format'
import { Center, Spinner, EmptyState } from '../components/ui'

const KINDS = [
  { value: 'challenge_fee', label: 'Challenge fee', income: false },
  { value: 'reset_fee', label: 'Reset fee', income: false },
  { value: 'subscription', label: 'Subscription', income: false },
  { value: 'other', label: 'Other cost', income: false },
  { value: 'payout', label: 'Payout', income: true },
  { value: 'refund', label: 'Refund', income: true },
]
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label]))
const isIncome = (k) => ['payout', 'refund'].includes(k)

const today = () => new Date().toISOString().slice(0, 10)
const blank = () => ({
  date: today(), firm: '', kind: 'challenge_fee', amount: '', currency: 'USD',
  account_size: '', reference: '', method: '', notes: '',
})

function Metric({ label, value, cls, sub }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={clsx('text-xl font-semibold tabular-nums mt-0.5', cls)}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function TxForm({ initial, accounts, firms, onSave, onCancel }) {
  const [f, setF] = useState(initial)
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">{initial.id ? 'Edit transaction' : 'Add transaction'}</h3>
        <button className="text-slate-500 hover:text-slate-300" onClick={onCancel}><X size={16} /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="text-xs text-slate-500">Date
          <input type="date" className="input w-full mt-1" value={f.date} onChange={(e) => set('date', e.target.value)} />
        </label>
        <label className="text-xs text-slate-500">Firm
          <input className="input w-full mt-1" list="firm-list" placeholder="FTMO" value={f.firm} onChange={(e) => set('firm', e.target.value)} />
          <datalist id="firm-list">{firms.map((x) => <option key={x} value={x} />)}</datalist>
        </label>
        <label className="text-xs text-slate-500">Type
          <select className="input w-full mt-1" value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">Amount ({isIncome(f.kind) ? 'received' : 'paid'})
          <input type="number" step="0.01" min="0" className="input w-full mt-1" value={f.amount} onChange={(e) => set('amount', e.target.value)} />
        </label>
        <label className="text-xs text-slate-500">Currency
          <input className="input w-full mt-1" value={f.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
        </label>
        <label className="text-xs text-slate-500">Account size
          <input type="number" className="input w-full mt-1" placeholder="100000" value={f.account_size} onChange={(e) => set('account_size', e.target.value)} />
        </label>
        <label className="text-xs text-slate-500">Linked account
          <select className="input w-full mt-1" value={f.account_id || ''} onChange={(e) => set('account_id', e.target.value || null)}>
            <option value="">—</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">Reference
          <input className="input w-full mt-1" placeholder="invoice / payout id" value={f.reference} onChange={(e) => set('reference', e.target.value)} />
        </label>
        <label className="text-xs text-slate-500">Method
          <input className="input w-full mt-1" placeholder="card / crypto / bank" value={f.method} onChange={(e) => set('method', e.target.value)} />
        </label>
        <label className="text-xs text-slate-500 sm:col-span-2 lg:col-span-3">Notes
          <input className="input w-full mt-1" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={!f.firm || !f.amount} onClick={() => onSave(f)}>Save</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

export default function PropFirms() {
  const [data, setData] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [tax, setTax] = useState(null)
  const [editing, setEditing] = useState(null)
  const [err, setErr] = useState(null)

  const load = useCallback(() => {
    api.propTransactions().then(setData).catch((e) => setErr(e.message))
    api.propTaxSummary().then(setTax).catch(() => {})
  }, [])

  useEffect(() => {
    load()
    api.accounts().then(setAccounts).catch(() => {})
  }, [load])

  const save = async (f) => {
    try {
      const body = { ...f, amount: Number(f.amount), account_size: f.account_size ? Number(f.account_size) : null }
      if (f.id) await api.updatePropTx(f.id, body)
      else await api.createPropTx(body)
      setEditing(null); load()
    } catch (e) { setErr(e.message) }
  }

  const remove = async (id) => {
    if (!confirm('Delete this transaction?')) return
    try { await api.deletePropTx(id); load() } catch (e) { setErr(e.message) }
  }

  if (!data && !err) return <Center className="h-64"><Spinner className="w-6 h-6" /></Center>
  if (err && !data) return <EmptyState title="Failed to load" hint={err} />

  const t = data.totals
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Building2 size={20} className="text-accent" />
          <h1 className="text-lg font-semibold">Prop firms</h1>
          <span className="text-xs text-slate-600">{t.count} transactions</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a className="btn text-xs" href={api.exportPropUrl(null, 'csv')} download><Download size={13} /> Ledger CSV</a>
          <a className="btn text-xs" href={api.exportPropTaxUrl()} download><Receipt size={13} /> Tax summary</a>
          <button className="btn btn-primary text-xs" onClick={() => setEditing(blank())}><Plus size={13} /> Add</button>
        </div>
      </div>

      {/* headline numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Spent on firms" value={money(t.costs)} cls="text-loss" sub="challenges, resets, subs" />
        <Metric label="Payouts received" value={money(t.payouts)} cls="text-profit" />
        <Metric label="Net profit" value={money(t.net, { sign: true })} cls={pnlClass(t.net)} sub="payouts − costs" />
        <Metric label="Return on fees" value={t.costs > 0 ? `${num((t.payouts / t.costs) * 100, 0)}%` : '—'} cls={t.payouts >= t.costs ? 'text-profit' : 'text-slate-300'} sub="payouts ÷ costs" />
      </div>

      {editing && (
        <TxForm initial={editing} accounts={accounts} firms={data.firms}
          onSave={save} onCancel={() => setEditing(null)} />
      )}

      {/* breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <h2 className="font-medium text-sm mb-3">By firm</h2>
          {data.by_firm.length === 0 && <div className="text-sm text-slate-600">No transactions yet.</div>}
          <div className="space-y-1">
            {data.by_firm.map((f) => (
              <div key={f.firm} className="flex items-center gap-3 text-sm py-1.5 border-b border-ink-800/60 last:border-0">
                <span className="font-medium min-w-0 truncate">{f.firm}</span>
                <span className="text-xs text-slate-600">{f.count}</span>
                <span className="ml-auto text-xs text-loss tabular-nums">−{money(f.costs, { decimals: 0 })}</span>
                <span className="text-xs text-profit tabular-nums">+{money(f.payouts, { decimals: 0 })}</span>
                <span className={clsx('tabular-nums font-medium w-24 text-right', pnlClass(f.net))}>{money(f.net, { sign: true, decimals: 0 })}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <h2 className="font-medium text-sm mb-3">By year <span className="text-xs text-slate-600 font-normal">— for tax returns</span></h2>
          {(tax?.years || []).length === 0 && <div className="text-sm text-slate-600">No transactions yet.</div>}
          <div className="overflow-x-auto">
            {(tax?.years || []).length > 0 && (
              <table className="w-full min-w-[420px]">
                <thead><tr>
                  <th className="th">Year</th><th className="th text-right">Payouts</th>
                  <th className="th text-right">Costs</th><th className="th text-right">Net</th>
                </tr></thead>
                <tbody>
                  {tax.years.map((y) => (
                    <tr key={y.year} className="hover:bg-ink-800/40">
                      <td className="td font-medium">{y.year}</td>
                      <td className="td text-right tabular-nums text-profit">{money(y.payouts + y.refunds, { decimals: 0 })}</td>
                      <td className="td text-right tabular-nums text-loss">{money(y.costs, { decimals: 0 })}</td>
                      <td className={clsx('td text-right tabular-nums font-medium', pnlClass(y.net_profit))}>{money(y.net_profit, { sign: true, decimals: 0 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* ledger */}
      <div className="card p-4">
        <h2 className="font-medium text-sm mb-3">Ledger</h2>
        {data.transactions.length === 0
          ? <div className="text-sm text-slate-600">Nothing logged yet — add your first challenge purchase or payout.</div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead><tr>
                  <th className="th">Date</th><th className="th">Firm</th><th className="th">Type</th>
                  <th className="th text-right">Amount</th><th className="th">Account</th>
                  <th className="th">Reference</th><th className="th"></th>
                </tr></thead>
                <tbody>
                  {data.transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-ink-800/40 cursor-pointer" onClick={() => setEditing({ ...tx, amount: String(tx.amount), account_size: tx.account_size ?? '' })}>
                      <td className="td whitespace-nowrap text-slate-400 text-xs">{format(parseISO(tx.date), 'dd MMM yyyy')}</td>
                      <td className="td font-medium">{tx.firm}</td>
                      <td className="td">
                        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', isIncome(tx.kind) ? 'bg-profit/15 text-profit' : 'bg-loss/15 text-loss')}>
                          {KIND_LABEL[tx.kind] || tx.kind}
                        </span>
                      </td>
                      <td className={clsx('td text-right tabular-nums font-medium', pnlClass(tx.signed))}>{money(tx.signed, { sign: true, currency: tx.currency || 'USD' })}</td>
                      <td className="td text-xs text-slate-500">{tx.account || (tx.account_size ? `${num(tx.account_size / 1000, 0)}k` : '—')}</td>
                      <td className="td text-xs text-slate-500 truncate max-w-[160px]">{tx.reference || '—'}</td>
                      <td className="td text-right">
                        <button className="text-slate-600 hover:text-loss" onClick={(e) => { e.stopPropagation(); remove(tx.id) }}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      <p className="text-xs text-slate-600">
        Trading P&amp;L on a prop account is the firm's capital — what's taxable is what you actually
        receive. Net profit here = payouts + refunds − fees paid. Export the ledger or the yearly
        tax summary for your accountant.
      </p>
      {err && <div className="text-sm text-loss">{err}</div>}
    </div>
  )
}
