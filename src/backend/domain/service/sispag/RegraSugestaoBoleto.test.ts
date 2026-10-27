import 'reflect-metadata';
import type { AvaliacaoSugestao } from '../../interface/sispag/SugestaoBoleto.js';
import RegraSugestaoBoleto, {
    DIAS_DEPOIS_MAX,
    DIAS_DEPOIS_MIN,
    LIMITE_VALOR_MESMO_DIA,
    NUMERO_CONFIAVEL_MIN_DIGITOS,
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
    dps?: string;
    ordemDps?: boolean;
}

const avaliar = (c: Caso): AvaliacaoSugestao => {
    const vencTitulo = c.vencTitulo ?? '2026-10-20';
    return regra.avaliar({
        titulo: {
            valor: c.valorTitulo ?? 100,
            vencimento: vencTitulo,
            ...(c.numeroTitulo ? { numeroDocumento: c.numeroTitulo } : {}),
            ...(c.dps ? { dps: c.dps } : {}),
        },
        boleto: {
            valor: c.valorBoleto ?? c.valorTitulo ?? 100,
            vencimento: c.vencBoleto ?? vencTitulo,
            ...(c.numeroBoleto ? { numero: c.numeroBoleto } : {}),
        },
        dataDebito: c.dataDebito ?? vencTitulo,
        parConfirmado: c.par ?? false,
        ...(c.ordemDps ? { ordemDps: true } : {}),
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
        // ADR-0078: a barra de sábado vence no próximo dia útil (segunda) ⇒ NÃO está vencida no débito.
        expect(avaliar({ ...base, vencBoleto: '2026-10-31' }).resultado).toBe('FORTE');
        // Barra de sexta (dia útil, sem rolagem) com débito na segunda segue vencida.
        expect(avaliar({ ...base, vencBoleto: '2026-10-30' }).resultado).toBe(
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

describe('RegraSugestaoBoleto — aviso VENCE_ANTES_DO_TITULO (I15o, ADR-0072)', () => {
    it.each([
        [-1, '2026-10-19'],
        [-8, '2026-10-12'],
    ])('Δdias = %i dentro do envelope emite o sinal', (delta, venc) => {
        const r = avaliar({ vencBoleto: venc, dataDebito: '2026-10-11' });
        expect(r.deltaDias).toBe(delta);
        expect(r.sinais).toContain('VENCE_ANTES_DO_TITULO');
    });

    it.each([
        [0, '2026-10-20'],
        [1, '2026-10-21'],
        [5, '2026-10-25'],
    ])('Δdias = %i não emite o sinal', (delta, venc) => {
        const r = avaliar({ vencBoleto: venc });
        expect(r.deltaDias).toBe(delta);
        expect(r.sinais).not.toContain('VENCE_ANTES_DO_TITULO');
    });

    it('caso A: boleto antes da data de débito → VENCIDO_INFORMATIVO, não confirmável, com dias de atraso', () => {
        // título 20/10, boleto 15/10 (quinta, dia útil), débito 20/10 → vencido há 5 dias no débito
        const r = avaliar({ vencBoleto: '2026-10-15', dataDebito: '2026-10-20' });
        expect(r.resultado).toBe('VENCIDO_INFORMATIVO');
        expect(r.confirmavel).toBe(false);
        expect(r.sinais).toContain('VENCE_ANTES_DO_TITULO');
        expect(r.diasVencidoNoDebito).toBe(5);
    });

    it('caso B: Δ < 0, boleto ainda vale no débito antecipado → ATENCAO, sinal, 0 dia vencido', () => {
        // título 20/10, boleto 18/10, débito 15/10 (antecipado) → boleto ≥ débito
        const r = avaliar({ vencBoleto: '2026-10-18', dataDebito: '2026-10-15' });
        expect(r.resultado).toBe('ATENCAO');
        expect(r.sinais).toContain('VENCE_ANTES_DO_TITULO');
        expect(r.diasVencidoNoDebito).toBe(0);
    });

    it('Δ ≥ 0 e boleto em dia: diasVencidoNoDebito = 0', () => {
        expect(avaliar({}).diasVencidoNoDebito).toBe(0);
    });

    it('o sinal não altera tier, deltas nem confirmavel', () => {
        const casos: Caso[] = [
            { vencBoleto: '2026-10-18', dataDebito: '2026-10-15' },
            { vencBoleto: '2026-10-17', dataDebito: '2026-10-20' },
            { vencBoleto: '2026-10-12', dataDebito: '2026-10-11', valorBoleto: 100.04 },
            { vencBoleto: '2026-10-19', dataDebito: '2026-10-15', par: true },
        ];
        for (const c of casos) {
            const r = avaliar(c);
            const { sinais: _s, diasVencidoNoDebito: _d, ...base } = r;
            // baseline = a regra anterior: Δ<0 nunca é seguro (nem CONHECIDO) e só ATENCAO confirma
            expect(['ATENCAO', 'VENCIDO_INFORMATIVO']).toContain(base.resultado);
            expect(base.confirmavel).toBe(base.resultado === 'ATENCAO');
            expect(r.sinais).toContain('VENCE_ANTES_DO_TITULO');
            // tirar o sinal deixa exatamente os sinais que a regra já emitia (valor/dia/par/número)
            const semSinal = r.sinais.filter((s) => s !== 'VENCE_ANTES_DO_TITULO');
            expect(semSinal).toEqual(
                semSinal.filter((s) =>
                    [
                        'VALOR_IGUAL',
                        'VALOR_ATE_5_CENTAVOS',
                        'MESMO_DIA',
                        'DIAS_DEPOIS',
                        'NUMERO_IGUAL',
                        'COLISAO_NUMERO',
                        'EMISSOR_CONFIRMADO',
                    ].includes(s),
                ),
            );
        }
    });

    it('fora do envelope (SEM_RELACAO) não emite o sinal (Q3)', () => {
        const r = avaliar({ vencBoleto: '2026-10-01', dataDebito: '2026-10-01' });
        expect(r.resultado).toBe('SEM_RELACAO');
        expect(r.sinais).not.toContain('VENCE_ANTES_DO_TITULO');
    });

    it('datas civis UTC meia-noite: o dia não desloca', () => {
        const r = avaliar({ vencBoleto: '2026-10-19', dataDebito: '2026-10-19' });
        expect(r.deltaDias).toBe(-1);
        expect(r.diasVencidoNoDebito).toBe(0);
        expect(r.sinais).toContain('VENCE_ANTES_DO_TITULO');
    });
});

describe('RegraSugestaoBoleto — âncora DPS (I15p, ADR-0073)', () => {
    // Caso real (2026-10-19): título 41155/1, NFS-e 86666, DPS 776132, boleto 776132000, +8 dias.
    const multilog = {
        valorTitulo: 147.99,
        vencTitulo: '2026-10-16',
        vencBoleto: '2026-10-24',
        numeroTitulo: '86666',
        numeroBoleto: '776132000',
    };

    it('número do boleto = DPS + 000 → DPS_IGUAL, sem subir o tier (+8 dias segue ATENCAO)', () => {
        const r = avaliar({ ...multilog, dps: '776132' });
        expect(r.resultado).toBe('ATENCAO');
        expect(r.sinais).toContain('DPS_IGUAL');
        expect(r.sinais).not.toContain('NUMERO_IGUAL');
    });

    it('compara dígitos estritos: zeros à esquerda do boleto não atrapalham', () => {
        expect(avaliar({ ...multilog, dps: '25459', numeroBoleto: '025459000' }).sinais).toContain(
            'DPS_IGUAL',
        );
    });

    it('DPS de outro título (776138) não ancora este boleto', () => {
        expect(avaliar({ ...multilog, dps: '776138' }).sinais).not.toContain('DPS_IGUAL');
    });

    it('sem o sufixo 000 não é DPS_IGUAL (o número do boleto tem de ser exatamente DPS·000)', () => {
        expect(
            avaliar({ ...multilog, dps: '776132', numeroBoleto: '776132' }).sinais,
        ).not.toContain('DPS_IGUAL');
    });

    it('DPS igual não resgata par fora do envelope (I15f por analogia)', () => {
        const r = avaliar({ ...multilog, dps: '776132', vencBoleto: '2026-11-30' });
        expect(r.resultado).toBe('SEM_RELACAO');
        expect(r.sinais).not.toContain('DPS_IGUAL');
    });

    it('ordemDps vira o sinal ORDEM_DPS dentro do envelope, sem subir o tier', () => {
        const r = avaliar({ ...multilog, ordemDps: true });
        expect(r.resultado).toBe('ATENCAO');
        expect(r.sinais).toContain('ORDEM_DPS');
    });

    it('ordemDps não alarga I15h: boleto vencido no débito segue VENCIDO_INFORMATIVO', () => {
        const r = avaliar({ ...multilog, ordemDps: true, dataDebito: '2026-10-27' });
        expect(r.resultado).toBe('VENCIDO_INFORMATIVO');
        expect(r.confirmavel).toBe(false);
    });
});

describe('RegraSugestaoBoleto — prazo final da barra e exigência de reconhecimento (ADR-0078)', () => {
    // 2026-10-20 é terça; 2026-10-24 é sábado; 2026-10-26 é segunda.
    it('barra de sábado com débito na segunda NÃO é vencida (rolagem ao próximo dia útil)', () => {
        const r = avaliar({
            vencTitulo: '2026-10-23',
            vencBoleto: '2026-10-24',
            dataDebito: '2026-10-26',
        });
        expect(r.resultado).not.toBe('VENCIDO_INFORMATIVO');
        expect(r.prazoFinalBoleto).toBe('2026-10-26');
        expect(r.diasVencidoNoDebito).toBe(0);
    });

    it('barra de sábado com débito na terça seguinte É vencida', () => {
        const r = avaliar({
            vencTitulo: '2026-10-23',
            vencBoleto: '2026-10-24',
            dataDebito: '2026-10-27',
        });
        expect(r.resultado).toBe('VENCIDO_INFORMATIVO');
        expect(r.diasVencidoNoDebito).toBe(1);
        expect(r.exigeReconhecimento).toBe('NENHUM');
    });

    it('prazo final de barra em dia útil é o próprio vencimento', () => {
        expect(avaliar({}).prazoFinalBoleto).toBe('2026-10-20');
    });

    it('título não rola: título de sábado com débito no sábado segue sem rolagem', () => {
        const r = avaliar({ vencTitulo: '2026-10-24', vencBoleto: '2026-10-24' });
        expect(r.resultado).toBe('FORTE');
    });

    describe('exigeReconhecimento', () => {
        it.each([
            [-10, 'DATA_DIVERGENTE'],
            [-3, 'DATA_DIVERGENTE'],
            [-1, 'DATA_DIVERGENTE'],
            [0, 'NENHUM'],
            [1, 'NENHUM'],
            [5, 'NENHUM'],
            [6, 'DATA_DIVERGENTE'],
            [7, 'DATA_DIVERGENTE'],
            [10, 'DATA_DIVERGENTE'],
            [11, 'NENHUM'],
            [-11, 'NENHUM'],
        ])('valor igual com Δdias %i ⇒ %s', (delta, esperado) => {
            // Débito antecipado: nunca antes de "hoje" do teste e antes de qualquer barra.
            const venc = '2026-11-10';
            const barra = new Date(Date.parse(`${venc}T00:00:00Z`) + delta * 86_400_000)
                .toISOString()
                .slice(0, 10);
            const r = avaliar({ vencTitulo: venc, vencBoleto: barra, dataDebito: '2026-10-01' });
            expect(r.exigeReconhecimento).toBe(esperado);
        });

        it('valor diferente (ATENCAO) nunca exige o reconhecimento tipado', () => {
            const r = avaliar({
                valorTitulo: 100,
                valorBoleto: 100.5,
                vencTitulo: '2026-11-10',
                vencBoleto: '2026-11-07',
                dataDebito: '2026-10-01',
            });
            expect(r.resultado).toBe('ATENCAO');
            expect(r.exigeReconhecimento).toBe('NENHUM');
        });

        it('boleto vencido na data de débito nunca exige (segue informativo)', () => {
            const r = avaliar({ vencTitulo: '2026-10-20', vencBoleto: '2026-10-14' });
            expect(r.resultado).toBe('VENCIDO_INFORMATIVO');
            expect(r.exigeReconhecimento).toBe('NENHUM');
        });

        it('fora do envelope (SEM_RELACAO) nunca exige', () => {
            const r = avaliar({
                vencTitulo: '2026-11-10',
                vencBoleto: '2026-12-10',
                dataDebito: '2026-10-01',
            });
            expect(r.resultado).toBe('SEM_RELACAO');
            expect(r.exigeReconhecimento).toBe('NENHUM');
        });
    });

    it('tier, limites e confirmabilidade da tabela atual seguem iguais (regressão)', () => {
        expect(avaliar({ vencBoleto: '2026-10-25', dataDebito: '2026-10-20' }).resultado).toBe(
            'FORTE',
        );
        expect(avaliar({ vencBoleto: '2026-10-26', dataDebito: '2026-10-20' }).resultado).toBe(
            'ATENCAO',
        );
        expect(avaliar({ vencBoleto: '2026-10-26', dataDebito: '2026-10-20' }).confirmavel).toBe(
            true,
        );
    });
});

describe('RegraSugestaoBoleto.normalizarNumero / NUMERO_CONFIAVEL_MIN_DIGITOS (I15s)', () => {
    it('normaliza dígitos sem zeros à esquerda; vazio vira vazio', () => {
        expect(RegraSugestaoBoleto.normalizarNumero('0025037')).toBe('25037');
        expect(RegraSugestaoBoleto.normalizarNumero('NF 25.037-A')).toBe('25037');
        expect(RegraSugestaoBoleto.normalizarNumero(undefined)).toBe('');
        expect(RegraSugestaoBoleto.normalizarNumero('000')).toBe('');
    });

    it('o mínimo de dígitos da âncora de número é 4', () => {
        expect(NUMERO_CONFIAVEL_MIN_DIGITOS).toBe(4);
    });
});
