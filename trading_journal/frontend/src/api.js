// Tiny fetch wrapper + typed-ish helpers for every endpoint.

async function req(path, { method = 'GET', body, isForm = false } = {}) {
  const opts = { method, headers: {} }
  if (body !== undefined) {
    if (isForm) {
      opts.body = body
    } else {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }
  }
  const res = await fetch(`/api${path}`, opts)
  if (!res.ok) {
    let detail
    try { detail = (await res.json()).detail } catch { detail = res.statusText }
    throw new Error(detail || `Request failed (${res.status})`)
  }
  if (res.status === 204) return null
  return res.json()
}

// build a query string from a filters object (drops empty values)
export function qs(filters = {}) {
  const p = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== '') p.set(k, v)
  })
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const api = {
  meta: () => req('/meta'),
  health: () => req('/health'),

  // accounts
  accounts: (withStats = false) => req(`/accounts${withStats ? '?with_stats=true' : ''}`),
  account: (id) => req(`/accounts/${id}`),
  createAccount: (data) => req('/accounts', { method: 'POST', body: data }),
  updateAccount: (id, data) => req(`/accounts/${id}`, { method: 'PUT', body: data }),
  deleteAccount: (id) => req(`/accounts/${id}`, { method: 'DELETE' }),

  // trades
  trades: (filters) => req(`/trades${qs(filters)}`),
  trade: (id) => req(`/trades/${id}`),
  tradeChart: (id) => req(`/trades/${id}/chart`),
  tradeLog: (id) => req(`/trades/${id}/log`),
  groupTrades: (tradeIds) => req('/trades/group', { method: 'POST', body: { trade_ids: tradeIds } }),
  ungroupTrade: (id) => req(`/trades/${id}/ungroup`, { method: 'POST' }),
  createTrade: (data) => req('/trades', { method: 'POST', body: data }),
  updateTrade: (id, data) => req(`/trades/${id}`, { method: 'PUT', body: data }),
  deleteTrade: (id) => req(`/trades/${id}`, { method: 'DELETE' }),
  addFill: (tradeId, data) => req(`/trades/${tradeId}/fills`, { method: 'POST', body: data }),

  // fills
  updateFill: (id, data) => req(`/fills/${id}`, { method: 'PUT', body: data }),
  deleteFill: (id) => req(`/fills/${id}`, { method: 'DELETE' }),

  // live market data
  liveOpen: (accountId) => req(`/live/open${accountId ? `?account_id=${accountId}` : ''}`),
  liveAccount: (accountId, fresh = false) => req(`/live/account${qs({ account_id: accountId, fresh: fresh || undefined })}`),
  livePrices: (symbols) => req(`/live/prices${symbols ? `?symbols=${symbols}` : ''}`),

  // backtest sandbox
  backtestCandles: (params) => req(`/backtest/candles${qs(params)}`),

  // app preferences
  getSettings: () => req('/settings'),
  updateSettings: (data) => req('/settings', { method: 'PUT', body: data }),
  testDiscord: () => req('/settings/test-discord', { method: 'POST' }),

  // tags taxonomy
  tags: () => req('/tags'),
  createCategory: (data) => req('/tags/categories', { method: 'POST', body: data }),
  updateCategory: (id, data) => req(`/tags/categories/${id}`, { method: 'PUT', body: data }),
  deleteCategory: (id) => req(`/tags/categories/${id}`, { method: 'DELETE' }),
  createOption: (catId, data) => req(`/tags/categories/${catId}/options`, { method: 'POST', body: data }),
  updateOption: (id, data) => req(`/tags/options/${id}`, { method: 'PUT', body: data }),
  deleteOption: (id) => req(`/tags/options/${id}`, { method: 'DELETE' }),
  importTags: (data) => req('/tags/import', { method: 'POST', body: { data } }),
  tagImportPrompt: () => req('/tags/import-prompt'),
  exportTagsUrl: (format = 'json') => `/api/tags/export?format=${format}`,
  reorderCategories: (ids) => req('/tags/categories/reorder', { method: 'PUT', body: { ids } }),
  reorderOptions: (catId, ids) => req(`/tags/categories/${catId}/options/reorder`, { method: 'PUT', body: { ids } }),

  // playbooks
  playbooks: () => req('/playbooks'),
  createPlaybook: (data) => req('/playbooks', { method: 'POST', body: data }),
  updatePlaybook: (id, data) => req(`/playbooks/${id}`, { method: 'PUT', body: data }),
  deletePlaybook: (id) => req(`/playbooks/${id}`, { method: 'DELETE' }),

  // journal / calendar / discipline goals
  journalMonth: (year, month, accountId) => req(`/journal/month${qs({ year, month, account_id: accountId })}`),
  journalDay: (date, accountId) => req(`/journal/day${qs({ date, account_id: accountId })}`),
  saveJournalDay: (date, data) => req(`/journal/day${qs({ date })}`, { method: 'PUT', body: data }),
  goals: (accountId) => req(`/journal/goals${qs({ account_id: accountId })}`),

  // prop-firm ledger (fees + payouts, tax exports)
  propTransactions: (filters) => req(`/prop${qs(filters)}`),
  createPropTx: (data) => req('/prop', { method: 'POST', body: data }),
  updatePropTx: (id, data) => req(`/prop/${id}`, { method: 'PUT', body: data }),
  deletePropTx: (id) => req(`/prop/${id}`, { method: 'DELETE' }),
  propTaxSummary: () => req('/prop/tax-summary'),

  // download helpers (return a URL the browser fetches directly)
  exportTradesUrl: (filters, format = 'csv', includeFills = false) =>
    `/api/trades/export${qs({ ...filters, format, include_fills: includeFills || undefined })}`,
  exportPropUrl: (year, format = 'csv') => `/api/prop/export${qs({ year, format })}`,
  exportPropTaxUrl: () => '/api/prop/tax-summary?format=csv',

  // system: event log + scheduled tasks
  logs: (filters) => req(`/system/logs${qs(filters)}`),
  tasks: () => req('/system/tasks'),
  runTask: (id) => req(`/system/tasks/${id}/run`, { method: 'POST' }),

  // economic calendar
  econUpcoming: (filters) => req(`/econ/upcoming${qs(filters)}`),
  econEvents: (filters) => req(`/econ${qs(filters)}`),
  econStatus: () => req('/econ/status'),
  econRefresh: () => req('/econ/refresh', { method: 'POST' }),

  // analytics
  overview: (filters) => req(`/analytics/overview${qs(filters)}`),
  tagPerformance: (filters) => req(`/analytics/tags${qs(filters)}`),
  playbookPerformance: (filters) => req(`/analytics/playbooks${qs(filters)}`),
  review: (filters) => req(`/analytics/review${qs(filters)}`),
  missingData: (filters) => req(`/analytics/missing${qs(filters)}`),
  exitOptimiser: (filters) => req(`/analytics/exit-optimiser${qs(filters)}`),
  summary: (filters) => req(`/analytics/summary${qs(filters)}`),
  equity: (filters) => req(`/analytics/equity${qs(filters)}`),
  calendar: (filters) => req(`/analytics/calendar${qs(filters)}`),
  distribution: (by, filters) => req(`/analytics/distribution${qs({ by, ...filters })}`),

  // admin
  seed: (opts = {}) => req(`/admin/seed${qs({ reset: opts.reset ?? true, account_id: opts.accountId, count: opts.count, days: opts.days })}`, { method: 'POST' }),
  backfillCandles: () => req('/admin/backfill-candles', { method: 'POST' }),
  refreshTrendbars: () => req('/admin/refresh-trendbars', { method: 'POST' }),
  candleStats: () => req('/admin/candle-stats'),
  reset: () => req('/admin/reset', { method: 'POST' }),
  importJson: (data) => req('/admin/import/json', { method: 'POST', body: data }),
  importCsv: (accountId, file) => {
    const fd = new FormData()
    fd.append('account_id', accountId)
    fd.append('file', file)
    return req('/admin/import/csv', { method: 'POST', body: fd, isForm: true })
  },
  ctraderStatus: () => req('/admin/ctrader/status'),
  ctraderAuthUrl: (redirectUri) => req(`/admin/ctrader/auth-url?redirect_uri=${encodeURIComponent(redirectUri)}`),
  ctraderExchange: (code, redirectUri) => req('/admin/ctrader/exchange', { method: 'POST', body: { code, redirect_uri: redirectUri } }),
  ctraderAccounts: () => req('/admin/ctrader/accounts'),
  syncCtrader: (accountId, ctid, groupWindow) => req(`/admin/sync/ctrader?account_id=${accountId}${ctid ? `&ctid=${ctid}` : ''}${groupWindow != null ? `&group_window=${groupWindow}` : ''}`, { method: 'POST' }),
  upload: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return req('/admin/upload', { method: 'POST', body: fd, isForm: true })
  },
}
