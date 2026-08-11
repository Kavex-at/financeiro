'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth/AuthProvider'

/**
 * Header user menu: shows the signed-in identity and a sign-out action.
 * Renders nothing when there is no session (e.g. on the `/login` page) and
 * in dev-bypass mode there is no real session to sign out of.
 */
export function UserMenu() {
  const { username, devBypass, signOut } = useAuth()
  const router = useRouter()

  if (devBypass || !username) {
    return null
  }

  // `signOut` virou async: ele REVOGA a sessão no provedor, não só limpa o estado local.
  // Redirecionar antes de a revogação completar deixaria o refresh token vivo — um logout
  // que não desloga.
  async function handleSignOut() {
    await signOut()
    router.replace('/login')
  }

  return (
    <div className="flex items-center gap-2" data-testid="user-menu">
      <span className="text-xs text-muted-foreground hidden sm:inline">{username}</span>
      <Button variant="ghost" size="sm" onClick={handleSignOut} data-testid="signout-button">
        <LogOut className="size-4" />
        Sair
      </Button>
    </div>
  )
}
