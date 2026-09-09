/**
 * Frontend domain types. The skeleton ships only the Conexos `Filial` shape
 * (mirrors the backend `GET /conexos/filiais` response). Financeiro feature
 * types are added here as the domain is modelled via the pipeline.
 */
export interface Filial {
  filCod: number
  filDesNome: string
  filDocFederalFmt: string
  ufEspSigla?: string
  filVldStatus?: number
}

export interface FiliaisResponse {
  filiais: Filial[]
  filCodDefault: number | null
}

/**
 * Permutas — "Gestão de Permutas" shapes. Mirror the (enriched) backend
 * snapshot the painel endpoint will expose (Fase B). Until then the page is
 * fed by `lib/permutas-fixture.ts` (real probed data) as a demo safety-net.
 */

export type StatusElegibilidade =
  | 'elegivel'
  | 'bloqueada'
  | 'casamento-manual'
  | 'permuta-manual'
  | 'ja-permutado'

/**
 * Tipo de permuta — classificação DERIVADA (apresentação) p/ as abas:
 *  - `simples`       — 1:1 ou 1 invoice → N adiantamentos (auto-casável).
 *  - `multiplas`     — 1 adiantamento → N invoices (mesmo processo).
 *  - `cross-over`    — N adiantamentos ↔ M invoices (mesmo processo).
 *  - `cross-process` — cliente-filtro: a invoice está em OUTRO processo.
 */
export type TipoPermuta = 'simples' | 'multiplas' | 'cross-over' | 'cross-process'

/** Importador (cliente) cadastrado como "filtro" — permuta manual cross-process. */
export interface ClienteFiltro {
  pesCod: string
  importador?: string
  criadoEm: string
}

/** Importador distinto do backlog (seletor do cadastro de cliente-filtro). */
export interface Importador {
  pesCod: string
  importador?: string
  qtdAdtos: number
}

/** Invoice encontrada na busca cross-process (live), para a alocação manual (Fase 2). */
export interface InvoiceBuscada {
  docCod: string
  priCod: string
  filCod: number
  referencia?: string
  exportador?: string
  dataEmissao?: string
  valorMoedaNegociada?: number
  moeda?: string
  taxa?: number
  /** O processo da invoice tem D.I/DUIMP? (a alocação exige `true`). */
  temDi: boolean
  dataBase?: string
  /** Σ já alocado nesta invoice por OUTROS adiantamentos (N:M). Disponível =
   * `valorMoedaNegociada − jaAlocado`. Default 0. */
  jaAlocado?: number
}

/** Uma alocação manual adto↔invoice (Fase 2), exibida na linha do permuta-manual. */
export interface AlocacaoDetalhe {
  invoiceDocCod: string
  invoicePriCod?: string
  valorAlocado: number
  moeda?: string
  variacaoClassificacao?: string
  variacaoResultado?: number
  /** Taxas do adiantamento e da invoice — montam a conta do juros/desconto na
   * tela: `valorAlocado × (taxaAdiantamento − taxaInvoice) = resultado`. */
  taxaAdiantamento?: number
  taxaInvoice?: number
  criadoPor?: string
  criadoEm: string
}

/** Status do analista sobre um adiantamento (botão "Processar"). */
export type ProcessamentoStatus = 'pendente' | 'processando' | 'processado' | 'erro'

/**
 * Micro-informações de um adiantamento (exibidas ao expandir a linha, qualquer
 * status). `declaracao` existe se o processo tem D.I/DUIMP; `taxa*`/`variacao*`
 * só para casos COM casamento — bloqueados/já-permutados não têm.
 */
export interface PermutaDetalhe {
  priCod: string
  pago: boolean
  dataEmissao?: string
  valorPermutar?: number
  /** Valor de FACE do título em BRL (`mnyTitValor`) — progresso de pagamento. */
  valorTotal?: number
  /** Saldo em aberto do título em BRL (`mnyTitAberto`) — quanto falta pagar (Gate 3). */
  valorAberto?: number
  declaracao?: { variante: 'DI' | 'DUIMP'; dataBase?: string }
  taxaAdiantamento?: number
  taxaInvoice?: number
  variacaoClassificacao?: string
  variacaoResultado?: number
  variacaoDelta?: number
}

