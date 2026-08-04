import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import { NDE_STATUS_EMISSAO } from '../../interface/recebimentos/constants.js';
import type { NdeStatusEmissao } from '../../interface/recebimentos/constants.js';
import type { NotaDebitoEletronica } from '../../interface/recebimentos/NotaDebitoEletronica.js';
import type { NdeRepositoryInterface } from '../../interface/recebimentos/ports.js';

/**
 * NdeRepository — CRUD fino sobre `nota_debito_eletronica` (0038). Registro local só para
 * idempotência + auditoria (a fonte da verdade é o ERP). `idempotency_key` UNIQUE garante uma NDe por
 * Recebimento. SQL 100% parametrizado (Rule #5); `mapRow` privado. Sem lógica de negócio (Fase 5).
 */
@injectable()
export default class NdeRepository implements NdeRepositoryInterface {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    public save = async (nde: NotaDebitoEletronica): Promise<NotaDebitoEletronica> => {
        await this.databaseClient.update(
            `INSERT INTO nota_debito_eletronica (
                id, recebimento_id, fil_cod, correlation_id, numero_nde, valor, moeda,
                status_emissao, idempotency_key, erp_response, emitida_em, emitida_por
            ) VALUES (
                $id, $recebimentoId, $filCod, $correlationId, $numeroNde, $valor, $moeda,
                $statusEmissao, $idempotencyKey, $erpResponse::jsonb, $emitidaEm, $emitidaPor
            )
            ON CONFLICT (idempotency_key) DO UPDATE SET
                numero_nde = EXCLUDED.numero_nde,
                status_emissao = EXCLUDED.status_emissao,
                erp_response = EXCLUDED.erp_response,
                emitida_em = EXCLUDED.emitida_em`,
            {
                id: nde.id,
                recebimentoId: nde.recebimentoId,
                filCod: nde.filCod,
                correlationId: nde.correlationId,
                numeroNde: nde.numeroNde ?? null,
                valor: nde.valor,
                moeda: nde.moeda,
                statusEmissao: nde.statusEmissao,
                idempotencyKey: nde.idempotencyKey,
                erpResponse: JSON.stringify(nde.erpResponse ?? null),
                emitidaEm: nde.emitidaEm ?? null,
                emitidaPor: nde.emitidaPor ?? null,
            },
        );
        return nde;
    };

    public findByRecebimentoId = async (
        recebimentoId: string,
    ): Promise<NotaDebitoEletronica | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT id, recebimento_id, fil_cod, correlation_id, numero_nde, valor, moeda,
                    status_emissao, idempotency_key, erp_response, emitida_em, emitida_por
             FROM nota_debito_eletronica
             WHERE recebimento_id = $recebimentoId
             LIMIT 1`,
            { recebimentoId },
        );
        return row ? this.mapRow(row) : null;
    };

    private mapRow = (r: Record<string, unknown>): NotaDebitoEletronica => ({
        id: String(r.id),
        recebimentoId: String(r.recebimento_id),
        filCod: Number(r.fil_cod),
        correlationId: String(r.correlation_id),
        ...(r.numero_nde != null ? { numeroNde: String(r.numero_nde) } : {}),
        valor: Number(r.valor),
        moeda: String(r.moeda),
        statusEmissao: (r.status_emissao as NdeStatusEmissao) ?? NDE_STATUS_EMISSAO.PENDENTE,
        idempotencyKey: String(r.idempotency_key),
        ...(r.erp_response != null ? { erpResponse: r.erp_response } : {}),
        ...(r.emitida_em != null ? { emitidaEm: new Date(r.emitida_em as string | Date) } : {}),
        ...(r.emitida_por != null ? { emitidaPor: String(r.emitida_por) } : {}),
    });
}
