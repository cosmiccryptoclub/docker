import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle } from 'lucide-react'

// Portal-based tooltip so it never gets clipped by cards/overflow containers.
export function Tooltip({ label, children, className = '' }) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const ref = useRef(null)

  const onEnter = useCallback(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: r.left + r.width / 2, y: r.top })
    setShow(true)
  }, [])

  return (
    <span
      ref={ref}
      onMouseEnter={onEnter}
      onMouseLeave={() => setShow(false)}
      className={`inline-flex items-center ${className}`}
    >
      {children}
      {show && label && createPortal(
        <div
          style={{ left: pos.x, top: pos.y }}
          className="fixed z-[100] -translate-x-1/2 -translate-y-full pointer-events-none"
        >
          <div className="mb-2 max-w-[260px] rounded-lg bg-ink-700 border border-ink-600 px-3 py-2 text-xs leading-relaxed text-slate-200 shadow-xl">
            {label}
          </div>
        </div>,
        document.body,
      )}
    </span>
  )
}

export function InfoTip({ label }) {
  return (
    <Tooltip label={label}>
      <HelpCircle size={13} className="text-slate-600 hover:text-slate-300 cursor-help" />
    </Tooltip>
  )
}
