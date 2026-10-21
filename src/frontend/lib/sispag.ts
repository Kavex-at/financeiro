import { z } from 'zod'
import { withAuthHeaders } from './auth/token'
import { lerArquivoDaResposta } from './download'
import { apiFetch } from './http'

/**
 * SISPAG (Escopo II) — cliente da API do painel READ-ONLY (spike / Fatia 1).
 * Bate em `GET /sispag/painel` (dados ao vivo do Conexos, só leitura). Os tipos
 * espelham `backend/domain/interface/sispag/SispagInterface.ts`.
 */

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

// ---------------------------------------------------------------- Situação de pagamento (ADR-0075)
// Espelho de `src/backend/domain/interface/sispag/SituacaoPagamento.ts` (teste de paridade).

export const ESTADO_PAGAMENTO = { PRONTO: 'PRONTO', BLOQUEADO: 'BLOQUEADO' } as const
export type EstadoPagamento = (typeof ESTADO_PAGAMENTO)[keyof typeof ESTADO_PAGAMENTO]

/** Ordem de prioridade: o primeiro que se aplica é o `principal` da linha. */
export const MOTIVO_PAGAMENTO = {
  ALCADA: 'ALCADA',
  TIPO_PERMUTA: 'TIPO_PERMUTA',
  VENCIDO: 'VENCIDO',
  FORMA_NAO_SISPAG: 'FORMA_NAO_SISPAG',
  DUPLICIDADE: 'DUPLICIDADE',
  RETIDO_CODBAR: 'RETIDO_CODBAR',
  AJUSTE_CENTAVOS_PENDENTE: 'AJUSTE_CENTAVOS_PENDENTE',
  CONFIRMACAO_A_REVISAR: 'CONFIRMACAO_A_REVISAR',
  BOLETO_SEM_DDA: 'BOLETO_SEM_DDA',
} as const
export type MotivoPagamento = (typeof MOTIVO_PAGAMENTO)[keyof typeof MOTIVO_PAGAMENTO]

/** Subdivisão de `BOLETO_SEM_DDA` pelo desfecho da sugestão de boleto (I19r). */
export const SUGESTAO_BOLETO_SEM_DDA = {
  PARA_CONFIRMAR: 'PARA_CONFIRMAR',
  A_ESCOLHER: 'A_ESCOLHER',
  CANDIDATO_FRACO: 'CANDIDATO_FRACO',
  SEM_CANDIDATO: 'SEM_CANDIDATO',
  AGUARDANDO_VINCULO: 'AGUARDANDO_VINCULO',
} as const
export type SugestaoBoletoSemDda =
  (typeof SUGESTAO_BOLETO_SEM_DDA)[keyof typeof SUGESTAO_BOLETO_SEM_DDA]

export const DONO_PAGAMENTO = {
  VOCE: 'VOCE',
  APROVADOR: 'APROVADOR',
  PERMUTAS: 'PERMUTAS',
  CONTAS_A_PAGAR: 'CONTAS_A_PAGAR',
} as const
export type DonoPagamento = (typeof DONO_PAGAMENTO)[keyof typeof DONO_PAGAMENTO]

export const ACAO_PAGAMENTO = {
  ABRIR_NO_CONEXOS: 'ABRIR_NO_CONEXOS',
  ABRIR_EM_PERMUTAS: 'ABRIR_EM_PERMUTAS',
  RENEGOCIAR_NO_CONEXOS: 'RENEGOCIAR_NO_CONEXOS',
  CORRIGIR_FORMA_NO_CONEXOS: 'CORRIGIR_FORMA_NO_CONEXOS',
  TRATAR_DUPLICIDADE: 'TRATAR_DUPLICIDADE',
  DESFAZER_RETENCAO: 'DESFAZER_RETENCAO',
  TENTAR_AJUSTE: 'TENTAR_AJUSTE',
  VER_BOLETO: 'VER_BOLETO',
} as const
export type AcaoPagamento = (typeof ACAO_PAGAMENTO)[keyof typeof ACAO_PAGAMENTO]

export const FONTE_SITUACAO = {
  DUPLICIDADE: 'DUPLICIDADE',
  AJUSTE_CENTAVOS: 'AJUSTE_CENTAVOS',
  BOLETO: 'BOLETO',
} as const
export type FonteSituacao = (typeof FONTE_SITUACAO)[keyof typeof FONTE_SITUACAO]

export interface SituacaoPagamento {
  estado: EstadoPagamento
  /** Todos os motivos que se aplicam, em ordem de prioridade. Vazio quando PRONTO. */
  motivos: MotivoPagamento[]
  principal?: MotivoPagamento
  /** Texto curto do motivo principal, pronto para a tela. */
  rotulo?: string
  dono?: DonoPagamento
  acao?: { codigo: AcaoPagamento; rotulo: string }
  detalhe?: string
  /** Só quando `principal = BOLETO_SEM_DDA`. Ausente em backend antigo: sem os sub-chips. */
  sugestaoBoleto?: SugestaoBoletoSemDda
}

export interface TotalSituacao {
  qtd: number
  valor: number
}

/** Sobre a carteira INTEIRA (não sobre o corte de payload). `porMotivo` conta pelo principal. */
export interface ResumoSituacao {
  porEstado: Record<EstadoPagamento, TotalSituacao>
  porMotivo: Partial<Record<MotivoPagamento, TotalSituacao>>
  porDono: Partial<Record<DonoPagamento, TotalSituacao>>
  /** Não vazio = a tela avisa "situação incompleta". */
  fontesIndisponiveis: FonteSituacao[]
}

export interface CriarLotesPorFilialInput {
  titulos: Array<{ filCod: number; docCod: string; titCod: string }>
  /** ADR-0064: título em outro lote RASCUNHO sai de lá e entra no novo. Sem a flag, é recusado. */
  mover?: boolean
}

export const RESULTADO_LOTE_FILIAL = {
  CRIADO: 'CRIADO',
  PARCIAL: 'PARCIAL',
  RECUSADO: 'RECUSADO',
} as const
export type ResultadoLoteFilial = (typeof RESULTADO_LOTE_FILIAL)[keyof typeof RESULTADO_LOTE_FILIAL]

export interface TituloRecusadoNoLote {
  chave: { filCod: number; docCod: string; titCod: string }
  codigo: string
  motivo?: MotivoPagamento
  mensagem: string
}

export interface LoteCriadoPorFilial {
  filCod: number
  resultado: ResultadoLoteFilial
  loteId?: string
  incluidos: Array<{ filCod: number; docCod: string; titCod: string }>
  recusados: TituloRecusadoNoLote[]
}

export interface CriarLotesPorFilialResult {
  lotes: LoteCriadoPorFilial[]
}

export interface TituloAPagar {
  /** Situação de pagamento (ADR-0075). Opcional para tolerar backend antigo. */
  situacaoPagamento?: SituacaoPagamento

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
  /**
   * Forma de pagamento do título NO CONEXOS (`titVldPagopor`, a "Situação" do psq014). Não é
   * o vínculo DDA: um título BOLETO pode estar sem boleto DDA associado. Ver `formaDePagamento`.
   */
  formaPagamentoConexos?: number
  ativo?: boolean
  /** Já está num lote RASCUNHO — não pode ser atachado a outro (bloqueia a seleção). */
  emLote?: boolean
  /** O lote RASCUNHO em que o título está (ADR-0050) — a linha mostra e linka o lote. */
  loteRascunho?: LoteRascunhoRef
  /** Lote FINALIZADO / com remessa gerada que já tem o título (ADR-0064) — não se move. */
  loteComprometido?: LoteComprometidoRef
}

/** Referência ao lote RASCUNHO que contém um título. */
export interface LoteRascunhoRef {
  id: string
  automatico: boolean
}

/** Lote que compromete o título: o pagamento já está a caminho do banco (ADR-0064). */
export interface LoteComprometidoRef {
  id: string
  status: 'FINALIZADO' | 'REMESSA_GERADA'
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
  /** Contagens por estado/motivo/dono sobre a carteira inteira (ADR-0075). Opcional: backend antigo. */
  resumoSituacao?: ResumoSituacao
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
   * Autorização do favorecido vigente quando o destino do item congelou no envio (ADR-0065): só a
   * REFERÊNCIA. A API nunca devolve conta ou chave do item.
   */
  favorecidoAutorizadoId?: string
  // ── verificação TED/PIX (ADR-0063) ──
  /** `PENDENTE`: o Conexos não respondeu — o finalizar barra até a verificação passar. */
  verificacaoEstado?: 'PENDENTE' | 'OK'
  verificadoEm?: string
  /** O que a verificação viu do destino: SÓ a máscara (nunca o valor). */
  destinoMascarado?: string
  /**
   * Selo do favorecido autorizado (ADR-0065): o último resultado da verificação do item TED/PIX.
   * Ausente = nunca verificado ou leitura que falhou.
   */
  autorizacaoAviso?: AvisoAutorizacao
  /** Alertas vivas do item neste lote, com a justificativa quando houver. */
  alertas?: AlertaItemLote[]
  /**
   * Vínculo do código de barras ao item (ADR-0071): só a MÁSCARA 5+4. Ausente = sem vínculo.
   */
  vinculoCodigoBarras?: VinculoCodigoBarrasItem
}

/** Origem do vínculo do código de barras ao item (ADR-0071, I17). */
export interface VinculoCodigoBarrasItem {
  origem: 'ERP_DDA' | 'DECISAO_HUMANA'
  decisaoId?: string
  /** 5 primeiros + 4 últimos dígitos, separados por `…`. Nunca o código completo. */
  codigoMascarado: string
  /** ISO-8601. */
  aplicadoEm: string
  /** Lote nativo (`flpCod`) em que o vínculo foi gravado. */
  flpCod: number
}

export type ModoVinculoCodigoBarras = 'off' | 'shadow' | 'on'

