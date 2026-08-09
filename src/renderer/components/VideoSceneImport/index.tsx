import { useEffect, useRef, useState } from 'react'

export interface SceneFrame {
  index: number
  framePath: string
  timestamp: number
}

// Modal de confirmação das cenas extraídas de um vídeo. O usuário revê os quadros,
// tira os que não quer, ajusta a sensibilidade (re-extrai) e confirma. Só então
// as cenas selecionadas viram nós no canvas (e cada uma é analisada pela IA).
export default function VideoSceneImport({
  videoName,
  videoPath,
  frames,
  capped,
  busy,
  onConfirm,
  onCancel,
  onReextract,
}: {
  videoName: string
  videoPath: string
  frames: SceneFrame[]
  capped: boolean
  busy: boolean
  onConfirm: (paths: string[]) => void
  onCancel: () => void
  onReextract: (direction: 'more' | 'fewer') => void
}) {
  // Cenas capturadas MANUALMENTE pelo usuário (agulha no tempo + botão), mantidas
  // localmente e mescladas às cenas da IA. Índices altos pra não colidir com as da IA.
  const [extra, setExtra] = useState<SceneFrame[]>([])
  const manualIdRef = useRef(1_000_000)
  const [capturing, setCapturing] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Mescla cenas da IA + manuais em ordem cronológica (uma captura em 0:05
  // aparece entre a de 0:04 e a de 0:06).
  const allFrames = [...frames, ...extra].sort((a, b) => a.timestamp - b.timestamp)
  const [selected, setSelected] = useState<Set<number>>(() => new Set(frames.map(f => f.index)))

  // Ao re-extrair (frames da IA mudam), zera as manuais e volta a marcar todas.
  useEffect(() => {
    setExtra([])
    setSelected(new Set(frames.map(f => f.index)))
  }, [frames])

  const toggle = (i: number) =>
    setSelected(s => {
      const n = new Set(s)
      n.has(i) ? n.delete(i) : n.add(i)
      return n
    })

  const captureCurrent = async () => {
    const v = videoRef.current
    if (!v || capturing) return
    setCapturing(true)
    try {
      const fr = await window.api.extractVideoFrame(videoPath, v.currentTime)
      const idx = manualIdRef.current++
      const frame: SceneFrame = { index: idx, framePath: fr.framePath, timestamp: fr.timestamp }
      setExtra(e => [...e, frame])
      setSelected(s => new Set(s).add(idx))
    } catch (err) {
      console.error('[capture-frame]', err)
    } finally {
      setCapturing(false)
    }
  }

  const selectedPaths = allFrames.filter(f => selected.has(f.index)).map(f => f.framePath)

  const fmt = (t: number) => {
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={onCancel}
    >
      <div
        className="w-[720px] max-w-[92vw] max-h-[86vh] rounded-2xl overflow-hidden flex flex-col"
        style={{ background: '#0d0d0f', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-white/85">Cenas do vídeo</div>
            <div className="text-[11px] text-white/35 truncate">
              {videoName} · {frames.length} cena{frames.length === 1 ? '' : 's'}
              {capped ? ' · limite atingido (há mais cenas)' : ''}
            </div>
          </div>
          <button onClick={onCancel} className="text-white/30 hover:text-white/60 transition-colors text-lg shrink-0">✕</button>
        </div>

        {/* Player pra captura manual: posicione a agulha e clique em "Capturar cena" */}
        <div className="px-5 py-3 border-b border-white/[0.06] flex flex-col gap-2">
          <video
            ref={videoRef}
            src={`file://${videoPath}`}
            controls
            className="w-full rounded-lg bg-black max-h-[240px]"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-white/35">
              Mova a agulha até o momento que quiser e capture a cena manualmente.
            </span>
            <button
              onClick={captureCurrent}
              disabled={capturing || busy}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-white transition-opacity disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #8f0e2e, #F97316)' }}
            >
              {capturing ? (
                <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
                  <path d="M12 3a9 9 0 0 1 9 9" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
                  <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="2" />
                </svg>
              )}
              Capturar cena
            </button>
          </div>
        </div>

        {/* Controles */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/[0.06] text-[11px]">
          <div className="flex items-center gap-2 text-white/40">
            <span>Sensibilidade:</span>
            <button
              disabled={busy}
              onClick={() => onReextract('fewer')}
              className="px-2 py-1 rounded-md border border-white/[0.08] hover:bg-white/[0.06] hover:text-white/70 transition-colors disabled:opacity-40"
            >
              − menos cenas
            </button>
            <button
              disabled={busy}
              onClick={() => onReextract('more')}
              className="px-2 py-1 rounded-md border border-white/[0.08] hover:bg-white/[0.06] hover:text-white/70 transition-colors disabled:opacity-40"
            >
              + mais cenas
            </button>
          </div>
          <div className="flex items-center gap-2 text-white/40">
            <button onClick={() => setSelected(new Set(allFrames.map(f => f.index)))} className="hover:text-white/70 transition-colors">Todas</button>
            <span className="text-white/15">·</span>
            <button onClick={() => setSelected(new Set())} className="hover:text-white/70 transition-colors">Nenhuma</button>
          </div>
        </div>

        {/* Grade de quadros */}
        <div className="relative overflow-y-auto p-4" data-scrollable>
          {busy && (
            <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: 'rgba(13,13,15,0.7)' }}>
              <div className="flex items-center gap-2 text-white/60 text-[12px]">
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
                  <path d="M12 3a9 9 0 0 1 9 9" stroke="#F97316" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Re-extraindo…
              </div>
            </div>
          )}
          <div className="grid grid-cols-4 gap-2.5">
            {allFrames.map(f => {
              const on = selected.has(f.index)
              const manual = f.index >= 1_000_000
              return (
                <button
                  key={f.framePath}
                  onClick={() => toggle(f.index)}
                  className="relative rounded-lg overflow-hidden transition-transform hover:scale-[1.02]"
                  style={{
                    border: on ? '2px solid #F97316' : '2px solid rgba(255,255,255,0.08)',
                    aspectRatio: '16 / 10',
                    background: '#000',
                  }}
                >
                  <img
                    src={`file://${f.framePath}`}
                    className="w-full h-full object-cover"
                    style={{ opacity: on ? 1 : 0.4 }}
                    draggable={false}
                  />
                  <span className="absolute bottom-1 left-1 text-[9px] px-1 rounded bg-black/70 text-white/70">{fmt(f.timestamp)}</span>
                  {manual && (
                    <span className="absolute top-1 left-1 text-[8px] font-semibold px-1 rounded bg-black/70 text-orange-300/90 uppercase tracking-wide">manual</span>
                  )}
                  {on && (
                    <span className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px]" style={{ background: '#F97316' }}>✓</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-white/[0.06]">
          <div className="text-[11px] text-white/40">
            {selected.size} selecionada{selected.size === 1 ? '' : 's'} · cada uma será analisada pela IA
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onCancel} className="px-3.5 py-2 rounded-xl text-[12px] text-white/50 hover:text-white/80 transition-colors">Cancelar</button>
            <button
              disabled={selected.size === 0 || busy}
              onClick={() => onConfirm(selectedPaths)}
              className="px-4 py-2 rounded-xl text-[12px] font-medium text-white transition-opacity disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #8f0e2e, #F97316)' }}
            >
              Adicionar {selected.size} ao canvas
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
