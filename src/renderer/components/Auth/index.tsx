import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import logoUrl from '../../assets/logo.png'

type Step = 'email' | 'otp'

export default function Auth() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data, error: dbError } = await supabase
      .from('authorized_emails')
      .select('email')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle()

    if (dbError) { setError('Erro ao verificar e-mail. Tente novamente.'); setLoading(false); return }
    if (!data) { setError('E-mail não encontrado. Adquira o Ref Map para ter acesso.'); setLoading(false); return }

    const { error: otpError } = await supabase.auth.signInWithOtp({ email: email.toLowerCase().trim() })

    setLoading(false)

    if (otpError) { setError('Erro ao enviar o código. Tente novamente.'); return }

    setStep('otp')
  }

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.verifyOtp({
      email: email.toLowerCase().trim(),
      token: otp.trim(),
      type: 'email',
    })

    setLoading(false)

    if (error) { setError('Código inválido ou expirado. Tente novamente.'); return }
  }

  const handleResend = async () => {
    setLoading(true)
    setError(null)
    await supabase.auth.signInWithOtp({ email: email.toLowerCase().trim() })
    setLoading(false)
    setError('Novo código enviado.')
  }

  return (
    <div
      className="flex h-screen items-center justify-center"
      style={{ background: 'radial-gradient(ellipse at 50% 40%, #0f0f12 0%, #09090b 50%, #060607 100%)' }}
    >
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
      `}</style>

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
            <h1 className="text-white/85 text-[17px] font-semibold mb-1">Acessar o Ref Map</h1>
            <p className="text-white/25 text-[12px] mb-7 text-center">
              Digite o e-mail usado na sua compra
            </p>
            <form onSubmit={handleEmailSubmit} className="w-full flex flex-col gap-3">
              <input
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                className="auth-input w-full rounded-xl px-4 py-3 text-[13px]"
              />
              {error && <p className="text-red-400/75 text-[12px] text-center leading-snug">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl text-[13px] font-medium text-white transition-opacity"
                style={{ background: 'linear-gradient(135deg, #8f0e2e, #F97316)', opacity: loading ? 0.5 : 1 }}
              >
                {loading ? 'Enviando código...' : 'Continuar'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-white/85 text-[17px] font-semibold mb-1">Verifique seu e-mail</h1>
            <p className="text-white/25 text-[12px] mb-7 text-center">
              Enviamos um código de 6 dígitos para<br />
              <span className="text-white/40">{email}</span>
            </p>
            <form onSubmit={handleOtpSubmit} className="w-full flex flex-col gap-3">
              <input
                type="text"
                placeholder="000000"
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
                required
                autoFocus
                inputMode="numeric"
                className="auth-input w-full rounded-xl px-4 py-3 text-[13px] text-center tracking-[0.3em]"
              />
              {error && (
                <p className={`text-[12px] text-center leading-snug ${error.includes('enviado') ? 'text-green-400/70' : 'text-red-400/75'}`}>
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading || otp.length < 8}
                className="w-full py-3 rounded-xl text-[13px] font-medium text-white transition-opacity"
                style={{ background: 'linear-gradient(135deg, #8f0e2e, #F97316)', opacity: (loading || otp.length < 6) ? 0.5 : 1 }}
              >
                {loading ? 'Verificando...' : 'Entrar'}
              </button>
            </form>
            <button
              onClick={handleResend}
              disabled={loading}
              className="mt-4 text-[11px] text-white/20 hover:text-white/50 transition-colors disabled:opacity-40"
            >
              Reenviar código
            </button>
            <button
              onClick={() => { setStep('email'); setOtp(''); setError(null) }}
              className="mt-3 text-[11px] text-white/15 hover:text-white/40 transition-colors"
            >
              ← Trocar e-mail
            </button>
          </>
        )}
      </div>
    </div>
  )
}
