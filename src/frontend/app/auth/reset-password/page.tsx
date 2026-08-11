'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { ArrowLeft, Eye, EyeOff, KeyRound, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { AuthInlineError, AuthScreen } from '@/app/auth/AuthScreen'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

/** Estado do link de recuperação. `verificando` enquanto a sessão de recovery não resolve. */
type LinkState = 'verificando' | 'valido' | 'invalido'

/**
 * Conclusão da redefinição de senha, aberta pelo link do e-mail. Rota **pública**.
 *
 * O link de recuperação é de **uso único** e expira. Quando ele já foi usado (ou caducou) o
 * provedor simplesmente não abre sessão — e sem um estado de erro próprio a tela pareceria
 * funcionar e falharia só no submit, com uma mensagem que não explica nada. Por isso o
 * `linkState`.
 */
function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [linkState, setLinkState] = useState<LinkState>('verificando')
  const [senha, setSenha] = useState('')
  const [showSenha, setShowSenha] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const supabase = getSupabaseBrowserClient()

    const verify = async () => {
      const code = searchParams.get('code')
      const tokenHash = searchParams.get('token_hash')
      try {
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) throw exchangeError
        } else if (tokenHash) {
          const { error: otpError } = await supabase.auth.verifyOtp({
            type: 'recovery',
            token_hash: tokenHash,
          })
          if (otpError) throw otpError
        } else {
          // Sem parâmetro nenhum: o `@supabase/ssr` pode já ter trocado o código pela sessão.
          const {
            data: { session },
          } = await supabase.auth.getSession()
          if (!session) throw new Error('no recovery session')
        }
        if (active) setLinkState('valido')
      } catch {
        if (active) setLinkState('invalido')
      }
    }

    void verify()
    return () => {
      active = false
    }
  }, [searchParams])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      const { error: updateError } = await getSupabaseBrowserClient().auth.updateUser({
        password: senha,
      })
      if (updateError) throw updateError
      toast.success('Senha redefinida. Você já pode entrar.')
      router.replace('/login')
    } catch {
      setError('Não foi possível redefinir a senha. O link pode ter expirado.')
      setSubmitting(false)
    }
  }

  const backToLogin = (
    <Link
      href="/login"
      className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
      data-testid="reset-password-back"
    >
      <ArrowLeft className="size-4" aria-hidden /> Voltar para o login
    </Link>
  )

  if (linkState === 'verificando') {
    return (
      <AuthScreen title="Redefinir senha" description="Verificando o link…">
        <div className="flex justify-center py-4">
          <Spinner className="size-6" />
        </div>
      </AuthScreen>
    )
  }

  if (linkState === 'invalido') {
    return (
      <AuthScreen
        title="Link inválido ou expirado"
        description="Links de redefinição valem para um único uso."
        footer={backToLogin}
      >
        <div className="space-y-4">
          <AuthInlineError testId="reset-password-link-invalid">
            Este link já foi usado ou expirou. Solicite um novo para redefinir sua senha.
          </AuthInlineError>
          <Button asChild className="w-full" size="lg" data-testid="reset-password-request-new">
            <Link href="/auth/forgot-password">Solicitar um novo link</Link>
          </Button>
        </div>
      </AuthScreen>
    )
  }

  return (
    <AuthScreen
      title="Criar nova senha"
      description="Escolha uma senha com pelo menos 8 caracteres."
      footer={backToLogin}
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="reset-password-senha">Nova senha</Label>
          <div className="relative">
            <Lock
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="reset-password-senha"
              type={showSenha ? 'text' : 'password'}
              className="pl-9 pr-9"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              placeholder="••••••••"
              required
              autoFocus
              data-testid="reset-password-senha"
            />
            <button
              type="button"
              onClick={() => setShowSenha((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={showSenha ? 'Ocultar senha' : 'Mostrar senha'}
              tabIndex={-1}
              data-testid="reset-password-toggle"
            >
              {showSenha ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {error ? <AuthInlineError testId="reset-password-error">{error}</AuthInlineError> : null}

        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={submitting}
          data-testid="reset-password-submit"
        >
          {submitting ? (
            <>
              <Spinner className="size-4" /> Salvando…
            </>
          ) : (
            <>
              <KeyRound className="size-4" aria-hidden /> Redefinir senha
            </>
          )}
        </Button>
      </form>
    </AuthScreen>
  )
}

/**
 * `useSearchParams()` exige `<Suspense>` — sem ele o build do Next quebra (mesmo padrão de
 * `app/login/page.tsx`).
 */
export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Spinner className="size-6" />
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  )
}
