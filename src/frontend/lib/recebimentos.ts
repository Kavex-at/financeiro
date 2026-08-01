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
  filCod: number
  dataMovimento: string
  tipo: TransacaoTipo
  valor: number
  moeda: string
  contraparte?: string
  referenciaBancaria?: string
  naturalKey: string
  status: TransacaoBancariaStatus
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
 * "Processar" um processo → gera a Solicitação de Numerário (encomenda) em DRY-RUN
 * (`POST /recebimentos/transacoes/:txnId/solicitacao-numerario`). NUNCA envia ao ERP: o backend só
 * CONSTRÓI e devolve o payload.
 *
 * NÃO tem fallback local. Montar o payload no navegador quando o backend cai
 * mostrava um documento INVENTADO com um toast verde de sucesso — pior que um
 * erro, porque não corresponde ao que o backend faria.
 */
export async function processarSolicitacaoNumerario(
  txnId: string,
  processo: Processo,
  valorTransacao: number,
): Promise<SolicitacaoNumerarioDryRun> {
  const res = await apiFetch(
      `${API}/recebimentos/transacoes/${encodeURIComponent(txnId)}/solicitacao-numerario`,
      {
        method: 'POST',
        headers: await withAuthHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          filCod: processo.filCod,
          priCod: processo.priCod,
          priEspRefcliente: processo.priEspRefcliente,
          pesCod: processo.pesCod,
          dpeNomPessoa: processo.dpeNomPessoa,
          moeCod: processo.moeCod,
          valorTransacao,
        }),
      },
    )
    if (!res.ok) throw new Error(`API ${res.status}`)
    const json = (await res.json()) as Partial<SolicitacaoNumerarioDryRun>
  if (!json?.payload || !json?.docConfig) {
    throw new Error('Resposta do backend sem payload/docConfig')
  }
  return { dryRun: true, docConfig: json.docConfig, payload: json.payload }
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
