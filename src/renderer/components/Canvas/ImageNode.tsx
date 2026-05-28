import { memo, useState, useEffect, useCallback } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import type { ImageNodeData, Tag } from '../../store'
import { useCanvasStore, usePromptStore } from '../../store'

type ImageNodeProps = NodeProps<ImageNodeData>

const SOURCE_BADGE: Record<string, { icon: string; label: string; color: string } | null> = {
  comfyui:    { icon: '🔗', label: 'ComfyUI',          color: 'bg-emerald-500/15 text-emerald-300/80 border-emerald-500/25' },
  a1111:      { icon: '🔗', label: 'Automatic1111',    color: 'bg-emerald-500/15 text-emerald-300/80 border-emerald-500/25' },
  midjourney: { icon: '🔗', label: 'Midjourney',       color: 'bg-sky-500/15 text-sky-300/80 border-sky-500/25' },
  ai:         { icon: '✨', label: 'Analisado por IA', color: 'bg-orange-500/15 text-orange-300/80 border-orange-500/25' },
  none:       { icon: '?', label: 'Não Identificado', color: 'bg-white/[0.05] text-white/35 border-white/[0.08]' },
}

const CATEGORY_LABEL: Record<string, string> = {
  style:       'Estilo',
  lighting:    'Luz',
  composition: 'Composição',
  color:       'Cor',
  mood:        'Atmosfera',
  subject:     'Sujeito',
  description: 'Descrição',
}

const CATEGORY_ORDER = ['subject', 'style', 'lighting', 'composition', 'color', 'mood', 'description']

function groupTagsByCategory(tags: Tag[]): [string, Tag[]][] {
  const map = new Map<string, Tag[]>()
  for (const tag of tags) {
    const list = map.get(tag.category) ?? []
    list.push(tag)
    map.set(tag.category, list)
  }
  const ordered: [string, Tag[]][] = []
  for (const cat of CATEGORY_ORDER) {
    if (map.has(cat)) ordered.push([cat, map.get(cat)!])
  }
  for (const [cat, tags] of map) {
    if (!CATEGORY_ORDER.includes(cat)) ordered.push([cat, tags])
  }
  return ordered
}

