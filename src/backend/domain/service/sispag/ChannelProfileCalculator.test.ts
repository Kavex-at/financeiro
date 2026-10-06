import 'reflect-metadata';
import {
    CHANNEL_CONFIDENCE,
    CHANNEL_GROUP,
    type ChannelPayment,
    type StatementDebit,
} from '../../interface/sispag/SispagInterface.js';
import ChannelProfileCalculator from './ChannelProfileCalculator.js';

/**
 * PerfilCanalFornecedor (ADR-0063, I13i): baixa a pagar (fin010) casada com débito do extrato
 * (fin095) por valor exato e data ±1,5 dia; só casamento ÚNICO conta. Puro.
 */

const DIA = 86_400_000;
const LIMIARES = { minPagamentos: 5, minMeses: 3, minParticipacao: 0.95 };
const JANELA = { inicio: Date.UTC(2025, 9, 1), fim: Date.UTC(2026, 9, 1) };

const mes = (m: number, d = 10): number => Date.UTC(2026, m, d);

/** Uma baixa + o débito que a casa, com o histórico dado. */
const pago = (
    pesCod: string | undefined,
    valor: number,
    data: number,
    historico: string,
): { baixa: ChannelPayment; debito: StatementDebit } => ({
    baixa: { ...(pesCod ? { pesCod } : {}), credor: `F${pesCod ?? '-'}`, valor, data },
    debito: { valor, data, historico },
});

const calc = new ChannelProfileCalculator();

const montar = (
    pares: Array<{ baixa: ChannelPayment; debito: StatementDebit }>,
    extras: StatementDebit[] = [],
    limiares = LIMIARES,
) =>
    calc.calcular({
        baixas: pares.map((p) => p.baixa),
        debitos: [...pares.map((p) => p.debito), ...extras],
        limiares,
        janela: JANELA,
    });

describe('ChannelProfileCalculator — grupo pelo histórico do extrato', () => {
    it.each([
        ['PIX ENVIADO FORNECEDOR', CHANNEL_GROUP.TED_PIX],
        ['TED 341 0001 FORNEC', CHANNEL_GROUP.TED_PIX],
        ['DOC ELETRONICO', CHANNEL_GROUP.TED_PIX],
        ['TRANSF ENTRE CONTAS', CHANNEL_GROUP.TED_PIX],
        ['PAGTO TITULO 123', CHANNEL_GROUP.BOLETO],
        ['SISPAG BOLETO', CHANNEL_GROUP.BOLETO],
        ['COBRANCA ITAU', CHANNEL_GROUP.BOLETO],
        ['DARF 0561', CHANNEL_GROUP.OUTROS],
        ['SISPAG FORNECEDORES', CHANNEL_GROUP.OUTROS],
        ['TARIFA', CHANNEL_GROUP.OUTROS],
        [undefined, CHANNEL_GROUP.OUTROS],
    ])('%s → %s', (historico, grupo) => {
        expect(calc.grupoDoHistorico(historico)).toBe(grupo);
    });
});

describe('ChannelProfileCalculator — casamento baixa × débito', () => {
    it('casamento único conta: 5 boletos em 3 meses → ALTA, dominante BOLETO, por pesCod', () => {
        const r = montar([
            pago('10', 100, mes(0), 'PAGTO TITULO'),
            pago('10', 200, mes(1), 'PAGTO TITULO'),
            pago('10', 300, mes(2), 'PAGTO TITULO'),
            pago('10', 400, mes(2, 20), 'PAGTO TITULO'),
            pago('10', 500, mes(1, 20), 'PAGTO TITULO'),
        ]);
        expect(r.perfis).toHaveLength(1);
        expect(r.perfis[0]).toMatchObject({
            pesCod: '10',
            grupoDominante: CHANNEL_GROUP.BOLETO,
            confianca: CHANNEL_CONFIDENCE.ALTA,
            pagamentosUnicos: 5,
            mesesDistintos: 3,
            participacao: 1,
            contagens: { BOLETO: 5, TED_PIX: 0, OUTROS: 0 },
            janelaInicio: JANELA.inicio,
            janelaFim: JANELA.fim,
        });
    });

    it('casamento ambíguo (dois débitos do mesmo valor na janela) é descartado', () => {
        const r = montar(
            [pago('10', 100, mes(0), 'PAGTO TITULO'), pago('10', 777, mes(1), 'PAGTO TITULO')],
            [{ valor: 777, data: mes(1) + DIA, historico: 'PIX ENVIADO' }],
        );
        expect(r.ambiguos).toBe(1);
        expect(r.perfis[0]?.pagamentosUnicos).toBe(1);
        expect(r.perfis[0]?.contagens).toEqual({ BOLETO: 1, TED_PIX: 0, OUTROS: 0 });
    });

    it('data a ±1,5 dia: 1,4 dia casa, 1,6 dia não', () => {
        const baixas: ChannelPayment[] = [
            { pesCod: '10', valor: 100, data: mes(0) },
            { pesCod: '10', valor: 200, data: mes(1) },
        ];
        const debitos: StatementDebit[] = [
            { valor: 100, data: mes(0) + 1.4 * DIA, historico: 'PAGTO TITULO' },
            { valor: 200, data: mes(1) + 1.6 * DIA, historico: 'PAGTO TITULO' },
        ];
        const r = calc.calcular({ baixas, debitos, limiares: LIMIARES, janela: JANELA });
        expect(r.perfis[0]?.pagamentosUnicos).toBe(1);
        expect(r.semDebito).toBe(1);
    });

    it('valor exato: 100,00 não casa com 100,01', () => {
        const r = calc.calcular({
            baixas: [{ pesCod: '10', valor: 100, data: mes(0) }],
            debitos: [{ valor: 100.01, data: mes(0), historico: 'PIX' }],
            limiares: LIMIARES,
            janela: JANELA,
        });
        expect(r.perfis).toEqual([]);
        expect(r.semDebito).toBe(1);
    });

    it('um débito casa uma baixa só', () => {
        const r = calc.calcular({
            baixas: [
                { pesCod: '10', valor: 100, data: mes(0) },
                { pesCod: '20', valor: 100, data: mes(0) },
            ],
            debitos: [{ valor: 100, data: mes(0), historico: 'PIX' }],
            limiares: LIMIARES,
            janela: JANELA,
        });
        expect(r.perfis.map((p) => p.pesCod)).toEqual(['10']);
        expect(r.semDebito).toBe(1);
    });

    it('baixa sem pesCod não entra em perfil nenhum (o perfil é chaveado por pesCod, Q4)', () => {
        const r = montar([pago(undefined, 100, mes(0), 'PIX')]);
        expect(r.perfis).toEqual([]);
        expect(r.semFavorecido).toBe(1);
    });
});

