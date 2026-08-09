// Mapa de imagens de exemplo das tags de preset, chaveado pelo slug do nome
// (em inglês). Usado tanto no PromptPresets quanto no node de tags da imagem
// para mostrar uma prévia ao passar o mouse. Folder-agnostic: casa pelo nome
// do arquivo, então não importa em qual categoria (pasta) a imagem está.
const exampleImages = import.meta.glob('../assets/examples/**/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const EXAMPLE_BY_SLUG: Record<string, string> = {}
for (const [p, url] of Object.entries(exampleImages)) {
  EXAMPLE_BY_SLUG[p.split('/').pop()!.replace(/\.webp$/, '')] = url
}

export const slugify = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Slugs de exemplo, do mais longo pro mais curto: no match aproximado o mais
// específico ("close-up") ganha antes do mais genérico, se houver ambiguidade.
const SLUGS_BY_LEN = Object.keys(EXAMPLE_BY_SLUG).sort((a, b) => b.length - a.length)

// `needle` aparece dentro de `hay` respeitando limites de palavra (hífen),
// pra "close-up" casar em "close-up-portrait" mas "art" não casar em "smart".
const tokenContains = (hay: string, needle: string): boolean =>
  hay === needle ||
  hay.startsWith(needle + '-') ||
  hay.endsWith('-' + needle) ||
  hay.includes('-' + needle + '-')

/**
 * URL da imagem de exemplo para o valor de uma tag, ou undefined.
 * 1) match exato pelo slug; 2) match aproximado: um slug de exemplo contido
 * na tag em limite de palavra (ex.: "close-up portrait" → "close-up").
 */
export const tagExampleUrl = (value: string): string | undefined => {
  const s = slugify(value)
  if (!s) return undefined
  if (EXAMPLE_BY_SLUG[s]) return EXAMPLE_BY_SLUG[s]
  for (const cand of SLUGS_BY_LEN) {
    // ignora slugs de 1–2 caracteres pra evitar casamentos ruidosos
    if (cand.length >= 3 && tokenContains(s, cand)) return EXAMPLE_BY_SLUG[cand]
  }
  return undefined
}
