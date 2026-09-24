// Catálogo de receitas para o ComfyUI e a regra que casa cada uma com a máquina.
//
// O catálogo é CONSTRUÍDO a partir do índice oficial de templates — o mesmo do
// menu "Browse Templates" do ComfyUI, lido do próprio ComfyUI do usuário quando
// ele está aberto (`/templates/index.json`) ou do repositório Comfy-Org/
// workflow_templates. Cada template traz título, descrição, tags, família
// (`models`), tamanho do download, miniatura e — no índice novo — a VRAM que o
// ComfyUI declara. Nada disso é digitado aqui.
//
// O que É digitado aqui são refinamentos para um punhado de receitas comuns
// (`CURADAS`): VRAM mínima "na prática" (com offload), passos, nota em PT/EN e
// notas de qualidade/velocidade. Para os demais, a VRAM vem do ComfyUI; a nota
// em inglês é a descrição oficial e a em português vem de `descricoesPt.ts`.
//
// Puro: sem Electron, sem React — para poder ser testado em Node.

import { descricaoPt } from './descricoesPt'

export type Tarefa = 'image' | 'video'
/** Filtro de tarefa na UI: 'auto' = sem filtro (imagem e vídeo juntos). */
export type FiltroTarefa = Tarefa | 'auto'
const casaTarefa = (r: { task: Tarefa }, f: FiltroTarefa) => f === 'auto' || r.task === f
export type Encaixe = 'ideal' | 'ok' | 'apertado' | 'nao'
export type FonteVram = 'curada' | 'comfyui' | 'estimada'

export interface Texto { pt: string; en: string }

/** Uma entrada do índice oficial, já achatada (categoria embutida). */
export interface TemplateIndice {
  name: string
  title: string
  description: string
  category: string          // "Image", "Video", "Use Cases", "Utility", …
  categoryType: string      // "image" | "video" | "audio" | "3d"
  tags: string[]
  models: string[]          // ["Flux.1", "Flux"] — o primeiro é a família
  size: number | null       // bytes do download total (modelos incluídos)
  vram: number | null       // bytes de VRAM declarados pelo ComfyUI (novo índice)
  tutorialUrl: string | null
  mediaSubtype: string      // "webp" | "mp3" | …
  thumbnail: string | null  // caminho relativo custom, quando não segue o padrão <name>-1.<sub>
  openSource: boolean | null        // false = só roda com nós de API (nuvem)
  minComfyUIVersion: string | null  // "0.32.0" — o template pode não abrir em ComfyUI mais antigo
  saida: string[]                   // mediaType das saídas do workflow: "image" | "video" | "audio" | "3d"
}

export interface Receita {
  id: string                // = template
  task: Tarefa
  familia: string           // id da família (filtro da UI)
  familiaNome: string
  nome: string
  template: string          // nome do arquivo no índice
  variante: Texto | null    // só nas curadas
  vramMin: number           // GB
  vramRec: number           // GB
  fonteVram: FonteVram
  ramMin: number
  passos: number | null
  qualidade: 1 | 2 | 3 | 4 | 5
  velocidade: 1 | 2 | 3 | 4 | 5
  nota: Texto               // curada em PT/EN, ou a descrição oficial (EN nos dois)
  notaCurada: boolean
  tags: string[]
  tamanhoGb: number | null
  tutorialUrl: string | null
  miniatura: string | null  // caminho relativo a /templates/ (só webp/png)
  versaoMinima: string | null // ComfyUI mínimo declarado pelo template
  /** Desempate na ordenação: geradores (Image/Video) antes de primeiros passos,
   *  casos de uso e utilitários. Um mapa de pose de 2 GB não é a "melhor opção"
   *  de quem quer gerar imagem, por mais que caiba. */
  prioridade: number
}

