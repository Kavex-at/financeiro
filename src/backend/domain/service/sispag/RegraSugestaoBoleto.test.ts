import 'reflect-metadata';
import type { AvaliacaoSugestao } from '../../interface/sispag/SugestaoBoleto.js';
import RegraSugestaoBoleto, {
    DIAS_DEPOIS_MAX,
    DIAS_DEPOIS_MIN,
    LIMITE_VALOR_MESMO_DIA,
} from './RegraSugestaoBoleto.js';

const regra = new RegraSugestaoBoleto();

interface Caso {
    valorTitulo?: number;
    valorBoleto?: number;
    vencTitulo?: string;
    vencBoleto?: string;
    /** Sem lote = vencimento do título (Q-C). */
    dataDebito?: string;
    par?: boolean;
    numeroTitulo?: string;
    numeroBoleto?: string;
}

const avaliar = (c: Caso): AvaliacaoSugestao => {
    const vencTitulo = c.vencTitulo ?? '2026-10-20';
    return regra.avaliar({
        titulo: {
            valor: c.valorTitulo ?? 100,
            vencimento: vencTitulo,
            ...(c.numeroTitulo ? { numeroDocumento: c.numeroTitulo } : {}),
        },
        boleto: {
            valor: c.valorBoleto ?? c.valorTitulo ?? 100,
            vencimento: c.vencBoleto ?? vencTitulo,
            ...(c.numeroBoleto ? { numero: c.numeroBoleto } : {}),
        },
        dataDebito: c.dataDebito ?? vencTitulo,
        parConfirmado: c.par ?? false,
    });
};

describe('RegraSugestaoBoleto — limites globais (I15c)', () => {
    it('expõe os limites como constantes de código', () => {
        expect(LIMITE_VALOR_MESMO_DIA).toBe(0.05);
        expect(DIAS_DEPOIS_MIN).toBe(1);
        expect(DIAS_DEPOIS_MAX).toBe(5);
    });

    it('valor igual e mesmo dia → FORTE (sem par) e CONHECIDO (com par vigente)', () => {
        expect(avaliar({}).resultado).toBe('FORTE');
        expect(avaliar({ par: true }).resultado).toBe('CONHECIDO');
        expect(avaliar({}).sinais).toEqual(['VALOR_IGUAL', 'MESMO_DIA']);
        expect(avaliar({}).confirmavel).toBe(true);
    });

    it('NELSON: +R$ 0,01 no mesmo dia → FORTE, delta com sinal', () => {
        const r = avaliar({ valorTitulo: 93.4, valorBoleto: 93.41 });
        expect(r.resultado).toBe('FORTE');
        expect(r.deltaValor).toBe(0.01);
        expect(r.deltaDias).toBe(0);
        expect(r.sinais).toContain('VALOR_ATE_5_CENTAVOS');
    });

    it('centavos em inteiros: 0,1 + 0,2 não vaza ruído de ponto flutuante', () => {
        const r = avaliar({ valorTitulo: 0.1, valorBoleto: 0.3 });
        expect(r.deltaValor).toBe(0.2);
        expect(avaliar({ valorTitulo: 10.1, valorBoleto: 10.15 }).resultado).toBe('FORTE');
        expect(avaliar({ valorTitulo: 10.1, valorBoleto: 10.16 }).resultado).toBe('ATENCAO');
    });

    it('±R$ 0,05 no mesmo dia é seguro nos dois sentidos; R$ 0,06 vira ATENCAO', () => {
        expect(avaliar({ valorBoleto: 100.05 }).resultado).toBe('FORTE');
        expect(avaliar({ valorBoleto: 99.95 }).resultado).toBe('FORTE');
        const r = avaliar({ valorBoleto: 100.06 });
        expect(r.resultado).toBe('ATENCAO');
        expect(r.deltaValor).toBe(0.06);
    });

    it('AR SOLUÇÕES: valor igual, +1 a +3 dias → FORTE (e até +5)', () => {
        for (const dias of [1, 2, 3, 5]) {
            const r = avaliar({
                vencTitulo: '2026-10-20',
                vencBoleto: `2026-10-${20 + dias}`,
            });
            expect(r.resultado).toBe('FORTE');
            expect(r.deltaDias).toBe(dias);
            expect(r.sinais).toEqual(['VALOR_IGUAL', 'DIAS_DEPOIS']);
        }
    });

    it('+6 dias com valor igual → ATENCAO', () => {
        const r = avaliar({ vencBoleto: '2026-10-26' });
        expect(r.resultado).toBe('ATENCAO');
        expect(r.deltaDias).toBe(6);
    });

    it('centavos E dias depois não combinam: +R$ 0,01 e +1 dia → ATENCAO', () => {
        expect(avaliar({ valorBoleto: 100.01, vencBoleto: '2026-10-21' }).resultado).toBe(
            'ATENCAO',
        );
    });

    it('+1,6 % e +R$ 10,00 → ATENCAO com a diferença com sinal e em %', () => {
        const pct = avaliar({ valorTitulo: 1000, valorBoleto: 1016 });
        expect(pct.resultado).toBe('ATENCAO');
        expect(pct.deltaValor).toBe(16);
        expect(pct.deltaPercentual).toBe(1.6);
        const abs = avaliar({ valorTitulo: 500, valorBoleto: 510 });
        expect(abs.resultado).toBe('ATENCAO');
        expect(abs.deltaValor).toBe(10);
        expect(abs.confirmavel).toBe(true);
    });

    it('boleto mais barato que o título: delta negativo, com sinal', () => {
        const r = avaliar({ valorTitulo: 1000, valorBoleto: 990 });
        expect(r.deltaValor).toBe(-10);
        expect(r.deltaPercentual).toBe(-1);
        expect(r.resultado).toBe('ATENCAO');
    });

    it('muito longe (R$ 500, 60 dias) não é candidato → SEM_RELACAO, não confirmável', () => {
        const r = avaliar({ valorBoleto: 600, vencBoleto: '2026-12-20' });
        expect(r.resultado).toBe('SEM_RELACAO');
        expect(r.confirmavel).toBe(false);
    });
});

