import { withAuthHeaders } from './auth/token'
import { lerArquivoDaResposta } from './download'
import { apiFetch } from './http'

/**
 * SISPAG (Escopo II) — cliente da API do painel READ-ONLY (spike / Fatia 1).
 * Bate em `GET /sispag/painel` (dados ao vivo do Conexos, só leitura). Os tipos
 * espelham `backend/domain/interface/sispag/SispagInterface.ts`.
 */

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

export interface TituloAPagar {
  docCod: string
  titCod: string
  filCod: number
  credor?: string
  valor: number
  moeda?: string
  vencimento?: number
  diasAteVencimento?: number
  liberado: boolean
  pago: boolean
  banco?: string
  numRemessa?: string
  pesCod?: string
  tpdCod?: string
  prontoParaRemessa?: boolean
  /**
   * O Conexos tem um boleto DDA (`fin124`) casado com este título — é o que permite a
   * remessa sair com código de barras. Persistido pela ingestão a partir do flag
   * `titVldReflexoDdaAssoc` do grid de pendentes; o código de barras em si NÃO existe no
   * título. Sem isto, marcar BOLETO no lote é barrado na geração da remessa.
   */
  temBoleto?: boolean
  ativo?: boolean
  /** Já está num lote RASCUNHO — não pode ser atachado a outro (bloqueia a seleção). */
  emLote?: boolean
  /** O lote RASCUNHO em que o título está (ADR-0050) — a linha mostra e linka o lote. */
  loteRascunho?: LoteRascunhoRef
}

/** Referência ao lote RASCUNHO que contém um título. */
export interface LoteRascunhoRef {
  id: string
  automatico: boolean
}

/** Chave natural de um título a pagar. */
export interface ChaveTitulo {
  filCod: number
  docCod: string
  titCod: string
}

export interface LoteSispag {
  filCod: number
  flpCod: number
  banco?: string
  conta?: string
  layoutConta?: string
  status: number
  envioConfirmado: boolean
  retornoProcessado: boolean
  titulosCount: number
  soma: number
  itensRetorno: number
  finalizadoPor?: string
  dataCredito?: number
}

export interface SispagKpis {
  titulosAVencer7d: number
  titulosAVencer30d: number
  titulosVencidos: number
  valorAVencer30d: number
  lotesAbertos: number
  lotesEnviados: number
}

export interface SispagPainel {
  geradoEm: string
  modo: {
    somenteLeitura: true
    conexosWriteEnabled: boolean
    conexosDryRun: boolean
  }
  ingestao: {
    ultimaRunEm?: string
  }
  kpis: SispagKpis
  titulos: TituloAPagar[]
  /** Tamanho da carteira antes do corte de payload — opcional para tolerar backend antigo. */
  titulosTotal?: number
  /** Execuções de escrita presas no meio — opcional para tolerar backend antigo. */
  execucoesParadas?: {
    remessa: number
    conciliacao: number
    desdeMinutos: number
    lotesNativos: number[]
  }
  lotes: LoteSispag[]
}

export interface PagamentoIngestaoRun {
  id: string
  triggeredBy: string
  status: 'running' | 'success' | 'error'
  totalTitulos: number
  totalInativados: number
  startedAt: string
  finishedAt?: string
  errorMessage?: string
}

export interface IngestaoPagamentosResult {
  runId: string
  status: 'success' | 'error'
  totalTitulos: number
  totalInativados: number
}

/** Lançado quando a ingestão devolve 409 — já existe uma rodando. */
export class IngestaoPagamentosEmAndamentoError extends Error {
  constructor(message = 'Já existe uma ingestão de pagamentos em andamento. Aguarde e tente de novo.') {
    super(message)
    this.name = 'IngestaoPagamentosEmAndamentoError'
  }
}

/** Busca o painel SISPAG (read-only). Lança em erro de rede/HTTP. */
export async function fetchSispagPainel(): Promise<SispagPainel> {
  const res = await apiFetch(`${API}/sispag/painel`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error ? ` — ${j.error}` : ''
    } catch {}
    throw new Error(`API ${res.status}${detail}`)
  }
  return (await res.json()) as SispagPainel
}

// ============================================================ Fatia 2 — Lote candidato
// Montagem local (sem escrita no ERP). Espelha backend/interface/sispag/SispagInterface.ts.

export type LotePagamentoStatus =
  | 'RASCUNHO'
  | 'FINALIZADO'
  /** Remessa .REM gerada no Conexos. NÃO é "enviado": o ERP não transmite ao banco. */
  | 'REMESSA_GERADA'
  /** Retorno .RET do banco processado e conciliado. */
  | 'RETORNADO'
  /** Baixa confirmada no fin010 para todos os itens. */
  | 'BAIXADO'
  | 'CANCELADO'

export type Modalidade = 'BOLETO' | 'TED' | 'PIX' | 'CREDITO_CONTA'

/**
 * Rótulos das formas de pagamento (A2) para o seletor da revisão. `oculta` = não é oferecida
 * para escolha, mas o rótulo continua aqui para exibir item que já a tem. Crédito em conta está
 * oculto: não foi testado ponta a ponta e não é prioridade agora (2026-09-28).
 */
export const MODALIDADES: { value: Modalidade; label: string; oculta?: boolean }[] = [
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'TED', label: 'TED' },
  { value: 'PIX', label: 'PIX' },
  { value: 'CREDITO_CONTA', label: 'Crédito em conta', oculta: true },
]

/** Formas que o seletor oferece (exclui as ocultas). */
export const MODALIDADES_OFERECIDAS = MODALIDADES.filter((m) => !m.oculta)

