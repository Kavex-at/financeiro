'use client'

import { Spinner } from '@/components/ui/spinner'
import { usePermissoes } from '@/lib/auth/PermissoesProvider'
import type { Permissao } from '@/lib/permissoes'
import { AcessoNegado } from './AcessoNegado'

/**
 * Guard de página (ADR-0053). Sem a permissão, renderiza SÓ o `AcessoNegado` — os filhos nem
 * montam, então as chamadas de dados da página não saem. Enquanto as permissões carregam, mostra o
 * carregamento padrão (nunca o "sem acesso", para não piscar).
 *
 * É ergonomia: a API já recusa (403) quem não tem a permissão.
 */
export function ExigePermissao({
  permissao,
  children,
}: {
  permissao: Permissao
  children: React.ReactNode
}) {
  const { carregando, tem } = usePermissoes()

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="permissoes-carregando">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (!tem(permissao)) return <AcessoNegado />

  return <>{children}</>
}
