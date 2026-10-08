'use client'

import * as React from 'react'
import {
  Activity,
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Landmark,
  UserCheck,
  Users,
} from 'lucide-react'
import type { SidebarGroup } from '@/components/ui/sidebar'
import { usePermissoes } from '@/lib/auth/PermissoesProvider'
import { isSispagEnabled } from '@/lib/features'
import { PERMISSAO, type Permissao } from '@/lib/permissoes'

/**
 * O modelo de navegação do Financeiro — fonte única, consumida pela `Sidebar` (desktop) e pelo
 * `BottomNav` (mobile).
 *
 * Dois grupos, com pesos deliberadamente diferentes: **Frentes** são o trabalho (é onde o analista
 * passa o dia) e **Plataforma** é quem cuida do trabalho. Achatar os dois numa lista só é
 * exatamente a uniformidade sem hierarquia que faz uma tela de operação parecer um menu genérico.
 *
 * ## Visibilidade
 *
 * Cada item aparece pela permissão do módulo (ADR-0053), a MESMA que governa o card correspondente
 * na home: Permutas ⇐ `permutas:ver`, SISPAG ⇐ flag E `sispag:ver`, Adiantamentos ⇐
 * `recebimentos:ver`, Operação ⇐ `operacao:ver`, Métricas ⇐ `metricas:ver`, Usuários ⇐
 * `usuarios:gerenciar`. A regra do design system (`docs/design-system/feedback.md`) é categórica:
 * **permissão ausente esconde, nunca desabilita** — "por que esse item está cinza?" é uma pergunta
 * que o usuário não deveria precisar fazer. Nenhum destes gates é segurança: o gate real é o guard
 * de permissão de cada rota no servidor (e o `SISPAG_ENABLED` do backend). Esconder é ergonomia.
 */

export interface AppNavPermissions {
  sispagEnabled: boolean
  /** A permissão está entre as efetivas do usuário (false enquanto carrega). */
  tem: (permissao: Permissao) => boolean
}

/**
 * Projeção pura das permissões → grupos de navegação. Sem hooks, sem fetch: é isto que torna a
 * regra de visibilidade testável sem montar a árvore inteira.
 */
export function buildAppNavGroups({ sispagEnabled, tem }: AppNavPermissions): SidebarGroup[] {
  return [
    {
      id: 'frentes',
      label: 'Frentes',
      items: [
        {
          id: 'permutas',
          label: 'Permutas',
          icon: <ArrowLeftRight />,
          href: '/permutas',
          hidden: !tem(PERMISSAO.PERMUTAS_VER),
          tooltip: {
            title: 'Permutas',
            description: 'Adiantamentos PROFORMA ↔ invoices: elegibilidade, casamento e baixa.',
          },
          children: [
            { id: 'permutas-borderos', label: 'Borderôs', href: '/permutas/borderos' },
            {
              id: 'permutas-clientes-filtro',
              label: 'Clientes p/ permuta',
              href: '/permutas/clientes-filtro',
            },
          ],
        },
        {
          id: 'sispag',
          label: 'SISPAG',
          icon: <Banknote />,
          href: '/sispag',
          hidden: !(sispagEnabled && tem(PERMISSAO.SISPAG_VER)),
          tooltip: {
            title: 'SISPAG — Pagamentos',
            description: 'Títulos a pagar: ingestão, montagem do lote, remessa e retorno.',
          },
        },
        {
          // ADR-0065: lista de favorecidos autorizados a receber TED/PIX e relatório de candidatos.
          // Ver é `sispag:ver`; pedir e decidir são checados na tela e no servidor.
          id: 'sispag-favorecidos-autorizados',
          label: 'Favorecidos autorizados',
          icon: <UserCheck />,
          href: '/sispag/favorecidos-autorizados',
          hidden: !(sispagEnabled && tem(PERMISSAO.SISPAG_VER)),
          tooltip: {
            title: 'Favorecidos autorizados',
            description: 'Quem pode receber TED/PIX e em qual conta ou chave do cadastro do Conexos.',
          },
        },
        {
          id: 'recebimentos',
          label: 'Adiantamentos',
          icon: <Landmark />,
          href: '/recebimentos',
          hidden: !tem(PERMISSAO.RECEBIMENTOS_VER),
          tooltip: {
            title: 'Gestão de Adiantamentos',
            description: 'Conciliação de créditos bancários, rateio, baixa assistida e NDe.',
          },
        },
      ],
    },
    {
      id: 'plataforma',
      label: 'Plataforma',
      items: [
        {
          id: 'operacao',
          label: 'Operação',
          icon: <Activity />,
          href: '/operacao',
          hidden: !tem(PERMISSAO.OPERACAO_VER),
          tooltip: {
            title: 'Painel de Operação',
            description: 'Saúde dos pipelines, alertas abertos e diagnóstico de configuração.',
          },
        },
        {
          id: 'metricas',
          label: 'Métricas',
          icon: <BarChart3 />,
          href: '/metricas',
          hidden: !tem(PERMISSAO.METRICAS_VER),
          tooltip: {
            title: 'Métricas',
            description: 'Quanto trabalho o sistema fez pela operação, por semana.',
          },
        },
        {
          id: 'usuarios',
          label: 'Usuários',
          icon: <Users />,
          href: '/usuarios',
          hidden: !tem(PERMISSAO.USUARIOS_GERENCIAR),
          tooltip: {
            title: 'Usuários',
            description: 'Acessos da plataforma, papéis e vínculo do acesso Conexos.',
          },
        },
      ],
    },
  ]
}

/**
 * Os grupos de navegação já recortados para o usuário atual. Enquanto as permissões carregam,
 * nenhum item condicionado aparece — um item que aparece e some parece defeito; um que só aparece
 * quando a resposta chega, não.
 */
export function useAppNavGroups(): SidebarGroup[] {
  const { carregando, tem } = usePermissoes()
  const sispagEnabled = isSispagEnabled()

  return React.useMemo(
    () =>
      buildAppNavGroups({
        sispagEnabled,
        tem: (p) => !carregando && tem(p),
      }),
    [sispagEnabled, carregando, tem],
  )
}
