import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Lançado ao pedir "Retirar do lote" para um título que não está em nenhum lote RASCUNHO
 * (ou saiu dele entre a leitura do painel e o clique). Nada é gravado — nem remoção, nem
 * retenção (ADR-0050 D3). Rota → HTTP 409; a tela recarrega e mostra o estado atual.
 */
export default class TituloForaDeLoteError extends Error implements HandlerError {
    public readonly code = 'TITULO_FORA_DE_LOTE';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: { filCod: number; docCod: string; titCod: string }) {
        super(`titulo ${params.filCod}:${params.docCod}/${params.titCod} is not in any draft lote`);
        this.name = 'TituloForaDeLoteError';
        this.userMessage =
            'Este título não está mais em nenhum lote em rascunho. Atualize a tela e confira.';
        this.details = { filCod: params.filCod, docCod: params.docCod, titCod: params.titCod };
    }
}
