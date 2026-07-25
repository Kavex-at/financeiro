import { injectable } from 'tsyringe';
import type {
    ExternalCallOptions,
    NexxeraFetchPeriod,
    NexxeraGatewayInterface,
    RawMovimento,
} from '../../../interface/recebimentos/ports.js';

/**
 * SKELETON stub — NexxeraGatewayInterface. Deterministic, no network (channel chosen after O7).
 * Returns an empty extract; Módulo 1 swaps this token for the real API/SFTP adapter.
 */
@injectable()
export default class NexxeraGatewayStub implements NexxeraGatewayInterface {
    public fetch = async (
        _period: NexxeraFetchPeriod,
        _opts?: ExternalCallOptions,
    ): Promise<RawMovimento[]> => {
        return [];
    };
}
