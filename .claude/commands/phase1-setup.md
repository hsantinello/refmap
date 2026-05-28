# Fase 1 — Setup do Projeto Ref Map

Inicializa o esqueleto completo do app Electron + React + Vite para o Ref Map.

## Objetivo

App abre, tem barra superior com toggle always-on-top, janela funcional com controles customizados.

## Tarefas

Execute em ordem:

### 1. Inicializar projeto com electron-vite

```bash
npm create @quick-start/electron@latest refmap -- --template react-ts
cd refmap
npm install
```

### 2. Instalar dependências base

```bash
npm install better-sqlite3 @types/better-sqlite3
npm install tailwindcss @tailwindcss/vite
npm install electron-builder --save-dev
npm install uuid @types/uuid
```

### 3. Configurar Tailwind CSS

Adicionar o plugin Tailwind ao `vite.config.ts` do renderer. Criar `src/renderer/index.css` com `@import "tailwindcss"`.

### 4. Configurar better-sqlite3 no processo main

- `better-sqlite3` é uma dependência nativa — precisa ser compilada para Electron
- Adicionar ao `package.json`:
  ```json
  "build": {
    "extraResources": ["node_modules/better-sqlite3/**"],
    "nativeRebuilder": "sequential"
  }
  ```
- Inicializar DB em `src/main/db.ts` — criar arquivo em AppData (Windows) ou Application Support (Mac)

### 5. Implementar janela principal

Em `src/main/index.ts`:
- `BrowserWindow` com frame: false (janela sem barra nativa)
- Tamanho inicial: 1200x800, minWidth: 900, minHeight: 600
- Always-on-top controlado via IPC

### 6. Controles de janela customizados (TopBar)

Criar `src/renderer/components/TopBar/index.tsx`:
- Botões de fechar, minimizar, maximizar (estilo custom — não usar barra nativa)
- Toggle "Always on Top" com estado visual (●  ativo / ○ inativo)
- Região de drag da janela com `-webkit-app-region: drag`
- Botões dentro da região com `-webkit-app-region: no-drag`

### 7. IPC para controles de janela

Em `src/main/ipc/handlers.ts`:
```ts
ipcMain.handle('window:minimize', () => win.minimize())
ipcMain.handle('window:maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize())
ipcMain.handle('window:close', () => win.close())
ipcMain.handle('window:setAlwaysOnTop', (_, val: boolean) => win.setAlwaysOnTop(val))
```

Em `src/preload/index.ts` expor via `contextBridge.exposeInMainWorld`.

### 8. Configurar electron-builder

Criar `electron-builder.config.ts`:
```ts
export default {
  appId: 'com.refmap.app',
  productName: 'Ref Map',
  directories: { output: 'dist-electron-builder' },
  win: { target: 'nsis' },
  mac: { target: 'dmg' },
}
```

## Verificação

- `npm run dev` → app abre sem erros
- Toggle always-on-top funciona
- Botões de janela (fechar, minimizar, maximizar) funcionam
- `npm run build` → gera executável sem erros de native modules

## Arquivos principais criados

- `src/main/index.ts`
- `src/main/db.ts`
- `src/main/ipc/handlers.ts`
- `src/preload/index.ts`
- `src/renderer/components/TopBar/index.tsx`
- `electron-builder.config.ts`