/** Adiantamento PROFORMA pendente de permuta (linha da visão geral). */
export interface PermutaPendente {
  docCod: string
  filCod: number
  referencia: string
  /** Referência externa do processo (cliente) — `priEspRefcliente` (ex.: "0052INX/26"). */
  referenciaExterna?: string
  exportador: string
  /** Cliente = importador do processo (`imp021`). Analistas buscam por ele. */
  importador?: string
  valorMoedaNegociada: number | null
  /** Valor de FACE do documento em BRL (`docMnyValor`) — base da consolidação em reais. */
  valorBrl?: number | null
  moeda: string
  diasEmAberto: number | null
  status: StatusElegibilidade
  motivoBloqueio?: string
  /** Status do processamento do analista, quando registrado no banco. */
  processamentoStatus?: ProcessamentoStatus
  /** Tipo de permuta (classificação derivada p/ as abas) — ver `TipoPermuta`. */
  tipoPermuta?: TipoPermuta
  /**
   * Invoices candidatas para o casamento manual (N:M) — invoices em aberto do
   * mesmo processo (`priCod`). Preenchido só quando `status === 'casamento-manual'`;
   * o analista escolhe UMA e processa (ADR-0005).
   */
  candidatas?: InvoiceEmAberto[]
  /** Alocações manuais N:M cross-process (Fase 2) — só p/ `permuta-manual`. */
  alocacoes?: AlocacaoDetalhe[]
  /** Saldo a permutar ainda não alocado (moeda negociada) — `permuta-manual`. */
  saldoRestante?: number
  /** Múltipla AUTOMÁTICA: adto cobre todas as invoices do processo (adto ≥ Σ invoices) — aba
   * "Automáticas", baixa auto-aloca. (Regra 2026-06-24) */
  autoElegivel?: boolean
  /** Micro-informações exibidas ao expandir a linha (qualquer status). */
  detalhe?: PermutaDetalhe
}

/** INVOICE finalizada em aberto (lado-crédito do casamento). */
export interface InvoiceEmAberto {
  docCod: string
  filCod: number
  /** Processo (Conexos priCod) — código em comum com o adiantamento. */
  priCod?: string
  /** Data de emissão da invoice (ISO). */
  dataEmissao?: string
  referencia: string
  /** Referência externa do processo (cliente) — `priEspRefcliente` (ex.: "0052INX/26"). */
  referenciaExterna?: string
  exportador: string
  /** Cliente = importador do processo (`imp021`), juntado por priCod. */
  importador?: string
  valorMoedaNegociada: number | null
  /** Valor de FACE do documento em BRL (`docMnyValor`) — base da consolidação em reais. */
  valorBrl?: number | null
  moeda: string
  /** Taxa de câmbio negociada da invoice (`com308` `titFltTaxaMneg`). */
  taxa?: number
}

/** Adiantamento sugerido para abater uma invoice, com o valor parcial a usar. */
export interface CasamentoAdiantamento {
  docCod: string
  referencia: string
  valorASerUsado: number
  moeda: string
  /** Saldo restante do adiantamento (moeda negociada) após a distribuição greedy:
   * `valorPermutar/taxa − valorASerUsado`. Quando o maior adto cobre a invoice
   * sozinho, o restante fica em aberto. Opcional. */
  saldoRestante?: number
  /** Status do processamento do analista, quando registrado no banco. */
  processamentoStatus?: ProcessamentoStatus
}

/** Uma invoice em aberto e os adiantamentos sugeridos para casá-la (N:M). */
export interface CasamentoSugerido {
  /**
   * Código do PROCESSO (Conexos `priCod`) — o número em comum entre a invoice e
   * o adiantamento. É a chave que o analista usa pra confirmar a relação batendo
   * manualmente no Conexos. Exibido na coluna no lugar do código da invoice.
   */
  priCod: string
  invoice: InvoiceEmAberto
  adiantamentos: CasamentoAdiantamento[]
}

/**
 * Resumo de uma rodada de ingestão para a trilha de auditoria do modal de
 * ingestão manual (ADR-0006). Espelha `GET /permutas/runs`. `triggeredBy` é o
 * username do analista que rodou, ou `'cron'` para o job agendado.
 */
export interface PermutaRun {
  runId: string
  triggeredBy: string
  startedAt: string
  finishedAt: string
  status: 'success' | 'partial' | 'error'
  totalCandidatas: number
  totalElegiveis: number
  totalBloqueadas: number
  errorMessage?: string
}

export interface PermutaRunsResponse {
  runs: PermutaRun[]
}

