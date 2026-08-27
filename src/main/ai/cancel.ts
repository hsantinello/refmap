// Registro das operações de IA em andamento.
//
// Antes, uma otimização ou análise disparada não tinha volta: a UI ficava com o
// spinner girando até o fim, mesmo que o usuário já soubesse que escolheu o
// modelo errado. Aqui cada chamada que recebe um requestId guarda um
// AbortController, e 'ai:cancel' aborta a requisição HTTP de verdade — o SDK
// devolve na hora e a conexão morre, em vez de a gente só ignorar o resultado.

const emAndamento = new Map<string, AbortController>()

// Erro único que atravessa o IPC. A UI reconhece por este texto e trata como
// "o usuário desistiu" — nunca como falha para exibir em vermelho.
export const ABORTED = 'ABORTED'

// Abre uma operação cancelável. Sem id, devolve undefined e o SDK roda como
// antes (chamadas internas que a UI não controla continuam funcionando).
export function abrirOperacao(id?: string): AbortSignal | undefined {
  if (!id) return undefined
  // Mesmo id chegando de novo = a UI redisparou sem esperar a anterior.
  // A antiga vira lixo: aborta antes de sobrescrever, senão ela ficaria
  // pendurada no Map sem ninguém para cancelá-la.
  emAndamento.get(id)?.abort()
  const ctrl = new AbortController()
  emAndamento.set(id, ctrl)
  return ctrl.signal
}

// Sempre no finally: sem isso o Map cresce sem parar a cada prompt otimizado.
export function fecharOperacao(id?: string): void {
  if (id) emAndamento.delete(id)
}

// Retorna false quando não há nada com esse id — a operação já terminou entre
// o clique e o IPC chegar aqui. Não é erro, é corrida normal.
export function cancelarOperacao(id: string): boolean {
  const ctrl = emAndamento.get(id)
  if (!ctrl) return false
  ctrl.abort()
  emAndamento.delete(id)
  return true
}

// Foi ESTE cancelamento que derrubou a chamada?
//
// Deliberadamente NÃO olhamos o texto do erro: o timeout interno dos SDKs
// também aborta um controller e produz mensagens com "abort", e confundir os
// dois faria uma falha real sumir em silêncio — o pior desfecho possível, com
// o usuário olhando para um spinner que parou sem dizer nada. O estado do
// signal que nós criamos é a única fonte confiável.
export function foiCancelado(signal: AbortSignal | undefined, err: unknown): boolean {
  if (signal?.aborted) return true
  // Sem signal (chamada não cancelável) só resta o nome do erro, e apenas o
  // nome — nunca a mensagem, que é ambígua.
  return ((err as { name?: string })?.name ?? '') === 'APIUserAbortError'
}
