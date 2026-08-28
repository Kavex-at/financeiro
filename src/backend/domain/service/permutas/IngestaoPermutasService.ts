import { inject, injectable } from 'tsyringe';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import type Invoice from '../../interface/permutas/Invoice.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import { ESTADO_ELEGIBILIDADE } from '../../interface/permutas/EstadoElegibilidade.js';
import type PermutaCandidata from '../../interface/permutas/PermutaCandidata.js';
import PermutaRelationalRepository, {
    type AdiantamentoRow,
    type CasamentoRow,
    type DeclaracaoRow,
    type IngestRunHeader,
    type InvoiceRow,
} from '../../repository/permutas/PermutaRelationalRepository.js';
import type { PermutaEleicaoRunInput } from '../../repository/permutas/PermutaSnapshotRepository.js';
import PermutaSnapshotRepository from '../../repository/permutas/PermutaSnapshotRepository.js';
import LogService from '../LogService.js';
import BorderoGestaoService from './BorderoGestaoService.js';
import EleicaoPermutasService from './EleicaoPermutasService.js';
import VariacaoCambialPermutaService from './VariacaoCambialPermutaService.js';

export interface IngestaoParams {
    /** Identidade auditável de quem disparou a ingestão (auditoria O6). */
    triggeredBy: string;
}

export interface IngestaoResult {
    runId: string;
    flowId: string;
    status: 'success' | 'error';
    totalAdiantamentos: number;
    totalInvoices: number;
    totalCasamentos: number;
    totalStale: number;
}

/**
 * Lock-key int32 estável da ingestão diária. Serializa o job × um eventual
 * trigger manual concorrente — só uma ingestão escreve o modelo relacional por
 * vez (os fatos last-good sobrevivem a um ROLLBACK).
 */
export const INGEST_LOCK_KEY = 918273645;

/**
 * IngestaoPermutasService — alimenta o modelo relacional (Fase B) a partir do
 * MESMO compute da eleição (`EleicaoPermutasService.computeCandidatas`).
 *
 * Fluxo (atômico, `withTransaction` + `withAdvisoryLock(INGEST_LOCK_KEY)`):
 *   1. cabeçalho de run `kind='ingest'`;
 *   2. UPSERT por chave natural dos fatos (adiantamento/invoice/declaração),
 *      carimbando `last_ingest_run_id`/`last_seen_at`/`stale=false`;
 *   3. recompute do casamento automático 1:1 (DELETE + INSERT);
 *   4. staleness sweep (`stale=true` no que não foi visto neste run);
 *   5. finaliza o cabeçalho com os totais.
 * Falha → ROLLBACK + cabeçalho `error` FORA da transação. Também grava o
 * snapshot (back-compat `/painel`) via `PermutaSnapshotRepository.persistRun`.
 */
@injectable()
export default class IngestaoPermutasService {
    constructor(
        @inject(EleicaoPermutasService) private eleicaoService: EleicaoPermutasService,
        @inject(PermutaRelationalRepository)
        private relationalRepository: PermutaRelationalRepository,
        @inject(PermutaSnapshotRepository)
        private snapshotRepository: PermutaSnapshotRepository,
        @inject(VariacaoCambialPermutaService)
        private variacaoCambialService: VariacaoCambialPermutaService,
        @inject(BorderoGestaoService) private borderoGestaoService: BorderoGestaoService,
        @inject(LogService) private logService: LogService,
    ) {}

