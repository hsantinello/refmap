import { Fragment, useState, useRef, useEffect, forwardRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import {
  DndContext,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { usePromptStore, useCanvasStore, WEIGHT_STEP, type PromptTag } from '../../store'
import { recordDuration, getEstimateSeconds } from '../../lib/estimate'
import { ensureWhisper, transcribeLocal, isWhisperReady } from '../../lib/localWhisper'

// hasCloudKey = há transcrição na nuvem disponível (Whisper OpenAI/Together). Sem isso
// (ex.: provedor ativo = Claude, que não transcreve), cai no Whisper local, gratuito.
function MicButton({ onTranscript, hasCloudKey }: { onTranscript: (text: string) => void; hasCloudKey: boolean }) {
  const [state, setState] = useState<'idle' | 'recording' | 'downloading' | 'transcribing' | 'error'>('idle')
  const [dlPercent, setDlPercent] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const toggleRef = useRef<() => void>(() => {}) // aponta pro toggle atual (p/ atalho Ctrl+D)

  const stopVisualizer = () => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    analyserRef.current = null
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null }
  }

  // Desenha uma waveform ao vivo (amplitude no tempo) a partir do stream do mic.
  const startVisualizer = (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext
        || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const audioCtx = new AudioCtx()
      audioCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.6
      source.connect(analyser)
      analyserRef.current = analyser

      const buffer = new Uint8Array(analyser.fftSize)
      const BARS = 28

      const draw = () => {
        rafRef.current = requestAnimationFrame(draw)
        const canvas = canvasRef.current
        const a = analyserRef.current
        if (!canvas || !a) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const dpr = window.devicePixelRatio || 1
        const cssW = canvas.clientWidth, cssH = canvas.clientHeight
        if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
          canvas.width = cssW * dpr
          canvas.height = cssH * dpr
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, cssW, cssH)

        a.getByteTimeDomainData(buffer)
        const step = Math.floor(buffer.length / BARS)
        const gap = cssW / BARS
        const barW = Math.max(2, gap * 0.5)
        for (let i = 0; i < BARS; i++) {
          let peak = 0
          for (let j = 0; j < step; j++) {
            const v = Math.abs(buffer[i * step + j] - 128) / 128
            if (v > peak) peak = v
          }
          const barH = Math.max(2, peak * cssH * 0.95)
          const x = i * gap + (gap - barW) / 2
          const y = (cssH - barH) / 2
          ctx.fillStyle = `rgba(249, 115, 22, ${0.4 + peak * 0.6})`
          ctx.beginPath()
          ctx.roundRect(x, y, barW, barH, barW / 2)
          ctx.fill()
        }
      }
      draw()
    } catch {
      // visualização é best-effort; ignora falhas (não impede a gravação)
    }
  }

  // Garante limpeza se o componente desmontar no meio de uma gravação.
  useEffect(() => () => {
    stopVisualizer()
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  // Atalho global Ctrl+D (ou ⌘+D): liga/desliga o microfone pra ditar. Captura no
  // topo (capture: true) pra funcionar mesmo com o cursor dentro do campo de texto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        e.stopPropagation()
        toggleRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const showError = (msg: string) => {
    setErrorMsg(msg)
    setState('error')
    setTimeout(() => setState('idle'), 7000)
  }

  const toggle = async () => {
    if (state === 'transcribing' || state === 'downloading' || state === 'error') return

    if (state === 'recording') {
      recorderRef.current?.stop()
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      startVisualizer(stream)

      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stopVisualizer()
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
        try {
          if (hasCloudKey) {
            // Nuvem: Whisper da OpenAI/Together (rápido).
            setState('transcribing')
            const buffer = await blob.arrayBuffer()
            const text = await window.api.transcribeAudio(new Uint8Array(buffer))
            if (text?.trim()) onTranscript(text.trim())
          } else {
            // Local: Whisper no próprio app (grátis, roda num worker → não trava a UI).
            // Baixa o modelo na 1ª vez (whisper-small, ~250MB).
            if (!isWhisperReady()) { setDlPercent(0); setState('downloading') }
            await ensureWhisper(p => {
              if (p.status === 'progress' && typeof p.progress === 'number') setDlPercent(Math.round(p.progress))
            })
            setState('transcribing')
            const text = await transcribeLocal(blob)
            if (text?.trim()) onTranscript(text.trim())
          }
          setState('idle')
        } catch (err) {
          console.error('[transcrição] erro:', err)
          const msg = String((err as Error)?.message || err)
          if (msg.includes('NO_OPENAI_KEY')) showError('Chave API não configurada')
          else if (!hasCloudKey) showError(`Local: ${msg.slice(0, 140)}`)
          else showError('Erro ao transcrever')
        }
      }
      recorder.start()
      recorderRef.current = recorder
      setState('recording')
    } catch {
      showError('Sem acesso ao microfone')
    }
  }
  toggleRef.current = toggle // mantém o atalho Ctrl+D chamando o toggle mais recente

  const label = state === 'recording' ? 'Parar gravação (Ctrl+D)'
    : state === 'downloading' ? `Baixando modelo de voz… ${dlPercent}%`
    : state === 'transcribing' ? 'Transcrevendo...'
    : state === 'error' ? errorMsg
    : hasCloudKey ? 'Ditar prompt (Ctrl+D)' : 'Ditar prompt · voz local grátis (Ctrl+D)'

  const bgClass = state === 'recording' ? 'bg-red-500/20'
    : state === 'downloading' || state === 'transcribing' ? 'bg-orange-500/15'
    : state === 'error' ? 'bg-red-500/10'
    : 'hover:bg-white/[0.07]'

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        title={label}
        disabled={state === 'transcribing' || state === 'downloading'}
        className={`p-2.5 rounded-lg transition-all ${bgClass}`}
      >
        {state === 'recording' ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <rect x="6" y="6" width="12" height="12" rx="2" fill="#ef4444" opacity="0.8"/>
          </svg>
        ) : state === 'downloading' || state === 'transcribing' ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" className="animate-spin">
            <circle cx="12" cy="12" r="9" stroke="rgba(249,115,22,0.3)" strokeWidth="2"/>
            <path d="M12 3a9 9 0 019 9" stroke="#f97316" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        ) : state === 'error' ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="#ef4444" strokeWidth="1.8" opacity="0.7"/>
            <path d="M12 8v5M12 16v1" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" opacity="0.7"/>
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="2" width="6" height="12" rx="3" stroke="rgba(255,255,255,0.4)" strokeWidth="1.8"/>
            <path d="M5 11a7 7 0 0014 0" stroke="rgba(255,255,255,0.4)" strokeWidth="1.8" strokeLinecap="round"/>
            <path d="M12 18v4M9 22h6" stroke="rgba(255,255,255,0.4)" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        )}
      </button>
      {state === 'recording' && (
        <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-black/85 border border-white/10 shadow-[0_12px_32px_rgba(0,0,0,0.6)] pointer-events-none backdrop-blur-md">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
          <canvas ref={canvasRef} width={120} height={26} style={{ width: 120, height: 26 }} />
        </div>
      )}
      {state === 'downloading' && (
        <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-black/85 border border-white/10 shadow-[0_12px_32px_rgba(0,0,0,0.6)] pointer-events-none backdrop-blur-md">
          <span className="text-[11px] text-white/70 whitespace-nowrap">Baixando voz local</span>
          <div className="w-16 h-1 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${dlPercent}%` }} />
          </div>
          <span className="text-[11px] text-white/50 tabular-nums w-8 text-right">{dlPercent}%</span>
        </div>
      )}
      {state === 'error' && (
        <div className="absolute bottom-full mb-2 right-0 w-56 px-2.5 py-1.5 rounded-lg text-[11px] leading-snug text-red-400 bg-red-500/10 border border-red-500/20 pointer-events-none break-words">
          {errorMsg}
        </div>
      )}
    </div>
  )
}