const PRIORIDADE: Record<string, number> = {
  Image: 0, Video: 0,
  'Getting Started': 1,
  'Use Cases': 2, 'Product & Ads': 2, 'Character & Fashion': 2, 'Brand & Design': 2,
  Utility: 3, 'Image Tools': 3, 'Video Tools': 3,
}

// ── Refinamentos manuais ───────────────────────────────────────────────────────
interface Curada {
  variante: Texto; vramMin: number; vramRec: number; ramMin: number; passos: number | null
  qualidade: 1 | 2 | 3 | 4 | 5; velocidade: 1 | 2 | 3 | 4 | 5; nota: Texto
}

export const CURADAS: Record<string, Curada> = {
  sdxlturbo_example: {
    variante: { pt: 'Checkpoint fp16 · 1 passo', en: 'fp16 checkpoint · 1 step' },
    vramMin: 4, vramRec: 6, ramMin: 8, passos: 1, qualidade: 2, velocidade: 5,
    nota: { pt: 'O mais leve que existe. Ideal para testar ideias em segundos numa placa de 4–6 GB; a qualidade é de rascunho.',
            en: 'The lightest option there is. Ideal for testing ideas in seconds on a 4–6 GB card; draft-level quality.' },
  },
  sdxl_simple_example: {
    variante: { pt: 'Checkpoint fp16 · 20–30 passos', en: 'fp16 checkpoint · 20–30 steps' },
    vramMin: 6, vramRec: 8, ramMin: 16, passos: 25, qualidade: 3, velocidade: 3,
    nota: { pt: 'O padrão de mercado: maior ecossistema de LoRAs e checkpoints. Roda em 6 GB com paciência, em 8 GB com folga.',
            en: 'The industry standard: the biggest LoRA and checkpoint ecosystem. Runs on 6 GB with patience, comfortably on 8 GB.' },
  },
  flux_schnell: {
    variante: { pt: 'fp8 · 4 passos', en: 'fp8 · 4 steps' },
    vramMin: 8, vramRec: 12, ramMin: 16, passos: 4, qualidade: 4, velocidade: 4,
    nota: { pt: 'Qualidade Flux em 4 passos. Em 8 GB roda com a versão fp8 e alguma espera no carregamento.',
            en: 'Flux quality in 4 steps. On 8 GB it runs with the fp8 version and some load-time waiting.' },
  },
  image_flux2_klein_text_to_image: {
    variante: { pt: 'Klein 4B · poucos passos', en: 'Klein 4B · few steps' },
    vramMin: 8, vramRec: 12, ramMin: 16, passos: 4, qualidade: 4, velocidade: 5,
    nota: { pt: 'Modelo destilado da Black Forest Labs: muito rápido, ótimo para 8–12 GB.',
            en: 'Black Forest Labs distilled model: very fast, great for 8–12 GB.' },
  },
  image_z_image_turbo: {
    variante: { pt: 'Completo · 8 passos', en: 'Full · 8 steps' },
    vramMin: 12, vramRec: 16, ramMin: 32, passos: 8, qualidade: 5, velocidade: 4,
    nota: { pt: 'Fotorrealismo forte em 8 passos. Pede 12 GB ou mais; abaixo disso só com offload.',
            en: 'Strong photorealism in 8 steps. Needs 12 GB or more; below that only with offloading.' },
  },
  flux_dev_checkpoint_example: {
    variante: { pt: 'fp8 · 20 passos', en: 'fp8 · 20 steps' },
    vramMin: 12, vramRec: 16, ramMin: 32, passos: 20, qualidade: 5, velocidade: 2,
    nota: { pt: 'Referência de qualidade e aderência ao prompt. Lento; em 12 GB só com fp8 e offload para a RAM.',
            en: 'The reference for quality and prompt adherence. Slow; on 12 GB only with fp8 and offloading to RAM.' },
  },
  hidream_i1_fast: {
    variante: { pt: 'Fast · 16 passos', en: 'Fast · 16 steps' },
    vramMin: 16, vramRec: 24, ramMin: 32, passos: 16, qualidade: 4, velocidade: 3,
    nota: { pt: 'Modelo grande (17B) com licença aberta. Quatro encoders de texto: pesado na RAM também.',
            en: 'A large (17B) open-licence model. Four text encoders: heavy on RAM as well.' },
  },
  image_qwen_Image_2512: {
    variante: { pt: 'fp8 · 20–50 passos', en: 'fp8 · 20–50 steps' },
    vramMin: 16, vramRec: 24, ramMin: 32, passos: 30, qualidade: 5, velocidade: 2,
    nota: { pt: 'Excelente com texto dentro da imagem e cenas complexas. Só vale com 16 GB ou mais.',
            en: 'Excellent with text inside the image and complex scenes. Only worth it with 16 GB or more.' },
  },
  text_to_video_wan: {
    variante: { pt: '1.3B · 480p · texto→vídeo', en: '1.3B · 480p · text→video' },
    vramMin: 6, vramRec: 8, ramMin: 16, passos: 30, qualidade: 2, velocidade: 4,
    nota: { pt: 'O único vídeo que cabe de verdade em 6 GB. Clipes curtos em 480p, bons para estudo de movimento.',
            en: 'The only video model that truly fits in 6 GB. Short 480p clips, good for motion studies.' },
  },
  video_wan2_2_5B_ti2v: {
    variante: { pt: '5B · 720p · texto ou imagem→vídeo', en: '5B · 720p · text or image→video' },
    vramMin: 8, vramRec: 12, ramMin: 16, passos: 20, qualidade: 3, velocidade: 3,
    nota: { pt: 'Melhor custo-benefício em vídeo: 720p a partir de texto ou de uma imagem, em 8–12 GB.',
            en: 'The best value in video: 720p from text or from an image, on 8–12 GB.' },
  },
  video_kandinsky5_t2v: {
    variante: { pt: '2B · texto→vídeo', en: '2B · text→video' },
    vramMin: 8, vramRec: 12, ramMin: 16, passos: 30, qualidade: 3, velocidade: 3,
    nota: { pt: 'Modelo leve (2B) com bom movimento. Alternativa ao Wan 5B na mesma faixa de placa.',
            en: 'A light (2B) model with good motion. An alternative to Wan 5B in the same card range.' },
  },
  video_ltx2_t2v_distilled: {
    variante: { pt: 'Distilled · texto→vídeo com áudio', en: 'Distilled · text→video with audio' },
    vramMin: 12, vramRec: 16, ramMin: 32, passos: 8, qualidade: 4, velocidade: 4,
    nota: { pt: 'Rápido e gera áudio sincronizado. Modelo grande no disco; em 12 GB roda com offload.',
            en: 'Fast, and generates synced audio. Large on disk; on 12 GB it runs with offloading.' },
  },
  'video_hunyuan_video_1.5_720p_t2v': {
    variante: { pt: '720p · texto→vídeo', en: '720p · text→video' },
    vramMin: 12, vramRec: 16, ramMin: 32, passos: 30, qualidade: 4, velocidade: 2,
    nota: { pt: 'Cinematográfico, mas lento e com download enorme. Vale a partir de 12 GB.',
            en: 'Cinematic, but slow and a huge download. Worth it from 12 GB up.' },
  },
  video_wan2_2_14B_t2v: {
    variante: { pt: '14B · fp8 · texto→vídeo', en: '14B · fp8 · text→video' },
    vramMin: 16, vramRec: 24, ramMin: 32, passos: 20, qualidade: 5, velocidade: 1,
    nota: { pt: 'O topo de linha aberto em vídeo. Em 16 GB só com fp8 e offload; confortável em 24 GB.',
            en: 'The open state of the art in video. On 16 GB only with fp8 and offloading; comfortable on 24 GB.' },
  },
  video_wan2_2_14B_i2v: {
    variante: { pt: '14B · fp8 · imagem→vídeo', en: '14B · fp8 · image→video' },
    vramMin: 16, vramRec: 24, ramMin: 32, passos: 20, qualidade: 5, velocidade: 1,
    nota: { pt: 'Anima uma imagem de referência com o Wan 14B. Mesmas exigências da versão texto→vídeo.',
            en: 'Animates a reference image with Wan 14B. Same requirements as the text→video version.' },
  },
}

