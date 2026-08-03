import type { MatchClassificacao, ParcelaFinalidade } from './constants.js';
import type { CreditoCliente } from './CreditoCliente.js';
import type { DocumentoAReceber } from './DocumentoAReceber.js';
import type { Processo } from './GerDocProcesso.js';
import type { NotaDebitoEletronica } from './NotaDebitoEletronica.js';
import type { RateioRecebimento } from './RateioRecebimento.js';
import type { Recebimento } from './Recebimento.js';
import type { RegraRecebimento } from './RegraRecebimento.js';
import type { TransacaoBancaria } from './TransacaoBancaria.js';

/**
 * Frente IV — the SEAMS (§3 of `frente-iv-arquitetura-modular.md`).
 *
 * These `*Interface` ports are the hand-off points between the 6 modules. No module imports another
 * module's *implementation* — only its *interface* + the shared DTOs. Swap a stub for a real class
 * via the DI token below and nothing else changes.
 *
 * Interface types can't be tsyringe tokens directly → each port has a `Symbol(...)` token (the
 * injection point teammates swap). SKELETON (Fase 0) — signatures frozen; implementations stubbed.
 */

// ─────────────────────────────────────────────────────────── Supporting types (contracts)

/** Raw movement fetched from Nexxera (wire confirmed in Fase 1 / spike O7). */
export interface RawMovimento {
    naturalKey: string;
    filCod: number;
    valor: number;
    moeda: string;
    dataMovimento: Date;
    payload: unknown;
}

/** Input to a Nexxera fetch — a period window. */
export interface NexxeraFetchPeriod {
    de: Date;
    ate: Date;
}

/**
 * Bound-execution options every external call MAY carry (Regis availability-2 / performance-2). The
 * adapter real MUST honour `timeoutMs` (default from `constants.ts`) so a hung Conexos/Nexxera/NDe
 * call never pins a worker until the global function timeout. `signal` lets the coordinator abort.
 */
export interface ExternalCallOptions {
    /** Latency ceiling in ms — the adapter aborts the call past this. Default lives in `constants.ts`. */
    timeoutMs?: number;
    signal?: AbortSignal;
}

/** Input to an ingest run. */
export interface IngestaoTransacoesInput {
    filCod: number;
    periodo: NexxeraFetchPeriod;
    correlationId: string;
    triggeredBy: string;
}

/** Result of an ingest run (persists `TransacaoBancaria[]`). */
export interface IngestaoTransacoesResult {
    runId: string;
    /**
     * OPCIONAL de propósito. A ingestão real NÃO materializa as transações: uma
     * run de 90 dias traz milhares de linhas, e devolvê-las na resposta HTTP do
     * trigger manual seria um payload de dezenas de MB para nenhum consumidor.
     * Quem precisa das linhas lê do banco. O stub segue populando (é barato lá).
     */
    importadas?: TransacaoBancaria[];
    total: number;
    deduplicadas: number;
}

/** Result of the matching engine — Módulo 2. */
export interface MatchResult {
    classificacao: MatchClassificacao;
    candidatos: DocumentoAReceber[];
    /** Drives the manual-queue threshold. */
    score: number;
}

/** Context handed to the rules engine — Módulo 4. */
export interface RegrasContext {
    recebimento: Recebimento;
    correlationId: string;
}

/** A parcela after a rule adjusted it (+ rationale) — Módulo 4. */
export interface ParcelaAjustada {
    rateio: RateioRecebimento;
    componente: ParcelaFinalidade;
    /** Explicable rationale registered on the `Recebimento`. */
    rationale: string;
    regraId: string;
}

/** Params to open a borderô in the ERP — `borVldTipo` is a PARAM (never hardcoded). */
export interface CriarBorderoParams {
    filCod: number;
    /** ERP borderô type — a PARAM, never a hardcoded `2`. */
    borVldTipo: number;
    /** Account routing — a PARAM, never hardcoded. */
    contaDestino: string;
    valor: number;
    correlationId: string;
    dryRun: boolean;
}

/** Result of opening a borderô. */
export interface BorderoCriado {
    borCod: number;
    dryRun: boolean;
}

/** Params to record a baixa (quitação) in the ERP. */
export interface GravarBaixaParams {
    borCod: number;
    filCod: number;
    docCod: string;
    titCod: string;
    valor: number;
    /** Account routing — a PARAM, never hardcoded. */
    contaDestino: string;
    correlationId: string;
    dryRun: boolean;
}

/** Result of a baixa. */
export interface BaixaGravada {
    bxaCodSeq: number;
    dryRun: boolean;
}

