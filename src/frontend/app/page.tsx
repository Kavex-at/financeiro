import Link from 'next/link'
import { ArrowLeftRight, Banknote, Landmark, Lock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { AdminHomeCard } from '@/components/home/AdminHomeCard'
import { isSispagEnabled } from '@/lib/features'

/**
 * Home (`/`) — landing do Financeiro. Autenticada pelo `RouteGate` em
 * `app/layout.tsx`. Lista as frentes de domínio disponíveis; a primeira
 * (Permutas — Frente I) já tem tela própria.
 */
export default function HomePage() {
  const sispagOn = isSispagEnabled()
  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        subtitle="Automação assistida da área Financeira da Columbia Trading."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        <AdminHomeCard />
      </div>
    </div>
  )
}
