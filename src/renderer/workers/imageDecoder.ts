// Web Worker: decodes images off the main thread using OffscreenCanvas
// Receives: { id, src, width, radius }
// Responds: { id, bitmap } | { id, error }

const NODE_R = 14

self.onmessage = async (e: MessageEvent<{ id: string; src: string; width: number; radius?: number }>) => {
  const { id, src, width, radius = NODE_R } = e.data
  try {
    const response = await fetch(src)
    const blob = await response.blob()
    const img = await createImageBitmap(blob)

    const imgH = Math.round(width * img.height / img.width)
    const dpr = Math.min(self.devicePixelRatio || 1, 3)

    const off = new OffscreenCanvas(Math.round(width * dpr), Math.round(imgH * dpr))
    const ctx = off.getContext('2d') as OffscreenCanvasRenderingContext2D | null
    if (ctx) {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.scale(dpr, dpr)
      ctx.beginPath()
      ctx.roundRect(0, 0, width, imgH, radius)
      ctx.clip()
      ctx.drawImage(img, 0, 0, width, imgH)
      img.close()
    }

    const bitmap = off.transferToImageBitmap()
    self.postMessage({ id, bitmap, imgH, dpr }, [bitmap] as unknown as Transferable[])
  } catch (err) {
    self.postMessage({ id, error: String(err) })
  }
}
