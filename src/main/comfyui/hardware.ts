// O que a máquina do usuário tem — GPU, VRAM, RAM, CPU — e se o ComfyUI está no ar.
//
// Fontes, da melhor para a pior:
//   1. ComfyUI rodando (`/system_stats`): VRAM total e livre exatas, versão.
//   2. nvidia-smi: nome, VRAM total/usada, driver. Está no PATH em qualquer PC NVIDIA.
//   3. Windows CIM / macOS system_profiler / lspci: só o NOME é confiável. O
//      `AdapterRAM` do Windows é um inteiro de 32 bits e reporta "4 GB" para uma
//      placa de 6, 8 ou 24 GB — por isso a VRAM fica `null` nesses casos e a UI avisa.
//
// Nunca lança: hardware desconhecido vira campos nulos, não erro.

import { execFile } from 'child_process'
import os from 'os'

export interface Gpu {
  nome: string
  vramGb: number | null
  vramLivreGb: number | null
  driver?: string
  fonte: 'comfyui' | 'nvidia-smi' | 'cim' | 'system_profiler' | 'lspci'
}

export interface ComfyStatus {
  online: boolean
  url: string | null
  versao?: string
  python?: string
  pytorch?: string
}

export interface Hardware {
  gpu: Gpu | null
  ramGb: number
  cpu: string
  nucleos: number
  so: NodeJS.Platform
  memoriaUnificada: boolean   // Apple Silicon: GPU e CPU dividem a RAM
  comfy: ComfyStatus
}

const gb = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10

function rodar(cmd: string, args: string[], timeoutMs = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(String(stdout))
    })
  })
}

async function viaNvidiaSmi(): Promise<Gpu | null> {
  try {
    const out = await rodar('nvidia-smi', ['--query-gpu=name,memory.total,memory.used,driver_version', '--format=csv,noheader,nounits'])
    const linha = out.trim().split('\n')[0]
    if (!linha) return null
    const [nome, total, usada, driver] = linha.split(',').map(s => s.trim())
    const totalMiB = Number(total), usadaMiB = Number(usada)
    if (!nome || !Number.isFinite(totalMiB)) return null
    return {
      nome, driver, fonte: 'nvidia-smi',
      vramGb: Math.round(totalMiB / 1024 * 10) / 10,
      vramLivreGb: Number.isFinite(usadaMiB) ? Math.round((totalMiB - usadaMiB) / 1024 * 10) / 10 : null,
    }
  } catch { return null }
}

const VIRTUAL = /virtual|remote|basic display|microsoft|parsec|superdisplay|spacedesk|duet/i

async function viaWindowsCim(): Promise<Gpu | null> {
  try {
    const out = await rodar('powershell', ['-NoProfile', '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion | ConvertTo-Json -Compress'])
    const dados = JSON.parse(out.trim() || 'null') as { Name?: string; DriverVersion?: string } | Array<{ Name?: string; DriverVersion?: string }> | null
    const lista = (Array.isArray(dados) ? dados : dados ? [dados] : []).filter(d => d.Name && !VIRTUAL.test(d.Name))
    // Dedicada antes de integrada.
    lista.sort((a, b) => Number(/intel.*(uhd|iris|hd graphics)/i.test(a.Name!)) - Number(/intel.*(uhd|iris|hd graphics)/i.test(b.Name!)))
    const g = lista[0]
    return g ? { nome: g.Name!, vramGb: null, vramLivreGb: null, driver: g.DriverVersion, fonte: 'cim' } : null
  } catch { return null }
}

async function viaSystemProfiler(): Promise<{ gpu: Gpu | null; unificada: boolean }> {
  try {
    const out = await rodar('system_profiler', ['SPDisplaysDataType', '-json'], 8000)
    const j = JSON.parse(out) as { SPDisplaysDataType?: Array<{ sppci_model?: string; spdisplays_vram?: string; spdisplays_vram_shared?: string; sppci_vendor?: string }> }
    const d = j.SPDisplaysDataType?.[0]
    if (!d?.sppci_model) return { gpu: null, unificada: false }
    const unificada = /apple/i.test(d.sppci_model) || /apple/i.test(d.sppci_vendor ?? '')
    const m = /([\d.]+)\s*(GB|MB)/i.exec(d.spdisplays_vram ?? d.spdisplays_vram_shared ?? '')
    const vram = m ? (m[2].toUpperCase() === 'GB' ? Number(m[1]) : Number(m[1]) / 1024) : null
    return { unificada, gpu: { nome: d.sppci_model, vramGb: unificada ? null : vram, vramLivreGb: null, fonte: 'system_profiler' } }
  } catch { return { gpu: null, unificada: false } }
}

async function viaLspci(): Promise<Gpu | null> {
  try {
    const out = await rodar('sh', ['-c', 'lspci | grep -iE "vga|3d controller"'])
    const linha = out.trim().split('\n')[0]
    if (!linha) return null
    return { nome: linha.replace(/^.*?:\s*/, '').trim(), vramGb: null, vramLivreGb: null, fonte: 'lspci' }
  } catch { return null }
}

interface SystemStats {
  system?: { comfyui_version?: string; python_version?: string; pytorch_version?: string }
  devices?: Array<{ name?: string; vram_total?: number; vram_free?: number }>
}

/** Tenta a URL configurada e as portas padrão (8188 clássico, 8000 app Desktop). */
async function sondarComfy(urlConfigurada: string | null): Promise<{ status: ComfyStatus; stats: SystemStats | null }> {
  const candidatos = [...new Set([urlConfigurada, 'http://127.0.0.1:8188', 'http://127.0.0.1:8000'].filter(Boolean) as string[])]
  for (const base of candidatos) {
    try {
      const res = await fetch(`${base.replace(/\/+$/, '')}/system_stats`, { signal: AbortSignal.timeout(1500) })
      if (!res.ok) continue
      const stats = await res.json() as SystemStats
      return {
        stats,
        status: {
          online: true, url: base,
          versao: stats.system?.comfyui_version,
          python: stats.system?.python_version?.split(' ')[0],
          pytorch: stats.system?.pytorch_version,
        },
      }
    } catch { /* próxima porta */ }
  }
  return { status: { online: false, url: null }, stats: null }
}

export async function detectarHardware(urlComfy: string | null): Promise<Hardware> {
  const so = process.platform
  let gpu: Gpu | null = null
  let memoriaUnificada = false

  if (so === 'darwin') {
    const r = await viaSystemProfiler(); gpu = r.gpu; memoriaUnificada = r.unificada
  } else {
    gpu = await viaNvidiaSmi()
    if (!gpu) gpu = so === 'win32' ? await viaWindowsCim() : await viaLspci()
  }

  const { status: comfy, stats } = await sondarComfy(urlComfy)
  // O ComfyUI mede a VRAM do jeito que importa (o que o PyTorch enxerga).
  const dev = stats?.devices?.[0]
  if (dev?.vram_total) {
    const nome = (dev.name ?? gpu?.nome ?? 'GPU').replace(/^cuda:\d+\s*/i, '').replace(/\s*:\s*cudaMallocAsync$/i, '').trim()
    gpu = { nome, vramGb: gb(dev.vram_total), vramLivreGb: dev.vram_free != null ? gb(dev.vram_free) : null, driver: gpu?.driver, fonte: 'comfyui' }
    if (/mps|apple/i.test(dev.name ?? '')) memoriaUnificada = true
  }

  return {
    gpu,
    ramGb: gb(os.totalmem()),
    cpu: os.cpus()[0]?.model?.trim() ?? '',
    nucleos: os.cpus().length,
    so,
    memoriaUnificada,
    comfy,
  }
}
