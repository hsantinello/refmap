import { useEffect, useRef, useState } from 'react'
import { CHANGELOG, ULTIMA_NOVIDADE, type EntradaChangelog } from '../../data/changelog'

// Sininho de novidades na barra de título.
//
// Duas fontes se juntam aqui:
//   • o changelog embarcado (data/changelog.ts) — sempre disponível, inclusive
//     depois de atualizar, que é quando a pessoa quer ler o que mudou;
//   • as release notes do GitHub, quando existe atualização pendente E a release
//     foi publicada com descrição. Hoje elas vêm vazias, então o changelog local
//     é o que aparece — e o app não fica dependendo disso.
//
// A bolinha vermelha aparece quando há versão nova para baixar OU quando a
// versão instalada trouxe novidades que ainda não foram lidas.

type EstadoUpdate =
  | { status: 'idle' }
  | { status: 'available'; version: string; notes: Array<{ version: string; items: string[] }> }
  | { status: 'downloading'; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

const CHAVE_LIDO = 'novidadesLidasAte'

export default function UpdateBell() {
  const [aberto, setAberto] = useState(false)
  const [update, setUpdate] = useState<EstadoUpdate>({ status: 'idle' })
  const [versaoAtual, setVersaoAtual] = useState('')
  // Última versão cujas novidades já foram abertas. undefined = ainda carregando,
  // e nesse meio-tempo não mostramos bolinha para não piscar na abertura do app.
  const [lidoAte, setLidoAte] = useState<string | undefined>(undefined)
  const painelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.getVersion().then(setVersaoAtual).catch(() => {})
    window.api.getSetting(CHAVE_LIDO)
      .then(v => setLidoAte(typeof v === 'string' ? v : ''))
      .catch(() => setLidoAte(''))

    const offAvailable = window.api.onUpdateAvailable(info => {
      setUpdate({ status: 'available', version: info.version, notes: info.notes ?? [] })
    })
    const offProgress = window.api.onDownloadProgress(percent => {
      setUpdate({ status: 'downloading', percent })
    })
    const offDownloaded = window.api.onUpdateDownloaded(version => {
      setUpdate({ status: 'ready', version })
    })
    const offError = window.api.onUpdateError(message => {
      setUpdate({ status: 'error', message })
    })

    // A verificação mora aqui: o sininho está sempre montado e é ele que
    // precisa da resposta para decidir se acende a bolinha. Em dev o handler
    // resolve null sem consultar nada.
    window.api.checkForUpdates().catch(() => {})

    return () => { offAvailable(); offProgress(); offDownloaded(); offError() }
  }, [])

  // Fecha ao clicar fora. capture=true porque o canvas por baixo também escuta
  // mousedown e engoliria o evento antes de chegar aqui.
  useEffect(() => {
    if (!aberto) return
    const onDown = (e: MouseEvent) => {
      if (!painelRef.current?.contains(e.target as Node)) setAberto(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [aberto])

  const versaoPendente =
    update.status === 'available' ? update.version :
    update.status === 'ready'     ? update.version : null

  // A versão mais nova que o usuário poderia querer ler: a que está para baixar,
  // ou, na falta dela, a novidade mais recente do changelog embarcado.
  const versaoDeInteresse = versaoPendente ?? ULTIMA_NOVIDADE
  const temNovidade = lidoAte !== undefined && !!versaoDeInteresse && lidoAte !== versaoDeInteresse

  const abrir = () => {
    const proximo = !aberto
    setAberto(proximo)
    if (proximo && versaoDeInteresse && lidoAte !== versaoDeInteresse) {
      // Marcar como lido na ABERTURA (não no fechamento): abriu, viu, acabou.
      setLidoAte(versaoDeInteresse)
      window.api.setSetting(CHAVE_LIDO, versaoDeInteresse).catch(() => {})
    }
  }

  // As notas remotas, quando existem, entram como entradas do mesmo formato do
  // changelog para a lista sair uniforme. Sem data: o feed não traz uma por versão.
  const entradasRemotas: EntradaChangelog[] =
    update.status === 'available'
      ? update.notes
          .filter(n => !CHANGELOG.some(c => c.version === n.version))
          .map(n => ({ version: n.version, date: '', items: n.items }))
      : []

  const entradas = [...entradasRemotas, ...CHANGELOG]

  const dataBR = (iso: string) => {
    if (!iso) return ''
    const [a, m, d] = iso.split('-')
    return a && m && d ? `${d}/${m}/${a}` : ''
  }

  return (
    <div ref={painelRef} className="relative shrink-0">
      <button
        onClick={abrir}
        title={temNovidade ? 'Novidades' : 'Novidades do Ref Map'}
        className={`no-drag-region relative flex items-center justify-center w-7 h-7 rounded-md transition-all ${
          aberto ? 'bg-white/[0.09] text-white/80' : 'text-white/40 hover:text-white/75 hover:bg-white/[0.06]'
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {temNovidade && (
          <span
            className="absolute top-1 right-1 w-[7px] h-[7px] rounded-full"
            style={{ background: '#F87171', boxShadow: '0 0 0 1.5px #000' }}
          />
        )}
      </button>

      {aberto && (
        <div
          className="no-drag-region rm-modal-enter absolute right-0 top-full mt-1.5 w-[340px] max-h-[420px] overflow-y-auto rounded-xl z-[200]"
          style={{
            background: 'rgba(14,14,16,0.97)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.8)',
          }}
        >
          {/* Faixa da atualização pendente — só aparece quando há uma */}
          {update.status !== 'idle' && update.status !== 'error' && (
            <div
              className="flex items-center justify-between gap-2"
              style={{ padding: '11px 13px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              <span className="text-[11px] text-white/60 truncate">
                {update.status === 'available' && <>Versão <b className="text-orange-300/90 font-semibold">v{update.version}</b> disponível</>}
                {update.status === 'downloading' && <>Baixando… {update.percent}%</>}
                {update.status === 'ready' && <>v{update.version} pronta para instalar</>}
              </span>

              {update.status === 'available' && (
                <button
                  onClick={() => { setUpdate({ status: 'downloading', percent: 0 }); window.api.downloadUpdate() }}
                  className="shrink-0 px-2 py-0.5 rounded text-[11px] font-medium"
                  style={{ color: 'rgba(251,146,60,0.95)', background: 'rgba(251,146,60,0.15)', border: '1px solid rgba(251,146,60,0.35)' }}
                >
                  Baixar
                </button>
              )}
              {update.status === 'downloading' && (
                <div className="shrink-0 w-20 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                  <div className="h-full rounded-full transition-all duration-300" style={{ width: `${update.percent}%`, background: 'rgba(251,146,60,0.8)' }} />
                </div>
              )}
              {update.status === 'ready' && (
                <button
                  onClick={() => window.api.installUpdate()}
                  className="shrink-0 px-2 py-0.5 rounded text-[11px] font-medium"
                  style={{ color: 'rgba(251,146,60,0.95)', background: 'rgba(251,146,60,0.15)', border: '1px solid rgba(251,146,60,0.35)' }}
                >
                  Reiniciar e instalar
                </button>
              )}
            </div>
          )}

          {update.status === 'error' && (
            <div style={{ padding: '11px 13px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[11px] text-red-400/85">Não foi possível verificar atualizações.</p>
              <button
                onClick={() => { setUpdate({ status: 'idle' }); window.api.checkForUpdates().catch(() => {}) }}
                className="mt-1.5 px-2 py-0.5 rounded-md text-[11px] text-white/55 hover:text-white/85 bg-white/[0.06] hover:bg-white/[0.12] transition-colors"
              >
                Tentar de novo
              </button>
            </div>
          )}

          {/* Lista de novidades */}
          <div style={{ padding: '4px 0 8px' }}>
            {entradas.map(entrada => {
              const instalada = !!versaoAtual && entrada.version === versaoAtual
              return (
                <div key={entrada.version} style={{ padding: '9px 13px 4px' }}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12px] font-medium text-white/75">v{entrada.version}</span>
                    {instalada && (
                      <span className="text-[9px] px-1.5 py-[1px] rounded-full text-emerald-300/80" style={{ background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.22)' }}>
                        você tem esta
                      </span>
                    )}
                    {entrada.date && <span className="text-[10px] text-white/25 ml-auto shrink-0">{dataBR(entrada.date)}</span>}
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {entrada.items.map((item, i) => (
                      <li key={i} className="flex gap-1.5 text-[11px] text-white/45 leading-relaxed">
                        <span className="text-white/20 shrink-0 select-none">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}

            {entradas.length === 0 && (
              <p className="text-[11px] text-white/30" style={{ padding: '12px 13px' }}>
                Nenhuma novidade registrada ainda.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
