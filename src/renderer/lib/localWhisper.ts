// Transcrição de voz 100% local e gratuita, via Whisper. A inferência (WASM) roda num
// Web Worker pra NÃO travar a UI; aqui na thread principal só decodificamos/reamostramos
// o áudio e conversamos com o worker. O modelo (whisper-small, ~250MB) é baixado do
// HuggingFace na 1ª vez e fica em cache do navegador (offline depois). Não usa Ollama
// (não faz ASR) nem API.

export type WhisperProgress = { status: string; file?: string; progress?: number; loaded?: number; total?: number }
export type ProgressCb = (p: WhisperProgress) => void

let worker: Worker | null = null
let ready = false                 // true depois que o modelo carregou no worker
let loadPromise: Promise<void> | null = null
let progressCb: ProgressCb | null = null
let seq = 0
const pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./whisperWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data || {}
      if (m.type === 'progress') { progressCb?.(m.progress as WhisperProgress); return }
      if (m.type === 'loaded') { ready = true; return }
      if (m.type === 'result') { pending.get(m.id)?.resolve(m.text ?? ''); pending.delete(m.id); return }
      if (m.type === 'error') { pending.get(m.id)?.reject(new Error(m.message || 'whisper worker error')); pending.delete(m.id) }
    }
    worker.onerror = (ev) => {
      const err = new Error(ev.message || 'whisper worker crashed')
      for (const p of pending.values()) p.reject(err)
      pending.clear()
    }
  }
  return worker
}

// Garante o modelo carregado no worker (baixa na 1ª vez). Reutiliza depois.
export function ensureWhisper(onProgress?: ProgressCb): Promise<void> {
  if (onProgress) progressCb = onProgress
  if (!loadPromise) {
    const w = getWorker()
    loadPromise = new Promise<void>((resolve, reject) => {
      const id = ++seq
      const onMsg = (e: MessageEvent) => {
        const m = e.data || {}
        if (m.type === 'loaded') { w.removeEventListener('message', onMsg); ready = true; resolve() }
        else if (m.type === 'error' && m.id === id) { w.removeEventListener('message', onMsg); reject(new Error(m.message)) }
      }
      w.addEventListener('message', onMsg)
      w.postMessage({ type: 'load', id })
    }).catch(err => { loadPromise = null; throw err })
  }
  return loadPromise
}

// True quando o modelo já está pronto (2ª+ gravação → sem espera de download/load).
export function isWhisperReady(): boolean {
  return ready
}

// Decodifica o áudio gravado (webm/opus) e reamostra pra 16kHz mono Float32 (formato do
// Whisper). decodeAudioData e o rendering são nativos/assíncronos — não travam a UI.
async function decodeToPcm16k(blob: Blob): Promise<Float32Array> {
  const arrayBuf = await blob.arrayBuffer()
  const AudioCtx = window.AudioContext
    || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const decodeCtx = new AudioCtx()
  let decoded: AudioBuffer
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuf)
  } finally {
    decodeCtx.close().catch(() => {})
  }
  const targetRate = 16000
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate))
  const offline = new OfflineAudioContext(1, frames, targetRate)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

// Transcreve um blob de áudio: decodifica aqui, roda a inferência no worker.
export async function transcribeLocal(blob: Blob, lang: 'pt' | 'en' = 'pt'): Promise<string> {
  await ensureWhisper()
  const pcm = await decodeToPcm16k(blob)
  const w = getWorker()
  return new Promise<string>((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    // Transfere o buffer do PCM (zero-copy) pro worker.
    w.postMessage({ type: 'transcribe', id, pcm, lang }, [pcm.buffer])
  })
}
