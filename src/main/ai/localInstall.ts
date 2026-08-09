import { app, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getLocalConfig, getLocalTextConfig } from './local'

// Instalação 100% in-app da IA local (Ollama + modelo), só Windows por enquanto.
// Fluxo: verifica → (baixa+instala Ollama silencioso, se preciso) → inicia → puxa o modelo.
// Cada etapa emite progresso pro renderer via 'local:installProgress'.

export type InstallPhase =
  | 'checking' | 'downloading' | 'installing' | 'starting' | 'pulling' | 'uninstalling' | 'done' | 'error'

export interface InstallProgress {
  phase: InstallPhase
  percent: number   // 0-100; -1 = indeterminado (etapa sem total conhecido)
  message: string
  error?: string
}

const OLLAMA_INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe'

function send(win: BrowserWindow, p: InstallProgress): void {
  if (!win.isDestroyed()) win.webContents.send('local:installProgress', p)
}

// baseURL vem como http://localhost:11434/v1 — a API nativa do Ollama fica na raiz.
function apiRoot(): string {
  return getLocalConfig().baseURL.replace(/\/v1\/?$/, '')
}

async function isOllamaUp(root: string): Promise<boolean> {
  try {
    const res = await fetch(`${root}/api/tags`, { method: 'GET' })
    return res.ok
  } catch { return false }
}

async function waitForOllama(root: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isOllamaUp(root)) return true
    await new Promise(r => setTimeout(r, 1500))
  }
  return false
}

// Caminho padrão do ollama.exe numa instalação por-usuário do Windows.
function existingOllamaExe(): string | null {
  const local = process.env.LOCALAPPDATA
  if (!local) return null
  const p = path.join(local, 'Programs', 'Ollama', 'ollama.exe')
  return fs.existsSync(p) ? p : null
}

async function downloadFile(url: string, dest: string, onPercent: (pct: number) => void): Promise<void> {
  const res = await fetch(url) // fetch segue redirects (o link do Ollama redireciona pra CDN)
  if (!res.ok || !res.body) throw new Error(`Download falhou (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  let received = 0

  const fileStream = fs.createWriteStream(dest)
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      if (!fileStream.write(chunk)) {
        await new Promise<void>(r => fileStream.once('drain', () => r()))
      }
      received += chunk.length
      onPercent(total ? Math.round((received / total) * 100) : -1)
    }
  } finally {
    fileStream.end()
  }
  await new Promise<void>((resolve, reject) => {
    fileStream.on('finish', () => resolve())
    fileStream.on('error', reject)
  })
}

function runSilentInstaller(installerPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Instalador do Ollama é Inno Setup → flags silenciosas, instala por-usuário (sem UAC).
    const proc = spawn(installerPath, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { windowsHide: true })
    proc.on('error', reject)
    proc.on('exit', code => code === 0 ? resolve() : reject(new Error(`Instalador saiu com código ${code}`)))
  })
}

async function pullModel(root: string, model: string, onProgress: (pct: number, status: string) => void): Promise<void> {
  const res = await fetch(`${root}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model, stream: true }),
  })
  if (!res.ok || !res.body) throw new Error(`Pull do modelo falhou (HTTP ${res.status})`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? '' // guarda a linha parcial
    for (const line of lines) {
      if (!line.trim()) continue
      let obj: { status?: string; total?: number; completed?: number; error?: string }
      try { obj = JSON.parse(line) } catch { continue }
      if (obj.error) throw new Error(obj.error)
      if (obj.total && obj.completed) onProgress(Math.round((obj.completed / obj.total) * 100), obj.status ?? '')
      else onProgress(-1, obj.status ?? '')
    }
  }
}

// Roda um comando PowerShell e devolve o stdout (para consultar registro etc.).
function ps(command: string): Promise<string> {
  return new Promise(resolve => {
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true })
    let out = ''
    proc.stdout.on('data', d => { out += d.toString() })
    proc.on('exit', () => resolve(out.trim()))
    proc.on('error', () => resolve(''))
  })
}

// Encerra TODOS os processos "ollama*" (app, serve, model runner).
function killOllama(): Promise<void> {
  return ps("Get-Process -Name 'ollama*' -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue").then(() => {})
}

// Descobre o desinstalador: 1) UninstallString no registro (fonte oficial),
// 2) caminho padrão unins000.exe, 3) qualquer unins*.exe na pasta do Ollama.
async function findUninstaller(): Promise<string> {
  const cmd =
    "$r='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'," +
    "'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'," +
    "'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall';" +
    "Get-ChildItem $r -EA SilentlyContinue | ForEach-Object { Get-ItemProperty $_.PSPath -EA SilentlyContinue } |" +
    "Where-Object { $_.DisplayName -like '*Ollama*' } | Select-Object -ExpandProperty UninstallString -First 1"
  const raw = await ps(cmd)
  const m = raw && (raw.match(/"([^"]+\.exe)"/i) || raw.match(/(\S+\.exe)/i))
  if (m && fs.existsSync(m[1])) return m[1]

  const local = process.env.LOCALAPPDATA
  if (local) {
    const dir = path.join(local, 'Programs', 'Ollama')
    const guess = path.join(dir, 'unins000.exe')
    if (fs.existsSync(guess)) return guess
    try {
      const f = fs.readdirSync(dir).find(n => /^unins.*\.exe$/i.test(n))
      if (f) return path.join(dir, f)
    } catch { /* pasta pode não existir */ }
  }
  return ''
}

