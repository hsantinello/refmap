import { useEffect, useState } from 'react'
import { create } from 'zustand'

// Diálogo de confirmação do próprio app, no lugar do window.confirm.
//
// O window.confirm tinha dois problemas: aparecia como caixa cinza do Windows
// dentro de uma janela sem moldura e toda estilizada, e BLOQUEIA o renderer
// inteiro enquanto está aberto (nenhuma animação, nenhum render). Este some com
// os dois e ainda permite destacar a ação destrutiva em vermelho.
//
// Uso, igual ao confirm nativo mas com await:
//   if (!await confirmar({ titulo: 'Apagar?', mensagem: '...' })) return

export interface OpcoesConfirmacao {
  titulo: string
  mensagem: string
  /** Texto do botão que confirma. Prefira um verbo ("Apagar"), não "OK". */
  confirmar?: string
  cancelar?: string
  /** Pinta o botão de confirmar de vermelho e o torna a ação secundária visualmente. */
  perigo?: boolean
}

interface Pedido extends OpcoesConfirmacao {
  resolve: (ok: boolean) => void
}

const useConfirmStore = create<{
  pedido: Pedido | null
  abrir: (p: Pedido) => void
  fechar: () => void
}>(set => ({
  pedido: null,
  abrir: pedido => set({ pedido }),
  fechar: () => set({ pedido: null }),
}))

/**
 * Pergunta ao usuário e resolve com true/false. Fora de um componente React,
 * então pode ser chamada de qualquer handler.
 */
export function confirmar(opcoes: OpcoesConfirmacao): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const anterior = useConfirmStore.getState().pedido
    // Dois pedidos ao mesmo tempo não deveriam acontecer, mas se acontecerem o
    // anterior não pode ficar com a Promise pendurada para sempre.
    anterior?.resolve(false)
    useConfirmStore.getState().abrir({ ...opcoes, resolve })
  })
}

/** Montado uma vez no App. Sem ele, confirmar() nunca resolve. */
export function ConfirmHost() {
  const pedido = useConfirmStore(s => s.pedido)
  const fechar = useConfirmStore(s => s.fechar)
  const [saindo, setSaindo] = useState(false)

  const responder = (ok: boolean) => {
    if (saindo) return
    setSaindo(true)
    // Espera a animação de saída antes de desmontar, como nos outros modais.
    setTimeout(() => {
      pedido?.resolve(ok)
      fechar()
      setSaindo(false)
    }, 155)
  }

  // Enter confirma, Esc cancela — o mesmo par de teclas do diálogo nativo.
  useEffect(() => {
    if (!pedido) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); responder(false) }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); responder(true) }
    }
    // capture: o canvas escuta teclas na window e reagiria a Enter/Esc por baixo.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pedido, saindo])

  if (!pedido) return null

  const corConfirmar = pedido.perigo
    ? 'bg-red-500/15 text-red-300/90 hover:bg-red-500/25 border-red-500/25'
    : 'bg-white/[0.08] text-white/70 hover:bg-white/[0.14] border-white/[0.12]'

  return (
    <div
      className={`${saindo ? 'rm-backdrop-out' : 'rm-backdrop'} fixed inset-0 flex items-center justify-center z-[100]`}
      onClick={() => responder(false)}
    >
      <div
        className={`${saindo ? 'rm-modal-exit' : 'rm-modal-enter'} rm-panel !border-transparent w-[330px]`}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '15px 15px 6px' }}>
          <h2 className="text-white/80 text-sm font-medium">{pedido.titulo}</h2>
        </div>

        <div style={{ padding: '0 15px 15px' }}>
          <p className="text-white/40 text-[12px] leading-relaxed">{pedido.mensagem}</p>
        </div>

        <div className="flex gap-2" style={{ padding: '0 15px 15px' }}>
          <button
            onClick={() => responder(false)}
            style={{ paddingTop: '9px', paddingBottom: '9px', border: '1px solid rgba(255,255,255,0.10)' }}
            className="flex-1 rounded-lg text-[12px] text-white/45 hover:text-white/70 hover:bg-white/[0.05] transition-colors"
          >
            {pedido.cancelar ?? 'Cancelar'}
          </button>
          <button
            onClick={() => responder(true)}
            autoFocus
            style={{ paddingTop: '9px', paddingBottom: '9px', borderWidth: '1px', borderStyle: 'solid' }}
            className={`flex-1 rounded-lg text-[12px] transition-colors ${corConfirmar}`}
          >
            {pedido.confirmar ?? 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
