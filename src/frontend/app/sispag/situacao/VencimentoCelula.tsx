import { Badge } from '@/components/ui/badge'
import { formatErpDay, type TituloAPagar } from '@/lib/sispag'
import { causaDoPrazo, estaPerdido, ROTULO_PERDIDO } from './prazoTitulo'

/**
 * Coluna Vencimento: a DATA (dd/mm/aaaa, dia do ERP, sem fuso) e, embaixo, o relativo em badge
 * outline como no resto da tela. Vencido e "vence hoje" usam o tom de perigo.
 */
export function VencimentoCelula({
  vencimento,
  dias,
  titulo,
}: {
  vencimento?: number
  dias?: number
  /** Com o título, a célula mostra a causa do prazo do boleto sugerido (I19t). */
  titulo?: TituloAPagar
}) {
  const causa = titulo ? causaDoPrazo(titulo) : undefined
  const perdido = titulo ? estaPerdido(titulo) : false
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="text-xs tabular-nums">{formatErpDay(vencimento)}</span>
      {dias === undefined ? (
        <span className="text-muted-foreground">—</span>
      ) : dias < 0 ? (
        <Badge variant="outline" className="border-danger/40 text-danger">
          vencido {Math.abs(dias)}d
        </Badge>
      ) : dias === 0 ? (
        <Badge variant="outline" className="border-danger/40 text-danger">
          vence hoje
        </Badge>
      ) : dias <= 7 ? (
        <Badge variant="outline" className="border-warning/40 text-warning">
          vence em {dias}d
        </Badge>
      ) : (
        <Badge variant="outline">em {dias}d</Badge>
      )}
      {causa ? <span className="text-xs text-danger-foreground">{causa}</span> : null}
      {perdido ? (
        <Badge variant="outline" className="border-warning/40 text-warning-foreground">
          {ROTULO_PERDIDO}
        </Badge>
      ) : null}
    </div>
  )
}
