// Cliente Anthropic com o cabeçalho de workspace, quando o usuário configurou um.
//
// Desde 2026 a API recusa chaves que não estão ligadas a um workspace ("This API
// key is not scoped to a workspace, so this request must include the
// anthropic-workspace-id header"). A resposta 400 NÃO traz o ID, então não há
// como descobrir sozinho: o usuário informa o ID (wrkspc_…) nas Configurações ou
// cria uma chave já ligada a um workspace no console. Todo `new Anthropic(...)`
// do main passa por aqui para o cabeçalho valer em análise, otimização,
// tradução e animação.

import Anthropic from '@anthropic-ai/sdk'
import { settingQueries } from '../db'

export const SETTING_WORKSPACE = 'anthropicWorkspaceId'

export function workspaceAnthropic(): string {
  return String(settingQueries.get(SETTING_WORKSPACE) ?? '').trim()
}

export function criarAnthropic(apiKey: string, opcoes: { timeout?: number; maxRetries?: number } = {}): Anthropic {
  const ws = workspaceAnthropic()
  return new Anthropic({
    apiKey,
    ...opcoes,
    ...(ws ? { defaultHeaders: { 'anthropic-workspace-id': ws } } : {}),
  })
}
