import { useEffect, useState } from 'react'
import logoUrl from '../../assets/logo.png'

interface AboutProps {
  onClose: () => void
}

export default function About({ onClose }: AboutProps) {
  const [version, setVersion] = useState('...')
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    window.api.getVersion().then(setVersion)
  }, [])

  const handleClose = () => {
    setClosing(true)
    setTimeout(onClose, 155)
  }

  return (
    <div
      className={`${closing ? 'rm-backdrop-out' : 'rm-backdrop'} fixed inset-0 flex items-center justify-center z-50`}
      onClick={handleClose}
    >
      <div
        className={`${closing ? 'rm-modal-exit' : 'rm-modal-enter'} rm-panel !border-transparent w-[320px]`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ padding: '15px' }}>
          <div className="flex items-center gap-2">
            <img src={logoUrl} alt="Ref Map" className="w-6 h-6 rounded-md" />
            <div className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-white/80 text-sm font-medium">Ref Map</span>
              <span className="text-white/25 text-[10px]">v{version}</span>
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{ border: '1px solid rgba(255,255,255,0.12)' }}
            className="w-6 h-6 flex items-center justify-center text-white/25 hover:text-white/60 transition-colors rounded-md hover:bg-white/[0.06]"
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
              <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="space-y-4" style={{ padding: '6px 15px 15px' }}>
          <p className="text-white/40 text-[12px] leading-relaxed">
            Canvas de referências para criadores de conteúdo com IA. Extraia metadados, gere tags e componha prompts melhores.
          </p>

        </div>

        <div style={{ padding: '0 15px 15px' }}>
          <button
            onClick={handleClose}
            style={{ paddingTop: '10px', paddingBottom: '10px' }}
            className="w-full rounded-lg text-sm text-white/35 hover:text-white/65 hover:bg-white/[0.05] transition-all"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
