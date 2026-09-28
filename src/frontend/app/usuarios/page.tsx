'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, KeyRound, Link2, Mail, ShieldCheck, Users } from 'lucide-react'
import { toast } from 'sonner'
import { ExigePermissao } from '@/components/auth/ExigePermissao'
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
import { useAuth } from '@/lib/auth/AuthProvider'
import { PERMISSAO, type Permissao } from '@/lib/permissoes'
import {
  type AppUser,
  fetchUsuarios,
  fetchUsuariosMeta,
  listarPapeis,
  type PapelComPermissoes,
  setUsuarioAtivo,
} from '@/lib/usuarios'
import { EditarAcessoDialog } from './EditarAcessoDialog'
import { EditarEmailDialog } from './EditarEmailDialog'
import { NovoUsuarioDialog } from './NovoUsuarioDialog'
import { ResetSenhaDialog } from './ResetSenhaDialog'
import { VinculoConexosDialog } from './VinculoConexosDialog'

/**
 * Gestão de usuários da plataforma (Fatia A) e do acesso deles (ADR-0053) — quem tem
 * `usuarios:gerenciar`. A autorização real é server-side (guard do router `/usuarios`); este guard
 * de página é só UX: sem a permissão, a página mostra "Você não tem acesso a esta área." e nem
 * busca a lista.
 */
export default function UsuariosPage() {
  return (
    <ExigePermissao permissao={PERMISSAO.USUARIOS_GERENCIAR}>
      <UsuariosPageConteudo />
    </ExigePermissao>
  )
}

function UsuariosPageConteudo() {
  const { username: eu } = useAuth()
  const [usuarios, setUsuarios] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [resetAlvo, setResetAlvo] = useState<AppUser | null>(null)
  const [vinculoAlvo, setVinculoAlvo] = useState<AppUser | null>(null)
  const [emailAlvo, setEmailAlvo] = useState<AppUser | null>(null)
  const [acessoAlvo, setAcessoAlvo] = useState<AppUser | null>(null)
  const [papeis, setPapeis] = useState<PapelComPermissoes[]>([])
  const [catalogo, setCatalogo] = useState<Permissao[]>([])
  const [vinculoDisponivel, setVinculoDisponivel] = useState(false)
  const [togglingId, setTogglingId] = useState<number | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [lista, meta, papeisECatalogo] = await Promise.all([
        fetchUsuarios(),
        fetchUsuariosMeta().catch(() => ({ vinculoDisponivel: false })),
        listarPapeis(),
      ])
      setUsuarios(lista)
      setVinculoDisponivel(meta.vinculoDisponivel)
      setPapeis(papeisECatalogo.papeis)
      setCatalogo(papeisECatalogo.catalogo)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao carregar usuários.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuários"
        subtitle="Cadastre e gerencie os acessos à plataforma e o e-mail de login de cada um."
        actions={
          <NovoUsuarioDialog
            onCreated={carregar}
            vinculoDisponivel={vinculoDisponivel}
            papeis={papeis}
          />
        }
      />

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner /> Carregando usuários…
        </div>
      ) : usuarios.length === 0 ? (
        <EmptyState
          icon={<Users className="size-8" aria-hidden />}
          title="Nenhum usuário"
          description="Cadastre o primeiro acesso pelo botão acima."
        />
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>E-mail</TableHead>
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
                      {u.email ? (
                        u.email
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-warning/40 bg-warning-subtle text-warning-foreground"
                        >
                          <AlertTriangle className="size-3" aria-hidden /> Pendente
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant="secondary">{u.papel?.nome ?? '—'}</Badge>
                        {u.excecoes && u.excecoes.length > 0 ? (
                          <Badge variant="outline" className="gap-1">
                            <ShieldCheck className="size-3" aria-hidden /> com exceções
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={u.ativo}
                          disabled={souEu || togglingId === u.id}
                          onCheckedChange={(v) => handleToggleAtivo(u, v)}
                          aria-label={`Acesso de ${u.username}`}
                        />
                        <span className="text-sm text-muted-foreground">
                          {u.ativo ? 'Ativo' : 'Inativo'}
                        </span>
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
                        <Button variant="ghost" size="sm" onClick={() => setAcessoAlvo(u)}>
                          <ShieldCheck className="size-4" aria-hidden /> Editar acesso
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEmailAlvo(u)}>
                          <Mail className="size-4" aria-hidden /> Editar e-mail
                        </Button>
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

      <EditarEmailDialog
        key={emailAlvo?.id ?? 'fechado'}
        alvo={emailAlvo}
        onClose={() => setEmailAlvo(null)}
        onSaved={carregar}
      />
      <EditarAcessoDialog
        key={`acesso-${acessoAlvo?.id ?? 'fechado'}`}
        alvo={acessoAlvo}
        papeis={papeis}
        catalogo={catalogo}
        souEu={acessoAlvo != null && eu != null && acessoAlvo.username === eu}
        onClose={() => setAcessoAlvo(null)}
        onSaved={carregar}
      />
      <ResetSenhaDialog alvo={resetAlvo} onClose={() => setResetAlvo(null)} />
      <VinculoConexosDialog
        alvo={vinculoAlvo}
        onClose={() => setVinculoAlvo(null)}
        onSaved={carregar}
      />
    </div>
  )
}
