import OpenAI from 'openai'
import { settingQueries } from '../db'

// IA local via Ollama (endpoint compatível com a API da OpenAI). É o fallback
// automático usado sempre que NÃO há chave de API de nuvem configurada.
//
// Esquema HÍBRIDO (dois modelos, cada um no que é melhor):
//  • VISÃO  → gemma3:4b (multimodal, oficial): analisa imagens e gera tags. Carrega
//    de forma confiável no Ollama; é censurado (limitação em imagens explícitas).
//  • TEXTO  → dolphin-mistral (sem censura): otimiza/traduz prompts e permite +18.
export const OLLAMA_DEFAULT_URL   = 'http://localhost:11434/v1'
export const OLLAMA_VISION_MODEL  = 'gemma3:4b'
export const OLLAMA_TEXT_MODEL    = 'dolphin-mistral'
// Compat: código antigo referencia OLLAMA_DEFAULT_MODEL (= modelo de visão).
export const OLLAMA_DEFAULT_MODEL = OLLAMA_VISION_MODEL

// Config do modelo de VISÃO (análise de imagem → tags). Também usado pelo status.
export function getLocalConfig(): { baseURL: string; model: string; apiKey: string } {
  const baseURL = (settingQueries.get('ollamaBaseUrl') as string | null)?.trim() || OLLAMA_DEFAULT_URL
  const model   = (settingQueries.get('ollamaVisionModel') as string | null)?.trim()
    || (settingQueries.get('ollamaModel') as string | null)?.trim() || OLLAMA_VISION_MODEL
  // O Ollama ignora a chave, mas o SDK exige uma string não-vazia.
  return { baseURL, model, apiKey: 'ollama' }
}

// Config do modelo de TEXTO (otimizar/traduzir prompts, sem censura → +18).
export function getLocalTextConfig(): { baseURL: string; model: string; apiKey: string } {
  const baseURL = (settingQueries.get('ollamaBaseUrl') as string | null)?.trim() || OLLAMA_DEFAULT_URL
  const model   = (settingQueries.get('ollamaTextModel') as string | null)?.trim() || OLLAMA_TEXT_MODEL
  return { baseURL, model, apiKey: 'ollama' }
}

// Falha de conexão = Ollama não instalado / não está rodando. Convertemos num
// erro reconhecível pela UI em vez de vazar "ECONNREFUSED"/"fetch failed" cru.
export function isConnectionError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return msg.includes('econnrefused') || msg.includes('fetch failed') ||
    msg.includes('econnreset') || msg.includes('enotfound') ||
    msg.includes('network') || msg.includes('connection')
}

// Modelo não baixado ainda (ex.: após trocar de modelo). O Ollama responde 404
// "model ... not found, try pulling it first". Tratamos como IA local indisponível
// pra a UI orientar o download em vez de vazar o erro cru.
export function isModelNotFound(err: unknown): boolean {
  const status = (err as { status?: number })?.status
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return status === 404 || msg.includes('not found') || msg.includes('try pulling') ||
    msg.includes('no such model') || msg.includes('model not found')
}

// Qualquer falha do local que a UI deve tratar como "IA local indisponível"
// (Ollama fora do ar OU modelo ainda não baixado) → orienta instalar/baixar.
export function isLocalUnavailable(err: unknown): boolean {
  return isConnectionError(err) || isModelNotFound(err)
}

// Mensagem-sentinela que o renderer detecta para mostrar o aviso amigável.
export const LOCAL_AI_UNAVAILABLE = 'LOCAL_AI_UNAVAILABLE'

// Executa uma conversa de texto no Ollama local. Erros de conexão viram
// LOCAL_AI_UNAVAILABLE (UI orienta a instalar/abrir o Ollama ou configurar API).
export async function localChat(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<string> {
  const { baseURL, model, apiKey } = getLocalTextConfig()
  const client = new OpenAI({ apiKey, baseURL, timeout: 120_000, maxRetries: 0 })
  try {
    const completion = await client.chat.completions.create({ model, messages })
    return completion.choices[0]?.message?.content?.trim() ?? ''
  } catch (err) {
    if (isLocalUnavailable(err)) throw new Error(LOCAL_AI_UNAVAILABLE)
    throw err
  }
}
