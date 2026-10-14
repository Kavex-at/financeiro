import BoletoCodigoBarrasRetiradaIncompletaError, {
    MOTIVO_LEDGER_LIMPEZA_INCOMPLETA,
} from './BoletoCodigoBarrasRetiradaIncompletaError.js';
import BoletoLoteEsvaziadoPorCodigoError from './BoletoLoteEsvaziadoPorCodigoError.js';

// Código SINTÉTICO de 44/47 dígitos; nunca um código real.
const BARRAS = '34191158000001412001090047729099260408340000';
const LINHA = '34191090044772909926704083400001115800000141200';

describe('BoletoCodigoBarrasRetiradaIncompletaError', () => {
    const limpeza = new BoletoCodigoBarrasRetiradaIncompletaError({
        modo: 'limpeza',
        flpCod: 31,
        retirados: 3,
        pendentes: [
            { docCod: '6172', titCod: '1' },
            { docCod: '6173', titCod: '1' },
        ],
        restantesNoRascunho: 2,
    });

    it('é um HandlerError 409 não retentável com code estável', () => {
        expect(limpeza.code).toBe('BOLETO_CODIGO_BARRAS_RETIRADA_INCOMPLETA');
        expect(limpeza.statusCode).toBe(409);
        expect(limpeza.retryable).toBe(false);
        expect(limpeza.name).toBe('BoletoCodigoBarrasRetiradaIncompletaError');
        expect(limpeza).toBeInstanceOf(Error);
    });

    it('limpeza: message leva o motivo do ledger e os títulos pendentes, em inglês de identificador', () => {
        expect(limpeza.message).toContain(MOTIVO_LEDGER_LIMPEZA_INCOMPLETA);
        expect(limpeza.message).toContain('6172/1');
        expect(limpeza.message).toContain('flpCod 31');
    });

    it('limpeza: userMessage pt-BR diz o que saiu, o que falta, o rascunho e que nada foi ao banco', () => {
        const m = limpeza.userMessage;
        expect(m).toMatch(/3 título\(s\) já saíram/);
        expect(m).toMatch(/2 ainda precisam sair/);
        expect(m).toContain('6172/1');
        expect(m).toMatch(/ainda contém 2 item/);
        expect(m).toMatch(/Nada foi enviado ao banco/);
        expect(m).toMatch(/Gere a remessa de novo/);
        expect(m).toMatch(/Lote nativo no Conexos: 31/);
    });

    it('leitura: nada foi retirado, causa estável, sem promessa de limpeza', () => {
        const err = new BoletoCodigoBarrasRetiradaIncompletaError({
            modo: 'leitura',
            flpCod: 31,
            causa: 'LISTA_TRUNCADA',
            pendentes: [{ docCod: '6172', titCod: '1' }],
        });
        expect(err.code).toBe('BOLETO_CODIGO_BARRAS_RETIRADA_INCOMPLETA');
        expect((err.details as { causa: string }).causa).toBe('LISTA_TRUNCADA');
        expect(err.userMessage).toMatch(/nenhum título foi retirado/);
        expect(err.userMessage).toMatch(/nada foi enviado ao banco/);
        expect(err.message).toContain('LISTA_TRUNCADA');
    });

    it('privacidade: código de 44/47 dígitos injetado em texto livre é saneado em todas as saídas', () => {
        const hostil = new BoletoCodigoBarrasRetiradaIncompletaError({
            modo: 'limpeza',
            retirados: 1,
            pendentes: [{ docCod: BARRAS, titCod: LINHA }],
        });
        const saidas = [
            hostil.message,
            hostil.userMessage,
            JSON.stringify(hostil.details),
            String(hostil.stack),
        ];
        for (const s of saidas) {
            expect(s).not.toMatch(/\d{10,}/);
            expect(s).not.toContain(BARRAS);
            expect(s).not.toContain(LINHA);
        }
    });

    it('lista no máximo 20 títulos na mensagem e resume o resto', () => {
        const pendentes = Array.from({ length: 25 }, (_, i) => ({
            docCod: String(1000 + i),
            titCod: '1',
        }));
        const err = new BoletoCodigoBarrasRetiradaIncompletaError({
            modo: 'limpeza',
            retirados: 0,
            pendentes,
        });
        expect(err.message).toContain('(+5)');
        expect(err.message).not.toContain('1020/1');
        expect((err.details as { pendentes: unknown[] }).pendentes).toHaveLength(25);
    });
});

describe('BoletoLoteEsvaziadoPorCodigoError', () => {
    const err = new BoletoLoteEsvaziadoPorCodigoError({
        loteId: 'L1',
        flpCod: 31,
        itens: [{ docCod: '6171', titCod: '1', motivo: 'CODIGO_BARRAS_ILEGIVEL' }],
    });

    it('409 não retentável, code estável, sem código na mensagem', () => {
        expect(err.code).toBe('BOLETO_LOTE_ESVAZIADO_POR_CODIGO');
        expect(err.statusCode).toBe(409);
        expect(err.retryable).toBe(false);
        expect(err.message).toContain('6171/1=CODIGO_BARRAS_ILEGIVEL');
        expect(err.userMessage).toMatch(/Nada foi enviado ao banco/);
        expect(err.userMessage).toMatch(/Lote nativo no Conexos: 31/);
        expect(err.userMessage).not.toMatch(/\d{10,}/);
    });
});
