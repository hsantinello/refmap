# Fase 6 — Persistência de Dados

Salva e carrega o estado completo do canvas entre sessões usando SQLite.

## Objetivo

O app lembra tudo entre sessões. Fechar e reabrir restaura o canvas exatamente como estava. Suporte a múltiplos canvases.

## Tarefas

### 1. Schema SQLite completo

`src/main/db.ts` — criar todas as tabelas na inicialização:

```ts
import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'

const dbPath = path.join(app.getPath('userData'), 'refmap.db')
export const db = new Database(dbPath)

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS canvases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Canvas',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      image_path TEXT NOT NULL,
      position_x REAL NOT NULL DEFAULT 0,
      position_y REAL NOT NULL DEFAULT 0,
      width REAL NOT NULL DEFAULT 200,
      height REAL NOT NULL DEFAULT 200,
      metadata_source TEXT NOT NULL DEFAULT 'none',
      FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'metadata',
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_cache (
      image_path TEXT PRIMARY KEY,
      tags_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `)
  
  // Criar canvas padrão se não existir
  const existing = db.prepare('SELECT id FROM canvases LIMIT 1').get()
  if (!existing) {
    db.prepare('INSERT INTO canvases VALUES (?, ?, ?, ?)').run(
      crypto.randomUUID(), 'Meu Canvas', Date.now(), Date.now()
    )
  }
}
```

### 2. Queries de canvas

```ts
// CRUD de canvases
export const canvasQueries = {
  getAll: () => db.prepare('SELECT * FROM canvases ORDER BY updated_at DESC').all(),
  getById: (id: string) => db.prepare('SELECT * FROM canvases WHERE id = ?').get(id),
  create: (name: string) => {
    const id = crypto.randomUUID()
    const now = Date.now()
    db.prepare('INSERT INTO canvases VALUES (?, ?, ?, ?)').run(id, name, now, now)
    return id
  },
  rename: (id: string, name: string) =>
    db.prepare('UPDATE canvases SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id),
  delete: (id: string) =>
    db.prepare('DELETE FROM canvases WHERE id = ?').run(id),
  touch: (id: string) =>
    db.prepare('UPDATE canvases SET updated_at = ? WHERE id = ?').run(Date.now(), id),
}
```

### 3. Queries de nodes

```ts
export const nodeQueries = {
  getByCanvas: (canvasId: string) =>
    db.prepare('SELECT * FROM nodes WHERE canvas_id = ?').all(canvasId),
  
  upsert: (node: NodeRecord) =>
    db.prepare(`
      INSERT INTO nodes (id, canvas_id, image_path, position_x, position_y, width, height, metadata_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        position_x = excluded.position_x,
        position_y = excluded.position_y,
        width = excluded.width,
        height = excluded.height,
        metadata_source = excluded.metadata_source
    `).run(node.id, node.canvasId, node.imagePath, node.x, node.y, node.width, node.height, node.source),
  
  updatePosition: (id: string, x: number, y: number) =>
    db.prepare('UPDATE nodes SET position_x = ?, position_y = ? WHERE id = ?').run(x, y, id),
  
  updateSize: (id: string, width: number, height: number) =>
    db.prepare('UPDATE nodes SET width = ?, height = ? WHERE id = ?').run(width, height, id),
  
  delete: (id: string) =>
    db.prepare('DELETE FROM nodes WHERE id = ?').run(id),
}
```

### 4. Queries de tags

```ts
export const tagQueries = {
  getByNode: (nodeId: string) =>
    db.prepare('SELECT * FROM tags WHERE node_id = ?').all(nodeId),
  
  getByCanvas: (canvasId: string) =>
    db.prepare(`
      SELECT t.* FROM tags t
      JOIN nodes n ON n.id = t.node_id
      WHERE n.canvas_id = ?
    `).all(canvasId),
  
  insertMany: (nodeId: string, tags: TagRecord[]) => {
    const stmt = db.prepare('INSERT OR REPLACE INTO tags VALUES (?, ?, ?, ?, ?)')
    const insertAll = db.transaction((tags: TagRecord[]) => {
      for (const tag of tags) stmt.run(tag.id, nodeId, tag.category, tag.value, tag.source)
    })
    insertAll(tags)
  },
  
  deleteByNode: (nodeId: string) =>
    db.prepare('DELETE FROM tags WHERE node_id = ?').run(nodeId),
}
```

### 5. IPC para persistência

```ts
// Carregar canvas completo (nodes + tags)
ipcMain.handle('canvas:load', (_, canvasId: string) => {
  const nodes = nodeQueries.getByCanvas(canvasId)
  const tags = tagQueries.getByCanvas(canvasId)
  return { nodes, tags }
})

// Salvar posição do node (throttle no renderer para não sobrecarregar)
ipcMain.handle('node:updatePosition', (_, id: string, x: number, y: number) => {
  nodeQueries.updatePosition(id, x, y)
  return true
})

// Salvar novo node
ipcMain.handle('node:create', (_, node: NodeRecord) => {
  nodeQueries.upsert(node)
  return true
})

// Deletar node
ipcMain.handle('node:delete', (_, id: string) => {
  nodeQueries.delete(id)
  return true
})

// Salvar tags de um node
ipcMain.handle('node:saveTags', (_, nodeId: string, tags: TagRecord[]) => {
  tagQueries.deleteByNode(nodeId)
  tagQueries.insertMany(nodeId, tags)
  return true
})

// CRUD de canvases
ipcMain.handle('canvas:list', () => canvasQueries.getAll())
ipcMain.handle('canvas:create', (_, name: string) => canvasQueries.create(name))
ipcMain.handle('canvas:rename', (_, id: string, name: string) => canvasQueries.rename(id, name))
ipcMain.handle('canvas:delete', (_, id: string) => canvasQueries.delete(id))
```

### 6. Auto-save de posição dos nodes

No renderer, usar debounce ao mover nodes:

```ts
import { debounce } from 'lodash-es'  // ou implementar manual

const savePosition = debounce((id: string, x: number, y: number) => {
  window.api.updateNodePosition(id, x, y)
}, 500)

// Em onNodeDragStop do React Flow:
const onNodeDragStop = (_: MouseEvent, node: Node) => {
  savePosition(node.id, node.position.x, node.position.y)
}
```

### 7. Carregar canvas ao iniciar

No `App.tsx`:

```ts
useEffect(() => {
  const loadCanvas = async () => {
    // Pegar último canvas aberto (salvo em settings)
    const lastCanvasId = await window.api.getSetting('lastCanvasId')
    const canvases = await window.api.listCanvases()
    
    const canvasId = lastCanvasId || canvases[0]?.id
    if (!canvasId) return
    
    const { nodes, tags } = await window.api.loadCanvas(canvasId)
    // Reconstruir estado do React Flow a partir dos dados do SQLite
    setNodes(nodes.map(dbNodeToFlowNode(tags)))
    setCurrentCanvasId(canvasId)
  }
  loadCanvas()
}, [])
```

### 8. Seletor de canvases

Na TopBar ou sidebar, adicionar:
- Lista de canvases
- Botão "+" para criar novo
- Clique duplo para renomear
- Botão de delete com confirmação

```tsx
// Simples dropdown na TopBar:
<select onChange={(e) => switchCanvas(e.target.value)} value={currentCanvasId}>
  {canvases.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
</select>
<button onClick={createNewCanvas}>+</button>
```

## Verificação

- Importar imagens, fechar o app, reabrir → canvas restaurado exatamente como estava
- Mover nodes → posições salvas automaticamente (sem botão "salvar")
- Criar novo canvas → começa vazio
- Deletar canvas → confirmação antes de excluir
- Múltiplos canvases funcionam independentemente

## Arquivos principais

- `src/main/db.ts` (schema completo + queries)
- `src/main/ipc/handlers.ts` (IPC de canvas/node/tags)
- `src/renderer/App.tsx` (carregamento inicial)
- `src/renderer/store/index.ts` (currentCanvasId, canvasList)