/** Situação derivada de um item do lote pela sincronização (ADR-0055, I11d). */
export type ItemSituacao = 'AGENDADO' | 'PAGO' | 'REJEITADO' | 'SEM_RETORNO'

/** De onde veio a baixa de um item pago (ADR-0055). */
export type OrigemBaixa = 'REMESSA' | 'FORA_DO_RETORNO' | 'NAO_IDENTIFICADA'

/** Estados em que o lote pode ser sincronizado ("Sincronizar agora"). */
export const STATUS_SINCRONIZAVEIS: readonly LotePagamentoStatus[] = [
  'REMESSA_GERADA',
  'RETORNADO',
  'BAIXADO',
]

/** Última leitura bem-sucedida entre os itens do lote (ISO) — o "sincronizado em" do card. */
export function ultimaSincronizacao(lote: LotePagamento): string | undefined {
  const datas = lote.itens
    .map((i) => i.sincronizadoEm)
    .filter((d): d is string => typeof d === 'string')
    .sort()
  return datas[datas.length - 1]
}

export interface ItemLote {
  loteId: string
  filCod: number
  docCod: string
  titCod: string
  credor?: string
  valor?: number
  vencimento?: number
  /** Forma de pagamento (A2). Ausente = "a definir" — bloqueia a finalização. */
  modalidade?: Modalidade
  incluidoPor: string
  incluidoEm?: string
  // ── resultado da conciliação do retorno ──
  /** Código do evento bancário. Itaú: `00` = PAGAMENTO EFETUADO. */
  retornoEvento?: string
  retornoDescricao?: string
  /** `true` quando o banco rejeitou este item. */
  rejeitado?: boolean
  /** Borderô e baixa no fin010 — o elo que o ERP não guarda consultável. */
  borCod?: number
  bxaCodSeq?: number
  conciliadoEm?: string
  // ── sincronização pelo título (ADR-0055) ──
  /** Situação derivada do item. Ausente = nunca sincronizado. */
  situacao?: ItemSituacao
  /** Data (ISO) da baixa, das baixas do título no Conexos quando legíveis. */
  pagoEm?: string
  /** Primeira sincronização (ISO) que viu o título pago. */
  pagoObservadoEm?: string
  valorPago?: number
  origemBaixa?: OrigemBaixa
  baixaFonte?: 'RETORNO' | 'TITULO'
  /** Contradição que a máquina não resolve (estorno, rejeitado com título pago). */
  divergencia?: boolean
  divergenciaDetalhe?: string
  /** Última leitura bem-sucedida do título (ISO). */
  sincronizadoEm?: string
  /**
   * Destino digitado pela analista (ADR-0054), SÓ mascarado — a API nunca manda o valor inteiro,
   * e a tela exibe este texto como veio (não re-mascara).
   */
  destinoManualResumo?: DestinoManualResumo
}

/**
 * Aprovação do destino digitado (ADR-0054 D10/D11): conta (TED) digitada nasce `PENDENTE` e só
 * quem tem `sispag:aprovar_destino` aprova; chave PIX CPF/CNPJ é `NAO_EXIGIDA`.
 */
export type DestinoAprovacao = 'NAO_EXIGIDA' | 'PENDENTE' | 'APROVADO'

/** Máscara do destino digitado + quem informou + estado da aprovação. */
export interface DestinoManualResumo {
  tipo: 'CONTA' | 'CHAVE_PIX'
  destinoMascarado: string
  /** CPF/CNPJ do titular, já mascarado pelo backend — é o que o aprovador confere. */
  titularDocumentoMascarado?: string
  informadoPor?: string
  informadoEm?: string
  /** Ausente = backend anterior ao D10: tratado como não exigida. */
  aprovacao?: DestinoAprovacao
  aprovadoPor?: string
  aprovadoEm?: string
}

/** Destino que a oferta mostra para TED/PIX: origem + máscara (só com as flags ligadas). */
export interface DestinoOfertado {
  origem: 'CADASTRO' | 'MANUAL' | 'NENHUM'
  destinoMascarado?: string
  /**
   * Só no PIX (D12): chave CPF/CNPJ que é o próprio documento do favorecido. A tela lista PIX
   * antes de TED e abre "Informar destino" na aba PIX.
   */
  chaveCpfCnpjDoFavorecido?: boolean
}

/** Uma linha da oferta de formas de pagamento de um item. */
export interface OfertaModalidadesItem {
  docCod: string
  titCod: string
  modalidades: Modalidade[]
  destinos?: Partial<Record<'TED' | 'PIX', DestinoOfertado>>
}

export interface LotePagamento {
  id: string
  filCod: number
  banco?: string
  conta?: string
  status: LotePagamentoStatus
  criadoPor: string
  finalizadoPor?: string
  finalizadoEm?: string
  versao: number
  criadoEm?: string
  /** Formado pelo cron de formação automática (vs. montado manualmente). */
  automatico?: boolean
  // ── ponte com o lote NATIVO do Conexos (fin015) ──
  nativeFlpCod?: number
  nativeGabCod?: number
  remessaArquivo?: string
  remessaNum?: number
  remessaGeradaEm?: string
  /** Conta financeira (plano gerencial) da conta pagadora. */
  gerNum?: number
  /**
   * Data de débito da remessa (`'YYYY-MM-DD'`, data civil — ADR-0049). Congelada a partir do
   * lote nativo do fin015. Exibir com `formatCivilDate`, nunca com `new Date(...)`.
   */
  dataDebito?: string
  itens: ItemLote[]
}

export interface FormacaoLotesResult {
  lotesFormados: number
  titulosLotados: number
  lotesDesfeitos: number
}

