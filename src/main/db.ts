import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialized')
  return db
}

export function initDb(): void {
  const dbPath = path.join(app.getPath('userData'), 'refmap.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

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

    CREATE INDEX IF NOT EXISTS idx_nodes_canvas_id ON nodes(canvas_id);
    CREATE INDEX IF NOT EXISTS idx_tags_node_id ON tags(node_id);
  `)

  // Migration: add model_name column if missing
  const hasModelName = (db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('nodes') WHERE name='model_name'").get() as { count: number }).count
  if (!hasModelName) {
    db.exec('ALTER TABLE nodes ADD COLUMN model_name TEXT')
  }

  // Migration: add parent_id and node_type columns if missing
  const hasParentId = (db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('nodes') WHERE name='parent_id'").get() as { count: number }).count
  if (!hasParentId) {
    db.exec('ALTER TABLE nodes ADD COLUMN parent_id TEXT')
  }

  const hasNodeType = (db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('nodes') WHERE name='node_type'").get() as { count: number }).count
  if (!hasNodeType) {
    db.exec("ALTER TABLE nodes ADD COLUMN node_type TEXT NOT NULL DEFAULT 'image'")
  }

  // Migration: add comfy_params and linked_node_id for metadata nodes
  const hasComfyParams = (db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('nodes') WHERE name='comfy_params'").get() as { count: number }).count
  if (!hasComfyParams) {
    db.exec('ALTER TABLE nodes ADD COLUMN comfy_params TEXT')
  }

  const hasLinkedNodeId = (db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('nodes') WHERE name='linked_node_id'").get() as { count: number }).count
  if (!hasLinkedNodeId) {
    db.exec('ALTER TABLE nodes ADD COLUMN linked_node_id TEXT')
  }

  const hasThumbnailPath = (db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('nodes') WHERE name='thumbnail_path'").get() as { count: number }).count
  if (!hasThumbnailPath) {
    db.exec('ALTER TABLE nodes ADD COLUMN thumbnail_path TEXT')
  }

  const hasStarred = (db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('nodes') WHERE name='starred'").get() as { count: number }).count
  if (!hasStarred) {
    db.exec('ALTER TABLE nodes ADD COLUMN starred INTEGER NOT NULL DEFAULT 0')
  }

  // Migration: mtime do arquivo no cache de IA. Reexportar a imagem por cima do
  // mesmo caminho passa a invalidar o cache, em vez de devolver as tags da antiga.
  const hasCacheMtime = (db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('ai_cache') WHERE name='mtime'").get() as { count: number }).count
  if (!hasCacheMtime) db.exec('ALTER TABLE ai_cache ADD COLUMN mtime INTEGER')

  // Migration: idioma nativo das tags (en/pt) — para não re-traduzir tags que já
  // foram geradas no idioma alvo
  const hasTagLang = (db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('nodes') WHERE name='tag_lang'").get() as { count: number }).count
  if (!hasTagLang) {
    db.exec("ALTER TABLE nodes ADD COLUMN tag_lang TEXT NOT NULL DEFAULT 'en'")
  }

  // Ensure thumbnails directory exists
  fs.mkdirSync(path.join(app.getPath('userData'), 'thumbnails'), { recursive: true })

  const existing = db.prepare('SELECT id FROM canvases LIMIT 1').get()
  if (!existing) {
    const { randomUUID } = require('crypto')
    db.prepare('INSERT INTO canvases VALUES (?, ?, ?, ?)').run(
      randomUUID(),
      'Meu Canvas',
      Date.now(),
      Date.now()
    )
  }
}

export const canvasQueries = {
  getAll: () => getDb().prepare('SELECT * FROM canvases ORDER BY created_at ASC').all(),
  getById: (id: string) => getDb().prepare('SELECT * FROM canvases WHERE id = ?').get(id),
  create: (name: string) => {
    const { randomUUID } = require('crypto')
    const id = randomUUID()
    const now = Date.now()
    getDb().prepare('INSERT INTO canvases VALUES (?, ?, ?, ?)').run(id, name, now, now)
    return id
  },
  rename: (id: string, name: string) =>
    getDb().prepare('UPDATE canvases SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id),
  delete: (id: string) =>
    getDb().prepare('DELETE FROM canvases WHERE id = ?').run(id),
  touch: (id: string) =>
    getDb().prepare('UPDATE canvases SET updated_at = ? WHERE id = ?').run(Date.now(), id),
}

export const nodeQueries = {
  getByCanvas: (canvasId: string) =>
    getDb().prepare('SELECT * FROM nodes WHERE canvas_id = ?').all(canvasId),
  upsert: (node: {
    id: string; canvasId: string; imagePath: string
    x: number; y: number; width: number; height: number; source: string
    parentId?: string; nodeType?: string; linkedNodeId?: string; comfyParams?: string
  }) =>
    getDb().prepare(`
      INSERT INTO nodes (id, canvas_id, image_path, position_x, position_y, width, height, metadata_source, parent_id, node_type, linked_node_id, comfy_params)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        position_x = excluded.position_x,
        position_y = excluded.position_y,
        width = excluded.width,
        height = excluded.height,
        metadata_source = excluded.metadata_source,
        parent_id = excluded.parent_id,
        linked_node_id = excluded.linked_node_id,
        comfy_params = excluded.comfy_params
    `).run(node.id, node.canvasId, node.imagePath, node.x, node.y, node.width, node.height, node.source, node.parentId ?? null, node.nodeType ?? 'image', node.linkedNodeId ?? null, node.comfyParams ?? null),
  updateMetadata: (id: string, source: string, modelName?: string) =>
    getDb().prepare('UPDATE nodes SET metadata_source = ?, model_name = ? WHERE id = ?').run(source, modelName ?? null, id),
  updateComfyParams: (id: string, comfyParams: string | null) =>
    getDb().prepare('UPDATE nodes SET comfy_params = ? WHERE id = ?').run(comfyParams ?? null, id),
  updatePosition: (id: string, x: number, y: number) =>
    getDb().prepare('UPDATE nodes SET position_x = ?, position_y = ? WHERE id = ?').run(x, y, id),
  updateSize: (id: string, width: number, height: number) =>
    getDb().prepare('UPDATE nodes SET width = ?, height = ? WHERE id = ?').run(width, height, id),
  updateParent: (id: string, parentId: string | null) =>
    getDb().prepare('UPDATE nodes SET parent_id = ? WHERE id = ?').run(parentId, id),
  getChildren: (parentId: string) =>
    getDb().prepare('SELECT id FROM nodes WHERE parent_id = ?').all(parentId) as { id: string }[],
  updateThumbnail: (id: string, thumbPath: string) =>
    getDb().prepare('UPDATE nodes SET thumbnail_path = ? WHERE id = ?').run(thumbPath, id),
  setStarred: (id: string, starred: boolean) =>
    getDb().prepare('UPDATE nodes SET starred = ? WHERE id = ?').run(starred ? 1 : 0, id),
  setTagLang: (id: string, lang: string) =>
    getDb().prepare('UPDATE nodes SET tag_lang = ? WHERE id = ?').run(lang, id),
  delete: (id: string) =>
    getDb().prepare('DELETE FROM nodes WHERE id = ?').run(id),
}

export const tagQueries = {
  getByNode: (nodeId: string) =>
    getDb().prepare('SELECT * FROM tags WHERE node_id = ?').all(nodeId),
  getByCanvas: (canvasId: string) =>
    getDb().prepare(`
      SELECT t.* FROM tags t
      JOIN nodes n ON n.id = t.node_id
      WHERE n.canvas_id = ?
    `).all(canvasId),
  insertMany: (nodeId: string, tags: { id: string; category: string; value: string; source: string }[]) => {
    const stmt = getDb().prepare('INSERT OR REPLACE INTO tags VALUES (?, ?, ?, ?, ?)')
    const insertAll = getDb().transaction((ts: typeof tags) => {
      for (const tag of ts) stmt.run(tag.id, nodeId, tag.category, tag.value, tag.source)
    })
    insertAll(tags)
  },
  deleteByNode: (nodeId: string) =>
    getDb().prepare('DELETE FROM tags WHERE node_id = ?').run(nodeId),
}

export const settingQueries = {
  get: (key: string) => (getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as any)?.value ?? null,
  set: (key: string, value: string) =>
    getDb().prepare('INSERT OR REPLACE INTO settings VALUES (?, ?)').run(key, value),
}

export const aiCacheQueries = {
  // `mtime` esperado: se o arquivo mudou desde a gravação, é outra imagem no
  // mesmo caminho e o cache não vale. Linhas antigas (sem mtime) seguem valendo.
  get: (imagePath: string, mtime?: number) => {
    const row = getDb().prepare('SELECT tags_json, mtime FROM ai_cache WHERE image_path = ?').get(imagePath) as any
    if (!row) return null
    if (mtime && row.mtime && row.mtime !== mtime) return null
    return JSON.parse(row.tags_json)
  },
  set: (imagePath: string, tags: unknown, mtime?: number) =>
    getDb().prepare('INSERT OR REPLACE INTO ai_cache (image_path, tags_json, created_at, mtime) VALUES (?, ?, ?, ?)').run(
      imagePath, JSON.stringify(tags), Date.now(), mtime ?? null
    ),
}

// Consultas da limpeza de arquivos (src/main/housekeeping.ts).
export const housekeepingQueries = {
  /** Todo caminho de imagem/miniatura que algum nó ainda usa. */
  caminhosEmUso: (): string[] => {
    const rows = getDb().prepare('SELECT image_path, thumbnail_path FROM nodes').all() as { image_path?: string; thumbnail_path?: string }[]
    const out: string[] = []
    for (const r of rows) { if (r.image_path) out.push(r.image_path); if (r.thumbnail_path) out.push(r.thumbnail_path) }
    return out
  },
  arquivosDoNo: (id: string): { imagePath: string | null; thumbnailPath: string | null } => {
    const r = getDb().prepare('SELECT image_path, thumbnail_path FROM nodes WHERE id = ?').get(id) as { image_path?: string; thumbnail_path?: string } | undefined
    return { imagePath: r?.image_path ?? null, thumbnailPath: r?.thumbnail_path ?? null }
  },
  arquivoEmUsoPorOutro: (caminho: string, exceptId: string): boolean =>
    !!getDb().prepare('SELECT 1 FROM nodes WHERE (image_path = ? OR thumbnail_path = ?) AND id != ? LIMIT 1').get(caminho, caminho, exceptId),
  /** Apaga do cache as linhas cujo arquivo não existe mais. Devolve quantas. */
  apagarCacheOrfao: (existe: (p: string) => boolean): number => {
    const db = getDb()
    const rows = db.prepare('SELECT image_path FROM ai_cache').all() as { image_path: string }[]
    const del = db.prepare('DELETE FROM ai_cache WHERE image_path = ?')
    let n = 0
    for (const r of rows) {
      // A chave pode ter sufixo de idioma ("…png::pt"): o arquivo é a parte antes.
      const arquivo = r.image_path.replace(/::(pt|en)$/, '')
      if (!existe(arquivo)) { del.run(r.image_path); n++ }
    }
    return n
  },
}
