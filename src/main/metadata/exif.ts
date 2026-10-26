import fs from 'fs'
import path from 'path'

const EXIFR_OPTS = { userComment: true, xmp: true, tiff: true, translateValues: false, mergeOutput: true }

/**
 * EXIF/XMP de JPG e WEBP, já com os campos que os parsers esperam:
 * - ComfyUI (SaveAnimatedWEBP e afins) grava "prompt:<json>" e "workflow:<json>"
 *   em campos de texto do EXIF (Model, Make...) → viram `prompt` / `workflow`.
 * - A1111/Forge gravam o texto de geração no UserComment → vira `parameters`.
 */
export async function readExifMetadata(imagePath: string): Promise<Record<string, unknown> | null> {
  const exifr = (await import('exifr')).default
  const ext = path.extname(imagePath).toLowerCase()

  // O exifr não entende WEBP: o bloco EXIF (um TIFF) sai do chunk RIFF e vai direto pra ele
  let raw: Record<string, unknown> | null
  if (ext === '.webp') {
    const tiff = webpExifChunk(imagePath)
    raw = tiff ? ((await exifr.parse(tiff, EXIFR_OPTS)) as Record<string, unknown> | null) : null
  } else {
    raw = (await exifr.parse(imagePath, EXIFR_OPTS)) as Record<string, unknown> | null
  }
  if (!raw) return null

  for (const v of Object.values(raw)) {
    if (typeof v !== 'string') continue
    const m = /^(prompt|workflow):\s*(\{[\s\S]*)$/.exec(v)
    if (m && raw[m[1]] === undefined) raw[m[1]] = m[2]
  }
  if (raw.parameters === undefined) {
    const comment = decodeUserComment(raw.userComment ?? raw.UserComment)
    if (comment) raw.parameters = comment
  }
  return raw
}

// RIFF....WEBP + chunks [fourcc, tamanho LE, dados (com padding par)]
function webpExifChunk(imagePath: string): Buffer | null {
  let buf: Buffer
  try { buf = fs.readFileSync(imagePath) } catch { return null }
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null
  let offset = 12
  while (offset + 8 <= buf.length) {
    const type = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const data = buf.subarray(offset + 8, offset + 8 + size)
    if (type === 'EXIF') {
      // Alguns gravadores mantêm o cabeçalho "Exif\0\0" do JPEG
      return data.toString('ascii', 0, 6) === 'Exif\0\0' ? data.subarray(6) : data
    }
    offset += 8 + size + (size & 1)
  }
  return null
}

// UserComment começa com 8 bytes de charset: "ASCII\0\0\0", "UNICODE\0" (UTF-16) ou zeros
function decodeUserComment(v: unknown): string | null {
  if (typeof v === 'string') {
    const s = v.replace(/^(ASCII|UNICODE|JIS)?\0*/, '').replace(/\0+$/, '').trim()
    return s || null
  }
  if (!(v instanceof Uint8Array) || v.length <= 8) return null
  const head = Buffer.from(v.subarray(0, 8)).toString('ascii')
  const body = Buffer.from(v.subarray(8))
  let s: string
  if (head.startsWith('UNICODE')) {
    // A1111 (piexif) grava UTF-16 BE; sem BOM, decide pelo lado em que caem os zeros
    const be = body.length > 1 && body[0] === 0 && body[1] !== 0
    const even = body.subarray(0, body.length & ~1)
    s = be ? Buffer.from(even).swap16().toString('utf16le') : even.toString('utf16le')
  } else {
    s = body.toString('utf8')
  }
  s = s.replace(/^﻿/, '').replace(/\0+$/, '').trim()
  return s || null
}
