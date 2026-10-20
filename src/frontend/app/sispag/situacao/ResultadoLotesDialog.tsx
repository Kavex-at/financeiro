'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  type CriarLotesPorFilialResult,
  type LoteCriadoPorFilial,
  RESULTADO_LOTE_FILIAL,
  type TituloAPagar,
} from '@/lib/sispag'
import { ROTULO_MOTIVO } from './rotulos'
import { resumirResultadoLotes } from './resultadoLotes'

const ROTULO_RESULTADO: Record<LoteCriadoPorFilial['resultado'], string> = {
  [RESULTADO_LOTE_FILIAL.CRIADO]: 'Lote criado',
  [RESULTADO_LOTE_FILIAL.PARCIAL]: 'Criado em parte',
  [RESULTADO_LOTE_FILIAL.RECUSADO]: 'Nenhum título entrou',
}

const CLASSE_RESULTADO: Record<LoteCriadoPorFilial['resultado'], string> = {
  [RESULTADO_LOTE_FILIAL.CRIADO]: 'border-success/40 text-success-foreground',
  [RESULTADO_LOTE_FILIAL.PARCIAL]: 'border-warning/40 text-warning-foreground',
  [RESULTADO_LOTE_FILIAL.RECUSADO]: 'border-danger/40 text-danger-foreground',
}

/**
 * Resultado de "Criar lotes": um bloco por filial, com o que entrou e, para cada título recusado,
 * a mensagem do servidor e o motivo de pagamento. Um lote que falha não desfaz os outros, e a
 * analista precisa ver isso título a título para saber o que resolver.
 */
export function ResultadoLotesDialog({
  resultado,
  titulos,
  onClose,
  onVerLote,
}: {
  resultado: CriarLotesPorFilialResult | null
  /** A lista da tela, só para mostrar o nome do credor ao lado do documento. */
  titulos: TituloAPagar[]
  onClose: () => void
  onVerLote: (loteId: string) => void
}) {
  const credor = (c: { filCod: number; docCod: string; titCod: string }) =>
    titulos.find((t) => t.filCod === c.filCod && t.docCod === c.docCod && t.titCod === c.titCod)?.credor
  const resumo = resultado ? resumirResultadoLotes(resultado) : null
  return (
    <Dialog open={resultado !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{resumo?.titulo ?? 'Resultado'}</DialogTitle>
          <DialogDescription>
            Foi criado um lote por filial. Nada foi escrito no ERP ainda: o lote nasce em rascunho.
          </DialogDescription>
        </DialogHeader>
        {resultado ? (
          <DialogBody className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
            {resultado.lotes.map((l) => (
              <section key={l.filCod} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    Filial {l.filCod}
                    <Badge variant="outline" className={CLASSE_RESULTADO[l.resultado]}>
                      {ROTULO_RESULTADO[l.resultado]}
                    </Badge>
                    <span className="text-xs font-normal text-muted-foreground">
                      {l.incluidos.length} entraram
                      {l.recusados.length > 0 ? ` · ${l.recusados.length} recusados` : ''}
                    </span>
                  </p>
                  {l.loteId ? (
                    <Button size="sm" variant="outline" onClick={() => onVerLote(l.loteId as string)}>
                      Abrir o lote
                    </Button>
                  ) : null}
                </div>
                {l.recusados.length > 0 ? (
                  <ul className="space-y-1 text-sm" aria-label={`Títulos recusados da filial ${l.filCod}`}>
                    {l.recusados.map((r) => (
                      <li
                        key={`${r.chave.docCod}/${r.chave.titCod}`}
                        className="rounded-md bg-danger-subtle/30 px-2 py-1.5"
                      >
                        <span className="font-medium">
                          {credor(r.chave) ?? '—'}{' '}
                          <span className="font-normal text-muted-foreground">
                            {r.chave.docCod}/{r.chave.titCod}
                          </span>
                        </span>
                        {r.motivo ? (
                          <Badge variant="outline" className="ml-2 border-danger/40 text-danger-foreground">
                            {ROTULO_MOTIVO[r.motivo]}
                          </Badge>
                        ) : null}
                        <p className="text-xs text-muted-foreground">{r.mensagem}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
