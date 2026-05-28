import { useEffect, useRef, useState } from 'react'

interface ContextMenuProps {
  x: number
  y: number
  multiSelect: boolean
  onOrganize: (type: 'grid' | 'row' | 'column') => void
  onDelete: () => void
  onClose: () => void
  onAddToGroup: () => void
}

export default function ContextMenu({ x, y, multiSelect, onOrganize, onDelete, onClose, onAddToGroup }: ContextMenuProps) {
  const [subOpen, setSubOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openSub = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setSubOpen(true)
  }
  const closeSub = () => {
    hideTimer.current = setTimeout(() => setSubOpen(false), 120)
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [onClose])

  const item = 'flex items-center justify-between gap-6 px-3 py-1.5 text-[13px] text-white/75 hover:bg-white/[0.08] hover:text-white rounded-md cursor-default transition-colors select-none w-full text-left'

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-[#1a1a1a] border border-white/[0.1] rounded-xl shadow-2xl shadow-black/60 py-1.5 px-1 min-w-[180px]"
      style={{ left: x, top: y }}
      onContextMenu={e => e.preventDefault()}
    >
      {multiSelect && (
        <button className={item} onClick={() => { onAddToGroup(); onClose() }}>
          <span>Adicionar ao grupo</span>
        </button>
      )}

      {multiSelect && (
        <div
          className={`${item} relative`}
          onMouseEnter={openSub}
          onMouseLeave={closeSub}
        >
          <span>Organizar</span>
          <span className="text-white/30 text-[11px]">▶</span>

          {subOpen && (
            <div
              className="absolute left-full top-0 bg-[#1a1a1a] border border-white/[0.1] rounded-xl shadow-2xl shadow-black/60 py-1.5 px-1 min-w-[160px]"
              onMouseEnter={openSub}
              onMouseLeave={closeSub}
            >
              <button className={item} onClick={() => { onOrganize('grid'); onClose() }}>Grade</button>
              <button className={item} onClick={() => { onOrganize('row'); onClose() }}>Linha horizontal</button>
              <button className={item} onClick={() => { onOrganize('column'); onClose() }}>Coluna vertical</button>
            </div>
          )}
        </div>
      )}

      {multiSelect && <div className="h-px bg-white/[0.07] mx-2 my-1" />}

      <button
        className="flex items-center gap-6 px-3 py-1.5 text-[13px] text-red-400/80 hover:bg-red-500/[0.10] hover:text-red-300 rounded-md cursor-default transition-colors select-none w-full text-left"
        onClick={onDelete}
      >
        Deletar
      </button>
    </div>
  )
}
