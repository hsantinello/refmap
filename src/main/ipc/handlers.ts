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
import { getLocalConfig, getLocalTextConfig, localChat, isLocalUnavailable, LOCAL_AI_UNAVAILABLE } from '../ai/local'
import { installLocalAI, uninstallLocal } from '../ai/localInstall'
import { extractScenes, extractFrameAt } from '../video/extractScenes'

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

  // ── Video: detecção de cena + extração de keyframes ─────────────────────
  ipcMain.handle('video:openFilePicker', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Vídeos', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }],
    })
    return result.filePaths[0] ?? null
  })
  ipcMain.handle('video:extractScenes', (_e, videoPath: string, opts?: { threshold?: number; maxScenes?: number }) =>
    extractScenes(videoPath, opts),
  )
  ipcMain.handle('video:extractFrame', (_e, videoPath: string, timestamp: number) =>
    extractFrameAt(videoPath, timestamp),
  )

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

  // Copia a imagem do disco para o clipboard do SO, para colar em outros apps.
  ipcMain.handle('clipboard:writeImage', async (_e, imagePath: string): Promise<boolean> => {
    const { clipboard, nativeImage } = await import('electron')
    const img = nativeImage.createFromPath(imagePath)
    if (img.isEmpty()) return false
    clipboard.writeImage(img)
    return true
  })

  // Grava bytes de imagem num arquivo temporário e devolve o caminho (usado para
  // analisar só a região recortada com a IA).
  ipcMain.handle('image:writeTempImage', async (_e, data: Uint8Array): Promise<string> => {
    const dir = path.join(app.getPath('temp'), 'refmap-crop')
    fs.mkdirSync(dir, { recursive: true })
    const p = path.join(dir, `crop-${crypto.randomBytes(6).toString('hex')}.png`)
    fs.writeFileSync(p, Buffer.from(data))
    return p
  })

  // Copia bytes de imagem (ex.: PNG já recortado) para o clipboard.
  ipcMain.handle('clipboard:writeImageData', async (_e, data: Uint8Array): Promise<boolean> => {
    const { clipboard, nativeImage } = await import('electron')
    const img = nativeImage.createFromBuffer(Buffer.from(data))
    if (img.isEmpty()) return false
    clipboard.writeImage(img)
    return true
  })

  // ── IA Local (Ollama) ──────────────────────────────────────────────────
  // Status do endpoint local: usado nas Settings para mostrar se o Ollama está
  // rodando e listar os modelos instalados.
  ipcMain.handle('local:status', async (): Promise<{ ok: boolean; models: string[]; model: string }> => {
    const { baseURL, apiKey, model } = getLocalConfig()          // visão
    const { model: textModel } = getLocalTextConfig()            // texto (sem censura)
    try {
      const client = new OpenAI({ apiKey, baseURL, timeout: 4000, maxRetries: 0 })
      const list = await client.models.list()
      const ids = list.data.map(m => m.id)
      const hasOne = (m: string) => {
        const base = m.split(':')[0]
        return ids.some(id => id === m || id === base || id.startsWith(base + ':'))
      }
      // "ok" exige o Ollama rodando E OS DOIS modelos do híbrido baixados (visão + texto).
      // Se faltar qualquer um, o "Baixar" reaparece pra puxar o que falta.
      return { ok: hasOne(model) && hasOne(textModel), models: ids, model }
    } catch {
      return { ok: false, models: [], model }
    }
  })

  // Instala/prepara a IA local dentro do app (baixa Ollama + puxa o modelo).
  // Progresso é enviado via evento 'local:installProgress'.
  ipcMain.handle('local:install', async () => { await installLocalAI(win); return true })
  ipcMain.handle('local:uninstall', async () => { await uninstallLocal(win); return true })

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

    const isTogetherKey = apiKey.startsWith('tgp_')

    let tags: string
    if (!apiKey) {
      // Sem chave de nuvem → IA local (Ollama). Comportamento padrão do app.
      const local = getLocalConfig()
      try {
        tags = await analyzeWithOpenAI(imagePath, local.apiKey, {
          baseURL: local.baseURL, model: local.model, lang,
        })
      } catch (err) {
        if (isLocalUnavailable(err)) throw new Error(LOCAL_AI_UNAVAILABLE)
        throw err
      }
    } else if (isTogetherKey) {
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
    // Resolve a chave: provider ativo, senão qualquer outra chave de nuvem salva.
    const decryptKey = (enc: unknown): string => {
      if (!enc || typeof enc !== 'string') return ''
      try { return safeStorage.decryptString(Buffer.from(enc, 'hex')).trim() } catch { return '' }
    }
    let apiKey = decryptKey(settingQueries.get(`apiKey_${provider}`))
    let effectiveProvider = provider as string
    if (!apiKey) {
      const aKey = decryptKey(settingQueries.get('apiKey_anthropic'))
      const oKey = decryptKey(settingQueries.get('apiKey_openai'))
      if (aKey) { apiKey = aKey; effectiveProvider = 'anthropic' }
      else if (oKey) { apiKey = oKey; effectiveProvider = 'openai' }
    }
    // Sem nenhuma chave de nuvem → usa IA local (Ollama).
    const useLocal = !apiKey
    // Together AI keys start with "tgp_" — auto-route regardless of which slot they were saved in
    if (apiKey.startsWith('tgp_')) effectiveProvider = 'together'

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

    // Antes esta regra dizia "natural lighting", que é CONTEÚDO DE CENA e acabava
    // autorizando o modelo a inventar iluminação que o usuário não pediu. Agora ela
    // define só o registro de renderização, e nunca vale para uma edição.
    const realismDefault = IMAGE_MODEL_IDS.has(modelId)
      ? `\n\nDEFAULT STYLE: if the user did NOT specify an artistic style, medium or aesthetic, render it photorealistic — real photography, true-to-life detail and texture. This is a RENDERING STYLE only: it lets you say the image is photographic, it does NOT let you add lighting, a setting, a camera, a mood or any other scene content the user did not write. Only use a non-realistic style (illustration, anime, painting, 3D render, graphic, etc.) when the user explicitly asked for it. Skip this rule entirely when the user is editing an existing image.`
      : ''

    // Idioma da saída — por modelo. Default 'en' mantém exatamente o texto de antes.
    const lang = config.outputLanguage ?? 'en'
    const strictEN = lang === 'en-strict'

    // 'en-strict': a regra de idioma entra no topo (prioridade) e é repetida colada
    // no prompt do usuário (recência) — os dois pontos que o modelo mais pesa.
    const languageHeader = strictEN
      ? `LANGUAGE — NON-NEGOTIABLE, THIS OVERRIDES EVERY OTHER RULE BELOW: the optimized prompt MUST be written in English, whatever language the user wrote in. ${config.label} performs dramatically worse in any other language. Translate EVERY descriptive element into English — subject, action, scene, camera, lens, lighting, mood, style, transitions, shot-list labels, negative direction, preserve-lists, SFX, music and audio direction. The ONLY text that keeps the user's original language is text inside double quotes that a character SPEAKS or that is DISPLAYED on screen (see VERBATIM below). If any descriptive sentence comes out in the user's language, it is WRONG — write it in English.\n\n`
      : ''

    const openingLine = lang === 'source'
      ? `Optimize this prompt for ${config.label}. Write it in the SAME language the user wrote it in.`
      : `Optimize this prompt for ${config.label}. Write the descriptive prompt in English only, regardless of the input language — EXCEPT for literal spoken lines and text-to-render, which follow the VERBATIM rule below.`

    // Sem isso a exceção VERBATIM vaza e leva a descrição inteira junto.
    const verbatimScope = strictEN
      ? ` This exception is NARROW: it covers ONLY the quoted words themselves. Everything around them — the speaker's name, the tone, the action tied to the line, the SFX/music/audio description and the instruction about where the on-screen text appears — is written in English.`
      : ''

    // Última instrução antes do prompt do usuário — é a que mais pesa na saída.
    // Checagem de escopo colada no prompt do usuário: é a última coisa lida antes
    // dele escrever, a posição de maior peso na saída.
    const scopeCheck = `FINAL CHECK ON SCOPE: list to yourself the things the user actually named. Your answer may not contain a single subject, person, place, object, action, light source or camera move beyond that list. If the user named only an object, no human appears in your answer. If the user is editing something that already exists, answer with the change only — never with a scene.`

    const closing = strictEN
      ? `Return ONLY the prompt, no introduction, no explanation.\n\n${scopeCheck}\n\nFINAL CHECK ON LANGUAGE: every descriptive word of your answer must be in English — subject, action, camera, lighting, mood, audio and SFX included. Only text inside double quotes that is spoken aloud or shown on screen may stay in another language. The user's prompt follows:`
      : `Return ONLY the prompt, no introduction, no explanation.\n\n${scopeCheck}\n\nThe user's prompt follows:`

    const userMsg = `${languageHeader}${openingLine}

VERBATIM TEXT — HIGHEST PRIORITY: If the user gives words that a person/character/subject SPEAKS or SAYS (dialogue, voice-over, narration), or literal TEXT TO BE DISPLAYED in the image/video (speech bubble, sign, caption, title, subtitle, label, on-screen text), reproduce that text EXACTLY word-for-word, wrapped in double quotes, in the SAME language the user wrote it. Never translate it, paraphrase it, summarize it, rephrase it, correct it, shorten it or drop it. Only the surrounding description gets translated to English; the quoted spoken/displayed text must stay intact exactly as written.${verbatimScope}

CORE OBJECTIVE — REFORMAT, DO NOT INVENT (as important as the VERBATIM rule above): Your ONLY job is to take the user's prompt and RE-EXPRESS the exact same idea in the structure, order and technical vocabulary that ${config.label} understands best. You are a FORMATTER, not a co-writer. The optimized prompt must describe the SAME scene the user wrote — same subjects, same actions, same setting — nothing added, nothing removed.
- Keep ALL of the user's content: every subject, attribute, action, setting, style and detail they wrote must survive.
- Do NOT add any new information the user did not write or unambiguously imply: no new subjects, characters, objects, actions, poses, backstory, locations, time of day, weather, colors, clothing, camera angles, lens, lighting, mood, emotions or artistic style. Do not "enrich", "elevate", dramatize or embellish. Every visual element in your output must trace back to something the user actually wrote. (The ONLY permitted style choice is the DEFAULT STYLE rule below, and only when the user specified no style at all.)
- You MAY only reorganize, clarify and translate the user's words into the target format, plus the minimal structural/technical phrasing the format itself requires — but that phrasing must NOT introduce new scene content.
- The prompt guides/examples for this model show you the FORMAT and structure to follow — do NOT copy their invented level of detail onto the user's prompt. Match their shape, not their content.
- When unsure whether a detail is implied, LEAVE IT OUT and keep the user's own ${strictEN ? 'meaning, translated to English' : 'wording'}.
The result must be a faithful, well-formatted version of THE USER'S prompt: same scene, better structure — never a richer, more elaborate or different creative concept.${realismDefault}

${closing}\n\n${prompt}`

    // O systemPrompt de cada modelo é um guia de "como escrever um prompt rico",
    // com SEÇÕES OBRIGATÓRIAS (cena, luz, câmera, áudio…). Quando o usuário não dá
    // material para uma seção, o modelo INVENTA para conseguir preenchê-la — foi o
    // que gerava mulher/sala/luz âmbar a partir de "editar a roupa com textura
    // realista". A regra de não inventar existia só na mensagem do usuário e perdia
    // para o mandato estrutural daqui. Este override entra no MESMO nível do
    // mandato, para desarmá-lo.
    const scopeOverride = `SCOPE — THIS RULE OUTRANKS EVERY STRUCTURAL INSTRUCTION ABOVE.

AUTHORITY: the user's text is the sole authority over CONTENT — what exists, who is there, what happens. Everything above this line is authority over FORM only: wording, ordering, technical vocabulary. When form and content disagree, content wins and the form bends. Never the other way around.

The sections, element lists, formulas and examples above describe the FULL vocabulary this model understands. They are a MENU to choose from, never a checklist to complete.
- Fill ONLY the parts the user actually gave material for. If the user said nothing about camera, framing, lens, lighting, location, time of day, weather, mood, audio or style, those parts DO NOT appear in your output. Omitting a section is CORRECT; inventing content to fill it is a FAILURE.
- Any minimum length, sentence count or "cover all N elements" instruction above is void when the user's prompt does not contain that much. A short request stays short — a single sentence is a valid answer.
- Never introduce a person, place, object, action, pose or camera move that the user did not name.
- THE SUBJECT STAYS WHAT THE USER SAID IT IS. If the user's subject is an OBJECT — a garment, a product, a piece of furniture, a package — it stays that object, alone. Do NOT add a person to wear it, hold it, use it or stand near it. A tank top is a tank top, not a man in a tank top. A shoe is a shoe, not a model wearing shoes. Adding a human that the user never mentioned is one of the worst failures you can make here: the user's reference photo often contains only the object, and inventing a wearer makes the prompt unusable.
- EDIT INSTRUCTIONS STAY EDIT INSTRUCTIONS: if the user is changing something in an image or video that already exists ("troque a jaqueta por couro", "coloque textura realista no vestido", "adicione rasgos na regata", "remova o fundo"), your output describes ONLY what changes and what must be preserved. Do NOT build a scene around it — no subject description, no setting, no lighting, no camera, no action, and above all no new people. The scene already exists; you are writing an instruction, not a scene.`

    // A regra de idioma fica por último de propósito: é curta, é sobre forma e não
    // sobre conteúdo, então não compete com o escopo acima.
    const systemPrompt = [
      config.systemPrompt,
      scopeOverride,
      strictEN
        ? `ABSOLUTE LANGUAGE RULE: your entire answer is written in English. Whatever language the incoming prompt is in, every descriptive word you write is English. The only exception is text inside double quotes that a character speaks aloud or that is displayed on screen — that keeps the user's original wording and language.`
        : '',
    ].filter(Boolean).join('\n\n')

    const runChat = async (system: string, user: string): Promise<string> => {
      if (useLocal) {
        // IA local (Ollama) — erros de conexão viram LOCAL_AI_UNAVAILABLE.
        return await localChat([
          { role: 'system', content: system },
          { role: 'user', content: user },
        ])
      } else if (effectiveProvider === 'anthropic') {
        const client = new Anthropic({ apiKey })
        const message = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          system,
          messages: [{ role: 'user', content: user }],
        })
        const block = message.content[0]
        return block?.type === 'text' ? block.text.trim() : ''
      } else {
        const client = effectiveProvider === 'together'
          ? new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' })
          : new OpenAI({ apiKey })
        const model = effectiveProvider === 'together' ? 'meta-llama/Llama-3.3-70B-Instruct-Turbo' : 'gpt-4o-mini'
        const completion = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        })
        return completion.choices[0].message.content?.trim() ?? ''
      }
    }

    const finalize = (raw: string): string => cleanPrompt(stripIntro(raw.replace(/\\n/g, '\n')))

    // SEMPRE uma chamada só. O 'en-strict' resolve o idioma no próprio prompt
    // (regra no topo do system, no topo da mensagem e colada no texto do usuário),
    // e não numa segunda passada de tradução — que dobrava o tempo de resposta
    // justamente para quem escreve em português.
    return finalize(await runChat(systemPrompt, userMsg))
  })

  // ── Prompt de animação (first/last frame) ─────────────────────────────
  // Recebe DUAS imagens (primeiro e último quadro) e gera um prompt de MOVIMENTO
  // descrevendo a transição — para workflows image-to-video de first/last frame.
  ipcMain.handle('prompt:animate', async (_e, firstPath: string, lastPath: string): Promise<string> => {
    const provider = settingQueries.get('aiProvider') || 'anthropic'
    const decryptKey = (enc: unknown): string => {
      if (!enc || typeof enc !== 'string') return ''
      try { return safeStorage.decryptString(Buffer.from(enc, 'hex')).trim() } catch { return '' }
    }
    let apiKey = decryptKey(settingQueries.get(`apiKey_${provider}`))
    let effectiveProvider = provider as string
    if (!apiKey) {
      const aKey = decryptKey(settingQueries.get('apiKey_anthropic'))
      const oKey = decryptKey(settingQueries.get('apiKey_openai'))
      if (aKey) { apiKey = aKey; effectiveProvider = 'anthropic' }
      else if (oKey) { apiKey = oKey; effectiveProvider = 'openai' }
    }
    const useLocal = !apiKey
    if (apiKey.startsWith('tgp_')) effectiveProvider = 'together'

    const instruction = `You are given the FIRST frame and the LAST frame of a short video clip, in that order. Write ONE detailed MOTION prompt in English describing the animation/transition FROM the first frame TO the last frame: what moves and how, camera movement (pan/zoom/dolly/orbit), changes in pose, expression, lighting and background, and the overall pacing. Focus on the MOVEMENT and the transition between the two frames — do NOT merely describe the static images. Make it a single flowing prompt suitable for a first-last-frame image-to-video model. Return ONLY the prompt, no preamble, no headings.`

    const readB64 = (p: string) => {
      const buf = fs.readFileSync(p)
      const ext = path.extname(p).slice(1).toLowerCase()
      return { b64: buf.toString('base64'), ext: ext === 'jpg' ? 'jpeg' : ext }
    }

    try {
      if (effectiveProvider === 'anthropic' && !useLocal) {
        const client = new Anthropic({ apiKey })
        const block = (p: string) => {
          const { b64, ext } = readB64(p)
          return { type: 'image' as const, source: { type: 'base64' as const, media_type: `image/${ext}` as 'image/jpeg', data: b64 } }
        }
        const msg = await client.messages.create({
          model: 'claude-haiku-4-5-20251001', max_tokens: 1024,
          messages: [{ role: 'user', content: [block(firstPath), block(lastPath), { type: 'text', text: instruction }] }],
        })
        const b = msg.content[0]
        return b?.type === 'text' ? b.text.trim() : ''
      }

      // openai / together / local (Ollama) — todos compatíveis com a API da OpenAI
      const cfg = useLocal ? getLocalConfig() : null
      const baseURL = useLocal ? cfg!.baseURL : (effectiveProvider === 'together' ? 'https://api.together.xyz/v1' : undefined)
      const key = useLocal ? cfg!.apiKey : apiKey
      const model = useLocal ? cfg!.model : (effectiveProvider === 'together' ? 'google/gemma-3n-E4B-it' : 'gpt-4o-mini')
      const client = new OpenAI({ apiKey: key, ...(baseURL ? { baseURL } : {}), timeout: 120_000, maxRetries: useLocal ? 0 : 1 })
      const url = (p: string) => { const { b64, ext } = readB64(p); return `data:image/${ext};base64,${b64}` }
      const completion = await client.chat.completions.create({
        model, max_tokens: 1024,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: url(firstPath) } },
          { type: 'image_url', image_url: { url: url(lastPath) } },
          { type: 'text', text: instruction },
        ] }],
      })
      return completion.choices[0]?.message?.content?.trim() ?? ''
    } catch (err) {
      if (useLocal && isLocalUnavailable(err)) throw new Error(LOCAL_AI_UNAVAILABLE)
      throw err
    }
  })

  // ── Tag translation ───────────────────────────────────────────────────
  ipcMain.handle('tags:translate', async (_e, values: string[], targetLang: 'pt' | 'en') => {
    const provider = settingQueries.get('aiProvider') || 'anthropic'
    const decryptKey = (enc: unknown): string => {
      if (!enc || typeof enc !== 'string') return ''
      try { return safeStorage.decryptString(Buffer.from(enc, 'hex')).trim() } catch { return '' }
    }
    let apiKey = decryptKey(settingQueries.get(`apiKey_${provider}`))
    let effectiveProvider = provider as string
    if (!apiKey) {
      const aKey = decryptKey(settingQueries.get('apiKey_anthropic'))
      const oKey = decryptKey(settingQueries.get('apiKey_openai'))
      if (aKey) { apiKey = aKey; effectiveProvider = 'anthropic' }
      else if (oKey) { apiKey = oKey; effectiveProvider = 'openai' }
    }
    const useLocal = !apiKey
    if (apiKey.startsWith('tgp_')) effectiveProvider = 'together'

    const langLabel = targetLang === 'pt' ? 'Brazilian Portuguese' : 'English'
    const prompt = `Translate each of the following image generation prompt tags to ${langLabel}. Return ONLY a JSON array of strings in the same order, no explanation:\n${JSON.stringify(values)}`

    let raw = ''
    if (useLocal) {
      raw = await localChat([{ role: 'user', content: prompt }])
    } else if (effectiveProvider === 'anthropic') {
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
    // Chave em branco = remover. Guardamos '' (falsy) em vez do hex da string
    // vazia criptografada — senão o `if (!encryptedKey)` dos handlers passa batido
    // e o SDK acaba estourando um erro de auth confuso em vez de "not configured".
    if (!key.trim()) {
      settingQueries.set(`apiKey_${provider}`, '')
      return true
    }
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
    id: string; canvasId: string; x: number; y: number; width: number; height: number; label?: string
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
      // Nome do grupo persistido em comfy_params (model_name já é usado pela cor).
      comfyParams: groupNode.label ? JSON.stringify({ label: groupNode.label }) : undefined,
    })
    for (const childId of childIds) {
      nodeQueries.updateParent(childId, groupNode.id)
    }
    return true
  })

  ipcMain.handle('node:updateGroupLabel', (_e, id: string, label: string) => {
    nodeQueries.updateComfyParams(id, label ? JSON.stringify({ label }) : null)
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
