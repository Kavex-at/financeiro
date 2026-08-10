import { withAuthHeaders } from './auth/token'
import { apiFetch } from './http'

/**
 * Recebimentos (Frente IV) — cliente da API do painel READ-ONLY (Fase 1).
 *
 * Bate em `GET /recebimentos/painel`; os tipos espelham
 * `backend/domain/interface/recebimentos/{TransacaoBancaria,Recebimento,NotaDebitoEletronica,constants}.ts`.
 * Como o backend hoje devolve um stub vazio, `fetchPainelRecebimentos()` cai num
 * FIXTURE (rede de segurança do demo — espelha `fetchGestaoPermutas` em `lib/api.ts`),
 * então o painel nunca quebra na review mesmo sem reads reais / Postgres semeado.
 */

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

// ─────────────────────────────────────────────────────────── Status/enum tipos (frozen)
// Mesmos valores literais das constantes do backend (`constants.ts`); FE não importa do
// backend (boundary), então os union types são replicados aqui, um-a-um.

export type RecebimentoStatus = 'rascunho' | 'aprovado' | 'executado' | 'estornado'

export type TransacaoBancariaStatus = 'importada' | 'conciliada' | 'parcial' | 'manual' | 'erro'

export type TransacaoTipo = 'CREDITO' | 'DEBITO' | 'ESTORNO' | 'TARIFA' | 'JUROS'

export type MatchClassificacao = 'unica' | 'multiplas' | 'parcial' | 'nenhuma'

export type NdeStatusEmissao = 'pendente' | 'emitida' | 'erro'

// ─────────────────────────────────────────────────────────── Entidades (espelho dos DTOs)
// `Date` do backend chega como ISO string no JSON — por isso os campos temporais são `string`.

/** Movimento bancário importado — espelho de `TransacaoBancaria` (Módulo 1). */
export interface TransacaoBancaria {
  id: string
  correlationId: string
  /**
   * Ausente = conta CORPORATIVA (ADR-0032). O canal automático (`fin095`) nunca traz filial — o
   * extrato é escopado por conta e o mesmo crédito é visto de todas as filiais. A filial da
   * operação só passa a existir na alocação, no `Recebimento`. O canal `xlsx_bradesco` traz.
   */
  filCod?: number
  dataMovimento: string
  tipo: TransacaoTipo
  valor: number
  moeda: string
  contraparte?: string
  referenciaBancaria?: string
  naturalKey: string
  status: TransacaoBancariaStatus
  /**
   * Conta financeira (Conexos `ger_num`) em que o pagamento caiu. É ela que a baixa
   * (fin014) usa — o pagamento já carrega a conta. Sem `gerNum` a alocação real não
   * pode rodar (o backend devolve 422); a UI bloqueia o Processar e avisa.
   */
  gerNum?: number
  /** Classificação do match (quando já houve `atribuirBaixa`). Fase 2 popula de verdade. */
  classificacaoMatch?: MatchClassificacao
  importRunId?: string
  importadoEm: string
}

/** Agregado de conciliação (a spine) — espelho de `Recebimento`. */
export interface Recebimento {
  id: string
  correlationId: string
  transacaoBancariaId: string
  filCod: number
  classificacaoMatch: MatchClassificacao
  status: RecebimentoStatus
  valorRecebido: number
  valorAlocado: number
  diferencaNaoAlocada: number
  ndeId?: string
  versao: number
  criadoPor: string
  aprovadoPor?: string
  executadoPor?: string
  estornadoPor?: string
  criadoEm: string
}

/** Nota de Débito Eletrônica — espelho de `NotaDebitoEletronica` (artefato terminal). */
export interface NotaDebitoEletronica {
  id: string
  recebimentoId: string
  filCod: number
  correlationId: string
  numeroNde?: string
  valor: number
  moeda: string
  statusEmissao: NdeStatusEmissao
  idempotencyKey: string
  emitidaEm?: string
  emitidaPor?: string
}

