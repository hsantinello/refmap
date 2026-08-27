import entradas from './changelog.json'

// Novidades de cada versão, exibidas no sininho da barra de título.
//
// O conteúdo mora no .json ao lado, e não aqui, porque ele tem DOIS leitores: o
// app (por este módulo) e o workflow de publicação, que extrai a entrada da
// versão sendo publicada e a usa como descrição da release no GitHub. Assim
// quem ainda NÃO atualizou também vê as novidades — o app dele só tem o
// changelog até a versão instalada, e o resto chega pelas notas remotas.
//
// AO PUBLICAR: adicione a entrada nova no TOPO do changelog.json, com o mesmo
// número que vai para o package.json. A ordem do array é a ordem de exibição.

export interface EntradaChangelog {
  version: string
  /** AAAA-MM-DD. Só para exibição. */
  date: string
  /** Uma frase por novidade, escrita para quem usa o app — não para quem o escreve. */
  items: string[]
}

export const CHANGELOG: EntradaChangelog[] = entradas

/** A entrada mais recente do changelog embarcado. */
export const ULTIMA_NOVIDADE = CHANGELOG[0]?.version ?? ''
