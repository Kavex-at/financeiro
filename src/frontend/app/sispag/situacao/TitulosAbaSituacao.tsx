'use client'

import { AlertTriangle, Layers } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  type LotePagamento,
  type ResumoSituacao,
  type TituloAPagar,
  type TituloRetidoPorCodigoBarras,
} from '@/lib/sispag'
import { ExportarTitulosAPagarBotao } from '../components/ExportarTitulosAPagarBotao'
import { formatarDia } from '../components/filtrosAbas'
import { MoverParaLoteDialog } from '../components/MoverParaLoteDialog'
import type { ResumoDesfecho } from '../components/sugestaoBoleto'
import { BarraSelecaoLotes } from './BarraSelecaoLotes'
import { CardsSituacao } from './CardsSituacao'
import { FaixaBloqueadosHoje } from './FaixaBloqueadosHoje'
import { FiltroSituacaoBarra } from './FiltroSituacaoBarra'
import { PreviaLotesAutomaticos } from './PreviaLotesAutomaticos'
import { RegrasSituacao } from './RegrasSituacao'
import { ResultadoLotesDialog } from './ResultadoLotesDialog'
import { diaDoPrazo } from './prazoTitulo'
import { ROTULO_FONTE } from './rotulos'
import { resumirSelecao, selecionavel } from './selecao'
import {
  bloqueadosPorMotivo,
  bloqueadosPerdidos,
  bloqueadosQueVencemHoje,
  boletoSemDdaPorSugestao,
  chaveDoTitulo,
  totaisPorEstado,
} from './situacaoTitulos'
import { TabelaTitulos } from './TabelaTitulos'
import { opcoesDosFiltros } from './filtrosAtivos'
import { useCriarLotesPorFilial } from './useCriarLotesPorFilial'
import { useTabelaTitulos } from './useTabelaTitulos'

/**
 * A aba "Títulos a pagar" com situação de pagamento (ADR-0075): cards de ação, faixa dos bloqueados
 * de hoje, filtro externo, regras, tabela com filtro/ordenação no cabeçalho e barra de seleção que
 * cria um lote por filial. Só é usada quando o backend manda `resumoSituacao`; sem ele, a página
 * mostra a aba de antes.
 */
