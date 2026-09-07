import { t, type I18nKey } from '../i18n'

// Tradutor central de erros técnicos → mensagem que o usuário entende.
//
// Regra da casa: NENHUM erro cru ("spawn EBUSY", "HTTP 429", "ECONNREFUSED")
// deve chegar na interface. Todo ponto que exibe erro passa por aqui.
//
// Cada caso devolve:
//   • message — o que aconteceu, em uma frase, sem jargão.
//   • action  — o que o usuário pode fazer, quando há algo ao alcance dele.
//   • technical — a string original, para tooltip/suporte. Nunca é o texto principal.

// Que botão a UI deve oferecer ao lado da mensagem. O texto de 'action' diz o
// que fazer; isto deixa a UI FAZER, em vez de só instruir.
//   retry    — refazer a mesma operação resolve (rede, limite, sobrecarga).
//   settings — depende de configuração (chave ausente/inválida, IA local).
//   none     — nada que um botão resolva (arquivo sumiu, conteúdo bloqueado).
export type Recovery = 'retry' | 'settings' | 'none'

export interface FriendlyError {
  message: string
  action?: string
  technical: string
  recovery: Recovery
}

// O erro cruza o IPC embrulhado: "Error invoking remote method 'x': Error: EBUSY...".
// Guardamos o texto inteiro para casar padrões, mas limpamos o que for exibido.
function rawText(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input
  if (input instanceof Error) return `${input.message} ${(input as { code?: string }).code ?? ''}`.trim()
  if (typeof input === 'object') {
    const o = input as { message?: unknown; code?: unknown; error?: unknown; status?: unknown }
    return [o.message, o.code, o.error, o.status].filter(v => v != null).join(' ')
  }
  return String(input)
}

// Remove o embrulho do IPC e prefixos "Error:" repetidos, para o tooltip ficar legível.
function cleanTechnical(raw: string): string {
  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/i, '')
    .replace(/^(Error:\s*)+/i, '')
    .trim()
}

// As regras guardam CHAVES, não texto. A tradução acontece em `friendlyError()`,
// no momento da chamada — assim nenhum ponto que exibe erro precisou mudar.
type Rule = { test: RegExp; messageKey: I18nKey; actionKey?: I18nKey; recovery: Recovery }