/** Chamada que devolve `{ lote }` — lança Error com a mensagem do backend (409/422). */
async function loteRequest(path: string, init?: RequestInit): Promise<LotePagamento> {
  const res = await apiFetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(await withAuthHeaders()) },
  })
  if (!res.ok) {
    let msg = `API ${res.status}`
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch {}
    throw new Error(msg)
  }
  const j = (await res.json()) as { lote: LotePagamento }
  return j.lote
}

export async function fetchLotes(
  filtro: { status?: LotePagamentoStatus; filCod?: number } = {},
): Promise<LotePagamento[]> {
  const qs = new URLSearchParams()
  if (filtro.status) qs.set('status', filtro.status)
  if (filtro.filCod != null) qs.set('filCod', String(filtro.filCod))
  const q = qs.toString()
  const res = await apiFetch(`${API}/sispag/lotes${q ? `?${q}` : ''}`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const j = (await res.json()) as { lotes: LotePagamento[] }
  return j.lotes ?? []
}

export const criarLote = (input: { filCod: number; banco?: string; conta?: string }) =>
  loteRequest('/sispag/lotes', { method: 'POST', body: JSON.stringify(input) })

export const incluirTitulo = (
  loteId: string,
  input: { filCod: number; docCod: string; titCod: string },
) =>
  loteRequest(`/sispag/lotes/${loteId}/itens`, { method: 'POST', body: JSON.stringify(input) })

export const removerItem = (
  loteId: string,
  input: { filCod: number; docCod: string; titCod: string },
) =>
  loteRequest(
    `/sispag/lotes/${loteId}/itens/${input.filCod}/${encodeURIComponent(input.docCod)}/${encodeURIComponent(input.titCod)}`,
    { method: 'DELETE' },
  )

const rotaTitulo = (c: ChaveTitulo) =>
  `/sispag/titulos/${c.filCod}/${encodeURIComponent(c.docCod)}/${encodeURIComponent(c.titCod)}`

/**
 * "Retirar do lote" (ADR-0050): tira o título do lote RASCUNHO em que está. Ele fica solto e
 * pode ir para outro lote.
 */
export const retirarDoLote = (chave: ChaveTitulo) =>
  loteRequest(`${rotaTitulo(chave)}/retirar-do-lote`, { method: 'POST' })

export const finalizarLote = (loteId: string, versao: number) =>
  loteRequest(`/sispag/lotes/${loteId}/finalizar`, {
    method: 'POST',
    body: JSON.stringify({ versao }),
  })

export const reabrirLote = (loteId: string, versao: number) =>
  loteRequest(`/sispag/lotes/${loteId}/reabrir`, { method: 'POST', body: JSON.stringify({ versao }) })

export const cancelarLote = (loteId: string, versao: number) =>
  loteRequest(`/sispag/lotes/${loteId}/cancelar`, {
    method: 'POST',
    body: JSON.stringify({ versao }),
  })

/**
 * "Sincronizar agora" (ADR-0055): relê no Conexos a baixa dos títulos do lote e atualiza a
 * situação de cada item e o status do lote. Só leitura no ERP. Devolve o lote atualizado.
 */
export const sincronizarLote = (loteId: string) =>
  loteRequest(`/sispag/lotes/${loteId}/sincronizar`, { method: 'POST' })

// ══════════════════════════════════════════ Fatia 3 — remessa e conciliação

export interface GerarRemessaResult {
  status: 'gerada' | 'dry-run' | 'skipped'
  dryRun: boolean
  writeEnabled: boolean
  loteId: string
  nativeFlpCod?: number
  nativeGabCod?: number
  arquivo?: string
  numRemessa?: number
  conteudo?: string
  itens: number
  valorTotal: number
  /** Data de débito usada (`'YYYY-MM-DD'`). */
  dataDebito?: string
}

/** Título cujo vencimento limita a janela de débito. */
export interface TituloLimitante {
  itemId: string
  credor?: string
  /** `docCod/titCod`. */
  documento: string
  vencimento?: string
}

/**
 * Janela permitida da data de débito (espelha `JanelaDataDebito` do backend). O calendário
 * bancário mora SÓ no backend: a tela exibe estes campos e não recalcula dia útil nenhum.
 */
export interface JanelaDataDebito {
  /** Hoje em Brasília. */
  hoje: string
  sugerida?: string
  /** Próximo dia útil depois de hoje, quando cabe na janela. */
  amanha?: string
  min?: string
  max?: string
  limitante?: TituloLimitante
  /** Dias não úteis dentro de `[min, max]`. */
  naoUteis: string[]
  vazia?: { motivo: 'titulo_vencido' | 'sem_dia_util' | 'titulo_sem_vencimento' }
  congelada?: { data: string; nativeFlpCod: number; motivo: 'lote_nativo_criado' | 'no_passado' }
}

/**
 * `'2026-09-22'` → `'22/09'`. Por split de string, nunca `new Date(...)`: um `Date` de data
 * civil nasce à meia-noite UTC e, exibido em Brasília, recua um dia.
 */
export function formatCivilDate(civil: string): string {
  const [, mes, dia] = civil.split('-')
  return `${dia}/${mes}`
}

/**
 * Vencimento do ERP (epoch-ms) → `'24/09/2026'`. O Conexos grava 00:00Z do dia pretendido; lido
 * no fuso do navegador (Brasília, UTC-3), esse instante vira 21h do dia anterior. Por isso o dia
 * sai sempre em UTC — a mesma regra do `BankingCalendar.fromErpEpoch` no backend.
 */
export function formatErpDay(ms?: number): string {
  return ms == null ? '—' : new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

export interface ItemConciliado {
  loteId?: string
  docCod?: string
  titCod?: string
  flpCod?: number
  itsCodSeq?: number
  evento?: string
  descricao?: string
  rejeitado: boolean
  borCod?: number
  bxaCodSeq?: number
  contaFinanceira?: number
  valorPago?: number
  /** `false` quando a linha não casou com nenhum lote nosso (montado direto no ERP). */
  reconhecido: boolean
}

export interface ConciliarResult {
  dryRun: boolean
  writeEnabled: boolean
  processado: boolean
  totalLinhas: number
  pagos: number
  rejeitados: number
  naoReconhecidos: number
  lotesAfetados: string[]
  itens: ItemConciliado[]
  /** Algum código de evento não pôde ser lido — a conciliação é parcial. */
  varreduraIncompleta?: boolean
  eventosNaoLidos?: Array<{ evento: string; motivo: string }>
}

/**
 * Erros de domínio que a tela precisa distinguir de uma falha genérica, porque cada um
 * pede uma ação humana diferente.
 */
export class RemessaEmDuvidaError extends Error {
  constructor(
    message: string,
    /** Lote nativo possivelmente órfão no Conexos — é por onde a pessoa investiga. */
    readonly nativeFlpCod?: number,
  ) {
    super(message)
    this.name = 'RemessaEmDuvidaError'
  }
}

/**
 * O lote nativo da tentativa anterior foi cancelado no Conexos por uma pessoa.
 * Não é falha: é uma bifurcação que só quem cancelou resolve — limpar um órfão travado
 * e abortar um pagamento deixam o MESMO estado no ERP. A tela pergunta.
 */
export class LoteAnteriorCanceladoError extends Error {
  constructor(
    message: string,
    readonly flpCodCancelado?: number,
  ) {
    super(message)
    this.name = 'LoteAnteriorCanceladoError'
  }
}

/** A data de débito pedida está fora da janela do lote (ou a janela está vazia). */
export class DebitDateOutsideWindowError extends Error {
  constructor(
    message: string,
    readonly details: {
      dataDebito?: string
      min?: string
      max?: string
      motivo?: string
      limitante?: TituloLimitante
    } = {},
  ) {
    super(message)
    this.name = 'DebitDateOutsideWindowError'
  }
}

/** O lote nativo já nasceu no Conexos com outra data — mudar exige cancelar no fin015. */
export class DebitDateFrozenError extends Error {
  constructor(
    message: string,
    readonly details: {
      motivo?: 'diferente' | 'no_passado'
      dataCongelada?: string
      nativeFlpCod?: number
    } = {},
  ) {
    super(message)
    this.name = 'DebitDateFrozenError'
  }
}

/** Já existe uma geração em curso para este lote — esperar resolve. */
export class RemessaEmAndamentoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemessaEmAndamentoError'
  }
}

