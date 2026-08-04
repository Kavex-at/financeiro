import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import { REGRA_TIPO } from '../../interface/recebimentos/constants.js';
import type { RegraTipo } from '../../interface/recebimentos/constants.js';
import type { RegraRecebimento } from '../../interface/recebimentos/RegraRecebimento.js';
import type { RegraRecebimentoRepositoryInterface } from '../../interface/recebimentos/ports.js';

/**
 * RegraRecebimentoRepository — CRUD fino sobre `regra_recebimento` (0037). SQL 100% parametrizado
 * (Rule #5); `mapRow` privado. Sem lógica de negócio (Módulo 4 preenche na Fase 4).
 */
@injectable()
export default class RegraRecebimentoRepository implements RegraRecebimentoRepositoryInterface {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    public save = async (regra: RegraRecebimento): Promise<RegraRecebimento> => {
        await this.databaseClient.update(
            `INSERT INTO regra_recebimento (
                id, tipo, versao, vigente_de, vigente_ate, parametros, explicacao, ativo
            ) VALUES (
                $id, $tipo, $versao, $vigenteDe, $vigenteAte, $parametros::jsonb, $explicacao, $ativo
            )
            ON CONFLICT (tipo, versao) DO UPDATE SET
                vigente_ate = EXCLUDED.vigente_ate,
                parametros = EXCLUDED.parametros,
                explicacao = EXCLUDED.explicacao,
                ativo = EXCLUDED.ativo`,
            {
                id: regra.id,
                tipo: regra.tipo,
                versao: regra.versao,
                vigenteDe: regra.vigenteDe,
                vigenteAte: regra.vigenteAte ?? null,
                parametros: JSON.stringify(regra.parametros ?? {}),
                explicacao: regra.explicacao,
                ativo: regra.ativo,
            },
        );
        return regra;
    };

    public listAtivas = async (): Promise<RegraRecebimento[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT id, tipo, versao, vigente_de, vigente_ate, parametros, explicacao, ativo
             FROM regra_recebimento
             WHERE ativo = true
             ORDER BY tipo, versao DESC`,
        );
        return rows.map((r) => this.mapRow(r));
    };

    private mapRow = (r: Record<string, unknown>): RegraRecebimento => ({
        id: String(r.id),
        tipo: (r.tipo as RegraTipo) ?? REGRA_TIPO.ENCOMENDA,
        versao: Number(r.versao),
        vigenteDe: new Date(r.vigente_de as string | Date),
        ...(r.vigente_ate != null ? { vigenteAte: new Date(r.vigente_ate as string | Date) } : {}),
        parametros: (r.parametros as Record<string, unknown>) ?? {},
        explicacao: String(r.explicacao),
        ativo: Boolean(r.ativo),
    });
}
