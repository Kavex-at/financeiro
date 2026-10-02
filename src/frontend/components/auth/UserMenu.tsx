'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, KeyRound, LogOut, UserRound } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/lib/auth/AuthProvider'
import { usePermissoes } from '@/lib/auth/PermissoesProvider'

/**
 * Menu de avatar do header (ADR-0058): identidade do usuário, "Meu perfil", "Alterar senha" e
 * "Sair". Não renderiza nada sem sessão (`/login`) nem em dev-bypass (não há sessão para encerrar).
 *
 * O papel vem de `usePermissoes().papel` — a mesma consulta de `/me/permissoes` que o resto da tela
 * já faz, sem chamada nova. Enquanto carrega, ou se falhou, mostra só o username.
 *
 * O gatilho (avatar + chevron) tem 40px de altura (alvo de toque) e aparece em qualquer largura; o
 * menu abre alinhado à direita.
 */
export function UserMenu() {
  const { username, devBypass, signOut } = useAuth()
  const { papel } = usePermissoes()
  const router = useRouter()

  if (devBypass || !username) {
    return null
  }

  function handleSignOut() {
    signOut()
    router.replace('/login')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Menu da conta de ${username}`}
        data-testid="user-menu"
        className="group inline-flex h-10 items-center gap-1 rounded-full pr-1.5 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=open]:bg-accent"
      >
        <Avatar username={username} />
        <ChevronDown
          aria-hidden
          className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{username}</span>
          {papel ? (
            <span className="truncate text-xs font-normal text-muted-foreground">{papel.nome}</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/perfil">
            <UserRound aria-hidden />
            Meu perfil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/perfil#senha">
            <KeyRound aria-hidden />
            Alterar senha
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSignOut} data-testid="signout-button">
          <LogOut aria-hidden />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
