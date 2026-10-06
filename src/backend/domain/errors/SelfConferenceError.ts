import type { HandlerError } from '../libs/handler/HandlerError.js';

const MOTIVO: Readonly<Record<string, string>> = {
    FINALIZOU: 'você finalizou este lote',
    INCLUIU_ITEM: 'você incluiu título neste lote',
    CRIOU_LOTE_MANUAL: 'você montou este lote',
    NAO_IDENTIFICADO: 'não foi possível identificar o usuário',
};

/**
 * Conferência (L12) ou devolução (L13) por quem não pode conferir (ADR-0063, I13l): quem
 * finalizou o lote, incluiu algum título nele ou criou o lote manual. Comparado pelo username
 * canônico do usuário autenticado, no backend. HTTP 403.
 */
export default class SelfConferenceError extends Error implements HandlerError {
    public readonly code = 'CONFERENCIA_PELA_MESMA_PESSOA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 403;
    public readonly details?: unknown;

    public constructor(params: { loteId: string; impedimento: string }) {
        super(`lot ${params.loteId} cannot be checked by this user (${params.impedimento})`);
        this.name = 'SelfConferenceError';
        this.userMessage =
            `A conferência precisa ser feita por outra pessoa: ${MOTIVO[params.impedimento] ?? 'você participou da montagem'}. ` +
            'Peça a alguém com a permissão "SISPAG — conferir" que não montou nem finalizou o lote.';
        this.details = { loteId: params.loteId, impedimento: params.impedimento };
    }
}