/** A structured observability event emitted per pipeline stage — Módulo 6. */
export interface MetricsEvent {
    stage: string;
    correlationId: string;
    /** No PII — counters/status only. */
    outcome: 'started' | 'ok' | 'error';
    /**
     * Counters/flags/enums only — NEVER PII. The type does not enforce this; it is a discipline
     * constraint. Módulo 6: never surface `TransacaoBancaria.contraparte`, `referenciaBancaria`,
     * `rawPayload` or `normalized` (payer name/CNPJ/bank ref/raw extract) in metric attributes.
     */
    attributes?: Record<string, number | string | boolean>;
}

// ─────────────────────────────────────────────────────────── Ports (interfaces) — Módulos 1–6

/** Módulo 1 — Nexxera gateway (channel-agnostic: API vs SFTP/CNAB, chosen after O7). */
export interface NexxeraGatewayInterface {
    /** `opts.timeoutMs` (default `NEXXERA_FETCH_TIMEOUT_MS`) MUST be honoured by the real adapter. */
    fetch: (period: NexxeraFetchPeriod, opts?: ExternalCallOptions) => Promise<RawMovimento[]>;
}

/**
 * Módulo 1 — ingest service (persists `TransacaoBancaria[]`, raw+normalized, deduped).
 *
 * `run` ingests ONE filial per call. `runMany` fans out over N filiais under a BOUNDED pool
 * (`FANOUT_LIMIT_RECEBIMENTOS`, mirrors the SISPAG mitigation of `LOGIN_ERROR_MAX_SESSIONS`) so a
 * Fase-1 consumer can't recreate the session-burst incident with `Promise.all`. `advisoryLockKey`
 * (namespaced `RECEBIMENTO_INGEST_LOCK_KEY`) is the cross-process exclusion contract for Módulo 1.
 */
export interface IngestaoTransacoesInterface {
    run: (input: IngestaoTransacoesInput) => Promise<IngestaoTransacoesResult>;
    runMany: (input: RunManyIngestaoInput) => Promise<IngestaoTransacoesResult>;
    readonly advisoryLockKey: number;
}

/** Input to the bounded multi-filial fan-out ingest run (Regis performance-1). */
export interface RunManyIngestaoInput {
    filCods: number[];
    periodo: NexxeraFetchPeriod;
    correlationId: string;
    triggeredBy: string;
}

/** Módulo 2 — matching engine (única/múltiplas/parcial/nenhuma). */
export interface MatchingEngineInterface {
    match: (transacao: TransacaoBancaria, abertos: DocumentoAReceber[]) => Promise<MatchResult>;
}

/** Módulo 3 — rateio engine (invariant I-Receb-1 enforced downstream). */
export interface RateioEngineInterface {
    ratear: (recebimento: Recebimento) => Promise<RateioRecebimento[]>;
}

/** Módulo 4 — rules engine (applies the versioned rule plugins). */
export interface RegrasEngineInterface {
    aplicar: (parcelas: RateioRecebimento[], ctx: RegrasContext) => Promise<ParcelaAjustada[]>;
}

/** Módulo 4 — a single rule plugin (`tipo`, `aplica`, rationale). */
export interface RegraRecebimentoInterface {
    readonly regra: RegraRecebimento;
    aplica: (parcelas: RateioRecebimento[], ctx: RegrasContext) => ParcelaAjustada[];
}

/** Módulo 5 — ERP receivables write (borVldTipo + account routing are PARAMS). */
export interface ErpReceivablesGatewayInterface {
    /** `opts.timeoutMs` (default `ERP_WRITE_TIMEOUT_MS`) MUST be honoured by the real adapter. */
    criarBordero: (
        params: CriarBorderoParams,
        opts?: ExternalCallOptions,
    ) => Promise<BorderoCriado>;
    /** `opts.timeoutMs` (default `ERP_WRITE_TIMEOUT_MS`) MUST be honoured by the real adapter. */
    gravarBaixa: (params: GravarBaixaParams, opts?: ExternalCallOptions) => Promise<BaixaGravada>;
}

/** Módulo 5 — NDe emitter (idempotent). */
export interface NdeEmitterInterface {
    /** `opts.timeoutMs` (default `NDE_EMIT_TIMEOUT_MS`) MUST be honoured by the real adapter. */
    emitir: (recebimento: Recebimento, opts?: ExternalCallOptions) => Promise<NotaDebitoEletronica>;
}

