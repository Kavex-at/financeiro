'use client'

import Link from 'next/link'
import { ArrowLeftRight, Banknote, Landmark, Lock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { AdminHomeCard } from '@/components/home/AdminHomeCard'
import { OperacaoHomeCard } from '@/components/home/OperacaoHomeCard'
import { usePermissoes } from '@/lib/auth/PermissoesProvider'
import { isSispagEnabled } from '@/lib/features'
import { PERMISSAO } from '@/lib/permissoes'

/**
 * Home (`/`) — landing do Financeiro. Autenticada pelo `RouteGate` em
 * `app/layout.tsx`. Lista as frentes de domínio que o usuário pode ver (ADR-0053): cada card
 * aparece pela permissão `:ver` do módulo, e some — nunca desabilita — sem ela. Enquanto as
 * permissões carregam, nenhum card condicionado aparece (nada pisca).
 */
export default function HomePage() {
  const sispagOn = isSispagEnabled()
  const { carregando, tem } = usePermissoes()
  const podeVer = (p: Parameters<typeof tem>[0]) => !carregando && tem(p)
  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        subtitle="Automação assistida da área Financeira da Columbia Trading."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {podeVer(PERMISSAO.PERMUTAS_VER) ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowLeftRight className="size-4" aria-hidden /> Permutas
              </CardTitle>
              <CardDescription>
                Adiantamentos PROFORMA ↔ invoices: elegibilidade, casamento e baixa assistida (Frente I).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/permutas">Abrir Gestão de Permutas</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
        {podeVer(PERMISSAO.SISPAG_VER) ? (
          <Card className={sispagOn ? undefined : 'opacity-70'}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Banknote className="size-4" aria-hidden /> SISPAG — Pagamentos
                {sispagOn ? null : (
                  <Badge variant="secondary" className="ml-auto gap-1">
                    <Lock className="size-3" aria-hidden /> Indisponível
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Títulos a pagar: ingestão diária, painel e montagem do lote com finalização (Frente II).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sispagOn ? (
                <Button asChild>
                  <Link href="/sispag">Abrir Painel SISPAG</Link>
                </Button>
              ) : (
                <Button disabled aria-disabled>
                  <Lock className="size-4" aria-hidden /> Indisponível em produção
                </Button>
              )}
            </CardContent>
          </Card>
        ) : null}
        {podeVer(PERMISSAO.RECEBIMENTOS_VER) ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Landmark className="size-4" aria-hidden /> Gestão de Adiantamentos
              </CardTitle>
              <CardDescription>
                Conciliação de créditos bancários (Conexos): importação, matching e baixa assistida com NDe (Frente IV).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/recebimentos">Abrir Gestão de Adiantamentos</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
        <OperacaoHomeCard />
        <AdminHomeCard />
      </div>
    </div>
  )
}
