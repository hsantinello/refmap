import { app, BrowserWindow, nativeImage } from 'electron'
import { join } from 'path'
import { initDb } from './db'
import { registerHandlers } from './ipc/handlers'

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
      webSecurity: false, // necessário para carregar imagens via file://
    },
  })

  win.once('ready-to-show', () => win?.show())
  setTimeout(() => { if (win && !win.isVisible()) win.show() }, 3000)
  win.on('maximize', () => win?.webContents.send('window:maximizeChange', true))
  win.on('unmaximize', () => win?.webContents.send('window:maximizeChange', false))

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initDb()
  createWindow()
  if (win) registerHandlers(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      if (win) registerHandlers(win)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