    public executar = async (params: IngestaoParams): Promise<IngestaoResult> => {
        const { triggeredBy } = params;
        const startedAt = new Date();
        let flowId = '';

        try {
            const computed = await this.eleicaoService.computeCandidatas();
            flowId = computed.flowId;
            const { candidatas, totals } = computed;

            const adiantamentos = candidatas.map((c) => this.toAdiantamentoRow(c));
            const invoices = this.toInvoiceRows(candidatas, computed.todasInvoices);
            const declaracoes = this.toDeclaracaoRows(candidatas);
            const casamentos = this.toCasamentoRows(candidatas);

            const header: IngestRunHeader = {
                flowId,
                startedAt,
                finishedAt: new Date(),
                status: 'success',
                triggeredBy,
                totalAdiantamentos: adiantamentos.length,
                totalInvoices: invoices.length,
                totalCasamentos: casamentos.length,
                totalStale: 0,
            };

            let totalStale = 0;
            const runId = await this.relationalRepository.persistIngestRun(
                header,
                INGEST_LOCK_KEY,
                async (tx, currentRunId) => {
                    await this.relationalRepository.upsertAdiantamentos(
                        tx,
                        currentRunId,
                        adiantamentos,
                    );
                    await this.relationalRepository.upsertInvoices(tx, currentRunId, invoices);
                    await this.relationalRepository.upsertDeclaracoes(
                        tx,
                        currentRunId,
                        declaracoes,
                    );
                    await this.relationalRepository.replaceAutoCasamentos(
                        tx,
                        currentRunId,
                        casamentos,
                    );
                    totalStale = await this.relationalRepository.markStale(tx, currentRunId);
                },
            );

            // Back-compat `/painel`: mantém o snapshot de candidatas vivo.
            const snapshotInput: PermutaEleicaoRunInput = {
                flowId,
                startedAt,
                finishedAt: new Date(),
                status: 'success',
                triggeredBy,
                totalCandidatas: totals.totalCandidatas,
                totalElegiveis: totals.totalElegiveis,
                totalBloqueadas: totals.totalBloqueadas,
                bloqueadasByMotivo: totals.bloqueadasByMotivo,
            };
            await this.snapshotRepository.persistRun(snapshotInput, candidatas);

            // Atualiza o cache de borderôs (tela de Borderôs lê do banco). Best-effort: uma falha
            // aqui não derruba a ingestão (os fatos principais já foram persistidos).
            try {
                await this.borderoGestaoService.refreshCache();
            } catch (err) {
                await this.logService.warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'falha ao atualizar o cache de borderôs (segue)',
                    data: { flowId, erro: err instanceof Error ? err.message : String(err) },
                });
            }

            await this.logService.info({
                type: LOG_TYPE.FLOW_COMPLETE,
                message: 'permuta ingest complete',
                data: {
                    flowId,
                    ingestRunId: runId,
                    totalAdiantamentos: adiantamentos.length,
                    totalInvoices: invoices.length,
                    totalCasamentos: casamentos.length,
                    totalStale,
                    durationMs: Date.now() - startedAt.getTime(),
                },
            });

