// Instrução ÚNICA de análise de imagem, compartilhada por TODOS os provedores
// (Anthropic, OpenAI, Together e IA local/Ollama). Assim a regra é a mesma em todos.
//
// Regra principal (pedido do usuário): a IA deve descrever SOMENTE o que está
// visível na imagem — sem inventar, supor, deduzir nem embelezar nada.
export function buildVisionPrompt(lang: 'en' | 'pt' = 'en'): string {
  const langRule = lang === 'pt'
    ? '- Write every chunk in Brazilian Portuguese'
    : '- Write in English'
  return `Your ONLY task is to describe what is ACTUALLY VISIBLE in this image — an accurate visual report of what is in front of you.

DESCRIBE ONLY WHAT YOU SEE — this is the highest-priority rule, above everything else:
- Do NOT invent, guess, assume, infer, imagine or embellish anything that is not directly visible.
- No backstory, no intentions, no narrative, no off-frame context, no "probably"/"seems like"/"appears to be".
- Do NOT state a brand, model, name, place, date or price unless it is plainly readable or unmistakable in the image itself.
- Do NOT attribute emotions, mood or atmosphere that are not clearly shown by what is visible (expression, posture, lighting).
- If something is unclear, occluded or uncertain, LEAVE IT OUT. Never fill gaps with plausible-sounding guesses.
- Describe the actual medium as seen (photo, 3D render, painting, drawing) — do not assume it is a real scene.

Then describe it as precise, prompt-ready chunks for image generation.

Format: {main subject}[modifier][modifier]...
Put the MAIN SUBJECT inside {curly braces} and lead with it. Everything else goes in [brackets] AFTER the subject.

Cover, in this order (only what is clearly visible): subject → setting/time → lighting → composition/framing → color → style/medium → mood.

Rules:
- PRECISION over quantity. Every chunk must add NEW information grounded in what is visible. Cut vague filler ("beautiful", "nice", "small size", "front-facing pose", "no accessories").
- NO REDUNDANCY is the top priority: never say the same thing in different words. Name the subject ONCE, in its single most precise form, and do NOT also add looser synonyms for it — e.g. if you wrote "white Nissan 200SX", do NOT add "Japanese sports car", "sports car" or "automobile"; pick the one best name. The same applies to setting, lighting and color: one chunk per idea, never two or three near-identical ones.
- MERGE related details into a single chunk instead of splitting — e.g. "soft cool diffused lighting" as ONE chunk, not "ambient lighting" + "soft diffused light" + "cool color temperature" + "slightly blue tint".
- You MAY add at most ONE plain generic word for the MAIN subject only, for searchability (e.g. besides "shih tzu puppy" add "dog"; besides "Nissan 200SX" add "car"). Never add generic nouns for secondary objects.
- 8-14 chunks total, each a short specific phrase. Fewer, sharper chunks beat many overlapping ones. No duplicates.
${langRule}
- If the image contains nudity, explicit sexual content, or adult-only material, include [nsfw] as one of the chunks
- Return ONLY the formatted string, nothing else

Example: {a shih tzu puppy flanked by two tabby kittens}[dog][the three standing upright on hind legs, mouths open][playful energetic expressions][cozy living room with soft warm lamp light from the left][shallow depth of field, eye-level frontal shot][warm cream and brown palette][photorealistic pet photography][cheerful lighthearted mood]`
}
