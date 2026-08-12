import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { Check, AlertTriangle, X } from 'lucide-react'
import clsx from 'clsx'

const ToastContext = createContext(null)

const STYLE = {
  success: { ring: 'ring-profit/40', bg: 'bg-profit/15', text: 'text-profit', Icon: Check },
  error: { ring: 'ring-loss/40', bg: 'bg-loss/15', text: 'text-loss', Icon: AlertTriangle },
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const seq = useRef(0)

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const push = useCallback((message, kind = 'success', ms = 3200) => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, message, kind }])
    // errors stay longer — you usually need to read them
    setTimeout(() => dismiss(id), kind === 'error' ? Math.max(ms, 6000) : ms)
    return id
  }, [dismiss])

  const value = {
    push,
    success: (m) => push(m, 'success'),
    error: (m) => push(typeof m === 'string' ? m : (m?.message || 'Something went wrong'), 'error'),
    /** Wrap an async action: toasts on success, shows the real error on failure. */
    run: async (fn, okMessage = 'Changes saved') => {
      try {
        const r = await fn()
        push(okMessage, 'success')
        return r
      } catch (e) {
        push(e?.message || 'Something went wrong', 'error')
        throw e
      }
    },
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 items-end pointer-events-none">
        {toasts.map((t) => {
          const s = STYLE[t.kind] || STYLE.success
          return (
            <div
              key={t.id}
              role="status"
              className={clsx(
                'pointer-events-auto flex items-start gap-2.5 max-w-sm rounded-lg px-3 py-2.5',
                'bg-ink-900 shadow-2xl ring-1 text-sm animate-[fadeIn_0.15s_ease-out]',
                s.ring,
              )}
            >
              <span className={clsx('rounded-full p-1 shrink-0 mt-0.5', s.bg, s.text)}>
                <s.Icon size={13} />
              </span>
              <span className="text-slate-200 break-words min-w-0">{t.message}</span>
              <button onClick={() => dismiss(t.id)} className="text-slate-600 hover:text-slate-300 shrink-0">
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
