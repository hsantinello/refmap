// Regras de segurança do processo main.
//
// Modelo de ameaça: o que roda na janela do app é confiável; QUALQUER outra coisa
// que consiga ser carregada nela não é. O caso real que motivou isto: soltar um
// arquivo .html ou um link fora do canvas fazia a janela navegar até ele (é o
// padrão do Chromium), e a página nova recebia o `window.api` do preload inteiro
// — incluindo a função que devolvia a chave de API descriptografada.
//
// Três camadas, cada uma fecha o buraco sozinha:
//   1. a janela não navega nem abre janelas fora do app;
//   2. todo canal IPC confere se quem chamou é o app;
//   3. os canais sensíveis não entregam o que não precisam (chave mascarada,
//      só links https/mailto, só arquivos .refmap).

import { ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import path from 'path'

let urlDoApp: URL | null = null

/** Chamado uma vez, antes de a janela carregar. Em dev é o servidor do Vite; no
 *  app empacotado é o `index.html` do renderer. */
export function definirUrlDoApp(url: string): void {
  urlDoApp = new URL(url)
}

/** A URL pertence ao app? Ignora query e hash, que não mudam o documento. */
export function ehUrlDoApp(url: string, base: URL | null = urlDoApp): boolean {
  if (!base) return false
  let alvo: URL
  try { alvo = new URL(url) } catch { return false }

  if (base.protocol === 'file:') {
    if (alvo.protocol !== 'file:') return false
    // No Windows o mesmo arquivo pode chegar com a letra do drive em caixa
    // diferente (E: / e:). Comparar decodificado e sem caixa.
    const norm = (u: URL) => decodeURIComponent(u.pathname).replace(/\\/g, '/').toLowerCase()
    return norm(alvo) === norm(base)
  }
  // Dev: qualquer rota do próprio servidor do Vite.
  return alvo.origin === base.origin
}

/** Links que podem sair do app para o navegador / cliente de e-mail. Tudo o mais
 *  (file:, protocolos de sistema como ms-msdt:, javascript:) é recusado — abrir
 *  um desses é o caminho clássico de execução de código em apps Electron. */
export function urlExternaPermitida(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'mailto:'
  } catch {
    return false
  }
}

/** Abre um link externo só se ele passar na regra acima. */
export async function abrirExterno(url: string): Promise<boolean> {
  if (!urlExternaPermitida(url)) {
    console.warn('[seguranca] link externo recusado:', url.slice(0, 120))
    return false
  }
  await shell.openExternal(url)
  return true
}

/** Blinda um webContents: sem navegação para fora do app, sem janelas novas,
 *  sem <webview>. Aplicado a todo webContents criado, não só à janela principal. */
export function blindarWebContents(contents: WebContents): void {
  contents.on('will-navigate', (evento, url) => {
    if (ehUrlDoApp(url)) return
    evento.preventDefault()
    console.warn('[seguranca] navegacao bloqueada:', url.slice(0, 120))
  })

  // window.open / target=_blank: nunca vira janela do Electron (ela herdaria o
  // preload). Link permitido vai para o navegador do sistema.
  contents.setWindowOpenHandler(({ url }) => {
    void abrirExterno(url)
    return { action: 'deny' }
  })

  contents.on('will-attach-webview', evento => evento.preventDefault())
}

/** O pedido IPC veio do app — frame principal, carregado da URL do app? */
export function remetenteDoApp(evento: IpcMainInvokeEvent): boolean {
  const frame = evento.senderFrame
  if (!frame || frame.parent !== null) return false
  return ehUrlDoApp(frame.url)
}

/** `ipcMain.handle` que recusa chamadas de fora do app.
 *
 *  Substitui o `ipcMain.handle` em todos os registros. Mesmo que a camada de
 *  navegação falhe um dia, uma página estranha na janela não consegue usar
 *  nenhum canal. */
export function handleSeguro<A extends unknown[], R>(
  canal: string,
  fn: (evento: IpcMainInvokeEvent, ...args: A) => R,
): void {
  ipcMain.handle(canal, (evento, ...args) => {
    if (!remetenteDoApp(evento)) {
      console.warn(`[seguranca] IPC "${canal}" recusado de ${evento.senderFrame?.url ?? '(frame desconhecido)'}`)
      throw new Error('IPC_BLOQUEADO')
    }
    return fn(evento, ...(args as A))
  })
}

/** Versão da chave que pode ir para a interface: prefixo e fim, nunca o meio.
 *
 *  O prefixo fica inteiro porque a interface decide coisas por ele (`tgp_` =
 *  Together, que transcreve voz). Chave curta demais para mascarar com
 *  segurança vira só bolinhas. */
export function mascararChave(chave: string): string {
  const c = chave.trim()
  if (c.length < 16) return '••••••••'
  return `${c.slice(0, 7)}…${c.slice(-4)}`
}

/** Caminho aceitável para gravar um canvas: absoluto e com extensão .refmap.
 *
 *  Antes o canal gravava em QUALQUER caminho vindo da interface — o que, com a
 *  interface comprometida, dava para sobrescrever qualquer arquivo do usuário.
 *  Restringir à extensão tira esse poder e mantém o Ctrl+S funcionando, que
 *  reusa um caminho guardado entre sessões. */
export function caminhoRefmapValido(caminho: unknown): caminho is string {
  if (typeof caminho !== 'string' || !caminho.trim()) return false
  if (!path.isAbsolute(caminho)) return false
  return path.extname(caminho).toLowerCase() === '.refmap'
}

/** Configurações que a interface não pode ler nem escrever pelo canal genérico.
 *  As chaves de API têm canais próprios (que criptografam e mascaram). */
export function configuracaoProtegida(chave: string): boolean {
  return chave.startsWith('apiKey_')
}
