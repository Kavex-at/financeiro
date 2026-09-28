'use client'

import Link from 'next/link'
import { Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePermissoes } from '@/lib/auth/PermissoesProvider'
import { PERMISSAO } from '@/lib/permissoes'

/**
 * Card de administração na home (root da plataforma) — gerenciamento de usuários.
 * É um recurso de PLATAFORMA, não de um produto específico, então mora na home
 * e não no header dentro dos produtos. Só quem tem `usuarios:gerenciar` vê (ADR-0053; o gate real
 * é server-side).
 */
export function AdminHomeCard() {
  const { carregando, tem } = usePermissoes()
  if (carregando || !tem(PERMISSAO.USUARIOS_GERENCIAR)) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" aria-hidden /> Usuários
        </CardTitle>
        <CardDescription>
          Acessos à plataforma: cadastro, e-mail de login, papéis e vínculo do acesso Conexos de cada usuário.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href="/usuarios">Gerenciar usuários</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