/** Previsão do vínculo por título (`GET /sispag/lotes/:id/vinculos-previstos`). Só máscaras. */
export interface VinculoPrevisto {
  titulo: ChaveTitulo
  elegivel: boolean
  motivo?: string
  /** Vencimento da barra − vencimento do título, em dias, com sinal. */
  deltaDias?: number
  /** Valor da barra − aberto, em centavos, com sinal. */
  deltaCentavos?: number
  codigoMascarado?: string
  decisaoId?: string
  valorAbertoFonte: 'CARTEIRA_LOCAL' | 'ERP_AO_VIVO'
}

export interface VinculosPrevistos {
  modo: ModoVinculoCodigoBarras
  itens: VinculoPrevisto[]
}

/**
 * O que o vínculo do código confirmado FARIA neste lote (ADR-0071, I17k). Leitura local no
 * servidor. Falha vira "sem previsão" (modo `off`): é complemento, nunca bloqueia o card.
 */
export async function fetchVinculosPrevistos(loteId: string): Promise<VinculosPrevistos> {
  try {
    const res = await apiFetch(
      `${API}/sispag/lotes/${encodeURIComponent(loteId)}/vinculos-previstos`,
      { headers: { ...(await withAuthHeaders()) } },
    )
    if (!res.ok) return { modo: 'off', itens: [] }
    const j = (await res.json().catch(() => ({}))) as Partial<VinculosPrevistos>
    return { modo: j.modo ?? 'off', itens: j.itens ?? [] }
  } catch {
    return { modo: 'off', itens: [] }
  }
}

export type TipoAlertaItem = 'DUPLICIDADE_FORTE' | 'DUPLICIDADE_FRACA'

/** Sinal da verificação TED/PIX sobre um item (ADR-0063). Duplicidade ABERTA barra o finalizar. */
export interface AlertaItemLote {
  id: string
  loteId: string
  filCod: number
  docCod: string
  titCod: string
  tipo: TipoAlertaItem
  contraparteFilCod?: number
  contraparteDocCod?: string
  contraparteTitulos?: Array<{ titCod: string; valor: number; vencimento?: number; pago: boolean }>
  evidencia: Record<string, unknown>
  estado: 'ABERTA' | 'RESOLVIDA' | 'OBSOLETA' | 'DESCARTADA'
  resolucao?: 'JUSTIFICADA' | 'RETIRADA'
  justificativa?: string
  resolvidoPor?: string
  resolvidoEm?: string
  criadoEm: string
  verificadoEm: string
}

export const ehDuplicidade = (a: AlertaItemLote): boolean =>
  a.tipo === 'DUPLICIDADE_FORTE' || a.tipo === 'DUPLICIDADE_FRACA'

/** Destino que a oferta mostra para TED/PIX: origem + máscara (só com as flags ligadas). */
export interface DestinoOfertado {
  origem: 'CADASTRO' | 'NENHUM'
  destinoMascarado?: string
  /**
   * Só no PIX (D12): chave CPF/CNPJ que é o próprio documento do favorecido. A tela lista PIX
   * antes de TED.
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

/**
 * Cria UM lote por filial com os títulos dados (ADR-0075, `POST /sispag/lotes/por-filial`).
 * O servidor aplica a situação de pagamento a cada título: bloqueado é recusado com o motivo.
 * Um lote que falha não desfaz os outros; o resultado diz o que aconteceu em cada filial.
 */
export async function criarLotesPorFilial(
  input: CriarLotesPorFilialInput,
): Promise<CriarLotesPorFilialResult> {
  const res = await apiFetch(`${API}/sispag/lotes/por-filial`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await withAuthHeaders()) },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    let msg = `API ${res.status}`
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch {}
    throw new Error(msg)
  }
  const j = (await res.json()) as Partial<CriarLotesPorFilialResult>
  return { lotes: j.lotes ?? [] }
}

/**
 * Inclui o título no lote. `mover: true` (ADR-0064) o tira do lote RASCUNHO em que estiver, na
 * mesma transação; sem a flag, título em outro lote é recusado (409).
 */
export const incluirTitulo = (
  loteId: string,
  input: { filCod: number; docCod: string; titCod: string; mover?: boolean },
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

/** Item que a verificação do favorecido autorizado retirou no finalizar (ADR-0065 L3). */
export interface ItemRetirado {
  filCod: number
  docCod: string
  titCod: string
  credor?: string
  modalidade?: string
  motivo: Exclude<AvisoAutorizacao, 'OK'>
}

/**
 * Finaliza o lote. A verificação RETIRA os itens TED/PIX cujo favorecido não está autorizado e o
 * lote finaliza com os restantes; a resposta lista os retirados (vazia quando nenhum saiu).
 * Todos retirados = 409 com a mensagem do backend e o lote segue RASCUNHO.
 */
export async function finalizarLote(
  loteId: string,
  versao: number,
): Promise<{ lote: LotePagamento; retirados: ItemRetirado[] }> {
  const res = await apiFetch(`${API}/sispag/lotes/${loteId}/finalizar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await withAuthHeaders()) },
    body: JSON.stringify({ versao }),
  })
  if (!res.ok) {
    let msg = `API ${res.status}`
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch {}
    throw new Error(msg)
  }
  const j = (await res.json()) as { lote: LotePagamento; retirados?: ItemRetirado[] }
  return { lote: j.lote, retirados: j.retirados ?? [] }
}

export const reabrirLote = (loteId: string, versao: number) =>
  loteRequest(`/sispag/lotes/${loteId}/reabrir`, { method: 'POST', body: JSON.stringify({ versao }) })

export const cancelarLote = (loteId: string, versao: number) =>
  loteRequest(`/sispag/lotes/${loteId}/cancelar`, {
    method: 'POST',
    body: JSON.stringify({ versao }),
  })

// ── ADR-0063 — verificação TED/PIX e duplicidade ──────────────────────────────

/**
 * Trata UMA alerta de duplicidade (só RASCUNHO): JUSTIFICAR (texto obrigatório; o item fica) ou
 * RETIRAR (o item sai e o título fica bloqueado até o cancelamento no Conexos). O ator é sempre
 * quem está logado — o backend ignora qualquer outro.
 */
export const resolverAlertaDuplicidade = (
  loteId: string,
  item: ChaveTitulo,
  alertaId: string,
  input: { acao: 'JUSTIFICAR' | 'RETIRAR'; justificativa?: string },
) =>
  loteRequest(
    `/sispag/lotes/${loteId}/itens/${item.filCod}/${encodeURIComponent(item.docCod)}/${encodeURIComponent(item.titCod)}/alertas/${encodeURIComponent(alertaId)}/resolucao`,
    { method: 'POST', body: JSON.stringify(input) },
  )

/** Desfaz o bloqueio por duplicidade de um título, com motivo (auditado). */
export async function desfazerBloqueioDuplicidade(chave: ChaveTitulo, motivo: string): Promise<void> {
  const res = await apiFetch(`${API}${rotaTitulo(chave)}/bloqueio-duplicidade/desfazer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await withAuthHeaders()) },
    body: JSON.stringify({ motivo }),
  })
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error ?? `API ${res.status}`)
  }
}

/**
 * O que o sistema retirou DESTE lote por código de barras repetido/ilegível, lido da trilha
 * (ADR-0069 emenda 1, I16f(3)). É o que dá persistência ao aviso do `LoteCard`: sobrevive a
 * recarregar a tela. Falha vira lista vazia — o aviso é um complemento, nunca bloqueia o card.
 */
export async function fetchRetiradasDoLote(loteId: string): Promise<RetiradaDoLote[]> {
  const res = await apiFetch(
    `${API}/sispag/lotes/${encodeURIComponent(loteId)}/retirados-por-codigo-barras`,
    { headers: { ...(await withAuthHeaders()) } },
  )
  if (!res.ok) return []
  const j = (await res.json().catch(() => ({}))) as { retirados?: RetiradaDoLote[] }
  return j.retirados ?? []
}

/** Títulos retidos por código de barras (I16g) — a aba de títulos marca e permite desfazer. */
export async function fetchRetidosPorCodigoBarras(): Promise<TituloRetidoPorCodigoBarras[]> {
  const res = await apiFetch(`${API}/sispag/titulos/retidos-por-codigo-barras`, {
    headers: { ...(await withAuthHeaders()) },
  })
  if (!res.ok) return []
  const j = (await res.json().catch(() => ({}))) as { retidos?: TituloRetidoPorCodigoBarras[] }
  return j.retidos ?? []
}

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
  /**
   * Itens que a guarda de código de barras retirou do lote nesta geração (ADR-0069 emenda 1).
   * Ausente quando nada saiu. Só a máscara do código (5 primeiros + 4 últimos dígitos).
   */
  retiradosPorCodigoBarras?: RetiradoPorCodigoBarras[]
  /** Avisos em pt-BR: não vazio quando houve retirada — a remessa saiu, mas NÃO é "tudo certo". */
  avisos?: string[]
  /** Itens cujo código de barras foi vinculado da confirmação da analista (ADR-0071). Só máscara. */
  vinculados?: Array<{ titulo: ChaveTitulo; codigoMascarado: string }>
  /** Dry-run com o modo shadow/on: o que seria vinculado. */
  vinculosPrevistos?: VinculoPrevisto[]
}

/** Motivo da retirada automática por código de barras. */
export type MotivoRetiradaCodigoBarras =
  | 'CODIGO_BARRAS_REPETIDO'
  | 'CODIGO_BARRAS_ILEGIVEL'
  | 'VINCULO_CODIGO_BARRAS_FALHOU'

