'use client'

import { Plus } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import {
  ESTADOS_AUTORIZACAO,
  type EstadoAutorizacao,
  type FavorecidoAutorizado,
  listarFavorecidosAutorizados,
  ROTULO_ESTADO_AUTORIZACAO,
  reconferirAutorizacao,
} from '@/lib/sispag'
import { AutorizacoesTable, type PermissoesTabela } from './AutorizacoesTable'
import { DecidirAutorizacaoDialog } from './DecidirAutorizacaoDialog'
import { type AcaoComMotivo, MotivoAutorizacaoDialog } from './MotivoAutorizacaoDialog'
import { type PedidoInicial, SolicitarAutorizacaoDialog } from './SolicitarAutorizacaoDialog'

type Filtro = EstadoAutorizacao | 'TODAS'

type Dialogo =
  | { tipo: 'pedir'; inicial?: PedidoInicial }
  | { tipo: 'decidir'; autorizacao: FavorecidoAutorizado }
  | { tipo: AcaoComMotivo; autorizacao: FavorecidoAutorizado }

/** Lista por estado + pedir, decidir, reconferir e revelar (ADR-0065). */
export function AutorizacoesTab({
  usuario,
  permissoes,
  pedidoInicial,
}: {
  usuario: string | null
  permissoes: PermissoesTabela
  /** Atalho vindo do item do lote (`?pedir=1&...`): abre o pedido já preenchido. */
  pedidoInicial?: PedidoInicial
}) {
  const [filtro, setFiltro] = React.useState<Filtro>('TODAS')
  const [lista, setLista] = React.useState<FavorecidoAutorizado[]>([])
  const [carregando, setCarregando] = React.useState(true)
  const [erro, setErro] = React.useState<string | null>(null)
  const [reconferindo, setReconferindo] = React.useState<string | null>(null)
  const [dialogo, setDialogo] = React.useState<Dialogo | null>(
    pedidoInicial && permissoes.executar ? { tipo: 'pedir', inicial: pedidoInicial } : null,
  )

  const carregar = React.useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      setLista(await listarFavorecidosAutorizados(filtro === 'TODAS' ? {} : { estado: filtro }))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar as autorizações.')
    } finally {
      setCarregando(false)
    }
  }, [filtro])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  const substituir = React.useCallback((a: FavorecidoAutorizado) => {
    setLista((atual) => atual.map((x) => (x.id === a.id ? a : x)))
  }, [])

  const concluir = (mensagem: string) => {
    setDialogo(null)
    toast.success(mensagem)
    void carregar()
  }

  async function reconferir(a: FavorecidoAutorizado) {
    setReconferindo(a.id)
    try {
      const r = await reconferirAutorizacao(a.id)
      substituir(r.autorizacao)
      if (r.autorizacao.estado === 'REAPROVACAO_PENDENTE' && a.estado === 'AUTORIZADO') {
        toast.warning('O destino mudou no cadastro do Conexos: a autorização precisa ser aprovada de novo.')
      } else {
        toast.success('Conferido com o Conexos')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível reconferir.')
    } finally {
      setReconferindo(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
          {(['TODAS', ...ESTADOS_AUTORIZACAO] as const).map((v) => (
            <Button
              key={v}
              type="button"
              size="sm"
              variant={filtro === v ? 'default' : 'outline'}
              aria-pressed={filtro === v}
              onClick={() => setFiltro(v)}
            >
              {v === 'TODAS' ? 'Todas' : ROTULO_ESTADO_AUTORIZACAO[v]}
            </Button>
          ))}
        </div>
        {permissoes.executar ? (
          <Button type="button" onClick={() => setDialogo({ tipo: 'pedir' })}>
            <Plus className="size-4" aria-hidden />
            Pedir autorização
          </Button>
        ) : null}
      </div>

      {carregando ? (
        <div className="flex items-center justify-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : erro ? (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground">
          {erro}
        </p>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhuma autorização neste filtro"
          description="Peça a autorização a partir do relatório de candidatos ou do item do lote."
        />
      ) : (
        <AutorizacoesTable
          autorizacoes={lista}
          usuario={usuario}
          permissoes={permissoes}
          reconferindo={reconferindo}
          onDecidir={(autorizacao) => setDialogo({ tipo: 'decidir', autorizacao })}
          onRejeitar={(autorizacao) => setDialogo({ tipo: 'rejeitar', autorizacao })}
          onRevogar={(autorizacao) => setDialogo({ tipo: 'revogar', autorizacao })}
          onReconferir={(a) => void reconferir(a)}
        />
      )}

      {dialogo?.tipo === 'pedir' ? (
        <SolicitarAutorizacaoDialog
          {...(dialogo.inicial ? { inicial: dialogo.inicial } : {})}
          origem={dialogo.inicial ? 'ITEM' : 'MANUAL'}
          onOpenChange={(open) => {
            if (!open) setDialogo(null)
          }}
          onSolicitada={() => concluir('Autorização pedida: aguarda a aprovação de outra pessoa')}
        />
      ) : null}
      {dialogo?.tipo === 'decidir' ? (
        <DecidirAutorizacaoDialog
          autorizacao={dialogo.autorizacao}
          usuario={usuario}
          podeAprovar={permissoes.autorizar}
          podeConfirmarPedido={permissoes.executar}
          podeRevelar={permissoes.autorizar}
          onOpenChange={(open) => {
            if (!open) setDialogo(null)
          }}
          onAtualizada={substituir}
          onAprovada={() => concluir('Favorecido autorizado')}
        />
      ) : null}
      {dialogo?.tipo === 'rejeitar' || dialogo?.tipo === 'revogar' ? (
        <MotivoAutorizacaoDialog
          autorizacao={dialogo.autorizacao}
          acao={dialogo.tipo}
          onOpenChange={(open) => {
            if (!open) setDialogo(null)
          }}
          onConcluida={() =>
            concluir(dialogo.tipo === 'rejeitar' ? 'Autorização rejeitada' : 'Autorização revogada')
          }
        />
      ) : null}
    </div>
  )
}
