import { spawn } from 'child_process'
import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import ffmpegStatic from 'ffmpeg-static'
import sharp from 'sharp'

// Teto rígido de extração: o ffmpeg varre o vídeo INTEIRO e só para se um vídeo
// patológico passar disso (guarda contra estouro de disco). Vídeos normais terminam
// no fim do arquivo bem antes. A amostragem final reduz o exibido para maxScenes.
const HARD_EXTRACT_CAP = 800

// Largura máxima dos quadros. Normalizar a resolução com `scale` também CONSERTA
// vídeos que trocam de resolução no meio (comum em download de YouTube) — sem isso
// o grafo de filtros do ffmpeg trava na troca e a extração para na metade do vídeo.
const MAX_FRAME_WIDTH = 1280

// Caminho do binário ffmpeg embutido. Em produção o binário é desempacotado do
// asar (ver "asarUnpack" no package.json), então trocamos app.asar → app.asar.unpacked.
function resolveFfmpegPath(): string {
  const raw = (ffmpegStatic as unknown as string) || ''
  if (!raw) throw new Error('ffmpeg-static: binário não encontrado')
  return raw.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep).replace('app.asar/', 'app.asar.unpacked/')
}

export interface SceneFrame {
  index: number
  framePath: string
  timestamp: number // segundos (best-effort, extraído do showinfo)
}

export interface ExtractScenesOptions {
  threshold?: number       // 0..1 — sensibilidade do corte (menor = mais cenas). Default 0.5
  maxScenes?: number       // teto de segurança. Default 60
  outDir?: string          // pasta onde salvar os quadros. Default: userData/scenes/<timestamp>
  maxGap?: number          // s — nunca deixa buraco maior que isso sem cena (cobre tomadas longas). Default 20
  minStdev?: number        // abaixo disso o quadro é "liso" (flash/cor sólida/fade) → descartado. Default 8
  minDistinctFrac?: number // fração dos bits do hash que precisam diferir p/ não ser quase-duplicata. Default 0.12
  start?: number           // s — recorta o vídeo a partir daqui (trim). Default 0 (início)
  end?: number             // s — recorta o vídeo até aqui. Default: fim do vídeo
}

export interface ExtractScenesResult {
  frames: SceneFrame[]
  capped: boolean // true se atingiu o teto (havia mais cenas do que maxScenes)
  outDir: string
}

