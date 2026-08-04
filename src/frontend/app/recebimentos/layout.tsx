import type { Metadata } from 'next'

/**
 * Título da aba da rota `/recebimentos`. Precisa morar num layout (server
 * component): `page.tsx` é `'use client'` e o Next ignora `export const metadata`
 * em client components. Sem isto a aba herdaria o título do layout raiz
 * (`Financeiro · vX.Y.Z`).
 */
export const metadata: Metadata = {
  title: 'Gestão de Adiantamentos',
}

export default function RecebimentosLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
