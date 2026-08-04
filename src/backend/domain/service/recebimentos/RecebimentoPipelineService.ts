import 'reflect-metadata';
import { inject, injectable } from 'tsyringe';
import {
    ERP_WRITE_TIMEOUT_MS,
    NDE_EMIT_TIMEOUT_MS,
    RECEBIMENTO_RETRY_ATTEMPTS,
    RECEBIMENTO_RETRY_DELAY_MS,
    RECEBIMENTO_STATUS,
} from '../../interface/recebimentos/constants.js';
import RetryExecutor from '../../libs/executor/RetryExecutor.js';
import type { DocumentoAReceber } from '../../interface/recebimentos/DocumentoAReceber.js';
import type { Recebimento } from '../../interface/recebimentos/Recebimento.js';
import {
    assertTransitionRecebimento,
    computeDiferencaNaoAlocada,
    computeValorAlocado,
} from '../../interface/recebimentos/recebimentoTransitions.js';
import type { TransacaoBancaria } from '../../interface/recebimentos/TransacaoBancaria.js';
import {
    ERP_RECEIVABLES_GATEWAY_TOKEN,
    INGESTAO_TRANSACOES_TOKEN,
    MATCHING_ENGINE_TOKEN,
    METRICS_PORT_TOKEN,
    NDE_EMITTER_TOKEN,
    RATEIO_ENGINE_TOKEN,
    RECEBIMENTO_EXECUCAO_REPOSITORY_TOKEN,
    RECEBIMENTO_REPOSITORY_TOKEN,
    REGRAS_ENGINE_TOKEN,
} from '../../interface/recebimentos/ports.js';
import type {
    ErpReceivablesGatewayInterface,
    IngestaoTransacoesInput,
    IngestaoTransacoesInterface,
    MatchingEngineInterface,
    MetricsPortInterface,
    NdeEmitterInterface,
    RateioEngineInterface,
    RecebimentoExecucaoRepositoryInterface,
    RecebimentoRepositoryInterface,
    RegrasEngineInterface,
} from '../../interface/recebimentos/ports.js';
import LogService from '../LogService.js';

/** Input to a full pipeline run — the spine plus the read-model context. */
export interface RunPipelineInput {
    recebimento: Recebimento;
    transacao: TransacaoBancaria;
    documentosAbertos: DocumentoAReceber[];
    ingestao: IngestaoTransacoesInput;
    /** ERP routing params — never hardcoded (Módulo 5). */
    borVldTipo: number;
    contaDestino: string;
    dryRun: boolean;
    ator: string;
}

/**
 * RecebimentoPipelineService — the COORDINATOR (owned by architecture).
 *
 * Wires the 5 stages through the injected PORT TOKENS (never concrete stubs — swap-a-token
 * property): importarTransacoes → atribuirBaixa → ratearRecebimento → aplicarRegras →
 * executarRecebimento. Each stage reads its slice off the `Recebimento` spine, calls the port,
 * writes its slice back, and emits a metrics event under the correlation id. State changes go through
 * the pure `assertTransitionRecebimento` guard. NO business logic — orchestration only (SKELETON).
 */
@injectable()
export default class RecebimentoPipelineService {
    constructor(
        @inject(INGESTAO_TRANSACOES_TOKEN)
        private ingestao: IngestaoTransacoesInterface,
        @inject(MATCHING_ENGINE_TOKEN)
        private matching: MatchingEngineInterface,
        @inject(RATEIO_ENGINE_TOKEN)
        private rateio: RateioEngineInterface,
        @inject(REGRAS_ENGINE_TOKEN)
        private regras: RegrasEngineInterface,
        @inject(ERP_RECEIVABLES_GATEWAY_TOKEN)
        private erp: ErpReceivablesGatewayInterface,
        @inject(NDE_EMITTER_TOKEN)
        private ndeEmitter: NdeEmitterInterface,
        @inject(METRICS_PORT_TOKEN)
        private metrics: MetricsPortInterface,
        @inject(RECEBIMENTO_REPOSITORY_TOKEN)
        private recebimentoRepository: RecebimentoRepositoryInterface,
        @inject(RECEBIMENTO_EXECUCAO_REPOSITORY_TOKEN)
        private execucaoRepository: RecebimentoExecucaoRepositoryInterface,
        @inject(LogService)
        private logService: LogService,
    ) {}

    /**
     * Política CENTRAL de retry das chamadas externas (Regis availability-3): 3 tentativas com delay,
     * só para falhas TRANSITÓRIAS (5xx/timeout). Um 4xx do ERP (regra fiscal) NÃO é retryable —
     * `retryable === false` desiste na hora. Uniforme para os 6 módulos (evita 6 comportamentos).
     */
    private retry: RetryExecutor = new RetryExecutor({
        retries: RECEBIMENTO_RETRY_ATTEMPTS,
        delayMs: RECEBIMENTO_RETRY_DELAY_MS,
        shouldLog: false,
        shouldRetry: (error: unknown) => (error as { retryable?: boolean })?.retryable !== false,
    });

