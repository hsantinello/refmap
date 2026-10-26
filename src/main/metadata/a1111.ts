import type { ExtractionResult } from './comfyui'

export function isA1111(raw: Record<string, unknown>): boolean {
  const params = (raw?.parameters ?? raw?.Parameters) as string | undefined
  return (
    typeof params === 'string' &&
    params.includes('Steps:') &&
    params.includes('Sampler:')
  )
}

export function parseA1111(raw: Record<string, unknown>): ExtractionResult {
  const text = (raw.parameters ?? raw.Parameters) as string

  const negIndex = text.indexOf('Negative prompt:')
  const positivePrompt = negIndex > -1
    ? text.slice(0, negIndex).trim()
    : text.split('\n')[0].trim()

  const paramsLine = text.split('\n').find(l => l.includes('Steps:')) ?? ''

  function extractParam(line: string, key: string): string | undefined {
    const match = line.match(new RegExp(`${key}:\\s*([^,\\n]+)`))
    return match?.[1]?.trim()
  }

  // "Size: 832x1216"
  const size = extractParam(paramsLine, 'Size')?.match(/^(\d+)x(\d+)$/)

  return {
    source: 'a1111',
    description: positivePrompt || '',
    rawText: positivePrompt || null,
    params: {
      steps: extractParam(paramsLine, 'Steps'),
      sampler: extractParam(paramsLine, 'Sampler'),
      // A1111 1.9+ e Forge separam o scheduler do sampler
      scheduler: extractParam(paramsLine, 'Schedule type'),
      cfg: extractParam(paramsLine, 'CFG scale'),
      // Forge com Flux: o guidance de verdade é o "Distilled CFG Scale"
      guidance: extractParam(paramsLine, 'Distilled CFG Scale'),
      seed: extractParam(paramsLine, 'Seed'),
      model: extractParam(paramsLine, 'Model'),
      width: size?.[1],
      height: size?.[2],
    },
  }
}
