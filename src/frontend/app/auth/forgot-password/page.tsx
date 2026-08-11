'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowLeft, Mail, Send } from 'lucide-react'
import { toast } from 'sonner'
import { AuthInlineNotice, AuthScreen } from '@/app/auth/AuthScreen'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

/**
 * Solicitação de redefinição de senha (self-service). Rota **pública**.
 *
 * ## A mensagem é SEMPRE a mesma
 *
 * Exista ou não o e-mail, esteja o usuário ativo ou não, funcione o envio ou não: a tela
 * responde a mesma coisa. Um "e-mail não cadastrado" aqui **entrega a lista de funcionários
 * da Columbia** a qualquer pessoa na internet, um e-mail por vez — e é a primeira coisa que
 * um scanner automatizado tenta contra um formulário de recuperação.
 *
 * Espelha exatamente o anti-enumeração do backend (`POST /auth/forgot-password`).
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [enviado, setEnviado] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const redirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/auth/reset-password` : undefined
      await getSupabaseBrowserClient().auth.resetPasswordForEmail(email, { redirectTo })
    } catch {
      // Falha de rede/configuração NÃO muda a resposta visível — senão o próprio erro vira o
      // oráculo que o anti-enumeração existe para fechar. O diagnóstico fica no toast.
      toast.error('Não foi possível concluir agora. Tente novamente em instantes.')
    } finally {
      // `enviado` é setado SEMPRE, inclusive quando o e-mail não existe.
      setEnviado(true)
      setSubmitting(false)
    }
  }

  return (
    <AuthScreen
      title="Esqueceu sua senha?"
      description="Informe seu e-mail e enviaremos um link para você criar uma nova."
      footer={
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          data-testid="forgot-password-back"
        >
          <ArrowLeft className="size-4" aria-hidden /> Voltar para o login
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="forgot-email">E-mail</Label>
          <div className="relative">
            <Mail
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="forgot-email"
              type="email"
              className="pl-9"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="seu.email@columbia.com.br"
              required
              autoFocus
              data-testid="forgot-password-email"
            />
          </div>
        </div>

        {enviado ? (
          <AuthInlineNotice testId="forgot-password-sent">
            Se este e-mail estiver cadastrado, você receberá um link para redefinir a senha.
            Verifique também a caixa de spam.
          </AuthInlineNotice>
        ) : null}

        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={submitting}
          data-testid="forgot-password-submit"
        >
          {submitting ? (
            <>
              <Spinner className="size-4" /> Enviando…
            </>
          ) : (
            <>
              <Send className="size-4" aria-hidden /> Enviar link
            </>
          )}
        </Button>
      </form>
    </AuthScreen>
  )
}
