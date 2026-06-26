import Anthropic from '@anthropic-ai/sdk'
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

export async function analyzeWithAnthropic(imagePath: string, apiKey: string, lang: 'en' | 'pt' = 'en'): Promise<string> {
  const client = new Anthropic({ apiKey })

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

  return response.content[0].type === 'text' ? response.content[0].text.trim() : ''
}