/** KPIs agregados do painel (Fase 1 — derivados client-side do fixture se ausentes). */
export interface RecebimentosKpis {
  importadas: number
  conciliadas: number
  parciais: number
  filaManual: number
  erro: number
  valorNaoAlocado: number
  ndePendentes: number
}

export interface RecebimentosPainel {
  /**
   * Origem dos dados. `fixture` sobrevive só para os testes e para o fixture
   * exportado — nenhum caminho de produção produz esse valor desde que os
   * fallbacks silenciosos saíram.
   */
  fonte: 'banco' | 'fixture'
  geradoEm: string
  kpis: RecebimentosKpis
  transacoes: TransacaoBancaria[]
  recebimentos: Recebimento[]
  ndes: NotaDebitoEletronica[]
  /** Fim da última ingestão bem-sucedida — exibido como "carteira de". */
  ultimaIngestao?: string
  /** `true` quando o backend capou a lista. */
  truncado?: boolean
}

// ─────────────────────────────────────────────────────────── Fixture (rede de segurança)
// Semeado a partir das shapes de `backend/.../__fixtures__` (mesmos IDs/valores) + variações
// que exercitam TODO status/classificação, para a review ver cada chip.

/** Deriva os KPIs a partir das listas — fonte única, evita drift entre cards e tabelas. */
export function computeKpis(
  transacoes: TransacaoBancaria[],
  recebimentos: Recebimento[],
  ndes: NotaDebitoEletronica[],
): RecebimentosKpis {
  return {
    importadas: transacoes.filter((t) => t.status === 'importada').length,
    conciliadas: transacoes.filter((t) => t.status === 'conciliada').length,
    parciais: transacoes.filter((t) => t.status === 'parcial').length,
    filaManual: transacoes.filter((t) => t.status === 'manual').length,
    erro: transacoes.filter((t) => t.status === 'erro').length,
    valorNaoAlocado: recebimentos.reduce((acc, r) => acc + (r.diferencaNaoAlocada || 0), 0),
    ndePendentes: ndes.filter((n) => n.statusEmissao === 'pendente').length,
  }
}

const fixtureTransacoes: TransacaoBancaria[] = [
  {
    id: 'txn-0001',
    correlationId: 'corr-0001',
    filCod: 4,
    dataMovimento: '2026-07-20T15:00:00.000Z',
    tipo: 'CREDITO',
    valor: 15000,
    moeda: 'BRL',
    contraparte: 'CLIENTE EXEMPLO LTDA',
    referenciaBancaria: 'PIX-ABC123',
    naturalKey: '4:12345:2026-07-20:15000:PIX-ABC123',
    status: 'importada',
    importRunId: 'run-0001',
    importadoEm: '2026-07-20T15:05:00.000Z',
  },
  {
    id: 'txn-0002',
    correlationId: 'corr-0002',
    filCod: 4,
    dataMovimento: '2026-07-19T13:30:00.000Z',
    tipo: 'CREDITO',
    valor: 32500.5,
    moeda: 'BRL',
    contraparte: 'IMPORTADORA ATLAS S.A.',
    referenciaBancaria: 'TED-778812',
    naturalKey: '4:98120:2026-07-19:32500:TED-778812',
    status: 'conciliada',
    classificacaoMatch: 'unica',
    importRunId: 'run-0001',
    importadoEm: '2026-07-19T13:40:00.000Z',
  },
  {
    id: 'txn-0003',
    correlationId: 'corr-0003',
    filCod: 7,
    dataMovimento: '2026-07-18T18:10:00.000Z',
    tipo: 'CREDITO',
    valor: 9000,
    moeda: 'BRL',
    contraparte: 'COMERCIAL VERTEX LTDA',
    referenciaBancaria: 'PIX-CD9931',
    naturalKey: '7:44201:2026-07-18:9000:PIX-CD9931',
    status: 'parcial',
    classificacaoMatch: 'parcial',
    importRunId: 'run-0002',
    importadoEm: '2026-07-18T18:22:00.000Z',
  },
  {
    id: 'txn-0004',
    correlationId: 'corr-0004',
    filCod: 7,
    dataMovimento: '2026-07-17T11:05:00.000Z',
    tipo: 'CREDITO',
    valor: 5400,
    moeda: 'BRL',
    contraparte: 'DESCONHECIDO / SEM REF.',
    referenciaBancaria: 'TED-000451',
    naturalKey: '7:11002:2026-07-17:5400:TED-000451',
    status: 'manual',
    classificacaoMatch: 'nenhuma',
    importRunId: 'run-0002',
    importadoEm: '2026-07-17T11:15:00.000Z',
  },
  {
    id: 'txn-0005',
    correlationId: 'corr-0005',
    filCod: 4,
    dataMovimento: '2026-07-16T09:45:00.000Z',
    tipo: 'CREDITO',
    valor: 21750,
    moeda: 'BRL',
    contraparte: 'GRUPO MERIDIAN',
    referenciaBancaria: 'PIX-EF5567',
    naturalKey: '4:77310:2026-07-16:21750:PIX-EF5567',
    status: 'erro',
    importRunId: 'run-0002',
    importadoEm: '2026-07-16T09:52:00.000Z',
  },
]

