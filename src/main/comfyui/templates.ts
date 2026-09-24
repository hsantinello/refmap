// Templates oficiais do ComfyUI: índice, miniaturas e o JSON do workflow.
//
// Fonte preferida: o catálogo do Comfy Cloud (`cloud.comfy.org/templates/`), que
// é o pacote de templates mais recente e completo — o ComfyUI instalado do
// usuário carrega uma cópia congelada na versão dele (0.19 tinha 378; o Cloud
// tinha 637 na mesma data). Sem internet para o Cloud, cai no GitHub
// Comfy-Org/workflow_templates (mesmo conteúdo) e por último no `/templates/`
// do ComfyUI local, se estiver aberto. Índice, miniaturas e workflows saem da
// mesma fonte. Tudo é cacheado em userData/comfy para o painel abrir sem rede.
//
// Segurança: só se baixa o que existe no índice (nome válido), e as miniaturas
// chegam ao renderer pelo esquema refmap://media, como qualquer imagem do disco.

import { app, dialog, type BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import type { TemplateIndice } from '../../shared/comfy/catalogo'
import { miniaturaDe } from '../../shared/comfy/catalogo'

const CLOUD = 'https://cloud.comfy.org/templates/'
const GITHUB = 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/'
const VALIDADE_MS = 24 * 60 * 60 * 1000
const NOME_VALIDO = /^[\w.-]+$/

// Sobe quando `TemplateIndice` ganha campo novo: cache de versão diferente é
// tratado como vencido (baixa de novo), mas continua utilizável sem rede.
const VERSAO_CACHE = 2
type Cache = { versao?: number; ts: number; origem: string; entradas: TemplateIndice[] }

/** Entrada gravada por uma versão anterior do app pode não ter os campos novos. */
function normalizar(e: Partial<TemplateIndice> & { name: string }): TemplateIndice {
  return {
    name: e.name, title: e.title ?? e.name, description: e.description ?? '',
    category: e.category ?? '', categoryType: e.categoryType ?? 'image',
    tags: Array.isArray(e.tags) ? e.tags : [], models: Array.isArray(e.models) ? e.models : [],
    size: e.size ?? null, vram: e.vram ?? null, tutorialUrl: e.tutorialUrl ?? null,
    mediaSubtype: e.mediaSubtype ?? 'webp', thumbnail: e.thumbnail ?? null,
    openSource: e.openSource ?? null, minComfyUIVersion: e.minComfyUIVersion ?? null,
    saida: Array.isArray(e.saida) ? e.saida : [],
  }
}

const pastaCache = () => path.join(app.getPath('userData'), 'comfy')
const arquivoIndice = () => path.join(pastaCache(), 'templates-index.json')

let indiceEmMemoria: Cache | null = null
let baseAtual: string | null = null   // de onde o índice veio; miniaturas e workflows seguem a mesma fonte
/** Fontes para miniatura/workflow: a do índice primeiro, depois as públicas. */
const fontes = () => [...new Set([baseAtual, CLOUD, GITHUB].filter(Boolean) as string[])]

// ── Índice ────────────────────────────────────────────────────────────────────

interface EntradaBruta {
  name?: string; title?: string; description?: string; tags?: string[]; models?: string[]
  size?: number; vram?: number; tutorialUrl?: string; mediaType?: string; mediaSubtype?: string
  thumbnail?: string[] | string
  openSource?: boolean; minComfyUIVersion?: string
  io?: { outputs?: Array<{ mediaType?: string }> }
}
interface CategoriaBruta { title?: string; category?: string; moduleName?: string; type?: string; templates?: EntradaBruta[] }

function achatar(bruto: unknown): TemplateIndice[] {
  const cats: CategoriaBruta[] = Array.isArray(bruto) ? bruto : ((bruto as { categories?: CategoriaBruta[] })?.categories ?? [])
  const out: TemplateIndice[] = []
  for (const c of cats) {
    const category = c.title ?? c.category ?? c.moduleName ?? ''
    for (const t of c.templates ?? []) {
      if (!t.name || !NOME_VALIDO.test(t.name)) continue
      const thumb = Array.isArray(t.thumbnail) ? t.thumbnail[0] : t.thumbnail
      out.push({
        name: t.name,
        title: t.title ?? t.name,
        description: t.description ?? '',
        category,
        categoryType: c.type ?? t.mediaType ?? 'image',
        tags: Array.isArray(t.tags) ? t.tags : [],
        models: Array.isArray(t.models) ? t.models : [],
        size: typeof t.size === 'number' && t.size > 0 ? t.size : null,
        vram: typeof t.vram === 'number' && t.vram > 0 ? t.vram : null,
        tutorialUrl: t.tutorialUrl && /^https:\/\//.test(t.tutorialUrl) ? t.tutorialUrl : null,
        mediaSubtype: t.mediaSubtype ?? 'webp',
        thumbnail: thumb && /^[\w./-]+$/.test(thumb) && !thumb.includes('..') ? thumb : null,
        openSource: typeof t.openSource === 'boolean' ? t.openSource : null,
        minComfyUIVersion: typeof t.minComfyUIVersion === 'string' && /^\d+(\.\d+)*$/.test(t.minComfyUIVersion) ? t.minComfyUIVersion : null,
        saida: [...new Set((t.io?.outputs ?? []).map(o => o?.mediaType).filter((x): x is string => typeof x === 'string'))],
      })
    }
  }
  return out
}

async function baixarJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

/** `/templates/` do ComfyUI local, se ele estiver aberto. */
async function baseLocal(urlComfy: string | null): Promise<string | null> {
  for (const base of [...new Set([urlComfy, 'http://127.0.0.1:8188', 'http://127.0.0.1:8000'].filter(Boolean) as string[])]) {
    try {
      const res = await fetch(`${base.replace(/\/+$/, '')}/templates/index.json`, { method: 'HEAD', signal: AbortSignal.timeout(1500) })
      if (res.ok) return `${base.replace(/\/+$/, '')}/templates/`
    } catch { /* próxima */ }
  }
  return null
}

function lerCache(): Cache | null {
  if (indiceEmMemoria) return indiceEmMemoria
  try {
    const c = JSON.parse(fs.readFileSync(arquivoIndice(), 'utf-8')) as Cache
    if (!Array.isArray(c.entradas)) throw new Error('cache: entradas missing')
    c.entradas = c.entradas.filter(e => e && typeof e.name === 'string').map(normalizar)
    if (c.versao !== VERSAO_CACHE) c.ts = 0 // formato antigo: vale como fallback, mas força re-download
    indiceEmMemoria = c
  } catch { indiceEmMemoria = null }
  return indiceEmMemoria
}

export async function indiceTemplates(urlComfy: string | null, forcar = false): Promise<TemplateIndice[]> {
  const cache = lerCache()
  if (cache && !forcar && Date.now() - cache.ts < VALIDADE_MS) { baseAtual = cache.origem; return cache.entradas }

  // Cloud e GitHub primeiro (catálogo completo); o ComfyUI local por último —
  // só se checa se ele está aberto quando os dois falharam.
  const candidatos: Array<string | (() => Promise<string | null>)> = [CLOUD, GITHUB, () => baseLocal(urlComfy)]
  for (const c of candidatos) {
    const base = typeof c === 'string' ? c : await c()
    if (!base) continue
    try {
      const entradas = achatar(await baixarJson(`${base}index.json`, 10000))
      if (!entradas.length) continue
      const novo: Cache = { versao: VERSAO_CACHE, ts: Date.now(), origem: base, entradas }
      fs.mkdirSync(pastaCache(), { recursive: true })
      fs.writeFileSync(arquivoIndice(), JSON.stringify(novo), 'utf-8')
      indiceEmMemoria = novo; baseAtual = base
      return entradas
    } catch (err) {
      console.warn('[comfy] índice indisponível em', base, '—', err instanceof Error ? err.message : err)
    }
  }
  if (cache) { baseAtual = cache.origem; return cache.entradas } // vencido, mas melhor que nada
  return []
}

function entradaDoIndice(name: string): TemplateIndice | null {
  return lerCache()?.entradas.find(t => t.name === name) ?? null
}

// ── Miniaturas ────────────────────────────────────────────────────────────────

// Poucas de cada vez: o painel pede dezenas ao abrir e o ComfyUI local não é
// um CDN. As prévias de vídeo são webp animados de 0,5–4 MB (123 MB somando as
// 99 de vídeo), por isso o tempo limite é largo e há uma segunda tentativa.
let emVoo = 0
const fila: Array<() => void> = []
const vaga = () => new Promise<void>(r => { if (emVoo < 4) { emVoo++; r() } else fila.push(() => { emVoo++; r() }) })
const libera = () => { emVoo--; fila.shift()?.() }

/** Caminho local da miniatura (baixa e cacheia na 1ª vez). null se não há. */
export async function miniatura(name: string): Promise<string | null> {
  const t = entradaDoIndice(name)
  if (!t) return null
  const rel = miniaturaDe(t)
  if (!rel) return null
  const ext = path.extname(rel).toLowerCase()
  const destino = path.join(pastaCache(), 'thumbs', `${name.replace(/[^\w.-]/g, '_')}${ext}`)
  if (fs.existsSync(destino)) return destino

  await vaga()
  try {
    for (const base of fontes()) {
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        try {
          const res = await fetch(`${base}${rel}`, { signal: AbortSignal.timeout(60000) })
          if (res.status === 404) break // não existe nesta fonte; tentar de novo não muda nada
          if (!res.ok) continue
          const bytes = Buffer.from(await res.arrayBuffer())
          if (bytes.length < 64) break
          fs.mkdirSync(path.dirname(destino), { recursive: true })
          fs.writeFileSync(destino, bytes)
          return destino
        } catch { /* tempo esgotado ou rede: mais uma vez, depois próxima fonte */ }
      }
    }
    return null
  } finally { libera() }
}

// ── Workflow ──────────────────────────────────────────────────────────────────

/** Baixa o workflow e deixa o usuário escolher onde salvar. Devolve o caminho ou
 *  null se cancelou. Nome fora do índice → null (e aviso), nunca download. */
export async function baixarWorkflow(win: BrowserWindow, name: string): Promise<string | null> {
  if (!NOME_VALIDO.test(name) || !entradaDoIndice(name)) {
    console.warn('[comfy] template fora do índice recusado:', String(name).slice(0, 80))
    return null
  }
  let texto: string | null = null
  for (const base of fontes()) {
    try {
      const res = await fetch(`${base}${name}.json`, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) continue
      texto = await res.text()
      JSON.parse(texto) // tem de ser JSON válido antes de ir para o disco
      break
    } catch { texto = null }
  }
  if (!texto) throw new Error('workflow download failed')

  const escolha = await dialog.showSaveDialog(win, {
    defaultPath: `${name}.json`,
    filters: [{ name: 'ComfyUI workflow', extensions: ['json'] }],
  })
  if (escolha.canceled || !escolha.filePath) return null
  fs.writeFileSync(escolha.filePath, texto, 'utf-8')
  return escolha.filePath
}
