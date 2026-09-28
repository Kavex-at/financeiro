const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

/**
 * GET /auth/transicao — o banner de transição para e-mail está ligado? (ADR-0051)
 *
 * A rota é PÚBLICA (a tela de login não tem token), então usa `fetch` puro: nem
 * `withAuthHeaders`, nem `apiFetch`, que num 401 abriria o modal de sessão expirada numa tela
 * onde ninguém está logado.
 *
 * Falha FECHADA: erro de rede, status diferente de 200, JSON inválido ou `ativo` que não seja
 * boolean resultam em `false`. O banner é aviso, não funcionalidade; na dúvida, não aparece. Cobre
 * o 404 de um backend antigo na janela entre os deploys do front (Vercel) e do back (Render).
 */
export async function fetchTransicaoEmail(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/auth/transicao`, { cache: 'no-store' })
    if (res.status !== 200) return false
    const body: unknown = await res.json()
    if (typeof body !== 'object' || body === null) return false
    const ativo = (body as { ativo?: unknown }).ativo
    return typeof ativo === 'boolean' ? ativo : false
  } catch {
    return false
  }
}
