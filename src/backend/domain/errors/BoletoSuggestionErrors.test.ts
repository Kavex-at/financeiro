import BoletoAlreadySuggestedToOtherTitleError from './BoletoAlreadySuggestedToOtherTitleError.js';
import BoletoSuggestionNotAvailableError from './BoletoSuggestionNotAvailableError.js';
import DecisionNotConfirmedError from './DecisionNotConfirmedError.js';
import IssuerConfirmationNotFoundError from './IssuerConfirmationNotFoundError.js';
import IssuerConfirmationReasonRequiredError from './IssuerConfirmationReasonRequiredError.js';
import IssuerConfirmationVersionConflictError from './IssuerConfirmationVersionConflictError.js';
import InvalidDecisionActorError from './InvalidDecisionActorError.js';
import SuggestionListingTruncatedError from './SuggestionListingTruncatedError.js';
import LineCopyAuditFailedError from './LineCopyAuditFailedError.js';
import OverdueBoletoNotConfirmableError from './OverdueBoletoNotConfirmableError.js';
import WarningAcknowledgementRequiredError from './WarningAcknowledgementRequiredError.js';
import DivergenceAcknowledgementRequiredError from './DivergenceAcknowledgementRequiredError.js';
import DivergenceAcknowledgementStaleError from './DivergenceAcknowledgementStaleError.js';

const chave = { filCod: 2, docCod: '9001', titCod: '1', ddcCod: 10, ditCod: 3 };

describe('WarningAcknowledgementRequiredError (I15o, ADR-0072)', () => {
    const erro = new WarningAcknowledgementRequiredError({
        ...chave,
        avisos: ['VENCE_ANTES_DO_TITULO'],
        vencimentoTitulo: '2026-10-20',
        vencimentoBoleto: '2026-10-18',
        dataDebito: '2026-10-15',
    });

    it('é 422 com código estável e não é retentável', () => {
        expect(erro.statusCode).toBe(422);
        expect(erro.code).toBe('RECONHECIMENTO_DE_AVISO_OBRIGATORIO');
        expect(erro.retryable).toBe(false);
        expect(erro.name).toBe('WarningAcknowledgementRequiredError');
    });

    it('message em inglês; userMessage em pt-BR com as datas e a orientação do portal', () => {
        expect(erro.message).toMatch(/^Warning acknowledgement required/);
        expect(erro.userMessage).toContain('18/10/2026');
        expect(erro.userMessage).toContain('20/10/2026');
        expect(erro.userMessage).toContain('15/10/2026');
        expect(erro.userMessage).toContain('confirme o vencimento no portal do banco');
    });

    it('os detalhes carregam a chave e os avisos, sem barras', () => {
        expect(erro.details).toEqual({ ...chave, avisos: ['VENCE_ANTES_DO_TITULO'] });
        expect(JSON.stringify(erro.details)).not.toMatch(/\d{20,}/);
    });
});

describe('erros da sugestão de boleto (ADR-0068) — HTTP e mensagem', () => {
    it.each([
        [new BoletoSuggestionNotAvailableError(chave), 409],
        [new BoletoAlreadySuggestedToOtherTitleError(chave), 409],
        [new IssuerConfirmationReasonRequiredError({ acao: 'rejeitar a sugestão' }), 422],
        [new OverdueBoletoNotConfirmableError(chave), 422],
        [new IssuerConfirmationNotFoundError({ id: 'x' }), 404],
        [new IssuerConfirmationVersionConflictError({ id: 'x' }), 409],
        [new DecisionNotConfirmedError({ filCod: 2, docCod: '9001', titCod: '1' }), 409],
        [new InvalidDecisionActorError(), 403],
        [new SuggestionListingTruncatedError({ listagem: 'decisoes', limite: 10000 }), 503],
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

describe('erros do reconhecimento de divergência (I15q, ADR-0078)', () => {
    const exigido = new DivergenceAcknowledgementRequiredError({
        ...chave,
        deltaDias: 7,
        valorBoleto: 102_880,
        vencimentoTitulo: '2026-10-20',
        vencimentoBoleto: '2026-10-27',
        codigoMascarado: '34191…0001',
    });
    const velho = new DivergenceAcknowledgementStaleError({
        ...chave,
        deltaDiasVisto: -3,
        deltaDiasAtual: -1,
        valorBoletoVisto: 102_880,
        valorBoletoAtual: 102_881,
        codigoMascarado: '34191…0001',
    });

    it('são 422, não retentáveis, com código estável e message em inglês', () => {
        expect(exigido.statusCode).toBe(422);
        expect(exigido.code).toBe('RECONHECIMENTO_DE_DIVERGENCIA_OBRIGATORIO');
        expect(exigido.message).toMatch(/^Divergence acknowledgement required/);
        expect(velho.statusCode).toBe(422);
        expect(velho.code).toBe('RECONHECIMENTO_DE_DIVERGENCIA_DESATUALIZADO');
        expect(velho.message).toMatch(/^Divergence acknowledgement stale/);
        expect(exigido.retryable).toBe(false);
        expect(velho.retryable).toBe(false);
    });

    it('a mensagem ao operador está em português, com Δ com sinal, valor e código mascarado', () => {
        expect(exigido.userMessage).toContain('+7 dias');
        expect(exigido.userMessage).toContain('R$ 1.028,80');
        expect(exigido.userMessage).toContain('27/10/2026');
        expect(exigido.userMessage).toContain('34191…0001');
        expect(velho.userMessage).toContain('-1 dia');
        expect(velho.userMessage).toContain('-3 dias');
        expect(velho.userMessage).toContain('R$ 1.028,81');
    });

    it('os detalhes nunca carregam barras completas', () => {
        expect(JSON.stringify([exigido.details, velho.details])).not.toMatch(/\d{20,}/);
    });
});
