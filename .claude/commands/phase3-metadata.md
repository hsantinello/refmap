# Fase 3 — Extração de Metadados

Lê automaticamente os metadados de geração dos arquivos de imagem (ComfyUI, A1111, Midjourney).

## Objetivo

Imagens do ComfyUI, A1111 e Midjourney mostram tags automaticamente ao serem importadas. Badge `🔗` indica metadados reais. Imagens sem metadados ficam marcadas como "pendente de análise IA".

## Dependências

```bash
npm install exifr sharp
npm install @types/sharp --save-dev
```

**Importante:** `sharp` e `exifr` rodam no processo **main** (Node.js), nunca no renderer.

## Tarefas

### 1. Dispatcher de metadados

Criar `src/main/metadata/index.ts`:

```ts
export async function extractMetadata(imagePath: string): Promise<ExtractionResult> {
  const raw = await readImageChunks(imagePath)  // usa exifr
  
  if (isComfyUI(raw)) return parseComfyUI(raw)
  if (isA1111(raw))   return parseA1111(raw)
  if (isMidjourney(raw)) return parseMidjourney(raw)
  
  return { source: 'none', tags: {}, rawText: null }
}
```

### 2. Leitura de chunks PNG com exifr

```ts
import exifr from 'exifr'

async function readImageChunks(imagePath: string) {
  // exifr lê todos os segmentos de metadados
  const parsed = await exifr.parse(imagePath, {
    userComment: true,
    xmp: true,
    tiff: true,
    ifd1: true,
    // chunks raw para PNG:
    pngText: true,
  })
  return parsed
}
```

### 3. Parser ComfyUI

`src/main/metadata/comfyui.ts`

Detecção: chunk `prompt` contém JSON com estrutura de workflow (nós com `class_type`).

```ts
function isComfyUI(raw: any): boolean {
  try {
    const prompt = raw?.prompt || raw?.workflow
    if (!prompt) return false
    const parsed = JSON.parse(prompt)
    // ComfyUI workflows têm objetos com class_type
    return Object.values(parsed).some((node: any) => node?.class_type)
  } catch { return false }
}

function parseComfyUI(raw: any): ExtractionResult {
  const workflow = JSON.parse(raw.prompt || raw.workflow)
  // Extrair do nó CLIPTextEncode (positive prompt)
  // Extrair do nó KSampler (seed, steps, cfg, sampler_name)
  // Extrair do nó CheckpointLoaderSimple (ckpt_name = modelo)
  
  // Categorizar tags do positive prompt
  const tags = categorizePromptText(positivePrompt)
  return { source: 'comfyui', tags, rawText: positivePrompt, params: { seed, steps, sampler, model } }
}
```

Nós relevantes a procurar no workflow:
- `CLIPTextEncode` com input de `KSampler.positive` → prompt positivo
- `KSampler` → `seed`, `steps`, `cfg`, `sampler_name`, `scheduler`
- `CheckpointLoaderSimple` → `ckpt_name`

### 4. Parser Automatic1111

`src/main/metadata/a1111.ts`

Detecção: chunk `parameters` começa com o prompt e contém `Negative prompt:` e `Steps:`.

```ts
function isA1111(raw: any): boolean {
  const params = raw?.parameters || raw?.Parameters
  return typeof params === 'string' && params.includes('Steps:') && params.includes('Sampler:')
}

function parseA1111(raw: any): ExtractionResult {
  const text = raw.parameters
  // Formato:
  // <positive prompt>
  // Negative prompt: <negative>
  // Steps: 20, Sampler: DPM++ 2M, CFG scale: 7, Seed: 123456, Model: v1-5-pruned
  
  const [promptSection, ...rest] = text.split('Negative prompt:')
  const positivePrompt = promptSection.trim()
  const paramsLine = rest.join('').split('\n').find(l => l.includes('Steps:')) || ''
  
  const tags = categorizePromptText(positivePrompt)
  return { source: 'a1111', tags, rawText: positivePrompt, params: extractA1111Params(paramsLine) }
}
```

