import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

interface OnboardingProps {
  onComplete: () => void
}

const STEPS = [
  {
    title: 'Importe suas referências',
    description: 'Arraste suas imagens para o Canvas ou clique em +. Suporta PNG, JPG e WEBP.',
    illustration: IllustrationImport,
  },
  {
    title: 'Explore os metadados',
    description: 'Clique em qualquer imagem no canvas para ver todas as informações extraídas: modelo, sampler, steps, seed, LoRAs e muito mais.',
    illustration: IllustrationClick,
  },
  {
    title: 'Monte e otimize seu prompt',
    description: 'Clique nas tags para adicioná-las ao Prompt Builder. Reordene, edite manualmente e use a IA para otimizar o prompt para o modelo que quiser.',
    illustration: IllustrationPrompt,
  },
]

function IllustrationImport() {
  return (
    <svg width="260" height="148" viewBox="0 0 260 148" fill="none">
      {/* Canvas background */}
      <rect x="8" y="8" width="244" height="132" rx="12" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.07)" strokeWidth="1"/>

      {/* Drop zone */}
      <rect x="28" y="24" width="110" height="100" rx="8" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.12)" strokeWidth="1.2" strokeDasharray="5 4"/>
      {/* + button in place of upload arrow */}
      <rect x="60" y="62" width="46" height="22" rx="6" fill="rgba(251,146,60,0.2)" stroke="rgba(251,146,60,0.4)" strokeWidth="1"/>
      <text x="83" y="77" textAnchor="middle" fill="rgba(251,146,60,0.9)" fontSize="12" fontFamily="system-ui" fontWeight="600">+</text>
      <text x="83" y="96" textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="9" fontFamily="system-ui">arraste aqui</text>

      {/* Image being dragged */}
      <g style={{ filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.6))' }}>
        <rect x="140" y="20" width="72" height="60" rx="6" fill="rgba(251,146,60,0.15)" stroke="rgba(251,146,60,0.4)" strokeWidth="1.2"/>
        <rect x="148" y="28" width="56" height="36" rx="3" fill="rgba(251,146,60,0.2)"/>
        <path d="M148 52l12-10 10 8 8-6 14 10" stroke="rgba(251,146,60,0.6)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="158" cy="36" r="4" fill="rgba(251,146,60,0.5)"/>
        <text x="176" y="72" textAnchor="middle" fill="rgba(251,146,60,0.7)" fontSize="8" fontFamily="system-ui" fontWeight="500">imagem.png</text>
      </g>

      {/* Arrow */}
      <path d="M138 56 L112 68" stroke="rgba(251,146,60,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 3"/>
      <path d="M112 68l6-2-3 5" fill="rgba(251,146,60,0.5)"/>
    </svg>
  )
}

function IllustrationClick() {
  return (
    <svg width="260" height="148" viewBox="0 0 260 148" fill="none">
      {/* Canvas background */}
      <rect x="8" y="8" width="244" height="132" rx="12" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.07)" strokeWidth="1"/>

      {/* Selected image */}
      <rect x="20" y="22" width="88" height="104" rx="8" fill="rgba(255,255,255,0.04)" stroke="rgba(251,146,60,0.6)" strokeWidth="1.5"/>
      <rect x="26" y="28" width="76" height="58" rx="4" fill="rgba(255,255,255,0.06)"/>
      <path d="M26 72l18-14 14 11 12-9 22 15" stroke="rgba(255,255,255,0.2)" strokeWidth="1.2" strokeLinecap="round"/>
      <circle cx="40" cy="40" r="6" fill="rgba(255,255,255,0.1)"/>
      {/* Selection handles */}
      <rect x="17" y="19" width="6" height="6" rx="1.5" fill="rgba(251,146,60,0.7)"/>
      <rect x="105" y="19" width="6" height="6" rx="1.5" fill="rgba(251,146,60,0.7)"/>
      <rect x="17" y="123" width="6" height="6" rx="1.5" fill="rgba(251,146,60,0.7)"/>
      <rect x="105" y="123" width="6" height="6" rx="1.5" fill="rgba(251,146,60,0.7)"/>
      {/* Tags under image */}
      <rect x="26" y="94" width="34" height="12" rx="3" fill="rgba(251,146,60,0.2)"/>
      <text x="43" y="103" textAnchor="middle" fill="rgba(251,146,60,0.8)" fontSize="7" fontFamily="system-ui">comfyui</text>
      <rect x="64" y="94" width="28" height="12" rx="3" fill="rgba(255,255,255,0.06)"/>
      <text x="78" y="103" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="7" fontFamily="system-ui">sdxl</text>

      {/* Arrow */}
      <path d="M114 74 L136 74" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M130 70l6 4-6 4" stroke="rgba(255,255,255,0.2)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>

      {/* Info panel */}
      <rect x="140" y="18" width="108" height="112" rx="8" fill="rgba(0,0,0,0.4)" stroke="rgba(255,255,255,0.07)" strokeWidth="1"/>
      {/* Panel rows */}
      {[
        { y: 32, label: 'Modelo', value: 'DreamShaper XL', w: 70 },
        { y: 56, label: 'Sampler', value: 'DPM++ 2M', w: 52 },
        { y: 80, label: 'Steps', value: '28', w: 20 },
        { y: 104, label: 'Seed', value: '4829301...', w: 48 },
      ].map(({ y, label, value, w }) => (
        <g key={y}>
          <text x="152" y={y} fill="rgba(255,255,255,0.25)" fontSize="7.5" fontFamily="system-ui">{label}</text>
          <rect x="152" y={y + 5} width={w} height="10" rx="2.5" fill="rgba(255,255,255,0.06)"/>
          <text x="156" y={y + 13} fill="rgba(255,255,255,0.5)" fontSize="7" fontFamily="system-ui">{value}</text>
        </g>
      ))}
    </svg>
  )
}

