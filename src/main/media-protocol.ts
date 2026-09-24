// Esquema `refmap://` — como o renderer chega a arquivos do disco.
//
// Antes a janela rodava com `webSecurity: false` para poder carregar as imagens
// do usuário via `file://`. Isso desligava a política de mesma origem na janela
// INTEIRA: qualquer código que rodasse nela podia ler qualquer arquivo e mandar
// para qualquer servidor. Este esquema devolve só o que o app precisa:
//
//   refmap://media/<caminho absoluto, URL-encoded>
//       Arquivos do usuário. Só extensões de imagem e vídeo — o renderer não
//       consegue usar isto para ler um .txt, um .env ou um banco de dados.
//       Suporta Range, senão o <video> não avança nem retrocede.
//
//   refmap://lib/<arquivo>
//       O Whisper (transformers.js + WASM), que antes vinha de um CDN em tempo
//       de execução. Confinado à pasta da biblioteca; só .js/.wasm/.json.
//
// Tudo sai com `Access-Control-Allow-Origin: *`: a página do app vive em
// `file://` (origem opaca), então cada pedido aqui é cross-origin. Sem isso o
// canvas ficaria "contaminado" e `getImageData` (paleta de cores, recorte,
// copiar imagem) falharia.

import { app, protocol } from 'electron'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'

export const ESQUEMA = 'refmap'

const MIME_MEDIA: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.m4v': 'video/x-m4v',
}
const MIME_LIB: Record<string, string> = {
  '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.json': 'application/json',
}

/** Precisa rodar ANTES de `app.whenReady()`. `standard`+`secure` fazem o esquema
 *  se comportar como https (URLs relativas, módulos ES, fetch); `stream` deixa
 *  devolver arquivos grandes sem carregar tudo na memória. */
export function registrarEsquemaPrivilegiado(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: ESQUEMA,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  }])
}

/** Pasta com transformers.min.js e os .wasm. No app empacotado vem de
 *  `extraResources` (package.json); em dev, direto do node_modules. */
export function pastaDaLib(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'transformers')
    : path.join(app.getAppPath(), 'node_modules', '@xenova', 'transformers', 'dist')
}

export type Resolucao =
  | { ok: true; arquivo: string; mime: string }
  | { ok: false; status: 400 | 403 | 404 }

/** Decide o que uma URL `refmap://` pode devolver. Pura, para poder ser testada. */
export function resolverPedido(urlBruta: string, libDir: string): Resolucao {
  let url: URL
  try { url = new URL(urlBruta) } catch { return { ok: false, status: 400 } }
  if (url.protocol !== `${ESQUEMA}:`) return { ok: false, status: 400 }

  let relativo: string
  try { relativo = decodeURIComponent(url.pathname.replace(/^\/+/, '')) } catch { return { ok: false, status: 400 } }
  if (!relativo) return { ok: false, status: 404 }

  if (url.host === 'media') {
    // Caminho absoluto de um arquivo de mídia, em qualquer lugar do disco.
    if (!path.isAbsolute(relativo)) return { ok: false, status: 403 }
    const arquivo = path.normalize(relativo)
    const mime = MIME_MEDIA[path.extname(arquivo).toLowerCase()]
    if (!mime) return { ok: false, status: 403 }
    return { ok: true, arquivo, mime }
  }

  if (url.host === 'lib') {
    // Só dentro da pasta da biblioteca. `resolve` já colapsa `..`; a checagem de
    // prefixo garante que o resultado não saiu da pasta.
    const raiz = path.resolve(libDir)
    const arquivo = path.resolve(raiz, relativo)
    if (arquivo !== raiz && !arquivo.startsWith(raiz + path.sep)) return { ok: false, status: 403 }
    const mime = MIME_LIB[path.extname(arquivo).toLowerCase()]
    if (!mime) return { ok: false, status: 403 }
    return { ok: true, arquivo, mime }
  }

  return { ok: false, status: 404 }
}

/** Interpreta `Range: bytes=a-b`. Devolve null se ausente ou inválido. */
export function interpretarRange(cabecalho: string | null, tamanho: number): { inicio: number; fim: number } | null {
  if (!cabecalho) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(cabecalho.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null
  let inicio: number, fim: number
  if (m[1] === '') {            // bytes=-N → últimos N bytes
    const n = Number(m[2])
    if (n === 0) return null
    inicio = Math.max(0, tamanho - n); fim = tamanho - 1
  } else {
    inicio = Number(m[1])
    fim = m[2] === '' ? tamanho - 1 : Math.min(Number(m[2]), tamanho - 1)
  }
  if (inicio > fim || inicio >= tamanho) return null
  return { inicio, fim }
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range' }

function responderArquivo(arquivo: string, mime: string, pedido: Request): Response {
  let stat: fs.Stats
  try { stat = fs.statSync(arquivo) } catch { return new Response(null, { status: 404, headers: CORS }) }
  if (!stat.isFile()) return new Response(null, { status: 404, headers: CORS })

  const base = { ...CORS, 'Content-Type': mime, 'Accept-Ranges': 'bytes' }
  const range = interpretarRange(pedido.headers.get('range'), stat.size)

  if (range) {
    const corpo = Readable.toWeb(fs.createReadStream(arquivo, { start: range.inicio, end: range.fim })) as ReadableStream
    return new Response(corpo, {
      status: 206,
      headers: {
        ...base,
        'Content-Length': String(range.fim - range.inicio + 1),
        'Content-Range': `bytes ${range.inicio}-${range.fim}/${stat.size}`,
      },
    })
  }

  // Pedido de Range fora do arquivo: 416, como um servidor HTTP faria.
  if (pedido.headers.get('range')) {
    return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${stat.size}` } })
  }

  const corpo = Readable.toWeb(fs.createReadStream(arquivo)) as ReadableStream
  return new Response(corpo, { status: 200, headers: { ...base, 'Content-Length': String(stat.size) } })
}

/** Chamado depois de `app.whenReady()`. */
export function registrarProtocolo(): void {
  const libDir = pastaDaLib()
  protocol.handle(ESQUEMA, pedido => {
    if (pedido.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (pedido.method !== 'GET' && pedido.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: CORS })
    }
    const r = resolverPedido(pedido.url, libDir)
    if (!r.ok) {
      if (r.status === 403) console.warn('[refmap://] recusado:', pedido.url.slice(0, 160))
      return new Response(null, { status: r.status, headers: CORS })
    }
    return responderArquivo(r.arquivo, r.mime, pedido)
  })
}
