import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O borderô do grupo parou numa falha transitória ou ambígua depois de criado (I21p(2)): ledger
 * `failed`, borderô e rascunho preservados, a retomada continua de onde parou (I21s) — nunca cria
 * um segundo borderô. Também a resposta `SUCESSO` do `importar` sem o item observado (H4).
 * HTTP 409, retomável.
 */
export default class GroupBorderoIncompleteError extends Error implements HandlerError {
    public readonly code = 'GRUPO_BORDERO_INCOMPLETO';
    public readonly userMessage: string;
    public readonly retryable = true;
    public readonly statusCode = 409;
    public readonly details: {
        grupoId: string;
        filCod: number;
        borCod?: number;
        flpCod?: number;
        etapa: string;
    };

    public constructor(params: {
        grupoId: string;
        filCod: number;
        borCod?: number;
        flpCod?: number;
        etapa: string;
    }) {
        super(
            `Group borderô of ${params.grupoId} stopped at ${params.etapa}${params.borCod !== undefined ? ` (borCod ${params.borCod})` : ''}; resumable`,
        );
        this.name = 'GroupBorderoIncompleteError';
        const bordero = params.borCod !== undefined ? ` (borderô ${params.borCod})` : '';
        const lote = params.flpCod !== undefined ? `, lote nativo ${params.flpCod}` : '';
        this.userMessage =
            `A preparação do boleto agrupado${bordero} na filial ${params.filCod}${lote} não ` +
            'terminou: o Conexos não respondeu de forma conclusiva. Ela será retomada de onde ' +
            'parou, sem criar outro borderô: gere a remessa de novo em alguns minutos.';
        this.details = { ...params };
    }
}
