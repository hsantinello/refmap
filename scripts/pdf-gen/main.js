const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 794,
    height: 1123,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })

  const htmlPath = path.join(__dirname, 'content.html')
  await win.loadURL('file:///' + htmlPath.replace(/\\/g, '/'))

  // Wait for fonts and rendering
  await new Promise(r => setTimeout(r, 2500))

  const pdfBuffer = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    landscape: false,
  })

  const outPath = path.join(__dirname, '..', '..', 'Ref Map - Guia de Funcionalidades.pdf')
  fs.writeFileSync(outPath, pdfBuffer)
  console.log('PDF gerado em:', outPath)
  app.quit()
})
