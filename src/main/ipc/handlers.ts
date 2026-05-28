import { ipcMain, dialog, safeStorage, BrowserWindow, shell } from 'electron'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { canvasQueries, nodeQueries, tagQueries, settingQueries, aiCacheQueries } from '../db'
import { extractMetadata } from '../metadata'
import { analyzeWithAnthropic } from '../ai/anthropic'
import { analyzeWithOpenAI } from '../ai/openai'
import { MODEL_PROMPT_CONFIGS } from '../ai/model-prompts'

export function registerHandlers(win: BrowserWindow): void {
  // ── Window controls ────────────────────────────────────────────────────
  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('window:minimize', () => win.minimize())
  ipcMain.handle('window:maximize', () =>
    win.isMaximized() ? win.unmaximize() : win.maximize()
  )
  ipcMain.handle('window:close', () => win.close())
  ipcMain.handle('window:setAlwaysOnTop', (_e, val: boolean) => {
    win.setAlwaysOnTop(val, 'floating')
    return val
  })
  ipcMain.handle('window:isAlwaysOnTop', () => win.isAlwaysOnTop())
  ipcMain.handle('window:isMaximized', () => win.isMaximized())

  // ── File picker ────────────────────────────────────────────────────────
  ipcMain.handle('image:openFilePicker', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    return result.filePaths
  })

  // ── Metadata extraction ────────────────────────────────────────────────
  ipcMain.handle('image:extractMetadata', async (_e, imagePath: string) => {
    return await extractMetadata(imagePath)
  })

  // ── AI analysis ───────────────────────────────────────────────────────
  ipcMain.handle('image:analyzeWithAI', async (_e, imagePath: string) => {
    const cached = aiCacheQueries.get(imagePath)
    if (cached && typeof cached === 'string' && /\{[^}]+\}/.test(cached)) return cached

    const provider = settingQueries.get('aiProvider') || 'anthropic'
    const encryptedKey = settingQueries.get(`apiKey_${provider}`)
    if (!encryptedKey) throw new Error('API key not configured')

    const apiKey = safeStorage.decryptString(Buffer.from(encryptedKey, 'hex'))
    const tags = provider === 'anthropic'
      ? await analyzeWithAnthropic(imagePath, apiKey)
      : await analyzeWithOpenAI(imagePath, apiKey)

    aiCacheQueries.set(imagePath, tags)
    return tags
  })

  // ── Prompt optimization ───────────────────────────────────────────────
  ipcMain.handle('prompt:optimize', async (_e, prompt: string, modelId: string) => {
    const config = MODEL_PROMPT_CONFIGS[modelId]
    if (!config) throw new Error(`Unknown model: ${modelId}`)

    const provider = settingQueries.get('aiProvider') || 'anthropic'
    const encryptedKey = settingQueries.get(`apiKey_${provider}`)
    if (!encryptedKey) throw new Error('API key not configured')
    const apiKey = safeStorage.decryptString(Buffer.from(encryptedKey, 'hex'))

    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey })
      const message = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: config.systemPrompt,
        messages: [{ role: 'user', content: `Otimize este prompt para ${config.label}:\n\n${prompt}` }],
      })
      const block = message.content[0]
      return block?.type === 'text' ? block.text.trim() : ''
    } else {
      const client = new OpenAI({ apiKey })
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: config.systemPrompt },
          { role: 'user', content: `Otimize este prompt para ${config.label}:\n\n${prompt}` },
        ],
      })
      return completion.choices[0].message.content?.trim() ?? ''
    }
  })

  // ── Settings ───────────────────────────────────────────────────────────
  ipcMain.handle('settings:getApiKey', (_e, provider: string) => {
    const encrypted = settingQueries.get(`apiKey_${provider}`)
    if (!encrypted) return null
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'hex'))
    } catch {
      return null
    }
  })

  ipcMain.handle('settings:setApiKey', (_e, provider: string, key: string) => {
    const encrypted = safeStorage.encryptString(key)
    settingQueries.set(`apiKey_${provider}`, encrypted.toString('hex'))
    return true
  })

  ipcMain.handle('settings:get', (_e, key: string) => settingQueries.get(key))
  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    settingQueries.set(key, value)
    return true
  })

  ipcMain.handle('app:getVersion', () => {
    const { app } = require('electron')
    return app.getVersion()
  })

  // ── Canvas file export/import ──────────────────────────────────────────
  ipcMain.handle('canvas:exportFile', async (_e, data: { name: string; nodes: unknown[]; tags: unknown[] }) => {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${data.name}.refmap`,
      filters: [{ name: 'Ref Map Canvas', extensions: ['refmap'] }],
    })
    if (result.canceled || !result.filePath) return false
    const fs = require('fs') as typeof import('fs')
    fs.writeFileSync(result.filePath, JSON.stringify({ version: 1, ...data }, null, 2), 'utf-8')
    return true
  })

  ipcMain.handle('canvas:openFile', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Ref Map Canvas', extensions: ['refmap'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const fs = require('fs') as typeof import('fs')
    return JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'))
  })

  // ── Canvas CRUD ────────────────────────────────────────────────────────
  ipcMain.handle('canvas:list', () => canvasQueries.getAll())
  ipcMain.handle('canvas:load', (_e, canvasId: string) => {
    const nodes = nodeQueries.getByCanvas(canvasId)
    const tags = tagQueries.getByCanvas(canvasId)
    return { nodes, tags }
  })
  ipcMain.handle('canvas:create', (_e, name: string) => canvasQueries.create(name))
  ipcMain.handle('canvas:rename', (_e, id: string, name: string) => canvasQueries.rename(id, name))
  ipcMain.handle('canvas:delete', (_e, id: string) => canvasQueries.delete(id))

  // ── Node CRUD ──────────────────────────────────────────────────────────
  ipcMain.handle('node:create', (_e, node: Parameters<typeof nodeQueries.upsert>[0]) => {
    nodeQueries.upsert(node)
    return true
  })
  ipcMain.handle('node:updateMetadata', (_e, id: string, source: string, modelName?: string) => {
    nodeQueries.updateMetadata(id, source, modelName)
  })
  ipcMain.handle('node:updatePosition', (_e, id: string, x: number, y: number) => {
    nodeQueries.updatePosition(id, x, y)
    return true
  })
  ipcMain.handle('node:updateSize', (_e, id: string, width: number, height: number) => {
    nodeQueries.updateSize(id, width, height)
    return true
  })
  ipcMain.handle('node:delete', (_e, id: string) => {
    nodeQueries.delete(id)
    return true
  })
  ipcMain.handle('node:saveTags', (_e, nodeId: string, tags: Parameters<typeof tagQueries.insertMany>[1]) => {
    tagQueries.deleteByNode(nodeId)
    if (tags.length > 0) tagQueries.insertMany(nodeId, tags)
    return true
  })

  ipcMain.handle('node:createGroup', (_e, groupNode: {
    id: string; canvasId: string; x: number; y: number; width: number; height: number
  }, childIds: string[]) => {
    nodeQueries.upsert({
      id: groupNode.id,
      canvasId: groupNode.canvasId,
      imagePath: '',
      x: groupNode.x,
      y: groupNode.y,
      width: groupNode.width,
      height: groupNode.height,
      source: 'group',
      nodeType: 'group',
    })
    for (const childId of childIds) {
      nodeQueries.updateParent(childId, groupNode.id)
    }
    return true
  })

  ipcMain.handle('node:updateParent', (_e, id: string, parentId: string | null) => {
    nodeQueries.updateParent(id, parentId)
    return true
  })

  ipcMain.handle('node:deleteWithChildren', (_e, id: string) => {
    const children = nodeQueries.getChildren(id)
    for (const child of children) {
      nodeQueries.delete(child.id)
    }
    nodeQueries.delete(id)
    return true
  })
}
