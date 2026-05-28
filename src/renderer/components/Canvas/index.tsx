import { useCallback, useEffect, useRef, useState, memo } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  useReactFlow,
  useStore,
  applyNodeChanges,
  type Node,
  type NodeMouseHandler,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import ImageNode from './ImageNode'
import GroupNode from './GroupNode'
import MetadataNode from './MetadataNode'
import ContextMenu from './ContextMenu'
import { useCanvasStore, type ImageNodeData, type Tag, type ComfyParams } from '../../store'
import { v4 as uuid } from 'uuid'

const nodeTypes = { imageNode: ImageNode, groupNode: GroupNode, metadataNode: MetadataNode }

const TARGET_H = 340
const MAX_W = 420
const MIN_W = 200

function getImageSize(path: string): Promise<{ w: number; h: number }> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ w: 1, h: 1 })
    img.src = `file://${path}`
  })
}

interface CanvasProps {
  canvasId: string
}

function CanvasToolbar() {
  const zoom = useStore(s => s.transform[2])
  const { zoomIn, zoomOut, fitView } = useReactFlow()

  const btnBase = 'w-9 h-9 flex items-center justify-center rounded-lg transition-all'
  const btnIdle = 'text-white/40 hover:text-white/80 hover:bg-white/[0.08]'

  return (
    <div className="absolute top-3 right-3 z-10 flex items-center gap-0.5 px-1.5 py-1.5 rm-panel !border-transparent rounded-xl">
      <button onClick={() => fitView({ duration: 300 })} title="Centralizar" className={`${btnBase} ${btnIdle}`}>
        <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
          <path d="M1 4V1H4M10 1H13V4M13 10V13H10M4 13H1V10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>

      <div className="w-px h-4 bg-white/[0.08] mx-0.5" />

      <button onClick={() => zoomOut({ duration: 200 })} className={`${btnBase} ${btnIdle} text-lg font-light`}>
        −
      </button>

      <span className="text-[12px] text-white/35 w-10 text-center tabular-nums font-medium">
        {Math.round(zoom * 100)}%
      </span>

      <button onClick={() => zoomIn({ duration: 200 })} className={`${btnBase} ${btnIdle} text-lg font-light`}>
        +
      </button>
    </div>
  )
}

