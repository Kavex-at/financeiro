'use client'

import * as React from 'react'
import Link from 'next/link'
import { Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchPermissoes } from '@/lib/operacao'

/**
 * Card do Painel de Operação na home.
 *
 * Só aparece para os usuários do allow-list `OPERACAO_USUARIOS` — recorte por IDENTIDADE, não por
 * papel, porque `admin` hoje é todo mundo e portanto não recorta nada. Sem a env configurada, a
 * lista é vazia e todo admin vê (comportamento de hoje).
 *
 * Como em `AdminHomeCard`, **o gate real é server-side**: as rotas `/operacao` respondem 404 para
 * quem está fora. Esconder o card é ergonomia — a tela é de quem opera a plataforma, não do
 * analista financeiro, e poluir a home dele com ela não ajuda ninguém.
 *
 * Falha fechada na dúvida: se a consulta de permissão não responde, o card não aparece. Um card
 * que some é irritante; um card que aparece e leva a um 404 parece defeito.
 */
export function OperacaoHomeCard() {
  const [podeVer, setPodeVer] = React.useState(false)

  React.useEffect(() => {
    let vivo = true
    void fetchPermissoes()
      .then((p) => {
        if (vivo) setPodeVer(p.operacao)
      })
      .catch(() => {
        if (vivo) setPodeVer(false)
      })
    return () => {
      vivo = false
    }
  }, [])

  if (!podeVer) return null

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
