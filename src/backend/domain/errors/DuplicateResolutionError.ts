import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Por que a resolução de uma alerta de duplicidade (ou o desfazer do bloqueio) foi recusada. */
export const DUPLICATE_RESOLUTION_FAILURE = {
    /** JUSTIFICAR sem texto, ou desfazer bloqueio sem motivo (400). */
    TEXTO_OBRIGATORIO: 'TEXTO_OBRIGATORIO',
    /** Alerta inexistente, de outro lote/item, ou que não é de duplicidade (404). */
    ALERTA_NAO_ENCONTRADA: 'ALERTA_NAO_ENCONTRADA',
    /** Alerta que não está mais ABERTA (409). */
    ALERTA_NAO_ABERTA: 'ALERTA_NAO_ABERTA',
    /** Título sem bloqueio ATIVO para desfazer (409). */
    SEM_BLOQUEIO_ATIVO: 'SEM_BLOQUEIO_ATIVO',
} as const;

export type DuplicateResolutionFailure =
    (typeof DUPLICATE_RESOLUTION_FAILURE)[keyof typeof DUPLICATE_RESOLUTION_FAILURE];

const STATUS: Readonly<Record<DuplicateResolutionFailure, number>> = {
    TEXTO_OBRIGATORIO: 400,
    ALERTA_NAO_ENCONTRADA: 404,
    ALERTA_NAO_ABERTA: 409,
    SEM_BLOQUEIO_ATIVO: 409,
};

const MENSAGEM: Readonly<Record<DuplicateResolutionFailure, string>> = {
    TEXTO_OBRIGATORIO:
        'Informe o texto: a justificativa (ao manter o item) ou o motivo (ao desfazer o bloqueio) é obrigatório.',
    ALERTA_NAO_ENCONTRADA: 'Alerta de duplicidade não encontrada para este item do lote.',
    ALERTA_NAO_ABERTA:
        'Esta alerta de duplicidade já foi tratada ou deixou de valer. Atualize o lote.',
    SEM_BLOQUEIO_ATIVO: 'Este título não tem bloqueio por duplicidade ativo.',
};

/** Resolução de duplicidade recusada (ADR-0063, I13f/I13g). Mensagem ao operador em português. */
export default class DuplicateResolutionError extends Error implements HandlerError {
    public readonly code: string;
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode: number;
    public readonly details?: unknown;

    public constructor(params: { motivo: DuplicateResolutionFailure; alertaId?: string }) {
        super(`duplicate resolution refused: ${params.motivo}`);
        this.name = 'DuplicateResolutionError';
        this.code = `RESOLUCAO_DUPLICIDADE_${params.motivo}`;
        this.statusCode = STATUS[params.motivo];
        this.userMessage = MENSAGEM[params.motivo];
        this.details = params.alertaId ? { alertaId: params.alertaId } : undefined;
    }
}
