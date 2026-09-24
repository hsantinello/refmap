import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { useCanvasStore } from '../../store'
import { mediaUrl } from '../../lib/mediaUrl'
import LogoComfy from '../LogoComfy'
import { montarCatalogo, familias, tagsFrequentes, recomendar, vramEfetiva, type Tarefa, type Encaixe, type Receita, type Recomendacao, compararVersao, type FiltroTarefa } from '../../../shared/comfy/catalogo'

// Painel "ComfyUI": o que a máquina tem e quais receitas do acervo oficial cabem
// nela. O catálogo nasce do índice de templates (lido do próprio ComfyUI do
// usuário ou do repositório oficial) via `montarCatalogo`; a regra de encaixe é
// `recomendar`. Tudo em src/shared/comfy/catalogo.ts.

type Hardware = Awaited<ReturnType<typeof window.api.comfyHardware>>

const COR_ENCAIXE: Record<Encaixe, string> = {
  ideal:    'text-emerald-300/90 bg-emerald-500/[0.12] border-emerald-500/25',
  ok:       'text-sky-300/90 bg-sky-500/[0.12] border-sky-500/25',
  apertado: 'text-amber-300/90 bg-amber-500/[0.12] border-amber-500/25',
  nao:      'text-white/35 bg-white/[0.04] border-white/[0.08]',
}

const pontos = (n: number) => '●'.repeat(n) + '○'.repeat(5 - n)

