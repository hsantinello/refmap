import OpenAI from 'openai'
import fs from 'fs/promises'
import path from 'path'
import { buildVisionPrompt } from './visionPrompt'

export async function analyzeWithOpenAI(
  imagePath: string,
  apiKey: string,
  options?: { baseURL?: string; model?: string; lang?: 'en' | 'pt' }
): Promise<string> {
  // timeout + capped retries so a slow/hung endpoint fails cleanly instead of
  // leaving the UI spinner analyzing forever (Together serverless can stall).
  const client = new OpenAI({
    apiKey,
    timeout: 60_000,
    maxRetries: 1,
    ...(options?.baseURL ? { baseURL: options.baseURL } : {}),
  })
  const model = options?.model ?? 'gpt-4o-mini'

  const imageBuffer = await fs.readFile(imagePath)
  const base64 = imageBuffer.toString('base64')
  const ext = path.extname(imagePath).slice(1).toLowerCase()
  const mime = ext === 'jpg' ? 'jpeg' : ext
  const dataUrl = `data:image/${mime};base64,${base64}`

  // The OpenAI-specific `detail` field is REJECTED by Together's vision models
  // (Gemma/MiniMax) and made every Together image analysis fail. Only send it
  // to OpenAI proper (no custom baseURL); omit it for Together/compatible APIs.
  const imageUrl = options?.baseURL
    ? { url: dataUrl }
    : { url: dataUrl, detail: 'high' as const }

  const response = await client.chat.completions.create({
    model,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: imageUrl },
        { type: 'text', text: buildVisionPrompt(options?.lang) },
      ],
    }],
  })

  return (response.choices[0]?.message?.content ?? '').trim()
}
