import type { ExtractionResult } from './comfyui'

export function isMidjourney(raw: Record<string, unknown>): boolean {
  const desc = (raw?.Description ?? raw?.description) as string | undefined
  return (
    typeof desc === 'string' &&
    (desc.includes(' --') || desc.includes('Job ID:') || /--\w+/.test(desc))
  )
}

export function parseMidjourney(raw: Record<string, unknown>): ExtractionResult {
  const text = (raw.Description ?? raw.description) as string

  const paramStart = text.search(/ --\w/)
  const promptText = paramStart > -1 ? text.slice(0, paramStart).trim() : text.trim()

  const paramPart = paramStart > -1 ? text.slice(paramStart) : ''
  const params: Record<string, string> = {}
  const paramRegex = /--(\w+)\s+([^\s-][^\s]*)/g
  let match
  while ((match = paramRegex.exec(paramPart)) !== null) {
    params[match[1]] = match[2]
  }

  return {
    source: 'midjourney',
    description: promptText || '',
    rawText: promptText || null,
    params,
  }
}
