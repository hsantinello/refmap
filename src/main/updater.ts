import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'

let win: BrowserWindow | null = null
let updateReady = false   // true quando uma atualização já foi BAIXADA e está pronta
let closeDecided = false  // evita reabrir o diálogo na segunda passada do 'close'

function send(channel: string, payload?: unknown) {
  win?.webContents.send(channel, payload)
}

// As notas do GitHub chegam como HTML (o feed atom devolve o corpo já
// renderizado). Em vez de injetar isso na interface — HTML remoto dentro do
// app —, reduzimos a linhas de texto e a UI desenha a lista com o estilo dela.
function notasParaLinhas(html: string): string[] {
  return html
    // cada item de lista e cada quebra viram uma linha antes de tirar as tags
    .replace(/<\/(li|p|h[1-6]|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    // tira marcador manual ("- ", "* ") para não duplicar o bullet do CSS
    .map(l => l.trim().replace(/^[-*\u2022]\s*/, '').trim())
    .filter(Boolean)
}

// Normaliza os dois formatos que o electron-updater usa: string única (uma
// release) ou lista por versão (fullChangelog).
function normalizarNotas(
  notas: string | Array<{ version: string; note: string | null }> | null | undefined,
  versaoFallback: string,
): Array<{ version: string; items: string[] }> {
  if (!notas) return []
  if (typeof notas === 'string') {
    const items = notasParaLinhas(notas)
    return items.length ? [{ version: versaoFallback, items }] : []
  }
  return notas
    .map(n => ({ version: n.version, items: notasParaLinhas(n.note ?? '') }))
    .filter(n => n.items.length > 0)
}

export function initUpdater(mainWindow: BrowserWindow): void {
  win = mainWindow

  // Handlers registrados SEMPRE — mesmo em dev — pra o renderer poder chamar
  // checkForUpdates()/downloadUpdate() sem estourar "No handler registered".
  // Em dev (não empacotado) eles apenas resolvem em silêncio: não há update real.
  ipcMain.handle('updater:check', () =>
    app.isPackaged ? autoUpdater.checkForUpdates().catch(() => null) : null
  )

  ipcMain.handle('updater:download', () =>
    app.isPackaged ? autoUpdater.downloadUpdate().catch(() => null) : null
  )

  ipcMain.handle('updater:install', () => {
    if (app.isPackaged) setImmediate(() => autoUpdater.quitAndInstall(false, true))
  })

  // Auto-update de fato só funciona em builds empacotados.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = false         // user clicks "Download"
  autoUpdater.autoInstallOnAppQuit = false // ao fechar, PERGUNTAMOS (ver 'close' abaixo)
  // Traz as notas de TODAS as versões entre a instalada e a mais nova, não só
  // da última: quem ficou três versões para trás vê tudo o que perdeu.
  autoUpdater.fullChangelog = true

  autoUpdater.on('update-available', (info) => {
    send('updater:updateAvailable', {
      version: info.version,
      releaseDate: info.releaseDate,
      // Pode vir vazio: uma release publicada sem descrição não tem nota
      // nenhuma. A UI cai no changelog embarcado nesse caso.
      notes: normalizarNotas(info.releaseNotes, info.version),
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    send('updater:downloadProgress', Math.round(progress.percent))
  })

  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true
    send('updater:updateDownloaded', info.version)
  })

  // Ao fechar com uma atualização já baixada: oferece "Atualizar e fechar" ou
  // "Apenas fechar", em vez de instalar em silêncio.
  mainWindow.on('close', (e) => {
    if (!updateReady || closeDecided) return // nada pendente → fecha normal
    e.preventDefault()
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Atualizar e fechar', 'Apenas fechar'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'Atualização disponível',
      message: 'Há uma atualização do Ref Map pronta para instalar.',
      detail: 'Quer instalar agora ao fechar o aplicativo?',
    })
    closeDecided = true
    if (choice === 0) {
      // instala em silêncio e fecha (sem reabrir automaticamente)
      setImmediate(() => autoUpdater.quitAndInstall(true, false))
    } else {
      // fecha sem instalar (a atualização fica guardada p/ próxima vez)
      mainWindow.destroy()
    }
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater]', err.message)
    send('updater:error', err.message)
  })
}
