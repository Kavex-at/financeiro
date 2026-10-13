import { Barcode } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formaDePagamento, type TituloAPagar } from '@/lib/sispag'

const TITULO: Record<'dda' | 'alerta', string> = {
  dda: 'BOLETO no Conexos com boleto DDA associado — o código de barras sai na remessa',
  alerta: 'BOLETO no Conexos sem boleto DDA: valor ou vencimento do boleto difere do título',
}

/**
 * Coluna "Forma de pagamento" de um título: a forma do Conexos (`titVldPagopor`) e, quando é
 * BOLETO, se o boleto DDA está associado. "boleto sem DDA" é o caso que sai sem código de barras.
 */
export function FormaPagamentoBadge({
  titulo,
}: {
  titulo: Pick<TituloAPagar, 'formaPagamentoConexos' | 'temBoleto'>
}) {
  const forma = formaDePagamento(titulo)
  if (forma.tom === 'dda') {
    return (
      <Badge variant="outline" className="border-success/40 text-success" title={TITULO.dda}>
        <Barcode className="mr-1 size-3" aria-hidden />
        {forma.rotulo}
      </Badge>
    )
  }
  if (forma.tom === 'alerta') {
    return (
      <Badge variant="outline" className="border-warning/40 text-warning" title={TITULO.alerta}>
        {forma.rotulo}
      </Badge>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground"
      title="Forma de pagamento no Conexos (Pago Por / Situação do psq014)"
    >
      {forma.rotulo}
      {forma.comDda ? (
        <span className="inline-flex items-center text-success">
          <Barcode className="size-3" aria-hidden />
          <span className="sr-only">com boleto DDA</span>
        </span>
      ) : null}
    </span>
  )
}
