import { useState, useRef } from 'react'
import { Download, Upload, Sparkles, Check, Copy, ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '../api'
import { useToast } from './Toast'

const PLACEHOLDER = `Paste JSON, or plain text like:

Market structure zones
  - Support
  - Resistance
  - Fib golden zone
Liquidity Grab
  - Large liquidity node hit`

export default function TagImportExport({ reload }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState(null)
  const [copied, setCopied] = useState(false)
  const fileRef = useRef(null)
  const toast = useToast()

  const doImport = async (payload) => {
    setBusy(true); setErr(null); setResult(null)
    try {
      const r = await api.importTags(payload)
      setResult(r)
      setText('')
      reload()
      toast.success(`Added ${r.groups_added} group(s) and ${r.tags_added} tag(s)`)
    } catch (e) { setErr(e.message); toast.error(e) } finally { setBusy(false) }
  }

  const onFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fr = new FileReader()
    fr.onload = () => doImport(String(fr.result || ''))
    fr.readAsText(file)
    e.target.value = ''
  }

  const copyPrompt = async () => {
    try {
      const { prompt } = await api.tagImportPrompt()
      await navigator.clipboard.writeText(prompt)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch (e) { setErr('Could not copy the prompt: ' + e.message) }
  }

  return (
    <div className="card p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 w-full text-left">
        {open ? <ChevronDown size={15} className="text-slate-500" /> : <ChevronRight size={15} className="text-slate-500" />}
        <span className="text-sm font-medium text-slate-300">Import / export</span>
        <span className="text-xs text-slate-500">
          Paste a list, upload a file, or download what you have. Import only <b>adds</b> — nothing is overwritten or duplicated.
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-3">
            <div>
              <textarea
                className="input w-full h-44 font-mono text-xs"
                placeholder={PLACEHOLDER}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <button className="btn btn-primary text-xs" disabled={!text.trim() || busy}
                  onClick={() => doImport(text)}>
                  <Upload size={13} /> {busy ? 'Importing…' : 'Import'}
                </button>
                <button className="btn text-xs" onClick={() => fileRef.current?.click()} disabled={busy}>
                  <Upload size={13} /> Upload file
                </button>
                <input ref={fileRef} type="file" accept=".json,.txt,.md,.csv" className="hidden" onChange={onFile} />
                <a className="btn text-xs" href={api.exportTagsUrl('json')} download>
                  <Download size={13} /> JSON
                </a>
                <a className="btn text-xs" href={api.exportTagsUrl('text')} download>
                  <Download size={13} /> Text
                </a>
              </div>
            </div>

            <div className="bg-ink-850 rounded-lg p-3">
              <div className="flex items-center gap-1.5 text-sm text-slate-300 mb-1">
                <Sparkles size={14} className="text-accent" /> Messy list?
              </div>
              <p className="text-xs text-slate-500 mb-2">
                Copy this prompt, paste it into any LLM along with your notes, spreadsheet
                columns or a transcribed screenshot. It returns JSON you can paste straight
                into the box.
              </p>
              <button className="btn text-xs w-full" onClick={copyPrompt}>
                {copied ? <><Check size={13} className="text-profit" /> Copied</> : <><Copy size={13} /> Copy LLM prompt</>}
              </button>
            </div>
          </div>

          {err && <div className="text-sm text-loss">{err}</div>}

          {result && (
            <div className="bg-ink-850 rounded-lg p-3 text-sm">
              <div className="flex items-center gap-2 text-profit font-medium">
                <Check size={15} />
                Added {result.groups_added} group{result.groups_added === 1 ? '' : 's'} and{' '}
                {result.tags_added} tag{result.tags_added === 1 ? '' : 's'}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {result.tags_skipped > 0 && <>{result.tags_skipped} already existed (skipped). </>}
                {result.groups_existing > 0 && <>{result.groups_existing} group(s) already existed and were left untouched.</>}
                {result.tags_skipped === 0 && result.groups_existing === 0 && 'Nothing was duplicated.'}
              </div>
              {result.added_tags?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {result.added_tags.slice(0, 40).map((t, i) => (
                    <span key={i} className="chip text-[11px]">{t}</span>
                  ))}
                  {result.added_tags.length > 40 && (
                    <span className="text-xs text-slate-500">+{result.added_tags.length - 40} more</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
