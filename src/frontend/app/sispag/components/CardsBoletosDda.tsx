'use client'

import type * as React from 'react'
import { Button } from '@/components/ui/button'
import { KPIGrid, SimpleKPI } from '@/components/ui/kpi-card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBRL } from '@/lib/utils'
import type { BoletosDdaResposta } from '@/lib/sispag'
import { somaTotais, type TotalDda, totalDe } from '../boletos-dda/filtrosBoletosDda'
import { BOTAO_ALERTA, BOTAO_PERIGO, BOTAO_PRIMARIO } from './filtros/botoesDeCard'

const qtd = (t: TotalDda) => (t.qtd === undefined ? '—' : t.qtd.toLocaleString('pt-BR'))
const reais = (t: TotalDda) => (t.valor === undefined ? '—' : formatBRL(t.valor))

/**
 * Os 4 cards de ação da aba "Boletos DDA", no padrão de `CardsSituacao` (Títulos a pagar): número,
 * R$ no rodapé e UM botão cheio na cor do card que liga o filtro. Os totais vêm do servidor
 * (`totais`), na mesma base do filtro externo. O total do período não é card: é o segmento Todos.
 */
export function CardsBoletosDda({
  dados,
  carregando,
  segmento,
  urgentesAtivo,
  emGrupoAtivo,
  onVerCasados,
  onConferir,
  onAlternarUrgentes,
  onAlternarEmGrupo,
}: {
  /** `undefined` enquanto a primeira resposta não chegou: os cards mostram o esqueleto. */
  dados?: BoletosDdaResposta
  carregando: boolean
  segmento: string | undefined
  urgentesAtivo: boolean
  emGrupoAtivo: boolean
  onVerCasados: () => void
  onConferir: () => void
  onAlternarUrgentes: () => void
  onAlternarEmGrupo: () => void
}) {
  const casados = totalDe(dados, 'VINCULADO')
  const candidatos = totalDe(dados, 'CANDIDATO')
  const ambiguos = totalDe(dados, 'AMBIGUO')
  const conferir = somaTotais(candidatos, ambiguos)
  const urgentes = totalDe(dados, 'urgentes')
  const urgConferir = totalDe(dados, 'urgentesParaConferir')
  const urgSemTitulo = totalDe(dados, 'urgentesSemTitulo')
  const grupos = totalDe(dados, 'emGrupo')
  const sugeridos = totalDe(dados, 'grupoSugerido')
  const confirmados = totalDe(dados, 'grupoConfirmado')
  const loading = carregando && !dados
  // Carregando: a MESMA árvore, com esqueleto no número e no rodapé (nada desloca ao chegar).
  const numero = (t: TotalDda) => (loading ? <Skeleton className="h-8 w-16" /> : qtd(t))
  const rodape = (conteudo: React.ReactNode) =>
    loading ? <Skeleton className="h-4 w-40" /> : <div className="space-y-2">{conteudo}</div>

  return (
    <KPIGrid columns={4} aria-label="Resumo dos boletos DDA" aria-busy={loading}>
      <SimpleKPI
        label="Casados com título"
        value={numero(casados)}
        color="success"
        active={segmento === 'casados'}
        footer={rodape(
          <>
            <p>{reais(casados)} · o Conexos já ligou o boleto a um título</p>
            {(casados.qtd ?? 0) > 0 ? (
              <Button size="sm" aria-pressed={segmento === 'casados'} onClick={onVerCasados}>
                {segmento === 'casados' ? 'Tirar o filtro' : 'Ver os casados'}
              </Button>
            ) : null}
          </>,
        )}
      />
      <SimpleKPI
        label="Para conferir"
        value={numero(conferir)}
        color="danger"
        active={segmento === 'conferir'}
        footer={rodape(
          <>
            <p>
              {reais(conferir)} · {qtd(candidatos)} com um candidato · {qtd(ambiguos)} ambíguos
            </p>
            {(conferir.qtd ?? 0) > 0 ? (
              <Button
                size="sm"
                className={BOTAO_PERIGO}
                aria-pressed={segmento === 'conferir'}
                onClick={onConferir}
              >
                {segmento === 'conferir' ? 'Tirar o filtro' : 'Conferir'}
              </Button>
            ) : null}
          </>,
        )}
      />
      <SimpleKPI
        label="Vencem em até 2 dias"
        value={numero(urgentes)}
        color="warning"
        active={urgentesAtivo}
        footer={rodape(
          <>
            <p>
              {reais(urgentes)} · {qtd(urgConferir)} para conferir · {qtd(urgSemTitulo)} sem título
            </p>
            {(urgentes.qtd ?? 0) > 0 || urgentesAtivo ? (
              <Button
                size="sm"
                className={BOTAO_ALERTA}
                aria-pressed={urgentesAtivo}
                onClick={onAlternarUrgentes}
              >
                {urgentesAtivo ? 'Tirar o filtro' : 'Ver só os urgentes'}
              </Button>
            ) : null}
          </>,
        )}
      />
      <SimpleKPI
        label="Pagam vários títulos"
        value={numero(grupos)}
        color="primary"
        active={emGrupoAtivo}
        footer={rodape(
          <>
            <p>
              {reais(grupos)} · {qtd(sugeridos)} sugeridos · {qtd(confirmados)} confirmados
            </p>
            {(grupos.qtd ?? 0) > 0 || emGrupoAtivo ? (
              <Button
                size="sm"
                className={BOTAO_PRIMARIO}
                aria-pressed={emGrupoAtivo}
                onClick={onAlternarEmGrupo}
              >
                {emGrupoAtivo ? 'Tirar o filtro' : 'Ver os grupos'}
              </Button>
            ) : null}
          </>,
        )}
      />
    </KPIGrid>
  )
}
