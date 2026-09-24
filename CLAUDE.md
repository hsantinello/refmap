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

## Idioma da Interface (i18n)

O app roda em **português e inglês**. Dicionário próprio, sem biblioteca — são dois
idiomas e o estado já vive no Zustand.

```
src/shared/i18n/
├── en.ts     # BASE — define quais chaves existem (`I18nKey`)
├── pt.ts     # Record<I18nKey, string> — build QUEBRA se faltar/sobrar chave
└── index.ts  # translate(), normalizeLang() — puro, sem Zustand nem Electron
```

Como usar:

| Onde | O que usar |
|---|---|
| Corpo de componente React | `const t = useT()` — re-renderiza ao trocar idioma |
| Handler, `catch`, código imperativo | `import { t } from '../../i18n'` — lê o idioma na hora |
| Frase com `<span>` no meio | `useTRich('chave', { slot: <span>…</span> })` |
| Processo main | `tm()` de `src/main/i18n.ts` |

**Nunca** escreva texto visível direto no JSX ou em `message:`. Sempre uma chave.

O idioma vive em `appLang` (Zustand) e na tabela `settings`. Na primeira execução o
main resolve pelo idioma do SO (`app.getLocale()`) e o renderer lê via
`window.api.getLang()`. Trocar o idioma avisa o main pelo handler `settings:set`.

### O que NÃO traduzir

É inglês **de propósito** — vocabulário que vai para o modelo de IA:

- **Todo cliente Anthropic nasce em `ai/anthropicClient.ts` (`criarAnthropic`)**,
  nunca `new Anthropic(...)` solto: desde 2026 a API exige o cabeçalho
  `anthropic-workspace-id` para chaves não ligadas a um workspace, e a resposta
  400 NÃO traz o ID (sem descoberta automática). O usuário informa o ID na
  setting `anthropicWorkspaceId` (Configurações → Anthropic) ou cria uma chave
  já dentro de um workspace. `friendlyError` reconhece esse 400.
- `ai/model-prompts.ts` e `ai/visionPrompt.ts` — system prompts das APIs.
  Um perfil de modelo novo do otimizador exige TRÊS lugares em sincronia:
  `MODEL_PROMPT_CONFIGS` + `IMAGE_MODEL_IDS` (se for imagem) em
  `main/ai/model-prompts.ts`, e `MODEL_GROUPS` no `PromptBuilder`. O perfil
  "Qwen Image 2.1" segue o guia oficial: três formatos (texto→imagem; edição
  com "Content to preserve / Requested changes / Consistency / Do not add";
  várias referências abrindo com "Figure 1: … Figure 2: …" na ORDEM de upload).
- `metadata/categorizer.ts` — listas de keywords de classificação
- `lib/tagExamples.ts`

Esses arquivos estão na lista `IGNORADOS` de `scripts/check-i18n.ts`.

**Arquivo ignorado inteiro esconde interface.** Foi o que aconteceu com o
`PromptPresets`: o vocabulário dos presets é inglês por design, mas "Categorias",
"Todas" e "Meus Presets" eram moldura e passaram batido por semanas. A regra
passou a ser: só ignore o arquivo inteiro quando ele NÃO tiver JSX. Tendo, marque
apenas o bloco de dados com `// i18n-ignore-start` / `// i18n-ignore-end` e
mantenha o arquivo em `MIGRADOS`, para o guard vigiar o resto.

### Ferramentas

```bash
npm run check:i18n          # relatório: quanto falta migrar, por arquivo
npm run check:i18n -- --ci  # falha se um arquivo já migrado regrediu
npm run typecheck           # garante que os dois dicionários batem
```

Ao terminar a migração de um arquivo, adicione o caminho em `MIGRADOS` no
`scripts/check-i18n.ts` — a partir daí ele é obrigado a ficar limpo.

### Estado da migração

**Concluída** — 368 chaves, 24 arquivos migrados, `npm run check:i18n` em zero.

O guard roda em modo `--ci` sobre a lista `MIGRADOS`, que hoje cobre todo o
renderer e todo o main. Arquivo novo com texto de interface: acrescente na lista.

### Pendências conhecidas

- **Termos de Uso** (`src/shared/i18n/terms.ts`) — a versão em inglês é tradução
  fiel, mas SEM revisão jurídica. O item de reembolso cita a Hotmart e o prazo de
  7 dias do CDC, que não vale fora do Brasil; também não há cláusula de foro.
- **Changelog remoto** — o sininho mostra as novidades do `changelog.json` no
  idioma do app (campo `items_en`, com fallback para `items`). O que continua em
  português é o corpo da release no GitHub, gerado por `scripts/release-notes.mjs`
  a partir de `items`. Isso só aparece para quem AINDA não atualizou e a release
  tem descrição. **Ao publicar uma versão, preencha `items` e `items_en`.**
