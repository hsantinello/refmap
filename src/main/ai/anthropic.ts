import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs/promises'
import path from 'path'
import { buildVisionPrompt } from './visionPrompt'

export async function analyzeWithAnthropic(imagePath: string, apiKey: string, lang: 'en' | 'pt' = 'en'): Promise<string> {
  // timeout + capped retries so a slow/hung endpoint fails cleanly instead of
  // leaving the UI spinner analyzing forever (mesmo padrão do openai.ts).
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 })

  const imageBuffer = await fs.readFile(imagePath)
  const base64 = imageBuffer.toString('base64')
  const ext = path.extname(imagePath).slice(1).toLowerCase()
  const mediaType = (ext === 'jpg' ? 'image/jpeg' : `image/${ext}`) as
    'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: buildVisionPrompt(lang) },
      ],
    }],
  })

  return response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
}
