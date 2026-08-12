import { useState, useEffect } from 'react'
import { Database, Trash2, Upload, RefreshCw, Plug, FileJson, FileSpreadsheet, Search, Link2, SlidersHorizontal, CandlestickChart, Target, CalendarClock, Bell, HardDriveDownload } from 'lucide-react'
import { useStore } from '../store'
import { useToast } from '../components/Toast'
import { api } from '../api'

function Section({ icon: Icon, title, desc, children }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={17} className="text-accent" />
        <h2 className="font-medium">{title}</h2>
      </div>
      {desc && <p className="text-sm text-slate-500 mb-4">{desc}</p>}
      {children}
    </div>
  )
}

const TABS = [
  { key: 'general', label: 'General', icon: SlidersHorizontal },
  { key: 'sync', label: 'cTrader sync', icon: Plug },
  { key: 'data', label: 'Market data', icon: CandlestickChart },
  { key: 'goals', label: 'Goals & alerts', icon: Target },
  { key: 'system', label: 'Data & system', icon: HardDriveDownload },
]

function Toast({ msg }) {
  if (!msg) return null
  return <div className={`mt-3 text-sm ${msg.err ? 'text-loss' : 'text-profit'}`}>{msg.text}</div>
}

export default function Settings() {
  const { accounts, meta, reloadAccounts, reloadMeta } = useStore()
  const toast = useToast()
  const [tab, setTab] = useState(() => localStorage.getItem('tj.settingsTab') || 'general')
  useEffect(() => { localStorage.setItem('tj.settingsTab', tab) }, [tab])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  const [importAcc, setImportAcc] = useState(accounts[0]?.id || '')
  const [jsonText, setJsonText] = useState('')
  const [ctAccounts, setCtAccounts] = useState(null)
  const [ctErr, setCtErr] = useState(null)
  const [rowTarget, setRowTarget] = useState({})
  const [groupWindow, setGroupWindow] = useState(60)
  const [seedAcc, setSeedAcc] = useState('')
  const [seedCount, setSeedCount] = useState(50)
  const [seedDays, setSeedDays] = useState(30)

  const [ctStatus, setCtStatus] = useState(null)
  useEffect(() => { api.ctraderStatus().then(setCtStatus).catch(() => {}) }, [])

  const [candleStats, setCandleStats] = useState(null)
  useEffect(() => { api.candleStats().then(setCandleStats).catch(() => {}) }, [])

  const [econStat, setEconStat] = useState(null)
  useEffect(() => { api.econStatus().then(setEconStat).catch(() => {}) }, [])

  const [prefs, setPrefs] = useState(null)
  const [prefsMsg, setPrefsMsg] = useState(null)
  useEffect(() => {
    api.getSettings().then((s) => { setPrefs(s); setGroupWindow(s.ctrader_group_window ?? 60) }).catch(() => {})
  }, [])
  const savePrefs = async (patch) => {
    setPrefs((p) => ({ ...p, ...patch }))
    try { const saved = await api.updateSettings(patch); setPrefs(saved); toast.success('Settings saved') }
    catch (e) { toast.error(e) }
  }

  const fetchCt = async () => {
    setCtErr(null); setBusy('ct-fetch')
    try { setCtAccounts(await api.ctraderAccounts()) }
    catch (e) { setCtErr(e.message); setCtAccounts(null) }
    finally { setBusy('') }
  }

  const connectCt = async () => {
    setCtErr(null)
    try {
      const redirect = window.location.origin + '/'
      const { url } = await api.ctraderAuthUrl(redirect)
      window.location.href = url
    } catch (e) { setCtErr(e.message) }
  }

  const refreshAll = async () => { await Promise.all([reloadAccounts(), reloadMeta()]) }
  const run = async (label, fn) => {
    setBusy(label); setMsg(null)
    try {
      const r = await fn()
      await refreshAll()
      const text = typeof r === 'string' ? r : 'Done.'
      setMsg({ text }); toast.success(text)
    }
    catch (e) { setMsg({ err: true, text: e.message }); toast.error(e) }
    finally { setBusy('') }
  }

  const ctraderConfigured = meta?.connectors?.ctrader?.configured

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-lg font-semibold">Settings</h1>

      <div className="flex gap-1 overflow-x-auto border-b border-ink-800 -mb-px">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              tab === key ? 'border-accent text-accent' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === 'general' && prefs && (
        <Section icon={SlidersHorizontal} title="Preferences" desc="App defaults + cTrader auto-sync.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-xs text-slate-500 block">Default group window (seconds)
              <input type="number" min={0} className="input w-full mt-1" value={prefs.ctrader_group_window}
                onChange={(e) => setPrefs({ ...prefs, ctrader_group_window: Math.max(0, +e.target.value || 0) })}
                onBlur={(e) => savePrefs({ ctrader_group_window: Math.max(0, +e.target.value || 0) })} />
              <span className="text-[11px] text-slate-600">Merge hotkey scale-ins opened within this window on sync (0 = off).</span>
            </label>
            <label className="text-xs text-slate-500 block">cTrader auto-sync (minutes)
              <input type="number" min={0} className="input w-full mt-1" value={prefs.ctrader_autosync_minutes}
                onChange={(e) => setPrefs({ ...prefs, ctrader_autosync_minutes: Math.max(0, +e.target.value || 0) })}
                onBlur={(e) => savePrefs({ ctrader_autosync_minutes: Math.max(0, +e.target.value || 0) })} />
              <span className="text-[11px] text-slate-600">Re-sync linked cTrader accounts every N minutes (0 = off).</span>
            </label>
          </div>
          {prefs.ctrader_syncs?.length > 0 && (
            <div className="mt-4">
              <div className="text-xs text-slate-500 mb-2">Auto-sync targets (added when you sync an account)</div>
              <div className="space-y-1">
                {prefs.ctrader_syncs.map((m) => {
                  const acc = accounts.find((a) => a.id === m.account_id)
                  return (
                    <div key={m.ctid} className="flex items-center gap-2 text-sm bg-ink-850 rounded p-2">
                      <span className="text-slate-400">cTrader {m.ctrader_name || m.ctid}</span>
                      <span className="text-slate-600">→</span>
                      <span>{acc?.name || `account ${m.account_id}`}</span>
                      <button className="ml-auto text-slate-600 hover:text-loss" onClick={() => savePrefs({ ctrader_syncs: prefs.ctrader_syncs.filter((x) => x.ctid !== m.ctid) })}><Trash2 size={13} /></button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {prefsMsg && <div className="mt-2 text-xs text-profit">{prefsMsg}</div>}
        </Section>
      )}

      {tab === 'system' && prefs && (
        <Section icon={HardDriveDownload} title="Backups & exports" desc="Everything lives in this container's ./data volume — keep a copy.">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input type="checkbox" checked={prefs.db_backups !== false} onChange={(e) => savePrefs({ db_backups: e.target.checked })} />
            Nightly database backup (03:30 local, keeps the last 14)
          </label>
          <p className="mt-2 text-xs text-slate-600">
            Written to <code className="text-slate-400">data/backups/</code> using SQLite's online backup
            (safe while the app is running). Back up the whole <code className="text-slate-400">./data</code> folder
            to keep trades, candles, settings and screenshots.
          </p>
          <div className="flex gap-2 mt-3 flex-wrap">
            <a className="btn text-xs" href="/api/trades/export?format=csv" download>Export all trades (CSV)</a>
            <a className="btn text-xs" href="/api/trades/export?format=json" download>Export all trades (JSON)</a>
            <a className="btn text-xs" href="/api/prop/export?format=csv" download>Export prop ledger (CSV)</a>
          </div>
        </Section>
      )}

      {tab === 'system' && (
      <Section icon={Database} title="Dummy data" desc="Generate realistic scale-in / partial-TP trades — fills, tags, playbook checklists, ratings, notes and daily journal entries — so every page has something to show.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <label className="text-xs text-slate-500 block">Add to account
            <select className="input w-full mt-1" value={seedAcc} onChange={(e) => setSeedAcc(e.target.value)}>
              <option value="">Demo accounts (wipes everything)</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <span className="text-[11px] text-slate-600">
              {seedAcc ? 'Added to this account. Nothing is wiped, and your own tag groups + playbooks are used.'
                       : 'Rebuilds the demo accounts from scratch — deletes existing data.'}
            </span>
          </label>
          <label className="text-xs text-slate-500 block">Trades
            <input type="number" min={1} max={500} className="input w-full mt-1" value={seedCount}
              onChange={(e) => setSeedCount(Math.max(1, Math.min(500, +e.target.value || 1)))} />
          </label>
          <label className="text-xs text-slate-500 block">Spread over (days)
            <input type="number" min={1} max={365} className="input w-full mt-1" value={seedDays}
              onChange={(e) => setSeedDays(Math.max(1, Math.min(365, +e.target.value || 1)))} />
          </label>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-primary" disabled={busy === 'seed'}
            onClick={() => {
              if (!seedAcc && !confirm('No account selected — this WIPES all accounts, trades and tags and rebuilds the demo set. Continue?')) return
              run('seed', async () => {
                const r = await api.seed({
                  accountId: seedAcc || undefined,
                  count: seedAcc ? seedCount : undefined,
                  days: seedDays,
                  reset: !seedAcc,
                })
                return r.account
                  ? `Added ${r.trades} trades + ${r.day_notes} journal entries to ${r.account}.`
                  : `Seeded ${r.trades} trades across ${r.accounts} accounts.`
              })
            }}>
            <RefreshCw size={14} /> {busy === 'seed' ? 'Seeding…' : seedAcc ? 'Add dummy trades' : 'Seed / reset dummy data'}
          </button>
          <button className="btn btn-danger" disabled={busy === 'reset'}
            onClick={() => { if (confirm('Wipe ALL accounts, trades and fills?')) run('reset', async () => { await api.reset(); return 'All data cleared.' }) }}>
            <Trash2 size={14} /> Wipe everything
          </button>
        </div>
      </Section>
      )}

      {tab === 'sync' && (
      <Section icon={Plug} title="cTrader sync" desc="Pull deals from a cTrader account via the Open API and group them by position into trades (entries + partial exits).">
        <div className="flex items-center gap-2 mb-3">
          <span className={`w-2 h-2 rounded-full ${ctStatus?.has_token ? 'bg-profit' : 'bg-slate-500'}`} />
          <span className="text-sm text-slate-400">
            {ctStatus?.source === 'oauth' ? 'Production token connected (OAuth).'
              : ctStatus?.source === 'env' ? 'Using CTRADER_ACCESS_TOKEN from .env — if that is a Playground/sandbox token, deal sync fails with ACCOUNT_DISABLED. Connect for a production token.'
              : 'No token. Set CTRADER_CLIENT_ID / _SECRET in .env, then Connect.'}
          </span>
        </div>

        <div className="bg-ink-850 border border-amber-500/30 rounded-lg p-3 mb-3 text-xs text-slate-400">
          <b className="text-amber-400">Getting RET_ACCOUNT_DISABLED?</b> The Playground "Get token" gives a <b>sandbox</b> token
          that can list accounts but can't sync deals. Click <b>Connect cTrader</b> below for a <b>production</b> token.
          First make sure <code className="text-slate-300">{typeof window !== 'undefined' ? window.location.origin + '/' : ''}</code> is
          added as a Redirect URI on your app at openapi.ctrader.com.
        </div>

        <div className="flex gap-2 mb-1">
          <button className="btn btn-primary" onClick={connectCt} disabled={!ctStatus?.configured}>
            <Link2 size={14} /> Connect cTrader (production token)
          </button>
          <button className="btn" disabled={busy === 'ct-fetch' || !ctStatus?.has_token} onClick={fetchCt}>
            <Search size={14} /> {busy === 'ct-fetch' ? 'Fetching…' : 'Fetch my cTrader accounts'}
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
          <span>Group scale-ins opened within</span>
          <input type="number" min={0} value={groupWindow} onChange={(e) => setGroupWindow(Math.max(0, +e.target.value || 0))} className="input w-16 py-1 text-center" />
          <span>seconds into one trade (0 = off). Re-syncing replaces this account's cTrader trades.</span>
        </div>
        {ctErr && <div className="mt-2 text-sm text-loss">{ctErr}</div>}

        {ctAccounts && (
          <div className="mt-4">
            {ctAccounts.profile && (
              <div className="text-xs text-slate-500 mb-2">cTID {ctAccounts.profile.userId}{ctAccounts.profile.nickname ? ` · ${ctAccounts.profile.nickname}` : ''}</div>
            )}
            {ctAccounts.accounts.length === 0 && <div className="text-sm text-slate-500">No trading accounts linked to this cTID.</div>}
            <div className="space-y-2">
              {ctAccounts.accounts.map((a) => (
                <div key={a.accountId} className="flex flex-wrap items-center gap-2 bg-ink-850 rounded-lg p-2 text-sm">
                  <span className="font-medium">{a.accountNumber || a.accountId}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${a.live ? 'bg-accent/15 text-accent' : 'bg-slate-700 text-slate-300'}`}>{a.live ? 'LIVE' : 'DEMO'}</span>
                  <span className="text-slate-500 text-xs">{a.brokerTitle || a.brokerName}</span>
                  <span className="text-slate-600 text-[11px]">id {a.accountId}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-slate-500 text-xs">→</span>
                    <select className="input py-1 text-xs" value={rowTarget[a.accountId] || importAcc || ''} onChange={(e) => setRowTarget({ ...rowTarget, [a.accountId]: e.target.value })}>
                      <option value="">local account…</option>
                      {accounts.map((la) => <option key={la.id} value={la.id}>{la.name}</option>)}
                    </select>
                    <button className="btn btn-primary py-1" disabled={busy === `ct-${a.accountId}`}
                      onClick={() => {
                        const local = rowTarget[a.accountId] || importAcc
                        if (!local) { setCtErr('Pick a local account to sync into.'); return }
                        run(`ct-${a.accountId}`, async () => { const r = await api.syncCtrader(local, a.accountId, groupWindow); return `Synced ${r.total} trades from ${a.accountNumber || a.accountId}.` })
                      }}>
                      <RefreshCw size={13} /> Sync
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-600"><b>Beta:</b> deal→trade mapping uses each symbol's own lot size when cTrader provides it (BTC/ETH fallback otherwise) — verify PnL after your first sync. Sync is idempotent (re-syncing updates existing trades).</p>
      </Section>
      )}

      {tab === 'data' && (
      <Section icon={CandlestickChart} title="Candle history" desc="Keep real candles for every trade so charts stay accurate long after providers expire the intraday window (Binance keeps years for crypto; Yahoo indices/forex ~30–60 days, then forward from now).">
        {prefs && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input type="checkbox" checked={prefs.candle_autostore !== false} onChange={(e) => savePrefs({ candle_autostore: e.target.checked })} />
              Collect candles automatically
            </label>
            <label className={`text-xs text-slate-500 block ${prefs.candle_autostore !== false ? '' : 'opacity-50 pointer-events-none'}`}>Collector interval (minutes)
              <input type="number" min={5} className="input w-full mt-1" value={prefs.candle_collect_minutes ?? 30}
                onChange={(e) => setPrefs({ ...prefs, candle_collect_minutes: Math.max(5, +e.target.value || 0) })}
                onBlur={(e) => savePrefs({ candle_collect_minutes: Math.max(5, +e.target.value || 0) })} />
              <span className="text-[11px] text-slate-600">Runs on this interval and right after every auto-sync.</span>
            </label>
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <button className="btn" disabled={busy === 'backfill'}
            onClick={() => run('backfill', async () => { await api.backfillCandles(); setTimeout(() => api.candleStats().then(setCandleStats), 5000); return 'Backfill started — storing candles in the background (watch the container logs).' })}>
            <CandlestickChart size={14} /> Backfill now
          </button>
          {candleStats && (
            <span className="text-sm text-slate-500">
              {(candleStats.candles || 0).toLocaleString()} candles · {candleStats.symbols || 0} symbols
              {candleStats.trendbar_candles > 0 && <span> · {(candleStats.trendbar_candles).toLocaleString()} broker-exact</span>}
              {candleStats.pending_trades > 0 && <span className="text-amber-400"> · {candleStats.pending_trades} trades queued</span>}
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-600">On by default. New synced trades are captured within a few minutes automatically — the manual backfill is only needed for a one-off catch-up.</p>

        {/* Broker-exact candles via cTrader trendbars */}
        {prefs && (
          <div className="border-t border-ink-800 mt-4 pt-4">
            <div className="text-sm font-medium text-slate-300 mb-1">Broker-exact candles (cTrader trendbars)</div>
            <p className="text-xs text-slate-500 mb-3">Use cTrader's own trendbars for indices / gold / forex so charts match your platform exactly, instead of Yahoo's (slightly different) prices. Needs cTrader connected. Beta — verify a chart after enabling.</p>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <input type="checkbox" checked={!!prefs.ctrader_trendbars} disabled={!ctStatus?.has_token}
                  onChange={(e) => savePrefs({ ctrader_trendbars: e.target.checked })} />
                Prefer broker-exact candles automatically
              </label>
              <button className="btn" disabled={busy === 'trendbars' || !ctStatus?.has_token}
                onClick={() => run('trendbars', async () => { await api.refreshTrendbars(); setTimeout(() => api.candleStats().then(setCandleStats), 8000); return 'Fetching broker-exact candles in the background (watch the container logs).' })}>
                <RefreshCw size={14} /> Refresh broker-exact candles
              </button>
            </div>
            {!ctStatus?.has_token && <p className="mt-2 text-xs text-slate-600">Connect cTrader on the "cTrader sync" tab to enable this.</p>}
          </div>
        )}
      </Section>
      )}

      {tab === 'data' && (
      <Section icon={CalendarClock} title="Economic calendar" desc="Pulls high-impact news from the ForexFactory feed so upcoming events show on the Dashboard and overlay on your trade charts. Events accumulate locally, building history over time.">
        {prefs && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input type="checkbox" checked={prefs.econ_calendar !== false} onChange={(e) => savePrefs({ econ_calendar: e.target.checked })} />
              Keep the economic calendar updated
            </label>
            <label className={`text-xs text-slate-500 block ${prefs.econ_calendar !== false ? '' : 'opacity-50 pointer-events-none'}`}>Refresh interval (hours)
              <input type="number" min={1} className="input w-full mt-1" value={prefs.econ_refresh_hours ?? 6}
                onChange={(e) => setPrefs({ ...prefs, econ_refresh_hours: Math.max(1, +e.target.value || 0) })}
                onBlur={(e) => savePrefs({ econ_refresh_hours: Math.max(1, +e.target.value || 0) })} />
            </label>
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <button className="btn" disabled={busy === 'econ'}
            onClick={() => run('econ', async () => { await api.econRefresh(); setTimeout(() => api.econStatus().then(setEconStat), 4000); return 'Economic calendar refresh started.' })}>
            <RefreshCw size={14} /> Refresh now
          </button>
          {econStat && (
            <span className="text-sm text-slate-500">
              {(econStat.events || 0).toLocaleString()} events stored
              {econStat.last_fetched && ` · updated ${new Date(econStat.last_fetched).toLocaleString()}`}
            </span>
          )}
        </div>
      </Section>
      )}


      {tab === 'goals' && prefs && (
        <Section icon={Bell} title="Discord alerts" desc="Get pinged when a prop rule is at risk, breached, or a profit target is reached.">
                                    <label className="text-xs text-slate-500 block">Webhook URL
            <input type="password" className="input w-full mt-1" placeholder="https://discord.com/api/webhooks/…"
              value={prefs.discord_webhook_url || ''}
              onChange={(e) => setPrefs({ ...prefs, discord_webhook_url: e.target.value })}
              onBlur={(e) => savePrefs({ discord_webhook_url: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-400 mt-3">
            <input type="checkbox" checked={!!prefs.discord_alerts} onChange={(e) => savePrefs({ discord_alerts: e.target.checked })} />
            Enable prop-rule / target alerts
          </label>
          <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 ${prefs.discord_alerts ? '' : 'opacity-50 pointer-events-none'}`}>
            <label className="text-xs text-slate-500 block">Warn when a limit reaches (%)
              <input type="number" min={1} max={100} className="input w-full mt-1" value={prefs.alert_warning_pct ?? 80}
                onChange={(e) => setPrefs({ ...prefs, alert_warning_pct: Math.max(1, Math.min(100, +e.target.value || 0)) })}
                onBlur={(e) => savePrefs({ alert_warning_pct: Math.max(1, Math.min(100, +e.target.value || 0)) })} />
              <span className="text-[11px] text-slate-600">Below this = OK, at/above = ⚠️ warning, at 100% = 🚨 breach.</span>
            </label>
            <label className="text-xs text-slate-500 block">Daily summary hour (local time, -1 = off)
              <input type="number" min={-1} max={23} className="input w-full mt-1" value={prefs.daily_summary_hour ?? -1}
                onChange={(e) => setPrefs({ ...prefs, daily_summary_hour: Math.max(-1, Math.min(23, +e.target.value)) })}
                onBlur={(e) => savePrefs({ daily_summary_hour: Math.max(-1, Math.min(23, +e.target.value)) })} />
            </label>
          </div>
          <div className={`flex flex-wrap gap-x-6 gap-y-2 mt-3 ${prefs.discord_alerts ? '' : 'opacity-50 pointer-events-none'}`}>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input type="checkbox" checked={prefs.alert_daily_loss !== false} onChange={(e) => savePrefs({ alert_daily_loss: e.target.checked })} />
              Daily-loss alerts
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input type="checkbox" checked={prefs.alert_max_dd !== false} onChange={(e) => savePrefs({ alert_max_dd: e.target.checked })} />
              Max-drawdown alerts
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input type="checkbox" checked={prefs.alert_profit_target !== false} onChange={(e) => savePrefs({ alert_profit_target: e.target.checked })} />
              Profit-target reached
            </label>
          </div>
          <button className="btn mt-3" disabled={!prefs.discord_webhook_url || busy === 'discord'}
            onClick={() => run('discord', async () => { await api.testDiscord(); return 'Test message sent to Discord.' })}>
            Send test message
          </button>
        </Section>
      )}

      {tab === 'goals' && prefs && (
        <Section icon={Target} title="Discipline goals" desc="Personal limits and targets, tracked on the Calendar & Journal page. Set 0 to disable a goal.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-xs text-slate-500 block">Max trades per day
              <input type="number" min={0} className="input w-full mt-1" value={prefs.goal_max_trades_per_day ?? 0}
                onChange={(e) => setPrefs({ ...prefs, goal_max_trades_per_day: Math.max(0, +e.target.value || 0) })}
                onBlur={(e) => savePrefs({ goal_max_trades_per_day: Math.max(0, +e.target.value || 0) })} />
              <span className="text-[11px] text-slate-600">Flag days where you over-trade.</span>
            </label>
            <label className="text-xs text-slate-500 block">Personal daily-loss cap ($)
              <input type="number" min={0} className="input w-full mt-1" value={prefs.goal_max_daily_loss ?? 0}
                onChange={(e) => setPrefs({ ...prefs, goal_max_daily_loss: Math.max(0, +e.target.value || 0) })}
                onBlur={(e) => savePrefs({ goal_max_daily_loss: Math.max(0, +e.target.value || 0) })} />
              <span className="text-[11px] text-slate-600">Softer than a prop rule — your own line in the sand.</span>
            </label>
            <label className="text-xs text-slate-500 block">Monthly R target
              <input type="number" step="0.5" min={0} className="input w-full mt-1" value={prefs.goal_monthly_r ?? 0}
                onChange={(e) => setPrefs({ ...prefs, goal_monthly_r: Math.max(0, +e.target.value || 0) })}
                onBlur={(e) => savePrefs({ goal_monthly_r: Math.max(0, +e.target.value || 0) })} />
              <span className="text-[11px] text-slate-600">Progress bar of month-to-date R vs this.</span>
            </label>
            <label className="text-xs text-slate-500 block">Min checklist adherence (%)
              <input type="number" min={0} max={100} className="input w-full mt-1" value={prefs.goal_min_adherence_pct ?? 0}
                onChange={(e) => setPrefs({ ...prefs, goal_min_adherence_pct: Math.max(0, Math.min(100, +e.target.value || 0)) })}
                onBlur={(e) => savePrefs({ goal_min_adherence_pct: Math.max(0, Math.min(100, +e.target.value || 0)) })} />
              <span className="text-[11px] text-slate-600">Hold yourself to following your playbook rules.</span>
            </label>
            <label className="text-xs text-slate-500 block">Intended risk per trade (R)
              <input type="number" step="0.1" min={0} className="input w-full mt-1" value={prefs.goal_risk_per_trade_r ?? 0}
                onChange={(e) => setPrefs({ ...prefs, goal_risk_per_trade_r: Math.max(0, +e.target.value || 0) })}
                onBlur={(e) => savePrefs({ goal_risk_per_trade_r: Math.max(0, +e.target.value || 0) })} />
              <span className="text-[11px] text-slate-600">Informational — your standard 1R stake.</span>
            </label>
          </div>
        </Section>
      )}

      {tab === 'system' && (
      <Section icon={Upload} title="Manual import" desc="Import trades from a JSON payload or a fills CSV while live sync is being wired up.">
        <div className="mb-3">
          <label className="text-xs text-slate-500 block mb-1">Target account</label>
          <select className="input" value={importAcc} onChange={(e) => setImportAcc(e.target.value)}>
            <option value="">Select account…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-sm text-slate-300 mb-1"><FileJson size={14} /> JSON</div>
            <textarea className="input w-full h-32 font-mono text-xs" placeholder='{"trades":[{"external_id":"p1","symbol":"BTCUSD","direction":"long","opened_at":"2026-07-01T09:00:00","fills":[...]}]}' value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
            <button className="btn mt-2" disabled={!importAcc || !jsonText || busy === 'json'}
              onClick={() => run('json', async () => {
                const parsed = JSON.parse(jsonText)
                const body = Array.isArray(parsed) ? { account_id: Number(importAcc), trades: parsed } : { account_id: Number(importAcc), ...parsed }
                const r = await api.importJson(body)
                return `Imported ${r.total} trades (${r.created} new).`
              })}>Import JSON</button>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-sm text-slate-300 mb-1"><FileSpreadsheet size={14} /> Fills CSV</div>
            <p className="text-xs text-slate-500 mb-2">Columns: <code className="text-slate-400">position_id, symbol, direction, kind, price, lots, executed_at, fee</code></p>
            <label className="btn cursor-pointer w-fit">
              <Upload size={14} /> Choose CSV
              <input type="file" accept=".csv" className="hidden" disabled={!importAcc}
                onChange={(e) => { const file = e.target.files?.[0]; if (file) run('csv', async () => { const r = await api.importCsv(Number(importAcc), file); return `Imported ${r.total} trades.` }); e.target.value = '' }} />
            </label>
          </div>
        </div>
      </Section>
      )}

      <Toast msg={msg} />

      <div className="text-xs text-slate-600">Trade Journal v{meta?.version} · local-first · data stored in the Docker <code>./data</code> volume.</div>
    </div>
  )
}
