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

  return {
    source: 'a1111',
    description: positivePrompt || '',
    rawText: positivePrompt || null,
    params: {
      steps: extractParam(paramsLine, 'Steps'),
      sampler: extractParam(paramsLine, 'Sampler'),
      cfg: extractParam(paramsLine, 'CFG scale'),
      seed: extractParam(paramsLine, 'Seed'),
      model: extractParam(paramsLine, 'Model'),
    },
  }
}
