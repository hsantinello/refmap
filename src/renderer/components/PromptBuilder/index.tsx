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
import { usePromptStore, useCanvasStore, type PromptTag } from '../../store'

function MicButton({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const showError = (msg: string) => {
    setErrorMsg(msg)
    setState('error')
    setTimeout(() => setState('idle'), 3000)
  }

  const toggle = async () => {
    if (state === 'transcribing' || state === 'error') return

    if (state === 'recording') {
      recorderRef.current?.stop()
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []

      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
        const buffer = await blob.arrayBuffer()
        setState('transcribing')
        try {
          const text = await window.api.transcribeAudio(new Uint8Array(buffer))
          if (text?.trim()) onTranscript(text.trim())
          setState('idle')
        } catch (err) {
          const msg = String(err)
          if (msg.includes('NO_OPENAI_KEY')) showError('Chave API não configurada')
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

  const label = state === 'recording' ? 'Parar gravação'
    : state === 'transcribing' ? 'Transcrevendo...'
    : state === 'error' ? errorMsg
    : 'Ditar prompt'

  const bgClass = state === 'recording' ? 'bg-red-500/20'
    : state === 'transcribing' ? 'bg-orange-500/15'
    : state === 'error' ? 'bg-red-500/10'
    : 'hover:bg-white/[0.07]'

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        title={label}
        disabled={state === 'transcribing'}
        className={`p-2.5 rounded-lg transition-all ${bgClass}`}
      >
        {state === 'recording' ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <rect x="6" y="6" width="12" height="12" rx="2" fill="#ef4444" opacity="0.8"/>
          </svg>
        ) : state === 'transcribing' ? (
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
      {state === 'error' && (
        <div className="absolute bottom-full mb-2 right-0 whitespace-nowrap px-2.5 py-1.5 rounded-lg text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 pointer-events-none">
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
  const { removeTag, updateTagText } = usePromptStore()
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
          className="text-[12px] leading-none px-2.5 py-1.5"
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
      <button
        className="pr-2 text-current opacity-0 group-hover:opacity-40 hover:!opacity-90 transition-opacity text-base leading-none shrink-0 -ml-0.5"
        onClick={e => { e.stopPropagation(); removeTag(tag.id) }}
        onPointerDown={e => e.stopPropagation()}
      >
        ×
      </button>
    </div>
  )
}

function getCaretIndexInTextarea(textarea: HTMLTextAreaElement, clientX: number, clientY: number): number {
  const text = textarea.value
  if (!text) return 0

  const cs = window.getComputedStyle(textarea)
  const rect = textarea.getBoundingClientRect()

  const mirror = document.createElement('div')
  Object.assign(mirror.style, {
    position: 'fixed',
    top: rect.top + 'px',
    left: rect.left + 'px',
    width: rect.width + 'px',
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing,
    paddingTop: cs.paddingTop,
    paddingBottom: cs.paddingBottom,
    paddingLeft: cs.paddingLeft,
    paddingRight: cs.paddingRight,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowX: 'hidden',
    opacity: '0',
    zIndex: '2147483647',
    boxSizing: 'border-box',
  })

  for (let i = 0; i < text.length; i++) {
    const span = document.createElement('span')
    span.textContent = text[i]
    mirror.appendChild(span)
  }

  document.body.appendChild(mirror)

  let index = text.length
  const el = document.elementFromPoint(clientX, clientY)
  if (el && mirror.contains(el)) {
    const spans = Array.from(mirror.children) as HTMLSpanElement[]
    const spanIdx = spans.indexOf(el as HTMLSpanElement)
    if (spanIdx >= 0) {
      const r = el.getBoundingClientRect()
      index = clientX > r.left + r.width / 2 ? spanIdx + 1 : spanIdx
    }
  }

  document.body.removeChild(mirror)
  return index
}

function getCaretPixelPosition(textarea: HTMLTextAreaElement, index: number): { left: number; top: number; height: number } {
  const cs = window.getComputedStyle(textarea)
  const rect = textarea.getBoundingClientRect()
  const text = textarea.value

  const mirror = document.createElement('div')
  Object.assign(mirror.style, {
    position: 'fixed',
    top: rect.top + 'px',
    left: rect.left + 'px',
    width: rect.width + 'px',
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing,
    paddingTop: cs.paddingTop,
    paddingBottom: cs.paddingBottom,
    paddingLeft: cs.paddingLeft,
    paddingRight: cs.paddingRight,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
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
      { id: 'flux',               label: 'Flux',            nsfw: true },
      { id: 'flux2-klein',        label: 'Flux 2 [klein]',  nsfw: true },
      { id: 'gpt-image-2',        label: 'GPT Image 2' },
      { id: 'grok',               label: 'Grok' },
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
      { id: 'ltx-2',       label: 'LTX-2',             nsfw: true },
      { id: 'luma',        label: 'Luma Dream Machine' },
      { id: 'pika',        label: 'Pika' },
      { id: 'pixverse',    label: 'PixVerse' },
      { id: 'runway-gen4', label: 'Runway Gen-4' },
      { id: 'seedance',    label: 'Seedance 2.0' },
      { id: 'sora-2',      label: 'Sora 2' },
      { id: 'veo3',        label: 'Veo 3' },
      { id: 'wan',         label: 'Wan 2.2',            nsfw: true },
    ],
  },
]
// Flat list for label lookup
const MODELS = MODEL_GROUPS.flatMap(g => g.models)

export default function PromptBuilder() {
  const { promptTags, reorderTags, clearAll, getPromptString, insertTagAt, removeTag } = usePromptStore()
  const dragPointerRef = useRef({ x: 0, y: 0 })
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const [insertIndex, setInsertIndex] = useState<number | null>(null)
  const [copied, setCopied]           = useState(false)
  const [history, setHistory]         = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const currentCanvasId = useCanvasStore(s => s.currentCanvasId)

  useEffect(() => {
    const checkKey = async () => {
      const provider = ((await window.api.getSetting('aiProvider')) ?? 'anthropic') as string
      const [activeKey, openaiKey] = await Promise.all([
        window.api.getApiKey(provider),
        window.api.getApiKey('openai'),
      ])
      const canTranscribe = !!(
        (activeKey?.trim() && (activeKey.startsWith('tgp_') || provider === 'openai')) ||
        openaiKey?.trim()
      )
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
      if (raw) try { setHistory(JSON.parse(raw)) } catch {}
    })
  }, [currentCanvasId])
  const [hasOpenAIKey, setHasOpenAIKey] = useState(false)
  const [inputText, setInputText] = useState('')
  const [targetModel, setTargetModel] = useState<string | null>(null)
  const [showModels, setShowModels] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)
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
      const modelId = pendingModelRef.current
      if (!modelId) return
      pendingModelRef.current = null
      handleSelectModelRef.current?.(modelId)
    }
    window.addEventListener('apikey-changed', handler)
    return () => window.removeEventListener('apikey-changed', handler)
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

    if (over.id === 'textarea-drop') {
      const tag = promptTags.find(t => t.id === active.id)
      if (!tag || !textInputRef.current) return
      const { x, y } = dragPointerRef.current
      const pos = getCaretIndexInTextarea(textInputRef.current, x, y)
      const before = inputText.slice(0, pos)
      const after = inputText.slice(pos)
      const sep1 = before && !before.match(/[,\s]$/) ? ', ' : ''
      const sep2 = after && !after.match(/^[,\s]/) ? ', ' : ''
      setInputText(before + sep1 + tag.value + sep2 + after)
      removeTag(tag.id)
      return
    }

    if (active.id === over.id) return
    const from = promptTags.findIndex(t => t.id === active.id)
    const to = promptTags.findIndex(t => t.id === over.id)
    reorderTags(from, to)
  }

  const handleCopy = () => {
    const parts = [getPromptString(), inputText.trim()].filter(Boolean)
    const text = parts.join(', ')
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    // Save to history (max 10 entries, deduplicated)
    if (currentCanvasId) {
      const newHistory = [text, ...history.filter(h => h !== text)].slice(0, 10)
      setHistory(newHistory)
      window.api.setSetting(`promptHistory_${currentCanvasId}`, JSON.stringify(newHistory))
    }
  }

  const handleClearAll = () => {
    clearAll()
    setInputText('')
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
    try {
      const optimized = await window.api.optimizePrompt(currentPrompt, modelId)
      const text = optimized.split('\n').map((l: string) => l.trim()).filter((l: string) => l && l !== '---NEGATIVE---').join('\n')
      clearAll()
      setInputText(text)
      setTargetModel(null)
      // Save optimized prompt to history
      if (currentCanvasId) {
        const newHistory = [text, ...history.filter(h => h !== text)].slice(0, 10)
        setHistory(newHistory)
        window.api.setSetting(`promptHistory_${currentCanvasId}`, JSON.stringify(newHistory))
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[optimize]', msg)
      if (msg === 'API key not configured') {
        pendingModelRef.current = modelId
        setTargetModel(null)
        window.dispatchEvent(new CustomEvent('open-settings'))
      } else {
        setOptimizeError(`Erro: ${msg}`)
        setTimeout(() => setOptimizeError(null), 6000)
      }
    } finally {
      setOptimizing(false)
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
            {/* Chips */}
            {count > 0 && (
              <div
                className="flex flex-wrap items-start gap-1.5 pb-2 max-h-[90px] overflow-y-auto overflow-x-hidden cursor-text"
                onMouseDown={e => {
                  // If clicked on empty space (not on a chip or insert zone), insert at end
                  const target = e.target as Element
                  if (target.closest('[data-chip]') || target.closest('[data-insert-zone]')) return
                  e.preventDefault()
                  setInsertIndex(promptTags.length)
                }}
              >
                <SortableContext items={promptTags.map(t => t.id)} strategy={rectSortingStrategy}>
                  {promptTags.map((tag, i) => (
                    <Fragment key={tag.id}>
                      <InsertZone
                        index={i}
                        activeIndex={insertIndex}
                        onActivate={setInsertIndex}
                        onCommit={v => { insertTagAt(v, i); setInsertIndex(null) }}
                        onCancel={() => setInsertIndex(null)}
                      />
                      <SortableChip tag={tag} />
                    </Fragment>
                  ))}
                </SortableContext>
                {/* Insert zone at end */}
                <InsertZone
                  index={promptTags.length}
                  activeIndex={insertIndex}
                  onActivate={setInsertIndex}
                  onCommit={v => { insertTagAt(v, promptTags.length); setInsertIndex(null) }}
                  onCancel={() => setInsertIndex(null)}
                />
              </div>
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
                disabled={!hasContent && !optimizeError}
                onClick={() => {
                  if (!showModels && modelBtnRef.current) {
                    const r = modelBtnRef.current.getBoundingClientRect()
                    setDropdownPos({ x: r.left, y: r.top })
                  }
                  setShowModels(v => !v)
                }}
                className={`flex items-center gap-1.5 text-[11px] transition-colors px-2 py-1 rounded-md max-w-[200px] truncate ${
                  !hasContent && !optimizeError
                    ? 'text-white/15 cursor-not-allowed'
                    : optimizeError
                      ? 'text-red-400/70 hover:text-red-400 hover:bg-white/[0.06]'
                      : 'text-white/40 hover:text-white/70 hover:bg-white/[0.06]'
                }`}
              >
                <span>{optimizing ? 'Otimizando...' : optimizeError ?? (targetModel ? MODELS.find(m => m.id === targetModel)?.label : 'Otimizar para...')}</span>
                <svg width="8" height="8" viewBox="0 0 10 6" fill="none">
                  <path d={showModels ? 'M1 5L5 1L9 5' : 'M1 1L5 5L9 1'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
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
            {hasOpenAIKey && <MicButton onTranscript={text => setInputText(prev => prev ? prev + ' ' + text : text)} />}
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
                <div className="border-t border-white/[0.06] px-4 pt-3 pb-2 flex flex-col gap-1.5">
                  <span className="text-[9px] uppercase tracking-widest text-white/25 font-semibold mb-1">Histórico</span>
                  <div className="flex flex-col gap-1.5 max-h-[60px] overflow-y-auto">
                    {history.map((h, i) => (
                      <button
                        key={i}
                        onClick={() => { navigator.clipboard.writeText(h); setCopied(true); setTimeout(() => setCopied(false), 1500); setShowHistory(false) }}
                        className="text-left text-[11px] text-white/45 hover:text-white/75 hover:bg-white/[0.04] rounded-lg px-2 py-1 transition-colors truncate shrink-0"
                        title={h}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>
    </div>
  )
}
