'use client'

import { useState } from 'react'
import { Mail } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { definirEmail, type AppUser } from '@/lib/usuarios'

const CAMPO_ID = 'editar-email'
const ERRO_ID = 'editar-email-erro'

/**
 * Dialog de edição do e-mail de login (ADR-0051). `alvo=null` fecha; setar um usuário abre.
 *
 * O `username` aparece só como contexto: é a identidade de auditoria e nenhuma tela o edita. Erro
 * do backend (409 colisão, 400 inválido) fica INLINE, embaixo do campo, com o diálogo aberto para
 * o admin corrigir (padrão de `docs/design-system/forms.md`); o toast é só para o sucesso.
 */
export function EditarEmailDialog({
  alvo,
  onClose,
  onSaved,
}: {
  alvo: AppUser | null
  onClose: () => void
  onSaved: () => void
}) {
  // Pré-preenche com o e-mail atual. A página remonta o diálogo a cada alvo (`key`), então o
  // estado nasce certo sem precisar de efeito de sincronização.
  const [email, setEmail] = useState(alvo?.email ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!alvo || saving) return
    setSaving(true)
    setErro(null)
    try {
      await definirEmail(alvo.id, email.trim())
      toast.success(`E-mail de ${alvo.username} atualizado.`)
      onClose()
      onSaved()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao salvar o e-mail.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={alvo != null}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Editar e-mail</DialogTitle>
            <DialogDescription>
              E-mail de login de <strong>{alvo?.username}</strong>. Ele passa a valer junto com o
              usuário atual, com a mesma senha.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-1.5">
              <Label htmlFor={CAMPO_ID}>E-mail da Columbia</Label>
              <Input
                id={CAMPO_ID}
                type="email"
                autoComplete="off"
                placeholder="nome@columbiabr.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (erro) setErro(null)
                }}
                aria-invalid={erro !== null}
                aria-describedby={erro ? ERRO_ID : undefined}
                required
              />
              {erro ? (
                <p id={ERRO_ID} role="alert" className="text-xs text-destructive">
                  {erro}
                </p>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner /> : <Mail className="size-4" aria-hidden />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