describe('ChannelProfileCalculator — confiança (limiares injetados)', () => {
    const cincoEm3Meses = (historicos: string[]) =>
        historicos.map((h, i) => pago('10', 100 + i, mes(i % 3, 5 + i), h));

    it('PIX e TED/DOC/TRANSF caem no MESMO grupo TED_PIX', () => {
        const r = montar(cincoEm3Meses(['PIX', 'TED', 'DOC X', 'TRANSF', 'PIX']));
        expect(r.perfis[0]).toMatchObject({
            grupoDominante: CHANNEL_GROUP.TED_PIX,
            confianca: CHANNEL_CONFIDENCE.ALTA,
        });
    });

    it('tributo e SISPAG sem canal vão para OUTROS', () => {
        const r = montar(cincoEm3Meses(['DARF', 'SISPAG', 'GPS', 'TARIFA', 'DARF']));
        expect(r.perfis[0]?.grupoDominante).toBe(CHANNEL_GROUP.OUTROS);
    });

    it('menos pagamentos que o mínimo injetado → não é ALTA', () => {
        const pares = cincoEm3Meses([
            'PAGTO TITULO',
            'PAGTO TITULO',
            'PAGTO TITULO',
            'PAGTO TITULO',
            'PAGTO TITULO',
        ]);
        expect(montar(pares).perfis[0]?.confianca).toBe(CHANNEL_CONFIDENCE.ALTA);
        expect(montar(pares, [], { ...LIMIARES, minPagamentos: 6 }).perfis[0]?.confianca).toBe(
            CHANNEL_CONFIDENCE.MEDIA,
        );
    });

    it('menos meses distintos que o mínimo → não é ALTA', () => {
        const pares = [0, 1, 2, 3, 4].map((i) =>
            pago('10', 100 + i, mes(0, 1 + i), 'PAGTO TITULO'),
        );
        const r = montar(pares);
        expect(r.perfis[0]?.mesesDistintos).toBe(1);
        expect(r.perfis[0]?.confianca).not.toBe(CHANNEL_CONFIDENCE.ALTA);
    });

    it('participação: 19 de 20 (0,95) é ALTA; 18 de 20 não', () => {
        const historicos = (boletos: number) =>
            Array.from({ length: 20 }, (_, i) => (i < boletos ? 'PAGTO TITULO' : 'PIX'));
        const pares = (boletos: number) =>
            historicos(boletos).map((h, i) => pago('10', 100 + i, mes(i % 4, 1 + i), h));
        expect(montar(pares(19)).perfis[0]).toMatchObject({
            confianca: CHANNEL_CONFIDENCE.ALTA,
            participacao: 0.95,
        });
        expect(montar(pares(18)).perfis[0]?.confianca).not.toBe(CHANNEL_CONFIDENCE.ALTA);
    });

    it('perfis separados por favorecido', () => {
        const r = montar([
            ...[0, 1, 2, 3, 4].map((i) => pago('10', 100 + i, mes(i % 3, 3 + i), 'PAGTO TITULO')),
            ...[0, 1, 2, 3, 4].map((i) => pago('20', 900 + i, mes(i % 3, 3 + i), 'PIX')),
        ]);
        const por = new Map(r.perfis.map((p) => [p.pesCod, p.grupoDominante]));
        expect(por.get('10')).toBe(CHANNEL_GROUP.BOLETO);
        expect(por.get('20')).toBe(CHANNEL_GROUP.TED_PIX);
    });
});
