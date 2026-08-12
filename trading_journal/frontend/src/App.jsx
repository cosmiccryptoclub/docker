import { useEffect } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import Layout from './components/Layout'
import { useStore } from './store'
import { api } from './api'
import { Center, Spinner } from './components/ui'
import Dashboard from './pages/Dashboard'
import Trades from './pages/Trades'
import TradeDetail from './pages/TradeDetail'
import Accounts from './pages/Accounts'
import Settings from './pages/Settings'
import TagsConfig from './pages/TagsConfig'
import TagInsights from './pages/TagInsights'
import Playbooks from './pages/Playbooks'
import Review from './pages/Review'
import Backtest from './pages/Backtest'
import Calendar from './pages/Calendar'
import Live from './pages/Live'
import Logs from './pages/Logs'
import MissingData from './pages/MissingData'
import PropFirms from './pages/PropFirms'
import Tasks from './pages/Tasks'

export default function App() {
  const { loading } = useStore()
  const navigate = useNavigate()

  // Handle the cTrader OAuth redirect back to the app (?code=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (!code) return
    api.ctraderExchange(code, window.location.origin + '/')
      .then(() => { navigate('/settings'); alert('✅ cTrader connected — production token stored. Now Fetch accounts + Sync.') })
      .catch((e) => { navigate('/settings'); alert('cTrader connect failed: ' + e.message) })
  }, [navigate])

  if (loading) {
    return <Center className="h-screen"><Spinner className="w-6 h-6" /></Center>
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="trades" element={<Trades />} />
        <Route path="trades/:id" element={<TradeDetail />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="live" element={<Live />} />
        <Route path="insights" element={<TagInsights />} />
        <Route path="missing" element={<MissingData />} />
        <Route path="review" element={<Review />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="prop-firms" element={<PropFirms />} />
        <Route path="tags" element={<TagsConfig />} />
        <Route path="playbooks" element={<Playbooks />} />
        <Route path="backtest" element={<Backtest />} />
        <Route path="logs" element={<Logs />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
