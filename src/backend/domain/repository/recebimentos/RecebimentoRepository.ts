import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { TransactionClient } from '../../client/database/PostgreeDatabaseClient.js';
import {
    MATCH_CLASSIFICACAO,
    RECEBIMENTO_STATUS,
    REGRA_TIPO,
} from '../../interface/recebimentos/constants.js';
import type {
    MatchClassificacao,
    RecebimentoStatus,
    RegraTipo,
} from '../../interface/recebimentos/constants.js';
import type { RateioRecebimento } from '../../interface/recebimentos/RateioRecebimento.js';
import type { Recebimento } from '../../interface/recebimentos/Recebimento.js';
import { RecebimentoVersionConflictError } from '../../interface/recebimentos/recebimentoTransitions.js';
import type { RegraRecebimento } from '../../interface/recebimentos/RegraRecebimento.js';
import {
    computeDiferencaNaoAlocada,
    computeValorAlocado,
} from '../../interface/recebimentos/recebimentoTransitions.js';
import type { RecebimentoRepositoryInterface } from '../../interface/recebimentos/ports.js';

/**
 * RecebimentoRepository — a SPINE persistida (0033) + os membros do agregado. `save` grava a raiz, os
 * `rateios` (0034) e as `regrasAplicadas` (0039) NA MESMA TRANSAÇÃO (Regis modifiability-1) e bumpa
 * `versao`; `findById` reidrata o agregado completo. Concorrência otimista (Regis fault-tolerance-3):
 * com `expectedVersao`, o UPDATE é guardado por `WHERE versao = expectedVersao` e a escrita perdida
 * lança `RecebimentoVersionConflictError` (409) em vez de sobrescrever silenciosamente. SQL 100%
 * parametrizado (Rule #5); `mapRow*` privados.
 */
@injectable()
export default class RecebimentoRepository implements RecebimentoRepositoryInterface {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    public save = async (
        recebimento: Recebimento,
        expectedVersao?: number,
    ): Promise<Recebimento> => {
        const nextVersao = (expectedVersao ?? recebimento.versao) + 1;
        return this.databaseClient.withTransaction(async (tx) => {
            const saved = await this.saveRoot(tx, recebimento, expectedVersao, nextVersao);
            await this.saveRateios(tx, recebimento);
            await this.saveRegrasAplicadas(tx, recebimento);
            return saved;
        });
    };

    private saveRoot = async (
        tx: TransactionClient,
        recebimento: Recebimento,
        expectedVersao: number | undefined,
        nextVersao: number,
    ): Promise<Recebimento> => {
        const params = {
            id: recebimento.id,
            correlationId: recebimento.correlationId,
            transacaoId: recebimento.transacaoBancariaId,
            filCod: recebimento.filCod,
            classificacaoMatch: recebimento.classificacaoMatch,
            status: recebimento.status,
            valorRecebido: recebimento.valorRecebido,
            resultadoExecucao: JSON.stringify(recebimento.resultadoExecucao ?? null),
            ndeId: recebimento.ndeId ?? null,
            versao: nextVersao,
            criadoPor: recebimento.criadoPor,
            aprovadoPor: recebimento.aprovadoPor ?? null,
            executadoPor: recebimento.executadoPor ?? null,
            estornadoPor: recebimento.estornadoPor ?? null,
            criadoEm: recebimento.criadoEm,
            expectedVersao: expectedVersao ?? null,
        };

        // Sem expectedVersao → upsert simples (semeadura/primeira gravação). Com expectedVersao → o
        // UPDATE só aplica se a versão bater; 0 linhas afetadas num conflito de id existente = escrita
        // perdida → 409 (nunca sobrescreve silenciosamente).
        const rows = await tx.selectMany(
            `INSERT INTO recebimento (
                id, correlation_id, transacao_id, fil_cod, classificacao_match, status,
                valor_recebido, resultado_execucao, nde_id, versao,
                criado_por, aprovado_por, executado_por, estornado_por, criado_em
            ) VALUES (
                $id, $correlationId, $transacaoId, $filCod, $classificacaoMatch, $status,
                $valorRecebido, $resultadoExecucao::jsonb, $ndeId, $versao,
                $criadoPor, $aprovadoPor, $executadoPor, $estornadoPor, $criadoEm
            )
            ON CONFLICT (id) DO UPDATE SET
                classificacao_match = EXCLUDED.classificacao_match,
                status = EXCLUDED.status,
                resultado_execucao = EXCLUDED.resultado_execucao,
                nde_id = EXCLUDED.nde_id,
                versao = EXCLUDED.versao,
                aprovado_por = EXCLUDED.aprovado_por,
                executado_por = EXCLUDED.executado_por,
                estornado_por = EXCLUDED.estornado_por
            WHERE $expectedVersao::int IS NULL OR recebimento.versao = $expectedVersao::int
            RETURNING versao`,
            params,
        );

        if (expectedVersao !== undefined && rows.length === 0) {
            throw new RecebimentoVersionConflictError(
                `Recebimento ${recebimento.id} version conflict: expected ${expectedVersao}`,
                'Este recebimento foi alterado por outro processo. Recarregue e tente novamente.',
            );
        }

        return { ...recebimento, versao: nextVersao };
    };

