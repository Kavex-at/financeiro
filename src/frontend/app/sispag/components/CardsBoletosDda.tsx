'use client'

import { Button } from '@/components/ui/button'
import { KPIGrid, SimpleKPI } from '@/components/ui/kpi-card'
import type { BoletoDdaContagem, BoletoDdaSituacao } from '@/lib/sispag'

export type FiltroSituacaoDda = 'todas' | BoletoDdaSituacao

const fmt = (n: number | undefined) => (n === undefined ? '—' : n.toLocaleString('pt-BR'))

/**
 * Cards-resumo da aba "Boletos DDA". Cada card é um atalho para o filtro de situação (o mesmo da
 * barra de chips) e leva botões de ação, como em "Títulos a pagar". Os números são o `contagem` do
 * servidor (já com filial + busca aplicadas), então não dependem da página aberta.
 */
export function CardsBoletosDda({
  contagem,
  situacaoAtiva,
  onSelecionar,
  emGrupoAtivo = false,
  onAlternarEmGrupo,
}: {
  /** `undefined` enquanto a primeira resposta não chegou: o card mostra "—", nunca zero. */
  contagem?: BoletoDdaContagem
  situacaoAtiva: FiltroSituacaoDda
  onSelecionar: (s: FiltroSituacaoDda) => void
  /** I21v: o filtro "Em grupo" está ligado. */
  emGrupoAtivo?: boolean
  onAlternarEmGrupo?: () => void
}) {
  const aConferir = contagem ? contagem.CANDIDATO + contagem.AMBIGUO : undefined
  const alternar = (s: BoletoDdaSituacao) => onSelecionar(situacaoAtiva === s ? 'todas' : s)
  return (
    <KPIGrid columns={5} aria-label="Resumo dos boletos DDA">
      <SimpleKPI
        label="Casados com título"
        value={fmt(contagem?.VINCULADO)}
        color="success"
        active={situacaoAtiva === 'VINCULADO'}
        footer={
          <div className="space-y-2">
            <p>O Conexos já ligou o boleto a um título</p>
            {contagem && contagem.VINCULADO > 0 ? (
              <Button
                size="sm"
                variant="outline"
                aria-pressed={situacaoAtiva === 'VINCULADO'}
                onClick={() => alternar('VINCULADO')}
              >
                {situacaoAtiva === 'VINCULADO' ? 'Tirar o filtro' : 'Ver os casados'}
              </Button>
            ) : null}
          </div>
        }
      />
      <SimpleKPI
        label="Para conferir"
        value={fmt(aConferir)}
        color="info"
        active={situacaoAtiva === 'CANDIDATO' || situacaoAtiva === 'AMBIGUO'}
        footer={
          <div className="space-y-2">
            <p>
              {contagem
                ? `${contagem.CANDIDATO} com um candidato · ${contagem.AMBIGUO} ambíguos`
                : 'carregando…'}
            </p>
            <div className="flex flex-wrap gap-2">
              {contagem && contagem.CANDIDATO > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  aria-pressed={situacaoAtiva === 'CANDIDATO'}
                  onClick={() => alternar('CANDIDATO')}
                >
                  Ver candidatos
                </Button>
              ) : null}
              {contagem && contagem.AMBIGUO > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  aria-pressed={situacaoAtiva === 'AMBIGUO'}
                  onClick={() => alternar('AMBIGUO')}
                >
                  Ver ambíguos
                </Button>
              ) : null}
            </div>
          </div>
        }
      />
      <SimpleKPI
        label="Sem título"
        value={fmt(contagem?.SEM_TITULO)}
        color="warning"
        active={situacaoAtiva === 'SEM_TITULO'}
        footer={
          <div className="space-y-2">
            <p>Nenhum título aberto bate em valor e vencimento</p>
            {contagem && contagem.SEM_TITULO > 0 ? (
              <Button
                size="sm"
                variant="outline"
                aria-pressed={situacaoAtiva === 'SEM_TITULO'}
                onClick={() => alternar('SEM_TITULO')}
              >
                {situacaoAtiva === 'SEM_TITULO' ? 'Tirar o filtro' : 'Ver sem título'}
              </Button>
            ) : null}
          </div>
        }
      />
      <SimpleKPI
        label="Pagam vários títulos"
        value={fmt(contagem?.emGrupo)}
        color="info"
        active={emGrupoAtivo}
        footer={
          <div className="space-y-2">
            <p>Um boleto que fecha a soma de vários títulos do credor</p>
            {contagem && contagem.emGrupo > 0 && onAlternarEmGrupo ? (
              <Button
                size="sm"
                variant="outline"
                aria-pressed={emGrupoAtivo}
                onClick={onAlternarEmGrupo}
              >
                {emGrupoAtivo ? 'Tirar o filtro' : 'Ver os grupos'}
              </Button>
            ) : null}
          </div>
        }
      />
      <SimpleKPI
        label="Boletos no período"
        value={fmt(contagem?.todas)}
        active={situacaoAtiva === 'todas'}
        footer={<p>Com a filial e a busca atuais. O valor total ainda não vem do servidor.</p>}
      />
    </KPIGrid>
  )
}
