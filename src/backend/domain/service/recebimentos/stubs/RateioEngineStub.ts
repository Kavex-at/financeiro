import { injectable } from 'tsyringe';
import type { RateioRecebimento } from '../../../interface/recebimentos/RateioRecebimento.js';
import type { Recebimento } from '../../../interface/recebimentos/Recebimento.js';
import type { RateioEngineInterface } from '../../../interface/recebimentos/ports.js';

/**
 * SKELETON stub — RateioEngineInterface. Deterministic, no logic. Echoes the existing rateios of the
 * `Recebimento` unchanged (empty on a fresh spine). Módulo 3 swaps this token for the real engine.
 */
@injectable()
export default class RateioEngineStub implements RateioEngineInterface {
    public ratear = async (recebimento: Recebimento): Promise<RateioRecebimento[]> => {
        return recebimento.rateios;
    };
}
