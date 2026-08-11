'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { Eye, EyeOff, Lock, LogIn, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/lib/auth/AuthProvider'
import pkg from '../../package.json'

/**
 * Sign-in page. `signIn` agora fala com o Supabase GoTrue (`signInWithPassword`) em vez de
 * postar para `POST /auth/login` — mas a ASSINATURA não mudou, e por isso este formulário
 * mudou o mínimo possível.
 *
 * **A migração para `react-hook-form` + `zod` foi deliberadamente ADIADA** (follow-up P2).
 * Esta é a única porta de entrada durante um cutover cujo modo de falha declarado é lockout
 * geral: reescrevê-la no mesmo PR que troca o provedor de identidade removeria justamente a
 * peça que precisa continuar funcionando enquanto tudo em volta muda. (E as moléculas que
 * `docs/design-system/forms.md` exige — `FormField`, `PasswordInput` — ainda não existem.)
 *
 * Já-autenticados (ou dev-bypass) são mandados para `/`. Rota pública (fora do `RouteGate`);
 * o header da app fica escondido aqui (ver `AppShell`).
 */
function LoginForm() {
  const { signIn, token, devBypass, loading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = searchParams.get('returnTo') || '/'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (devBypass || token) {
      router.replace(returnTo)
    }
  }, [devBypass, token, router, returnTo])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(username, password)
      router.replace(returnTo)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao entrar.')
      setSubmitting(false)
    }
  }

  if (loading || devBypass || token) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-primary/10 via-background to-primary/5 p-4">
      {/* Blobs decorativos suaves no fundo. */}
      <div className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 size-72 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative w-full max-w-md">
        {/* Marca */}
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="h-7 w-2 rounded-sm bg-primary" />
          <div className="leading-tight">
            <div className="text-xl font-bold tracking-tight">Columbia Trading</div>
            <div className="text-sm text-muted-foreground">Financeiro</div>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-8 shadow-xl">
          <div className="mb-6 space-y-1 text-center">
            <h1 className="text-2xl font-bold tracking-tight">Acesse sua conta</h1>
            <p className="text-sm text-muted-foreground">
              Entre com suas credenciais para continuar
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium">
                E-mail
              </label>
              <div className="relative">
                {/* O identificador SEMPRE foi o e-mail (`app_user.username`); o provedor de
                    identidade agora torna isso explícito. O `type` continua `text` de
                    propósito: introduzir validação nova de formato no meio de um cutover
                    trocaria um problema de login por outro. */}
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="username"
                  className="pl-9"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="seu.email@columbia.com.br"
                  required
                  autoFocus
                  data-testid="login-username"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Senha
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="pl-9 pr-9"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                  data-testid="login-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  tabIndex={-1}
                  data-testid="login-password-toggle"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {error ? (
              <div
                className="rounded-lg border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger-foreground"
                data-testid="login-error"
                role="alert"
              >
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={submitting}
              data-testid="login-submit"
            >
              {submitting ? (
                <>
                  <Spinner className="size-4" /> Entrando…
                </>
              ) : (
                <>
                  <LogIn className="size-4" /> Entrar
                </>
              )}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm">
            <Link
              href="/auth/forgot-password"
              className="text-muted-foreground transition-colors hover:text-foreground"
              data-testid="login-forgot-password"
            >
              Esqueci minha senha
            </Link>
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Columbia Trading · Financeiro · v{pkg.version}
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Spinner className="size-6" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
