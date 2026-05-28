# Fase 5 — Prompt Builder

Implementa o painel lateral onde o usuário compõe prompts clicando nas tags.

## Objetivo

Usuário clica em tags de diferentes nodes, monta um prompt no painel direito e copia com um clique.

## Dependências

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

## Tarefas

### 1. Estrutura do painel

Criar `src/renderer/components/PromptBuilder/index.tsx`:

Layout:
```
┌─────────────────┐
│  PROMPT BUILDER │
├─────────────────┤
│ [tag1] [tag2]   │
│ [tag3] [tag4]   │
│ ...             │
├─────────────────┤
│ texto gerado:   │
│ tag1, tag2, ... │
├─────────────────┤
│ [Copy] [Clear]  │
└─────────────────┘
```

Largura fixa: 220px, altura: 100% da área de trabalho.

### 2. Estado do Prompt Builder no Zustand

```ts
// src/renderer/store/index.ts
interface PromptBuilderState {
  promptTags: PromptTag[]          // tags na ordem atual
  addTag: (tag: Tag) => void       // adiciona se não existir
  removeTag: (tagId: string) => void
  reorderTags: (oldIndex: number, newIndex: number) => void
  updateTagText: (tagId: string, newText: string) => void
  clearAll: () => void
  getPromptString: () => string    // join com ', '
}

interface PromptTag {
  id: string
  value: string
  category: string
  sourceNodeId: string
}
```

### 3. Clique em tag no ImageNode → adiciona ao Prompt Builder

No `ImageNode.tsx`:

```tsx
const { addTag, promptTags } = usePromptBuilderStore()

const isInPrompt = (tag: Tag) => promptTags.some(t => t.value === tag.value)

// Tag clicável:
<button
  onClick={() => addTag(tag)}
  className={cn(
    'px-2 py-0.5 rounded text-xs transition-all',
    categoryColors[tag.category],
    isInPrompt(tag) && 'ring-1 ring-white/60 opacity-60'  // highlight quando já está no builder
  )}
>
  {tag.value}
</button>
```

Comportamento:
- Clique na tag → adiciona ao PromptBuilder (se não estiver)
- Clique novamente na mesma tag → remove do PromptBuilder
- Tag já adicionada tem visual diferente (highlight/opacidade)

### 4. Lista de tags com drag-and-drop

No PromptBuilder, usar `@dnd-kit/sortable`:

```tsx
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'

function SortableTag({ tag }: { tag: PromptTag }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: tag.id })
  
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
         {...attributes} {...listeners}
         className="flex items-center gap-1 px-2 py-1 bg-white/10 rounded cursor-grab">
      <span className="text-xs">{tag.value}</span>
      <button onClick={() => removeTag(tag.id)} className="text-white/40 hover:text-white/80">×</button>
    </div>
  )
}
```

### 5. Edição inline de tag

Duplo clique na tag → transforma em `<input>` editável:

```tsx
const [editingId, setEditingId] = useState<string | null>(null)

// Na tag:
onDoubleClick={() => setEditingId(tag.id)}

// Renderização condicional:
{editingId === tag.id
  ? <input autoFocus defaultValue={tag.value}
           onBlur={(e) => { updateTagText(tag.id, e.target.value); setEditingId(null) }}
           onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  : <span onDoubleClick={() => setEditingId(tag.id)}>{tag.value}</span>
}
```

### 6. Preview do prompt gerado

Abaixo da lista de tags, mostrar o prompt em texto:

```tsx
const promptString = getPromptString()  // "cinematic, soft light, close-up, warm tones"

<div className="p-2 bg-black/20 rounded text-xs text-white/60 min-h-[60px] font-mono">
  {promptString || <span className="italic">Clique nas tags para compor o prompt...</span>}
</div>
```

### 7. Botões Copy e Clear

```tsx
// Copy:
<button onClick={() => navigator.clipboard.writeText(getPromptString())}>
  Copiar
</button>

// Com feedback visual (1.5s):
const [copied, setCopied] = useState(false)
const handleCopy = () => {
  navigator.clipboard.writeText(getPromptString())
  setCopied(true)
  setTimeout(() => setCopied(false), 1500)
}
// Exibir "Copiado!" por 1.5s ao invés do ícone normal

// Clear:
<button onClick={clearAll}>Limpar</button>
```

### 8. Highlight visual nas tags dos nodes

Quando uma tag já está no PromptBuilder, exibir visualmente diferente no ImageNode:
- Borda ou outline
- Leve opacidade
- Tooltip "clique para remover"

## Layout final no App.tsx

```tsx
<div className="flex flex-col h-screen">
  <TopBar />
  <div className="flex flex-1 overflow-hidden">
    <Canvas className="flex-1" />
    <PromptBuilder className="w-[220px] border-l border-white/10" />
  </div>
</div>
```

## Verificação

- Clicar em tag no node → aparece no PromptBuilder
- Clicar novamente → remove (toggle)
- Drag-and-drop reordena as tags no painel
- Duplo clique edita a tag inline
- Botão Copy copia o prompt com feedback visual
- Botão Clear limpa tudo
- Tags já no builder têm visual diferente nos nodes
- Prompt é join com ", " das tags na ordem atual

## Arquivos principais

- `src/renderer/components/PromptBuilder/index.tsx`
- `src/renderer/store/index.ts` (adicionar PromptBuilderState)
- `src/renderer/components/Canvas/ImageNode.tsx` (tags clicáveis + highlight)
