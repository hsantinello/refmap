# Ref Map — CLAUDE.md

## O que é esse projeto

**Ref Map** é um app desktop Electron para criadores de conteúdo visual com IA. Funciona como um canvas flutuante (inspirado no PureRef) onde o usuário importa imagens de referência e o app automaticamente extrai os metadados de geração (prompt, modelo, parâmetros). Quando não há metadados, usa a API de visão do usuário (Anthropic ou OpenAI) para analisar a imagem e gerar tags categorizadas. O usuário clica nas tags para compor novos prompts no Prompt Builder integrado.

**Problema resolvido:** traduzir inspiração visual em texto que a IA entende é a maior fricção do criador. O Ref Map elimina essa curva.

---

## Stack Técnica

| Camada | Tecnologia |
|---|---|
| Desktop | Electron |
| UI | React + Tailwind CSS |
| Canvas | React Flow |
| Banco | SQLite (better-sqlite3) |
| Metadados | exifr + sharp |
| IA | Anthropic SDK (`claude-haiku-4-5`) + OpenAI SDK (`gpt-4o-mini`) |
| Empacotamento | Electron Builder |
| Build | electron-vite |

---

## Estrutura do Projeto

```
refmap/
├── src/
│   ├── main/                  # Processo main do Electron
│   │   ├── index.ts           # Entry point Electron
│   │   ├── db.ts              # SQLite setup e queries
│   │   ├── metadata/          # Parsers de metadados
│   │   │   ├── index.ts       # Dispatcher (detecta qual parser usar)
│   │   │   ├── comfyui.ts
│   │   │   ├── a1111.ts
│   │   │   └── midjourney.ts
│   │   ├── ai/                # Integração com APIs de visão
│   │   │   ├── anthropic.ts
│   │   │   └── openai.ts
│   │   └── ipc/               # Handlers IPC (main ↔ renderer)
│   │       └── handlers.ts
│   ├── renderer/              # Processo renderer (React)
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Canvas/        # React Flow canvas
│   │   │   │   ├── index.tsx
│   │   │   │   └── ImageNode.tsx
│   │   │   ├── PromptBuilder/ # Painel lateral direito
│   │   │   │   └── index.tsx
│   │   │   ├── TopBar/        # Barra superior (importar, API key, always-on-top)
│   │   │   │   └── index.tsx
│   │   │   └── Settings/      # Modal de configurações
│   │   │       └── index.tsx
│   │   ├── hooks/
│   │   │   ├── useCanvas.ts
│   │   │   └── usePromptBuilder.ts
│   │   └── store/             # Estado global (Zustand)
│   │       └── index.ts
│   └── preload/
│       └── index.ts           # Expõe APIs seguras ao renderer
├── docs/                      # Documentação do projeto
├── CLAUDE.md
├── package.json
├── electron-builder.config.ts
└── vite.config.ts
```

---

## Arquitetura IPC (Electron)

O renderer **nunca** acessa o filesystem ou SQLite diretamente. Tudo vai via IPC:

```
Renderer → preload.contextBridge → main process
```

Canais IPC principais:
- `image:import` — abre file picker ou recebe paths de drag-drop
- `image:extractMetadata` — roda parsers + fallback IA
- `canvas:save` — persiste estado do canvas
- `canvas:load` — carrega canvas salvo
- `settings:getApiKey` / `settings:setApiKey` — usa `safeStorage` do Electron

---

## Banco de Dados (SQLite)

Schema em `src/main/db.ts`:

```sql
CREATE TABLE canvases (
  id TEXT PRIMARY KEY,
  name TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  canvas_id TEXT,
  image_path TEXT,
  position_x REAL,
  position_y REAL,
  width REAL,
  height REAL,
  metadata_source TEXT, -- 'comfyui' | 'a1111' | 'midjourney' | 'ai' | 'none'
  FOREIGN KEY (canvas_id) REFERENCES canvases(id)
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  node_id TEXT,
  category TEXT,   -- 'style' | 'lighting' | 'composition' | 'color' | 'mood' | 'subject'
  value TEXT,
  source TEXT,     -- 'metadata' | 'ai'
  FOREIGN KEY (node_id) REFERENCES nodes(id)
);
```

---

## Extração de Metadados

Fluxo por imagem importada:
1. `exifr` lê chunks PNG (UserComment, Description, parameters)
2. Detecta origem: ComfyUI → A1111 → Midjourney → fallback IA
3. Tags categorizadas extraídas ou geradas
4. Badge `🔗` para metadados reais, `✨` para gerado por IA

Categorias de tags: `style`, `lighting`, `composition`, `color`, `mood`, `subject`

---

## Integração com IA

- Usuário configura sua chave Anthropic ou OpenAI nas Settings
- Chave salva com `safeStorage` do Electron (criptografia nativa do SO)
- Modelo preferido: `claude-haiku-4-5` (Anthropic) ou `gpt-4o-mini` (OpenAI)
- Resultado cacheado no SQLite — nunca chama a API duas vezes para a mesma imagem
- **Zero custo operacional** para o desenvolvedor

Prompt de visão retorna JSON estruturado:
```json
{
  "style": ["cinematic", "hyperrealistic"],
  "lighting": ["soft diffused", "golden hour"],
  "composition": ["close-up portrait", "shallow depth of field"],
  "color": ["warm tones", "desaturated shadows"],
  "mood": ["melancholic", "intimate"],
  "subject": ["woman", "urban background"]
}
```

---

## Fases de Implementação

Sequência recomendada: **1 → 2 → 3 → 5 → 4 → 6 → 7**

| Fase | Skill | Status |
|---|---|---|
| 1 — Setup | `/phase1-setup` | Pendente |
| 2 — Canvas Infinito | `/phase2-canvas` | Pendente |
| 3 — Extração de Metadados | `/phase3-metadata` | Pendente |
| 5 — Prompt Builder | `/phase5-prompt-builder` | Pendente |
| 4 — Integração IA | `/phase4-ai` | Pendente |
| 6 — Persistência | `/phase6-persistence` | Pendente |
| 7 — Distribuição | `/phase7-distribution` | Pendente |

---

## Princípios de Desenvolvimento

- **100% local** — nenhum dado enviado a servidores próprios
- Imagens **não são copiadas** — apenas o path é salvo no SQLite
- Código de renderer não acessa filesystem diretamente (tudo via IPC)
- Sem servidor, sem conta, sem login — produto de pagamento único
- Electron `safeStorage` para qualquer dado sensível (API keys)

---

## Distribuição

- `electron-builder` → NSIS installer (.exe Windows) + DMG (.dmg Mac)
- App ID: `com.refmap.app`
- Always-on-top: funcionalidade central — flutua sobre ComfyUI, Midjourney, etc.
- Licença: chave de ativação gerada na compra (Gumroad ou Lemon Squeezy)

---

## Contexto de Negócio

- **Público:** criadores que geram imagens com IA (ComfyUI, A1111, Midjourney, etc.)
- **Preço:** $9 early bird → $19 padrão (pagamento único)
- **Canal:** YouTube do criador documenta a construção com Claude Code
- **Fora do escopo v1:** nuvem, colaboração, vídeo, marketplace de prompts
