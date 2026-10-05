'use client'

import { Plus } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { toast } from 'sonner'
import { ExigePermissao } from '@/components/auth/ExigePermissao'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/lib/auth/AuthProvider'
import { PERMISSAO } from '@/lib/permissoes'
import {
  ESTADOS_EXCECAO,
  type ExcecaoDestinoResumo,
  type ExcecaoEstado,
  getRecursos,
  listarExcecoes,
  type RecursosSispag,
} from '@/lib/sispag'
import { AprovarExcecaoDialog } from './components/AprovarExcecaoDialog'
import { CadastrarExcecaoDialog } from './components/CadastrarExcecaoDialog'
import { ExcecoesTable } from './components/ExcecoesTable'
import { RevogarExcecaoDialog } from './components/RevogarExcecaoDialog'

type Filtro = ExcecaoEstado | 'TODAS'

type Dialogo =
  | { tipo: 'cadastrar' }
  | { tipo: 'aprovar'; excecao: ExcecaoDestinoResumo }
  | { tipo: 'rejeitar' | 'revogar'; excecao: ExcecaoDestinoResumo }

/**
 * Exceções de destino de pagamento SISPAG (ADR-0060) — quem tem `sispag:excecao`. O cadastro do
 * Conexos é a fonte do destino; aqui se cadastra, aprova (por OUTRA pessoa), rejeita e revoga o
 * destino que difere dele. Com a flag desligada a página só explica. A autorização real é do
 * servidor: este guard é ergonomia.
 */
export default function ExcecoesDestinoPage() {
  return (
    <ExigePermissao permissao={PERMISSAO.SISPAG_EXCECAO}>
      <ExcecoesConteudo />
    </ExigePermissao>
  )
}

function ExcecoesConteudo() {
  const { username } = useAuth()
  const [recursos, setRecursos] = React.useState<RecursosSispag | null>(null)
  const [filtro, setFiltro] = React.useState<Filtro>('PENDENTE')
  const [excecoes, setExcecoes] = React.useState<ExcecaoDestinoResumo[]>([])
  const [carregando, setCarregando] = React.useState(true)
  const [erro, setErro] = React.useState<string | null>(null)
  const [dialogo, setDialogo] = React.useState<Dialogo | null>(null)

  React.useEffect(() => {
    let vivo = true
    void getRecursos().then((r) => {
      if (vivo) setRecursos(r)
    })
    return () => {
      vivo = false
    }
  }, [])

  const habilitada = recursos?.excecaoDestinoEnabled === true

  const carregar = React.useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      setExcecoes(await listarExcecoes(filtro === 'TODAS' ? {} : { estado: filtro }))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar as exceções.')
    } finally {
      setCarregando(false)
    }
  }, [filtro])

  React.useEffect(() => {
    if (habilitada) void carregar()
  }, [habilitada, carregar])

  const concluir = (mensagem: string) => {
    setDialogo(null)
    toast.success(mensagem)
    void carregar()
  }

  if (recursos && !habilitada) {
    return (
      <div className="space-y-6">
        <PageHeader title="Exceções de destino" />
        <EmptyState
          title="Exceção de destino não habilitada"
          description="Enquanto estiver desligada, o destino de TED e PIX vem só do cadastro do Conexos."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exceções de destino"
        subtitle="Conta ou chave de um favorecido que difere do cadastro do Conexos. Cada exceção precisa ser aprovada por outra pessoa; o cadastro do Conexos sempre vale primeiro."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/sispag">Voltar ao SISPAG</Link>
            </Button>
            <Button onClick={() => setDialogo({ tipo: 'cadastrar' })} disabled={!recursos}>
              <Plus className="size-4" aria-hidden />
              Cadastrar exceção
            </Button>
          </>
        }
      />

      <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
        {([{ value: 'TODAS', label: 'Todas' }, ...ESTADOS_EXCECAO] as const).map((o) => (
          <Button
            key={o.value}
            type="button"
            size="sm"
            variant={filtro === o.value ? 'default' : 'outline'}
            aria-pressed={filtro === o.value}
            onClick={() => setFiltro(o.value as Filtro)}
          >
            {o.label}
          </Button>
        ))}
      </div>

      {carregando ? (
        <div className="flex items-center justify-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : erro ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground"
        >
          {erro}
        </p>
      ) : excecoes.length === 0 ? (
        <EmptyState
          title="Nenhuma exceção neste filtro"
          description="Cadastre uma exceção quando o cadastro do Conexos não tiver conta ou chave ativa para o favorecido."
        />
      ) : (
        <ExcecoesTable
          excecoes={excecoes}
          usuario={username}
          podeAgir
          onAprovar={(excecao) => setDialogo({ tipo: 'aprovar', excecao })}
          onRejeitar={(excecao) => setDialogo({ tipo: 'rejeitar', excecao })}
          onRevogar={(excecao) => setDialogo({ tipo: 'revogar', excecao })}
        />
      )}

      {dialogo?.tipo === 'cadastrar' && recursos ? (
        <CadastrarExcecaoDialog
          tedEnabled={recursos.tedEnabled}
          pixEnabled={recursos.pixEnabled}
          onOpenChange={(open) => {
            if (!open) setDialogo(null)
          }}
          onCadastrada={() => concluir('Exceção cadastrada: aguarda a aprovação de outra pessoa')}
        />
      ) : null}
      {dialogo?.tipo === 'aprovar' ? (
        <AprovarExcecaoDialog
          excecao={dialogo.excecao}
          onOpenChange={(open) => {
            if (!open) setDialogo(null)
          }}
          onAprovada={() => concluir('Exceção aprovada')}
        />
      ) : null}
      {dialogo?.tipo === 'rejeitar' || dialogo?.tipo === 'revogar' ? (
        <RevogarExcecaoDialog
          excecao={dialogo.excecao}
          acao={dialogo.tipo}
          onOpenChange={(open) => {
            if (!open) setDialogo(null)
          }}
          onConcluida={() =>
            concluir(dialogo.tipo === 'rejeitar' ? 'Exceção rejeitada' : 'Exceção revogada')
          }
        />
      ) : null}
    </div>
  )
}
