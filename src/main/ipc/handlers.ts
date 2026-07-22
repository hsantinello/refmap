import { ipcMain, dialog, safeStorage, BrowserWindow, shell, app } from 'electron'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import sharp from 'sharp'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { canvasQueries, nodeQueries, tagQueries, settingQueries, aiCacheQueries } from '../db'
import { extractMetadata } from '../metadata'
import { analyzeWithAnthropic } from '../ai/anthropic'
import { analyzeWithOpenAI } from '../ai/openai'
import { MODEL_PROMPT_CONFIGS, IMAGE_MODEL_IDS } from '../ai/model-prompts'

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

  // ── Clipboard image ────────────────────────────────────────────────────
  ipcMain.handle('clipboard:readImage', async (): Promise<string | null> => {
    const { clipboard, nativeImage } = await import('electron')
    const img = clipboard.readImage()
    if (img.isEmpty()) return null
    const tmpDir = path.join(app.getPath('temp'), 'refmap-paste')
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmpPath = path.join(tmpDir, `paste-${Date.now()}.png`)
    fs.writeFileSync(tmpPath, img.toPNG())
    return tmpPath
  })

  // ── Thumbnail generation ───────────────────────────────────────────────
  ipcMain.handle('image:createThumbnail', async (_e, imagePath: string): Promise<string> => {
    const thumbDir = path.join(app.getPath('userData'), 'thumbnails')
    const hash = crypto.createHash('md5').update(imagePath).digest('hex')
    const thumbPath = path.join(thumbDir, `${hash}.jpg`)
    if (!fs.existsSync(thumbPath)) {
      await sharp(imagePath)
        .resize(900, 900, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toFile(thumbPath)
    }
    return thumbPath
  })

  // ── Metadata extraction ────────────────────────────────────────────────
  ipcMain.handle('image:extractMetadata', async (_e, imagePath: string) => {
    return await extractMetadata(imagePath)
  })

  // ── AI analysis ───────────────────────────────────────────────────────
  ipcMain.handle('image:analyzeWithAI', async (_e, imagePath: string, lang: 'en' | 'pt' = 'en', force = false) => {
    // Cache por idioma: análise em PT e em EN são entradas separadas.
    const cacheKey = lang === 'pt' ? `${imagePath}::pt` : imagePath
    // force = true (botão "Reanalisar com IA") pula a leitura do cache e refaz de verdade.
    const cached = force ? null : aiCacheQueries.get(cacheKey)
    if (cached && typeof cached === 'string' && /\{[^}]+\}/.test(cached)) return cached

    const provider = settingQueries.get('aiProvider') || 'anthropic'

    const encryptedAnthropic = settingQueries.get('apiKey_anthropic')
    const encryptedOpenAI = settingQueries.get('apiKey_openai')

    const decryptKey = (enc: unknown): string => {
      if (!enc || typeof enc !== 'string') return ''
      try { return safeStorage.decryptString(Buffer.from(enc, 'hex')).trim() } catch { return '' }
    }

    // Resolve which key to use for vision. Prefer the active provider's key;
    // only fall back to another provider's key when the active one is missing
    // or blank. A blank/revoked key must NOT silently route to OpenAI — it
    // yields a clean "not configured" error instead of a raw 401.
    // Rastreia o provider da chave EFETIVAMENTE resolvida: se a chave do
    // provider ativo falta, cai para outra chave — mas o dispatch abaixo tem
    // que rotear para o SDK dessa chave, senão manda sk- da OpenAI ao endpoint
    // Anthropic (401).
    let effectiveProvider = provider
    let apiKey = decryptKey(settingQueries.get(`apiKey_${provider}`))
    if (!apiKey) {
      const aKey = decryptKey(encryptedAnthropic)
      const oKey = decryptKey(encryptedOpenAI)
      if (aKey) { apiKey = aKey; effectiveProvider = 'anthropic' }
      else if (oKey) { apiKey = oKey; effectiveProvider = 'openai' }
    }
    if (!apiKey) throw new Error('API key not configured')

    const isTogetherKey = apiKey.startsWith('tgp_')

    let tags: string
    if (isTogetherKey) {
      // Try Together AI vision models in order until one works. These are the
      // multimodal models that are actually SERVERLESS on Together — verified by
      // sending a real image to /v1/chat/completions. Counterintuitively, the
      // "*-VL" and Llama-4/3.2-Vision models are dedicated-only (they return a
      // 400 "non-serverless model" error), while these smaller multimodal chat
      // models work serverless. gemma-3n gives the richest descriptions.
      const togetherVisionModels = [
        'google/gemma-3n-E4B-it',
        'MiniMaxAI/MiniMax-M3',
      ]
      tags = ''
      let lastErr: unknown = null
      // Only genuine transient errors are worth retrying. The 400 "Unable to
      // access non-serverless model" is PERMANENT for the account (the model
      // isn't available serverless at all), so we must NOT retry it — doing so
      // just wastes ~30s/image before falling back. Fail it fast to the next
      // model / to the Anthropic|OpenAI fallback below.
      const isRetryable = (err: unknown): boolean => {
        const status = (err as { status?: number })?.status
        const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
        return status === 429 || status === 500 || status === 502 || status === 503 ||
          msg.includes('rate limit') || msg.includes('overloaded')
      }
      const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
      for (const model of togetherVisionModels) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            tags = await analyzeWithOpenAI(imagePath, apiKey, {
              baseURL: 'https://api.together.xyz/v1',
              model,
              lang,
            })
            break
          } catch (err) {
            lastErr = err
            console.warn(`[analyzeWithAI] Together vision "${model}" attempt ${attempt + 1}/3 failed:`, err instanceof Error ? err.message : err)
            // Non-retryable (e.g. 401) or out of attempts → move to next model
            if (!isRetryable(err) || attempt === 2) break
            await delay(1500 * (attempt + 1)) // 1.5s, then 3s backoff
          }
        }
        if (tags) break
      }
      // Together vision unavailable — fall back to a REAL Anthropic/OpenAI key
      // if one is configured. Guard against empty/blank stored keys, which
      // otherwise crash the SDK with a cryptic "Could not resolve authentication".
      if (!tags) {
        const decryptIfPresent = (enc: unknown): string => {
          if (!enc || typeof enc !== 'string') return ''
          try { return safeStorage.decryptString(Buffer.from(enc, 'hex')).trim() } catch { return '' }
        }
        const anthropicKey = decryptIfPresent(encryptedAnthropic)
        const openaiKey = decryptIfPresent(encryptedOpenAI)
        if (anthropicKey) {
          tags = await analyzeWithAnthropic(imagePath, anthropicKey, lang)
        } else if (openaiKey) {
          tags = await analyzeWithOpenAI(imagePath, openaiKey, { lang })
        } else {
          // Together vision models all failed and there's no OpenAI/Anthropic
          // fallback key. Propagate the real error so it's diagnosable.
          const detail = lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'unknown error')
          console.warn(`[analyzeWithAI] Together vision failed and no fallback key configured. Last error: ${detail}`)
          throw new Error(`Together AI vision failed: ${detail}`)
        }
      }
    } else if (effectiveProvider === 'anthropic') {
      tags = await analyzeWithAnthropic(imagePath, apiKey, lang)
    } else {
      tags = await analyzeWithOpenAI(imagePath, apiKey, { lang })
    }

    // Só cacheia saída bem-formada; uma resposta truncada/lixo (ex.: stream do
    // Together que travou contendo qualquer "{x}") não pode ser cacheada e
    // servida para sempre. O read gate acima permanece permissivo de propósito,
    // para não re-analisar em loop um truncamento determinístico.
    const isWellFormedTags = (s: string): boolean =>
      s.trimStart().startsWith('{') &&
      /\}/.test(s) &&
      (s.match(/\[[^\]]+\]/g)?.length ?? 0) >= 5
    if (isWellFormedTags(tags)) aiCacheQueries.set(cacheKey, tags)
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
    // Together AI keys start with "tgp_" — auto-route regardless of which slot they were saved in
    const effectiveProvider = apiKey.startsWith('tgp_') ? 'together' : provider

    // Remove markdown/special characters from the prompt
    const cleanPrompt = (text: string): string =>
      text
        .replace(/^#{1,6}\s+/gm, '')       // ## headers at line start
        .replace(/#/g, '')                 // any remaining # chars
        .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')  // **bold**, *italic*, ***both***
        .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')    // __bold__, _italic_
        .replace(/`([^`]+)`/g, '$1')        // `code`
        .replace(/^\s*[-*+]\s+/gm, '')      // bullet points at start of line
        .replace(/^\s*\d+\.\s+/gm, '')      // numbered lists at start of line
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [link](url)
        .replace(/\n{3,}/g, '\n\n')         // max 2 consecutive blank lines
        .trim()

    // Strip any introductory lines the model might prepend before the actual prompt
    const stripIntro = (text: string): string => {
      const lines = text.split('\n')
      // Patterns that indicate an intro/header line
      const introRe = /^(\*{1,2})?((here'?s?|aqui (est[aá]|vai)|voici|here is|below is|optimized prompt|prompt otimizado|prompt for|otimizado para|resultado|result|output|the (optimized|following|result)|segue)(\*{1,2})?[^a-z]*:?|#{1,3}\s)/i
      // Also strip lines that are entirely a header followed by optional colon (< 120 chars, no sentence structure)
      const isHeaderLine = (l: string) => introRe.test(l) || (l.endsWith(':') && l.length < 120 && !/[.!?]/.test(l.slice(0, -1)))
      let start = 0
      for (let i = 0; i < Math.min(lines.length, 5); i++) {
        const line = lines[i].trim()
        if (!line) { start = i + 1; continue }
        if (isHeaderLine(line)) { start = i + 1 }
        else break
      }
      // Also remove markdown bold headers anywhere in the first line
      let result = lines.slice(start).join('\n').trim()
      result = result.replace(/^\*\*[^*]{1,80}\*\*\n+/, '')
      return result
    }

    const realismDefault = IMAGE_MODEL_IDS.has(modelId)
      ? `\n\nDEFAULT STYLE: if the user did NOT specify an artistic style, medium or aesthetic, make the image photorealistic — realistic photography, natural lighting, true-to-life detail and texture. Only use a non-realistic style (illustration, anime, painting, 3D render, graphic, etc.) when the user explicitly asked for it.`
      : ''

    const userMsg = `Optimize this prompt for ${config.label}. Write the descriptive prompt in English only, regardless of the input language — EXCEPT for literal spoken lines and text-to-render, which follow the VERBATIM rule below.

VERBATIM TEXT — HIGHEST PRIORITY: If the user gives words that a person/character/subject SPEAKS or SAYS (dialogue, voice-over, narration), or literal TEXT TO BE DISPLAYED in the image/video (speech bubble, sign, caption, title, subtitle, label, on-screen text), reproduce that text EXACTLY word-for-word, wrapped in double quotes, in the SAME language the user wrote it. Never translate it, paraphrase it, summarize it, rephrase it, correct it, shorten it or drop it. Only the surrounding description gets translated to English; the quoted spoken/displayed text must stay intact exactly as written.

IMPORTANT — STAY FAITHFUL TO WHAT THE USER WROTE: Keep ALL of the user's meaningful content — every subject, attribute, action, setting and style cue they wrote must survive in the output. Do not drop, merge away or over-summarize what they gave you. Restructure and clarify THEIR prompt into the format and technical vocabulary the target model expects (per your instructions), and add only the supporting detail their idea needs to render well — camera, lighting, quality and structure cues that are implied by what they described. Do NOT invent new subjects, characters, objects, actions, backstory, settings or narrative that the user did not state or clearly imply; no embellishment for its own sake. When in doubt, preserve the user's own wording instead of rewriting it. The result must read as a faithful, well-structured version of THE USER'S prompt — not a different or more elaborate creative concept.${realismDefault}

Return ONLY the prompt, no introduction, no explanation:\n\n${prompt}`

    if (effectiveProvider === 'anthropic') {
      const client = new Anthropic({ apiKey })
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: config.systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      })
      const block = message.content[0]
      const raw = block?.type === 'text' ? block.text.trim() : ''
      return cleanPrompt(stripIntro(raw.replace(/\\n/g, '\n')))
    } else {
      const client = effectiveProvider === 'together'
        ? new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' })
        : new OpenAI({ apiKey })
      const model = effectiveProvider === 'together' ? 'meta-llama/Llama-3.3-70B-Instruct-Turbo' : 'gpt-4o-mini'
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: config.systemPrompt },
          { role: 'user', content: userMsg },
        ],
      })
      return cleanPrompt(stripIntro((completion.choices[0].message.content?.trim() ?? '').replace(/\\n/g, '\n')))
    }
  })

  // ── Tag translation ───────────────────────────────────────────────────
  ipcMain.handle('tags:translate', async (_e, values: string[], targetLang: 'pt' | 'en') => {
    const provider = settingQueries.get('aiProvider') || 'anthropic'
    const encryptedKey = settingQueries.get(`apiKey_${provider}`)
    if (!encryptedKey) throw new Error('API key not configured')
    const apiKey = safeStorage.decryptString(Buffer.from(encryptedKey, 'hex'))
    const effectiveProvider = apiKey.startsWith('tgp_') ? 'together' : provider

    const langLabel = targetLang === 'pt' ? 'Brazilian Portuguese' : 'English'
    const prompt = `Translate each of the following image generation prompt tags to ${langLabel}. Return ONLY a JSON array of strings in the same order, no explanation:\n${JSON.stringify(values)}`

    let raw = ''
    if (effectiveProvider === 'anthropic') {
      const client = new Anthropic({ apiKey })
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      })
      const block = msg.content[0]
      raw = block?.type === 'text' ? block.text.trim() : '[]'
    } else {
      const client = effectiveProvider === 'together'
        ? new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' })
        : new OpenAI({ apiKey })
      const model = effectiveProvider === 'together' ? 'meta-llama/Llama-3.3-70B-Instruct-Turbo' : 'gpt-4o-mini'
      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
      })
      raw = completion.choices[0].message.content?.trim() ?? '[]'
    }

    const match = raw.match(/\[[\s\S]*\]/)
    return match ? JSON.parse(match[0]) as string[] : values
  })

  // ── Speech transcription (Whisper) ────────────────────────────────────
  ipcMain.handle('speech:transcribe', async (_e, audioData: Uint8Array) => {
    // Try active provider key first; fall back to explicit openai key
    const provider = settingQueries.get('aiProvider') || 'anthropic'
    const encryptedActive = provider !== 'anthropic' ? settingQueries.get(`apiKey_${provider}`) : null
    const encryptedOpenAI = settingQueries.get('apiKey_openai')

    let apiKey = ''
    if (encryptedActive) {
      try { apiKey = safeStorage.decryptString(Buffer.from(encryptedActive, 'hex')) } catch {}
    }
    if (!apiKey?.trim() && encryptedOpenAI) {
      try { apiKey = safeStorage.decryptString(Buffer.from(encryptedOpenAI, 'hex')) } catch {}
    }
    if (!apiKey?.trim()) throw new Error('NO_OPENAI_KEY')

    const isTogetherKey = apiKey.startsWith('tgp_')
    const client = isTogetherKey
      ? new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' })
      : new OpenAI({ apiKey })
    const model = isTogetherKey ? 'openai/whisper-large-v3' : 'whisper-1'

    const tempPath = path.join(app.getPath('temp'), `refmap-speech-${Date.now()}.webm`)
    try {
      fs.writeFileSync(tempPath, Buffer.from(audioData))
      const result = await client.audio.transcriptions.create({
        file: fs.createReadStream(tempPath),
        model,
        language: 'pt',
      })
      return result.text
    } finally {
      try { fs.unlinkSync(tempPath) } catch {}
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
  // ── Auto-backup (no dialog — saves to userData/backups) ──────────────────
  ipcMain.handle('canvas:autoBackup', async (_e, data: { name: string; nodes: unknown[]; tags: unknown[] }) => {
    try {
      const { app } = require('electron') as typeof import('electron')
      const path = require('path') as typeof import('path')
      const fs   = require('fs')   as typeof import('fs')
      const backupDir = path.join(app.getPath('userData'), 'backups')
      fs.mkdirSync(backupDir, { recursive: true })
      const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const safeName = data.name.replace(/[^a-z0-9]/gi, '_')
      const filepath = path.join(backupDir, `${safeName}_${ts}.refmap`)
      fs.writeFileSync(filepath, JSON.stringify({ version: 1, ...data }, null, 2), 'utf-8')
      // Keep only last 5 backups per canvas
      const all = fs.readdirSync(backupDir).filter((f: string) => f.startsWith(safeName)).sort()
      for (const old of all.slice(0, -5)) fs.unlinkSync(path.join(backupDir, old))
      return filepath
    } catch (err) { console.error('[autoBackup]', err); return null }
  })

  // Save directly to a known path (no dialog) — used by Ctrl+S
  ipcMain.handle('canvas:saveToPath', async (_e, filePath: string, data: { name: string; nodes: unknown[]; tags: unknown[] }) => {
    try {
      const fs = require('fs') as typeof import('fs')
      fs.writeFileSync(filePath, JSON.stringify({ version: 1, ...data }, null, 2), 'utf-8')
      return true
    } catch (err) { console.error('[saveToPath]', err); return false }
  })

  ipcMain.handle('canvas:exportFile', async (_e, data: { name: string; nodes: unknown[]; tags: unknown[] }) => {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${data.name}.refmap`,
      filters: [{ name: 'Ref Map Canvas', extensions: ['refmap'] }],
    })
    if (result.canceled || !result.filePath) return null
    const fs = require('fs') as typeof import('fs')
    fs.writeFileSync(result.filePath, JSON.stringify({ version: 1, ...data }, null, 2), 'utf-8')
    return result.filePath  // return path so caller can remember it
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
  ipcMain.handle('node:updateThumbnail', (_e, id: string, thumbPath: string) => {
    nodeQueries.updateThumbnail(id, thumbPath)
  })
  ipcMain.handle('node:setStarred', (_e, id: string, starred: boolean) => {
    nodeQueries.setStarred(id, starred)
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
  ipcMain.handle('node:saveTags', (_e, nodeId: string, tags: Parameters<typeof tagQueries.insertMany>[1], tagLang?: 'en' | 'pt') => {
    tagQueries.deleteByNode(nodeId)
    if (tags.length > 0) tagQueries.insertMany(nodeId, tags)
    if (tagLang) nodeQueries.setTagLang(nodeId, tagLang)
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
