import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import {
  LayoutDashboard, ListOrdered, Wallet, Settings, CandlestickChart,
  ChevronDown, Globe, Check, Sparkles, Tags, BookOpen, CalendarCheck, FlaskConical,
  CalendarDays, Activity, ScrollText, Timer, ClipboardList, Building2, Menu, X,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react'
import { useStore } from '../store'
import { Segmented } from './ui'
import { money, pnlClass } from '../lib/format'

// Grouped by when you actually use them: what's happening now, logging/reviewing a
// session, digging for edge, the money side, one-off setup, then plumbing.
const NAV_SECTIONS = [
  {
    section: null,                      // no heading — these two are the landing pages
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/live', label: 'Live', icon: Activity },
    ],
  },
  {
    section: 'Journal',
    items: [
      { to: '/trades', label: 'Trades', icon: ListOrdered },
      { to: '/calendar', label: 'Calendar & Journal', icon: CalendarDays },
      { to: '/review', label: 'Weekly Review', icon: CalendarCheck },
    ],
  },
  {
    section: 'Analysis',
    items: [
      { to: '/insights', label: 'Tag Insights', icon: Sparkles },
      { to: '/missing', label: 'Missing Data', icon: ClipboardList },
      { to: '/backtest', label: 'Backtest', icon: FlaskConical },
    ],
  },
  {
    section: 'Accounts',
    items: [
      { to: '/accounts', label: 'Accounts', icon: Wallet },
      { to: '/prop-firms', label: 'Prop Firms', icon: Building2 },
    ],
  },
  {
    section: 'Setup',
    items: [
      { to: '/playbooks', label: 'Playbooks', icon: BookOpen },
      { to: '/tags', label: 'Tags', icon: Tags },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    section: 'System',
    items: [
      { to: '/tasks', label: 'Scheduled Tasks', icon: Timer },
      { to: '/logs', label: 'Logs', icon: ScrollText },
    ],
  },
]

function AccountSwitcher() {
  const { accounts, accountId, setAccountId, activeAccount } = useStore()
  const [open, setOpen] = useState(false)

  const globalPnl = accounts.reduce((s, a) => s + (a.stats?.net_pnl || 0), 0)
  const current = activeAccount
    ? { name: activeAccount.name, color: activeAccount.color, pnl: activeAccount.stats?.net_pnl }
    : { name: 'All accounts', color: null, pnl: globalPnl }

  const select = (id) => { setAccountId(id); setOpen(false) }

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="btn w-full sm:min-w-[220px] justify-between">
        <span className="flex items-center gap-2 truncate">
          {current.color
            ? <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: current.color }} />
            : <Globe size={14} className="text-slate-400 shrink-0" />}
          <span className="truncate">{current.name}</span>
        </span>
        <ChevronDown size={14} className="text-slate-500" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-[min(300px,calc(100vw-2rem))] card p-1 shadow-2xl max-h-[70vh] overflow-auto">
            <button onClick={() => select(null)} className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-ink-800 text-sm">
              <span className="flex items-center gap-2"><Globe size={14} className="text-slate-400" /> All accounts <span className="text-slate-500">(global)</span></span>
              <span className="flex items-center gap-2">
                <span className={clsx('tabular-nums', pnlClass(globalPnl))}>{money(globalPnl, { sign: true })}</span>
                {accountId === null && <Check size={14} className="text-accent" />}
              </span>
            </button>
            <div className="my-1 border-t border-ink-800" />
            {accounts.map((a) => (
              <button key={a.id} onClick={() => select(a.id)} className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-ink-800 text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: a.color }} />
                  <span className="truncate">{a.name}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className={clsx('tabular-nums text-xs', pnlClass(a.stats?.net_pnl))}>{money(a.stats?.net_pnl || 0, { sign: true })}</span>
                  {accountId === a.id && <Check size={14} className="text-accent" />}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SidebarContent({ collapsed, onNavigate, version, onToggleCollapse }) {
  return (
    <>
      <nav className="flex-1 p-2 overflow-y-auto">
        {NAV_SECTIONS.map(({ section, items }, si) => (
          <div key={section || si} className={si > 0 ? 'mt-3' : ''}>
            {/* collapsed: the label won't fit, so the group reads as a divider instead */}
            {section && (collapsed
              ? <div className="mx-2 mb-2 border-t border-ink-800" />
              : <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  {section}
                </div>
            )}
            <div className="space-y-0.5">
              {items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={onNavigate}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) => clsx(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    collapsed && 'justify-center px-2',
                    isActive ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:text-slate-200 hover:bg-ink-800',
                  )}
                >
                  <Icon size={17} className="shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-ink-800">
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={clsx(
              'w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-slate-500',
              'hover:text-slate-200 hover:bg-ink-800 transition-colors',
              collapsed && 'justify-center px-2',
            )}
          >
            {collapsed ? <PanelLeftOpen size={17} className="shrink-0" />
                       : <PanelLeftClose size={17} className="shrink-0" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        )}
        <div className={clsx('px-3 pb-3 pt-1 text-[11px] text-slate-600', collapsed && 'text-center px-1')}>
          {collapsed ? <span title={`Trade Journal v${version}`}>v{version}</span> : <>Trade Journal · <span className="text-slate-500">v{version}</span></>}
        </div>
      </div>
    </>
  )
}

export default function Layout() {
  const { rangeKey, setRangeKey, ranges, meta } = useStore()
  const [collapsed, setCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tj.navCollapsed')) ?? false } catch { return false }
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  useEffect(() => { localStorage.setItem('tj.navCollapsed', JSON.stringify(collapsed)) }, [collapsed])
  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  const version = meta?.version || '—'

  return (
    <div className="flex h-screen overflow-hidden">
      {/* desktop sidebar */}
      <aside className={clsx(
        'hidden md:flex shrink-0 bg-ink-900 border-r border-ink-800 flex-col transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-56',
      )}>
        <div className={clsx('h-14 flex items-center gap-2 px-4 border-b border-ink-800', collapsed && 'px-0 justify-center')}>
          <CandlestickChart size={20} className="text-accent shrink-0" />
          {!collapsed && <span className="font-semibold tracking-tight truncate">Trade Journal</span>}
        </div>
        <SidebarContent collapsed={collapsed} version={version} onToggleCollapse={() => setCollapsed((v) => !v)} />
      </aside>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-64 max-w-[80vw] bg-ink-900 border-r border-ink-800 flex flex-col">
            <div className="h-14 flex items-center justify-between gap-2 px-4 border-b border-ink-800">
              <span className="flex items-center gap-2">
                <CandlestickChart size={20} className="text-accent" />
                <span className="font-semibold tracking-tight">Trade Journal</span>
              </span>
              <button className="text-slate-500 hover:text-slate-200" onClick={() => setMobileOpen(false)}><X size={18} /></button>
            </div>
            <SidebarContent collapsed={false} version={version} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="min-h-14 shrink-0 flex items-center justify-between gap-2 px-3 sm:px-5 py-2 border-b border-ink-800 bg-ink-900/50">
          <div className="flex items-center gap-2 min-w-0">
            <button className="md:hidden btn px-2 py-1.5" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu size={16} />
            </button>
            {/* collapse control lives at the foot of the sidebar itself */}
            <div className="min-w-0"><AccountSwitcher /></div>
          </div>
          <div className="overflow-x-auto">
            <Segmented
              options={ranges.map((r) => ({ value: r.key, label: r.label }))}
              value={rangeKey}
              onChange={setRangeKey}
              size="sm"
            />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-3 sm:p-5">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
