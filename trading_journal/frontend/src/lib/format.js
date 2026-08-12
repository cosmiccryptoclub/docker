import { format, formatDistanceStrict } from 'date-fns'

export function money(v, { currency = 'USD', decimals = 2, sign = false } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const s = new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(Math.abs(v))
  const prefix = v < 0 ? '-' : sign ? '+' : ''
  return prefix + s
}

export function num(v, decimals = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(v)
}

export function pct(v, decimals = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${v >= 0 ? '' : ''}${num(v, decimals)}%`
}

export function lots(v) {
  if (v === null || v === undefined) return '—'
  return num(v, 2)
}

export function rMultiple(v) {
  if (v === null || v === undefined) return '—'
  return `${v >= 0 ? '+' : ''}${num(v, 2)}R`
}

export function price(v, decimals = 2) {
  if (v === null || v === undefined) return '—'
  return num(v, decimals)
}

export function profitFactor(v) {
  if (v === null || v === undefined) return '∞'
  return num(v, 2)
}

export function dt(v, fmt = 'dd MMM yyyy, HH:mm') {
  if (!v) return '—'
  try { return format(new Date(v), fmt) } catch { return '—' }
}

export function dateOnly(v) {
  return dt(v, 'dd MMM yyyy')
}

export function duration(seconds) {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const start = new Date(0)
  const end = new Date(seconds * 1000)
  return formatDistanceStrict(start, end)
}

export function pnlClass(v) {
  if (v === null || v === undefined || Math.abs(v) < 1e-9) return 'text-slate-400'
  return v > 0 ? 'text-profit' : 'text-loss'
}

export const CHART = {
  profit: '#16c784',
  loss: '#ea3943',
  grid: '#232d42',
  axis: '#5b6b8c',
  line: '#3b82f6',
}

// Display precision per instrument — mirrors marketdata.price_decimals on the backend.
// Altcoins vary hugely (SOL ~2dp, DOGE ~5dp, SHIB ~8dp), so when a reference price is
// known the precision follows its magnitude.
const FIAT = new Set(['USD','EUR','GBP','JPY','AUD','CAD','CHF','NZD','SEK','NOK','DKK',
  'PLN','CZK','HUF','TRY','ZAR','MXN','SGD','HKD','CNH','CNY'])

export function priceDecimals(symbol, ref) {
  const s = String(symbol || '').toUpperCase().split('.')[0].replace(/[/_-]/g, '')
  if (s.startsWith('BTC')) return 1
  if (s.length === 6 && FIAT.has(s.slice(0, 3)) && FIAT.has(s.slice(3))) {
    return s.endsWith('JPY') ? 3 : 5
  }
  if (ref != null && ref > 0) {
    if (ref >= 10000) return 1
    if (ref >= 1000) return 2
    if (ref >= 100) return 3
    if (ref >= 1) return 4
    if (ref >= 0.01) return 6
    return 8
  }
  return 2
}
