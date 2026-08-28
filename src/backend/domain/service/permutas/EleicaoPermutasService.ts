import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import ConexosCadastroClient, {
    type DeclaracaoEntry,
    type ProcessoListItem,
} from '../../client/ConexosCadastroClient.js';
import ConexosFinanceiroClient from '../../client/ConexosFinanceiroClient.js';
import ConexosTitulosClient, { siglaMoedaNegociada } from '../../client/ConexosTitulosClient.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import ConexosError from '../../errors/ConexosError.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import type Adiantamento from '../../interface/permutas/Adiantamento.js';
import {
    ESTADO_ELEGIBILIDADE,
    MOTIVO_BLOQUEIO,
} from '../../interface/permutas/EstadoElegibilidade.js';
import { GATE } from '../../interface/permutas/PermutaCandidata.js';
import type InvoiceLancamento from '../../interface/closing-reports/Invoice.js';
import type Invoice from '../../interface/permutas/Invoice.js';
import type PermutaCandidata from '../../interface/permutas/PermutaCandidata.js';
import LogService from '../LogService.js';
import ClienteFiltroRepository from '../../repository/permutas/ClienteFiltroRepository.js';
import PermutaSnapshotRepository, {
    type PermutaEleicaoRunInput,
} from '../../repository/permutas/PermutaSnapshotRepository.js';
import AgingService from './AgingService.js';
import ElegibilidadeService from './ElegibilidadeService.js';
import VariacaoCambialPermutaService from './VariacaoCambialPermutaService.js';

export interface EleicaoResult {
    runId: string;
    flowId: string;
    totalCandidatas: number;
    totalElegiveis: number;
    totalBloqueadas: number;
    bloqueadasByMotivo: Record<string, number>;
    status: 'success' | 'error';
    candidatas: PermutaCandidata[];
    /** `true` quando a run foi REAPROVEITADA via Idempotency-Key (P0-6) — não
     * houve novo fan-out Conexos. Ausente/`false` numa run fresca. */
    idempotentReplay?: boolean;
}

export interface EleicaoParams {
    /** Identidade auditável de quem disparou a run (auditoria O6). */
    triggeredBy: string;
    /**
     * `Idempotency-Key` (header HTTP) — P0-6. Quando presente, um segundo
     * request com a mesma key (dentro de 24h, ou concorrente) retorna a run
     * existente em vez de disparar um novo fan-out Conexos.
     */
    idempotencyKey?: string;
}

/**
 * Deriva um lock-key int32 estável a partir da `Idempotency-Key` (string) para
 * `pg_try_advisory_lock` (P0-6). djb2 truncado em 31 bits → cabe em `integer`.
 */