### 5. Parser Midjourney

`src/main/metadata/midjourney.ts`

Detecção: chunk `Description` contém `--v` ou `--ar` ou começa com prompt Midjourney típico.

```ts
function isMidjourney(raw: any): boolean {
  const desc = raw?.Description || raw?.description
  return typeof desc === 'string' && (desc.includes(' --') || desc.includes('Job ID:'))
}

function parseMidjourney(raw: any): ExtractionResult {
  const text = raw.Description
  // Separar prompt dos parâmetros
  // Tudo antes do primeiro " --" é o prompt
  const paramStart = text.search(/ --\w/)
  const promptText = paramStart > -1 ? text.slice(0, paramStart) : text
  
  // Extrair parâmetros: --v 6.1 --ar 16:9 --style raw --chaos 0
  const params = extractMidjourneyParams(text)
  
  const tags = categorizePromptText(promptText)
  return { source: 'midjourney', tags, rawText: promptText, params }
}
```

### 6. Categorização de texto de prompt

`src/main/metadata/categorizer.ts`

Função que recebe texto livre e retorna tags por categoria:

```ts
const STYLE_KEYWORDS = ['cinematic', 'hyperrealistic', 'painterly', 'anime', 'photorealistic', '8k', 'detailed', 'illustration', ...]
const LIGHTING_KEYWORDS = ['golden hour', 'soft light', 'dramatic lighting', 'rim light', 'backlit', 'studio lighting', ...]
const COMPOSITION_KEYWORDS = ['close-up', 'portrait', 'wide shot', 'aerial view', 'macro', 'shallow depth of field', ...]
const COLOR_KEYWORDS = ['warm tones', 'desaturated', 'vibrant', 'monochrome', 'pastel', 'high contrast', ...]
const MOOD_KEYWORDS = ['melancholic', 'dramatic', 'peaceful', 'ethereal', 'dark', 'whimsical', ...]

export function categorizePromptText(text: string): TagsByCategory {
  // Split por vírgulas e identificar palavras-chave
  // Retornar { style: [], lighting: [], composition: [], color: [], mood: [], subject: [] }
}
```

Para `subject`: tudo que não se enquadra nas outras categorias e parece ser substantivo.

### 7. IPC para extração

```ts
ipcMain.handle('image:extractMetadata', async (_, imagePath: string) => {
  return await extractMetadata(imagePath)
})
```

Chamar após adicionar node ao canvas (Fase 2) e atualizar o node com as tags retornadas.

### 8. Exibição no ImageNode

No `ImageNode.tsx`, renderizar tags por categoria:

```tsx
const categoryColors = {
  style: 'bg-purple-500/20 text-purple-300',
  lighting: 'bg-yellow-500/20 text-yellow-300',
  composition: 'bg-blue-500/20 text-blue-300',
  color: 'bg-pink-500/20 text-pink-300',
  mood: 'bg-indigo-500/20 text-indigo-300',
  subject: 'bg-green-500/20 text-green-300',
}
```

Badge de origem:
- `🔗` para source: 'comfyui' | 'a1111' | 'midjourney'
- `✨` para source: 'ai'
- Spinner para isPending: true

## Verificação

- Importar PNG gerada pelo ComfyUI → tags aparecem com `🔗`
- Importar PNG gerada pelo A1111 → tags aparecem com `🔗`
- Importar imagem do Midjourney (download via site) → tags com `🔗`
- Importar JPEG qualquer sem metadados → node marcado como "pendente" sem crash

## Arquivos principais

- `src/main/metadata/index.ts`
- `src/main/metadata/comfyui.ts`
- `src/main/metadata/a1111.ts`
- `src/main/metadata/midjourney.ts`
- `src/main/metadata/categorizer.ts`
