import { createHash, randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import { RECEBIMENTO_INGEST_LOCK_KEY } from '../../interface/recebimentos/constants.js';
import type { LinhaExtratoArquivo } from '../../interface/recebimentos/ExtratoArquivoParser.js';
import type { TransacaoBancaria } from '../../interface/recebimentos/TransacaoBancaria.js';
import RecebimentoIngestaoRunRepository from '../../repository/recebimentos/RecebimentoIngestaoRunRepository.js';
import TransacaoRepository from '../../repository/recebimentos/TransacaoRepository.js';
import LogService from '../LogService.js';
import BradescoExtratoParser from './parsers/BradescoExtratoParser.js';
import { groupKeyXlsx, normalizarLinhaXlsx } from './normalizarLinhaXlsx.js';

/** Entrada comum do preview/importar — o arquivo em memória + a filial escolhida no upload. */
export interface ImportarExtratoInput {
    buffer: Buffer;
    arquivoNome: string;
    filCod: number;
    triggeredBy: string;
    /** Chave de idempotência explícita; default = sha256 do arquivo (+ seleção, ver `hash`). */
    idempotencyKey?: string;
    /**
     * `linhaIndice` dos créditos que o analista DESMARCOU no preview — ficam de fora desta
     * importação. Ausente/vazio = importa todos os créditos (comportamento default). Linhas fora
     * da amostra exibida (além de `PREVIEW_AMOSTRA_MAX`) nunca podem ser excluídas — permanecem
     * incluídas, pois o analista não teve como vê-las.
     */
    excluirLinhas?: number[];
}

/** Uma linha da amostra do preview (crédito), com o veredito de dedup. */
export interface PreviewLinha {
    /** Número da linha na planilha original — identifica a linha para seleção na confirmação. */
    linhaIndice: number;
    data: string;
    descricao: string;
    contraparteNome: string | null;
    contraparteDoc: string | null;
    valor: number;
    /** `false` = já existe na carteira (será deduplicada na confirmação). */
    novo: boolean;
}

/** Resultado do dry-run (nenhuma escrita). */
export interface ImportarExtratoPreview {
    cabecalho: {
        banco: string;
        agencia?: string;
        conta?: string;
        periodoDe?: string;
        periodoAte?: string;
    };
    totalLinhas: number;
    totalCreditos: number;
    totalIgnorados: number;
    novos: number;
    jaImportados: number;
    /** O arquivo (mesmo hash) já foi importado numa run anterior. */
    jaImportadoArquivo: boolean;
    amostra: PreviewLinha[];
}

/** Resultado da importação efetiva. */
export interface ImportarExtratoResult {
    runId: string;
    reaproveitada: boolean;
    totalCreditos: number;
    inseridas: number;
    deduplicadas: number;
}

/** Linhas da amostra do preview. */
const PREVIEW_AMOSTRA_MAX = 50;

/**
 * ImportacaoExtratoArquivoService — canal MANUAL do Módulo 1 (upload de extrato .xlsx).
 *
 * Segundo caminho para a MESMA `transacao_bancaria` do canal automático (`IngestaoTransacoesService`
 * / fin095): o analista sobe o extrato baixado do banco quando o caminho ERP não está disponível.
 * Reusa a auditoria de run (`RecebimentoIngestaoRunRepository`), a idempotência, o dedup por
 * `naturalKey` (`TransacaoRepository.upsertMany`) e o MESMO advisory lock do canal automático — upload
 * e cron são mutuamente exclusivos. Importa SÓ créditos (`valor > 0`).
 */
@injectable()
export default class ImportacaoExtratoArquivoService {
    public readonly advisoryLockKey: number = RECEBIMENTO_INGEST_LOCK_KEY;

    public constructor(
        @inject(BradescoExtratoParser) private readonly parser: BradescoExtratoParser,
        @inject(TransacaoRepository) private readonly transacaoRepo: TransacaoRepository,
        @inject(RecebimentoIngestaoRunRepository)
        private readonly runRepo: RecebimentoIngestaoRunRepository,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    /** Dry-run: parseia, classifica novos × já importados e NÃO escreve nada. */
    public preview = async (
        input: Pick<ImportarExtratoInput, 'buffer' | 'arquivoNome' | 'filCod'>,
    ): Promise<ImportarExtratoPreview> => {
        const { cabecalho, totalLinhas, creditos, totalIgnorados } = await this.parseECreditos(
            input.buffer,
        );

        const transacoes = this.montarTransacoes(creditos, {
            filCod: input.filCod,
            agencia: cabecalho.agencia,
            conta: cabecalho.conta,
            arquivoNome: input.arquivoNome,
            runId: 'preview',
            importadoEm: new Date(),
        });

        const existentes = await this.transacaoRepo.existingNaturalKeys(
            transacoes.map((t) => t.naturalKey),
        );
        const jaImportadoArquivo =
            (await this.runRepo.findRunIdByIdempotencyKey(this.hash(input.buffer))) !== null;

        const novos = transacoes.filter((t) => !existentes.has(t.naturalKey)).length;
        const amostra: PreviewLinha[] = creditos.slice(0, PREVIEW_AMOSTRA_MAX).map((l, i) => ({
            linhaIndice: l.linhaIndice,
            data: l.data.toISOString(),
            descricao: l.descricao,
            contraparteNome: l.contraparteNome ?? null,
            contraparteDoc: l.contraparteDoc ?? null,
            valor: l.valor,
            novo: !existentes.has(transacoes[i]?.naturalKey ?? ''),
        }));

        return {
            cabecalho: {
                banco: cabecalho.banco,
                ...(cabecalho.agencia !== undefined ? { agencia: cabecalho.agencia } : {}),
                ...(cabecalho.conta !== undefined ? { conta: cabecalho.conta } : {}),
                ...(cabecalho.periodoDe ? { periodoDe: cabecalho.periodoDe.toISOString() } : {}),
                ...(cabecalho.periodoAte ? { periodoAte: cabecalho.periodoAte.toISOString() } : {}),
            },
            totalLinhas,
            totalCreditos: creditos.length,
            totalIgnorados,
            novos,
            jaImportados: creditos.length - novos,
            jaImportadoArquivo,
            amostra,
        };
    };

    /**
     * Importa efetivamente. Idempotência de arquivo (mesmo hash → run anterior) ANTES do lock;
     * dedup por `naturalKey` no upsert. Uma segunda importação concorrente recebe **409**
     * (`IngestLockBusyError`) — o MESMO lock do canal automático.
     */
    public importar = async (input: ImportarExtratoInput): Promise<ImportarExtratoResult> => {
        const key = input.idempotencyKey ?? this.hash(input.buffer, input.excluirLinhas);
        const existente = await this.runRepo.findRunIdByIdempotencyKey(key);
        if (existente) {
            return {
                runId: existente,
                reaproveitada: true,
                totalCreditos: 0,
                inseridas: 0,
                deduplicadas: 0,
            };
        }

        return this.db.withAdvisoryLock(
            this.advisoryLockKey,
            () => this.executar(input, key),
            async () => {
                throw new IngestLockBusyError(
                    'recebimento ingest advisory lock busy — importação de extrato em andamento',
                );
            },
        );
    };

    private executar = async (
        input: ImportarExtratoInput,
        idempotencyKey: string,
    ): Promise<ImportarExtratoResult> => {
        const { cabecalho, creditos } = await this.parseECreditos(input.buffer);
        const periodo = this.resolverPeriodo(cabecalho.periodoDe, cabecalho.periodoAte, creditos);

        const runId = await this.runRepo.createRun({
            correlationId: randomUUID(),
            triggeredBy: input.triggeredBy,
            filCods: [input.filCod],
            periodoDe: periodo.de,
            periodoAte: periodo.ate,
        });

        try {
            const transacoes = this.montarTransacoes(
                creditos,
                {
                    filCod: input.filCod,
                    agencia: cabecalho.agencia,
                    conta: cabecalho.conta,
                    arquivoNome: input.arquivoNome,
                    runId,
                    importadoEm: new Date(),
                },
                input.excluirLinhas && input.excluirLinhas.length > 0
                    ? new Set(input.excluirLinhas)
                    : undefined,
            );

            const r = await this.transacaoRepo.upsertMany(transacoes, runId);
            await this.runRepo.finishRun({
                runId,
                status: 'success',
                totalLidas: creditos.length,
                totalInseridas: r.inseridas,
                totalDeduplicadas: r.deduplicadas,
                totalContas: 1,
                totalContasFalhas: 0,
            });
            await this.runRepo.recordIdempotencyKey(idempotencyKey, runId);

            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: `[RECEBIMENTOS] upload extrato ${runId}: ${creditos.length} créditos, ${r.inseridas} novos, ${r.deduplicadas} já conhecidos (filial ${input.filCod})`,
                data: {
                    runId,
                    filCod: input.filCod,
                    arquivo: input.arquivoNome,
                    totalCreditos: creditos.length,
                    inseridas: r.inseridas,
                    deduplicadas: r.deduplicadas,
                },
            });

            return {
                runId,
                reaproveitada: false,
                totalCreditos: creditos.length,
                inseridas: r.inseridas,
                deduplicadas: r.deduplicadas,
            };
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

    /** Parseia o arquivo e separa os créditos (`valor > 0`) do resto (débitos ignorados). */
    private parseECreditos = async (buffer: Buffer) => {
        const { cabecalho, linhas } = await this.parser.parse(buffer);
        const creditos = linhas.filter((l) => l.valor > 0);
        return {
            cabecalho,
            totalLinhas: linhas.length,
            creditos,
            totalIgnorados: linhas.length - creditos.length,
        };
    };

    /**
     * Constrói as `TransacaoBancaria` com o ordinal de OCORRÊNCIA por tupla, na ordem do arquivo.
     * Dois créditos idênticos no mesmo dia viram ocorrências 1 e 2 (chaves distintas → ambos
     * gravados); um re-upload regenera as mesmas ocorrências (dedup).
     *
     * A ocorrência é calculada sobre TODOS os `creditos` (mesmo os excluídos pelo analista) —
     * excluir uma linha nunca pode deslocar a ocorrência (e portanto a `naturalKey`) das linhas
     * remanescentes, ou uma seleção parcial deixaria de casar (`ON CONFLICT`) com uma importação
     * anterior/futura da mesma linha.
     */
    private montarTransacoes = (
        creditos: LinhaExtratoArquivo[],
        ctx: {
            filCod: number;
            agencia?: string;
            conta?: string;
            arquivoNome: string;
            runId: string;
            importadoEm: Date;
        },
        excluirLinhas?: Set<number>,
    ): TransacaoBancaria[] => {
        const contadores = new Map<string, number>();
        const transacoes: TransacaoBancaria[] = [];
        for (const linha of creditos) {
            const gk = groupKeyXlsx({
                filCod: ctx.filCod,
                agencia: ctx.agencia,
                conta: ctx.conta,
                data: linha.data,
                valor: linha.valor,
                descricao: linha.descricao,
                contraparteDoc: linha.contraparteDoc,
                contraparteNome: linha.contraparteNome,
            });
            const ocorrencia = (contadores.get(gk) ?? 0) + 1;
            contadores.set(gk, ocorrencia);
            if (excluirLinhas?.has(linha.linhaIndice)) continue;
            transacoes.push(normalizarLinhaXlsx(linha, ctx, ocorrencia));
        }
        return transacoes;
    };

    /** Período da run: o do cabeçalho quando presente; senão o min/max das datas dos créditos. */
    private resolverPeriodo = (
        periodoDe: Date | undefined,
        periodoAte: Date | undefined,
        creditos: LinhaExtratoArquivo[],
    ): { de: Date; ate: Date } => {
        if (periodoDe && periodoAte) return { de: periodoDe, ate: periodoAte };
        if (creditos.length === 0) {
            const agora = new Date();
            return { de: periodoDe ?? agora, ate: periodoAte ?? agora };
        }
        const tempos = creditos.map((l) => l.data.getTime());
        return {
            de: periodoDe ?? new Date(Math.min(...tempos)),
            ate: periodoAte ?? new Date(Math.max(...tempos)),
        };
    };

    /**
     * Hash do arquivo + seleção. A seleção entra na chave (ordenada, para não depender da ordem de
     * cliques) porque a MESMA planilha com exclusões diferentes é um pedido de importação diferente
     * — sem isso, reenviar o arquivo com outra seleção seria tratado como reaproveitamento da run
     * anterior e nada seria escrito.
     */
    private hash = (buffer: Buffer, excluirLinhas?: number[]): string => {
        const selecao = [...(excluirLinhas ?? [])].sort((a, b) => a - b).join(',');
        return createHash('sha256').update(buffer).update(`|excl=${selecao}`).digest('hex');
    };
}
