import { type NextRequest, NextResponse } from 'next/server'
import { isLegacyAuth } from '@/lib/auth/provider'
import { updateSession } from '@/lib/supabase/middleware'

/**
 * Middleware do Next — roda a cada navegação: renova a sessão do Supabase e redireciona
 * para `/login` quem não tem sessão numa rota protegida, **antes da hidratação**.
 *
 * Antes desta feature não existia `middleware.ts` nenhum: toda a proteção era client-side,
 * pós-hidratação. `RouteGate`/`AuthGuard` continuam como defesa em profundidade.
 *
 * ## Sob o rollback (`NEXT_PUBLIC_AUTH_PROVIDER=legacy`) ele sai do caminho
 *
 * A sessão legada é um token em `localStorage` — invisível para o servidor **por
 * construção**. Manter a checagem ligada não degradaria: redirecionaria **todo mundo** para
 * `/login`, inclusive quem acabou de logar, em loop. E `updateSession` estouraria em
 * `MissingSupabaseEnvError` justamente quando o rollback foi acionado porque o Supabase é o
 * problema.
 *
 * A proteção não some — volta a ser a de antes do cutover: `RouteGate`/`AuthGuard` no
 * cliente, e o backend recusando toda request sem token válido.
 */
export const middleware = async (request: NextRequest) =>
  isLegacyAuth() ? NextResponse.next({ request }) : updateSession(request)

export const config = {
  matcher: [
    /**
     * Tudo, EXCETO os assets e os arquivos estáticos.
     *
     * Cada request que passa por aqui fala com o provedor (`getUser()`): deixar `_next/*`,
     * favicons e imagens entrarem no matcher multiplicaria essas chamadas por dezenas a cada
     * page load — o custo não apareceria como erro, apenas como lentidão e rate-limit.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)',
  ],
}