// ── Famílias ───────────────────────────────────────────────────────────────────
// `models[0]` do índice varia na grafia ("Wan2.1", "Wan2.2", "Wan"); aqui vira um
// id estável e um nome de exibição.
const FAMILIAS: Array<[RegExp, string, string]> = [
  [/^wan/i, 'wan', 'Wan'],
  [/^flux\.?2/i, 'flux2', 'Flux.2'],
  [/^flux/i, 'flux1', 'Flux.1'],
  [/^qwen[- ]?image|^qwen$/i, 'qwen', 'Qwen Image'],
  [/^z[- ]?image/i, 'zimage', 'Z-Image'],
  [/^ltx|^lightricks/i, 'ltx', 'LTX'],
  [/^minimax/i, 'minimax', 'MiniMax H3'],
  [/^anima\b/i, 'anima', 'Anima'],
  [/^krea/i, 'krea', 'Krea 2'],
  [/^ideogram/i, 'ideogram', 'Ideogram'],
  [/^boogu/i, 'boogu', 'Boogu'],
  [/^mage/i, 'mage', 'Mage-Flow'],
  [/^seedvr/i, 'seedvr', 'SeedVR2'],
  [/^sam ?3/i, 'sam3', 'SAM 3'],
  [/^depth anything/i, 'depthanything', 'Depth Anything'],
  [/^sdxl/i, 'sdxl', 'SDXL'],
  [/^sd\s?3/i, 'sd35', 'SD 3.5'],
  [/^sd\s?1/i, 'sd15', 'SD 1.5'],
  [/^hidream/i, 'hidream', 'HiDream'],
  [/^hunyuan\s?video/i, 'hunyuan', 'Hunyuan Video'],
  [/^kandinsky/i, 'kandinsky', 'Kandinsky'],
  [/^chroma/i, 'chroma', 'Chroma'],
  [/^omnigen/i, 'omnigen', 'OmniGen'],
  [/^longcat/i, 'longcat', 'LongCat'],
  [/^ernie/i, 'ernie', 'ERNIE Image'],
  [/^capybara/i, 'capybara', 'Capybara'],
]

