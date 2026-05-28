import { useEffect, useState } from 'react'
import { type Session } from '@supabase/supabase-js'
import logoUrl from './assets/logo.png'
import { ReactFlowProvider } from '@xyflow/react'
import TopBar from './components/TopBar'
import Canvas from './components/Canvas'
import PromptBuilder from './components/PromptBuilder'
import Settings from './components/Settings'
import Onboarding from './components/Onboarding'
import About from './components/About'
import Auth from './components/Auth'
import { useCanvasStore, usePromptStore } from './store'
import { supabase } from './lib/supabase'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [showSettings, setShowSettings] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [ready, setReady] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)

  const setCanvasList      = useCanvasStore(s => s.setCanvasList)
  const setCurrentCanvasId = useCanvasStore(s => s.setCurrentCanvasId)
  const setNodes           = useCanvasStore(s => s.setNodes)
  const currentCanvasId    = useCanvasStore(s => s.currentCanvasId)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
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

  const handleKeySaved = () => {
    setHasApiKey(true)
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
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  useEffect(() => {
    const init = async () => {
      // Check onboarding
      const onboardingDone = await window.api.getSetting('onboardingCompleted')
      if (!onboardingDone) {
        setShowOnboarding(true)
      }

      // Check API key
      const provider = (await window.api.getSetting('aiProvider') as string | null) ?? 'anthropic'
      const key = await window.api.getApiKey(provider as 'anthropic' | 'openai')
      setHasApiKey(!!key)

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
          }[]
          tags: { id: string; node_id: string; category: string; value: string; source: string }[]
        }

        // Build flow nodes in order: groups → images → metadata
        const groupDbNodes = nodes.filter(n => n.node_type === 'group')
        const imageDbNodes = nodes.filter(n => n.node_type !== 'group' && n.node_type !== 'metadata')
        const metadataDbNodes = nodes.filter(n => n.node_type === 'metadata')

        const groupFlowNodes = groupDbNodes.map(n => ({
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
            label: 'Grupo',
          },
        }))

        const imageFlowNodes = imageDbNodes.map((n, i) => ({
          id: n.id,
          type: 'imageNode' as const,
          ...(n.parent_id ? { parentId: n.parent_id } : {}),
          position: { x: n.position_x, y: n.position_y },
          style: { width: n.width },
          data: {
            imagePath: n.image_path,
            tags: tags
              .filter(t => t.node_id === n.id)
              .map(t => ({
                id: t.id,
                category: t.category as 'style',
                value: t.value,
                source: t.source as 'metadata',
              })),
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

        // Group nodes must come before their children in the array
        setNodes([...groupFlowNodes, ...metadataFlowNodes, ...imageFlowNodes])
        await window.api.setSetting('lastCanvasId', targetId)

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
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'radial-gradient(ellipse at 50% 40%, #1a0a0e 0%, #0d0407 50%, #080305 100%)' }}>
      <TopBar
        onOpenSettings={() => setShowSettings(true)}
        onOpenAbout={() => setShowAbout(true)}
        hasApiKey={hasApiKey}
        onRemoveApiKey={handleRemoveApiKey}
        onSignOut={handleSignOut}
      />

      <div className="flex-1 overflow-hidden relative flex flex-col px-3 pb-3">
        <ReactFlowProvider>
          <Canvas canvasId={currentCanvasId ?? ''} />
        </ReactFlowProvider>
        <PromptBuilder />
      </div>

      {showSettings && <Settings onClose={() => setShowSettings(false)} onKeySaved={handleKeySaved} />}
      {showAbout && <About onClose={() => setShowAbout(false)} />}
      {showOnboarding && <Onboarding onComplete={() => setShowOnboarding(false)} />}
    </div>
  )
}
