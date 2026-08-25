import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Já existe uma geração de remessa EM CURSO para este lote, agora.
 *
 * Diferente do `RemessaEmDuvidaError`: lá a execução anterior MORREU sem confirmar e o estado do
 * ERP é desconhecido; aqui ela está viva e rodando neste instante, noutra requisição.
 *
 * ── POR QUE É PRECISO ───────────────────────────────────────────────────────────────────
 * O ledger write-ahead protege contra INTERRUPÇÃO, não contra CONCORRÊNCIA: duas requisições
 * simultâneas leem `findByIdempotencyKey` antes de qualquer uma escrever, as duas se veem como
 * "primeira tentativa", e as duas chamam `criarLote`. Resultado: dois lotes nativos, dois
 * `.REM`, pagamento em duplicidade — exatamente o dano que o ledger existe para evitar.
 *
 * O `heavyRouteLimiter` é por IP e não cobre dois operadores em máquinas diferentes.
 *
 * Retryable: sim, e de propósito — basta esperar a execução em curso terminar.
 * Rota → HTTP 409.
 */
export default class RemessaEmAndamentoError extends Error implements HandlerError {
    public readonly code = 'REMESSA_EM_ANDAMENTO';
    public readonly userMessage: string;
    public readonly retryable = true;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    constructor(params: { loteId: string }) {
        super(`remessa já em andamento para o lote ${params.loteId}`);
        this.name = 'RemessaEmAndamentoError';
        this.userMessage =
            'Já existe uma geração de remessa em andamento para este lote. Aguarde alguns ' +
            'segundos e recarregue — não clique de novo: duas execuções ao mesmo tempo criariam ' +
            'dois lotes de pagamento no Conexos.';
        this.details = params;
    }
}
