'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import {
  type ConfirmacaoEmissorBoleto,
  fetchConfirmacoesEmissor,
  revogarConfirmacaoEmissor,
} from '@/lib/sispag'
import { MotivoDecisaoDialog } from './MotivoDecisaoDialog'

const quando = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR')
}

/**
 * Pares (credor, emissor) confirmados (ADR-0068, T8). Mostra só o emissor mascarado. Revogar é
 * `sispag:executar`, com motivo; a lista é de `sispag:ver`.
 */
export function ConfirmacoesEmissorPainel({
  podeExecutar,
  onAlterado,
}: {
  podeExecutar: boolean
  /** Depois de revogar: a tela relê as sugestões (o par deixa de tornar o tier CONHECIDO). */
  onAlterado?: () => void | Promise<void>
}) {
  const [lista, setLista] = React.useState<ConfirmacaoEmissorBoleto[] | null>(null)
  const [erro, setErro] = React.useState<string | null>(null)
  const [revogando, setRevogando] = React.useState<ConfirmacaoEmissorBoleto | null>(null)
  const [ok, setOk] = React.useState<string | null>(null)

  const carregar = React.useCallback(async () => {
    try {
      setLista(await fetchConfirmacoesEmissor())
      setErro(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar as confirmações de emissor.')
    }
  }, [])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  if (erro)
    return (
      <EmptyState
        title="Não foi possível carregar as confirmações de emissor"
        description={erro}
        action={
          <Button size="sm" variant="outline" onClick={() => void carregar()}>
            Tentar de novo
          </Button>
        }
      />
    )
  if (lista === null)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Carregando as confirmações de emissor…
      </div>
    )
  if (lista.length === 0)
    return (
      <EmptyState
        title="Nenhum emissor confirmado"
        description="Ao confirmar uma sugestão de boleto, o emissor do credor aparece aqui."
      />
    )

  return (
    <div className="flex flex-col gap-2">
      <div aria-live="polite">
        {ok ? (
          <p role="status" className="text-sm text-success">
            {ok}
          </p>
        ) : null}
      </div>
      <Table>
        <caption className="sr-only">Emissores de boleto confirmados por credor</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Credor</TableHead>
            <TableHead>Emissor</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>Confirmado por</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Ações</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lista.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">{c.credor ?? c.pesCod}</TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-1">
                  <span className="tabular-nums">{c.emissorMascarado}</span>
                  {!c.elegivelAutomatico ? (
                    <Badge
                      variant="outline"
                      className="border-warning/40 text-warning"
                      title="Layout genérico: nunca vira automático (I15i)."
                    >
                      não elegível a automático
                    </Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                {c.estado === 'VIGENTE' ? (
                  <Badge variant="outline" className="border-success/40 text-success">
                    vigente
                  </Badge>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    <Badge variant="outline">revogada</Badge>
                    {c.motivoRevogacao ? (
                      <span className="text-xs text-muted-foreground">{c.motivoRevogacao}</span>
                    ) : null}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {c.confirmadoPor} · {quando(c.confirmadoEm)}
              </TableCell>
              <TableCell className="text-right">
                {podeExecutar && c.estado === 'VIGENTE' ? (
                  <Button size="sm" variant="outline" onClick={() => setRevogando(c)}>
                    Revogar
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {revogando ? (
        <MotivoDecisaoDialog
          titulo="Revogar confirmação do emissor"
          descricao={`${revogando.credor ?? revogando.pesCod} · ${revogando.emissorMascarado}. As sugestões deste emissor voltam a 'forte'. Nada muda no Conexos. O motivo fica na trilha.`}
          rotuloConfirmar="Revogar"
          onFechar={() => setRevogando(null)}
          onConfirmar={async (motivo) => {
            try {
              await revogarConfirmacaoEmissor(revogando.id, motivo)
            } catch (e) {
              throw new Error(
                e instanceof Error && e.message
                  ? e.message
                  : 'Não foi possível revogar a confirmação.',
              )
            }
            setRevogando(null)
            setOk('Confirmação do emissor revogada.')
            await carregar()
            await onAlterado?.()
          }}
        />
      ) : null}
    </div>
  )
}
