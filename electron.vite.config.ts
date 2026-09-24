import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

// Content Security Policy do renderer — só no build. Em dev o Vite injeta scripts
// inline (HMR, React Refresh) que uma CSP rígida bloquearia.
//   script-src  : só o próprio bundle + a lib do Whisper via refmap://; wasm-unsafe-eval
//                 é o que deixa o WebAssembly do Whisper compilar.
//   connect-src : Supabase (login/licença) e HuggingFace (download do modelo de voz,
//                 que redireciona para *.hf.co). Mais nada sai do renderer — as APIs
//                 de IA são chamadas pelo main.
//   style-src   : 'unsafe-inline' porque o app usa style={{}} e <style> por toda parte.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' refmap:",
  "worker-src 'self' blob:",
  "connect-src 'self' refmap: blob: data: https://juuxhecabxoeuhnajahj.supabase.co https://huggingface.co https://*.huggingface.co https://*.hf.co",
  "img-src 'self' data: blob: refmap:",
  "media-src 'self' blob: refmap:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join('; ')

function cspPlugin(): Plugin {
  return {
    name: 'refmap-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: { '@renderer': resolve('src/renderer') }
    },
    // Transformers.js (Whisper local) traz onnxruntime-web; deixar o Vite pré-empacotar
    // quebra o carregamento do WASM. Excluímos do optimize e o importamos dinamicamente.
    optimizeDeps: { exclude: ['@xenova/transformers'] },
    plugins: [react(), tailwindcss(), cspPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
