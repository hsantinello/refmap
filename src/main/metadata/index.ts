import path from 'path'
import { readPngTextChunks } from './pngChunks'
import { readExifMetadata } from './exif'
import type { ExtractionResult } from './comfyui'
import { isComfyUI, parseComfyUI } from './comfyui'
import { isA1111, parseA1111 } from './a1111'
import { isMidjourney, parseMidjourney } from './midjourney'

const EMPTY_RESULT: ExtractionResult = {
  source: 'none',
  description: '',
  rawText: null,
}

export async function extractMetadata(imagePath: string): Promise<ExtractionResult> {
  try {
    const ext = path.extname(imagePath).toLowerCase()

    // PNG: read chunks directly — exifr is unreliable for tEXt/iTXt chunks
    if (ext === '.png') {
      const raw = readPngTextChunks(imagePath)
      if (isComfyUI(raw)) return parseComfyUI(raw, path.basename(imagePath))
      if (isA1111(raw)) return parseA1111(raw)
      if (isMidjourney(raw)) return parseMidjourney(raw)
      return EMPTY_RESULT
    }

    // JPG/WEBP: EXIF/XMP, com prompt/workflow do ComfyUI e UserComment do A1111 já extraídos
    const raw = await readExifMetadata(imagePath)
    if (!raw) return EMPTY_RESULT

    if (isComfyUI(raw)) return parseComfyUI(raw, path.basename(imagePath))
    if (isA1111(raw)) return parseA1111(raw)
    if (isMidjourney(raw)) return parseMidjourney(raw)

    return EMPTY_RESULT
  } catch (err) {
    console.error('[metadata] extraction error:', err)
    return EMPTY_RESULT
  }
}

export type { ExtractionResult }