describe('RegraSugestaoBoleto — o par nunca alarga limite (I15d)', () => {
    it('par vigente + Δ = +R$ 10 → ATENCAO, nunca CONHECIDO', () => {
        const r = avaliar({ valorTitulo: 500, valorBoleto: 510, par: true });
        expect(r.resultado).toBe('ATENCAO');
        expect(r.sinais).toContain('EMISSOR_CONFIRMADO');
    });

    it('par vigente + 6 dias depois → ATENCAO', () => {
        expect(avaliar({ vencBoleto: '2026-10-26', par: true }).resultado).toBe('ATENCAO');
    });

    it('par vigente não livra o vencido', () => {
        const r = avaliar({ vencBoleto: '2026-10-19', par: true });
        expect(r.resultado).toBe('VENCIDO_INFORMATIVO');
    });
});

describe('RegraSugestaoBoleto — boleto vencido na data de débito (I15h)', () => {
    it('valor igual, 1 dia ANTES do título, sem lote → VENCIDO_INFORMATIVO, não confirmável', () => {
        const r = avaliar({ vencTitulo: '2026-10-20', vencBoleto: '2026-10-19' });
        expect(r.resultado).toBe('VENCIDO_INFORMATIVO');
        expect(r.confirmavel).toBe(false);
        expect(r.deltaDias).toBe(-1);
    });

    it('com lote pagando ANTES do vencimento do título, o mesmo boleto deixa de ser vencido', () => {
        // data de débito do lote = 15/10; o boleto vence 19/10 (>= débito), 1 dia antes do título
        const r = avaliar({
            vencTitulo: '2026-10-20',
            vencBoleto: '2026-10-19',
            dataDebito: '2026-10-15',
        });
        expect(r.resultado).toBe('ATENCAO');
        expect(r.deltaDias).toBe(-1);
    });

    it('valor igual, +1 dia depois do título mas ANTES da data de débito do lote → VENCIDO', () => {
        const r = avaliar({
            vencTitulo: '2026-10-20',
            vencBoleto: '2026-10-21',
            dataDebito: '2026-10-22',
        });
        expect(r.resultado).toBe('VENCIDO_INFORMATIVO');
    });

    it('data de débito ajustada (fim de semana): vencimento sábado, débito segunda', () => {
        // 2026-10-31 é sábado; o lote debita na segunda 2026-11-02 (I8)
        const base = { vencTitulo: '2026-10-31', dataDebito: '2026-11-02' };
        expect(avaliar({ ...base, vencBoleto: '2026-10-31' }).resultado).toBe(
            'VENCIDO_INFORMATIVO',
        );
        // boleto vence na segunda: +2 dias, valor igual, não antes do débito → FORTE
        const r = avaliar({ ...base, vencBoleto: '2026-11-02' });
        expect(r.resultado).toBe('FORTE');
        expect(r.deltaDias).toBe(2);
    });

    it('virada de mês: 30/09 → 02/10 conta 2 dias', () => {
        const r = avaliar({ vencTitulo: '2026-09-30', vencBoleto: '2026-10-02' });
        expect(r.deltaDias).toBe(2);
        expect(r.resultado).toBe('FORTE');
    });
});