function ImageNode({ id, data, selected }: ImageNodeProps) {
  const promptTags = usePromptStore(s => s.promptTags)
  const toggleTag  = usePromptStore(s => s.toggleTag)
  const rf = useReactFlow()
  const [imgError, setImgError] = useState(false)
  const [visible, setVisible] = useState(data.animationDelay === undefined)
  useEffect(() => {
    if (data.animationDelay === undefined) return
    const t = setTimeout(() => setVisible(true), data.animationDelay)
    return () => clearTimeout(t)
  }, [])

  const handleCornerMouseDown = useCallback((
    e: React.MouseEvent,
    corner: 'se' | 'sw' | 'ne' | 'nw'
  ) => {
    e.stopPropagation()
    e.preventDefault()

    // Read initial state from RF (not store — store may be stale after prior resize)
    const rfNode = rf.getNodes().find(n => n.id === id)
    if (!rfNode) return

    const startMouseX = e.clientX
    const startWidth = (rfNode.style?.width as number) ?? 220
    const startPosX = rfNode.position.x
    const startPosY = rfNode.position.y

    const onMouseMove = (me: MouseEvent) => {
      const { zoom } = rf.getViewport()
      const dx = (me.clientX - startMouseX) / zoom

      let newWidth: number
      let newPosX = startPosX

      if (corner === 'se' || corner === 'ne') {
        newWidth = Math.max(150, startWidth + dx)
      } else {
        newWidth = Math.max(150, startWidth - dx)
        newPosX = startPosX + (startWidth - newWidth)
      }

      // Update RF internal state — visual feedback without touching Zustand store
      rf.updateNode(id, n => ({
        style: { ...n.style, width: newWidth },
        position: { ...n.position, x: newPosX },
      }))
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)

      // Persist final state to store + DB on mouse up (not per-frame)
      const finalNode = rf.getNodes().find(n => n.id === id)
      if (finalNode) {
        const finalWidth = (finalNode.style?.width as number) ?? 220
        const finalPosX = finalNode.position.x
        useCanvasStore.getState().setNodes(
          useCanvasStore.getState().nodes.map(n =>
            n.id === id
              ? { ...n, style: { ...n.style, width: finalWidth }, position: { ...n.position, x: finalPosX } }
              : n
          )
        )
        window.api.updateNodePosition(id, finalPosX, startPosY)
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [id, rf])

  const baseBadge = SOURCE_BADGE[data.metadataSource] ?? null
  const badge = baseBadge && data.metadataSource === 'comfyui' && data.modelName
    ? { ...baseBadge, label: `ComfyUI — ${data.modelName}` }
    : baseBadge
  const groupedTags = groupTagsByCategory(data.tags)

  const cornerCursors = { se: 'se-resize', sw: 'sw-resize', ne: 'ne-resize', nw: 'nw-resize' } as const

  return (
    <div
      className="relative"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0px)' : 'translateY(24px)',
        transition: 'opacity 500ms ease-out, transform 500ms ease-out',
        willChange: 'transform',
      }}
    >
      {/* Corner resize handles */}
      {(['se', 'sw', 'ne', 'nw'] as const).map(corner => (
        <div
          key={corner}
          className="nodrag nopan absolute z-20 w-5 h-5"
          style={{
            cursor: cornerCursors[corner],
            bottom: corner.includes('s') ? 0 : undefined,
            top: corner.includes('n') ? 0 : undefined,
            right: corner.includes('e') ? 0 : undefined,
            left: corner.includes('w') ? 0 : undefined,
          }}
          onMouseDown={(e) => handleCornerMouseDown(e, corner)}
        />
      ))}

      {/* Source badge — 2px above the node */}
      {badge && (
        <div
          className={`absolute left-0 flex items-center gap-1 backdrop-blur-sm rounded-md px-1.5 py-0.5 border whitespace-nowrap ${badge.color}`}
          style={{ bottom: 'calc(100% + 2px)' }}
        >
          <span className="text-[10px] leading-none">{badge.icon}</span>
          <span className="text-[10px] font-medium leading-none">{badge.label}</span>
        </div>
      )}

      {/* Bottom label */}
      {!data.isPending && !data.isError && data.metadataSource !== 'none' && data.metadataSource !== 'ai' && (
        <div
          className="absolute left-0 right-0 flex justify-center"
          style={{ top: 'calc(100% + 6px)' }}
        >
          <span className="text-[10px] text-emerald-300/50 font-medium whitespace-nowrap">🔗 Metadados Originais</span>
        </div>
      )}

      <div
        className={`flex flex-col bg-[#111111] rounded-2xl border shadow-2xl min-w-[150px]`}
        style={{
          borderColor: selected ? 'rgb(251 146 60)' : 'transparent',
          boxShadow: selected
            ? '0 0 0 3px rgba(251,146,60,0.35), 0 8px 32px rgba(0,0,0,0.8)'
            : '0 1px 3px rgba(0,0,0,0.8)',
          transition: 'border-color 150ms ease-out, box-shadow 150ms ease-out',
        }}
      >

        {/* Thumbnail */}
        <div className="relative">
          {!imgError ? (
            <img
              src={`file://${data.imagePath}`}
              alt=""
              className="w-full block rounded-t-2xl"
              draggable={false}
              decoding="async"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-[140px] gap-2 text-white/20">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.3"/>
                <circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" opacity="0.5"/>
                <path d="M3 16L8 11L12 15L15.5 11L21 16" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              <span className="text-xs">Imagem não encontrada</span>
            </div>
          )}
        </div>

        {/* Description area */}
        <div className="px-4 py-4 flex flex-col gap-2 rounded-b-2xl">
          {data.isPending && (
            <div className="text-xs text-white/35 flex items-center gap-2 py-0.5">
              <span className="animate-spin inline-block">⏳</span>
              <span>Analisando...</span>
            </div>
          )}

          {data.isError && (
            <div className="text-xs text-red-400/70 bg-red-500/10 rounded-lg px-2 py-1.5 border border-red-500/15">
              Configure uma API key nas configurações
            </div>
          )}

          {!data.isPending && !data.isError && data.tags.length === 0 && (
            <div className="text-xs text-white/20 italic py-0.5">Sem descrição</div>
          )}

          {groupedTags.map(([category, tags]) => (
            <div key={category} className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-widest text-white/25 font-semibold leading-none">
                {CATEGORY_LABEL[category] ?? category}
              </span>
              <div className="flex flex-wrap gap-1">
                {tags.map(tag => {
                  const inPrompt = promptTags.some(pt => pt.value === tag.value)
                  return (
                    <button
                      key={tag.id}
                      onClick={() => toggleTag(tag, id)}
                      className={`rm-chip nodrag ${inPrompt ? 'is-active' : ''}`}
                      title={inPrompt ? 'Remover do builder' : 'Adicionar ao builder'}
                    >
                      {tag.value}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Only re-render when data or selection changes — ignore RF position/drag props
// (positionAbsoluteX, positionAbsoluteY, dragging, zIndex change every drag frame
//  but ImageNode never reads them, so skipping them is correct)
export default memo(ImageNode, (prev: ImageNodeProps, next: ImageNodeProps) =>
  prev.id === next.id &&
  prev.data === next.data &&
  prev.selected === next.selected
)
