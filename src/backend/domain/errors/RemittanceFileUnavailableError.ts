import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O lote TEM remessa registrada (`remessa_arquivo`), mas o arquivo não foi encontrado no `fin015`
 * do Conexos — nem pelo nome na grade de arquivos do lote nativo, nem pelo `gabCod` registrado.
 *
 * Existe para não mentir na tela: antes, este caso devolvia o mesmo 404 de "lote sem remessa
 * gerada", e a analista concluía que a remessa não tinha saído. O arquivo pode ter sido
 * cancelado/excluído no ERP ou o lote nativo reaproveitado; quem resolve é olhar no fin015.
 */
export default class RemittanceFileUnavailableError extends Error implements HandlerError {
    public readonly code = 'REMESSA_ARQUIVO_INDISPONIVEL';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 404;
    public readonly details?: unknown;

    public constructor(params: {
        loteId: string;
        nomeArquivo: string;
        filCod: number;
        flpCod: number;
        gabCod?: number;
    }) {
        super(
            `remessa ${params.nomeArquivo} do lote ${params.loteId} não encontrada no fin015 (fil ${params.filCod}, flp ${params.flpCod}, gab ${params.gabCod ?? '—'})`,
        );
        this.name = 'RemittanceFileUnavailableError';
        this.userMessage =
            `O arquivo de remessa ${params.nomeArquivo} não foi encontrado no Conexos ` +
            `(filial ${params.filCod}, lote nativo ${params.flpCod}). Ele pode ter sido ` +
            'cancelado ou excluído no fin015. Confira o lote no Conexos antes de gerar de novo.';
        this.details = params;
    }
}
