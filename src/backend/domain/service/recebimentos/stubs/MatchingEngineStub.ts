import { injectable } from 'tsyringe';
import { MATCH_CLASSIFICACAO } from '../../../interface/recebimentos/constants.js';
import type { DocumentoAReceber } from '../../../interface/recebimentos/DocumentoAReceber.js';
import type {
    MatchingEngineInterface,
    MatchResult,
} from '../../../interface/recebimentos/ports.js';
import type { TransacaoBancaria } from '../../../interface/recebimentos/TransacaoBancaria.js';

/**
 * SKELETON stub — MatchingEngineInterface. Deterministic, no logic. Always returns `nenhuma`
 * (nothing matched) → the coordinator routes to the manual queue. Módulo 2 swaps this token.
 */
@injectable()
export default class MatchingEngineStub implements MatchingEngineInterface {
    public match = async (
        _transacao: TransacaoBancaria,
        _abertos: DocumentoAReceber[],
    ): Promise<MatchResult> => {
        return { classificacao: MATCH_CLASSIFICACAO.NENHUMA, candidatos: [], score: 0 };
    };
}
