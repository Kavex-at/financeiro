'use client'

import { format } from 'date-fns'
import { LogIn } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/lib/auth/AuthProvider'

/**
 * Blocking modal shown when the 12h app JWT expires. It is non-dismissable
 * (no X, ESC and overlay-click are prevented) — the only way out is to log in
 * again, so the user never keeps operating against a dead (zombie) token.
 *
 * Copy is deliberately precise: it shows the EXACT expiry time and clarifies
 * that everything done BEFORE that time was saved normally — only the last
 * action (after expiry) was rejected and must be redone. A blanket "nothing
 * was saved" would wrongly suggest the whole session's work was lost.
 *
 * Mounted once in the root layout (inside `AuthProvider`). Renders nothing
 * until `sessionExpired` flips true.
 */
export function SessionExpiredModal() {
  const { sessionExpired, sessionExpiredAt, signOut, clearSessionExpired } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  if (!sessionExpired) return null

  const at = sessionExpiredAt ? format(new Date(sessionExpiredAt), 'dd/MM HH:mm') : null

  const handleRelogin = async () => {
    const returnTo = pathname || '/'
    // Aguarda a revogação no provedor antes de sair da tela (ver `UserMenu`).
    await signOut()
    clearSessionExpired()
    router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`)
  }

  return (
    <Dialog open={sessionExpired}>
      <DialogContent
        size="sm"
        showClose={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        data-testid="session-expired-modal"
      >
        <DialogHeader>
          <DialogTitle>Sua sessão expirou</DialogTitle>
          <DialogDescription>
            {at ? (
              <>
                Sua sessão expirou às <strong>{at}</strong>. Nada feito após esse horário foi salvo —
                entre novamente e refaça a última ação.
              </>
            ) : (
              <>
                Sua sessão expirou. Nada feito após a expiração foi salvo — entre novamente e refaça
                a última ação.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="py-2" />
        <DialogFooter>
          <Button onClick={handleRelogin} data-testid="session-expired-relogin">
            <LogIn className="size-4" /> Entrar novamente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
