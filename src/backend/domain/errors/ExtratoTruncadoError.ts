import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Lançado quando a leitura do extrato (`fin095/list`) bate no teto de páginas do
 * `paginate` — ou seja, o Conexos tinha MAIS lançamentos do que conseguimos ler.
 *
 * É uma falha ALTA de propósito. O modo de falha que este erro fecha: se um
 * filtro for recusado ou silenciosamente ignorado pelo ERP, a consulta degrada
 * para "extrato inteiro da conta" (28k linhas na conta 38 em produção), o
 * `paginate` corta em `MAX_PAGES × PAGE_SIZE` e devolve uma lista incompleta
 * SEM erro. A ingestão então grava metade do extrato e fecha a run como sucesso —
 * uma carteira furada que ninguém percebe. Melhor a run falhar e alguém olhar.
 *
 * Correção operacional: encurtar a janela de datas (o serviço já fatia em blocos)
 * ou conferir se o filtro de tipo/data continua sendo aceito pelo ERP.
 */
export default class ExtratoTruncadoError extends Error implements HandlerError {
    public readonly code = 'EXTRATO_TRUNCADO';
    public readonly userMessage =
        'A leitura do extrato excedeu o limite de páginas e seria incompleta. Reduza a janela de datas e tente novamente.';
    public readonly retryable = false;
    public readonly statusCode = 502;
    public readonly details?: unknown;

    constructor(contexto: { filCod: number; gerNum: number; de: Date; ate: Date; lidas: number }) {
        super(
            `fin095/list truncou: filial ${contexto.filCod}, conta ${contexto.gerNum}, ` +
                `janela ${contexto.de.toISOString()}..${contexto.ate.toISOString()}, ` +
                `${contexto.lidas} linhas lidas antes do teto`,
        );
        this.name = 'ExtratoTruncadoError';
        this.details = contexto;
    }
}
