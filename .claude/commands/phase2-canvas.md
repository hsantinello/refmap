# Fase 2 — Canvas Infinito

Implementa o canvas navegável com nodes de imagem usando React Flow.

## Objetivo

Usuário abre o app, arrasta imagens, elas aparecem no canvas como nodes navegáveis e redimensionáveis.

## Dependências

```bash
npm install @xyflow/react
```

## Tarefas

### 1. Estrutura do Canvas

Criar `src/renderer/components/Canvas/index.tsx`:
- `<ReactFlow>` ocupa toda a área disponível (excluindo TopBar e PromptBuilder)
- Desativar controles padrão do React Flow (`controls={false}`)
- Background com padrão de pontos (`<Background variant="dots" />`)
- Registrar tipo de node customizado: `nodeTypes={{ imageNode: ImageNode }}`

### 2. Configurar pan e zoom

```tsx
<ReactFlow
  panOnScroll={false}
  panOnDrag={[1, 2]}        // botão do meio ou drag livre
  zoomOnScroll={true}
  zoomOnPinch={true}
  selectionOnDrag={false}
  // Pan com espaço + arrastar:
  // usar onKeyDown/onKeyUp para alternar cursor e modo pan
>
```

Para espaço + arrastar: detectar `keydown Space` → setar `panOnDrag={true}` temporariamente, `keyup Space` → restaurar.

### 3. Componente ImageNode

Criar `src/renderer/components/Canvas/ImageNode.tsx`:

```tsx
interface ImageNodeData {
  imagePath: string
  tags: Tag[]
  metadataSource: 'comfyui' | 'a1111' | 'midjourney' | 'ai' | 'none'
  isPending: boolean
}
```

Layout do node:
```
┌─────────────────────┐
│   [thumbnail img]   │  ← object-fit: contain
├─────────────────────┤
│ 🔗 style: cinematic │  ← badge + tags clicáveis
│    lighting: soft   │
│    mood: intimate   │
└─────────────────────┘
```

- Thumbnail com `<img src={`file://${imagePath}`} />`
- Mínimo 150px de largura
- `<NodeResizer>` do React Flow para redimensionar

### 4. Drag-and-drop de imagens no canvas

No componente Canvas, adicionar handlers:

```tsx
const onDrop = (e: DragEvent) => {
  e.preventDefault()
  const files = Array.from(e.dataTransfer.files).filter(f =>
    ['image/png', 'image/jpeg', 'image/webp'].includes(f.type)
  )
  // Converter posição de tela para posição do canvas:
  const position = reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY })
  files.forEach((file, i) => {
    addImageNode(file.path, { x: position.x + i * 20, y: position.y + i * 20 })
  })
}
```

### 5. Botão Importar (file picker)

Na TopBar, botão "Importar" chama IPC:
```ts
// main
ipcMain.handle('image:openFilePicker', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  })
  return result.filePaths
})
```

Retornar paths → criar nodes centrados na view atual.

### 6. Estado do canvas com Zustand

Criar `src/renderer/store/index.ts`:

```ts
interface CanvasStore {
  nodes: Node[]
  edges: Edge[]
  addImageNode: (imagePath: string, position: XYPosition) => void
  updateNodeTags: (nodeId: string, tags: Tag[]) => void
}
```

### 7. Nodes redimensionáveis

Usar `<NodeResizer>` do `@xyflow/react`:
```tsx
import { NodeResizer } from '@xyflow/react'
// dentro do ImageNode:
<NodeResizer minWidth={150} minHeight={150} />
```

## Verificação

- Drag-and-drop de múltiplas imagens no canvas funciona
- Imagens aparecem onde foram soltas
- Pan com scroll (botão do meio) e drag funcionam
- Zoom com scroll do mouse funciona
- Nodes são redimensionáveis
- Botão "Importar" abre file picker e adiciona nodes

## Arquivos principais

- `src/renderer/components/Canvas/index.tsx`
- `src/renderer/components/Canvas/ImageNode.tsx`
- `src/renderer/store/index.ts`
- `src/renderer/App.tsx` (layout geral: TopBar + Canvas + PromptBuilder)