function InsertZone({ index, activeIndex, onActivate, onCommit, onCancel }: {
  index: number
  activeIndex: number | null
  onActivate: (i: number) => void
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const active = activeIndex === index

  if (active) {
    return (
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { onCommit(value); setValue('') }
          if (e.key === 'Escape') { onCancel(); setValue('') }
          e.stopPropagation()
        }}
        onBlur={() => { value.trim() ? onCommit(value) : onCancel(); setValue('') }}
        onPointerDown={e => e.stopPropagation()}
        className="bg-transparent text-[12px] text-white/70 outline-none self-center"
        style={{ width: `${Math.max(50, value.length * 7 + 20)}px` }}
      />
    )
  }

  return (
    <div
      data-insert-zone={index}
      className="self-stretch cursor-text"
      style={{ width: '12px', margin: '0 -4px', position: 'relative', zIndex: 5 }}
      onMouseDown={e => { e.preventDefault(); onActivate(index) }}
    />
  )
}

function SortableChip({ tag }: { tag: PromptTag }) {
  const store = usePromptStore()
  const removeTag = store.removeTag
  const updateTagText = store.updateTagText
  const setTagWeight = store.setTagWeight
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: tag.id })
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(tag.value)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    zIndex: isDragging ? 20 : undefined,
  }

  const commitEdit = () => {
    const trimmed = editValue.trim()
    if (trimmed) updateTagText(tag.id, trimmed)
    setEditing(false)
  }

  const weight = tag.weight ?? 1
  const showWeight = Math.abs(weight - 1) > 0.001
  const wStr = String(Math.round(weight * 10) / 10)
  const bump = (d: number) => setTagWeight(tag.id, weight + d)

  return (
    <div
      ref={setNodeRef}
      data-chip
      style={style}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); window.dispatchEvent(new CustomEvent('save-to-my-presets', { detail: { value: tag.value } })) }}
      className={`rm-builder-chip group ${isDragging ? 'opacity-45 shadow-xl' : ''}`}
      {...attributes}
      {...listeners}
    >
      {editing ? (
        <input
          autoFocus
          className="bg-transparent text-[12px] outline-none px-2.5 py-1.5 min-w-[40px]"
          style={{ width: `${Math.max(60, editValue.length * 7 + 20)}px` }}
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => {
            if (e.key === 'Enter') commitEdit()
            if (e.key === 'Escape') { setEditValue(tag.value); setEditing(false) }
            e.stopPropagation()
          }}
          onPointerDown={e => e.stopPropagation()}
        />
      ) : (
        <span
          className="text-[12px] leading-none pl-2.5 py-1.5"
          onClick={e => {
            e.stopPropagation()
            setEditValue(tag.value)
            setEditing(true)
          }}
          title="Clique para editar"
        >
          {tag.value}
        </span>
      )}
      <div className="flex items-center gap-1 pl-1.5 pr-1.5 shrink-0">
        {showWeight && <span className="rm-weight-badge" title="Peso">{wStr}</span>}
        <div className="rm-weight-stepper flex flex-col opacity-0 group-hover:opacity-80 transition-opacity">
          <button
            title="Aumentar peso"
            onClick={e => { e.stopPropagation(); bump(WEIGHT_STEP) }}
            onPointerDown={e => e.stopPropagation()}
          >
            <svg width="8" height="5" viewBox="0 0 8 5" fill="none"><path d="M1 4L4 1L7 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button
            title="Diminuir peso"
            onClick={e => { e.stopPropagation(); bump(-WEIGHT_STEP) }}
            onPointerDown={e => e.stopPropagation()}
          >
            <svg width="8" height="5" viewBox="0 0 8 5" fill="none"><path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
        <button
          className="text-current opacity-0 group-hover:opacity-40 hover:!opacity-90 transition-opacity text-base leading-none -ml-0.5"
          onClick={e => { e.stopPropagation(); removeTag(tag.id) }}
          onPointerDown={e => e.stopPropagation()}
        >
          ×
        </button>
      </div>
    </div>
  )
}

