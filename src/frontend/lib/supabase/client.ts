'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSupabasePublicEnv } from './env'

let browserClient: SupabaseClient | undefined

/**
 * Cliente do Supabase para o **browser** (Client Components).
 *
 * Memoizado por módulo de propósito: cada `createBrowserClient` instala seus próprios
 * listeners de `onAuthStateChange` e seu próprio timer de auto-refresh. Criar um por render
 * multiplicaria os refreshes silenciosamente — e o sintoma seria rate-limit no provedor, não
 * um erro que aponte para a causa.
 */
export const getSupabaseBrowserClient = (): SupabaseClient => {
  if (browserClient) return browserClient
  const { url, anonKey } = readSupabasePublicEnv()
  browserClient = createBrowserClient(url, anonKey)
  return browserClient
}