            return {
                runId,
                flowId,
                status: 'success',
                totalAdiantamentos: adiantamentos.length,
                totalInvoices: invoices.length,
                totalCasamentos: casamentos.length,
                totalStale,
            };
        } catch (error) {
            // Lock ocupado (cron ou outro analista rodando) NÃO é falha: nada se
            // moveu, nada foi escrito (ADR-0006). Não grava run `error` (poluiria a
            // trilha de auditoria do modal) nem loga como erro — só re-lança para a
            // rota mapear em HTTP 409.
            if (error instanceof IngestLockBusyError) {
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            // Cabeçalho de erro FORA da transação (a tx foi revertida — os fatos
            // last-good sobrevivem). Best-effort: uma falha aqui não mascara o
            // erro original.
            let runId = '';
            try {
                runId = await this.relationalRepository.insertIngestRunHeader({
                    flowId,
                    startedAt,
                    finishedAt: new Date(),
                    status: 'error',
                    triggeredBy,
                    totalAdiantamentos: 0,
                    totalInvoices: 0,
                    totalCasamentos: 0,
                    totalStale: 0,
                    errorMessage: message,
                });
            } catch {
                // engole — o erro original é re-lançado abaixo.
            }

            await this.logService.error({
                type: LOG_TYPE.FLOW_ERROR,
                message: 'permuta ingest aborted',
                error,
                data: { flowId, ingestRunId: runId, error: message },
            });
            throw error;
        }
    };

    private toAdiantamentoRow = (c: PermutaCandidata): AdiantamentoRow => ({
        docCod: c.adiantamento.docCod,
        priCod: c.priCod,
        ...(c.adiantamento.filCod != null ? { filCod: c.adiantamento.filCod } : {}),
        ...(c.adiantamento.referencia !== undefined
            ? { referencia: c.adiantamento.referencia }
            : {}),
        ...(c.adiantamento.referenciaExterna !== undefined
            ? { referenciaExterna: c.adiantamento.referenciaExterna }
            : {}),
        ...(c.adiantamento.exportador !== undefined
            ? { exportador: c.adiantamento.exportador }
            : {}),
        ...(c.adiantamento.dataEmissao !== undefined
            ? { dataEmissao: c.adiantamento.dataEmissao }
            : {}),
        ...(c.adiantamento.valor !== undefined ? { valor: c.adiantamento.valor } : {}),
        ...(c.adiantamento.valorMoedaNegociada !== undefined
            ? { valorMoedaNegociada: c.adiantamento.valorMoedaNegociada }
            : {}),
        ...(c.adiantamento.moeda !== undefined ? { moeda: c.adiantamento.moeda } : {}),
        ...(c.adiantamento.moedaNegociada !== undefined
            ? { moedaNegociada: c.adiantamento.moedaNegociada }
            : {}),
        ...(c.adiantamento.taxa !== undefined ? { taxa: c.adiantamento.taxa } : {}),
        ...(c.adiantamento.valorTotal !== undefined
            ? { valorTotal: c.adiantamento.valorTotal }
            : {}),
        ...(c.adiantamento.valorAberto !== undefined
            ? { valorAberto: c.adiantamento.valorAberto }
            : {}),
        ...(c.adiantamento.pesCod !== undefined ? { pesCod: c.adiantamento.pesCod } : {}),
        ...(c.adiantamento.importador !== undefined
            ? { importador: c.adiantamento.importador }
            : {}),
        pago: c.adiantamento.pago,
        ...(c.adiantamento.valorPermutar !== undefined
            ? { valorPermutar: c.adiantamento.valorPermutar }
            : {}),
        estadoElegibilidade: this.toEstadoRow(c.estadoElegibilidade),
        ...(c.motivoBloqueio !== undefined ? { motivoBloqueio: c.motivoBloqueio } : {}),
        ...(c.aging !== undefined ? { agingDays: c.aging } : {}),
    });

    /**
     * Mapeia o estado de elegibilidade do domínio para o valor da coluna
     * `permuta_adiantamento.estado_elegibilidade` (migration 0005 inclui
     * `casamento-manual` — ADR-0005). 1:1, sem normalização: o relacional carrega
     * o estado real (≠ snapshot, que colapsa N:M → bloqueada para o `/painel`).
     */
    private toEstadoRow = (
        estado: PermutaCandidata['estadoElegibilidade'],
    ): AdiantamentoRow['estadoElegibilidade'] => {
        switch (estado) {
            case ESTADO_ELEGIBILIDADE.ELEGIVEL:
                return 'elegivel';
            case ESTADO_ELEGIBILIDADE.CASAMENTO_MANUAL:
                return 'casamento-manual';
            case ESTADO_ELEGIBILIDADE.PERMUTA_MANUAL:
                return 'permuta-manual';
            case ESTADO_ELEGIBILIDADE.BLOQUEADA:
                return 'bloqueada';
            default:
                return 'descoberta';
        }
    };

    /**
     * Invoices a persistir, deduplicadas por `docCod` (uma invoice pode reaparecer):
     *   - `invoiceCasada` dos elegíveis (1:1);
     *   - `invoicesCandidatas` dos N:M (casamento-manual) — para o analista escolher
     *     uma na tela (read-time agrupa por `priCod`). ADR-0005.
     */
    private toInvoiceRows = (
        candidatas: PermutaCandidata[],
        todasInvoices: Array<{
            inv: Invoice;
            filCod: number;
            pesCod?: string;
            importador?: string;
        }> = [],
    ): InvoiceRow[] => {
        const byDocCod = new Map<string, InvoiceRow>();
        // `pago` CONFIÁVEL por docCod, vindo do universo hidratado (`hidratarInvoiceNegociada`
        // → `derivarPagoDosTitulos` sobre o com308). É a ÚNICA fonte boa deste campo.
        //
        // As invoices das candidatas (adicionadas primeiro, logo abaixo) carregam o `pago` do
        // `com298/list` via `ConexosBaseClient.isPago`, que é sempre `false` — o list não popula
        // `mnyTitAberto`/`mnyTitPago` (null em 1146/1146 INVOICEs, sonda 2026-08-28). Como a
        // candidata entra primeiro e o laço do universo pula quem já existe, sem este mapa a
        // correção do `pago` NÃO alcançaria justamente as invoices de processo COM adiantamento
        // — as que mais importam para permuta. Achado do Regis-Review 2026-08-28.
        //
        // O universo (`listInvoicesFinalizadas`) usa o mesmo filtro das candidatas
        // (`tpdCod=128` + FINALIZADO) sem o recorte de `priCod`, então toda invoice casada
        // também está aqui. Se faltar (ex.: cap de paginação), o `?? inv.pago` preserva o
        // piso conservador `false` — a invoice continua visível.
        const pagoConfiavel = new Map<string, boolean>(
            todasInvoices.map(({ inv }) => [inv.docCod, inv.pago]),
        );
        const add = (
            inv: PermutaCandidata['invoiceCasada'],
            filCod: number,
            cliente?: { pesCod?: string; importador?: string },
        ) => {
            if (!inv) return;
            byDocCod.set(inv.docCod, {
                docCod: inv.docCod,
                priCod: inv.priCod,
                ...(filCod != null ? { filCod } : {}),
                ...(inv.referencia !== undefined ? { referencia: inv.referencia } : {}),
                ...(inv.referenciaExterna !== undefined
                    ? { referenciaExterna: inv.referenciaExterna }
                    : {}),
                ...(inv.exportador !== undefined ? { exportador: inv.exportador } : {}),
                ...(inv.dataEmissao !== undefined ? { dataEmissao: inv.dataEmissao } : {}),
                ...(inv.valor !== undefined ? { valor: inv.valor } : {}),
                ...(inv.valorMoedaNegociada !== undefined
                    ? { valorMoedaNegociada: inv.valorMoedaNegociada }
                    : {}),
                ...(inv.moeda !== undefined ? { moeda: inv.moeda } : {}),
                ...(inv.moedaNegociada !== undefined ? { moedaNegociada: inv.moedaNegociada } : {}),
                ...(inv.taxa !== undefined ? { taxa: inv.taxa } : {}),
                ...(cliente?.pesCod !== undefined ? { pesCod: cliente.pesCod } : {}),
                ...(cliente?.importador !== undefined ? { importador: cliente.importador } : {}),
                pago: pagoConfiavel.get(inv.docCod) ?? inv.pago,
            });
        };
        for (const c of candidatas) {
            // Cliente (importador) do processo do adiantamento — mesmas invoices do processo.
            const cliente = {
                ...(c.adiantamento.pesCod !== undefined ? { pesCod: c.adiantamento.pesCod } : {}),
                ...(c.adiantamento.importador !== undefined
                    ? { importador: c.adiantamento.importador }
                    : {}),
            };
            add(c.invoiceCasada, c.adiantamento.filCod, cliente);
            for (const inv of c.invoicesCandidatas ?? []) add(inv, c.adiantamento.filCod, cliente);
        }
        // Universo COMPLETO (regra 2026-06-24): todas as invoices finalizadas, mesmo SEM adto casado.
        // Básico (sem com308 → sem valor negociado). NÃO sobrescreve as casadas (hidratadas acima).
        for (const { inv, filCod, pesCod, importador } of todasInvoices) {
            if (byDocCod.has(inv.docCod)) continue;
            byDocCod.set(inv.docCod, {
                docCod: inv.docCod,
                priCod: inv.priCod,
                ...(filCod != null ? { filCod } : {}),
                ...(inv.referencia !== undefined ? { referencia: inv.referencia } : {}),
                ...(inv.referenciaExterna !== undefined
                    ? { referenciaExterna: inv.referenciaExterna }
                    : {}),
                ...(inv.exportador !== undefined ? { exportador: inv.exportador } : {}),
                ...(inv.dataEmissao !== undefined ? { dataEmissao: inv.dataEmissao } : {}),
                ...(inv.valor !== undefined ? { valor: inv.valor } : {}),
                ...(inv.valorMoedaNegociada !== undefined
                    ? { valorMoedaNegociada: inv.valorMoedaNegociada }
                    : {}),
                ...(inv.moeda !== undefined ? { moeda: inv.moeda } : {}),
                ...(inv.moedaNegociada !== undefined ? { moedaNegociada: inv.moedaNegociada } : {}),
                ...(inv.taxa !== undefined ? { taxa: inv.taxa } : {}),
                ...(pesCod !== undefined ? { pesCod } : {}),
                ...(importador !== undefined ? { importador } : {}),
                pago: inv.pago,
            });
        }
        return [...byDocCod.values()];
    };

    /** Declarações, deduplicadas por `(priCod, variante)`. */
    private toDeclaracaoRows = (candidatas: PermutaCandidata[]): DeclaracaoRow[] => {
        const byKey = new Map<string, DeclaracaoRow>();
        for (const c of candidatas) {
            const d = c.declaracaoImportacao;
            if (!d) continue;
            const key = `${d.priCod}|${d.variante}`;
            byKey.set(key, {
                priCod: d.priCod,
                variante: d.variante,
                ...(d.dataBase !== undefined ? { dataBase: d.dataBase } : {}),
            });
        }
        return [...byKey.values()];
    };

    /**
     * Moeda do casamento (rotula `valorASerUsado`, em moeda NEGOCIADA): a sigla
     * negociada da invoice, com fallback para a do adiantamento e, por fim, a do
     * documento da invoice. Garante "USD" em vez de "BRL" na tela Gestão.
     */
    private casamentoMoeda = (c: PermutaCandidata): string | undefined =>
        c.invoiceCasada?.moedaNegociada ?? c.adiantamento.moedaNegociada ?? c.invoiceCasada?.moeda;

    /** Saldo disponível do adiantamento em moeda NEGOCIADA: `valorPermutar(BRL) /
     * taxa` (mesmo cálculo do lado manual); fallback ao `valorMoedaNegociada`. */
    private saldoDisponivelNeg = (c: PermutaCandidata): number => {
        const a = c.adiantamento;
        if (a.valorPermutar !== undefined && a.taxa !== undefined && a.taxa > 0) {
            return a.valorPermutar / a.taxa;
        }
        return a.valorMoedaNegociada ?? 0;
    };

    /**
     * Casamentos automáticos N:1 (permuta Simples) — distribuição GREEDY com teto.
     *
     * Vários adiantamentos ELEGÍVEIS podem casar com a MESMA invoice. Em vez de
     * cada um usar seu valor cheio (super-permuta), distribui o em-aberto vivo da
     * invoice (`valorAbertoNegociado`, fallback `valorMoedaNegociada`) entre eles:
     * do MAIOR saldo p/ o menor (desempate: mais antigo primeiro — maior aging,
     * fallback dataEmissao). O adiantamento consumido parcialmente mantém o saldo
     * restante em aberto (`valorASerUsado` parcial). A variação cambial é
     * recalculada sobre o valor PARCIAL de cada adto. READ-ONLY (só nosso snapshot).
     */
    private toCasamentoRows = (candidatas: PermutaCandidata[]): CasamentoRow[] => {
        // Agrupa as candidatas elegíveis (com invoice casada) por invoice.
        const byInvoice = new Map<string, PermutaCandidata[]>();
        for (const c of candidatas) {
            if (c.estadoElegibilidade !== ESTADO_ELEGIBILIDADE.ELEGIVEL || !c.invoiceCasada) {
                continue;
            }
            const list = byInvoice.get(c.invoiceCasada.docCod) ?? [];
            list.push(c);
            byInvoice.set(c.invoiceCasada.docCod, list);
        }

        const rows: CasamentoRow[] = [];
        for (const grupo of byInvoice.values()) {
            // Teto da invoice (moeda negociada): em-aberto vivo; fallback valor
            // negociado; se ambos ausentes → undefined (mantém comportamento antigo:
            // cada adto usa seu saldo cheio, sem capar).
            const inv = grupo[0]?.invoiceCasada;
            const teto = inv?.valorAbertoNegociado ?? inv?.valorMoedaNegociada;
            // Ordena: maior saldo disponível primeiro; desempate mais antigo
            // (aging desc; fallback dataEmissao asc).
            const ordenado = [...grupo].sort((x, y) => {
                const sx = this.saldoDisponivelNeg(x);
                const sy = this.saldoDisponivelNeg(y);
                if (sy !== sx) return sy - sx;
                if (x.aging !== undefined && y.aging !== undefined && x.aging !== y.aging) {
                    return y.aging - x.aging;
                }
                return x.adiantamento.dataEmissao.getTime() - y.adiantamento.dataEmissao.getTime();
            });

            let restante = teto;
            for (const c of ordenado) {
                const saldo = this.saldoDisponivelNeg(c);
                const usado =
                    restante === undefined ? saldo : Math.min(saldo, Math.max(0, restante));
                if (restante !== undefined) restante -= usado;

                const vc = c.variacaoCambial;
                const taxaAdiantamento = vc?.taxaAdiantamento ?? c.adiantamento.taxa;
                const taxaInvoice = vc?.taxaInvoice;
                const moeda = this.casamentoMoeda(c);
                // Variação recalculada sobre o valor PARCIAL (`usado`).
                const variacao =
                    taxaAdiantamento !== undefined &&
                    taxaInvoice !== undefined &&
                    moeda !== undefined
                        ? this.variacaoCambialService.calcular({
                              moeda,
                              principalMoeda: usado,
                              taxaAdiantamento,
                              taxaInvoice,
                              ...(c.declaracaoImportacao?.dataBase !== undefined
                                  ? { dataBase: c.declaracaoImportacao.dataBase }
                                  : {}),
                          })
                        : undefined;

                rows.push({
                    invoiceDocCod: c.invoiceCasada?.docCod ?? '',
                    adiantamentoDocCod: c.adiantamento.docCod,
                    priCod: c.priCod,
                    valorASerUsado: usado,
                    ...(moeda !== undefined ? { moeda } : {}),
                    ...(variacao?.classificacao !== undefined
                        ? { variacaoClassificacao: variacao.classificacao }
                        : {}),
                    ...(variacao?.resultado !== undefined
                        ? { variacaoResultado: variacao.resultado }
                        : {}),
                    ...(variacao?.delta !== undefined ? { variacaoDelta: variacao.delta } : {}),
                    ...(taxaAdiantamento !== undefined ? { taxaAdiantamento } : {}),
                    ...(taxaInvoice !== undefined ? { taxaInvoice } : {}),
                });
            }
        }
        return rows;
    };
}
