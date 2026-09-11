/**
 * URL pública canônica do app.
 *
 * Existe por um motivo estreito: o Next só transforma `/opengraph-image` em URL absoluta se
 * `metadataBase` estiver definido, e Teams, Outlook e Slack **descartam** um `og:image` relativo.
 * Sem isto o card do link chega com título e descrição, mas com o placeholder cinza no lugar da
 * imagem — que é exatamente o sintoma que esta função resolve.
 *
 * Ordem de resolução: override explícito → domínio de produção que a Vercel injeta no build →
 * localhost (dev, onde o unfurl não é exercitado de qualquer forma).
 */
export function resolveSiteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit) return new URL(explicit)

  const vercelProductionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (vercelProductionHost) return new URL(`https://${vercelProductionHost}`)

  return new URL('http://localhost:3000')
}
