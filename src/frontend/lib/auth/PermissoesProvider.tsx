'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  CATALOGO_PERMISSOES,
  fetchMinhasPermissoes,
  type MinhasPermissoes,
  PERMISSAO,
  type PapelRef,
  type Permissao,
} from '../permissoes'
import { useAuth, useRole } from './AuthProvider'

/**
 * O que o usuário logado pode, para ESCONDER nav, cards, páginas e botões (ADR-0053). Esconder é
 * ergonomia: o gate real é o guard de cada rota no servidor (I2). Regra do design system:
 * permissão ausente esconde, nunca desabilita (R11).
 */
export interface PermissoesContextValue {
  /** `true` até a primeira resposta de `/me/permissoes` desta sessão. Enquanto isso, `tem()` = false. */
  carregando: boolean
  tem: (permissao: Permissao) => boolean
  papel?: PapelRef
}

const PermissoesContext = createContext<PermissoesContextValue | undefined>(undefined)

const CATALOGO = new Set<Permissao>(CATALOGO_PERMISSOES)
const NENHUMA = new Set<Permissao>()

/** Resultado da consulta, amarrado ao token que a fez: token novo = consulta nova. */
interface Resposta {
  token: string
  dados: MinhasPermissoes | null
}

/**
 * D4 — janela de deploy: backend anterior à ADR-0053 responde só `{ operacao }`. O front cai no
 * comportamento de hoje (catálogo inteiro para `role = 'admin'`, e Operação conforme a chave). Sai
 * no tweak que remover a chave `operacao` de `/me/permissoes`.
 */
const permissoesLegadas = (role: string | null, operacao: boolean): Set<Permissao> => {
  const base =
    role === 'admin'
      ? new Set<Permissao>(CATALOGO_PERMISSOES.filter((p) => p !== PERMISSAO.OPERACAO_VER))
      : new Set<Permissao>()
  if (operacao) base.add(PERMISSAO.OPERACAO_VER)
  return base
}

/**
 * Busca `/me/permissoes` UMA vez por sessão, e de novo quando o token muda (login / troca de
 * usuário) — não a cada navegação. Mora no layout raiz, dentro do `AuthProvider`.
 *
 * - `DEV_AUTH_BYPASS` (D1): catálogo inteiro, sem consulta (o backend faz o mesmo);
 * - erro: conjunto vazio (fail-closed), sem quebrar a tela.
 */
export function PermissoesProvider({ children }: { children: React.ReactNode }) {
  const { token, devBypass } = useAuth()
  const role = useRole()
  const [resposta, setResposta] = useState<Resposta | null>(null)

  useEffect(() => {
    if (devBypass || !token) return
    let vivo = true
    fetchMinhasPermissoes()
      .then((dados) => {
        if (vivo) setResposta({ token, dados })
      })
      .catch(() => {
        if (vivo) setResposta({ token, dados: null })
      })
    return () => {
      vivo = false
    }
  }, [token, devBypass])

  const atual = token != null && resposta?.token === token ? resposta : null
  const carregando = !devBypass && token != null && atual === null

  const permissoes = useMemo<ReadonlySet<Permissao>>(() => {
    if (devBypass) return CATALOGO
    const dados = atual?.dados
    if (!dados) return NENHUMA
    if (dados.legado) return permissoesLegadas(role, dados.operacaoLegado === true)
    return dados.permissoes
  }, [devBypass, atual, role])

  const tem = useCallback((p: Permissao) => permissoes.has(p), [permissoes])
  const papel = atual?.dados?.papel

  const value = useMemo<PermissoesContextValue>(
    () => ({ carregando, tem, ...(papel ? { papel } : {}) }),
    [carregando, tem, papel],
  )

  return <PermissoesContext.Provider value={value}>{children}</PermissoesContext.Provider>
}

/** As permissões do usuário logado. Deve rodar sob `<PermissoesProvider>` (layout raiz). */
export function usePermissoes(): PermissoesContextValue {
  const ctx = useContext(PermissoesContext)
  if (!ctx) {
    throw new Error('usePermissoes must be used within a <PermissoesProvider>')
  }
  return ctx
}
