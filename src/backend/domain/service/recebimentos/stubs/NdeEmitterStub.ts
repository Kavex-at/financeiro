import { injectable } from 'tsyringe';
import { NDE_STATUS_EMISSAO } from '../../../interface/recebimentos/constants.js';
import type { NotaDebitoEletronica } from '../../../interface/recebimentos/NotaDebitoEletronica.js';
import type { Recebimento } from '../../../interface/recebimentos/Recebimento.js';
import type {
    ExternalCallOptions,
    NdeEmitterInterface,
} from '../../../interface/recebimentos/ports.js';

/**
 * SKELETON stub — NdeEmitterInterface. Deterministic, idempotent, no ERP call. Returns a `pendente`
 * NDe keyed by the recebimento id (same input → same idempotency key). Módulo 5 swaps this token.
 */
@injectable()
export default class NdeEmitterStub implements NdeEmitterInterface {
    public emitir = async (
        recebimento: Recebimento,
        _opts?: ExternalCallOptions,
    ): Promise<NotaDebitoEletronica> => {
        return {
            id: `stub-nde-${recebimento.id}`,
            recebimentoId: recebimento.id,
            filCod: recebimento.filCod,
            correlationId: recebimento.correlationId,
            valor: recebimento.valorRecebido,
            moeda: 'BRL',
            statusEmissao: NDE_STATUS_EMISSAO.PENDENTE,
            idempotencyKey: `nde:${recebimento.id}`,
        };
    };
}
