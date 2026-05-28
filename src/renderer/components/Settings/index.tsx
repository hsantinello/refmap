import { useState, useEffect } from 'react'

interface SettingsProps {
  onClose: () => void
  onKeySaved?: () => void
}

export default function Settings({ onClose, onKeySaved }: SettingsProps) {
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [closing, setClosing] = useState(false)
  const [showKeyHelp, setShowKeyHelp] = useState(false)

  const handleClose = () => {
    setClosing(true)
    setTimeout(onClose, 155)
  }

  useEffect(() => {
    const load = async () => {
      const savedProvider = (await window.api.getSetting('aiProvider')) as 'anthropic' | 'openai' | null
      if (savedProvider) setProvider(savedProvider)
      const key = await window.api.getApiKey(savedProvider ?? 'anthropic')
      if (key) setApiKey(key)
    }
    load()
  }, [])

  const handleSave = async () => {
    await window.api.setApiKey(provider, apiKey)
    await window.api.setSetting('aiProvider', provider)
    onKeySaved?.()
    setSaved(true)
    setTimeout(() => { setSaved(false); handleClose() }, 1200)
  }

  const handleProviderChange = async (p: 'anthropic' | 'openai') => {
    setProvider(p)
    setTestResult(null)
    const key = await window.api.getApiKey(p)
    setApiKey(key ?? '')
  }

  return (
    <div
      className={`${closing ? 'rm-backdrop-out' : 'rm-backdrop'} fixed inset-0 flex items-center justify-center z-50`}
      onClick={handleClose}
    >
      <div
        className={`${closing ? 'rm-modal-exit' : 'rm-modal-enter'} rm-panel !border-transparent w-[400px]`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ padding: '15px' }}>
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
            <span className="text-white/80 text-sm font-medium">Conecte sua API</span>
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

        <div className="space-y-5" style={{ padding: '6px 15px 15px' }}>
          {/* Provider selector */}
          <div>
            <label className="text-[11px] text-white/60 uppercase tracking-widest mb-2.5 block font-medium">
              Provedor
            </label>
            <div className="flex gap-2">
              {(['anthropic', 'openai'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => handleProviderChange(p)}
                  style={{ paddingTop: '10px', paddingBottom: '10px' }}
                  className={`flex-1 rounded-lg text-xs font-medium transition-all ${
                    provider === p
                      ? 'bg-white/[0.10] text-white/90'
                      : 'bg-white/[0.03] text-white/35 hover:text-white/60 hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    {p === 'anthropic' ? (
                      <img
                        src={new URL('../../../../ID/anthropic.webp', import.meta.url).href}
                        alt=""
                        style={{ width: 14, height: 14, filter: 'invert(1)', mixBlendMode: 'screen', opacity: provider === p ? 0.9 : 0.35 }}
                      />
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M22.282 9.821a6 6 0 0 0-.516-4.91 6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9 6.05 6.05 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206 6 6 0 0 0 3.997-2.9 6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023-.141-.085-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5Z"/>
                      </svg>
                    )}
                    {p === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[13px] text-white/25 mt-2" style={{ marginBottom: '10px' }}>
              {provider === 'anthropic'
                ? 'claude-haiku-4-5 — rápido e econômico'
                : 'gpt-4o-mini — alternativa OpenAI'}
            </p>
          </div>

          {/* API Key input */}
          <div>
            <div className="flex items-center gap-1.5 mb-2.5">
              <label className="text-[11px] text-white/60 uppercase tracking-widest font-medium">
                Chave
              </label>
              <div className="relative">
                <button
                  onClick={() => setShowKeyHelp(v => !v)}
                  className="w-3.5 h-3.5 rounded-full bg-white/[0.08] text-white/35 hover:text-white/70 hover:bg-white/[0.14] transition-all flex items-center justify-center text-[9px] font-bold leading-none"
                >
                  ?
                </button>
                {showKeyHelp && (
                  <button
                    onClick={() => {
                      window.api.openExternal(
                        provider === 'anthropic'
                          ? 'https://platform.claude.com/settings/keys'
                          : 'https://platform.openai.com/api-keys'
                      )
                      setShowKeyHelp(false)
                    }}
                    className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-3 py-2 rounded-lg text-xs font-medium bg-white/[0.10] text-white/90 hover:bg-white/[0.14] hover:text-white transition-all whitespace-nowrap z-10"
                  >
                    Gere sua API Key →
                  </button>
                )}
              </div>
            </div>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
                style={{ paddingTop: '6px', paddingBottom: '6px', paddingLeft: '14px' }}
                className="w-full bg-white/[0.08] rounded-lg text-sm text-white/90 placeholder:text-white/25 outline-none focus:bg-white/[0.12] transition-all pr-9 font-mono"
              />
              <button
                onClick={() => setShowKey(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/50 transition-colors"
                tabIndex={-1}
              >
                {showKey ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
            <p className="flex items-center gap-1 text-[11px] text-white/20 mt-2">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1.5 6 4.5 9 10.5 3"/>
              </svg>
              Sua chave é salva localmente com criptografia de ponta a ponta.
            </p>
          </div>

          {testResult && (
            <div className={`text-xs rounded-lg px-3 py-2.5 border ${
              testResult.startsWith('✓')
                ? 'bg-green-500/10 text-green-400/80 border-green-500/20'
                : 'bg-red-500/10 text-red-400/80 border-red-500/20'
            }`}>
              {testResult}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2" style={{ padding: '0 15px 15px' }}>
          <button
            onClick={handleSave}
            disabled={!apiKey.trim()}
            style={{ paddingTop: '10px', paddingBottom: '10px' }}
            className={`flex-1 rounded-lg text-sm font-medium transition-all ${
              saved
                ? 'bg-green-500/20 text-green-400'
                : apiKey.trim()
                  ? 'bg-white/[0.08] text-white/90 hover:bg-white/[0.12] hover:text-white'
                  : 'bg-white/[0.03] text-white/20 cursor-not-allowed'
            }`}
          >
            {saved ? '✓ Salvo' : 'Salvar'}
          </button>
          <button
            onClick={handleClose}
            style={{ paddingTop: '10px', paddingBottom: '10px' }}
            className="px-4 rounded-lg text-sm text-white/35 hover:text-white/65 hover:bg-white/[0.05] transition-all"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
