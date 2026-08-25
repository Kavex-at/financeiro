import { withAuthHeaders } from './auth/token'
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
  ativo?: boolean
  /** Já está num lote RASCUNHO — não pode ser atachado a outro (bloqueia a seleção). */
  emLote?: boolean
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

/** Rótulos das formas de pagamento (A2) para o seletor da revisão. */
export const MODALIDADES: { value: Modalidade; label: string }[] = [
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'TED', label: 'TED' },
  { value: 'PIX', label: 'PIX' },
  { value: 'CREDITO_CONTA', label: 'Crédito em conta' },
]

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

/** FINALIZADO → RETORNADO ("de volta do Nexxera"). Hoje manual; futuro = robô-poller. */
export const marcarRetorno = (loteId: string, versao: number) =>
  loteRequest(`/sispag/lotes/${loteId}/retorno`, {
    method: 'POST',
    body: JSON.stringify({ versao }),
  })

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
  opts?: { dryRun?: boolean; confirmarNovoLote?: boolean },
) =>
  sispagRequest<GerarRemessaResult>(`/sispag/lotes/${loteId}/remessa`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `remessa:${loteId}` },
    body: JSON.stringify({
      dryRun: opts?.dryRun ?? false,
      // Só vai quando a pessoa confirmou no diálogo — nunca por default.
      ...(opts?.confirmarNovoLote ? { confirmarNovoLote: true } : {}),
    }),
  })

/** Baixa o `.REM` já gerado (CNAB 240, texto puro) e devolve o conteúdo. */
export async function baixarRemessa(loteId: string): Promise<{ nome: string; conteudo: string }> {
  const res = await apiFetch(`${API}/sispag/lotes/${loteId}/remessa/arquivo`, {
    headers: { ...(await withAuthHeaders()) },
  })
  if (!res.ok) throw new Error(`Falha ao baixar a remessa (${res.status})`)
  const disp = res.headers.get('Content-Disposition') ?? ''
  const nome = /filename="([^"]+)"/.exec(disp)?.[1] ?? `lote-${loteId}.REM`
  return { nome, conteudo: await res.text() }
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

/** A2 opção B — formas de pagamento disponíveis (cadastro do favorecido) por item do lote, ao vivo. */
export async function fetchModalidadesDisponiveis(
  loteId: string,
): Promise<Array<{ docCod: string; titCod: string; modalidades: Modalidade[] }>> {
  const res = await apiFetch(`${API}/sispag/lotes/${loteId}/modalidades-disponiveis`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const j = (await res.json()) as {
    itens: Array<{ docCod: string; titCod: string; modalidades: Modalidade[] }>
  }
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
