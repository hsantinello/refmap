# Ref Map — Design Spec
**Data:** 2026-05-21  
**Versão:** 1.0

---

## Visão Geral

**Ref Map** é um app desktop para criadores de conteúdo visual com IA. Funciona como um canvas flutuante (inspirado no PureRef) onde o usuário importa imagens de referência e o app automaticamente extrai os metadados de geração (prompt, modelo, parâmetros). Quando não há metadados, usa a API de visão do próprio usuário para analisar a imagem e gerar tags categorizadas. O usuário clica nas tags para compor novos prompts no Prompt Builder integrado.

**Problema resolvido:** A maior fricção do criador de IA é traduzir inspiração visual em texto que a IA entende. Isso leva meses para aprender. O Ref Map elimina essa curva.

---

## Público-Alvo

**Todo criador que gera imagens com IA** — independente da ferramenta usada.

Exemplos de ferramentas suportadas com extração automática de metadados:
- ComfyUI
- Automatic1111 / SD WebUI Forge
- Midjourney (download via site oficial)

Para imagens de qualquer outra ferramenta (DALL-E, Adobe Firefly, Kling, Hugging Face, etc.) o app usa a API de visão do usuário para gerar tags automaticamente — sem metadados não significa sem valor.

Perfil: criadores que acumulam imagens de referência e querem acelerar a construção de prompts, independente do gerador que usam. Inclui desde iniciantes no Midjourney até power users de ComfyUI.

---

## Plataforma

**App desktop Electron** — Windows e Mac.

Electron é necessário para suportar a funcionalidade de janela always-on-top (flutuar sobre outros apps enquanto o usuário trabalha no ComfyUI, Midjourney, etc.).

---

## Interface

### Layout Principal

```
┌─────────────────────────────────────────────────────────┐
│  [Importar]  [API Key]  [Always on Top ●]    [− □ ×]   │
├─────────────────────────────────────────────────┬───────┤
│                                                 │PROMPT │
│          CANVAS INFINITO                        │BUILDER│
│                                                 │       │
│   ┌──────────┐   ┌──────────┐                  │style, │
│   │  imagem  │   │  imagem  │                  │cinematic│
│   │          │   │          │                  │soft   │
│   ├──────────┤   ├──────────┤                  │light, │
│   │🔗 style  │   │✨ style  │                  │...    │
│   │ cinematic│   │ dramatic │                  │       │
│   │ lighting │   │ portrait │                  ├───────┤
│   │ soft...  │   │ warm...  │                  │[Copy] │
│   └──────────┘   └──────────┘                  │[Clear]│
│                                                 │       │
└─────────────────────────────────────────────────┴───────┘
```

### Canvas
- Infinito, com pan (espaço + arrastar) e zoom (scroll)
- Imagens importadas via drag-and-drop ou botão Importar
- Múltiplas imagens importadas de uma vez

### Nodes (imagens no canvas)
Cada imagem é um node com:
- Thumbnail da imagem (redimensionável)
- Tags categorizadas abaixo: estilo, iluminação, composição, cor, atmosfera, sujeito
- Badge de origem:
  - `🔗` metadados reais extraídos do arquivo
  - `✨` gerado por IA (API do usuário)

### Prompt Builder (painel direito)
- Clique em qualquer tag → adiciona ao Prompt Builder
- Tags acumuladas formam o prompt
- Reordenável via drag
- Editável inline
- Botão Copy e Clear

---

## Extração de Metadados

### Fluxo por imagem importada

```
Imagem importada
      │
      ▼
Lê chunks PNG (exifr + sharp)
      │
      ├── ComfyUI detectado → extrai prompt, modelo, seed, sampler, steps
      │
      ├── A1111 detectado → extrai prompt, negative prompt, CFG, modelo, sampler
      │
      ├── Midjourney detectado → extrai prompt completo + parâmetros (--v, --ar, --style...)
      │
      └── Nenhum encontrado → chama API de visão configurada pelo usuário
                                    │
                                    ▼
                          Retorna JSON com tags por categoria
                          (exibidas com badge ✨)
```

### Formato de resposta da IA

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

## Armazenamento de Dados

**100% local. Nenhum dado enviado a servidores próprios.**

- Banco SQLite em `AppData/RefMap/` (Windows) ou `~/Library/Application Support/RefMap/` (Mac)
- Imagens **não são copiadas** — apenas o caminho do arquivo é salvo
- Canvases, posições dos nodes e tags ficam no SQLite
- API key salva localmente com criptografia gerada na instalação

**Único dado que sai do computador:** quando uma imagem não tem metadados, ela é enviada à API da Anthropic ou OpenAI usando a chave do próprio usuário — idêntico ao usuário fazer isso manualmente no ChatGPT.

---

## Integração com IA

- Usuário configura sua chave da **Anthropic** ou **OpenAI** nas configurações
- O app usa a chave dele para chamadas de visão
- Uma chamada por imagem sem metadados, resultado cacheado localmente
- Sem custo operacional para o desenvolvedor

---

## Stack Técnica

| Camada | Tecnologia |
|---|---|
| Desktop | Electron |
| UI | React + Tailwind CSS |
| Canvas | React Flow |
| Banco | SQLite (better-sqlite3) |
| Metadados | exifr + sharp |
| IA | Anthropic SDK + OpenAI SDK |
| Empacotamento | Electron Builder (gera `.exe` e `.dmg`) |

---

## Monetização

**Pagamento único — sem mensalidade.**

| Fase | Preço | Público |
|---|---|---|
| Early bird (lançamento para audiência existente) | $9 | Inscritos do canal / lista de e-mail |
| Preço padrão | $19 | Público geral |

Sem conta, sem login, sem servidor. O produto gera receita por venda direta.

**Canal de aquisição:** o próprio YouTube do criador documenta a construção do app com Claude Code — gerando conteúdo orgânico para uma nova audiência (Claude Code / vibe coding) enquanto os inscritos atuais se tornam os primeiros clientes.

---

## Fora do Escopo (v1)

- Sincronização em nuvem
- Colaboração multi-usuário
- Suporte a vídeo
- Marketplace de prompts (ideia separada para o futuro)
- Integração com ChatGPT / DALL-E (sem metadados extraíveis)
- Fallback de IA por visão para imagens sem API key configurada
