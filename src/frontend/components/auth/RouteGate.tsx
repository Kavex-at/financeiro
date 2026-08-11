'use client'

import { usePathname } from 'next/navigation'
import { isPublicRoute } from '@/lib/supabase/routes'
import { AuthGuard } from './AuthGuard'

/**
 * Applies the `<AuthGuard>` to every route except the explicitly public ones.
 * Mounted once in the root layout so all current and future app pages
 * (`/` and every domain route) are protected by default.
 *
 * A lista de rotas públicas vive em `lib/supabase/routes.ts` e é **a mesma** que o
 * `middleware.ts` consome. Manter duas listas seria manter duas listas que divergem em
 * silêncio — e a divergência não daria erro: daria um loop de redirect para exatamente a
 * tela que o usuário deslogado precisa alcançar (a recuperação de senha).
 *
 * Este gate **permanece** depois do `middleware.ts`: defesa em profundidade, não
 * substituição. O middleware fecha a janela pré-hidratação; este fecha a navegação
 * client-side.
 */
export function RouteGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (isPublicRoute(pathname)) {
    return <>{children}</>
  }

  return <AuthGuard>{children}</AuthGuard>
}
