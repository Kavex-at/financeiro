import ItemEditadoPorTerceiroError from './ItemEditadoPorTerceiroError.js';
import VinculoCodigoBarrasDivergenteError from './VinculoCodigoBarrasDivergenteError.js';
import VinculoCodigoBarrasIncompletoError, {
    MOTIVO_LEDGER_VINCULO_INCOMPLETO,
} from './VinculoCodigoBarrasIncompletoError.js';

// Códigos SINTÉTICOS de 44/47 dígitos, para provar que nada disto os deixa passar.
const BARRAS = '34191158000001412001090047729099260408340000';
const LINHA = '34191090044772909926704083400001115800000141200';

describe('VinculoCodigoBarrasIncompletoError (I17g(2))', () => {
    const err = new VinculoCodigoBarrasIncompletoError({
        flpCod: 36,
        vinculados: [{ docCod: '6172', titCod: '1' }],
        pendentes: [
            { docCod: '6173', titCod: '1' },
            { docCod: '6174', titCod: '1' },
        ],
        causa: 'TRANSITORIA',
        codigoMascarado: '34191…0000',
    });

    it('é HandlerError 409 retomável com code estável', () => {
        expect(err.code).toBe('VINCULO_CODIGO_BARRAS_INCOMPLETO');
        expect(err.statusCode).toBe(409);
        expect(err.retryable).toBe(true);
        expect(err.name).toBe('VinculoCodigoBarrasIncompletoError');
        expect(err).toBeInstanceOf(Error);
    });

    it('message em inglês de identificador, com o rótulo do ledger e os pendentes', () => {
        expect(err.message).toContain(MOTIVO_LEDGER_VINCULO_INCOMPLETO);
        expect(err.message).toContain('6173/1');
        expect(err.message).toContain('flpCod 36');
    });

    it('userMessage pt-BR: o que já vinculou, o que falta, nada foi ao banco, reexecutar retoma', () => {
        const m = err.userMessage;
        expect(m).toMatch(/1 título\(s\) já ficaram vinculados/);
        expect(m).toMatch(/2 ainda faltam/);
        expect(m).toContain('6173/1');
        expect(m).toMatch(/Nada foi enviado ao banco/);
        expect(m).toMatch(/rascunho foi preservado/);
        expect(m).toMatch(/retoma de onde parou/);
        expect(m).toContain('34191…0000');
    });

    it('saneia texto livre: 44 e 47 dígitos nunca chegam a message, userMessage ou details', () => {
        const sujo = new VinculoCodigoBarrasIncompletoError({
            vinculados: [{ docCod: BARRAS, titCod: LINHA }],
            pendentes: [{ docCod: `x${BARRAS}`, titCod: '1' }],
            causa: `falha ${LINHA} em ${BARRAS}`,
            codigoMascarado: BARRAS,
        });
        const tudo = JSON.stringify([sujo.message, sujo.userMessage, sujo.details]);
        expect(tudo).not.toMatch(/\d{10,}/);
    });
});

describe('VinculoCodigoBarrasDivergenteError (I17d/I17g(3))', () => {
    it('diz título, valores, Δ com sinal e a máscara; é 409 não retentável', () => {
        const err = new VinculoCodigoBarrasDivergenteError({
            docCod: '757',
            titCod: '1',
            campo: 'VALOR',
            esperadoCentavos: 102880,
            obtidoCentavos: 102881,
            deltaDias: 3,
            codigoMascarado: '34191…0000',
        });
        expect(err.code).toBe('VINCULO_CODIGO_BARRAS_DIVERGENTE');
        expect(err.statusCode).toBe(409);
        expect(err.retryable).toBe(false);
        expect(err.userMessage).toContain('757/1');
        expect(err.userMessage).toContain('R$ 1028,80');
        expect(err.userMessage).toContain('R$ 1028,81');
        expect(err.userMessage).toMatch(/\+1 centavo/);
        expect(err.userMessage).toMatch(/\+3 dia/);
        expect(err.userMessage).toContain('34191…0000');
        expect(err.userMessage).toMatch(/Nada foi enviado ao banco/);
    });

    it('Δ negativo mostra o sinal e dígitos longos são saneados', () => {
        const err = new VinculoCodigoBarrasDivergenteError({
            docCod: BARRAS,
            titCod: '1',
            campo: 'DATA',
            esperadoCentavos: 100,
            obtidoCentavos: 99,
            deltaDias: -2,
            codigoMascarado: LINHA,
        });
        expect(err.userMessage).toMatch(/-1 centavo/);
        expect(err.userMessage).toMatch(/-2 dia/);
        expect(JSON.stringify([err.message, err.userMessage, err.details])).not.toMatch(/\d{10,}/);
    });
});

describe('ItemEditadoPorTerceiroError (I17f)', () => {
    const err = new ItemEditadoPorTerceiroError({
        docCod: '636',
        titCod: '1',
        campo: 'CODIGO',
        flpCod: 36,
    });

    it('é 409, não retentável, etapa indeterminado', () => {
        expect(err.code).toBe('ITEM_EDITADO_POR_TERCEIRO');
        expect(err.statusCode).toBe(409);
        expect(err.retryable).toBe(false);
        expect((err.details as { etapa: string }).etapa).toBe('indeterminado');
    });

    it('diz qual campo divergiu sem expor o código, e que nada foi sobrescrito', () => {
        expect(err.userMessage).toMatch(/636\/1/);
        expect(err.userMessage).toMatch(/código de barras do item é diferente/);
        expect(err.userMessage).toMatch(/nada foi sobrescrito nem retirado/);
        expect(err.userMessage).toMatch(/Lote nativo no Conexos: 36/);
        expect(JSON.stringify([err.message, err.userMessage, err.details])).not.toMatch(/\d{10,}/);
    });
});
