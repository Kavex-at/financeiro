'use client'

import { CircleHelp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MOTIVO_PAGAMENTO, type MotivoPagamento, type SugestaoBoletoSemDda } from '@/lib/sispag'
import { ChipFiltro } from '../components/filtros/ChipFiltro'
import { DONO_DO_MOTIVO, ROTULO_DONO, ROTULO_MOTIVO, ROTULO_SUGESTAO_BOLETO } from './rotulos'
import { SegmentosComTotal } from '../components/filtros/SegmentosComTotal'
import type { EstadoFiltro, Total } from './situacaoTitulos'

const OPCOES: ReadonlyArray<{ valor: EstadoFiltro; rotulo: string }> = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'prontos', rotulo: 'Prontos' },
  { valor: 'bloqueados', rotulo: 'Bloqueados' },
]

const PONTO: Record<EstadoFiltro, string> = {
  todos: '',
  prontos: 'bg-success',
  bloqueados: 'bg-danger',
}

/**
 * Filtro externo `Todos | Prontos | Bloqueados` (decisão D3), com contagem e valor, e — com
 * Bloqueados escolhido — os chips de motivo com o dono. Os chips e a coluna Situação editam a
 * MESMA seleção (`situacoes`). Com "Boleto sem DDA" marcado, uma segunda linha o divide pela
 * sugestão de boleto (I19r). O "?" abre as regras (decisão D11).
 */
export function FiltroSituacaoBarra({
  estado,
  totais,
  motivos,
  motivosSelecionados,
  onEstado,
  onAlternarMotivo,
  sugestoesBoleto = [],
  sugestoesSelecionadas = [],
  onAlternarSugestao,
  regrasAbertas,
  regrasId,
  onAlternarRegras,
}: {
  estado: EstadoFiltro
  totais: Record<EstadoFiltro, Total>
  /** Motivos presentes nos bloqueados, com contagem. */
  motivos: Array<{ motivo: MotivoPagamento } & Total>
  motivosSelecionados: readonly string[]
  onEstado: (e: EstadoFiltro) => void
  onAlternarMotivo: (m: MotivoPagamento) => void
  /** "Boleto sem DDA" por sugestão, com contagem (vazio em backend antigo). */
  sugestoesBoleto?: Array<{ sugestao: SugestaoBoletoSemDda } & Total>
  sugestoesSelecionadas?: readonly SugestaoBoletoSemDda[]
  onAlternarSugestao?: (s: SugestaoBoletoSemDda) => void
  regrasAbertas: boolean
  regrasId: string
  onAlternarRegras: () => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentosComTotal
          rotulo="Situação do título"
          segmentos={OPCOES.map((o) => ({
            valor: o.valor,
            rotulo: o.rotulo,
            ponto: PONTO[o.valor],
            qtd: totais[o.valor].qtd,
            valorReais: totais[o.valor].valor,
          }))}
          ativo={estado}
          onSelecionar={onEstado}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 rounded-full"
          aria-expanded={regrasAbertas}
          aria-controls={regrasId}
          aria-label="Como a situação é calculada"
          title="Como a situação é calculada"
          onClick={onAlternarRegras}
        >
          <CircleHelp className="size-4" aria-hidden />
        </Button>
      </div>
      {estado === 'bloqueados' && motivos.length > 0 ? (
        <div role="group" aria-label="Motivo do bloqueio" className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Por motivo:</span>
          {Object.values(MOTIVO_PAGAMENTO)
            .map((m) => motivos.find((x) => x.motivo === m))
            .flatMap((x) => (x ? [x] : []))
            .map(({ motivo, qtd }) => {
              const marcado = motivosSelecionados.includes(motivo)
              return (
                <ChipFiltro key={motivo} marcado={marcado} onClick={() => onAlternarMotivo(motivo)}>
                  {ROTULO_MOTIVO[motivo]}
                  <b className="tabular-nums">{qtd}</b>
                  <span className={cn('text-xs', marcado ? 'opacity-70' : 'text-muted-foreground')}>
                    · {ROTULO_DONO[DONO_DO_MOTIVO[motivo]]}
                  </span>
                </ChipFiltro>
              )
            })}
        </div>
      ) : null}
      {estado === 'bloqueados' &&
      motivosSelecionados.includes(MOTIVO_PAGAMENTO.BOLETO_SEM_DDA) &&
      sugestoesBoleto.length > 0 ? (
        <div
          role="group"
          aria-label="Boleto sem DDA por sugestão"
          className="flex flex-wrap items-center gap-1.5 border-l-2 pl-3"
        >
          <span className="text-xs text-muted-foreground">Boleto sem DDA, por sugestão:</span>
          {sugestoesBoleto.map(({ sugestao, qtd }) => {
            const marcado = sugestoesSelecionadas.includes(sugestao)
            return (
              <ChipFiltro
                key={sugestao}
                marcado={marcado}
                onClick={() => onAlternarSugestao?.(sugestao)}
              >
                {ROTULO_SUGESTAO_BOLETO[sugestao]}
                <b className="tabular-nums">{qtd}</b>
              </ChipFiltro>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
