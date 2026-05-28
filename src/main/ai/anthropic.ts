import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs/promises'
import path from 'path'

const VISION_PROMPT = `Describe this AI-generated image as structured prompt chunks using this exact format:
{main subject}[modifier][modifier][modifier]...

Rules:
- Use {} for the main subject (who or what is the focus)
- Use [] for each modifier: appearance, clothing, action, setting, lighting, style, mood, color palette
- Create 6-12 total chunks, each a short phrase
- Write in English, concise and prompt-ready
- Return ONLY the formatted string, nothing else

Example: {a young woman}[with auburn hair][wearing a silk dress][standing in a sunlit garden][golden hour lighting][impressionist style][warm earthy palette][dreamy atmosphere]`

export async function analyzeWithAnthropic(imagePath: string, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey })

  const imageBuffer = await fs.readFile(imagePath)
  const base64 = imageBuffer.toString('base64')
  const ext = path.extname(imagePath).slice(1).toLowerCase()
  const mediaType = (ext === 'jpg' ? 'image/jpeg' : `image/${ext}`) as
    'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: VISION_PROMPT },
      ],
    }],
  })

  return response.content[0].type === 'text' ? response.content[0].text.trim() : ''
}