    private saveRateios = async (
        tx: TransactionClient,
        recebimento: Recebimento,
    ): Promise<void> => {
        // Reescreve o conjunto de parcelas do recebimento (agregado): remove as antigas e insere as
        // atuais, tudo na mesma transação (Regis modifiability-1 — sem perder o rateio no reload).
        await tx.update(`DELETE FROM rateio_recebimento WHERE recebimento_id = $recebimentoId`, {
            recebimentoId: recebimento.id,
        });
        for (const rateio of recebimento.rateios) {
            await tx.insert(
                `INSERT INTO rateio_recebimento (
                    id, recebimento_id, doc_cod, tit_cod, fil_cod, pri_cod, componente,
                    finalidade, valor_alocado, moeda, incluido_por
                ) VALUES (
                    $id, $recebimentoId, $docCod, $titCod, $filCod, $priCod, $componente,
                    $finalidade, $valorAlocado, $moeda, $incluidoPor
                )`,
                {
                    id: rateio.id,
                    recebimentoId: recebimento.id,
                    docCod: rateio.documentoDocCod,
                    titCod: rateio.documentoTitCod,
                    filCod: rateio.filCod,
                    priCod: rateio.priCod ?? null,
                    componente: rateio.componente ?? null,
                    finalidade: rateio.finalidade,
                    valorAlocado: rateio.valorAlocado,
                    moeda: rateio.moeda,
                    incluidoPor: rateio.incluidoPor,
                },
            );
        }
    };

    private saveRegrasAplicadas = async (
        tx: TransactionClient,
        recebimento: Recebimento,
    ): Promise<void> => {
        await tx.update(
            `DELETE FROM recebimento_regra_aplicada WHERE recebimento_id = $recebimentoId`,
            { recebimentoId: recebimento.id },
        );
        for (const regra of recebimento.regrasAplicadas) {
            await tx.insert(
                `INSERT INTO recebimento_regra_aplicada (
                    recebimento_id, regra_id, tipo, versao, vigente_de, vigente_ate,
                    parametros, explicacao, ativo
                ) VALUES (
                    $recebimentoId, $regraId, $tipo, $versao, $vigenteDe, $vigenteAte,
                    $parametros::jsonb, $explicacao, $ativo
                )`,
                {
                    recebimentoId: recebimento.id,
                    regraId: regra.id,
                    tipo: regra.tipo,
                    versao: regra.versao,
                    vigenteDe: regra.vigenteDe,
                    vigenteAte: regra.vigenteAte ?? null,
                    parametros: JSON.stringify(regra.parametros ?? {}),
                    explicacao: regra.explicacao,
                    ativo: regra.ativo,
                },
            );
        }
    };

