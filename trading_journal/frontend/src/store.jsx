import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import { api } from './api'

const StoreContext = createContext(null)

const RANGES = [
  { key: 'all', label: 'All time', days: 0 },
  { key: '7d', label: 'Last 7d', days: 7 },
  { key: '30d', label: 'Last 30d', days: 30 },
  { key: '90d', label: 'Last 90d', days: 90 },
  { key: '365d', label: 'Last 1y', days: 365 },
]

const load = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v) }
  catch { return fallback }
}

export function StoreProvider({ children }) {
  const [meta, setMeta] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [accountId, setAccountId] = useState(() => load('tj.accountId', null)) // null = global
  const [rangeKey, setRangeKey] = useState(() => load('tj.rangeKey', 'all'))
  const [filters, setFilters] = useState({
    symbol: '', setup: '', session: '', direction: '', status: '', tag: '', search: '',
  })
  const [tagOptionIds, setTagOptionIds] = useState([])   // structured-tag drill-down filter

  const reloadAccounts = useCallback(async () => {
    const a = await api.accounts(true)
    setAccounts(a)
    return a
  }, [])

  const reloadMeta = useCallback(async () => {
    const m = await api.meta()
    setMeta(m)
    return m
  }, [])

  useEffect(() => {
    Promise.all([reloadMeta(), reloadAccounts()])
      .catch((e) => console.error('init load failed', e))
      .finally(() => setLoading(false))
  }, [reloadMeta, reloadAccounts])

  useEffect(() => { localStorage.setItem('tj.accountId', JSON.stringify(accountId)) }, [accountId])
  useEffect(() => { localStorage.setItem('tj.rangeKey', JSON.stringify(rangeKey)) }, [rangeKey])

  // filters actually sent to the API (account + date range + user filters)
  const apiFilters = useMemo(() => {
    const range = RANGES.find((r) => r.key === rangeKey) || RANGES[0]
    const out = { ...filters }
    if (accountId) out.account_id = accountId
    if (range.days > 0) {
      const start = new Date(Date.now() - range.days * 86400_000)
      out.start = start.toISOString()
    }
    if (tagOptionIds.length) out.tag_option_ids = tagOptionIds.join(',')
    Object.keys(out).forEach((k) => { if (out[k] === '' || out[k] == null) delete out[k] })
    return out
  }, [filters, accountId, rangeKey, tagOptionIds])

  const activeAccount = accounts.find((a) => a.id === accountId) || null

  const value = {
    meta, accounts, loading, reloadAccounts, reloadMeta,
    accountId, setAccountId, activeAccount,
    rangeKey, setRangeKey, ranges: RANGES,
    filters, setFilters, apiFilters,
    tagOptionIds, setTagOptionIds,
    resetFilters: () => { setFilters({ symbol: '', setup: '', session: '', direction: '', status: '', tag: '', search: '' }); setTagOptionIds([]) },
  }
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export const useStore = () => {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