describe('RegraSugestaoBoleto — número do documento é sinal de apoio (I15f)', () => {
    it('número igual dentro dos limites só adiciona o sinal', () => {
        const r = avaliar({ numeroTitulo: '001532761', numeroBoleto: '1532761' });
        expect(r.resultado).toBe('FORTE');
        expect(r.sinais).toContain('NUMERO_IGUAL');
        expect(r.sinais).not.toContain('COLISAO_NUMERO');
    });

    it('número igual com valor/data fora do limite NÃO sobe o tier e é colisão', () => {
        const r = avaliar({ valorBoleto: 110, numeroTitulo: '5046', numeroBoleto: '5046' });
        expect(r.resultado).toBe('ATENCAO');
        expect(r.sinais).toEqual(expect.arrayContaining(['NUMERO_IGUAL', 'COLISAO_NUMERO']));
    });

    it('número igual, mas longe demais, continua SEM_RELACAO', () => {
        const r = avaliar({ valorBoleto: 900, numeroTitulo: '5046', numeroBoleto: '5046' });
        expect(r.resultado).toBe('SEM_RELACAO');
        expect(r.sinais).toContain('COLISAO_NUMERO');
    });

    it('número ausente em qualquer lado não penaliza', () => {
        expect(avaliar({ numeroTitulo: '5046' }).resultado).toBe('FORTE');
        expect(avaliar({ numeroBoleto: '5046' }).resultado).toBe('FORTE');
    });

    it('números diferentes não geram sinal nem penalizam', () => {
        const r = avaliar({ numeroTitulo: '5046', numeroBoleto: '5047' });
        expect(r.resultado).toBe('FORTE');
        expect(r.sinais).not.toContain('NUMERO_IGUAL');
    });
});

describe('RegraSugestaoBoleto — entrada inválida', () => {
    it('data inválida → SEM_RELACAO, sem lançar', () => {
        expect(() => avaliar({ vencBoleto: 'nao-e-data' })).not.toThrow();
        expect(avaliar({ vencBoleto: 'nao-e-data' }).resultado).toBe('SEM_RELACAO');
    });

    it('título de valor zero não divide por zero', () => {
        const r = avaliar({ valorTitulo: 0, valorBoleto: 0 });
        expect(r.deltaPercentual).toBe(0);
    });
});
