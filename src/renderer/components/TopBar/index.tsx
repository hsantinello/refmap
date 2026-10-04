import { useState, useEffect, useRef } from 'react'
import { type Node } from '@xyflow/react'
import { useCanvasStore, usePromptStore, type ImageNodeData, type ComfyParams } from '../../store'
import logoUrl from '../../assets/logo.png'
import { confirmar } from '../ConfirmDialog'
import UpdateBell from '../UpdateBell'
import { useT } from '../../i18n'
import { PROVEDORES, NOME_PROVEDOR, type Provedor } from '../../lib/provedores'

interface TopBarProps {
  onOpenSettings: (view?: 'choose' | 'api' | 'local') => void
  onOpenAbout: () => void
  onOpenTutorial: () => void
  hasApiKey: boolean
  apiProviderName?: string
  localActive?: boolean   // sem chave, mas IA local (Ollama) rodando
  localAvailable?: boolean // IA local instalada e rodando (mesmo com chave ativa)
  localModel?: string
  onConnectionChanged: () => void
  onUninstallLocal: () => void
  onSignOut: () => void
}

export default function TopBar({ onOpenSettings, onOpenAbout, onOpenTutorial, hasApiKey, apiProviderName, localActive, localAvailable, localModel, onConnectionChanged, onUninstallLocal, onSignOut }: TopBarProps) {
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const t = useT()
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
  const appLang         = useCanvasStore(s => s.appLang)
  const setAppLang      = useCanvasStore(s => s.setAppLang)

  const handleToggleLang = () => {
    const next = appLang === 'pt' ? 'en' : 'pt'
    setAppLang(next)
    window.api.setSetting('appLang', next)
  }

  // ── Menu de conexões ─────────────────────────────────────────────────────
  // Cada provedor guarda a própria chave: trocar de conexão NÃO apaga as outras.
  // O menu lista as chaves salvas (mascaradas) + IA local; clicar ativa.
  const [showConn, setShowConn] = useState(false)
  const [hoverLocal, setHoverLocal] = useState(false)   // painel "o que cada modelo local faz"
  const [conexoes, setConexoes] = useState<{ id: Provedor; mascara: string }[]>([])
  const [ativo, setAtivo] = useState<string>('anthropic')
  const connRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showConn) { setHoverLocal(false); return }
    const handleClick = (e: MouseEvent) => {
      if (connRef.current && !connRef.current.contains(e.target as globalThis.Node)) setShowConn(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showConn])

  const carregarConexoes = async () => {
    const lista: { id: Provedor; mascara: string }[] = []
    for (const id of PROVEDORES) {
      const mascara = await window.api.getApiKey(id)
      if (mascara) lista.push({ id, mascara })
    }
    setConexoes(lista)
    setAtivo(((await window.api.getSetting('aiProvider')) as string | null) ?? 'anthropic')
    return lista
  }

  const handleConnectionClick = async () => {
    if (showConn) { setShowConn(false); return }
    const lista = await carregarConexoes()
    // Nada salvo e sem IA local: não há o que escolher → tela de configuração.
    if (lista.length === 0 && !localAvailable) { onOpenSettings('choose'); return }
    setShowConn(true)
  }

  const ativarConexao = async (id: Provedor | 'local') => {
    setShowConn(false)
    await window.api.setSetting('aiProvider', id)
    onConnectionChanged()
  }

  const removerConexao = async (id: Provedor) => {
    setShowConn(false)
    const ok = await confirmar({
      titulo: t('topbar.removeKey.title', { provider: NOME_PROVEDOR[id] }),
      mensagem: t('topbar.removeKey.message'),
      confirmar: t('common.remove'),
      perigo: true,
    })
    if (!ok) return
    await window.api.setApiKey(id, '')
    // Apagou a conexão em uso: passa para outra chave salva, senão para a IA local.
    if (ativo === id) {
      const outra = conexoes.find(c => c.id !== id)
      await window.api.setSetting('aiProvider', outra ? outra.id : 'local')
    }
    onConnectionChanged()
  }

  // Desinstala a IA local (mesmo fluxo e confirmação da tela "IA Local").
  // Se ela era a conexão em uso e há chave salva, passa para essa chave.
  const desinstalarLocal = async () => {
    setShowConn(false)
    const ok = await confirmar({
      titulo: t('settings.local.uninstall.title'),
      mensagem: t('settings.local.uninstall.message'),
      confirmar: t('settings.local.uninstall.confirm'),
      perigo: true,
    })
    if (!ok) return
    if (ativo === 'local' && conexoes.length > 0) {
      await window.api.setSetting('aiProvider', conexoes[0].id)
      onConnectionChanged()
    }
    onUninstallLocal()
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
              isGroup: true, label: n.label ?? t('canvas.group.defaultLabel'),
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
    const name = t('topbar.newCanvas.name')
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

    const name = store.canvasList.find(c => c.id === id)?.name ?? t('topbar.deleteCanvas.fallbackName')

    const hasNodes = store.currentCanvasId === id
      ? store.nodes.length > 0
      : ((await window.api.loadCanvas(id)) as { nodes: unknown[] }).nodes.length > 0

    if (hasNodes) {
      const confirmed = await confirmar({
        titulo: t('topbar.deleteCanvas.title', { name }),
        mensagem: t('topbar.deleteCanvas.message'),
        confirmar: t('common.delete'),
        perigo: true,
      })
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
        comfy_params?: string; linked_node_id?: string; tag_lang?: string
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
            label: t('canvas.group.defaultLabel'),
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
            tagLang: (n.tag_lang as 'en' | 'pt') ?? 'en',
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
                  {t('topbar.menu.file')}
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
                    {t('topbar.menu.saveCanvas')}
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
                    {t('topbar.menu.saveCanvasAs')}
                  </button>
                  <button
                    onClick={() => { handleOpen(); setShowLogoMenu(false); setShowArquivoSub(false) }}
                    style={{ padding: '10px 20px' }}
                    className="w-full flex items-center gap-3 text-[12px] text-white/60 hover:text-white/90 hover:bg-white/[0.05] transition-colors text-left"
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0">
                      <path d="M1 4a1 1 0 011-1h3l1.5 1.5H12a1 1 0 011 1V11a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.3"/>
                    </svg>
                    {t('topbar.menu.openCanvas')}
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
                {t('topbar.menu.onTop')}
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
                {t('topbar.menu.sfwMode')}
              </div>
              <div className={`relative w-8 h-[18px] rounded-full transition-colors duration-200 shrink-0 ${sfwMode ? 'bg-orange-500' : 'bg-white/[0.12]'}`}>
                <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-all duration-200 ${sfwMode ? 'left-[18px]' : 'left-[2px]'}`} />
              </div>
            </button>
            <div className="h-px bg-white/[0.05] mx-3" />
            <button
              onClick={handleToggleLang}
              style={{ padding: '10px 20px' }}
              className="w-full flex items-center justify-between gap-3 text-[12px] text-white/60 hover:text-white/90 hover:bg-white/[0.05] transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0">
                  <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M1 7h12M7 1c1.8 1.6 2.8 3.8 2.8 6S8.8 12.4 7 14M7 1C5.2 2.6 4.2 4.8 4.2 7S5.2 12.4 7 14" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                </svg>
                {t('topbar.menu.language')}
              </div>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/[0.08] text-white/70 shrink-0">
                {appLang === 'pt' ? 'PT-BR' : 'EN'}
              </span>
            </button>
            <button
              onClick={() => { onOpenTutorial(); setShowLogoMenu(false) }}
              style={{ padding: '10px 20px' }}
              className="w-full flex items-center gap-3 text-[12px] text-white/60 hover:text-white/90 hover:bg-white/[0.05] transition-colors text-left"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0">
                <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M7 6.5v4M7 4.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              {t('topbar.menu.help')}
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
              {t('topbar.menu.support')}
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
              {t('topbar.menu.signOut')}
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
          title={t('topbar.newCanvas.tooltip')}
        >
          +
        </button>
      </div>


      {/* Right actions */}
      <div
        className="flex items-center gap-2 px-3 shrink-0"
      >
        <UpdateBell />

        <div ref={connRef} className="relative no-drag-region">
        <button
          onClick={handleConnectionClick}
          className="no-drag-region flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.09] hover:border-white/[0.1] transition-all"
        >
          {hasApiKey ? (
            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-green-400" />
          ) : localActive ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
            </svg>
          ) : (
            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-orange-400" />
          )}
          <span className="text-[11px] text-white/50">
            {hasApiKey
              ? (apiProviderName ? t('topbar.connection.apiNamed', { provider: apiProviderName }) : t('topbar.connection.api'))
              : localActive
                ? `${t('topbar.connection.local')}${localModel ? ` · ${localModel}` : ''}`
                : t('topbar.connection.none')}
          </span>
        </button>

        {showConn && (
          <div className="absolute right-0 top-full mt-2 w-[270px] bg-black rounded-xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8)] z-50 py-1.5">
            <div className="px-4 pt-1.5 pb-1 text-[9px] font-bold tracking-widest uppercase text-white/30">{t('topbar.conn.header')}</div>

            {conexoes.map(c => {
              const on = hasApiKey && ativo === c.id
              return (
                <div key={c.id} className="group flex items-center hover:bg-white/[0.05] transition-colors">
                  <button
                    onClick={() => ativarConexao(c.id)}
                    style={{ padding: '9px 0 9px 16px' }}
                    className="flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${on ? 'bg-green-400' : 'bg-white/15'}`} />
                    <span className={`text-[12px] shrink-0 ${on ? 'text-white/90' : 'text-white/60'}`}>{NOME_PROVEDOR[c.id]}</span>
                    <span className="text-[10px] font-mono text-white/25 truncate">{c.mascara}</span>
                  </button>
                  <button
                    onClick={() => removerConexao(c.id)}
                    title={t('topbar.conn.remove')}
                    className="px-3 self-stretch flex items-center text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                    </svg>
                  </button>
                </div>
              )
            })}

            {/* IA local: sempre na lista. Sem Ollama, leva à tela de instalação.
                Passar o mouse mostra os modelos que ela instala e para que serve cada um. */}
            <div
              className="relative group flex items-center hover:bg-white/[0.05] transition-colors"
              onMouseEnter={() => setHoverLocal(true)}
              onMouseLeave={() => setHoverLocal(false)}
            >
            {hoverLocal && (
              <div className="absolute right-full top-0 mr-2 w-[260px] bg-black rounded-xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8)] px-4 py-3 pointer-events-none">
                <div className="text-[9px] font-bold tracking-widest uppercase text-white/30 mb-2">{t('topbar.conn.localModels')}</div>
                <ul className="space-y-1.5 text-[11px] text-white/35 leading-relaxed">
                  {([
                    ['Gemma 3 4B', t('settings.local.model.vision')],
                    ['Dolphin Mistral', t('settings.local.model.text')],
                    ['Whisper', t('settings.local.model.voice')],
                  ] as const).map(([nome, desc]) => (
                    <li key={nome} className="flex gap-1.5">
                      <span className="text-orange-400/60 shrink-0">•</span>
                      <span><span className="text-white/65">{nome}</span> {desc}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              onClick={() => {
                if (localAvailable) { void ativarConexao('local'); return }
                setShowConn(false)
                onOpenSettings('local')
              }}
              style={{ padding: localAvailable ? '9px 0 9px 16px' : '9px 16px' }}
              className="flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={localActive ? '#34D399' : 'rgba(255,255,255,0.3)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
              </svg>
              <span className={`text-[12px] shrink-0 ${localActive ? 'text-white/90' : 'text-white/60'}`}>
                {localAvailable ? t('topbar.connection.local') : t('topbar.conn.localInstall')}
              </span>
              {localAvailable && localModel && <span className="text-[10px] font-mono text-white/25 truncate">{localModel}</span>}
            </button>
            {localAvailable && (
              <button
                onClick={desinstalarLocal}
                title={t('settings.local.uninstall')}
                className="px-3 self-stretch flex items-center text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                </svg>
              </button>
            )}
            </div>

            <div className="h-px bg-white/[0.06] my-1" />

            <button
              onClick={() => { setShowConn(false); onOpenSettings('api') }}
              style={{ padding: '9px 16px' }}
              className="w-full flex items-center gap-2.5 text-left text-[12px] text-white/60 hover:text-white/90 hover:bg-white/[0.05] transition-colors cursor-pointer"
            >
              <span className="w-1.5 text-center text-white/40 shrink-0">+</span>
              {t('topbar.conn.add')}
            </button>
          </div>
        )}
        </div>

      </div>

      {/* Espaço reservado para os controles nativos do Windows (~138px) */}
      <div className="w-[138px] shrink-0" />
    </div>
  )
}
