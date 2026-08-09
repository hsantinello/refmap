import { create } from 'zustand'
import { type Node, type Edge, type XYPosition } from '@xyflow/react'
import { v4 as uuid } from 'uuid'

export interface Tag {
  id: string
  category: 'style' | 'lighting' | 'composition' | 'color' | 'mood' | 'subject' | 'description'
  value: string
  source: 'metadata' | 'ai'
}

export interface ComfyLora {
  name: string
  strengthModel: number
}

export interface ComfyParams {
  model?: string
  loras?: ComfyLora[]
  sampler?: string
  scheduler?: string
  steps?: number
  seed?: number
  guidance?: number
  cfg?: number
  denoise?: number
  width?: number
  height?: number
}

export interface ImageNodeData extends Record<string, unknown> {
  imagePath: string
  thumbnailPath?: string
  starred?: boolean
  tags: Tag[]
  tagLang?: 'en' | 'pt'
  metadataSource: 'comfyui' | 'a1111' | 'midjourney' | 'ai' | 'none' | 'group'
  modelName?: string
  isPending: boolean
  isError: boolean
  canvasId: string
  animationDelay?: number
  // Group node fields
  isGroup?: boolean
  label?: string
  // Metadata node fields
  comfyParams?: ComfyParams
  linkedImageNodeId?: string
  isMetadataNode?: boolean
  // Vídeo: se presente, o nó representa um vídeo e agrupa todas as suas cenas.
  videoScenes?: string[]
  videoName?: string
}

export interface PromptTag {
  id: string
  value: string
  category: string
  sourceNodeId: string
  weight?: number // 1 = sem peso; serializa como (value:weight) quando ≠ 1
}

// ─── Pesos ────────────────────────────────────────────────────────────────
export const WEIGHT_MIN = 0.1
export const WEIGHT_MAX = 2.0
export const WEIGHT_STEP = 0.1
export const clampWeight = (w: number) =>
  Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, Math.round(w * 10) / 10))

// Sintaxe universal ComfyUI / A1111 / Forge / Flux: (tag:1.3). Peso 1 → texto puro.
const serializeTag = (t: PromptTag): string => {
  const w = t.weight ?? 1
  if (Math.abs(w - 1) < 0.001) return t.value
  return `(${t.value}:${Math.round(w * 100) / 100})`
}

interface CanvasStore {
  nodes: Node<ImageNodeData>[]
  edges: Edge[]
  currentCanvasId: string | null
  canvasList: { id: string; name: string; updated_at: number }[]
  sfwMode: boolean
  appLang: 'en' | 'pt'

  setNodes: (nodes: Node<ImageNodeData>[]) => void
  setEdges: (edges: Edge[]) => void
  setCurrentCanvasId: (id: string) => void
  setCanvasList: (list: { id: string; name: string; updated_at: number }[]) => void
  setSfwMode: (v: boolean) => void
  setAppLang: (v: 'en' | 'pt') => void

  addImageNode: (imagePath: string, position: XYPosition, canvasId: string, width?: number) => string
  addGroupNode: (id: string, position: XYPosition, size: { width: number; height: number }, canvasId: string) => void
  addMetadataNode: (id: string, position: XYPosition, canvasId: string, comfyParams: ComfyParams, linkedImageNodeId: string) => void
  updateNodeData: (nodeId: string, data: Partial<ImageNodeData>) => void
  removeNode: (nodeId: string) => void
}

interface PromptBuilderStore {
  promptTags: PromptTag[]
  setPromptTags: (tags: PromptTag[]) => void
  addTag: (tag: Tag, sourceNodeId: string) => void
  insertTagAt: (value: string, index: number) => void
  removeTag: (tagId: string) => void
  toggleTag: (tag: Tag, sourceNodeId: string) => void
  hasTag: (tagValue: string) => boolean
  reorderTags: (from: number, to: number) => void
  updateTagText: (tagId: string, text: string) => void
  setTagWeight: (tagId: string, weight: number) => void
  clearAll: () => void
  getPromptString: () => string
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: [],
  edges: [],
  currentCanvasId: null,
  canvasList: [],
  sfwMode: false,
  appLang: 'en',

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  setCurrentCanvasId: (id) => set({ currentCanvasId: id }),
  setCanvasList: (list) => set({ canvasList: list }),
  setSfwMode: (v) => set({ sfwMode: v }),
  setAppLang: (v) => set({ appLang: v }),

