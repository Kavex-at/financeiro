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
    /**
     * Bancos distintos com conta pagadora na filial. Lista, não "o primeiro": o grid de
     * pendentes é da FILIAL e o banco só serve para achar um lote que sirva de contexto de
     * leitura. Medido em PRD (2026-08-31): `contas[0]` é o banco 38 na filial 1 e o 11 na
     * filial 2 — nenhum dos dois tem lote nativo, e a carteira INTEIRA dessas duas filiais
     * vinha marcada como "sem boleto". Pelo banco 4 a mesma leitura devolve 38 e 266 títulos.
     */
    private bancosDaFilial = async (filCod: number): Promise<number[]> => {
        const contas = await this.sispag.listContasCorrentes(filCod);
        return [...new Set(contas.map((c) => c.bncCod))];
    };

    /**
     * Títulos da filial que o ERP casou com um boleto DDA (`titVldReflexoDdaAssoc`).
     *
     * Best-effort por desenho: a carteira é o produto principal da ingestão, e o flag de boleto
     * é enriquecimento. Falha de leitura devolve conjunto vazio com WARN — os títulos entram com
     * `temBoleto = false` em vez de a rodada inteira cair.
     */
    private titulosComBoletoDda = async (filCod: number): Promise<Set<string>> => {
        try {
            const bncCods = await this.bancosDaFilial(filCod);
            if (bncCods.length === 0) {
                await this.avisar('filial sem conta pagadora — sem flag de boleto', { filCod });
                return new Set();
            }
            const comBoleto = await this.fin015.listarTitulosComBoletoDda({ filCod, bncCods });
            // Taxa por filial, registrada TODA rodada. É o sinal barato de quebra de contrato:
            // uma filial que historicamente traz dezenas de boletos e passa a trazer 0 aparece
            // aqui na rodada seguinte, em vez de aparecer no banco recusando a remessa.
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'ingestão pagamentos: taxa de boleto DDA por filial',
                data: { filCod, bncCodsTentados: bncCods.length, comBoletoDda: comBoleto.size },
            });
            // Zero pode ser verdade (filial sem boleto) ou "nenhum banco tinha lote para servir
            // de contexto". A diferença importa: no segundo caso a coluna do painel mente.
            if (comBoleto.size === 0) {
                await this.avisar('nenhum título com boleto DDA nesta filial', {
                    filCod,
                    bncCodsTentados: bncCods.length,
                });
            }
            return comBoleto;
        } catch (error) {
            await this.avisar('leitura do flag de boleto DDA falhou (ignorada)', {
                filCod,
                reason: error instanceof Error ? error.message : String(error),
            });
            return new Set();
        }
    };

    /** WARN da ingestão, com o prefixo padrão da frente. */
    private avisar = async (mensagem: string, data: Record<string, unknown>): Promise<void> => {
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: `ingestão pagamentos: ${mensagem}`,
            data,
        });
    };

    /**
     * Títulos de UMA filial que entram na carteira, já com o flag de boleto resolvido.
     * Extraído de `runIngestion` para manter o laço de acumulação legível.
     */
    private titulosDaFilial = (lido: {
        titulos: TituloAPagar[];
        exterior: Set<string>;
        comBoleto: Set<string>;
    }): TituloAPagar[] =>
        lido.titulos
            // Pago sai; internacional (exterior/câmbio) também — é câmbio manual da tesouraria,
            // fora do escopo SISPAG (ADR-0021).
            .filter((t) => !t.pago && !lido.exterior.has(t.docCod))
            // "Tem boleto?" vem do flag de DDA do grid de pendentes — nunca do título
            // (o `titEspCodbar` é null em 100% da carteira medida em produção).
            .map((t) => ({
                ...t,
                temBoleto: lido.comBoleto.has(`${t.filCod}:${t.docCod}:${t.titCod}`),
            }));

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
                if (s.status !== 'fulfilled') {
                    await this.avisar('leitura de filial falhou (ignorada)', {
                        filCod: filCods[i],
                        reason: s.reason instanceof Error ? s.reason.message : String(s.reason),
                    });
                    continue;
                }
                filiaisLidas.push(filCods[i]);
                titulos.push(...this.titulosDaFilial(s.value));
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
