import { injectable } from 'tsyringe';
import { PARCELA_FINALIDADE } from '../../../interface/recebimentos/constants.js';
import type { RateioRecebimento } from '../../../interface/recebimentos/RateioRecebimento.js';
import type {
    ParcelaAjustada,
    RegrasContext,
    RegrasEngineInterface,
} from '../../../interface/recebimentos/ports.js';

/**
 * SKELETON stub — RegrasEngineInterface. Deterministic, no logic. Echoes the parcelas unchanged as
 * `PRINCIPAL` with a fixed rationale. Módulo 4 swaps this token for the real rules engine + registry.
 */
@injectable()
export default class RegrasEngineStub implements RegrasEngineInterface {
    public aplicar = async (
        parcelas: RateioRecebimento[],
        _ctx: RegrasContext,
    ): Promise<ParcelaAjustada[]> => {
        return parcelas.map((rateio) => ({
            rateio,
            componente: PARCELA_FINALIDADE.PRINCIPAL,
            rationale: 'SKELETON stub — no rule applied.',
            regraId: 'stub-regra',
        }));
    };
}
