'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Link2, ShieldAlert, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth, useIsAdmin } from '@/lib/auth/AuthProvider'
import {
  type AppUser,
  fetchUsuarios,
  fetchUsuariosMeta,
  setUsuarioAtivo,
} from '@/lib/usuarios'
import { NovoUsuarioDialog } from './NovoUsuarioDialog'
import { ResetSenhaDialog } from './ResetSenhaDialog'
import { VinculoConexosDialog } from './VinculoConexosDialog'

/**
 * Rótulo do ciclo de vida do acesso.
 *
 * O `status` vem DERIVADO do backend (`GET /usuarios`, a partir de `ativo` +
 * `convite_pendente`) — a UI não o recalcula, para que não existam duas regras de derivação
 * que divergem. `convidado` usa o token `warning`: é um estado de espera, não um erro.
 */
function statusLabel(u: AppUser) {
  const status = u.status ?? (u.ativo ? 'ativo' : 'inativo')
  if (status === 'convidado') {
    return (
      <Badge
        variant="outline"
        className="border-warning/40 bg-warning-subtle text-warning-foreground"
        data-testid={`usuario-status-convidado-${u.id}`}
      >
        Convite pendente
      </Badge>
    )
  }
  return (
    <span className="text-sm text-muted-foreground" data-testid={`usuario-status-${u.id}`}>
      {status === 'ativo' ? 'Ativo' : 'Inativo'}
    </span>
  )
}

/**
 * Gestão de usuários da plataforma (Fatia A) — só admin. Substitui o cadastro
 * manual de usuários @kavex no banco. A autorização real é server-side
 * (`requireRole('admin')`); este guard client-side é só UX.
 */
export default function UsuariosPage() {
  const isAdmin = useIsAdmin()
  const { username: eu } = useAuth()
  const [usuarios, setUsuarios] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [resetAlvo, setResetAlvo] = useState<AppUser | null>(null)
  const [vinculoAlvo, setVinculoAlvo] = useState<AppUser | null>(null)
  const [vinculoDisponivel, setVinculoDisponivel] = useState(false)
  const [togglingId, setTogglingId] = useState<number | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [lista, meta] = await Promise.all([
        fetchUsuarios(),
        fetchUsuariosMeta().catch(() => ({ vinculoDisponivel: false })),
      ])
      setUsuarios(lista)
      setVinculoDisponivel(meta.vinculoDisponivel)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao carregar usuários.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void carregar()
  }, [isAdmin, carregar])

  async function handleToggleAtivo(u: AppUser, ativo: boolean) {
    setTogglingId(u.id)
    // Atualização otimista; reverte no erro.
    setUsuarios((prev) => prev.map((x) => (x.id === u.id ? { ...x, ativo } : x)))
    try {
      await setUsuarioAtivo(u.id, ativo)
      toast.success(`${u.username} ${ativo ? 'ativado' : 'desativado'}.`)
    } catch (err) {
      setUsuarios((prev) => prev.map((x) => (x.id === u.id ? { ...x, ativo: !ativo } : x)))
      toast.error(err instanceof Error ? err.message : 'Falha ao alterar o acesso.')
    } finally {
      setTogglingId(null)
    }
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Usuários" subtitle="Gestão de acessos da plataforma." />
        <EmptyState
          icon={<ShieldAlert className="size-8" aria-hidden />}
          title="Acesso restrito"
          description="Apenas administradores podem gerenciar usuários."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuários"
        subtitle="Cadastre e gerencie os acessos @kavex à plataforma."
        actions={<NovoUsuarioDialog onCreated={carregar} vinculoDisponivel={vinculoDisponivel} />}
      />

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner /> Carregando usuários…
        </div>
      ) : usuarios.length === 0 ? (
        <EmptyState
          icon={<Users className="size-8" aria-hidden />}
          title="Nenhum usuário"
          description="Cadastre o primeiro acesso @kavex pelo botão acima."
        />
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Acesso</TableHead>
                {vinculoDisponivel ? <TableHead>Conexos</TableHead> : null}
                <TableHead>Cadastrado por</TableHead>
                <TableHead>Em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usuarios.map((u) => {
                const souEu = eu != null && u.username === eu
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.username}
                      {souEu ? <span className="ml-2 text-xs text-muted-foreground">(você)</span> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                        {u.role === 'admin' ? 'Administrador' : 'Operador'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={u.ativo}
                          disabled={souEu || togglingId === u.id}
                          onCheckedChange={(v) => handleToggleAtivo(u, v)}
                          aria-label={`Acesso de ${u.username}`}
                        />
                        {/* `convidado` e `inativo` são os dois `ativo = false`. Mostrá-los
                            igual faria o admin oferecer "reenviar convite" a quem foi
                            desligado — e ler "acesso revogado" em quem nunca entrou. */}
                        {statusLabel(u)}
                      </div>
                    </TableCell>
                    {vinculoDisponivel ? (
                      <TableCell>
                        {u.conexosUsername ? (
                          <Badge variant="outline" className="font-mono">
                            {u.conexosUsername}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">Robô</span>
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-muted-foreground">{u.createdBy ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {vinculoDisponivel ? (
                          <Button variant="ghost" size="sm" onClick={() => setVinculoAlvo(u)}>
                            <Link2 className="size-4" aria-hidden /> Conexos
                          </Button>
                        ) : null}
                        <Button variant="ghost" size="sm" onClick={() => setResetAlvo(u)}>
                          <KeyRound className="size-4" aria-hidden /> Redefinir senha
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ResetSenhaDialog alvo={resetAlvo} onClose={() => setResetAlvo(null)} />
      <VinculoConexosDialog
        alvo={vinculoAlvo}
        onClose={() => setVinculoAlvo(null)}
        onSaved={carregar}
      />
    </div>
  )
}
