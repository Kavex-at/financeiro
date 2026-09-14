'use client'

import * as React from 'react'
import { Activity, ArrowLeftRight, Banknote, BarChart3, Landmark, Users } from 'lucide-react'
import type { SidebarGroup } from '@/components/ui/sidebar'
import { useIsAdmin } from '@/lib/auth/AuthProvider'
import { isSispagEnabled } from '@/lib/features'
import { fetchPermissoes } from '@/lib/operacao'

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
 * Cada item herda o MESMO recorte que já governa o card correspondente na home. A regra do design
 * system (`docs/design-system/feedback.md`) é categórica: **permissão ausente esconde, nunca
 * desabilita** — "por que esse item está cinza?" é uma pergunta que o usuário não deveria precisar
 * fazer. Nenhum destes gates é segurança: o gate real é server-side em todos os três casos
 * (`SISPAG_ENABLED` no backend, 404 nas rotas `/operacao`, `requireRole('admin')` em `/usuarios`).
 * Esconder é ergonomia.
 */

export interface AppNavPermissions {
  sispagEnabled: boolean
  isAdmin: boolean
  operacaoEnabled: boolean
}

/**
 * Projeção pura das permissões → grupos de navegação. Sem hooks, sem fetch: é isto que torna a
 * regra de visibilidade testável sem montar a árvore inteira.
 */
export function buildAppNavGroups({
  sispagEnabled,
  isAdmin,
  operacaoEnabled,
}: AppNavPermissions): SidebarGroup[] {
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
          hidden: !sispagEnabled,
          tooltip: {
            title: 'SISPAG — Pagamentos',
            description: 'Títulos a pagar: ingestão, montagem do lote, remessa e retorno.',
          },
        },
        {
          id: 'recebimentos',
          label: 'Adiantamentos',
          icon: <Landmark />,
          href: '/recebimentos',
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
          hidden: !operacaoEnabled,
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
          hidden: !isAdmin,
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
 * Consulta o allow-list de Operação (`OPERACAO_USUARIOS`, recorte por identidade e não por papel —
 * ADR-0042). Falha **fechada**: se a consulta não responde, o item não aparece. Um item que some é
 * irritante; um item que aparece e leva a um 404 parece defeito.
 */
function usePermissaoOperacao(): boolean {
  const [permitido, setPermitido] = React.useState(false)

  React.useEffect(() => {
    let vivo = true
    void fetchPermissoes()
      .then((p) => {
        if (vivo) setPermitido(p.operacao)
      })
      .catch(() => {
        if (vivo) setPermitido(false)
      })
    return () => {
      vivo = false
    }
  }, [])

  return permitido
}

/** Os grupos de navegação já recortados para o usuário atual. */
export function useAppNavGroups(): SidebarGroup[] {
  const isAdmin = useIsAdmin()
  const operacaoEnabled = usePermissaoOperacao()
  const sispagEnabled = isSispagEnabled()

  return React.useMemo(
    () => buildAppNavGroups({ sispagEnabled, isAdmin, operacaoEnabled }),
    [sispagEnabled, isAdmin, operacaoEnabled],
  )
}
