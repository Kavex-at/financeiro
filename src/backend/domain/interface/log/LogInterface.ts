export type LogLevel = 'INFO' | 'ERROR' | 'WARN' | 'SUCCESS';

/**
 * Constantes tipadas de `LogType` para o flow de Permutas (ObservabilityAdvisor).
 * Evita strings cruas no service layer — `LogType` aceita estas + as legadas.
 * Reusa `CONEXOS_ERROR`/`CONEXOS_DEBUG`.
 */
export const LOG_TYPE = {
    FLOW_START: 'FLOW_START',
    FLOW_COMPLETE: 'FLOW_COMPLETE',
    FLOW_ERROR: 'FLOW_ERROR',
    BUSINESS_INFO: 'BUSINESS_INFO',
    BUSINESS_WARN: 'BUSINESS_WARN',
    CONEXOS_ERROR: 'CONEXOS_ERROR',
    CONEXOS_DEBUG: 'CONEXOS_DEBUG',
    /**
     * Supabase Auth (ADR-0056). `AUTH_DIVERGENCIA`: o `app_user` e o GoTrue discordam (vínculo sem
     * usuário, banido com `ativo = true`, commit que falhou depois do GoTrue, desativado sem ban) —
     * o reparo é o job `sync-supabase-auth`. `AUTH_INDISPONIVEL`: o GoTrue não respondeu.
     * `AUTH_SESSAO`: login, renovação e logout.
     */
    AUTH_DIVERGENCIA: 'AUTH_DIVERGENCIA',
    AUTH_INDISPONIVEL: 'AUTH_INDISPONIVEL',
    AUTH_SESSAO: 'AUTH_SESSAO',
} as const;

export type LogType =
    | 'VALIDATION_ERROR'
    | 'BUSINESS_ERROR'
    | 'CONEXOS_ERROR'
    | 'SYSTEM_ERROR'
    | 'CONEXOS_DEBUG'
    | 'FLOW_START'
    | 'FLOW_COMPLETE'
    | 'FLOW_ERROR'
    | 'BUSINESS_INFO'
    | 'BUSINESS_WARN'
    | string;

export interface LoggerMetadata {
    service: string;
    lambdaContext: string;
    lambdaName: string;
    requestId: string;
    environment: string;
    clientName: string;
    messageId?: string;
    eventId?: string;
    flowId?: string;
    parentExecutionId?: string;
}

export interface CreateLogInput {
    level: LogLevel;
    type: LogType;
    message: string;
    stacktrace?: string;
    statusCode?: number;
    qive_id?: string | null;
    caller?: string;
    data?: Record<string, any>;
}

export interface LogInterface extends CreateLogInput, LoggerMetadata {
    timestamp: string;
}

export interface BaseLogParams {
    type: LogType;
    message: string;
    statusCode?: number;
    error?: any;
    qive_id?: null | string;
    data?: Record<string, any>;
}
