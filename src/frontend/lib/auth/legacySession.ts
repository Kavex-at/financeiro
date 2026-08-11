'use client'

/**
 * Sessão do esquema **legado** — o JWT HS256 do `POST /auth/login` guardado em
 * `localStorage`.
 *
 * ## Isto é dívida deliberada, e é a única forma honesta de ter rollback
 *
 * Foi exatamente este mecanismo que o cutover eliminou: token sem refresh, sem rotação e
 * **sem revogação** — um token vazado vale as 12 h inteiras. Ele volta aqui **só** sob
 * `NEXT_PUBLIC_AUTH_PROVIDER=legacy`, porque um rollback que não restaura o comportamento
 * anterior não é um rollback. O caminho normal (`supabase`) nunca toca este módulo.
 *
 * Some na Fase 4 (ADR-0030 §6), junto do resto do esquema legado.
 */

/** Chave do token no `localStorage`. Mesma do esquema pré-cutover — sessões vivas sobrevivem ao toggle. */
const TOKEN_STORAGE_KEY = 'columbia.auth.token'

/** Chave do username. Existe para a UI ter o que mostrar sem decodificar o token. */
const USERNAME_STORAGE_KEY = 'columbia.auth.username'

/** Sessão legada persistida, ou `null` quando não há (ou o browser não está disponível). */
export interface LegacySession {
  token: string
  username: string
}

/** `localStorage` só existe no browser — no SSR e nos testes de servidor devolve `null`. */
const storage = (): Storage | null => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    // Modo privado / storage bloqueado por política: o app segue sem sessão persistida em
    // vez de estourar na renderização.
    return null
  }
}

/** Lê a sessão legada persistida. `null` quando ausente ou incompleta. */
export const readLegacySession = (): LegacySession | null => {
  const store = storage()
  if (!store) return null
  const token = store.getItem(TOKEN_STORAGE_KEY)
  const username = store.getItem(USERNAME_STORAGE_KEY)
  if (!token || !username) return null
  return { token, username }
}

/** Persiste a sessão legada após um login bem-sucedido. */
export const writeLegacySession = (session: LegacySession): void => {
  const store = storage()
  if (!store) return
  store.setItem(TOKEN_STORAGE_KEY, session.token)
  store.setItem(USERNAME_STORAGE_KEY, session.username)
}

/**
 * Apaga a sessão legada.
 *
 * **É tudo o que o logout legado consegue fazer** — o token continua válido no servidor até
 * o `exp`. A ausência de revogação real é a razão de existir do cutover; aqui ela é
 * restaurada junto com o resto do modo de emergência.
 */
export const clearLegacySession = (): void => {
  const store = storage()
  if (!store) return
  store.removeItem(TOKEN_STORAGE_KEY)
  store.removeItem(USERNAME_STORAGE_KEY)
}