// Zona de chips do prompt. É um droppable dnd-kit; o InsertZone final permite digitar.
function ChipZone({
  tags, activeInsert, setActiveInsert, onInsert,
}: {
  tags: PromptTag[]
  activeInsert: number | null
  setActiveInsert: (i: number | null) => void
  onInsert: (value: string, index: number) => void
}) {
  const { setNodeRef } = useDroppable({ id: 'zone-positive' })
  return (
    <div
      ref={setNodeRef}
      className="flex flex-wrap items-start gap-1.5 pb-2 max-h-[90px] overflow-y-auto overflow-x-hidden cursor-text"
      onMouseDown={e => {
        const target = e.target as Element
        if (target.closest('[data-chip]') || target.closest('[data-insert-zone]')) return
        e.preventDefault()
        setActiveInsert(tags.length)
      }}
    >
      <SortableContext items={tags.map(t => t.id)} strategy={rectSortingStrategy}>
        {tags.map((tag, i) => (
          <Fragment key={tag.id}>
            <InsertZone
              index={i}
              activeIndex={activeInsert}
              onActivate={setActiveInsert}
              onCommit={v => { onInsert(v, i); setActiveInsert(null) }}
              onCancel={() => setActiveInsert(null)}
            />
            <SortableChip tag={tag} />
          </Fragment>
        ))}
      </SortableContext>
      <InsertZone
        index={tags.length}
        activeIndex={activeInsert}
        onActivate={setActiveInsert}
        onCommit={v => { onInsert(v, tags.length); setActiveInsert(null) }}
        onCancel={() => setActiveInsert(null)}
      />
    </div>
  )
}

function getCaretIndexInTextarea(textarea: HTMLTextAreaElement, clientX: number, clientY: number): number {
  const text = textarea.value
  if (!text) return 0

  const cs = window.getComputedStyle(textarea)
  const rect = textarea.getBoundingClientRect()
  const bTop = parseFloat(cs.borderTopWidth) || 0
  const bLeft = parseFloat(cs.borderLeftWidth) || 0

  const mirror = document.createElement('div')
  Object.assign(mirror.style, {
    position: 'fixed',
    // Alinha ao box de conteúdo do textarea e compensa o scroll. clientWidth já
    // exclui a BORDA e a BARRA DE ROLAGEM — sem isso o espelho fica mais largo,
    // quebra as linhas em pontos diferentes e o mapeamento sai ~1 linha deslocado.
    top: (rect.top + bTop - textarea.scrollTop) + 'px',
    left: (rect.left + bLeft - textarea.scrollLeft) + 'px',
    width: textarea.clientWidth + 'px',
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing,
    paddingTop: cs.paddingTop,
    paddingBottom: cs.paddingBottom,
    paddingLeft: cs.paddingLeft,
    paddingRight: cs.paddingRight,
    // Copia a quebra de linha EXATA do textarea pra o espelho quebrar igual.
    whiteSpace: cs.whiteSpace === 'normal' ? 'pre-wrap' : cs.whiteSpace,
    wordBreak: cs.wordBreak,
    overflowWrap: cs.overflowWrap,
    overflowX: 'hidden',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '2147483647',
    boxSizing: 'border-box',
  })

  for (let i = 0; i < text.length; i++) {
    const span = document.createElement('span')
    span.textContent = text[i] // espaço já tem largura com pre-wrap; sem NBSP p/ não somar erro
    mirror.appendChild(span)
  }

  document.body.appendChild(mirror)

  // Em vez de exigir acerto exato num caractere (elementFromPoint), acha o
  // caractere MAIS PRÓXIMO do ponto solto: prioriza fortemente a linha certa
  // (distância vertical) e, dentro dela, decide antes/depois pelo centro do
  // caractere no eixo X. Assim soltar em espaço vazio / fim de linha / margem
  // insere onde faz sentido visualmente, não sempre no fim.
  const spans = Array.from(mirror.children) as HTMLSpanElement[]
  let index = text.length
  let bestDist = Infinity
  for (let i = 0; i < spans.length; i++) {
    const r = spans[i].getBoundingClientRect()
    const dy = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0
    const cx = r.left + r.width / 2
    const dx = Math.abs(clientX - cx)
    const dist = dy * 10000 + dx // linha domina; X desempata dentro da linha
    if (dist < bestDist) {
      bestDist = dist
      index = clientX > cx ? i + 1 : i
    }
  }

  document.body.removeChild(mirror)
  return index
}

