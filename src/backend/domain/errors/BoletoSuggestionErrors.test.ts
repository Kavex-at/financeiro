import BoletoAlreadySuggestedToOtherTitleError from './BoletoAlreadySuggestedToOtherTitleError.js';
import BoletoSuggestionNotAvailableError from './BoletoSuggestionNotAvailableError.js';
import IssuerConfirmationNotFoundError from './IssuerConfirmationNotFoundError.js';
import IssuerConfirmationReasonRequiredError from './IssuerConfirmationReasonRequiredError.js';
import LineCopyAuditFailedError from './LineCopyAuditFailedError.js';
import OverdueBoletoNotConfirmableError from './OverdueBoletoNotConfirmableError.js';

const chave = { filCod: 2, docCod: '9001', titCod: '1', ddcCod: 10, ditCod: 3 };

describe('erros da sugestão de boleto (ADR-0068) — HTTP e mensagem', () => {
    it.each([
        [new BoletoSuggestionNotAvailableError(chave), 409],
        [new BoletoAlreadySuggestedToOtherTitleError(chave), 409],
        [new IssuerConfirmationReasonRequiredError({ acao: 'rejeitar a sugestão' }), 422],
        [new OverdueBoletoNotConfirmableError(chave), 422],
        [new IssuerConfirmationNotFoundError({ id: 'x' }), 404],
        [new LineCopyAuditFailedError({ filCod: 2, docCod: '9001', titCod: '1' }), 503],
    ])('%p → %i', (erro, status) => {
        expect(erro.statusCode).toBe(status);
        expect(erro.userMessage.length).toBeGreaterThan(0);
        expect(erro.code).toMatch(/^[A-Z_]+$/);
        expect(erro.message.length).toBeGreaterThan(0);
    });

    it('a mensagem de indisponibilidade aceita um motivo específico em português', () => {
        const e = new BoletoSuggestionNotAvailableError({
            ...chave,
            motivo: 'O título já foi pago.',
        });
        expect(e.userMessage).toBe('O título já foi pago.');
        expect(e.details).toEqual(chave);
    });

    it('nenhum erro expõe barras nem linha digitável nos detalhes', () => {
        const e = new BoletoAlreadySuggestedToOtherTitleError(chave);
        expect(JSON.stringify(e.details)).not.toMatch(/\d{20,}/);
    });
});