/** Módulo 6 — metrics port (structured events under one correlation id; reuses `LogService`). */
export interface MetricsPortInterface {
    emit: (event: MetricsEvent) => void;
    /**
     * Runs `fn` within a correlation-id scope. The scaffold stub is a pass-through; the real Módulo 6
     * impl MUST bind the id to the log context inside the scope (e.g. `logService.setMetadata({
     * qive_id: correlationId })`) so every downstream log carries it without the caller re-passing it.
     */
    withCorrelationId: <T>(correlationId: string, fn: () => T) => T;
}

/**
 * Provedor de PROCESSOS candidatos para uma `TransacaoBancaria` (Frente IV — "Alocar" no painel).
 *
 * O modal de "Alocar" lista os processos de importação candidatos para o operador ESCOLHER qual
 * processar. Nesta iteração é um STUB in-memory (fixtures) atrás deste port — sem matching-engine,
 * sem DB/SQL. Filtra por `filCod` da transação e, de forma frouxa, pela contraparte. Módulo 2/2b
 * troca o token pela fonte real (Conexos / matching) sem tocar rota/serviço.
 */
export interface ProcessoProviderInterface {
    listCandidatosParaTransacao: (input: ListCandidatosInput) => Promise<Processo[]>;
    /**
     * Clientes com processo aberto na filial — alimenta o seletor do modal
     * "Alocar". O extrato bancário NÃO carrega `pesCod` nem CNPJ (só um histórico
     * truncado pelo banco), então quem liga crédito↔cliente é o analista. Esta é
     * a lista que ele escolhe.
     */
    listClientes: (input: { filCod: number }) => Promise<ClienteProcesso[]>;
}

/** Cliente derivado dos processos abertos do `imp021`. */
export interface ClienteProcesso {
    pesCod: number;
    dpeNomPessoa: string;
    /** Nº de processos abertos — exibido junto ao nome para desambiguar homônimos. */
    processosAbertos: number;
    /**
     * Filiais em que o cliente tem processo aberto. Populado ao agregar a lista
     * multi-filial na rota (o provider é por-filial): o seletor do modal "Alocar"
     * varre TODAS as filiais acessíveis, não só a da transação (um crédito cai numa
     * filial mas a encomenda do cliente pode estar em outra). Ausente = single-filial.
     */
    filiais?: number[];
}

/** Filtro dos candidatos — `filCod` obrigatório (multi-filial). */
export interface ListCandidatosInput {
    filCod: number;
    /**
     * Cliente escolhido pelo analista. É o filtro FORTE e o caminho principal.
     */
    pesCod?: number;
    /**
     * Dica de contraparte vinda do histórico do extrato — match FROUXO por nome,
     * mantido só por compatibilidade. Não é chave: o banco trunca o histórico em
     * ~24 caracteres e não há CNPJ.
     */
    contraparte?: string;
}

// ─────────────────────────────────────────────────────────── Repository ports (the spine)

/** Persists/loads `TransacaoBancaria` (Módulo 1). */
export interface TransacaoRepositoryInterface {
    save: (transacao: TransacaoBancaria) => Promise<TransacaoBancaria>;
    findById: (id: string) => Promise<TransacaoBancaria | null>;
}

/**
 * Persists/loads the shared spine `Recebimento` (Módulo 2 seeds it, others update).
 *
 * `save` persists the FULL aggregate (root + `rateios` + `regrasAplicadas`) in ONE transaction and
 * bumps `versao` (Regis modifiability-1). Optimistic concurrency (Regis fault-tolerance-3): when
 * `expectedVersao` is given the UPDATE is guarded by `WHERE versao = expectedVersao` and a lost write
 * throws `RecebimentoVersionConflictError` (409, non-retryable) instead of silently overwriting.
 */
export interface RecebimentoRepositoryInterface {
    save: (recebimento: Recebimento, expectedVersao?: number) => Promise<Recebimento>;
    findById: (id: string) => Promise<Recebimento | null>;
}

/** The idempotency write-ahead ledger (Módulo 5). */
export interface RecebimentoExecucaoRepositoryInterface {
    findByIdempotencyKey: (key: string) => Promise<RecebimentoExecucaoRow | null>;
    beginExecution: (
        input: BeginRecebimentoExecucaoInput,
    ) => Promise<BeginRecebimentoExecucaoResult>;
    /**
     * Persist the `borCod` AS SOON as the borderô is created — BEFORE the next POST (Regis
     * fault-tolerance-2). If the process dies between `criarBordero` and `gravarBaixa`, the ledger
     * still points at the orphan borderô to reconcile (parity with `PermutaExecucaoRepository`).
     */
    setBorCod: (key: string, borCod: number) => Promise<void>;
    /** Persist the raw request payload for post-mortem/reconciliation (parity with Permutas). */
    setRequestPayload: (key: string, payload: unknown) => Promise<void>;
    markSettled: (key: string, data: RecebimentoExecucaoSettleData) => Promise<void>;
    markError: (key: string, data: RecebimentoExecucaoErrorData) => Promise<void>;
}

