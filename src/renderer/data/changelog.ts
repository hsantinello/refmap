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
  /** Mesma lista em inglês. Opcional: as notas REMOTAS (vindas da descrição da
   *  release no GitHub) não têm este campo, e entradas antigas podem não ter. */
  items_en?: string[]
}

export const CHANGELOG: EntradaChangelog[] = entradas

/** A entrada mais recente do changelog embarcado. */
export const ULTIMA_NOVIDADE = CHANGELOG[0]?.version ?? ''

/** Itens no idioma do app, caindo no português quando não há versão em inglês.
 *
 *  O fallback importa: as notas remotas do GitHub chegam sempre num idioma só
 *  (o corpo da release), e é melhor mostrá-las em português do que sumir com
 *  elas por não existir tradução. */
export function itensDaEntrada(entrada: EntradaChangelog, lang: 'en' | 'pt'): string[] {
  return lang === 'en' && entrada.items_en?.length ? entrada.items_en : entrada.items
}