// Detecta as trocas de cena de um vídeo e extrai 1 quadro (JPG) por cena.
// Reusa o ffmpeg embutido com o filtro `select` de detecção de cena.
export async function extractScenes(
  videoPath: string,
  opts: ExtractScenesOptions = {},
): Promise<ExtractScenesResult> {
  const threshold = opts.threshold ?? 0.5
  const maxScenes = opts.maxScenes ?? 60
  const maxGap = opts.maxGap ?? 20
  const outDir =
    opts.outDir ?? path.join(app.getPath('userData'), 'scenes', String(Date.now()))

  await fs.mkdir(outDir, { recursive: true })
  const pattern = path.join(outDir, 'scene_%04d.jpg')

  // `scale` normaliza a resolução ANTES do resto: conserta vídeos que trocam de
  // resolução no meio (senão o grafo trava e a extração para na metade) e capa a
  // largura em MAX_FRAME_WIDTH sem aumentar vídeos menores. Depois `select` pega:
  //  - o primeiro quadro (n=0),
  //  - cortes de câmera (score de cena > threshold),
  //  - E cobertura: um quadro sempre que passam maxGap segundos sem nenhuma seleção
  //    (`t - prev_selected_t >= maxGap`), pra tomadas longas não ficarem sem cena.
  // `showinfo` imprime os timestamps. Vírgulas internas são escapadas (\,).
  const filter = `scale='min(${MAX_FRAME_WIDTH}\\,iw)':-2,select=eq(n\\,0)+gt(scene\\,${threshold})+gte(t-prev_selected_t\\,${maxGap}),showinfo`

  // Trim: -ss ANTES de -i faz seek rápido; os timestamps do showinfo passam a contar
  // do início do trecho (0), então somamos `start` de volta ao reportar.
  const start = opts.start && opts.start > 0 ? opts.start : 0
  const args = ['-hide_banner']
  if (start > 0) args.push('-ss', String(start))
  args.push('-i', videoPath)
  if (opts.end && opts.end > start) args.push('-t', String(opts.end - start))
  args.push(
    '-vf', filter,
    '-vsync', 'vfr',
    '-frames:v', String(HARD_EXTRACT_CAP), // varre o vídeo INTEIRO; só limita caso extremo
    '-q:v', '3',
    pattern,
  )

  const stderr = await runFfmpeg(resolveFfmpegPath(), args)
  const times = [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map(m => parseFloat(m[1]) + start)

  const ordered = (await fs.readdir(outDir)).filter(f => /^scene_\d+\.jpg$/.test(f)).sort()
  const hitHardCap = ordered.length >= HARD_EXTRACT_CAP

  // Limpeza: (A) descarta quadros "lisos" (flash branco, cor sólida, fade — medindo a
  // região CENTRAL, ignorando barras de letterbox) e (dedup GLOBAL) descarta quadros
  // parecidos com QUALQUER cena já escolhida — não só a anterior. Isso pega os cenários
  // que o filme intercala e repete ao longo do vídeo (mesma cama, mesma janela, etc).
  const minStdev = opts.minStdev ?? 8
  const minDistinctFrac = opts.minDistinctFrac ?? 0.25
  const deduped: SceneFrame[] = []
  const keptHashes: number[][] = []
  let lastKeptT = -Infinity
  for (let i = 0; i < ordered.length; i++) {
    const fp = path.join(outDir, ordered[i])
    const t = times[i] ?? 0
    const sig = await frameSignature(fp).catch(() => null)
    if (sig && sig.stdev < minStdev) { await fs.rm(fp).catch(() => {}); continue } // (A) quadro liso/vazio
    // Quadros de COBERTURA (longe no tempo do último mantido) são preservados mesmo se
    // parecidos — garantem amostras ao longo de cenas CONTÍNUAS (sem corte de câmera).
    const isCoverage = t - lastKeptT >= maxGap
    if (!isCoverage && sig && keptHashes.some(h => hammingDistance(h, sig.hash) < minDistinctFrac * sig.hash.length)) {
      await fs.rm(fp).catch(() => {}) // parecido com uma cena já escolhida → descarta
      continue
    }
    if (sig) keptHashes.push(sig.hash)
    lastKeptT = t
    deduped.push({ index: deduped.length, framePath: fp, timestamp: t })
  }

  // Se ainda passou do teto, amostra UNIFORMEMENTE ao longo de toda a duração
  // (começo → meio → fim), em vez de truncar no começo do vídeo.
  let frames = deduped
  let capped = hitHardCap
  if (deduped.length > maxScenes) {
    const step = deduped.length / maxScenes
    const keep = new Set<string>()
    const sampled: SceneFrame[] = []
    for (let k = 0; k < maxScenes; k++) {
      const f = deduped[Math.min(deduped.length - 1, Math.floor(k * step))]
      if (!keep.has(f.framePath)) { keep.add(f.framePath); sampled.push(f) }
    }
    await Promise.all(
      deduped.filter(f => !keep.has(f.framePath)).map(f => fs.rm(f.framePath).catch(() => {})),
    )
    frames = sampled.map((f, i) => ({ ...f, index: i }))
    capped = true
  }

  return { frames, capped, outDir }
}

// Captura MANUAL: extrai um único quadro no timestamp exato escolhido pelo usuário.
// Seek híbrido: -ss (t-1) antes do -i (rápido, vai pro keyframe) + -ss restante depois
// do -i (decodifica ~1s até o tempo exato) → rápido E preciso.
export async function extractFrameAt(
  videoPath: string,
  timestamp: number,
  outDir?: string,
): Promise<SceneFrame> {
  const dir = outDir ?? path.join(app.getPath('userData'), 'scenes', 'manual')
  await fs.mkdir(dir, { recursive: true })
  const t = Math.max(0, timestamp)
  const pre = Math.max(0, t - 1)
  const fp = path.join(dir, `manual_${Date.now()}.jpg`)
  const filter = `scale='min(${MAX_FRAME_WIDTH}\\,iw)':-2`
  const args = ['-hide_banner']
  if (pre > 0) args.push('-ss', String(pre))
  args.push('-i', videoPath)
  if (t - pre > 0) args.push('-ss', String(t - pre))
  args.push('-frames:v', '1', '-vf', filter, '-q:v', '3', '-y', fp)
  await runFfmpeg(resolveFfmpegPath(), args)
  return { index: 0, framePath: fp, timestamp: t }
}

// Assinatura do quadro a partir da REGIÃO CENTRAL (corta as bordas, ignorando letterbox).
// Usa um grid GROSSEIRO (12x7 → 40 valores centrais): borrar os detalhes finos faz o
// "mesmo cenário/enquadramento" em momentos diferentes ter hash parecido, então é
// reconhecido como repetido. Retorna:
//  - stdev: quão "cheio" de conteúdo está o centro (baixo = liso: flash, cor sólida, fade)
//  - hash: average-hash (relativo à média → invariante a brilho/contraste)
async function frameSignature(framePath: string): Promise<{ stdev: number; hash: number[] }> {
  const W = 12, H = 7
  const { data } = await sharp(framePath).grayscale().resize(W, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  const mx = 2, my = 1
  const center: number[] = []
  for (let y = my; y < H - my; y++) for (let x = mx; x < W - mx; x++) center.push(data[y * W + x])
  const mean = center.reduce((s, v) => s + v, 0) / center.length
  const variance = center.reduce((s, v) => s + (v - mean) * (v - mean), 0) / center.length
  return { stdev: Math.sqrt(variance), hash: center.map(v => (v >= mean ? 1 : 0)) }
}

// Distância de Hamming: quantos bits diferem entre dois hashes (0 = idêntico).
function hammingDistance(a: number[], b: number[]): number {
  let d = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++
  return d
}

function runFfmpeg(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('error', reject)
    proc.on('close', code => {
      if (code === 0) resolve(stderr)
      else reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.slice(-800)}`))
    })
  })
}