async function waitUntilGone(filePath: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (!fs.existsSync(filePath)) return true
    await new Promise(r => setTimeout(r, 800))
  }
  return false
}

// Desinstala o Ollama (Windows). Emite progresso pelo MESMO canal da instalação
// ('local:installProgress'), então aparece no pill do topo e na barra do Settings.
export async function uninstallLocal(win: BrowserWindow): Promise<void> {
  if (installing) return
  installing = true
  try {
    if (process.platform !== 'win32') throw new Error('Desinstalação automática disponível apenas no Windows.')
    const local = process.env.LOCALAPPDATA
    const ollamaExe = local ? path.join(local, 'Programs', 'Ollama', 'ollama.exe') : ''

    send(win, { phase: 'uninstalling', percent: -1, message: 'Localizando o Ollama…' })
    const uninstaller = await findUninstaller()
    console.log('[uninstall] desinstalador =', uninstaller || '(não encontrado)')
    if (!uninstaller) throw new Error('Não encontrei o desinstalador do Ollama. Desinstale pelo Painel de Controle do Windows.')

    send(win, { phase: 'uninstalling', percent: -1, message: 'Encerrando o Ollama…' })
    await killOllama()
    await new Promise(r => setTimeout(r, 1000)) // deixa os processos caírem

    send(win, { phase: 'uninstalling', percent: -1, message: 'Removendo o Ollama…' })
    // O desinstalador do Inno se copia pro temp e sai cedo — não confiamos no exit;
    // esperamos o ollama.exe sumir do disco (= desinstalação realmente concluída).
    spawn(uninstaller, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { windowsHide: true })
    const target = (ollamaExe && fs.existsSync(ollamaExe)) ? ollamaExe : uninstaller
    const gone = await waitUntilGone(target, 90_000)
    console.log('[uninstall] concluído =', gone, '| alvo =', target)
    if (!gone) throw new Error('A desinstalação não concluiu — o Ollama ainda está instalado. Tente pelo Painel de Controle.')

    send(win, { phase: 'done', percent: 100, message: 'Ollama desinstalado.' })
  } catch (err) {
    console.error('[uninstall] erro:', err)
    send(win, {
      phase: 'error', percent: 0, message: 'Falha ao desinstalar o Ollama',
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    installing = false
  }
}

let installing = false

export async function installLocalAI(win: BrowserWindow): Promise<void> {
  if (installing) return // evita instalação concorrente (ex.: clicou duas vezes)
  installing = true
  const { model: visionModel } = getLocalConfig()      // visão (tags)
  const { model: textModel }   = getLocalTextConfig()  // texto sem censura (+18)
  const root = apiRoot()

  try {
    send(win, { phase: 'checking', percent: -1, message: 'Verificando Ollama…' })
    let up = await isOllamaUp(root)

    // Instalado mas parado? Tenta iniciar antes de baixar de novo.
    if (!up) {
      const exe = existingOllamaExe()
      if (exe) {
        send(win, { phase: 'starting', percent: -1, message: 'Iniciando Ollama…' })
        spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
        up = await waitForOllama(root, 20_000)
      }
    }

    // Não instalado → baixa e instala (Windows).
    if (!up) {
      if (process.platform !== 'win32') {
        throw new Error('A instalação automática está disponível apenas no Windows por enquanto.')
      }
      const dir = path.join(app.getPath('temp'), 'refmap-ollama')
      fs.mkdirSync(dir, { recursive: true })
      const installerPath = path.join(dir, 'OllamaSetup.exe')

      send(win, { phase: 'downloading', percent: 0, message: 'Baixando Ollama…' })
      await downloadFile(OLLAMA_INSTALLER_URL, installerPath, pct =>
        send(win, { phase: 'downloading', percent: pct, message: 'Baixando Ollama…' }))

      send(win, { phase: 'installing', percent: -1, message: 'Instalando Ollama…' })
      await runSilentInstaller(installerPath)

      send(win, { phase: 'starting', percent: -1, message: 'Iniciando Ollama…' })
      up = await waitForOllama(root, 60_000)
      if (!up) throw new Error('Ollama instalado, mas o serviço não respondeu. Reinicie o app e tente de novo.')

      fs.rm(installerPath, () => {}) // limpa o instalador baixado
    }

    // Puxa OS DOIS modelos do híbrido (parte mais pesada). Só re-baixa o que faltar
    // (o Ollama pula camadas já presentes). Visão primeiro, depois texto.
    const models = textModel && textModel !== visionModel ? [visionModel, textModel] : [visionModel]
    for (let i = 0; i < models.length; i++) {
      const m = models[i]
      const rotulo = m === visionModel ? 'visão (tags)' : 'texto (+18)'
      await pullModel(root, m, (pct, status) =>
        send(win, { phase: 'pulling', percent: pct, message: status || `Baixando modelo de ${rotulo}…` }))
    }

    send(win, { phase: 'done', percent: 100, message: 'IA local pronta!' })
  } catch (err) {
    send(win, {
      phase: 'error', percent: 0, message: 'Falha ao instalar a IA local',
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    installing = false
  }
}
