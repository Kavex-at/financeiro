import 'reflect-metadata';
import SelfConferenceError from '../../errors/SelfConferenceError.js';
import type { ItemLote, LotePagamento } from '../../interface/sispag/SispagInterface.js';
import ConferenciaLoteRule from './ConferenciaLoteRule.js';

const item = (over: Partial<ItemLote> = {}): ItemLote => ({
    loteId: 'L1',
    filCod: 2,
    docCod: '100',
    titCod: '1',
    modalidade: 'BOLETO',
    incluidoPor: 'cron-formacao',
    divergencia: false,
    ...over,
});

const lote = (over: Partial<LotePagamento> = {}): LotePagamento => ({
    id: 'L1',
    filCod: 2,
    status: 'FINALIZADO',
    criadoPor: 'cron-formacao',
    finalizadoPor: 'ana',
    automatico: true,
    versao: 4,
    itens: [item({ modalidade: 'TED' })],
    ...over,
});

const rule = new ConferenciaLoteRule();

describe('ConferenciaLoteRule (ADR-0063, I13l)', () => {
    it('exigeConferencia: ≥1 TED ou PIX; só boleto não exige', () => {
        expect(rule.exigeConferencia(lote())).toBe(true);
        expect(rule.exigeConferencia(lote({ itens: [item(), item({ modalidade: 'PIX' })] }))).toBe(
            true,
        );
        expect(
            rule.exigeConferencia(lote({ itens: [item(), item({ modalidade: undefined })] })),
        ).toBe(false);
        expect(
            rule.exigeConferencia(lote({ itens: [item({ modalidade: 'CREDITO_CONTA' })] })),
        ).toBe(false);
    });

    it('quem finalizou não confere (comparação sem caixa nem espaço)', () => {
        expect(rule.impedimento(lote(), ' ANA ')).toBe('FINALIZOU');
        expect(() => rule.exigirOutraPessoa(lote(), 'ana')).toThrow(SelfConferenceError);
    });

    it('quem incluiu QUALQUER item não confere', () => {
        const l = lote({
            itens: [item({ modalidade: 'TED' }), item({ docCod: '2', incluidoPor: 'caio' })],
        });
        expect(rule.impedimento(l, 'caio')).toBe('INCLUIU_ITEM');
    });

    it('quem criou lote MANUAL não confere; o criador de lote automático (cron) não conta', () => {
        expect(rule.impedimento(lote({ automatico: false, criadoPor: 'dani' }), 'dani')).toBe(
            'CRIOU_LOTE_MANUAL',
        );
        expect(
            rule.impedimento(lote({ automatico: true, criadoPor: 'dani' }), 'dani'),
        ).toBeUndefined();
    });

    it('falha fechada: ator vazio ou "unknown" nunca é outra pessoa', () => {
        expect(rule.impedimento(lote(), '')).toBe('NAO_IDENTIFICADO');
        expect(rule.impedimento(lote(), 'unknown')).toBe('NAO_IDENTIFICADO');
        expect(rule.impedimento(lote(), undefined)).toBe('NAO_IDENTIFICADO');
    });

    it('terceira pessoa pode conferir', () => {
        expect(rule.impedimento(lote(), 'bia')).toBeUndefined();
        expect(() => rule.exigirOutraPessoa(lote(), 'bia')).not.toThrow();
    });

    it('SelfConferenceError é 403 e a mensagem é em português', () => {
        const err = new SelfConferenceError({ loteId: 'L1', impedimento: 'FINALIZOU' });
        expect(err.statusCode).toBe(403);
        expect(err.userMessage).toMatch(/outra pessoa/);
    });
});
