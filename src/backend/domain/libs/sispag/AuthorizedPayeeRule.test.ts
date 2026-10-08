import 'reflect-metadata';
import AuthorizedPayeeActiveExistsError from '../../errors/AuthorizedPayeeActiveExistsError.js';
import AuthorizedPayeeStateError from '../../errors/AuthorizedPayeeStateError.js';
import PayeeApprovalBySolicitorError from '../../errors/PayeeApprovalBySolicitorError.js';
import PayeeDecisionReasonRequiredError from '../../errors/PayeeDecisionReasonRequiredError.js';
import PayeeDestinationChangedSinceShownError from '../../errors/PayeeDestinationChangedSinceShownError.js';
import PayeeReapprovalNotConfirmedError from '../../errors/PayeeReapprovalNotConfirmedError.js';
import PayeeWithoutPaymentDataError from '../../errors/PayeeWithoutPaymentDataError.js';
import {
    AUTHORIZED_PAYEE_STATE,
    type AuthorizedPayee,
    type AuthorizedPayeeState,
    PAYEE_CHECK_RESULT,
    PAYEE_REQUEST_ORIGIN,
    type PayeeDestinationReading,
} from '../../interface/sispag/AuthorizedPayeeInterface.js';
import AuthorizedPayeeRule from './AuthorizedPayeeRule.js';

const registro = (over: Partial<AuthorizedPayee> = {}): AuthorizedPayee => ({
    id: 'a1',
    pesCod: '7001',
    credor: 'ACME',
    modalidade: 'TED',
    estado: AUTHORIZED_PAYEE_STATE.PENDENTE,
    avisos: [],
    origemSolicitacao: PAYEE_REQUEST_ORIGIN.MANUAL,
    solicitadoPor: 'ana',
    solicitadoEm: '2026-10-08T10:00:00.000Z',
    filCodLeitura: 1,
    versao: 1,
    ...over,
});

const autorizado = (over: Partial<AuthorizedPayee> = {}): AuthorizedPayee =>
    registro({
        estado: AUTHORIZED_PAYEE_STATE.AUTORIZADO,
        fingerprint: 'fp-1',
        fingerprintChaveId: 'v1',
        destinoMascarado: 'banco 237 · ag. 1234 · cc ****4321-0',
        decididoPor: 'bia',
        ...over,
    });

const lido = (fingerprint: string, keyId = 'v1'): PayeeDestinationReading => ({
    status: 'OK',
    fingerprint,
    keyId,
});
const SEM_DADO: PayeeDestinationReading = { status: 'SEM_DADO' };
const FALHA: PayeeDestinationReading = { status: 'FALHA_LEITURA' };

