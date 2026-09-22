'use client'

import { AlertTriangle, FileText, Lock } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  fetchJanelaDataDebito,
  formatCivilDate,
  type GerarRemessaResult,
  gerarRemessa,
  type JanelaDataDebito,
  type LotePagamento,
} from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'

/**
 * Executor de ações do lote (vive no `page.tsx`). Recebe `opts` para que a própria ação possa
 * ser repetida COM confirmação — é assim que o toast do lote cancelado reexecuta exatamente a
 * mesma chamada, só que aprovada (e, aqui, com a mesma data de débito).
 */
export type Acao = (
  fn: (opts?: { confirmarNovoLote?: boolean }) => Promise<unknown>,
  okMsg: string | ((resultado: unknown) => { titulo: string; descricao?: string }),
) => void

const CAMPO_ID = 'gerar-remessa-data-debito'
const ERRO_ID = 'gerar-remessa-data-debito-erro'
const JANELA_ID = 'gerar-remessa-janela'

/** Mensagem de sucesso por resultado — dry-run e remessa real NÃO podem soar iguais. */
const mensagemDeSucesso =
  (filCod: number) =>
  (r: unknown): { titulo: string; descricao?: string } => {
    const res = r as GerarRemessaResult
    const debito = res.dataDebito ? ` · débito em ${formatCivilDate(res.dataDebito)}` : ''
    if (res.status === 'dry-run') {
      return {
        titulo: 'Simulação (dry-run) — NADA foi criado no Conexos',
        descricao:
          'A escrita está desligada (CONEXOS_DRY_RUN). Nenhum lote nem arquivo existe no ERP.',
      }
    }
    if (res.status === 'skipped') {
      return {
        titulo: 'Remessa já existia — nada foi gerado de novo',
        descricao: `Lote nativo ${res.nativeFlpCod ?? '—'} no Conexos${debito}.`,
      }
    }
    return {
      titulo: `Remessa ${res.arquivo ?? ''} gerada`,
      // Sem isto, quem gerou não sabe ONDE procurar no ERP — foi o que aconteceu no
      // primeiro teste: sucesso na tela, e ninguém achava o lote.
      descricao: `Lote nativo ${res.nativeFlpCod} · filial ${filCod} · remessa nº ${res.numRemessa ?? '—'}${debito}`,
    }
  }

/** Por que não existe data possível — em termos que a analista resolve (reabrir o lote). */
function explicarJanelaVazia(j: JanelaDataDebito): string {
  const t = j.limitante
  const titulo = t ? `${t.documento}${t.credor ? ` — ${t.credor}` : ''}` : 'um título do lote'
  switch (j.vazia?.motivo) {
    case 'titulo_vencido':
      return `O título ${titulo} venceu em ${t?.vencimento ? formatCivilDate(t.vencimento) : '—'}. Nenhuma data de débito é possível: reabra o lote e retire esse título.`
    case 'sem_dia_util':
      return `Não há dia útil bancário entre hoje (${formatCivilDate(j.hoje)}) e o vencimento do título ${titulo}${t?.vencimento ? ` (${formatCivilDate(t.vencimento)})` : ''}. Reabra o lote e retire esse título.`
    default:
      return `O título ${titulo} está sem vencimento no lote, então a janela de débito não pode ser calculada. Reabra o lote e retire ou reinclua o título.`
  }
}

/** Erro inline da data escolhida, a partir SÓ da janela do backend. */
function erroDaData(j: JanelaDataDebito, data: string): string | undefined {
  if (!data) return 'Escolha a data de débito.'
  if (!j.min || !j.max || data < j.min || data > j.max) {
    return `${formatCivilDate(data)} está fora da janela permitida.`
  }
  if (j.naoUteis.includes(data)) return `${formatCivilDate(data)} não é dia útil bancário.`
  return undefined
}

/** Um dia é selecionável se cai na janela e não é dia não útil. */
const selecionavel = (j: JanelaDataDebito, data?: string): data is string =>
  data !== undefined && erroDaData(j, data) === undefined

/**
 * Confirmação de "Gerar remessa" com a data de débito (ADR-0049). A janela, os atalhos e os
 * dias não úteis vêm prontos do backend — a tela não sabe o que é feriado.
 */