const fixtureRecebimentos: Recebimento[] = [
  {
    id: 'rec-0001',
    correlationId: 'corr-0001',
    transacaoBancariaId: 'txn-0001',
    filCod: 4,
    classificacaoMatch: 'unica',
    status: 'rascunho',
    valorRecebido: 15000,
    valorAlocado: 15000,
    diferencaNaoAlocada: 0,
    versao: 0,
    criadoPor: 'analista',
    criadoEm: '2026-07-20T15:10:00.000Z',
  },
  {
    id: 'rec-0002',
    correlationId: 'corr-0002',
    transacaoBancariaId: 'txn-0002',
    filCod: 4,
    classificacaoMatch: 'unica',
    status: 'executado',
    valorRecebido: 32500.5,
    valorAlocado: 32500.5,
    diferencaNaoAlocada: 0,
    ndeId: 'nde-0002',
    versao: 2,
    criadoPor: 'analista',
    aprovadoPor: 'analista',
    executadoPor: 'analista',
    criadoEm: '2026-07-19T13:45:00.000Z',
  },
  {
    id: 'rec-0003',
    correlationId: 'corr-0003',
    transacaoBancariaId: 'txn-0003',
    filCod: 7,
    classificacaoMatch: 'parcial',
    status: 'aprovado',
    valorRecebido: 9000,
    valorAlocado: 6000,
    diferencaNaoAlocada: 3000,
    versao: 1,
    criadoPor: 'analista',
    aprovadoPor: 'analista',
    criadoEm: '2026-07-18T18:30:00.000Z',
  },
]

const fixtureNdes: NotaDebitoEletronica[] = [
  {
    id: 'nde-0002',
    recebimentoId: 'rec-0002',
    filCod: 4,
    correlationId: 'corr-0002',
    numeroNde: 'NDE-000123',
    valor: 32500.5,
    moeda: 'BRL',
    statusEmissao: 'emitida',
    idempotencyKey: 'receb:rec-0002:corr-0002',
    emitidaEm: '2026-07-19T14:02:00.000Z',
    emitidaPor: 'analista',
  },
  {
    id: 'nde-0003',
    recebimentoId: 'rec-0003',
    filCod: 7,
    correlationId: 'corr-0003',
    valor: 9000,
    moeda: 'BRL',
    statusEmissao: 'pendente',
    idempotencyKey: 'receb:rec-0003:corr-0003',
  },
]

