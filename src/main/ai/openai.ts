import OpenAI from 'openai'
import fs from 'fs/promises'
import path from 'path'
import { buildVisionPrompt } from './visionPrompt'

// Modelos de visão SERVERLESS no Together (conferido em 03/10/2026 enviando imagem
// real a /v1/chat/completions). gemma-3n, gemma-3, Qwen-VL e Llama-4 passaram a
// responder 400 "non-serverless model". O MiniMax-M3 raciocina antes de responder:
// com max_tokens 1024 gastava tudo pensando e devolvia texto VAZIO — por isso
// VISION_MAX_TOKENS é folgado. Kimi-K3 é ~9x mais caro: fica só de reserva.
export const TOGETHER_VISION_MODELS = ['MiniMaxAI/MiniMax-M3', 'moonshotai/Kimi-K3']
export const VISION_MAX_TOKENS = 4096

// Alguns modelos de raciocínio deixam o <think>…</think> dentro do texto.
export function semRaciocinio(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

export async function analyzeWithOpenAI(
  imagePath: string,
  apiKey: string,
  options?: { baseURL?: string; model?: string; lang?: 'en' | 'pt'; signal?: AbortSignal }
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
    max_tokens: VISION_MAX_TOKENS,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: imageUrl },
        { type: 'text', text: buildVisionPrompt(options?.lang) },
      ],
    }],
  }, options?.signal ? { signal: options.signal } : undefined)

  return semRaciocinio(response.choices[0]?.message?.content ?? '')
}