function getCaretPixelPosition(textarea: HTMLTextAreaElement, index: number): { left: number; top: number; height: number } {
  const cs = window.getComputedStyle(textarea)
  const rect = textarea.getBoundingClientRect()
  const text = textarea.value
  const bTop = parseFloat(cs.borderTopWidth) || 0
  const bLeft = parseFloat(cs.borderLeftWidth) || 0

  const mirror = document.createElement('div')
  Object.assign(mirror.style, {
    position: 'fixed',
    // Mesmo box de conteúdo / clientWidth de getCaretIndexInTextarea, pra o preview
    // do caret bater exatamente com o ponto de inserção calculado no drop.
    top: (rect.top + bTop - textarea.scrollTop) + 'px',
    left: (rect.left + bLeft - textarea.scrollLeft) + 'px',
    width: textarea.clientWidth + 'px',
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing,
    paddingTop: cs.paddingTop,
    paddingBottom: cs.paddingBottom,
    paddingLeft: cs.paddingLeft,
    paddingRight: cs.paddingRight,
    whiteSpace: cs.whiteSpace === 'normal' ? 'pre-wrap' : cs.whiteSpace,
    wordBreak: cs.wordBreak,
    overflowWrap: cs.overflowWrap,
    overflowX: 'hidden',
    visibility: 'hidden',
    zIndex: '2147483647',
    boxSizing: 'border-box',
  })

  const before = document.createElement('span')
  before.textContent = text.slice(0, index) || '​'
  const sentinel = document.createElement('span')
  sentinel.textContent = '​'
  const after = document.createElement('span')
  after.textContent = text.slice(index)

  mirror.appendChild(before)
  mirror.appendChild(sentinel)
  mirror.appendChild(after)
  document.body.appendChild(mirror)

  const sr = sentinel.getBoundingClientRect()
  document.body.removeChild(mirror)

  return {
    left: sr.left - rect.left,
    top: sr.top - rect.top,
    height: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5,
  }
}

