import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { type Session } from '@supabase/supabase-js'
import logoUrl from './assets/logo.png'
import TopBar from './components/TopBar'
import PixiCanvas from './components/PixiCanvas'
import PromptBuilder from './components/PromptBuilder'
import Settings from './components/Settings'
import Onboarding from './components/Onboarding'
import About from './components/About'
import Auth from './components/Auth'
import UpdateBanner from './components/UpdateBanner'
import LocalInstallBanner, { type LocalInstallProgress } from './components/LocalInstallBanner'
import { ensureWhisper, isWhisperReady } from './lib/localWhisper'
import { useCanvasStore, usePromptStore } from './store'
import { supabase, isLicenseActive } from './lib/supabase'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [showSettings, setShowSettings] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [ready, setReady] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [apiProviderName, setApiProviderName] = useState('')
  const [localOk, setLocalOk] = useState(false)
  const [localModel, setLocalModel] = useState('')
  const [settingsView, setSettingsView] = useState<'choose' | 'api' | 'local'>('choose')
  const [installProgress, setInstallProgress] = useState<LocalInstallProgress | null>(null)

  // Dispara a instalação da IA local. O progresso vem por evento e é tratado no
  // effect abaixo (vive no App → persiste mesmo com as Settings fechadas).
  // Ao terminar o Ollama (fase 'done'), o effect encadeia o download do modelo de voz.
  const startLocalInstall = () => {
    setInstallProgress({ phase: 'checking', percent: -1, message: 'Iniciando…' })
    window.api.installLocalAI().catch(() => {})
  }

  // Baixa o modelo de transcrição (Whisper, ~250MB) no renderer, mostrando o progresso
  // na mesma barra da IA local — assim o "Baixar" traz texto + voz de uma vez só.
  const downloadWhisperModel = async () => {
    if (isWhisperReady()) {
      setInstallProgress({ phase: 'done', percent: 100, message: 'Pronto' })
      setTimeout(() => setInstallProgress(null), 2500)
      return
    }
    const files = new Map<string, { loaded: number; total: number }>()
    setInstallProgress({ phase: 'downloading', percent: -1, message: 'Baixando modelo de voz' })
    try {
      await ensureWhisper(p => {
        if (p.file && typeof p.total === 'number') {
          const loaded = p.status === 'done' ? p.total : (typeof p.loaded === 'number' ? p.loaded : 0)
          files.set(p.file, { loaded, total: p.total })
        }
        let l = 0, t = 0
        for (const f of files.values()) { l += f.loaded; t += f.total }
        const percent = t > 0 ? Math.min(99, Math.round((l / t) * 100)) : -1
        setInstallProgress({ phase: 'downloading', percent, message: 'Baixando modelo de voz' })
      })
      setInstallProgress({ phase: 'done', percent: 100, message: 'Pronto' })
    } catch {
      // Whisper falhou, mas a IA local de texto já instalou — não trava o fluxo.
      setInstallProgress({ phase: 'done', percent: 100, message: 'IA local pronta' })
    }
    setTimeout(() => setInstallProgress(null), 2500)
  }

  const startLocalUninstall = () => {
    setInstallProgress({ phase: 'uninstalling', percent: -1, message: 'Desinstalando o Ollama…' })
    window.api.uninstallLocalAI().catch(() => {})
  }
  // Primeira execução: abre a tela de escolha (Local vs API) antes do tutorial.
  const firstRunAiRef = useRef(false)

  const openSettings = (view: 'choose' | 'api' | 'local' = 'choose') => {
    setSettingsView(view)
    setShowSettings(true)
  }

  const setCanvasList      = useCanvasStore(s => s.setCanvasList)
  const setCurrentCanvasId = useCanvasStore(s => s.setCurrentCanvasId)
  const setNodes           = useCanvasStore(s => s.setNodes)
  const currentCanvasId    = useCanvasStore(s => s.currentCanvasId)

  useEffect(() => {
    let mounted = true
    // No boot, VALIDA de verdade a sessão guardada. O clássico "Invalid Refresh Token:
    // Refresh Token Not Found" acontece quando sobra uma sessão podre no disco: ao tentar
    // se renovar no fundo, ela dispara um SIGNED_OUT que atropela um login novo (era isso
    // que derrubava o "Entrar"). Então: se getUser falhar, a sessão é inválida → limpamos
    // ANTES de qualquer login, pra ela não ter como interferir.
    ;(async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (data.session) {
          const { error } = await supabase.auth.getUser()
          if (error) {
            await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
            if (mounted) setSession(null)
            return
          }
        }
        if (mounted) setSession(data.session)
      } catch {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
        if (mounted) setSession(null)
      }
    })()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setSession(session)
    })
    return () => { mounted = false; subscription.unsubscribe() }
  }, [])

  // Revalida a licença: se o e-mail do usuário sair da tabela `licenses`, desloga.
  // Fail-open: só desloga quando a resposta é AUTORITATIVA (licença removida = false).
  // Erro de rede / servidor indisponível (null) NÃO desloga — evita expulsar quem
  // está offline. Revalida ao abrir, ao focar a janela e a cada 5 min.
  useEffect(() => {
    const email = session?.user?.email
    if (!email) return

    let cancelled = false
    const validate = async () => {
      const active = await isLicenseActive(email)
      if (!cancelled && active === false) await supabase.auth.signOut()
    }

    validate()
    const interval = setInterval(validate, 5 * 60 * 1000)
    const onFocus = () => validate()
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [session])

  // Open settings from anywhere via custom event
  useEffect(() => {
    const handler = () => { setSettingsView('choose'); setShowSettings(true) }
    window.addEventListener('open-settings', handler)
    return () => window.removeEventListener('open-settings', handler)
  }, [])

  // Status da IA local (Ollama). Revalida ao mudar a chave, ao focar a janela e
  // a cada 20s — assim, se o Ollama for desinstalado/parado com o app aberto, o
  // pill volta para "Configure seu Ref Map" em vez de continuar mostrando "IA Local".
  useEffect(() => {
    const check = () => window.api.getLocalStatus()
      .then(s => { setLocalOk(s.ok); setLocalModel(s.model) })
      .catch(() => setLocalOk(false))
    check()
    const interval = setInterval(check, 20_000)
    window.addEventListener('apikey-changed', check)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(interval)
      window.removeEventListener('apikey-changed', check)
      window.removeEventListener('focus', check)
    }
  }, [])

  // Progresso da instalação da IA local — escutado no App para persistir na barra
  // do topo mesmo quando a janela de Settings é fechada.
  useEffect(() => {
    const off = window.api.onLocalInstallProgress(p => {
      if (p.phase === 'done') {
        window.dispatchEvent(new CustomEvent('apikey-changed')) // atualiza status/pill
        // IA de texto pronta → segue baixando o modelo de voz na mesma barra.
        downloadWhisperModel()
        return
      }
      setInstallProgress(p)
      if (p.phase === 'error') {
        setTimeout(() => setInstallProgress(null), 6000)
      }
    })
    return () => { off() }
  }, [])

  // Auto-save prompt tags whenever they change
  useEffect(() => {
    return usePromptStore.subscribe((state, prev) => {
      if (state.promptTags === prev.promptTags) return
      const canvasId = useCanvasStore.getState().currentCanvasId
      if (!canvasId) return
      window.api.setSetting(`promptBuilder_${canvasId}`, JSON.stringify(state.promptTags))
    })
  }, [])

  const resolveProviderName = async () => {
    const provider = (await window.api.getSetting('aiProvider') as string | null) ?? 'anthropic'
    const names: Record<string, string> = { anthropic: 'Claude', openai: 'ChatGPT', togetherai: 'Together AI' }
    return names[provider] ?? provider
  }

  const handleKeySaved = async () => {
    setHasApiKey(true)
    setApiProviderName(await resolveProviderName())
    window.dispatchEvent(new CustomEvent('apikey-changed'))
    const store = useCanvasStore.getState()
    store.nodes.forEach(node => {
      if (node.data.metadataSource === 'none' || node.data.isError) {
        store.updateNodeData(node.id, { isPending: true, isError: false })
      }
    })
  }

  const handleRemoveApiKey = async () => {
    const provider = (await window.api.getSetting('aiProvider') as string | null) ?? 'anthropic'
    await window.api.setApiKey(provider as 'anthropic' | 'openai', '')
    setHasApiKey(false)
    setApiProviderName('')
    window.dispatchEvent(new CustomEvent('apikey-changed'))
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  const handleCloseSettings = async () => {
    setShowSettings(false)
    // Se era a tela de escolha da primeira execução: marca como escolhido e,
    // em seguida, mostra o tutorial (se ainda não foi visto).
    if (firstRunAiRef.current) {
      firstRunAiRef.current = false
      await window.api.setSetting('aiModeChosen', 'true')
      const onboardingDone = await window.api.getSetting('onboardingCompleted')
      if (!onboardingDone) setShowOnboarding(true)
    }
  }

  useEffect(() => {
    const init = async () => {
      // Restore app language preference
      const lang = await window.api.getSetting('appLang')
      useCanvasStore.getState().setAppLang(lang === 'pt' ? 'pt' : 'en')

      // Primeira execução: mostra a tela "Como deseja usar o app?" (Local vs API)
      // ANTES do tutorial. O tutorial é disparado quando essa escolha é fechada.
      const onboardingDone = await window.api.getSetting('onboardingCompleted')
      const aiModeChosen = await window.api.getSetting('aiModeChosen')
      if (!aiModeChosen) {
        firstRunAiRef.current = true
        setShowSettings(true)
      } else if (!onboardingDone) {
        setShowOnboarding(true)
      }

      // Check API key
      const provider = (await window.api.getSetting('aiProvider') as string | null) ?? 'anthropic'
      const key = await window.api.getApiKey(provider as 'anthropic' | 'openai')
      setHasApiKey(!!key)
      if (key) {
        const names: Record<string, string> = { anthropic: 'Claude', openai: 'ChatGPT', togetherai: 'Together AI' }
        setApiProviderName(names[provider] ?? provider)
      }

      // Load canvas list
      const canvases = await window.api.listCanvases() as { id: string; name: string; updated_at: number }[]
      setCanvasList(canvases)

      // Load last active canvas
      const lastId = await window.api.getSetting('lastCanvasId')
      const targetId = (lastId && canvases.find(c => c.id === lastId)) ? lastId : canvases[0]?.id

      if (targetId) {
        setCurrentCanvasId(targetId)
        const { nodes, tags } = await window.api.loadCanvas(targetId) as {
          nodes: {
            id: string; image_path: string; position_x: number
            position_y: number; width: number; height: number
            metadata_source: string; model_name?: string
            parent_id?: string; node_type?: string
            comfy_params?: string; linked_node_id?: string
            thumbnail_path?: string; starred?: number; tag_lang?: string
          }[]
          tags: { id: string; node_id: string; category: string; value: string; source: string }[]
        }

        // Build flow nodes in order: groups → images → metadata
        const groupDbNodes = nodes.filter(n => n.node_type === 'group')
        const imageDbNodes = nodes.filter(n => n.node_type !== 'group' && n.node_type !== 'metadata')
        const metadataDbNodes = nodes.filter(n => n.node_type === 'metadata')

        const groupFlowNodes = groupDbNodes.map(n => {
          // Nome do grupo persistido em comfy_params ({ label }); fallback 'Grupo'.
          let groupLabel = 'Grupo'
          if (n.comfy_params) {
            try { groupLabel = (JSON.parse(n.comfy_params) as { label?: string }).label || 'Grupo' } catch { /* ignore */ }
          }
          return {
            id: n.id,
            type: 'groupNode' as const,
            position: { x: n.position_x, y: n.position_y },
            style: { width: n.width, height: n.height },
            data: {
              imagePath: '',
              tags: [] as { id: string; category: 'style'; value: string; source: 'metadata' }[],
              metadataSource: 'group' as const,
              isPending: false,
              isError: false,
              canvasId: targetId,
              isGroup: true,
              label: groupLabel,
              modelName: n.model_name ?? undefined, // stores saved group color (#rrggbb)
            },
          }
        })

        const imageFlowNodes = imageDbNodes.map((n, i) => ({
          id: n.id,
          type: 'imageNode' as const,
          ...(n.parent_id ? { parentId: n.parent_id } : {}),
          position: { x: n.position_x, y: n.position_y },
          style: { width: n.width },
          data: {
            imagePath: n.image_path,
            thumbnailPath: n.thumbnail_path ?? undefined,
            starred: n.starred === 1,
            tags: tags
              .filter(t => t.node_id === n.id)
              .map(t => ({
                id: t.id,
                category: t.category as 'style',
                value: t.value,
                source: t.source as 'metadata',
              })),
            tagLang: (n.tag_lang as 'en' | 'pt') ?? 'en',
            metadataSource: n.metadata_source as 'comfyui',
            modelName: n.model_name ?? undefined,
            isPending: false,
            isError: false,
            canvasId: targetId,
            animationDelay: i * 60,
          },
        }))

        const metadataFlowNodes = metadataDbNodes.map(n => {
          return {
            id: n.id,
            type: 'metadataNode' as const,
            position: { x: n.position_x, y: n.position_y },
            style: { width: 260 },
            data: {
              imagePath: '',
              tags: [] as { id: string; category: 'style'; value: string; source: 'metadata' }[],
              metadataSource: 'comfyui' as const,
              isPending: false,
              isError: false,
              canvasId: targetId,
              comfyParams: n.comfy_params ? JSON.parse(n.comfy_params) : {},
              linkedImageNodeId: n.linked_node_id ?? undefined,
              isMetadataNode: true,
            },
          }
        })

        // Mark images without description as pending so they get processed on startup
        const imageFlowNodesReady = imageFlowNodes.map(n => ({
          ...n,
          data: {
            ...n.data,
            isPending: !!key && (n.data.metadataSource === 'none' || n.data.isError),
            isError: false,
          }
        }))

        // Group nodes must come before their children in the array
        setNodes([...groupFlowNodes, ...metadataFlowNodes, ...imageFlowNodesReady])
        await window.api.setSetting('lastCanvasId', targetId)

        // Batch generate thumbnails for nodes that don't have one yet (background)
        const nodesWithoutThumb = imageDbNodes.filter(n => !n.thumbnail_path && n.image_path)
        if (nodesWithoutThumb.length > 0) {
          ;(async () => {
            for (const n of nodesWithoutThumb) {
              try {
                const thumbPath = await window.api.createThumbnail(n.image_path)
                await window.api.updateNodeThumbnail(n.id, thumbPath)
                useCanvasStore.getState().updateNodeData(n.id, { thumbnailPath: thumbPath })
              } catch {}
            }
          })()
        }

        // Restore prompt builder state for this canvas
        const savedPrompt = await window.api.getSetting(`promptBuilder_${targetId}`)
        if (savedPrompt) {
          try {
            usePromptStore.getState().setPromptTags(JSON.parse(savedPrompt))
          } catch {}
        }
      }

      setReady(true)
    }

    init()
  }, [])

  // Checking session (undefined = still loading)
  if (session === undefined) {
    return <div className="h-screen bg-black" />
  }

  if (!session) {
    return <Auth />
  }

  if (!ready) {
    return (
      <div className="flex h-screen bg-black items-center justify-center">
        <style>{`
          @keyframes rm-dot { 0%,100%{opacity:.15;transform:scale(.75)} 50%{opacity:.8;transform:scale(1)} }
          @keyframes rm-logo { 0%{opacity:0;transform:scale(.92)} 100%{opacity:1;transform:scale(1)} }
        `}</style>
        <div className="flex flex-col items-center gap-7">
          <img
            src={logoUrl}
            alt="Ref Map"
            className="w-14 h-14 rounded-2xl"
            style={{ animation: 'rm-logo .5s ease-out forwards' }}
          />
          <div className="flex gap-2">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-white/50"
                style={{ animation: `rm-dot 1.1s ease-in-out ${i * 0.18}s infinite` }}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'radial-gradient(ellipse at 50% 40%, #1a0a0e 0%, #0d0407 50%, #080305 100%)' }} onContextMenu={e => e.preventDefault()}>
      <TopBar
        onOpenSettings={openSettings}
        onOpenAbout={() => setShowAbout(true)}
        onOpenTutorial={() => setShowOnboarding(true)}
        hasApiKey={hasApiKey}
        apiProviderName={apiProviderName}
        localActive={!hasApiKey && localOk}
        localModel={localModel}
        onRemoveApiKey={handleRemoveApiKey}
        onSignOut={handleSignOut}
      />

      <div className="flex-1 overflow-hidden relative flex flex-col px-3 pb-3">
        <PixiCanvas canvasId={currentCanvasId ?? ''} />
        <PromptBuilder />
      </div>

      {/* Banners flutuantes — alinhados à barra de ferramentas do canvas
          (Snap/Buscar/zoom ficam em top-3, ~44px abaixo do TopBar de 32px). */}
      <div className="fixed top-[44px] left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2 pointer-events-none">
        <UpdateBanner />
        <AnimatePresence>
          {installProgress && !showSettings && <LocalInstallBanner progress={installProgress} />}
        </AnimatePresence>
      </div>

      {showSettings && <Settings onClose={handleCloseSettings} onKeySaved={handleKeySaved} initialView={settingsView} installProgress={installProgress} onInstallLocal={startLocalInstall} onUninstallLocal={startLocalUninstall} />}
      {showAbout && <About onClose={() => setShowAbout(false)} />}
      {showOnboarding && <Onboarding onComplete={() => setShowOnboarding(false)} />}
    </div>
  )
}
