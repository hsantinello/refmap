import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  // Shell
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  // Window
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  setAlwaysOnTop: (val: boolean) => ipcRenderer.invoke('window:setAlwaysOnTop', val),
  isAlwaysOnTop: () => ipcRenderer.invoke('window:isAlwaysOnTop'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChange: (cb: (val: boolean) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, val: boolean) => cb(val)
    ipcRenderer.on('window:maximizeChange', handler)
    return () => ipcRenderer.off('window:maximizeChange', handler)
  },

  // Files
  openFilePicker: (): Promise<string[]> => ipcRenderer.invoke('image:openFilePicker'),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  // Vídeo → cenas
  openVideoPicker: (): Promise<string | null> => ipcRenderer.invoke('video:openFilePicker'),
  extractVideoScenes: (
    videoPath: string,
    opts?: { threshold?: number; maxScenes?: number; start?: number; end?: number; maxGap?: number },
  ): Promise<{ frames: { index: number; framePath: string; timestamp: number }[]; capped: boolean; outDir: string }> =>
    ipcRenderer.invoke('video:extractScenes', videoPath, opts),
  // Captura manual de 1 quadro num tempo exato do vídeo
  extractVideoFrame: (
    videoPath: string,
    timestamp: number,
  ): Promise<{ index: number; framePath: string; timestamp: number }> =>
    ipcRenderer.invoke('video:extractFrame', videoPath, timestamp),

  // Metadata
  extractMetadata: (imagePath: string) => ipcRenderer.invoke('image:extractMetadata', imagePath),
  analyzeWithAI: (imagePath: string, lang?: 'en' | 'pt', force?: boolean) => ipcRenderer.invoke('image:analyzeWithAI', imagePath, lang, force),
  createThumbnail: (imagePath: string): Promise<string> => ipcRenderer.invoke('image:createThumbnail', imagePath),
  readClipboardImage: (): Promise<string | null> => ipcRenderer.invoke('clipboard:readImage'),
  copyImageToClipboard: (imagePath: string): Promise<boolean> => ipcRenderer.invoke('clipboard:writeImage', imagePath),
  copyImageDataToClipboard: (data: Uint8Array): Promise<boolean> => ipcRenderer.invoke('clipboard:writeImageData', data),
  writeTempImage: (data: Uint8Array): Promise<string> => ipcRenderer.invoke('image:writeTempImage', data),

  // IA Local (Ollama)
  getLocalStatus: (): Promise<{ ok: boolean; models: string[]; model: string }> => ipcRenderer.invoke('local:status'),
  installLocalAI: (): Promise<boolean> => ipcRenderer.invoke('local:install'),
  uninstallLocalAI: (): Promise<boolean> => ipcRenderer.invoke('local:uninstall'),
  onLocalInstallProgress: (
    cb: (p: { phase: string; percent: number; message: string; error?: string }) => void,
  ) => {
    const handler = (_e: Electron.IpcRendererEvent, p: { phase: string; percent: number; message: string; error?: string }) => cb(p)
    ipcRenderer.on('local:installProgress', handler)
    return () => ipcRenderer.off('local:installProgress', handler)
  },

  // Settings
  getApiKey: (provider: string): Promise<string | null> => ipcRenderer.invoke('settings:getApiKey', provider),
  setApiKey: (provider: string, key: string) => ipcRenderer.invoke('settings:setApiKey', provider, key),
  getSetting: (key: string): Promise<string | null> => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),

  // Canvas files
  autoBackup: (data: { name: string; nodes: unknown[]; tags: unknown[] }): Promise<string | null> => ipcRenderer.invoke('canvas:autoBackup', data),
  saveToPath: (filePath: string, data: { name: string; nodes: unknown[]; tags: unknown[] }): Promise<boolean> => ipcRenderer.invoke('canvas:saveToPath', filePath, data),
  exportCanvasFile: (data: { name: string; nodes: unknown[]; tags: unknown[] }): Promise<string | null> => ipcRenderer.invoke('canvas:exportFile', data),
  openCanvasFile: (): Promise<{ version: number; name: string; nodes: unknown[]; tags: unknown[] } | null> => ipcRenderer.invoke('canvas:openFile'),

  // Canvas
  listCanvases: () => ipcRenderer.invoke('canvas:list'),
  loadCanvas: (canvasId: string) => ipcRenderer.invoke('canvas:load', canvasId),
  createCanvas: (name: string) => ipcRenderer.invoke('canvas:create', name),
  renameCanvas: (id: string, name: string) => ipcRenderer.invoke('canvas:rename', id, name),
  deleteCanvas: (id: string) => ipcRenderer.invoke('canvas:delete', id),

  // Prompt optimization
  optimizePrompt: (prompt: string, modelId: string): Promise<string> => ipcRenderer.invoke('prompt:optimize', prompt, modelId),
  // Prompt de animação a partir de 2 imagens (first/last frame)
  animatePrompt: (firstPath: string, lastPath: string): Promise<string> => ipcRenderer.invoke('prompt:animate', firstPath, lastPath),

  // Tag translation
  translateTags: (values: string[], targetLang: 'pt' | 'en'): Promise<string[]> => ipcRenderer.invoke('tags:translate', values, targetLang),

  // Speech transcription
  transcribeAudio: (audioData: Uint8Array): Promise<string> => ipcRenderer.invoke('speech:transcribe', audioData),

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdateAvailable: (cb: (info: { version: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, info: { version: string }) => cb(info)
    ipcRenderer.on('updater:updateAvailable', handler)
    return () => ipcRenderer.off('updater:updateAvailable', handler)
  },
  onDownloadProgress: (cb: (percent: number) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, percent: number) => cb(percent)
    ipcRenderer.on('updater:downloadProgress', handler)
    return () => ipcRenderer.off('updater:downloadProgress', handler)
  },
  onUpdateDownloaded: (cb: (version: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, version: string) => cb(version)
    ipcRenderer.on('updater:updateDownloaded', handler)
    return () => ipcRenderer.off('updater:updateDownloaded', handler)
  },
  onUpdateError: (cb: (msg: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, msg: string) => cb(msg)
    ipcRenderer.on('updater:error', handler)
    return () => ipcRenderer.off('updater:error', handler)
  },

  // Nodes
  createNode: (node: unknown) => ipcRenderer.invoke('node:create', node),
  updateNodeMetadata: (id: string, source: string, modelName?: string) => ipcRenderer.invoke('node:updateMetadata', id, source, modelName),
  updateNodeThumbnail: (id: string, thumbPath: string) => ipcRenderer.invoke('node:updateThumbnail', id, thumbPath),
  setNodeStarred: (id: string, starred: boolean) => ipcRenderer.invoke('node:setStarred', id, starred),
  updateNodePosition: (id: string, x: number, y: number) => ipcRenderer.invoke('node:updatePosition', id, x, y),
  updateNodeSize: (id: string, width: number, height: number) => ipcRenderer.invoke('node:updateSize', id, width, height),
  deleteNode: (id: string) => ipcRenderer.invoke('node:delete', id),
  saveNodeTags: (nodeId: string, tags: unknown, tagLang?: 'en' | 'pt') => ipcRenderer.invoke('node:saveTags', nodeId, tags, tagLang),
  createGroupNode: (groupNode: { id: string; canvasId: string; x: number; y: number; width: number; height: number; label?: string }, childIds: string[]) =>
    ipcRenderer.invoke('node:createGroup', groupNode, childIds),
  updateGroupLabel: (id: string, label: string) => ipcRenderer.invoke('node:updateGroupLabel', id, label),
  updateNodeParent: (id: string, parentId: string | null) => ipcRenderer.invoke('node:updateParent', id, parentId),
  deleteNodeWithChildren: (id: string) => ipcRenderer.invoke('node:deleteWithChildren', id),
}

contextBridge.exposeInMainWorld('api', api)

export type AppApi = typeof api
