import OpenAI from 'openai'
import fs from 'fs/promises'
import path from 'path'

function buildVisionPrompt(lang: 'en' | 'pt' = 'en'): string {
  const langRule = lang === 'pt'
    ? '- Write every chunk in Brazilian Portuguese'
    : '- Write in English'
  return `Analyze this image and describe it as precise, prompt-ready chunks for image generation.

Format: {main subject}[modifier][modifier]...
Put the MAIN SUBJECT inside {curly braces} and lead with it. Everything else goes in [brackets] AFTER the subject.

Describe in THIS order — the subject first and most carefully:
1. SUBJECT — identify it PRECISELY: exactly what/who it is, and how many. Name it concretely (species, type, breed, object kind) and capture the traits that define THIS subject (pose, expression, key features). If there are several subjects, name each precisely, but state a shared trait only once — never repeat the same modifier for each.
2. SETTING — environment, location, background elements, time of day.
3. LIGHTING — type, direction, quality, color temperature.
4. COMPOSITION — framing, angle, perspective, depth of field.
5. COLOR — dominant palette, grading, saturation.
6. STYLE — medium and rendering (photography, digital art, painting, 3D…), technique.
7. MOOD — emotional tone, atmosphere.

Rules:
- PRECISION over quantity. Every chunk must be concrete and useful in a prompt. Cut vague filler like "small size", "front-facing pose", "no accessories", "beautiful", "nice".
- The subject is the priority: get WHAT it is exactly right before describing anything else.
- For every living being or key object, ALSO add a separate chunk with its plain generic noun in the target language (e.g. besides "shih tzu puppy" add "dog"; besides "tabby kitten" add "cat"; besides "sports car" add "car") so it stays searchable by the common word.
- 12-20 chunks total, each a short specific phrase. Fewer precise chunks beat many loose ones. No duplicates.
${langRule}
- If the image contains nudity, explicit sexual content, or adult-only material, include [nsfw] as one of the chunks
- Return ONLY the formatted string, nothing else

Example: {a shih tzu puppy flanked by two tabby kittens}[dog][cat][the three standing upright on hind legs][open mouths with tongues out][playful energetic expressions][cozy living room background][soft warm lamp light from the left][shallow depth of field][eye-level frontal shot][warm cream and brown palette][photorealistic pet photography][cheerful lighthearted mood]`
}

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
