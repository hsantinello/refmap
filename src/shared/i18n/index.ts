// Núcleo de tradução — compartilhado entre main, preload e renderer.
//
// Regra da casa: NENHUM texto visível ao usuário é escrito direto no JSX ou nas
// mensagens. Tudo passa por uma chave daqui. O inglês (`en.ts`) é a BASE — é ele
// que define quais chaves existem; o português (`pt.ts`) é tipado como
// `Record<I18nKey, string>`, então o build QUEBRA se uma chave for adicionada em
// um e esquecida no outro. Com ~500 strings, esse é o único jeito de a tradução
// não ficar pela metade sem ninguém perceber.
//
// Este arquivo é puro: não conhece Zustand nem Electron. Quem amarra ao estado é
// `src/renderer/i18n.ts` (hook + função) e `src/main/i18n.ts` (cache em memória).

import { en, type I18nKey } from './en'
import { pt } from './pt'

export type { I18nKey }
export type Lang = 'en' | 'pt'
export type Dict = Record<I18nKey, string>

export const DICTS: Record<Lang, Dict> = { en, pt }

export type Vars = Record<string, string | number>

/** Substitui `{nome}` pelos valores passados. Placeholder sem valor fica visível
 *  de propósito — some silenciosamente é pior que aparecer errado. */
function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  )
}

/** Tradução pura. O fallback para `en` cobre o caso de uma chave existir só na
 *  base — nunca deve acontecer (o tipo impede), mas é melhor mostrar inglês do
 *  que `undefined` na tela. */
export function translate(lang: Lang, key: I18nKey, vars?: Vars): string {
  return interpolate(DICTS[lang][key] ?? en[key], vars)
}

/** Normaliza qualquer coisa (setting salva, `app.getLocale()`, valor de IPC)
 *  para um idioma suportado. Só 'pt*' vira português; o resto cai em inglês. */
export function normalizeLang(raw: unknown): Lang {
  return typeof raw === 'string' && raw.toLowerCase().startsWith('pt') ? 'pt' : 'en'
}
