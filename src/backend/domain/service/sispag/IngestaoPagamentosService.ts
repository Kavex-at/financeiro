import { inject, injectable } from 'tsyringe';
import ConexosBaseClient from '../../client/ConexosBaseClient.js';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import type {
    IngestaoPagamentosResult,
    TituloAPagar,
} from '../../interface/sispag/SispagInterface.js';
import PagamentoIngestaoRunRepository from '../../repository/sispag/PagamentoIngestaoRunRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import LogService from '../LogService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Chave de advisory lock EXCLUSIVA da ingestão de pagamentos (≠ da de permutas). */
export const PAGAMENTO_INGEST_LOCK_KEY = 726354819;
/** Teto de leituras Conexos simultâneas no fan-out da ingestão. */
const FANOUT_LIMIT = 4;

/**
 * IngestaoPagamentosService — cadência da carteira de pagamentos (cron ou manual).
 * Lê os títulos a pagar do Conexos (janela de vencimento), persiste os DADOS
 * BÁSICOS em `titulo_a_pagar` e grava um run de auditoria. Exclusão cross-processo
 * via advisory lock (`IngestLockBusyError` → 409). Espelha `IngestaoPermutasService`.
 * READ-ONLY no ERP; a única escrita é o Postgres próprio.
 */
@injectable()
export default class IngestaoPagamentosService {
    public constructor(
        @inject(TituloAPagarRepository) private readonly tituloRepo: TituloAPagarRepository,
        @inject(PagamentoIngestaoRunRepository)
        private readonly runRepo: PagamentoIngestaoRunRepository,
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(ConexosSispagWriteClient) private readonly fin015: ConexosSispagWriteClient,
        @inject(ConexosBaseClient) private readonly base: ConexosBaseClient,
        @inject(BoundedConcurrency) private readonly bounded: BoundedConcurrency,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    public executar = async (input: {
        triggeredBy: string;
        idempotencyKey?: string;
    }): Promise<IngestaoPagamentosResult> => {
        if (input.idempotencyKey) {
            const existing = await this.runRepo.findRunIdByIdempotencyKey(input.idempotencyKey);
            if (existing) {
                return { runId: existing, status: 'success', totalTitulos: 0, totalInativados: 0 };
            }
        }
        return this.db.withAdvisoryLock(
            PAGAMENTO_INGEST_LOCK_KEY,
            () => this.runIngestion(input),
            async () => {
                throw new IngestLockBusyError(
                    'pagamento ingest advisory lock busy — another ingestion is running',
                );
            },
        );
    };

    /**
     * Títulos da filial que o ERP casou com um boleto DDA (`titVldReflexoDdaAssoc`).
     *
     * Best-effort por desenho: a carteira é o produto principal da ingestão, e o flag de boleto
     * é enriquecimento. Uma filial sem lote nativo (nada a usar como contexto de leitura do
     * grid), ou uma falha nessa leitura, devolve conjunto vazio com WARN — os títulos entram
     * com `temBoleto = false` em vez de a rodada inteira cair.
     */
    private titulosComBoletoDda = async (filCod: number): Promise<Set<string>> => {
        try {
            // O banco NUNCA é fixo: sai da conta pagadora da própria filial (`fin005`).
            // O mesmo `ccoCod` aponta para contas diferentes em cada filial.
            const contas = await this.sispag.listContasCorrentes(filCod);
            const bncCod = contas[0]?.bncCod;
            if (bncCod === undefined) {
                await this.logService.warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'ingestão pagamentos: filial sem conta pagadora — sem flag de boleto',
                    data: { filCod },
                });
                return new Set();
            }
            const comBoleto = await this.fin015.listarTitulosComBoletoDda({ filCod, bncCod });
            // Taxa por filial, registrada TODA rodada. É o sinal barato de quebra de contrato:
            // uma filial que historicamente traz dezenas de boletos e passa a trazer 0 aparece
            // aqui na rodada seguinte, em vez de aparecer no banco recusando a remessa.
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'ingestão pagamentos: taxa de boleto DDA por filial',
                data: { filCod, bncCod, comBoletoDda: comBoleto.size },
            });
            return comBoleto;
        } catch (error) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'ingestão pagamentos: leitura do flag de boleto DDA falhou (ignorada)',
                data: {
                    filCod,
                    reason: error instanceof Error ? error.message : String(error),
                },
            });
            return new Set();
        }
    };

    private runIngestion = async (input: {
        triggeredBy: string;
        idempotencyKey?: string;
    }): Promise<IngestaoPagamentosResult> => {
        const runId = await this.runRepo.createRun({ triggeredBy: input.triggeredBy });
        try {
            const filiais = await this.base.getFiliais();
            const filCods = filiais
                .map((f) => f.filCod)
                .filter((n): n is number => typeof n === 'number');

            const now = Date.now();
            const minVencimento = now - 15 * DAY_MS;
            const maxVencimento = now + 45 * DAY_MS;

            // Por filial: títulos (fin064) + conjunto de docs a EXCLUIR (exterior/câmbio,
            // com298 ufEspSigla=EX). Internacional está FORA do escopo SISPAG (é câmbio manual
            // da tesouraria, Itaú→BB) — nem entra na carteira. Ver ADR-0021.
            const settled = await this.bounded.run(
                filCods,
                async (filCod) => {
                    const [titulos, exterior, comBoleto] = await Promise.all([
                        this.sispag.listTitulosAPagar(filCod, { minVencimento, maxVencimento }),
                        this.sispag.listExteriorDocCods(filCod),
                        this.titulosComBoletoDda(filCod),
                    ]);
                    return { titulos, exterior, comBoleto };
                },
                FANOUT_LIMIT,
            );

            const titulos: TituloAPagar[] = [];
            // Só as filiais LIDAS com sucesso participam da inativação anti-fantasma —
            // uma filial que falhou não perde seus títulos por engano (fault-tolerance).
            const filiaisLidas: number[] = [];
            for (let i = 0; i < settled.length; i += 1) {
                const s = settled[i];
                if (s.status === 'fulfilled') {
                    filiaisLidas.push(filCods[i]);
                    for (const t of s.value.titulos) {
                        if (t.pago) continue;
                        // Internacional (exterior/câmbio) NÃO entra na carteira SISPAG (fora do escopo).
                        if (s.value.exterior.has(t.docCod)) continue;
                        // "Tem boleto?" vem do flag de DDA do grid de pendentes — nunca do
                        // título (o `titEspCodbar` é null em 100% da carteira).
                        titulos.push({
                            ...t,
                            temBoleto: s.value.comBoleto.has(`${t.filCod}:${t.docCod}:${t.titCod}`),
                        });
                    }
                } else {
                    await this.logService.warn({
                        type: LOG_TYPE.BUSINESS_WARN,
                        message: 'ingestão pagamentos: leitura de filial falhou (ignorada)',
                        data: {
                            filCod: filCods[i],
                            reason: s.reason instanceof Error ? s.reason.message : String(s.reason),
                        },
                    });
                }
            }

            await this.tituloRepo.upsertMany(titulos, runId);
            const inativados = await this.tituloRepo.marcarInativosForaDaRun(runId, filiaisLidas);
            await this.runRepo.finishRun({
                runId,
                status: 'success',
                totalTitulos: titulos.length,
                totalInativados: inativados,
            });
            // Best-effort pós-sucesso: a run JÁ está 'success' e os títulos persistidos —
            // uma falha aqui (blip de banco no idempotency, log) NÃO deve remarcar como error.
            try {
                if (input.idempotencyKey) {
                    await this.runRepo.recordIdempotencyKey(input.idempotencyKey, runId);
                }
                await this.logService.info({
                    type: LOG_TYPE.BUSINESS_INFO,
                    message: 'ingestão de pagamentos concluída',
                    data: {
                        runId,
                        triggeredBy: input.triggeredBy,
                        totalTitulos: titulos.length,
                        inativados,
                    },
                });
            } catch {
                // best-effort — não regride o status da run.
            }
            return {
                runId,
                status: 'success',
                totalTitulos: titulos.length,
                totalInativados: inativados,
            };
        } catch (error) {
            await this.runRepo.finishRun({
                runId,
                status: 'error',
                totalTitulos: 0,
                totalInativados: 0,
                errorMessage: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    };
}