    public findById = async (id: string): Promise<Recebimento | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT id, correlation_id, transacao_id, fil_cod, classificacao_match, status,
                    valor_recebido, resultado_execucao, nde_id, versao,
                    criado_por, aprovado_por, executado_por, estornado_por, criado_em
             FROM recebimento
             WHERE id = $id`,
            { id },
        );
        if (!row) return null;

        const rateioRows = await this.databaseClient.selectMany(
            `SELECT id, recebimento_id, doc_cod, tit_cod, fil_cod, pri_cod, componente,
                    finalidade, valor_alocado, moeda, incluido_por
             FROM rateio_recebimento
             WHERE recebimento_id = $id
             ORDER BY id`,
            { id },
        );
        const regraRows = await this.databaseClient.selectMany(
            `SELECT regra_id, tipo, versao, vigente_de, vigente_ate, parametros, explicacao, ativo
             FROM recebimento_regra_aplicada
             WHERE recebimento_id = $id
             ORDER BY regra_id`,
            { id },
        );

        const rateios = rateioRows.map((r) => this.mapRateioRow(r));
        const regrasAplicadas = regraRows.map((r) => this.mapRegraRow(r));
        return this.mapRow(row, rateios, regrasAplicadas);
    };

    private mapRow = (
        r: Record<string, unknown>,
        rateios: RateioRecebimento[],
        regrasAplicadas: RegraRecebimento[],
    ): Recebimento => {
        const base: Recebimento = {
            id: String(r.id),
            correlationId: String(r.correlation_id),
            transacaoBancariaId: String(r.transacao_id),
            filCod: Number(r.fil_cod),
            classificacaoMatch:
                (r.classificacao_match as MatchClassificacao) ?? MATCH_CLASSIFICACAO.NENHUMA,
            status: (r.status as RecebimentoStatus) ?? RECEBIMENTO_STATUS.RASCUNHO,
            valorRecebido: Number(r.valor_recebido),
            valorAlocado: 0,
            diferencaNaoAlocada: Number(r.valor_recebido),
            regrasAplicadas,
            rateios,
            ...(r.resultado_execucao != null ? { resultadoExecucao: r.resultado_execucao } : {}),
            ...(r.nde_id != null ? { ndeId: String(r.nde_id) } : {}),
            versao: Number(r.versao),
            criadoPor: String(r.criado_por),
            ...(r.aprovado_por != null ? { aprovadoPor: String(r.aprovado_por) } : {}),
            ...(r.executado_por != null ? { executadoPor: String(r.executado_por) } : {}),
            ...(r.estornado_por != null ? { estornadoPor: String(r.estornado_por) } : {}),
            criadoEm: new Date(r.criado_em as string | Date),
        };
        // Derivados recompostos a partir do agregado carregado (Fase 3).
        base.valorAlocado = computeValorAlocado(rateios);
        base.diferencaNaoAlocada = computeDiferencaNaoAlocada(base);
        return base;
    };

    private mapRateioRow = (r: Record<string, unknown>): RateioRecebimento => ({
        id: String(r.id),
        recebimentoId: String(r.recebimento_id),
        documentoDocCod: String(r.doc_cod),
        documentoTitCod: String(r.tit_cod),
        filCod: Number(r.fil_cod),
        ...(r.pri_cod != null ? { priCod: String(r.pri_cod) } : {}),
        ...(r.componente != null
            ? { componente: r.componente as RateioRecebimento['componente'] }
            : {}),
        finalidade: String(r.finalidade),
        valorAlocado: Number(r.valor_alocado),
        moeda: String(r.moeda),
        incluidoPor: String(r.incluido_por),
    });

    private mapRegraRow = (r: Record<string, unknown>): RegraRecebimento => ({
        id: String(r.regra_id),
        tipo: (r.tipo as RegraTipo) ?? REGRA_TIPO.ENCOMENDA,
        versao: Number(r.versao),
        vigenteDe: new Date(r.vigente_de as string | Date),
        ...(r.vigente_ate != null ? { vigenteAte: new Date(r.vigente_ate as string | Date) } : {}),
        parametros: (r.parametros as Record<string, unknown>) ?? {},
        explicacao: String(r.explicacao),
        ativo: Boolean(r.ativo),
    });
}