/** Conciliação em dúvida: o `processar` anterior não confirmou. NÃO repetir sem conferir. */
export class ConciliacaoEmDuvidaError extends Error {
  constructor(
    message: string,
    readonly garCodSeq?: number,
  ) {
    super(message)
    this.name = 'ConciliacaoEmDuvidaError'
  }
}

export class ErpPerguntaError extends Error {
  constructor(
    message: string,
    readonly chave?: string,
  ) {
    super(message)
    this.name = 'ErpPerguntaError'
  }
}

/** Traduz os códigos do backend em erros tipados; o resto vira Error comum. */
async function sispagRequest<T>(path: string, init: RequestInit): Promise<T> {
  const res = await apiFetch(`${API}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...((init.headers ?? {}) as Record<string, string>),
      ...(await withAuthHeaders()),
    },
  })
  const body = await res.json().catch(() => ({}) as Record<string, unknown>)
  if (!res.ok) {
    const msg = String(body.error ?? `Falha (${res.status})`)
    const det = (body.details ?? {}) as Record<string, unknown>
    if (body.code === 'REMESSA_EM_DUVIDA') {
      throw new RemessaEmDuvidaError(msg, det.nativeFlpCod as number | undefined)
    }
    if (body.code === 'REMESSA_EM_ANDAMENTO') {
      throw new RemessaEmAndamentoError(msg)
    }
    if (body.code === 'CONCILIACAO_EM_DUVIDA') {
      throw new ConciliacaoEmDuvidaError(msg, det.garCodSeq as number | undefined)
    }
    if (body.code === 'LOTE_ANTERIOR_CANCELADO') {
      throw new LoteAnteriorCanceladoError(msg, det.flpCodCancelado as number | undefined)
    }
    if (body.code === 'DATA_DEBITO_FORA_DA_JANELA') {
      throw new DebitDateOutsideWindowError(msg, det as DebitDateOutsideWindowError['details'])
    }
    if (body.code === 'DATA_DEBITO_CONGELADA') {
      throw new DebitDateFrozenError(msg, det as DebitDateFrozenError['details'])
    }
    if (body.code === 'ERP_PERGUNTA') {
      throw new ErpPerguntaError(msg, det.chave as string | undefined)
    }
    throw new Error(msg)
  }
  return body as T
}

/**
 * Gera a remessa `.REM` de um lote FINALIZADO, dirigindo o fin015.
 *
 * `Idempotency-Key` derivada do lote: duas tentativas para o MESMO lote colidem de
 * propósito. As escritas do fin015 não são idempotentes — sem isso, um duplo clique
 * ou um retry após timeout viraria um segundo lote de pagamento.
 */
export const gerarRemessa = (
  loteId: string,
  opts?: { dryRun?: boolean; confirmarNovoLote?: boolean; dataDebito?: string },
) =>
  sispagRequest<GerarRemessaResult>(`/sispag/lotes/${loteId}/remessa`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `remessa:${loteId}` },
    body: JSON.stringify({
      dryRun: opts?.dryRun ?? false,
      // Só vai quando a pessoa confirmou no diálogo — nunca por default.
      ...(opts?.confirmarNovoLote ? { confirmarNovoLote: true } : {}),
      // Ausente = o backend usa o primeiro dia útil da janela.
      ...(opts?.dataDebito ? { dataDebito: opts.dataDebito } : {}),
    }),
  })

/** Janela permitida da data de débito de um lote FINALIZADO (ADR-0049). Leitura. */
export const fetchJanelaDataDebito = (loteId: string) =>
  sispagRequest<JanelaDataDebito>(`/sispag/lotes/${loteId}/remessa/janela`, { method: 'GET' })

/**
 * Baixa o `.REM` já gerado (CNAB 240) e devolve os BYTES como vieram do backend.
 * Nunca `res.text()`: ele decodifica sempre como UTF-8, e o backend manda latin1 de
 * propósito. Um "Ç" no nome do favorecido viraria U+FFFD (3 bytes ao regravar) e
 * deslocaria as colunas fixas do registro — o banco recusa ou lê os campos errados.
 * A leitura dos bytes (e a conferência de integridade) mora em `lib/download.ts`.
 */
export async function baixarRemessa(loteId: string): Promise<{ nome: string; arquivo: Blob }> {
  const res = await apiFetch(`${API}/sispag/lotes/${loteId}/remessa/arquivo`, {
    headers: { ...(await withAuthHeaders()) },
  })
  if (!res.ok) throw new Error(`Falha ao baixar a remessa (${res.status})`)
  return lerArquivoDaResposta(res, `lote-${loteId}.REM`)
}

/**
 * Concilia um arquivo de retorno: lê o detalhe do `.RET` e traz borderô, baixa e evento
 * bancário para os itens dos nossos lotes. Com `processar: true`, manda o ERP processar
 * o arquivo antes — é o passo que GERA AS BAIXAS no fin010.
 */
export const conciliarRetorno = (input: {
  filCod: number
  bncCod: number
  gtbCodSeq: number
  garCodSeq: number
  processar?: boolean
  dryRun?: boolean
}) =>
  sispagRequest<ConciliarResult>('/sispag/retornos/conciliar', {
    method: 'POST',
    body: JSON.stringify(input),
  })

/** Conta corrente pagadora da filial, lida do `fin005`. */
export interface ContaPagadora {
  ccoCod: number
  /** Código INTERNO do banco no Conexos (≠ FEBRABAN). */
  bncCod: number
  agencia?: string
  numeroConta?: number
  dvConta?: string
  /** Conta financeira (plano gerencial) vinculada. */
  gerNum?: number
  gerDes?: string
}

/**
 * Contas pagadoras REAIS da filial (A3).
 *
 * Substitui uma lista fixa de duas contas (Itaú e Santander). A filial tem 17 no
 * `fin005`, e a escolha importa: um favorecido só recebe se a conta pagadora for do
 * MESMO banco da conta dele. Com a lista fixa, todo favorecido de outro banco ficava
 * impossível de pagar pela tela — o serviço recusava, corretamente, e não havia como
 * escolher a conta que resolveria.
 */
export async function fetchContasPagadoras(filCod: number): Promise<ContaPagadora[]> {
  const res = await apiFetch(`${API}/sispag/contas-pagadoras?filCod=${filCod}`, {
    headers: { ...(await withAuthHeaders()) },
  })
  if (!res.ok) throw new Error(`Falha ao carregar as contas pagadoras (${res.status})`)
  const j = (await res.json()) as { contas: ContaPagadora[] }
  return j.contas ?? []
}

/** Rótulo legível de uma conta pagadora, para o seletor. */
export const rotuloConta = (c: ContaPagadora): string => {
  const nome = BANCO_NOME[c.bncCod] ?? `banco ${c.bncCod}`
  return `${nome} · ag ${c.agencia ?? '—'} · ${c.numeroConta ?? '—'}-${c.dvConta ?? ''}`
}

/** Nome do banco pelo código INTERNO do Conexos (o `bncCod`, não o FEBRABAN). */
const BANCO_NOME: Record<number, string> = {
  3: 'Banco do Brasil',
  4: 'Itaú',
  6: 'Banco 6',
  7: 'Bradesco',
  8: 'Safra',
  10: 'Santander',
  11: 'Banestes',
  14: 'Banco 14',
  15: 'Daycoval',
  25: 'Votorantim',
  35: 'Pine',
  38: 'Original',
  39: 'Banco 39',
  44: 'XP',
}

/** A3 — troca a conta pagadora do lote (só RASCUNHO; optimistic lock por versao). */
export const atualizarContaPagadora = (
  loteId: string,
  input: { versao: number; banco: string; conta: string },
) =>
  loteRequest(`/sispag/lotes/${loteId}/conta`, {
    method: 'POST',
    body: JSON.stringify(input),
  })

/** Um arquivo de retorno (.RET) do fin052 — read-only. */
export interface ArquivoRetorno {
  filCod: number
  bncCod: number
  gtbCodSeq: number
  garCodSeq: number
  arquivo?: string
  status?: number
  statusProcessamento?: number
  configNome?: string
  banco?: string
  erros?: number
  titulosRejeitados?: number
  cadastradoEm?: number
  processadoEm?: number
}

/** Retornos (.RET) do fin052, ao vivo. READ-ONLY (upload/processar = fase futura). */
export async function fetchRetornos(): Promise<ArquivoRetorno[]> {
  const res = await apiFetch(`${API}/sispag/retornos`, { headers: await withAuthHeaders() })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const j = (await res.json()) as { arquivos: ArquivoRetorno[] }
  return j.arquivos ?? []
}

/** Uma linha digitável já conferida (47 dígitos + 4 verificadores) no backend. */
export type ItemLinhaDigitavel = { docCod: string; titCod: string; linhaDigitavel: string }

/** Resposta de `fetchLinhasDigitaveis`. Invariante: `itens.length + dropped === total`. */
export type LinhasDigitaveis = {
  itens: ItemLinhaDigitavel[]
  /** Itens do lote que afirmam ter boleto (`itsNumCodbar` presente). */
  total: number
  /** Quantos desses foram recusados por dígito verificador inválido. */
  dropped: number
}

/**
 * Linhas digitáveis dos boletos do lote (47 dígitos — o que se cola no app do banco).
 *
 * Só há dado depois da remessa gerada: o Conexos anexa o código ao item durante o import
 * (ADR-0040). Em rascunho volta lista vazia, e isso é o estágio, não uma falha.
 *
 * `total`/`dropped` contam os itens que afirmam ter boleto e quantos desses o backend recusou
 * por dígito verificador inválido. É o que permite à tela distinguir "não é boleto" de "o
 * código veio corrompido" em vez de só não mostrar o botão.
 */
export async function fetchLinhasDigitaveis(loteId: string): Promise<LinhasDigitaveis> {
  const res = await apiFetch(`${API}/sispag/lotes/${loteId}/linhas-digitaveis`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const j = (await res.json()) as Partial<LinhasDigitaveis>
  const itens = j.itens ?? []
  return { itens, total: j.total ?? itens.length, dropped: j.dropped ?? 0 }
}

/** A2 opção B — formas de pagamento disponíveis (cadastro do favorecido) por item do lote, ao vivo. */
export async function fetchModalidadesDisponiveis(
  loteId: string,
): Promise<OfertaModalidadesItem[]> {
  const res = await apiFetch(`${API}/sispag/lotes/${loteId}/modalidades-disponiveis`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const j = (await res.json()) as { itens: OfertaModalidadesItem[] }
  return j.itens ?? []
}

/** A2 — define a forma de pagamento de um item (só RASCUNHO; optimistic lock por versao). */
export const atualizarModalidadeItem = (
  loteId: string,
  input: { filCod: number; docCod: string; titCod: string; versao: number; modalidade: Modalidade },
) =>
  loteRequest(
    `/sispag/lotes/${loteId}/itens/${input.filCod}/${encodeURIComponent(input.docCod)}/${encodeURIComponent(input.titCod)}/modalidade`,
    { method: 'POST', body: JSON.stringify({ versao: input.versao, modalidade: input.modalidade }) },
  )

// ============================================================ Ingestão de pagamentos

/** Dispara a ingestão manual da carteira. 409 → IngestaoPagamentosEmAndamentoError. */
export async function runIngestaoPagamentos(): Promise<IngestaoPagamentosResult> {
  const res = await apiFetch(`${API}/sispag/ingestao`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await withAuthHeaders()) },
  })
  if (res.status === 409) throw new IngestaoPagamentosEmAndamentoError()
  if (!res.ok) throw new Error(`API ${res.status}`)
  return (await res.json()) as IngestaoPagamentosResult
}

export async function fetchIngestaoRuns(limit = 10): Promise<PagamentoIngestaoRun[]> {
  const res = await apiFetch(`${API}/sispag/ingestao/runs?limit=${limit}`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const j = (await res.json()) as { runs: PagamentoIngestaoRun[] }
  return j.runs ?? []
}

/** Dispara a formação automática de lotes candidatos (mesmo motor do cron). */
export async function formarLotes(): Promise<FormacaoLotesResult> {
  const res = await apiFetch(`${API}/sispag/lotes/formar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await withAuthHeaders()) },
  })
  if (res.status === 409)
    throw new Error('Já existe uma formação de lotes em andamento. Aguarde e tente de novo.')
  if (!res.ok) throw new Error(`API ${res.status}`)
  return (await res.json()) as FormacaoLotesResult
}

