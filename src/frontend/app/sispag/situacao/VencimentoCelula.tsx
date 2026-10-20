import { Badge } from '@/components/ui/badge'
import { formatErpDay } from '@/lib/sispag'

/**
 * Coluna Vencimento: a DATA (dd/mm/aaaa, dia do ERP, sem fuso) e, embaixo, o relativo em badge
 * outline como no resto da tela. Vencido e "vence hoje" usam o tom de perigo.
 */
export function VencimentoCelula({ vencimento, dias }: { vencimento?: number; dias?: number }) {
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
    </div>
  )
}
