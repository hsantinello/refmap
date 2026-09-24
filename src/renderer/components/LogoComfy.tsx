// A marca do ComfyUI (o "C" em dois blocos inclinados), no laranja do app.
// Usada no botão da barra e no cabeçalho do painel — é a mesma logo nos dois.
// Traçado com a mesma cor e junção arredondada para arredondar os cantos.
// O id do gradiente leva um sufixo por instância: dois SVGs na mesma página com
// o mesmo id fariam um deles perder a cor.

import { useId } from 'react'

export default function LogoComfy({ size = 18, className }: { size?: number; className?: string }) {
  const id = `rm-comfy-logo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FDBA74" />
          <stop offset="0.45" stopColor="#F97316" />
          <stop offset="1" stopColor="#EA580C" />
        </linearGradient>
      </defs>
      <path d="M12.7 2H20.9L18.7 8.7H11.3L9.8 15.8H16.9L15.5 22H5.8L5.6 17.8H2.9L5.3 8.7Z"
        fill={`url(#${id})`} stroke={`url(#${id})`} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}
