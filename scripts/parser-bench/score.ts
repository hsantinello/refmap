// Nota dos parsers de metadados (src/main/metadata) contra um gabarito.
//
// Por que existe: os parsers decidem se a imagem sai com o prompt EXATO do
// arquivo ou cai na análise por IA (paga e aproximada). Sem uma nota, não dá
// pra saber se uma mudança num parser melhorou ou quebrou outro caso. Este
// script é a "métrica fixa" do loop de melhoria descrito em parser-bench/program.md.
//
// Gabarito: cada imagem em parser-bench/<conjunto>/ tem do lado um
// <nome>.expected.json (gerado em rascunho por draft.ts e revisado à mão).
// Só entram na nota os gabaritos com "_reviewed": true.
//
// Uso:
//   npm run bench:parsers                 → conjunto dev
//   npm run bench:parsers -- --set holdout
//   npm run bench:parsers -- --verbose    → mostra cada campo errado
//   npm run bench:parsers -- --log "descrição da mudança"  → anexa em results.tsv

import fs from 'fs'
import path from 'path'
import { extractMetadata } from '../../src/main/metadata'
import type { ExtractionResult } from '../../src/main/metadata'

const RAIZ = path.resolve(__dirname, '..', '..')
const BENCH = path.join(RAIZ, 'parser-bench')
export const IMAGE_EXTS = /\.(png|jpe?g|webp)$/i

export interface Expected {
  _reviewed?: boolean
  _note?: string
  source: ExtractionResult['source']
  prompt?: string
  model?: string
  seed?: number
  steps?: number
  cfg?: number
  guidance?: number
  sampler?: string
  scheduler?: string
  denoise?: number
  width?: number
  height?: number
  loras?: string[]
}

// Peso de cada campo na nota. source e prompt valem mais: são o que o usuário
// vê no Prompt Builder. Campo ausente no gabarito não conta.
const PESOS: Record<string, number> = {
  source: 3, prompt: 4, model: 1, seed: 1, steps: 1, cfg: 1, guidance: 1,
  sampler: 1, scheduler: 1, denoise: 1, width: 1, height: 1, loras: 1,
}

const normText = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
const normModel = (s: string) => s.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '').toLowerCase()

// Prompt ganha crédito parcial (F1 de palavras): pegar 90% do texto é melhor
// que pegar o nó errado, e a nota precisa enxergar essa diferença.
function promptScore(expected: string, actual: string): number {
  const a = normText(expected), b = normText(actual)
  if (a === b) return 1
  if (!a || !b) return 0
  const tok = (s: string) => s.split(/[\s,()]+/).filter(Boolean)
  const ea = tok(a), eb = tok(b)
  const pool = new Map<string, number>()
  for (const t of ea) pool.set(t, (pool.get(t) ?? 0) + 1)
  let hit = 0
  for (const t of eb) {
    const n = pool.get(t) ?? 0
    if (n > 0) { hit++; pool.set(t, n - 1) }
  }
  if (!hit) return 0
  const p = hit / eb.length, r = hit / ea.length
  return (2 * p * r) / (p + r)
}

function sameNumber(a: unknown, b: unknown): boolean {
  const x = Number(a), y = Number(b)
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-6
}

function loraNames(params: Record<string, unknown> | undefined): string[] {
  const l = params?.loras
  if (!Array.isArray(l)) return []
  return l.map(x => normModel(typeof x === 'string' ? x : String((x as { name?: string })?.name ?? '')))
}

export interface FieldResult { field: string; weight: number; score: number; expected: unknown; actual: unknown }

export function scoreOne(exp: Expected, got: ExtractionResult): FieldResult[] {
  const params = (got.params ?? {}) as Record<string, unknown>
  const out: FieldResult[] = []
  const push = (field: string, score: number, expected: unknown, actual: unknown) =>
    out.push({ field, weight: PESOS[field] ?? 1, score, expected, actual })

  push('source', exp.source === got.source ? 1 : 0, exp.source, got.source)
  // Imagem sem metadados: só importa o parser não inventar nada.
  if (exp.source === 'none') return out

  // rawText fora do tipo (ex.: o array de um link do ComfyUI) zera o campo em vez de derrubar a nota
  if (exp.prompt !== undefined) {
    const text = typeof got.rawText === 'string' ? got.rawText : ''
    push('prompt', got.rawText == null || typeof got.rawText === 'string' ? promptScore(exp.prompt, text) : 0, exp.prompt, got.rawText)
  }
  if (exp.model !== undefined) {
    const m = params.model
    push('model', typeof m === 'string' && normModel(m) === normModel(exp.model) ? 1 : 0, exp.model, m)
  }
  for (const f of ['seed', 'steps', 'cfg', 'guidance', 'denoise', 'width', 'height'] as const) {
    if (exp[f] !== undefined) push(f, sameNumber(exp[f], params[f]) ? 1 : 0, exp[f], params[f])
  }
  for (const f of ['sampler', 'scheduler'] as const) {
    if (exp[f] !== undefined) {
      const v = params[f]
      push(f, typeof v === 'string' && v.toLowerCase() === exp[f]!.toLowerCase() ? 1 : 0, exp[f], v)
    }
  }
  if (exp.loras !== undefined) {
    const want = exp.loras.map(normModel).sort(), have = loraNames(params).sort()
    push('loras', JSON.stringify(want) === JSON.stringify(have) ? 1 : 0, exp.loras, have)
  }
  return out
}

