export interface ExtractionResult {
  source: 'comfyui' | 'a1111' | 'midjourney' | 'ai' | 'none'
  description: string
  rawText: string | null
  params?: Record<string, unknown>
}

export interface ComfyLora {
  name: string
  strengthModel: number
}

export type ComfyParams = {
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

type ComfyNode = { class_type: string; inputs: Record<string, unknown> }

// O ComfyUI grava o grafo com o json.dumps do Python, que escreve NaN/Infinity
// soltos (JSON inválido). Troca só os que estão FORA de strings por null.
export function parseComfyJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    let out = '', inStr = false
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      if (inStr) {
        out += c
        if (c === '\\') out += s[++i] ?? ''
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') { inStr = true; out += c; continue }
      const m = /^-?(NaN|Infinity)/.exec(s.slice(i, i + 9))
      if (m) { out += 'null'; i += m[0].length - 1; continue }
      out += c
    }
    return JSON.parse(out) as Record<string, unknown>
  }
}

export function isComfyUI(raw: Record<string, unknown>): boolean {
  try {
    const promptStr = raw?.prompt ?? raw?.workflow
    if (typeof promptStr !== 'string') return false
    const parsed = parseComfyJson(promptStr)
    return Object.values(parsed).some(
      (node) => node && typeof node === 'object' && 'class_type' in (node as object)
    )
  } catch {
    return false
  }
}

type Grafo = Record<string, ComfyNode>
type Link = [string, number]
const isLink = (v: unknown): v is Link => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number'

// Entradas que carregam texto, em ordem de preferência. "source"/"input"/"any"
// cobrem nós de passagem (PreviewAny, ShowText, Switch...).
const TEXT_INPUTS = ['text', 'prompt', 'value', 'string', 'text_g', 'positive_prompt', 'source', 'input', 'any', 'text_a']

// Segue links até achar um texto digitado. Texto gerado em tempo de execução
// (upsampler, gerador de rosto) não fica no arquivo: nesse caso continua pelas
// entradas do nó até o pedido original do usuário, ou devolve null.
function resolveText(g: Grafo, v: unknown, seen = new Set<string>()): string | null {
  if (typeof v === 'string') return v
  if (!isLink(v) || seen.has(v[0])) return null
  seen.add(v[0])
  const node = g[v[0]]
  if (!node) return null
  // Switch (ComfySwitchNode e afins): só o ramo escolhido chegou ao sampler
  if (typeof node.inputs?.switch === 'boolean' && ('on_true' in node.inputs || 'on_false' in node.inputs)) {
    return resolveText(g, node.inputs.switch ? node.inputs.on_true : node.inputs.on_false, seen)
  }
  for (const key of TEXT_INPUTS) {
    if (!(key in (node.inputs ?? {}))) continue
    const t = resolveText(g, node.inputs[key], seen)
    if (t !== null) return t
  }
  return null
}

// Do conditioning positivo até o nó de texto (atravessa FluxGuidance, Concat, ControlNet...).
function resolveConditioning(g: Grafo, v: unknown, seen = new Set<string>()): string | null {
  if (!isLink(v) || seen.has(v[0])) return null
  seen.add(v[0])
  const node = g[v[0]]
  if (!node) return null
  const inputs = node.inputs ?? {}
  if (TEXT_INPUTS.some(k => k in inputs) && !('conditioning' in inputs) && !('positive' in inputs)) {
    return resolveText(g, v)
  }
  for (const key of ['positive', 'conditioning', 'conditioning_to', 'conditioning_1', 'guider']) {
    if (key in inputs) {
      const t = resolveConditioning(g, inputs[key], seen)
      if (t !== null) return t
    }
  }
  return null
}

const SAVE_NODE = /save|image\s*save/i
const prefixBase = (p: unknown) => (typeof p === 'string' ? p.replace(/.*[/\\]/, '') : '')

