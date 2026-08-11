/**
 * Qual provedor de identidade esta build usa — **o botão de rollback da Fase 2**
 * (ADR-0030 §6).
 *
 * ## Por que isto existe como código, e não como comentário
 *
 * A ADR e o `DEPLOY.md` prometem que voltar atrás no cutover é *"uma variável de ambiente na
 * Vercel, sem redeploy do backend"*. Enquanto ninguém lia a variável, a promessa era pior do
 * que ausente: virar a flag no painel não produzia erro nenhum, apenas **nada** — e a
 * descoberta aconteceria durante um incidente de login, que é o único momento em que ela
 * seria acionada. Uma escape-hatch que falha em silêncio é indistinguível de uma que
 * funciona, até a hora exata em que importa.
 *
 * ## O default é `supabase`
 *
 * O rollback é o desvio, não o caminho. Uma var ausente (ou escrita errado) cai no caminho
 * do provedor — que é o estado desejado depois do cutover — em vez de silenciosamente
 * devolver todo mundo ao esquema legado, que a Fase 3 vai desligar.
 *
 * ## Toda a fase legada morre junto
 *
 * Na Fase 4 este módulo é removido inteiro, junto do HS256, do `password_hash` e do
 * `AuthService` no backend.
 */

/** O provedor de identidade em vigor nesta build. */
export type AuthProviderMode = 'supabase' | 'legacy'

/**
 * Valor da `NEXT_PUBLIC_AUTH_PROVIDER`.
 *
 * O nome é referenciado como **literal** (`process.env.NEXT_PUBLIC_AUTH_PROVIDER`) porque é
 * assim que o Next substitui a expressão em tempo de build — indexar dinamicamente devolve
 * `undefined` no bundle do cliente, que é como uma flag vira ornamento.
 */
export const getAuthProvider = (): AuthProviderMode =>
  process.env.NEXT_PUBLIC_AUTH_PROVIDER === 'legacy' ? 'legacy' : 'supabase'

/**
 * `true` quando a build deve autenticar pelo login legado (`POST /auth/login` + JWT HS256 em
 * `localStorage`) em vez do GoTrue.
 *
 * Enquanto isto for `true` o app volta ao modelo antigo **inclusive nas suas limitações**:
 * sem refresh, sem rotação e sem revogação do lado do provedor. É um modo de emergência com
 * data de validade, não uma configuração suportada.
 */
export const isLegacyAuth = (): boolean => getAuthProvider() === 'legacy'
