// Extrai a entrada do changelog.json para a versão pedida e imprime em Markdown.
//
// Usado pelo workflow de publicação como corpo da release no GitHub. Sem isso as
// releases saem sem descrição, e o sininho de quem AINDA NÃO atualizou não tem o
// que mostrar — o changelog embarcado no app dele para na versão instalada.
//
// Uso: node scripts/release-notes.mjs 0.0.28

import { readFileSync } from 'node:fs'

const versao = (process.argv[2] || '').replace(/^v/, '')
if (!versao) {
  console.error('Uso: node scripts/release-notes.mjs <versao>')
  process.exit(1)
}

const entradas = JSON.parse(readFileSync('src/renderer/data/changelog.json', 'utf8'))
const entrada = entradas.find(e => e.version === versao)

if (!entrada) {
  // Não é motivo para derrubar a publicação: a release sai sem corpo, como saía
  // antes. Mas avisa alto, porque quase sempre é esquecimento de atualizar o
  // changelog junto com o package.json.
  console.error(`[release-notes] AVISO: changelog.json não tem entrada para ${versao}.`)
  process.exit(0)
}

console.log(entrada.items.map(i => `- ${i}`).join('\n'))
