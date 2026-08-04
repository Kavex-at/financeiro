import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import { CREDITO_CLIENTE_STATUS } from '../../interface/recebimentos/constants.js';
import type { CreditoClienteStatus } from '../../interface/recebimentos/constants.js';
import type { CreditoCliente } from '../../interface/recebimentos/CreditoCliente.js';
import type { CreditoClienteRepositoryInterface } from '../../interface/recebimentos/ports.js';

/**
 * CreditoClienteRepository — CRUD fino sobre `credito_cliente` (0036). SQL 100% parametrizado
 * (Rule #5); `mapRow` privado. Sem lógica de negócio (Módulo 4 preenche na Fase 4).
 */
@injectable()
export default class CreditoClienteRepository implements CreditoClienteRepositoryInterface {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    public save = async (credito: CreditoCliente): Promise<CreditoCliente> => {
        await this.databaseClient.update(
            `INSERT INTO credito_cliente (
                id, fil_cod, cliente, pes_cod, valor_original, valor_disponivel, moeda,
                origem_recebimento_id, status, criado_em
            ) VALUES (
                $id, $filCod, $cliente, $pesCod, $valorOriginal, $valorDisponivel, $moeda,
                $origemRecebimentoId, $status, $criadoEm
            )
            ON CONFLICT (id) DO UPDATE SET
                valor_disponivel = EXCLUDED.valor_disponivel,
                status = EXCLUDED.status`,
            {
                id: credito.id,
                filCod: credito.filCod,
                cliente: credito.cliente ?? null,
                pesCod: credito.pesCod ?? null,
                valorOriginal: credito.valorOriginal,
                valorDisponivel: credito.valorDisponivel,
                moeda: credito.moeda,
                origemRecebimentoId: credito.origemRecebimentoId ?? null,
                status: credito.status,
                criadoEm: credito.criadoEm,
            },
        );
        return credito;
    };

    public findById = async (id: string): Promise<CreditoCliente | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT id, fil_cod, cliente, pes_cod, valor_original, valor_disponivel, moeda,
                    origem_recebimento_id, status, criado_em
             FROM credito_cliente
             WHERE id = $id`,
            { id },
        );
        return row ? this.mapRow(row) : null;
    };

    private mapRow = (r: Record<string, unknown>): CreditoCliente => ({
        id: String(r.id),
        filCod: Number(r.fil_cod),
        ...(r.cliente != null ? { cliente: String(r.cliente) } : {}),
        ...(r.pes_cod != null ? { pesCod: String(r.pes_cod) } : {}),
        valorOriginal: Number(r.valor_original),
        valorDisponivel: Number(r.valor_disponivel),
        moeda: String(r.moeda),
        ...(r.origem_recebimento_id != null
            ? { origemRecebimentoId: String(r.origem_recebimento_id) }
            : {}),
        status: (r.status as CreditoClienteStatus) ?? CREDITO_CLIENTE_STATUS.DISPONIVEL,
        criadoEm: new Date(r.criado_em as string | Date),
    });
}
