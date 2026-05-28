export interface TagsByCategory {
  style: string[]
  lighting: string[]
  composition: string[]
  color: string[]
  mood: string[]
  subject: string[]
}

const STYLE = [
  'cinematic', 'hyperrealistic', 'photorealistic', 'painterly', 'anime', 'illustration',
  'digital art', 'concept art', 'oil painting', 'watercolor', 'sketch', '8k', '4k',
  'detailed', 'masterpiece', 'best quality', 'ultra detailed', 'realistic', 'fantasy',
  'sci-fi', 'gothic', 'minimalist', 'abstract', 'surreal', 'vintage', 'retro',
  'impressionist', 'photographic', 'render', 'cgi', 'unreal engine', 'octane render',
  '3d', '3d render', '3d character', '3d model', 'blender', 'zbrush', 'clay render',
  'stylized', 'cartoon', 'comic', 'manga', 'pixel art', 'low poly', 'isometric',
  'line art', 'flat design', 'graphic novel', 'noir', 'art nouveau', 'baroque',
]

const LIGHTING = [
  'golden hour', 'soft light', 'dramatic lighting', 'rim light', 'backlit', 'studio lighting',
  'natural light', 'sunset', 'sunrise', 'candlelight', 'neon lights', 'god rays', 'volumetric',
  'cinematic lighting', 'hard light', 'diffused', 'ambient', 'low key', 'high key', 'chiaroscuro',
  'moonlight', 'dusk', 'dawn', 'overcast', 'fog', 'haze', 'shadow', 'bright', 'dark lighting',
]

const COMPOSITION = [
  'close-up', 'portrait', 'wide shot', 'aerial view', 'macro', 'shallow depth of field',
  'full body', 'half body', 'bust', 'overhead', 'dutch angle', "worm's eye view",
  "bird's eye view", 'symmetrical', 'rule of thirds', 'centered', 'dynamic pose',
  'action shot', 'establishing shot', 'extreme close-up', 'medium shot', 'side view',
  'front view', 'back view', 'profile', 'standing', 'sitting', 'walking', 'running',
]

const COLOR = [
  'warm tones', 'cool tones', 'desaturated', 'vibrant', 'monochrome', 'pastel',
  'high contrast', 'low contrast', 'muted colors', 'colorful', 'black and white',
  'sepia', 'teal and orange', 'earth tones', 'neon colors', 'dark palette', 'light palette',
  // basic colors
  'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'white', 'black', 'gray',
  'grey', 'brown', 'gold', 'silver', 'cyan', 'magenta', 'navy', 'teal', 'beige', 'cream',
]

const MOOD = [
  'melancholic', 'dramatic', 'peaceful', 'ethereal', 'dark', 'whimsical', 'mysterious',
  'romantic', 'epic', 'serene', 'tense', 'joyful', 'nostalgic', 'eerie', 'majestic',
  'intimate', 'lonely', 'dreamy', 'ominous', 'hopeful', 'gloomy', 'cheerful', 'neutral',
  'calm', 'intense', 'playful', 'serious', 'elegant', 'fun', 'cozy',
]

// Words to ignore when extracting subjects
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from',
  'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'its', 'it', 'this', 'that', 'these', 'those', 'his', 'her', 'their', 'our',
  'very', 'some', 'no', 'not', 'as', 'up', 'out', 'so', 'into', 'over',
])

function normalize(s: string): string {
  return s.toLowerCase().trim()
}

function matchesKeyword(text: string, keywords: string[]): string[] {
  const found: string[] = []
  const t = normalize(text)
  for (const kw of keywords) {
    if (t.includes(normalize(kw))) found.push(kw)
  }
  return found
}

/**
 * Splits a prompt into candidate tokens whether it uses commas or natural language.
 */
function tokenizePrompt(text: string): string[] {
  const hasCommas = text.includes(',')

  if (hasCommas) {
    // Standard keyword-style prompt
    return text.split(/[,，\n]+/).map(s => s.trim()).filter(s => s.length > 1)
  }

  // Natural language: split into meaningful phrases at conjunctions/prepositions
  const phrases = text
    .split(/\b(?:wearing|holding|with|in a|in the|on a|on the|and a|and the|and|having|showing|standing|sitting|looking|facing)\b/i)
    .map(s => s.trim())
    .filter(s => s.length > 2)

  // Also include the full text as one candidate for keyword matching
  phrases.unshift(text)

  return phrases
}

export function categorizePromptText(promptText: string): TagsByCategory {
  if (!promptText?.trim()) {
    return { style: [], lighting: [], composition: [], color: [], mood: [], subject: [] }
  }

  const result: TagsByCategory = {
    style: [], lighting: [], composition: [], color: [], mood: [], subject: [],
  }

  // Match against the full text for all keyword categories
  result.style = matchesKeyword(promptText, STYLE)
  result.lighting = matchesKeyword(promptText, LIGHTING)
  result.composition = matchesKeyword(promptText, COMPOSITION)
  result.color = matchesKeyword(promptText, COLOR)
  result.mood = matchesKeyword(promptText, MOOD)

  // Build set of all matched keyword text for subject exclusion
  const allMatched = new Set([
    ...result.style, ...result.lighting, ...result.composition,
    ...result.color, ...result.mood,
  ].map(normalize))

  // Extract subjects from all tokens — inclusive, no keyword filtering
  const tokens = tokenizePrompt(promptText)
  const subjectCandidates: string[] = []
  const seenSubjects = new Set<string>()

  const addSubject = (phrase: string) => {
    // Strip leading articles/stop words
    const cleaned = phrase.replace(/^(a|an|the)\s+/i, '').trim()
    if (cleaned.length < 2) return
    const key = normalize(cleaned).slice(0, 40)
    if (!seenSubjects.has(key)) {
      seenSubjects.add(key)
      subjectCandidates.push(cleaned)
    }
  }

  for (const token of tokens) {
    if (token === promptText) continue // skip the full-text entry

    if (token.length <= 50) {
      addSubject(token)
    } else {
      // Long phrase: extract 2-3 word noun chunks skipping stop words
      const words = token.split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w.toLowerCase()))
      for (let i = 0; i < words.length; i++) {
        if (i + 1 < words.length) addSubject(words.slice(i, i + 2).join(' '))
        if (i + 2 < words.length) addSubject(words.slice(i, i + 3).join(' '))
      }
    }
  }

  // Deduplicate: remove subjects that are already covered by style/lighting/composition/mood labels
  const exactMatched = new Set([...result.style, ...result.lighting, ...result.composition, ...result.mood].map(normalize))
  result.subject = subjectCandidates
    .filter(s => !exactMatched.has(normalize(s)))
    .slice(0, 8)

  return result
}
