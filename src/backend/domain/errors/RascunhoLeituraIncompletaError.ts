import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * A leitura dos itens do rascunho nativo não chegou ao fim (limite de páginas) e o item procurado
 * não apareceu. NÃO é "item ausente": quem procura decide abortar, nunca assumir ausência
 * (ADR-0071, I17g(2)). Só carrega identidade do lote.
 */
export default class RascunhoLeituraIncompletaError extends Error implements HandlerError {
    public readonly code = 'RASCUNHO_LEITURA_INCOMPLETA';
    public readonly userMessage: string;
    public readonly retryable = true;
    public readonly statusCode = 409;
    public readonly details: unknown;

    public constructor(params: { filCod: number; bncCod: number; flpCod: number; lidas: number }) {
        super(
            `draft item list read is incomplete (${params.lidas} rows) on flpCod ${params.flpCod}`,
        );
        this.name = 'RascunhoLeituraIncompletaError';
        this.userMessage =
            `Não foi possível ler por inteiro os itens do rascunho ${params.flpCod} no Conexos. ` +
            'Por segurança nada foi alterado. Tente de novo.';
        this.details = {
            filCod: Number(params.filCod),
            bncCod: Number(params.bncCod),
            flpCod: Number(params.flpCod),
            lidas: Number(params.lidas),
        };
    }
}