    /** Runs all 5 stages end-to-end, returning the enriched spine (all stubbed in the scaffold). */
    public run = async (input: RunPipelineInput): Promise<Recebimento> => {
        const { correlationId } = input.recebimento;
        return this.metrics.withCorrelationId(correlationId, async () => {
            await this.importarTransacoes(input);
            let recebimento = await this.atribuirBaixa(input);
            recebimento = await this.ratearRecebimento(recebimento);
            recebimento = await this.aplicarRegras(recebimento, correlationId);
            recebimento = await this.executarRecebimento(recebimento, input);
            return recebimento;
        });
    };

    private importarTransacoes = async (input: RunPipelineInput): Promise<void> => {
        this.metrics.emit({
            stage: 'importarTransacoes',
            correlationId: input.recebimento.correlationId,
            outcome: 'started',
        });
        const result = await this.ingestao.run(input.ingestao);
        void this.logService.info({
            type: 'FLOW_START',
            message: 'importarTransacoes',
            qive_id: input.recebimento.correlationId,
            data: { total: result.total, deduplicadas: result.deduplicadas },
        });
        this.metrics.emit({
            stage: 'importarTransacoes',
            correlationId: input.recebimento.correlationId,
            outcome: 'ok',
            attributes: { total: result.total },
        });
    };

    private atribuirBaixa = async (input: RunPipelineInput): Promise<Recebimento> => {
        this.metrics.emit({
            stage: 'atribuirBaixa',
            correlationId: input.recebimento.correlationId,
            outcome: 'started',
        });
        const match = await this.matching.match(input.transacao, input.documentosAbertos);
        const recebimento: Recebimento = {
            ...input.recebimento,
            classificacaoMatch: match.classificacao,
        };
        // `save` bumpa a versão e a devolve — o pipeline propaga a versão viva para o próximo estágio
        // (base da concorrência otimista real no estágio de execução).
        const saved = await this.recebimentoRepository.save(recebimento, recebimento.versao);
        this.metrics.emit({
            stage: 'atribuirBaixa',
            correlationId: saved.correlationId,
            outcome: 'ok',
            attributes: { classificacao: match.classificacao, score: match.score },
        });
        return saved;
    };

    private ratearRecebimento = async (recebimento: Recebimento): Promise<Recebimento> => {
        this.metrics.emit({
            stage: 'ratearRecebimento',
            correlationId: recebimento.correlationId,
            outcome: 'started',
        });
        const rateios = await this.rateio.ratear(recebimento);
        const enriched: Recebimento = { ...recebimento, rateios };
        enriched.valorAlocado = computeValorAlocado(rateios);
        enriched.diferencaNaoAlocada = computeDiferencaNaoAlocada(enriched);
        const saved = await this.recebimentoRepository.save(enriched, enriched.versao);
        const savedEnriched: Recebimento = {
            ...saved,
            rateios,
            valorAlocado: enriched.valorAlocado,
            diferencaNaoAlocada: enriched.diferencaNaoAlocada,
        };
        this.metrics.emit({
            stage: 'ratearRecebimento',
            correlationId: savedEnriched.correlationId,
            outcome: 'ok',
            attributes: { parcelas: rateios.length, valorAlocado: enriched.valorAlocado },
        });
        return savedEnriched;
    };

    private aplicarRegras = async (
        recebimento: Recebimento,
        correlationId: string,
    ): Promise<Recebimento> => {
        this.metrics.emit({ stage: 'aplicarRegras', correlationId, outcome: 'started' });
        const ajustes = await this.regras.aplicar(recebimento.rateios, {
            recebimento,
            correlationId,
        });
        void this.logService.info({
            type: 'BUSINESS_INFO',
            message: 'aplicarRegras',
            qive_id: correlationId,
            data: { ajustes: ajustes.length },
        });
        this.metrics.emit({
            stage: 'aplicarRegras',
            correlationId,
            outcome: 'ok',
            attributes: { ajustes: ajustes.length },
        });
        return recebimento;
    };

