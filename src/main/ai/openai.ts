import OpenAI from 'openai'
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

export async function analyzeWithOpenAI(imagePath: string, apiKey: string): Promise<string> {
  const client = new OpenAI({ apiKey })

  const imageBuffer = await fs.readFile(imagePath)
  const base64 = imageBuffer.toString('base64')
  const ext = path.extname(imagePath).slice(1).toLowerCase()
  const mime = ext === 'jpg' ? 'jpeg' : ext
  const dataUrl = `data:image/${mime};base64,${base64}`

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
        { type: 'text', text: VISION_PROMPT },
      ],
    }],
  })

  return (response.choices[0]?.message?.content ?? '').trim()
}