export function TitulosAbaSituacao({
  titulos,
  resumo,
  lotes,
  lotesIndisponiveis,
  podeExecutar,
  busy,
  retidos,
  resumoDoDesfecho,
  barraExtra,
  onAbrirSugestao,
  onVerBoleto,
  onIrParaLote,
  onIrParaLotes,
  onRetirar,
  onResolvido,
  onLotesCriados,
  formando,
  onFormarAutomaticos,
}: {
  /** Títulos da aba (já sem os comprometidos, conforme o botão da página). */
  titulos: TituloAPagar[]
  resumo: ResumoSituacao
  lotes: LotePagamento[]
  /** A lista de lotes falhou ao carregar: o card de lotes diz isso. */
  lotesIndisponiveis: boolean
  podeExecutar: boolean
  busy: boolean
  retidos: ReadonlyMap<string, TituloRetidoPorCodigoBarras>
  resumoDoDesfecho: (t: TituloAPagar) => ResumoDesfecho | undefined
  /** Avisos e botões da página que ficam ao lado da exportação (comprometidos, corte, sugestões). */
  barraExtra?: React.ReactNode
  onAbrirSugestao: (t: TituloAPagar) => void
  onVerBoleto: (t: TituloAPagar) => void
  onIrParaLote: (loteId: string) => void
  /** Leva à aba de lotes (candidatos, ou finalizados quando só há esses). */
  onIrParaLotes: (aba: 'lotes-candidatos' | 'lotes-finalizados') => void
  onRetirar: (t: TituloAPagar) => void
  /** Depois de uma ação que muda o servidor (desfazer retenção, ajuste): recarregar painel e retidos. */
  onResolvido: () => void | Promise<void>
  /** Depois de criar lotes: recarregar painel e lotes. */
  onLotesCriados: () => Promise<void>
  formando: boolean
  onFormarAutomaticos: () => Promise<void>
}) {
  const tabela = useTabelaTitulos(titulos)
  const [selecionados, setSelecionados] = React.useState<Set<string>>(new Set())
  const [regrasAbertas, setRegrasAbertas] = React.useState(false)
  const [previaAberta, setPreviaAberta] = React.useState(false)
  const regrasId = React.useId()

  const selecionadosTitulos = React.useMemo(
    () => titulos.filter((t) => selecionados.has(chaveDoTitulo(t)) && selecionavel(t)),
    [titulos, selecionados],
  )
  const criarLotes = useCriarLotesPorFilial({
    selecionados: selecionadosTitulos,
    lotes,
    aoConcluir: async () => {
      setSelecionados(new Set())
      await onLotesCriados()
    },
  })

  const totais = React.useMemo(() => totaisPorEstado(titulos), [titulos])
  const motivos = React.useMemo(() => bloqueadosPorMotivo(titulos), [titulos])
  const sugestoesBoleto = React.useMemo(() => boletoSemDdaPorSugestao(titulos), [titulos])
  const opcoes = React.useMemo(() => opcoesDosFiltros(titulos), [titulos])
  const hoje = React.useMemo(() => bloqueadosQueVencemHoje(titulos), [titulos])
  const perdidos = React.useMemo(() => bloqueadosPerdidos(titulos), [titulos])
  // O dia de hoje é o prazo efetivo de qualquer título da faixa (todos vencem hoje, por construção).
  const dataHoje = hoje[0] ? formatarDia(diaDoPrazo(hoje[0])) : ''
  const resumoSelecao = resumirSelecao(selecionadosTitulos, new Set(selecionadosTitulos.map(chaveDoTitulo)))
  const lotesEsperando = lotesIndisponiveis
    ? null
    : {
        paraFinalizar: lotes.filter((l) => l.status === 'RASCUNHO').length,
        paraGerarRemessa: lotes.filter((l) => l.status === 'FINALIZADO').length,
      }

  const formar = async () => {
    await onFormarAutomaticos()
    setPreviaAberta(false)
  }

  return (
    <div className="space-y-4">
      {resumo.fontesIndisponiveis.length > 0 ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle/40 px-3 py-2 text-xs text-warning-foreground"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Situação incompleta: não foi possível ler{' '}
            {resumo.fontesIndisponiveis.map((f) => ROTULO_FONTE[f]).join(', ')}. Títulos afetados
            podem aparecer como prontos; o servidor ainda confere ao criar o lote.
          </span>
        </p>
      ) : null}

      <CardsSituacao
        resumo={resumo}
        titulos={titulos}
        lotes={lotesEsperando}
        podeExecutar={podeExecutar}
        estadoAtivo={tabela.filtros.estado}
        urgentesAtivo={tabela.urgentesAtivo}
        onSelecionarProntos={() => {
          tabela.limpar()
          tabela.definirEstado('prontos')
          setSelecionados(new Set(titulos.filter(selecionavel).map(chaveDoTitulo)))
        }}
        onVerBloqueados={() => tabela.definirEstado('bloqueados')}
        onAlternarUrgentes={tabela.alternarUrgentes}
        onIrParaLotes={() =>
          onIrParaLotes(
            (lotesEsperando?.paraFinalizar ?? 0) > 0 ? 'lotes-candidatos' : 'lotes-finalizados',
          )
        }
      />

      <FaixaBloqueadosHoje
        titulos={hoje}
        perdidos={perdidos}
        dataHoje={dataHoje}
        podeExecutar={podeExecutar}
        onVerBoleto={onVerBoleto}
        onResolvido={onResolvido}
        onVerSoEstes={() => {
          tabela.limpar()
          tabela.definirEstado('bloqueados')
          tabela.atualizar({ faixas: ['HOJE'] })
        }}
      />

      <FiltroSituacaoBarra
        estado={tabela.filtros.estado}
        totais={totais}
        motivos={motivos}
        motivosSelecionados={tabela.filtros.situacoes}
        onEstado={tabela.definirEstado}
        onAlternarMotivo={tabela.alternarMotivo}
        sugestoesBoleto={sugestoesBoleto}
        sugestoesSelecionadas={tabela.filtros.sugestoesBoleto}
        onAlternarSugestao={tabela.alternarSugestaoBoleto}
        regrasAbertas={regrasAbertas}
        regrasId={regrasId}
        onAlternarRegras={() => setRegrasAbertas((v) => !v)}
      />
      {regrasAbertas ? <RegrasSituacao id={regrasId} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{barraExtra}</div>
        <div className="flex items-center gap-2">
          <ExportarTitulosAPagarBotao titulos={tabela.filtrados} />
          {podeExecutar ? (
            <Button
              size="sm"
              variant="outline"
              aria-expanded={previaAberta}
              onClick={() => setPreviaAberta((v) => !v)}
            >
              <Layers className="size-4" aria-hidden /> Formar lotes automáticos
            </Button>
          ) : null}
        </div>
      </div>

      {previaAberta ? (
        <PreviaLotesAutomaticos
          titulos={titulos}
          formando={formando}
          onFormar={() => void formar()}
          onFechar={() => setPreviaAberta(false)}
        />
      ) : null}

      <div className="rounded-lg">
        <TabelaTitulos
          tabela={tabela}
          opcoes={opcoes}
          totalNaLista={titulos.length}
          selecionados={selecionados}
          onSelecionados={setSelecionados}
          podeExecutar={podeExecutar}
          busy={busy}
          retidos={retidos}
          resumoDoDesfecho={resumoDoDesfecho}
          onAbrirSugestao={onAbrirSugestao}
          onVerBoleto={onVerBoleto}
          onIrParaLote={onIrParaLote}
          onRetirar={onRetirar}
          onResolvido={onResolvido}
        />
        {podeExecutar ? (
          <BarraSelecaoLotes
            resumo={resumoSelecao}
            criando={criarLotes.criando}
            onLimpar={() => setSelecionados(new Set())}
            onCriar={() => void criarLotes.criar()}
          />
        ) : null}
      </div>

      <MoverParaLoteDialog
        plano={criarLotes.confirmacao}
        totalSelecionados={selecionadosTitulos.length}
        onClose={criarLotes.cancelarMover}
        salvando={criarLotes.criando}
        onConfirmar={() => void criarLotes.confirmarMover()}
      />

      <ResultadoLotesDialog
        resultado={criarLotes.resultado}
        titulos={titulos}
        onClose={criarLotes.fecharResultado}
        onVerLote={(id) => {
          criarLotes.fecharResultado()
          onIrParaLote(id)
        }}
      />
    </div>
  )
}
