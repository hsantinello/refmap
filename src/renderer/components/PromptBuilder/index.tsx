import { Fragment, useState, useRef, useEffect, forwardRef } from 'react'
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
import { usePromptStore, type PromptTag } from '../../store'


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
      className="self-stretch w-2 cursor-text"
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
      style={style}
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
        className="bg-transparent text-[15px] text-white/70 placeholder-white/15 outline-none w-full resize-none overflow-hidden pb-2"
        style={{ lineHeight: '1.5' }}
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

const MODELS = [
  { id: 'midjourney',       label: 'Midjourney' },
  { id: 'nano-banana',      label: 'Nano Banana' },
  { id: 'gpt-image-2',      label: 'GPT Image 2' },
  { id: 'stable-diffusion', label: 'Stable Diffusion' },
  { id: 'flux',             label: 'Flux' },
  { id: 'flux2-klein',      label: 'Flux 2 [klein]' },
  { id: 'zimage',           label: 'ZImage' },
  { id: 'grok',             label: 'Grok (xAI)' },
  { id: 'veo3',             label: 'Veo 3' },
  { id: 'hunyuan',          label: 'HunYuan Video' },
  { id: 'sora-2',           label: 'Sora 2' },
  { id: 'wan',              label: 'Wan 2.2' },
  { id: 'seedance',         label: 'Seedance 2.0' },
  { id: 'ltx-2',            label: 'LTX-2' },
]

export default function PromptBuilder() {
  const { promptTags, reorderTags, clearAll, getPromptString, insertTagAt, removeTag } = usePromptStore()
  const dragPointerRef = useRef({ x: 0, y: 0 })
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const [insertIndex, setInsertIndex] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
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

  useEffect(() => {
    const el = textInputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[optimize]', msg)
      setOptimizeError(msg.includes('API key') ? 'Configure a API key nas Settings' : `Erro: ${msg}`)
      setTimeout(() => setOptimizeError(null), 6000)
    } finally {
      setOptimizing(false)
    }
  }

  const count = promptTags.length
  const hasContent = count > 0 || inputText.trim().length > 0

  return (
    <div
      className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 pointer-events-none w-full max-w-[640px]"
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
              <div className="flex flex-wrap items-start gap-1.5 pb-2 max-h-[90px] overflow-y-auto overflow-x-hidden">
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
              </div>
            )}

            {/* Textarea */}
            <DroppableTextarea
              ref={textInputRef}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              placeholder="Escrever prompt..."
            />
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
                  className="bg-black/95 backdrop-blur-md rounded-xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8)] py-1.5 px-1 min-w-0 w-[120px] z-[9999]"
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
                  {MODELS.map(m => (
                    <button
                      key={m.id}
                      className={`w-full text-left px-2 py-1 text-[11px] rounded-md transition-colors cursor-default select-none ${
                        targetModel === m.id
                          ? 'text-orange-300/80 bg-orange-500/[0.12]'
                          : 'text-white/75 hover:text-white hover:bg-white/[0.08]'
                      }`}
                      onClick={() => handleSelectModel(m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>,
                document.body
              )}
            </div>

            <div className="flex items-center gap-2">
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
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
