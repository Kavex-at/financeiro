import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Já existe uma reconciliação (baixa `fin010`) EM CURSO para este adiantamento, agora.
 *
 * Irmão de `RemessaEmAndamentoError` (SISPAG): mesma tática, mesmo motivo, outro domínio.
 *
 * ── POR QUE É PRECISO (I-Recon-5) ───────────────────────────────────────────────────────
 * O ledger write-ahead protege contra INTERRUPÇÃO, não contra CONCORRÊNCIA. Duas requisições
 * simultâneas ao mesmo `adiantamentoDocCod` leem `findByIdempotencyKey` ANTES de qualquer uma
 * escrever, as duas se veem como "primeira tentativa", e as duas seguem o handshake de 5
 * chamadas. Resultado: dois borderôs no `fin010`, duas baixas para o mesmo par, e uma trilha
 * que grava só o último `bor_cod` (last-write-wins) — o borderô perdedor fica invisível ao
 * painel. Exatamente o dano que o ledger existe para evitar.
 *
 * O `ON CONFLICT DO UPDATE` de `beginExecution` NÃO fecha isso: a CASE preserva os terminais,
 * mas dois callers em `reconciling` passam os dois. O `heavyRouteLimiter` é por IP e não
 * alcança dois operadores em máquinas diferentes.
 *
 * Diferente do IN-DOUBT (`reconciling` órfão): lá a execução anterior MORREU e o estado do ERP
 * é desconhecido (fail-closed, conciliação manual). Aqui ela está VIVA e rodando neste instante,
 * noutra requisição — e a espera resolve.
 *
 * Retryable: sim, e de propósito — basta esperar a execução em curso terminar.
 * Rota → HTTP 409.
 */
export default class ReconciliacaoEmAndamentoError extends Error implements HandlerError {
    public readonly code = 'RECONCILIACAO_EM_ANDAMENTO';
    public readonly userMessage: string;
    public readonly retryable = true;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    constructor(params: { adiantamentoDocCod: string }) {
        super(`reconciliação já em andamento para o adiantamento ${params.adiantamentoDocCod}`);
        this.name = 'ReconciliacaoEmAndamentoError';
        this.userMessage =
            'Já existe uma baixa em andamento para este adiantamento. Aguarde alguns segundos e ' +
            'recarregue a tela — não clique de novo: duas execuções ao mesmo tempo criariam dois ' +
            'borderôs e duas baixas para a mesma invoice no Conexos.';
        this.details = params;
    }
}