/** Resultado de uma ingestão manual disparada com sucesso (`POST /permutas/ingestao`). */
export interface IngestaoResult {
  runId: string
  status: 'success' | 'error'
  totalAdiantamentos: number
  totalInvoices: number
  totalCasamentos: number
  totalStale: number
}

export interface GestaoPermutasResponse {
  /** ISO timestamp de quando o snapshot/eleição foi gerado. */
  geradoEm?: string
  /** Origem dos dados exibidos — usado no badge da tela. */
  fonte: 'banco' | 'fixture'
  pendentes: PermutaPendente[]
  invoicesEmAberto: InvoiceEmAberto[]
  casamentos: CasamentoSugerido[]
  totais: {
    pendentes: number
    invoicesEmAberto: number
    elegiveis: number
    bloqueadas: number
    /** N:M que passaram os 4 gates, aguardando escolha de invoice (ADR-0005). */
    casamentoManual: number
    /** Adtos de clientes-filtro (pago + saldo) p/ permuta manual cross-process. */
    permutaManual: number
    /** Já permutados (pago + 100% consumido antes) — estado CONCLUÍDO, fora de bloqueadas. */
    jaPermutado: number
  }
}

/**
 * Status de execução da baixa no ERP, por par adto↔invoice (Fase 3, ADR-0013).
 *
 * `settled` e `parcial` são os DOIS terminais (ADR-0044): `parcial` = houve baixa confirmada, mas
 * sobrou `valorResidualUsd` a re-alocar. Espelha À MÃO
 * `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts` (`ExecucaoStatus`) —
 * guarda de paridade em `lib/types.test.ts`.
 */
export type ExecucaoStatus = 'pending' | 'reconciling' | 'settled' | 'error' | 'parcial'

/** Resultado de UM par adto→invoice numa chamada de reconciliação. */
export interface ResultadoAlocacao {
  invoiceDocCod: string
  status: ExecucaoStatus | 'dry-run' | 'skipped'
  dryRun: boolean
  borCod?: number
  bxaCodSeq?: number
  valorBaixado?: number
  /** Resíduo NÃO baixado do valor alocado, em moeda negociada. Só em `parcial` (I-Recon-7b). */
  valorResidualUsd?: number
  erro?: string
  payload?: Record<string, unknown>
}

/** Resposta do POST /reconciliar (Fase 3). */
export interface ReconciliarResult {
  adiantamentoDocCod: string
  dryRun: boolean
  writeEnabled: boolean
  borCod?: number
  resultados: ResultadoAlocacao[]
}

/**
 * Status agregado de UM adiantamento dentro do lote de automáticas.
 *
 * ⚠️ O `'parcial'` DAQUI é outra coisa que o `'parcial'` de `ExecucaoStatus`: aqui significa
 * "alguns pares do adto deram settled, outros deram error"; lá, "a baixa deste par cobriu o
 * alocado só em parte". `'com-residuo'` (ADR-0044) é o segundo caso agregado ao adto: todos os
 * pares terminaram, sem erro, mas ao menos um deixou resíduo. Espelha à mão
 * `src/backend/domain/service/permutas/ReconciliacaoLotePermutaService.ts`.
 */
export type LoteAdiantamentoStatus =
  | 'settled'
  | 'parcial'
  | 'com-residuo'
  | 'error'
  | 'dry-run'
  | 'skipped'

/** Resultado por adiantamento no lote (POST /reconciliar-lote). */
export interface ReconciliarLoteItem {
  adiantamentoDocCod: string
  priCod?: string
  status: LoteAdiantamentoStatus
  borCod?: number
  erro?: string
}

/** Resposta agregada do POST /reconciliar-lote (executar todas as automáticas). */
export interface ReconciliarLoteResult {
  dryRun: boolean
  writeEnabled: boolean
  totalCasos: number
  totalSettled: number
  /** Baixas que entraram no ERP mas NÃO fecharam o alocado (resíduo a re-alocar). */
  totalParciais: number
  totalErros: number
  borderos: number[]
  resultados: ReconciliarLoteItem[]
}

/** Trilha persistida de execução (GET /execucoes). */
export interface ExecucaoPermuta {
  idempotencyKey: string
  adiantamentoDocCod: string
  invoiceDocCod: string
  filCod: number
  status: ExecucaoStatus
  dryRun: boolean
  borCod?: number
  bxaCodSeq?: number
  valorBaixado?: number
  /** Resíduo NÃO baixado do valor alocado, em moeda negociada. Só em `parcial` (I-Recon-7b). */
  valorResidualUsd?: number
  erroMensagem?: string
  executadoPor?: string
  criadoEm: string
  atualizadoEm: string
}

