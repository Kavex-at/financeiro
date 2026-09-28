'use client'

import Link from 'next/link'
import { Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePermissoes } from '@/lib/auth/PermissoesProvider'
import { PERMISSAO } from '@/lib/permissoes'

/**
 * Card do Painel de Operação na home.
 *
 * Só aparece para quem tem `operacao:ver` (ADR-0053, que aposentou o allow-list por env da
 * ADR-0042). Como em `AdminHomeCard`, **o gate real é server-side**: as rotas `/operacao`
 * respondem 404 para quem não tem a permissão. Esconder o card é ergonomia — a tela é de quem
 * opera a plataforma, não do analista financeiro.
 *
 * Falha fechada na dúvida: enquanto as permissões carregam, ou se a consulta falhar, o card não
 * aparece. Um card que some é irritante; um card que aparece e leva a um 404 parece defeito.
 */
export function OperacaoHomeCard() {
  const { carregando, tem } = usePermissoes()
  if (carregando || !tem(PERMISSAO.OPERACAO_VER)) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4" aria-hidden /> Operação
        </CardTitle>
        <CardDescription>
          Saúde dos pipelines, alertas abertos e diagnóstico de configuração. É a tela que se abre
          durante um incidente — não depende do ERP.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href="/operacao">Abrir Painel de Operação</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
