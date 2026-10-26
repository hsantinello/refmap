// Gera rascunhos de gabarito para as imagens novas do parser-bench.
//
// Para cada imagem sem <nome>.expected.json, grava:
//   <nome>.expected.json → o que o parser ATUAL extrai, com "_reviewed": false
//   <nome>.raw.json      → todos os metadados crus do arquivo, para conferir
//
// O rascunho é só um ponto de partida: ele repete os erros do parser atual.
// Alguém precisa abrir o .raw.json, corrigir o .expected.json e marcar
// "_reviewed": true — só então a imagem entra na nota (score.ts).
//
// Uso:
//   npm run bench:draft                   → conjunto dev
//   npm run bench:draft -- --set holdout

import fs from 'fs'
import path from 'path'
import { extractMetadata } from '../../src/main/metadata'
import { readPngTextChunks } from '../../src/main/metadata/pngChunks'
import { listImages, expectedPath, IMAGE_EXTS, type Expected } from './score'

const BENCH = path.resolve(__dirname, '..', '..', 'parser-bench')

async function readRaw(img: string): Promise<Record<string, unknown>> {
  if (/\.png$/i.test(img)) return readPngTextChunks(img)
  const exifr = await import('exifr')
  const raw = await exifr.default.parse(img, {
    userComment: true, xmp: true, tiff: true, translateValues: false, mergeOutput: true,
  }).catch(() => null)
  if (raw) return raw as Record<string, unknown>
  // exifr não lê WEBP: puxa o bloco EXIF cru pelo sharp só para o dump ficar conferível
  const sharp = (await import('sharp')).default
  const exif = (await sharp(img).metadata().catch(() => null))?.exif
  return exif ? { _exifTexto: exif.toString('latin1').replace(/[^\x20-\x7e\n -ÿ]+/g, ' | ') } : {}
}

// Campos binários (Buffer/Uint8Array) viram texto legível no dump; o resto passa direto.
function printable(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v instanceof Uint8Array) out[k] = Buffer.from(v).toString('utf8').replace(/\0/g, '')
    else out[k] = v
  }
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const i = args.indexOf('--set')
  const set = i > -1 ? args[i + 1] : 'dev'
  const dir = path.join(BENCH, set)
  const images = listImages(dir)
  if (!images.length) {
    console.error(`Nenhuma imagem em parser-bench/${set}/.`)
    process.exit(1)
  }

  let created = 0
  for (const img of images) {
    const ep = expectedPath(img)
    if (fs.existsSync(ep)) continue

    const raw = printable(await readRaw(img))
    fs.writeFileSync(img.replace(IMAGE_EXTS, '.raw.json'), JSON.stringify(raw, null, 2))

    const got = await extractMetadata(img)
    const p = (got.params ?? {}) as Record<string, unknown>
    const draft: Expected = { _reviewed: false, source: got.source }
    if (got.source !== 'none') {
      draft.prompt = typeof got.rawText === 'string' ? got.rawText : ''
      for (const f of ['model', 'seed', 'steps', 'cfg', 'guidance', 'sampler', 'scheduler', 'denoise', 'width', 'height'] as const) {
        if (p[f] !== undefined && p[f] !== null) (draft as unknown as Record<string, unknown>)[f] = p[f]
      }
      if (Array.isArray(p.loras)) draft.loras = p.loras.map(l => (typeof l === 'string' ? l : (l as { name: string }).name))
    }
    const keys = Object.keys(raw)
    if (got.source === 'none' && keys.length) {
      draft._note = `ATENÇÃO: o arquivo tem metadados (${keys.slice(0, 8).join(', ')}) mas o parser devolveu none. Confira o .raw.json.`
    }
    fs.writeFileSync(ep, JSON.stringify(draft, null, 2) + '\n')
    created++
    console.log(`${path.basename(img)} → ${got.source}${draft._note ? '  (!)' : ''}`)
  }
  console.log(`\n${created} rascunhos criados em parser-bench/${set}/. Revise e marque "_reviewed": true.`)
}

main()
