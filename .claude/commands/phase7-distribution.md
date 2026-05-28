# Fase 7 — Polimento e Distribuição

Prepara o app para venda e distribuição: branding, onboarding, licença e empacotamento.

## Objetivo

Instalador `.exe` (Windows) e `.dmg` (Mac) funcionais, pronto para venda no Gumroad ou Lemon Squeezy.

## Tarefas

### 1. Ícone do app

Converter `LOGO_sem fundo.png` para os formatos necessários:

```bash
# Windows: precisa de .ico (256x256, 128x128, 64x64, 32x32, 16x16)
# Mac: precisa de .icns

# Usar sharp no processo de build:
npm install --save-dev electron-icon-builder
npx electron-icon-builder --input=assets/LOGO_sem\ fundo.png --output=build/
```

Resultado esperado em `build/`:
- `icon.ico` (Windows)
- `icon.icns` (Mac)
- `icon.png` (Linux / fallback)

### 2. Configurar electron-builder completo

`electron-builder.config.ts`:

```ts
import { defineConfig } from 'electron-builder'

export default defineConfig({
  appId: 'com.refmap.app',
  productName: 'Ref Map',
  copyright: 'Copyright © 2026',
  
  directories: {
    output: 'dist-release',
    buildResources: 'build',
  },
  
  files: [
    'dist/**/*',
    'node_modules/**/*',
    '!node_modules/.cache',
  ],
  
  extraResources: [
    { from: 'node_modules/better-sqlite3/build/Release/', to: 'native/', filter: '*.node' }
  ],
  
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
  },
  
  nsis: {
    oneClick: false,           // instalador com wizard
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Ref Map',
  },
  
  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    icon: 'build/icon.icns',
    category: 'public.app-category.graphics-design',
  },
  
  dmg: {
    title: 'Ref Map',
    background: 'build/dmg-background.png',  // opcional
  },
})
```

### 3. Tela de onboarding

Criar `src/renderer/components/Onboarding/index.tsx` — exibida na primeira execução:

```
┌─────────────────────────────────────────┐
│             Bem-vindo ao Ref Map        │
│                                         │
│  1. Importe imagens de referência       │
│     [ilustração: drag-and-drop]         │
│                                         │
│  2. Veja as tags extraídas              │
│     [ilustração: node com tags]         │
│                                         │
│  3. Copie o prompt pronto               │
│     [ilustração: prompt builder]        │
│                                         │
│           [Começar agora →]             │
└─────────────────────────────────────────┘
```

3 slides simples. Salvar `onboardingCompleted: true` em settings ao clicar em "Começar agora".

```ts
// Verificar na inicialização:
const onboardingDone = db.prepare(
  "SELECT value FROM settings WHERE key = 'onboardingCompleted'"
).get()
if (!onboardingDone) showOnboarding()
```

### 4. Tela "Sobre"

Modal `src/renderer/components/About/index.tsx`:
- Logo do app
- Nome: Ref Map
- Versão: `app.getVersion()` via IPC
- Link de suporte (email ou página)
- Link para verificar atualizações (manual por ora)

```ts
ipcMain.handle('app:getVersion', () => app.getVersion())
```

### 5. Verificação de licença (simples)

Sistema offline: validar chave de licença contra algoritmo local.

```ts
// src/main/license.ts
import crypto from 'crypto'

const LICENSE_SECRET = 'refmap-2026-secret'  // embutido no app (obfuscado no build)

export function validateLicense(key: string): boolean {
  // Formato: XXXX-XXXX-XXXX-XXXX (16 chars hex + dashes)
  const clean = key.replace(/-/g, '').toLowerCase()
  if (clean.length !== 16) return false
  
  // Verificar HMAC: últimos 4 chars são checksum dos primeiros 12
  const payload = clean.slice(0, 12)
  const checksum = clean.slice(12)
  const expected = crypto
    .createHmac('sha256', LICENSE_SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 4)
  
  return checksum === expected
}

export function generateLicense(): string {
  // Usado pelo script de geração de licenças (não embutido no app)
  const payload = crypto.randomBytes(6).toString('hex')
  const checksum = crypto
    .createHmac('sha256', LICENSE_SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 4)
  const full = `${payload}${checksum}`
  return [0,4,8,12].map(i => full.slice(i, i+4)).join('-').toUpperCase()
}
```

Tela de ativação: exibida se licença não validada. Campo para inserir chave + botão Ativar.

Script separado `scripts/generate-license.ts` para gerar chaves na venda.

### 6. Configurar Gumroad

- Criar produto "Ref Map" com preço $9 (early bird)
- Ativar "Generate unique license keys" no Gumroad
- Webhook ou email automático entrega a chave após compra
- O script `generate-license.ts` pode ser integrado ao workflow de fulfillment

### 7. Scripts de build

`package.json`:
```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "dist:win": "npm run build && electron-builder --win",
    "dist:mac": "npm run build && electron-builder --mac",
    "dist:all": "npm run build && electron-builder --win --mac",
    "gen-license": "tsx scripts/generate-license.ts"
  }
}
```

### 8. Checklist de teste pré-lançamento

- [ ] Instalar o `.exe` em máquina Windows limpa (sem Node.js)
- [ ] Verificar se ícone aparece no instalador e no app instalado
- [ ] Testar drag-and-drop de imagens ComfyUI, A1111, Midjourney
- [ ] Testar análise com API Anthropic e OpenAI
- [ ] Testar persistência: fechar e reabrir → canvas restaurado
- [ ] Testar always-on-top sobre outros apps
- [ ] Testar licença: chave válida ativa, chave inválida rejeitada
- [ ] Testar onboarding na primeira execução
- [ ] Verificar que app não crasha sem internet

## Verificação

- `npm run dist:win` gera `Ref Map Setup.exe` funcional
- Instalação limpa no Windows sem dependências externas
- Ícone aparece no instalador, área de trabalho e barra de tarefas
- Onboarding aparece apenas na primeira execução
- Licença válida ativa, inválida rejeita com mensagem clara

## Arquivos principais

- `electron-builder.config.ts`
- `src/renderer/components/Onboarding/index.tsx`
- `src/renderer/components/About/index.tsx`
- `src/main/license.ts`
- `scripts/generate-license.ts`
- `build/icon.ico`, `build/icon.icns`
