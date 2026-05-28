import { useState } from 'react'

interface OnboardingProps {
  onComplete: () => void
}

const STEPS = [
  {
    title: 'Importe imagens de referência',
    description: 'Arraste imagens direto para o canvas ou clique em "Importar". Suporta PNG, JPG e WEBP de qualquer ferramenta de IA.',
    icon: '🖼️',
  },
  {
    title: 'Veja as tags extraídas',
    description: 'O Ref Map lê automaticamente os metadados de ComfyUI, A1111 e Midjourney. Para outras imagens, usa IA de visão para gerar tags.',
    icon: '🔍',
  },
  {
    title: 'Monte seu prompt',
    description: 'Clique em qualquer tag para adicioná-la ao Prompt Builder. Reordene, edite e copie o prompt pronto para usar.',
    icon: '✨',
  },
]

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0)

  const handleComplete = async () => {
    await window.api.setSetting('onboardingCompleted', 'true')
    onComplete()
  }

  return (
    <div className="fixed inset-0 bg-[#0f0f13] flex items-center justify-center z-50">
      <div className="w-[480px] text-center">
        <h1 className="text-2xl font-bold text-white mb-2">Bem-vindo ao Ref Map</h1>
        <p className="text-white/40 text-sm mb-10">
          Seu canvas de referências para criar prompts melhores com IA
        </p>

        {/* Steps */}
        <div className="flex gap-2 justify-center mb-8">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={`w-2 h-2 rounded-full transition-all ${
                i === step ? 'bg-purple-500 w-6' : 'bg-white/20 hover:bg-white/40'
              }`}
            />
          ))}
        </div>

        {/* Current step */}
        <div className="bg-white/5 rounded-2xl p-8 mb-8">
          <div className="text-5xl mb-4">{STEPS[step].icon}</div>
          <h2 className="text-lg font-semibold text-white mb-2">{STEPS[step].title}</h2>
          <p className="text-white/50 text-sm leading-relaxed">{STEPS[step].description}</p>
        </div>

        {/* Navigation */}
        <div className="flex gap-3 justify-center">
          {step < STEPS.length - 1 ? (
            <>
              <button
                onClick={handleComplete}
                className="px-5 py-2 text-sm text-white/40 hover:text-white/60 transition-colors"
              >
                Pular
              </button>
              <button
                onClick={() => setStep(s => s + 1)}
                className="px-8 py-2.5 bg-purple-600/80 hover:bg-purple-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Próximo →
              </button>
            </>
          ) : (
            <button
              onClick={handleComplete}
              className="px-10 py-2.5 bg-purple-600/80 hover:bg-purple-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Começar agora →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
