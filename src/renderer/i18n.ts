// Ponte entre o dicionário compartilhado e o estado do renderer.
//
// Duas formas de propósito:
//
//   useT()  — dentro do corpo de um componente. Assina o `appLang` no Zustand,
//             então trocar de idioma re-renderiza a tela sozinho.
//
//   t()     — fora do corpo: event handlers, blocos `catch`, callbacks e o código
//             imperativo do PixiCanvas. Lê o idioma na hora da chamada. Não
//             re-renderiza nada — e não precisa, porque quem chama já está
//             produzindo texto novo naquele instante.
//
// Regra prática: se o texto vai direto no JSX, use `useT()`. Se ele vira estado
// (setErro, confirmar, toast), use `t()`.

import { createElement, Fragment, useCallback, type ReactNode } from 'react'
import { translate, type I18nKey, type Vars } from '../shared/i18n'
import { useCanvasStore } from './store'

export type { I18nKey }

/** Tradução imperativa — lê o idioma atual do store no momento da chamada. */
export function t(key: I18nKey, vars?: Vars): string {
  return translate(useCanvasStore.getState().appLang, key, vars)
}

/** Tradução reativa — o componente re-renderiza ao trocar o idioma. */
export function useT() {
  const lang = useCanvasStore(s => s.appLang)
  return useCallback((key: I18nKey, vars?: Vars) => translate(lang, key, vars), [lang])
}

/** Fraseado com pedaços de JSX no meio ("instala <b>três modelos</b> que rodam…").
 *
 *  Quebrar a frase em `parte1 + <span> + parte2` no JSX parece mais simples, mas
 *  trava a ordem das palavras do português no inglês. Aqui a frase inteira mora
 *  no dicionário com placeholders, e cada idioma pode pôr o `{models}` onde
 *  precisar. */
export function useTRich() {
  const lang = useCanvasStore(s => s.appLang)
  return useCallback((key: I18nKey, nodes: Record<string, ReactNode>): ReactNode[] => {
    return translate(lang, key)
      .split(/(\{\w+\})/g)
      .filter(part => part !== '')
      .map((part, i) => {
        const match = /^\{(\w+)\}$/.exec(part)
        if (!match) return part
        return createElement(Fragment, { key: i }, nodes[match[1]] ?? part)
      })
  }, [lang])
}