function IllustrationPrompt() {
  return (
    <svg width="260" height="148" viewBox="0 0 260 148" fill="none">
      {/* Canvas background */}
      <rect x="8" y="8" width="244" height="132" rx="12" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.07)" strokeWidth="1"/>

      {/* Image with tags */}
      <rect x="20" y="18" width="80" height="72" rx="6" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
      <rect x="26" y="24" width="68" height="44" rx="3" fill="rgba(255,255,255,0.05)"/>
      <path d="M26 54l14-11 12 9 10-7 18 13" stroke="rgba(255,255,255,0.15)" strokeWidth="1.1" strokeLinecap="round"/>

      {/* Clickable tags */}
      {[
        { x: 20, y: 96, text: 'cinematic', active: true },
        { x: 74, y: 96, text: 'soft light', active: true },
        { x: 20, y: 112, text: 'bokeh', active: false },
        { x: 60, y: 112, text: 'portrait', active: true },
      ].map(({ x, y, text, active }) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width={text.length * 5.5 + 10} height="12" rx="3"
            fill={active ? 'rgba(251,146,60,0.25)' : 'rgba(255,255,255,0.06)'}
            stroke={active ? 'rgba(251,146,60,0.5)' : 'none'} strokeWidth="0.8"/>
          <text x={x + (text.length * 5.5 + 10) / 2} y={y + 8.5} textAnchor="middle"
            fill={active ? 'rgba(251,146,60,0.9)' : 'rgba(255,255,255,0.35)'} fontSize="7" fontFamily="system-ui">{text}</text>
        </g>
      ))}

      {/* Arrows going to prompt bar */}
      <path d="M55 96 Q130 80 150 130" stroke="rgba(251,146,60,0.3)" strokeWidth="1" strokeDasharray="3 3" fill="none"/>

      {/* Prompt builder bar */}
      <rect x="18" y="124" width="224" height="18" rx="5" fill="rgba(0,0,0,0.5)" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
      {/* Chips in bar */}
      {[
        { x: 24, text: 'cinematic' },
        { x: 82, text: 'soft light' },
        { x: 136, text: 'portrait' },
      ].map(({ x, text }) => (
        <g key={x}>
          <rect x={x} y={128} width={text.length * 5 + 10} height="10" rx="2.5" fill="rgba(251,146,60,0.2)"/>
          <text x={x + (text.length * 5 + 10) / 2} y={135.5} textAnchor="middle" fill="rgba(251,146,60,0.85)" fontSize="6.5" fontFamily="system-ui">{text}</text>
        </g>
      ))}
      {/* Optimize button */}
      <rect x="204" y="128" width="32" height="10" rx="2.5" fill="rgba(168,85,247,0.35)"/>
      <text x="220" y="135.5" textAnchor="middle" fill="rgba(168,85,247,0.9)" fontSize="6.5" fontFamily="system-ui" fontWeight="600">Otimizar</text>
    </svg>
  )
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)

  const goTo = (next: number) => {
    setDirection(next > step ? 1 : -1)
    setStep(next)
  }

  const handleComplete = async () => {
    await window.api.setSetting('onboardingCompleted', 'true')
    onComplete()
  }

  const { title, description, illustration: Illustration } = STEPS[step]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)' }}
    >
      <div className="relative w-[380px] rm-panel !border-white/[0.08] rounded-3xl overflow-hidden">
        {/* Close */}
        <button
          onClick={handleComplete}
          className="absolute top-4 right-4 z-10 w-7 h-7 flex items-center justify-center rounded-full text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Illustration area */}
        <div className="flex items-center justify-center pt-8 pb-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              initial={{ opacity: 0, x: direction * 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -30 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              <Illustration />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Step dots */}
        <div className="flex gap-1.5 justify-center py-4 border-t border-white/[0.05]">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? 'w-6 bg-orange-400' : 'w-1.5 bg-white/20 hover:bg-white/40'
              }`}
            />
          ))}
        </div>

        {/* Text */}
        <div className="px-8 pb-2">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <h2 className="text-[15px] font-semibold text-white mb-2">{title}</h2>
              <p className="text-[12px] text-white/45 leading-relaxed">{description}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between px-8 py-5">
          <button
            onClick={() => step > 0 ? goTo(step - 1) : handleComplete()}
            className="text-[12px] text-white/30 hover:text-white/60 transition-colors"
          >
            {step === 0 ? 'Pular' : '← Anterior'}
          </button>

          {step < STEPS.length - 1 ? (
            <button
              onClick={() => goTo(step + 1)}
              className="px-5 py-2 bg-orange-500/80 hover:bg-orange-500 text-white rounded-lg text-[12px] font-medium transition-colors"
            >
              Próximo →
            </button>
          ) : (
            <button
              onClick={handleComplete}
              className="px-5 py-2 bg-orange-500/80 hover:bg-orange-500 text-white rounded-lg text-[12px] font-medium transition-colors"
            >
              Começar →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
