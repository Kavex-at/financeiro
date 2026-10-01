'use client'

import type * as React from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { Perfil } from '@/lib/api/perfil'
import { usePermissoes } from '@/lib/auth/PermissoesProvider'
import { PERMISSAO } from '@/lib/permissoes'
import { diaSp } from './periodo'
import { ErroSecao, SecaoPerfil } from './SecaoPerfil'

export interface EstadoPerfil {
  carregando: boolean
  erro: string | null
  perfil: Perfil | null
}

/**
 * Identidade: quem eu sou para a plataforma. Só leitura, para todo papel (U2 — sem autoescalada):
 * mudanças de e-mail, papel ou vínculo continuam em `/usuarios`, e o link só aparece para quem
 * tem `usuarios:gerenciar`.
 */
export function IdentidadeSection({
  estado,
  onTentar,
}: {
  estado: EstadoPerfil
  onTentar: () => void
}) {
  const { tem } = usePermissoes()
  const gerencia = tem(PERMISSAO.USUARIOS_GERENCIAR)

  return (
    <SecaoPerfil
      idTitulo="perfil-identidade"
      titulo="Identidade"
      descricao="Como a plataforma e o Conexos identificam você."
      acoes={
        gerencia ? (
          <Link href="/usuarios" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Gerenciar usuários
          </Link>
        ) : null
      }
    >
      {estado.carregando ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} data-testid="skeleton" className="h-10" />
          ))}
        </div>
      ) : estado.erro || !estado.perfil ? (
        <ErroSecao mensagem={estado.erro ?? 'Não foi possível carregar seu perfil.'} onTentar={onTentar} />
      ) : (
        <Conteudo perfil={estado.perfil} />
      )}
    </SecaoPerfil>
  )
}

function Conteudo({ perfil }: { perfil: Perfil }) {
  return (
    <div className="space-y-4">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Campo rotulo="Usuário">
          <span data-campo="username" className="font-medium">
            {perfil.username}
          </span>
        </Campo>
        <Campo rotulo="E-mail">
          {perfil.email ?? <span className="text-muted-foreground">não cadastrado</span>}
        </Campo>
        <Campo rotulo="Papel">
          <Badge variant="secondary">{perfil.papel.nome}</Badge>
        </Campo>
        <Campo rotulo="Membro desde">
          {diaSp(perfil.membroDesde)}
          {perfil.criadoPor ? (
            <span className="text-muted-foreground"> · criado por {perfil.criadoPor}</span>
          ) : null}
        </Campo>
        <Campo rotulo="Vínculo Conexos">
          {perfil.conexos.vinculado && perfil.conexos.conexosUsername ? (
            <span className="font-mono">{perfil.conexos.conexosUsername}</span>
          ) : (
            <span className="text-muted-foreground">sem vínculo</span>
          )}
        </Campo>
      </dl>
      {!perfil.conexos.vinculado ? (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-sm text-warning-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          Sem vínculo com o Conexos: suas execuções saem no ERP como robô CLONEX. Elas continuam
          registradas no seu nome aqui na plataforma. Para assinar no ERP com o seu login, peça a um
          administrador para cadastrar o vínculo.
        </p>
      ) : null}
    </div>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd>{children}</dd>
    </div>
  )
}