// ============================================================ Boletos DDA (fin124)
// Snapshot do pool DDA consolidado contra a carteira. Espelha
// backend/domain/interface/sispag/BoletoDda.ts.

export type BoletoDdaSituacao = 'VINCULADO' | 'CANDIDATO' | 'AMBIGUO' | 'SEM_TITULO'
export type BoletoDdaEscopo = 'a-vencer' | 'todos'

export interface BoletoDdaTitulo {
  filCod: number
  docCod: string
  titCod: string
  credor?: string
  valor?: number
  /** `YYYY-MM-DD` */
  vencimento?: string
  /** Vencimento do boleto − vencimento do título, em dias. */
  diferencaDias?: number
  temBoletoDda?: boolean
  lote?: { loteId: string; status: string }
}

export interface BoletoDda {
  ddcCod: number
  ditCod: number
  arquivo?: string
  importadoEm?: number
  numero?: string
  valor: number
  /** `YYYY-MM-DD` */
  vencimento?: string
  vencido: boolean
  codbar?: string
  linhaDigitavel?: string
  bancoEmissor?: string
  situacao: BoletoDdaSituacao
  vinculo?: BoletoDdaTitulo & { flpCod?: number }
  candidatos: BoletoDdaTitulo[]
}

export type BoletoDdaContagem = Record<BoletoDdaSituacao | 'todas', number>

