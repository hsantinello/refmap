import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

type UpdateState =
  | { status: 'idle' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

export default function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const offAvailable = window.api.onUpdateAvailable(({ version }) => {
      setUpdate({ status: 'available', version })
      setDismissed(false)
    })

    const offProgress = window.api.onDownloadProgress((percent) => {
      setUpdate({ status: 'downloading', percent })
    })

    const offDownloaded = window.api.onUpdateDownloaded((version) => {
      setUpdate({ status: 'ready', version })
    })

    const offError = window.api.onUpdateError((msg) => {
      setUpdate({ status: 'error', message: msg })
      setDismissed(false)
    })

    window.api.checkForUpdates().catch(() => {})

    return () => {
      offAvailable()
      offProgress()
      offDownloaded()
      offError()
    }
  }, [])

  const visible = !dismissed && update.status !== 'idle'

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="flex items-center justify-between px-4 py-1.5 text-xs"
          style={{
            background: 'rgba(180, 30, 40, 0.18)',
            borderBottom: '1px solid rgba(251, 146, 60, 0.2)',
          }}
        >
          <span className="text-white/70">
            {update.status === 'available' && (
              <>
                Nova versão <span className="font-semibold" style={{ color: 'rgba(251,146,60,0.95)' }}>v{update.version}</span> disponível
              </>
            )}
            {update.status === 'downloading' && (
              <>
                Baixando atualização…{' '}
                <span className="font-semibold" style={{ color: 'rgba(251,146,60,0.95)' }}>{update.percent}%</span>
              </>
            )}
            {update.status === 'ready' && (
              <>
                Atualização <span className="font-semibold" style={{ color: 'rgba(251,146,60,0.95)' }}>v{update.version}</span> pronta para instalar
              </>
            )}
            {update.status === 'error' && (
              <span style={{ color: 'rgba(251,146,60,0.8)' }}>
                Erro ao baixar atualização — baixe manualmente em refmap.app
              </span>
            )}
          </span>

          <div className="flex items-center gap-2">
            {update.status === 'available' && (
              <button
                onClick={() => {
                  setUpdate({ status: 'downloading', percent: 0 })
                  window.api.downloadUpdate()
                }}
                className="px-2.5 py-0.5 rounded font-medium cursor-pointer"
                style={{
                  color: 'rgba(251,146,60,0.95)',
                  background: 'rgba(251,146,60,0.15)',
                  border: '1px solid rgba(251,146,60,0.35)',
                }}
              >
                Baixar
              </button>
            )}

            {update.status === 'downloading' && (
              <div
                className="w-24 h-1 rounded-full overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.1)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${update.percent}%`, background: 'rgba(251,146,60,0.8)' }}
                />
              </div>
            )}

            {update.status === 'ready' && (
              <button
                onClick={() => window.api.installUpdate()}
                className="px-2.5 py-0.5 rounded font-medium cursor-pointer"
                style={{
                  color: 'rgba(251,146,60,0.95)',
                  background: 'rgba(251,146,60,0.15)',
                  border: '1px solid rgba(251,146,60,0.35)',
                }}
              >
                Reiniciar e instalar
              </button>
            )}

            {update.status !== 'downloading' && (
              <button
                onClick={() => setDismissed(true)}
                className="text-white/30 hover:text-white/60 transition-colors cursor-pointer leading-none"
              >
                ✕
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
