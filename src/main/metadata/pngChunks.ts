import fs from 'fs'
import zlib from 'zlib'

/**
 * Reads all tEXt / zTXt / iTXt chunks from a PNG file.
 * Returns a flat key→value map.
 */
export function readPngTextChunks(imagePath: string): Record<string, string> {
  let buf: Buffer
  try {
    buf = fs.readFileSync(imagePath)
  } catch {
    return {}
  }

  // Verify PNG signature
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return {}

  const result: Record<string, string> = {}
  let offset = 8 // skip 8-byte signature

  while (offset + 8 < buf.length) {
    const length = buf.readUInt32BE(offset)
    offset += 4
    const type = buf.subarray(offset, offset + 4).toString('ascii')
    offset += 4
    const data = buf.subarray(offset, offset + length)
    offset += length
    offset += 4 // CRC

    if (type === 'IEND') break

    if (type === 'tEXt') {
      const sep = data.indexOf(0)
      if (sep === -1) continue
      const key = data.subarray(0, sep).toString('latin1')
      const value = data.subarray(sep + 1).toString('latin1')
      result[key] = value
    }

    if (type === 'zTXt') {
      const sep = data.indexOf(0)
      if (sep === -1) continue
      const key = data.subarray(0, sep).toString('latin1')
      // byte after null is compression method (0 = deflate)
      try {
        const compressed = data.subarray(sep + 2)
        const value = zlib.inflateSync(compressed).toString('latin1')
        result[key] = value
      } catch { /* skip corrupt chunk */ }
    }

    if (type === 'iTXt') {
      // keyword \0 comprFlag(1) comprMethod(1) language \0 transKeyword \0 text
      const sep = data.indexOf(0)
      if (sep === -1) continue
      const key = data.subarray(0, sep).toString('latin1')
      const comprFlag = data[sep + 1]
      let cursor = sep + 3 // skip comprFlag + comprMethod
      // skip language tag
      while (cursor < data.length && data[cursor] !== 0) cursor++
      cursor++ // skip null
      // skip translated keyword
      while (cursor < data.length && data[cursor] !== 0) cursor++
      cursor++ // skip null

      try {
        let textBuf = data.subarray(cursor)
        if (comprFlag === 1) textBuf = zlib.inflateSync(textBuf)
        result[key] = textBuf.toString('utf8')
      } catch { /* skip */ }
    }
  }

  return result
}
