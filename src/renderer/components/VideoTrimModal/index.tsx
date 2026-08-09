import { useEffect, useRef, useState } from 'react'

const fmt = (t: number) => {
  if (!isFinite(t) || t < 0) t = 0
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// Mini-editor de vídeo: o usuário escolhe o INÍCIO e o FIM (trim) antes de extrair
// as cenas. Player + linha do tempo com dois marcadores arrastáveis e um cabeçote.
export default function VideoTrimModal({
  videoPath, videoName, onConfirm, onCancel,
}: {
  videoPath: string
  videoName: string
  onConfirm: (start: number, end: number) => void
  onCancel: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [playing, setPlaying] = useState(false)
  const dragRef = useRef<'start' | 'end' | 'seek' | null>(null)

  // Metadados carregados → define duração e o fim = duração total.
  const onLoaded = () => {
    const d = videoRef.current?.duration ?? 0
    setDuration(d); setEnd(d)
  }

  // Durante a reprodução, pausa ao chegar no fim marcado (fica dentro do trecho).
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => {
      // Durante o arraste, a agulha segue o valor otimista — ignorar o timeupdate
      // (que dispara com posições intermediárias do seek) evita o flicker.
      if (dragRef.current) return
      setCurrent(v.currentTime)
      if (v.currentTime >= end && end > 0) { v.pause() }
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onSeeked = () => {
      seekingRef.current = false
      if (pendingRef.current != null) { const p = pendingRef.current; pendingRef.current = null; seekingRef.current = true; v.currentTime = p }
    }
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('seeked', onSeeked)
    return () => { v.removeEventListener('timeupdate', onTime); v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause); v.removeEventListener('seeked', onSeeked) }
  }, [end])

  // Seek coalescido: só UMA busca em andamento por vez; movimentos rápidos guardam o
  // alvo mais recente e disparam quando a anterior termina (evita o backlog que atrasa).
  // A agulha/labels atualizam na hora (otimista), mesmo que o frame decodifique depois.
  const seekingRef = useRef(false)
  const pendingRef = useRef<number | null>(null)
  const seek = (t: number) => {
    const v = videoRef.current
    if (!v) return
    const time = Math.max(0, Math.min(v.duration || duration || 0, t))
    setCurrent(time)
    if (seekingRef.current) { pendingRef.current = time; return }
    seekingRef.current = true
    v.currentTime = time
  }

  const togglePlay = () => {
    const v = videoRef.current; if (!v) return
    if (v.paused) { if (v.currentTime < start || v.currentTime >= end) v.currentTime = start; v.play() }
    else v.pause()
  }

  // Converte a posição X do mouse na trilha → tempo em segundos.
  const timeFromX = (clientX: number) => {
    const el = trackRef.current; if (!el || duration <= 0) return 0
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration
  }

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return
      const t = timeFromX(e.clientX)
      // Ao arrastar um marcador, o vídeo busca aquele ponto (mostra o frame) — igual à agulha.
      if (dragRef.current === 'start') { const nt = Math.min(t, end - 0.1); setStart(nt); seek(nt) }
      else if (dragRef.current === 'end') { const nt = Math.max(t, start + 0.1); setEnd(nt); seek(nt) }
      else if (dragRef.current === 'seek') seek(t)
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, start, end])

  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={onCancel}
    >
      <div
        className="w-[760px] max-w-[92vw] rounded-2xl overflow-hidden flex flex-col"
        style={{ background: '#0d0d0f', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-white/85">Cortar duração do vídeo</div>
            <div className="text-[11px] text-white/35 truncate">{videoName} · selecione o início e o fim</div>
          </div>
          <button onClick={onCancel} className="text-white/30 hover:text-white/60 transition-colors text-lg shrink-0 cursor-pointer">✕</button>
        </div>

        {/* Player */}
        <div className="px-5 pt-4 flex items-center justify-center" style={{ background: '#000' }}>
          <video
            ref={videoRef}
            src={`file://${videoPath}`}
            onLoadedMetadata={onLoaded}
            onClick={togglePlay}
            className="max-h-[46vh] rounded-lg cursor-pointer"
            style={{ maxWidth: '100%' }}
          />
        </div>

        {/* Controles + tempo */}
        <div className="flex items-center gap-3 px-5 pt-3 text-[12px] text-white/60">
          <button onClick={togglePlay} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.06] hover:bg-white/[0.12] transition-colors cursor-pointer">
            {playing ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7z"/></svg>
            )}
          </button>
          <span className="tabular-nums">{fmt(current)} / {fmt(duration)}</span>
          <div className="ml-auto flex items-center gap-2 text-[11px]">
            <button onClick={() => setStart(Math.min(current, end - 0.1))} className="px-2 py-1 rounded-md border border-white/[0.08] hover:bg-white/[0.06] hover:text-white/80 transition-colors cursor-pointer">Início aqui</button>
            <button onClick={() => setEnd(Math.max(current, start + 0.1))} className="px-2 py-1 rounded-md border border-white/[0.08] hover:bg-white/[0.06] hover:text-white/80 transition-colors cursor-pointer">Fim aqui</button>
          </div>
        </div>

        {/* Linha do tempo com marcadores */}
        <div className="px-5 pt-3 pb-1">
          <div
            ref={trackRef}
            className="relative h-9 rounded-lg select-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)' }}
            onPointerDown={e => { dragRef.current = 'seek'; seek(timeFromX(e.clientX)) }}
          >
            {/* trecho selecionado */}
            <div className="absolute top-0 bottom-0 rounded-md pointer-events-none" style={{ left: `${pct(start)}%`, width: `${pct(end - start)}%`, background: 'rgba(249,115,22,0.18)', border: '1px solid rgba(249,115,22,0.4)' }} />
            {/* cabeçote (playhead) */}
            <div className="absolute top-0 bottom-0 w-0.5 bg-white/70 pointer-events-none" style={{ left: `${pct(current)}%` }} />
            {/* marcador início */}
            <div
              className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize flex items-center justify-center"
              style={{ left: `${pct(start)}%` }}
              onPointerDown={e => { e.stopPropagation(); dragRef.current = 'start'; seek(start) }}
            >
              <div className="w-1.5 h-6 rounded-full" style={{ background: '#F97316' }} />
            </div>
            {/* marcador fim */}
            <div
              className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize flex items-center justify-center"
              style={{ left: `${pct(end)}%` }}
              onPointerDown={e => { e.stopPropagation(); dragRef.current = 'end'; seek(end) }}
            >
              <div className="w-1.5 h-6 rounded-full" style={{ background: '#F97316' }} />
            </div>
          </div>
          <div className="flex items-center justify-between mt-1.5 text-[10px] text-white/35 tabular-nums">
            <span>início <span className="text-orange-400/80">{fmt(start)}</span></span>
            <span>duração selecionada <span className="text-white/60">{fmt(Math.max(0, end - start))}</span></span>
            <span>fim <span className="text-orange-400/80">{fmt(end)}</span></span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-white/[0.06]">
          <button onClick={onCancel} className="px-3.5 py-2 rounded-xl text-[12px] text-white/50 hover:text-white/80 transition-colors cursor-pointer">Cancelar</button>
          <button
            disabled={duration <= 0 || end - start < 0.2}
            onClick={() => onConfirm(start, end)}
            className="px-4 py-2 rounded-xl text-[12px] font-medium text-white transition-opacity disabled:opacity-40 cursor-pointer"
            style={{ background: 'linear-gradient(135deg, #8f0e2e, #F97316)' }}
          >
            Extrair cenas do trecho
          </button>
        </div>
      </div>
    </div>
  )
}