/** Painel completo de demonstração — a rede de segurança do fixture. */
export const recebimentosPainelFixture: RecebimentosPainel = {
  fonte: 'fixture',
  geradoEm: '2026-07-20T15:30:00.000Z',
  kpis: computeKpis(fixtureTransacoes, fixtureRecebimentos, fixtureNdes),
  transacoes: fixtureTransacoes,
  recebimentos: fixtureRecebimentos,
  ndes: fixtureNdes,
}

// ─────────────────────────────────────────────────────────── Fetch (backend → fixture)

/** Cliente com processo aberto (seletor do modal "Alocar"). */
export interface ClienteProcesso {
  pesCod: number
  dpeNomPessoa: string
  processosAbertos: number
  /** Filiais em que o cliente tem processo aberto (a busca é multi-filial). */
  filiais?: number[]
}

/** Shape que o backend devolve. */
interface PainelResponseRaw {
  geradoEm?: string
  /** Fim da última ingestão bem-sucedida — o painel exibe "carteira de". */
  ultimaIngestao?: string
  /** `true` quando a lista bateu no teto do backend. */
  truncado?: boolean
  transacoes?: TransacaoBancaria[]
  recebimentos?: Recebimento[]
  ndes?: NotaDebitoEletronica[]
  kpis?: Partial<RecebimentosKpis>
}

// ─────────────────────────────────────────────── Alocar / Solicitação de Numerário (dry-run)
// Espelham `backend/domain/interface/recebimentos/GerDocProcesso.ts`. O "Processar" gera uma
// Solicitação de Numerário (encomenda) via com299/gerDocProcesso em DRY-RUN — nada vai ao ERP.

/** Processo de importação candidato para uma transação — espelho de `Processo`. */
export interface Processo {
  priCod: number
  /** Opcional: o `imp021` não preenche em todo processo. */
  priEspRefcliente?: string
  filCod: number
  pesCod: number
  dpeNomPessoa: string
  moeCod: number
  /**
   * `true` quando a moeda NÃO veio do ERP e foi assumida (BRL/790) — o `imp021`
   * só expõe `moeCodConv` (conversão) e `moeCodSeg` (seguro). A UI avisa; assumir
   * calado num payload financeiro vira bug no dia em que deixar de ser dry-run.
   */
  moeCodAssumido?: boolean
  valor?: number
  contraparte?: string
}

/** Item de rateio da SN (`TmpCom068DTOItem`) — espelho do wire com299. */
export interface TmpCom068DTOItem {
  prjCod: number
  ctpCod: number
  tmpMnyValor: number
  ctpDesNome: string
  tpcCod: number
  cfoEspCod: number
  total: number
}

/**
 * Cabeçalho do payload com299 (`GerDocProcessoSelectionDTOCab`). `docTip`/`docVldTipo`/`docVldTipoAdto`
 * são NUMÉRICOS (HAR-confirmado, doc 18202); `moeCod` é `null` na SN Encomenda (BRL implícito).
 */
export interface GerDocProcessoSelectionDTOCab {
  filCod: number
  docTip: number
  docVldTipo: number
  docVldTipoAdto: number
  priCod: number
  priEspRefcliente: string
  pesCod: number
  dpeNomPessoa: string
  gcdCod: number
  gcdDesNome: string
  docDtaEmissao: string
  dtaVencimento: string
  valor: number
  moeCod: number | null
  items: TmpCom068DTOItem[]
}

/** Config de documento (`gcd`) devolvida no preview. */
export interface DocConfig {
  gcdCod: number
  gcdDesNome: string
}

/** Resultado do "Processar" — SEMPRE dry-run (constrói o payload, não envia ao ERP). */
export interface SolicitacaoNumerarioDryRun {
  dryRun: true
  docConfig: DocConfig
  payload: GerDocProcessoSelectionDTOCab
}

// ─────────────────────────────────────────── Alocação REAL (payment-driven, split)
// A partir da automação real do Conexos: "Processar" numa linha roda a automação
// completa (com299 SN → fin014 baixa na conta do pagamento → com297 NDe + cauda
// fiscal + homologação + poll SEFAZ) para UMA alocação. Split: cada processo
// consome parte do `saldoRestante`. Espelha o contrato do backend um-a-um.

