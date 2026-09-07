// Caça strings em português que ainda não passaram pelo dicionário.
//
// Por que existe: com ~500 strings migradas em fases, o jeito mais fácil de
// "achar que acabou" é não ter como conferir. O TypeScript já garante que os
// dois dicionários tenham as MESMAS chaves — o que ele não vê é o texto que
// nunca virou chave e continua cravado no JSX.
//
// Dois modos:
//   npm run check:i18n          → relatório de progresso (nunca falha)
//   npm run check:i18n -- --ci  → falha se um arquivo JÁ MIGRADO regrediu
//
// Conforme cada fase termina, acrescente os arquivos em MIGRADOS. A partir daí
// eles são obrigados a ficar limpos.

import fs from 'fs'
import path from 'path'

const RAIZ = path.resolve(__dirname, '..')

// Arquivos que já passaram pela migração — precisam ficar em zero.
const MIGRADOS = [
  'src/renderer/App.tsx',
  'src/renderer/store/index.ts',
  'src/renderer/components/TopBar/index.tsx',
  'src/renderer/components/Settings/index.tsx',
  'src/renderer/components/Onboarding/index.tsx',
  'src/renderer/components/Auth/index.tsx',
  'src/renderer/lib/friendlyError.ts',
  'src/main/i18n.ts',
  'src/main/updater.ts',
  'src/main/ai/localInstall.ts',
  'src/main/video/extractScenes.ts',
  'src/main/ipc/handlers.ts',
  'src/renderer/components/About/index.tsx',
  'src/renderer/components/ConfirmDialog/index.tsx',
  'src/renderer/components/LocalInstallBanner.tsx',
  'src/renderer/components/UpdateBanner.tsx',
  'src/renderer/components/UpdateBell/index.tsx',
  'src/renderer/components/PromptHistoryButton/index.tsx',
  'src/renderer/components/VideoSceneImport/index.tsx',
  'src/renderer/components/VideoScenesViewer/index.tsx',
  'src/renderer/components/VideoTrimModal/index.tsx',
  'src/renderer/components/PromptBuilder/index.tsx',
  'src/renderer/components/PixiCanvas/index.tsx',
  'src/renderer/components/PromptPresets/index.tsx',
]

// Conteúdo que é inglês DE PROPÓSITO e não deve virar chave de tradução:
// vocabulário de prompt (vai para o modelo, e já tem tradução em runtime via
// `tags:translate`), system prompts das APIs e listas de classificação.
const IGNORADOS = [
  'src/shared/i18n/',
  'src/renderer/lib/tagExamples.ts',
  'src/main/ai/model-prompts.ts',
  'src/main/ai/visionPrompt.ts',
  'src/main/metadata/categorizer.ts',
]

const ACENTOS = /[áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ]/

// Acento sozinho não basta: "Salvar", "Limpar", "Novo Canvas" e "Copiar" passam
// batido. Estas palavras não existem em inglês, então denunciam o português que
// escapou do acento. Lista conservadora de propósito — falso positivo aqui é
// barulho, mas falso NEGATIVO é uma string que nunca vai ser traduzida.
const PALAVRAS_PT = new RegExp(
  '\\b(' + [
    'para', 'sem', 'uma', 'umas', 'uns', 'que', 'por', 'pelo', 'pela', 'dos', 'das',
    'seu', 'sua', 'seus', 'suas', 'isso', 'isto', 'aqui', 'agora', 'depois', 'antes',
    'ainda', 'nunca', 'sempre', 'todos', 'todas', 'nenhum', 'nenhuma',
    'salvar', 'salvo', 'apagar', 'abrir', 'fechar', 'copiar', 'copiado', 'colar',
    'adicionar', 'remover', 'buscar', 'procurar', 'limpar', 'desfazer', 'refazer',
    'novo', 'nova', 'erro', 'falhou', 'pronto', 'tente', 'tentar', 'carregando',
    'salvando', 'enviando', 'imagem', 'imagens', 'arquivo', 'arquivos',
    'cena', 'cenas', 'tamanho', 'cores', 'ordem', 'nome', 'senha', 'entrar', 'conta',
    'clique', 'clicar', 'arraste', 'arrastar', 'selecione', 'selecionar',
    'escolha', 'escolher', 'ajuda', 'sair', 'voltar', 'proximo', 'anterior', 'grupo',
  ].join('|') + ')\\b',
  'i',
)

// Classes do Tailwind viram falso positivo em massa ("min-w-0 ... para" nunca
// acontece, mas o volume de literais com espaço é enorme). Nenhuma delas carrega
// texto de interface, então saem antes da análise.
const TAILWIND = /(^|\s)(flex|grid|block|inline|hidden|absolute|relative|fixed|sticky|truncate|border|rounded|shadow|transition|animate|cursor|select|pointer|overflow|whitespace|outline|ring|fill|stroke|origin|scale|translate|rotate|backdrop|shrink|grow|basis-|w-|h-|p-|m-|px-|py-|pt-|pb-|pl-|pr-|mx-|my-|mt-|mb-|ml-|mr-|gap-|text-|bg-|min-|max-|top-|left-|right-|bottom-|z-|font-|leading-|tracking-|space-|items-|justify-|self-|hover:|focus:|active:|disabled:|group-)/