    private executarRecebimento = async (
        recebimento: Recebimento,
        input: RunPipelineInput,
    ): Promise<Recebimento> => {
        this.metrics.emit({
            stage: 'executarRecebimento',
            correlationId: recebimento.correlationId,
            outcome: 'started',
        });
        // Aprovação (gate humano) já ocorreu upstream no fluxo real; no scaffold o coordinator
        // demonstra as transições legais via o guard puro (rascunho → aprovado → executado).
        assertTransitionRecebimento(recebimento.status, RECEBIMENTO_STATUS.APROVADO);
        const aprovado: Recebimento = {
            ...recebimento,
            status: RECEBIMENTO_STATUS.APROVADO,
            aprovadoPor: input.ator,
        };

        const idempotencyKey = `receb:${aprovado.id}`;
        const begin = await this.execucaoRepository.beginExecution({
            idempotencyKey,
            recebimentoId: aprovado.id,
            filCod: aprovado.filCod,
            dryRun: input.dryRun,
            executadoPor: input.ator,
        });
        if (begin.alreadySettled) {
            this.metrics.emit({
                stage: 'executarRecebimento',
                correlationId: aprovado.correlationId,
                outcome: 'ok',
                attributes: { alreadySettled: true },
            });
            return { ...aprovado, status: RECEBIMENTO_STATUS.EXECUTADO };
        }

        // ── Bloco irreversível (POSTs no ERP + NDe fiscal) envolvido em try/catch (Regis
        // p0-executar-recebimento-safety): qualquer falha vira `error` no ledger (nunca fica preso em
        // `reconciling`) + métrica `outcome: 'error'`. Cada chamada externa passa pela política central
        // de retry com TETO de latência (availability-2/3, performance-2). Espelha
        // ReconciliacaoPermutaService. `borCod` é persistido ANTES do próximo POST (fault-tolerance-2).
        try {
            const bordero = await this.retry.execute(() =>
                this.erp.criarBordero(
                    {
                        filCod: aprovado.filCod,
                        borVldTipo: input.borVldTipo,
                        contaDestino: input.contaDestino,
                        valor: aprovado.valorRecebido,
                        correlationId: aprovado.correlationId,
                        dryRun: input.dryRun,
                    },
                    { timeoutMs: ERP_WRITE_TIMEOUT_MS },
                ),
            );
            // Rastreabilidade de órfão (fault-tolerance-2): grava o borCod ANTES do gravarBaixa.
            await this.execucaoRepository.setBorCod(idempotencyKey, bordero.borCod);

            const baixa = await this.retry.execute(() =>
                this.erp.gravarBaixa(
                    {
                        borCod: bordero.borCod,
                        filCod: aprovado.filCod,
                        docCod: aprovado.rateios[0]?.documentoDocCod ?? '',
                        titCod: aprovado.rateios[0]?.documentoTitCod ?? '',
                        valor: aprovado.valorAlocado,
                        contaDestino: input.contaDestino,
                        correlationId: aprovado.correlationId,
                        dryRun: input.dryRun,
                    },
                    { timeoutMs: ERP_WRITE_TIMEOUT_MS },
                ),
            );
            const nde = await this.retry.execute(() =>
                this.ndeEmitter.emitir(aprovado, { timeoutMs: NDE_EMIT_TIMEOUT_MS }),
            );
            await this.execucaoRepository.markSettled(idempotencyKey, {
                borCod: bordero.borCod,
                ndeId: nde.id,
                erpResponse: { bxaCodSeq: baixa.bxaCodSeq },
            });

            assertTransitionRecebimento(aprovado.status, RECEBIMENTO_STATUS.EXECUTADO);
            const executado: Recebimento = {
                ...aprovado,
                status: RECEBIMENTO_STATUS.EXECUTADO,
                executadoPor: input.ator,
                ndeId: nde.id,
                resultadoExecucao: {
                    borCod: bordero.borCod,
                    bxaCodSeq: baixa.bxaCodSeq,
                    ndeId: nde.id,
                },
            };
            await this.recebimentoRepository.save(executado, aprovado.versao);
            this.metrics.emit({
                stage: 'executarRecebimento',
                correlationId: executado.correlationId,
                outcome: 'ok',
                attributes: { borCod: bordero.borCod, dryRun: input.dryRun },
            });
            return executado;
        } catch (err) {
            // Estado terminal `error` com payload cru — a retentativa encontra um estado terminal e
            // decide de forma informada (nunca re-executa o POST irreversível cegamente). `borCod`
            // preservado quando o borderô já respondeu antes da falha (COALESCE no markError).
            await this.execucaoRepository.markError(idempotencyKey, {
                erroMensagem: err instanceof Error ? err.message : String(err),
                erpResponse: (err as { response?: unknown })?.response ?? null,
            });
            this.metrics.emit({
                stage: 'executarRecebimento',
                correlationId: aprovado.correlationId,
                outcome: 'error',
                attributes: { errorCode: String((err as { code?: string })?.code ?? 'unknown') },
            });
            throw err;
        }
    };
}