function familiaDe(t: TemplateIndice): { id: string; nome: string } {
  const base = t.models[0] ?? ''
  for (const [re, id, nome] of FAMILIAS) if (re.test(base) || re.test(t.name) || re.test(t.title)) return { id, nome }
  if (base && !/^none$/i.test(base)) return { id: base.toLowerCase().replace(/[^a-z0-9]+/g, '-'), nome: base }
  return { id: 'outros', nome: 'Outros' }
}

// ── Tarefa ─────────────────────────────────────────────────────────────────────
const TAGS_VIDEO = /video|flf2v|lip sync|animate|motion/i
const CATEGORIAS_IMAGEM = new Set(['Image', 'Image Tools', 'Getting Started', 'Use Cases', 'Utility', 'Product & Ads', 'Character & Fashion', 'Brand & Design'])
// Saída que não é imagem nem vídeo. "Audio to Video" e "Lip Sync" NÃO entram
// aqui: o resultado é vídeo. As categorias "Getting Started" e "Use Cases"
// misturam tudo, por isso a checagem é por tag e por nome, não só por categoria.
const TAGS_FORA = /^(audio|text to audio|audio to audio|speech|music|tts|3d|image to 3d|text to 3d|llm|text to text|chat)$/i
const NOME_FORA = /(^|[_-])(audio|3d|tts|llm)([_-]|$)|ace[_-]?step|hunyuan[_-]?3d|stable[_-]?audio|mmaudio/i
const PREVIA_AUDIO = /^(mp3|wav|ogg|flac)$/i
// Modelos que só existem como serviço de nuvem: o template chama uma API paga,
// mesmo quando o índice lista size/vram por causa de um modelo local auxiliar.
const MODELOS_NUVEM = /kling|nano ?banana|grok|gpt|gemini|veo|sora|seedream|seedance|runway|luma|ideogram|recraft|midjourney|hailuo|minimax|pika|vidu|imagen|dall[- ]?e|openai|bytedance seed|wan.*api/i

