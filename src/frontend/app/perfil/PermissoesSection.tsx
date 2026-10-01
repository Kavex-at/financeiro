'use client'

import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { PermissaoComOrigem } from '@/lib/api/perfil'
import { usePermissoes } from '@/lib/auth/PermissoesProvider'
import { MODULOS } from '@/lib/permissoes'
import type { EstadoPerfil } from './IdentidadeSection'
import { diaSp } from './periodo'
import { ErroSecao, SecaoPerfil, VerificacaoIndisponivel } from './SecaoPerfil'

/** "concedida por admin em 01/09/2026", "implicada por executar", … */
const descreverOrigem = (p: PermissaoComOrigem): string => {
  const quando = p.em ? ` em ${diaSp(p.em)}` : ''
  switch (p.origem) {
    case 'papel':
      return 'pelo papel'
    case 'concedida':
      return `concedida por ${p.por ?? '—'}${quando}`
    case 'revogada':
      return `revogada por ${p.por ?? '—'}${quando}`
    case 'implicada': {
      const acao = p.implicadaPor?.split(':')[1] ?? 'executar'
      return `implicada por ${acao}`
    }
  }
}

/**
 * O que eu posso fazer, agrupado por módulo, com a ORIGEM de cada permissão (papel, exceção
 * concedida, revogada ou implicada por executar). A lista vem do servidor (`GET /me`), calculada
 * pelo mesmo `EffectivePermissionCalculator` que autoriza as rotas.
 */
export function PermissoesSection({
  estado,
  onTentar,
}: {
  estado: EstadoPerfil
  onTentar: () => void
}) {
  const { falhou, recarregar } = usePermissoes()

  const recarregarTudo = () => {
    recarregar()
    onTentar()
  }

  return (
    <SecaoPerfil
      idTitulo="perfil-permissoes"
      titulo="Permissões"
      descricao="O que o seu papel e as exceções do seu usuário liberam."
    >
      {falhou ? (
        <VerificacaoIndisponivel onRecarregar={recarregarTudo} />
      ) : estado.carregando ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} data-testid="skeleton" className="h-8" />
          ))}
        </div>
      ) : estado.erro || !estado.perfil ? (
        <ErroSecao mensagem={estado.erro ?? 'Não foi possível carregar suas permissões.'} onTentar={onTentar} />
      ) : (
        <Lista permissoes={estado.perfil.permissoes} />
      )}
    </SecaoPerfil>
  )
}

function Lista({ permissoes }: { permissoes: PermissaoComOrigem[] }) {
  const porCodigo = new Map(permissoes.map((p) => [p.codigo, p]))
  const modulos = MODULOS.map((m) => ({
    nome: m.nome,
    itens: m.itens.flatMap((i) => {
      const p = porCodigo.get(i.permissao)
      return p ? [{ ...i, p }] : []
    }),
  })).filter((m) => m.itens.length > 0)

  if (modulos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Seu papel ainda não libera nenhum módulo. Fale com um administrador.
      </p>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {modulos.map((m) => (
        <div key={m.nome} className="space-y-2">
          <h3 className="text-sm font-semibold">{m.nome}</h3>
          <ul className="space-y-1.5">
            {m.itens.map(({ permissao, acao, p }) => (
              <li key={permissao} className="flex flex-wrap items-center gap-2 text-sm">
                <span className={p.efetiva ? undefined : 'text-muted-foreground line-through'}>
                  {acao}
                </span>
                <Badge
                  variant="outline"
                  className={
                    p.efetiva
                      ? 'border-transparent bg-success-subtle text-success-foreground'
                      : 'border-transparent bg-danger-subtle text-danger-foreground'
                  }
                >
                  {descreverOrigem(p)}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
