import OpenAI from 'openai'
import fs from 'fs/promises'
import path from 'path'

function buildVisionPrompt(lang: 'en' | 'pt' = 'en'): string {
  const langRule = lang === 'pt'
    ? '- Write every chunk in Brazilian Portuguese'
    : '- Write in English'
  return `Analyze this AI-generated image and describe it as detailed prompt chunks for image generation.

Format: {main subject}[modifier][modifier]...

Cover ALL of these aspects with specific, descriptive chunks:
- SUBJECT: who/what is the main focus, their appearance, expression, pose, clothing, accessories
- COMPOSITION: framing, angle, perspective, depth of field, foreground/background elements
- SETTING: environment, location, time of day, weather, atmosphere
- LIGHTING: type, direction, quality, shadows, highlights, color temperature
- COLOR: dominant palette, color grading, saturation, contrast
- STYLE: artistic style, rendering technique, medium (digital art, photography, painting, etc.)
- QUALITY: render quality, detail level, sharpness, texture
- MOOD: emotional tone, ambiance

Rules:
- Create 15-25 chunks total
- Each chunk is a short, specific, prompt-ready phrase
- Be precise and descriptive — avoid generic terms like "beautiful" or "nice"
${langRule}
- If the image contains nudity, explicit sexual content, or adult-only material, include [nsfw] as one of the chunks
- Return ONLY the formatted string, nothing else

Example: {a female warrior}[long silver braided hair][wearing dark leather armor][holding a glowing sword][fierce determined expression][standing on a cliff edge][stormy sky background][dramatic rim lighting][deep shadows][cool blue and purple color grade][cinematic composition][low angle shot][hyperrealistic digital art][8k ultra detailed][volumetric fog][epic fantasy atmosphere]`
}

export async function analyzeWithOpenAI(
  imagePath: string,
  apiKey: string,
  options?: { baseURL?: string; model?: string; lang?: 'en' | 'pt' }
): Promise<string> {
  const client = new OpenAI({ apiKey, ...(options?.baseURL ? { baseURL: options.baseURL } : {}) })
  const model = options?.model ?? 'gpt-4o-mini'

  const imageBuffer = await fs.readFile(imagePath)
  const base64 = imageBuffer.toString('base64')
  const ext = path.extname(imagePath).slice(1).toLowerCase()
  const mime = ext === 'jpg' ? 'jpeg' : ext
  const dataUrl = `data:image/${mime};base64,${base64}`

  const response = await client.chat.completions.create({
    model,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        { type: 'text', text: buildVisionPrompt(options?.lang) },
      ],
    }],
  })

  return (response.choices[0]?.message?.content ?? '').trim()
}
