// Provedores de nuvem que guardam chave própria (apiKey_<id> no main). A setting
// `aiProvider` aponta para um deles — ou para 'local' (IA local, Ollama).
export type Provedor = 'anthropic' | 'openai' | 'together'
export const PROVEDORES: Provedor[] = ['anthropic', 'openai', 'together']

// Nomes de marca: iguais nos dois idiomas.
export const NOME_PROVEDOR: Record<Provedor, string> = {
  anthropic: 'Claude',
  openai: 'ChatGPT',
  together: 'Together AI',
}

export function nomeProvedor(id: string): string {
  return NOME_PROVEDOR[id as Provedor] ?? id
}
