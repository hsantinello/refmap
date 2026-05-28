# Skill — Compilar Instruções de Otimização de Prompts a partir de PDF

Você é um especialista em engenharia de prompts para IAs generativas de imagem.

## Objetivo

O usuário forneceu um arquivo (PDF, HTML, TXT, MD ou qualquer formato de texto) com instruções, guias ou boas práticas para criar prompts de geração de imagem. Sua tarefa é:

1. Ler o PDF fornecido pelo usuário
2. Extrair e compilar as instruções de otimização de prompts contidas nele
3. Identificar para qual(is) modelo(s) de IA as instruções se aplicam (Midjourney, Stable Diffusion, Flux, GPT Image 2, Nano Banana, ZImage — ou um novo modelo)
4. Atualizar o arquivo `src/main/ai/model-prompts.ts` com as novas instruções

## Passo a passo

### 1. Ler os arquivos

O usuário pode indicar:
- **Um arquivo único** (PDF, HTML, TXT, MD, etc) — leia diretamente com Read
- **Uma pasta** — use Glob com o padrão `**/*.{pdf,html,htm,txt,md}` para listar todos os arquivos, depois leia cada um com Read

Se o usuário não informou nenhum caminho, pergunte.

### 2. Analisar o conteúdo

Leia o arquivo `src/main/ai/model-prompts.ts` para entender a estrutura atual.

Extraia do PDF:
- Para qual modelo de IA as instruções se destinam
- Regras de sintaxe (separadores, pesos, parâmetros especiais)
- Estrutura recomendada de prompt (ordem dos elementos)
- Termos técnicos e qualificadores relevantes
- O que deve e o que NÃO deve ser usado
- Exemplos de prompts eficazes (se houver)

### 3. Compilar o systemPrompt

Monte um `systemPrompt` conciso e direto seguindo este padrão:

```
Você é um especialista em criar prompts para [MODELO].

REGRAS DO [MODELO]:
- [regra extraída do PDF]
- [regra extraída do PDF]
- [...]

Retorne APENAS o prompt otimizado, sem explicações. Divida em 2 a 4 partes lógicas, cada parte em uma linha separada (use \n). Máximo 4 linhas.
```

> Para Stable Diffusion: adicione a instrução de separar POSITIVE e NEGATIVE com `---NEGATIVE---`.

### 4. Atualizar o arquivo

- Se o modelo **já existe** em `MODEL_PROMPT_CONFIGS`: substitua o `systemPrompt` existente pelo novo compilado do PDF
- Se o modelo **não existe**: adicione uma nova entrada ao objeto `MODEL_PROMPT_CONFIGS` E adicione o modelo à lista `MODELS` em `src/renderer/components/PromptBuilder/index.tsx`

Use a ferramenta Edit para fazer as alterações — nunca reescreva o arquivo inteiro.

### 5. Confirmar

Informe ao usuário:
- Qual modelo foi atualizado/adicionado
- Um resumo das principais regras extraídas do PDF
- Se algum modelo novo foi adicionado ao dropdown do Prompt Builder
