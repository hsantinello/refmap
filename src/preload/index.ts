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

  // Metadata
  extractMetadata: (imagePath: string) => ipcRenderer.invoke('image:extractMetadata', imagePath),
  analyzeWithAI: (imagePath: string) => ipcRenderer.invoke('image:analyzeWithAI', imagePath),

  // Settings
  getApiKey: (provider: string): Promise<string | null> => ipcRenderer.invoke('settings:getApiKey', provider),
  setApiKey: (provider: string, key: string) => ipcRenderer.invoke('settings:setApiKey', provider, key),
  getSetting: (key: string): Promise<string | null> => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),

  // Canvas files
  exportCanvasFile: (data: { name: string; nodes: unknown[]; tags: unknown[] }) => ipcRenderer.invoke('canvas:exportFile', data),
  openCanvasFile: (): Promise<{ version: number; name: string; nodes: unknown[]; tags: unknown[] } | null> => ipcRenderer.invoke('canvas:openFile'),

  // Canvas
  listCanvases: () => ipcRenderer.invoke('canvas:list'),
  loadCanvas: (canvasId: string) => ipcRenderer.invoke('canvas:load', canvasId),
  createCanvas: (name: string) => ipcRenderer.invoke('canvas:create', name),
  renameCanvas: (id: string, name: string) => ipcRenderer.invoke('canvas:rename', id, name),
  deleteCanvas: (id: string) => ipcRenderer.invoke('canvas:delete', id),

  // Prompt optimization
  optimizePrompt: (prompt: string, modelId: string): Promise<string> => ipcRenderer.invoke('prompt:optimize', prompt, modelId),

  // Nodes
  createNode: (node: unknown) => ipcRenderer.invoke('node:create', node),
  updateNodeMetadata: (id: string, source: string, modelName?: string) => ipcRenderer.invoke('node:updateMetadata', id, source, modelName),
  updateNodePosition: (id: string, x: number, y: number) => ipcRenderer.invoke('node:updatePosition', id, x, y),
  updateNodeSize: (id: string, width: number, height: number) => ipcRenderer.invoke('node:updateSize', id, width, height),
  deleteNode: (id: string) => ipcRenderer.invoke('node:delete', id),
  saveNodeTags: (nodeId: string, tags: unknown) => ipcRenderer.invoke('node:saveTags', nodeId, tags),
  createGroupNode: (groupNode: { id: string; canvasId: string; x: number; y: number; width: number; height: number }, childIds: string[]) =>
    ipcRenderer.invoke('node:createGroup', groupNode, childIds),
  updateNodeParent: (id: string, parentId: string | null) => ipcRenderer.invoke('node:updateParent', id, parentId),
  deleteNodeWithChildren: (id: string) => ipcRenderer.invoke('node:deleteWithChildren', id),
}

contextBridge.exposeInMainWorld('api', api)

export type AppApi = typeof api
