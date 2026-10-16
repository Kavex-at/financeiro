import { AlertTriangle, Barcode } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formaDePagamento, type TituloAPagar } from '@/lib/sispag'
import {
  ROTULO_AVISO,
  ROTULO_SITUACAO,
  type ResumoDesfecho,
  SITUACAO_SEM_PAINEL,
  TOM_SITUACAO,
  type TomSituacao,
} from './sugestaoBoleto'

const EXPLICACAO: Record<'dda' | 'alerta', string> = {
  dda: 'o código de barras sai na remessa',
  alerta: 'valor ou vencimento do boleto difere do título',
}

const EXPLICACAO_AVISO = {
  CRITICO: 'O boleto candidato vence antes da data de débito prevista',
  ATENCAO: 'O boleto candidato vence antes do vencimento do título',
} as const

/** Tom do link: só o confirmável e seguro usa o tom de ação; fraco nunca é verde nem "disponível". */
const CLASSE_TOM: Record<TomSituacao, string> = {
  acao: 'text-primary',
  aviso: 'text-warning-foreground',
  mudo: 'text-muted-foreground',
}

const LINK_CLASSE =
  'text-xs underline underline-offset-2 focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm'

/**
 * Selo de situação do TÍTULO (ADR-0072): rótulo por situação, chip de aviso de vencimento antes do
 * título (ícone + texto + `sr-only`: a cor nunca é o único canal) e, para `SEM_CANDIDATO`, só o
 * texto — não há o que abrir.
 */
function SeloSugestao({
  sugestao,
  onAbrir,
}: {
  sugestao: ResumoDesfecho
  onAbrir: (() => void) | undefined
}) {
  const rotulo = ROTULO_SITUACAO[sugestao.situacao]
  const classe = CLASSE_TOM[TOM_SITUACAO[sugestao.situacao]]
  const aviso = sugestao.avisoVenceAntes
  const abre = onAbrir !== undefined && !SITUACAO_SEM_PAINEL.has(sugestao.situacao)
  return (
    <>
      {aviso !== 'NENHUM' ? (
        <span className="inline-flex items-center gap-1 text-xs text-warning-foreground">
          <AlertTriangle className="size-3 shrink-0" aria-hidden />
          {ROTULO_AVISO[aviso]}
          <span className="sr-only"> — {EXPLICACAO_AVISO[aviso]}</span>
        </span>
      ) : null}
      {abre ? (
        <button
          type="button"
          onClick={onAbrir}
          title={sugestao.total > 1 ? `${sugestao.total} boletos candidatos` : undefined}
          className={`${LINK_CLASSE} ${classe}`}
        >
          {rotulo}
        </button>
      ) : (
        <span className={`text-xs ${classe}`}>{rotulo}</span>
      )}
    </>
  )
}

/**
 * Coluna "Forma de pagamento" de um título: a forma do Conexos (`titVldPagopor`) e, quando é
 * BOLETO, se o boleto DDA está associado. "boleto sem DDA" é o caso que sai sem código de barras.
 */
export function FormaPagamentoBadge({
  titulo,
  sugestao,
  onAbrirSugestao,
}: {
  titulo: Pick<TituloAPagar, 'formaPagamentoConexos' | 'temBoleto'>
  /** Desfecho do título (ADR-0072) — só aparece em "boleto sem DDA". */
  sugestao?: ResumoDesfecho | undefined
  onAbrirSugestao?: () => void
}) {
  const forma = formaDePagamento(titulo)
  if (forma.tom === 'dda') {
    // Confirmação órfã (I15l): o ERP já sinalizou o título depois da confirmação. A analista
    // precisa chegar ao painel para anulá-la; as demais sugestões não aparecem aqui.
    const orfa = sugestao?.situacao === 'ORFA' && onAbrirSugestao
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
            className={`${LINK_CLASSE} text-primary`}
          >
            {ROTULO_SITUACAO.ORFA}
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
        {sugestao ? <SeloSugestao sugestao={sugestao} onAbrir={onAbrirSugestao} /> : null}
      </div>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
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