/** Uma PÁGINA da aba — o backend filtra e pagina; o pool inteiro nunca vem ao navegador. */
export interface BoletosDdaResposta {
  boletos: BoletoDda[]
  /** Linhas depois de todos os filtros — base da paginação. */
  total: number
  pagina: number
  tamanho: number
  /** Por situação, depois de filial + busca e antes do filtro de situação (chips). */
  contagem: BoletoDdaContagem
  filiais: number[]
  sincronizadoEm?: number
  janelaDias: number
}

export interface FiltroBoletosDda {
  escopo: BoletoDdaEscopo
  situacao?: BoletoDdaSituacao
  busca?: string
  filCod?: number
  pagina: number
  tamanho?: number
}

export interface SincronizacaoDdaResultado {
  arquivosNovos: number
  arquivosRelidos: number
  boletos: number
  falhas: number
}

/** Lançado quando a sincronização devolve 409 — já existe uma rodando. */
export class SincronizacaoDdaEmAndamentoError extends Error {
  constructor(message = 'Já existe uma sincronização do DDA em andamento. Aguarde e tente de novo.') {
    super(message)
    this.name = 'SincronizacaoDdaEmAndamentoError'
  }
}

export async function fetchBoletosDda(filtro: FiltroBoletosDda): Promise<BoletosDdaResposta> {
  const qs = new URLSearchParams({ escopo: filtro.escopo, pagina: String(filtro.pagina) })
  if (filtro.situacao) qs.set('situacao', filtro.situacao)
  if (filtro.busca?.trim()) qs.set('busca', filtro.busca.trim())
  if (filtro.filCod != null) qs.set('filCod', String(filtro.filCod))
  if (filtro.tamanho != null) qs.set('tamanho', String(filtro.tamanho))
  const res = await apiFetch(`${API}/sispag/boletos-dda?${qs.toString()}`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) {
    let msg = `API ${res.status}`
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch {}
    throw new Error(msg)
  }
  return (await res.json()) as BoletosDdaResposta
}

