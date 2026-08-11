import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { readSupabasePublicEnv } from './env'

/**
 * Cliente do Supabase para **Server Components / Route Handlers**.
 *
 * Cada invocação cria um cliente novo, amarrado ao `cookies()` **daquela** request — um
 * cliente compartilhado entre requests serviria a sessão de um usuário para outro.
 *
 * O `try/catch` do `setAll` não é preguiça: em Server Components o store de cookies é
 * somente-leitura, e o `@supabase/ssr` documenta esse padrão. A escrita real do cookie
 * acontece no `middleware.ts`, que é onde a sessão é renovada.
 */
export const getSupabaseServerClient = async (): Promise<SupabaseClient> => {
  const { url, anonKey } = readSupabasePublicEnv()
  const cookieStore = await cookies()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Component: store somente-leitura. O middleware faz o refresh e é ele
          // quem grava o cookie — engolir aqui é o contrato do @supabase/ssr, não um
          // erro escondido.
        }
      },
    },
  })
}
