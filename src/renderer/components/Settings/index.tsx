import { useState, useEffect } from 'react'
import type { LocalInstallProgress } from '../LocalInstallBanner'
import { friendlyError } from '../../lib/friendlyError'
import { confirmar } from '../ConfirmDialog'
import { useT, useTRich } from '../../i18n'

type View = 'choose' | 'api' | 'local'

interface SettingsProps {
  onClose: () => void
  onKeySaved?: () => void
  initialView?: View
  installProgress?: LocalInstallProgress | null   // vive no App → persiste ao fechar
  onInstallLocal?: () => void
  onUninstallLocal?: () => void
}

export default function Settings({ onClose, onKeySaved, initialView, installProgress, onInstallLocal, onUninstallLocal }: SettingsProps) {
  const t = useT()
  const tRich = useTRich()
  const [view, setView] = useState<View>(initialView ?? 'choose')
  const [provider, setProvider] = useState<'anthropic' | 'openai' | 'together'>('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [closing, setClosing] = useState(false)
  const [showKeyHelp, setShowKeyHelp] = useState(false)
  const [localStatus, setLocalStatus] = useState<'checking' | 'ok' | 'off'>('checking')
  const [localModel, setLocalModel] = useState('')

  const handleClose = () => {
    setClosing(true)
    setTimeout(onClose, 155)
  }

  useEffect(() => {
    const load = async () => {
      const savedProvider = (await window.api.getSetting('aiProvider')) as 'anthropic' | 'openai' | 'together' | null
      if (savedProvider) setProvider(savedProvider)
      const key = await window.api.getApiKey(savedProvider ?? 'anthropic')
      if (key) setApiKey(key)
    }
    load()
  }, [])

  // Checa se o Ollama (IA local) está rodando.
  useEffect(() => {
    window.api.getLocalStatus()
      .then(s => { setLocalStatus(s.ok ? 'ok' : 'off'); setLocalModel(s.model) })
      .catch(() => setLocalStatus('off'))
  }, [])

  // Ao concluir uma operação (instalar OU desinstalar), revalida o status real.
  useEffect(() => {
    if (installProgress?.phase === 'done') {
      window.api.getLocalStatus().then(s => setLocalStatus(s.ok ? 'ok' : 'off')).catch(() => {})
    }
  }, [installProgress])

  const handleUninstall = async () => {
    const ok = await confirmar({
      titulo: t('settings.local.uninstall.title'),
      mensagem: t('settings.local.uninstall.message'),
      confirmar: t('settings.local.uninstall.confirm'),
      perigo: true,
    })
    if (!ok) return
    onUninstallLocal?.()
  }

  const handleSave = async () => {
    await window.api.setApiKey(provider, apiKey)
    await window.api.setSetting('aiProvider', provider)
    onKeySaved?.()
    setSaved(true)
    setTimeout(() => { setSaved(false); handleClose() }, 1200)
  }

  const handleProviderChange = async (p: 'anthropic' | 'openai' | 'together') => {
    setProvider(p)
    const key = await window.api.getApiKey(p)
    setApiKey(key ?? '')
  }

  const title = view === 'choose' ? t('settings.title.choose') : view === 'api' ? t('settings.title.api') : t('settings.title.local')

  return (
    <div
      className={`${closing ? 'rm-backdrop-out' : 'rm-backdrop'} fixed inset-0 flex items-center justify-center z-50`}
      onClick={handleClose}
    >
      <div
        className={`rm-settings ${closing ? 'rm-modal-exit' : 'rm-modal-enter'} rm-panel !border-transparent w-[440px]`}
        onClick={e => e.stopPropagation()}
      >
        <style>{`
          /* Todo botão do modal mostra o cursor de clique. */
          .rm-settings button:not(:disabled) { cursor: pointer; }
          .rm-settings button:disabled { cursor: not-allowed; }
          /* Cards de escolha — hover moderno com destaque na cor de cada opção. */
          .choice-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            transition: transform .18s ease, background .18s ease, border-color .18s ease, box-shadow .18s ease;
          }
          .choice-card:hover { transform: translateY(-3px); background: rgba(255,255,255,0.06); }
          .choice-card:active { transform: translateY(-1px); }
          .choice-card__icon { transition: transform .18s ease, box-shadow .18s ease; }
          .choice-card:hover .choice-card__icon { transform: scale(1.08); }
          .choice-card--local:hover {
            border-color: rgba(52,211,153,0.55);
            box-shadow: 0 10px 28px rgba(52,211,153,0.14), inset 0 0 0 1px rgba(52,211,153,0.15);
          }
          .choice-card--local:hover .choice-card__icon { box-shadow: 0 0 18px rgba(52,211,153,0.35); }
          .choice-card--api:hover {
            border-color: rgba(249,115,22,0.55);
            box-shadow: 0 10px 28px rgba(249,115,22,0.16), inset 0 0 0 1px rgba(249,115,22,0.15);
          }
          .choice-card--api:hover .choice-card__icon { box-shadow: 0 0 18px rgba(249,115,22,0.4); }
        `}</style>
        {/* Header */}
        <div className="flex items-center justify-between" style={{ padding: '15px' }}>
          <div className="flex items-center gap-2">
            {view !== 'choose' && (
              <button
                onClick={() => setView('choose')}
                className="w-6 h-6 flex items-center justify-center text-white/40 hover:text-white/80 transition-colors rounded-md hover:bg-white/[0.06]"
                title={t('common.back')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6"/>
                </svg>
              </button>
            )}
            <span className="text-white/85 text-base font-semibold">{title}</span>
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

        {/* Progresso da instalação da IA local — global (aparece em qualquer aba) */}
        {installProgress && installProgress.phase !== 'done' && (
          <div style={{ padding: '0 15px 12px' }}>
            {installProgress.phase === 'error' ? (
              (() => {
                // Nunca mostramos o erro cru ("spawn EBUSY"): o tradutor devolve
                // o que aconteceu e o que o usuário pode fazer. O texto técnico
                // fica no title, para suporte.
                const f = friendlyError(installProgress.error, t('settings.local.installFailed'))
                return (
                  <div className="rounded-lg p-2.5" title={f.technical} style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.22)' }}>
                    <p className="text-[11px] text-red-400/90">{f.message}</p>
                    {f.action && <p className="text-[11px] text-white/45 mt-1">{f.action}</p>}
                    {/* Dizer o que fazer não basta se o usuário ainda tiver que ir
                        procurar onde fazer. Quando a saída é repetir, o botão fica aqui. */}
                    {f.recovery === 'retry' && onInstallLocal && (
                      <button
                        onClick={onInstallLocal}
                        style={{ border: '1px solid rgba(255,255,255,0.12)' }}
                        className="mt-2 px-2 py-1 rounded-md text-[11px] text-white/60 hover:text-white/90 hover:bg-white/[0.08] transition-colors"
                      >
                        {t('common.retry')}
                      </button>
                    )}
                  </div>
                )
              })()
            ) : (
              <div className="rounded-lg p-2.5" style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.18)' }}>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-white/60 truncate">{installProgress.phase === 'uninstalling' ? installProgress.message : t('settings.local.installing', { message: installProgress.message })}</span>
                  {installProgress.percent >= 0 && <span className="text-white/40 shrink-0 ml-2">{installProgress.percent}%</span>}
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <div
                    className={`h-full rounded-full ${installProgress.percent < 0 ? 'animate-pulse' : 'transition-all duration-300'}`}
                    style={{ width: installProgress.percent < 0 ? '100%' : `${installProgress.percent}%`, background: 'linear-gradient(90deg, #8f0e2e, #F97316)' }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tela de escolha ─────────────────────────────────────────────── */}
        {view === 'choose' && (
          <div style={{ padding: '4px 15px 18px' }}>
            <p className="text-[12px] text-white/30 mb-4">{t('settings.choose.subtitle')}</p>
            <div className="grid grid-cols-2 gap-3">
              {/* Local */}
              <button
                onClick={() => setView('local')}
                className="choice-card choice-card--local flex flex-col items-start text-left rounded-xl p-4"
              >
                <div className="choice-card__icon w-9 h-9 rounded-lg flex items-center justify-center mb-3" style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                  </svg>
                </div>
                <span className="text-[13px] font-semibold text-white/90">{t('settings.choose.local.name')}</span>
                <span className="text-[11px] text-emerald-400/70 mt-0.5">{t('settings.choose.local.price')}</span>
                <span className="text-[10.5px] text-white/25 mt-1.5 leading-snug">{t('settings.choose.local.desc')}</span>
              </button>

              {/* API */}
              <button
                onClick={() => setView('api')}
                className="choice-card choice-card--api flex flex-col items-start text-left rounded-xl p-4"
              >
                <div className="choice-card__icon w-9 h-9 rounded-lg flex items-center justify-center mb-3" style={{ background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.25)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/>
                  </svg>
                </div>
                <span className="text-[13px] font-semibold text-white/90">{t('settings.choose.api.name')}</span>
                <span className="text-[11px] text-orange-400/80 mt-0.5">{t('settings.choose.api.price')}</span>
                <span className="text-[10.5px] text-white/25 mt-1.5 leading-snug">{t('settings.choose.api.desc')}</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Tela API ────────────────────────────────────────────────────── */}
        {view === 'api' && (
          <>
            <div className="space-y-5" style={{ padding: '6px 15px 15px' }}>
              {/* Provider selector */}
              <div>
                <div className="flex items-stretch gap-0">
                  {/* Grupo Padrão */}
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                    <span className="text-[9px] text-white/30 uppercase tracking-widest font-medium text-center">{t('settings.api.groupDefault')}</span>
                    <div className="flex gap-1.5">
                      {(['anthropic', 'openai'] as const).map(p => (
                        <button
                          key={p}
                          onClick={() => handleProviderChange(p)}
                          style={{ paddingTop: '8px', paddingBottom: '8px' }}
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
                  </div>

                  {/* Divisor */}
                  <div className="flex items-end pb-0 px-2.5">
                    <div className="w-px bg-white/[0.08]" style={{ height: '32px' }} />
                  </div>

                  {/* Grupo NSFW */}
                  <div className="flex flex-col gap-1.5" style={{ width: '30%' }}>
                    <span className="text-[9px] text-white/30 uppercase tracking-widest font-medium text-center">{t('settings.api.groupNsfw')}</span>
                    <button
                      onClick={() => handleProviderChange('together')}
                      style={{ paddingTop: '8px', paddingBottom: '8px' }}
                      className={`w-full rounded-lg text-xs font-medium transition-all ${
                        provider === 'together'
                          ? 'bg-white/[0.10] text-white/90'
                          : 'bg-white/[0.03] text-white/35 hover:text-white/60 hover:bg-white/[0.06]'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1.5">
                        <svg width="13" height="13" viewBox="0 0 32 32" fill="currentColor">
                          <path d="M16 2C8.268 2 2 8.268 2 16s6.268 14 14 14 14-6.268 14-14S23.732 2 16 2zm0 3.5a10.5 10.5 0 1 1 0 21 10.5 10.5 0 0 1 0-21zm-1 4v7.586l-3.293-3.293-1.414 1.414L16 21.414l5.707-5.707-1.414-1.414L17 17.586V9.5h-2z"/>
                        </svg>
                        Together
                      </span>
                    </button>
                  </div>
                </div>

                <p className="text-[12px] text-white/25 mt-2" style={{ marginBottom: '2px' }}>
                  {provider === 'anthropic'
                    ? t('settings.api.desc.anthropic')
                    : provider === 'openai'
                      ? t('settings.api.desc.openai')
                      : t('settings.api.desc.together')}
                </p>
              </div>

              {/* API Key input */}
              <div>
                <div className="flex items-center gap-1.5 mb-2.5">
                  <label className="text-[11px] text-white/60 uppercase tracking-widest font-medium">
                    {t('settings.api.keyLabel')}
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
                              : provider === 'together'
                                ? 'https://api.together.xyz/settings/api-keys'
                                : 'https://platform.openai.com/api-keys'
                          )
                          setShowKeyHelp(false)
                        }}
                        className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-3 py-2 rounded-lg text-xs font-medium bg-white/[0.10] text-white/90 hover:bg-white/[0.14] hover:text-white transition-all whitespace-nowrap z-10"
                      >
                        {t('settings.api.getKey')}
                      </button>
                    )}
                  </div>
                </div>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder={provider === 'anthropic' ? 'sk-ant-...' : provider === 'together' ? 'tgp_v1_...' : 'sk-...'}
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
                  {t('settings.api.keyStored')}
                </p>
              </div>
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
                {saved ? t('common.saved') : t('common.save')}
              </button>
              <button
                onClick={handleClose}
                style={{ paddingTop: '10px', paddingBottom: '10px' }}
                className="px-4 rounded-lg text-sm text-white/35 hover:text-white/65 hover:bg-white/[0.05] transition-all"
              >
                {t('common.cancel')}
              </button>
            </div>
          </>
        )}

        {/* ── Tela Local ──────────────────────────────────────────────────── */}
        {view === 'local' && (
          <div style={{ padding: '4px 15px 18px' }}>
            <div className="rounded-lg p-3.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-white/60 uppercase tracking-widest font-medium">{t('common.status')}</span>
                <span className="flex items-center gap-1.5 text-[11px]">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: localStatus === 'ok' ? '#34D399' : localStatus === 'off' ? '#f87171' : 'rgba(255,255,255,0.3)' }}
                  />
                  <span className={localStatus === 'ok' ? 'text-emerald-400/80' : localStatus === 'off' ? 'text-red-400/70' : 'text-white/40'}>
                    {localStatus === 'checking' ? t('settings.local.checking') : localStatus === 'ok' ? t('settings.local.ready') : t('settings.local.notInstalled')}
                  </span>
                </span>
              </div>
              <p className="text-[11px] text-white/30 leading-relaxed">
                {tRich('settings.local.intro', {
                  models: <span className="text-white/50">{t('settings.local.intro.models')}</span>,
                  free: <span className="text-emerald-400/70">{t('settings.local.intro.free')}</span>,
                })}
              </p>
              <ul className="mt-2 space-y-1.5 text-[11px] text-white/30 leading-relaxed">
                <li className="flex gap-1.5">
                  <span className="text-orange-400/60 shrink-0">•</span>
                  <span><span className="text-white/50">Gemma 3 4B</span> {t('settings.local.model.vision')}</span>
                </li>
                <li className="flex gap-1.5">
                  <span className="text-orange-400/60 shrink-0">•</span>
                  <span><span className="text-white/50">Dolphin Mistral</span> {t('settings.local.model.text')}</span>
                </li>
                <li className="flex gap-1.5">
                  <span className="text-orange-400/60 shrink-0">•</span>
                  <span><span className="text-white/50">Whisper</span> {t('settings.local.model.voice')}</span>
                </li>
              </ul>
              {installProgress && installProgress.phase !== 'error' && installProgress.phase !== 'done' && installProgress.phase !== 'uninstalling' && (
                <p className="text-[10px] text-white/20 mt-2.5">{t('settings.local.downloadWarn')}</p>
              )}
            </div>

            {/* Ações */}
            {localStatus === 'ok' && !installProgress ? (
              <>
                <p className="flex items-center gap-1.5 text-[12px] text-emerald-400/70 mt-3">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                  {t('settings.local.allSet')}
                </p>
                <button
                  onClick={handleUninstall}
                  className="mt-3 w-full py-2 rounded-lg text-[12px] font-medium transition-all hover:brightness-110"
                  style={{ color: 'rgba(248,113,113,0.85)', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.22)' }}
                >
                  {t('settings.local.uninstall')}
                </button>
              </>
            ) : (localStatus !== 'ok' && (!installProgress || installProgress.phase === 'error')) && (
              <button
                onClick={onInstallLocal}
                className="mt-3 w-full py-2.5 rounded-lg text-[13px] font-medium text-white transition-all hover:brightness-110"
                style={{ background: 'linear-gradient(135deg, #8f0e2e, #F97316)' }}
              >
                {installProgress?.phase === 'error' ? t('common.retry') : t('settings.local.download')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