/** Serve para a máquina do usuário? Fora: templates de nós de nuvem (tag API,
 *  modelo que só existe como serviço, ou sem nenhum modelo para baixar — o
 *  índice não declara nem size nem vram). */
export function rodaLocal(t: TemplateIndice): boolean {
  if (/^api_/i.test(t.name)) return false
  if (t.openSource === false) return false
  if ((t.tags ?? []).some(g => /^api$/i.test(g))) return false
  // A lista de marcas de nuvem só vale quando o índice NÃO declara `openSource`
  // (pacote antigo do ComfyUI local). Marcas mudam de lado: MiniMax H3 e
  // Ideogram 4 hoje têm pesos abertos, e o índice novo diz isso.
  // Índice novo: `openSource: true` é palavra final — inclusive para workflows
  // só de nós (glitch, crossfade, pixel sort), que não têm nada para baixar
  // e por isso vêm com size 0.
  if (t.openSource === true) return true
  if ((t.models ?? []).some(m => MODELOS_NUVEM.test(m))) return false
  if (!t.size && !t.vram) return false
  return true
}

export function tarefaDe(t: TemplateIndice): Tarefa | null {
  const saida = Array.isArray(t.saida) ? t.saida : [] // cache de versão antiga não tem o campo
  const tags = Array.isArray(t.tags) ? t.tags : []
  if (/^(audio|3d|llm)$/i.test(t.categoryType)) return null
  // O índice novo declara o que o workflow SALVA (`io.outputs`) — é o critério
  // mais confiável quando existe.
  if (saida.some(s => /^(audio|3d)$/i.test(s))) return null
  if (tags.some(g => TAGS_FORA.test(g))) return null
  // "Audio to Video" antes da checagem de nome: `video_ltx_2_audio_to_video` tem
  // "audio" no nome, mas a saída é vídeo.
  if (saida.includes('video') || tags.some(g => /to video$/i.test(g))) return 'video'
  if (NOME_FORA.test(t.name) || PREVIA_AUDIO.test(t.mediaSubtype)) return null
  if (t.categoryType === 'video' || t.category === 'Video') return 'video'
  if (tags.some(g => TAGS_VIDEO.test(g))) return 'video'
  if (t.categoryType === 'image' && CATEGORIAS_IMAGEM.has(t.category)) return 'image'
  return null // LLM, básicos de nós
}

