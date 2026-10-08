import AuthorizedPayeeActiveExistsError from './AuthorizedPayeeActiveExistsError.js';
import AuthorizedPayeeNotFoundError from './AuthorizedPayeeNotFoundError.js';
import AuthorizedPayeeStateError from './AuthorizedPayeeStateError.js';
import AuthorizedPayeeVersionConflictError from './AuthorizedPayeeVersionConflictError.js';
import BatchEmptiedByCheckError from './BatchEmptiedByCheckError.js';
import PayeeApprovalBySolicitorError from './PayeeApprovalBySolicitorError.js';
import PayeeDecisionReasonRequiredError from './PayeeDecisionReasonRequiredError.js';
import PayeeDestinationChangedSinceShownError from './PayeeDestinationChangedSinceShownError.js';
import PayeeNotAuthorizedAtRemittanceError from './PayeeNotAuthorizedAtRemittanceError.js';
import PayeeReapprovalNotConfirmedError from './PayeeReapprovalNotConfirmedError.js';
import PayeeWithoutPaymentDataError from './PayeeWithoutPaymentDataError.js';

const itens = [
    { docCod: 'D1', titCod: 'T1', credor: 'ACME', motivo: 'FAVORECIDO_NAO_AUTORIZADO' },
    { docCod: 'D2', titCod: 'T2', motivo: 'SEM_DADO_PAGAMENTO' },
];

describe('erros do favorecido autorizado (ADR-0065) — HTTP e mensagem', () => {
    it.each([
        [new PayeeNotAuthorizedAtRemittanceError({ loteId: 'L', itens }), 409],
        [new PayeeApprovalBySolicitorError({ id: 'a' }), 403],
        [new PayeeReapprovalNotConfirmedError({ id: 'a' }), 409],
        [new PayeeDestinationChangedSinceShownError({ id: 'a' }), 409],
        [new PayeeWithoutPaymentDataError({ id: 'a', modalidade: 'TED' }), 422],
        [new BatchEmptiedByCheckError({ loteId: 'L', itens }), 409],
        [new AuthorizedPayeeActiveExistsError({ pesCod: '1', modalidade: 'TED' }), 409],
        [new AuthorizedPayeeStateError({ id: 'a', estado: 'REVOGADO', acao: 'aprovada' }), 409],
        [new PayeeDecisionReasonRequiredError({ id: 'a', acao: 'revogar' }), 422],
        [new AuthorizedPayeeNotFoundError({ id: 'a' }), 404],
        [new AuthorizedPayeeVersionConflictError({ id: 'a', versaoEsperada: 2 }), 409],
    ])('%p → %i', (erro, status) => {
        expect(erro.statusCode).toBe(status);
        expect(erro.userMessage.length).toBeGreaterThan(0);
        expect(erro.code).toMatch(/^[A-Z_]+$/);
    });

    it('remessa barrada lista cada item com o motivo em português', () => {
        const e = new PayeeNotAuthorizedAtRemittanceError({ loteId: 'L', itens });
        expect(e.userMessage).toContain('D1/T1 (ACME): favorecido não autorizado');
        expect(e.userMessage).toContain('D2/T2: sem conta/chave no cadastro do Conexos');
        expect(e.details).toEqual({
            loteId: 'L',
            itens: [
                { item: 'D1/T1', motivo: 'FAVORECIDO_NAO_AUTORIZADO' },
                { item: 'D2/T2', motivo: 'SEM_DADO_PAGAMENTO' },
            ],
        });
    });

    it('lote esvaziado orienta pedir ao responsável pelo cadastro do Conexos quando falta dado', () => {
        const e = new BatchEmptiedByCheckError({ loteId: 'L', itens });
        expect(e.userMessage).toContain('pedir ao responsável pelo cadastro do Conexos');
        expect(e.userMessage).toContain('rascunho');
    });
});
