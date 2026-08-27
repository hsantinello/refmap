import { motion } from 'framer-motion'
import { friendlyError } from '../lib/friendlyError'

export interface LocalInstallProgress {
  phase: string
  percent: number
  message: string
  error?: string
}

// Barra fina no topo que mostra o progresso do download/instalação da IA local.
// Fica no App (sempre montado), então persiste mesmo com as Settings fechadas.
export default function LocalInstallBanner({ progress, onRetry }: { progress: LocalInstallProgress; onRetry?: () => void }) {
  const { phase, percent, message, error } = progress
  const isError = phase === 'error'
  const isDone = phase === 'done'
  // A pílula é estreita e trunca: mostramos só a frase do "o que houve" e
  // deixamos a solução + o texto técnico no tooltip.
  const friendly = isError ? friendlyError(error, 'Não foi possível instalar a IA local.') : null

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.96 }}
      transition={{ duration: 0.2 }}
      className="pointer-events-auto flex items-center gap-3 px-4 py-1.5 text-xs rounded-full"
      style={{
        background: 'rgba(18,18,20,0.92)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${isError ? 'rgba(248,113,113,0.3)' : 'rgba(249,115,22,0.22)'}`,
        boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
      }}
    >
      <span
        className="text-white/70 truncate"
        title={friendly ? [friendly.message, friendly.action, friendly.technical].filter(Boolean).join('\n\n') : undefined}
      >
        {isError
          ? friendly!.message
          : isDone
            ? 'IA local pronta!'
            : <>IA Local · <span className="text-white/50">{message}</span></>}
      </span>

      {!isError && !isDone && (
        <div className="flex items-center gap-2 shrink-0">
          {percent >= 0 && <span className="text-white/40">{percent}%</span>}
          <div className="w-28 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <div
              className={`h-full rounded-full ${percent < 0 ? 'animate-pulse' : 'transition-all duration-300'}`}
              style={{ width: percent < 0 ? '100%' : `${percent}%`, background: 'linear-gradient(90deg,#8f0e2e,#F97316)' }}
            />
          </div>
        </div>
      )}

      {/* Instalar de novo dali mesmo. A maioria das falhas aqui é transitória
          (arquivo travado, rede caindo no meio do download) e some na segunda
          tentativa — mas antes o usuário tinha que caçar o botão nas Configurações. */}
      {isError && onRetry && friendly!.recovery === 'retry' && (
        <button
          onClick={onRetry}
          className="shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] text-white/60 hover:text-white/90 bg-white/[0.08] hover:bg-white/[0.16] transition-colors"
        >
          Tentar de novo
        </button>
      )}

      {isDone && (
        <svg className="shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
      )}
    </motion.div>
  )
}
