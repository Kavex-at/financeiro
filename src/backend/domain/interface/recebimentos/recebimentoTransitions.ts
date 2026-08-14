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
        // Caminho REAL da tela hoje: o analista aloca e a execução vai até o fim, sem passar por
        // `conciliada` (que nada escreve). Ver ADR-0033.
        TRANSACAO_BANCARIA_STATUS.PROCESSADA,
    ],
    // Alocação parcial/manual que depois é executada até o fim também termina em `processada`.
    [TRANSACAO_BANCARIA_STATUS.PARCIAL]: [
        TRANSACAO_BANCARIA_STATUS.ERRO,
        TRANSACAO_BANCARIA_STATUS.PROCESSADA,
    ],
    [TRANSACAO_BANCARIA_STATUS.MANUAL]: [
        TRANSACAO_BANCARIA_STATUS.ERRO,
        TRANSACAO_BANCARIA_STATUS.PARCIAL,
        TRANSACAO_BANCARIA_STATUS.PROCESSADA,
    ],
    [TRANSACAO_BANCARIA_STATUS.CONCILIADA]: [TRANSACAO_BANCARIA_STATUS.PROCESSADA],
    /**
     * `erro` é retomável: a re-execução que settla leva a transação ao terminal.
     *
     * `PARCIAL` está aqui porque a retomada pode settlar só UMA perna de uma alocação dividida. Sem
     * essa aresta a guarda de origem barraria a escrita EM SILÊNCIO (ela não lança) e o crédito
     * ficaria `erro` para sempre com dinheiro parcialmente alocado atrás.
     */
    [TRANSACAO_BANCARIA_STATUS.ERRO]: [
        TRANSACAO_BANCARIA_STATUS.PARCIAL,
        TRANSACAO_BANCARIA_STATUS.PROCESSADA,
    ],
    /** TERMINAL de verdade — depois de processada, nada mais transiciona. */
    [TRANSACAO_BANCARIA_STATUS.PROCESSADA]: [],
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

/**
 * Estados a partir dos quais `to` é alcançável — derivado da mesma `TRANSACAO_ALLOWED`.
 *
 * É a forma que o caminho do dinheiro consome: o repositório aplica o resultado como
 * `WHERE status = ANY($origens)`, o que torna a guarda ATÔMICA e sem `throw`. Recusar por `throw`
 * depois que o ERP já confirmou a baixa deixaria a tela mentindo sobre trabalho já registrado; não
 * escrever nada, por outro lado, é seguro — `PROCESSADA` não é origem de nada, então nenhuma escrita
 * tardia consegue rebaixar o terminal.
 *
 * `assertTransitionTransacao` (a forma que lança) continua exportada para o Módulo 2, que decide
 * ANTES de escrever no ERP e por isso pode falhar-fechado.
 */
export const origensPermitidasPara = (
    to: TransacaoBancariaStatus,
): readonly TransacaoBancariaStatus[] =>
    (Object.keys(TRANSACAO_ALLOWED) as TransacaoBancariaStatus[]).filter((from) =>
        TRANSACAO_ALLOWED[from].includes(to),
    );

/** Converte para centavos inteiros — comparação de dinheiro nunca em ponto flutuante. */
const emCentavos = (valor: number): number => Math.round(valor * 100);

/**
 * Decide o status da transação depois que uma alocação settla, comparando a Σ das alocações já
 * executadas com o valor do crédito. `undefined` = **não dá para decidir; não escreva nada.**
 *
 * Por que Σ e não "settlou logo processada": a marcação é por `txnId`, mas o ledger é por
 * `(txnId, priCod, valor)`. Um crédito dividido entre 4 processos ficaria `processada` na PRIMEIRA
 * baixa, escondendo da carteira o dinheiro que ainda falta alocar.
 *
 * ## Por que a medição indeterminada NÃO vira `processada`
 *
 * A tentação é fazer fail-open ("não consegui medir → mantém o comportamento antigo"). É errado, e a
 * assimetria é o ponto: `processada` é o ÚNICO estado terminal de verdade — `origensPermitidasPara`
 * nunca o devolve, então nem a varredura de reconciliação, nem o backfill, nem reprocessar
 * conseguem tirar um crédito de lá. Um `SUM` que falhou por timeout de pool mandaria um crédito de
 * R$ 1 milhão com R$ 250 mil alocados para fora da carteira E fora do KPI "a distribuir", de forma
 * permanente, recuperável só por SQL manual.
 *
 * Não escrever nada deixa o crédito num estado **recuperável e visível**: ele continua na fila, e a
 * varredura horária (`reconciliarStatusPorLedger`) decide com a medição feita DENTRO do Postgres,
 * numa statement só, sem round-trip que possa falhar no meio. Errar para o lado de "ainda aparece
 * como pendente" é o erro barato; errar para o lado de "sumiu da carteira" não é.
 *
 * Linhas de ledger com `valor` nulo (anteriores à migração 0042) são puladas pelo `SUM`, o que só
 * pode SUBESTIMAR a Σ. No pior caso um crédito completo fica `parcial` e permanece na fila — nunca
 * o contrário. Nunca escondemos dinheiro não alocado.
 */
export const decidirStatusPosSettle = (
    somaSettled: number | undefined,
    valorTransacao: number,
): TransacaoBancariaStatus | undefined => {
    // Não foi possível medir (a query lançou, ou o ledger não conhece o `txnId`).
    if (somaSettled === undefined) return undefined;

    const alocado = emCentavos(somaSettled);
    const total = emCentavos(valorTransacao);

    // Σ ≤ 0 com linhas no ledger significa `valor` nulo em todas: medimos, mas a medição não diz
    // nada sobre cobertura. `total` ≤ 0 é ruído de tesouraria, onde `0 >= 0` marcaria `processada`
    // sem alocação nenhuma. Nos dois casos, o mesmo princípio: sem base para decidir, não escreve.
    if (alocado <= 0 || total <= 0) return undefined;

    // `>=` e não `=`: pagamento a maior é trabalho concluído, não anomalia a esconder.
    return alocado >= total
        ? TRANSACAO_BANCARIA_STATUS.PROCESSADA
        : TRANSACAO_BANCARIA_STATUS.PARCIAL;
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