const DroppableTextarea = forwardRef<HTMLTextAreaElement, {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder: string
}>(function DroppableTextarea({ value, onChange, onKeyDown, placeholder }, forwardedRef) {
  const { setNodeRef, isOver } = useDroppable({ id: 'textarea-drop' })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [cursorStyle, setCursorStyle] = useState<{ left: number; top: number; height: number } | null>(null)

  const mergedRef = (el: HTMLTextAreaElement | null) => {
    (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
    if (typeof forwardedRef === 'function') forwardedRef(el)
    else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
  }

  useEffect(() => {
    if (!isOver) { setCursorStyle(null); return }
    const textarea = textareaRef.current
    if (!textarea) return

    let rafId: number | null = null
    const update = (e: PointerEvent) => {
      const { clientX, clientY } = e
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const index = getCaretIndexInTextarea(textarea, clientX, clientY)
        setCursorStyle(getCaretPixelPosition(textarea, index))
        rafId = null
      })
    }
    document.addEventListener('pointermove', update)
    return () => {
      document.removeEventListener('pointermove', update)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [isOver])

  return (
    <div ref={setNodeRef} className="relative rounded-md">
      <textarea
        ref={mergedRef}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={1}
        className="bg-transparent text-[15px] text-white/70 placeholder-white/15 outline-none w-full resize-none overflow-y-auto pb-2"
        style={{ lineHeight: '1.5', maxHeight: '90px' }}
      />
      {isOver && cursorStyle && (
        <div
          className="pointer-events-none absolute rounded-sm"
          style={{
            left: cursorStyle.left,
            top: cursorStyle.top,
            height: cursorStyle.height,
            width: 2,
            background: 'rgba(249, 115, 22, 0.85)',
          }}
        />
      )}
    </div>
  )
})

const MODEL_GROUPS = [
  {
    group: 'Imagem',
    models: [
      { id: 'boogu',              label: 'Boogu' },
      { id: 'flux',               label: 'Flux',            nsfw: true },
      { id: 'flux2-klein',        label: 'Flux 2 [klein]',  nsfw: true },
      { id: 'gpt-image-2',        label: 'GPT Image 2' },
      { id: 'grok',               label: 'Grok' },
      { id: 'hidream',            label: 'HiDream',         nsfw: true },
      { id: 'krea-2',             label: 'Krea 2' },
      { id: 'midjourney',         label: 'Midjourney' },
      { id: 'nano-banana',        label: 'Nano Banana' },
      { id: 'qwen-image-2512',    label: 'Qwen Image 2512', nsfw: true },
      { id: 'stable-diffusion',   label: 'Stable Diffusion', nsfw: true },
      { id: 'zimage',             label: 'ZImage',          nsfw: true },
    ],
  },
  {
    group: 'Vídeo',
    models: [
      { id: 'gemini-omni',  label: 'Gemini Omni' },
      { id: 'hailuo',      label: 'Hailuo Minimax' },
      { id: 'hunyuan',     label: 'HunYuan Video',     nsfw: true },
      { id: 'kling-3',     label: 'Kling 3.0' },
      { id: 'ltx-2',       label: 'LTX 2.3',           nsfw: true },
      { id: 'luma',        label: 'Luma Dream Machine' },
      { id: 'minimax-h3',  label: 'MiniMax H3',        nsfw: true },
      { id: 'pika',        label: 'Pika' },
      { id: 'pixverse',    label: 'PixVerse' },
      { id: 'runway-gen4', label: 'Runway Gen-4' },
      { id: 'seedance',    label: 'Seedance 2.5' },
      { id: 'sora-2',      label: 'Sora 2' },
      { id: 'veo3',        label: 'Veo 3' },
      { id: 'wan',         label: 'Wan 2.2',            nsfw: true },
    ],
  },
]
// Flat list for label lookup
const MODELS = MODEL_GROUPS.flatMap(g => g.models)
const modelLabel = (id?: string) => id ? (MODELS.find(m => m.id === id)?.label ?? id) : undefined

// `source` = prompt original que deu origem ao otimizado (para restaurar).
type HistoryEntry = { text: string; model?: string; source?: string }

export default function PromptBuilder() {
  const {
    promptTags, reorderTags, clearAll, getPromptString, insertTagAt, removeTag, updateTagText,
  } = usePromptStore()
  const dragPointerRef = useRef({ x: 0, y: 0 })
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const [insertIndex, setInsertIndex] = useState<number | null>(null)
  const [copied, setCopied]           = useState(false)
  const [history, setHistory]         = useState<HistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [hoverHistory, setHoverHistory] = useState<{ idx: number; left: number; bottom: number } | null>(null)
  const historyHideRef = useRef<number | null>(null)
  const cancelHistoryHide = () => { if (historyHideRef.current) { clearTimeout(historyHideRef.current); historyHideRef.current = null } }
  const scheduleHistoryHide = () => { cancelHistoryHide(); historyHideRef.current = window.setTimeout(() => setHoverHistory(null), 150) }
  const currentCanvasId = useCanvasStore(s => s.currentCanvasId)

  useEffect(() => {
    const checkKey = async () => {
      const provider = ((await window.api.getSetting('aiProvider')) ?? 'anthropic') as string
      const activeKey = await window.api.getApiKey(provider)
      // Transcrição na nuvem só quando o PROVEDOR ATIVO transcreve (OpenAI Whisper ou
      // Together via chave tgp_). Com Claude ativo (não transcreve) cai no Whisper local.
      const canTranscribe = !!(activeKey?.trim() && (activeKey.startsWith('tgp_') || provider === 'openai'))
      setHasOpenAIKey(canTranscribe)
    }
    checkKey()
    window.addEventListener('apikey-changed', checkKey)
    return () => window.removeEventListener('apikey-changed', checkKey)
  }, [])

  // Load history for current canvas
  useEffect(() => {
    if (!currentCanvasId) return
    window.api.getSetting(`promptHistory_${currentCanvasId}`).then(raw => {
      if (!raw) { setHistory([]); return }
      try {
        const parsed = JSON.parse(raw)
        // Compat: entradas antigas eram strings; novas são { text, model }.
        const normalized: HistoryEntry[] = Array.isArray(parsed)
          ? parsed.map((e: unknown) => typeof e === 'string'
              ? { text: e }
              : { text: (e as HistoryEntry).text, model: (e as HistoryEntry).model, source: (e as HistoryEntry).source })
          : []
        setHistory(normalized)
      } catch { setHistory([]) }
    })
  }, [currentCanvasId])
  const [hasOpenAIKey, setHasOpenAIKey] = useState(false)
  const [inputText, setInputText] = useState('')
  const [targetModel, setTargetModel] = useState<string | null>(null)
  const [showModels, setShowModels] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [optElapsed, setOptElapsed] = useState(0)          // segundos decorridos
  const [optEstimate, setOptEstimate] = useState<number | null>(null) // estimativa (s)
  const optTimerRef = useRef<ReturnType<typeof setInterval>>(undefined)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)
  // Falta de configuração ao otimizar (sem chave e IA local indisponível) →
  // mostramos um botão-CTA com a orientação certa, em vez do erro cru do IPC.
  // null = tudo ok; string = mensagem a exibir no CTA (clicável → Settings).
  const [setupHint, setSetupHint] = useState<string | null>(null)
  const [translatingPrompt, setTranslatingPrompt] = useState(false)
  const [promptTranslated, setPromptTranslated] = useState(false)
  const preTranslateRef = useRef<{ tags: { id: string; value: string }[]; input: string } | null>(null)
  const [dropdownPos, setDropdownPos] = useState({ x: 0, y: 0 })
  const modelRef = useRef<HTMLDivElement>(null)
  const modelBtnRef = useRef<HTMLButtonElement>(null)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const textInputRef = useRef<HTMLTextAreaElement>(null)
  const pendingModelRef = useRef<string | null>(null)
  const handleSelectModelRef = useRef<((id: string) => Promise<void>) | null>(null)

  useEffect(() => {
    const el = textInputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 90) + 'px'
  }, [inputText])

  useEffect(() => {
    if (!showModels) return
    const handler = (e: MouseEvent) => {
      const inTrigger = modelRef.current?.contains(e.target as Node)
      const inDropdown = modelDropdownRef.current?.contains(e.target as Node)
      if (!inTrigger && !inDropdown) setShowModels(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModels])

  useEffect(() => {
    const handler = () => {
      setSetupHint(null)
      const modelId = pendingModelRef.current
      if (!modelId) return
      pendingModelRef.current = null
      handleSelectModelRef.current?.(modelId)
    }
    window.addEventListener('apikey-changed', handler)
    return () => window.removeEventListener('apikey-changed', handler)
  }, [])

  // Recebe um prompt gerado externamente (ex.: prompt de animação de 2 imagens) → joga no input.
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text
      if (text) { setInputText(text); setPromptTranslated(false); preTranslateRef.current = null }
    }
    window.addEventListener('set-prompt-text', handler as EventListener)
    return () => window.removeEventListener('set-prompt-text', handler as EventListener)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const handleDragStart = () => {
    const track = (e: PointerEvent) => { dragPointerRef.current = { x: e.clientX, y: e.clientY } }
    document.addEventListener('pointermove', track)
    dragCleanupRef.current = () => document.removeEventListener('pointermove', track)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    dragCleanupRef.current?.()
    dragCleanupRef.current = null

    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)

    // Soltar no textarea → o chip vira texto livre
    if (overId === 'textarea-drop') {
      const tag = promptTags.find(t => t.id === activeId)
      if (!tag || !textInputRef.current) return
      const { x, y } = dragPointerRef.current
      const pos = getCaretIndexInTextarea(textInputRef.current, x, y)
      const before = inputText.slice(0, pos)
      const after = inputText.slice(pos)
      const sep1 = before && !before.match(/[,\s]$/) ? ', ' : ''
      const sep2 = after && !after.match(/^[,\s]/) ? ', ' : ''
      setInputText(before + sep1 + tag.value + sep2 + after)
      removeTag(activeId)
      return
    }

    // Reordenar dentro do prompt
    if (activeId === overId) return
    const from = promptTags.findIndex(t => t.id === activeId)
    const to = promptTags.findIndex(t => t.id === overId)
    if (from >= 0 && to >= 0) reorderTags(from, to)
  }

  const handleCopy = () => {
    const text = [getPromptString(), inputText.trim()].filter(Boolean).join(', ')
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    // Save to history (max 10 entries, deduplicated)
    if (currentCanvasId) {
      const newHistory: HistoryEntry[] = [{ text }, ...history.filter(h => h.text !== text)].slice(0, 10)
      setHistory(newHistory)
      window.api.setSetting(`promptHistory_${currentCanvasId}`, JSON.stringify(newHistory))
    }
  }

  const handleClearAll = () => {
    clearAll()
    setInputText('')
    setPromptTranslated(false)
    preTranslateRef.current = null
    setSetupHint(null)
    setOptimizeError(null)
  }

  const handleTranslatePrompt = async () => {
    if (translatingPrompt) return

    // Já traduzido → reverte para os valores originais guardados.
    if (promptTranslated) {
      const orig = preTranslateRef.current
      if (orig) {
        orig.tags.forEach(t => updateTagText(t.id, t.value))
        setInputText(orig.input)
      }
      setPromptTranslated(false)
      preTranslateRef.current = null
      return
    }

    const inputTrim = inputText.trim()
    const values = promptTags.map(t => t.value)
    if (inputTrim) values.push(inputTrim)
    if (values.length === 0) return

    setTranslatingPrompt(true)
    try {
      const translated = await window.api.translateTags(values, 'pt')
      // Guarda originais para conseguir voltar ao inglês.
      preTranslateRef.current = {
        tags: promptTags.map(t => ({ id: t.id, value: t.value })),
        input: inputText,
      }
      promptTags.forEach((t, i) => { if (translated[i]) updateTagText(t.id, translated[i]) })
      if (inputTrim) {
        const ti = translated[promptTags.length]
        if (ti) setInputText(ti)
      }
      setPromptTranslated(true)
    } catch (err) {
      console.error('[translate-prompt]', err)
    } finally {
      setTranslatingPrompt(false)
    }
  }

  const handleSelectModel = async (modelId: string) => {
    if (targetModel === modelId) { setTargetModel(null); setShowModels(false); return }
    setTargetModel(modelId)
    setShowModels(false)

    const parts = [getPromptString(), inputText.trim()].filter(Boolean)
    const currentPrompt = parts.join(', ')
    if (!currentPrompt) {
      setOptimizeError('Adicione conteúdo ao prompt primeiro')
      setTimeout(() => setOptimizeError(null), 4000)
      return
    }

    setOptimizing(true)
    setOptimizeError(null)
    setSetupHint(null)
    // Cronômetro + estimativa adaptativa (média das últimas otimizações).
    const startedAt = Date.now()
    setOptElapsed(0)
    setOptEstimate(null)
    getEstimateSeconds('optimize').then(setOptEstimate).catch(() => {})
    clearInterval(optTimerRef.current)
    optTimerRef.current = setInterval(() => setOptElapsed(Math.round((Date.now() - startedAt) / 1000)), 500)
    try {
      const optimized = await window.api.optimizePrompt(currentPrompt, modelId)
      recordDuration('optimize', Date.now() - startedAt) // alimenta a estimativa
      // Só o positivo interessa. Descarta qualquer bloco após ---NEGATIVE--- que
      // algum modelo ainda devolva (defesa contra resíduo do prompt do modelo).
      const [positive] = optimized.split('---NEGATIVE---')
      const text = positive.split('\n').map((l: string) => l.trim()).filter(Boolean).join('\n')
      clearAll()
      setInputText(text)
      setTargetModel(null)
      setPromptTranslated(false)
      preTranslateRef.current = null
      // Save optimized prompt to history (com o modelo e o prompt original que o gerou)
      if (currentCanvasId) {
        const newHistory: HistoryEntry[] = [{ text, model: modelId, source: currentPrompt }, ...history.filter(h => h.text !== text)].slice(0, 10)
        setHistory(newHistory)
        window.api.setSetting(`promptHistory_${currentCanvasId}`, JSON.stringify(newHistory))
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[optimize]', msg)
      // O erro cruza o IPC embrulhado ("Error invoking remote method '...': Error: X"),
      // então usamos includes(). Sem chave, o app cai na IA local (Ollama); se ela não
      // estiver rodando, vem LOCAL_AI_UNAVAILABLE → orientamos a instalar/abrir o Ollama.
      if (msg.includes('LOCAL_AI_UNAVAILABLE')) {
        pendingModelRef.current = modelId
        setTargetModel(null)
        setSetupHint('A otimização falhou, clique aqui para configurar a IA')
      } else if (msg.includes('API key not configured')) {
        pendingModelRef.current = modelId
        setTargetModel(null)
        setSetupHint('Para aprimorar um prompt configure sua API')
      } else {
        // Qualquer outra falha → CTA clicável que leva às configurações da IA
        // (o erro técnico fica no console para depuração).
        pendingModelRef.current = modelId
        setTargetModel(null)
        setSetupHint('A otimização falhou, clique aqui para configurar a IA')
      }
    } finally {
      setOptimizing(false)
      clearInterval(optTimerRef.current)
    }
  }

  handleSelectModelRef.current = handleSelectModel

  const count = promptTags.length
  const hasContent = count > 0 || inputText.trim().length > 0

  return (
    <div
      className="absolute bottom-[20px] left-1/2 -translate-x-1/2 z-20 pointer-events-none w-full max-w-[640px]"
    >
      <div className="pointer-events-auto w-full rm-panel !border-transparent">
        <div style={{ padding: '24px 24px 0' }}>

          <DndContext
            sensors={sensors}
            collisionDetection={rectIntersection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {/* Chips do prompt */}
            {count > 0 && (
              <ChipZone
                tags={promptTags}
                activeInsert={insertIndex}
                setActiveInsert={setInsertIndex}
                onInsert={(v, i) => insertTagAt(v, i)}
              />
            )}

            {/* Textarea — hidden when there are tags and no text */}
            {(!count || inputText) && (
              <DroppableTextarea
                ref={textInputRef}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => e.stopPropagation()}
                placeholder="Escrever prompt..."
              />
            )}
          </DndContext>

          {/* Ações */}
          <div className="flex justify-between items-center gap-2" style={{ paddingBottom: '14px', paddingTop: '8px' }}>
            {/* Model selector */}
            <div ref={modelRef} className="relative">
              <button
                ref={modelBtnRef}
                disabled={!hasContent && !optimizeError && !setupHint}
                onClick={() => {
                  // Problema de configuração: o botão vira CTA e leva às configurações.
                  // Some na hora ao clicar (se ainda houver problema, reaparece na próxima tentativa).
                  if (setupHint) {
                    setSetupHint(null)
                    window.dispatchEvent(new CustomEvent('open-settings'))
                    return
                  }
                  if (!showModels && modelBtnRef.current) {
                    const r = modelBtnRef.current.getBoundingClientRect()
                    setDropdownPos({ x: r.left, y: r.top })
                  }
                  setShowModels(v => !v)
                }}
                className={`flex items-center gap-1.5 text-[11px] transition-colors px-2 py-1 rounded-md ${setupHint ? 'cursor-pointer' : 'max-w-[200px] truncate'} ${
                  setupHint
                    ? 'text-red-400/90 hover:text-red-300 bg-red-500/[0.12] hover:bg-red-500/[0.20]'
                    : !hasContent && !optimizeError
                      ? 'text-white/15 cursor-not-allowed'
                      : optimizeError
                        ? 'text-red-400/70 hover:text-red-400 hover:bg-white/[0.06]'
                        : 'text-white/40 hover:text-white/70 hover:bg-white/[0.06]'
                }`}
              >
                <span>{optimizing
                  ? (optEstimate == null
                      ? `Otimizando… ${optElapsed}s`
                      : (optEstimate - optElapsed > 0 ? `Otimizando… restam ~${optEstimate - optElapsed}s` : 'Otimizando…'))
                  : setupHint ? setupHint : (optimizeError ?? (targetModel ? MODELS.find(m => m.id === targetModel)?.label : 'Otimizar para...'))}</span>
                {!setupHint && (
                  <svg width="8" height="8" viewBox="0 0 10 6" fill="none">
                    <path d={showModels ? 'M1 5L5 1L9 5' : 'M1 1L5 5L9 1'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>

              {showModels && createPortal(
                <div
                  ref={modelDropdownRef}
                  className="bg-black/95 backdrop-blur-md rounded-xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8)] py-1.5 px-1 min-w-0 w-[150px] z-[9999]"
                  style={{ position: 'fixed', left: dropdownPos.x, bottom: window.innerHeight - dropdownPos.y + 6 }}
                >
                  {targetModel && (
                    <>
                      <button
                        className="w-full text-left px-2 py-1 text-[11px] text-white/35 hover:text-white/65 hover:bg-white/[0.08] rounded-md transition-colors cursor-default select-none"
                        onClick={() => { setTargetModel(null); setShowModels(false) }}
                      >
                        Nenhum
                      </button>
                      <div className="h-px bg-white/[0.06] mx-2 my-1" />
                    </>
                  )}
                  {MODEL_GROUPS.map((grp, gi) => (
                    <div key={grp.group}>
                      {gi > 0 && <div className="h-px bg-white/[0.06] mx-2 my-1" />}
                      <div className="px-2 pt-1 pb-0.5 text-[9px] font-bold uppercase tracking-widest text-white/25">
                        {grp.group}
                      </div>
                      {grp.models.map(m => (
                        <button
                          key={m.id}
                          className={`w-full text-left px-2 py-1 text-[11px] rounded-md transition-colors cursor-default select-none flex items-center gap-1.5 ${
                            targetModel === m.id
                              ? 'text-orange-300/80 bg-orange-500/[0.12]'
                              : 'text-white/75 hover:text-white hover:bg-white/[0.08]'
                          }`}
                          onClick={() => handleSelectModel(m.id)}
                        >
                          <span className="flex-1">{m.label}</span>
                          {m.nsfw && (
                            <span className="text-[8px] font-bold px-1 py-px rounded leading-none" style={{ color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}>
                              +18
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>,
                document.body
              )}
            </div>

            <div className="flex items-center gap-2">
            <MicButton hasCloudKey={hasOpenAIKey} onTranscript={text => setInputText(prev => prev ? prev + ' ' + text : text)} />
            {hasContent && (
              <button
                onClick={handleTranslatePrompt}
                disabled={translatingPrompt}
                title={translatingPrompt ? 'Traduzindo...' : promptTranslated ? 'Voltar para inglês' : 'Traduzir prompt para português'}
                className={`text-[11px] px-2 py-0.5 rounded-md transition-colors shrink-0 inline-flex items-center gap-1 ${
                  translatingPrompt
                    ? 'text-white/30 cursor-default'
                    : promptTranslated
                      ? 'text-white/70 bg-white/[0.10] hover:bg-white/[0.14]'
                      : 'text-white/30 hover:text-white/65 hover:bg-white/[0.06]'
                }`}
              >
                {translatingPrompt && (
                  <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
                    <path d="M12 3a9 9 0 019 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                )}
                <span>{promptTranslated ? 'EN' : 'PT-BR'}</span>
              </button>
            )}
            {hasContent && (
              <button
                onClick={handleClearAll}
                className="text-[11px] text-white/30 hover:text-white/65 transition-colors px-2 py-0.5 rounded-md hover:bg-white/[0.06] shrink-0"
              >
                Limpar
              </button>
            )}
            <button
              onClick={handleCopy}
              disabled={!hasContent}
              className={`p-2.5 rounded-lg transition-all shrink-0 ${
                hasContent
                  ? copied
                    ? 'bg-emerald-600/20 hover:bg-emerald-600/30'
                    : 'hover:bg-white/[0.07]'
                  : 'opacity-25 cursor-not-allowed'
              }`}
              title={copied ? 'Copiado!' : 'Copiar prompt'}
            >
              {copied ? (
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6L9 17L4 12" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
                  <defs>
                    <linearGradient id="grad-copy" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#8f0e2e"/>
                      <stop offset="100%" stopColor="#F97316"/>
                    </linearGradient>
                  </defs>
                  <rect x="3" y="3" width="13" height="16" rx="2.5" stroke="url(#grad-copy)" strokeWidth="2"/>
                  <rect x="8" y="7" width="13" height="16" rx="2.5" fill="#0f0106" stroke="url(#grad-copy)" strokeWidth="2"/>
                </svg>
              )}
            </button>
            {/* History button */}
            {history.length > 0 && (
              <button
                onClick={() => setShowHistory(s => !s)}
                className={`p-2.5 rounded-lg transition-all shrink-0 hover:bg-white/[0.07] ${showHistory ? 'bg-white/[0.07]' : ''}`}
                title="Histórico de prompts"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.4)" strokeWidth="1.8"/>
                  <path d="M12 7v5l3 3" stroke="rgba(255,255,255,0.4)" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </button>
            )}
            </div>
          </div>

          {/* History panel */}
          <AnimatePresence initial={false}>
            {showHistory && history.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                style={{ overflow: 'hidden' }}
              >
                <div className="relative border-t border-white/[0.06] px-4 pt-3 pb-2 flex flex-col gap-1.5">
                  <span className="text-[9px] uppercase tracking-widest text-white/25 font-semibold mb-1">Histórico</span>
                  <div className="flex flex-col gap-1.5 max-h-[60px] overflow-y-auto">
                    {history.map((h, i) => (
                      <button
                        key={i}
                        onClick={() => { navigator.clipboard.writeText(h.text); setCopied(true); setTimeout(() => setCopied(false), 1500); setShowHistory(false) }}
                        onContextMenu={e => {
                          e.preventDefault()
                          if (!h.source) return
                          clearAll()
                          setInputText(h.source)
                          setTargetModel(null)
                          setPromptTranslated(false)
                          preTranslateRef.current = null
                          setShowHistory(false)
                          setHoverHistory(null)
                        }}
                        onMouseEnter={e => {
                          cancelHistoryHide()
                          const r = e.currentTarget.getBoundingClientRect()
                          const W = 300
                          // Sempre à direita; só limita pra não sair da tela.
                          const left = Math.min(r.right + 8, window.innerWidth - W - 8)
                          setHoverHistory({ idx: i, left, bottom: window.innerHeight - r.bottom })
                        }}
                        onMouseLeave={scheduleHistoryHide}
                        title={h.source ? 'Clique: copiar · Botão direito: restaurar o prompt original' : 'Clique para copiar'}
                        className="group flex items-center gap-2 text-left text-[11px] text-white/45 hover:text-white/75 hover:bg-white/[0.04] rounded-lg px-2 py-1 transition-colors shrink-0"
                      >
                        <span className="truncate flex-1 min-w-0">{h.text}</span>
                        {h.model && (
                          <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-orange-500/[0.12] text-orange-300/80 border border-orange-500/20">
                            {modelLabel(h.model)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>

      {/* Preview do prompt completo ao passar o mouse (portal — evita o clip do painel) */}
      {showHistory && hoverHistory && history[hoverHistory.idx] && createPortal(
        <div
          className="fixed z-[9999] w-[300px] pointer-events-auto rm-panel !border-transparent rounded-xl p-3 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8)]"
          style={{ left: hoverHistory.left, bottom: hoverHistory.bottom }}
          onMouseEnter={cancelHistoryHide}
          onMouseLeave={scheduleHistoryHide}
        >
          {history[hoverHistory.idx].model && (
            <div className="mb-1.5 text-[9px] uppercase tracking-widest font-semibold text-orange-300/70">
              {modelLabel(history[hoverHistory.idx].model)}
            </div>
          )}
          <div className="text-[11px] leading-relaxed text-white/70 whitespace-pre-wrap max-h-[240px] overflow-y-auto" data-scrollable>
            {history[hoverHistory.idx].text}
          </div>
          {history[hoverHistory.idx].source && (
            <div className="mt-2 pt-2 border-t border-white/[0.08]">
              <div className="mb-1 text-[9px] uppercase tracking-widest font-semibold text-white/35">Original — botão direito p/ restaurar</div>
              <div className="text-[11px] leading-relaxed text-white/50 whitespace-pre-wrap max-h-[140px] overflow-y-auto" data-scrollable>
                {history[hoverHistory.idx].source}
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
