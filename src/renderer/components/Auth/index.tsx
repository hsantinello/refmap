import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import logoUrl from '../../assets/logo.png'

const TERMS_TEXT = `TERMOS DE USO — REF MAP
Última atualização: junho de 2026

1. ACEITAÇÃO
Ao acessar e usar o Ref Map, você declara que leu, compreendeu e concorda com estes Termos. Se não concordar, não utilize o aplicativo.

2. O QUE É O REF MAP
O Ref Map é um software desktop para organização de imagens de referência e construção de prompts para ferramentas de IA generativa. O acesso é concedido mediante compra de licença.

3. LICENÇA DE USO
Ao adquirir o Ref Map, você recebe uma licença pessoal, não exclusiva e intransferível para uso do software. É vedado redistribuir, vender, sublicenciar ou compartilhar o acesso com terceiros.

4. DADOS E PRIVACIDADE
• Autenticação: seu e-mail é armazenado em um banco de dados seguro para controle de acesso.
• API Keys: suas chaves de API (Anthropic/OpenAI) são armazenadas localmente no seu dispositivo com criptografia do sistema operacional. Não temos acesso a elas.
• Imagens: suas imagens de referência são armazenadas apenas no seu dispositivo. Não enviamos imagens aos nossos servidores.
• Thumbnails e metadados são processados localmente.

5. CONTEÚDO GERADO POR IA
Os prompts gerados pelo Ref Map pertencem a você. Somos responsáveis pelo funcionamento do software, mas não pela qualidade, adequação ou uso dos prompts gerados. O uso dos prompts em ferramentas de terceiros está sujeito aos termos dessas ferramentas.

6. REEMBOLSOS
A política de reembolso é gerenciada pela Hotmart, plataforma de venda do produto. Pedidos de reembolso devem ser realizados diretamente na Hotmart dentro do prazo legal de 7 dias.

7. LIMITAÇÃO DE RESPONSABILIDADE
O Ref Map é fornecido "como está". Não nos responsabilizamos por danos diretos ou indiretos decorrentes do uso do software, incluindo perda de dados ou uso indevido de conteúdo gerado por IA.

8. USO ADEQUADO
É vedado utilizar o Ref Map para gerar conteúdo ilegal, difamatório, que viole direitos de terceiros ou as políticas das ferramentas de IA integradas.

9. ALTERAÇÕES
Podemos atualizar estes Termos a qualquer momento. Atualizações serão comunicadas no aplicativo. O uso continuado após a notificação implica aceitação.

10. CONTATO
Dúvidas: app@refmap.santinello.com.br`

type Step = 'email' | 'otp'

export default function Auth() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [showTerms, setShowTerms] = useState(false)

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data, error: dbError } = await supabase
      .from('licenses')
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
              <span className="text-[13px] font-semibold text-white/80">Termos de Uso</span>
              <button onClick={() => setShowTerms(false)} className="text-white/30 hover:text-white/60 transition-colors text-lg">✕</button>
            </div>
            <div className="overflow-y-auto px-6 py-5" data-scrollable>
              <pre className="text-[11.5px] text-white/45 leading-relaxed whitespace-pre-wrap font-sans">{TERMS_TEXT}</pre>
            </div>
            <div className="px-6 py-4 border-t border-white/[0.06]">
              <button
                onClick={() => { setTermsAccepted(true); setShowTerms(false) }}
                className="w-full py-2.5 rounded-xl text-[13px] font-medium text-white transition-opacity"
                style={{ background: 'linear-gradient(135deg, #8f0e2e, #F97316)' }}
              >
                Aceitar e fechar
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
              {/* Terms checkbox */}
              <div className="flex items-start gap-2.5 select-none">
                <div
                  className="w-4 h-4 rounded mt-0.5 shrink-0 flex items-center justify-center transition-all cursor-pointer"
                  style={{
                    background: termsAccepted ? 'linear-gradient(135deg, #8f0e2e, #F97316)' : 'rgba(255,255,255,0.06)',
                    border: termsAccepted ? 'none' : '1px solid rgba(255,255,255,0.15)',
                  }}
                  onClick={() => setTermsAccepted(v => !v)}
                >
                  {termsAccepted && (
                    <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                      <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
                <span className="text-[11px] text-white/30 leading-relaxed">
                  Li e concordo com os{' '}
                  <button
                    type="button"
                    onClick={() => setShowTerms(true)}
                    className="text-orange-400/70 hover:text-orange-400 underline transition-colors"
                  >
                    Termos de Uso
                  </button>
                </span>
              </div>

              {error && <p className="text-red-400/75 text-[12px] text-center leading-snug">{error}</p>}
              <button
                type="submit"
                disabled={loading || !termsAccepted}
                className="w-full py-3 rounded-xl text-[13px] font-medium text-white transition-opacity"
                style={{ background: 'linear-gradient(135deg, #8f0e2e, #F97316)', opacity: (loading || !termsAccepted) ? 0.4 : 1 }}
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
