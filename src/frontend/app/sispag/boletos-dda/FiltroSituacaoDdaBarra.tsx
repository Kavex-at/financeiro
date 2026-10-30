'use client'

import { CircleHelp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BoletoDdaSituacao, BoletosDdaResposta } from '@/lib/sispag'
import { ChipFiltro } from '../components/filtros/ChipFiltro'
import { SegmentosComTotal } from '../components/filtros/SegmentosComTotal'
import {
  rotuloDaSituacao,
  type SegmentoDda,
  SITUACOES_PARA_CONFERIR,
  somaTotais,
  totalDe,
} from './filtrosBoletosDda'

const SEGMENTOS: ReadonlyArray<{ valor: SegmentoDda; rotulo: string; ponto: string }> = [
  { valor: 'todos', rotulo: 'Todos', ponto: '' },
  { valor: 'casados', rotulo: 'Casados', ponto: 'bg-success' },
  { valor: 'conferir', rotulo: 'Para conferir', ponto: 'bg-danger' },
  { valor: 'sem-titulo', rotulo: 'Sem título', ponto: 'bg-muted-foreground' },
  { valor: 'fora-janela', rotulo: 'Fora da janela', ponto: 'bg-muted-foreground' },
  // Escondido em "Todos": só aparece aqui, com a quantidade.
  { valor: 'saiu-carteira', rotulo: 'Saiu da carteira', ponto: 'bg-muted-foreground' },
]

/**
 * Filtro externo da aba Boletos DDA, no padrão de `FiltroSituacaoBarra`: segmentos com quantidade
 * e R$; com "Para conferir", os chips Candidato/Ambíguo; e o chip "Em grupo" (ortogonal à
 * situação). Segmento, chips e a coluna Situação editam o MESMO estado. O "?" abre as regras.
 */
export function FiltroSituacaoDdaBarra({
  dados,
  segmento,
  situacoes,
  emGrupo,
  onSegmento,
  onAlternarConferir,
  onAlternarEmGrupo,
  regrasAbertas,
  regrasId,
  onAlternarRegras,
}: {
  dados?: BoletosDdaResposta
  /** `undefined` = a coluna Situação tem uma combinação sem segmento (nenhum aceso). */
  segmento: SegmentoDda | undefined
  situacoes: readonly BoletoDdaSituacao[]
  emGrupo: boolean
  onSegmento: (s: SegmentoDda) => void
  onAlternarConferir: (s: BoletoDdaSituacao) => void
  onAlternarEmGrupo: () => void
  regrasAbertas: boolean
  regrasId: string
  onAlternarRegras: () => void
}) {
  const totalDoSegmento = (s: SegmentoDda) => {
    switch (s) {
      case 'todos':
        return totalDe(dados, 'todas')
      case 'casados':
        return totalDe(dados, 'VINCULADO')
      case 'conferir':
        return somaTotais(totalDe(dados, 'CANDIDATO'), totalDe(dados, 'AMBIGUO'))
      case 'sem-titulo':
        return totalDe(dados, 'SEM_TITULO')
      case 'fora-janela':
        return totalDe(dados, 'FORA_JANELA')
      case 'saiu-carteira':
        return totalDe(dados, 'TITULO_SAIU_CARTEIRA')
    }
  }
  const marcadas = situacoes.length === 1 ? situacoes : []
  const grupos = totalDe(dados, 'emGrupo')
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentosComTotal<SegmentoDda | 'misto'>
          rotulo="Situação do boleto"
          segmentos={SEGMENTOS.map((s) => {
            const t = totalDoSegmento(s.valor)
            return {
              valor: s.valor,
              rotulo: s.rotulo,
              ponto: s.ponto,
              ...(t.qtd !== undefined ? { qtd: t.qtd } : {}),
              ...(t.valor !== undefined ? { valorReais: t.valor } : {}),
            }
          })}
          ativo={segmento ?? 'misto'}
          onSelecionar={(s) => {
            if (s !== 'misto') onSegmento(s)
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 rounded-full"
          aria-expanded={regrasAbertas}
          aria-controls={regrasId}
          aria-label="Como a situação do boleto é calculada"
          title="Como a situação do boleto é calculada"
          onClick={onAlternarRegras}
        >
          <CircleHelp className="size-4" aria-hidden />
        </Button>
      </div>
      <div role="group" aria-label="Filtros rápidos" className="flex flex-wrap items-center gap-1.5">
        {segmento === 'conferir' ? (
          <>
            <span className="text-xs text-muted-foreground">Por situação:</span>
            {SITUACOES_PARA_CONFERIR.map((s) => (
              <ChipFiltro key={s} marcado={marcadas.includes(s)} onClick={() => onAlternarConferir(s)}>
                {rotuloDaSituacao(s)}
                <b className="tabular-nums">{totalDe(dados, s).qtd ?? '—'}</b>
              </ChipFiltro>
            ))}
            <span aria-hidden className="mx-1 h-4 border-l" />
          </>
        ) : null}
        <ChipFiltro
          marcado={emGrupo}
          onClick={onAlternarEmGrupo}
          title="Boletos que pagam vários títulos de uma vez (grupo sugerido ou confirmado)"
        >
          Em grupo
          <b className="tabular-nums">{grupos.qtd ?? '—'}</b>
        </ChipFiltro>
      </div>
    </div>
  )
}
