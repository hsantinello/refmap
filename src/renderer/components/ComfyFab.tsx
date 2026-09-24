// Botão flutuante do ComfyUI: logo abaixo da barra de zoom do canvas, alinhado
// à direita dela. A barra fica em top-3 dentro do canvas (TopBar de 32 px + 12 px
// = 44 px do topo da janela), tem 48 px de altura (py-1.5 + botões de 36 px) e
// termina a 24 px da borda direita (px-3 do container + right-3). Daí:
// top = 44 + 48 + 8 de folga = 100 px; right = 24 px.
// Discreto de propósito: pequeno e apagado, acende no hover. Fica fora do
// TopBar porque a barra é região de arrasto da janela.

import { useT } from '../i18n'
import LogoComfy from './LogoComfy'

export default function ComfyFab({ onClick, escondido = false }: { onClick: () => void; escondido?: boolean }) {
  const t = useT()
  return (
    <button
      onClick={onClick}
      title={t('comfy.button')}
      aria-label={t('comfy.button')}
      className={`rm-panel !rounded-full fixed top-[100px] right-6 z-40 w-8 h-8 flex items-center justify-center
        transition-all duration-200 hover:!opacity-100 hover:scale-110 active:scale-95
        ${escondido ? 'opacity-0 pointer-events-none translate-x-3' : 'opacity-45'}`}
      style={{ boxShadow: '0 6px 16px -6px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)' }}
    >
      <LogoComfy size={15} />
    </button>
  )
}