export function GerarRemessaDialog({
  lote: l,
  open,
  onOpenChange,
  busy,
  acao,
}: {
  lote: LotePagamento
  open: boolean
  onOpenChange: (open: boolean) => void
  busy: boolean
  acao: Acao
}) {
  const [janela, setJanela] = React.useState<JanelaDataDebito | null>(null)
  const [erroCarga, setErroCarga] = React.useState<string | null>(null)
  const [data, setData] = React.useState('')

  // O card monta este diálogo só enquanto ele está aberto: cada abertura começa do zero
  // (janela relida), sem precisar zerar estado dentro do efeito.
  React.useEffect(() => {
    if (!open) return
    let vivo = true
    fetchJanelaDataDebito(l.id)
      .then((j) => {
        if (!vivo) return
        setJanela(j)
        setData(j.congelada?.data ?? j.sugerida ?? '')
      })
      .catch((e: unknown) => {
        if (vivo) setErroCarga(e instanceof Error ? e.message : 'Falha ao carregar a janela.')
      })
    return () => {
      vivo = false
    }
  }, [open, l.id])

  const total = l.itens.reduce((acc, i) => acc + (i.valor ?? 0), 0)
  const congelada = janela?.congelada
  const erro = janela && !congelada && !janela.vazia ? erroDaData(janela, data) : undefined
  const podeGerar =
    !busy && janela !== null && !janela.vazia && (congelada !== undefined || erro === undefined)

  const confirmar = () => {
    const dataDebito = congelada?.data ?? data
    onOpenChange(false)
    acao((o) => gerarRemessa(l.id, { ...o, dataDebito }), mensagemDeSucesso(l.filCod))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Gerar remessa</DialogTitle>
          <DialogDescription>
            {l.itens.length} título(s) · {formatBRL(total)} · conta pagadora{' '}
            {l.conta ? `${l.banco ?? ''} ${l.conta}`.trim() : 'padrão da filial'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {erroCarga ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              Não foi possível carregar a janela de débito: {erroCarga}
            </p>
          ) : !janela ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : janela.vazia ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-subtle/40 p-3 text-sm text-warning-foreground"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {explicarJanelaVazia(janela)}
            </p>
          ) : congelada ? (
            <div className="space-y-2 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <Lock className="size-4 text-muted-foreground" aria-hidden />
                Débito em {formatCivilDate(congelada.data)}
              </p>
              <p className="text-muted-foreground">
                Lote nativo flp {congelada.nativeFlpCod} já criado no Conexos com esta data; para
                mudar, cancele no fin015.
              </p>
              {congelada.motivo === 'no_passado' ? (
                <p className="text-warning-foreground">
                  Esta data já passou. Se o Conexos ainda não finalizou o lote, ele vai recusar:
                  cancele o flp {congelada.nativeFlpCod} no fin015 e gere de novo.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!selecionavel(janela, janela.hoje)}
                  onClick={() => setData(janela.hoje)}
                >
                  Hoje {formatCivilDate(janela.hoje)}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!selecionavel(janela, janela.amanha)}
                  title={janela.amanha ? undefined : 'O próximo dia útil está fora da janela.'}
                  onClick={() => janela.amanha && setData(janela.amanha)}
                >
                  {janela.amanha ? `Amanhã ${formatCivilDate(janela.amanha)}` : 'Amanhã'}
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={CAMPO_ID}>Data de débito</Label>
                <DatePicker
                  id={CAMPO_ID}
                  value={data}
                  onChange={setData}
                  min={janela.min}
                  max={janela.max}
                  aria-invalid={erro !== undefined}
                  aria-describedby={erro ? `${ERRO_ID} ${JANELA_ID}` : JANELA_ID}
                />
                {erro ? (
                  <p id={ERRO_ID} role="alert" className="text-xs text-destructive">
                    {erro}
                  </p>
                ) : null}
              </div>
              <div id={JANELA_ID} className="space-y-0.5 text-xs text-muted-foreground">
                {janela.min && janela.max ? (
                  <p>
                    Permitido: {formatCivilDate(janela.min)} a {formatCivilDate(janela.max)}
                    {janela.naoUteis.length > 0 ? ', só em dias úteis bancários.' : '.'}
                  </p>
                ) : null}
                {janela.limitante ? (
                  <p>
                    limitado pelo título {janela.limitante.documento}
                    {janela.limitante.credor ? ` — ${janela.limitante.credor}` : ''}
                    {janela.limitante.vencimento
                      ? `, vence ${formatCivilDate(janela.limitante.vencimento)}`
                      : ''}
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={!podeGerar}>
            <FileText className="size-4" aria-hidden /> Gerar remessa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
