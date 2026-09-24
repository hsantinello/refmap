import { app, BrowserWindow, nativeImage, dialog } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { initDb } from './db'
import { registerHandlers, setMainWindow } from './ipc/handlers'
import { initUpdater, setUpdaterWindow } from './updater'
import { initMainLang } from './i18n'
import { blindarWebContents, definirUrlDoApp } from './security'
import { registrarEsquemaPrivilegiado, registrarProtocolo } from './media-protocol'
import { limparArquivosOrfaos } from './housekeeping'
import { matarFfmpegAtivos } from './video/extractScenes'
import { translate, normalizeLang } from '../shared/i18n'

// Tem de acontecer antes de o app ficar pronto — depois disso o Chromium não aceita mais.
registrarEsquemaPrivilegiado()

let win: BrowserWindow | null = null

function createWindow(): void {
  const iconPath = join(__dirname, '../../ID/icone app.png')
  const rawIcon = nativeImage.createFromPath(iconPath)
  const { width, height } = rawIcon.getSize()
  const crop = Math.floor(width * 0.13)
  const icon = rawIcon
    .crop({ x: crop, y: crop, width: width - crop * 2, height: height - crop * 2 })
    .resize({ width: 256, height: 256 })

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 400,
    minHeight: 300,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#000000',
      symbolColor: 'rgba(255,255,255,0.75)',
      height: 32,
    },
    transparent: false,
    backgroundColor: '#000000',
    icon,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win?.show())
  setTimeout(() => { if (win && !win.isVisible()) win.show() }, 3000)
  win.on('maximize', () => win?.webContents.send('window:maximizeChange', true))
  win.on('unmaximize', () => win?.webContents.send('window:maximizeChange', false))

  // A URL do app precisa ser conhecida ANTES de carregar: é contra ela que a
  // navegação e os canais IPC conferem se quem está do outro lado é o app.
  if (process.env.ELECTRON_RENDERER_URL) {
    definirUrlDoApp(process.env.ELECTRON_RENDERER_URL)
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    const indexHtml = join(__dirname, '../renderer/index.html')
    definirUrlDoApp(pathToFileURL(indexHtml).href)
    win.loadFile(indexHtml)
  }
}

// Todo webContents que nascer (janela principal ou qualquer outro) já nasce sem
// poder navegar para fora do app nem abrir janelas. Ver security.ts.
app.on('web-contents-created', (_e, contents) => blindarWebContents(contents))

app.whenReady().then(() => {
  try {
    initDb()
  } catch (err) {
    // Banco corrompido, travado por outra instância ou binário do SQLite
    // incompatível: sem isto o app ficava "aberto" no gerenciador de tarefas, sem
    // janela e sem uma palavra. O idioma vem do SO porque a setting mora no banco.
    const idioma = normalizeLang(app.getLocale())
    dialog.showErrorBox('Ref Map',
      translate(idioma, 'main.db.openFailed', { dir: app.getPath('userData') }) +
      `\n\n${err instanceof Error ? err.message : String(err)}`)
    app.exit(1)
    return
  }
  // Depende do banco (lê a setting 'appLang') e precisa vir antes de qualquer
  // string do main ir para a tela — o diálogo do updater, por exemplo.
  initMainLang()
  // Antes da janela: é por aqui que as imagens do usuário e o Whisper chegam ao renderer.
  registrarProtocolo()
  createWindow()
  if (win) {
    registerHandlers(win)
    initUpdater(win)
  }
  // Com a janela já na tela e sem bloquear nada: miniaturas, quadros de vídeo,
  // colagens e cache que nenhum nó usa mais.
  setTimeout(() => void limparArquivosOrfaos(), 5000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      // Handlers já estão registrados; só apontam para a janela nova.
      if (win) { setMainWindow(win); setUpdaterWindow(win) }
    }
  })
}).catch(err => {
  dialog.showErrorBox('Ref Map', err instanceof Error ? (err.stack ?? err.message) : String(err))
  app.exit(1)
})

// Extração de vídeo em curso não sobrevive ao app fechar.
app.on('before-quit', () => matarFfmpegAtivos())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
