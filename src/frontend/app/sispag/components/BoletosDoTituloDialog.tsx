'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
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
  type TituloSemBoleto,
  fetchBoletosDdaDoTitulo,
} from '@/lib/sispag'
import { SITUACAO_BADGE } from './BoletosDdaTab'
import { DiferencaBadge, fmtCivil } from './CandidatosBoletoDialog'

function TabelaBoletos({ linhas, mostrarLigacao }: { linhas: BoletoDdaDoTitulo[]; mostrarLigacao: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Boleto</TableHead>
          <TableHead className="text-right">Valor</TableHead>
          <TableHead>Vencimento</TableHead>
          <TableHead>Diferença</TableHead>
          <TableHead>Situação</TableHead>
          {mostrarLigacao ? <TableHead>Ligado a</TableHead> : null}
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
}: {
  titulo: TituloSemBoleto | null
  onClose: () => void
}) {
  // O resultado guarda de QUE título é: ao trocar de título, o resultado antigo deixa de valer
  // sem precisar zerar estado dentro do efeito.
  const [resultado, setResultado] = React.useState<{
    chave: string
    dados?: BoletosDdaDoTitulo
    erro?: string
  } | null>(null)

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
  }, [titulo, chave])

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
              {erro ? (
                <EmptyState title="Não foi possível consultar os boletos DDA" description={erro} />
              ) : dados === null ? (
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
