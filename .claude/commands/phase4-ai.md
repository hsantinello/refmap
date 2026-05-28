# Fase 4 — Integração com IA

Analisa imagens sem metadados usando a API de visão do usuário (Anthropic ou OpenAI).

## Objetivo

Imagens sem metadados reconhecidos são analisadas automaticamente e recebem tags categorizadas com badge `✨`. Resultado cacheado localmente — nunca chama a API duas vezes para a mesma imagem.

## Dependências

```bash
npm install @anthropic-ai/sdk openai
```

## Tarefas

### 1. Tela de configurações

Criar `src/renderer/components/Settings/index.tsx` — modal aberto via botão "API Key" na TopBar:

```tsx
// Campos:
// - Provider: Anthropic | OpenAI (radio ou select)
// - API Key: input type="password"
// - Botão "Salvar"
// - Botão "Testar conexão" (faz chamada mínima para validar)
```

### 2. Salvar API key com safeStorage do Electron

```ts
// src/main/ipc/handlers.ts
import { safeStorage } from 'electron'

ipcMain.handle('settings:setApiKey', (_, provider: string, key: string) => {
  const encrypted = safeStorage.encryptString(key)
  // Salvar buffer como hex no SQLite:
  db.prepare('INSERT OR REPLACE INTO settings VALUES (?, ?)').run(
    `apiKey_${provider}`,
    encrypted.toString('hex')
  )
})

ipcMain.handle('settings:getApiKey', (_, provider: string) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`apiKey_${provider}`)
  if (!row) return null
  const buf = Buffer.from(row.value, 'hex')
  return safeStorage.decryptString(buf)
})
```

Adicionar tabela `settings` ao schema SQLite:
```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

### 3. Chamada à API Anthropic (claude-haiku-4-5)

`src/main/ai/anthropic.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'

const VISION_PROMPT = `Analyze this AI-generated image and return a JSON object with these exact categories:
{
  "style": [],
  "lighting": [],
  "composition": [],
  "color": [],
  "mood": [],
  "subject": []
}

Each array should contain 2-5 descriptive tags that would work as prompt keywords.
Return ONLY the JSON, no explanation.`

export async function analyzeWithAnthropic(imagePath: string, apiKey: string): Promise<TagsByCategory> {
  const client = new Anthropic({ apiKey })
  
  const imageBuffer = fs.readFileSync(imagePath)
  const base64 = imageBuffer.toString('base64')
  const ext = path.extname(imagePath).slice(1).toLowerCase()
  const mediaType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}` as any
  
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: VISION_PROMPT }
      ]
    }]
  })
  
  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  return JSON.parse(text)
}
```

### 4. Chamada à API OpenAI (gpt-4o-mini)

`src/main/ai/openai.ts`:

```ts
import OpenAI from 'openai'

export async function analyzeWithOpenAI(imagePath: string, apiKey: string): Promise<TagsByCategory> {
  const client = new OpenAI({ apiKey })
  
  const imageBuffer = fs.readFileSync(imagePath)
  const base64 = imageBuffer.toString('base64')
  const ext = path.extname(imagePath).slice(1).toLowerCase()
  const dataUrl = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${base64}`
  
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
        { type: 'text', text: VISION_PROMPT }  // mesmo prompt da Anthropic
      ]
    }]
  })
  
  return JSON.parse(response.choices[0].message.content || '{}')
}
```

### 5. IPC para análise de imagem

```ts
ipcMain.handle('image:analyzeWithAI', async (_, imagePath: string) => {
  // 1. Verificar cache no SQLite
  const cached = db.prepare(
    'SELECT tags_json FROM ai_cache WHERE image_path = ?'
  ).get(imagePath)
  if (cached) return JSON.parse(cached.tags_json)
  
  // 2. Obter API key configurada
  const provider = getSettingValue('aiProvider') || 'anthropic'
  const apiKey = getDecryptedApiKey(provider)
  if (!apiKey) throw new Error('API key not configured')
  
  // 3. Chamar API
  const tags = provider === 'anthropic'
    ? await analyzeWithAnthropic(imagePath, apiKey)
    : await analyzeWithOpenAI(imagePath, apiKey)
  
  // 4. Cachear resultado
  db.prepare(
    'INSERT OR REPLACE INTO ai_cache VALUES (?, ?, ?)'
  ).run(imagePath, JSON.stringify(tags), Date.now())
  
  return tags
})
```

Tabela de cache:
```sql
CREATE TABLE IF NOT EXISTS ai_cache (
  image_path TEXT PRIMARY KEY,
  tags_json TEXT,
  created_at INTEGER
);
```

### 6. Fluxo no renderer

Após importar imagem sem metadados (source: 'none'):
1. Node exibe spinner `⏳`
2. Chamar `window.api.analyzeWithAI(imagePath)`
3. Sucesso → atualizar node com tags + badge `✨`
4. Erro de API key → toast "Configure sua API key nas configurações"
5. Erro de créditos → toast "Sem créditos na API. Verifique sua conta."

### 7. Tratamento de erros

```ts
// No renderer, envolver chamada:
try {
  const tags = await window.api.analyzeWithAI(imagePath)
  updateNodeTags(nodeId, tags, 'ai')
} catch (err: any) {
  if (err.message?.includes('401') || err.message?.includes('invalid_api_key')) {
    showToast('API key inválida. Verifique nas configurações.', 'error')
  } else if (err.message?.includes('insufficient_quota') || err.message?.includes('429')) {
    showToast('Sem créditos na API. Verifique sua conta.', 'error')
  } else if (err.message?.includes('not configured')) {
    showToast('Configure sua API key para analisar imagens sem metadados.', 'warning')
  } else {
    showToast(`Erro ao analisar imagem: ${err.message}`, 'error')
  }
  updateNodeStatus(nodeId, 'error')
}
```

## Verificação

- Settings modal abre e salva API key
- Importar imagem sem metadados (JPEG qualquer) → spinner aparece → tags com `✨`
- Fechar e reabrir → mesma imagem não chama API novamente (cache funciona)
- API key inválida → mensagem de erro clara
- Sem API key configurada → mensagem orientando configuração

## Arquivos principais

- `src/main/ai/anthropic.ts`
- `src/main/ai/openai.ts`
- `src/renderer/components/Settings/index.tsx`