function Canvas({ canvasId }: CanvasProps) {
  // Only subscribe to stable store functions — never causes re-renders
  const addImageNode   = useCanvasStore(s => s.addImageNode)
  const addMetadataNode = useCanvasStore(s => s.addMetadataNode)
  const updateNodeData = useCanvasStore(s => s.updateNodeData)
  const removeNode     = useCanvasStore(s => s.removeNode)

  const rf = useReactFlow<Node<ImageNodeData>>()
  const { screenToFlowPosition, getViewport, zoomTo, setCenter, fitView } = rf

  // Initial nodes from store — read once at mount
  const initialNodesRef = useRef(useCanvasStore.getState().nodes)

  // Bidirectional map: imageNodeId ↔ metadataNodeId — for O(1) linked-node lookup during drag
  const linkedNodeMapRef = useRef(
    (() => {
      const map = new Map<string, string>()
      for (const n of useCanvasStore.getState().nodes) {
        if (n.data.linkedImageNodeId) {
          map.set(n.id, n.data.linkedImageNodeId)
          map.set(n.data.linkedImageNodeId, n.id)
        }
      }
      return map
    })()
  )

  // Fit view after first load
  const hasFitRef = useRef(false)
  const onInit = useCallback(() => {
    if (hasFitRef.current || rf.getNodes().length === 0) return
    hasFitRef.current = true
    setTimeout(() => fitView({ duration: 600, padding: 0.15 }), 100)
  }, [rf, fitView])

  // When switching canvases, replace RF nodes and re-fit
  const prevCanvasIdRef = useRef(canvasId)
  useEffect(() => {
    if (prevCanvasIdRef.current === canvasId) return
    prevCanvasIdRef.current = canvasId
    hasFitRef.current = false
    // Rebuild linked-node map for new canvas
    linkedNodeMapRef.current.clear()
    for (const n of useCanvasStore.getState().nodes) {
      if (n.data.linkedImageNodeId) {
        linkedNodeMapRef.current.set(n.id, n.data.linkedImageNodeId)
        linkedNodeMapRef.current.set(n.data.linkedImageNodeId, n.id)
      }
    }
    rf.setNodes(useCanvasStore.getState().nodes)
    setTimeout(() => fitView({ duration: 500, padding: 0.15 }), 100)
  }, [canvasId, fitView, rf])

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId?: string; selectedIds: string[] } | null>(null)

  const onNodeDoubleClick: NodeMouseHandler = useCallback((_e, node) => {
    const w = node.measured?.width ?? (node.style?.width as number) ?? 220
    const h = node.measured?.height ?? 280
    const cx = node.position.x + w / 2
    const cy = node.position.y + h / 2
    const padding = 0.75
    const zoom = Math.min(
      (window.innerWidth * padding) / w,
      (window.innerHeight * padding) / h,
      4
    )
    setCenter(cx, cy, { zoom, duration: 400 })
  }, [setCenter])

  const onNodeContextMenu: NodeMouseHandler = useCallback((e, node) => {
    e.preventDefault()
    const selected = rf.getNodes().filter(n => n.selected).map(n => n.id)
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id, selectedIds: selected })
  }, [rf])

  const onContainerContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('.react-flow__node')) return
    const selected = rf.getNodes().filter(n => n.selected)
    if (selected.length < 2) return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, selectedIds: selected.map(n => n.id) })
  }, [rf])

  const GAP = 24

  const organizeNodes = useCallback((type: 'grid' | 'row' | 'column') => {
    const allNodes = rf.getNodes()
    const selected = allNodes.filter(n => n.selected)
    if (selected.length < 2) return

    const getW = (n: Node<ImageNodeData>) => (n.measured?.width ?? (n.style?.width as number) ?? 220)
    const getH = (n: Node<ImageNodeData>) => (n.measured?.height ?? 280)
    const getArea = (n: Node<ImageNodeData>) => getW(n) * getH(n)

    const sorted = [...selected].sort((a, b) => getArea(b) - getArea(a))
    const origin = { x: Math.min(...selected.map(n => n.position.x)), y: Math.min(...selected.map(n => n.position.y)) }

    let updatedPositions: { id: string; x: number; y: number }[] = []

    if (type === 'row') {
      let curX = origin.x
      updatedPositions = sorted.map(n => {
        const pos = { id: n.id, x: curX, y: origin.y }
        curX += getW(n) + GAP
        return pos
      })
    } else if (type === 'column') {
      let curY = origin.y
      updatedPositions = sorted.map(n => {
        const pos = { id: n.id, x: origin.x, y: curY }
        curY += getH(n) + GAP
        return pos
      })
    } else {
      const cols = Math.ceil(Math.sqrt(sorted.length))
      updatedPositions = sorted.map((n, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        const rowNodes = sorted.slice(row * cols, row * cols + cols)
        const x = origin.x + rowNodes.slice(0, col).reduce((acc, rn) => acc + getW(rn) + GAP, 0)
        const y = origin.y + sorted.slice(0, row * cols).reduce((acc, _, idx) => {
          const rStart = Math.floor(idx / cols) * cols
          return idx % cols === 0 ? acc + getH(sorted[rStart]) + GAP : acc
        }, 0)
        return { id: n.id, x, y }
      })
    }

    const posMap = new Map(updatedPositions.map(p => [p.id, p]))

    rf.setNodes(current => current.map(n =>
      posMap.has(n.id) ? { ...n, position: { x: posMap.get(n.id)!.x, y: posMap.get(n.id)!.y } } : n
    ))
    useCanvasStore.getState().setNodes(
      useCanvasStore.getState().nodes.map(n =>
        posMap.has(n.id) ? { ...n, position: { x: posMap.get(n.id)!.x, y: posMap.get(n.id)!.y } } : n
      )
    )
    updatedPositions.forEach(p => window.api.updateNodePosition(p.id, p.x, p.y))
  }, [rf])

  const GROUP_PAD = 40

  const createGroup = useCallback(() => {
    const allNodes = rf.getNodes()
    const selectedIds = new Set(allNodes.filter(n => n.selected).map(n => n.id))
    const imageNodes = allNodes.filter(n => selectedIds.has(n.id) && n.type !== 'groupNode')
    if (imageNodes.length < 2) return

    const getW = (n: Node<ImageNodeData>) => (n.measured?.width ?? (n.style?.width as number) ?? 220)
    const getH = (n: Node<ImageNodeData>) => (n.measured?.height ?? 280)

    const minX = Math.min(...imageNodes.map(n => n.position.x))
    const minY = Math.min(...imageNodes.map(n => n.position.y))
    const maxX = Math.max(...imageNodes.map(n => n.position.x + getW(n)))
    const maxY = Math.max(...imageNodes.map(n => n.position.y + getH(n)))

    const groupId = uuid()
    const gx = minX - GROUP_PAD
    const gy = minY - GROUP_PAD
    const gw = maxX - minX + GROUP_PAD * 2
    const gh = maxY - minY + GROUP_PAD * 2

    const adjusted = imageNodes.map(n => ({
      ...n,
      parentId: groupId,
      position: { x: n.position.x - gx, y: n.position.y - gy },
    }))

    const groupNode: Node<ImageNodeData> = {
      id: groupId,
      type: 'groupNode',
      position: { x: gx, y: gy },
      style: { width: gw, height: gh },
      data: {
        imagePath: '',
        tags: [],
        metadataSource: 'group',
        isPending: false,
        isError: false,
        canvasId,
        isGroup: true,
        label: 'Grupo',
      },
    }

    const newNodes = [
      ...allNodes.filter(n => !selectedIds.has(n.id)),
      groupNode,
      ...adjusted,
    ]
    rf.setNodes(newNodes)
    useCanvasStore.getState().setNodes([
      ...useCanvasStore.getState().nodes.filter(n => !selectedIds.has(n.id)),
      groupNode,
      ...adjusted,
    ])

    window.api.createGroupNode(
      { id: groupId, canvasId, x: gx, y: gy, width: gw, height: gh },
      imageNodes.map(n => n.id)
    ).catch(console.error)

    adjusted.forEach(n => {
      window.api.updateNodePosition(n.id, n.position.x, n.position.y)
    })
  }, [rf, canvasId])

  const ctrlHeldRef = useRef(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Control') ctrlHeldRef.current = true }
    const up = (e: KeyboardEvent) => { if (e.key === 'Control') ctrlHeldRef.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  const processingRef = useRef(new Set<string>())
  // Tracks nodes being moved programmatically to avoid infinite co-movement loop
  const programmaticMovingRef = useRef(new Set<string>())
  // Tracks last known positions for computing per-frame deltas during linked-node co-movement
  const prevPositionsRef = useRef(new Map<string, { x: number; y: number }>())

  const processImage = useCallback(async (imagePath: string, nodeId: string) => {
    try {
      const result = await window.api.extractMetadata(imagePath)

      let description: string
      let source = result.source as ImageNodeData['metadataSource']
      let modelName: string | undefined

      if (result.source === 'none') {
        try {
          const aiResult = await window.api.analyzeWithAI(imagePath)
          description = typeof aiResult === 'string' ? aiResult : ''
          source = 'ai'
        } catch {
          const err = { isPending: false, isError: true }
          rf.updateNodeData(nodeId, err)
          updateNodeData(nodeId, err)
          return
        }
      } else {
        description = result.description as string

        if (result.source === 'comfyui') {
          const params = result.params as ComfyParams
          if (params?.model) {
            modelName = params.model.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '')
          }

          const imageNode = rf.getNodes().find(n => n.id === nodeId)
          if (imageNode) {
            const imageWidth = (imageNode.style?.width as number) ?? 220
            const metaPos = { x: imageNode.position.x + imageWidth + 20, y: imageNode.position.y }
            const metaId = uuid()
            addMetadataNode(metaId, metaPos, canvasId, params, nodeId)
            const metaNode = useCanvasStore.getState().nodes.find(n => n.id === metaId)
            if (metaNode) rf.addNodes(metaNode)
            linkedNodeMapRef.current.set(metaId, nodeId)
            linkedNodeMapRef.current.set(nodeId, metaId)
            window.api.createNode({
              id: metaId,
              canvasId,
              imagePath: '',
              x: metaPos.x,
              y: metaPos.y,
              width: 260,
              height: 200,
              source: 'comfyui',
              nodeType: 'metadata',
              linkedNodeId: nodeId,
              comfyParams: JSON.stringify(params),
            }).catch(console.error)
          }
        }
      }

      const tagSource = source === 'ai' ? 'ai' : 'metadata'
      const tags: Tag[] = parseDescriptionToTags(description, tagSource)
      const updates = { tags, metadataSource: source, modelName, isPending: false, isError: false }

      rf.updateNodeData(nodeId, updates)
      updateNodeData(nodeId, updates)

      await window.api.updateNodeMetadata(nodeId, source, modelName)
      await window.api.saveNodeTags(nodeId, tags.map(t => ({
        id: t.id, category: t.category, value: t.value, source: t.source,
      })))
    } catch (err) {
      console.error('[canvas] processImage error:', err)
      const error = { isPending: false, isError: true }
      rf.updateNodeData(nodeId, error)
      updateNodeData(nodeId, error)
    }
  }, [rf, updateNodeData, addMetadataNode, canvasId])

  const addNodes = useCallback(async (
    filePaths: string[],
    screenPos?: { x: number; y: number }
  ) => {
    if (filePaths.length === 0) return

    const basePos = screenPos
      ? screenToFlowPosition(screenPos)
      : screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })

    const sizes = await Promise.all(filePaths.map(getImageSize))

    filePaths.forEach((imagePath, i) => {
      const position = { x: basePos.x + i * 30, y: basePos.y + i * 30 }
      const { w, h } = sizes[i]
      const displayWidth = Math.round(Math.min(Math.max(TARGET_H * w / h, MIN_W), MAX_W))

      const nodeId = addImageNode(imagePath, position, canvasId, displayWidth)
      const newNode = useCanvasStore.getState().nodes.find(n => n.id === nodeId)
      if (newNode) rf.addNodes(newNode)

      // Start processing immediately — no useEffect needed
      if (!processingRef.current.has(nodeId)) {
        processingRef.current.add(nodeId)
        processImage(imagePath, nodeId).finally(() => processingRef.current.delete(nodeId))
      }

      window.api.createNode({
        id: nodeId,
        canvasId,
        imagePath,
        x: position.x,
        y: position.y,
        width: displayWidth,
        height: 200,
        source: 'none',
      }).catch(console.error)
    })
  }, [addImageNode, canvasId, screenToFlowPosition, rf, processImage])

  const handleImport = useCallback(async () => {
    const paths = await window.api.openFilePicker()
    if (paths.length > 0) addNodes(paths)
  }, [addNodes])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()

    const files = Array.from(e.dataTransfer.files)
    const imagePaths: string[] = []

    for (const file of files) {
      let p: string
      try {
        p = window.api.getPathForFile(file)
      } catch {
        p = (file as File & { path?: string }).path ?? ''
      }

      if (p && /\.(png|jpe?g|webp)$/i.test(p)) {
        imagePaths.push(p)
      }
    }

    if (imagePaths.length > 0) {
      addNodes(imagePaths, { x: e.clientX, y: e.clientY })
    }
  }, [addNodes])

  useEffect(() => {
    (window as Window & { addNodesToCanvas?: typeof addNodes }).addNodesToCanvas = addNodes
    return () => {
      delete (window as Window & { addNodesToCanvas?: typeof addNodes }).addNodesToCanvas
    }
  }, [addNodes])

  const handleNodesChange = useCallback((changes: NodeChange<Node<ImageNodeData>>[]) => {
    const extraChanges: NodeChange<Node<ImageNodeData>>[] = []

    changes.forEach(c => {
      // Ctrl+click: re-select nodes that RF deselected
      if (c.type === 'select' && !c.selected && ctrlHeldRef.current) {
        extraChanges.push({ type: 'select', id: c.id, selected: true })
        return
      }

      // Co-select linked node — O(1) map lookup
      if (c.type === 'select') {
        const linkedId = linkedNodeMapRef.current.get(c.id)
        if (linkedId) extraChanges.push({ type: 'select', id: linkedId, selected: c.selected })
      }

      // Co-move linked node
      if (c.type === 'position' && c.position) {
        // Skip programmatic moves to avoid feedback loop
        if (programmaticMovingRef.current.has(c.id)) {
          programmaticMovingRef.current.delete(c.id)
          if (c.dragging === false) window.api.updateNodePosition(c.id, c.position.x, c.position.y)
          prevPositionsRef.current.set(c.id, c.position)
          return
        }

        const prevPos = prevPositionsRef.current.get(c.id)
        if (prevPos) {
          const dx = c.position.x - prevPos.x
          const dy = c.position.y - prevPos.y

          if (dx !== 0 || dy !== 0) {
            const linkedId = linkedNodeMapRef.current.get(c.id)
            if (linkedId) {
              const linked = rf.getNode(linkedId) // O(1) instead of O(n)
              if (linked) {
                const newLinkedPos = { x: linked.position.x + dx, y: linked.position.y + dy }
                programmaticMovingRef.current.add(linkedId)
                extraChanges.push({ type: 'position', id: linkedId, position: newLinkedPos, dragging: c.dragging })
                if (c.dragging === false) {
                  window.api.updateNodePosition(linkedId, newLinkedPos.x, newLinkedPos.y)
                  useCanvasStore.getState().setNodes(
                    useCanvasStore.getState().nodes.map(n =>
                      n.id === linkedId ? { ...n, position: newLinkedPos } : n
                    )
                  )
                }
              }
            }
          }
        }

        prevPositionsRef.current.set(c.id, c.position)

        if (c.dragging === false) {
          window.api.updateNodePosition(c.id, c.position.x, c.position.y)
          useCanvasStore.getState().setNodes(
            useCanvasStore.getState().nodes.map(n =>
              n.id === c.id ? { ...n, position: c.position! } : n
            )
          )
        }
      }

      if (c.type === 'remove') {
        const linkedId = linkedNodeMapRef.current.get(c.id)
        if (linkedId) {
          linkedNodeMapRef.current.delete(c.id)
          linkedNodeMapRef.current.delete(linkedId)
          removeNode(linkedId)
          window.api.deleteNode(linkedId).catch(console.error)
        }
        removeNode(c.id)
        window.api.deleteNode(c.id).catch(console.error)
      }
    })

    if (extraChanges.length > 0) {
      rf.setNodes(current => applyNodeChanges(extraChanges, current))
    }
  }, [rf, removeNode])

  // Capture position at drag start for accurate first-frame delta
  const onNodeDragStart: NodeMouseHandler = useCallback((_e, node) => {
    prevPositionsRef.current.set(node.id, node.position)
  }, [])

  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      const { zoom } = getViewport()
      const delta = e.deltaY * 0.002
      const factor = Math.exp(-delta)
      const newZoom = Math.max(0.1, Math.min(4, zoom * factor))
      zoomTo(newZoom, { duration: 0 })
    }
    el.addEventListener('wheel', handler, { passive: false, capture: true })
    return () => el.removeEventListener('wheel', handler, { capture: true })
  }, [getViewport, zoomTo])

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 relative bg-black rounded-[16px] overflow-hidden"
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={onContainerContextMenu}
    >
      <ReactFlow
        defaultNodes={initialNodesRef.current}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={() => setContextMenu(null)}
        onInit={onInit}
        panOnDrag={[0, 1, 2]}
        selectionKeyCode="Control"
        zoomOnScroll
        zoomOnPinch
        deleteKeyCode="Delete"
        fitView={false}
        minZoom={0.1}
        maxZoom={4}
        nodesConnectable={false}
        nodesFocusable={false}
        elevateNodesOnSelect={false}
        autoPanOnNodeDrag={false}
        colorMode="dark"
        style={{ background: '#000000' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={48} size={1.5} color="rgba(255,255,255,0.28)" />
      </ReactFlow>

<CanvasToolbar />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          multiSelect={contextMenu.selectedIds.length > 1}
          onOrganize={organizeNodes}
          onAddToGroup={createGroup}
          onDelete={() => {
            const toDeleteIds = new Set(
              contextMenu.selectedIds.length > 1
                ? contextMenu.selectedIds
                : contextMenu.nodeId ? [contextMenu.nodeId] : []
            )
            rf.getNodes().forEach(n => {
              if (n.parentId && toDeleteIds.has(n.parentId)) toDeleteIds.add(n.id)
              if (n.data.linkedImageNodeId && toDeleteIds.has(n.data.linkedImageNodeId)) toDeleteIds.add(n.id)
            })
            toDeleteIds.forEach(id => {
              removeNode(id)
              window.api.deleteNode(id).catch(console.error)
            })
            rf.setNodes(current => current.filter(n => !toDeleteIds.has(n.id)))
            setContextMenu(null)
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

export default memo(Canvas)

function parseDescriptionToTags(description: string, source: 'metadata' | 'ai'): Tag[] {
  if (!description) return []

  const chunkRegex = /\{([^}]+)\}|\[([^\]]+)\]/g
  const chunks: string[] = []
  let match
  while ((match = chunkRegex.exec(description)) !== null) {
    const value = (match[1] ?? match[2]).trim()
    if (value) chunks.push(value)
  }

  if (chunks.length > 0) {
    return chunks.map(value => ({ id: uuid(), category: 'description' as const, value, source }))
  }

  return description.split(',')
    .map(s => s.trim())
    .filter(s => s.length > 1)
    .map(value => ({ id: uuid(), category: 'description' as const, value, source }))
}