// O nó que gravou ESTA imagem: entre vários SaveImage, o de filename_prefix
// que bate com o nome do arquivo ("Imagem final_00001_.png" ← "Imagem final").
function pickOutputNode(g: Grafo, fileName?: string): ComfyNode | undefined {
  const saves = Object.values(g).filter(n => SAVE_NODE.test(n.class_type) && 'images' in (n.inputs ?? {}))
  const candidates = saves.length ? saves : Object.values(g).filter(n => /preview/i.test(n.class_type) && 'images' in (n.inputs ?? {}))
  if (candidates.length <= 1 || !fileName) return candidates[0]
  const name = fileName.toLowerCase()
  const matches = candidates
    .filter(n => prefixBase(n.inputs.filename_prefix) && name.startsWith(prefixBase(n.inputs.filename_prefix).toLowerCase()))
    .sort((a, b) => prefixBase(b.inputs.filename_prefix).length - prefixBase(a.inputs.filename_prefix).length)
  return matches[0] ?? candidates[0]
}

const isSampler = (n: ComfyNode) => 'positive' in (n.inputs ?? {}) || 'guider' in (n.inputs ?? {}) || /sampler/i.test(n.class_type) && 'model' in (n.inputs ?? {})
// Nó de API (Gemini, Seedream, Topaz, Kling...): gera a imagem a partir de
// prompt/modelo próprios, sem conditioning.
const isApiGenerator = (n: ComfyNode) => {
  const i = n.inputs ?? {}
  return !isSampler(n) && ('prompt' in i || (typeof i.model === 'string' && !/\.(safetensors|ckpt|pt|bin|pth|gguf|sft)$/i.test(i.model)))
}

// Anda para trás a partir da saída até o primeiro nó que gera imagem.
function findGenerator(g: Grafo, out: ComfyNode): ComfyNode | undefined {
  const queue: unknown[] = Object.values(out.inputs ?? {})
  const seen = new Set<string>()
  while (queue.length) {
    const v = queue.shift()
    if (!isLink(v) || seen.has(v[0])) continue
    seen.add(v[0])
    const node = g[v[0]]
    if (!node) continue
    if (isSampler(node) || isApiGenerator(node)) return node
    queue.push(...Object.values(node.inputs ?? {}))
  }
  return undefined
}

