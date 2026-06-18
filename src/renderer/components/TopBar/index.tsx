import { useState, useEffect, useRef } from 'react'
import { type Node } from '@xyflow/react'
import { useCanvasStore, usePromptStore, type ImageNodeData, type ComfyParams } from '../../store'
import logoUrl from '../../assets/logo.png'

interface TopBarProps {
  onOpenSettings: () => void
  onOpenAbout: () => void
  onOpenTutorial: () => void
  hasApiKey: boolean
  apiProviderName?: string
  onRemoveApiKey: () => void
  onSignOut: () => void
}

export default function TopBar({ onOpenSettings, onOpenAbout, onOpenTutorial, hasApiKey, apiProviderName, onRemoveApiKey, onSignOut }: TopBarProps) {
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [showLogoMenu, setShowLogoMenu] = useState(false)
  const [showArquivoSub, setShowArquivoSub] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const logoMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showLogoMenu) return
    const handleClick = (e: MouseEvent) => {
      if (logoMenuRef.current && !logoMenuRef.current.contains(e.target as Node)) {
        setShowLogoMenu(false)
        setShowArquivoSub(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showLogoMenu])
  const canvasList      = useCanvasStore(s => s.canvasList)
  const currentCanvasId = useCanvasStore(s => s.currentCanvasId)
  const sfwMode         = useCanvasStore(s => s.sfwMode)
  const setSfwMode      = useCanvasStore(s => s.setSfwMode)

  const handleConnectionClick = () => {
    if (!hasApiKey) { onOpenSettings(); return }
    const confirmed = window.confirm('Remover sua API Key? O app não conseguirá analisar imagens sem ela.')
    if (confirmed) onRemoveApiKey()
  }


  const handleAlwaysOnTop = async () => {
    const next = !alwaysOnTop
    await window.api.setAlwaysOnTop(next)
    setAlwaysOnTop(next)
  }

  const handleSave = async () => {
    const store = useCanvasStore.getState()
    const canvasName = store.canvasList.find(c => c.id === store.currentCanvasId)?.name ?? 'canvas'
    const nodesData = store.nodes.map(n => ({
      id: n.id,
      nodeType: n.type,
      parentId: n.parentId,
      imagePath: n.data.imagePath,
      positionX: n.position.x,
      positionY: n.position.y,
      width: (n.style?.width as number) ?? 240,
      height: (n.style?.height as number) ?? undefined,
      metadataSource: n.data.metadataSource,
      modelName: n.data.modelName,
      label: n.data.label,
      isMetadataNode: n.data.isMetadataNode ?? false,
      comfyParams: n.data.comfyParams ? JSON.stringify(n.data.comfyParams) : undefined,
      linkedImageNodeId: n.data.linkedImageNodeId,
    }))
    const tagsData = store.nodes.flatMap(n =>
      n.data.tags.map(t => ({ ...t, nodeId: n.id }))
    )
    await window.api.exportCanvasFile({ name: canvasName, nodes: nodesData, tags: tagsData })
    setShowLogoMenu(false)
  }

  const handleOpen = async () => {
    setShowLogoMenu(false)
    const file = await window.api.openCanvasFile()
    if (!file) return

    type SavedNode = {
      id: string; nodeType?: string; parentId?: string
      imagePath: string; positionX: number; positionY: number
      width: number; height?: number; metadataSource: string
      modelName?: string; label?: string
      isMetadataNode?: boolean; comfyParams?: string | ComfyParams
      linkedImageNodeId?: string
    }
    type SavedTag = { id: string; nodeId: string; category: string; value: string; source: string }
    const saved = file as { version: number; name: string; nodes: SavedNode[]; tags: SavedTag[] }

    const canvasId = await window.api.createCanvas(saved.name) as string
    const store = useCanvasStore.getState()
    // NOTE: setCurrentCanvasId is called AFTER setNodes below so PixiCanvas
    // finds the correct nodes when its canvas-switch effect fires.

    // Map old IDs → new IDs to avoid DB conflicts
    const idMap = new Map<string, string>()
    for (const n of saved.nodes) idMap.set(n.id, crypto.randomUUID())

    const isMetadataNode = (n: SavedNode) =>
      n.isMetadataNode === true || n.nodeType === 'metadataNode'

    const nonMetaNodes = saved.nodes.filter(n => !isMetadataNode(n))
    const metaNodes = saved.nodes.filter(n => isMetadataNode(n))

    const flowNodes: Node<ImageNodeData>[] = []

    // Pass 1: groups and image nodes
    for (const n of nonMetaNodes) {
      try {
        const newId = idMap.get(n.id)!
        const newParentId = n.parentId ? idMap.get(n.parentId) : undefined
        const isGroup = n.nodeType === 'groupNode'

        await window.api.createNode({
          id: newId, canvasId, imagePath: n.imagePath ?? '',
          x: n.positionX, y: n.positionY,
          width: n.width ?? (isGroup ? 400 : 240),
          height: n.height ?? 200,
          source: n.metadataSource ?? 'none',
          nodeType: isGroup ? 'group' : 'image',
          parentId: newParentId,
        })

        if (!isGroup && n.metadataSource && n.metadataSource !== 'none') {
          await window.api.updateNodeMetadata(newId, n.metadataSource, n.modelName)
        }

        if (isGroup) {
          flowNodes.push({
            id: newId, type: 'groupNode',
            position: { x: n.positionX, y: n.positionY },
            style: { width: n.width ?? 400, height: n.height ?? 300 },
            data: {
              imagePath: '', tags: [], metadataSource: 'group',
              isPending: false, isError: false, canvasId,
              isGroup: true, label: n.label ?? 'Grupo',
            },
          })
        } else {
          const nodeTags = saved.tags
            .filter(t => t.nodeId === n.id)
            .map(t => ({ id: crypto.randomUUID(), category: t.category as 'style', value: t.value, source: t.source as 'metadata' }))
          if (nodeTags.length > 0) await window.api.saveNodeTags(newId, nodeTags)
          flowNodes.push({
            id: newId, type: 'imageNode',
            position: { x: n.positionX, y: n.positionY },
            style: { width: n.width || 240 },
            ...(newParentId ? { parentId: newParentId } : {}),
            data: {
              imagePath: n.imagePath ?? '', metadataSource: n.metadataSource as 'comfyui',
              modelName: n.modelName, isPending: false, isError: false, canvasId,
              tags: nodeTags,
            },
          })
        }
      } catch (err) {
        console.error('[handleOpen] pass1 node error:', n, err)
      }
    }

    // Pass 2: metadata nodes — all image nodes are now in flowNodes
    for (const n of metaNodes) {
      try {
        const newId = idMap.get(n.id)!
        const newLinkedId = n.linkedImageNodeId ? idMap.get(n.linkedImageNodeId) : undefined

        const comfyParamsStr = typeof n.comfyParams === 'string'
          ? n.comfyParams
          : n.comfyParams ? JSON.stringify(n.comfyParams) : undefined
        const comfyParamsObj: ComfyParams | undefined = comfyParamsStr
          ? (() => { try { return JSON.parse(comfyParamsStr) } catch { return undefined } })()
          : undefined

        await window.api.createNode({
          id: newId, canvasId, imagePath: '',
          x: n.positionX, y: n.positionY,
          width: n.width ?? 260, height: n.height ?? 200,
          source: 'comfyui', nodeType: 'metadata',
          linkedNodeId: newLinkedId,
          comfyParams: comfyParamsStr,
        })

        flowNodes.push({
          id: newId, type: 'metadataNode',
          position: { x: n.positionX, y: n.positionY },
          style: { width: n.width || 260 },
          data: {
            imagePath: '', tags: [], metadataSource: 'comfyui',
            isPending: false, isError: false, canvasId,
            comfyParams: comfyParamsObj, linkedImageNodeId: newLinkedId, isMetadataNode: true,
          },
        })
      } catch (err) {
        console.error('[handleOpen] pass2 metadata error:', n, err)
      }
    }

    // Set nodes FIRST, then change canvas ID — same pattern as handleSwitchCanvas
    store.setCanvasList([...store.canvasList, { id: canvasId, name: saved.name, updated_at: Date.now() }])
    store.setNodes(flowNodes)
    store.setCurrentCanvasId(canvasId)
    await window.api.setSetting('lastCanvasId', canvasId)
    usePromptStore.getState().clearAll()
  }

  const handleNewCanvas = async () => {
    const name = 'Novo Canvas'
    const id = await window.api.createCanvas(name)
    const store = useCanvasStore.getState()
    store.setCanvasList([...store.canvasList, { id, name, updated_at: Date.now() }])
    store.setCurrentCanvasId(id)
    store.setNodes([])
    usePromptStore.getState().clearAll()
  }

  const handleStartRename = (e: React.MouseEvent, c: { id: string; name: string }) => {
    e.stopPropagation()
    setRenamingId(c.id)
    setRenameValue(c.name)
    setTimeout(() => { renameInputRef.current?.focus(); renameInputRef.current?.select() }, 30)
  }

  const confirmRename = async (id: string) => {
    const name = renameValue.trim()
    if (name && name !== canvasList.find(c => c.id === id)?.name) {
      await window.api.renameCanvas(id, name)
      useCanvasStore.getState().setCanvasList(
        canvasList.map(c => c.id === id ? { ...c, name } : c)
      )
    }
    setRenamingId(null)
  }

  const handleDeleteCanvas = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const store = useCanvasStore.getState()
    if (store.canvasList.length <= 1) return

    const name = store.canvasList.find(c => c.id === id)?.name ?? 'este canvas'

    const hasNodes = store.currentCanvasId === id
      ? store.nodes.length > 0
      : ((await window.api.loadCanvas(id)) as { nodes: unknown[] }).nodes.length > 0

    if (hasNodes) {
      const confirmed = window.confirm(`Apagar "${name}"? Esta ação não pode ser desfeita.`)
      if (!confirmed) return
    }

    await window.api.deleteCanvas(id)
    const next = store.canvasList.filter(c => c.id !== id)
    store.setCanvasList(next)
    if (store.currentCanvasId === id) {
      const fallback = next[next.length - 1]
      await handleSwitchCanvas(fallback.id)
    }
  }


  const handleSwitchCanvas = async (id: string) => {
    const { nodes, tags } = await window.api.loadCanvas(id) as {
      nodes: {
        id: string; image_path: string; position_x: number
        position_y: number; width: number; height: number; metadata_source: string
        model_name?: string; node_type?: string; parent_id?: string | null
        comfy_params?: string; linked_node_id?: string
      }[]
      tags: { id: string; node_id: string; category: string; value: string; source: string }[]
    }

    // Build flow nodes BEFORE changing the canvas ID so the store is ready
    // when PixiCanvas's canvas-switch effect fires.
    const nodeTypeOrder = (t: string | undefined) => t === 'group' ? 0 : t === 'metadata' ? 2 : 1
    const sorted = [...nodes].sort((a, b) => nodeTypeOrder(a.node_type) - nodeTypeOrder(b.node_type))

    const flowNodes: Node<ImageNodeData>[] = []
    let imageIndex = 0
    for (const n of sorted) {
      if (n.node_type === 'group') {
        flowNodes.push({
          id: n.id,
          type: 'groupNode' as const,
          position: { x: n.position_x, y: n.position_y },
          style: { width: n.width, height: n.height },
          data: {
            imagePath: '',
            tags: [],
            metadataSource: 'group' as const,
            isPending: false,
            isError: false,
            canvasId: id,
            isGroup: true,
            label: 'Grupo',
            modelName: n.model_name ?? undefined, // stores saved group color
          },
        })
      } else if (n.node_type === 'metadata') {
        flowNodes.push({
          id: n.id,
          type: 'metadataNode' as const,
          position: { x: n.position_x, y: n.position_y },
          style: { width: n.width || 260 },
          data: {
            imagePath: '',
            tags: [],
            metadataSource: 'comfyui' as const,
            isPending: false,
            isError: false,
            canvasId: id,
            comfyParams: n.comfy_params ? JSON.parse(n.comfy_params) : {},
            linkedImageNodeId: n.linked_node_id ?? undefined,
            isMetadataNode: true,
          },
        })
      } else {
        flowNodes.push({
          id: n.id,
          type: 'imageNode' as const,
          position: { x: n.position_x, y: n.position_y },
          style: { width: n.width },
          ...(n.parent_id ? { parentId: n.parent_id } : {}),
          data: {
            imagePath: n.image_path,
            tags: tags
              .filter(t => t.node_id === n.id)
              .map(t => ({ id: t.id, category: t.category as 'style', value: t.value, source: t.source as 'metadata' })),
            metadataSource: n.metadata_source as 'comfyui',
            modelName: n.model_name ?? undefined,
            isPending: false,
            isError: false,
            canvasId: id,
            animationDelay: imageIndex * 50,
          },
        })
        imageIndex++
      }
    }

    // Set nodes THEN change ID — PixiCanvas reads store.nodes when it detects the ID change
    const store = useCanvasStore.getState()
    store.setNodes(flowNodes)
    store.setCurrentCanvasId(id)
    await window.api.setSetting('lastCanvasId', id)

    const savedPrompt = await window.api.getSetting(`promptBuilder_${id}`)
    if (savedPrompt) {
      try { usePromptStore.getState().setPromptTags(JSON.parse(savedPrompt)) }
      catch {}
    } else {
      usePromptStore.getState().clearAll()
    }
  }

  return (
    <div
      className="drag-region flex items-center h-8 bg-black shrink-0 select-none"
    >
      {/* Logo + dropdown */}
      <div
        ref={logoMenuRef}
        className="relative flex items-center gap-2.5 pl-[14px] pr-1 shrink-0"
      >
        <img
          src={logoUrl}
          alt="Ref Map"
          className="no-drag-region w-[30px] h-[30px] rounded-md shrink-0 cursor-pointer"
          onClick={() => setShowLogoMenu(v => !v)}
        />
        {showLogoMenu && (
          <div
            className="no-drag-region absolute top-full left-4 mt-2 w-[170px] bg-black rounded-xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8)] z-50"
            onMouseLeave={() => { setShowLogoMenu(false); setShowArquivoSub(false) }}
          >
            {/* Arquivo item com submenu flyout */}
            <div
              className="relative"
              onMouseEnter={() => setShowArquivoSub(true)}
              onMouseLeave={() => setShowArquivoSub(false)}
            >
              <button
                style={{ padding: '10px 20px' }}
                className="w-full flex items-center justify-between gap-3 text-[12px] text-white/60 hover:text-white/90 hover:bg-white/[0.05] transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0">
                    <path d="M1 4a1 1 0 011-1h3l1.5 1.5H12a1 1 0 011 1V11a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.3"/>
                  </svg>
                  Arquivo
                </div>
                <svg width="6" height="10" viewBox="0 0 6 10" fill="none" className="shrink-0 opacity-40">
                  <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {showArquivoSub && (
                <div className="absolute left-full top-0 w-[200px] bg-black rounded-xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8)] z-50 whitespace-nowrap">
                  <button
                    onClick={() => { handleSave(); setShowLogoMenu(false); setShowArquivoSub(false) }}
                    style={{ padding: '10px 20px' }}
                    className="w-full flex items-center gap-3 text-[12px] text-white/60 hover:text-white/90 hover:bg-white/[0.05] transition-colors text-left"
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0">
                      <path d="M2 2h8l2 2v8a1 1 0 01-1 1H3a1 1 0 01-1-1V2z" stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M5 13V8h4v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M4 2h6v3H4z" stroke="currentColor" strokeWidth="1.3"/>
                    </svg>
                    Salvar Canvas
                  </button>
                  <button
                    onClick={() => { handleSave(); setShowLogoMenu(false); setShowArquivoSub(false) }}
                    style={{ padding: '10px 20px' }}
                    className="w-full flex items-center gap-3 text-[12px] text-white/60 hover:text-white/90 hover:bg-white/[0.05] transition-colors text-left"
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0">
                      <path d="M2 2h8l2 2v8a1 1 0 01-1 1H3a1 1 0 01-1-1V2z" stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M5 13V8h4v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M4 2h6v3H4z" stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M9 2v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                    </svg>
                    Salvar Canvas Como
                  </button>
                  <button
                    onClick={() => { handleOpen(); setShowLogoMenu(false); setShowArquivoSub(false) }}
                    style={{ padding: '10px 20px' }}
                    className="w-full flex items-center gap-3 text-[12px] text-white/60 hover:text-white/90 hover:bg-white/[0.05] transition-colors text-left"
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0">
                      <path d="M1 4a1 1 0 011-1h3l1.5 1.5H12a1 1 0 011 1V11a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.3"/>
                    </svg>
                    Abrir Canvas
                  </button>
                </div>
              )}
            </div>
            <div className="h-px bg-white/[0.05] mx-3" />
            <button
              onClick={() => { handleAlwaysOnTop() }}
              style={{ padding: '10px 20px' }}
              className="w-full flex items-center justify-between gap-3 text-[12px] text-white/60 hover:text-white/90 hover:bg-white/[0.05] transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0">
                  <path d="M7 1v8M4 4l3-3 3 3M3 13h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                On Top
              </div>
              <div className={`relative w-8 h-[18px] rounded-full transition-colors duration-200 shrink-0 ${alwaysOnTop ? 'bg-orange-500' : 'bg-white/[0.12]'}`}>
                <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-all duration-200 ${alwaysOnTop ? 'left-[18px]' : 'left-[2px]'}`} />
              </div>
            </button>
            <button
              onClick={() => setSfwMode(!sfwMode)}
              style={{ padding: '10px 20px' }}
              className="w-full flex items-center justify-between gap-3 text-[12px] text-white/60 hover:text-white/90 hover:bg-white/[0.05] transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0">
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M4 7c0-1.657 1.343-3 3-3s3 1.343 3 3-1.343 3-3 3-3-1.343-3-3z" fill="currentColor" opacity="0.4"/>
                  <line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className={sfwMode ? '' : 'hidden'}/>
                </svg>
                Modo SFW
              </div>
              <div className={`relative w-8 h-[18px] rounded-full transition-colors duration-200 shrink-0 ${sfwMode ? 'bg-orange-500' : 'bg-white/[0.12]'}`}>
                <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-all duration-200 ${sfwMode ? 'left-[18px]' : 'left-[2px]'}`} />
              </div>
            </button>
            <div className="h-px bg-white/[0.05] mx-3" />
            <button
              onClick={() => { onOpenTutorial(); setShowLogoMenu(false) }}
              style={{ padding: '10px 20px' }}
              className="w-full flex items-center gap-3 text-[12px] text-white/60 hover:text-white/90 hover:bg-white/[0.05] transition-colors text-left"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0">
                <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M7 6.5v4M7 4.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              Ajuda
            </button>
            <button
              onClick={() => { window.api.openExternal('mailto:app@refmap.santinello.com.br?subject=Suporte%20REFMAP'); setShowLogoMenu(false) }}
              style={{ padding: '10px 20px' }}
              className="w-full flex items-center gap-3 text-[12px] text-white/60 hover:text-white/90 hover:bg-white/[0.05] transition-colors text-left"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0">
                <rect x="1" y="3" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M1 4l6 4 6-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Suporte
            </button>
            <div className="h-px bg-white/[0.05] mx-3" />
            <button
              onClick={() => { onSignOut(); setShowLogoMenu(false) }}
              style={{ padding: '10px 20px' }}
              className="w-full flex items-center gap-3 text-[12px] text-white/40 hover:text-red-400 hover:bg-white/[0.05] transition-colors text-left"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0">
                <path d="M5 2H2a1 1 0 00-1 1v8a1 1 0 001 1h3M9 10l3-3-3-3M6 7h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Sair
            </button>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="w-px h-8 bg-white/[0.1] mx-1 shrink-0" />

      {/* Canvas Tabs */}
      <div
        className="flex items-stretch flex-1 overflow-hidden h-full"
      >
        {canvasList.map(c => (
          <button
            key={c.id}
            onClick={() => handleSwitchCanvas(c.id)}
            className={`no-drag-region
              min-w-[60px] px-1.5 h-full text-[14px] transition-all whitespace-nowrap flex items-center justify-between gap-1
              border-r border-white/[0.05] relative
              ${currentCanvasId === c.id ? 'text-white font-medium' : 'text-white/40 hover:text-white/70'}
            `}
          >
            <div className={`flex items-center gap-1.5 min-w-0 px-1.5 py-1 rounded-lg transition-colors ${currentCanvasId === c.id ? 'bg-white/[0.05]' : 'hover:bg-white/[0.04]'}`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${currentCanvasId === c.id ? 'bg-orange-500' : 'bg-transparent'}`} />
              {renamingId === c.id ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') confirmRename(c.id)
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onBlur={() => confirmRename(c.id)}
                  onClick={e => e.stopPropagation()}
                  className="bg-transparent border-b border-white/30 text-white/90 text-[12px] outline-none w-full min-w-0"
                />
              ) : (
                <span onDoubleClick={e => handleStartRename(e, c)}>{c.name}</span>
              )}
            </div>
            {canvasList.length > 1 && (
              <span
                onClick={e => handleDeleteCanvas(e, c.id)}
                className="w-3.5 h-3.5 flex items-center justify-center rounded text-white/20 hover:text-white/70 hover:bg-white/[0.1] transition-all shrink-0"
              >
                <svg width="6" height="6" viewBox="0 0 8 8" fill="none">
                  <path d="M1 1L7 7M7 1L1 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </span>
            )}
          </button>
        ))}
        <button
          onClick={handleNewCanvas}
          className="no-drag-region px-3 h-full text-white/25 hover:text-white/60 hover:bg-white/[0.04] transition-colors text-lg flex items-center border-r border-white/[0.05]"
          title="Novo canvas"
        >
          +
        </button>
      </div>


      {/* Right actions */}
      <div
        className="flex items-center gap-2 px-3 shrink-0"
      >
        <button
          onClick={handleConnectionClick}
          className="no-drag-region flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.09] hover:border-white/[0.1] transition-all"
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasApiKey ? 'bg-green-400' : 'bg-orange-400'}`} />
          <span className="text-[11px] text-white/50">
            {hasApiKey ? (apiProviderName ? `API conectada — ${apiProviderName}` : 'API Conectada') : 'Conecte sua API'}
          </span>
        </button>

      </div>

      {/* Espaço reservado para os controles nativos do Windows (~138px) */}
      <div className="w-[138px] shrink-0" />
    </div>
  )
}
