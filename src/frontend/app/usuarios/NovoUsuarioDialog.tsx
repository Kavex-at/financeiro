'use client'

import { useState } from 'react'
import { UserPlus } from 'lucide-react'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { criarUsuario, type UserRole } from '@/lib/usuarios'

/** Dialog de criação de usuário. Chama `onCreated` após sucesso p/ recarregar a lista. */
export function NovoUsuarioDialog({
  onCreated,
  vinculoDisponivel,
}: {
  onCreated: () => void
  vinculoDisponivel: boolean
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [role, setRole] = useState<UserRole>('operador')
  const [conexosUser, setConexosUser] = useState('')
  const [conexosSenha, setConexosSenha] = useState('')
  const [saving, setSaving] = useState(false)
  // Erro do backend (ex.: 409 "já identifica outro usuário") — inline, com o diálogo aberto.
  const [erro, setErro] = useState<string | null>(null)

  const reset = () => {
    setErro(null)
    setEmail('')
    setSenha('')
    setRole('operador')
    setConexosUser('')
    setConexosSenha('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setErro(null)
    try {
      const cxUser = conexosUser.trim()
      // O backend grava username = email (ADR-0051).
      const criado = await criarUsuario({
        email: email.trim(),
        password: senha,
        role,
        // Vínculo Conexos só vai se AMBOS forem preenchidos (login + senha).
        ...(vinculoDisponivel && cxUser && conexosSenha
          ? { conexosUsername: cxUser, conexosPassword: conexosSenha }
          : {}),
      })
      toast.success(`Usuário ${criado.username} criado.`)
      reset()
      setOpen(false)
      onCreated()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao criar usuário.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="size-4" aria-hidden /> Novo usuário
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Novo usuário</DialogTitle>
            <DialogDescription>
              Cadastre um acesso à plataforma. O e-mail é o login; a senha pode ser redefinida
              depois.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="novo-email">E-mail da Columbia</Label>
              <Input
                id="novo-email"
                type="email"
                autoComplete="off"
                placeholder="nome@columbiabr.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (erro) setErro(null)
                }}
                aria-invalid={erro !== null}
                aria-describedby={erro ? 'novo-email-erro' : undefined}
                required
              />
              {erro ? (
                <p id="novo-email-erro" role="alert" className="text-xs text-destructive">
                  {erro}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="novo-senha">Senha (mín. 8 caracteres)</Label>
              <Input
                id="novo-senha"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="novo-role">Papel</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger id="novo-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operador">Operador — opera Permutas e SISPAG</SelectItem>
                  <SelectItem value="admin">Administrador — também gerencia usuários</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {vinculoDisponivel ? (
              <div className="space-y-4 rounded-lg border bg-muted/30 p-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Acesso Conexos (opcional)</p>
                  <p className="text-xs text-muted-foreground">
                    Vincule o login do ERP para que as execuções saiam no nome deste usuário. Sem
                    vínculo, ele opera pelo robô.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="novo-cxuser">Login Conexos</Label>
                  <Input
                    id="novo-cxuser"
                    autoComplete="off"
                    placeholder="NOME_SOBRENOME"
                    value={conexosUser}
                    onChange={(e) => setConexosUser(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="novo-cxsenha">Senha Conexos</Label>
                  <Input
                    id="novo-cxsenha"
                    type="password"
                    autoComplete="new-password"
                    value={conexosSenha}
                    onChange={(e) => setConexosSenha(e.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner /> : <UserPlus className="size-4" aria-hidden />} Criar usuário
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