/**
 * Status da PERMUTA em relação ao seu borderô no fin010 (badge na tela de permutas).
 *
 * `parcial-aguardando-finalizacao` (B1', ADR-0044) afirma DUAS pendências: borderô a finalizar E
 * resíduo a re-alocar. Nunca é input de elegibilidade — o adto segue na fila. Espelha À MÃO
 * `src/backend/domain/service/permutas/BorderoGestaoService.ts` (`PermutaStatus`).
 */
export type PermutaStatusBordero =
  | 'aguardando-finalizacao'
  | 'parcial-aguardando-finalizacao'
  | 'finalizado'

/** Vínculo permuta→borderô (status vivo) — `GET /permutas/status`. */
export interface PermutaBorderoVinculo {
  borCod: number
  permutaStatus: PermutaStatusBordero
  situacao: BorderoSituacao
}

export interface PermutaStatusResponse {
  porAdiantamento: Record<string, PermutaBorderoVinculo>
}

/** Situação viva do borderô no ERP (Fase 3.1 — gestão de borderôs). */
export type BorderoSituacao =
  | 'EM_CADASTRO'
  | 'FINALIZADO'
  | 'CANCELADO'
  | 'ESTORNADO'
  | 'REMOVIDO'
  | 'INDISPONIVEL'

/** Uma baixa (par adto→invoice) dentro do borderô. */
export interface BaixaResumo {
  invoiceDocCod: string
  adiantamentoDocCod: string
  status: ExecucaoStatus
  valorBaixado?: number
  juros?: number
  contaJuros?: number
  bxaCodSeq?: number
  /** Mensagem de erro da baixa (só quando `status='error'`). */
  erroMensagem?: string
  criadoEm: string
}

/**
 * Relatórios exportáveis (.xlsx) do painel de Permutas — espelha o enum do
 * backend (`:tipo` de `GET /permutas/relatorios/:tipo`). Cada um vira um item no
 * menu "Exportar" e baixa um arquivo próprio (snapshot completo, sem filtros).
 */
export type RelatorioTipo =
  | 'adiantamentos'
  | 'invoices'
  | 'ja-permutado'
  | 'bloqueadas'
  | 'reconciliacao-processo'
  | 'clientes'

/** Descritor de um relatório para o menu de exportação (rótulo + ajuda). */
export interface RelatorioDescritor {
  tipo: RelatorioTipo
  label: string
  descricao: string
}

/** Relatórios oferecidos no menu "Exportar" (ordem = ordem de exibição). */
export const RELATORIOS_DISPONIVEIS: RelatorioDescritor[] = [
  {
    tipo: 'adiantamentos',
    label: 'Adiantamentos pendentes',
    descricao: 'Todos os adiantamentos, com detalhe (status, gates, datas, variação).',
  },
  {
    tipo: 'invoices',
    label: 'Invoices em aberto',
    descricao: 'Invoices finalizadas a casar, com cliente, moeda e taxa.',
  },
  {
    tipo: 'ja-permutado',
    label: 'Já permutado',
    descricao: 'Adiantamentos concluídos em permuta anterior.',
  },
  {
    tipo: 'bloqueadas',
    label: 'Bloqueadas',
    descricao: 'Adiantamentos bloqueados, com o motivo de cada bloqueio.',
  },
  {
    tipo: 'reconciliacao-processo',
    label: 'Reconciliação por processo',
    descricao: 'Resumo por processo: cardinalidade, cobertura, aging.',
  },
  {
    tipo: 'clientes',
    label: 'Quebra por cliente',
    descricao: 'Resumo por importador: volumes, valores e contagens de status.',
  },
]

/** Resumo de um borderô para a tela de gestão (trilha local + status vivo do ERP). */
export interface BorderoResumo {
  borCod: number
  filCod: number
  situacao: BorderoSituacao
  finalizado: boolean
  estornado: boolean
  criadoPor?: string
  criadoEm: string
  totalBaixado: number
  baixas: BaixaResumo[]
  /** Criado por este sistema (tem trilha)? Habilita as ações de escrita. */
  daTrilha?: boolean
}