/** Item retirado do lote pela guarda (resultado da geração). Nunca o código completo. */
export interface RetiradoPorCodigoBarras {
  titulo: ChaveTitulo
  valor?: number
  /** Data civil `YYYY-MM-DD`. */
  vencimento?: string
  credor?: string
  /** 5 primeiros + 4 últimos dígitos, separados por `…`. */
  codigoMascarado?: string
  /** Título do grupo que FICOU no lote (só em repetido). */
  tituloMantido?: ChaveTitulo
  motivo: MotivoRetiradaCodigoBarras
}

/** O mesmo fato lido da TRILHA do lote — persiste enquanto o lote existir (I16f(3)). */
export interface RetiradaDoLote extends RetiradoPorCodigoBarras {
  ocorridoEm: string
}

/** Título retido por código de barras na aba de títulos (I16g). */
export interface TituloRetidoPorCodigoBarras {
  filCod: number
  docCod: string
  titCod: string
  origem: MotivoRetiradaCodigoBarras
  codigoMascarado?: string
  tituloMantido?: ChaveTitulo
  loteIdOrigem?: string
  marcadoEm: string
  credor?: string
  valor?: number
  vencimento?: string
}

/** Texto curto, em português, do motivo (selo e aviso do lote). */
export const ROTULO_RETIRADA_CODIGO_BARRAS: Record<MotivoRetiradaCodigoBarras, string> = {
  CODIGO_BARRAS_REPETIDO: 'boleto repetido',
  CODIGO_BARRAS_ILEGIVEL: 'código de barras ilegível',
  VINCULO_CODIGO_BARRAS_FALHOU: 'vínculo do código de barras falhou',
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

/** Código `titVldPagopor` do Conexos que significa BOLETO. */
export const FORMA_CONEXOS_BOLETO = 6

/**
 * A ÚNICA tabela de rótulos de `titVldPagopor` ("Pago Por") no frontend, com os códigos que o
 * Conexos documenta (070-com3 FinTituloFin). Os códigos espelham `PAGO_POR_CONEXOS` do backend —
 * um teste de paridade lê o arquivo do backend e falha se divergirem. Rótulo no minúsculo das
 * outras etiquetas da linha; sigla em caixa alta. Não há "TED": qual código a Columbia usa para
 * TED não está confirmado — não deduza.
 */
export const FORMA_CONEXOS_ROTULO: Readonly<Record<number, string>> = {
  1: 'cheque',
  2: 'TEF',
  3: 'carteira',
  4: 'extra-caixa',
  5: 'cartão de crédito',
  6: 'boleto',
  7: 'caixa',
  8: 'transação',
  9: 'documento',
  10: 'transação automática',
}

/** Valor do filtro/coluna "Forma de pagamento" de um título. */
export interface FormaDePagamento {
  /** Chave estável do filtro: `boleto-com-dda`, `boleto-sem-dda`, `forma-<código>` ou `sem-forma`. */
  chave: string
  rotulo: string
  /** `dda` = boleto pronto para a remessa; `alerta` = BOLETO sem DDA (sai sem código de barras). */
  tom: 'dda' | 'alerta' | 'neutro'
  /**
   * O Conexos NÃO diz BOLETO (outra forma, ou forma nenhuma), mas tem boleto DDA associado — a
   * linha mostra o código de barras sem fingir que é o caso perfeito.
   */
  comDda?: boolean
}

/** Ordem dos chips: boletos primeiro, depois pelo código do Conexos, "sem forma" por último. */
export const ORDEM_FORMA_DE_PAGAMENTO = [
  'boleto-com-dda',
  'boleto-sem-dda',
  // BOLETO não tem chip próprio: ele se divide em com/sem DDA.
  ...Object.keys(FORMA_CONEXOS_ROTULO)
    .filter((c) => Number(c) !== FORMA_CONEXOS_BOLETO)
    .map((c) => `forma-${c}`),
  'sem-forma',
] as const

/**
 * Uma coluna para "como este título vai ser pago": a forma do Conexos (`titVldPagopor`) e, quando
 * é BOLETO, se o ERP já associou o boleto DDA — "boleto sem DDA" é o caso que sai sem barras.
 * "boleto com DDA" exige o Conexos dizer BOLETO. Sem forma no Conexos (título fora do grid de
 * pendentes — bloqueado, já num lote nativo — ou com "Pago Por" vazio no ERP), a linha diz
 * "sem forma no Conexos", com a marca de DDA se houver boleto associado. Código que o ERP mandou
 * mas não está na tabela (novo no Conexos) vira "código N" — chip próprio, nunca "sem forma".
 */
export function formaDePagamento(
  t: Pick<TituloAPagar, 'formaPagamentoConexos' | 'temBoleto'>,
): FormaDePagamento {
  const forma = t.formaPagamentoConexos
  const dda = t.temBoleto === true
  const marcaDda = dda ? { comDda: true } : {}
  if (forma === FORMA_CONEXOS_BOLETO) {
    return dda
      ? { chave: 'boleto-com-dda', rotulo: 'boleto com DDA', tom: 'dda' }
      : { chave: 'boleto-sem-dda', rotulo: 'boleto sem DDA', tom: 'alerta' }
  }
  if (forma == null) {
    return { chave: 'sem-forma', rotulo: 'sem forma no Conexos', tom: 'neutro', ...marcaDda }
  }
  const rotulo = FORMA_CONEXOS_ROTULO[forma] ?? `código ${forma}`
  return { chave: `forma-${forma}`, rotulo, tom: 'neutro', ...marcaDda }
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

/** O título que ficou sem boleto DDA associado — o que o diálogo dos boletos precisa para abrir. */
export interface TituloSemBoleto {
  /** Ausente em respostas antigas do backend; a tela cai no filtro só por documento/valor. */
  filCod?: number
  docCod: string
  titCod: string
  credor?: string
  valor?: number
  /** Data civil `YYYY-MM-DD`. */
  vencimento?: string
}

/**
 * BOLETO sem boleto DDA associado no Conexos: a remessa sairia sem código de barras. Nada foi
 * escrito no ERP. A tela abre os boletos DDA do título para a analista ver valor e data.
 */
export class BoletoSemCodigoBarrasError extends Error {
  constructor(
    message: string,
    public readonly titulo: TituloSemBoleto,
  ) {
    super(message)
    this.name = 'BoletoSemCodigoBarrasError'
  }
}

/**
 * A retirada automática por boleto repetido/ilegível não terminou (ADR-0069 emenda 1). Nada foi
 * enviado ao banco; gerar de novo termina a limpeza. A mensagem é a do backend, em pt-BR, e já
 * diz o que saiu, o que falta e onde está o lote nativo — nunca carrega o código completo.
 */
export class BoletoCodigoBarrasRetiradaIncompletaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BoletoCodigoBarrasRetiradaIncompletaError'
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

/** Motivo, por item, de uma remessa barrada pela guarda do favorecido autorizado (ADR-0065). */
export interface ItemBarradoNaRemessa {
  /** `docCod/titCod`. */
  item: string
  motivo: AvisoAutorizacao | 'FALHA_LEITURA'
}

/**
 * A remessa não saiu: item(ns) TED/PIX sem autorização válida do favorecido. Nada foi enviado ao
 * Conexos. A tela lista item e motivo.
 */
export class PayeeNotAuthorizedAtRemittanceError extends Error {
  constructor(
    message: string,
    readonly itens: ItemBarradoNaRemessa[],
  ) {
    super(message)
    this.name = 'PayeeNotAuthorizedAtRemittanceError'
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
    if (body.code === 'BOLETO_SEM_CODIGO_BARRAS') {
      throw new BoletoSemCodigoBarrasError(msg, {
        docCod: String(det.docCod ?? ''),
        titCod: String(det.titCod ?? ''),
        ...(typeof det.filCod === 'number' ? { filCod: det.filCod } : {}),
        ...(typeof det.credor === 'string' ? { credor: det.credor } : {}),
        ...(typeof det.valor === 'number' ? { valor: det.valor } : {}),
        ...(typeof det.vencimento === 'string' ? { vencimento: det.vencimento } : {}),
      })
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
    if (body.code === 'FAVORECIDO_NAO_AUTORIZADO_NA_REMESSA') {
      const itens = Array.isArray(det.itens) ? (det.itens as ItemBarradoNaRemessa[]) : []
      throw new PayeeNotAuthorizedAtRemittanceError(msg, itens)
    }
    if (body.code === 'ERP_PERGUNTA') {
      throw new ErpPerguntaError(msg, det.chave as string | undefined)
    }
    if (body.code === 'BOLETO_CODIGO_BARRAS_RETIRADA_INCOMPLETA') {
      throw new BoletoCodigoBarrasRetiradaIncompletaError(msg)
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
  if (!res.ok) throw new Error(await mensagemDeErro(res, 'Falha ao baixar a remessa'))
  return lerArquivoDaResposta(res, `lote-${loteId}.REM`)
}

/**
 * Mensagem de uma resposta de erro de download: o `error` do corpo JSON quando o backend manda
 * (ex.: "O arquivo de remessa PG… não foi encontrado no Conexos…"), senão o prefixo + status.
 * Antes a tela só mostrava "Falha ao baixar a remessa (404)" e escondia o motivo.
 */
async function mensagemDeErro(res: Response, prefixo: string): Promise<string> {
  const body = (await res.json?.().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' && body.error.trim()
    ? body.error
    : `${prefixo} (${res.status})`
}

/** Teto de lotes por export — espelha `MAX_LOTES_EXPORT` do backend. */
export const MAX_LOTES_EXPORT = 50

/**
 * Exporta (.xlsx) os títulos das remessas dos lotes escolhidos — uma linha por título, com
 * linha de totais. Para a revisão do financeiro; basta `sispag:ver`.
 */
export async function exportarTitulosRemessas(
  loteIds: string[],
): Promise<{ nome: string; arquivo: Blob }> {
  const res = await apiFetch(`${API}/sispag/remessas/titulos/exportar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await withAuthHeaders()) },
    body: JSON.stringify({ loteIds }),
  })
  if (!res.ok) throw new Error(await mensagemDeErro(res, 'Falha ao exportar os títulos'))
  return lerArquivoDaResposta(res, 'sispag-titulos-remessas.xlsx')
}

/** Teto de títulos por export — espelha `MAX_TITULOS_EXPORT` do backend. */
export const MAX_TITULOS_EXPORT = 5000

/**
 * Exporta (.xlsx) os títulos a pagar das chaves `filCod:docCod:titCod` — as linhas da aba com o
 * filtro atual, na ordem da tela. Os valores saem da carteira no servidor; basta `sispag:ver`.
 */
export async function exportarTitulosAPagar(
  chaves: string[],
): Promise<{ nome: string; arquivo: Blob }> {
  const res = await apiFetch(`${API}/sispag/titulos/exportar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await withAuthHeaders()) },
    body: JSON.stringify({ chaves }),
  })
  if (!res.ok) throw new Error(await mensagemDeErro(res, 'Falha ao exportar os títulos'))
  return lerArquivoDaResposta(res, 'sispag-titulos-a-pagar.xlsx')
}

/** Status em que o lote tem remessa gerada — download do `.REM` e export dos títulos. */
export const STATUS_COM_REMESSA: readonly LotePagamentoStatus[] = [
  'REMESSA_GERADA',
  'RETORNADO',
  'BAIXADO',
]

export const temRemessa = (lote: Pick<LotePagamento, 'status'>): boolean =>
  STATUS_COM_REMESSA.includes(lote.status)

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

export type EstadoCarteira = 'fresca' | 'atualizada' | 'em_andamento' | 'falha_recente'

/** Resposta de `POST /sispag/carteira/atualizar` (ADR-0060). */
export interface CarteiraAtualizacao {
  estado: EstadoCarteira
  /** ISO do fim da última ingestão bem-sucedida. */
  ultimaIngestaoEm?: string
  idadeMin?: number
  run?: IngestaoPagamentosResult
  /** Mensagem da última falha (só em `falha_recente`). */
  motivo?: string
}

/**
 * Pede ao backend para atualizar a carteira SE ela estiver defasada (TTL de 30 min no servidor).
 * Chamada pela tela ao abrir: `fresca` não toca o Conexos; `atualizada` rodou a ingestão (~10 s).
 * Basta `sispag:ver`. NÃO forma lotes.
 */
export async function atualizarCarteiraSeDefasada(): Promise<CarteiraAtualizacao> {
  const res = await apiFetch(`${API}/sispag/carteira/atualizar`, {
    method: 'POST',
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
  return (await res.json()) as CarteiraAtualizacao
}

// ============================================================ Sincronização dos lotes (L11)

export type EstadoSincronizacaoLotes = 'fresca' | 'atualizada' | 'em_andamento' | 'falha_recente'

/** Contadores de uma passada completa de L11 (ADR-0055). */
export interface ResumoSincronizacaoLotes {
  lotes: number
  transicionados: number
  atualizados: number
  semMudanca: number
  pulados: number
  falhasLeitura: number
  eventosNaoLidos: number
}

/** Resposta de `POST /sispag/lotes/sincronizar[-se-defasado]` (ADR-0066). */
export interface SincronizacaoLotes {
  estado: EstadoSincronizacaoLotes
  /** ISO do fim da última passada completa finalizada. */
  ultimaSincronizacaoEm?: string
  idadeMin?: number
  /** A passada que rodou (só em `atualizada`). */
  passada?: {
    runId: string
    status: 'success' | 'partial' | 'error'
    resumo?: ResumoSincronizacaoLotes
    errorMessage?: string
  }
  /** Última falha (`falha_recente`) ou a da passada que acabou de fechar em erro. */
  motivo?: string
}

async function postSincronizacaoLotes(path: string): Promise<SincronizacaoLotes> {
  const res = await apiFetch(`${API}${path}`, {
    method: 'POST',
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
  return (await res.json()) as SincronizacaoLotes
}

/**
 * Sincroniza os lotes com o Conexos SE a última passada tiver mais de 30 min (TTL no servidor).
 * Chamada pela tela ao abrir, DEPOIS da carteira (ADR-0066). Só leitura no ERP; basta `sispag:ver`.
 */
export const sincronizarLotesSeDefasado = () =>
  postSincronizacaoLotes('/sispag/lotes/sincronizar-se-defasado')

/**
 * "Sincronizar lotes" (ADR-0066): relê no Conexos a baixa dos títulos de TODOS os lotes com
 * remessa e atualiza situação e status (~25 s). Ignora o TTL; outra passada rodando →
 * `em_andamento`. Só leitura no ERP; basta `sispag:ver`.
 */
export const sincronizarLotes = () => postSincronizacaoLotes('/sispag/lotes/sincronizar')

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
  /** Resultado da regra em camadas (ADR-0068). */
  tier?: 'FORTE' | 'ATENCAO' | 'VENCIDO_INFORMATIVO'
  /** boleto − título, em reais, com sinal. */
  deltaValor?: number
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
  /** Valor igual, data fora do limite seguro: só informação, não conta para a situação. */
  informativos?: BoletoDdaTitulo[]
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
  /** Regra de candidato vigente (texto vindo do backend, a partir das constantes). */
  regraCandidato: string
}

export interface FiltroBoletosDda {
  escopo: BoletoDdaEscopo
  situacao?: BoletoDdaSituacao
  busca?: string
  filCod?: number
  /** Vencimento do boleto de/até, `YYYY-MM-DD`, inclusivo (filtrado no servidor). */
  vencimentoDe?: string
  vencimentoAte?: string
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
  if (filtro.vencimentoDe) qs.set('vencimentoDe', filtro.vencimentoDe)
  if (filtro.vencimentoAte) qs.set('vencimentoAte', filtro.vencimentoAte)
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

/** Dados do item de um lote que o diálogo dos boletos DDA usa (vencimento vira data civil). */
export const tituloDeItem = (i: ItemLote): TituloSemBoleto => ({
  filCod: i.filCod,
  docCod: i.docCod,
  titCod: i.titCod,
  ...(i.credor ? { credor: i.credor } : {}),
  ...(i.valor !== undefined ? { valor: i.valor } : {}),
  ...(i.vencimento !== undefined
    ? { vencimento: new Date(i.vencimento).toISOString().slice(0, 10) }
    : {}),
})

/** Dias entre duas datas civis `YYYY-MM-DD` (`b − a`), sem passar por fuso. */
export const diasEntre = (a: string, b: string): number => {
  const [ya, ma, da] = a.split('-').map(Number)
  const [yb, mb, db] = b.split('-').map(Number)
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000)
}

/** Boleto DDA já ligado ou candidato a um título específico. */
const ehDoTitulo = (b: BoletoDda, t: TituloSemBoleto): boolean =>
  [b.vinculo, ...b.candidatos].some(
    (x) =>
      x !== undefined &&
      x.docCod === t.docCod &&
      x.titCod === t.titCod &&
      (t.filCod === undefined || x.filCod === t.filCod),
  )

export interface BoletoDdaDoTitulo {
  boleto: BoletoDda
  /** Vencimento do boleto − vencimento do título, em dias. Ausente se uma das datas falta. */
  diferencaDias?: number
}

export interface BoletosDdaDoTitulo {
  /** O Conexos já ligou, ou listou como candidato, este título. */
  doTitulo: BoletoDdaDoTitulo[]
  /** Mesmo valor, mas nenhuma ligação com este título: o caso de data fora da janela. */
  mesmoValor: BoletoDdaDoTitulo[]
}

/**
 * Separa os boletos DDA que importam para UM título: os que o Conexos associa/lista como
 * candidatos dele e os que só têm o MESMO valor (onde mora o "a data difere alguns dias").
 * Pura: a busca do backend é textual, então o filtro exato do valor e do título é feito aqui.
 */
export const classificarBoletosDoTitulo = (
  titulo: TituloSemBoleto,
  boletos: BoletoDda[],
): BoletosDdaDoTitulo => {
  const unicos = [...new Map(boletos.map((b) => [`${b.ddcCod}:${b.ditCod}`, b])).values()]
  const comDiferenca = (b: BoletoDda): BoletoDdaDoTitulo => {
    const candidato = [b.vinculo, ...b.candidatos].find(
      (x) => x !== undefined && x.docCod === titulo.docCod && x.titCod === titulo.titCod,
    )
    const calculada =
      titulo.vencimento && b.vencimento ? diasEntre(titulo.vencimento, b.vencimento) : undefined
    const diferencaDias = calculada ?? candidato?.diferencaDias
    return { boleto: b, ...(diferencaDias !== undefined ? { diferencaDias } : {}) }
  }
  const porDistancia = (a: BoletoDdaDoTitulo, b: BoletoDdaDoTitulo) =>
    Math.abs(a.diferencaDias ?? Number.MAX_SAFE_INTEGER) -
    Math.abs(b.diferencaDias ?? Number.MAX_SAFE_INTEGER)
  const doTitulo = unicos.filter((b) => ehDoTitulo(b, titulo)).map(comDiferenca).sort(porDistancia)
  const mesmoValor = unicos
    .filter(
      (b) =>
        !ehDoTitulo(b, titulo) &&
        titulo.valor !== undefined &&
        Math.abs(b.valor - titulo.valor) < 0.005,
    )
    .map(comDiferenca)
    .sort(porDistancia)
  return { doTitulo, mesmoValor }
}

/**
 * Boletos DDA que podem ser deste título: os que o listam como candidato/vínculo e os de mesmo
 * valor, qualquer data. Duas buscas à lista paginada do backend (ela já indexa `doc/tit` e o
 * valor), unidas e classificadas aqui.
 */
export async function fetchBoletosDdaDoTitulo(
  titulo: TituloSemBoleto,
): Promise<BoletosDdaDoTitulo> {
  const base = {
    escopo: 'todos' as const,
    pagina: 1,
    tamanho: 50,
    ...(titulo.filCod !== undefined ? { filCod: titulo.filCod } : {}),
  }
  const [porTitulo, porValor] = await Promise.all([
    fetchBoletosDda({ ...base, busca: `${titulo.docCod}/${titulo.titCod}` }),
    titulo.valor !== undefined
      ? fetchBoletosDda({ ...base, busca: titulo.valor.toFixed(2) })
      : Promise.resolve(undefined),
  ])
  return classificarBoletosDoTitulo(titulo, [...porTitulo.boletos, ...(porValor?.boletos ?? [])])
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

// ============================================================ ADR-0054/0065 — destino de TED/PIX

/**
 * Flags expostas pelo backend (`GET /sispag/recursos`). `tedEnabled`/`pixEnabled` já dizem se a
 * modalidade é OFERECIDA: só com a guarda do favorecido autorizado ligada (I14k).
 */
export interface RecursosSispag {
  tedEnabled: boolean
  pixEnabled: boolean
  favorecidoAutorizadoEnabled: boolean
}

const RECURSOS_DESLIGADOS: RecursosSispag = {
  tedEnabled: false,
  pixEnabled: false,
  favorecidoAutorizadoEnabled: false,
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
          pixEnabled: j.pixEnabled === true,
          favorecidoAutorizadoEnabled: j.favorecidoAutorizadoEnabled === true,
        }
      } catch {
        recursosEmCache = null
        return RECURSOS_DESLIGADOS
      }
    })()
  }
  return recursosEmCache
}

/** D12: a oferta do item traz PIX por chave CPF/CNPJ do favorecido. */
export const pixPreferido = (oferta: OfertaModalidadesItem | undefined): boolean =>
  oferta?.destinos?.PIX?.chaveCpfCnpjDoFavorecido === true

// ============================================================ ADR-0065 — favorecido autorizado

/**
 * Selo do item TED/PIX e motivo de retirada/bloqueio: o resultado da verificação do favorecido
 * autorizado (I14d). `OK` = autorizado com o destino de agora igual ao aprovado.
 */
export type AvisoAutorizacao =
  | 'OK'
  | 'SEM_DADO_PAGAMENTO'
  | 'FAVORECIDO_NAO_AUTORIZADO'
  | 'DESTINO_ALTERADO'

/** Texto curto, em português, de cada resultado (selo, retirada, remessa barrada). */
export const ROTULO_AVISO_AUTORIZACAO: Record<AvisoAutorizacao | 'FALHA_LEITURA', string> = {
  OK: 'favorecido autorizado',
  SEM_DADO_PAGAMENTO:
    'sem conta/chave no cadastro do Conexos — pedir ao responsável pelo cadastro do Conexos',
  FAVORECIDO_NAO_AUTORIZADO: 'favorecido não autorizado para esta forma de pagamento',
  DESTINO_ALTERADO: 'destino mudou no cadastro desde a aprovação',
  FALHA_LEITURA: 'não foi possível ler o cadastro do Conexos',
}

export const ESTADOS_AUTORIZACAO = [
  'PENDENTE',
  'AUTORIZADO',
  'REJEITADO',
  'REAPROVACAO_PENDENTE',
  'REVOGADO',
] as const

export type EstadoAutorizacao = (typeof ESTADOS_AUTORIZACAO)[number]

export const ROTULO_ESTADO_AUTORIZACAO: Record<EstadoAutorizacao, string> = {
  PENDENTE: 'Pendente',
  AUTORIZADO: 'Autorizado',
  REJEITADO: 'Rejeitado',
  REAPROVACAO_PENDENTE: 'Reaprovação pendente',
  REVOGADO: 'Revogado',
}

export type ModalidadeAutorizavel = 'TED' | 'PIX'
export type OrigemSolicitacao = 'ITEM' | 'RELATORIO' | 'MANUAL'

const opcional = <T extends z.ZodType>(t: T) =>
  t
    .nullish()
    .transform((v) => v ?? undefined)
    .optional()

const autorizacaoSchema = z.object({
  id: z.string(),
  pesCod: z.string(),
  credor: opcional(z.string()),
  modalidade: z.enum(['TED', 'PIX']),
  estado: z.enum(ESTADOS_AUTORIZACAO),
  fingerprintChaveId: opcional(z.string()),
  destinoMascarado: opcional(z.string()),
  avisos: z.array(z.string()).default([]),
  destinoObservadoMascarado: opcional(z.string()),
  origemSolicitacao: z.enum(['ITEM', 'RELATORIO', 'MANUAL']),
  filCodLeitura: z.number(),
  solicitadoPor: opcional(z.string()),
  solicitadoEm: opcional(z.string()),
  decididoPor: opcional(z.string()),
  decididoEm: opcional(z.string()),
  motivoDecisao: opcional(z.string()),
  ultimaConferenciaEm: opcional(z.string()),
  ultimaConferenciaResultado: opcional(z.enum(['IGUAL', 'DIFERENTE', 'SEM_DADO', 'FALHA_LEITURA'])),
  versao: z.number(),
})

/** Autorização como a API devolve: só máscara, nunca conta ou chave completas. */
export type FavorecidoAutorizado = z.infer<typeof autorizacaoSchema>

const eventoSchema = z.object({
  id: z.string(),
  autorizacaoId: z.string(),
  evento: z.string(),
  ator: z.string(),
  ocorridoEm: z.string(),
  dados: opcional(z.record(z.string(), z.unknown())),
})

export type EventoAutorizacao = z.infer<typeof eventoSchema>

const destinoAtualSchema = z.object({
  resultado: z.enum(['OK', 'SEM_DADO', 'FALHA_LEITURA']),
  destinoMascarado: opcional(z.string()),
  /** A impressão que a aprovação devolve (anti-TOCTOU). Não é reversível. */
  fingerprint: opcional(z.string()),
  avisos: z.array(z.string()).default([]),
})

export type DestinoAtual = z.infer<typeof destinoAtualSchema>

const destinoReveladoSchema = z.object({
  destinoMascarado: z.string(),
  destino: z.union([
    z.object({
      tipo: z.literal('TED'),
      banco: z.string(),
      agencia: opcional(z.string()),
      agenciaDv: opcional(z.string()),
      conta: z.string(),
      contaDv: opcional(z.string()),
    }),
    z.object({ tipo: z.literal('PIX'), chaveTipo: opcional(z.string()), chave: z.string() }),
  ]),
})

export type DestinoRevelado = z.infer<typeof destinoReveladoSchema>

const cadastroTemSchema = z.enum(['SIM', 'NAO', 'FALHA_LEITURA'])
const estadoLinhaSchema = z.object({
  estado: z.union([z.enum(ESTADOS_AUTORIZACAO), z.literal('NENHUMA')]),
  id: opcional(z.string()),
})

const candidatoSchema = z.object({
  pesCod: z.string(),
  credor: opcional(z.string()),
  grupoDominante: z.string(),
  participacao: z.number(),
  pagamentos: z.number(),
  pagamentosTedPix: z.number(),
  meses: z.number(),
  confianca: z.string(),
  cadastro: z.object({ TED: cadastroTemSchema, PIX: cadastroTemSchema }),
  autorizacao: z.object({ TED: estadoLinhaSchema, PIX: estadoLinhaSchema }),
})

export type CandidatoAutorizacao = z.infer<typeof candidatoSchema>

const retiradoSemDadoSchema = z.object({
  loteId: opcional(z.string()),
  filCod: opcional(z.number()),
  docCod: opcional(z.string()),
  titCod: opcional(z.string()),
  pesCod: opcional(z.string()),
  credor: opcional(z.string()),
  ocorridoEm: z.string(),
})

const relatorioSchema = z.object({
  candidatos: z.array(candidatoSchema),
  total: z.number(),
  pagina: z.number(),
  limite: z.number(),
  retiradosSemDado: z.array(retiradoSemDadoSchema),
})

export type RelatorioCandidatos = z.infer<typeof relatorioSchema>

const favorecidoEncontradoSchema = z.object({
  pesCod: z.string(),
  nome: z.string(),
  nomeFantasia: opcional(z.string()),
  /** CPF/CNPJ mascarado no backend. O valor completo nunca chega aqui. */
  documentoMascarado: opcional(z.string()),
  /** `pesVldStatus` do Conexos: 1 ativo, 2 inativo, 3 em cadastro, 4 bloqueado, 5 não vender. */
  situacao: opcional(z.number()),
  autorizacao: z.object({ TED: estadoLinhaSchema, PIX: estadoLinhaSchema }),
})

export type FavorecidoEncontrado = z.infer<typeof favorecidoEncontradoSchema>

const buscaFavorecidosSchema = z.object({
  favorecidos: z.array(favorecidoEncontradoSchema),
  truncado: z.boolean(),
})

export type BuscaFavorecidos = z.infer<typeof buscaFavorecidosSchema>

/** Prévia do pedido: o destino do cadastro, mascarado, sem impressão. */
export type PreviaDestino = Omit<DestinoAtual, 'fingerprint'>

/** Erro da API de autorizações, com o código estável (o 409 de destino mudado recarrega). */
export class AutorizacaoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'AutorizacaoApiError'
  }
}

