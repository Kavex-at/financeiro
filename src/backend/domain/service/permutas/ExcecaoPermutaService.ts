import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
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
        estado === ESTADO_ELEGIBILIDADE.BLOQUEADA && motivo === MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR;

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
                    estadoElegibilidade: ESTADO_ELEGIBILIDADE.JA_PERMUTADO,
                    motivoBloqueio: MOTIVO_BLOQUEIO.PERMUTADO_FORA_DO_PAINEL,
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
}
