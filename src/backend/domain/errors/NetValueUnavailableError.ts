import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O título não traz o valor LÍQUIDO no grid de pendentes do `fin015` e tem juros/desconto: o
 * item não pode ser importado pelo valor base, senão o `.REM` pagaria o valor errado (I17n,
 * ADR-0073). HTTP 409. Nada foi importado.
 */
export default class NetValueUnavailableError extends Error implements HandlerError {
    public readonly code = 'VALOR_LIQUIDO_INDISPONIVEL';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details: {
        filCod: number;
        docCod: string;
        titCod: string;
        motivo: 'VALOR_LIQUIDO_INDISPONIVEL';
    };

    public constructor(params: { filCod: number; docCod: string; titCod: string }) {
        super(
            `Net value unavailable for title ${params.filCod}:${params.docCod}:${params.titCod}: the pending grid has interest/discount but no titMnyLiquido`,
        );
        this.name = 'NetValueUnavailableError';
        this.userMessage =
            `O Conexos não informou o valor líquido do título ${params.docCod}/${params.titCod}, ` +
            'que tem juros ou desconto. Nada foi importado para o lote nativo. ' +
            'Confira o título no Conexos e gere a remessa de novo.';
        this.details = {
            filCod: params.filCod,
            docCod: params.docCod,
            titCod: params.titCod,
            motivo: 'VALOR_LIQUIDO_INDISPONIVEL',
        };
    }
}