export type RecebimentoExecucaoStatus = 'pending' | 'reconciling' | 'settled' | 'error';

export interface RecebimentoExecucaoRow {
    idempotencyKey: string;
    recebimentoId: string;
    filCod: number;
    status: RecebimentoExecucaoStatus;
    dryRun: boolean;
    borCod?: number;
    ndeId?: string;
    erpResponse?: unknown;
    erroMensagem?: string;
    executadoPor?: string;
    criadoEm: Date;
    atualizadoEm: Date;
}

export interface BeginRecebimentoExecucaoInput {
    idempotencyKey: string;
    recebimentoId: string;
    filCod: number;
    dryRun: boolean;
    executadoPor: string;
}

export interface BeginRecebimentoExecucaoResult {
    status: RecebimentoExecucaoStatus;
    /** TRUE when the row was already `settled` (idempotency short-circuit). */
    alreadySettled: boolean;
}

export interface RecebimentoExecucaoSettleData {
    borCod?: number;
    ndeId?: string;
    erpResponse?: unknown;
}

export interface RecebimentoExecucaoErrorData {
    erroMensagem: string;
    erpResponse?: unknown;
    borCod?: number;
}

/**
 * Write-ahead ledger da Solicitação de Numerário (com299) — parity com o `RecebimentoExecucao`, mas o
 * handle de reconciliação é o `docCod` (o com299 é multi-call: cabeçalho → rateio → líquido → finaliza).
 * `setDocCod` persiste o `docCod` ASSIM QUE o cabeçalho é criado, ANTES do próximo POST (Regis
 * fault-tolerance-2): se a sequência morrer no meio, a trilha aponta o documento órfão a conciliar.
 */
export interface SolicitacaoNumerarioExecucaoRepositoryInterface {
    findByIdempotencyKey: (key: string) => Promise<SolicitacaoNumerarioExecucaoRow | null>;
    /** Auditoria: execuções (alocações) de uma transação bancária. */
    listByTxnId: (txnId: string) => Promise<SolicitacaoNumerarioExecucaoRow[]>;
    /** Auditoria: execuções por status (`error`/`reconciling`/`settled`/`pending`), com teto. */
    listByStatus: (status: string, limit: number) => Promise<SolicitacaoNumerarioExecucaoRow[]>;
    beginExecution: (
        input: BeginSolicitacaoNumerarioExecucaoInput,
    ) => Promise<BeginSolicitacaoNumerarioExecucaoResult>;
    setDocCod: (key: string, docCod: number) => Promise<void>;
    setRequestPayload: (key: string, payload: unknown) => Promise<void>;
    /** Tela 2 (fin014): grava o borderô do recebimento + avança a etapa (retomada anti-duplicação). */
    setFin014BorCod: (key: string, borCod: number) => Promise<void>;
    /** Tela 3 (com297): grava o docCod da nota de débito + avança a etapa (retomada anti-duplicação). */
    setNdDocCod: (key: string, docCod: number) => Promise<void>;
    /** Avança a etapa alcançada (leg fiscal: fiscal-done / obs-done / homologado / concluido). */
    setEtapa: (key: string, etapa: SolicitacaoNumerarioEtapa) => Promise<void>;
    /** Marca que a homologação voltou com validações pendentes (com194 — revisão humana). */
    setRevisaoHumana: (key: string, revisao: boolean) => Promise<void>;
    /** Marca que a SEFAZ autorizou a NDe no poll (`vldAutorizado != 0`). */
    setNdeAutorizado: (key: string, autorizado: boolean) => Promise<void>;
    markSettled: (key: string, data: SolicitacaoNumerarioExecucaoSettleData) => Promise<void>;
    markError: (key: string, data: SolicitacaoNumerarioExecucaoErrorData) => Promise<void>;
}

/**
 * Onde a orquestração do numerário REAL parou (retomada/diagnóstico). Espelha o `NumerarioEtapa` dos
 * permutas + as etapas da leg FISCAL confirmadas por HAR (fiscal-done → obs-done → homologado →
 * concluido).
 */
export type SolicitacaoNumerarioEtapa =
    | 'sn'
    | 'sn-finalizar'
    | 'fin014'
    | 'fin014-done'
    | 'nota-debito'
    | 'fiscal-done'
    | 'obs-done'
    | 'homologado'
    | 'concluido'
    | 'error';