export function parseComfyUI(raw: Record<string, unknown>, fileName?: string): ExtractionResult {
  const promptStr = (raw.prompt ?? raw.workflow) as string
  const workflow = parseComfyJson(promptStr) as Record<string, ComfyNode>

  let positivePrompt = ''
  let seed: number | undefined
  let steps: number | undefined
  let sampler: string | undefined
  let model: string | undefined
  const loras: ComfyLora[] = []
  let scheduler: string | undefined
  let guidance: number | undefined
  let cfg: number | undefined
  let denoise: number | undefined
  let width: number | undefined
  let height: number | undefined

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

  const out = pickOutputNode(workflow, fileName)
  const gen = out ? findGenerator(workflow, out) : undefined
  // Sem saída rastreável: o primeiro KSampler do grafo, como antes
  const ksampler = gen && isSampler(gen) ? gen : (gen ? undefined : Object.values(workflow).find(
    n => n.class_type === 'KSampler' || n.class_type === 'KSamplerAdvanced'
  ))

  if (gen && isApiGenerator(gen)) {
    const i = gen.inputs
    positivePrompt = resolveText(workflow, i.prompt) ?? ''
    model = str(i.model)
    seed = num(i.seed)
    width = num(i.width); height = num(i.height)
  } else if (ksampler) {
    const i = ksampler.inputs
    seed = num(i.seed ?? i.noise_seed)
    steps = num(i.steps)
    sampler = str(i.sampler_name)
    scheduler = str(i.scheduler)
    cfg = num(i.cfg)
    denoise = num(i.denoise)
    positivePrompt = resolveConditioning(workflow, i.positive ?? i.guider) ?? ''
  }

  // Fallback (grafo sem saída/gerador reconhecível): CLIPTextEncode com o maior texto
  if (!positivePrompt && !gen) {
    const textOf = (n: ComfyNode) => (typeof n.inputs.text === 'string' ? n.inputs.text : '')
    const clips = Object.values(workflow).filter(n => n.class_type === 'CLIPTextEncode')
    clips.sort((a, b) => textOf(b).length - textOf(a).length)
    positivePrompt = clips[0] ? textOf(clips[0]) : ''
  }

  // Walk all nodes once
  const MODEL_FIELDS = ['ckpt_name', 'unet_name', 'model_name', 'checkpoint', 'base_ckpt_name']
  const MODEL_EXTS = /\.(safetensors|ckpt|pt|bin|pth|gguf|sft)$/i
  const stripPath = (s: string) => s.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '')

  for (const node of Object.values(workflow)) {
    const ct = node.class_type

    // Base model
    if (!model) {
      for (const field of MODEL_FIELDS) {
        const val = node.inputs?.[field]
        if (typeof val === 'string' && MODEL_EXTS.test(val)) { model = val; break }
      }
    }

    // LoRA loaders (standard + Power Lora Loader + StyleModelLoader used as LoRA)
    if (ct === 'LoraLoader' || ct === 'LoraLoaderModelOnly' || ct === 'LoraLoaderBlockWeight') {
      const name = node.inputs?.lora_name as string
      if (name) loras.push({ name: stripPath(name), strengthModel: typeof node.inputs?.strength_model === 'number' ? node.inputs.strength_model : 1 })
    }
    // Power Lora Loader (multiple loras in one node)
    if (ct === 'Power Lora Loader (rgthree)') {
      for (let i = 1; i <= 10; i++) {
        const name = node.inputs?.[`lora_${i}`] as string
        if (name && MODEL_EXTS.test(name)) { const s = node.inputs?.[`strength_${i}`]; loras.push({ name: stripPath(name), strengthModel: typeof s === 'number' ? s : 1 }) }
      }
    }

    // Schedulers
    if (ct === 'BasicScheduler' || ct === 'KarrasScheduler' || ct === 'ExponentialScheduler' ||
        ct === 'PolyexponentialScheduler' || ct === 'VPScheduler') {
      scheduler = node.inputs?.scheduler as string
      if (typeof node.inputs?.denoise === 'number') denoise = node.inputs.denoise
      if (node.inputs?.steps !== undefined && steps === undefined) steps = node.inputs.steps as number
    }

    // Guidance (Flux / SD3)
    if (ct === 'FluxGuidance' || ct === 'CFGGuider') {
      guidance = (node.inputs?.guidance ?? node.inputs?.cfg) as number
    }

    // Seed — various nodes
    if ((ct === 'RandomNoise' || ct === 'KSamplerSelect' || ct === 'SamplerCustomAdvanced') && seed === undefined) {
      seed = (node.inputs?.noise_seed ?? node.inputs?.seed) as number
    }

    // Sampler node
    if ((ct === 'KSamplerSelect' || ct === 'SamplerCustomAdvanced') && !sampler) {
      sampler = node.inputs?.sampler_name as string
    }

    // Resolution — many latent node types
    if (!width && (
      ct === 'EmptyLatentImage' || ct === 'EmptySD3LatentImage' ||
      ct === 'EmptyHunyuanLatentVideo' || ct === 'EmptyMochiLatentVideo' ||
      ct === 'EmptyCogVideoLatentVideo' || ct === 'CLIPTextEncodeFlux' ||
      ct === 'EmptyLatentAudio' || ct === 'LatentFromBatch'
    )) {
      if (node.inputs?.width) { width = node.inputs.width as number; height = node.inputs.height as number }
    }
  }

  // Wide fallback: any string value ending in a model extension
  if (!model) {
    outer: for (const node of Object.values(workflow)) {
      for (const val of Object.values(node.inputs ?? {})) {
        if (typeof val === 'string' && MODEL_EXTS.test(val)) { model = val; break outer }
      }
    }
  }

  const params: ComfyParams = {
    model, loras: loras.length ? loras : undefined,
    sampler, scheduler, steps, seed, guidance, cfg, denoise, width, height,
  }

  return {
    source: 'comfyui',
    description: positivePrompt || '',
    rawText: positivePrompt || null,
    params,
  }
}
