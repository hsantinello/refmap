// PRIMEIRO de tudo, antes de qualquer módulo do Pixi carregar: a CSP do app
// (electron.vite.config.ts) não permite 'unsafe-eval', e o PixiJS 8 gera os
// programas de shader/uniform com `new Function`. Este módulo troca esse caminho
// por um sem eval. Sem ele o canvas morre com "Current environment does not
// allow unsafe-eval" — foi o que quebrou a v0.0.30 para todo mundo.
import 'pixi.js/unsafe-eval'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)
