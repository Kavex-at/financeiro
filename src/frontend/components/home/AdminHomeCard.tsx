'use client'

import Link from 'next/link'
import { Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useIsAdmin } from '@/lib/auth/AuthProvider'

/**
 * Card de administração na home (root da plataforma) — gerenciamento de usuários.
 * É um recurso de PLATAFORMA, não de um produto específico, então mora na home
 * e não no header dentro dos produtos. Só admins veem (o gate real é server-side).
 */
export function AdminHomeCard() {
  const isAdmin = useIsAdmin()
  if (!isAdmin) return null

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
