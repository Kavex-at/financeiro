import { RECEBIMENTO_STATUS, TRANSACAO_BANCARIA_STATUS } from './constants.js';
import { buildRecebimento } from './__fixtures__/recebimento.fixture.js';
import {
    assertTransitionRecebimento,
    assertTransitionTransacao,
    canTransitionRecebimento,
    canTransitionTransacao,
    computeDiferencaNaoAlocada,
    computeValorAlocado,
    IllegalTransitionError,
    isRateioBalanceado,
} from './recebimentoTransitions.js';

describe('recebimentoTransitions — Recebimento guards (R2–R5)', () => {
    it('allows the 4 legal transitions', () => {
        expect(
            canTransitionRecebimento(RECEBIMENTO_STATUS.RASCUNHO, RECEBIMENTO_STATUS.APROVADO),
        ).toBe(true);
        expect(
            canTransitionRecebimento(RECEBIMENTO_STATUS.APROVADO, RECEBIMENTO_STATUS.RASCUNHO),
        ).toBe(true);
        expect(
            canTransitionRecebimento(RECEBIMENTO_STATUS.APROVADO, RECEBIMENTO_STATUS.EXECUTADO),
        ).toBe(true);
        expect(
            canTransitionRecebimento(RECEBIMENTO_STATUS.EXECUTADO, RECEBIMENTO_STATUS.ESTORNADO),
        ).toBe(true);
    });

    it('rejects illegal transitions', () => {
        expect(
            canTransitionRecebimento(RECEBIMENTO_STATUS.RASCUNHO, RECEBIMENTO_STATUS.EXECUTADO),
        ).toBe(false);
        expect(
            canTransitionRecebimento(RECEBIMENTO_STATUS.EXECUTADO, RECEBIMENTO_STATUS.RASCUNHO),
        ).toBe(false);
        expect(
            canTransitionRecebimento(RECEBIMENTO_STATUS.ESTORNADO, RECEBIMENTO_STATUS.RASCUNHO),
        ).toBe(false);
        expect(
            canTransitionRecebimento(RECEBIMENTO_STATUS.RASCUNHO, RECEBIMENTO_STATUS.ESTORNADO),
        ).toBe(false);
    });

    it('assertTransitionRecebimento throws IllegalTransitionError on an illegal transition', () => {
        expect(() =>
            assertTransitionRecebimento(RECEBIMENTO_STATUS.EXECUTADO, RECEBIMENTO_STATUS.RASCUNHO),
        ).toThrow(IllegalTransitionError);
    });

    it('assertTransitionRecebimento passes on a legal transition', () => {
        expect(() =>
            assertTransitionRecebimento(RECEBIMENTO_STATUS.RASCUNHO, RECEBIMENTO_STATUS.APROVADO),
        ).not.toThrow();
    });

    it('IllegalTransitionError carries the HandlerError contract', () => {
        const error = new IllegalTransitionError('technical', 'user');
        expect(error.code).toBe('RECEBIMENTO_TRANSICAO_INVALIDA');
        expect(error.statusCode).toBe(409);
        expect(error.retryable).toBe(false);
        expect(error.userMessage).toBe('user');
    });
});

describe('recebimentoTransitions — TransacaoBancaria guards (TB2–TB5)', () => {
    it('allows importada → {conciliada, parcial, manual, erro}', () => {
        expect(
            canTransitionTransacao(
                TRANSACAO_BANCARIA_STATUS.IMPORTADA,
                TRANSACAO_BANCARIA_STATUS.CONCILIADA,
            ),
        ).toBe(true);
        expect(
            canTransitionTransacao(
                TRANSACAO_BANCARIA_STATUS.IMPORTADA,
                TRANSACAO_BANCARIA_STATUS.PARCIAL,
            ),
        ).toBe(true);
        expect(
            canTransitionTransacao(
                TRANSACAO_BANCARIA_STATUS.IMPORTADA,
                TRANSACAO_BANCARIA_STATUS.MANUAL,
            ),
        ).toBe(true);
    });

    it('allows {parcial, manual} → erro', () => {
        expect(
            canTransitionTransacao(
                TRANSACAO_BANCARIA_STATUS.PARCIAL,
                TRANSACAO_BANCARIA_STATUS.ERRO,
            ),
        ).toBe(true);
        expect(
            canTransitionTransacao(
                TRANSACAO_BANCARIA_STATUS.MANUAL,
                TRANSACAO_BANCARIA_STATUS.ERRO,
            ),
        ).toBe(true);
    });

    it('rejects conciliada → importada (terminal-ish) and throws via assert', () => {
        expect(
            canTransitionTransacao(
                TRANSACAO_BANCARIA_STATUS.CONCILIADA,
                TRANSACAO_BANCARIA_STATUS.IMPORTADA,
            ),
        ).toBe(false);
        expect(() =>
            assertTransitionTransacao(
                TRANSACAO_BANCARIA_STATUS.CONCILIADA,
                TRANSACAO_BANCARIA_STATUS.IMPORTADA,
            ),
        ).toThrow(IllegalTransitionError);
    });

    it('assertTransitionTransacao passes on a legal transition', () => {
        expect(() =>
            assertTransitionTransacao(
                TRANSACAO_BANCARIA_STATUS.IMPORTADA,
                TRANSACAO_BANCARIA_STATUS.CONCILIADA,
            ),
        ).not.toThrow();
    });
});

describe('recebimentoTransitions — pure derivations', () => {
    it('computeValorAlocado sums rateio.valorAlocado', () => {
        const recebimento = buildRecebimento();
        expect(computeValorAlocado(recebimento.rateios)).toBe(15000);
        expect(computeValorAlocado([])).toBe(0);
    });

    it('computeDiferencaNaoAlocada = valorRecebido − Σ alocado', () => {
        const recebimento = buildRecebimento({ valorRecebido: 20000 });
        expect(computeDiferencaNaoAlocada(recebimento)).toBe(5000);
    });

    it('isRateioBalanceado flags Σ > valorRecebido', () => {
        expect(isRateioBalanceado(buildRecebimento({ valorRecebido: 15000 }))).toBe(true);
        expect(isRateioBalanceado(buildRecebimento({ valorRecebido: 10000 }))).toBe(false);
    });
});
