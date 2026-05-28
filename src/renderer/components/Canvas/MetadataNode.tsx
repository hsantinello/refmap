import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { type ImageNodeData, type ComfyParams } from '../../store'

type MetadataNodeProps = NodeProps<ImageNodeData>

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="text-[10px] text-white/30 shrink-0">{label}</span>
      <span className={`text-[10px] text-white/60 truncate text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function MetadataNode({ data, selected }: MetadataNodeProps) {
  const p = (data.comfyParams ?? {}) as ComfyParams

  const baseName = p.model
    ? p.model.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '')
    : null

  const hasModels = baseName || (p.loras && p.loras.length > 0)
  const hasSampling = p.sampler || p.scheduler || p.steps !== undefined ||
    p.seed !== undefined || p.guidance !== undefined || p.cfg !== undefined ||
    p.width !== undefined

  return (
    <div
      className="rounded-2xl overflow-hidden shadow-xl transition-all"
      style={{
        width: 260,
        background: 'rgba(10, 6, 14, 0.92)',
        border: selected
          ? '1px solid rgba(251,146,60,0.6)'
          : '1px solid rgba(255,255,255,0.07)',
        boxShadow: selected
          ? '0 0 0 3px rgba(251,146,60,0.2), 0 8px 32px rgba(0,0,0,0.8)'
          : '0 8px 32px rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="text-[9px] font-bold tracking-widest uppercase text-white/25">ComfyUI</span>
        <span className="ml-auto text-[9px] text-orange-400/60">🔗</span>
      </div>

      {/* Models */}
      {hasModels && (
        <div className="px-3.5 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[8px] font-bold tracking-widest uppercase text-white/20 mb-2">Modelos</div>

          {baseName && (
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] text-white/65 font-medium truncate flex-1">{baseName}</span>
              <span className="text-[8px] px-1.5 py-0.5 rounded font-bold tracking-wider uppercase text-white/25"
                style={{ background: 'rgba(255,255,255,0.05)' }}>
                BASE
              </span>
            </div>
          )}

          {p.loras && p.loras.length > 0 && (
            <div className="space-y-1">
              {p.loras.map((lora, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[9px] text-white/25 shrink-0">↪</span>
                  <span className="text-[10px] text-orange-300/65 truncate flex-1">{lora.name}</span>
                  <span className="text-[9px] font-mono text-white/30 shrink-0">{lora.strengthModel.toFixed(1)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sampling */}
      {hasSampling && (
        <div className="px-3.5 py-2.5">
          <div className="text-[8px] font-bold tracking-widest uppercase text-white/20 mb-1.5">Sampling</div>

          {p.sampler && <Row label="Sampler" value={p.sampler} />}
          {p.scheduler && <Row label="Scheduler" value={p.scheduler} />}
          {p.steps !== undefined && <Row label="Steps" value={String(p.steps)} />}
          {p.denoise !== undefined && <Row label="Denoise" value={p.denoise.toFixed(2)} />}
          {(p.guidance !== undefined || p.cfg !== undefined) && (
            <Row label="Guidance" value={String(p.guidance ?? p.cfg)} />
          )}
          {p.width !== undefined && p.height !== undefined && (
            <Row label="Resolução" value={`${p.width} × ${p.height}`} />
          )}
          {p.seed !== undefined && (
            <Row label="Seed" value={String(p.seed)} />
          )}
        </div>
      )}

      {!hasModels && !hasSampling && (
        <div className="px-3.5 py-4 text-center text-[10px] text-white/20">Sem parâmetros</div>
      )}
    </div>
  )
}

export default memo(MetadataNode, (prev: MetadataNodeProps, next: MetadataNodeProps) =>
  prev.data === next.data &&
  prev.selected === next.selected
)
