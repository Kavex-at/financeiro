import { injectable } from 'tsyringe';
import type {
    BaixaGravada,
    BorderoCriado,
    CriarBorderoParams,
    ErpReceivablesGatewayInterface,
    ExternalCallOptions,
    GravarBaixaParams,
} from '../../../interface/recebimentos/ports.js';

/**
 * SKELETON stub — ErpReceivablesGatewayInterface. Deterministic, no ERP call. Echoes a fake
 * `borCod`/`bxaCodSeq` and preserves the `dryRun` flag from the params (borVldTipo + account routing
 * stay PARAMS). Módulo 5 swaps this token for the real Conexos receivables client (spike O3).
 */
@injectable()
export default class ErpReceivablesGatewayStub implements ErpReceivablesGatewayInterface {
    public criarBordero = async (
        params: CriarBorderoParams,
        _opts?: ExternalCallOptions,
    ): Promise<BorderoCriado> => {
        return { borCod: 999000, dryRun: params.dryRun };
    };

    public gravarBaixa = async (
        params: GravarBaixaParams,
        _opts?: ExternalCallOptions,
    ): Promise<BaixaGravada> => {
        return { bxaCodSeq: 999001, dryRun: params.dryRun };
    };
}
