// Tradutor central de erros técnicos → mensagem que o usuário entende.
//
// Regra da casa: NENHUM erro cru ("spawn EBUSY", "HTTP 429", "ECONNREFUSED")
// deve chegar na interface. Todo ponto que exibe erro passa por aqui.
//
// Cada caso devolve:
//   • message — o que aconteceu, em uma frase, sem jargão.
//   • action  — o que o usuário pode fazer, quando há algo ao alcance dele.
//   • technical — a string original, para tooltip/suporte. Nunca é o texto principal.

export interface FriendlyError {
  message: string
  action?: string
  technical: string
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

type Rule = { test: RegExp; message: string; action?: string }

// ORDEM IMPORTA: do mais específico para o mais genérico. "connection", por
// exemplo, casaria com vários casos acima se viesse antes deles.
const RULES: Rule[] = [
  // ── IA local (Ollama) ────────────────────────────────────────────────────
  {
    test: /LOCAL_AI_UNAVAILABLE/i,
    message: 'A IA local não está rodando no seu computador.',
    action: 'Abra as Configurações e clique em "Baixar IA Local" — ou conecte uma chave de API para usar a IA na nuvem.',
  },
  {
    test: /try pulling|no such model|model .*not found|modelo .*n[ãa]o encontrado/i,
    message: 'O modelo da IA local ainda não terminou de baixar.',
    action: 'Abra as Configurações e clique em "Baixar IA Local" para concluir o download.',
  },

  // ── Sistema de arquivos ──────────────────────────────────────────────────
  {
    test: /\bEBUSY\b|\bETXTBSY\b|\bEPERM\b|\bEACCES\b|being used by another process/i,
    message: 'Outro programa do seu computador está bloqueando o arquivo — normalmente o antivírus, que verifica downloads novos.',
    action: 'Aguarde alguns segundos e clique em "Tentar de novo".',
  },
  {
    test: /\bENOSPC\b|no space left|disk full/i,
    message: 'Não há espaço em disco suficiente para concluir.',
    action: 'Libere espaço no disco e tente de novo.',
  },
  {
    test: /\bEMFILE\b|too many open files/i,
    message: 'O computador atingiu o limite de arquivos abertos ao mesmo tempo.',
    action: 'Feche e reabra o app.',
  },
  {
    test: /\bENOENT\b|no such file/i,
    message: 'O arquivo não foi encontrado onde o app esperava.',
    action: 'Ele pode ter sido movido, renomeado ou apagado. Importe a imagem de novo.',
  },

  // ── Chave de API ─────────────────────────────────────────────────────────
  {
    test: /API key not configured|chave n[ãa]o configurada|Could not resolve authentication/i,
    message: 'Nenhuma chave de API está configurada.',
    action: 'Abra as Configurações para conectar uma chave — ou baixe a IA local, que roda no seu PC sem custo.',
  },
  {
    test: /\b401\b|\b403\b|invalid[_ ]api[_ ]key|incorrect api key|unauthorized|forbidden|authentication/i,
    message: 'O provedor de IA recusou a sua chave de API.',
    action: 'Confira em Configurações se a chave está correta e ainda ativa no painel do provedor.',
  },
  {
    test: /insufficient[_ ]quota|billing|payment|out of credit|sem cr[ée]dito/i,
    message: 'A sua conta no provedor de IA está sem créditos.',
    action: 'Adicione créditos no painel do provedor e tente de novo.',
  },
  {
    test: /\b429\b|rate.?limit|too many requests|quota exceeded/i,
    message: 'Você atingiu o limite de uso do provedor de IA.',
    action: 'Aguarde cerca de um minuto e tente de novo.',
  },

  // ── Provedor / rede ──────────────────────────────────────────────────────
  {
    test: /non-serverless|not available serverless/i,
    message: 'Esse modelo não está disponível no plano da sua conta no provedor.',
    action: 'Troque de provedor de IA nas Configurações, ou use a IA local.',
  },
  {
    test: /content[_ ]policy|safety|flagged|moderation|refus/i,
    message: 'O provedor de IA recusou o conteúdo por política de uso.',
    action: 'Ajuste o texto, ou use a IA local — ela roda no seu PC e não tem esse filtro.',
  },
  {
    test: /\b5\d\d\b|overloaded|bad gateway|service unavailable|internal server error/i,
    message: 'O provedor de IA está instável neste momento.',
    action: 'Tente de novo em alguns instantes.',
  },
  {
    test: /timeout|timed out|\bETIMEDOUT\b|aborted|AbortError/i,
    message: 'A operação demorou mais do que o esperado e foi interrompida.',
    action: 'Tente de novo. Se continuar, verifique a sua conexão com a internet.',
  },
  {
    test: /\bENOTFOUND\b|\bECONNREFUSED\b|\bECONNRESET\b|\bEAI_AGAIN\b|getaddrinfo|fetch failed|network|connection/i,
    message: 'Não foi possível conectar à internet.',
    action: 'Verifique a sua conexão e tente de novo.',
  },

  // ── Instalação da IA local ───────────────────────────────────────────────
  {
    test: /Instalador saiu com c[óo]digo/i,
    message: 'A instalação da IA local foi interrompida antes de terminar.',
    action: 'Clique em "Tentar de novo". Se repetir, instale o Ollama manualmente pelo site ollama.com.',
  },
  {
    test: /apenas no Windows|only on Windows/i,
    message: 'A instalação automática da IA local só está disponível no Windows por enquanto.',
    action: 'No Mac, instale o Ollama pelo site ollama.com e o app o reconhece sozinho.',
  },
  {
    test: /Download falhou/i,
    message: 'O download não foi concluído.',
    action: 'Verifique a sua conexão e clique em "Tentar de novo".',
  },
]

const FALLBACK_MESSAGE = 'Algo deu errado nesta operação.'
const FALLBACK_ACTION = 'Tente de novo. Se continuar acontecendo, feche e reabra o app.'

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
      return { message: rule.message, action: rule.action, technical }
    }
  }
  return {
    message: fallback || FALLBACK_MESSAGE,
    action: FALLBACK_ACTION,
    technical,
  }
}

/** Versão em uma linha, para onde não cabe mensagem + ação separadas. */
export function friendlyErrorText(input: unknown, fallback?: string): string {
  const { message, action } = friendlyError(input, fallback)
  return action ? `${message} ${action}` : message
}
