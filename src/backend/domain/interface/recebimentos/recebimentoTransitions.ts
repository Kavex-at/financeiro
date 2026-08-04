import { RECEBIMENTO_STATUS, TRANSACAO_BANCARIA_STATUS } from './constants.js';
import type { RecebimentoStatus, TransacaoBancariaStatus } from './constants.js';
import type { RateioRecebimento } from './RateioRecebimento.js';
import type { Recebimento } from './Recebimento.js';

/**
 * Pure state-machine transition guards for Frente IV — no I/O, no `container`, no `Date.now()`
 * inside the decision. Mirror `state-machines/recebimento.md` (R2–R5) and
 * `state-machines/transacao-bancaria.md` (TB2–TB5). Exported as named consts (repo `utils/` style
 * for pure helpers).
 */

/** Domain error thrown on an illegal transition — conforms to the `HandlerError` contract. */
export class IllegalTransitionError extends Error {
    public readonly code: string = 'RECEBIMENTO_TRANSICAO_INVALIDA';
    public readonly userMessage: string;
    public readonly retryable: boolean = false;
    public readonly statusCode: number = 409;

    constructor(message: string, userMessage: string) {
        super(message);
        this.name = 'IllegalTransitionError';
        this.userMessage = userMessage;
    }
}

/**
 * Domain error thrown when an optimistic-concurrency write loses (Regis fault-tolerance-3) — conforms
 * to the `HandlerError` contract (409, non-retryable). Mirrors the lote's I6 concurrency guard.
 */
export class RecebimentoVersionConflictError extends Error {
    public readonly code: string = 'RECEBIMENTO_VERSAO_CONFLITO';
    public readonly userMessage: string;
    public readonly retryable: boolean = false;
    public readonly statusCode: number = 409;

    constructor(message: string, userMessage: string) {
        super(message);
        this.name = 'RecebimentoVersionConflictError';
        this.userMessage = userMessage;
    }
}

/** Allowed `Recebimento` transitions — `from → Set(to)`. Anything else is illegal. */
const RECEBIMENTO_ALLOWED: Readonly<Record<RecebimentoStatus, readonly RecebimentoStatus[]>> = {
    [RECEBIMENTO_STATUS.RASCUNHO]: [RECEBIMENTO_STATUS.APROVADO],
    [RECEBIMENTO_STATUS.APROVADO]: [RECEBIMENTO_STATUS.RASCUNHO, RECEBIMENTO_STATUS.EXECUTADO],
    [RECEBIMENTO_STATUS.EXECUTADO]: [RECEBIMENTO_STATUS.ESTORNADO],
    [RECEBIMENTO_STATUS.ESTORNADO]: [],
};

/** R2 (rascunho→aprovado), R3 (aprovado→rascunho), R4 (aprovado→executado), R5 (executado→estornado). */
export const canTransitionRecebimento = (from: RecebimentoStatus, to: RecebimentoStatus): boolean =>
    RECEBIMENTO_ALLOWED[from].includes(to);

/** Throws `IllegalTransitionError` when the transition is not allowed. */
export const assertTransitionRecebimento = (
    from: RecebimentoStatus,
    to: RecebimentoStatus,
): void => {
    if (!canTransitionRecebimento(from, to)) {
        throw new IllegalTransitionError(
            `Illegal Recebimento transition: ${from} → ${to}`,
            'Transição de recebimento inválida.',
        );
    }
};

/** Allowed `TransacaoBancaria` transitions — TB2–TB5. */
const TRANSACAO_ALLOWED: Readonly<
    Record<TransacaoBancariaStatus, readonly TransacaoBancariaStatus[]>
> = {
    [TRANSACAO_BANCARIA_STATUS.IMPORTADA]: [
        TRANSACAO_BANCARIA_STATUS.CONCILIADA,
        TRANSACAO_BANCARIA_STATUS.PARCIAL,
        TRANSACAO_BANCARIA_STATUS.MANUAL,
        TRANSACAO_BANCARIA_STATUS.ERRO,
    ],
    [TRANSACAO_BANCARIA_STATUS.PARCIAL]: [TRANSACAO_BANCARIA_STATUS.ERRO],
    [TRANSACAO_BANCARIA_STATUS.MANUAL]: [TRANSACAO_BANCARIA_STATUS.ERRO],
    [TRANSACAO_BANCARIA_STATUS.CONCILIADA]: [],
    [TRANSACAO_BANCARIA_STATUS.ERRO]: [],
};

/** `importada→{conciliada,parcial,manual}` and `{importada,parcial,manual}→erro`. */
export const canTransitionTransacao = (
    from: TransacaoBancariaStatus,
    to: TransacaoBancariaStatus,
): boolean => TRANSACAO_ALLOWED[from].includes(to);

/** Throws `IllegalTransitionError` when the transacao transition is not allowed. */
export const assertTransitionTransacao = (
    from: TransacaoBancariaStatus,
    to: TransacaoBancariaStatus,
): void => {
    if (!canTransitionTransacao(from, to)) {
        throw new IllegalTransitionError(
            `Illegal TransacaoBancaria transition: ${from} → ${to}`,
            'Transição de movimento bancário inválida.',
        );
    }
};

/** Σ of `rateio.valorAlocado` — pure derivation. */
export const computeValorAlocado = (rateios: readonly RateioRecebimento[]): number =>
    rateios.reduce((sum, rateio) => sum + rateio.valorAlocado, 0);

/** `valorRecebido − Σ valorAlocado` — pure derivation. */
export const computeDiferencaNaoAlocada = (recebimento: Recebimento): number =>
    recebimento.valorRecebido - computeValorAlocado(recebimento.rateios);

/** Invariant I-Receb-1: Σ valorAlocado must not exceed valorRecebido. */
export const isRateioBalanceado = (recebimento: Recebimento): boolean =>
    computeValorAlocado(recebimento.rateios) <= recebimento.valorRecebido;