- **Correções de segurança entram no changelog de forma GENÉRICA** ("segurança
  do aplicativo aprimorada"), nunca descrevendo a falha corrigida. O changelog é
  público (release do GitHub + sininho) e quem ainda não atualizou continua
  exposto ao que ele descreveria. O detalhe fica só na mensagem de commit.
- **Categorias de tag** (`CAT_LABEL` no PixiCanvas) — já eram inglês nos dois
  idiomas antes desta migração. Mantido como estava.

## Segurança do processo main

**CSP do renderer** (`electron.vite.config.ts`, injetada só no build): `script-src`
sem `'unsafe-eval'`. O PixiJS 8 gera shaders/uniforms com `new Function`, então
`src/renderer/main.tsx` importa `'pixi.js/unsafe-eval'` ANTES de qualquer outra
coisa — sem isso o canvas morre com "Current environment does not allow
unsafe-eval" (foi a v0.0.30, hotfix na 0.0.31). Qualquer teste do canvas precisa
rodar DEPOIS do login; os e2e pré-login não pegam isso. Harness que reproduz:
`scratchpad/pixi-csp` (Pixi real sob a mesma CSP, com e sem o módulo).


Regras em `src/main/security.ts`. A premissa: o que roda na janela do app é
confiável; qualquer outra coisa que consiga ser carregada nela não é.

- **Todo canal IPC usa `handleSeguro`, nunca `ipcMain.handle`.** Ele recusa
  pedidos que não venham do frame principal do app (`IPC_BLOQUEADO`). Canal novo
  registrado com `ipcMain.handle` direto fura essa proteção.
- **A janela não navega nem abre janelas** fora do app (`blindarWebContents`,
  aplicado a todo webContents). Sem isso, soltar um `.html` fora do canvas fazia a
  janela carregá-lo — e a página recebia o `window.api` inteiro.
- **`getApiKey` devolve a chave mascarada** (`sk-ant-…a1b2`). Quem usa a chave de
  verdade é o main. Não crie canal que devolva a chave inteira.
- **`openExternal` só abre `https:` e `mailto:`.**
- **`saveToPath` só grava `.refmap`.**
- **`settings:get/set` recusam `apiKey_*`** — as chaves têm canais próprios.

**Arquivos do disco chegam ao renderer pelo esquema `refmap://`**
(`src/main/media-protocol.ts`), nunca por `file://` — `webSecurity` está ligado.
- `refmap://media/<caminho absoluto encoded>`: só extensões de imagem/vídeo, com
  Range (o `<video>` depende disso). Use `mediaUrl()` de `renderer/lib/mediaUrl.ts`
  e, em `new Image()`, `crossOrigin = 'anonymous'` — senão o canvas contamina.
- `refmap://lib/`: o Whisper (transformers.min.js + .wasm) empacotado via
  `extraResources` no package.json; em dev vem do node_modules. Nada de CDN.

**Arquivos que o app cria são limpos** por `src/main/housekeeping.ts`: no boot
(miniaturas, cenas, colagens e cache que nenhum nó usa) e ao apagar um nó. Regra:
só apaga o que está DENTRO das pastas do app — imagem do usuário nunca é tocada.
Imagem colada vai para `userData/pasted` (não para o temp, que o Windows limpa).

**Janela e handlers:** `registerHandlers`/`initUpdater` rodam uma vez; no
`activate` (macOS) só `setMainWindow`/`setUpdaterWindow` apontam para a janela nova.
Todo canal IPC deve ler `win` da variável de módulo, nunca capturar a janela.

## Integração ComfyUI (painel "ComfyUI" na barra)

- O catálogo NÃO é uma lista fixa: é montado do índice oficial de templates
  (`templates/index.json`), o mesmo acervo do "Browse Templates" do ComfyUI.
  Fonte preferida é o **Comfy Cloud** (`cloud.comfy.org/templates/`, público,
  idêntico ao GitHub `Comfy-Org/workflow_templates`): é sempre o pacote mais novo
  (637 templates em set/2026), enquanto o ComfyUI instalado carrega uma cópia
  congelada da versão dele (0.19.3 → 378). O `/templates/` local é só fallback.
  O MCP do Comfy Cloud exige API key própria e não serve para isso.
- Campos novos do índice usados: `io.outputs[].mediaType` (o que o workflow
  SALVA — critério principal de imagem/vídeo/áudio/3D), `openSource` (false =
  só API), `minComfyUIVersion` (o painel mostra "Precisa do ComfyUI X+" quando o
  ComfyUI detectado é mais antigo). O índice do Cloud NÃO traz `vram`; no do
  ComfyUI local ele é quase sempre igual ao `size`. Logo a VRAM é, na prática,
  estimada pelo download (×0,6; mínimo ×0,55) salvo nas `CURADAS`.
- `src/shared/comfy/catalogo.ts` — puro e testado. `montarCatalogo(indice)` filtra
  o que roda local (`rodaLocal`: fora `api_*`, tag API e `openSource: false`;
  `openSource: true` é palavra final e ENTRA mesmo com size 0 — workflows só de
  nós. A lista de marcas de nuvem `MODELOS_NUVEM` e a regra "sem size/vram" só
  valem quando o índice não declara `openSource` — pacote antigo do ComfyUI.
  Marcas mudam de lado: MiniMax H3 e Ideogram 4 hoje têm pesos abertos, e a
  lista já os barrou por engano uma vez), classifica em imagem/vídeo
  (`tarefaDe`: áudio, 3D e LLM ficam de fora por TAG e por NOME, porque as
  categorias "Getting Started" e "Use Cases" misturam tudo; "Audio to Video" é
  vídeo), agrupa por família (`FAMILIAS`) e
  calcula VRAM: `CURADAS` (15 overrides práticos, fonte `curada`) → campo `vram` do
  índice (bytes → GiB, fonte `comfyui`) → estimativa pelo tamanho (`estimada`).
  `recomendar(receitas, máquina, tarefa, {familia, tag, busca})` — `tarefa` é
  `FiltroTarefa` ('image' | 'video' | 'auto' = sem filtro; o painel abre em
  'auto' e o card mostra Imagens/Vídeo nesse modo) — ordena por
  encaixe → `prioridade` (Image/Video antes de Getting Started/Use Cases/Utility)
  → nota curada → qualidade → velocidade. `miniaturaDe` é sempre
  `<name>-1.<mediaSubtype>`: o campo `thumbnail` do índice aponta para caminhos
  que NÃO são servidos (404 local e no GitHub).
- `src/main/comfyui/hardware.ts` — GPU/VRAM/RAM. Ordem: ComfyUI `/system_stats`
  (VRAM exata; tenta a setting `comfyUrl`, depois :8188 e :8000) → nvidia-smi →
  CIM/system_profiler/lspci (só o nome; o `AdapterRAM` do Windows mente).
- `src/main/comfyui/templates.ts` — fonte do índice, miniaturas e JSON dos
  workflows. Ordem: Comfy Cloud → GitHub → ComfyUI local (`<url>/templates/`).
  Miniaturas e workflows saem da mesma fonte do índice, com as públicas como
  reserva (`fontes()`). **Ao acrescentar campo em `TemplateIndice`, subir
  `VERSAO_CACHE`** e dar default em `normalizar()`: o cache gravado pela versão
  anterior do app não tem o campo, e isso já derrubou o catálogo uma vez (o
  painel mostrava "não foi possível ler o hardware" por causa do índice).
  Hardware, catálogo e download têm erros separados no painel. Índice cacheado 24 h em
  `userData/comfy/templates-index.json` (`forcar` ignora); miniaturas em
  `userData/comfy/thumbs/<name>.<ext>`, no máximo 4 downloads simultâneos,
  60 s de tempo limite e uma segunda tentativa: as prévias de vídeo são webp
  ANIMADOS de 0,5–4 MB (123 MB somando as ~100). Por isso o `Miniatura` do
  painel só pede a prévia quando o card entra na área visível
  (IntersectionObserver) e, se falhar, mostra "clique para tentar de novo".
  Só baixa nomes que existem no índice (`NOME_VALIDO`), e o JSON é validado.
- IPC: `comfy:hardware`, `comfy:templates(forcar)`, `comfy:thumb(name)`,
  `comfy:downloadWorkflow(name)`. Renderer: `components/ComfyPanel` (dropdown
  glass próprio `Seletor`, `Miniatura` via `mediaUrl`). O botão que abre o painel
  é o `ComfyFab` (flutuante, borda direita, meio da altura, montado em
  `App.tsx`; some enquanto um modal está aberto) — NÃO fica na TopBar, que é
  região de arrasto da janela. Marca: `components/LogoComfy.tsx`.
- `src/shared/comfy/descricoesPt.ts` — descrição PT de cada template (o índice
  só traz inglês), chaveada pelo nome. Template novo sem tradução ganha frase
  genérica montada das tags (`descricaoPt`); o teste unitário aponta os que
  faltam. A nota EN continua sendo a descrição oficial.
- Para ajustar a VRAM de um template: entrada em `CURADAS` com o nome exato do
  índice (o teste unitário confere que todas existem).

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