/**
 * Status terminal de uma alocação real. `blocked` = o pré-flight barrou ANTES de qualquer escrita
 * (cadastro/elegibilidade/modalidade indeterminável) — nada foi ao ERP, e o `motivo` explica o quê.
 */
export type AlocacaoStatus = 'settled' | 'skipped' | 'error' | 'dry-run' | 'blocked'

/** Corpo enviado ao backend para processar UMA alocação. */
export interface AlocacaoRequest {
  priCod: number
  valor: number
  /**
   * Filial DO PROCESSO escolhido (não a do pagamento). Todo o fluxo Conexos
   * (com299 SN → fin014 → com297 + cauda fiscal) roda nesta filial: o processo de
   * importação pode viver numa filial diferente da transação. A conta financeira
   * (`gerNum`) é global, então continua válida aqui.
   */
  filCod: number
  priEspRefcliente?: string
  pesCod: number
  dpeNomPessoa: string
  moeCod: number
  /**
   * SN EXISTENTE escolhida pelo analista (ADR-0027) — `docCod` da SN já finalizada. Quando
   * presente, o backend PULA a criação da SN e roda fin014 baixa + com297 NDe contra este
   * `docCod`. Ausente = "Criar novo SN" (fluxo completo, inalterado).
   */
  snDocCod?: number
}

/** Uma Solicitação de Numerário já existente do processo — espelho do DTO do backend. */
export interface SolicitacaoNumerarioListItem {
  /** `docCod` da SN — o handle que a baixa fin014 + NDe com297 usam. */
  docCod: number
  /** Número do documento (`docEspNumero`). */
  numero: string
  /** Emissão em ISO. */
  data: string
  /** Descrição derivada (gcd/tpd/ger). */
  descricao: string
  /** `vldStatus` cru do ERP. */
  status: number
  /** Rótulo humano do status (best-effort). */
  statusLabel: string
  /** Valor solicitado (`mnyBruto`). */
  solicitado: number
  /** Valor do documento (`docMnyValor`). */
  valor: number
}

/**
 * Resultado de UMA alocação real — espelho do que o backend devolve em
 * `POST /recebimentos/transacoes/:txnId/solicitacao-numerario`.
 */
export interface AlocacaoResultado {
  status: AlocacaoStatus
  /** Etapa em que parou (ou onde falhou, quando `status === 'error'`). */
  etapa?: string
  /** docCod da Solicitação de Numerário (com299). */
  snDocCod?: number
  /** nº do borderô da baixa (fin014). */
  borCod?: number
  /** docCod da Nota de Débito (com297). */
  ndDocCod?: number
  /** Homologou com validações pendentes (`docVldComvalidacoes===2`) → revisão humana. */
  revisaoHumana?: boolean
  /** Autorização SEFAZ concluída (poll `vldAutorizado`). */
  ndeAutorizado?: boolean
  /** Resultado de `docVldComvalidacoes` da homologação (1 ok / 2 → revisão). */
  docVldComvalidacoes?: number
  /** `vldAutorizado` da NDe: `0` = ainda aguardando SEFAZ (não é falha). */
  vldAutorizado?: number
  /** Mensagem de erro quando `status === 'error'`. */
  erro?: string
  /**
   * `true` quando a quitação fechou SEM nota de débito porque o processo é POR CONTA E ORDEM DE
   * TERCEIROS (ADR-0031). É sucesso: a SN e a baixa aconteceram; a nota é que não era devida.
   */
  ndeDispensada?: boolean
  /** Explicação legível de um `blocked` — ou da dispensa da NDe. Nunca um erro cru do ERP. */
  motivo?: string
  /** `true` quando o backend rodou em modo simulação (nada foi ao ERP). */
  dryRun: boolean
}