async function autorizacaoRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const res = await apiFetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(await withAuthHeaders()) },
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new AutorizacaoApiError(
      typeof body.error === 'string' ? body.error : `Falha (HTTP ${res.status}).`,
      res.status,
      typeof body.code === 'string' ? body.code : undefined,
    )
  }
  return schema.parse(body)
}

const base = '/sispag/favorecidos-autorizados'
const rotaId = (id: string) => `${base}/${encodeURIComponent(id)}`

export async function listarFavorecidosAutorizados(
  filtro: { estado?: EstadoAutorizacao; pesCod?: string } = {},
): Promise<FavorecidoAutorizado[]> {
  const qs = new URLSearchParams()
  if (filtro.estado) qs.set('estado', filtro.estado)
  if (filtro.pesCod) qs.set('pesCod', filtro.pesCod)
  const q = qs.toString()
  const j = await autorizacaoRequest(
    `${base}${q ? `?${q}` : ''}`,
    z.object({ autorizacoes: z.array(autorizacaoSchema) }),
  )
  return j.autorizacoes
}

/** Pede a autorização (F1) ou confirma a reaprovação aberta pelo sistema (F5). */
export async function pedirAutorizacao(input: {
  pesCod: string
  credor?: string
  modalidade: ModalidadeAutorizavel
  origem: OrigemSolicitacao
  filCod?: number
}): Promise<FavorecidoAutorizado> {
  const j = await autorizacaoRequest(base, z.object({ autorizacao: autorizacaoSchema }), {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return j.autorizacao
}

/** Aprova com a impressão que a tela mostrou (vinda do `reconferirAutorizacao`). */
export async function aprovarAutorizacao(
  id: string,
  input: { versao: number; fingerprintMostrado: string },
): Promise<FavorecidoAutorizado> {
  const j = await autorizacaoRequest(
    `${rotaId(id)}/aprovar`,
    z.object({ autorizacao: autorizacaoSchema }),
    { method: 'POST', body: JSON.stringify(input) },
  )
  return j.autorizacao
}

export async function rejeitarAutorizacao(
  id: string,
  input: { versao: number; motivo: string },
): Promise<FavorecidoAutorizado> {
  const j = await autorizacaoRequest(
    `${rotaId(id)}/rejeitar`,
    z.object({ autorizacao: autorizacaoSchema }),
    { method: 'POST', body: JSON.stringify(input) },
  )
  return j.autorizacao
}

export async function revogarAutorizacao(
  id: string,
  input: { versao: number; motivo: string },
): Promise<FavorecidoAutorizado> {
  const j = await autorizacaoRequest(
    `${rotaId(id)}/revogar`,
    z.object({ autorizacao: autorizacaoSchema }),
    { method: 'POST', body: JSON.stringify(input) },
  )
  return j.autorizacao
}

/** "Reconferir com o Conexos": o selo atualizado e o destino de agora (mascarado + impressão). */
export function reconferirAutorizacao(
  id: string,
): Promise<{ autorizacao: FavorecidoAutorizado; atual: DestinoAtual }> {
  return autorizacaoRequest(
    `${rotaId(id)}/reconferir`,
    z.object({ autorizacao: autorizacaoSchema, atual: destinoAtualSchema }),
    { method: 'POST', body: '{}' },
  )
}

/** O destino COMPLETO, lido ao vivo e auditado. Nunca guardar: a tela mostra e esquece. */
export function revelarDestino(id: string): Promise<DestinoRevelado> {
  return autorizacaoRequest(`${rotaId(id)}/revelar`, destinoReveladoSchema, {
    method: 'POST',
    body: '{}',
    cache: 'no-store',
  })
}

export async function eventosAutorizacao(id: string): Promise<EventoAutorizacao[]> {
  const j = await autorizacaoRequest(
    `${rotaId(id)}/eventos`,
    z.object({ eventos: z.array(eventoSchema) }),
  )
  return j.eventos
}

/** Relatório read-only de candidatos à autorização (paginado). */
export function listarCandidatosAutorizacao(
  params: { pagina?: number; limite?: number } = {},
): Promise<RelatorioCandidatos> {
  const qs = new URLSearchParams()
  if (params.pagina) qs.set('pagina', String(params.pagina))
  if (params.limite) qs.set('limite', String(params.limite))
  const q = qs.toString()
  return autorizacaoRequest(`${base}/candidatos${q ? `?${q}` : ''}`, relatorioSchema)
}

/** Acha o favorecido no cadastro do Conexos por nome, nome fantasia, CPF/CNPJ ou código. */
export function buscarFavorecidos(termo: string, init?: { signal?: AbortSignal }): Promise<BuscaFavorecidos> {
  // POST: o termo pode ser um CPF/CNPJ inteiro e não deve ir para URL (logs de acesso/erro).
  return autorizacaoRequest(`${base}/busca`, buscaFavorecidosSchema, {
    method: 'POST',
    body: JSON.stringify({ termo }),
    cache: 'no-store',
    ...(init?.signal ? { signal: init.signal } : {}),
  })
}

/** O destino que o cadastro do Conexos tem agora para o favorecido, mascarado (prévia do pedido). */
export function previaDestinoFavorecido(
  pesCod: string,
  modalidade: ModalidadeAutorizavel,
  init?: { signal?: AbortSignal },
): Promise<PreviaDestino> {
  const qs = new URLSearchParams({ pesCod, modalidade })
  return autorizacaoRequest(
    `${base}/destino-atual?${qs.toString()}`,
    destinoAtualSchema.omit({ fingerprint: true }),
    { cache: 'no-store', ...(init?.signal ? { signal: init.signal } : {}) },
  )
}

// ===================================================== ADR-0068 — sugestão de boleto (passo 1)
// Espelho do contrato de `routes/sispag.ts` (`/sugestoes-boleto`, `/confirmacoes-emissor`).
// EVIDÊNCIA, não autoridade. A listagem NUNCA traz barras nem linha digitável: a linha só sai de
// `POST /sugestoes-boleto/copiar-linha` (`sispag:ver`, auditado a cada cópia, fail-closed).

export const TIERS_SUGESTAO_BOLETO = ['CONHECIDO', 'FORTE', 'ATENCAO'] as const
export type TierSugestaoBoleto = (typeof TIERS_SUGESTAO_BOLETO)[number]
export type ResultadoSugestaoBoleto =
  | TierSugestaoBoleto
  | 'VENCIDO_INFORMATIVO'
  | 'SEM_RELACAO'

export const SINAIS_SUGESTAO_BOLETO = [
  'VALOR_IGUAL',
  'VALOR_ATE_5_CENTAVOS',
  'MESMO_DIA',
  'DIAS_DEPOIS',
  'NUMERO_IGUAL',
  'COLISAO_NUMERO',
  'EMISSOR_CONFIRMADO',
  /** O boleto vence ANTES do título (Δdias < 0, dentro do envelope): confirmar exige reconhecer (I15o). */
  'VENCE_ANTES_DO_TITULO',
  /** Gravado no snapshot da decisão quando o analista reconheceu `VENCE_ANTES_DO_TITULO`. */
  'RECONHECEU_VENCE_ANTES',
  /** Número do boleto = DPS lido do PDF da NFS-e + `000` (âncora direta, I15p). */
  'DPS_IGUAL',
  /** Casado pela ordem de DPS no escopo provado do emissor (I15p). */
  'ORDEM_DPS',
] as const
export type SinalSugestaoBoleto = (typeof SINAIS_SUGESTAO_BOLETO)[number]

const layoutEmissorSchema = z.enum(['ITAU_341', 'BRADESCO_237', 'GENERICO'])
export type LayoutEmissorBoleto = z.infer<typeof layoutEmissorSchema>

const resultadoSugestaoSchema = z.enum([
  'CONHECIDO',
  'FORTE',
  'ATENCAO',
  'VENCIDO_INFORMATIVO',
  'SEM_RELACAO',
])

export const sugestaoBoletoSchema = z.object({
  filCod: z.number(),
  docCod: z.string(),
  titCod: z.string(),
  pesCod: z.string().optional(),
  credor: z.string().optional(),
  valorTitulo: z.number(),
  /** Data civil `YYYY-MM-DD`. */
  vencimentoTitulo: z.string(),
  /** Data de débito considerada: a do lote ou, sem lote, o vencimento do título. */
  dataDebito: z.string(),
  ddcCod: z.number(),
  ditCod: z.number(),
  numeroBoleto: z.string().optional(),
  valorBoleto: z.number(),
  vencimentoBoleto: z.string(),
  /** Só a máscara (ex.: `237 / 2656 / ***2740`). Sem chave, sem barras, sem linha digitável. */
  emissor: z
    .object({ banco: z.string(), layout: layoutEmissorSchema, mascarado: z.string() })
    .optional(),
  avaliacao: z.object({
    resultado: resultadoSugestaoSchema,
    /** boleto − título, em reais, com sinal. */
    deltaValor: z.number(),
    deltaPercentual: z.number(),
    /** vencimento do boleto − vencimento do título, em dias, com sinal. */
    deltaDias: z.number(),
    sinais: z.array(z.enum(SINAIS_SUGESTAO_BOLETO)),
    confirmavel: z.boolean(),
    /** Dias vencido na data de débito (derivado, ≥ 0); ausente em resposta antiga. */
    diasVencidoNoDebito: z.number().optional(),
  }),
  estado: z.enum(['SUGERIDA', 'CONFIRMADA']),
  motivo: z.string().optional(),
  /**
   * Confirmação ÓRFÃ (I15l): a decisão segue ativa, mas o boleto saiu do pool ou o ERP sinalizou
   * o título. Nunca confirmável; a tela oferece "Anular confirmação".
   */
  orfa: z.boolean().optional(),
  motivoOrfa: z.string().optional(),
  /** Só `SUGERIDA` dentro dos três tiers. */
  confirmavel: z.boolean(),
  /** Par (credor, emissor) vigente do boleto, quando existe — para revogar pela tela. */
  confirmacaoEmissorId: z.string().optional(),
  /** CONFIRMADA: autor humano (herdado quando a decisão foi transferida, ADR-0074 M1). */
  decididoPor: z.string().optional(),
  /** `sistema` quando a decisão foi transferida ao título renegociado (ADR-0074 M1). */
  transferidaPor: z.string().optional(),
})
export type SugestaoBoleto = z.infer<typeof sugestaoBoletoSchema>

/**
 * Situação do TÍTULO (I15m, ADR-0072): um desfecho por título elegível. Só `UNICA_SEGURA` e
 * `SO_ATENCAO` têm candidato confirmável; as demais são informação.
 */
export const SITUACOES_SUGESTAO_TITULO = [
  'UNICA_SEGURA',
  'AMBIGUA',
  'SO_ATENCAO',
  'SO_FRACA',
  'SO_VENCIDA',
  'DISPUTADA',
  'SEM_CANDIDATO',
  'CONFIRMADA',
  'ORFA',
] as const
export type SituacaoSugestaoTitulo = (typeof SITUACOES_SUGESTAO_TITULO)[number]

export const AVISOS_VENCE_ANTES = ['NENHUM', 'ATENCAO', 'CRITICO'] as const
export type AvisoVenceAntes = (typeof AVISOS_VENCE_ANTES)[number]

const chaveTituloSchema = z.object({ filCod: z.number(), docCod: z.string(), titCod: z.string() })

export const candidatoTituloSchema = z.object({
  ddcCod: z.number(),
  ditCod: z.number(),
  numeroBoleto: z.string().optional(),
  valorBoleto: z.number(),
  vencimentoBoleto: z.string(),
  /** Só a máscara. Nunca barras nem linha digitável (I15k). */
  emissor: z
    .object({ banco: z.string(), layout: layoutEmissorSchema, mascarado: z.string() })
    .optional(),
  avaliacao: sugestaoBoletoSchema.shape.avaliacao,
  ancorado: z.boolean(),
  confirmavel: z.boolean(),
  /** Boleto exibido em mais de um título sem reserva (fraco/vencido não reservam). */
  compartilhado: z.boolean().optional(),
  /** O boleto está reservado ao título indicado (disputa, I15e/I15n). */
  reservadoParaTitulo: chaveTituloSchema.optional(),
  /** Por que não é confirmável (pt-BR). */
  motivo: z.string().optional(),
  confirmacaoEmissorId: z.string().optional(),
  decididoPor: z.string().optional(),
  transferidaPor: z.string().optional(),
})
export type CandidatoTituloBoleto = z.infer<typeof candidatoTituloSchema>

export const desfechoTituloSchema = z.object({
  filCod: z.number(),
  docCod: z.string(),
  titCod: z.string(),
  pesCod: z.string().optional(),
  credor: z.string().optional(),
  valorTitulo: z.number(),
  vencimentoTitulo: z.string(),
  dataDebito: z.string(),
  situacao: z.enum(SITUACOES_SUGESTAO_TITULO),
  candidatos: z.array(candidatoTituloSchema),
  /** Candidatos dentro do envelope, antes do corte de exibição (3). */
  totalCandidatos: z.number(),
  motivo: z.string(),
  motivoOrfa: z.string().optional(),
  avisoVenceAntes: z.enum(AVISOS_VENCE_ANTES),
  diasVencidoNoDebito: z.number(),
})
export type DesfechoTituloBoleto = z.infer<typeof desfechoTituloSchema>

export const listagemSugestoesBoletoSchema = z.object({
  sugestoes: z.array(sugestaoBoletoSchema),
  /** Uma linha por título elegível (ADR-0072). Opcional: resposta antiga não o traz. */
  titulos: z.array(desfechoTituloSchema).optional(),
  totalTitulos: z.number().optional(),
  contagemSituacao: z.record(z.string(), z.number()).optional(),
  total: z.number(),
  pagina: z.number(),
  tamanho: z.number(),
  contagem: z.record(z.string(), z.number()),
  /** epoch ms da última sincronização do DDA. */
  sincronizadoEm: z.number().optional(),
  /** Horas de defasagem do DDA (> 8 h em dia útil, ADR-0067); ausente = em dia. */
  ddaDefasadoHoras: z.number().optional(),
})
export type ListagemSugestoesBoleto = z.infer<typeof listagemSugestoesBoletoSchema>

/** Filtros de `GET /sispag/sugestoes-boleto`. */
export interface FiltroSugestoesBoleto {
  filCod?: number
  pesCod?: string
  tier?: ResultadoSugestaoBoleto
  situacao?: SituacaoSugestaoTitulo
  pagina?: number
  tamanho?: number
}

/** Corpo de `confirmar` e `copiar-linha`; `rejeitar` acrescenta `motivo`. Nunca um "ator". */
export interface ChaveSugestaoBoleto {
  filCod: number
  docCod: string
  titCod: string
  ddcCod: number
  ditCod: number
}

export const decisaoSugestaoBoletoSchema = z.object({
  id: z.string(),
  filCod: z.number(),
  docCod: z.string(),
  titCod: z.string(),
  pesCod: z.string(),
  credor: z.string().optional(),
  ddcCod: z.number(),
  ditCod: z.number(),
  numeroBoleto: z.string().optional(),
  codbarMascarado: z.string(),
  valorTitulo: z.number(),
  vencimentoTitulo: z.string(),
  valorBoleto: z.number(),
  vencimentoBoleto: z.string(),
  deltaValor: z.number(),
  deltaPercentual: z.number(),
  deltaDias: z.number(),
  sinais: z.array(z.enum(SINAIS_SUGESTAO_BOLETO)),
  tier: z.enum(TIERS_SUGESTAO_BOLETO).optional(),
  decisao: z.enum(['CONFIRMADA', 'REJEITADA', 'ANULADA']),
  decididoPor: z.string(),
  decididoEm: z.string(),
  motivo: z.string().optional(),
  confirmacaoEmissorId: z.string().optional(),
  anuladaPor: z.string().optional(),
  anuladaEm: z.string().optional(),
  motivoAnulacao: z.string().optional(),
})
export type DecisaoSugestaoBoleto = z.infer<typeof decisaoSugestaoBoletoSchema>

/** Resposta de `confirmar` (201 nova, 200 já existia) e de `rejeitar`. */
export const resultadoDecisaoBoletoSchema = z.object({
  criada: z.boolean(),
  decisao: decisaoSugestaoBoletoSchema,
})
export type ResultadoDecisaoBoleto = z.infer<typeof resultadoDecisaoBoletoSchema>

/** Corpo de `POST /sugestoes-boleto/anular`: o título (a decisão é uma por título) e o motivo. */
export interface ChaveAnulacaoBoleto {
  filCod: number
  docCod: string
  titCod: string
}

/** Resposta de `anular` (200 sempre que o título termina ANULADA; `anulada=false` = já estava). */
export const resultadoAnulacaoBoletoSchema = z.object({
  anulada: z.boolean(),
  decisao: decisaoSugestaoBoletoSchema,
})
export type ResultadoAnulacaoBoleto = z.infer<typeof resultadoAnulacaoBoletoSchema>

/** Menor motivo aceito para anular uma confirmação (o servidor recusa menos que isso). */
export const MOTIVO_ANULACAO_MINIMO = 10

/** Resposta de `POST /sugestoes-boleto/copiar-linha` (`Cache-Control: no-store`). */
export const linhaCopiadaSchema = z.object({ linhaDigitavel: z.string() })

export const confirmacaoEmissorSchema = z.object({
  id: z.string(),
  pesCod: z.string(),
  credor: z.string().optional(),
  layoutEmissor: layoutEmissorSchema,
  bancoEmissor: z.string(),
  emissorMascarado: z.string(),
  estado: z.enum(['VIGENTE', 'REVOGADA']),
  confirmadoPor: z.string(),
  confirmadoEm: z.string(),
  revogadoPor: z.string().optional(),
  revogadoEm: z.string().optional(),
  motivoRevogacao: z.string().optional(),
  versao: z.number(),
  /** `GENERICO` nunca é elegível a automático (I15i). */
  elegivelAutomatico: z.boolean(),
})
export type ConfirmacaoEmissorBoleto = z.infer<typeof confirmacaoEmissorSchema>

/** Códigos estáveis de erro da sugestão de boleto (envelope `{ error, code, retryable }`). */
export const CODIGOS_ERRO_SUGESTAO_BOLETO = {
  INDISPONIVEL: 'SUGESTAO_BOLETO_INDISPONIVEL', // 409
  RESERVADO_A_OUTRO_TITULO: 'BOLETO_JA_SUGERIDO_A_OUTRO_TITULO', // 409
  MOTIVO_OBRIGATORIO: 'CONFIRMACAO_EMISSOR_MOTIVO_OBRIGATORIO', // 422
  VENCIDO: 'BOLETO_VENCIDO_NAO_CONFIRMAVEL', // 422
  AVISO_OBRIGATORIO: 'RECONHECIMENTO_DE_AVISO_OBRIGATORIO', // 422: reconhecer VENCE_ANTES_DO_TITULO
  TITULO_SEM_SUGESTAO: 'TITULO_SEM_SUGESTAO', // 404
  PAR_NAO_ENCONTRADO: 'CONFIRMACAO_EMISSOR_NAO_ENCONTRADA', // 404
  NAO_CONFIRMADA: 'DECISAO_NAO_CONFIRMADA', // 409: nada a anular neste título
  SEM_TRILHA: 'COPIA_LINHA_SEM_TRILHA', // 503: a linha NÃO foi devolvida
} as const

const sugestoesBase = '/sispag/sugestoes-boleto'
const confirmacoesBase = '/sispag/confirmacoes-emissor'
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

/** `GET /sispag/sugestoes-boleto` (`sispag:ver`). Sem barras nem linha digitável. */
export async function fetchSugestoesBoleto(
  filtro: FiltroSugestoesBoleto = {},
): Promise<ListagemSugestoesBoleto> {
  const qs = new URLSearchParams()
  if (filtro.filCod !== undefined) qs.set('filCod', String(filtro.filCod))
  if (filtro.pesCod) qs.set('pesCod', filtro.pesCod)
  if (filtro.tier) qs.set('tier', filtro.tier)
  if (filtro.situacao) qs.set('situacao', filtro.situacao)
  if (filtro.pagina !== undefined) qs.set('pagina', String(filtro.pagina))
  if (filtro.tamanho !== undefined) qs.set('tamanho', String(filtro.tamanho))
  const q = qs.toString()
  return autorizacaoRequest(
    `${sugestoesBase}${q ? `?${q}` : ''}`,
    listagemSugestoesBoletoSchema,
    { cache: 'no-store' },
  )
}

/** Teto de uma página do backend (`SUGESTAO_TAMANHO_MAXIMO`); a tela pede tudo numa chamada. */
export const SUGESTOES_TAMANHO_TELA = 2000

/**
 * Todas as sugestões numa chamada só (`tamanho = 2000`), para a aba de títulos casar por título.
 * Antes eram páginas de 100 em série, e cada página recalculava o motor inteiro. Se
 * `total > sugestoes.length` a lista veio truncada: a tela AVISA, nunca corta em silêncio.
 */
export async function fetchTodasSugestoesBoleto(): Promise<ListagemSugestoesBoleto> {
  return fetchSugestoesBoleto({ pagina: 1, tamanho: SUGESTOES_TAMANHO_TELA })
}

/**
 * `POST .../confirmar` (`sispag:executar`). Nada é escrito no ERP. `reconheceAvisos` só vai no
 * corpo quando há aviso reconhecido (o servidor confere contra a avaliação recalculada).
 */
export async function confirmarSugestaoBoleto(
  chave: ChaveSugestaoBoleto,
  reconheceAvisos: readonly SinalSugestaoBoleto[] = [],
): Promise<ResultadoDecisaoBoleto> {
  return autorizacaoRequest(
    `${sugestoesBase}/confirmar`,
    resultadoDecisaoBoletoSchema,
    post(reconheceAvisos.length > 0 ? { ...chave, reconheceAvisos } : chave),
  )
}

/** `GET .../titulo` (`sispag:ver`): até 3 candidatos de UM título, sob demanda. */
export async function fetchDetalheTituloBoleto(chave: ChaveAnulacaoBoleto): Promise<DesfechoTituloBoleto> {
  const qs = new URLSearchParams({
    filCod: String(chave.filCod),
    docCod: chave.docCod,
    titCod: chave.titCod,
  })
  return autorizacaoRequest(`${sugestoesBase}/titulo?${qs.toString()}`, desfechoTituloSchema, {
    cache: 'no-store',
  })
}

/** `POST .../rejeitar` (`sispag:executar`); `motivo` obrigatório. */
export async function rejeitarSugestaoBoleto(
  chave: ChaveSugestaoBoleto,
  motivo: string,
): Promise<ResultadoDecisaoBoleto> {
  return autorizacaoRequest(
    `${sugestoesBase}/rejeitar`,
    resultadoDecisaoBoletoSchema,
    post({ ...chave, motivo }),
  )
}

/**
 * `POST .../anular` (`sispag:executar`): desfaz a confirmação do TÍTULO e libera título e boleto
 * (I15l). Vale também para confirmação órfã. `motivo` de 10 a 500 caracteres. Nada muda no ERP.
 */
export async function anularConfirmacaoBoleto(
  chave: ChaveAnulacaoBoleto,
  motivo: string,
): Promise<ResultadoAnulacaoBoleto> {
  return autorizacaoRequest(
    `${sugestoesBase}/anular`,
    resultadoAnulacaoBoletoSchema,
    post({ filCod: chave.filCod, docCod: chave.docCod, titCod: chave.titCod, motivo }),
  )
}

/**
 * `POST .../copiar-linha` (`sispag:ver`). A cópia é auditada ANTES de a linha sair; sem trilha
 * (503 `COPIA_LINHA_SEM_TRILHA`) a linha não vem. Devolve só a string — quem chama a escreve na
 * área de transferência e a descarta; nunca em estado, log nem tela.
 */
export async function copiarLinhaSugestao(chave: ChaveSugestaoBoleto): Promise<string> {
  const r = await autorizacaoRequest(`${sugestoesBase}/copiar-linha`, linhaCopiadaSchema, {
    ...post(chave),
    cache: 'no-store',
  })
  return r.linhaDigitavel
}

/** `GET /sispag/confirmacoes-emissor` (`sispag:ver`). Só o emissor mascarado. */
export async function fetchConfirmacoesEmissor(
  filtro: { estado?: 'VIGENTE' | 'REVOGADA'; pesCod?: string } = {},
): Promise<ConfirmacaoEmissorBoleto[]> {
  const qs = new URLSearchParams()
  if (filtro.estado) qs.set('estado', filtro.estado)
  if (filtro.pesCod) qs.set('pesCod', filtro.pesCod)
  const q = qs.toString()
  const j = await autorizacaoRequest(
    `${confirmacoesBase}${q ? `?${q}` : ''}`,
    z.object({ confirmacoes: z.array(confirmacaoEmissorSchema) }),
    { cache: 'no-store' },
  )
  return j.confirmacoes
}

/** `POST /sispag/confirmacoes-emissor/:id/revogar` (`sispag:executar`); `motivo` obrigatório. */
export async function revogarConfirmacaoEmissor(
  id: string,
  motivo: string,
): Promise<ConfirmacaoEmissorBoleto> {
  const j = await autorizacaoRequest(
    `${confirmacoesBase}/${encodeURIComponent(id)}/revogar`,
    z.object({ confirmacao: confirmacaoEmissorSchema }),
    post({ motivo }),
  )
  return j.confirmacao
}


// ===================================================== Ajuste de centavos do título (ADR-0074, I18)

export const MODOS_AJUSTE_CENTAVOS = ['shadow', 'on'] as const
export type ModoAjusteCentavos = (typeof MODOS_AJUSTE_CENTAVOS)[number]

export const ETAPAS_AJUSTE_CENTAVOS = [
  'pendente',
  'renegociacao_criada',
  'titulo_incluido',
  'composicao_gravada',
  'ajuste_aplicado',
  'finalizada',
  'liberada',
  'sem_bloqueio',
  'rechaveada',
  'concluido',
  'concluido_sem_decisao',
  'aguardando_aprovacao_manual',
  'cancelado',
  'recusado',
  'indeterminado',
  'simulado',
] as const
export type EtapaAjusteCentavos = (typeof ETAPAS_AJUSTE_CENTAVOS)[number]

/** Estado do ajuste de um título (ledger). Só a máscara 5+4 do código; nunca o código. */
export const ajusteCentavosSchema = z.object({
  id: z.string(),
  filCod: z.number(),
  docCod: z.string(),
  titCodOrigem: z.string(),
  decisaoId: z.string(),
  titCodNovo: z.string().optional(),
  frnCod: z.number().optional(),
  etapa: z.enum(ETAPAS_AJUSTE_CENTAVOS),
  motivo: z.string().optional(),
  deltaCentavos: z.number().optional(),
  frnVldTpop: z.number().optional(),
  /** Valor do boleto = o LÍQUIDO do título novo depois do ajuste (centavos). */
  valorBoletoCentavos: z.number().optional(),
  codigoMascarado: z
    .string()
    .regex(/^\d{5}…\d{4}$/)
    .optional(),
  tentativas: z.number(),
  criadoEm: z.string().optional(),
  atualizadoEm: z.string().optional(),
  concluidoEm: z.string().optional(),
})
export type AjusteCentavos = z.infer<typeof ajusteCentavosSchema>

export const estadoAjustesCentavosSchema = z.object({
  modo: z.enum(MODOS_AJUSTE_CENTAVOS),
  avisos: z.array(z.string()),
  ajustes: z.array(ajusteCentavosSchema),
})
export type EstadoAjustesCentavos = z.infer<typeof estadoAjustesCentavosSchema>

export const resultadoAjusteCentavosSchema = z.object({
  resultado: z.string(),
  modo: z.enum(MODOS_AJUSTE_CENTAVOS),
  etapa: z.enum(ETAPAS_AJUSTE_CENTAVOS).optional(),
  motivo: z.string().optional(),
  execucaoId: z.string().optional(),
})
export type ResultadoAjusteCentavos = z.infer<typeof resultadoAjusteCentavosSchema>

const ajustesBase = '/sispag/ajustes-centavos'

/** `GET /sispag/ajustes-centavos?filCod=` (`sispag:ver`): modo efetivo e estado por título. */
export async function fetchAjustesCentavos(filCod: number): Promise<EstadoAjustesCentavos> {
  return autorizacaoRequest(
    `${ajustesBase}?filCod=${encodeURIComponent(String(filCod))}`,
    estadoAjustesCentavosSchema,
    { cache: 'no-store' },
  )
}

/** `POST .../tentar-novamente` (`sispag:executar`). 409 traz a mensagem pt-BR do servidor. */
export async function tentarAjusteCentavos(titulo: {
  filCod: number
  docCod: string
  titCod: string
}): Promise<ResultadoAjusteCentavos> {
  return autorizacaoRequest(`${ajustesBase}/tentar-novamente`, resultadoAjusteCentavosSchema, {
    method: 'POST',
    body: JSON.stringify(titulo),
  })
}

/**
 * `POST .../retomar` (`sispag:executar`) ao abrir a tela: o servidor agenda a varredura e responde
 * 202 na hora. Quem só tem `sispag:ver` recebe 403 — ignorado em silêncio.
 */
export async function retomarAjustesCentavos(): Promise<void> {
  try {
    await autorizacaoRequest(`${ajustesBase}/retomar`, z.object({ agendado: z.boolean() }), {
      method: 'POST',
      body: JSON.stringify({}),
    })
  } catch (e) {
    if (e instanceof AutorizacaoApiError && e.status === 403) return
    throw e
  }
}
