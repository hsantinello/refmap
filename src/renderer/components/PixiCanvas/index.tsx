import { useCallback, useEffect, useRef, useState } from 'react'
import { Application, Container, Graphics, Sprite, Texture, ImageSource, BlurFilter } from 'pixi.js'
import { useCanvasStore, usePromptStore, type ImageNodeData, type Tag, type ComfyParams } from '../../store'
import { useShallow } from 'zustand/react/shallow'
import { v4 as uuid } from 'uuid'
import PromptPresets from '../PromptPresets'

// ─── texture cache (module-level — persists across canvas tab switches) ──────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _textureCache = new Map<string, { texture: any; w: number; h: number }>()

// ─── image decoder worker (shared across all canvas instances) ───────────────
const _decoderWorker = new Worker(new URL('../../workers/imageDecoder.ts', import.meta.url), { type: 'module' })
type DecoderResult = { id: string; bitmap: ImageBitmap; imgH: number; dpr: number } | { id: string; error: string }
const _decoderCallbacks = new Map<string, (result: DecoderResult) => void>()
_decoderWorker.onmessage = (e: MessageEvent<DecoderResult>) => {
  const cb = _decoderCallbacks.get(e.data.id)
  if (cb) { _decoderCallbacks.delete(e.data.id); cb(e.data) }
}
function decodeImage(id: string, src: string, width: number): Promise<DecoderResult> {
  return new Promise(resolve => {
    _decoderCallbacks.set(id, resolve)
    _decoderWorker.postMessage({ id, src, width })
  })
}

// ─── types ────────────────────────────────────────────────────────────────────

interface PixiNode {
  id: string
  type: 'imageNode' | 'metadataNode' | 'groupNode'
  x: number; y: number
  width: number; height: number
  data: ImageNodeData
  selected: boolean
  loaded: boolean   // true after texture loaded — determines bg draw mode
  container: Container | null
  bg: Graphics | null
  sprite: Sprite | null
  blurMask?: Graphics | null
  groupColor?: number
  imgEl?: HTMLImageElement     // kept for resize redraw
  imgLoadStarted?: boolean     // lazy loading: true once texture load has been initiated
  locked?: boolean             // lock prevents drag/resize
  lastSeenAt?: number          // ticker timestamp of last in-viewport frame (for eviction)
}

// ─── NSFW detection ───────────────────────────────────────────────────────────

const NSFW_KEYWORDS = [
  'nsfw', '+18', '18+',
  'nude', 'nudity', 'naked', 'unclothed', 'undressed',
  'topless', 'shirtless', 'bare chest', 'bare skin', 'bare body', 'bare torso',
  'nipple', 'breast', 'genitalia', 'genital', 'vagina', 'penis',
  'erotic', 'explicit', 'pornographic',
  'adult content', 'adult material', 'adult only', 'sexually explicit', 'sexual content',
  'lingerie', 'uncensored',
  'nudez', 'seio', 'pele nua', 'conteúdo adulto', 'sexualmente explícito',
]

// Palavras com símbolos/dígitos casam por substring; as demais por palavra
// inteira (com acentos), para evitar falsos positivos como "breast" em
// "breastplate" ou "adulto" em "homem adulto".
const NSFW_SYMBOL_KW = new Set(['+18', '18+'])
function tagIsNsfw(value: string): boolean {
  const v = value.toLowerCase()
  return NSFW_KEYWORDS.some(kw => {
    if (NSFW_SYMBOL_KW.has(kw)) return v.includes(kw)
    const pattern = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
    return new RegExp(`(^|[^\\p{L}])${pattern}([^\\p{L}]|$)`, 'iu').test(v)
  })
}

function isNsfwNode(node: PixiNode): boolean {
  const tags = node.data?.tags ?? []
  return tags.some(tag => tagIsNsfw(tag.value))
}

// ─── constants ────────────────────────────────────────────────────────────────

const TARGET_H = 340, MAX_W = 420, MIN_W = 200
const NODE_R   = 14
const BG_COL   = 0x111111
const SEL_COL  = 0xfb923c
const MIN_ZOOM = 0.08, MAX_ZOOM = 4
const DOT_SIZE = 130 // background dot grid pitch (larger = more spread out)
const BASE_SFW_BLUR = 15 // força do blur do modo SFW em zoom 1 (escala com o zoom)

// ─── helpers ──────────────────────────────────────────────────────────────────

function getImageNaturalSize(path: string): Promise<{ w: number; h: number }> {
  return new Promise(res => {
    const img = new Image()
    img.onload  = () => res({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => res({ w: 1, h: 1 })
    img.src = `file://${path}`
  })
}

// Assets.load() uses fetch() in a WebWorker which can't access file:// paths.
// Load via HTMLImageElement (main thread) then wrap in PixiJS ImageSource.
function loadTexture(path: string): Promise<{ texture: Texture; w: number; h: number } | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      try {
        const source  = new ImageSource({ resource: img })
        const texture = new Texture({ source })
        resolve({ texture, w: img.naturalWidth, h: img.naturalHeight })
      } catch (e) { console.warn('[PixiCanvas] Texture create failed:', e); resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = `file://${path}`
  })
}

function parseDescriptionToTags(desc: unknown, src: 'metadata' | 'ai'): Tag[] {
  if (!desc || typeof desc !== 'string') return []
  const trimmed = desc.trim()

  // JSON-structured prompt (e.g. mfyUI: {"prompt":"...","style":"...","camera":{...}})
  // Use regex to extract string values regardless of JSON validity
  if (/"[^"]+"\s*:/.test(trimmed)) {
    const vals: string[] = []
    const re = /:\s*"([^"]+)"/g
    let jm: RegExpExecArray | null
    while ((jm = re.exec(trimmed)) !== null) {
      jm[1].split(',').map(s => s.trim()).filter(s => s.length > 1).forEach(v => vals.push(v))
    }
    if (vals.length > 0)
      return vals.map(v => ({ id: uuid(), category: 'description' as const, value: v, source: src }))
  }

  // {chunk}[chunk] format — AI vision analysis output
  const rx = /\{([^}]+)\}|\[([^\]]+)\]/g
  const chunks: string[] = []
  let m
  while ((m = rx.exec(desc)) !== null) { const v = (m[1] ?? m[2]).trim(); if (v) chunks.push(v) }
  if (chunks.length > 0) return chunks.map(v => ({ id: uuid(), category: 'description' as const, value: v, source: src }))

  // Plain comma-separated fallback
  return desc.split(',').map(s => s.trim()).filter(s => s.length > 1)
    .map(v => ({ id: uuid(), category: 'description' as const, value: v, source: src }))
}

const GRP_COL = 0xfb923c

// Unified bg redraw — handles imageNode, groupNode, and placeholder states.
// worldScale: current world zoom (used to keep selection border constant in screen pixels)
function redrawBg(node: PixiNode, worldScale = 1) {
  const { bg, width, height, selected, loaded, type } = node
  if (!bg) return
  bg.clear()

  if (type === 'groupNode') {
    const col = node.groupColor ?? GRP_COL
    bg.roundRect(0, 0, width, height, NODE_R)
      .fill({ color: col, alpha: selected ? 0.10 : 0.07 })
    return
  }

  if (!loaded) {
    bg.roundRect(0, 0, width, height, NODE_R).fill({ color: BG_COL })
  } else {
    bg.roundRect(0, 0, width, height, NODE_R).fill({ color: 0x000000, alpha: 0 })
  }
  if (selected) {
    // Fixed 1.5px on screen at all zoom levels — matches the metadata node's CSS border
    const sw = 1.5 / worldScale
    bg.roundRect(sw * 0.5, sw * 0.5, width - sw, height - sw, NODE_R)
      .stroke({ color: SEL_COL, width: sw, alpha: 0.9 })
  }
}

// ─── tags panel ───────────────────────────────────────────────────────────────

const CAT_LABEL: Record<string, string> = {
  style: 'Style', lighting: 'Lighting', composition: 'Composition',
  color: 'Color', mood: 'Mood', subject: 'Subject', description: 'Description',
}

// Cache persistente de traduções de tags. Chaveado por `${idioma}:${valor}`
// (bidirecional: en→pt e pt→en). A mesma tag costuma se repetir entre imagens,
// então isso evita re-traduzir e mantém a troca de idioma instantânea, inclusive
// entre reinícios do app.
let tagTransCache: Record<string, string> = {}
let tagTransCacheLoaded = false
async function loadTagTransCache() {
  if (tagTransCacheLoaded) return
  tagTransCacheLoaded = true
  try {
    const raw = await window.api.getSetting('tagTranslations_v2')
    if (raw) tagTransCache = JSON.parse(raw)
  } catch { /* ignore */ }
}
function saveTagTransCache() {
  window.api.setSetting('tagTranslations_v2', JSON.stringify(tagTransCache))
}
const CAT_ORDER = ['subject', 'style', 'lighting', 'composition', 'color', 'mood', 'description']

function groupTagsByCategory(tags: Tag[]): [string, Tag[]][] {
  const map = new Map<string, Tag[]>()
  for (const t of tags) { const l = map.get(t.category) ?? []; l.push(t); map.set(t.category, l) }
  const out: [string, Tag[]][] = []
  for (const c of CAT_ORDER) { if (map.has(c)) out.push([c, map.get(c)!]) }
  for (const [c, ts] of map) { if (!CAT_ORDER.includes(c)) out.push([c, ts]) }
  return out
}

const SRC_BADGE: Record<string, { icon: string; label: string; cls: string } | null> = {
  comfyui:    { icon: '🔗', label: 'ComfyUI',          cls: 'bg-emerald-500/15 text-emerald-300/80 border-emerald-500/25' },
  a1111:      { icon: '🔗', label: 'Automatic1111',    cls: 'bg-emerald-500/15 text-emerald-300/80 border-emerald-500/25' },
  midjourney: { icon: '🔗', label: 'Midjourney',       cls: 'bg-sky-500/15 text-sky-300/80 border-sky-500/25' },
  ai:         { icon: '✨', label: 'Analisado por IA', cls: 'bg-orange-500/15 text-orange-300/80 border-orange-500/25' },
  none:       { icon: '?',  label: 'Não Identificado', cls: 'bg-white/[0.05] text-white/35 border-white/[0.08]' },
}

function extractDominantColors(imagePath: string, count = 6): Promise<string[]> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const SIZE = 80
      const c = document.createElement('canvas'); c.width = SIZE; c.height = SIZE
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0, SIZE, SIZE)
      const data = ctx.getImageData(0, 0, SIZE, SIZE).data
      // Sample every 4th pixel, bucket into coarse bins
      const buckets = new Map<string, number>()
      for (let i = 0; i < data.length; i += 16) {
        const r = Math.round(data[i]   / 32) * 32
        const g = Math.round(data[i+1] / 32) * 32
        const b = Math.round(data[i+2] / 32) * 32
        if (data[i+3] < 128) continue  // skip transparent
        const key = `${r},${g},${b}`
        buckets.set(key, (buckets.get(key) ?? 0) + 1)
      }
      const top = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, count)
      resolve(top.map(([k]) => {
        const [r, g, b] = k.split(',').map(Number)
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
      }))
    }
    img.onerror = () => resolve([])
    img.src = `file://${imagePath}`
  })
}

