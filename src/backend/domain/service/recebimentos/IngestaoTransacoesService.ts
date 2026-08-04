import { inject, injectable } from 'tsyringe';
import ConexosBaseClient from '../../client/ConexosBaseClient.js';
import ConexosExtratoClient from '../../client/ConexosExtratoClient.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    FANOUT_LIMIT_RECEBIMENTOS,
    RECEBIMENTO_INGEST_BLOCO_DIAS,
    RECEBIMENTO_INGEST_LOCK_KEY,
} from '../../interface/recebimentos/constants.js';
import type {
    IngestaoTransacoesInput,
    IngestaoTransacoesInterface,
    IngestaoTransacoesResult,
    RunManyIngestaoInput,
} from '../../interface/recebimentos/ports.js';
import RecebimentoIngestaoRunRepository from '../../repository/recebimentos/RecebimentoIngestaoRunRepository.js';
import TransacaoRepository from '../../repository/recebimentos/TransacaoRepository.js';
import LogService from '../LogService.js';
import { normalizarLancamento } from './normalizarLancamento.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Um par (filial, conta) a ler — a unidade de trabalho do fan-out ACHATADO. */
interface AlvoLeitura {
    filCod: number;
    gerNum: number;
    gerDes?: string;
}

/**
 * IngestaoTransacoesService — Módulo 1 da Frente IV (cadência do extrato bancário).
 *
 * Lê os lançamentos de crédito do Conexos (`fin095`, por conta do `fin133`),
 * normaliza, deduplica por chave natural e persiste em `transacao_bancaria`.
 * Exclusão cross-processo por advisory lock (`IngestLockBusyError` → 409).
 * READ-ONLY no ERP: a única escrita é o Postgres próprio.
 *
 * Espelha `IngestaoPagamentosService` (SISPAG). Duas diferenças deliberadas:
 *
 * 1. **`ConexosExtratoClient` é injetado direto**, sem passar pelo
 *    `NEXXERA_GATEWAY_TOKEN`. O `RawMovimento` daquele port não tem `tipo`,
 *    `gerNum` nem `referenciaBancaria`, e a fonte real não é a Nexxera — é o
 *    Conexos. O port continua no lugar para quando houver ingestão por arquivo
 *    CNAB; o rename está anotado no inbox da ontologia.
 * 2. **Sem anti-fantasma.** Extrato bancário é imutável: um lançamento não some
 *    da fonte. Inativar por ausência (como o `titulo_a_pagar` faz) mascararia um
 *    problema de leitura como se fosse conciliação.
 */
@injectable()
export default class IngestaoTransacoesService implements IngestaoTransacoesInterface {
    public readonly advisoryLockKey: number = RECEBIMENTO_INGEST_LOCK_KEY;

