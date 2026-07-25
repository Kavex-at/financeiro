import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import {
    TRANSACAO_BANCARIA_STATUS,
    TRANSACAO_TIPO,
} from '../../interface/recebimentos/constants.js';
import type {
    TransacaoBancariaStatus,
    TransacaoTipo,
} from '../../interface/recebimentos/constants.js';
import type { TransacaoBancaria } from '../../interface/recebimentos/TransacaoBancaria.js';
import type { TransacaoRepositoryInterface } from '../../interface/recebimentos/ports.js';

/**
 * TransacaoRepository — CRUD fino sobre `transacao_bancaria` (0032). SQL 100% parametrizado
 * (Rule #5); `mapRow` privado. Sem lógica de negócio (Módulo 1 preenche na Fase 1).
 */
@injectable()
export default class TransacaoRepository implements TransacaoRepositoryInterface {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    public save = async (transacao: TransacaoBancaria): Promise<TransacaoBancaria> => {
        await this.databaseClient.update(
            `INSERT INTO transacao_bancaria (
                id, correlation_id, fil_cod, data_movimento, tipo, valor, moeda,
                contraparte, referencia_bancaria, natural_key, raw_payload, normalized,
                status, import_run_id, importado_em
            ) VALUES (
                $id, $correlationId, $filCod, $dataMovimento, $tipo, $valor, $moeda,
                $contraparte, $referenciaBancaria, $naturalKey, $rawPayload::jsonb, $normalized::jsonb,
                $status, $importRunId, $importadoEm
            )
            ON CONFLICT (natural_key) DO UPDATE SET
                status = EXCLUDED.status,
                normalized = EXCLUDED.normalized`,
            {
                id: transacao.id,
                correlationId: transacao.correlationId,
                filCod: transacao.filCod,
                dataMovimento: transacao.dataMovimento,
                tipo: transacao.tipo,
                valor: transacao.valor,
                moeda: transacao.moeda,
                contraparte: transacao.contraparte ?? null,
                referenciaBancaria: transacao.referenciaBancaria ?? null,
                naturalKey: transacao.naturalKey,
                rawPayload: JSON.stringify(transacao.rawPayload ?? null),
                normalized: JSON.stringify(transacao.normalized ?? null),
                status: transacao.status,
                importRunId: transacao.importRunId ?? null,
                importadoEm: transacao.importadoEm,
            },
        );
        return transacao;
    };

    public findById = async (id: string): Promise<TransacaoBancaria | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT id, correlation_id, fil_cod, data_movimento, tipo, valor, moeda,
                    contraparte, referencia_bancaria, natural_key, raw_payload, normalized,
                    status, import_run_id, importado_em
             FROM transacao_bancaria
             WHERE id = $id`,
            { id },
        );
        return row ? this.mapRow(row) : null;
    };

    private mapRow = (r: Record<string, unknown>): TransacaoBancaria => ({
        id: String(r.id),
        correlationId: String(r.correlation_id),
        filCod: Number(r.fil_cod),
        dataMovimento: new Date(r.data_movimento as string | Date),
        tipo: (r.tipo as TransacaoTipo) ?? TRANSACAO_TIPO.CREDITO,
        valor: Number(r.valor),
        moeda: String(r.moeda),
        ...(r.contraparte != null ? { contraparte: String(r.contraparte) } : {}),
        ...(r.referencia_bancaria != null
            ? { referenciaBancaria: String(r.referencia_bancaria) }
            : {}),
        naturalKey: String(r.natural_key),
        rawPayload: r.raw_payload ?? null,
        normalized: r.normalized ?? null,
        status: (r.status as TransacaoBancariaStatus) ?? TRANSACAO_BANCARIA_STATUS.IMPORTADA,
        ...(r.import_run_id != null ? { importRunId: String(r.import_run_id) } : {}),
        importadoEm: new Date(r.importado_em as string | Date),
    });
}
