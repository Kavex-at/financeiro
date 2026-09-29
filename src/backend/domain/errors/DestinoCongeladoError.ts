import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Por que o destino não pode mudar (ADR-0054 I10f / D5). */
export const MOTIVO_DESTINO_CONGELADO = {
    /** A analista tentou editar um destino que já foi importado num lote nativo vivo. */
    JA_IMPORTADO: 'ja_importado',
    /** A retomada achou um destino diferente do que a tentativa anterior registrou. */
    DIVERGE_DO_ENVIADO: 'diverge_do_enviado',
    /** Não foi possível saber se o item está no lote nativo (leitura do fin015 falhou). */
    INDETERMINADO: 'indeterminado',
} as const;

export type MotivoDestinoCongelado =
    (typeof MOTIVO_DESTINO_CONGELADO)[keyof typeof MOTIVO_DESTINO_CONGELADO];

/**
 * Congelamento do destino (ADR-0054 I10f): depois do `importarTitulos` com um destino, esse
 * destino não muda. Retry e retomada reenviam o que foi registrado; editar só volta a ser
 * possível quando o lote nativo que o usou deixou de existir. HTTP 409.
 *
 * Mesma família da `DebitDateFrozenError` (I8b). Sem conta/chave na mensagem (I10h).
 */
export default class DestinoCongeladoError extends Error implements HandlerError {
    public readonly code = 'DESTINO_CONGELADO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: {
        motivo: MotivoDestinoCongelado;
        titulo: string;
        nativeFlpCod?: number;
    }) {
        super(`payment destination of ${params.titulo} is frozen (${params.motivo})`);
        this.name = 'DestinoCongeladoError';
        const lote = params.nativeFlpCod !== undefined ? ` (lote ${params.nativeFlpCod})` : '';
        this.userMessage =
            params.motivo === MOTIVO_DESTINO_CONGELADO.JA_IMPORTADO
                ? `O destino do título ${params.titulo} já foi enviado ao Conexos no lote nativo${lote} e não pode mais mudar. Para trocar, cancele o lote nativo no fin015.`
                : params.motivo === MOTIVO_DESTINO_CONGELADO.DIVERGE_DO_ENVIADO
                  ? `O destino do título ${params.titulo} não é mais o que foi registrado na tentativa anterior${lote}. A remessa não reenvia um destino diferente: cancele o lote nativo no fin015 para recomeçar.`
                  : `Não foi possível confirmar no Conexos se o título ${params.titulo} já está no lote nativo${lote}. Por segurança o destino não foi alterado; tente de novo.`;
        this.details = {
            motivo: params.motivo,
            titulo: params.titulo,
            ...(params.nativeFlpCod !== undefined ? { nativeFlpCod: params.nativeFlpCod } : {}),
        };
    }
}
