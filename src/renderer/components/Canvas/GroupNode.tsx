import { memo, useState, useCallback } from 'react'
import type { NodeProps } from '@xyflow/react'
import { NodeToolbar, NodeResizer, Position, useStore } from '@xyflow/react'
import type { ImageNodeData } from '../../store'

const COLORS = [
  { label: 'laranja', dot: '#f97316', border: 'rgba(249,115,22,0.35)', bg: 'rgba(249,115,22,0.05)' },
  { label: 'violeta', dot: '#8b5cf6', border: 'rgba(139,92,246,0.35)', bg: 'rgba(139,92,246,0.05)' },
  { label: 'azul',    dot: '#38bdf8', border: 'rgba(56,189,248,0.35)',  bg: 'rgba(56,189,248,0.05)'  },
  { label: 'verde',   dot: '#34d399', border: 'rgba(52,211,153,0.35)',  bg: 'rgba(52,211,153,0.05)'  },
  { label: 'rosa',    dot: '#fb7185', border: 'rgba(251,113,133,0.35)', bg: 'rgba(251,113,133,0.05)' },
]

const TARGET_PX = 10

function GroupNode({ id, data, selected }: NodeProps<ImageNodeData>) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(data.label ?? 'Grupo')
  const [colorIdx, setColorIdx] = useState<number | null>(null)

  const zoom = useStore(s => s.transform[2])
  const fontSize = Math.max(15, Math.min(20, TARGET_PX / zoom))

  const handleResizeEnd = useCallback((_e: unknown, { width, height }: { width: number; height: number }) => {
    window.api.updateNodeSize(id, width, height)
  }, [id])

  const active = colorIdx !== null ? COLORS[colorIdx] : null

  const borderColor = active
    ? (selected ? active.border : active.border.replace('0.35', '0.2'))
    : (selected ? 'rgba(249,115,22,0.25)' : 'rgba(255,255,255,0.06)')

  const bgColor = active
    ? active.bg
    : (selected ? 'rgba(249,115,22,0.03)' : 'rgba(255,255,255,0.015)')

  return (
    <>
      <NodeResizer
        isVisible={true}
        minWidth={120}
        minHeight={80}
        onResizeEnd={handleResizeEnd}
        lineStyle={{ display: 'none' }}
        handleStyle={{
          width: 16,
          height: 16,
          backgroundColor: 'transparent',
          border: 'none',
        }}
      />

      {/* NodeToolbar acima do grupo — sempre visível */}
      <NodeToolbar isVisible={true} position={Position.Top} offset={8} align="start">
        <div className="flex flex-row items-center gap-2">

          {/* Label — sempre visível, tamanho compensa zoom */}
          {editing ? (
            <input
              autoFocus
              value={label}
              onChange={e => setLabel(e.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === 'Escape') setEditing(false)
                e.stopPropagation()
              }}
              onPointerDown={e => e.stopPropagation()}
              className="nodrag nopan bg-transparent text-white/55 outline-none text-center"
              style={{ fontSize, width: `${Math.max(60, label.length * fontSize * 0.6)}px` }}
            />
          ) : (
            <span
              className="nodrag nopan text-white/40 font-medium select-none whitespace-nowrap cursor-text"
              style={{ fontSize }}
              onDoubleClick={() => setEditing(true)}
            >
              {label}
            </span>
          )}

          {/* Swatches — só quando selecionado */}
          {selected && (
            <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-[#1c1c1c] border border-white/10 shadow-2xl shadow-black/60">
              {COLORS.map((c, i) => (
                <button
                  key={c.label}
                  onClick={() => setColorIdx(i === colorIdx ? null : i)}
                  className="nodrag nopan w-5 h-5 rounded-full transition-transform hover:scale-110 active:scale-95"
                  style={{
                    background: c.dot,
                    boxShadow: colorIdx === i
                      ? `0 0 0 2px #1c1c1c, 0 0 0 3.5px ${c.dot}`
                      : undefined,
                  }}
                  title={c.label}
                />
              ))}
            </div>
          )}

        </div>
      </NodeToolbar>

      {/* Corpo do grupo */}
      <div
        className="w-full h-full rounded-2xl border transition-colors"
        style={{ borderColor, backgroundColor: bgColor }}
      />
    </>
  )
}

export default memo(GroupNode, (prev, next) =>
  prev.id === next.id &&
  prev.data === next.data &&
  prev.selected === next.selected
)
