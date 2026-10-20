'use client'

import { Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { formatBRL } from '@/lib/utils'
import type { ResumoSelecao } from './selecao'

/** O que a barra diz sobre as filiais da seleção: um lote, ou um lote por filial. */
export const textoFiliais = (filiais: readonly number[]): string =>
  filiais.length <= 1
    ? `Filial ${filiais[0] ?? '—'}: um lote.`
    : `Filiais ${filiais.join(', ')}: será criado um lote para cada filial.`

/**
 * Barra de seleção, presa à base da tela (decisão D8): quantos títulos, quanto vale e quantos
 * lotes nascem. A seleção pode atravessar filiais, e o botão cria um lote por filial.
 */
export function BarraSelecaoLotes({
  resumo,
  criando,
  onLimpar,
  onCriar,
}: {
  resumo: ResumoSelecao
  criando: boolean
  onLimpar: () => void
  onCriar: () => void
}) {
  if (resumo.qtd === 0) return null
  const lotes = resumo.filiais.length
  return (
    <div
      role="region"
      aria-label="Seleção de títulos"
      className="sticky bottom-3 z-10 mx-3 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-foreground px-4 py-2.5 text-background shadow-lg"
    >
      <div aria-live="polite">
        <p className="text-sm font-semibold tabular-nums">
          {resumo.qtd.toLocaleString('pt-BR')} selecionados · {formatBRL(resumo.valor)}
        </p>
        <p className="text-xs opacity-80">{textoFiliais(resumo.filiais)}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="border-background/60 bg-transparent text-background hover:bg-background/10 hover:text-background"
          disabled={criando}
          onClick={onLimpar}
        >
          Limpar
        </Button>
        <Button size="sm" disabled={criando} onClick={onCriar}>
          {criando ? <Spinner aria-hidden /> : <Layers className="size-4" aria-hidden />}
          Criar {lotes} lote{lotes > 1 ? 's' : ''}
        </Button>
      </div>
    </div>
  )
}
