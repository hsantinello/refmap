// Limpeza de arquivos que o app cria e antes nunca apagava.
//
// Miniaturas (userData/thumbnails), quadros de vídeo (userData/scenes), imagens
// coladas (userData/pasted), recortes para análise (temp/refmap-crop) e as
// linhas do cache de IA cresciam sem limite: importar três vídeos deixava
// centenas de JPGs permanentes, e apagar o nó não apagava nada.
//
// Duas frentes:
//   • no boot, `limparArquivosOrfaos()` apaga o que nenhum nó referencia;
//   • ao apagar um nó, `apagarArquivosDoNo()` leva junto a miniatura e a imagem
//     colada, se mais ninguém as usa.
//
// Regra de ouro: só apaga o que está DENTRO das pastas do app. Um arquivo do
// usuário (a imagem original em Downloads, por exemplo) nunca é tocado.

import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { housekeepingQueries } from './db'

const norm = (p: string) => path.normalize(p).toLowerCase()

function listarRecursivo(dir: string): string[] {
  const out: string[] = []
  const pilha = [dir]
  while (pilha.length) {
    const atual = pilha.pop()!
    let entradas: fs.Dirent[]
    try { entradas = fs.readdirSync(atual, { withFileTypes: true }) } catch { continue }
    for (const e of entradas) {
      const p = path.join(atual, e.name)
      if (e.isDirectory()) pilha.push(p)
      else out.push(p)
    }
  }
  return out
}

/** Apaga, numa pasta plana, todo arquivo que não está em `usados`. */
function apagarNaoReferenciados(dir: string, usados: Set<string>): number {
  if (!fs.existsSync(dir)) return 0
  let n = 0
  for (const arquivo of listarRecursivo(dir)) {
    if (usados.has(norm(arquivo))) continue
    try { fs.unlinkSync(arquivo); n++ } catch { /* em uso ou sem permissão: fica para a próxima */ }
  }
  return n
}

/** Apaga arquivos com mais de `idadeMs` numa pasta de temporários. */
function apagarAntigos(dir: string, idadeMs: number): number {
  if (!fs.existsSync(dir)) return 0
  const limite = Date.now() - idadeMs
  let n = 0
  for (const arquivo of listarRecursivo(dir)) {
    try {
      if (fs.statSync(arquivo).mtimeMs < limite) { fs.unlinkSync(arquivo); n++ }
    } catch { /* idem */ }
  }
  return n
}

/** Roda no boot, depois de a janela existir. Nunca lança. */
export async function limparArquivosOrfaos(): Promise<void> {
  try {
    const usados = new Set<string>()
    for (const p of housekeepingQueries.caminhosEmUso()) usados.add(norm(p))
    const dados = app.getPath('userData')
    let arquivos = 0

    arquivos += apagarNaoReferenciados(path.join(dados, 'thumbnails'), usados)
    arquivos += apagarNaoReferenciados(path.join(dados, 'pasted'), usados)

    // Cenas: uma pasta por extração. O nó de vídeo aponta para um quadro dela, então
    // a pasta está em uso enquanto QUALQUER arquivo seu for referenciado — e vai
    // embora inteira quando o nó some. Extrações abandonadas (cancelar, fechar o
    // app no meio) também caem aqui.
    const cenas = path.join(dados, 'scenes')
    if (fs.existsSync(cenas)) {
      for (const sub of fs.readdirSync(cenas, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue
        const dir = path.join(cenas, sub.name)
        const conteudo = listarRecursivo(dir)
        if (conteudo.some(a => usados.has(norm(a)))) continue
        try { fs.rmSync(dir, { recursive: true, force: true }); arquivos += conteudo.length } catch { /* idem */ }
      }
    }

    // Recortes existem só para uma análise; uma hora é folga de sobra.
    arquivos += apagarAntigos(path.join(app.getPath('temp'), 'refmap-crop'), 60 * 60 * 1000)

    // Cache de IA apontando para arquivo que não existe mais (recortes, colagens
    // antigas no temp, imagens que o usuário apagou).
    const cache = housekeepingQueries.apagarCacheOrfao(p => fs.existsSync(p))

    if (arquivos || cache) console.log(`[housekeeping] ${arquivos} arquivo(s) e ${cache} entrada(s) de cache removidos`)
  } catch (err) {
    console.warn('[housekeeping] falhou:', err)
  }
}

/** Antes de apagar o nó do banco: leva a miniatura e a imagem colada, se forem só dele. */
export function apagarArquivosDoNo(id: string): void {
  try {
    const { imagePath, thumbnailPath } = housekeepingQueries.arquivosDoNo(id)
    const pastas = [path.join(app.getPath('userData'), 'pasted'), path.join(app.getPath('userData'), 'thumbnails')]
    const dentroDoApp = (p: string) => pastas.some(pasta => norm(p).startsWith(norm(pasta) + path.sep))

    for (const arquivo of [thumbnailPath, imagePath]) {
      if (!arquivo || !dentroDoApp(arquivo)) continue
      if (housekeepingQueries.arquivoEmUsoPorOutro(arquivo, id)) continue
      try { fs.unlinkSync(arquivo) } catch { /* já não existe ou em uso */ }
    }
  } catch (err) {
    console.warn('[housekeeping] apagarArquivosDoNo:', err)
  }
}