/** Config canônica da SN encomenda (fixture de fallback + rótulo). */
export const SOLICITACAO_NUMERARIO_GCD_DES_NOME = 'Solicitação de Numerário - Encomenda'

// `buildDryRunFallback` foi REMOVIDO (A2): o payload dry-run vem SEMPRE do backend
// (`processarSolicitacaoNumerario` propaga erro em vez de inventar documento no navegador), e o
// `gcdCod` é fonte única do env → `docConfig` do backend — nada de duplicata hardcoded no FE.

/**
 * Lista os PROCESSOS do cliente escolhido pelo analista (modal "Alocar").
 *
 * Multi-filial: o backend varre TODAS as filiais acessíveis (não só a da
 * transação) e cada `Processo` carrega o próprio `filCod` — a SN gerada herda a
 * filial do processo. Sem `pesCod` o backend devolve `[]` de propósito: o extrato
 * não carrega cliente, então listar processos "da filial" seria despejar centenas
 * de linhas sem critério.
 *
 * NÃO tem fallback de fixture. Um backend fora do ar precisa aparecer como erro —
 * um analista olhando dados de demonstração achando que são reais é pior que uma
 * tela vazia.
 */
export async function fetchProcessosParaTransacao(
  txnId: string,
  pesCod?: number,
): Promise<Processo[]> {
  const qs = new URLSearchParams()
  if (pesCod !== undefined) qs.set('pesCod', String(pesCod))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const res = await apiFetch(
    `${API}/recebimentos/transacoes/${encodeURIComponent(txnId)}/processos${suffix}`,
    { headers: await withAuthHeaders() },
  )
  if (!res.ok) throw new Error(`API ${res.status}`)
  const json = (await res.json()) as { processos?: Processo[] }
  return json.processos ?? []
}

/**
 * Lista as Solicitações de Numerário (SN) já EXISTENTES de um processo (ADR-0027) —
 * `GET /recebimentos/processos/:priCod/sns?filCod=`. Alimenta o painel de seleção de SN do modal
 * "Alocar": o analista escolhe uma SN existente (baixa contra o `docCod` dela) ou "Criar novo SN".
 *
 * `filCod` é o da filial DO PROCESSO. Sem fallback de fixture: um backend fora do ar precisa
 * aparecer como erro, não como uma lista inventada de documentos financeiros.
 */
export async function fetchSNsDoProcesso(
  priCod: number,
  filCod: number,
): Promise<SolicitacaoNumerarioListItem[]> {
  const res = await apiFetch(
    `${API}/recebimentos/processos/${encodeURIComponent(String(priCod))}/sns?filCod=${encodeURIComponent(
      String(filCod),
    )}`,
    { headers: await withAuthHeaders() },
  )
  if (!res.ok) throw new Error(`API ${res.status}`)
  const json = (await res.json()) as { sns?: SolicitacaoNumerarioListItem[] }
  return json.sns ?? []
}

/**
 * Clientes com processo aberto — alimenta o seletor do modal "Alocar".
 *
 * Multi-filial de propósito: um crédito cai numa filial, mas a encomenda do
 * cliente pode estar em outra. O backend agrega por cliente sobre todas as
 * filiais acessíveis, então o analista sempre encontra o pagador.
 */