export async function sincronizarBoletosDda(): Promise<SincronizacaoDdaResultado> {
  const res = await apiFetch(`${API}/sispag/boletos-dda/sincronizar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await withAuthHeaders()) },
  })
  if (res.status === 409) throw new SincronizacaoDdaEmAndamentoError()
  if (!res.ok) throw new Error(`API ${res.status}`)
  return (await res.json()) as SincronizacaoDdaResultado
}

// ============================================================ ADR-0054 — destino de TED/PIX

/** Flags de TED/PIX/destino manual expostas pelo backend (`GET /sispag/recursos`). */
export interface RecursosSispag {
  tedEnabled: boolean
  destinoManualEnabled: boolean
  pixEnabled: boolean
}

const RECURSOS_DESLIGADOS: RecursosSispag = {
  tedEnabled: false,
  destinoManualEnabled: false,
  pixEnabled: false,
}

let recursosEmCache: Promise<RecursosSispag> | null = null

/** Só para testes: esquece o cache de `getRecursos`. */
export function __limparCacheRecursos(): void {
  recursosEmCache = null
}

/**
 * Flags do SISPAG para a tela. Lidas uma vez por carga de página (vários cards de lote pedem).
 * Falha de leitura = tudo desligado: a tela fica idêntica à de antes do TED/PIX.
 */
export function getRecursos(): Promise<RecursosSispag> {
  if (!recursosEmCache) {
    recursosEmCache = (async () => {
      try {
        const res = await apiFetch(`${API}/sispag/recursos`, { headers: await withAuthHeaders() })
        if (!res.ok) throw new Error(`API ${res.status}`)
        const j = (await res.json()) as Partial<Record<keyof RecursosSispag, unknown>>
        return {
          tedEnabled: j.tedEnabled === true,
          destinoManualEnabled: j.destinoManualEnabled === true,
          pixEnabled: j.pixEnabled === true,
        }
      } catch {
        recursosEmCache = null
        return RECURSOS_DESLIGADOS
      }
    })()
  }
  return recursosEmCache
}

export type ChavePixTipo = 'CPF_CNPJ' | 'EMAIL' | 'TELEFONE' | 'ALEATORIA'

export const TIPOS_CHAVE_PIX: { value: ChavePixTipo; label: string }[] = [
  { value: 'CPF_CNPJ', label: 'CPF/CNPJ' },
  { value: 'EMAIL', label: 'E-mail' },
  { value: 'TELEFONE', label: 'Telefone' },
  { value: 'ALEATORIA', label: 'Chave aleatória' },
]

/**
 * Tipos de chave que a analista pode DIGITAR. Só CPF/CNPJ: é o único em que dá para conferir o
 * titular (a chave é o próprio documento). O dono das outras está no DICT, que só banco consulta.
 * Chave que vem do cadastro do Conexos pode ser de qualquer tipo.
 */
export const TIPOS_CHAVE_PIX_DIGITAVEIS = TIPOS_CHAVE_PIX.filter((t) => t.value === 'CPF_CNPJ')

export type DestinoManual =
  | {
      tipo: 'CONTA'
      bancoCod: string
      agencia: string
      agenciaDv?: string
      conta: string
      contaDv: string
      titularDocumento: string
    }
  | { tipo: 'CHAVE_PIX'; chavePixTipo: ChavePixTipo; chavePix: string; titularDocumento: string }

/** O que o formulário digita — tudo texto, antes de normalizar. */
export type DestinoManualEntrada =
  | {
      tipo: 'CONTA'
      bancoCod: string
      agencia: string
      agenciaDv: string
      conta: string
      contaDv: string
      titularDocumento: string
    }
  | { tipo: 'CHAVE_PIX'; chavePixTipo: ChavePixTipo; chavePix: string; titularDocumento: string }

const soDigitos = (v: string): string => v.replace(/\D/g, '')

/** CPF (11) ou CNPJ (14) com DV válido — a mesma conta do backend. */
export function documentoValido(doc: string): boolean {
  if (!/^(\d{11}|\d{14})$/.test(doc) || /^(\d)\1+$/.test(doc)) return false
  const n = doc.split('').map(Number)
  if (doc.length === 11) {
    const dv = (ate: number) => {
      let soma = 0
      for (let i = 0; i < ate; i += 1) soma += (n[i] ?? 0) * (ate + 1 - i)
      const r = (soma * 10) % 11
      return r === 10 ? 0 : r
    }
    return dv(9) === n[9] && dv(10) === n[10]
  }
  const dv = (ate: number) => {
    const pesos =
      ate === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let soma = 0
    for (let i = 0; i < ate; i += 1) soma += (n[i] ?? 0) * (pesos[i] ?? 0)
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(12) === n[12] && dv(13) === n[13]
}

const normalizarChave = (tipo: ChavePixTipo, chave: string): string => {
  const c = chave.trim()
  if (tipo === 'CPF_CNPJ') return soDigitos(c)
  if (tipo === 'TELEFONE') {
    const d = soDigitos(c)
    return !c.startsWith('+') && (d.length === 10 || d.length === 11) ? `+55${d}` : `+${d}`
  }
  return c.toLowerCase()
}

const chaveValida = (tipo: ChavePixTipo, chave: string): boolean => {
  if (tipo === 'CPF_CNPJ') return documentoValido(chave)
  if (tipo === 'EMAIL')
    return chave.length <= 77 && /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(chave)
  if (tipo === 'TELEFONE') return /^\+55[1-9][1-9]\d{8,9}$/.test(chave)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(chave)
}

/**
 * Validação de FORMATO no cliente, espelhando o `DestinoManualValidator` do backend (que é quem
 * decide — e confere a titularidade). As mensagens nunca repetem o valor digitado.
 */
export function validarDestinoManual(e: DestinoManualEntrada): {
  destino?: DestinoManual
  erros: Partial<Record<string, string>>
} {
  const erros: Partial<Record<string, string>> = {}
  const titular = soDigitos(e.titularDocumento)
  if (!documentoValido(titular)) erros.titularDocumento = 'CPF/CNPJ inválido.'
  if (e.tipo === 'CONTA') {
    const v = {
      bancoCod: e.bancoCod.trim(),
      agencia: e.agencia.trim(),
      agenciaDv: e.agenciaDv.trim(),
      conta: e.conta.trim(),
      contaDv: e.contaDv.trim(),
    }
    if (!/^\d{3}$/.test(v.bancoCod)) erros.bancoCod = 'Use o código FEBRABAN de 3 dígitos.'
    if (!/^\d{1,5}$/.test(v.agencia)) erros.agencia = 'Só dígitos.'
    if (v.agenciaDv !== '' && !/^\d$/.test(v.agenciaDv)) erros.agenciaDv = 'Um dígito.'
    if (!/^\d{1,12}$/.test(v.conta)) erros.conta = 'Só dígitos.'
    if (!/^\d{1,2}$/.test(v.contaDv)) erros.contaDv = 'Só dígitos.'
    if (Object.keys(erros).length > 0) return { erros }
    return {
      erros,
      destino: {
        tipo: 'CONTA',
        bancoCod: v.bancoCod,
        agencia: v.agencia,
        ...(v.agenciaDv !== '' ? { agenciaDv: v.agenciaDv } : {}),
        conta: v.conta,
        contaDv: v.contaDv,
        titularDocumento: titular,
      },
    }
  }
  const chave = normalizarChave(e.chavePixTipo, e.chavePix)
  if (!chaveValida(e.chavePixTipo, chave)) erros.chavePix = 'Chave inválida para o tipo escolhido.'
  if (Object.keys(erros).length > 0) return { erros }
  return {
    erros,
    destino: {
      tipo: 'CHAVE_PIX',
      chavePixTipo: e.chavePixTipo,
      chavePix: chave,
      titularDocumento: titular,
    },
  }
}

const rotaDestino = (loteId: string, c: { filCod: number; docCod: string; titCod: string }) =>
  `/sispag/lotes/${loteId}/itens/${c.filCod}/${encodeURIComponent(c.docCod)}/${encodeURIComponent(c.titCod)}/destino`

/** Grava o destino digitado do item (só RASCUNHO; optimistic lock). 409/422 → mensagem do backend. */
export const definirDestinoItem = (
  loteId: string,
  input: { filCod: number; docCod: string; titCod: string; versao: number; destino: DestinoManual },
) =>
  loteRequest(rotaDestino(loteId, input), {
    method: 'POST',
    body: JSON.stringify({ versao: input.versao, destino: input.destino }),
  })

/** Remove o destino digitado (volta a valer o cadastro do Conexos). */
export const limparDestinoItem = (
  loteId: string,
  input: { filCod: number; docCod: string; titCod: string; versao: number },
) =>
  loteRequest(rotaDestino(loteId, input), {
    method: 'DELETE',
    body: JSON.stringify({ versao: input.versao }),
  })

/**
 * Aprova a conta (TED) digitada do item (ADR-0054 D10). Exige `sispag:aprovar_destino`; só
 * RASCUNHO; optimistic lock pela `versao`. O body leva só a versão.
 */
export const aprovarDestinoItem = (
  loteId: string,
  input: { filCod: number; docCod: string; titCod: string; versao: number },
) =>
  loteRequest(`${rotaDestino(loteId, input)}/aprovar`, {
    method: 'POST',
    body: JSON.stringify({ versao: input.versao }),
  })

/** D10: o item tem conta digitada aguardando aprovação. */
export const destinoPendenteDeAprovacao = (item: ItemLote): boolean =>
  item.destinoManualResumo?.aprovacao === 'PENDENTE'

/** D12: a oferta do item traz PIX por chave CPF/CNPJ do favorecido. */
export const pixPreferido = (oferta: OfertaModalidadesItem | undefined): boolean =>
  oferta?.destinos?.PIX?.chaveCpfCnpjDoFavorecido === true
