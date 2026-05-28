# Ref Map — Plano de Implementação
**Data:** 2026-05-21

---

## Visão Geral das Fases

```
Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 5 → Fase 6 → Fase 7
Setup    Canvas   Metadata   IA       Prompt   Persist  Distrib
```

---

## Fase 1 — Setup do Projeto

**Objetivo:** esqueleto funcional do app Electron com React rodando.

### Tarefas
- [ ] Inicializar projeto com `electron-vite` (Electron + React + Vite)
- [ ] Configurar Tailwind CSS
- [ ] Configurar `better-sqlite3` no processo main do Electron
- [ ] Configurar `electron-builder` para gerar `.exe` (Windows) e `.dmg` (Mac)
- [ ] Implementar janela principal com always-on-top toggle na barra superior
- [ ] Implementar controles básicos de janela (minimizar, maximizar, fechar) com estilo customizado

**Entregável:** app abre, tem barra superior com toggle always-on-top, janela funcional.

---

## Fase 2 — Canvas Infinito

**Objetivo:** canvas navegável com suporte a nodes de imagem.

### Tarefas
- [ ] Integrar `React Flow` para canvas infinito
- [ ] Implementar pan com espaço + arrastar e zoom com scroll
- [ ] Criar componente `ImageNode` — exibe thumbnail da imagem
- [ ] Implementar drag-and-drop de imagens direto no canvas (múltiplas de uma vez)
- [ ] Implementar botão "Importar" que abre file picker (PNG, JPG, WEBP)
- [ ] Imagens posicionadas onde foram soltas no canvas
- [ ] Nodes redimensionáveis

**Entregável:** usuário abre o app, arrasta imagens, elas aparecem no canvas como nodes navegáveis.

---

## Fase 3 — Extração de Metadados

**Objetivo:** ler automaticamente os metadados de geração dos arquivos de imagem.

### Tarefas
- [ ] Integrar `exifr` para leitura de chunks PNG
- [ ] Integrar `sharp` para leitura de metadados de imagem
- [ ] Implementar parser de **ComfyUI** — extrai workflow JSON do chunk `prompt`, parseia: prompt positivo, modelo, seed, sampler, steps
- [ ] Implementar parser de **Automatic1111** — extrai do chunk `parameters`: prompt, negative prompt, seed, CFG scale, modelo, sampler
- [ ] Implementar parser de **Midjourney** — extrai do chunk `Description`: prompt completo + parâmetros (`--v`, `--ar`, `--style`, etc.)
- [ ] Implementar categorização das tags extraídas em: `style`, `lighting`, `composition`, `color`, `mood`, `subject`
- [ ] Exibir tags categorizadas abaixo de cada ImageNode com badge `🔗`
- [ ] Para imagens sem metadados reconhecidos: marcar como "pendente de análise IA"

**Entregável:** imagens do ComfyUI, A1111 e Midjourney mostram tags automaticamente ao serem importadas.

---

## Fase 4 — Integração com IA

**Objetivo:** analisar automaticamente imagens sem metadados usando a API do usuário.

### Tarefas
- [ ] Criar tela de configurações com campo para API key (Anthropic ou OpenAI)
- [ ] Salvar API key localmente com criptografia (`safeStorage` do Electron)
- [ ] Implementar chamada à API de visão da Anthropic (`claude-haiku-4-5` — barato e rápido)
- [ ] Implementar chamada à API de visão da OpenAI (`gpt-4o-mini` — alternativa)
- [ ] Prompt estruturado que retorna JSON com tags por categoria
- [ ] Cachear resultado localmente no SQLite (nunca chamar a API duas vezes para a mesma imagem)
- [ ] Exibir tags com badge `✨` para indicar origem IA
- [ ] Tratar erros de API key inválida ou sem créditos com mensagem clara

**Entregável:** imagens sem metadados são analisadas automaticamente e recebem tags categorizadas com badge ✨.

---

## Fase 5 — Prompt Builder

**Objetivo:** painel lateral onde o usuário compõe prompts clicando nas tags.

### Tarefas
- [ ] Criar painel fixo à direita do canvas
- [ ] Clique em tag no node → tag aparece no Prompt Builder
- [ ] Tags acumuladas formam uma string de prompt separada por vírgulas
- [ ] Drag-and-drop para reordenar tags no painel
- [ ] Clique duplo na tag para editar o texto inline
- [ ] Botão "Copy" — copia o prompt completo para clipboard
- [ ] Botão "Clear" — limpa o Prompt Builder
- [ ] Highlight visual na tag quando ela já está no Prompt Builder

**Entregável:** usuário clica em tags de diferentes nodes, monta um prompt no painel e copia com um clique.

---

## Fase 6 — Persistência de Dados

**Objetivo:** salvar e carregar o estado do canvas entre sessões.

### Schema SQLite

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
  category TEXT,
  value TEXT,
  source TEXT, -- 'metadata' | 'ai'
  FOREIGN KEY (node_id) REFERENCES nodes(id)
);
```

### Tarefas
- [ ] Criar schema e migrations do SQLite
- [ ] Auto-salvar posição dos nodes quando movidos no canvas
- [ ] Carregar canvas ao abrir o app (último canvas aberto)
- [ ] Suporte a múltiplos canvases (lista lateral ou menu)
- [ ] Criar novo canvas, renomear, deletar

**Entregável:** o app lembra tudo entre sessões. Fechar e reabrir restaura o canvas exatamente como estava.

---

## Fase 7 — Polimento e Distribuição

**Objetivo:** app pronto para venda e distribuição.

### Tarefas
- [ ] Aplicar logo `LOGO_sem fundo.png` como ícone do app (`.ico` para Windows, `.icns` para Mac)
- [ ] Tela de onboarding para novos usuários (3 passos: importar imagem, ver tags, copiar prompt)
- [ ] Tela de "Sobre" com versão e link de suporte
- [ ] Configurar `electron-builder` com:
  - Nome: "Ref Map"
  - ID: `com.refmap.app`
  - Targets: NSIS (Windows installer) + DMG (Mac)
- [ ] Testar instalação limpa no Windows e Mac
- [ ] Implementar verificação de licença simples (chave de ativação gerada na compra)
- [ ] Configurar Gumroad ou Lemon Squeezy para venda e geração de licenças

**Entregável:** instalador `.exe` e `.dmg` funcionais, pronto para venda.

---

## Ordem de Prioridade

As fases 1-5 formam o MVP funcional. Fase 6 é necessária para o produto ser utilizável no dia a dia. Fase 7 é necessária para distribuição.

**Sequência recomendada:** 1 → 2 → 3 → 5 → 4 → 6 → 7

> Fase 5 (Prompt Builder) antes da Fase 4 (IA) porque o fluxo principal do produto já funciona com metadados reais — a IA é um enhancement, não o core.

---

## Estimativa

| Fase | Complexidade |
|---|---|
| 1 — Setup | Baixa |
| 2 — Canvas | Média |
| 3 — Metadados | Média |
| 4 — IA | Baixa |
| 5 — Prompt Builder | Média |
| 6 — Persistência | Média |
| 7 — Distribuição | Baixa |

Com Claude Code como principal ferramenta de desenvolvimento, o MVP (fases 1–6) é construível em 2–4 semanas de trabalho focado.
