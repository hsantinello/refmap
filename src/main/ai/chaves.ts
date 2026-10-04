import { safeStorage } from 'electron'
import { settingQueries } from '../db'

// As chaves ficam salvas UMA POR PROVEDOR (apiKey_anthropic, apiKey_openai,
// apiKey_together) e continuam lá quando a pessoa troca de conexão. Quem decide
// qual delas vale agora é a setting `aiProvider` — que também pode ser 'local'.

export function decifrarChave(enc: unknown): string {
  if (!enc || typeof enc !== 'string') return ''
  try { return safeStorage.decryptString(Buffer.from(enc, 'hex')).trim() } catch { return '' }
}

// apiKey vazia = usar a IA local (Ollama).
//  • aiProvider 'local' → escolha explícita: ignora as chaves salvas.
//  • provedor ativo sem chave → cai para a chave da Anthropic ou da OpenAI, se
//    houver (comportamento antigo, mantido para quem só tem uma delas salva).
//  • chave "tgp_" é do Together em qualquer slot em que tenha sido colada.
export function resolverChaveAtiva(): { apiKey: string; effectiveProvider: string } {
  const provider = (settingQueries.get('aiProvider') as string | null) || 'anthropic'
  if (provider === 'local') return { apiKey: '', effectiveProvider: 'local' }
  let apiKey = decifrarChave(settingQueries.get(`apiKey_${provider}`))
  let effectiveProvider = provider
  if (!apiKey) {
    const aKey = decifrarChave(settingQueries.get('apiKey_anthropic'))
    const oKey = decifrarChave(settingQueries.get('apiKey_openai'))
    if (aKey) { apiKey = aKey; effectiveProvider = 'anthropic' }
    else if (oKey) { apiKey = oKey; effectiveProvider = 'openai' }
  }
  if (apiKey.startsWith('tgp_')) effectiveProvider = 'together'
  return { apiKey, effectiveProvider }
}
