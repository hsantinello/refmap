import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

let win: BrowserWindow | null = null

function send(channel: string, payload?: unknown) {
  win?.webContents.send(channel, payload)
}

export function initUpdater(mainWindow: BrowserWindow): void {
  // Auto-update only works in packaged builds
  if (!app.isPackaged) return

  win = mainWindow

  autoUpdater.autoDownload = false        // user clicks "Download"
  autoUpdater.autoInstallOnAppQuit = true // install silently when user quits

  autoUpdater.on('update-available', (info) => {
    send('updater:updateAvailable', { version: info.version })
  })

  autoUpdater.on('download-progress', (progress) => {
    send('updater:downloadProgress', Math.round(progress.percent))
  })

  autoUpdater.on('update-downloaded', (info) => {
    send('updater:updateDownloaded', info.version)
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater]', err.message)
    send('updater:error', err.message)
  })

  ipcMain.handle('updater:check', () =>
    autoUpdater.checkForUpdates().catch(() => null)
  )

  ipcMain.handle('updater:download', () =>
    autoUpdater.downloadUpdate().catch(() => null)
  )

  ipcMain.handle('updater:install', () => {
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
  })
}