    public constructor(
        @inject(ConexosExtratoClient) private readonly extrato: ConexosExtratoClient,
        @inject(TransacaoRepository) private readonly transacaoRepo: TransacaoRepository,
        @inject(RecebimentoIngestaoRunRepository)
        private readonly runRepo: RecebimentoIngestaoRunRepository,
        @inject(ConexosBaseClient) private readonly base: ConexosBaseClient,
        @inject(BoundedConcurrency) private readonly bounded: BoundedConcurrency,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    /** Ingestão de UMA filial. Toma o lock (é ponto de entrada público). */
    public run = async (input: IngestaoTransacoesInput): Promise<IngestaoTransacoesResult> =>
        this.comLock(() =>
            this.executar({
                filCods: [input.filCod],
                periodo: input.periodo,
                correlationId: input.correlationId,
                triggeredBy: input.triggeredBy,
            }),
        );

    /**
     * Ingestão de N filiais. Toma o lock UMA vez, no topo.
     *
     * ⚠️ Não delegue para `run` por filial: o `withAdvisoryLock` adquire o lock
     * numa conexão DEDICADA do pool, e `pg_try_advisory_lock` é session-scoped —
     * cada chamada aninhada abriria outra sessão, falharia em adquirir e todas as
     * filiais virariam 409. O stub que este serviço substitui faz exatamente essa
     * delegação (inofensiva lá porque não há lock).
     */
    public runMany = async (input: RunManyIngestaoInput): Promise<IngestaoTransacoesResult> =>
        this.comLock(() => this.executar(input));

    private comLock = async <T>(fn: () => Promise<T>): Promise<T> =>
        this.db.withAdvisoryLock(this.advisoryLockKey, fn, async () => {
            throw new IngestLockBusyError(
                'recebimento ingest advisory lock busy — another ingestion is running',
            );
        });

    private executar = async (input: RunManyIngestaoInput): Promise<IngestaoTransacoesResult> => {
        const runId = await this.runRepo.createRun({
            correlationId: input.correlationId,
            triggeredBy: input.triggeredBy,
            filCods: input.filCods,
            periodoDe: input.periodo.de,
            periodoAte: input.periodo.ate,
        });

        try {
            const alvos = await this.resolverAlvos(input.filCods);
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: `[RECEBIMENTOS] ingestão ${runId}: ${alvos.length} conta(s) com movimento em ${input.filCods.length} filial(is)`,
                data: { runId, correlationId: input.correlationId, contas: alvos.length },
            });

            const importadoEm = new Date();
            let totalLidas = 0;
            let totalInseridas = 0;
            let totalDeduplicadas = 0;
            let contasFalhas = 0;

            // Fan-out ACHATADO sobre (filial × conta) — um único bounded pool.
            // Dois níveis aninhados dariam FANOUT² sessões Conexos simultâneas, que
            // é literalmente o burst do incidente LOGIN_ERROR_MAX_SESSIONS do SISPAG.
            const resultados = await this.bounded.run(
                alvos,
                async (alvo) => this.ingerirConta(alvo, input.periodo, runId, importadoEm),
                FANOUT_LIMIT_RECEBIMENTOS,
            );

            for (let i = 0; i < resultados.length; i++) {
                const r = resultados[i];
                if (r.status === 'fulfilled') {
                    totalLidas += r.value.lidas;
                    totalInseridas += r.value.inseridas;
                    totalDeduplicadas += r.value.deduplicadas;
                } else {
                    contasFalhas += 1;
                    // Contar a falha sem dizer QUAL foi transforma um erro de escrita
                    // num "partial" mudo — o operador vê 7 contas falhas e nenhuma pista.
                    const alvo = alvos[i];
                    await this.logService.warn({
                        type: LOG_TYPE.BUSINESS_WARN,
                        message: `[RECEBIMENTOS] conta ${alvo?.gerNum} (filial ${alvo?.filCod}) falhou na ingestão ${runId}`,
                        error: r.reason,
                        data: { runId, filCod: alvo?.filCod, gerNum: alvo?.gerNum },
                    });
                }
            }

            // `partial` quando alguma conta falhou: a carteira está incompleta e o
            // painel não pode anunciar "carteira de HH:mm" como se estivesse inteira.
            const status = contasFalhas > 0 ? 'partial' : 'success';
            await this.runRepo.finishRun({
                runId,
                status,
                totalLidas,
                totalInseridas,
                totalDeduplicadas,
                totalContas: alvos.length,
                totalContasFalhas: contasFalhas,
            });

            const resumo = {
                type: contasFalhas > 0 ? LOG_TYPE.BUSINESS_WARN : LOG_TYPE.BUSINESS_INFO,
                message: `[RECEBIMENTOS] ingestão ${runId} ${status}: ${totalLidas} lidas, ${totalInseridas} novas, ${totalDeduplicadas} já conhecidas, ${contasFalhas} conta(s) com falha`,
                data: {
                    runId,
                    status,
                    totalLidas,
                    totalInseridas,
                    totalDeduplicadas,
                    contasFalhas,
                },
            };
            if (contasFalhas > 0) await this.logService.warn(resumo);
            else await this.logService.info(resumo);

            return { runId, total: totalLidas, deduplicadas: totalDeduplicadas };
        } catch (err) {
            await this.runRepo.finishRun({
                runId,
                status: 'error',
                totalLidas: 0,
                totalInseridas: 0,
                totalDeduplicadas: 0,
                totalContas: 0,
                totalContasFalhas: 0,
                errorMessage: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    };

    /**
     * Contas a ler: só as que têm movimento. Uma conta zerada custa uma chamada ao
     * `fin095` para devolver nada — em produção, 12 das 19 contas da filial 1 são
     * assim.
     */
    private resolverAlvos = async (filCods: number[]): Promise<AlvoLeitura[]> => {
        const porFilial = await this.bounded.run(
            filCods,
            async (filCod) => {
                const contas = await this.extrato.listContas(filCod);
                return contas
                    .filter((c) => (c.qtdeBanco ?? 0) > 0 || (c.qtdeSistema ?? 0) > 0)
                    .map((c) => ({ filCod, gerNum: c.gerNum, gerDes: c.gerDes }));
            },
            FANOUT_LIMIT_RECEBIMENTOS,
        );

        return porFilial.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    };

    /**
     * Lê e persiste UMA conta, fatiando a janela em blocos.
     *
     * O fatiamento mantém cada `paginate` longe do teto de páginas mesmo numa conta
     * de alto volume, e persiste bloco a bloco em vez de acumular a conta inteira
     * em memória antes de gravar.
     */
    private ingerirConta = async (
        alvo: AlvoLeitura,
        periodo: { de: Date; ate: Date },
        runId: string,
        importadoEm: Date,
    ): Promise<{ lidas: number; inseridas: number; deduplicadas: number }> => {
        let lidas = 0;
        let inseridas = 0;
        let deduplicadas = 0;

        for (const bloco of this.fatiarPeriodo(periodo)) {
            const lancamentos = await this.extrato.listLancamentos({
                filCod: alvo.filCod,
                gerNum: alvo.gerNum,
                de: bloco.de,
                ate: bloco.ate,
            });
            if (lancamentos.length === 0) continue;

            const transacoes = lancamentos.map((l) =>
                normalizarLancamento(l, { runId, importadoEm }),
            );
            const r = await this.transacaoRepo.upsertMany(transacoes, runId);

            lidas += lancamentos.length;
            inseridas += r.inseridas;
            deduplicadas += r.deduplicadas;
        }

        return { lidas, inseridas, deduplicadas };
    };

    /** Divide a janela em blocos de no máximo `RECEBIMENTO_INGEST_BLOCO_DIAS`. */
    private fatiarPeriodo = (periodo: { de: Date; ate: Date }): Array<{ de: Date; ate: Date }> => {
        const blocos: Array<{ de: Date; ate: Date }> = [];
        const passo = RECEBIMENTO_INGEST_BLOCO_DIAS * DAY_MS;
        let inicio = periodo.de.getTime();
        const fim = periodo.ate.getTime();

        while (inicio < fim) {
            const proximo = Math.min(inicio + passo, fim);
            blocos.push({ de: new Date(inicio), ate: new Date(proximo) });
            inicio = proximo;
        }
        // Janela degenerada (de >= ate) ainda rende um bloco — deixa o ERP decidir.
        return blocos.length > 0 ? blocos : [{ de: periodo.de, ate: periodo.ate }];
    };

    /** Filiais a ingerir: as configuradas, ou todas as do ERP. */
    public resolverFilCods = async (): Promise<number[]> => {
        const env = await this.environmentProvider.getEnvironmentVars();
        if (env.recebimentoIngestFilCods.length > 0) return env.recebimentoIngestFilCods;
        const filiais = await this.base.getFiliais();
        return filiais.map((f) => Number(f.filCod)).filter((n) => Number.isInteger(n) && n > 0);
    };

    /** Janela default da ingestão (env `RECEBIMENTO_INGEST_DIAS`). */
    public resolverPeriodo = async (diasOverride?: number): Promise<{ de: Date; ate: Date }> => {
        const env = await this.environmentProvider.getEnvironmentVars();
        const dias = diasOverride ?? env.recebimentoIngestDias;
        const ate = new Date();
        return { de: new Date(ate.getTime() - dias * DAY_MS), ate };
    };
}