export async function fetchClientes(): Promise<ClienteProcesso[]> {
  const res = await apiFetch(`${API}/recebimentos/clientes`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const json = (await res.json()) as { clientes?: ClienteProcesso[] }
  return json.clientes ?? []
}

/**
 * "Processar" uma alocação → roda a automação REAL do Conexos para UM processo
 * (`POST /recebimentos/transacoes/:txnId/solicitacao-numerario`): com299 (SN) → fin014
 * (baixa na conta do pagamento) → com297 (NDe) + cauda fiscal + homologação + poll SEFAZ.
 * NÃO é simulação — gera documentos no ERP. O modo dry-run é decidido pelo backend
 * (`resposta.dryRun`).
 *
 * Split: `valor` é a fatia deste processo do saldo do pagamento (o modal controla o
 * `saldoRestante`); o `moeCod`/`pesCod`/`dpeNomPessoa` vêm do processo escolhido.
 *
 * NÃO tem fallback local. Um erro do backend PRECISA aparecer como erro — inventar
 * um sucesso no navegador seria pior, pois não corresponde ao estado do ERP.
 */
export async function processarSolicitacaoNumerario(
  txnId: string,
  allocation: AlocacaoRequest,
): Promise<AlocacaoResultado> {
  const res = await apiFetch(
    `${API}/recebimentos/transacoes/${encodeURIComponent(txnId)}/solicitacao-numerario`,
    {
      method: 'POST',
      headers: await withAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        priCod: allocation.priCod,
        valor: allocation.valor,
        filCod: allocation.filCod,
        priEspRefcliente: allocation.priEspRefcliente,
        pesCod: allocation.pesCod,
        dpeNomPessoa: allocation.dpeNomPessoa,
        moeCod: allocation.moeCod,
        // SN existente escolhida (ADR-0027) — só vai no corpo quando definida ("Criar novo SN" omite).
        ...(allocation.snDocCod !== undefined ? { snDocCod: allocation.snDocCod } : {}),
      }),
    },
  )
  if (!res.ok) throw new Error(`API ${res.status}`)
  const json = (await res.json()) as Partial<AlocacaoResultado>
  if (!json?.status) {
    throw new Error('Resposta do backend sem status da alocação')
  }
  return {
    status: json.status,
    etapa: json.etapa,
    snDocCod: json.snDocCod,
    borCod: json.borCod,
    ndDocCod: json.ndDocCod,
    revisaoHumana: json.revisaoHumana,
    ndeAutorizado: json.ndeAutorizado,
    docVldComvalidacoes: json.docVldComvalidacoes,
    vldAutorizado: json.vldAutorizado,
    ndeDispensada: json.ndeDispensada,
    motivo: json.motivo,
    erro: json.erro,
    dryRun: json.dryRun ?? false,
  }
}

/**
 * Busca o painel de Recebimentos (`GET /recebimentos/painel`).
 *
 * NÃO cai mais em fixture. O early-return de "lista vazia → dados de demonstração"
 * sequestrava qualquer resposta legítima: um banco vazio de verdade virava demo, e
 * a tela nunca conseguia mostrar dado real. Erro propaga — a página já tem estado
 * de erro com botão de tentar de novo.
 */
