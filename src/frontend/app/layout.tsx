import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import { Toaster } from 'sonner'
import { AppShell } from '@/components/AppShell'
import { SessionExpiredModal } from '@/components/auth/SessionExpiredModal'
import { AuthProvider } from '@/lib/auth/AuthProvider'
import { resolveSiteUrl } from '@/lib/site-url'
import pkg from '../package.json'
import './globals.css'

const dmSans = DM_Sans({ subsets: ['latin'] })

const APP_VERSION = pkg.version

const TITLE = `Financeiro · v${APP_VERSION}`
const DESCRIPTION = 'Plataforma financeira — Columbia Trading'

/**
 * `metadataBase` não é decoração: sem ele o Next emite `og:image` relativo e Teams, Outlook e
 * Slack simplesmente descartam a imagem — o card sai com texto e placeholder cinza. O bloco
 * `openGraph`/`twitter` abaixo é explícito pelo mesmo motivo: antes o crawler só encontrava
 * `<title>` e `<meta name="description">`, e tinha de adivinhar o resto.
 *
 * As imagens em si vêm das convenções de arquivo vizinhas (`icon.svg`, `apple-icon.tsx`,
 * `opengraph-image.tsx`) — o Next as injeta aqui automaticamente, não se declaram à mão.
 */
export const metadata: Metadata = {
  metadataBase: resolveSiteUrl(),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'Columbia Trading Financeiro',
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Columbia Trading · Financeiro',
    title: TITLE,
    description: DESCRIPTION,
    locale: 'pt_BR',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${dmSans.className} antialiased min-h-screen`}>
        <AuthProvider>
          <AppShell version={APP_VERSION}>{children}</AppShell>
          <SessionExpiredModal />
          <Toaster position="bottom-right" richColors />
        </AuthProvider>
      </body>
    </html>
  )
}
