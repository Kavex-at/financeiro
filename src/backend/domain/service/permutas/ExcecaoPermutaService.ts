import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import ExcecaoPermutaRecusadaError from '../../errors/ExcecaoPermutaRecusadaError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    ESTADO_ELEGIBILIDADE,
    MOTIVO_BLOQUEIO,
} from '../../interface/permutas/EstadoElegibilidade.js';
import type { AvisoExcecaoInaplicavel } from '../../interface/permutas/ExcecaoPermuta.js';
import type PermutaCandidata from '../../interface/permutas/PermutaCandidata.js';
import ExcecaoPermutaRepository from '../../repository/permutas/ExcecaoPermutaRepository.js';
import PermutaRelationalRepository from '../../repository/permutas/PermutaRelationalRepository.js';
import LogService from '../LogService.js';

/**
 * O ÚNICO estado calculado sobre o qual a exceção pode ser criada e aplicada (guarda I-Exc-1),
 * e o estado que ela produz (T7). Fonte única: a guarda, o pós-passe da eleição e a
 * reclassificação imediata de marcar/desfazer leem daqui.
 */
const ESTADO_DA_GUARDA = {
    estado: ESTADO_ELEGIBILIDADE.BLOQUEADA,
    motivo: MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR,
} as const;

const ESTADO_DA_EXCECAO = {
    estado: ESTADO_ELEGIBILIDADE.JA_PERMUTADO,
    motivo: MOTIVO_BLOQUEIO.PERMUTADO_FORA_DO_PAINEL,
} as const;

/** Código SQLSTATE de violação de unicidade (índice parcial `uq_permuta_excecao_manual_ativa`). */
const UNIQUE_VIOLATION = '23505';

/** Entrada de `marcar` — o autor vem do JWT verificado, resolvido na rota. */
export interface MarcarExcecaoInput {
    docCod: string;
    justificativa: string;
    criadoPor: string;
}

/** Entrada de `desfazer` — o autor da remoção vem do JWT verificado. */
export interface DesfazerExcecaoInput {
    docCod: string;
    removidoPor: string;
}

/**
 * ExcecaoPermutaService — exceção manual "permutado fora do painel" (ADR-0047).
 *
 * Duas responsabilidades, com UM predicado de guarda compartilhado:
 *   - `aplicarExcecoes` (puro): pós-passe da eleição. Com exceção ativa E estado calculado
 *     `BLOQUEADA / sem-saldo-permutar`, a candidata vira `JA_PERMUTADO /
 *     permutado-fora-do-painel` (T7). Qualquer outro resultado vence e vira aviso (I-Exc-2).
 *   - marcar/desfazer: gravação transacional da exceção + efeito imediato na linha do adto.
 *
 * Nenhuma escrita no Conexos (I4 / I-Exc-5): não há cliente Conexos injetado.
 * Ontology: `entities/excecao-permuta.md`, state-machine `elegibilidade-permuta-candidata`.
 */
@injectable()
export default class ExcecaoPermutaService {
    constructor(
        @inject(PostgreeDatabaseClient) private databaseClient: PostgreeDatabaseClient,
        @inject(PermutaRelationalRepository)
        private relationalRepository: PermutaRelationalRepository,
        @inject(ExcecaoPermutaRepository) private excecaoRepository: ExcecaoPermutaRepository,
        @inject(LogService) private logService: LogService,
    ) {}

    /**
     * Guarda I-Exc-1 — o ÚNICO predicado que decide se uma exceção pode ser criada (sobre o
     * estado gravado) e aplicada (sobre o estado recalculado na run).
     */
    public guardaSatisfeita = (estado: string, motivo?: string): boolean =>
        estado === ESTADO_DA_GUARDA.estado && motivo === ESTADO_DA_GUARDA.motivo;

    /**
     * Aplica as exceções ativas sobre as candidatas de uma run. Puro: não muta a entrada e
     * devolve a MESMA referência para toda candidata que não muda. `gatesAvaliados` segue
     * intacto — a auditoria dos gates continua dizendo que o Gate 2 reprovou.
     * Exceção de `docCod` sem candidata na run é ignorada (o adto saiu do backlog).
     */
    public aplicarExcecoes = (
        candidatas: PermutaCandidata[],
        docCodsComExcecao: ReadonlySet<string>,
    ): { candidatas: PermutaCandidata[]; avisos: AvisoExcecaoInaplicavel[] } => {
        const avisos: AvisoExcecaoInaplicavel[] = [];
        const resultado = candidatas.map((candidata) => {
            const docCod = candidata.adiantamento.docCod;
            if (!docCodsComExcecao.has(docCod)) return candidata;
            if (this.guardaSatisfeita(candidata.estadoElegibilidade, candidata.motivoBloqueio)) {
                return {
                    ...candidata,
                    estadoElegibilidade: ESTADO_DA_EXCECAO.estado,
                    motivoBloqueio: ESTADO_DA_EXCECAO.motivo,
                };
            }
            avisos.push({
                docCod,
                estadoCalculado: candidata.estadoElegibilidade,
                ...(candidata.motivoBloqueio !== undefined
                    ? { motivoCalculado: candidata.motivoBloqueio }
                    : {}),
                transiente: candidata.motivoBloqueio === MOTIVO_BLOQUEIO.DETAIL_INDISPONIVEL,
            });
            return candidata;
        });
        return { candidatas: resultado, avisos };
    };

