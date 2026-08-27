import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Acompanhamento da atualização em andamento.
//
// Papéis divididos com o sininho da barra de título: ele ANUNCIA que existe
// versão nova (bolinha vermelha), mostra as novidades e começa o download. Este
// banner só ACOMPANHA o que já foi iniciado, para o progresso e o "reiniciar
// para instalar" ficarem visíveis sem manter o painel do sininho aberto.
//
// Por isso ele NÃO trata mais 'available' nem 'error': a mesma novidade em dois
// lugares, com dois botões "Baixar", era ruído — e falha ao consultar
// atualização não merece interromper ninguém (ela aparece dentro do sininho).

type UpdateState =
  | { status: 'idle' }
  | { status: 'downloading'; percent: number }
  | { status: 'ready'; version: string }

export default function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const offProgress = window.api.onDownloadProgress((percent) => {
      setUpdate({ status: 'downloading', percent })
      // Um download novo reabre o banner mesmo que o anterior tenha sido fechado.
      setDismissed(false)
    })

    const offDownloaded = window.api.onUpdateDownloaded((version) => {
      setUpdate({ status: 'ready', version })
    })

    return () => {
      offProgress()
      offDownloaded()
    }
  }, [])

  const visible = !dismissed && update.status !== 'idle'

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-auto flex items-center gap-3 pl-4 pr-2 py-1.5 text-xs rounded-full"
          style={{
            background: 'rgba(18,18,20,0.92)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(251,146,60,0.22)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
          }}
        >
          <span className="text-white/70">
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
          </span>

          <div className="flex items-center gap-2">
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
              <>
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
                <button
                  onClick={() => setDismissed(true)}
                  className="text-white/30 hover:text-white/60 transition-colors cursor-pointer leading-none"
                >
                  ✕
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
