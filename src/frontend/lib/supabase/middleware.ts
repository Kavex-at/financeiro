import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { readSupabasePublicEnv } from './env'
import { isPublicRoute } from './routes'

/**
 * Renova a sessão a cada navegação e protege as rotas **server-side**.
 *
 * ## Por que renovar aqui, e não só no cliente
 *
 * Server Components não conseguem escrever cookies. Sem este passo, o refresh token rotaciona
 * no browser e o servidor continua lendo o cookie antigo — a sessão "expira" para o SSR
 * enquanto está perfeitamente viva no cliente. É o caminho recomendado do `@supabase/ssr`.
 *
 * ## Por que `getUser()` e não `getSession()`
 *
 * `getSession()` lê o cookie e confia nele. `getUser()` **valida o token contra o provedor**.
 * Num middleware que decide redirecionar ou não, confiar num cookie que o próprio cliente
 * pode escrever é a diferença entre uma checagem e um teatro.
 *
 * ## Defesa em profundidade, não substituição
 *
 * `RouteGate` e `AuthGuard` **permanecem**. Este middleware fecha a janela entre o HTML
 * chegar e o React hidratar — hoje a proteção é 100% pós-hidratação, então uma tela
 * autenticada chega a pintar antes do redirect.
 */
export const updateSession = async (request: NextRequest): Promise<NextResponse> => {
  let response = NextResponse.next({ request })

  const { url, anonKey } = readSupabasePublicEnv()
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // Esta chamada é o que dispara o refresh e a gravação dos cookies acima. NÃO remover
  // "porque o resultado não é usado no caminho público" — o efeito colateral É o objetivo.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !isPublicRoute(request.nextUrl.pathname)) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    redirectUrl.searchParams.set('returnTo', request.nextUrl.pathname)
    return NextResponse.redirect(redirectUrl)
  }

  return response
}
