'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import * as React from 'react'
import { ExigePermissao } from '@/components/auth/ExigePermissao'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/lib/auth/AuthProvider'
import { usePermissoes } from '@/lib/auth/PermissoesProvider'
import { PERMISSAO } from '@/lib/permissoes'
import { getRecursos, type RecursosSispag } from '@/lib/sispag'
import { AutorizacoesTab } from './components/AutorizacoesTab'
import { CandidatosTab } from './components/CandidatosTab'
import type { PedidoInicial } from './components/SolicitarAutorizacaoDialog'

/**
 * Favorecidos autorizados (ADR-0065) — quem pode receber TED/PIX e em qual destino do cadastro do
 * Conexos, aprovado por duas pessoas. Aba "Autorizações" (lista, pedir, decidir, reconferir,
 * revelar) e aba "Candidatos" (relatório read-only para montar a lista inicial). Ver é
 * `sispag:ver`; o servidor é quem autoriza cada ação.
 */
export default function FavorecidosAutorizadosPage() {
  return (
    <ExigePermissao permissao={PERMISSAO.SISPAG_VER}>
      <React.Suspense fallback={null}>
        <Conteudo />
      </React.Suspense>
    </ExigePermissao>
  )
}

/** `?pedir=1&pesCod=&modalidade=&filCod=&credor=` — atalho do item do lote. */
const lerPedido = (q: URLSearchParams | null): PedidoInicial | undefined => {
  if (!q || q.get('pedir') !== '1') return undefined
  const modalidade = q.get('modalidade')
  const filCod = Number(q.get('filCod'))
  return {
    ...(q.get('pesCod') ? { pesCod: String(q.get('pesCod')) } : {}),
    ...(q.get('credor') ? { credor: String(q.get('credor')) } : {}),
    ...(modalidade === 'TED' || modalidade === 'PIX' ? { modalidade } : {}),
    ...(Number.isInteger(filCod) && filCod > 0 ? { filCod } : {}),
  }
}

function Conteudo() {
  const { username } = useAuth()
  const { tem } = usePermissoes()
  const busca = useSearchParams()
  const [recursos, setRecursos] = React.useState<RecursosSispag | null>(null)
  const pedidoInicial = React.useMemo(() => lerPedido(busca), [busca])

  React.useEffect(() => {
    let vivo = true
    void getRecursos().then((r) => {
      if (vivo) setRecursos(r)
    })
    return () => {
      vivo = false
    }
  }, [])

  const permissoes = {
    executar: tem(PERMISSAO.SISPAG_EXECUTAR),
    autorizar: tem(PERMISSAO.SISPAG_AUTORIZAR_FAVORECIDO),
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Favorecidos autorizados"
        subtitle="TED e PIX só saem para favorecido autorizado, no destino do cadastro do Conexos aprovado por outra pessoa. Se o cadastro mudar, os pagamentos param até uma nova aprovação."
        actions={
          <Button variant="outline" asChild>
            <Link href="/sispag">Voltar ao SISPAG</Link>
          </Button>
        }
      />
      {recursos && !recursos.favorecidoAutorizadoEnabled ? (
        <p role="status" className="rounded-lg border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning-foreground">
          O controle de favorecidos autorizados ainda não está ligado: TED e PIX não são oferecidos
          nos lotes. A lista já pode ser montada e aprovada.
        </p>
      ) : null}
      <Tabs defaultValue="autorizacoes">
        <TabsList aria-label="Seções de favorecidos autorizados">
          <TabsTrigger value="autorizacoes">Autorizações</TabsTrigger>
          <TabsTrigger value="candidatos">Candidatos</TabsTrigger>
        </TabsList>
        <TabsContent value="autorizacoes">
          <AutorizacoesTab
            usuario={username}
            permissoes={permissoes}
            {...(pedidoInicial ? { pedidoInicial } : {})}
          />
        </TabsContent>
        <TabsContent value="candidatos">
          <CandidatosTab podePedir={permissoes.executar} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
