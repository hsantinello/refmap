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

export function isComfyUI(raw: Record<string, unknown>): boolean {
  try {
    const promptStr = raw?.prompt ?? raw?.workflow
    if (typeof promptStr !== 'string') return false
    const parsed = JSON.parse(promptStr) as Record<string, unknown>
    return Object.values(parsed).some(
      (node) => node && typeof node === 'object' && 'class_type' in (node as object)
    )
  } catch {
    return false
  }
}

export function parseComfyUI(raw: Record<string, unknown>): ExtractionResult {
  const promptStr = (raw.prompt ?? raw.workflow) as string
  const workflow = JSON.parse(promptStr) as Record<string, { class_type: string; inputs: Record<string, unknown> }>

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

  // Find positive prompt from CLIPTextEncode connected to KSampler positive
  const ksampler = Object.values(workflow).find(n => n.class_type === 'KSampler')
  if (ksampler) {
    seed = ksampler.inputs.seed as number
    steps = ksampler.inputs.steps as number
    sampler = ksampler.inputs.sampler_name as string
    cfg = ksampler.inputs.cfg as number

    const posRef = ksampler.inputs.positive
    if (Array.isArray(posRef)) {
      const posNodeId = posRef[0] as string
      const posNode = workflow[posNodeId]
      if (posNode?.class_type === 'CLIPTextEncode') {
        positivePrompt = (posNode.inputs.text as string) ?? ''
      }
    }
  }

  // Fallback: first CLIPTextEncode with longest text
  if (!positivePrompt) {
    const clips = Object.values(workflow).filter(n => n.class_type === 'CLIPTextEncode')
    clips.sort((a, b) =>
      ((b.inputs.text as string) ?? '').length - ((a.inputs.text as string) ?? '').length
    )
    positivePrompt = (clips[0]?.inputs.text as string) ?? ''
  }

  // Walk all nodes once to gather remaining params
  const MODEL_FIELDS = ['ckpt_name', 'unet_name', 'model_name', 'checkpoint']
  const MODEL_EXTS = /\.(safetensors|ckpt|pt|bin|pth)$/i
  const stripPath = (s: string) => s.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '')

  for (const node of Object.values(workflow)) {
    const ct = node.class_type

    // Base model (first match wins)
    if (!model) {
      for (const field of MODEL_FIELDS) {
        const val = node.inputs?.[field]
        if (typeof val === 'string' && MODEL_EXTS.test(val)) { model = val; break }
      }
    }

    // LoRA loaders
    if (ct === 'LoraLoader' || ct === 'LoraLoaderModelOnly') {
      const name = node.inputs?.lora_name as string
      if (name) {
        loras.push({
          name: stripPath(name),
          strengthModel: (node.inputs?.strength_model as number) ?? 1,
        })
      }
    }

    // Scheduler (Flux BasicScheduler or standard)
    if (ct === 'BasicScheduler' || ct === 'KarrasScheduler') {
      scheduler = node.inputs?.scheduler as string
      if (node.inputs?.denoise !== undefined) denoise = node.inputs.denoise as number
      if (node.inputs?.steps !== undefined && steps === undefined) steps = node.inputs.steps as number
    }

    // Flux guidance
    if (ct === 'FluxGuidance') {
      guidance = node.inputs?.guidance as number
    }

    // Seed from advanced sampler nodes
    if ((ct === 'RandomNoise' || ct === 'KSamplerSelect') && seed === undefined) {
      if (node.inputs?.noise_seed !== undefined) seed = node.inputs.noise_seed as number
    }

    // Resolution
    if ((ct === 'EmptySD3LatentImage' || ct === 'EmptyLatentImage' || ct === 'EmptyHunyuanLatentVideo') && !width) {
      width = node.inputs?.width as number
      height = node.inputs?.height as number
    }

    // Sampler from advanced nodes
    if (ct === 'KSamplerSelect' && !sampler) {
      sampler = node.inputs?.sampler_name as string
    }
  }

  // Fallback: any string input that looks like a model file
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