function TagsPanel({ nodeId, data }: { nodeId: string; data: ImageNodeData }) {
  const promptTags = usePromptStore(s => s.promptTags)
  const toggleTag  = usePromptStore(s => s.toggleTag)
  const addTag     = usePromptStore(s => s.addTag)
  const removeTag  = usePromptStore(s => s.removeTag)
  const updateTagText = usePromptStore(s => s.updateTagText)
  const updateNodeData = useCanvasStore(s => s.updateNodeData)
  const appLang = useCanvasStore(s => s.appLang)
  const [palette, setPalette] = useState<string[]>([])
  const [copiedColor, setCopiedColor] = useState<string | null>(null)
  const [translatedMap, setTranslatedMap] = useState<Record<string, string> | null>(null)
  const [translating, setTranslating] = useState(false)

  useEffect(() => {
    if (!data.imagePath) return
    extractDominantColors(data.imagePath).then(setPalette)
  }, [data.imagePath])

  // Idioma nativo das tags desta imagem (em que foram geradas/salvas).
  const nativeLang: 'en' | 'pt' = data.tagLang ?? 'en'
  const otherLang: 'en' | 'pt' = nativeLang === 'en' ? 'pt' : 'en'

  // O painel é único e reaproveitado entre imagens. Ao trocar de imagem (ou de
  // idioma global), redefine a exibição para o idioma do app: se as tags já
  // estão nesse idioma (nativo), mostra direto; senão, traduz. O botão continua
  // permitindo alternar manualmente.
  useEffect(() => {
    setTranslating(false)
    if (appLang !== nativeLang && data.tags.length > 0) {
      applyTranslation(appLang)
    } else {
      setTranslatedMap(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, appLang, nativeLang, data.tags.length])

  const handleStar = () => {
    const next = !data.starred
    updateNodeData(nodeId, { starred: next })
    window.api.setNodeStarred(nodeId, next).catch(console.error)
    window.dispatchEvent(new CustomEvent('starred-changed', { detail: { nodeId, starred: next } }))
  }

  const grouped = groupTagsByCategory(data.tags)
  const b0 = SRC_BADGE[data.metadataSource] ?? null
  const badge = b0 && data.metadataSource === 'comfyui' && data.modelName
    ? { ...b0, label: `ComfyUI — ${data.modelName}` } : b0

  const allAdded = data.tags.length > 0 && data.tags.every(t => {
    const displayValue = translatedMap?.[t.id] ?? t.value
    return promptTags.some(pt => pt.value === displayValue)
  })

  const handleAddAll = () => {
    if (allAdded) {
      const displayValues = data.tags.map(t => translatedMap?.[t.id] ?? t.value)
      promptTags.filter(pt => displayValues.includes(pt.value)).forEach(pt => removeTag(pt.id))
    } else {
      data.tags.forEach(tag => {
        const displayValue = translatedMap?.[tag.id] ?? tag.value
        addTag({ ...tag, value: displayValue }, nodeId)
      })
    }
  }

  // Re-aponta as tags que já estão no Prompt Builder vindas deste node:
  // troca o `value` de `from` para `to` para que o chip continue marcado
  // como selecionado e o builder exiba a versão correta (traduzida ou EN).
  const syncBuilderTag = (from: string, to: string) => {
    if (!to || from === to) return
    const pt = usePromptStore.getState().promptTags.find(
      p => p.sourceNodeId === nodeId && p.value === from
    )
    if (pt) updateTagText(pt.id, to)
  }

  // Traduz as tags (que estão no idioma nativo) para `target`, usando o cache
  // (só chama a API para o que falta) e sincroniza as tags já no builder.
  const applyTranslation = async (target: 'en' | 'pt') => {
    if (data.tags.length === 0) return
    setTranslating(true)
    try {
      await loadTagTransCache()
      const key = (v: string) => `${target}:${v}`
      const uniqueMissing = [...new Set(data.tags.map(t => t.value).filter(v => !(key(v) in tagTransCache)))]
      if (uniqueMissing.length > 0) {
        const res = await window.api.translateTags(uniqueMissing, target)
        uniqueMissing.forEach((v, i) => { if (res[i]) tagTransCache[key(v)] = res[i] })
        saveTagTransCache()
      }
      const map: Record<string, string> = {}
      data.tags.forEach(t => { map[t.id] = tagTransCache[key(t.value)] ?? t.value })
      data.tags.forEach(t => syncBuilderTag(t.value, map[t.id]))
      setTranslatedMap(map)
    } catch (err) {
      console.error('[translate]', err)
    } finally {
      setTranslating(false)
    }
  }

  // Volta para o idioma nativo: reverte as tags do builder para o valor original.
  const revertTranslation = () => {
    if (translatedMap) data.tags.forEach(t => syncBuilderTag(translatedMap[t.id] ?? t.value, t.value))
    setTranslatedMap(null)
  }

  // translatedMap != null significa que estamos exibindo no idioma NÃO nativo.
  const switchToLang = translatedMap ? nativeLang : otherLang

  const handleTranslate = () => {
    if (translating) return
    if (translatedMap) revertTranslation()
    else applyTranslation(otherLang)
  }

  return (
    <div className="flex flex-col gap-2 bg-[#111111] rounded-2xl border border-white/[0.08] p-3 shadow-2xl" style={{ width: 260 }}>
      <div className="flex items-center justify-between">
        {badge ? (
          <div className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 border whitespace-nowrap ${badge.cls}`}>
            <span className="text-[10px] leading-none">{badge.icon}</span>
            <span className="text-[10px] font-medium leading-none">{badge.label}</span>
          </div>
        ) : <div />}
        <div className="flex items-center gap-1">
          {data.tags.length > 0 && (
            <>
              <button
                onClick={handleTranslate}
                disabled={translating}
                title={translating ? 'Traduzindo...' : `Mostrar em ${switchToLang === 'pt' ? 'português' : 'inglês'}`}
                className={`text-[10px] px-1.5 py-0.5 rounded-md border transition-colors inline-flex items-center gap-1 ${
                  translating
                    ? 'text-white/30 border-white/[0.08] cursor-default bg-white/[0.04]'
                    : translatedMap
                      ? 'text-white/70 border-white/[0.15] bg-white/[0.08] hover:bg-white/[0.12]'
                      : 'text-white/40 border-white/[0.08] hover:text-white/70 hover:bg-white/[0.07]'
                }`}
              >
                {translating && (
                  <svg className="animate-spin" width="9" height="9" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
                    <path d="M12 3a9 9 0 019 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                )}
                <span>{switchToLang === 'pt' ? 'PT-BR' : 'EN'}</span>
              </button>
              <button
                onClick={handleAddAll}
                title="Adicionar todas as tags ao builder"
                className={`text-[10px] px-1.5 py-0.5 rounded-md border transition-colors ${
                  allAdded
                    ? 'text-orange-300/70 border-orange-500/25 bg-orange-500/[0.08]'
                    : 'text-white/25 border-white/[0.06]'
                }`}
              >
                + todas
              </button>
            </>
          )}
          <button
            onClick={handleStar}
          title={data.starred ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-white/[0.07] transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill={data.starred ? '#FBBF24' : 'none'}>
            <path d="M7 1l1.5 4H13L9.5 7.5l1.5 4L7 9 3 11.5l1.5-4L1 5h4.5L7 1z"
              stroke={data.starred ? '#FBBF24' : 'rgba(255,255,255,0.3)'} strokeWidth="1.2" strokeLinejoin="round"/>
          </svg>
        </button>
        </div>
      </div>
      {data.isPending && (
        <div className="text-xs text-white/35 flex items-center gap-2">
          <span className="animate-spin inline-block">⏳</span><span>Analisando...</span>
        </div>
      )}
      {data.isError && (
        <button
          onClick={() => {
            window.api.getSetting('apiKey_anthropic').then(k1 =>
              window.api.getSetting('apiKey_openai').then(k2 => {
                if (!k1 && !k2) { window.dispatchEvent(new CustomEvent('open-settings')); return }
                window.dispatchEvent(new CustomEvent('retry-analysis', { detail: { nodeId, imagePath: data.imagePath } }))
              })
            )
          }}
          className="text-xs text-red-400/70 bg-red-500/10 rounded-lg px-2 py-1.5 border border-red-500/15 hover:bg-red-500/20 hover:text-red-400 transition-colors text-left cursor-pointer"
        >
          Falha na análise — clique para tentar novamente
        </button>
      )}

      {palette.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-widest text-white/25 font-semibold leading-none">Paleta</span>
          <div className="flex gap-1.5 flex-wrap">
            {palette.map(color => (
              <button
                key={color}
                title={copiedColor === color ? 'Copiado!' : color}
                onClick={() => { navigator.clipboard.writeText(color); setCopiedColor(color); setTimeout(() => setCopiedColor(null), 1500) }}
                className="w-6 h-6 rounded-md border border-white/10 hover:scale-110 transition-transform relative"
                style={{ background: color }}
              >
                {copiedColor === color && (
                  <span className="absolute inset-0 flex items-center justify-center text-[8px] bg-black/50 rounded-md">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      {grouped.map(([cat, tags]) => (
        <div key={cat} className="flex flex-col gap-1 items-start">
          <span className="text-[9px] uppercase tracking-widest text-white/25 font-semibold leading-none">
            {CAT_LABEL[cat] ?? cat}
          </span>
          <div className="flex flex-wrap justify-start gap-1 w-full">
            {tags.map(tag => {
              const displayValue = translatedMap?.[tag.id] ?? tag.value
              const active = promptTags.some(pt => pt.value === displayValue)
              return (
                <button key={tag.id}
                  onClick={e => { e.stopPropagation(); toggleTag({ ...tag, value: displayValue }, nodeId) }}
                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); window.dispatchEvent(new CustomEvent('save-to-my-presets', { detail: { value: displayValue } })) }}
                  className={`rm-chip ${active ? 'is-active' : ''}`}
                  title={active ? 'Remover do builder' : 'Adicionar ao builder'}
                >{displayValue}</button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── toolbar ──────────────────────────────────────────────────────────────────

function CanvasToolbar({ zoom, onZoomIn, onZoomOut, onFit }: {
  zoom: number; onZoomIn: () => void; onZoomOut: () => void; onFit: () => void
}) {
  const b = 'w-9 h-9 flex items-center justify-center rounded-lg transition-all text-white/40 hover:text-white/80 hover:bg-white/[0.08]'
  return (
    <div className="absolute top-3 right-3 z-10 flex items-center gap-0.5 px-1.5 py-1.5 rm-panel !border-transparent rounded-xl">
      <button onClick={onFit} title="Centralizar" className={b}>
        <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
          <path d="M1 4V1H4M10 1H13V4M13 10V13H10M4 13H1V10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <div className="w-px h-4 bg-white/[0.08] mx-0.5" />
      <button onClick={onZoomOut} className={`${b} text-lg font-light`}>−</button>
      <span className="text-[12px] text-white/35 w-10 text-center tabular-nums font-medium">{Math.round(zoom * 100)}%</span>
      <button onClick={onZoomIn} className={`${b} text-lg font-light`}>+</button>
    </div>
  )
}

// ─── metadata node view ───────────────────────────────────────────────────────

function MetadataNodeView({ data, selected }: { data: ImageNodeData; selected: boolean }) {
  const p = (data.comfyParams ?? {}) as ComfyParams
  const baseName = p.model ? p.model.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '') : null
  const hasModels   = baseName || (p.loras && p.loras.length > 0)
  const hasSampling = p.sampler || p.scheduler || p.steps !== undefined || p.seed !== undefined ||
    p.guidance !== undefined || p.cfg !== undefined || p.width !== undefined
  return (
    <div className="rounded-2xl overflow-hidden shadow-xl" style={{
      width: 260, background: 'rgba(10,6,14,0.92)',
      border: selected ? '1px solid rgba(251,146,60,0.6)' : '1px solid rgba(255,255,255,0.07)',
      boxShadow: selected ? '0 0 0 3px rgba(251,146,60,0.2),0 8px 32px rgba(0,0,0,0.8)' : '0 8px 32px rgba(0,0,0,0.6)',
      backdropFilter: 'blur(8px)',
    }}>
      <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="text-[9px] font-bold tracking-widest uppercase text-white/25">ComfyUI</span>
        <span className="ml-auto text-[9px] text-orange-400/60">🔗</span>
      </div>
      {hasModels && (
        <div className="px-3.5 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[8px] font-bold tracking-widest uppercase text-white/20 mb-2">Modelos</div>
          {baseName && (
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] text-white/65 font-medium truncate flex-1">{baseName}</span>
              <span className="text-[8px] px-1.5 py-0.5 rounded font-bold tracking-wider uppercase text-white/25" style={{ background: 'rgba(255,255,255,0.05)' }}>BASE</span>
            </div>
          )}
          {p.loras?.map((lora, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[9px] text-white/25 shrink-0">↪</span>
              <span className="text-[10px] text-orange-300/65 truncate flex-1">{lora.name}</span>
              <span className="text-[9px] font-mono text-white/30 shrink-0">{lora.strengthModel.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}
      {hasSampling && (
        <div className="px-3.5 py-2.5">
          <div className="text-[8px] font-bold tracking-widest uppercase text-white/20 mb-1.5">Sampling</div>
          {([
            p.sampler    && ['Sampler',   p.sampler],
            p.scheduler  && ['Scheduler', p.scheduler],
            p.steps    !== undefined && ['Steps',    String(p.steps)],
            p.denoise  !== undefined && ['Denoise',  p.denoise.toFixed(2)],
            (p.guidance !== undefined || p.cfg !== undefined) && ['Guidance', String(p.guidance ?? p.cfg)],
            p.width !== undefined && p.height !== undefined && ['Resolução', `${p.width} × ${p.height}`],
            p.seed !== undefined && ['Seed', String(p.seed)],
          ] as (string[] | false)[]).filter(Boolean).map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 py-[3px]">
              <span className="text-[10px] text-white/30 shrink-0">{label}</span>
              <span className="text-[10px] text-white/60 truncate text-right font-mono">{value}</span>
            </div>
          ))}
        </div>
      )}
      {!hasModels && !hasSampling && <div className="px-3.5 py-4 text-center text-[10px] text-white/20">A imagem não possui metadados</div>}
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

export default function PixiCanvas({ canvasId }: { canvasId: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasElRef  = useRef<HTMLCanvasElement>(null)
  const bgDotsRef    = useRef<HTMLDivElement>(null)  // dot pattern, moves with world
  const tagsElRef    = useRef<HTMLDivElement>(null)
  const metaOverRef  = useRef<HTMLDivElement>(null)

  const groupLabelsRef = useRef<HTMLDivElement>(null)  // screen-space group label overlay
  const prevScaleRef   = useRef<number>(1)             // tracks last zoom for border redraw
  const minimapRef      = useRef<HTMLCanvasElement>(null)
  const minimapDragging = useRef(false)
  const snapGuideRef    = useRef<HTMLDivElement>(null)  // snap alignment guides
  const lockIconsRef    = useRef<HTMLDivElement>(null)   // world-space lock icons

  const flashSave = useCallback(() => {
    setSaveStatus('saving')
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => setSaveStatus('saved'), 600)
    setTimeout(() => setSaveStatus('idle'), 3000)
  }, [])

  // ─ undo/redo history ──────────────────────────────────────────────────────
  type HistoryEntry = { undo: () => void; redo: () => void }
  const historyRef    = useRef<HistoryEntry[]>([])
  const historyIdxRef = useRef(-1)

  const pushHistory = useCallback((entry: HistoryEntry) => {
    // Discard any undone future entries before pushing new one
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1)
    historyRef.current.push(entry)
    historyIdxRef.current = historyRef.current.length - 1
  }, [])

  // clipboard for copy/paste
  const clipboardRef = useRef<Array<{ imagePath: string; width: number; relX: number; relY: number; data: ImageNodeData }>>([])

  // search query for tag filtering
  const [searchQuery, setSearchQuery] = useState('')
  const [starFilter, setStarFilter]   = useState(false)

  const appRef        = useRef<Application | null>(null)
  const worldRef      = useRef<Container | null>(null)
  const nodesRef      = useRef(new Map<string, PixiNode>())
  const linkedRef     = useRef(new Map<string, string>())
  const processingRef = useRef(new Set<string>())

  // Multi-select state — refs for perf-critical paths, useState for React re-renders
  const selIdsRef    = useRef(new Set<string>())     // all selected node IDs
  const primaryIdRef = useRef<string | null>(null)   // last-clicked, for tags panel

  type IxState =
    | { kind: 'idle' }
    | { kind: 'pan';     mx0: number; my0: number; wx0: number; wy0: number; hasMoved: boolean }
    | { kind: 'marquee'; sx0: number; sy0: number }
    | { kind: 'drag';    mx0: number; my0: number; starts: Map<string, { x: number; y: number }>; hasMoved: boolean }
    | { kind: 'resize';  id: string; corner: 'se'|'sw'|'ne'|'nw'
        mx0: number; my0: number; w0: number; h0: number; x0: number; y0: number }
  const ixRef      = useRef<IxState>({ kind: 'idle' })
  const marqueeRef = useRef<HTMLDivElement>(null)   // rubber-band selection box DOM element

  const [primaryId, setPrimaryId]           = useState<string | null>(null)
  const [selCount,  setSelCount]            = useState(0)   // reactive selection size
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel]     = useState('')
  const [groupColors, setGroupColors]       = useState<Map<string, number>>(new Map())
  const [zoom, setZoom]             = useState(1)
  const [pixiReady, setPixiReady]   = useState(false)
  const [canvasHeight, setCanvasHeight]       = useState(600)
  const [showShortcuts, setShowShortcuts]     = useState(false)
  const [snapEnabled, setSnapEnabled]         = useState(true)
  const [minimapVisible, setMinimapVisible]   = useState(true)
  const snapEnabledRef = useRef(true)   // ref for use inside pointer event closures
  const [saveStatus, setSaveStatus]           = useState<'idle'|'saving'|'saved'>('idle')
  const [analysisProgress, setAnalysisProgress] = useState<{ done: number; total: number } | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const analysisTotalRef = useRef(0)
  const analysisDoneRef  = useRef(0)
  const aiQueueRef       = useRef<Array<() => Promise<void>>>([])
  const aiRunningRef     = useRef(0)
  const MAX_AI_CONCURRENT = 3
  const [initError, setInitError]   = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId?: string; isCanvas?: boolean } | null>(null)

  const addImageNode    = useCanvasStore(s => s.addImageNode)
  const addMetadataNode = useCanvasStore(s => s.addMetadataNode)
  const updateNodeData  = useCanvasStore(s => s.updateNodeData)
  const removeNode      = useCanvasStore(s => s.removeNode)
  const sfwMode         = useCanvasStore(s => s.sfwMode)
  const metaNodes         = useCanvasStore(useShallow(s => s.nodes.filter(n => n.type === 'metadataNode')))
  const promptHasContent  = usePromptStore(s => s.promptTags.length > 0)
  const groupNodes      = useCanvasStore(useShallow(s => s.nodes.filter(n => n.type === 'groupNode')))
  const isEmpty         = useCanvasStore(s => s.nodes.filter(n => n.type === 'imageNode').length === 0)
  const isEmptyRef      = useRef(isEmpty)
  useEffect(() => { isEmptyRef.current = isEmpty }, [isEmpty])

  // SFW mode: blur NSFW-tagged images and pending images (unknown content)
  useEffect(() => {
    nodesRef.current.forEach(node => {
      if (!node.sprite || !node.container) return
      if (sfwMode && (node.data.isPending || isNsfwNode(node))) {
        if (!node.blurMask) {
          const mask = new Graphics()
          mask.roundRect(0, 0, node.width, node.height, 10).fill(0xffffff)
          node.container.addChild(mask)
          node.blurMask = mask
        }
        node.sprite.mask = node.blurMask
        node.sprite.filters = [new BlurFilter({ strength: BASE_SFW_BLUR * (worldRef.current?.scale.x ?? 1), quality: 4 })]
      } else {
        node.sprite.mask = null
        node.sprite.filters = []
        if (node.blurMask) {
          node.container.removeChild(node.blurMask)
          node.blurMask.destroy()
          node.blurMask = null
        }
      }
    })
  }, [sfwMode])

  const starFilterRef = useRef(false)
  useEffect(() => { starFilterRef.current = starFilter }, [starFilter])

  // When a node's starred status changes, update its alpha if filter is active
  useEffect(() => {
    const handler = (e: CustomEvent<{ nodeId: string; starred: boolean }>) => {
      const node = nodesRef.current.get(e.detail.nodeId)
      if (!node) return
      node.data = { ...node.data, starred: e.detail.starred }  // keep nodesRef in sync
      if (starFilterRef.current && node.container)
        node.container.alpha = e.detail.starred ? 1 : 0.12
    }
    window.addEventListener('starred-changed', handler as EventListener)
    return () => window.removeEventListener('starred-changed', handler as EventListener)
  }, [])

  const selectedNodeData = useCanvasStore(s => {
    if (!primaryId) return null
    return s.nodes.find(n => n.id === primaryId)?.data ?? null
  })

  // ─ world helpers ──────────────────────────────────────────────────────────

  function getWorld() { return worldRef.current! }
  function screenToWorld(sx: number, sy: number) {
    const w = getWorld(); return { x: (sx - w.x) / w.scale.x, y: (sy - w.y) / w.scale.y }
  }
  function getNodeAt(sx: number, sy: number): PixiNode | null {
    const { x: wx, y: wy } = screenToWorld(sx, sy)
    const nodes = [...nodesRef.current.values()].filter(n => n.type !== 'metadataNode')
    // Images always win over groups — check imageNodes first
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      if (n.type !== 'imageNode') continue
      if (wx >= n.x && wx <= n.x + n.width && wy >= n.y && wy <= n.y + n.height) return n
    }
    // Fallback: groups and any other node types
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      if (wx >= n.x && wx <= n.x + n.width && wy >= n.y && wy <= n.y + n.height) return n
    }
    return null
  }

  // ─ selection helpers ──────────────────────────────────────────────────────

  const setNodeSelected = (node: PixiNode, sel: boolean) => {
    node.selected = sel
    redrawBg(node, worldRef.current?.scale.x ?? 1)
  }

  const clearAllSelection = useCallback(() => {
    for (const id of selIdsRef.current) {
      const n = nodesRef.current.get(id)
      if (n) setNodeSelected(n, false)
    }
    selIdsRef.current.clear()
    primaryIdRef.current = null
    setPrimaryId(null); setSelCount(0)
    if (canvasElRef.current) canvasElRef.current.style.cursor = ''
  }, [])

  const selectOne = useCallback((id: string) => {
    clearAllSelection()
    const n = nodesRef.current.get(id)
    if (n) setNodeSelected(n, true)
    selIdsRef.current.add(id)
    primaryIdRef.current = id
    setPrimaryId(id); setSelCount(1)
  }, [clearAllSelection])

  const toggleSelect = useCallback((id: string) => {
    const n = nodesRef.current.get(id)
    if (!n) return
    if (selIdsRef.current.has(id)) {
      setNodeSelected(n, false)
      selIdsRef.current.delete(id)
      // If deselecting the primary, pick another selected node as primary
      if (primaryIdRef.current === id) {
        const next = [...selIdsRef.current][0] ?? null
        primaryIdRef.current = next
        setPrimaryId(next)
      }
    } else {
      setNodeSelected(n, true)
      selIdsRef.current.add(id)
      primaryIdRef.current = id
      setPrimaryId(id)
    }
    setSelCount(selIdsRef.current.size)
  }, [])

  // ─ add pixi node ──────────────────────────────────────────────────────────

  const addPixiNode = useCallback((
    id: string, type: PixiNode['type'],
    x: number, y: number, width: number,
    data: ImageNodeData, animDelay = 0, nodeHeight?: number,
  ) => {
    const world = worldRef.current
    if (!world) return

    const state: PixiNode = { id, type, x, y, width, height: nodeHeight ?? width, data, selected: false, loaded: false, container: null, bg: null, sprite: null }
    nodesRef.current.set(id, state)

    if (type === 'metadataNode') return // rendered as React DOM overlay

    if (type === 'groupNode') {
      const h = nodeHeight ?? 200
      // Restore saved color from model_name (stored as '#rrggbb')
      const savedHex = data.modelName
      const savedColor = savedHex?.startsWith('#') ? parseInt(savedHex.slice(1), 16) : GRP_COL
      state.groupColor = savedColor
      const container = new Container()
      container.x = x; container.y = y
      const bg = new Graphics()
      bg.roundRect(0, 0, width, h, NODE_R).fill({ color: savedColor, alpha: 0.07 })
      container.addChild(bg)
      state.container = container; state.bg = bg; state.loaded = true
      world.addChildAt(container, 0)
      return
    }

    if (type !== 'imageNode') return

    const container = new Container()
    container.x = x; container.y = y
    const bg = new Graphics()
    redrawBg(state, worldRef.current?.scale.x ?? 1) // draws opaque placeholder (not loaded yet)
    // bg is empty until we attach it — attach now
    bg.roundRect(0, 0, width, width, NODE_R).fill({ color: BG_COL })
    container.addChild(bg)
    state.container = container
    state.bg = bg
    world.addChild(container)

    // Load via HTMLImageElement + Canvas 2D (file:// works; PixiJS mask API is unreliable in v8)
    // Lazy: check if node is in (or near) the viewport before starting load
    const isInViewport = () => {
      const wc = worldRef.current; const ct = containerRef.current
      if (!wc || !ct) return true
      const vx = -wc.x / wc.scale.x, vy = -wc.y / wc.scale.y
      const vw = ct.clientWidth / wc.scale.x, vh = ct.clientHeight / wc.scale.y
      const PAD = 400 / wc.scale.x  // preload 400px outside visible area
      const h = nodeHeight ?? width
  return x + width >= vx - PAD && x <= vx + vw + PAD &&
             y + h >= vy - PAD && y <= vy + vh + PAD
    }
    if (!isInViewport()) { state.imgLoadStarted = false; return }  // defer

    state.imgLoadStarted = true
    const doLoad = () => {
      // Check texture cache first (avoids redrawing canvas2D on tab switch)
      const srcPath = data.thumbnailPath || data.imagePath
      const cached = _textureCache.get(srcPath + ':' + width)
      if (cached && nodesRef.current.has(id)) {
        const imgH = cached.h
        state.height = imgH; state.loaded = true
        try {
          const spr = new Sprite(cached.texture); spr.width = width; spr.height = imgH
          if (useCanvasStore.getState().sfwMode && (state.data.isPending || isNsfwNode(state))) {
            const mask = new Graphics()
            mask.roundRect(0, 0, width, imgH, 10).fill(0xffffff)
            container.addChild(mask)
            state.blurMask = mask
            spr.mask = mask
            spr.filters = [new BlurFilter({ strength: BASE_SFW_BLUR * (worldRef.current?.scale.x ?? 1), quality: 4 })]
          }
          container.addChild(spr)
          if (state.bg) { container.removeChild(state.bg); container.addChild(state.bg) }
          state.bg?.clear()
          state.bg?.roundRect(0, 0, width, imgH, NODE_R).fill({ color: 0x000000, alpha: 0 })
          state.sprite = spr
          redrawBg(state, worldRef.current?.scale.x ?? 1)
        } catch { /* fall through to full load */ }
        return
      }

      const img = new Image()
      img.onload = () => {
        if (!nodesRef.current.has(id)) return
        const imgH = Math.round(width * img.naturalHeight / img.naturalWidth)
        state.height = imgH; state.loaded = true; state.imgEl = img

        const dpr = Math.min(window.devicePixelRatio || 1, 3)
        const offscreen = document.createElement('canvas')
        offscreen.width = Math.round(width * dpr); offscreen.height = Math.round(imgH * dpr)
        const ctx = offscreen.getContext('2d')
        if (ctx) {
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
          ctx.scale(dpr, dpr); ctx.beginPath()
          ctx.roundRect(0, 0, width, imgH, NODE_R); ctx.clip()
          ctx.drawImage(img, 0, 0, width, imgH)
        }
        try {
          const source  = new ImageSource({ resource: offscreen, resolution: dpr })
          const texture = new Texture({ source })
          _textureCache.set(srcPath + ':' + width, { texture, w: img.naturalWidth, h: imgH })
          const sprite  = new Sprite(texture)
          sprite.width  = width; sprite.height = imgH
          if (useCanvasStore.getState().sfwMode && (state.data.isPending || isNsfwNode(state))) {
            const mask = new Graphics()
            mask.roundRect(0, 0, width, imgH, 10).fill(0xffffff)
            container.addChild(mask)
            state.blurMask = mask
            sprite.mask = mask
            sprite.filters = [new BlurFilter({ strength: BASE_SFW_BLUR * (worldRef.current?.scale.x ?? 1), quality: 4 })]
          }
          container.addChild(sprite)
          container.removeChild(bg); container.addChild(bg)
          redrawBg(state, worldRef.current?.scale.x ?? 1)
          state.sprite = sprite
        } catch (e) { console.warn('[PixiCanvas] sprite create failed:', e) }
      }
      img.onerror = () => console.warn('[PixiCanvas] image load failed:', srcPath)
      img.src = `file://${srcPath}`
    }

    if (animDelay > 0) setTimeout(doLoad, animDelay)
    else doLoad()
  }, [])

  const removePixiNode = useCallback((id: string) => {
    const node = nodesRef.current.get(id)
    if (!node) return
    if (node.container) { worldRef.current?.removeChild(node.container); node.container.destroy({ children: true }) }
    nodesRef.current.delete(id)
    selIdsRef.current.delete(id)
    if (primaryIdRef.current === id) { primaryIdRef.current = null; setPrimaryId(null) }
    setSelCount(selIdsRef.current.size)
  }, [])

  const updatePixiNodeData = useCallback((id: string, data: Partial<ImageNodeData>) => {
    const node = nodesRef.current.get(id)
    if (node) {
      node.data = { ...node.data, ...data }
      if ((data.tags !== undefined || data.isPending !== undefined) && node.sprite && node.container) {
        const sfw = useCanvasStore.getState().sfwMode
        const shouldBlur = sfw && (node.data.isPending || isNsfwNode(node))
        if (shouldBlur) {
          if (!node.blurMask) {
            const mask = new Graphics()
            mask.roundRect(0, 0, node.width, node.height, 10).fill(0xffffff)
            node.container.addChild(mask)
            node.blurMask = mask
          }
          node.sprite.mask = node.blurMask
          node.sprite.filters = [new BlurFilter({ strength: BASE_SFW_BLUR * (worldRef.current?.scale.x ?? 1), quality: 4 })]
        } else {
          node.sprite.mask = null
          node.sprite.filters = []
          if (node.blurMask) {
            node.container.removeChild(node.blurMask)
            node.blurMask.destroy()
            node.blurMask = null
          }
        }
      }
    }
    updateNodeData(id, data)
  }, [updateNodeData])

  // ─ AI queue — max 3 concurrent analyses ─────────────────────────────────
  const enqueueAI = useCallback((fn: () => Promise<void>) => {
    const run = () => {
      if (aiRunningRef.current >= MAX_AI_CONCURRENT) { aiQueueRef.current.push(run); return }
      aiRunningRef.current++
      fn().finally(() => { aiRunningRef.current--; const next = aiQueueRef.current.shift(); if (next) next() })
    }
    run()
  }, [])

  // ─ processImage ───────────────────────────────────────────────────────────

  const processImage = useCallback(async (imagePath: string, nodeId: string) => {
    analysisTotalRef.current++
    setAnalysisProgress({ done: analysisDoneRef.current, total: analysisTotalRef.current })
    try {
      const result = await window.api.extractMetadata(imagePath)
      let description: string
      let source = result.source as ImageNodeData['metadataSource']
      let modelName: string | undefined

      if (result.source === 'none') {
        try {
          // Use thumbnail for AI analysis when available (avoids sending large originals)
          const node = nodesRef.current.get(nodeId)
          const pathForAI = node?.data.thumbnailPath || imagePath
          const aiResult = await window.api.analyzeWithAI(pathForAI, useCanvasStore.getState().appLang)
          description = typeof aiResult === 'string' ? aiResult : ''
          source = 'ai'
        } catch {
          updatePixiNodeData(nodeId, { isPending: false, isError: true }); return
        }
      } else {
        description = typeof result.description === 'string' ? result.description : ''
        if (result.source === 'comfyui') {
          const params = result.params as ComfyParams
          if (params?.model) modelName = params.model.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '')
          const imageNode = nodesRef.current.get(nodeId)
          if (imageNode) {
            const metaPos = { x: imageNode.x, y: imageNode.y + imageNode.height + 14 }
            const metaId = uuid()
            addMetadataNode(metaId, metaPos, canvasId, params, nodeId)
            const metaData = useCanvasStore.getState().nodes.find(n => n.id === metaId)?.data
            if (metaData) addPixiNode(metaId, 'metadataNode', metaPos.x, metaPos.y, 260, metaData)
            linkedRef.current.set(metaId, nodeId); linkedRef.current.set(nodeId, metaId)
            window.api.createNode({ id: metaId, canvasId, imagePath: '', x: metaPos.x, y: metaPos.y, width: 260, height: 200, source: 'comfyui', nodeType: 'metadata', linkedNodeId: nodeId, comfyParams: JSON.stringify(params) }).catch(console.error)
          }
        }
      }

      // Always use AI when there's no description from metadata
      const tryAI = async () => {
        const node = nodesRef.current.get(nodeId)
        // Ensure thumbnail exists before sending to AI (avoids sending huge originals)
        let pathForAI = node?.data.thumbnailPath
        if (!pathForAI) {
          try {
            pathForAI = await window.api.createThumbnail(imagePath)
            updateNodeData(nodeId, { thumbnailPath: pathForAI })
            await window.api.updateNodeThumbnail(nodeId, pathForAI)
          } catch { pathForAI = imagePath }
        }
        const aiResult = await window.api.analyzeWithAI(pathForAI, useCanvasStore.getState().appLang)
        if (typeof aiResult === 'string' && aiResult) {
          description = aiResult
          source = 'ai'
        }
      }

      if (!description) {
        try { await tryAI() } catch { /* will show error */ }
      }

      const tagSrc = source === 'ai' ? 'ai' : 'metadata'
      let tags = parseDescriptionToTags(description, tagSrc)

      // If still no tags after metadata, force AI analysis
      if (tags.length === 0 && source !== 'ai') {
        try {
          await tryAI()
          tags = parseDescriptionToTags(description, 'ai')
        } catch { /* will mark as error below */ }
      }

      // If no tags at all, mark as error so user can retry
      if (tags.length === 0) {
        updatePixiNodeData(nodeId, { isPending: false, isError: true })
        return
      }

      // Idioma nativo das tags: o da análise quando geradas por IA; senão inglês
      // (tags vindas de metadados são o prompt original, tratado como inglês).
      const tagLang: 'en' | 'pt' = source === 'ai' ? useCanvasStore.getState().appLang : 'en'
      updatePixiNodeData(nodeId, { tags, tagLang, metadataSource: source, modelName, isPending: false, isError: false })
      await window.api.updateNodeMetadata(nodeId, source, modelName)
      await window.api.saveNodeTags(nodeId, tags.map(t => ({ id: t.id, category: t.category, value: t.value, source: t.source })), tagLang)
      flashSave()
    } catch (err) {
      console.error('[PixiCanvas] processImage:', err)
      updatePixiNodeData(nodeId, { isPending: false, isError: true })
    } finally {
      analysisDoneRef.current++
      const done = analysisDoneRef.current, total = analysisTotalRef.current
      setAnalysisProgress(done >= total ? null : { done, total })
      if (done >= total) { analysisTotalRef.current = 0; analysisDoneRef.current = 0 }
    }
  }, [canvasId, addMetadataNode, updatePixiNodeData, addPixiNode, flashSave])

  // ─ addNodes ───────────────────────────────────────────────────────────────

  const addNodes = useCallback(async (filePaths: string[], screenPos?: { x: number; y: number }) => {
    if (filePaths.length === 0) return
    const cx = screenPos?.x ?? (containerRef.current?.clientWidth  ?? window.innerWidth)  / 2
    const cy = screenPos?.y ?? (containerRef.current?.clientHeight ?? window.innerHeight) / 2
    const { x: startWx, y: startWy } = screenToWorld(cx, cy)

    const sizes = await Promise.all(filePaths.map(getImageNaturalSize))

    const GAP  = 24
    const cols = Math.ceil(Math.sqrt(filePaths.length))
    let colIdx = 0, curX = startWx, curY = startWy, rowMaxH = 0

    filePaths.forEach((imagePath, i) => {
      const { w, h } = sizes[i]
      const displayWidth  = Math.round(Math.min(Math.max(TARGET_H * w / h, MIN_W), MAX_W))
      const displayHeight = Math.round(displayWidth * h / w)

      // Single image → drop at cursor; multiple → auto grid
      const pos = filePaths.length === 1
        ? { x: startWx, y: startWy }
        : { x: curX, y: curY }

      const nodeId = addImageNode(imagePath, pos, canvasId, displayWidth)
      const newData = useCanvasStore.getState().nodes.find(n => n.id === nodeId)?.data
      if (!newData) return
      addPixiNode(nodeId, 'imageNode', pos.x, pos.y, displayWidth, newData)
      if (!processingRef.current.has(nodeId)) {
        processingRef.current.add(nodeId)
        enqueueAI(() => processImage(imagePath, nodeId).finally(() => processingRef.current.delete(nodeId)))
      }
      window.api.createNode({ id: nodeId, canvasId, imagePath, x: pos.x, y: pos.y, width: displayWidth, height: 200, source: 'none' }).catch(console.error)

      // Generate thumbnail in background; update node + DB when ready
      window.api.createThumbnail(imagePath).then(thumbPath => {
        updateNodeData(nodeId, { thumbnailPath: thumbPath })
        window.api.updateNodeThumbnail(nodeId, thumbPath).catch(console.error)
      }).catch(console.error)

      // Advance grid cursor
      if (filePaths.length > 1) {
        rowMaxH = Math.max(rowMaxH, displayHeight)
        colIdx++
        if (colIdx >= cols) {
          colIdx = 0; curX = startWx; curY += rowMaxH + GAP; rowMaxH = 0
        } else {
          curX += displayWidth + GAP
        }
      }
    })
  }, [canvasId, addImageNode, addPixiNode, processImage])

  // ─ animated zoom ──────────────────────────────────────────────────────────

  const animateZoom = useCallback((targetScale: number) => {
    const w = worldRef.current; const el = containerRef.current
    if (!w || !el) return
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2
    const s0 = w.scale.x, x0 = w.x, y0 = w.y
    const targetX = cx - (cx - x0) * (targetScale / s0)
    const targetY = cy - (cy - y0) * (targetScale / s0)
    const t0 = performance.now()
    const frame = (now: number) => {
      const raw = Math.min((now - t0) / 280, 1), ease = 1 - Math.pow(1 - raw, 3)
      w.scale.set(s0 + (targetScale - s0) * ease)
      w.x = x0 + (targetX - x0) * ease; w.y = y0 + (targetY - y0) * ease
      setZoom(w.scale.x)
      if (raw < 1) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }, [])

  // ─ fit view ───────────────────────────────────────────────────────────────

  const fitView = useCallback((delay = 0, animated = false) => {
    const doFit = () => {
      const world = worldRef.current; const el = containerRef.current
      if (!world || !el) return

      // Nothing selected → fit all; something selected → fit selection
      const candidates = selIdsRef.current.size > 0
        ? [...selIdsRef.current].map(id => nodesRef.current.get(id)).filter((n): n is PixiNode => !!n)
        : [...nodesRef.current.values()]
      const visible = candidates.filter(n => n.type === 'imageNode' && n.height > 10)
      if (visible.length === 0) return

      const minX = Math.min(...visible.map(n => n.x)), minY = Math.min(...visible.map(n => n.y))
      const maxX = Math.max(...visible.map(n => n.x + n.width)), maxY = Math.max(...visible.map(n => n.y + n.height))
      const cw = el.clientWidth, ch = el.clientHeight
      const targetScale = Math.min((cw * 0.76) / (maxX - minX || 1), (ch * 0.76) / (maxY - minY || 1), MAX_ZOOM)
      const targetX = (cw - (maxX - minX) * targetScale) / 2 - minX * targetScale
      const targetY = (ch - (maxY - minY) * targetScale) / 2 - minY * targetScale

      if (animated) {
        const s0 = world.scale.x, x0 = world.x, y0 = world.y, t0 = performance.now()
        const frame = (now: number) => {
          const raw = Math.min((now - t0) / 700, 1), ease = 1 - Math.pow(1 - raw, 3)
          world.scale.set(s0 + (targetScale - s0) * ease)
          world.x = x0 + (targetX - x0) * ease; world.y = y0 + (targetY - y0) * ease
          setZoom(world.scale.x)
          if (raw < 1) requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      } else {
        world.scale.set(targetScale); world.x = targetX; world.y = targetY; setZoom(targetScale)
      }
    }
    if (delay > 0) setTimeout(doFit, delay)
    else doFit()
  }, [])

  // ─ delete ─────────────────────────────────────────────────────────────────

  const deleteSelected = useCallback(() => {
    const toDelete = new Set<string>()
    for (const id of selIdsRef.current) {
      toDelete.add(id)
      const linked = linkedRef.current.get(id)
      if (linked) { toDelete.add(linked); linkedRef.current.delete(linked) }
      linkedRef.current.delete(id)
    }

    // Snapshot for undo — store node data + positions
    const snapshot = [...toDelete].map(id => {
      const pn  = nodesRef.current.get(id)
      const sn  = useCanvasStore.getState().nodes.find(n => n.id === id)
      return pn && sn ? { id, node: sn, pixiNode: pn } : null
    }).filter(Boolean) as { id: string; node: ReturnType<typeof useCanvasStore.getState>['nodes'][0]; pixiNode: PixiNode }[]

    toDelete.forEach(did => {
      removePixiNode(did); removeNode(did)
      window.api.deleteNode(did).catch(console.error)
    })

    // Remove groups only when the entire canvas is cleared (no image nodes left)
    const remainingNodes = useCanvasStore.getState().nodes
    const anyImageLeft = remainingNodes.some(n => n.type === 'imageNode')
    if (!anyImageLeft) {
      for (const [groupId, node] of nodesRef.current) {
        if (node.type !== 'groupNode' || toDelete.has(groupId)) continue
        removePixiNode(groupId); removeNode(groupId)
        window.api.deleteNode(groupId).catch(console.error)
      }
    }

    pushHistory({
      undo: () => {
        snapshot.forEach(({ node, pixiNode }) => {
          useCanvasStore.getState().setNodes([...useCanvasStore.getState().nodes, node])
          addPixiNode(node.id, node.type as PixiNode['type'], node.position.x, node.position.y,
            (node.style?.width as number) ?? 240, node.data, 0, (node.style?.height as number) ?? undefined)
          if (pixiNode.data.linkedImageNodeId) {
            linkedRef.current.set(node.id, pixiNode.data.linkedImageNodeId)
            linkedRef.current.set(pixiNode.data.linkedImageNodeId, node.id)
          }
        })
      },
      redo: () => {
        snapshot.forEach(({ id }) => {
          removePixiNode(id); removeNode(id)
          window.api.deleteNode(id).catch(console.error)
        })
      },
    })
  }, [removePixiNode, removeNode, addPixiNode, pushHistory])

  // ─ resize node ────────────────────────────────────────────────────────────

  const resizeNode = useCallback((id: string, newWidth: number) => {
    const state = nodesRef.current.get(id)
    if (!state || !state.imgEl || !state.container || !state.bg) return
    const img = state.imgEl
    const newH = Math.round(newWidth * img.naturalHeight / img.naturalWidth)
    state.width = newWidth; state.height = newH

    // Redraw sprite at new size
    if (state.sprite) { state.container.removeChild(state.sprite); state.sprite.destroy() }
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const off = document.createElement('canvas')
    off.width = Math.round(newWidth * dpr); off.height = Math.round(newH * dpr)
    const ctx = off.getContext('2d')
    if (ctx) {
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
      ctx.scale(dpr, dpr); ctx.beginPath()
      ctx.roundRect(0, 0, newWidth, newH, NODE_R); ctx.clip()
      ctx.drawImage(img, 0, 0, newWidth, newH)
    }
    const src  = new ImageSource({ resource: off, resolution: dpr })
    const tex  = new Texture({ source: src })
    const spr  = new Sprite(tex)
    spr.width  = newWidth; spr.height = newH
    if (useCanvasStore.getState().sfwMode && isNsfwNode(state)) {
      if (state.blurMask) {
        state.blurMask.clear()
        state.blurMask.roundRect(0, 0, newWidth, newH, 10).fill(0xffffff)
      } else {
        const mask = new Graphics()
        mask.roundRect(0, 0, newWidth, newH, 10).fill(0xffffff)
        state.container.addChild(mask)
        state.blurMask = mask
      }
      spr.mask = state.blurMask
      spr.filters = [new BlurFilter({ strength: BASE_SFW_BLUR * (worldRef.current?.scale.x ?? 1), quality: 4 })]
    }
    state.container.addChild(spr)
    state.container.removeChild(state.bg); state.container.addChild(state.bg)
    state.sprite = spr

    redrawBg(state, worldRef.current?.scale.x ?? 1)
  }, [])

  // ─ group color & label ────────────────────────────────────────────────────

  const setGroupColor = useCallback((groupId: string, colorHex: number) => {
    const node = nodesRef.current.get(groupId)
    if (!node) return
    node.groupColor = colorHex
    redrawBg(node, worldRef.current?.scale.x ?? 1)
    setGroupColors(prev => new Map(prev).set(groupId, colorHex))
    // Persist color as hex string in model_name (reused for groups since it's otherwise unused)
    const hexStr = `#${colorHex.toString(16).padStart(6, '0')}`
    window.api.updateNodeMetadata(groupId, 'group', hexStr).catch(console.error)
    useCanvasStore.getState().setNodes(
      useCanvasStore.getState().nodes.map(n =>
        n.id === groupId ? { ...n, data: { ...n.data, modelName: hexStr } } : n
      )
    )
  }, [])

  const deleteGroup = useCallback((groupId: string) => {
    removePixiNode(groupId)
    removeNode(groupId)
    window.api.deleteNode(groupId).catch(console.error)
    // Remove parentId from children
    useCanvasStore.getState().nodes
      .filter(n => (n as { parentId?: string }).parentId === groupId)
      .forEach(n => window.api.updateNodeParent(n.id, null).catch(console.error))
  }, [removePixiNode, removeNode])

  const saveGroupLabel = useCallback((groupId: string, newLabel: string) => {
    setEditingGroupId(null)
    const trimmed = newLabel.trim()
    if (!trimmed) return
    const prevLabel = nodesRef.current.get(groupId)?.data.label ?? 'Grupo'
    const applyLabel = (lbl: string) => {
      useCanvasStore.getState().setNodes(
        useCanvasStore.getState().nodes.map(n =>
          n.id === groupId ? { ...n, data: { ...n.data, label: lbl } } : n
        )
      )
      const n = nodesRef.current.get(groupId)
      if (n) n.data = { ...n.data, label: lbl }
    }
    applyLabel(trimmed)
    pushHistory({ undo: () => applyLabel(prevLabel), redo: () => applyLabel(trimmed) })
  }, [pushHistory])

  // ─ organize nodes ─────────────────────────────────────────────────────────

  const organizeNodes = useCallback((type: 'grid' | 'row' | 'column') => {
    const GAP      = 24  // gap between node slots
    const META_GAP = 14  // gap between image and its metadata node below

    const nodes = [...selIdsRef.current]
      .map(id => nodesRef.current.get(id))
      .filter((n): n is PixiNode => !!n && n.type === 'imageNode')
    if (nodes.length < 2) return

    // Sort left→right then top→bottom for consistent ordering
    nodes.sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y)

    const startX = Math.min(...nodes.map(n => n.x))
    const startY = Math.min(...nodes.map(n => n.y))

    // For each image node find linked metadata and measure its rendered height
    const cells = nodes.map(n => {
      const linkedId = linkedRef.current.get(n.id)
      let metaH = 0
      if (linkedId) {
        const metaEl = metaOverRef.current?.querySelector(`[data-meta-id="${linkedId}"]`) as HTMLElement | null
        metaH = metaEl ? metaEl.offsetHeight : 220
      }
      const cellH = n.height + (linkedId ? META_GAP + metaH : 0)
      return { node: n, linkedId, metaH, cellH }
    })

    const moves: { id: string; x: number; y: number }[] = []

    if (type === 'row') {
      let cx = startX
      for (const { node, linkedId } of cells) {
        moves.push({ id: node.id, x: cx, y: startY })
        if (linkedId) moves.push({ id: linkedId, x: cx, y: startY + node.height + META_GAP })
        cx += node.width + GAP
      }
    } else if (type === 'column') {
      let cy = startY
      for (const { node, linkedId, cellH } of cells) {
        moves.push({ id: node.id, x: startX, y: cy })
        if (linkedId) moves.push({ id: linkedId, x: startX, y: cy + node.height + META_GAP })
        cy += cellH + GAP
      }
    } else { // grid
      const cols = Math.ceil(Math.sqrt(cells.length))
      let cx = startX, cy = startY, col = 0, rowMaxCellH = 0
      for (const { node, linkedId, cellH } of cells) {
        moves.push({ id: node.id, x: cx, y: cy })
        if (linkedId) moves.push({ id: linkedId, x: cx, y: cy + node.height + META_GAP })
        rowMaxCellH = Math.max(rowMaxCellH, cellH)
        col++
        if (col >= cols) {
          col = 0; cx = startX; cy += rowMaxCellH + GAP; rowMaxCellH = 0
        } else {
          cx += node.width + GAP
        }
      }
    }

    // Apply all moves (image nodes via PixiJS container, metadata nodes via DOM)
    for (const { id, x, y } of moves) {
      const node = nodesRef.current.get(id)
      if (!node) continue
      node.x = x; node.y = y
      if (node.container) {
        node.container.x = x; node.container.y = y
      } else if (node.type === 'metadataNode') {
        const el = metaOverRef.current?.querySelector(`[data-meta-id="${id}"]`) as HTMLElement | null
        if (el) { el.style.left = `${x}px`; el.style.top = `${y}px` }
      }
      window.api.updateNodePosition(id, x, y).then(() => flashSave()).catch(console.error)
    }
    useCanvasStore.getState().setNodes(
      useCanvasStore.getState().nodes.map(n => {
        const m = moves.find(mv => mv.id === n.id)
        return m ? { ...n, position: { x: m.x, y: m.y } } : n
      })
    )
  }, [])

  // ─ organize all ───────────────────────────────────────────────────────────

  const organizeAll = useCallback(() => {
    const prevSel     = new Set(selIdsRef.current)
    const prevPrimary = primaryIdRef.current
    selIdsRef.current = new Set(
      [...nodesRef.current.values()].filter(n => n.type === 'imageNode').map(n => n.id)
    )
    organizeNodes('grid')
    selIdsRef.current    = prevSel
    primaryIdRef.current = prevPrimary
  }, [organizeNodes])

  // ─ add to group ───────────────────────────────────────────────────────────

  const addToGroup = useCallback(async () => {
    let selectedIds = [...selIdsRef.current]
    let selectedNodes = selectedIds
      .map(id => nodesRef.current.get(id))
      .filter((n): n is PixiNode => !!n && n.type === 'imageNode')

    // If fewer than 2 image nodes selected, use ALL image nodes on canvas
    if (selectedNodes.length < 2) {
      selectedNodes = [...nodesRef.current.values()].filter(n => n.type === 'imageNode')
      selectedIds   = selectedNodes.map(n => n.id)
    }
    if (selectedNodes.length < 2) return

    const PAD = 40
    const minX = Math.min(...selectedNodes.map(n => n.x)) - PAD
    const minY = Math.min(...selectedNodes.map(n => n.y)) - PAD
    const maxX = Math.max(...selectedNodes.map(n => n.x + n.width))  + PAD
    const maxY = Math.max(...selectedNodes.map(n => n.y + n.height)) + PAD
    const groupW = maxX - minX, groupH = maxY - minY
    const groupId = uuid()

    // Add to store (provides data for the label overlay)
    useCanvasStore.getState().addGroupNode(groupId, { x: minX, y: minY }, { width: groupW, height: groupH }, canvasId)

    // Create PixiJS visual at z=0 (behind everything)
    const groupData = useCanvasStore.getState().nodes.find(n => n.id === groupId)?.data
    if (groupData) addPixiNode(groupId, 'groupNode', minX, minY, groupW, groupData, 0, groupH)

    // Persist to DB (createGroupNode already calls updateParent for children)
    await window.api.createGroupNode(
      { id: groupId, canvasId, x: minX, y: minY, width: groupW, height: groupH },
      selectedIds
    )
  }, [canvasId, addPixiNode])

  // ─ load canvas nodes ──────────────────────────────────────────────────────

  const loadCanvasNodes = useCallback(() => {
    for (const node of nodesRef.current.values()) {
      if (node.container) { worldRef.current?.removeChild(node.container); node.container.destroy({ children: true }) }
    }
    nodesRef.current.clear(); linkedRef.current.clear(); selIdsRef.current.clear()
    primaryIdRef.current = null; setPrimaryId(null); setSelCount(0)

    const storeNodes = useCanvasStore.getState().nodes
    storeNodes.forEach((n, i) => {
      addPixiNode(n.id, n.type as PixiNode['type'], n.position.x, n.position.y,
        (n.style?.width as number) ?? 240, n.data, n.type === 'imageNode' ? i * 50 : 0,
        (n.style?.height as number) ?? undefined)
      if (n.data.linkedImageNodeId) {
        linkedRef.current.set(n.id, n.data.linkedImageNodeId)
        linkedRef.current.set(n.data.linkedImageNodeId, n.id)
      }
      // Trigger AI analysis for nodes that need it (startup retry)
      if (n.type === 'imageNode' && n.data.isPending && !processingRef.current.has(n.id)) {
        processingRef.current.add(n.id)
        enqueueAI(() => processImage(n.data.imagePath, n.id).finally(() => processingRef.current.delete(n.id)))
      }
    })
  }, [addPixiNode, enqueueAI, processImage])

  // Retry analysis on demand (placed after processImage + enqueueAI are initialized)
  useEffect(() => {
    const handler = (e: CustomEvent<{ nodeId: string; imagePath: string }>) => {
      const { nodeId, imagePath } = e.detail
      if (processingRef.current.has(nodeId)) return
      updatePixiNodeData(nodeId, { isPending: true, isError: false })
      processingRef.current.add(nodeId)
      enqueueAI(() => processImage(imagePath, nodeId).finally(() => processingRef.current.delete(nodeId)))
    }
    window.addEventListener('retry-analysis', handler as EventListener)
    return () => window.removeEventListener('retry-analysis', handler as EventListener)
  }, [processImage, enqueueAI, updatePixiNodeData])

  // ─ pixi init ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const el = canvasElRef.current; const ct = containerRef.current
    if (!el || !ct) return
    let cancelled = false
    const cw = Math.max(ct.clientWidth, 800), ch = Math.max(ct.clientHeight, 600)
    setCanvasHeight(ct.clientHeight || 600)
    console.log('[PixiCanvas] init', { cw, ch })

    const app = new Application()
    app.init({ canvas: el, width: cw, height: ch, backgroundAlpha: 0, antialias: false })
      .then(() => {
        if (cancelled) { app.destroy(); return }
        console.log('[PixiCanvas] ready')
        appRef.current = app

        const world = new Container()
        app.stage.addChild(world)
        worldRef.current = world

        // Initialise canvas CSS size explicitly (not via CSS inset-0)
        el.style.width  = `${ct.clientWidth}px`
        el.style.height = `${ct.clientHeight}px`
        el.style.transformOrigin = '0 0'

        // Debounced resize: canvas stays at current size during the drag (no stretch),
        // actual buffer resize happens 120ms after dragging stops.
        let resizeTimer = 0
        const ro = new ResizeObserver(() => {
          const w2 = ct.clientWidth, h2 = ct.clientHeight
          if (!w2 || !h2) return
          setCanvasHeight(h2)
          clearTimeout(resizeTimer)
          resizeTimer = window.setTimeout(() => {
            app.renderer.resize(w2, h2)
            el.style.width  = `${w2}px`
            el.style.height = `${h2}px`
          }, 120) as unknown as number
        })
        ro.observe(ct)
        ;(app as Application & { _ro?: ResizeObserver; _raf?: number })._ro = ro

        // Ticker: sync overlays + dot background every frame
        app.ticker.add(() => {
          const wc = worldRef.current; if (!wc) return
          const wx = wc.x, wy = wc.y, ws = wc.scale.x

          // Dot pattern: scale tile with zoom AND shift with world position.
          // This makes dots appear truly fixed in canvas space (like PureRef/ReactFlow).
          const bg = bgDotsRef.current
          if (bg) {
            const tileSize = DOT_SIZE * ws
            const dotX = ((wx % tileSize) + tileSize) % tileSize
            const dotY = ((wy % tileSize) + tileSize) % tileSize
            const dotOpacity = Math.min(0.12, ws * 0.3)
            bg.style.backgroundSize     = `${tileSize}px ${tileSize}px`
            bg.style.backgroundPosition = `${dotX}px ${dotY}px`
            bg.style.backgroundImage    = `radial-gradient(circle, rgba(255,255,255,${dotOpacity.toFixed(3)}) 1.5px, transparent 1.5px)`
          }

          // Metadata overlay transform
          const mo = metaOverRef.current
          if (mo) mo.style.transform = `translate(${wx}px, ${wy}px) scale(${ws})`

          // Tags panel screen position (right of primary selected node)
          const te = tagsElRef.current; const sid = primaryIdRef.current
          if (te && sid) {
            const node = nodesRef.current.get(sid)
            if (node) {
              te.style.left = `${wx + (node.x + node.width + 16) * ws}px`
              te.style.top  = `${wy + node.y * ws}px`
            }
          }

          // SFW blur: escala a força do blur com o zoom para que a imagem
          // borrada nunca fique discernível ao dar zoom in.
          for (const [, node] of nodesRef.current) {
            if (!node.blurMask || !node.sprite) continue
            const f = node.sprite.filters
            const bf = Array.isArray(f) ? f[0] : f
            if (bf instanceof BlurFilter) bf.strength = BASE_SFW_BLUR * ws
          }

          // Lazy loading: every 30 frames check for deferred nodes now in view
          if (app.ticker.lastTime % 500 < 20) {
            const vx = (-wc.x) / wc.scale.x, vy = (-wc.y) / wc.scale.y
            const vw = (containerRef.current?.clientWidth ?? 800) / wc.scale.x
            const vh = (containerRef.current?.clientHeight ?? 600) / wc.scale.y
            const PAD = 400 / wc.scale.x
            for (const [, node] of nodesRef.current) {
              if (node.type !== 'imageNode' || node.loaded || node.imgLoadStarted === true) continue
              if (node.x + node.width >= vx - PAD && node.x <= vx + vw + PAD &&
                  node.y + node.height >= vy - PAD && node.y <= vy + vh + PAD) {
                node.imgLoadStarted = true
                const lazySrc = node.data.thumbnailPath || node.data.imagePath
                const loadImg = new Image()
                loadImg.onload = () => {
                  if (!nodesRef.current.has(node.id)) return
                  const imgH = Math.round(node.width * loadImg.naturalHeight / loadImg.naturalWidth)
                  node.height = imgH; node.loaded = true; node.imgEl = loadImg
                  const dpr = Math.min(window.devicePixelRatio || 1, 3)
                  const off = document.createElement('canvas')
                  off.width = Math.round(node.width * dpr); off.height = Math.round(imgH * dpr)
                  const ctx = off.getContext('2d')
                  if (ctx) {
                    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
                    ctx.scale(dpr, dpr); ctx.beginPath()
                    ctx.roundRect(0, 0, node.width, imgH, NODE_R); ctx.clip()
                    ctx.drawImage(loadImg, 0, 0, node.width, imgH)
                  }
                  try {
                    const src = new ImageSource({ resource: off, resolution: dpr })
                    const tex = new Texture({ source: src })
                    const spr = new Sprite(tex); spr.width = node.width; spr.height = imgH
                    if (useCanvasStore.getState().sfwMode && (node.data.isPending || isNsfwNode(node))) {
                      if (!node.blurMask) {
                        const mask = new Graphics()
                        mask.roundRect(0, 0, node.width, imgH, 10).fill(0xffffff)
                        node.container?.addChild(mask)
                        node.blurMask = mask
                      }
                      spr.mask = node.blurMask ?? null
                      spr.filters = [new BlurFilter({ strength: BASE_SFW_BLUR * (worldRef.current?.scale.x ?? 1), quality: 4 })]
                    }
                    node.container?.addChild(spr)
                    if (node.bg && node.container) { node.container.removeChild(node.bg); node.container.addChild(node.bg) }
                    node.bg?.clear()
                    node.bg?.roundRect(0, 0, node.width, imgH, NODE_R).fill({ color: 0x000000, alpha: 0 })
                    node.sprite = spr
                    redrawBg(node, wc.scale.x)
                  } catch (e) { console.warn('[lazy load] sprite error:', e) }
                }
                loadImg.onerror = () => {}
                loadImg.src = `file://${lazySrc}`
              }
            }
          }

          // Texture eviction: unload sprites that have been off-screen for 45s+ to free GPU memory
          if (app.ticker.lastTime % 10000 < 20) {
            const EVICT_MS = 45000
            const now = app.ticker.lastTime
            const evx = (-wc.x) / wc.scale.x, evy = (-wc.y) / wc.scale.y
            const evw = (containerRef.current?.clientWidth ?? 800) / wc.scale.x
            const evh = (containerRef.current?.clientHeight ?? 600) / wc.scale.y
            const ePAD = 400 / wc.scale.x
            for (const [, node] of nodesRef.current) {
              if (node.type !== 'imageNode' || !node.loaded || !node.sprite || node.selected) continue
              const inView = node.x + node.width >= evx - ePAD && node.x <= evx + evw + ePAD &&
                             node.y + node.height >= evy - ePAD && node.y <= evy + evh + ePAD
              if (inView) {
                node.lastSeenAt = now
              } else if (node.lastSeenAt && now - node.lastSeenAt > EVICT_MS) {
                // Destroy sprite + texture to free GPU memory
                if (node.sprite && node.container) { node.container.removeChild(node.sprite); node.sprite.destroy(true) }
                node.sprite = null; node.loaded = false; node.imgLoadStarted = false; node.imgEl = undefined
                // Redraw placeholder bg
                node.bg?.clear()
                node.bg?.roundRect(0, 0, node.width, node.height, NODE_R).fill({ color: BG_COL })
              }
            }
          }

          // Redraw selection borders when zoom changes (border scales with zoom)
          if (Math.abs(ws - (prevScaleRef.current ?? 1)) > 0.001) {
            prevScaleRef.current = ws
            for (const id of selIdsRef.current) {
              const node = nodesRef.current.get(id)
              if (node?.selected) redrawBg(node, ws)
            }
          }

          // Minimap render
          const mm = minimapRef.current
          if (mm) {
            const mmCtx = mm.getContext('2d')
            const imageNodes = [...nodesRef.current.values()].filter(n => n.type === 'imageNode' && n.loaded)
            if (mmCtx && imageNodes.length > 0) {
              const PAD = 6
              const minNx = Math.min(...imageNodes.map(n => n.x))
              const minNy = Math.min(...imageNodes.map(n => n.y))
              const maxNx = Math.max(...imageNodes.map(n => n.x + n.width))
              const maxNy = Math.max(...imageNodes.map(n => n.y + n.height))
              const contentW = maxNx - minNx || 1, contentH = maxNy - minNy || 1
              const sc = Math.min((mm.width - PAD*2) / contentW, (mm.height - PAD*2) / contentH)
              const toMX = (x: number) => (x - minNx) * sc + PAD
              const toMY = (y: number) => (y - minNy) * sc + PAD
              mmCtx.clearRect(0, 0, mm.width, mm.height)
              // Nodes
              for (const n of imageNodes) {
                mmCtx.fillStyle = n.selected ? 'rgba(251,146,60,0.85)' : 'rgba(255,255,255,0.35)'
                const nw = Math.max(1, n.width * sc), nh = Math.max(1, n.height * sc)
                mmCtx.beginPath()
                mmCtx.roundRect(toMX(n.x), toMY(n.y), nw, nh, 2)
                mmCtx.fill()
              }
              // Viewport rect
              if (containerRef.current) {
                const vx = (-wc.x) / wc.scale.x, vy = (-wc.y) / wc.scale.y
                const vw = containerRef.current.clientWidth / wc.scale.x
                const vh = containerRef.current.clientHeight / wc.scale.y
                mmCtx.strokeStyle = 'rgba(255,255,255,0.6)'
                mmCtx.lineWidth = 1
                mmCtx.beginPath()
                mmCtx.roundRect(toMX(vx), toMY(vy), Math.max(2, vw * sc), Math.max(2, vh * sc), 2)
                mmCtx.stroke()
              }
            } else if (mmCtx) {
              mmCtx.clearRect(0, 0, mm.width, mm.height)
            }
          }

          // Star indicators — screen-space, follow nodes
          const starDiv = containerRef.current?.querySelector('#star-overlay')
          if (starDiv) {
            const stars = starDiv.querySelectorAll('[data-star-id]') as NodeListOf<HTMLElement>
            stars.forEach(el2 => {
              const id = el2.getAttribute('data-star-id')!
              const n = nodesRef.current.get(id)
              if (!n) return
              el2.style.left = `${wx + n.x * ws + 6}px`
              el2.style.top  = `${wy + n.y * ws + 6}px`
            })
          }

          // Lock icons — screen-space, follow nodes
          const liDiv = lockIconsRef.current
          if (liDiv) {
            const icons = liDiv.querySelectorAll('[data-lock-id]') as NodeListOf<HTMLElement>
            icons.forEach(el2 => {
              const id = el2.getAttribute('data-lock-id')!
              const n = nodesRef.current.get(id)
              if (!n) return
              el2.style.left = `${wx + (n.x + n.width - 20) * ws}px`
              el2.style.top  = `${wy + n.y * ws + 4}px`
            })
          }

          // Group labels — screen-space, follow group + immune to zoom scale
          const glDiv = groupLabelsRef.current
          if (glDiv) {
            const labels = glDiv.querySelectorAll('[data-group-label-id]') as NodeListOf<HTMLElement>
            labels.forEach(el => {
              const id = el.getAttribute('data-group-label-id')!
              const node = nodesRef.current.get(id)
              if (!node) return
              el.style.left = `${wx + node.x * ws}px`
              el.style.top  = `${wy + node.y * ws - 30}px`
            })
          }
        })

        loadCanvasNodes()
        fitView(500)  // initial fit after images start loading
        setPixiReady(true)
      })
      .catch(err => { if (!cancelled) { console.error('[PixiCanvas] init failed:', err); setInitError(String(err)) } })

    return () => {
      cancelled = true
      const ro = (appRef.current as Application & { _ro?: ResizeObserver })?._ro
      ro?.disconnect()
      appRef.current?.destroy(false, { children: true })
      appRef.current = null; worldRef.current = null; setPixiReady(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const prevCanvasRef = useRef(canvasId)
  useEffect(() => {
    if (prevCanvasRef.current === canvasId) return
    prevCanvasRef.current = canvasId
    const world = worldRef.current
    if (!world) return

    const cw = containerRef.current?.clientWidth  ?? 800
    const ch = containerRef.current?.clientHeight ?? 600

    // Start hidden at default zoom — will reset to 0.08 for fly-in only if there are nodes
    world.alpha = 0
    world.scale.set(0.8)
    world.x = cw / 2
    world.y = ch / 2
    setZoom(0.8)
    if (metaOverRef.current)    metaOverRef.current.style.opacity    = '0'
    if (groupLabelsRef.current) groupLabelsRef.current.style.opacity = '0'

    loadCanvasNodes()

    // After 350ms (images start loading, heights are known): fly-in + fade simultaneously
    setTimeout(() => {
      const hasNodes = [...nodesRef.current.values()].some(n => n.type === 'imageNode')

      if (hasNodes) {
        // Reset to zoomed-out position for dramatic fly-in (still hidden, alpha=0)
        world.scale.set(0.08)
        world.x = cw / 2
        world.y = ch / 2
      }

      // Fade in — ease-out cubic, 700ms
      const t0 = performance.now()
      const frame = (now: number) => {
        const t = Math.min((now - t0) / 700, 1), ease = 1 - Math.pow(1 - t, 3)
        world.alpha = ease
        if (t < 1) requestAnimationFrame(frame)
        else world.alpha = 1
      }
      requestAnimationFrame(frame)

      // Animated zoom-in to fit all images
      if (hasNodes) fitView(0, true)

      // CSS overlays fade in
      if (metaOverRef.current)    metaOverRef.current.style.opacity    = '1'
      if (groupLabelsRef.current) groupLabelsRef.current.style.opacity = '1'
    }, 350)
  }, [canvasId, loadCanvasNodes, fitView])

  useEffect(() => {
    (window as Window & { addNodesToCanvas?: typeof addNodes }).addNodesToCanvas = addNodes
    return () => { delete (window as Window & { addNodesToCanvas?: typeof addNodes }).addNodesToCanvas }
  }, [addNodes])

  // Auto-backup every 5 minutes
  useEffect(() => {
    const backup = async () => {
      const store = useCanvasStore.getState()
      if (!store.currentCanvasId || store.nodes.length === 0) return
      const name = store.canvasList.find(c => c.id === store.currentCanvasId)?.name ?? 'canvas'
      const nodesData = store.nodes.map(n => ({
        id: n.id, nodeType: n.type, imagePath: n.data.imagePath,
        positionX: n.position.x, positionY: n.position.y,
        width: (n.style?.width as number) ?? 240, height: (n.style?.height as number) ?? undefined,
        metadataSource: n.data.metadataSource, modelName: n.data.modelName,
        label: n.data.label, isMetadataNode: n.data.isMetadataNode,
        comfyParams: n.data.comfyParams ? JSON.stringify(n.data.comfyParams) : undefined,
        linkedImageNodeId: n.data.linkedImageNodeId,
      }))
      const tagsData = store.nodes.flatMap(n => n.data.tags.map((t: { id: string; category: string; value: string; source: string }) => ({ ...t, nodeId: n.id })))
      await window.api.autoBackup({ name, nodes: nodesData, tags: tagsData })
    }
    const timer = setInterval(backup, 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  // ─ pointer interactions ───────────────────────────────────────────────────

  useEffect(() => {
    const el = canvasElRef.current
    if (!el || !pixiReady) return

    // Returns the resize corner if the pointer is near a corner of a selected imageNode
    const getResizeCorner = (sx: number, sy: number): { node: PixiNode; corner: 'se'|'sw'|'ne'|'nw' } | null => {
      const { x: wx, y: wy } = screenToWorld(sx, sy)
      const ws = getWorld().scale.x
      const THRESH = 16 / ws  // 16px screen space, converted to world units
      for (const id of selIdsRef.current) {
        const n = nodesRef.current.get(id)
        if (!n || n.type !== 'imageNode' || !n.loaded) continue
        const corners: [number, number, 'se'|'sw'|'ne'|'nw'][] = [
          [n.x + n.width, n.y + n.height, 'se'],
          [n.x,           n.y + n.height, 'sw'],
          [n.x + n.width, n.y,            'ne'],
          [n.x,           n.y,            'nw'],
        ]
        for (const [cx, cy, corner] of corners) {
          if (Math.abs(wx - cx) < THRESH && Math.abs(wy - cy) < THRESH) return { node: n, corner }
        }
      }
      return null
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return
      if (isEmptyRef.current) return  // canvas vazio — navegação bloqueada
      setContextMenu(null)
      const rect = el.getBoundingClientRect()
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top
      const w = getWorld()

      // Middle mouse button always pans — never moves a node
      if (e.button === 1) {
        ixRef.current = { kind: 'pan', mx0: e.clientX, my0: e.clientY, wx0: w.x, wy0: w.y, hasMoved: false }
        el.setPointerCapture(e.pointerId)
        return
      }

      // Check resize corner (only for unlocked selected nodes)
      const resizeHit = getResizeCorner(sx, sy)
      if (resizeHit && !resizeHit.node.locked) {
        const { node, corner } = resizeHit
        ixRef.current = { kind: 'resize', id: node.id, corner,
          mx0: e.clientX, my0: e.clientY, w0: node.width, h0: node.height, x0: node.x, y0: node.y }
        el.setPointerCapture(e.pointerId)
        return
      }

      const hit = getNodeAt(sx, sy)

      if (hit) {
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+click: toggle this node in/out of selection
          toggleSelect(hit.id)
        } else {
          // Plain click: single-select unless already selected (start drag without clearing)
          if (!selIdsRef.current.has(hit.id)) selectOne(hit.id)
          else { primaryIdRef.current = hit.id; setPrimaryId(hit.id) } // just promote to primary
        }
        // Capture initial positions — skip locked nodes
        const starts = new Map<string, { x: number; y: number }>()
        for (const id of selIdsRef.current) {
          const n = nodesRef.current.get(id)
          if (n && !n.locked) starts.set(id, { x: n.x, y: n.y })
          // Include linked metadata node so it drags together
          const linkedId = linkedRef.current.get(id)
          if (linkedId) {
            const ln = nodesRef.current.get(linkedId)
            if (ln) starts.set(linkedId, { x: ln.x, y: ln.y })
          }
          // If dragging a group, bring along all images whose center is inside it
          if (n?.type === 'groupNode') {
            for (const [, img] of nodesRef.current) {
              if (img.type !== 'imageNode' || img.locked || starts.has(img.id)) continue
              const cx = img.x + img.width / 2
              const cy = img.y + img.height / 2
              if (cx >= n.x && cx <= n.x + n.width && cy >= n.y && cy <= n.y + n.height) {
                starts.set(img.id, { x: img.x, y: img.y })
                const lnkId = linkedRef.current.get(img.id)
                if (lnkId) {
                  const lnk = nodesRef.current.get(lnkId)
                  if (lnk) starts.set(lnkId, { x: lnk.x, y: lnk.y })
                }
              }
            }
          }
        }
        ixRef.current = { kind: 'drag', mx0: e.clientX, my0: e.clientY, starts, hasMoved: false }
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl + drag on empty space → rubber-band / marquee selection
        const cRect = containerRef.current!.getBoundingClientRect()
        ixRef.current = { kind: 'marquee', sx0: e.clientX - cRect.left, sy0: e.clientY - cRect.top }
        // Don't clear existing selection — Ctrl adds to it
      } else {
        // Don't clear selection yet — only clear if this ends up being a plain click (no drag)
        ixRef.current = { kind: 'pan', mx0: e.clientX, my0: e.clientY, wx0: w.x, wy0: w.y, hasMoved: false }
      }
      el.setPointerCapture(e.pointerId)
    }

    const RESIZE_CURSORS: Record<string, string> = { se: 'se-resize', sw: 'sw-resize', ne: 'ne-resize', nw: 'nw-resize' }

    const onMove = (e: PointerEvent) => {
      const ix = ixRef.current

      if (ix.kind === 'idle') {
        // Update resize cursor when hovering near corners of selected nodes
        const rect2 = el.getBoundingClientRect()
        const hit2 = getResizeCorner(e.clientX - rect2.left, e.clientY - rect2.top)
        el.style.cursor = hit2 ? RESIZE_CURSORS[hit2.corner] : ''
        return
      }

      if (ix.kind === 'pan') {
        const dx = e.clientX - ix.mx0, dy = e.clientY - ix.my0
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) ix.hasMoved = true
        const w = getWorld(); w.x = ix.wx0 + dx; w.y = ix.wy0 + dy
        return
      }

      if (ix.kind === 'resize') {
        const ws = getWorld().scale.x
        const dx = (e.clientX - ix.mx0) / ws
        let newW: number, newX = ix.x0
        if (ix.corner === 'se' || ix.corner === 'ne') newW = Math.max(MIN_W, ix.w0 + dx)
        else { newW = Math.max(MIN_W, ix.w0 - dx); newX = ix.x0 + (ix.w0 - newW) }

        // Snap right/left edge to nearby nodes
        const sg = snapGuideRef.current
        if (sg) sg.innerHTML = ''
        if (snapEnabledRef.current) {
          const SNAP_WORLD = 10 / ws
          const isRight = ix.corner === 'se' || ix.corner === 'ne'
          const movingEdge = isRight ? newX + newW : newX
          let snapEdge: number | null = null
          outer: for (const o of nodesRef.current.values()) {
            if (o.id === ix.id || o.type !== 'imageNode' || !o.loaded) continue
            for (const t of [o.x, o.x + o.width]) {
              if (Math.abs(movingEdge - t) < SNAP_WORLD) {
                snapEdge = t
                if (isRight) newW = Math.max(MIN_W, t - newX)
                else { newW = Math.max(MIN_W, ix.x0 + ix.w0 - t); newX = t }
                break outer
              }
            }
          }
          // Draw snap guide line
          if (snapEdge !== null && sg) {
            const wc = getWorld()
            const line = document.createElement('div')
            line.style.cssText = `position:absolute;left:${wc.x + snapEdge * wc.scale.x}px;top:0;width:1px;height:100%;background:rgba(251,146,60,0.55);pointer-events:none`
            sg.appendChild(line)
          }
        }

        const node = nodesRef.current.get(ix.id)
        if (node?.container && node.sprite) {
          node.container.x = newX; node.x = newX
          const aspect = node.imgEl
            ? node.imgEl.naturalHeight / node.imgEl.naturalWidth
            : node.sprite.texture.height / node.sprite.texture.width

          // Snap to matching height or width of nearby nodes
          if (snapEnabledRef.current) {
            const SNAP_PX = 10, SNAP_W = SNAP_PX / ws
            const currentH = newW * aspect
            let snapH: number | null = null
            let snapW: number | null = null
            for (const o of nodesRef.current.values()) {
              if (o.id === ix.id || o.type !== 'imageNode' || !o.loaded) continue
              if (snapH === null && Math.abs(currentH - o.height) < SNAP_W) snapH = o.height
              if (snapW === null && Math.abs(newW   - o.width)  < SNAP_W) snapW = o.width
              if (snapH !== null && snapW !== null) break
            }
            // Height snap takes priority (adjusts width to match target height)
            if (snapH !== null) {
              newW = Math.max(MIN_W, snapH / aspect)
              // Draw horizontal guide
              if (sg) {
                const wc = getWorld()
                const line = document.createElement('div')
                line.style.cssText = `position:absolute;top:${wc.y + (node.y + snapH) * wc.scale.x}px;left:0;height:1px;width:100%;background:rgba(251,146,60,0.55);pointer-events:none`
                sg.appendChild(line)
              }
            } else if (snapW !== null) {
              newW = Math.max(MIN_W, snapW)
            }
          }

          const newH = Math.round(newW * aspect)
          node.sprite.width = newW; node.sprite.height = newH
          node.width = newW; node.height = newH
          if (node.bg) redrawBg(node, ws)

          // Keep linked metadata node below the image in real-time
          const metaId = linkedRef.current.get(ix.id)
          if (metaId) {
            const metaNode = nodesRef.current.get(metaId)
            if (metaNode) {
              const newMetaY = node.y + newH + 14
              metaNode.y = newMetaY
              const metaEl = metaOverRef.current?.querySelector(`[data-meta-id="${metaId}"]`) as HTMLElement | null
              if (metaEl) metaEl.style.top = `${newMetaY}px`
            }
          }
        }
        return
      }

      if (ix.kind === 'marquee') {
        const cRect = containerRef.current!.getBoundingClientRect()
        const cx = e.clientX - cRect.left, cy = e.clientY - cRect.top
        const mx = Math.min(ix.sx0, cx), my = Math.min(ix.sy0, cy)
        const mw = Math.abs(cx - ix.sx0),  mh = Math.abs(cy - ix.sy0)
        const mel = marqueeRef.current
        if (mel) {
          mel.style.display = 'block'
          mel.style.left    = `${mx}px`
          mel.style.top     = `${my}px`
          mel.style.width   = `${mw}px`
          mel.style.height  = `${mh}px`
        }
        return
      }

      if (ix.kind === 'drag') {
        const s = getWorld().scale.x
        let dx = (e.clientX - ix.mx0) / s, dy = (e.clientY - ix.my0) / s
        if (!ix.hasMoved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return
        ix.hasMoved = true

        // Snap to alignment (only when snap is enabled)
        if (!snapEnabledRef.current) { if (snapGuideRef.current) snapGuideRef.current.innerHTML = '' }
        const wScale = getWorld().scale.x
        const SNAP_PX    = 6                    // px on screen to snap
        const SNAP_WORLD = SNAP_PX / wScale     // same threshold in world units
        const PROX_WORLD = 200 / wScale         // only check nodes within 200px screen

        const draggingIds = new Set([...ix.starts.keys()])
        const primaryDragId = [...ix.starts.keys()].find(id => nodesRef.current.get(id)?.type === 'imageNode')
        const primaryNode = primaryDragId ? nodesRef.current.get(primaryDragId) : null
        const pStart = primaryDragId ? ix.starts.get(primaryDragId) : null
        let snapX: number | null = null, snapY: number | null = null

        if (snapEnabledRef.current && primaryNode && pStart) {
          const curX = pStart.x + dx, curY = pStart.y + dy
          const pw = primaryNode.width, ph = primaryNode.height

          // Only check nodes that are actually close (proximity filter)
          const nearby = [...nodesRef.current.values()].filter(n =>
            n.type === 'imageNode' && n.loaded && !draggingIds.has(n.id) &&
            Math.abs(n.x - curX) < pw + PROX_WORLD &&
            Math.abs(n.y - curY) < ph + PROX_WORLD
          )

          for (const o of nearby) {
            if (snapX === null) {
              // Left/center/right alignment
              for (const [a, b] of [
                [curX,        o.x],            [curX,        o.x + o.width],
                [curX + pw/2, o.x + o.width/2],[curX + pw,   o.x],
                [curX + pw,   o.x + o.width],
              ] as [number, number][]) {
                if (Math.abs(a - b) < SNAP_WORLD) { snapX = b - (a - curX); break }
              }
            }
            if (snapY === null) {
              for (const [a, b] of [
                [curY,        o.y],            [curY,        o.y + o.height],
                [curY + ph/2, o.y + o.height/2],[curY + ph,   o.y],
                [curY + ph,   o.y + o.height],
              ] as [number, number][]) {
                if (Math.abs(a - b) < SNAP_WORLD) { snapY = b - (a - curY); break }
              }
            }
            if (snapX !== null && snapY !== null) break
          }

          if (snapX !== null) dx = snapX - pStart.x
          if (snapY !== null) dy = snapY - pStart.y
        }

        // Snap guide lines (orange)
        const sg = snapGuideRef.current
        if (sg) {
          sg.innerHTML = ''
          const wc = getWorld()
          if (snapX !== null) {
            const line = document.createElement('div')
            line.style.cssText = `position:absolute;left:${wc.x + snapX * wc.scale.x}px;top:0;width:1px;height:100%;background:rgba(251,146,60,0.55);pointer-events:none`
            sg.appendChild(line)
          }
          if (snapY !== null) {
            const line = document.createElement('div')
            line.style.cssText = `position:absolute;top:${wc.y + snapY * wc.scale.y}px;left:0;height:1px;width:100%;background:rgba(251,146,60,0.55);pointer-events:none`
            sg.appendChild(line)
          }
        }

        // Move ALL nodes in starts (selected + their linked metadata nodes)
        for (const [id, start] of ix.starts) {
          const node = nodesRef.current.get(id)
          if (!node) continue
          node.x = start.x + dx; node.y = start.y + dy
          if (node.container) {
            // PixiJS image node — update the sprite container
            node.container.x = node.x; node.container.y = node.y
          } else if (node.type === 'metadataNode') {
            // React DOM overlay — update style directly to avoid per-frame re-renders
            const el = metaOverRef.current?.querySelector(`[data-meta-id="${id}"]`) as HTMLElement | null
            if (el) { el.style.left = `${node.x}px`; el.style.top = `${node.y}px` }
          }
        }
      }
    }

    const onUp = (e: PointerEvent) => {
      const ix = ixRef.current; ixRef.current = { kind: 'idle' }

      if (ix.kind === 'pan' && !ix.hasMoved) {
        // Plain click on empty space (no drag) → deselect
        clearAllSelection()
        return
      }

      if (ix.kind === 'resize') {
        const node = nodesRef.current.get(ix.id)
        if (node) {
          const w0 = ix.w0, x0 = ix.x0, finalW = node.width, finalX = node.x
          resizeNode(ix.id, finalW)  // redraw at full quality
          window.api.updateNodeSize(ix.id, finalW, node.height).catch(console.error)
          window.api.updateNodePosition(ix.id, finalX, node.y).catch(console.error)
          useCanvasStore.getState().setNodes(
            useCanvasStore.getState().nodes.map(n => n.id === ix.id
              ? { ...n, style: { ...n.style, width: finalW }, position: { x: finalX, y: n.position.y } }
              : n)
          )

          // Move linked metadata node to sit below the resized image
          const metaId = linkedRef.current.get(ix.id)
          if (metaId) {
            const metaNode = nodesRef.current.get(metaId)
            if (metaNode) {
              const newMetaY = node.y + node.height + 14
              metaNode.y = newMetaY
              const metaEl = metaOverRef.current?.querySelector(`[data-meta-id="${metaId}"]`) as HTMLElement | null
              if (metaEl) { metaEl.style.top = `${newMetaY}px` }
              useCanvasStore.getState().setNodes(
                useCanvasStore.getState().nodes.map(n =>
                  n.id === metaId ? { ...n, position: { x: n.position.x, y: newMetaY } } : n
                )
              )
              window.api.updateNodePosition(metaId, metaNode.x, newMetaY).catch(console.error)
            }
          }

          pushHistory({
            undo: () => { resizeNode(ix.id, w0); const n = nodesRef.current.get(ix.id); if (n?.container) { n.container.x = x0; n.x = x0 } },
            redo: () => { resizeNode(ix.id, finalW); const n = nodesRef.current.get(ix.id); if (n?.container) { n.container.x = finalX; n.x = finalX } },
          })
        }
        if (snapGuideRef.current) snapGuideRef.current.innerHTML = ''
        return
      }

      if (ix.kind === 'marquee') {
        const mel = marqueeRef.current
        if (mel) mel.style.display = 'none'

        // Convert marquee screen rect → world rect, then select intersecting nodes
        const cRect = containerRef.current!.getBoundingClientRect()
        const cx = e.clientX - cRect.left, cy = e.clientY - cRect.top
        const sx0 = Math.min(ix.sx0, cx), sy0 = Math.min(ix.sy0, cy)
        const sx1 = Math.max(ix.sx0, cx), sy1 = Math.max(ix.sy0, cy)
        if (sx1 - sx0 < 4 && sy1 - sy0 < 4) return  // too small — ignore

        const w = getWorld()
        const wx0 = (sx0 - w.x) / w.scale.x, wy0 = (sy0 - w.y) / w.scale.y
        const wx1 = (sx1 - w.x) / w.scale.x, wy1 = (sy1 - w.y) / w.scale.y

        let firstId: string | null = null
        for (const [id, node] of nodesRef.current) {
          if (node.type === 'metadataNode') continue
          // Intersect check
          if (node.x < wx1 && node.x + node.width > wx0 && node.y < wy1 && node.y + node.height > wy0) {
            setNodeSelected(node, true)
            selIdsRef.current.add(id)
            if (!firstId && node.type === 'imageNode') firstId = id
          }
        }
        if (firstId) { primaryIdRef.current = firstId; setPrimaryId(firstId) }
        setSelCount(selIdsRef.current.size)
        return
      }

      // Clear snap guides
      if (snapGuideRef.current) snapGuideRef.current.innerHTML = ''

      if (ix.kind !== 'drag' || !ix.hasMoved) return

      // Build before/after snapshot for undo
      const moved = [...ix.starts.entries()].map(([id, from]) => {
        const n = nodesRef.current.get(id)
        return n ? { id, from, to: { x: n.x, y: n.y } } : null
      }).filter(Boolean) as { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[]

      const applyPos = (entries: { id: string; x: number; y: number }[]) => {
        entries.forEach(({ id, x, y }) => {
          const n = nodesRef.current.get(id)
          if (!n) return
          n.x = x; n.y = y
          if (n.container) { n.container.x = x; n.container.y = y }
          else if (n.type === 'metadataNode') {
            const el2 = metaOverRef.current?.querySelector(`[data-meta-id="${id}"]`) as HTMLElement | null
            if (el2) { el2.style.left = `${x}px`; el2.style.top = `${y}px` }
          }
          window.api.updateNodePosition(id, x, y).then(() => flashSave()).catch(console.error)
        })
        useCanvasStore.getState().setNodes(
          useCanvasStore.getState().nodes.map(n => {
            const e2 = entries.find(e => e.id === n.id)
            return e2 ? { ...n, position: { x: e2.x, y: e2.y } } : n
          })
        )
      }

      applyPos(moved.map(e => ({ id: e.id, x: e.to.x, y: e.to.y })))
      pushHistory({
        undo: () => applyPos(moved.map(e => ({ id: e.id, x: e.from.x, y: e.from.y }))),
        redo: () => applyPos(moved.map(e => ({ id: e.id, x: e.to.x, y: e.to.y }))),
      })
    }

    const onWheel = (e: WheelEvent) => {
      // Allow scroll inside panels that have data-scrollable (e.g. shortcuts panel)
      if ((e.target as Element)?.closest('[data-scrollable]')) return
      e.preventDefault()
      if (isEmptyRef.current) return  // canvas vazio — zoom bloqueado
      const w = getWorld()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top

      // Normalize delta across mouse wheel (large deltaY, few events)
      // and trackpad 2-finger scroll (small deltaY, many events)
      let delta = e.deltaY
      if (e.deltaMode === 1) delta *= 30   // line mode → pixels
      if (e.deltaMode === 2) delta *= 300  // page mode → pixels

      const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, w.scale.x * Math.exp(-delta * 0.003)))
      w.x = mx - (mx - w.x) * (newScale / w.scale.x)
      w.y = my - (my - w.y) * (newScale / w.scale.y)
      w.scale.set(newScale); setZoom(newScale)
    }

    const onCtxMenu = (e: MouseEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const hit = getNodeAt(e.clientX - rect.left, e.clientY - rect.top)
      if (hit) {
        if (!selIdsRef.current.has(hit.id)) selectOne(hit.id)
        setContextMenu({ x: e.clientX, y: e.clientY, nodeId: hit.id })
      } else {
        setContextMenu({ x: e.clientX, y: e.clientY, isCanvas: true })
      }
    }

    const buildExportData = () => {
      const store = useCanvasStore.getState()
      const name = store.canvasList.find(c => c.id === store.currentCanvasId)?.name ?? 'canvas'
      const nodes = store.nodes.map(n => ({
        id: n.id, nodeType: n.type, parentId: (n as { parentId?: string }).parentId,
        imagePath: n.data.imagePath, positionX: n.position.x, positionY: n.position.y,
        width: (n.style?.width as number) ?? 240, height: (n.style?.height as number) ?? undefined,
        metadataSource: n.data.metadataSource, modelName: n.data.modelName,
        label: n.data.label, isMetadataNode: n.data.isMetadataNode ?? false,
        comfyParams: n.data.comfyParams ? JSON.stringify(n.data.comfyParams) : undefined,
        linkedImageNodeId: n.data.linkedImageNodeId,
      }))
      const tags = store.nodes.flatMap(n => n.data.tags.map(t => ({ ...t, nodeId: n.id })))
      return { name, nodes, tags }
    }

    const saveCtrlS = async () => {
      const store = useCanvasStore.getState()
      if (!store.currentCanvasId) return
      const settingKey = `savePath_${store.currentCanvasId}`
      // Check if we already have a saved path for this canvas
      const savedPath = await window.api.getSetting(settingKey) as string | null
      const data = buildExportData()
      if (savedPath) {
        // Overwrite existing file silently
        const ok = await window.api.saveToPath(savedPath, data)
        if (ok) { flashSave(); return }
        // File gone — fall through to dialog
      }
      // First save: open dialog, then store chosen path
      const chosenPath = await window.api.exportCanvasFile(data)
      if (chosenPath) {
        await window.api.setSetting(settingKey, chosenPath)
        flashSave()
      }
    }

    const saveCtrlShiftS = async () => {
      if (!useCanvasStore.getState().currentCanvasId) return
      const data = buildExportData()
      const ok = await window.api.exportCanvasFile(data)
      if (ok) flashSave()
    }

    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      // Ctrl+S — save to existing file (or open dialog first time)
      if (ctrl && e.key.toLowerCase() === 's' && !e.shiftKey) { e.preventDefault(); saveCtrlS(); return }
      // Ctrl+Shift+S — always open dialog (Save As) — e.key is 'S' when Shift held
      if (ctrl && e.key.toLowerCase() === 's' && e.shiftKey)  { e.preventDefault(); saveCtrlShiftS(); return }
      // Undo
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        const idx = historyIdxRef.current
        if (idx >= 0) { historyRef.current[idx].undo(); historyIdxRef.current-- }
        return
      }
      // Redo
      if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        if (historyIdxRef.current < historyRef.current.length - 1) {
          historyIdxRef.current++
          historyRef.current[historyIdxRef.current].redo()
        }
        return
      }
      // Copy
      if (ctrl && e.key === 'c' && selIdsRef.current.size > 0) {
        const nodes = [...selIdsRef.current]
          .map(id => nodesRef.current.get(id))
          .filter((n): n is PixiNode => !!n && n.type === 'imageNode')
        if (nodes.length === 0) return
        const minX = Math.min(...nodes.map(n => n.x))
        const minY = Math.min(...nodes.map(n => n.y))
        clipboardRef.current = nodes.map(n => ({
          imagePath: n.data.imagePath,
          width: n.width,
          relX: n.x - minX,
          relY: n.y - minY,
          data: n.data,
        }))
        return
      }
      // Paste
      if (ctrl && e.key === 'v' && clipboardRef.current.length > 0) {
        const w = worldRef.current
        const ct = containerRef.current
        if (!w || !ct) return
        // Paste at center of viewport
        const cx = (ct.clientWidth / 2 - w.x) / w.scale.x + 40
        const cy = (ct.clientHeight / 2 - w.y) / w.scale.y + 40
        const newIds: string[] = []
        clipboardRef.current.forEach(item => {
          const pos = { x: cx + item.relX, y: cy + item.relY }
          const nodeId = addImageNode(item.imagePath, pos, canvasId, item.width)
          const newData = { ...item.data, tags: item.data.tags.map(t => ({ ...t, id: uuid() })), canvasId }
          useCanvasStore.getState().updateNodeData(nodeId, newData)
          const freshData = useCanvasStore.getState().nodes.find(n => n.id === nodeId)?.data
          if (freshData) addPixiNode(nodeId, 'imageNode', pos.x, pos.y, item.width, freshData)
          window.api.createNode({ id: nodeId, canvasId, imagePath: item.imagePath, x: pos.x, y: pos.y, width: item.width, height: 200, source: item.data.metadataSource }).catch(console.error)
          if (item.data.tags.length > 0) window.api.saveNodeTags(nodeId, item.data.tags).catch(console.error)
          newIds.push(nodeId)
        })
        // Push undo for paste
        pushHistory({
          undo: () => {
            newIds.forEach(id => {
              removePixiNode(id)
              removeNode(id)
              window.api.deleteNode(id).catch(console.error)
            })
          },
          redo: () => { /* re-paste is complex; skip for now */ },
        })
        return
      }
      // Ctrl+D — duplicate selected nodes
      if (ctrl && e.key === 'd') {
        e.preventDefault()
        const OFFSET = 24
        const nodes = [...selIdsRef.current]
          .map(id => nodesRef.current.get(id))
          .filter((n): n is PixiNode => !!n && n.type === 'imageNode')
        if (nodes.length === 0) return
        nodes.forEach(src => {
          const pos = { x: src.x + OFFSET, y: src.y + OFFSET }
          const nodeId = addImageNode(src.data.imagePath, pos, canvasId, src.width)
          const newData = { ...src.data, tags: src.data.tags.map(t => ({ ...t, id: uuid() })), canvasId }
          useCanvasStore.getState().updateNodeData(nodeId, newData)
          const fd = useCanvasStore.getState().nodes.find(n => n.id === nodeId)?.data
          if (fd) addPixiNode(nodeId, 'imageNode', pos.x, pos.y, src.width, fd)
          window.api.createNode({ id: nodeId, canvasId, imagePath: src.data.imagePath, x: pos.x, y: pos.y, width: src.width, height: 200, source: src.data.metadataSource }).catch(console.error)
          if (src.data.tags.length > 0) window.api.saveNodeTags(nodeId, src.data.tags).catch(console.error)
        })
        return
      }
      // M — toggle minimap
      if ((e.key === 'm' || e.key === 'M') && !ctrl) { setMinimapVisible(v => !v); return }
      // S — toggle snap
      if ((e.key === 's' || e.key === 'S') && !ctrl) {
        const next = !snapEnabledRef.current
        snapEnabledRef.current = next
        setSnapEnabled(next)
        return
      }
      // ? — toggle shortcuts panel
      if (e.key === '?') { setShowShortcuts(s => !s); return }
      if (e.key === 'Escape') { setShowShortcuts(false); return }
      // ] — bring to front, [ — send to back
      if (e.key === ']' && selIdsRef.current.size > 0) {
        selIdsRef.current.forEach(id => {
          const n = nodesRef.current.get(id)
          if (n?.container && worldRef.current) {
            worldRef.current.removeChild(n.container); worldRef.current.addChild(n.container)
          }
        }); return
      }
      if (e.key === '[' && selIdsRef.current.size > 0) {
        selIdsRef.current.forEach(id => {
          const n = nodesRef.current.get(id)
          if (n?.container && worldRef.current) {
            worldRef.current.removeChild(n.container); worldRef.current.addChildAt(n.container, 0)
          }
        }); return
      }
      // L — toggle lock for selected nodes
      if (e.key === 'l' || e.key === 'L') {
        const anyUnlocked = [...selIdsRef.current].some(id => !nodesRef.current.get(id)?.locked)
        selIdsRef.current.forEach(id => {
          const n = nodesRef.current.get(id)
          if (n) n.locked = anyUnlocked  // lock all if any are unlocked, else unlock all
        })
        setPrimaryId(p => p)  // force re-render for lock icons
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selIdsRef.current.size > 0) deleteSelected()
      // Ctrl+V — paste image from clipboard
      if ((e.key === 'v' || e.key === 'V') && (e.ctrlKey || e.metaKey)) {
        window.api.readClipboardImage().then(p => { if (p) addNodes([p]) }).catch(console.error)
      }
    }

    const onDblClick = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      const hit = getNodeAt(e.clientX - rect.left, e.clientY - rect.top)
      if (!hit) return
      const ct = containerRef.current!
      const cx = hit.x + hit.width  / 2
      const cy = hit.y + hit.height / 2
      const targetScale = Math.min(
        (ct.clientWidth  * 0.55) / hit.width,
        (ct.clientHeight * 0.55) / hit.height,
        MAX_ZOOM,
      )
      const targetX = ct.clientWidth  / 2 - cx * targetScale
      const targetY = ct.clientHeight / 2 - cy * targetScale

      // Smooth zoom animation — ease-out cubic, 420ms
      const w = getWorld()
      const s0 = w.scale.x, x0 = w.x, y0 = w.y
      const t0 = performance.now()
      const DURATION = 420

      const frame = (now: number) => {
        const raw  = Math.min((now - t0) / DURATION, 1)
        const ease = 1 - Math.pow(1 - raw, 3)   // ease-out cubic
        w.scale.set(s0 + (targetScale - s0) * ease)
        w.x = x0 + (targetX - x0) * ease
        w.y = y0 + (targetY - y0) * ease
        setZoom(w.scale.x)
        if (raw < 1) requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    }

    // Middle-button pan from anywhere inside the container (including overlay panels)
    const ct = containerRef.current!
    const onContainerMiddleDown = (e: PointerEvent) => {
      if (e.button !== 1 || e.target === el) return // canvas already handles it
      e.preventDefault()
      const w = getWorld()
      ixRef.current = { kind: 'pan', mx0: e.clientX, my0: e.clientY, wx0: w.x, wy0: w.y, hasMoved: false }
    }
    // Window-level move/up so pan works even when pointer is over overlays
    const onWindowMove = (e: PointerEvent) => {
      const ix = ixRef.current
      if (ix.kind !== 'pan') return
      const dx = e.clientX - ix.mx0, dy = e.clientY - ix.my0
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) ix.hasMoved = true
      const w = getWorld(); w.x = ix.wx0 + dx; w.y = ix.wy0 + dy
    }
    const onWindowUp = () => {
      const ix = ixRef.current
      if (ix.kind !== 'pan') return
      ixRef.current = { kind: 'idle' }
      if (!ix.hasMoved) clearAllSelection()
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('dblclick', onDblClick)
    el.addEventListener('contextmenu', onCtxMenu)
    // Attach wheel on the container with capture so overlays (tags panel, metadata) don't block zoom
    const ct2 = containerRef.current!
    ct2.addEventListener('wheel', onWheel, { passive: false, capture: true })
    ct.addEventListener('pointerdown', onContainerMiddleDown)
    window.addEventListener('pointermove', onWindowMove)
    window.addEventListener('pointerup', onWindowUp)
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('dblclick', onDblClick)
      el.removeEventListener('contextmenu', onCtxMenu)
      ct2.removeEventListener('wheel', onWheel, { capture: true })
      ct.removeEventListener('pointerdown', onContainerMiddleDown)
      window.removeEventListener('pointermove', onWindowMove)
      window.removeEventListener('pointerup', onWindowUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [pixiReady, selectOne, toggleSelect, clearAllSelection, deleteSelected])

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }, [])
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const paths: string[] = []
    for (const file of Array.from(e.dataTransfer.files)) {
      let p: string
      try { p = window.api.getPathForFile(file) } catch { p = (file as File & { path?: string }).path ?? '' }
      if (p && /\.(png|jpe?g|webp)$/i.test(p)) paths.push(p)
    }
    if (paths.length > 0) addNodes(paths, { x: e.clientX, y: e.clientY })
  }, [addNodes])

  // ─ render ─────────────────────────────────────────────────────────────────

  if (initError) {
    return (
      <div className="flex-1 min-h-0 relative bg-black rounded-[16px] overflow-hidden flex items-center justify-center">
        <div className="text-red-400/70 text-sm text-center px-8">
          <div className="font-medium mb-1">Erro ao inicializar WebGL</div>
          <div className="text-white/30 text-xs font-mono">{initError}</div>
        </div>
      </div>
    )
  }

  const primaryType = primaryId ? nodesRef.current.get(primaryId)?.type : null
  const showTags = primaryId && selectedNodeData && primaryType === 'imageNode' && selCount === 1

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 relative rounded-[16px] overflow-hidden"
      style={{ background: '#121212' }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Dot pattern — backgroundPosition updated by ticker to pan with the canvas */}
      <div
        ref={bgDotsRef}
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.12) 1.5px, transparent 1.5px)',
          backgroundSize: `${DOT_SIZE}px ${DOT_SIZE}px`,   // overwritten by ticker
          backgroundPosition: '0px 0px',                    // overwritten by ticker
        }}
      />

      {/* Snap alignment guides — filled by drag onMove via innerHTML */}
      <div ref={snapGuideRef} className="absolute inset-0 pointer-events-none z-10" />

      {/* Canvas sized via JS only — prevents flicker from CSS resize outrunning PixiJS buffer update */}
      <canvas ref={canvasElRef} style={{ position: 'absolute', top: 0, left: 0, display: 'block' }} />

      {/* Rubber-band marquee selection box — shown during Ctrl+drag */}
      <div
        ref={marqueeRef}
        className="absolute pointer-events-none z-30"
        style={{
          display: 'none',
          border: '1px solid rgba(251,146,60,0.7)',
          background: 'rgba(251,146,60,0.07)',
          borderRadius: 10,
        }}
      />

      {/* Metadata nodes — React DOM at world coordinates, synced via ticker */}
      <div ref={metaOverRef} className="absolute top-0 left-0 pointer-events-none" style={{ transformOrigin: '0 0', transition: 'opacity 700ms ease-out' }}>
        {metaNodes.map(n => {
          const linkedImageId = linkedRef.current.get(n.id)
          // Visible only when linked image (or the meta node itself) is selected
          const isVisible = linkedImageId ? primaryId === linkedImageId : primaryId === n.id
          return (
            <div
              key={n.id}
              data-meta-id={n.id}
              className="absolute"
              style={{
                left: n.position.x,
                top: n.position.y,
                opacity: isVisible ? 1 : 0,
                pointerEvents: isVisible ? 'auto' : 'none',
                transition: 'opacity 180ms ease',
              }}
            >
              <MetadataNodeView data={n.data} selected={isVisible} />
            </div>
          )
        })}
      </div>

      {/* Tags panel — screen space, positioned by ticker */}
      {showTags && (
        <div ref={tagsElRef} className="absolute z-[5] pointer-events-auto" style={{ left: 0, top: 0 }}>
          <TagsPanel nodeId={primaryId} data={selectedNodeData} />
        </div>
      )}

      {/* Group labels — screen-space so they stay readable at any zoom */}
      <div ref={groupLabelsRef} className="absolute inset-0 pointer-events-none overflow-hidden" style={{ transition: 'opacity 700ms ease-out' }}>
        {groupNodes.map(n => {
          const pixiNode = nodesRef.current.get(n.id)
          const colorHex = `#${((pixiNode?.groupColor ?? GRP_COL) >>> 0).toString(16).padStart(6, '0')}`
          const isSelected = primaryId === n.id
          const isEditing  = editingGroupId === n.id
          return (
            <div
              key={n.id}
              data-group-label-id={n.id}
              className="absolute flex items-center gap-2"
              style={{ pointerEvents: 'auto', top: 0, left: 0 }}
            >
              {isEditing ? (
                <input
                  autoFocus
                  value={editingLabel}
                  onChange={e => setEditingLabel(e.target.value)}
                  onBlur={() => saveGroupLabel(n.id, editingLabel)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === 'Escape') saveGroupLabel(n.id, editingLabel)
                    e.stopPropagation()
                  }}
                  onPointerDown={e => e.stopPropagation()}
                  className="bg-transparent outline-none text-[11px] font-medium tracking-widest uppercase"
                  style={{ color: colorHex, width: Math.max(60, editingLabel.length * 8) }}
                />
              ) : (
                <span
                  className="text-[11px] font-medium tracking-widest uppercase select-none cursor-default whitespace-nowrap"
                  style={{ color: colorHex }}
                  onDoubleClick={e => {
                    e.stopPropagation()
                    setEditingGroupId(n.id)
                    setEditingLabel(n.data.label ?? 'Grupo')
                  }}
                >
                  {n.data.label ?? 'Grupo'}
                </span>
              )}

              {isSelected && !isEditing && (
                <div
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-white/10 shadow-lg"
                  style={{ background: '#1c1c1c' }}
                  onPointerDown={e => e.stopPropagation()}
                >
                  {([
                    { hex: '#f97316', pixi: 0xf97316 },
                    { hex: '#8b5cf6', pixi: 0x8b5cf6 },
                    { hex: '#38bdf8', pixi: 0x38bdf8 },
                    { hex: '#34d399', pixi: 0x34d399 },
                    { hex: '#fb7185', pixi: 0xfb7185 },
                  ] as const).map(c => (
                    <button
                      key={c.hex}
                      onClick={() => setGroupColor(n.id, c.pixi)}
                      className="w-3.5 h-3.5 rounded-full hover:scale-110 active:scale-95 transition-transform"
                      style={{
                        background: c.hex,
                        boxShadow: (groupColors.get(n.id) ?? pixiNode?.groupColor) === c.pixi
                          ? `0 0 0 2px #1c1c1c, 0 0 0 3.5px ${c.hex}`
                          : undefined,
                      }}
                    />
                  ))}
                  <div className="w-px h-3 bg-white/[0.12] mx-0.5" />
                  <button
                    onClick={() => { deleteGroup(n.id); setContextMenu(null) }}
                    className="w-3.5 h-3.5 flex items-center justify-center text-white/30 hover:text-red-400/80 transition-colors"
                    title="Excluir grupo"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 2.5h6M4 2.5V2a.5.5 0 011 0v.5M3.5 2.5v5a.5.5 0 00.5.5h2a.5.5 0 00.5-.5v-5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Star indicators — screen-space, positioned by ticker via data-star-id */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" id="star-overlay">
        {[...nodesRef.current.values()].filter(n => n.data.starred && n.type === 'imageNode' && n.loaded).map(n => (
          <div key={n.id} data-star-id={n.id} className="absolute" style={{ left: 0, top: 0 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="#FBBF24">
              <path d="M7 1l1.5 4H13L9.5 7.5l1.5 4L7 9 3 11.5l1.5-4L1 5h4.5L7 1z" stroke="#F59E0B" strokeWidth="0.8" strokeLinejoin="round"/>
            </svg>
          </div>
        ))}
      </div>

      {/* Lock icons — screen-space, follow nodes */}
      <div ref={lockIconsRef} className="absolute inset-0 pointer-events-none overflow-hidden">
        {[...nodesRef.current.values()].filter(n => n.locked && n.type === 'imageNode').map(n => (
          <div key={n.id} data-lock-id={n.id} className="absolute pointer-events-auto"
            style={{ left: 0, top: 0 }}
            onClick={() => { const nd = nodesRef.current.get(n.id); if (nd) { nd.locked = false; setPrimaryId(p => p) } }}>
            <div className="w-5 h-5 flex items-center justify-center rounded-md bg-black/50 border border-white/20">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="2" y="4.5" width="6" height="5" rx="1" stroke="rgba(255,255,255,0.7)" strokeWidth="1"/>
                <path d="M3.5 4.5V3a1.5 1.5 0 013 0v1.5" stroke="rgba(255,255,255,0.7)" strokeWidth="1" strokeLinecap="round"/>
              </svg>
            </div>
          </div>
        ))}
      </div>

      {/* Progress bar — visible during AI analysis */}
      {analysisProgress && (
        <div className="absolute top-0 left-0 right-0 z-30 pointer-events-none">
          <div className="h-0.5 bg-orange-500/30">
            <div
              className="h-full bg-orange-400 transition-all duration-300"
              style={{ width: `${(analysisProgress.done / analysisProgress.total) * 100}%` }}
            />
          </div>
          <div className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] text-orange-400/70">
            Analisando {analysisProgress.done}/{analysisProgress.total}
          </div>
        </div>
      )}

      {/* Empty canvas overlay */}
      {isEmpty && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none">
          <button
            className="pointer-events-auto flex flex-col items-center gap-4 group"
            onClick={async () => {
              const paths = await window.api.openFilePicker()
              if (paths.length > 0) addNodes(paths)
            }}
          >
            <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-white/15 group-hover:border-orange-500/50 flex items-center justify-center transition-all duration-200 group-hover:bg-orange-500/5">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M14 6v16M6 14h16" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round" className="group-hover:stroke-orange-400 transition-colors duration-200"/>
              </svg>
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[13px] font-medium text-white/25 group-hover:text-white/50 transition-colors duration-200">Importar imagens</span>
              <span className="text-[11px] text-white/15 group-hover:text-white/30 transition-colors duration-200">ou arraste arquivos aqui</span>
            </div>
          </button>
        </div>
      )}

      {/* Save indicator */}
      {saveStatus !== 'idle' && (
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rm-panel !border-transparent rounded-lg text-[11px]"
          style={{ backdropFilter: 'blur(8px)' }}>
          {saveStatus === 'saving'
            ? <><span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" /><span className="text-white/40">Salvando…</span></>
            : <><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /><span className="text-white/40">Salvo</span></>
          }
        </div>
      )}

      {/* Snap indicator */}
      <div className="absolute top-3 left-3 z-40 flex items-center gap-2">
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] cursor-pointer select-none transition-all rm-panel !border-transparent ${snapEnabled ? 'text-orange-400/70' : 'text-white/25'}`}
          onClick={() => { const next = !snapEnabledRef.current; snapEnabledRef.current = next; setSnapEnabled(next) }}
          title={snapEnabled ? 'Snap ativo (S para desativar)' : 'Snap inativo (S para ativar)'}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M2 6h8M6 2v8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <circle cx="6" cy="6" r="1.5" fill="currentColor"/>
          </svg>
          Snap
        </div>
      </div>

      {/* Search bar */}
      <div className="absolute top-3 left-16 z-10">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rm-panel !border-transparent rounded-xl">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-white/30 shrink-0">
            <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M8 8l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <input
            value={searchQuery}
            onChange={e => {
              const q = e.target.value
              setSearchQuery(q)
              // Dim nodes that don't match; restore all if empty
              for (const node of nodesRef.current.values()) {
                if (node.type !== 'imageNode' || !node.container) continue
                if (!q) { node.container.alpha = 1; continue }
                // Word-boundary match: "man" matches "man"/"manager" but not "woman"/"roman"
              const re = new RegExp('\\b' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
              const match = node.data.tags.some(t => re.test(t.value))
                  || (node.data.modelName ? re.test(node.data.modelName) : false)
                node.container.alpha = match ? 1 : 0.15
              }
            }}
            onKeyDown={e => e.stopPropagation()}
            placeholder="Buscar por tags…"
            className="bg-transparent outline-none text-[12px] text-white/60 placeholder-white/20 w-36"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('')
                for (const node of nodesRef.current.values()) {
                  if (node.container) node.container.alpha = 1
                }
              }}
              className="text-white/25 hover:text-white/60 transition-colors text-xs"
            >✕</button>
          )}
          <div className="w-px h-3 bg-white/[0.08]" />
          <button
            onClick={() => {
              const next = !starFilter
              setStarFilter(next)
              const storeNodes = useCanvasStore.getState().nodes
              for (const node of nodesRef.current.values()) {
                if (node.type !== 'imageNode' || !node.container) continue
                const isStarred = storeNodes.find(n => n.id === node.id)?.data.starred === true
                node.container.alpha = !next || isStarred ? 1 : 0.12
              }
            }}
            title={starFilter ? 'Mostrar todas' : 'Mostrar só favoritos'}
            className={`transition-colors ${starFilter ? 'text-yellow-400' : 'text-white/25 hover:text-white/50'}`}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill={starFilter ? '#FBBF24' : 'none'}>
              <path d="M7 1l1.5 4H13L9.5 7.5l1.5 4L7 9 3 11.5l1.5-4L1 5h4.5L7 1z"
                stroke={starFilter ? '#FBBF24' : 'currentColor'} strokeWidth="1.3" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      <PromptPresets />

      <CanvasToolbar
        zoom={zoom}
        onFit={() => fitView(0, true)}
        onZoomIn={() => animateZoom(Math.min(worldRef.current!.scale.x * 1.25, MAX_ZOOM))}
        onZoomOut={() => animateZoom(Math.max(worldRef.current!.scale.x * 0.8, MIN_ZOOM))}
      />

      {/* Minimap */}
      {/* Minimap — hidden when canvas is too short to avoid overlapping Prompt Builder */}
      <canvas
        ref={minimapRef}
        width={160} height={100}
        className="absolute bottom-3 right-3 z-10 rounded-xl pointer-events-auto rm-panel"
        style={{ backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          display: (!minimapVisible || canvasHeight < 280 || promptHasContent) ? 'none' : 'block' }}
        onPointerDown={e => { minimapDragging.current = true; e.currentTarget.setPointerCapture(e.pointerId) }}
        onPointerUp={() => { minimapDragging.current = false }}
        onPointerMove={e => {
          if (!minimapDragging.current) return
          const mm = minimapRef.current; const ct = containerRef.current; const wc = worldRef.current
          if (!mm || !ct || !wc) return
          const imageNodes = [...nodesRef.current.values()].filter(n => n.type === 'imageNode' && n.loaded)
          if (imageNodes.length === 0) return
          const PAD = 6
          const minNx = Math.min(...imageNodes.map(n => n.x))
          const minNy = Math.min(...imageNodes.map(n => n.y))
          const maxNx = Math.max(...imageNodes.map(n => n.x + n.width))
          const maxNy = Math.max(...imageNodes.map(n => n.y + n.height))
          const contentW = maxNx - minNx || 1, contentH = maxNy - minNy || 1
          const sc = Math.min((mm.width - PAD*2) / contentW, (mm.height - PAD*2) / contentH)
          const rect = mm.getBoundingClientRect()
          const wx = (e.clientX - rect.left - PAD) / sc + minNx
          const wy = (e.clientY - rect.top  - PAD) / sc + minNy
          wc.x = ct.clientWidth  / 2 - wx * wc.scale.x
          wc.y = ct.clientHeight / 2 - wy * wc.scale.y
        }}
      />

      {contextMenu && contextMenu.isCanvas ? (
        // Canvas right-click menu (no node selected)
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={e => { e.preventDefault(); setContextMenu(null) }} />
          <div
            className="fixed z-50 bg-[#1a1a1a] border border-white/[0.1] rounded-xl shadow-2xl shadow-black/60 py-1.5 px-1 min-w-[200px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={e => e.preventDefault()}
          >
          {(() => {
            const item = 'flex items-center gap-2 px-3 py-1.5 text-[13px] text-white/75 hover:bg-white/[0.08] hover:text-white rounded-md cursor-default transition-colors select-none w-full text-left'
            return <>
              <button className={item} onClick={() => { addToGroup(); setContextMenu(null) }}>
                <span>Criar novo grupo</span>
                {selIdsRef.current.size >= 2
                  ? <span className="ml-auto text-white/25 text-[11px]">{selIdsRef.current.size} selecionados</span>
                  : <span className="ml-auto text-white/20 text-[11px]">selecione 2+</span>
                }
              </button>
              <button className={item} onClick={() => { organizeAll(); setContextMenu(null) }}>
                <span>Organizar tudo em grade</span>
              </button>
            </>
          })()}
        </div>
        </>
      ) : contextMenu ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 bg-[#1a1a1a] border border-white/[0.1] rounded-xl shadow-2xl shadow-black/60 py-1.5 px-1 min-w-[200px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={e => e.preventDefault()}
          >
            {(() => {
              const item = 'flex items-center gap-2 px-3 py-1.5 text-[13px] text-white/75 hover:bg-white/[0.08] hover:text-white rounded-md cursor-default transition-colors select-none w-full text-left'
              const multi = selIdsRef.current.size > 1
              const ctxNodeData = contextMenu.nodeId
                ? useCanvasStore.getState().nodes.find(n => n.id === contextMenu.nodeId)?.data as ImageNodeData | undefined
                : undefined
              const isAnalyzable = !!(ctxNodeData?.imagePath && !ctxNodeData?.isGroup)
              const metaSrc = ctxNodeData?.metadataSource
              const reanalyzeLabel = metaSrc === 'ai'
                ? 'Reanalisar com IA'
                : (metaSrc === 'comfyui' || metaSrc === 'a1111' || metaSrc === 'midjourney')
                  ? 'Recarregar metadados'
                  : 'Analisar com IA'
              const handleReanalyze = () => {
                if (!contextMenu.nodeId || !ctxNodeData?.imagePath) return
                window.dispatchEvent(new CustomEvent('retry-analysis', { detail: { nodeId: contextMenu.nodeId, imagePath: ctxNodeData.imagePath } }))
                setContextMenu(null)
              }
              return <>
                {isAnalyzable && (
                  <>
                    <button className={item} onClick={handleReanalyze}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                        <path d="M3 3v5h5"/>
                      </svg>
                      <span>{reanalyzeLabel}</span>
                    </button>
                    <div className="h-px bg-white/[0.07] mx-2 my-1" />
                  </>
                )}
                <button className={item} onClick={() => { organizeNodes('grid'); setContextMenu(null) }}>
                  <span>Organizar em grade</span>
                  {!multi && <span className="ml-auto text-white/20 text-[11px]">selecione 2+</span>}
                </button>
                <button className={item} onClick={() => { organizeNodes('row'); setContextMenu(null) }}>
                  <span>Organizar em linha</span>
                  {!multi && <span className="ml-auto text-white/20 text-[11px]">selecione 2+</span>}
                </button>
                <button className={item} onClick={() => { organizeNodes('column'); setContextMenu(null) }}>
                  <span>Organizar em coluna</span>
                  {!multi && <span className="ml-auto text-white/20 text-[11px]">selecione 2+</span>}
                </button>
                <div className="h-px bg-white/[0.07] mx-2 my-1" />
                <button className={item} onClick={() => { addToGroup(); setContextMenu(null) }}>
                  <span>Adicionar ao grupo</span>
                  {!multi && <span className="ml-auto text-white/20 text-[11px]">selecione 2+</span>}
                </button>
                <div className="h-px bg-white/[0.07] mx-2 my-1" />
                <button className={item} onClick={() => { selIdsRef.current.forEach(id => { const n = nodesRef.current.get(id); if (n?.container && worldRef.current) { worldRef.current.removeChild(n.container); worldRef.current.addChild(n.container) } }); setContextMenu(null) }}>
                  <span>Trazer para frente</span>
                </button>
                <button className={item} onClick={() => { selIdsRef.current.forEach(id => { const n = nodesRef.current.get(id); if (n?.container && worldRef.current) { worldRef.current.removeChild(n.container); worldRef.current.addChildAt(n.container, 0) } }); setContextMenu(null) }}>
                  <span>Mandar para trás</span>
                </button>
                <div className="h-px bg-white/[0.07] mx-2 my-1" />
                <button
                  className={`${item} text-red-400/80 hover:text-red-400 hover:bg-red-500/[0.08]`}
                  onClick={() => { deleteSelected(); setContextMenu(null) }}
                >
                  <span>Deletar</span>
                  {multi && <span className="ml-auto text-white/20 text-[11px]">{selIdsRef.current.size} itens</span>}
                </button>
              </>
            })()}
          </div>
        </>
      ) : null}

      {/* Shortcuts overlay */}
      {showShortcuts && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowShortcuts(false)}>
          <div data-scrollable className="bg-[#111111] border border-white/[0.08] rounded-2xl shadow-2xl p-6 w-[480px] max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-white/80 font-semibold text-sm">Atalhos de teclado</span>
              <button onClick={() => setShowShortcuts(false)} className="text-white/30 hover:text-white/70 text-lg">✕</button>
            </div>
            {[
              ['Canvas', [
                ['Scroll / 2 dedos', 'Zoom in/out'],
                ['Arrastar (espaço vazio) / Botão do meio', 'Pan'],
                ['Duplo clique', 'Zoom na imagem'],
              ]],
              ['Seleção', [
                ['Clique', 'Selecionar imagem'],
                ['Ctrl + Clique', 'Multi-seleção'],
                ['Ctrl + Arrastar', 'Seleção por área'],
                ['Clique em espaço vazio', 'Desselecionar'],
              ]],
              ['Edição', [
                ['Ctrl+Z', 'Desfazer'],
                ['Ctrl+Y / Ctrl+Shift+Z', 'Refazer'],
                ['Ctrl+C', 'Copiar'],
                ['Ctrl+V', 'Colar'],
                ['Ctrl+D', 'Duplicar'],
                ['Delete / Backspace', 'Deletar'],
                ['L', 'Travar / Destravar'],
                [']', 'Trazer para frente'],
                ['[', 'Mandar para trás'],
              ]],
              ['Arquivo', [
                ['Ctrl+S', 'Salvar'],
                ['Ctrl+Shift+S', 'Salvar como'],
              ]],
              ['Interface', [
                ['?', 'Mostrar/ocultar atalhos'],
                ['M', 'Mostrar/ocultar minimap'],
                ['S', 'Ativar/desativar snap'],
                ['Escape', 'Fechar painéis'],
              ]],
            ].map(([section, shortcuts]) => (
              <div key={section as string} className="mb-4">
                <div className="text-[9px] font-bold uppercase tracking-widest text-white/25 mb-2">{section as string}</div>
                {(shortcuts as [string, string][]).map(([key, desc]) => (
                  <div key={key} className="flex justify-between items-center py-1 border-b border-white/[0.04]">
                    <span className="text-white/50 text-[12px]">{desc}</span>
                    <kbd className="bg-white/[0.06] border border-white/[0.1] rounded px-2 py-0.5 text-[11px] text-white/60 font-mono">{key}</kbd>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