export interface SolicitacaoNumerarioExecucaoRow {
    idempotencyKey: string;
    correlationId?: string;
    filCod: number;
    priCod: number;
    status: RecebimentoExecucaoStatus;
    dryRun: boolean;
    docCod?: number;
    /** Handle da transação bancária (pagamento) que originou a alocação. */
    txnId?: string;
    /** Valor alocado ao processo (base da SN). */
    valor?: number;
    /** Borderô do recebimento fin014 (Tela 2). */
    fin014BorCod?: number;
    /** docCod da nota de débito com297 (Tela 3). */
    ndDocCod?: number;
    etapa?: SolicitacaoNumerarioEtapa;
    /** Homologação com validações pendentes (com194) — precisa de revisão humana. */
    revisaoHumana?: boolean;
    /** SEFAZ autorizou a NDe (poll `vldAutorizado != 0`). */
    ndeAutorizado?: boolean;
    erpResponse?: unknown;
    erroMensagem?: string;
    executadoPor?: string;
    criadoEm: Date;
    atualizadoEm: Date;
}

export interface BeginSolicitacaoNumerarioExecucaoInput {
    idempotencyKey: string;
    correlationId?: string;
    filCod: number;
    priCod: number;
    /** Handle da transação bancária (pagamento) que originou a alocação. */
    txnId?: string;
    /** Valor alocado ao processo (base da SN). */
    valor?: number;
    dryRun: boolean;
    executadoPor: string;
}

export interface BeginSolicitacaoNumerarioExecucaoResult {
    status: RecebimentoExecucaoStatus;
    /** TRUE when the row was already `settled` (idempotency short-circuit). */
    alreadySettled: boolean;
}

export interface SolicitacaoNumerarioExecucaoSettleData {
    docCod?: number;
    /** docCod da nota de débito com297 (preservado no settle). */
    ndDocCod?: number;
    erpResponse?: unknown;
}

export interface SolicitacaoNumerarioExecucaoErrorData {
    erroMensagem: string;
    erpResponse?: unknown;
    docCod?: number;
    etapa?: SolicitacaoNumerarioEtapa;
}

/** Thin repositories for the added entity tables (Fase 4/5 seams). */
export interface CreditoClienteRepositoryInterface {
    save: (credito: CreditoCliente) => Promise<CreditoCliente>;
    findById: (id: string) => Promise<CreditoCliente | null>;
}

export interface RegraRecebimentoRepositoryInterface {
    save: (regra: RegraRecebimento) => Promise<RegraRecebimento>;
    listAtivas: () => Promise<RegraRecebimento[]>;
}

export interface NdeRepositoryInterface {
    save: (nde: NotaDebitoEletronica) => Promise<NotaDebitoEletronica>;
    findByRecebimentoId: (recebimentoId: string) => Promise<NotaDebitoEletronica | null>;
}

// ─────────────────────────────────────────────────────────── DI tokens (one Symbol per port)

export const NEXXERA_GATEWAY_TOKEN = Symbol('NexxeraGatewayInterface');
export const INGESTAO_TRANSACOES_TOKEN = Symbol('IngestaoTransacoesInterface');
export const MATCHING_ENGINE_TOKEN = Symbol('MatchingEngineInterface');
export const RATEIO_ENGINE_TOKEN = Symbol('RateioEngineInterface');
export const REGRAS_ENGINE_TOKEN = Symbol('RegrasEngineInterface');
export const ERP_RECEIVABLES_GATEWAY_TOKEN = Symbol('ErpReceivablesGatewayInterface');
export const NDE_EMITTER_TOKEN = Symbol('NdeEmitterInterface');
export const METRICS_PORT_TOKEN = Symbol('MetricsPortInterface');
export const TRANSACAO_REPOSITORY_TOKEN = Symbol('TransacaoRepositoryInterface');
export const RECEBIMENTO_REPOSITORY_TOKEN = Symbol('RecebimentoRepositoryInterface');
export const RECEBIMENTO_EXECUCAO_REPOSITORY_TOKEN = Symbol(
    'RecebimentoExecucaoRepositoryInterface',
);
export const SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN = Symbol(
    'SolicitacaoNumerarioExecucaoRepositoryInterface',
);
export const PROCESSO_PROVIDER_TOKEN = Symbol('ProcessoProviderInterface');
export const CREDITO_CLIENTE_REPOSITORY_TOKEN = Symbol('CreditoClienteRepositoryInterface');
export const REGRA_RECEBIMENTO_REPOSITORY_TOKEN = Symbol('RegraRecebimentoRepositoryInterface');
export const NDE_REPOSITORY_TOKEN = Symbol('NdeRepositoryInterface');
