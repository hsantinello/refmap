# Parser bench

Uma nota de 0 a 100 que mede quanto os parsers de `src/main/metadata/` acertam o prompt e os parâmetros das imagens.
Serve para duas coisas:
1. **Teste de regressão**: qualquer mudança nos parsers precisa manter ou subir a nota.
2. **Loop de melhoria automática**, no estilo do [autoresearch](https://github.com/karpathy/autoresearch): um agente segue o `program.md` e melhora os parsers sozinho.

## Estrutura
```
parser-bench/
  dev/        imagens que o agente usa para treinar (fora do git)
  holdout/    imagens que o agente nunca vê, usadas só na conferência final (fora do git)
  results.tsv histórico das notas (fora do git)
  program.md  instruções do agente
```
Cada imagem tem do lado:
- `<nome>.expected.json`: o gabarito, ou seja, o que o parser deveria devolver
- `<nome>.raw.json`: os metadados crus do arquivo, para quem for revisar

As imagens ficam fora do git porque são pessoais e pesam cerca de 150 MB.

## Comandos
```bash
npm run bench:parsers                     # nota do dev
npm run bench:parsers -- --verbose        # mostra cada campo errado
npm run bench:parsers -- --set holdout    # nota do holdout
npm run bench:draft                       # cria rascunhos de gabarito para imagens novas
```

## Adicionar imagens
1. Copie a imagem para `dev/` ou `holdout/` **com o nome original**. Alguns parsers usam o nome do arquivo para achar o SaveImage certo.
2. Rode `npm run bench:draft`. Ele cria o `.expected.json` com o que o parser atual extrai e marca `"_reviewed": false`.
3. Abra o `.raw.json`, corrija o `.expected.json` e marque `"_reviewed": true`. Até lá, a imagem não entra na nota.

### Regras do gabarito
- `source`: `comfyui`, `a1111` (inclui Forge), `midjourney` ou `none`.
- `prompt`: o texto positivo que gerou **aquela** imagem. Em workflows com vários geradores, vale o do nó ligado ao SaveImage cujo prefixo bate com o nome do arquivo. Se o texto só existe em tempo de execução, vale o último texto fixo digitado pelo usuário. Se não há nenhum, use `""`.
- Os outros campos (`model`, `seed`, `steps`, `cfg`, `guidance`, `sampler`, `scheduler`, `denoise`, `width`, `height`, `loras`) só entram se estiverem gravados no arquivo. Campo ausente no gabarito não conta na nota.
- `model` e `loras` são comparados sem pasta, sem extensão e sem diferenciar maiúsculas.
- O prompt ganha crédito parcial (F1 de palavras). Os demais campos são certo ou errado.

## Conjunto atual (2026-10-26)
- 31 imagens no dev e 17 no holdout. Vêm de `E:\COMFYUI`, `Documents\ComfyUI\output` e `Downloads`: ComfyUI clássico (SD1.5, Flux, Flux Krea, Z-Image, Flux 3 com subgraph), nós de API (Gemini, Seedream, Topaz), Midjourney e imagens sem metadados.
- `synth_*` são sintéticas, para formatos que não estavam no disco: WEBP do ComfyUI, A1111 em PNG e JPG, Forge com Flux. O JPG usa `UserComment` com cabeçalho ASCII; o A1111 real grava em UNICODE.
- Gabaritos revisados pelo Claude. Vale conferir os de nós de API e o do subgraph.
- **Falta**: imagens reais de A1111, Forge, Fooocus, InvokeAI, NovelAI, SwarmUI e Civitai, e WEBP/JPG reais do ComfyUI.