    /**
     * Marca o adto como "permutado fora do painel". Valida, FORA da transação, que o adto
     * existe no backlog (404), que o estado gravado satisfaz a guarda (422) e que não há
     * exceção ativa (409). Na transação: grava a exceção e reclassifica a linha de
     * `bloqueada/sem-saldo-permutar` para `ja-permutado/permutado-fora-do-painel`, para a
     * tela mudar no "Atualizar" sem esperar a ingestão. Se a linha mudou no meio (0 linhas),
     * lança dentro da transação: nada fica gravado, nem a exceção.
     */
    public marcar = async (input: MarcarExcecaoInput): Promise<void> => {
        const { docCod, justificativa, criadoPor } = input;
        const adto = await this.relationalRepository.findAdiantamento(docCod);
        if (adto === null || adto.stale) {
            throw new ExcecaoPermutaRecusadaError({ tipo: 'adiantamento-nao-encontrado', docCod });
        }
        if (!this.guardaSatisfeita(adto.estadoElegibilidade, adto.motivoBloqueio)) {
            throw new ExcecaoPermutaRecusadaError({
                tipo: 'guarda',
                docCod,
                estado: adto.estadoElegibilidade,
                ...(adto.motivoBloqueio !== undefined ? { motivo: adto.motivoBloqueio } : {}),
            });
        }
        if ((await this.excecaoRepository.findAtiva(docCod)) !== null) {
            throw new ExcecaoPermutaRecusadaError({ tipo: 'ja-ativa', docCod });
        }

        try {
            await this.databaseClient.withTransaction(async (tx) => {
                await this.excecaoRepository.insertAtiva(tx, {
                    adiantamentoDocCod: docCod,
                    justificativa,
                    criadoPor,
                });
                const reclassificadas = await this.relationalRepository.reclassificarAdiantamento(
                    tx,
                    { docCod, de: ESTADO_DA_GUARDA, para: ESTADO_DA_EXCECAO },
                );
                if (reclassificadas === 0) {
                    throw new ExcecaoPermutaRecusadaError({ tipo: 'concorrencia', docCod });
                }
            });
        } catch (error) {
            // Corrida entre dois analistas: o índice parcial barra a segunda exceção ativa.
            if (this.isUniqueViolation(error)) {
                throw new ExcecaoPermutaRecusadaError({ tipo: 'ja-ativa', docCod });
            }
            throw error;
        }

        // Auditoria: quem e qual adto. A justificativa fica no banco, não no log.
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'exceção manual de permuta registrada (permutado fora do painel)',
            data: { docCod, criadoPor },
        });
    };

    /**
     * Desfaz a exceção ativa (soft delete com autor e data) e, na MESMA transação, devolve a
     * linha a `bloqueada/sem-saldo-permutar` — só se ela estiver com o motivo da exceção.
     * Exceção inativa (linha em outro estado porque o ERP venceu) só perde a marca: 0 linhas
     * reclassificadas não é erro. Sem exceção ativa → 404.
     */
    public desfazer = async (input: DesfazerExcecaoInput): Promise<void> => {
        const { docCod, removidoPor } = input;
        await this.databaseClient.withTransaction(async (tx) => {
            const removidas = await this.excecaoRepository.softDeleteAtiva(tx, {
                adiantamentoDocCod: docCod,
                removidoPor,
            });
            if (removidas === 0) {
                throw new ExcecaoPermutaRecusadaError({ tipo: 'excecao-nao-encontrada', docCod });
            }
            await this.relationalRepository.reclassificarAdiantamento(tx, {
                docCod,
                de: ESTADO_DA_EXCECAO,
                para: ESTADO_DA_GUARDA,
            });
        });

        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'exceção manual de permuta desfeita',
            data: { docCod, removidoPor },
        });
    };

    private isUniqueViolation = (error: unknown): boolean =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === UNIQUE_VIOLATION;
}