// Dropdown próprio. O <select> nativo abre o popup do sistema operacional, que não
// aceita estilo: saía branco com texto branco. Este segue o vidro escuro do
// painel de categorias dos presets.
function Seletor({ valor, opcoes, onChange }: {
  valor: string
  opcoes: { id: string; nome: string; total?: number }[]
  onChange: (id: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const atual = opcoes.find(o => o.id === valor) ?? opcoes[0]

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAberto(false) }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAberto(false) } }
    document.addEventListener('mousedown', fora, true)
    window.addEventListener('keydown', tecla, true)
    return () => { document.removeEventListener('mousedown', fora, true); window.removeEventListener('keydown', tecla, true) }
  }, [aberto])

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        onClick={() => setAberto(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.07] transition-colors text-[11px] text-white/80"
      >
        <span className="truncate">{atual?.nome}</span>
        <svg width="10" height="10" viewBox="0 0 10 6" fill="none" className="shrink-0">
          <path d={aberto ? 'M1 5L5 1L9 5' : 'M1 1L5 5L9 1'} stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {aberto && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl overflow-y-auto py-1"
          data-scrollable
          style={{ maxHeight: '260px', background: 'rgba(22, 20, 18, 0.88)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }}
        >
          {opcoes.map(o => (
            <button
              key={o.id}
              onClick={() => { onChange(o.id); setAberto(false) }}
              className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 text-[11px] transition-colors ${
                o.id === valor ? 'text-orange-300 bg-orange-500/[0.12]' : 'text-white/75 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <span className="truncate">{o.nome}</span>
              {o.total != null && <span className="text-[9px] text-white/30 shrink-0">{o.total}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Miniatura oficial do template. Vem do main (que baixa uma vez e guarda no
// disco) e chega pelo esquema refmap://media, como qualquer imagem do usuário.
function Miniatura({ template, temImagem }: { template: string; temImagem: boolean }) {
  const [src, setSrc] = useState<string | null>(null)
  const [estado, setEstado] = useState<'idle' | 'loading' | 'ok' | 'failed'>('idle')
  const [rodada, setRodada] = useState(0)          // incrementa para tentar de novo
  const [visivel, setVisivel] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Só pede a prévia quando o card se aproxima da área visível: a aba de vídeo
  // tem ~100 webp animados (123 MB no total) e pedir tudo de uma vez travava a
  // fila — os cards de baixo ficavam no ícone genérico por minutos.
  useEffect(() => {
    if (!temImagem || visivel) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setVisivel(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisivel(true); io.disconnect() } }, { rootMargin: '400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [temImagem, visivel])

  useEffect(() => {
    if (!temImagem || !visivel) return
    let vivo = true
    setEstado('loading')
    window.api.comfyThumb(template)
      .then(p => { if (!vivo) return; if (p) { setSrc(mediaUrl(p)); setEstado('ok') } else setEstado('failed') })
      .catch(() => { if (vivo) setEstado('failed') })
    return () => { vivo = false }
  }, [template, temImagem, visivel, rodada])

  const t = useT()
  const falhou = estado === 'failed'
  return (
    <div ref={ref} onClick={falhou ? () => setRodada(n => n + 1) : undefined} title={falhou ? t('comfy.thumbRetry') : undefined}
      className={`shrink-0 w-[150px] h-[150px] rounded-xl overflow-hidden ${falhou ? 'cursor-pointer hover:brightness-125' : ''}`}
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
      {src && estado === 'ok'
        ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setEstado('failed')} className="w-full h-full object-cover" />
        : (
          <div className={`w-full h-full flex flex-col items-center justify-center gap-1.5 ${estado === 'loading' ? 'animate-pulse text-white/20' : 'text-white/15'}`}>
            {falhou
              ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6"/></svg>
              : <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M9 6h6M18 9v6M8.5 8.5l7 7"/>
                </svg>}
            {falhou && <span className="text-[9px] text-white/30">{t('comfy.thumbRetry')}</span>}
          </div>
        )}
    </div>
  )
}

export default function ComfyPanel({ onClose }: { onClose: () => void }) {
  const t = useT()
  const appLang = useCanvasStore(s => s.appLang)
  const [closing, setClosing] = useState(false)
  const [hw, setHw] = useState<Hardware | null>(null)
  const [receitas, setReceitas] = useState<Receita[]>([])
  const [carregando, setCarregando] = useState(true)
  const [lendoHw, setLendoHw] = useState(false)
  const [erro, setErro] = useState<{ hardware?: boolean; catalogo?: boolean; download?: boolean }>({})
  const [task, setTask] = useState<FiltroTarefa>('auto')
  const [familia, setFamilia] = useState<string>('auto')
  const [tag, setTag] = useState<string>('auto')
  const [busca, setBusca] = useState('')
  const [baixando, setBaixando] = useState<string | null>(null)
  const [salvoEm, setSalvoEm] = useState<{ id: string; path: string } | null>(null)

  const handleClose = () => { setClosing(true); setTimeout(onClose, 155) }

  // Hardware e catálogo falham separados: um cache antigo do índice não pode
  // apagar a máquina que já foi lida (nem virar "não foi possível ler o hardware").
  const carregar = async (forcar = false) => {
    setCarregando(true); setErro({})
    const [h, indice] = await Promise.allSettled([window.api.comfyHardware(), window.api.comfyTemplates(forcar)])
    if (h.status === 'fulfilled') setHw(h.value)
    else { console.error('[comfy] hardware', h.reason); setErro(e => ({ ...e, hardware: true })) }
    if (indice.status === 'fulfilled') {
      try { setReceitas(montarCatalogo(indice.value)) }
      catch (err) { console.error('[comfy] catálogo', err); setErro(e => ({ ...e, catalogo: true })) }
    } else { console.error('[comfy] índice', indice.reason); setErro(e => ({ ...e, catalogo: true })) }
    setCarregando(false)
  }
  useEffect(() => { void carregar() }, [])

  /** Só o hardware, sem mexer no catálogo — para o botão "Reanalisar". */
  const lerHardware = async () => {
    setLendoHw(true); setErro(e => ({ ...e, hardware: false }))
    try { setHw(await window.api.comfyHardware()) }
    catch (err) { console.error('[comfy] hardware', err); setErro(e => ({ ...e, hardware: true })) }
    finally { setLendoHw(false) }
  }

  // Trocar de tarefa zera os filtros (famílias e tags são outras).
  useEffect(() => { setFamilia('auto'); setTag('auto') }, [task])

  const maquina = hw ? { vramGb: hw.gpu?.vramGb ?? null, ramGb: hw.ramGb, memoriaUnificada: hw.memoriaUnificada } : null
  const lista: Recomendacao[] = useMemo(
    () => maquina ? recomendar(receitas, maquina, task, { familia, tag, busca }) : [],
    [receitas, maquina?.vramGb, maquina?.ramGb, maquina?.memoriaUnificada, task, familia, tag, busca],
  )
  const listaFamilias = useMemo(() => familias(receitas, task), [receitas, task])
  const listaTags = useMemo(() => tagsFrequentes(receitas, task), [receitas, task])
  const totalTarefa = useMemo(() => task === 'auto' ? receitas.length : receitas.filter(r => r.task === task).length, [receitas, task])
  const vram = maquina ? vramEfetiva(maquina) : null
  const txt = (x: { pt: string; en: string }) => appLang === 'pt' ? x.pt : x.en

  const baixar = async (id: string, template: string) => {
    setBaixando(id); setSalvoEm(null); setErro(e => ({ ...e, download: false }))
    try {
      const path = await window.api.comfyDownloadWorkflow(template)
      if (path) setSalvoEm({ id, path })
    } catch (err) { console.error('[comfy] download', err); setErro(e => ({ ...e, download: true })) }
    finally { setBaixando(null) }
  }

  return (
    <div className={`${closing ? 'rm-backdrop-out' : 'rm-backdrop'} fixed inset-0 flex items-center justify-center z-50`} onClick={handleClose}>
      <div className={`rm-comfy ${closing ? 'rm-modal-exit' : 'rm-modal-enter'} rm-panel !border-transparent w-[620px] max-h-[88vh] flex flex-col`} onClick={e => e.stopPropagation()}>
        <style>{`.rm-comfy button:not(:disabled) { cursor: pointer; } .rm-comfy button:disabled { cursor: default; }`}</style>

        {/* Cabeçalho */}
        <div className="flex items-center justify-between shrink-0" style={{ padding: '15px' }}>
          <div className="flex items-center gap-2">
            <LogoComfy size={18} />
            <span className="text-white/85 text-base font-semibold">{t('comfy.title')}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void carregar(true)} disabled={carregando} title={t('comfy.refresh')}
              className="w-6 h-6 flex items-center justify-center text-white/30 hover:text-white/70 rounded-md hover:bg-white/[0.06] transition-colors disabled:opacity-40">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={carregando ? 'animate-spin' : ''}>
                <path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6"/>
              </svg>
            </button>
            <button onClick={handleClose} style={{ border: '1px solid rgba(255,255,255,0.12)' }}
              className="w-6 h-6 flex items-center justify-center text-white/25 hover:text-white/60 transition-colors rounded-md hover:bg-white/[0.06]">
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>

        <div className="overflow-y-auto min-h-0" data-scrollable style={{ padding: '0 15px 15px' }}>
          {/* Máquina */}
          <div className="rounded-lg p-3.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] uppercase tracking-widest font-semibold text-white/30">{t('comfy.machine')}</span>
              {(erro.hardware || (hw && !hw.gpu)) && (
                <button onClick={() => void lerHardware()} disabled={lendoHw || carregando}
                  className="text-[10px] px-2 py-0.5 rounded-md text-white/55 hover:text-white/90 hover:bg-white/[0.06] transition-colors disabled:opacity-40"
                  style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
                  {lendoHw ? t('comfy.reading') : t('comfy.retryHardware')}
                </button>
              )}
            </div>
            {erro.hardware && <p className="text-[11px] text-red-400/80">{t('comfy.error')}</p>}
            {!erro.hardware && !hw && <p className="text-[11px] text-white/35">{t('comfy.reading')}</p>}
            {hw && (
              <>
                <div className="text-[13px] font-semibold text-white/90 truncate">{hw.gpu?.nome ?? t('comfy.gpuUnknown')}</div>
                <div className="text-[11px] text-white/45 mt-0.5">
                  {hw.memoriaUnificada
                    ? t('comfy.unified', { ram: hw.ramGb })
                    : hw.gpu?.vramGb != null
                      ? (hw.gpu.vramLivreGb != null
                          ? t('comfy.vramFree', { free: hw.gpu.vramLivreGb, total: hw.gpu.vramGb })
                          : t('comfy.vram', { total: hw.gpu.vramGb }))
                      : t('comfy.vramUnknown')}
                  {' · '}{t('comfy.ram', { ram: hw.ramGb })}
                </div>
                <div className="text-[10.5px] text-white/25 mt-0.5 truncate">{hw.cpu} · {hw.nucleos} {t('comfy.cores')}</div>
                <div className={`mt-2 inline-flex items-center gap-1.5 text-[10.5px] px-2 py-0.5 rounded-md border ${hw.comfy.online ? 'text-emerald-300/85 border-emerald-500/25 bg-emerald-500/[0.08]' : 'text-white/40 border-white/[0.08] bg-white/[0.03]'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${hw.comfy.online ? 'bg-emerald-400' : 'bg-white/25'}`} />
                  {hw.comfy.online ? t('comfy.online', { v: hw.comfy.versao ?? '?' }) : t('comfy.offline')}
                </div>
                {vram?.estimada && <p className="text-[10.5px] text-amber-300/70 mt-2">{t('comfy.vramGuess')}</p>}
              </>
            )}
          </div>

          {/* Tarefa · família · tipo · busca */}
          <div className="flex items-center gap-2 mt-3">
            <Seletor valor={task} onChange={id => setTask(id as FiltroTarefa)}
              opcoes={[
                { id: 'auto', nome: t('comfy.taskAll'), total: receitas.length },
                { id: 'image', nome: t('comfy.taskImage'), total: receitas.filter(r => r.task === 'image').length },
                { id: 'video', nome: t('comfy.taskVideo'), total: receitas.filter(r => r.task === 'video').length },
              ]} />
            <Seletor valor={familia} onChange={setFamilia}
              opcoes={[{ id: 'auto', nome: t('comfy.familyAll'), total: totalTarefa }, ...listaFamilias]} />
            <Seletor valor={tag} onChange={setTag}
              opcoes={[{ id: 'auto', nome: t('comfy.tagAll') }, ...listaTags.map(g => ({ id: g, nome: g }))]} />
          </div>
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            onKeyDown={e => e.stopPropagation()}
            placeholder={t('comfy.search')}
            className="mt-2 w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-[11px] text-white/70 placeholder-white/25 outline-none focus:border-orange-500/30"
          />

          {/* Recomendações */}
          <div className="flex items-baseline justify-between mt-4 mb-2">
            <span className="text-[9px] uppercase tracking-widest font-semibold text-white/30">{t('comfy.recommended')}</span>
            {hw && <span className="text-[10px] text-white/25">{t('comfy.count', { n: lista.length, total: totalTarefa })}</span>}
          </div>
          {erro.catalogo && <p className="text-[11px] text-red-400/80 mb-2">{t('comfy.errorCatalog')}</p>}
          {erro.download && <p className="text-[11px] text-red-400/80 mb-2">{t('comfy.errorDownload')}</p>}
          {hw && !carregando && !erro.catalogo && lista.length === 0 && <p className="text-[11px] text-white/30">{t('comfy.empty')}</p>}
          <div className="flex flex-col gap-2">
            {lista.map((r, i) => (
              <div key={r.id} className={`rounded-lg p-3 ${r.encaixe === 'nao' ? 'opacity-60' : ''}`}
                style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${r.melhorOpcao ? 'rgba(52,211,153,0.35)' : 'rgba(255,255,255,0.06)'}` }}>
                <div className="flex items-start gap-3">
                  <Miniatura template={r.template} temImagem={!!r.miniatura} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[9px] font-bold text-white/25">{String(i + 1).padStart(2, '0')}</span>
                      <span className="text-[13px] font-semibold text-white/90">{r.nome}</span>
                      <span className={`text-[9px] font-semibold px-1.5 py-px rounded border ${COR_ENCAIXE[r.encaixe]}`}>{t(`comfy.fit.${r.encaixe}` as const)}</span>
                      {r.melhorOpcao && <span className="text-[9px] font-semibold px-1.5 py-px rounded border text-emerald-300/90 bg-emerald-500/[0.12] border-emerald-500/25">{t('comfy.best')}</span>}
                      {r.versaoMinima && hw?.comfy.versao && compararVersao(hw.comfy.versao, r.versaoMinima) < 0 && (
                        <span className="text-[9px] font-semibold px-1.5 py-px rounded border text-amber-300/90 bg-amber-500/[0.10] border-amber-500/25" title={r.versaoMinima}>{t('comfy.needsVersion', { v: r.versaoMinima })}</span>
                      )}
                    </div>
                    <div className="text-[10.5px] text-white/40 mt-0.5">
                      {task === 'auto' && <span className="text-white/60">{r.task === 'image' ? t('comfy.taskImage') : t('comfy.taskVideo')} · </span>}
                      {r.familiaNome}
                      {r.variante ? ` · ${txt(r.variante)}` : ''}
                      {r.passos ? ` · ${t('comfy.steps', { n: r.passos })}` : ''}
                      {r.tamanhoGb ? ` · ${t('comfy.download', { gb: r.tamanhoGb })}` : ''}
                    </div>
                    {r.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {r.tags.slice(0, 4).map(g => (
                          <button key={g} onClick={() => setTag(g)}
                            className="text-[9px] px-1.5 py-px rounded border border-white/[0.08] text-white/40 hover:text-white/75 hover:border-white/20 transition-colors">
                            {g}
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="text-[11px] text-white/55 mt-1.5 leading-relaxed">{txt(r.nota)}</p>
                    <p className="text-[10.5px] text-white/35 mt-1">
                      {txt(r.motivo)}{' '}
                      <span className="text-white/25">
                        {r.fonteVram === 'comfyui' ? t('comfy.vramFrom.comfyui') : r.fonteVram === 'curada' ? t('comfy.vramFrom.curada') : t('comfy.vramFrom.estimada')}
                      </span>
                    </p>
                    <div className="text-[10px] text-white/25 mt-1.5 tabular-nums">
                      {t('comfy.quality')} <span className="text-white/45">{pontos(r.qualidade)}</span>
                      {'  ·  '}{t('comfy.speed')} <span className="text-white/45">{pontos(r.velocidade)}</span>
                    </div>
                    {salvoEm?.id === r.id && <p className="text-[10.5px] text-emerald-300/80 mt-1.5 truncate">{t('comfy.savedTo', { path: salvoEm.path })}</p>}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button onClick={() => void baixar(r.id, r.template)} disabled={!!baixando}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white transition-all hover:brightness-110 disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg, #8f0e2e, #F97316)' }}>
                      {baixando === r.id ? t('comfy.downloading') : t('comfy.downloadBtn')}
                    </button>
                    {r.tutorialUrl && (
                      <button onClick={() => window.api.openExternal(r.tutorialUrl!)}
                        className="px-2.5 py-1 rounded-lg text-[10.5px] text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                        {t('comfy.tutorial')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-white/25 mt-4 leading-relaxed">{t('comfy.estimateNote')}</p>
          <p className="text-[10px] text-white/25 mt-1 leading-relaxed">{t('comfy.howTo')}</p>
        </div>
      </div>
    </div>
  )
}
