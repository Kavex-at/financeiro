'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  CATALOGO_PERMISSOES,
  fetchMinhasPermissoes,
  type MinhasPermissoes,
  type PapelRef,
  type Permissao,
} from '../permissoes'
import { useAuth } from './AuthProvider'

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
  /**
   * `true` quando a consulta de `/me/permissoes` FALHOU (auth instável, rede) — diferente de "sem
   * permissão". `tem()` continua false (fail-closed), mas a tela deve dizer que não conseguiu
   * verificar, não que o usuário não tem acesso (Regis `availability-1`).
   */
  falhou: boolean
  /** Refaz a consulta de `/me/permissoes` (botão "Tentar de novo"). */
  recarregar: () => void
}

const PermissoesContext = createContext<PermissoesContextValue | undefined>(undefined)

const CATALOGO = new Set<Permissao>(CATALOGO_PERMISSOES)
const NENHUMA = new Set<Permissao>()

/** Resultado da consulta, amarrado ao token que a fez: token novo = consulta nova. */
interface Resposta {
  token: string
  dados: MinhasPermissoes | null
  /** A consulta lançou (≠ respondeu sem permissões). */
  falhou: boolean
}

/**
 * Busca `/me/permissoes` UMA vez por sessão, e de novo quando o token muda (login / troca de
 * usuário) — não a cada navegação. Mora no layout raiz, dentro do `AuthProvider`.
 *
 * - `DEV_AUTH_BYPASS` (D1): catálogo inteiro, sem consulta (o backend faz o mesmo);
 * - erro, ou resposta sem o array de permissões: conjunto vazio (fail-closed), sem quebrar a tela.
 */
export function PermissoesProvider({ children }: { children: React.ReactNode }) {
  const { token, devBypass } = useAuth()
  const [resposta, setResposta] = useState<Resposta | null>(null)
  /** Incrementado pelo "Tentar de novo" para refazer a consulta com o mesmo token. */
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    if (devBypass || !token) return
    let vivo = true
    // `tentativa` só dispara o efeito de novo; o valor não é usado.
    void tentativa
    fetchMinhasPermissoes()
      .then((dados) => {
        if (vivo) setResposta({ token, dados, falhou: false })
      })
      .catch(() => {
        if (vivo) setResposta({ token, dados: null, falhou: true })
      })
    return () => {
      vivo = false
    }
  }, [token, devBypass, tentativa])

  const recarregar = useCallback(() => {
    setResposta(null)
    setTentativa((n) => n + 1)
  }, [])

  const atual = token != null && resposta?.token === token ? resposta : null
  const carregando = !devBypass && token != null && atual === null

  const permissoes = useMemo<ReadonlySet<Permissao>>(() => {
    if (devBypass) return CATALOGO
    const dados = atual?.dados
    if (!dados) return NENHUMA
    return dados.permissoes
  }, [devBypass, atual])

  const tem = useCallback((p: Permissao) => permissoes.has(p), [permissoes])
  const papel = atual?.dados?.papel
  const falhou = !devBypass && atual?.falhou === true

  const value = useMemo<PermissoesContextValue>(
    () => ({ carregando, tem, falhou, recarregar, ...(papel ? { papel } : {}) }),
    [carregando, tem, falhou, recarregar, papel],
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