export function listImages(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => IMAGE_EXTS.test(f)).sort().map(f => path.join(dir, f))
}

export const expectedPath = (img: string) => img.replace(IMAGE_EXTS, '.expected.json')

async function main() {
  const args = process.argv.slice(2)
  const opt = (name: string) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : undefined }
  const set = opt('--set') ?? 'dev'
  const verbose = args.includes('--verbose')
  const logMsg = opt('--log')

  const dir = path.join(BENCH, set)
  const images = listImages(dir)
  if (!images.length) {
    console.error(`Nenhuma imagem em ${path.relative(RAIZ, dir)}. Veja parser-bench/README.md.`)
    process.exit(1)
  }

  let earned = 0, possible = 0, perfect = 0, scored = 0, drafts = 0, missing = 0
  const bySource = new Map<string, { earned: number; possible: number; n: number }>()
  const falhas: string[] = []

  for (const img of images) {
    const ep = expectedPath(img)
    if (!fs.existsSync(ep)) { missing++; continue }
    const exp = JSON.parse(fs.readFileSync(ep, 'utf8')) as Expected
    if (!exp._reviewed) { drafts++; continue }

    const got = await extractMetadata(img)
    const fields = scoreOne(exp, got)
    const e = fields.reduce((s, f) => s + f.weight * f.score, 0)
    const p = fields.reduce((s, f) => s + f.weight, 0)
    earned += e; possible += p; scored++
    if (e === p) perfect++

    const b = bySource.get(exp.source) ?? { earned: 0, possible: 0, n: 0 }
    b.earned += e; b.possible += p; b.n++
    bySource.set(exp.source, b)

    const erros = fields.filter(f => f.score < 1)
    if (erros.length) {
      const nome = path.basename(img)
      falhas.push(`  ${nome} (${((e / p) * 100).toFixed(0)}%): ${erros.map(f => f.field).join(', ')}`)
      if (verbose) {
        for (const f of erros) {
          const cut = (v: unknown) => { const s = JSON.stringify(v) ?? 'undefined'; return s.length > 120 ? s.slice(0, 117) + '...' : s }
          falhas.push(`      ${f.field}: esperado ${cut(f.expected)} | veio ${cut(f.actual)}`)
        }
      }
    }
  }

  if (!scored) {
    console.error(`Nenhum gabarito revisado em ${set} (${drafts} rascunhos, ${missing} sem gabarito). Rode npm run bench:draft e revise.`)
    process.exit(1)
  }

  const nota = (earned / possible) * 100
  console.log(`\nConjunto: ${set} — ${scored} imagens avaliadas (${drafts} rascunhos e ${missing} sem gabarito ignorados)`)
  console.log('\nPor origem esperada:')
  for (const [src, b] of [...bySource].sort()) {
    console.log(`  ${src.padEnd(11)} ${String(b.n).padStart(3)} imgs  ${((b.earned / b.possible) * 100).toFixed(1)}%`)
  }
  if (falhas.length) console.log(`\nErros:\n${falhas.join('\n')}`)
  console.log(`\nPerfeitas: ${perfect}/${scored}`)
  console.log(`NOTA: ${nota.toFixed(2)}`)

  if (logMsg !== undefined) {
    const log = path.join(BENCH, 'results.tsv')
    if (!fs.existsSync(log)) fs.writeFileSync(log, 'data\tconjunto\tnota\tperfeitas\timagens\tmudança\n')
    const linha = [new Date().toISOString(), set, nota.toFixed(2), perfect, scored, logMsg.replace(/\s+/g, ' ')].join('\t')
    fs.appendFileSync(log, linha + '\n')
  }
}

if (require.main === module) main()
