# Parser bench: instruções para o agente

Você é o agente que melhora os parsers de metadados do Ref Map, em `src/main/metadata/`.
O objetivo é **subir a NOTA do conjunto dev** sem baixar a do holdout.
A nota sai de `npm run bench:parsers`, de 0 a 100, quanto maior melhor.

## O que você pode mexer
- Tudo em `src/main/metadata/` (parsers, dispatcher, leitor de PNG). Pode criar arquivos novos ali, por exemplo um parser novo.
- Dependência nova só se for indispensável (ex.: ler EXIF de WEBP). Anote o motivo no commit.

## O que você NÃO pode mexer
- `scripts/parser-bench/` (o script de nota) e qualquer `.expected.json`. A régua não muda no meio da corrida.
- Nada fora de `src/main/metadata/`, salvo o `package.json` no caso de dependência nova.
- **Não abra nem leia nada em `parser-bench/holdout/`.** Ele existe para provar que você melhorou o parser de verdade, e não só decorou o dev.
- Nada de caso especial por nome de arquivo do bench (`if (nome === 'Topaz_00001_.png')`). Usar o nome do arquivo como dado genérico vale. Por exemplo: achar o SaveImage cujo `filename_prefix` bate com o nome.

## O loop
1. Rode `npm run bench:parsers -- --verbose` e leia os erros.
2. Escolha **uma** hipótese (ex.: "JSON com NaN quebra o JSON.parse") e implemente a menor mudança que a resolve.
3. Rode `npm run typecheck:node`. Se quebrar, conserte antes de seguir.
4. Rode `npm run bench:parsers -- --log "<hipótese em uma linha>"`.
5. **Se a nota subiu** (ou empatou com código mais simples): `git commit` com a hipótese e a nota na mensagem.
   **Se caiu:** `git checkout -- src/main/metadata` e anote no results.tsv o que não deu certo, para não tentar de novo.
6. Volte ao passo 1. Pare quando a nota chegar a 100 ou quando três hipóteses seguidas não subirem a nota.

Ao terminar, rode **uma vez** `npm run bench:parsers -- --set holdout --log "final"` e relate as duas notas, antes e depois.

## Regras de comportamento do parser
- `rawText` é sempre `string` ou `null`, nunca um array ou objeto. Um link do ComfyUI (`["18:13", 0]`) precisa ser resolvido até o texto, ou virar `null`.
- Se o texto do prompt só existe em tempo de execução (gerado por outro nó, como um upsampler ou um gerador de rosto), siga o link até o último texto fixo que o usuário digitou. Se não houver nenhum, devolva `null`: a imagem cai na análise por IA, e isso é melhor do que um prompt errado.
- Num workflow com vários nós geradores, o prompt certo é o do nó que alimenta o SaveImage que gravou aquela imagem.
- Nós de API (Gemini, Seedream, Topaz, Kling etc.) também são ComfyUI: o prompt, o modelo e o seed ficam nos inputs do próprio nó.
- Nunca jogue exceção para fora de `extractMetadata`. Imagem estranha deve devolver `source: 'none'`.

## Erros conhecidos no início (2026-10-26, nota dev 53,07 e holdout 46,15)
- O JSON do ComfyUI com `NaN` (que o Python grava) quebra o `JSON.parse`, e a imagem vira `none`.
- O prompt de nós de API não é lido (Gemini, Seedream, Topaz).
- Prompt ligado a outro nó ou subgraph volta como array.
- WEBP: o exifr não lê o formato, então nenhum metadado aparece. O ComfyUI grava em EXIF `Model` = `prompt:<json>` e `Make` = `workflow:<json>`.
- JPG do A1111: o texto fica no EXIF `UserComment`, que hoje não é consultado.
- A1111/Forge: `Size`, `Schedule type` e `Distilled CFG Scale` não são lidos.
- O `scheduler` do KSampler não é lido.
