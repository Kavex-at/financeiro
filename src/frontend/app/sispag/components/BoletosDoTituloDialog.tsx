'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatBRL } from '@/lib/utils'
import {
  type BoletoDdaDoTitulo,
  type BoletosDdaDoTitulo,
  type SugestaoBoleto,
  type TituloSemBoleto,
  fetchBoletosDdaDoTitulo,
} from '@/lib/sispag'
import { SITUACAO_BADGE } from './BoletosDdaTab'
import { DiferencaBadge, fmtCivil } from './CandidatosBoletoDialog'
import { SugestaoBoletoPainel } from './SugestaoBoletoPainel'

function TabelaBoletos({ linhas, mostrarLigacao }: { linhas: BoletoDdaDoTitulo[]; mostrarLigacao: boolean }) {
  return (
    <Table>
      <caption className="sr-only">
        {mostrarLigacao
          ? 'Outros boletos DDA com o mesmo valor'
          : 'Boletos DDA candidatos do título'}
      </caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Boleto</TableHead>
          <TableHead scope="col" className="text-right">
            Valor
          </TableHead>
          <TableHead scope="col">Vencimento</TableHead>
          <TableHead scope="col">Diferença</TableHead>
          <TableHead scope="col">Situação</TableHead>
          {mostrarLigacao ? <TableHead scope="col">Ligado a</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {linhas.map(({ boleto: b, diferencaDias }) => {
          const badge = SITUACAO_BADGE[b.situacao]
          return (
            <TableRow key={`${b.ddcCod}:${b.ditCod}`}>
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium tabular-nums">{b.numero ?? '—'}</span>
                  <span className="text-xs text-muted-foreground">fin124 #{b.ddcCod}</span>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatBRL(b.valor)}</TableCell>
              <TableCell className="tabular-nums">{fmtCivil(b.vencimento)}</TableCell>
              <TableCell>
                <DiferencaBadge dias={diferencaDias} />
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={badge.className} title={badge.title}>
                  {badge.label}
                </Badge>
              </TableCell>
              {mostrarLigacao ? (
                <TableCell className="text-xs text-muted-foreground">
                  {b.vinculo
                    ? `${b.vinculo.credor ?? '—'} · ${b.vinculo.docCod}/${b.vinculo.titCod} (fil ${b.vinculo.filCod})`
                    : '—'}
                </TableCell>
              ) : null}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/**
 * Boletos DDA de UM título que ficou sem associação. Reúne o que a aba "Boletos DDA" mostra,
 * filtrado pelo título: o que o Conexos lista como candidato dele e os boletos de mesmo valor com
 * outra data — onde costuma estar o problema (o Conexos associa por valor, fornecedor e data, e
 * uma diferença de dias basta para não casar).
 */
export function BoletosDoTituloDialog({
  titulo,
  onClose,
  sugestoes = [],
  podeExecutar = false,
  podeCopiar = false,
  ddaDefasadoHoras,
  onDecidido,
  vinculadoEmLoteVivo = false,
}: {
  /** O item do título tem o código vinculado num lote vivo (ADR-0071, I17l). */
  vinculadoEmLoteVivo?: boolean
  titulo: TituloSemBoleto | null
  onClose: () => void
  /** Sugestões (ADR-0068) deste título; vazio = a seção nem aparece. */
  sugestoes?: SugestaoBoleto[]
  podeExecutar?: boolean
  podeCopiar?: boolean
  ddaDefasadoHoras?: number | undefined
  onDecidido?: () => void | Promise<void>
}) {
  // O resultado guarda de QUE título é: ao trocar de título, o resultado antigo deixa de valer
  // sem precisar zerar estado dentro do efeito.
  const [resultado, setResultado] = React.useState<{
    chave: string
    dados?: BoletosDdaDoTitulo
    erro?: string
  } | null>(null)

  const [tentativa, setTentativa] = React.useState(0)
  const chave = titulo ? `${titulo.filCod ?? ''}:${titulo.docCod}:${titulo.titCod}` : null
  React.useEffect(() => {
    if (!titulo || chave === null) return
    let vivo = true
    fetchBoletosDdaDoTitulo(titulo)
      .then((dados) => {
        if (vivo) setResultado({ chave, dados })
      })
      .catch((e: unknown) => {
        if (vivo)
          setResultado({
            chave,
            erro: e instanceof Error ? e.message : 'Falha ao consultar os boletos DDA',
          })
      })
    return () => {
      vivo = false
    }
  }, [titulo, chave, tentativa])

  const atual = resultado !== null && resultado.chave === chave ? resultado : null
  const dados = atual?.dados ?? null
  const erro = atual?.erro ?? null

  const vazio = dados !== null && dados.doTitulo.length === 0 && dados.mesmoValor.length === 0
  return (
    <Dialog open={titulo !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent size="lg">
        {titulo ? (
          <>
            <DialogHeader>
              <DialogTitle>
                Boletos DDA do título {titulo.docCod}/{titulo.titCod}
                {titulo.credor ? ` · ${titulo.credor}` : ''}
              </DialogTitle>
              <DialogDescription>
                {titulo.valor !== undefined ? formatBRL(titulo.valor) : 'valor desconhecido'}
                {titulo.vencimento ? ` · vence ${fmtCivil(titulo.vencimento)}` : ''}
                {titulo.filCod !== undefined ? ` · filial ${titulo.filCod}` : ''}. O Conexos liga
                o boleto ao título sozinho, por valor, fornecedor e data. Uma diferença de dias
                entre o vencimento do boleto e o do título costuma impedir a ligação.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4 overflow-y-auto">
              {sugestoes.length > 0 ? (
                <SugestaoBoletoPainel
                  sugestoes={sugestoes}
                  podeExecutar={podeExecutar}
                  podeCopiar={podeCopiar}
                  ddaDefasadoHoras={ddaDefasadoHoras}
                  itemVinculadoEmLoteVivo={vinculadoEmLoteVivo}
                  onDecidido={onDecidido ?? (() => undefined)}
                />
              ) : null}
              {erro ? (
                <div role="alert">
                  <EmptyState
                    title="Não foi possível consultar os boletos DDA"
                    description={erro}
                    action={
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setResultado(null)
                          setTentativa((n) => n + 1)
                        }}
                      >
                        Tentar de novo
                      </Button>
                    }
                  />
                </div>
              ) : dados === null ? (
                // O Spinner já expõe role=status com o rótulo "Loading".
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner /> Consultando os boletos DDA…
                </div>
              ) : vazio ? (
                <EmptyState
                  title="Nenhum boleto DDA com este valor"
                  description="Confira se o arquivo DDA deste boleto já foi importado (fin124) e se o valor do título bate com o do boleto."
                />
              ) : (
                <>
                  {dados.doTitulo.length > 0 ? (
                    <section className="flex flex-col gap-2">
                      <h3 className="text-sm font-medium">Candidatos deste título</h3>
                      <TabelaBoletos linhas={dados.doTitulo} mostrarLigacao={false} />
                    </section>
                  ) : null}
                  {dados.mesmoValor.length > 0 ? (
                    <section className="flex flex-col gap-2">
                      <h3 className="text-sm font-medium">Outros boletos com o mesmo valor</h3>
                      <p className="text-xs text-muted-foreground">
                        Não estão ligados a este título. Se o vencimento diferir por poucos dias,
                        é provável que seja o boleto dele.
                      </p>
                      <TabelaBoletos linhas={dados.mesmoValor} mostrarLigacao />
                    </section>
                  ) : null}
                </>
              )}
            </DialogBody>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
