import { useState } from 'react'

// Visualizador das cenas de um nó de vídeo. Mostra todas as cenas em grade; o usuário
// pode selecionar e adicionar cenas específicas ao canvas como imagens separadas.
export default function VideoScenesViewer({
  scenes, videoName, onAdd, onClose,
}: {
  scenes: string[]
  videoName?: string
  onAdd: (paths: string[]) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const toggle = (i: number) => setSelected(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
  const selectedPaths = [...selected].sort((a, b) => a - b).map(i => scenes[i])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="w-[760px] max-w-[92vw] max-h-[86vh] rounded-2xl overflow-hidden flex flex-col"
        style={{ background: '#0d0d0f', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="min-w-0 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3z"/>
            </svg>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-white/85 truncate">Cenas do vídeo</div>
              <div className="text-[11px] text-white/35 truncate">{videoName ? `${videoName} · ` : ''}{scenes.length} cena{scenes.length === 1 ? '' : 's'}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors text-lg shrink-0 cursor-pointer">✕</button>
        </div>

        {/* Controles */}
        <div className="flex items-center justify-end gap-2 px-5 py-2.5 border-b border-white/[0.06] text-[11px] text-white/40">
          <button onClick={() => setSelected(new Set(scenes.map((_, i) => i)))} className="hover:text-white/70 transition-colors cursor-pointer">Todas</button>
          <span className="text-white/15">·</span>
          <button onClick={() => setSelected(new Set())} className="hover:text-white/70 transition-colors cursor-pointer">Nenhuma</button>
        </div>

        {/* Grade */}
        <div className="overflow-y-auto p-4" data-scrollable>
          <div className="grid grid-cols-4 gap-2.5">
            {scenes.map((path, i) => {
              const on = selected.has(i)
              return (
                <button
                  key={path}
                  onClick={() => toggle(i)}
                  className="relative rounded-lg overflow-hidden transition-transform hover:scale-[1.02] cursor-pointer"
                  style={{ border: on ? '2px solid #F97316' : '2px solid rgba(255,255,255,0.08)', aspectRatio: '16 / 10', background: '#000' }}
                >
                  <img src={`file://${path}`} className="w-full h-full object-cover" style={{ opacity: on ? 1 : 0.75 }} draggable={false} />
                  {on && <span className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px]" style={{ background: '#F97316' }}>✓</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-white/[0.06]">
          <div className="text-[11px] text-white/40">{selected.size} selecionada{selected.size === 1 ? '' : 's'}</div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3.5 py-2 rounded-xl text-[12px] text-white/50 hover:text-white/80 transition-colors cursor-pointer">Fechar</button>
            <button
              disabled={selected.size === 0}
              onClick={() => { onAdd(selectedPaths); onClose() }}
              className="px-4 py-2 rounded-xl text-[12px] font-medium text-white transition-opacity disabled:opacity-40 cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #8f0e2e, #F97316)' }}
            >
              Adicionar {selected.size || ''} ao canvas
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
