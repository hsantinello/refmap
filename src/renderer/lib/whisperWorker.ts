/// <reference lib="webworker" />
// Web Worker: roda o Whisper (onnxruntime-web / WASM) FORA da thread principal, pra a
// inferência não travar a UI do renderer. Recebe PCM já decodificado (Float32 16kHz mono)
// e devolve o texto. Carrega a lib do CDN (bundle self-contained deles).

const CDN_DIST = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/'
const CDN_ESM = CDN_DIST + 'transformers.min.js'
// whisper-small: qualidade bem melhor que o base em pt-BR (~250MB, baixa 1x e cacheia).
const MODEL_ID = 'Xenova/whisper-small'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx: any = self
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asrPromise: Promise<any> | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getASR(): Promise<any> {
  if (!asrPromise) {
    asrPromise = (async () => {
      const mod = await import(/* @vite-ignore */ CDN_ESM)
      mod.env.allowLocalModels = false
      mod.env.useBrowserCache = true
      const wasm = mod.env.backends?.onnx?.wasm
      if (wasm) { wasm.wasmPaths = CDN_DIST; wasm.numThreads = 1 }
      return mod.pipeline('automatic-speech-recognition', MODEL_ID, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress_callback: (p: any) => ctx.postMessage({ type: 'progress', progress: p }),
      })
    })().catch((err: unknown) => { asrPromise = null; throw err })
  }
  return asrPromise
}

ctx.onmessage = async (e: MessageEvent) => {
  const { id, type, pcm, lang } = e.data || {}
  try {
    if (type === 'load') {
      await getASR()
      ctx.postMessage({ type: 'loaded', id })
      return
    }
    if (type === 'transcribe') {
      const asr = await getASR()
      const out = await asr(pcm, { language: lang || 'pt', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 })
      const text = Array.isArray(out)
        ? out.map((o: { text?: string }) => o.text ?? '').join(' ')
        : (out?.text ?? '')
      ctx.postMessage({ type: 'result', id, text: String(text).trim() })
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', id, message: String((err as Error)?.message || err) })
  }
}