/** -1 se a < b, 0 se iguais, 1 se a > b. Só dígitos e pontos ("0.19.3"). */
export function compararVersao(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

const arred = (gb: number, passo = 1) => Math.round(gb / passo) * passo
const bytesGb = (b: number) => b / 1024 ** 3

/** Miniatura servida em `/templates/`: sempre `<name>-1.<mediaSubtype>`.
 *
 *  O índice traz um campo `thumbnail` com caminhos como "thumbnail/x.png" ou
 *  "output/x.png" — são internos do repositório e NÃO são servidos (404 tanto no
 *  ComfyUI local quanto no GitHub); a imagem publicada segue a convenção acima
 *  mesmo para esses templates. Só imagem: prévia em mp3/mp4 não vira miniatura. */
export function miniaturaDe(t: TemplateIndice): string | null {
  return /^(webp|png|jpe?g)$/i.test(t.mediaSubtype) ? `${t.name}-1.${t.mediaSubtype}` : null
}

export function montarCatalogo(indice: TemplateIndice[]): Receita[] {
  const out: Receita[] = []
  for (const t of indice) {
    if (!rodaLocal(t)) continue
    const task = tarefaDe(t)
    if (!task) continue
    const fam = familiaDe(t)
    const curada = CURADAS[t.name]

    let vramRec: number, vramMin: number, fonteVram: FonteVram
    if (curada) {
      vramRec = curada.vramRec; vramMin = curada.vramMin; fonteVram = 'curada'
    } else if (t.vram && t.vram > 0) {
      // O ComfyUI declara quanto o modelo ocupa carregado inteiro. Com offload dos
      // encoders de texto para a RAM, na prática roda com bem menos: ~55%.
      vramRec = Math.max(4, arred(bytesGb(t.vram)))
      vramMin = Math.max(4, arred(vramRec * 0.55, 2))
      fonteVram = 'comfyui'
    } else {
      // Sem declaração: chute pelo tamanho do download (pesos ≈ o que vai para a VRAM).
      vramRec = Math.min(48, Math.max(6, arred(bytesGb(t.size ?? 0) * 0.6, 2)))
      vramMin = Math.max(4, arred(vramRec * 0.55, 2))
      fonteVram = 'estimada'
    }
    if (vramMin > vramRec) vramMin = vramRec

    const rapida = /turbo|distill|schnell|lcm|lightning|fast|2steps|4steps/i.test(`${t.name} ${t.title} ${t.tags.join(' ')}`)
    const qualidade = curada?.qualidade ?? (vramRec <= 8 ? 2 : vramRec <= 14 ? 3 : vramRec <= 24 ? 4 : 5) as Receita['qualidade']
    const velocidade = curada?.velocidade ?? (rapida ? 5 : vramRec <= 8 ? 4 : vramRec <= 16 ? 3 : vramRec <= 30 ? 2 : 1) as Receita['velocidade']

    out.push({
      id: t.name, task, familia: fam.id, familiaNome: fam.nome, nome: t.title || t.name, template: t.name,
      variante: curada?.variante ?? null,
      vramMin, vramRec, fonteVram,
      ramMin: curada?.ramMin ?? (vramRec <= 12 ? 16 : 32),
      passos: curada?.passos ?? null,
      qualidade, velocidade,
      nota: curada?.nota ?? { pt: descricaoPt(t.name, t.tags, fam.nome, task), en: t.description },
      notaCurada: !!curada,
      tags: t.tags.filter(g => !/^(image|video)$/i.test(g)),
      tamanhoGb: t.size ? Math.round(bytesGb(t.size) * 10) / 10 : null,
      tutorialUrl: t.tutorialUrl,
      miniatura: miniaturaDe(t),
      versaoMinima: t.minComfyUIVersion ?? null,
      prioridade: PRIORIDADE[t.category] ?? 2,
    })
  }
  return out
}

export interface Familia { id: string; nome: string; total: number }

export function familias(receitas: Receita[], task: FiltroTarefa): Familia[] {
  const m = new Map<string, Familia>()
  for (const r of receitas) if (casaTarefa(r, task)) {
    const f = m.get(r.familia) ?? { id: r.familia, nome: r.familiaNome, total: 0 }
    f.total++; m.set(r.familia, f)
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome))
}

/** Tags mais frequentes de uma tarefa, para os filtros da UI. */
export function tagsFrequentes(receitas: Receita[], task: FiltroTarefa, minimo = 2): string[] {
  const c = new Map<string, number>()
  for (const r of receitas) if (casaTarefa(r, task)) for (const g of r.tags) c.set(g, (c.get(g) ?? 0) + 1)
  return [...c].filter(([, n]) => n >= minimo).sort((a, b) => b[1] - a[1]).map(([g]) => g)
}

// ── Encaixe ────────────────────────────────────────────────────────────────────
export interface MaquinaResumo {
  vramGb: number | null
  ramGb: number
  memoriaUnificada: boolean
}