// ORDEM IMPORTA: do mais específico para o mais genérico. "connection", por
// exemplo, casaria com vários casos acima se viesse antes deles.
//
// Os `test` continuam casando texto CRU do sistema/SDK (inglês, mais alguns
// resquícios em português vindos do nosso próprio main) — isso não é interface
// e não muda com o idioma.
const RULES: Rule[] = [
  // ── IA local (Ollama) ────────────────────────────────────────────────────
  {
    test: /LOCAL_AI_UNAVAILABLE/i,
    recovery: 'settings',
    messageKey: 'error.localAiDown.msg',
    actionKey: 'error.localAiDown.act',
  },
  {
    test: /try pulling|no such model|model .*not found|modelo .*n[ãa]o encontrado/i,
    recovery: 'settings',
    messageKey: 'error.localModelMissing.msg',
    actionKey: 'error.localModelMissing.act',
  },

  // ── Sistema de arquivos ──────────────────────────────────────────────────
  {
    test: /\bEBUSY\b|\bETXTBSY\b|\bEPERM\b|\bEACCES\b|being used by another process/i,
    recovery: 'retry',
    messageKey: 'error.fileBusy.msg',
    actionKey: 'error.fileBusy.act',
  },
  {
    test: /\bENOSPC\b|no space left|disk full/i,
    recovery: 'retry',
    messageKey: 'error.diskFull.msg',
    actionKey: 'error.diskFull.act',
  },
  {
    test: /\bEMFILE\b|too many open files/i,
    recovery: 'none',
    messageKey: 'error.tooManyFiles.msg',
    actionKey: 'error.tooManyFiles.act',
  },
  {
    test: /\bENOENT\b|no such file/i,
    recovery: 'none',
    messageKey: 'error.fileNotFound.msg',
    actionKey: 'error.fileNotFound.act',
  },

  // ── Chave de API ─────────────────────────────────────────────────────────
  {
    test: /API key not configured|chave n[ãa]o configurada|Could not resolve authentication/i,
    recovery: 'settings',
    messageKey: 'error.noApiKey.msg',
    actionKey: 'error.noApiKey.act',
  },
  {
    test: /\b401\b|\b403\b|invalid[_ ]api[_ ]key|incorrect api key|unauthorized|forbidden|authentication/i,
    recovery: 'settings',
    messageKey: 'error.keyRejected.msg',
    actionKey: 'error.keyRejected.act',
  },
  {
    test: /insufficient[_ ]quota|billing|payment|out of credit|sem cr[ée]dito/i,
    recovery: 'none',
    messageKey: 'error.noCredits.msg',
    actionKey: 'error.noCredits.act',
  },
  {
    test: /\b429\b|rate.?limit|too many requests|quota exceeded/i,
    recovery: 'retry',
    messageKey: 'error.rateLimit.msg',
    actionKey: 'error.rateLimit.act',
  },

  // ── Provedor / rede ──────────────────────────────────────────────────────
  {
    test: /non-serverless|not available serverless/i,
    recovery: 'settings',
    messageKey: 'error.notServerless.msg',
    actionKey: 'error.notServerless.act',
  },
  {
    test: /content[_ ]policy|safety|flagged|moderation|refus/i,
    recovery: 'none',
    messageKey: 'error.contentPolicy.msg',
    actionKey: 'error.contentPolicy.act',
  },
  {
    test: /\b5\d\d\b|overloaded|bad gateway|service unavailable|internal server error/i,
    recovery: 'retry',
    messageKey: 'error.providerDown.msg',
    actionKey: 'error.providerDown.act',
  },
  {
    test: /timeout|timed out|\bETIMEDOUT\b|aborted|AbortError/i,
    recovery: 'retry',
    messageKey: 'error.timeout.msg',
    actionKey: 'error.timeout.act',
  },
  {
    test: /\bENOTFOUND\b|\bECONNREFUSED\b|\bECONNRESET\b|\bEAI_AGAIN\b|getaddrinfo|fetch failed|network|connection/i,
    recovery: 'retry',
    messageKey: 'error.offline.msg',
    actionKey: 'error.offline.act',
  },

  // ── Instalação da IA local ───────────────────────────────────────────────
  {
    // O main passou a lançar em inglês (é diagnóstico, não interface); o texto
    // antigo em português fica no padrão para não quebrar nada que ainda o gere.
    test: /Installer exited with code|Instalador saiu com c[óo]digo/i,
    recovery: 'retry',
    messageKey: 'error.installInterrupted.msg',
    actionKey: 'error.installInterrupted.act',
  },
  {
    test: /apenas no Windows|only on Windows/i,
    recovery: 'none',
    messageKey: 'error.windowsOnly.msg',
    actionKey: 'error.windowsOnly.act',
  },
  {
    test: /Download failed|Download falhou|Model pull failed/i,
    recovery: 'retry',
    messageKey: 'error.downloadFailed.msg',
    actionKey: 'error.downloadFailed.act',
  },
]

/**
 * Traduz qualquer erro para uma mensagem que o usuário entende.
 *
 * @param input    O erro (Error, string, objeto do SDK ou o que vier do IPC).
 * @param fallback Mensagem para quando nenhuma regra casar — use uma que
 *                 descreva a operação ("Não foi possível analisar a imagem.").
 */
export function friendlyError(input: unknown, fallback?: string): FriendlyError {
  const raw = rawText(input)
  const technical = cleanTechnical(raw)

  for (const rule of RULES) {
    if (rule.test.test(raw)) {
      return {
        message: t(rule.messageKey),
        action: rule.actionKey ? t(rule.actionKey) : undefined,
        technical,
        recovery: rule.recovery,
      }
    }
  }
  return {
    // `fallback` chega já traduzido de quem chamou — descreve a operação
    // específica ("Não foi possível analisar a imagem."), coisa que uma regra
    // genérica não teria como saber.
    message: fallback || t('error.fallback.msg'),
    action: t('error.fallback.act'),
    technical,
    recovery: 'retry',
  }
}

/** Versão em uma linha, para onde não cabe mensagem + ação separadas. */
export function friendlyErrorText(input: unknown, fallback?: string): string {
  const { message, action } = friendlyError(input, fallback)
  return action ? `${message} ${action}` : message
}

/**
 * O usuário cancelou? Erros de abort chegam com nomes diferentes de cada SDK
 * e embrulhados pelo IPC; o main normaliza tudo para 'ABORTED'.
 *
 * Checar SEMPRE antes de exibir erro: cancelar é uma escolha, não uma falha,
 * e não deve pintar nada de vermelho na tela.
 */
export function foiCancelado(input: unknown): boolean {
  if (!input) return false
  const txt = input instanceof Error ? input.message : String(input)
  return /ABORTED/.test(txt)
}