function listar(dir: string, saida: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) listar(p, saida)
    else if (/\.(ts|tsx)$/.test(e.name)) saida.push(p)
  }
  return saida
}

const paraPosix = (p: string) => p.split(path.sep).join('/')

/** Remove comentários antes de procurar — comentário em português é bem-vindo,
 *  o codebase inteiro é escrito assim. O alvo é só o texto que chega na tela.
 *  Troca por espaços em vez de apagar, para os números de linha não andarem. */
function semComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1)
}

function ehPortugues(texto: string): boolean {
  if (texto.length < 3) return false
  if (TAILWIND.test(texto)) return false
  return ACENTOS.test(texto) || PALAVRAS_PT.test(texto)
}

type Achado = { linha: number; texto: string }

/** Linhas entre `i18n-ignore-start` e `i18n-ignore-end`.
 *
 *  Existe para o português que é DADO, não interface — o caso real é
 *  `handlers.ts`, onde um system prompt em inglês traz exemplos em português de
 *  propósito, para o modelo reconhecer instruções de edição nessa língua.
 *  Calculado no texto cru, antes de os comentários serem removidos. */
function faixasIgnoradas(bruto: string): Set<number> {
  const ignoradas = new Set<number>()
  let dentro = false
  bruto.split('\n').forEach((linha, i) => {
    if (/i18n-ignore-start/.test(linha)) dentro = true
    if (dentro) ignoradas.add(i)
    if (/i18n-ignore-end/.test(linha)) dentro = false
  })
  return ignoradas
}

function varrer(arquivo: string): Achado[] {
  const bruto = fs.readFileSync(arquivo, 'utf8')
  const ignoradas = faixasIgnoradas(bruto)
  const limpo = semComentarios(bruto)
  const achados: Achado[] = []
  const vistos = new Set<string>()

  limpo.split('\n').forEach((linha, i) => {
    if (ignoradas.has(i)) return

    // `console.error('[login] verifyOtp falhou:', e)` é log de desenvolvedor —
    // fica em português de propósito e não deve entrar no dicionário.
    if (/\bconsole\.\w+\(/.test(linha)) return

    const candidatos = [
      // Literais entre aspas simples, duplas ou crases.
      ...linha.matchAll(/'([^'\\\n]{3,200})'|"([^"\\\n]{3,200})"|`([^`\\\n]{3,200})`/g),
      // Texto solto de JSX na mesma linha: >Salvar Canvas<
      ...linha.matchAll(/>\s*([^<>{}\n]{3,200}?)\s*</g),
    ]
    for (const m of candidatos) {
      const texto = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim()
      if (!ehPortugues(texto) || vistos.has(texto)) continue
      vistos.add(texto)
      achados.push({ linha: i + 1, texto })
    }
  })

  // Segunda passada, no arquivo INTEIRO: texto de JSX que ocupa a própria linha,
  // com o `>` numa linha e o `<` em outra. A varredura linha a linha acima é
  // cega para isso — foi assim que um "Nenhum" solto passou batido.
  const linhas = limpo.split('\n')
  for (const m of limpo.matchAll(/>\s*\n\s*([^<>{}\n]{3,200}?)\s*\n\s*</g)) {
    const texto = m[1].trim()
    if (!ehPortugues(texto) || vistos.has(texto)) continue
    // Índice do texto dentro do arquivo → número da linha.
    const ate = limpo.slice(0, m.index! + m[0].indexOf(texto))
    const linha = ate.split('\n').length
    if (ignoradas.has(linha - 1)) continue
    if (/\bconsole\.\w+\(/.test(linhas[linha - 1] ?? '')) continue
    vistos.add(texto)
    achados.push({ linha, texto })
  }

  return achados.sort((a, b) => a.linha - b.linha)
}

const ci = process.argv.includes('--ci')
const arquivos = [
  ...listar(path.join(RAIZ, 'src/renderer')),
  ...listar(path.join(RAIZ, 'src/main')),
  ...listar(path.join(RAIZ, 'src/preload')),
].filter(f => !IGNORADOS.some(ig => paraPosix(path.relative(RAIZ, f)).startsWith(ig)))

let totalPendente = 0
let regressoes = 0
const linhas: string[] = []

for (const arquivo of arquivos) {
  const rel = paraPosix(path.relative(RAIZ, arquivo))
  const achados = varrer(arquivo)
  if (achados.length === 0) continue

  if (MIGRADOS.includes(rel)) {
    regressoes += achados.length
    linhas.push(`\n  REGRESSÃO  ${rel} — ${achados.length} string(s) fora do dicionário:`)
    for (const a of achados.slice(0, 10)) linhas.push(`      ${rel}:${a.linha}  ${a.texto}`)
  } else {
    totalPendente += achados.length
    linhas.push(`  pendente  ${String(achados.length).padStart(4)}  ${rel}`)
  }
}

console.log(linhas.join('\n'))
console.log(`\n  ${MIGRADOS.length} arquivo(s) migrado(s) · ${totalPendente} string(s) ainda por migrar`)

if (regressoes > 0) {
  console.error(`\n  FALHOU: ${regressoes} string(s) em português em arquivo já migrado.`)
  process.exit(1)
}
if (ci) console.log('  OK — nenhum arquivo migrado regrediu.\n')
