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
import { Spinner } from '@/components/ui/spinner'
import {
  AutorizacaoApiError,
  aprovarAutorizacao,
  type DestinoAtual,
  type FavorecidoAutorizado,
  pedirAutorizacao,
  reconferirAutorizacao,
} from '@/lib/sispag'
import { mesmaPessoa, reaprovacaoSemPedido } from './formatar'
import { RevelarDestinoButton } from './RevelarDestinoButton'

const AVISO_TEXTO: Record<string, string> = {
  PIX_CHAVE_NAO_E_DOCUMENTO_DO_FAVORECIDO:
    'A chave PIX não é o CPF/CNPJ do favorecido: confira se ela é mesmo dele antes de aprovar.',
}

/**
 * Aprovar (F2/F6). Ao abrir, lê o destino ATUAL do cadastro do Conexos (reconferir) e mostra
 * antes × agora, mascarados; a aprovação devolve a impressão do que foi mostrado (anti-TOCTOU).
 * Se o destino mudar no meio, o backend recusa (409): a tela relê e explica. Reaprovação aberta
 * pelo sistema precisa antes que alguém com `sispag:executar` confirme o pedido.
 */
export function DecidirAutorizacaoDialog({
  autorizacao: inicial,
  usuario,
  podeAprovar,
  podeConfirmarPedido,
  podeRevelar,
  onOpenChange,
  onAprovada,
  onAtualizada,
}: {
  autorizacao: FavorecidoAutorizado
  usuario: string | null
  podeAprovar: boolean
  podeConfirmarPedido: boolean
  podeRevelar: boolean
  onOpenChange: (open: boolean) => void
  onAprovada: (a: FavorecidoAutorizado) => void
  onAtualizada: (a: FavorecidoAutorizado) => void
}) {
  const [autorizacao, setAutorizacao] = React.useState(inicial)
  const [atual, setAtual] = React.useState<DestinoAtual | null>(null)
  const [lendo, setLendo] = React.useState(true)
  const [salvando, setSalvando] = React.useState(false)
  const [aviso, setAviso] = React.useState<string | null>(null)
  const [erro, setErro] = React.useState<string | null>(null)

  const ler = React.useCallback(async () => {
    setLendo(true)
    setErro(null)
    try {
      const r = await reconferirAutorizacao(inicial.id)
      setAutorizacao(r.autorizacao)
      setAtual(r.atual)
      onAtualizada(r.autorizacao)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler o cadastro do Conexos.')
    } finally {
      setLendo(false)
    }
  }, [inicial.id, onAtualizada])

  React.useEffect(() => {
    void ler()
  }, [ler])

  const semPedido = reaprovacaoSemPedido(autorizacao)
  const ehSolicitante = mesmaPessoa(usuario, autorizacao.solicitadoPor)
  const fingerprint = atual?.resultado === 'OK' ? atual.fingerprint : undefined
  const bloqueioAprovar = semPedido
    ? 'O destino mudou no cadastro: alguém com permissão de executar pagamentos precisa confirmar o pedido antes.'
    : ehSolicitante
      ? 'Quem pediu a autorização não pode aprová-la: peça a outra pessoa.'
      : !fingerprint
        ? 'Sem destino lido do Conexos, não há o que aprovar.'
        : null

  async function aprovar() {
    if (!fingerprint || salvando) return
    setSalvando(true)
    setErro(null)
    setAviso(null)
    try {
      onAprovada(
        await aprovarAutorizacao(autorizacao.id, {
          versao: autorizacao.versao,
          fingerprintMostrado: fingerprint,
        }),
      )
    } catch (e) {
      if (e instanceof AutorizacaoApiError && e.code === 'AUTORIZACAO_DESTINO_MUDOU') {
        setAviso(
          'O destino mudou no cadastro do Conexos enquanto a tela estava aberta. Ela foi atualizada: confira de novo antes de aprovar.',
        )
        await ler()
      } else {
        setErro(e instanceof Error ? e.message : 'Não foi possível aprovar.')
      }
    } finally {
      setSalvando(false)
    }
  }

  async function confirmarPedido() {
    setSalvando(true)
    setErro(null)
    try {
      const a = await pedirAutorizacao({
        pesCod: autorizacao.pesCod,
        ...(autorizacao.credor ? { credor: autorizacao.credor } : {}),
        modalidade: autorizacao.modalidade,
        origem: 'MANUAL',
        filCod: autorizacao.filCodLeitura,
      })
      setAutorizacao(a)
      onAtualizada(a)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível confirmar o pedido.')
    } finally {
      setSalvando(false)
    }
  }

  const nome = autorizacao.credor ?? `favorecido ${autorizacao.pesCod}`
  const antes =
    autorizacao.estado === 'REAPROVACAO_PENDENTE' ? autorizacao.destinoMascarado : undefined

  return (
    <Dialog open onOpenChange={(aberto) => { if (!salvando) onOpenChange(aberto) }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>
            {autorizacao.estado === 'REAPROVACAO_PENDENTE' ? 'Reaprovar' : 'Aprovar'} {autorizacao.modalidade} para {nome}
          </DialogTitle>
          <DialogDescription>
            Confira a conta ou a chave PIX que o cadastro do Conexos tem agora. Aprovado, o
            favorecido só recebe nesse destino; se o cadastro mudar, os pagamentos param até uma
            nova aprovação.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {lendo ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner aria-hidden /> Lendo o cadastro do Conexos…
            </p>
          ) : (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
              {antes ? (
                <>
                  <dt className="text-muted-foreground">Antes (aprovado)</dt>
                  <dd className="tabular-nums">{antes}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">{antes ? 'Agora (Conexos)' : 'Destino no Conexos'}</dt>
              <dd className="tabular-nums">
                {atual?.resultado === 'OK'
                  ? atual.destinoMascarado
                  : atual?.resultado === 'SEM_DADO'
                    ? 'sem conta/chave no cadastro — pedir ao responsável pelo cadastro do Conexos'
                    : 'não foi possível ler o Conexos'}
                {podeRevelar && atual?.resultado === 'OK' ? (
                  <span className="mt-1 block">
                    <RevelarDestinoButton autorizacaoId={autorizacao.id} rotulo={nome} />
                  </span>
                ) : null}
              </dd>
              <dt className="text-muted-foreground">Pedido por</dt>
              <dd>{autorizacao.solicitadoPor ?? 'ninguém ainda (aberto pelo sistema)'}</dd>
            </dl>
          )}
          {(atual?.avisos ?? []).map((a) => (
            <p key={a} className="rounded-lg border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning-foreground">
              {AVISO_TEXTO[a] ?? a}
            </p>
          ))}
          {aviso ? (
            <p role="status" className="rounded-lg border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning-foreground">
              {aviso}
            </p>
          ) : null}
          {erro ? (
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground">
              {erro}
            </p>
          ) : null}
          {bloqueioAprovar && !lendo ? (
            <p id="bloqueio-aprovar" className="text-xs text-muted-foreground">
              {bloqueioAprovar}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
            Voltar
          </Button>
          {semPedido && podeConfirmarPedido ? (
            <Button type="button" variant="outline" onClick={() => void confirmarPedido()} disabled={salvando || lendo}>
              Confirmar pedido
            </Button>
          ) : null}
          {podeAprovar ? (
            <Button
              type="button"
              onClick={() => void aprovar()}
              disabled={salvando || lendo || bloqueioAprovar !== null}
              aria-describedby={bloqueioAprovar ? 'bloqueio-aprovar' : undefined}
            >
              {salvando ? <Spinner aria-hidden /> : null}
              Aprovar
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
