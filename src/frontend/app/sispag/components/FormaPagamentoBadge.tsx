import { Barcode } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formaDePagamento, type TituloAPagar } from '@/lib/sispag'
import type { ResumoSugestaoTitulo } from './sugestaoBoleto'

const EXPLICACAO: Record<'dda' | 'alerta', string> = {
  dda: 'o código de barras sai na remessa',
  alerta: 'valor ou vencimento do boleto difere do título',
}

/**
 * Coluna "Forma de pagamento" de um título: a forma do Conexos (`titVldPagopor`) e, quando é
 * BOLETO, se o boleto DDA está associado. "boleto sem DDA" é o caso que sai sem código de barras.
 */
const ROTULO_SUGESTAO: Record<ResumoSugestaoTitulo, string> = {
  DISPONIVEL: 'sugestão disponível',
  INFORMATIVA: 'ver boleto sugerido',
  CONFIRMADA: 'boleto confirmado',
  ORFA: 'confirmação a revisar',
}

export function FormaPagamentoBadge({
  titulo,
  sugestao,
  onAbrirSugestao,
}: {
  titulo: Pick<TituloAPagar, 'formaPagamentoConexos' | 'temBoleto'>
  /** Resumo da sugestão de boleto (ADR-0068) — só aparece em "boleto sem DDA". */
  sugestao?: ResumoSugestaoTitulo | undefined
  onAbrirSugestao?: () => void
}) {
  const forma = formaDePagamento(titulo)
  if (forma.tom === 'dda') {
    // Confirmação órfã (I15l): o ERP já sinalizou o título depois da confirmação. A analista
    // precisa chegar ao painel para anulá-la; as demais sugestões não aparecem aqui.
    const orfa = sugestao === 'ORFA' && onAbrirSugestao
    return (
      <div className="flex flex-col items-start gap-1">
        <Badge variant="outline" className="border-success/40 text-success-foreground">
          <Barcode className="mr-1 size-3" aria-hidden />
          {forma.rotulo}
          <span className="sr-only"> — {EXPLICACAO.dda}</span>
        </Badge>
        {orfa ? (
          <button
            type="button"
            onClick={onAbrirSugestao}
            className="text-xs text-primary underline underline-offset-2 focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm"
          >
            {ROTULO_SUGESTAO.ORFA}
          </button>
        ) : null}
      </div>
    )
  }
  if (forma.tom === 'alerta') {
    return (
      <div className="flex flex-col items-start gap-1">
        <Badge variant="outline" className="border-warning/40 text-warning-foreground">
          {forma.rotulo}
          <span className="sr-only"> — {EXPLICACAO.alerta}</span>
        </Badge>
        {sugestao && onAbrirSugestao ? (
          <button
            type="button"
            onClick={onAbrirSugestao}
            className="text-xs text-primary underline underline-offset-2 focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm"
          >
            {ROTULO_SUGESTAO[sugestao]}
          </button>
        ) : null}
      </div>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground"
    >
      {forma.rotulo}
      {forma.comDda ? (
        <span className="inline-flex items-center text-success-foreground">
          <Barcode className="size-3" aria-hidden />
          <span className="sr-only">com boleto DDA</span>
        </span>
      ) : null}
    </span>
  )
}