export async function fetchPainelRecebimentos(): Promise<RecebimentosPainel> {
  const res = await apiFetch(`${API}/recebimentos/painel`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const json = (await res.json()) as PainelResponseRaw
  const transacoes = json.transacoes ?? []
  const recebimentos = json.recebimentos ?? []
  const ndes = json.ndes ?? []
  return {
    fonte: 'banco',
    geradoEm: json.geradoEm ?? new Date().toISOString(),
    // Os KPIs do backend vêm de COUNT(*) sobre a janela inteira e têm precedência
    // sobre os derivados da página (que contariam só as linhas exibidas).
    kpis: { ...computeKpis(transacoes, recebimentos, ndes), ...(json.kpis ?? {}) },
    transacoes,
    recebimentos,
    ndes,
    ultimaIngestao: json.ultimaIngestao,
    truncado: json.truncado ?? false,
  }
}

// ─────────────────────────────────────────────── Importação MANUAL de extrato (.xlsx) — canal alternativo

/** Conta financeira Conexos (`fin133`) — a `gerNum` que o `fin014` usa como "Conta Financeira de Baixa". */
export interface ContaFinanceira {
  gerNum: number
  /** Descrição legível: `"BANCO ITAÚ - AG. 0641 CONTA 55.795-4"`. */
  gerDes?: string
  bncDesNome?: string
}

/**
 * Contas financeiras da filial (`GET /recebimentos/contas`). O `.xlsx` não carrega `gerNum` — o
 * analista confirma explicitamente qual conta Conexos corresponde ao extrato que está subindo.
 */
export async function fetchContasFinanceiras(filCod: number): Promise<ContaFinanceira[]> {
  const res = await apiFetch(`${API}/recebimentos/contas?filCod=${filCod}`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) throw new Error(await erroUpload(res))
  const json = (await res.json()) as { contas?: ContaFinanceira[] }
  return json.contas ?? []
}

/** Uma linha (crédito) da amostra do preview, com o veredito de dedup. */
export interface ImportExtratoPreviewLinha {
  /** Número da linha na planilha original — identifica a linha para seleção na confirmação. */
  linhaIndice: number
  data: string
  descricao: string
  contraparteNome: string | null
  contraparteDoc: string | null
  valor: number
  /** `false` = já existe na carteira (será deduplicada na confirmação). */
  novo: boolean
}

/** Dry-run do upload (`POST /recebimentos/ingestao/upload/preview`) — nenhuma escrita. */
export interface ImportExtratoPreview {
  cabecalho: {
    banco: string
    agencia?: string
    conta?: string
    periodoDe?: string
    periodoAte?: string
  }
  totalLinhas: number
  totalCreditos: number
  totalIgnorados: number
  novos: number
  jaImportados: number
  jaImportadoArquivo: boolean
  amostra: ImportExtratoPreviewLinha[]
}

/** Resultado da importação efetiva (`POST /recebimentos/ingestao/upload`). */
export interface ImportExtratoResult {
  runId: string
  reaproveitada: boolean
  totalCreditos: number
  inseridas: number
  deduplicadas: number
}

/** Extrai a mensagem de erro do backend (campo `error`) — ou cai no status HTTP. */
async function erroUpload(res: Response): Promise<string> {
  try {
    const j = await res.json()
    if (j?.error) return String(j.error)
  } catch {}
  return `API ${res.status}`
}

/** Monta o multipart do upload (arquivo + filial + conta). NÃO seta content-type — o browser põe o boundary. */
function formExtrato(
  file: File,
  filCod: number,
  gerNum: number,
  excluirLinhas?: number[],
): FormData {
  const form = new FormData()
  form.append('file', file)
  form.append('filCod', String(filCod))
  form.append('gerNum', String(gerNum))
  if (excluirLinhas && excluirLinhas.length > 0) {
    form.append('excluirLinhas', JSON.stringify(excluirLinhas))
  }
  return form
}

/** Preview do upload de extrato: parseia no servidor e classifica novos × já importados, sem gravar. */
export async function previewImportExtrato(
  file: File,
  filCod: number,
  gerNum: number,
): Promise<ImportExtratoPreview> {
  const res = await apiFetch(`${API}/recebimentos/ingestao/upload/preview`, {
    method: 'POST',
    headers: await withAuthHeaders(),
    body: formExtrato(file, filCod, gerNum),
  })
  if (!res.ok) throw new Error(await erroUpload(res))
  return res.json()
}

/**
 * Importa efetivamente os créditos do extrato .xlsx. `gerNum` é a conta financeira Conexos
 * confirmada pelo analista — estampada em toda transação desta importação, já que o `.xlsx` não a
 * carrega. `excluirLinhas` são os `linhaIndice` desmarcados no preview — ficam de fora desta
 * importação. A idempotência é por hash do arquivo + seleção no backend (mesma combinação
 * reaproveita a run), então o FE não precisa gerar Idempotency-Key.
 */
export async function importExtrato(
  file: File,
  filCod: number,
  gerNum: number,
  excluirLinhas?: number[],
): Promise<ImportExtratoResult> {
  const res = await apiFetch(`${API}/recebimentos/ingestao/upload`, {
    method: 'POST',
    headers: await withAuthHeaders(),
    body: formExtrato(file, filCod, gerNum, excluirLinhas),
  })
  if (!res.ok) throw new Error(await erroUpload(res))
  return res.json()
}
