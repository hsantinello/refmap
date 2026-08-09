// Estimador adaptativo de tempo: guarda a duração das últimas execuções de cada
// operação e devolve a média. Como o tempo varia muito (local vs nuvem), a média
// móvel das últimas rodadas se ajusta sozinha ao cenário atual do usuário.

const KEY = 'aiDurations'
const MAX = 6 // quantas amostras manter por operação

type Store = Record<string, number[]>
let cache: Store | null = null

async function load(): Promise<Store> {
  if (cache) return cache
  try {
    const raw = await window.api.getSetting(KEY)
    cache = raw ? JSON.parse(raw) : {}
  } catch { cache = {} }
  return cache!
}

// Registra a duração (ms) de uma operação concluída.
export async function recordDuration(op: string, ms: number): Promise<void> {
  if (!(ms > 0) || ms > 10 * 60_000) return // ignora lixo (0 ou > 10min)
  const s = await load()
  s[op] = (s[op] ?? []).concat(Math.round(ms)).slice(-MAX)
  window.api.setSetting(KEY, JSON.stringify(s)).catch(() => {})
}

// Estimativa em SEGUNDOS (média das amostras) ou null se ainda não há histórico.
export async function getEstimateSeconds(op: string): Promise<number | null> {
  const s = await load()
  const arr = s[op]
  if (!arr || arr.length === 0) return null
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length
  return Math.max(1, Math.round(avg / 1000))
}
