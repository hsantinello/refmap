import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import logoUrl from '../../assets/logo.png'
import UpdateBanner from '../UpdateBanner'
import { useT } from '../../i18n'
import { TERMS } from '../../../shared/i18n/terms'
import { useCanvasStore } from '../../store'

type Step = 'email' | 'otp'

export default function Auth() {
  const t = useT()
  const appLang = useCanvasStore(s => s.appLang)
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  // Antes isto era só uma string e a cor da mensagem saía de
  // `error.includes('enviado')`. Funcionava enquanto o app era só em português;
  // em inglês o aviso de sucesso apareceria em vermelho. O tipo agora é
  // explícito, em vez de deduzido do texto.
  const [aviso, setAviso] = useState<{ texto: string; sucesso: boolean } | null>(null)
  const erro = (texto: string) => setAviso({ texto, sucesso: false })
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [showTerms, setShowTerms] = useState(false)

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setAviso(null)

    const { data: licensed, error: dbError } = await supabase
      .rpc('check_license', { p_email: email.toLowerCase().trim() })

    if (dbError) { erro(t('auth.error.checkEmail')); setLoading(false); return }
    if (!licensed) { erro(t('auth.error.notFound')); setLoading(false); return }

    const { error: otpError } = await supabase.auth.signInWithOtp({ email: email.toLowerCase().trim() })

    setLoading(false)

    if (otpError) { erro(t('auth.error.sendCode')); return }

    setStep('otp')
  }

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (otp.trim().length < 8) {
      erro(t('auth.error.incompleteCode'))
      return
    }

    setLoading(true)
    setAviso(null)

    try {
      // Timeout: se o cliente de auth estiver travado (ex.: sessão velha pendurada), não
      // deixa o botão preso em "Verificando..." pra sempre — falha claro e a pessoa tenta de novo.
      const { data, error } = await Promise.race([
        supabase.auth.verifyOtp({ email: email.toLowerCase().trim(), token: otp.trim(), type: 'email' }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
      ])

      if (error) {
        console.error('[login] verifyOtp falhou:', error)
        const msg = (error.message || '').toLowerCase()
        erro(
          msg.includes('expired') || msg.includes('invalid') || msg.includes('token')
            ? t('auth.error.invalidCode')
            : t('auth.error.generic'),
        )
        return
      }
      if (!data.session) {
        // Verificou sem erro mas não veio sessão: estado inconsistente — não pode ficar mudo.
        console.error('[login] verifyOtp retornou sem sessão')
        erro(t('auth.error.noSession'))
        return
      }
      // Sucesso — a tela troca sozinha via onAuthStateChange no App.
    } catch (err) {
      console.error('[login] verifyOtp timeout/exceção:', err)
      erro(t('auth.error.timeout'))
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setLoading(true)
    setAviso(null)
    await supabase.auth.signInWithOtp({ email: email.toLowerCase().trim() })
    setLoading(false)
    setAviso({ texto: t('auth.resend.sent'), sucesso: true })
  }

  return (
    <div
      className="flex flex-col h-screen"
      style={{ background: 'radial-gradient(ellipse at 50% 40%, #0f0f12 0%, #09090b 50%, #060607 100%)' }}
    >
      {/* Terms modal */}
      {showTerms && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
          onClick={() => setShowTerms(false)}
        >
          <div
            className="w-[520px] max-h-[70vh] mx-4 rounded-2xl overflow-hidden flex flex-col"
            style={{ background: '#0d0d0f', border: '1px solid rgba(255,255,255,0.08)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
              <span className="text-[13px] font-semibold text-white/80">{t('auth.terms.title')}</span>
              <button onClick={() => setShowTerms(false)} className="text-white/30 hover:text-white/60 transition-colors text-lg">✕</button>
            </div>
            <div className="overflow-y-auto px-6 py-5" data-scrollable>
              <pre className="text-[11.5px] text-white/45 leading-relaxed whitespace-pre-wrap font-sans">{TERMS[appLang]}</pre>
            </div>
            <div className="px-6 py-4 border-t border-white/[0.06]">
              <button
                onClick={() => { setTermsAccepted(true); setShowTerms(false) }}
                className="w-full py-2.5 rounded-xl text-[13px] font-medium text-white transition-opacity"
                style={{ background: 'linear-gradient(135deg, #8f0e2e, #F97316)' }}
              >
                {t('auth.terms.accept')}
              </button>
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes auth-in { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        .auth-in { animation: auth-in .35s ease-out forwards }
        .auth-input {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.85);
          transition: border-color .15s, background .15s;
        }
        .auth-input::placeholder { color: rgba(255,255,255,0.18); }
        .auth-input:focus { outline: none; border-color: rgba(249,115,22,0.45); background: rgba(255,255,255,0.06); }
        .auth-checkbox:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(249,115,22,0.55); }
      `}</style>

      {/* Banner de atualização — pill flutuante centralizado no topo */}
      <div className="flex justify-center pt-3">
        <UpdateBanner />
      </div>

      <div className="flex flex-1 items-center justify-center">
      <div
        className="auth-in flex flex-col items-center w-full max-w-[340px] mx-4 px-8 py-10"
        style={{
          background: 'rgba(255,255,255,0.035)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: '24px',
          boxShadow: '0 32px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        <img src={logoUrl} alt="Ref Map" className="w-[72px] h-[72px] rounded-2xl mb-7" />

        {step === 'email' ? (
          <>
            <h1 className="text-white/85 text-[17px] font-semibold mb-1">{t('auth.email.title')}</h1>
            <p className="text-white/25 text-[12px] mb-7 text-center">
              {t('auth.email.subtitle')}
            </p>
            <form onSubmit={handleEmailSubmit} className="w-full flex flex-col gap-3">
              <input
                type="email"
                placeholder={t('auth.email.placeholder')}
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                className="auth-input w-full rounded-xl px-4 py-3 text-[13px]"
              />
              {/* Terms checkbox */}
              <div className="flex items-start gap-2.5 select-none">
                <div
                  role="checkbox"
                  aria-checked={termsAccepted}
                  aria-label={t('auth.terms.checkboxLabel')}
                  tabIndex={0}
                  className="auth-checkbox w-4 h-4 rounded mt-0.5 shrink-0 flex items-center justify-center transition-all cursor-pointer"
                  style={{
                    background: termsAccepted ? 'linear-gradient(135deg, #8f0e2e, #F97316)' : 'rgba(255,255,255,0.06)',
                    border: termsAccepted ? 'none' : '1px solid rgba(255,255,255,0.15)',
                  }}
                  onClick={() => setTermsAccepted(v => !v)}
                  onKeyDown={e => {
                    // Space/Enter marca a caixinha (como um checkbox nativo), sem rolar
                    // a tela nem submeter o form.
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault()
                      setTermsAccepted(v => !v)
                    }
                  }}
                >
                  {termsAccepted && (
                    <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                      <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
                <span className="text-[11px] text-white/30 leading-relaxed">
                  {t('auth.terms.agreePrefix')}{' '}
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowTerms(true)}
                    className="text-orange-400/70 hover:text-orange-400 underline transition-colors"
                  >
                    {t('auth.terms.title')}
                  </button>
                </span>
              </div>

              {aviso && <p className={`text-[12px] text-center leading-snug ${aviso.sucesso ? 'text-green-400/70' : 'text-red-400/75'}`}>{aviso.texto}</p>}
              <button
                type="submit"
                disabled={loading || !termsAccepted}
                className="w-full py-3 rounded-xl text-[13px] font-medium text-white transition-opacity"
                style={{ background: 'linear-gradient(135deg, #8f0e2e, #F97316)', opacity: (loading || !termsAccepted) ? 0.4 : 1 }}
              >
                {loading ? t('auth.email.sending') : t('auth.email.continue')}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-white/85 text-[17px] font-semibold mb-1">{t('auth.otp.title')}</h1>
            <p className="text-white/25 text-[12px] mb-7 text-center">
              {t('auth.otp.subtitle')}<br />
              <span className="text-white/40">{email}</span>
            </p>
            <form onSubmit={handleOtpSubmit} className="w-full flex flex-col gap-3">
              <input
                type="text"
                placeholder="00000000"
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
                required
                autoFocus
                inputMode="numeric"
                className="auth-input w-full rounded-xl px-4 py-3 text-[13px] text-center tracking-[0.3em]"
              />
              {aviso && (
                <p className={`text-[12px] text-center leading-snug ${aviso.sucesso ? 'text-green-400/70' : 'text-red-400/75'}`}>
                  {aviso.texto}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl text-[13px] font-medium text-white transition-opacity"
                style={{ background: 'linear-gradient(135deg, #8f0e2e, #F97316)', opacity: loading ? 0.5 : 1 }}
              >
                {loading ? t('auth.otp.verifying') : t('auth.otp.signIn')}
              </button>
            </form>
            <button
              onClick={handleResend}
              disabled={loading}
              className="mt-4 text-[11px] text-white/20 hover:text-white/50 transition-colors disabled:opacity-40"
            >
              {t('auth.otp.resend')}
            </button>
            <button
              onClick={() => { setStep('email'); setOtp(''); setAviso(null) }}
              className="mt-3 text-[11px] text-white/15 hover:text-white/40 transition-colors"
            >
              {t('auth.otp.changeEmail')}
            </button>
          </>
        )}
      </div>
      </div>
    </div>
  )
}