describe('AuthorizedPayeeRule — state machine favorecido-autorizado (ADR-0065)', () => {
    const rule = new AuthorizedPayeeRule();

    describe('F1/F5 solicitar', () => {
        it('F1: sem registro vigente cria PENDENTE (nunca AUTORIZADO)', () => {
            expect(rule.solicitar(null)).toBe('CRIAR');
        });

        it('F1: terminal (REJEITADO/REVOGADO) não impede pedido novo — é outro registro', () => {
            expect(rule.solicitar(registro({ estado: AUTHORIZED_PAYEE_STATE.REJEITADO }))).toBe(
                'CRIAR',
            );
            expect(rule.solicitar(registro({ estado: AUTHORIZED_PAYEE_STATE.REVOGADO }))).toBe(
                'CRIAR',
            );
        });

        it('F5: REAPROVACAO_PENDENTE é confirmada pelo pedido', () => {
            expect(
                rule.solicitar(
                    autorizado({
                        estado: AUTHORIZED_PAYEE_STATE.REAPROVACAO_PENDENTE,
                        solicitadoPor: undefined,
                    }),
                ),
            ).toBe('CONFIRMAR');
        });

        it('PENDENTE ou AUTORIZADO vigente → já existe (409)', () => {
            expect(() => rule.solicitar(registro())).toThrow(AuthorizedPayeeActiveExistsError);
            expect(() => rule.solicitar(autorizado())).toThrow(AuthorizedPayeeActiveExistsError);
        });
    });

    describe('F2/F6 aprovar', () => {
        it('F2: PENDENTE com destino igual ao mostrado → AUTORIZADO', () => {
            expect(
                rule.aprovar(registro(), {
                    ator: 'bia',
                    leitura: lido('fp-9'),
                    fingerprintMostrado: 'fp-9',
                }),
            ).toBe(AUTHORIZED_PAYEE_STATE.AUTORIZADO);
        });

        it('aprovador = solicitante → PayeeApprovalBySolicitorError', () => {
            expect(() =>
                rule.aprovar(registro(), {
                    ator: 'ana',
                    leitura: lido('fp-9'),
                    fingerprintMostrado: 'fp-9',
                }),
            ).toThrow(PayeeApprovalBySolicitorError);
        });

        it('F6 sem solicitadoPor (reaprovação não confirmada) → PayeeReapprovalNotConfirmedError', () => {
            const reap = autorizado({
                estado: AUTHORIZED_PAYEE_STATE.REAPROVACAO_PENDENTE,
                solicitadoPor: undefined,
            });
            expect(() =>
                rule.aprovar(reap, {
                    ator: 'bia',
                    leitura: lido('fp-2'),
                    fingerprintMostrado: 'fp-2',
                }),
            ).toThrow(PayeeReapprovalNotConfirmedError);
        });

        it('F6 confirmada por outra pessoa → AUTORIZADO', () => {
            const reap = autorizado({
                estado: AUTHORIZED_PAYEE_STATE.REAPROVACAO_PENDENTE,
                solicitadoPor: 'carla',
            });
            expect(
                rule.aprovar(reap, {
                    ator: 'bia',
                    leitura: lido('fp-2'),
                    fingerprintMostrado: 'fp-2',
                }),
            ).toBe(AUTHORIZED_PAYEE_STATE.AUTORIZADO);
        });

        it('cmn025 sem dado → PayeeWithoutPaymentDataError; destino mudou → 409', () => {
            expect(() =>
                rule.aprovar(registro(), {
                    ator: 'bia',
                    leitura: SEM_DADO,
                    fingerprintMostrado: 'fp-9',
                }),
            ).toThrow(PayeeWithoutPaymentDataError);
            expect(() =>
                rule.aprovar(registro(), {
                    ator: 'bia',
                    leitura: lido('fp-10'),
                    fingerprintMostrado: 'fp-9',
                }),
            ).toThrow(PayeeDestinationChangedSinceShownError);
        });

        it('falha de leitura na aprovação não aprova', () => {
            expect(() =>
                rule.aprovar(registro(), {
                    ator: 'bia',
                    leitura: FALHA,
                    fingerprintMostrado: 'fp-9',
                }),
            ).toThrow();
        });
    });

    describe('F3 rejeitar / F7 revogar', () => {
        it('F3: PENDENTE → REJEITADO com motivo; sem motivo recusa', () => {
            expect(rule.rejeitar(registro(), 'conta de terceiro')).toBe(
                AUTHORIZED_PAYEE_STATE.REJEITADO,
            );
            expect(() => rule.rejeitar(registro(), '   ')).toThrow(
                PayeeDecisionReasonRequiredError,
            );
        });

        it('F3 só de PENDENTE', () => {
            expect(() => rule.rejeitar(autorizado(), 'x')).toThrow(AuthorizedPayeeStateError);
        });

        it('F7: AUTORIZADO ou REAPROVACAO_PENDENTE → REVOGADO com motivo', () => {
            expect(rule.revogar(autorizado(), 'fornecedor encerrado')).toBe(
                AUTHORIZED_PAYEE_STATE.REVOGADO,
            );
            expect(
                rule.revogar(
                    autorizado({ estado: AUTHORIZED_PAYEE_STATE.REAPROVACAO_PENDENTE }),
                    'x',
                ),
            ).toBe(AUTHORIZED_PAYEE_STATE.REVOGADO);
            expect(() => rule.revogar(autorizado(), '')).toThrow(PayeeDecisionReasonRequiredError);
            expect(() => rule.revogar(registro(), 'x')).toThrow(AuthorizedPayeeStateError);
        });
    });

    it('terminais REJEITADO e REVOGADO recusam aprovar, rejeitar e revogar', () => {
        for (const estado of [
            AUTHORIZED_PAYEE_STATE.REJEITADO,
            AUTHORIZED_PAYEE_STATE.REVOGADO,
        ] as AuthorizedPayeeState[]) {
            const r = registro({ estado });
            expect(() =>
                rule.aprovar(r, { ator: 'bia', leitura: lido('f'), fingerprintMostrado: 'f' }),
            ).toThrow(AuthorizedPayeeStateError);
            expect(() => rule.rejeitar(r, 'x')).toThrow(AuthorizedPayeeStateError);
            expect(() => rule.revogar(r, 'x')).toThrow(AuthorizedPayeeStateError);
        }
    });

    describe('F4 abre reaprovação', () => {
        it('AUTORIZADO, leitura OK, mesma chave, fingerprint diferente → abre', () => {
            expect(rule.abreReaprovacao(autorizado(), lido('fp-2'))).toBe(true);
        });

        it('não abre com falha de leitura, sem dado, fingerprint igual, chave diferente ou outro estado', () => {
            expect(rule.abreReaprovacao(autorizado(), FALHA)).toBe(false);
            expect(rule.abreReaprovacao(autorizado(), SEM_DADO)).toBe(false);
            expect(rule.abreReaprovacao(autorizado(), lido('fp-1'))).toBe(false);
            expect(rule.abreReaprovacao(autorizado(), lido('fp-2', 'v2'))).toBe(false);
            expect(rule.abreReaprovacao(registro(), lido('fp-2'))).toBe(false);
        });
    });

    describe('classificar — precedência I14d', () => {
        it('OK só com AUTORIZADO e fingerprint igual na mesma chave', () => {
            expect(rule.classificar(autorizado(), lido('fp-1'))).toBe(PAYEE_CHECK_RESULT.OK);
        });

        it('FALHA_LEITURA vence tudo', () => {
            expect(rule.classificar(null, FALHA)).toBe(PAYEE_CHECK_RESULT.FALHA_LEITURA);
            expect(rule.classificar(autorizado(), FALHA)).toBe(PAYEE_CHECK_RESULT.FALHA_LEITURA);
        });

        it('SEM_DADO_PAGAMENTO vence não autorizado; autorizado sem dado também é SEM_DADO', () => {
            expect(rule.classificar(null, SEM_DADO)).toBe(PAYEE_CHECK_RESULT.SEM_DADO_PAGAMENTO);
            expect(rule.classificar(autorizado(), SEM_DADO)).toBe(
                PAYEE_CHECK_RESULT.SEM_DADO_PAGAMENTO,
            );
        });

        it('sem autorização vigente, PENDENTE ou chave de outra versão → FAVORECIDO_NAO_AUTORIZADO', () => {
            expect(rule.classificar(null, lido('x'))).toBe(
                PAYEE_CHECK_RESULT.FAVORECIDO_NAO_AUTORIZADO,
            );
            expect(rule.classificar(registro(), lido('x'))).toBe(
                PAYEE_CHECK_RESULT.FAVORECIDO_NAO_AUTORIZADO,
            );
            expect(rule.classificar(autorizado(), lido('fp-1', 'v2'))).toBe(
                PAYEE_CHECK_RESULT.FAVORECIDO_NAO_AUTORIZADO,
            );
        });

        it('fingerprint diferente ou reaprovação aberta → DESTINO_ALTERADO', () => {
            expect(rule.classificar(autorizado(), lido('fp-2'))).toBe(
                PAYEE_CHECK_RESULT.DESTINO_ALTERADO,
            );
            expect(
                rule.classificar(
                    autorizado({ estado: AUTHORIZED_PAYEE_STATE.REAPROVACAO_PENDENTE }),
                    lido('fp-1'),
                ),
            ).toBe(PAYEE_CHECK_RESULT.DESTINO_ALTERADO);
        });
    });
});