  addImageNode: (imagePath, position, canvasId, width = 240) => {
    const id = uuid()
    const node: Node<ImageNodeData> = {
      id,
      type: 'imageNode',
      position,
      data: {
        imagePath,
        tags: [],
        metadataSource: 'none',
        isPending: true,
        isError: false,
        canvasId,
      },
      style: { width },
    }
    set(state => ({ nodes: [...state.nodes, node] }))
    return id
  },

  addGroupNode: (id, position, size, canvasId) => {
    const node: Node<ImageNodeData> = {
      id,
      type: 'groupNode',
      position,
      style: { width: size.width, height: size.height },
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
    set(state => ({ nodes: [node, ...state.nodes] }))
  },

  addMetadataNode: (id, position, canvasId, comfyParams, linkedImageNodeId) => {
    const node: Node<ImageNodeData> = {
      id,
      type: 'metadataNode',
      position,
      style: { width: 260 },
      data: {
        imagePath: '',
        tags: [],
        metadataSource: 'comfyui',
        isPending: false,
        isError: false,
        canvasId,
        comfyParams,
        linkedImageNodeId,
        isMetadataNode: true,
      },
    }
    set(state => ({ nodes: [...state.nodes, node] }))
  },

  updateNodeData: (nodeId, data) => {
    set(state => ({
      nodes: state.nodes.map(n =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      ),
    }))
  },

  removeNode: (nodeId) => {
    set(state => ({ nodes: state.nodes.filter(n => n.id !== nodeId) }))
  },
}))

export const usePromptStore = create<PromptBuilderStore>((set, get) => ({
  promptTags: [],

  setPromptTags: (tags) => set({ promptTags: tags }),

  addTag: (tag, sourceNodeId) => {
    if (get().hasTag(tag.value)) return
    set(state => ({
      promptTags: [...state.promptTags, {
        id: uuid(),
        value: tag.value,
        category: tag.category,
        sourceNodeId,
      }],
    }))
  },

  insertTagAt: (value, index) => {
    const trimmed = value.trim()
    if (!trimmed) return
    set(state => {
      const tags = [...state.promptTags]
      tags.splice(index, 0, { id: uuid(), value: trimmed, category: 'description', sourceNodeId: 'manual' })
      return { promptTags: tags }
    })
  },

  removeTag: (tagId) => {
    set(state => ({ promptTags: state.promptTags.filter(t => t.id !== tagId) }))
  },

  toggleTag: (tag, sourceNodeId) => {
    const { hasTag, addTag, promptTags } = get()
    if (hasTag(tag.value)) {
      const existing = promptTags.find(t => t.value === tag.value)
      if (existing) set(state => ({ promptTags: state.promptTags.filter(t => t.id !== existing.id) }))
    } else {
      addTag(tag, sourceNodeId)
    }
  },

  hasTag: (tagValue) => get().promptTags.some(t => t.value === tagValue),

  reorderTags: (from, to) => {
    set(state => {
      const tags = [...state.promptTags]
      const [moved] = tags.splice(from, 1)
      tags.splice(to, 0, moved)
      return { promptTags: tags }
    })
  },

  updateTagText: (tagId, text) => {
    set(state => ({
      promptTags: state.promptTags.map(t => t.id === tagId ? { ...t, value: text } : t),
    }))
  },

  setTagWeight: (tagId, weight) => {
    const w = clampWeight(weight)
    set(state => ({ promptTags: state.promptTags.map(t => t.id === tagId ? { ...t, weight: w } : t) }))
  },

  clearAll: () => set({ promptTags: [] }),

  getPromptString: () => get().promptTags.map(serializeTag).join(', '),
}))
