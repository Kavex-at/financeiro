/**
 * A **fonte única** das rotas públicas.
 *
 * Elas são consumidas por três lugares que precisam concordar:
 * - `middleware.ts` (proteção server-side, antes da hidratação),
 * - `components/auth/RouteGate.tsx` (defesa em profundidade, client-side),
 * - `components/AppShell.tsx` (esconder o header da app autenticada).
 *
 * **Duas listas de rotas públicas divergem em silêncio** — e a divergência não produz erro:
 * produz um loop de redirect para exatamente a tela que o usuário deslogado precisa alcançar
 * (a recuperação de senha), ou uma tela de auth renderizada dentro da navegação da app
 * autenticada. Por isso a lista é uma constante compartilhada, e não uma convenção.
 */
export const PUBLIC_ROUTES = [
    /** Porta de entrada — precisa ser alcançável sem sessão, obviamente. */
    '/login',
    /**
     * Recuperação de senha (`/auth/forgot-password`, `/auth/reset-password`). Sem esta
     * entrada as telas novas nascem GATEADAS: quem esqueceu a senha é redirecionado para
     * `/login`, de onde clica em "esqueci minha senha" e é redirecionado de volta.
     */
    '/auth',
    /** Documentação de arquitetura, deliberadamente publicada sem sessão. */
    '/docs',
] as const;

const matches = (routes: readonly string[], pathname: string): boolean =>
    routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));

/** `true` quando o pathname é público (match exato ou prefixo de subrota). */
export const isPublicRoute = (pathname: string): boolean => matches(PUBLIC_ROUTES, pathname);

/**
 * Telas de **autenticação** — subconjunto PRÓPRIO das públicas, e a diferença é
 * deliberada: `/docs` é público mas **não** é tela de auth, então continua com o header
 * normal da app.
 *
 * O que estas têm em comum é serem página inteira, sem o chrome da app autenticada. Um
 * `/auth/forgot-password` renderizado dentro da navegação autenticada ofereceria ao visitante
 * sem sessão exatamente os links que ele não pode seguir.
 */
export const AUTH_SCREEN_ROUTES = ['/login', '/auth'] as const;

/** `true` quando o pathname é uma tela de autenticação (sem `AppShell`). */
export const isAuthScreen = (pathname: string): boolean =>
    matches(AUTH_SCREEN_ROUTES, pathname);
