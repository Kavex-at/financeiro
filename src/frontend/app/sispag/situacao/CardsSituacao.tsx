'use client'

import { Button } from '@/components/ui/button'
import { KPIGrid, SimpleKPI } from '@/components/ui/kpi-card'
import { formatBRL } from '@/lib/utils'
import type { DonoPagamento, ResumoSituacao, TituloAPagar } from '@/lib/sispag'
import { ESTADO_PAGAMENTO } from '@/lib/sispag'
import { BOTAO_ALERTA, BOTAO_INFO, BOTAO_PERIGO } from '../components/filtros/botoesDeCard'
import { ROTULO_DONO } from './rotulos'
import { ehBloqueado, ehPronto, vencemEmAteDoisDias } from './situacaoTitulos'

/** Ordem em que os donos aparecem no card "Precisam de ação" (quem é você vem primeiro). */
const ORDEM_DONOS: readonly DonoPagamento[] = ['VOCE', 'APROVADOR', 'PERMUTAS', 'CONTAS_A_PAGAR']


export interface LotesEsperando {
  paraFinalizar: number
  paraGerarRemessa: number
}

/**
 * Os 4 cards de ação do topo (decisão D1). Prontos e Precisam de ação saem do `resumoSituacao`
 * (carteira inteira). "Vencem em até 2 dias" sai da lista da tela, porque depende do dia civil.
 * Cada card tem UM botão que leva à ação, sem aninhar clique no card.
 */
export function CardsSituacao({
  resumo,
  titulos,
  lotes,
  podeExecutar,
  estadoAtivo,
  urgentesAtivo,
  onSelecionarProntos,
  onVerBloqueados,
  onAlternarUrgentes,
  onIrParaLotes,
}: {
  resumo: ResumoSituacao
  /** Títulos da aba (sem os comprometidos), para o recorte de urgência. */
  titulos: TituloAPagar[]
  /** `null` = a lista de lotes não carregou: o card diz isso em vez de mostrar zero. */
  lotes: LotesEsperando | null
  podeExecutar: boolean
  estadoAtivo: 'todos' | 'prontos' | 'bloqueados'
  urgentesAtivo: boolean
  onSelecionarProntos: () => void
  onVerBloqueados: () => void
  onAlternarUrgentes: () => void
  onIrParaLotes: () => void
}) {
  const prontos = resumo.porEstado[ESTADO_PAGAMENTO.PRONTO]
  const bloqueados = resumo.porEstado[ESTADO_PAGAMENTO.BLOQUEADO]
  const urgentes = vencemEmAteDoisDias(titulos)
  const urgentesProntos = urgentes.filter(ehPronto).length
  const urgentesBloqueados = urgentes.filter(ehBloqueado).length
  const donos = ORDEM_DONOS.flatMap((d) => {
    const total = resumo.porDono[d]
    return total && total.qtd > 0 ? [`${total.qtd} com ${ROTULO_DONO[d].toLowerCase()}`] : []
  })
  const lotesTotal = lotes ? lotes.paraFinalizar + lotes.paraGerarRemessa : 0

  return (
    <KPIGrid columns={4} aria-label="Resumo de ação">
      <SimpleKPI
        label="Prontos para pagar"
        value={prontos.qtd.toLocaleString('pt-BR')}
        color="success"
        active={estadoAtivo === 'prontos'}
        footer={
          <div className="space-y-2">
            <p>{formatBRL(prontos.valor)}</p>
            {podeExecutar && prontos.qtd > 0 ? (
              <Button size="sm" onClick={onSelecionarProntos}>
                Selecionar os {prontos.qtd.toLocaleString('pt-BR')} prontos
              </Button>
            ) : null}
          </div>
        }
      />
      <SimpleKPI
        label="Precisam de ação"
        value={bloqueados.qtd.toLocaleString('pt-BR')}
        color="danger"
        active={estadoAtivo === 'bloqueados'}
        footer={
          <div className="space-y-2">
            <p>
              {formatBRL(bloqueados.valor)} parados
              {donos.length > 0 ? ` · ${donos.join(' · ')}` : ''}
            </p>
            {bloqueados.qtd > 0 ? (
              <Button size="sm" className={BOTAO_PERIGO} onClick={onVerBloqueados}>
                Resolver bloqueados
              </Button>
            ) : null}
          </div>
        }
      />
      <SimpleKPI
        label="Vencem em até 2 dias"
        value={urgentes.length.toLocaleString('pt-BR')}
        color="warning"
        active={urgentesAtivo}
        footer={
          <div className="space-y-2">
            <p>
              {urgentesProntos} prontos · {urgentesBloqueados} bloqueados
            </p>
            {urgentes.length > 0 || urgentesAtivo ? (
              <Button
                size="sm"
                className={BOTAO_ALERTA}
                aria-pressed={urgentesAtivo}
                onClick={onAlternarUrgentes}
              >
                {urgentesAtivo ? 'Tirar o filtro' : 'Ver só os urgentes'}
              </Button>
            ) : null}
          </div>
        }
      />
      <SimpleKPI
        label="Lotes esperando você"
        value={lotes ? lotesTotal.toLocaleString('pt-BR') : '—'}
        color="info"
        footer={
          <div className="space-y-2">
            <p>
              {lotes
                ? `${lotes.paraFinalizar} para finalizar · ${lotes.paraGerarRemessa} para gerar remessa`
                : 'não foi possível carregar os lotes'}
            </p>
            {lotesTotal > 0 ? (
              <Button size="sm" className={BOTAO_INFO} onClick={onIrParaLotes}>
                Ir para os lotes
              </Button>
            ) : null}
          </div>
        }
      />
    </KPIGrid>
  )
}
