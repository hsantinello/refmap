import { useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../../store'

export default function PromptHistoryButton() {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const currentCanvasId = useCanvasStore(s => s.currentCanvasId)

  useEffect(() => {
    if (!currentCanvasId) return
    window.api.getSetting(`promptHistory_${currentCanvasId}`).then(raw => {
      if (raw) try { setHistory(JSON.parse(raw as string)) } catch {}
      else setHistory([])
    })
  }, [currentCanvasId])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        !panelRef.current?.contains(e.target as Node) &&
        !btnRef.current?.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 1500)
  }

  return (
    <>
      <button
        ref={btnRef}
        title="Histórico de prompts"
        onClick={() => setOpen(v => !v)}
        className={`
          absolute top-[60px] right-3 z-20
          w-9 h-9 flex items-center justify-center rounded-xl
          rm-panel !border-transparent transition-all
          ${open ? 'text-white/80' : 'text-white/40 hover:text-white/80'}
        `}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <path d="M7.5 1a6.5 6.5 0 1 0 0 13A6.5 6.5 0 0 0 7.5 1ZM7.5 4v4l2.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute top-[104px] right-3 z-20 w-[340px] rm-panel !border-transparent rounded-2xl overflow-hidden"
        >
          <div className="px-4 py-3 flex items-center justify-between border-b border-white/[0.06]">
            <span className="text-[12px] font-medium text-white/60 tracking-wide uppercase">
              Histórico de prompts
            </span>
            <span className="text-[11px] text-white/25">{history.length}/10</span>
          </div>

          {history.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-white/25">
              Nenhum prompt copiado ainda
            </div>
          ) : (
            <div className="max-h-[360px] overflow-y-auto flex flex-col">
              {history.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleCopy(prompt, idx)}
                  className="group w-full text-left px-4 py-3 hover:bg-white/[0.04] transition-colors border-b border-white/[0.04] last:border-b-0 flex items-start gap-3"
                >
                  <span className="flex-1 text-[12px] text-white/55 group-hover:text-white/80 transition-colors leading-relaxed line-clamp-3 break-words">
                    {prompt}
                  </span>
                  <span className={`shrink-0 text-[11px] mt-0.5 transition-colors ${copiedIdx === idx ? 'text-emerald-400' : 'text-white/20 group-hover:text-white/40'}`}>
                    {copiedIdx === idx ? 'Copiado!' : 'Copiar'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
