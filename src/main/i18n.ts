// Idioma no processo main.
//
// O main não enxerga o Zustand, então guarda o idioma em memória. Três momentos
// alimentam essa variável:
//
//   1. boot        — `initMainLang()` lê a setting salva; na primeira execução
//                    (sem setting) cai no idioma do sistema operacional.
//   2. troca no app — o handler `settings:set` avisa quando a chave é 'appLang'.
//   3. fallback     — 'en', igual ao default do renderer.
//
// Usado nas poucas strings que nascem aqui: diálogo nativo do updater, progresso
// da instalação do Ollama e filtros dos file pickers.

import { app } from 'electron'
import { settingQueries } from './db'
import { translate, normalizeLang, type I18nKey, type Lang, type Vars } from '../shared/i18n'

let currentLang: Lang = 'en'

/** Chamado uma vez no boot, depois do `initDb()`. */
export function initMainLang(): Lang {
  const saved = settingQueries.get('appLang')
  // Primeira execução: sem escolha salva, segue o idioma do sistema. Antes disso
  // o app abria sempre em 'en' e mostrava a interface em português — o badge
  // dizia uma coisa e a tela mostrava outra.
  currentLang = saved ? normalizeLang(saved) : normalizeLang(app.getLocale())
  return currentLang
}

export function setMainLang(raw: unknown): void {
  currentLang = normalizeLang(raw)
}

export function getMainLang(): Lang {
  return currentLang
}

/** Tradução no main. Mesmo dicionário do renderer. */
export function tm(key: I18nKey, vars?: Vars): string {
  return translate(currentLang, key, vars)
}