export interface Recomendacao extends Receita {
  encaixe: Encaixe
  motivo: Texto
  melhorOpcao: boolean
}

const ORDEM: Record<Encaixe, number> = { ideal: 0, ok: 1, apertado: 2, nao: 3 }

export function vramEfetiva(m: MaquinaResumo): { gb: number; estimada: boolean } {
  if (m.memoriaUnificada) return { gb: Math.round(m.ramGb * 0.7), estimada: false }
  if (m.vramGb == null) return { gb: Math.round(m.ramGb * 0.5), estimada: true }
  return { gb: m.vramGb, estimada: false }
}

export interface Filtro { familia?: string | 'auto'; tag?: string | 'auto'; busca?: string }

export function recomendar(receitas: Receita[], m: MaquinaResumo, task: FiltroTarefa, filtro: Filtro = {}): Recomendacao[] {
  const { gb } = vramEfetiva(m)
  const busca = (filtro.busca ?? '').trim().toLowerCase()
  const lista = receitas
    .filter(r => casaTarefa(r, task))
    .filter(r => !filtro.familia || filtro.familia === 'auto' || r.familia === filtro.familia)
    .filter(r => !filtro.tag || filtro.tag === 'auto' || r.tags.includes(filtro.tag))
    .filter(r => !busca || `${r.nome} ${r.familiaNome} ${r.tags.join(' ')} ${r.nota.en} ${r.nota.pt}`.toLowerCase().includes(busca))
    .map((r): Recomendacao => {
      let encaixe: Encaixe
      let motivo: Texto
      // Tolerância de 1 GB: um PC "de 16 GB" reporta ~15,7 GB (o SO reserva um pedaço).
      const ramCurta = m.ramGb + 1 < r.ramMin
      if (gb >= r.vramRec) {
        encaixe = 'ideal'
        motivo = { pt: `Roda com folga: ${gb} GB para ${r.vramRec} GB recomendados.`, en: `Runs comfortably: ${gb} GB against ${r.vramRec} GB recommended.` }
      } else if (gb >= r.vramMin) {
        encaixe = 'ok'
        motivo = { pt: `Roda, mais lento: ${gb} GB, recomendado ${r.vramRec} GB.`, en: `Runs, but slower: ${gb} GB, ${r.vramRec} GB recommended.` }
      } else if (gb >= r.vramMin - 2) {
        encaixe = 'apertado'
        motivo = { pt: `No limite: ${gb} GB para ${r.vramMin} GB mínimos. Só com offload para a RAM e paciência.`,
                   en: `Borderline: ${gb} GB against ${r.vramMin} GB minimum. Only with RAM offloading and patience.` }
      } else {
        encaixe = 'nao'
        motivo = { pt: `Não roda: precisa de ${r.vramMin} GB de VRAM, a placa tem ${gb} GB.`, en: `Won't run: needs ${r.vramMin} GB of VRAM, the card has ${gb} GB.` }
      }
      if (ramCurta && encaixe !== 'nao') {
        encaixe = encaixe === 'ideal' ? 'ok' : 'apertado'
        motivo = { pt: `${motivo.pt} RAM de ${m.ramGb} GB é pouca para este modelo (${r.ramMin} GB).`,
                   en: `${motivo.en} ${m.ramGb} GB of RAM is short for this model (${r.ramMin} GB).` }
      }
      return { ...r, encaixe, motivo, melhorOpcao: false }
    })
    .sort((a, b) => ORDEM[a.encaixe] - ORDEM[b.encaixe] || a.prioridade - b.prioridade || Number(b.notaCurada) - Number(a.notaCurada) || b.qualidade - a.qualidade || b.velocidade - a.velocidade)

  const melhor = lista.find(r => r.encaixe === 'ideal' || r.encaixe === 'ok')
  if (melhor) melhor.melhorOpcao = true
  return lista
}
