import { RECEBIMENTO_STATUS, TRANSACAO_BANCARIA_STATUS } from './constants.js';
import { buildRecebimento } from './__fixtures__/recebimento.fixture.js';
import {
    assertTransitionRecebimento,
    assertTransitionTransacao,
    canTransitionRecebimento,
    canTransitionTransacao,
    computeDiferencaNaoAlocada,
    computeValorAlocado,
    decidirStatusPosSettle,
    IllegalTransitionError,
    isRateioBalanceado,
    origensPermitidasPara,
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

describe('recebimentoTransitions — retomada parcial (ADR-0034)', () => {
    it('allows {erro, manual} → parcial — a retomada pode settlar só uma perna do split', () => {
        expect(
            canTransitionTransacao(
                TRANSACAO_BANCARIA_STATUS.ERRO,
                TRANSACAO_BANCARIA_STATUS.PARCIAL,
            ),
        ).toBe(true);
        expect(
            canTransitionTransacao(
                TRANSACAO_BANCARIA_STATUS.MANUAL,
                TRANSACAO_BANCARIA_STATUS.PARCIAL,
            ),
        ).toBe(true);
    });

    it('keeps processada terminal — nada rebaixa o terminal operacional', () => {
        for (const destino of Object.values(TRANSACAO_BANCARIA_STATUS)) {
            expect(canTransitionTransacao(TRANSACAO_BANCARIA_STATUS.PROCESSADA, destino)).toBe(
                false,
            );
        }
    });
});

describe('recebimentoTransitions — origensPermitidasPara', () => {
    it('lista as origens exatas de cada destino escrito pelo settle', () => {
        expect([...origensPermitidasPara(TRANSACAO_BANCARIA_STATUS.PROCESSADA)].sort()).toEqual(
            [
                TRANSACAO_BANCARIA_STATUS.IMPORTADA,
                TRANSACAO_BANCARIA_STATUS.CONCILIADA,
                TRANSACAO_BANCARIA_STATUS.PARCIAL,
                TRANSACAO_BANCARIA_STATUS.MANUAL,
                TRANSACAO_BANCARIA_STATUS.ERRO,
            ].sort(),
        );
        expect([...origensPermitidasPara(TRANSACAO_BANCARIA_STATUS.PARCIAL)].sort()).toEqual(
            [
                TRANSACAO_BANCARIA_STATUS.IMPORTADA,
                TRANSACAO_BANCARIA_STATUS.MANUAL,
                TRANSACAO_BANCARIA_STATUS.ERRO,
            ].sort(),
        );
        expect([...origensPermitidasPara(TRANSACAO_BANCARIA_STATUS.ERRO)].sort()).toEqual(
            [
                TRANSACAO_BANCARIA_STATUS.IMPORTADA,
                TRANSACAO_BANCARIA_STATUS.PARCIAL,
                TRANSACAO_BANCARIA_STATUS.MANUAL,
            ].sort(),
        );
    });

    it('nunca inclui processada como origem — é a guarda que protege o terminal', () => {
        for (const destino of Object.values(TRANSACAO_BANCARIA_STATUS)) {
            expect(origensPermitidasPara(destino)).not.toContain(
                TRANSACAO_BANCARIA_STATUS.PROCESSADA,
            );
        }
    });

    it('concorda com canTransitionTransacao para todo par', () => {
        for (const origem of Object.values(TRANSACAO_BANCARIA_STATUS)) {
            for (const destino of Object.values(TRANSACAO_BANCARIA_STATUS)) {
                expect(origensPermitidasPara(destino).includes(origem)).toBe(
                    canTransitionTransacao(origem, destino),
                );
            }
        }
    });
});

describe('recebimentoTransitions — decidirStatusPosSettle (regra Σ)', () => {
    const { PROCESSADA, PARCIAL } = TRANSACAO_BANCARIA_STATUS;

    it('Σ igual ao valor → processada', () => {
        expect(decidirStatusPosSettle(1000, 1000)).toBe(PROCESSADA);
    });

    it('Σ um centavo abaixo → parcial', () => {
        expect(decidirStatusPosSettle(999.99, 1000)).toBe(PARCIAL);
    });

    it('Σ um centavo acima → processada (pagamento a maior é trabalho concluído)', () => {
        expect(decidirStatusPosSettle(1000.01, 1000)).toBe(PROCESSADA);
    });

    it('absorve o resíduo binário de 0.1 + 0.2', () => {
        expect(decidirStatusPosSettle(0.1 + 0.2, 0.3)).toBe(PROCESSADA);
    });

    it('absorve três rateios de um terço', () => {
        const terco = Number((1000 / 3).toFixed(2));
        expect(decidirStatusPosSettle(terco * 3, 1000)).toBe(PARCIAL);
        expect(decidirStatusPosSettle(terco * 2 + 333.34, 1000)).toBe(PROCESSADA);
    });

    it('Σ indeterminada NÃO escreve nada — processada é irreversível', () => {
        // Fail-open aqui mandaria um crédito com saldo a alocar para o único estado do qual não se
        // volta (`origensPermitidasPara` nunca devolve `processada`), por causa de um timeout de
        // pool. A varredura horária mede dentro do Postgres e decide com segurança.
        expect(decidirStatusPosSettle(undefined, 1000)).toBeUndefined();
    });

    it('Σ zerada (todo valor nulo no ledger) não decide nada', () => {
        expect(decidirStatusPosSettle(0, 1000)).toBeUndefined();
    });

    it('crédito de valor zero não vira processada por 0 >= 0 sem alocação', () => {
        expect(decidirStatusPosSettle(0, 0)).toBeUndefined();
        expect(decidirStatusPosSettle(500, 0)).toBeUndefined();
    });

    it('split: primeira perna parcial, segunda fecha em processada', () => {
        expect(decidirStatusPosSettle(2500, 10000)).toBe(PARCIAL);
        expect(decidirStatusPosSettle(7500, 10000)).toBe(PARCIAL);
        expect(decidirStatusPosSettle(10000, 10000)).toBe(PROCESSADA);
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
