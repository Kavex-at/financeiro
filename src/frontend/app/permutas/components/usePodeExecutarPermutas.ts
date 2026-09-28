'use client'

import { usePermissoes } from '@/lib/auth/PermissoesProvider'
import { PERMISSAO } from '@/lib/permissoes'

/**
 * `true` quando o usuário pode AGIR em Permutas (`permutas:executar`, ADR-0053). Sem ela — ou
 * enquanto as permissões carregam — os botões de ação somem (nunca ficam desabilitados, R11); as
 * leituras continuam para quem só tem `permutas:ver`. O gate real é o servidor (403).
 */
export function usePodeExecutarPermutas(): boolean {
  const { carregando, tem } = usePermissoes()
  return !carregando && tem(PERMISSAO.PERMUTAS_EXECUTAR)
}