const advisoryLockKey = (key: string): number => {
    let hash = 5381;
    for (let i = 0; i < key.length; i += 1) {
        hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 2147483647;
};

const PAGE_SIZE = 500;
const MAX_PAGES = 50;

/**
 * Soma o `valorNegociado` de TODAS as parcelas (títulos com308) de um documento.
 * Um doc com várias parcelas (ex.: invoice 20707 = 26.006,40 + 234.057,60) ficava
 * subestimado ~10x quando se pegava só `titulos[0]`. `undefined` se nenhuma parcela
 * trouxer o valor (mantém o "—" na tela). A taxa segue de `titulos[0]` (parcelas
 * de um mesmo doc compartilham a taxa negociada).
 */
const somaValorNegociado = (
    titulos: ReadonlyArray<{ valorNegociado?: number }>,
): number | undefined => {
    const comValor = titulos.filter((t) => t.valorNegociado !== undefined);
    if (comValor.length === 0) return undefined;
    return comValor.reduce((acc, t) => acc + (t.valorNegociado ?? 0), 0);
};

/** Limites de concorrência do fan-out Conexos (P0-4). Mantêm o paralelismo sob
 * controle para não estourar a sessão do ERP (LOGIN_ERROR_MAX_SESSIONS). */
/**
 * `pago` da invoice derivado dos TÍTULOS (com308), não da row do `com298/list`.
 *
 * Regra: `pago ⟺ Σ face − Σ pago === 0`, **estrita** (sem epsilon) — mesma regra do
 * Gate 3 do adiantamento, mantida por decisão do Yuri em 2026-06-18
 * (`residual-pago-centavos`: um resíduo de R$0,02 NÃO conta como quitado).
 *
 * Validada ao vivo contra `getDetalheTitulos` (ground truth do ERP): 30/30 concordam,
 * 0 divergências (sonda `probe-invoice-pago`, PRD filial 2, 2026-08-28).
 *
 * Devolve `undefined` — e não `false` — quando não há títulos ou algum título não traz
 * face/pago: "não sei" é distinto de "está em aberto". O caller mantém o piso conservador,
 * então a invoice segue VISÍVEL. Nunca inferimos `pago = true` sem prova: esconder uma
 * invoice em aberto tira dinheiro do radar da analista; mostrar uma paga só incomoda.
 */
export const derivarPagoDosTitulos = (
    titulos: ReadonlyArray<{ valorBrl?: number; valorPago?: number }>,
): boolean | undefined => {
    if (titulos.length === 0) return undefined;
    if (titulos.some((t) => t.valorBrl === undefined || t.valorPago === undefined)) {
        return undefined;
    }
    const face = titulos.reduce((acc, t) => acc + (t.valorBrl ?? 0), 0);
    const pago = titulos.reduce((acc, t) => acc + (t.valorPago ?? 0), 0);
    return face - pago === 0;
};

const FILIAIS_CONCURRENCY = 5;
const ADIANTAMENTOS_CONCURRENCY = 10;

/**
 * EleicaoPermutasService — orquestrador da cadeia (o "job", sem scheduler — O4):
 *   elegerAdiantamentos → avaliarElegibilidade → casarInvoice
 *   → calcularVariacaoCambial → aging → snapshot/auditoria.
 *
 * Ontology: `ontology/actions/eleger-adiantamentos.md` + state-machine.
 * Idempotente (P0-7): recomputa o backlog do zero a cada run. Multi-filial (I6).
 * Observabilidade (ObservabilityAdvisor): `flowId` por execução em TODA linha de
 * log e propagado ao snapshot; FLOW_START / FLOW_COMPLETE (uma linha-resumo) /
 * FLOW_ERROR; BUSINESS_WARN cap-hit. Atomicidade: abort → 0 snapshot rows.
 */
@injectable()
export default class EleicaoPermutasService {
    constructor(
        @inject(ConexosCadastroClient) private conexosCadastroClient: ConexosCadastroClient,
        @inject(ConexosFinanceiroClient) private conexosFinanceiroClient: ConexosFinanceiroClient,
        @inject(ConexosTitulosClient) private conexosTitulosClient: ConexosTitulosClient,
        @inject(ElegibilidadeService) private elegibilidadeService: ElegibilidadeService,
        @inject(VariacaoCambialPermutaService)
        private variacaoCambialService: VariacaoCambialPermutaService,
        @inject(AgingService) private agingService: AgingService,
        @inject(PermutaSnapshotRepository)
        private snapshotRepository: PermutaSnapshotRepository,
        @inject(LogService) private logService: LogService,
        @inject(BoundedConcurrency) private boundedConcurrency: BoundedConcurrency,
        @inject(PostgreeDatabaseClient) private databaseClient: PostgreeDatabaseClient,
        @inject(ClienteFiltroRepository)
        private clienteFiltroRepository: ClienteFiltroRepository,
    ) {}

    /**
     * Ponto de entrada do job. Idempotente por `Idempotency-Key` (P0-6):
     *   1. Sem key → roda direto (comportamento legado).
     *   2. Com key já vista (TTL 24h) → retorna a run existente, ZERO fan-out.
     *   3. Com key nova → adquire `pg_try_advisory_lock(hash(key))`. Se OUTRO
     *      request concorrente segura o lock, NÃO dispara novo fan-out: aguarda
     *      e retorna a run que o vencedor produziu (ou um replay vazio).
     */
    public executar = async (params: EleicaoParams): Promise<EleicaoResult> => {
        const { idempotencyKey } = params;
        if (!idempotencyKey) {
            return this.runEleicao(params);
        }

        // (2) key já produziu uma run dentro do TTL → replay direto.
        const existingRunId =
            await this.snapshotRepository.findRunIdByIdempotencyKey(idempotencyKey);
        if (existingRunId) {
            const replay = await this.loadRunAsResult(existingRunId);
            if (replay) return replay;
        }

        // (3) serializa por key via advisory lock.
        return this.databaseClient.withAdvisoryLock(
            advisoryLockKey(idempotencyKey),
            async () => {
                // Double-check sob o lock: outra run pode ter gravado a key entre
                // a checagem (2) e a aquisição do lock.
                const racedRunId =
                    await this.snapshotRepository.findRunIdByIdempotencyKey(idempotencyKey);
                if (racedRunId) {
                    const replay = await this.loadRunAsResult(racedRunId);
                    if (replay) return replay;
                }
                const result = await this.runEleicao(params);
                await this.snapshotRepository.recordIdempotencyKey(idempotencyKey, result.runId);
                return result;
            },
            async () => {
                // Lock ocupado → um request concorrente com a MESMA key está
                // rodando o fan-out. NÃO disparamos outro. Retornamos a run
                // existente quando o vencedor terminar de gravá-la.
                await this.logService.warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'permuta eleicao idempotency lock busy — reusing concurrent run',
                    data: { idempotencyKey },
                });
                const concurrentRunId =
                    await this.snapshotRepository.findRunIdByIdempotencyKey(idempotencyKey);
                if (concurrentRunId) {
                    const replay = await this.loadRunAsResult(concurrentRunId);
                    if (replay) return replay;
                }
                // O vencedor ainda não gravou a key — devolve um replay vazio
                // marcado, sem disparar um novo fan-out Conexos.
                return {
                    runId: '',
                    flowId: '',
                    totalCandidatas: 0,
                    totalElegiveis: 0,
                    totalBloqueadas: 0,
                    bloqueadasByMotivo: {},
                    status: 'success',
                    candidatas: [],
                    idempotentReplay: true,
                };
            },
        );
    };

    /** Carrega uma run existente como `EleicaoResult` (replay idempotente). */
    private loadRunAsResult = async (runId: string): Promise<EleicaoResult | null> => {
        const summary = await this.snapshotRepository.findRunSummaryById(runId);
        if (!summary) return null;
        return {
            runId: summary.runId,
            flowId: summary.flowId,
            totalCandidatas: summary.totalCandidatas,
            totalElegiveis: summary.totalElegiveis,
            totalBloqueadas: summary.totalBloqueadas,
            bloqueadasByMotivo: summary.bloqueadasByMotivo,
            status: summary.status === 'error' ? 'error' : 'success',
            candidatas: [],
            idempotentReplay: true,
        };
    };

    /**
     * Fan-out + gates + VC + aging compartilhado (P0-7). Lê filiais →
     * adiantamentos → declarações/invoices → detalhe → gates → variação cambial
     * → aging e devolve as candidatas + `flowId` + os totais derivados. NÃO
     * persiste nada — é reusável pela eleição (snapshot do `/painel`) e pela
     * ingestão diária (modelo relacional do `/gestao`). Propaga qualquer falha
     * de fan-out ao caller, que decide como persistir o erro.
     */
    public computeCandidatas = async (): Promise<{
        candidatas: PermutaCandidata[];
        flowId: string;
        /** TODAS as invoices finalizadas (universo completo, hidratadas + cliente) — não só casadas. */
        todasInvoices: Array<{
            inv: Invoice;
            filCod: number;
            pesCod?: string;
            importador?: string;
        }>;
        totals: {
            totalCandidatas: number;
            totalElegiveis: number;
            totalBloqueadas: number;
            bloqueadasByMotivo: Record<string, number>;
        };
    }> => {
        const flowId = randomUUID();

        await this.logService.info({
            type: LOG_TYPE.FLOW_START,
            message: 'permuta compute candidatas started',
            data: { flowId, pageSize: PAGE_SIZE, maxPages: MAX_PAGES },
        });

        // AbortController (P0-4) — cancela o restante do fan-out assim que uma
        // filial falha de forma fatal, em vez de continuar disparando chamadas
        // Conexos para os demais workers em voo.
        const abortController = new AbortController();
        try {
            // Clientes-filtro (importadores p/ permuta manual cross-process) —
            // carregados UMA vez por run e usados no roteamento de cada candidata.
            const filtroPesCods = await this.clienteFiltroRepository.listPesCodsAtivos();
            const filiais = await this.conexosCadastroClient.listFiliais();
            // Filiais em paralelo com limite (P0-4) — speedup de I/O ≥5× vs. o
            // laço sequencial anterior. `map` propaga a 1ª falha → run aborta.
            const perFilial = await this.boundedConcurrency.map(
                filiais,
                (filial) =>
                    this.processFilial(
                        filial.filCod,
                        flowId,
                        abortController.signal,
                        filtroPesCods,
                    ),
                FILIAIS_CONCURRENCY,
            );
            const candidatas: PermutaCandidata[] = perFilial.flat();

            // Universo COMPLETO de invoices finalizadas (regra 2026-06-24) — todas as filiais, não
            // só os processos com adiantamento. HIDRATA valor/moeda negociada (com308) + CLIENTE
            // (importador via imp021 por processo) p/ buscar/contar por cliente no universo todo.
            const todasInvoicesPorFilial = await this.boundedConcurrency.map(
                filiais,
                async (filial) => {
                    const { invoices, capHit } =
                        await this.conexosFinanceiroClient.listInvoicesFinalizadas({
                            filCod: filial.filCod,
                        });
                    if (capHit) {
                        await this.logService.warn({
                            type: LOG_TYPE.BUSINESS_WARN,
                            message:
                                'listInvoicesFinalizadas atingiu o teto de páginas — universo pode estar TRUNCADO',
                            data: { flowId, filCod: filial.filCod, retornadas: invoices.length },
                        });
                    }
                    const priCods = [...new Set(invoices.map((i) => i.priCod))];
                    const processos = await this.conexosCadastroClient.listProcessos({
                        filCod: filial.filCod,
                        priCods,
                    });
                    const procByPri = new Map(processos.map((p) => [p.priCod, p]));
                    const hidratadas = await this.boundedConcurrency.map(
                        invoices,
                        (inv) => this.hidratarInvoiceNegociada(inv, filial.filCod),
                        ADIANTAMENTOS_CONCURRENCY,
                    );
                    return hidratadas.map(({ inv, filCod }) => {
                        const proc = procByPri.get(inv.priCod);
                        return {
                            inv,
                            filCod,
                            ...(proc?.pesCod ? { pesCod: proc.pesCod } : {}),
                            ...(proc?.importador ? { importador: proc.importador } : {}),
                        };
                    });
                },
                FILIAIS_CONCURRENCY,
            );
            const todasInvoices = todasInvoicesPorFilial.flat();

            const elegiveis = candidatas.filter(
                (c) => c.estadoElegibilidade === ESTADO_ELEGIBILIDADE.ELEGIVEL,
            );
            const bloqueadas = candidatas.filter(
                (c) => c.estadoElegibilidade === ESTADO_ELEGIBILIDADE.BLOQUEADA,
            );
            return {
                candidatas,
                flowId,
                todasInvoices,
                totals: {
                    totalCandidatas: candidatas.length,
                    totalElegiveis: elegiveis.length,
                    totalBloqueadas: bloqueadas.length,
                    bloqueadasByMotivo: this.countByMotivo(bloqueadas),
                },
            };
        } catch (error) {
            // P0-4 — corta os workers de fan-out ainda em voo (best-effort).
            abortController.abort();
            await this.logService.error({
                type: LOG_TYPE.FLOW_ERROR,
                message: 'permuta compute candidatas aborted',
                error,
                data: { flowId, error: error instanceof Error ? error.message : String(error) },
            });
            throw error;
        }
    };

    private runEleicao = async (params: EleicaoParams): Promise<EleicaoResult> => {
        const { triggeredBy } = params;
        const startedAt = new Date();
        let flowId = '';

        try {
            const computed = await this.computeCandidatas();
            flowId = computed.flowId;
            const { candidatas, totals } = computed;
            const finishedAt = new Date();

            const runInput: PermutaEleicaoRunInput = {
                flowId,
                startedAt,
                finishedAt,
                status: 'success',
                triggeredBy,
                totalCandidatas: totals.totalCandidatas,
                totalElegiveis: totals.totalElegiveis,
                totalBloqueadas: totals.totalBloqueadas,
                bloqueadasByMotivo: totals.bloqueadasByMotivo,
            };
            const runId = await this.snapshotRepository.persistRun(runInput, candidatas);

            await this.logService.info({
                type: LOG_TYPE.FLOW_COMPLETE,
                message: 'permuta eleicao complete',
                data: {
                    flowId,
                    snapshotId: runId,
                    ...totals,
                    durationMs: finishedAt.getTime() - startedAt.getTime(),
                },
            });

            return {
                runId,
                flowId,
                totalCandidatas: totals.totalCandidatas,
                totalElegiveis: totals.totalElegiveis,
                totalBloqueadas: totals.totalBloqueadas,
                bloqueadasByMotivo: totals.bloqueadasByMotivo,
                status: 'success',
                candidatas,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // Atomicidade: persiste a run com status=error e ZERO snapshot rows.
            const runId = await this.snapshotRepository.persistRun(
                {
                    flowId,
                    startedAt,
                    finishedAt: new Date(),
                    status: 'error',
                    triggeredBy,
                    totalCandidatas: 0,
                    totalElegiveis: 0,
                    totalBloqueadas: 0,
                    bloqueadasByMotivo: {},
                    errorMessage: message,
                },
                [],
            );

            await this.logService.error({
                type: LOG_TYPE.FLOW_ERROR,
                message: 'permuta eleicao aborted',
                error,
                data: { flowId, snapshotId: runId, error: message },
            });
            throw error;
        }
    };

    private processFilial = async (
        filCod: number,
        flowId: string,
        signal: AbortSignal,
        filtroPesCods: Set<string>,
    ): Promise<PermutaCandidata[]> => {
        const { adiantamentos, capHit } =
            await this.conexosFinanceiroClient.listAdiantamentosProforma({
                filCod,
            });

        if (capHit) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'permuta eleicao pagination cap hit — results may be truncated',
                data: { flowId, filCod, capHit: true, maxPages: MAX_PAGES },
            });
        }

        if (adiantamentos.length === 0) return [];

        // P0-7 — elimina o N+1: coleta os priCods ÚNICOS da filial e faz as
        // chamadas Conexos BATCHED (uma só, internamente chunked em 50) em vez de
        // 1 chamada por adiantamento. Resultados indexados em `Map` por priCod.
        const priCodsUnicos = [...new Set(adiantamentos.map((a) => a.priCod))];
        const [declaracoesByPriCod, invoicesByPriCod, processosByPriCod] = await Promise.all([
            this.fetchDeclaracoesBatched(priCodsUnicos, filCod),
            this.fetchInvoicesBatched(priCodsUnicos, filCod),
            this.fetchProcessosBatched(priCodsUnicos, filCod),
        ]);

        // Adiantamentos em paralelo com limite (P0-4). Só o detail por-documento
        // (`getDetalheTitulos` / `listTitulosAPagar`) permanece per-candidata —
        // são detail endpoints sem variante batched no Conexos.
        return this.boundedConcurrency.map(
            adiantamentos,
            (adiantamento) =>
                this.buildCandidata(adiantamento, filCod, flowId, {
                    declaracoes: declaracoesByPriCod.get(adiantamento.priCod) ?? [],
                    invoices: invoicesByPriCod.get(adiantamento.priCod) ?? [],
                    ...(processosByPriCod.get(adiantamento.priCod) !== undefined
                        ? { processo: processosByPriCod.get(adiantamento.priCod) }
                        : {}),
                    filtroPesCods,
                    signal,
                }),
            ADIANTAMENTOS_CONCURRENCY,
        );
    };

    /** Batch dos processos (imp021) de TODOS os priCods da filial → Map por priCod.
     * Hidrata o importador (`pesCod`/nome) de cada adiantamento, usado no
     * roteamento de clientes-filtro e na exibição. */
    private fetchProcessosBatched = async (
        priCods: string[],
        filCod: number,
    ): Promise<Map<string, ProcessoListItem>> => {
        const processos = await this.conexosCadastroClient.listProcessos({ priCods, filCod });
        const byPriCod = new Map<string, ProcessoListItem>();
        for (const p of processos) byPriCod.set(p.priCod, p);
        return byPriCod;
    };

    /** Batch das declarações (D.I/DUIMP) de TODOS os priCods da filial → Map. */
    private fetchDeclaracoesBatched = async (
        priCods: string[],
        filCod: number,
    ): Promise<Map<string, DeclaracaoEntry[]>> => {
        const declaracoes = await this.conexosCadastroClient.listDeclaracaoByProcesso({
            priCods,
            filCod,
        });
        const byPriCod = new Map<string, DeclaracaoEntry[]>();
        for (const entry of declaracoes) {
            const list = byPriCod.get(entry.priCod) ?? [];
            list.push(entry);
            byPriCod.set(entry.priCod, list);
        }
        return byPriCod;
    };

    /** Batch das INVOICEs de TODOS os priCods da filial → Map por priCod. */
    private fetchInvoicesBatched = async (
        priCods: string[],
        filCod: number,
    ): Promise<Map<string, Invoice[]>> => {
        const { invoices } = await this.conexosFinanceiroClient.listFinanceiroAPagar({
            priCods,
            docTip: 'INVOICE',
            filCod,
        });
        // Hidrata valor/moeda negociada (com308) de CADA invoice em aberto — p/ a
        // tela mostrar o valor da invoice em USD, inclusive nas candidatas N:M (a
        // variação 1:1 só hidrata a invoice casada). Concorrência limitada
        // (Conexos MAX_SESSIONS); falha numa linha apenas omite o valor.
        const hydrated = await this.boundedConcurrency.map(
            invoices,
            async (i): Promise<Invoice> => {
                const mapped: Invoice = {
                    docCod: i.docCod,
                    priCod: i.priCod,
                    dataEmissao: i.dataEmissao,
                    valor: i.valor,
                    moeda: i.moeda,
                    pago: i.pago,
                    ...(i.exportador !== undefined ? { exportador: i.exportador } : {}),
                    ...(i.referencia !== undefined ? { referencia: i.referencia } : {}),
                    ...(i.referenciaExterna !== undefined
                        ? { referenciaExterna: i.referenciaExterna }
                        : {}),
                };
                try {
                    const tit = await this.conexosTitulosClient.listTitulosAPagar({
                        docCod: i.docCod,
                        filCod,
                    });
                    const valorMoedaNegociada = somaValorNegociado(tit);
                    const moedaNegociada = tit[0] ? siglaMoedaNegociada(tit[0]) : undefined;
                    const taxa = tit[0]?.taxa;
                    if (valorMoedaNegociada !== undefined) {
                        mapped.valorMoedaNegociada = valorMoedaNegociada;
                    }
                    if (moedaNegociada !== undefined) mapped.moedaNegociada = moedaNegociada;
                    if (taxa !== undefined) mapped.taxa = taxa;
                } catch {
                    // com308 indisponível p/ esta invoice — segue sem valor negociado.
                }
                return mapped;
            },
            ADIANTAMENTOS_CONCURRENCY,
        );
        const byPriCod = new Map<string, Invoice[]>();
        for (const mapped of hydrated) {
            const list = byPriCod.get(mapped.priCod) ?? [];
            list.push(mapped);
            byPriCod.set(mapped.priCod, list);
        }
        return byPriCod;
    };

    /**
     * Hidrata UMA invoice do universo completo (regra 2026-06-24) com valor/moeda negociada
     * (com308) — espelha a hidratação de `fetchInvoicesBatched`, mas avulsa (sem priCod casado).
     * Falha numa linha apenas omite o valor negociado (best-effort; Conexos MAX_SESSIONS).
     */
    private hidratarInvoiceNegociada = async (
        raw: InvoiceLancamento,
        filCod: number,
    ): Promise<{ inv: Invoice; filCod: number }> => {
        const inv: Invoice = {
            docCod: raw.docCod,
            priCod: raw.priCod,
            dataEmissao: raw.dataEmissao,
            valor: raw.valor,
            moeda: raw.moeda,
            // `raw.pago` vem do `com298/list` via `isPago` — e o list NÃO popula
            // `mnyTitAberto`/`mnyTitPago` (null em 1146/1146 INVOICEs da filial 2,
            // sonda `probe-invoice-pago` 2026-08-28), então é SEMPRE `false`. Fica
            // aqui só como piso; o valor real é derivado dos títulos logo abaixo.
            pago: raw.pago,
            ...(raw.exportador !== undefined ? { exportador: raw.exportador } : {}),
            ...(raw.referencia !== undefined ? { referencia: raw.referencia } : {}),
            ...(raw.referenciaExterna !== undefined
                ? { referenciaExterna: raw.referenciaExterna }
                : {}),
        };
        try {
            const tit = await this.conexosTitulosClient.listTitulosAPagar({
                docCod: raw.docCod,
                filCod,
            });
            const valorMoedaNegociada = somaValorNegociado(tit);
            const moedaNegociada = tit[0] ? siglaMoedaNegociada(tit[0]) : undefined;
            const taxa = tit[0]?.taxa;
            if (valorMoedaNegociada !== undefined) inv.valorMoedaNegociada = valorMoedaNegociada;
            if (moedaNegociada !== undefined) inv.moedaNegociada = moedaNegociada;
            if (taxa !== undefined) inv.taxa = taxa;
            // `pago` REAL da invoice — mesma classe de defeito já corrigida no Gate 3
            // do adiantamento (01b99bf) e na busca de invoice da alocação (df90fa6):
            // a LISTA é inservível, a verdade está no título. Custo zero: este com308
            // já era chamado aqui para valor/taxa negociada.
            const pagoDosTitulos = derivarPagoDosTitulos(tit);
            if (pagoDosTitulos !== undefined) {
                inv.pago = pagoDosTitulos;
            } else {
                // Títulos vieram, mas sem face/pago utilizável — o `pago` fica no piso
                // conservador SEM prova. Sinalizado porque, em massa, é indistinguível de
                // "invoice realmente em aberto": exatamente o sintoma que originou este fix.
                await this.logService.warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'invoice sem pago derivável dos títulos — piso conservador aplicado',
                    data: { docCod: raw.docCod, filCod, titulos: tit.length },
                });
            }
        } catch (error) {
            // com308 indisponível p/ esta invoice — segue sem valor negociado e com
            // `pago` no piso conservador (`false`): a invoice continua visível na aba
            // em vez de sumir sem prova de quitação.
            //
            // NÃO é silencioso: um surto de falhas do com308 degrada a aba inteira de volta
            // ao bug original (invoice liquidada reaparece), e sem este sinal o operador só
            // descobriria por relato de analista — que foi como este bug chegou até nós.
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'com308 indisponível na hidratação da invoice — pago não derivado',
                data: {
                    docCod: raw.docCod,
                    filCod,
                    error: error instanceof Error ? error.message : String(error),
                },
            });
        }
        return { inv, filCod };
    };

    /**
     * Candidata BLOQUEADA por `DETAIL_INDISPONIVEL` (P0-3) — a leitura do detalhe
     * (`getDetalheTitulos`) falhou após retries. Marca o Gate 2 como não avaliado
     * (detalhe ausente) sem inventar `valorPermutar`. Não é `falha-gate`.
     */
    private buildDetailIndisponivelCandidata = (adiantamento: Adiantamento): PermutaCandidata => ({
        priCod: adiantamento.priCod,
        adiantamento,
        estadoElegibilidade: ESTADO_ELEGIBILIDADE.BLOQUEADA,
        motivoBloqueio: MOTIVO_BLOQUEIO.DETAIL_INDISPONIVEL,
        gatesAvaliados: [
            {
                gate: GATE.VALOR_PERMUTAR,
                passed: false,
                detail: 'detalhe da PROFORMA indisponivel (getDetalheTitulos falhou apos retries)',
            },
        ],
    });

    private buildCandidata = async (
        adiantamento: Adiantamento,
        filCod: number,
        flowId: string,
        context: {
            declaracoes: DeclaracaoEntry[];
            invoices: Invoice[];
            processo?: ProcessoListItem;
            filtroPesCods: Set<string>;
            signal: AbortSignal;
        },
    ): Promise<PermutaCandidata> => {
        const { declaracoes, invoices, processo, filtroPesCods, signal } = context;
        // Hidrata o importador (pesCod/nome) do processo em qualquer caminho de
        // saída — usado no roteamento de cliente-filtro e na exibição.
        const comImportador = (a: Adiantamento): Adiantamento => ({
            ...a,
            ...(processo?.pesCod !== undefined ? { pesCod: processo.pesCod } : {}),
            ...(processo?.importador !== undefined ? { importador: processo.importador } : {}),
        });
        // P0-4 — corte cooperativo: se a run já abortou (outra filial falhou),
        // não dispara o detail fetch deste adiantamento.
        if (signal.aborted) {
            throw new ConexosError({ endpoint: 'aborted', priCod: adiantamento.docCod });
        }

        // Gate 2 + Gate 3 — hidrata valorPermutar E pago via detail. Ambos os
        // campos voltam null no `com298/list` em produção (mnyTitPermutar e
        // mnyTitAberto/mnyTitPago), só são populados em GET /com298/{docCod}.
        // Por isso o `pago` da row do list é sempre false (gate-3-pago-via-detail):
        // sobrescrevemos com o status real derivado de `mnyTitAberto` ANTES de
        // avaliar os gates.
        // P0-3: se a leitura do detalhe falhar após retries (blip transiente do
        // Conexos), o `getDetalheTitulos` lança `ConexosError` — NÃO travamos a
        // run inteira nem reprovamos a candidata por mérito (`falha-gate`).
        // Bloqueamos com `DETAIL_INDISPONIVEL` (re-avaliável na próxima run).
        let detalhe: {
            valorPermutar?: number;
            pago?: boolean;
            valorPermutado?: number;
            valorTotal?: number;
            valorAberto?: number;
        };
        try {
            detalhe = await this.conexosTitulosClient.getDetalheTitulos({
                docCod: adiantamento.docCod,
                filCod,
            });
        } catch (error) {
            if (error instanceof ConexosError) {
                await this.logService.warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message:
                        'permuta eleicao detalhe da PROFORMA indisponivel — candidata bloqueada',
                    data: {
                        flowId,
                        filCod,
                        docCod: adiantamento.docCod,
                        motivo: MOTIVO_BLOQUEIO.DETAIL_INDISPONIVEL,
                    },
                });
                return this.buildDetailIndisponivelCandidata(comImportador(adiantamento));
            }
            throw error;
        }
        const hydrated: Adiantamento = {
            ...comImportador(adiantamento),
            ...(detalhe.valorPermutar !== undefined
                ? { valorPermutar: detalhe.valorPermutar }
                : {}),
            // `valorPermutado` (mnyTitPermuta) distingue "já permutado" de "sem
            // saldo" na reprovação do Gate 2 (ElegibilidadeService).
            ...(detalhe.valorPermutado !== undefined
                ? { valorPermutado: detalhe.valorPermutado }
                : {}),
            // Progresso de pagamento (face + saldo em aberto) — exibido no detalhe
            // dos bloqueados por `nao-pago` (% pago + quanto falta). Read-only.
            ...(detalhe.valorTotal !== undefined ? { valorTotal: detalhe.valorTotal } : {}),
            ...(detalhe.valorAberto !== undefined ? { valorAberto: detalhe.valorAberto } : {}),
            // Gate 3 — `pago` SEMPRE vem do detalhe (mnyTitAberto === 0): o list
            // devolve mnyTitAberto/mnyTitPago NULL em produção, então o `pago` da
            // row do list é inservível. Quando o detalhe não traz `mnyTitAberto`
            // (campo ausente/null), `detalhe.pago` é undefined → forçamos `false`
            // (conservador: Gate 3 reprova; NUNCA inferimos pago=true sem prova).
            pago: detalhe.pago ?? false,
        };

        const result = this.elegibilidadeService.avaliarElegibilidade({
            adiantamento: hydrated,
            declaracoes,
            invoices,
        });

        // Roteamento de CLIENTE FILTRO (Fase 1): se o importador está cadastrado e o
        // adiantamento está pago + com saldo a permutar, a candidata BLOQUEADA (ex.
        // sem D.I / sem invoice no próprio processo) vira `permuta-manual` — será
        // permutada manualmente e cross-process (Fatia 2). nao-pago/sem-saldo seguem
        // bloqueados (a manual exige pago + saldo); elegível/casamento-manual/já-permutado
        // não são tocados. A D.I não é exigida na manual (vem da invoice escolhida).
        const ehClienteFiltro = hydrated.pesCod !== undefined && filtroPesCods.has(hydrated.pesCod);
        const roteiaParaManual =
            ehClienteFiltro &&
            result.estadoElegibilidade === ESTADO_ELEGIBILIDADE.BLOQUEADA &&
            hydrated.pago === true &&
            (hydrated.valorPermutar ?? 0) > 0;
        const estadoElegibilidade = roteiaParaManual
            ? ESTADO_ELEGIBILIDADE.PERMUTA_MANUAL
            : result.estadoElegibilidade;
        const motivoBloqueio = roteiaParaManual
            ? MOTIVO_BLOQUEIO.CLIENTE_FILTRO
            : result.motivoBloqueio;

        const dataBase = result.declaracaoImportacao?.dataBase;
        const aging = this.agingService.compute(dataBase);

        const candidata: PermutaCandidata = {
            priCod: result.priCod,
            adiantamento: result.adiantamento,
            estadoElegibilidade,
            gatesAvaliados: result.gatesAvaliados,
            ...(result.invoiceCasada !== undefined ? { invoiceCasada: result.invoiceCasada } : {}),
            ...(result.invoicesCandidatas !== undefined
                ? { invoicesCandidatas: result.invoicesCandidatas }
                : {}),
            ...(result.declaracaoImportacao !== undefined
                ? { declaracaoImportacao: result.declaracaoImportacao }
                : {}),
            ...(motivoBloqueio !== undefined ? { motivoBloqueio } : {}),
            ...(aging !== undefined ? { aging } : {}),
        };

        // Variação cambial só para elegíveis com título a-pagar legível (P0-1).
        // O mesmo fan-out de títulos (`listTitulosAPagar`) também hidrata o
        // `valorMoedaNegociada` de adiantamento/invoice (coluna "Valor Moeda
        // Negociada" da tela Gestão) — sem chamadas extras.
        if (result.estadoElegibilidade === ESTADO_ELEGIBILIDADE.ELEGIVEL && result.invoiceCasada) {
            const enriched = await this.computeVariacao(
                hydrated,
                result.invoiceCasada,
                dataBase,
                filCod,
            );
            if (enriched.variacao !== undefined) candidata.variacaoCambial = enriched.variacao;
            // Taxa do adiantamento (do mesmo título lido na variação) — gravada
            // também na LINHA do adiantamento p/ uniformizar com os não-elegíveis
            // (antes só ia para o casamento `taxa_adiantamento`).
            const taxaAdto = enriched.variacao?.taxaAdiantamento;
            if (
                enriched.valorMoedaNegociadaAdto !== undefined ||
                enriched.moedaNegociadaAdto !== undefined ||
                taxaAdto !== undefined
            ) {
                candidata.adiantamento = {
                    ...candidata.adiantamento,
                    ...(enriched.valorMoedaNegociadaAdto !== undefined
                        ? { valorMoedaNegociada: enriched.valorMoedaNegociadaAdto }
                        : {}),
                    ...(enriched.moedaNegociadaAdto !== undefined
                        ? { moedaNegociada: enriched.moedaNegociadaAdto }
                        : {}),
                    ...(taxaAdto !== undefined ? { taxa: taxaAdto } : {}),
                };
            }
            if (
                (enriched.valorMoedaNegociadaInvoice !== undefined ||
                    enriched.moedaNegociadaInvoice !== undefined ||
                    enriched.valorAbertoNegociadoInvoice !== undefined) &&
                candidata.invoiceCasada
            ) {
                candidata.invoiceCasada = {
                    ...candidata.invoiceCasada,
                    ...(enriched.valorMoedaNegociadaInvoice !== undefined
                        ? { valorMoedaNegociada: enriched.valorMoedaNegociadaInvoice }
                        : {}),
                    ...(enriched.moedaNegociadaInvoice !== undefined
                        ? { moedaNegociada: enriched.moedaNegociadaInvoice }
                        : {}),
                    // Teto vivo da invoice p/ a distribuição Simples (greedy N:1).
                    ...(enriched.valorAbertoNegociadoInvoice !== undefined
                        ? { valorAbertoNegociado: enriched.valorAbertoNegociadoInvoice }
                        : {}),
                };
            }
        } else {
            // Não elegível (pago OU não-pago) → hidrata valor/moeda/taxa negociada
            // do adiantamento (com308) p/ as colunas "Valor Moeda Negociada" e a
            // taxa do detalhe. O dado existe no Conexos mesmo em não-pago (aba
            // Variação Cambial do título), então NÃO condicionamos a `pago`. Erro
            // aqui não trava a candidata (já classificada): apenas omite os campos.
            try {
                const titAdto = await this.conexosTitulosClient.listTitulosAPagar({
                    docCod: adiantamento.docCod,
                    filCod,
                });
                const valorMoedaNegociada = somaValorNegociado(titAdto);
                const moedaNegociada = titAdto[0] ? siglaMoedaNegociada(titAdto[0]) : undefined;
                const taxa = titAdto[0]?.taxa;
                if (
                    valorMoedaNegociada !== undefined ||
                    moedaNegociada !== undefined ||
                    taxa !== undefined
                ) {
                    candidata.adiantamento = {
                        ...candidata.adiantamento,
                        ...(valorMoedaNegociada !== undefined ? { valorMoedaNegociada } : {}),
                        ...(moedaNegociada !== undefined ? { moedaNegociada } : {}),
                        ...(taxa !== undefined ? { taxa } : {}),
                    };
                }
            } catch {
                // com308 indisponível para esta linha — segue sem valor/taxa ("-").
            }
        }

        return candidata;
    };

    private computeVariacao = async (
        adiantamento: Adiantamento,
        invoice: Invoice,
        dataBase: Date | undefined,
        filCod: number,
    ): Promise<{
        variacao?: PermutaCandidata['variacaoCambial'];
        valorMoedaNegociadaAdto?: number;
        valorMoedaNegociadaInvoice?: number;
        moedaNegociadaAdto?: string;
        moedaNegociadaInvoice?: string;
        valorAbertoNegociadoInvoice?: number;
    }> => {
        // `getDetalheTitulos` da invoice traz o EM ABERTO vivo (mnyTitAberto, BRL)
        // — teto da distribuição Simples. `.catch` → undefined (falha de detalhe
        // não trava o casamento; a distribuição cai no valorMoedaNegociada).
        const [titAdto, titInv, detInv] = await Promise.all([
            this.conexosTitulosClient.listTitulosAPagar({ docCod: adiantamento.docCod, filCod }),
            this.conexosTitulosClient.listTitulosAPagar({ docCod: invoice.docCod, filCod }),
            this.conexosTitulosClient
                .getDetalheTitulos({ docCod: invoice.docCod, filCod })
                .catch(() => undefined),
        ]);
        const taxaAdiantamento = titAdto[0]?.taxa;
        const taxaInvoice = titInv[0]?.taxa;
        const valorMoedaNegociadaAdto = somaValorNegociado(titAdto);
        const valorMoedaNegociadaInvoice = somaValorNegociado(titInv);
        // Em aberto vivo da invoice em moeda negociada (BRL / taxa).
        const valorAbertoNegociadoInvoice =
            detInv?.valorAberto !== undefined && taxaInvoice !== undefined && taxaInvoice > 0
                ? detInv.valorAberto / taxaInvoice
                : undefined;
        // Moeda NEGOCIADA do título (220=USD / "DOLAR DOS EUA"), distinta da
        // moeda do DOCUMENTO (BRL). Rotula `valorMoedaNegociada` na tela Gestão.
        const moedaNegociadaAdto = siglaMoedaNegociada(titAdto[0]);
        const moedaNegociadaInvoice = siglaMoedaNegociada(titInv[0]);
        // A variação cambial deste casamento incide sobre o valor PERMUTADO por
        // ESTE adiantamento — não sobre o total da invoice. A permuta abate o
        // adiantamento contra a invoice (limitado ao MENOR dos dois): usar o
        // total da invoice super-dimensiona o juros/desconto quando o
        // adiantamento cobre só parte da invoice (ex.: adto 1.100 × invoice 2.200).
        const principalMoeda =
            valorMoedaNegociadaAdto !== undefined && valorMoedaNegociadaInvoice !== undefined
                ? Math.min(valorMoedaNegociadaAdto, valorMoedaNegociadaInvoice)
                : (valorMoedaNegociadaAdto ?? valorMoedaNegociadaInvoice);
        const enriched: {
            variacao?: PermutaCandidata['variacaoCambial'];
            valorMoedaNegociadaAdto?: number;
            valorMoedaNegociadaInvoice?: number;
            moedaNegociadaAdto?: string;
            moedaNegociadaInvoice?: string;
            valorAbertoNegociadoInvoice?: number;
        } = {
            ...(valorMoedaNegociadaAdto !== undefined ? { valorMoedaNegociadaAdto } : {}),
            ...(valorMoedaNegociadaInvoice !== undefined ? { valorMoedaNegociadaInvoice } : {}),
            ...(moedaNegociadaAdto !== undefined ? { moedaNegociadaAdto } : {}),
            ...(moedaNegociadaInvoice !== undefined ? { moedaNegociadaInvoice } : {}),
            ...(valorAbertoNegociadoInvoice !== undefined ? { valorAbertoNegociadoInvoice } : {}),
        };
        if (
            taxaAdiantamento === undefined ||
            taxaInvoice === undefined ||
            principalMoeda === undefined
        ) {
            return enriched;
        }
        enriched.variacao = this.variacaoCambialService.calcular({
            moeda: titInv[0]?.moedaNome ?? invoice.moeda,
            principalMoeda,
            taxaAdiantamento,
            taxaInvoice,
            ...(dataBase !== undefined ? { dataBase } : {}),
        });
        return enriched;
    };

    private countByMotivo = (bloqueadas: PermutaCandidata[]): Record<string, number> => {
        const acc: Record<string, number> = {};
        for (const c of bloqueadas) {
            const motivo = c.motivoBloqueio ?? 'desconhecido';
            acc[motivo] = (acc[motivo] ?? 0) + 1;
        }
        return acc;
    };
}
