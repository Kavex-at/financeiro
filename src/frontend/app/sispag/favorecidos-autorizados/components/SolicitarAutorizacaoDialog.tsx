'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  type FavorecidoAutorizado,
  type ModalidadeAutorizavel,
  type OrigemSolicitacao,
  pedirAutorizacao,
} from '@/lib/sispag'

export interface PedidoInicial {
  pesCod?: string
  credor?: string
  modalidade?: ModalidadeAutorizavel
  filCod?: number
}

/**
 * Pedir a autorização de um favorecido (F1, `sispag:executar`). Nunca nasce autorizado: outra
 * pessoa, com `sispag:autorizar_favorecido`, aprova depois, conferindo o destino do Conexos.
 */
export function SolicitarAutorizacaoDialog({
  inicial,
  origem,
  onOpenChange,
  onSolicitada,
}: {
  inicial?: PedidoInicial
  origem: OrigemSolicitacao
  onOpenChange: (open: boolean) => void
  onSolicitada: (a: FavorecidoAutorizado) => void
}) {
  const [pesCod, setPesCod] = React.useState(inicial?.pesCod ?? '')
  const [credor, setCredor] = React.useState(inicial?.credor ?? '')
  const [modalidade, setModalidade] = React.useState<ModalidadeAutorizavel>(
    inicial?.modalidade ?? 'TED',
  )
  const [filCod, setFilCod] = React.useState(String(inicial?.filCod ?? 1))
  const [erro, setErro] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (salvando) return
    const fil = Number(filCod)
    if (pesCod.trim() === '' || !Number.isInteger(fil) || fil <= 0) {
      setErro('Informe o código do favorecido e a filial.')
      return
    }
    setErro(null)
    setSalvando(true)
    try {
      onSolicitada(
        await pedirAutorizacao({
          pesCod: pesCod.trim(),
          ...(credor.trim() ? { credor: credor.trim() } : {}),
          modalidade,
          origem,
          filCod: fil,
        }),
      )
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível pedir a autorização.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => { if (!salvando) onOpenChange(aberto) }}>
      <DialogContent size="sm">
        <form onSubmit={enviar} noValidate>
          <DialogHeader>
            <DialogTitle>Pedir autorização de favorecido</DialogTitle>
            <DialogDescription>
              O pedido fica pendente até outra pessoa aprovar, conferindo a conta ou a chave PIX
              do cadastro do Conexos.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pedido-pescod">Código do favorecido (Conexos)</Label>
              <Input id="pedido-pescod" value={pesCod} onChange={(e) => setPesCod(e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pedido-credor">Nome (opcional)</Label>
              <Input id="pedido-credor" value={credor} onChange={(e) => setCredor(e.target.value)} autoComplete="off" />
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Forma de pagamento</legend>
              <div className="flex gap-4">
                {(['TED', 'PIX'] as const).map((m) => (
                  <label key={m} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="pedido-modalidade"
                      value={m}
                      checked={modalidade === m}
                      onChange={() => setModalidade(m)}
                    />
                    {m}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="pedido-filial">Filial para ler o cadastro</Label>
              <Input
                id="pedido-filial"
                inputMode="numeric"
                value={filCod}
                onChange={(e) => setFilCod(e.target.value)}
                aria-describedby="pedido-filial-ajuda"
              />
              <p id="pedido-filial-ajuda" className="text-xs text-muted-foreground">
                O cadastro do favorecido é o mesmo em todas as filiais; a filial só é usada para lê-lo.
              </p>
            </div>
            {erro ? (
              <p role="alert" className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground">
                {erro}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
              Voltar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? <Spinner aria-hidden /> : null}
              Pedir autorização
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
