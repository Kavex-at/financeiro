import 'reflect-metadata';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import ConsolidacaoBoletoDda from './ConsolidacaoBoletoDda.js';
import RegraSugestaoBoleto from './RegraSugestaoBoleto.js';

// "Hoje" = 23/09/2026 12h em Brasília.
const calendar = BankingCalendar.withClock(() => new Date('2026-09-23T15:00:00Z'));
const consolidacao = new ConsolidacaoBoletoDda(
    new CodigoBarrasBoleto(),
    calendar,
    new RegraSugestaoBoleto(),
);

const utc = (civil: string): number => Date.parse(`${civil}T00:00:00Z`);

const titulo = (over: Partial<TituloAPagar>): TituloAPagar => ({
    filCod: 1,
    docCod: '1',
    titCod: '1',
    valor: 100,
    liberado: true,
    pago: false,
    ...over,
});

const boleto = (over: Partial<BoletoDda>): BoletoDda => ({
    ddcCod: 152,
    ditCod: 1,
    valor: 100,
    vencimento: '2026-09-25',
    ...over,
});

/** Casos reais de 2026-09-23 (ver `ontology/_inbox/sispag-boleto-dda-tab.md`). */
const ADP = titulo({
    filCod: 1,
    docCod: '5046',
    credor: 'ADP BRASIL LTDA',
    valor: 4815.33,
    vencimento: utc('2026-09-24'),
});
const BOLETO_ADP = boleto({
    ddcCod: 152,
    ditCod: 7,
    numero: '001532761',
    valor: 4815.33,
    vencimento: '2026-09-25',
    codbar: '34193158000004815331090113433700004286589000',
    arquivo: 'VAR_341_0641_55795_10092600.RET',
});

describe('ConsolidacaoBoletoDda', () => {
    it('ADP 5046/1: boleto livre de mesmo valor, 1 dia depois → CANDIDATO com a diferença', () => {
        const [linha] = consolidacao.consolidar({
            boletos: [BOLETO_ADP],
            titulos: [ADP],
            titulosEmLote: [
                { filCod: 1, docCod: '5046', titCod: '1', loteId: 'L-ADP', status: 'FINALIZADO' },
            ],
        });
        expect(linha).toMatchObject({
            situacao: 'CANDIDATO',
            vencido: false,
            bancoEmissor: '341',
            linhaDigitavel: expect.stringMatching(/^\d{47}$/),
            candidatos: [
                {
                    docCod: '5046',
                    credor: 'ADP BRASIL LTDA',
                    vencimento: '2026-09-24',
                    diferencaDias: 1,
                    lote: { loteId: 'L-ADP', status: 'FINALIZADO' },
                },
            ],
        });
    });

    it('cobrança recorrente de mesmo valor → AMBIGUO, candidatos do mais próximo ao mais distante', () => {
        const [linha] = consolidacao.consolidar({
            boletos: [boleto({ valor: 1412, vencimento: '2026-09-24' })],
            titulos: [
                titulo({ docCod: 'A', valor: 1412, vencimento: utc('2026-09-21') }),
                titulo({ docCod: 'B', valor: 1412, vencimento: utc('2026-09-23') }),
            ],
            titulosEmLote: [],
        });
        expect(linha.situacao).toBe('AMBIGUO');
        expect(linha.candidatos.map((c) => [c.docCod, c.diferencaDias])).toEqual([
            ['B', 1],
            ['A', 3],
        ]);
    });

    it('valor longe, título pago ou boleto além de +5 dias → SEM_TITULO', () => {
        const resultado = consolidacao.consolidar({
            boletos: [boleto({ valor: 100, vencimento: '2026-09-25' })],
            titulos: [
                // +7 dias: além do limite seguro (era "fora da janela ±3")
                titulo({ docCod: 'longe', valor: 100, vencimento: utc('2026-09-18') }),
                // R$ 5,00 de diferença: fora do limite de R$ 0,05
                titulo({ docCod: 'valor', valor: 105, vencimento: utc('2026-09-25') }),
                titulo({ docCod: 'pago', valor: 100, vencimento: utc('2026-09-25'), pago: true }),
            ],
            titulosEmLote: [],
        });
        expect(resultado[0]).toMatchObject({ situacao: 'SEM_TITULO', candidatos: [] });
    });

    it('REGRA EM CAMADAS: R$ 0,01 de diferença no mesmo dia passa a ser candidato FORTE (antes SEM_TITULO)', () => {
        const [linha] = consolidacao.consolidar({
            boletos: [boleto({ valor: 93.41, vencimento: '2026-09-25' })],
            titulos: [titulo({ docCod: 'NELSON', valor: 93.4, vencimento: utc('2026-09-25') })],
            titulosEmLote: [],
        });
        expect(linha.situacao).toBe('CANDIDATO');
        expect(linha.candidatos[0]).toMatchObject({
            docCod: 'NELSON',
            tier: 'FORTE',
            deltaValor: 0.01,
            diferencaDias: 0,
        });
    });

    it('REGRA EM CAMADAS: boleto de 1 a 3 dias ANTES do título não é mais candidato, vira informativo', () => {
        for (const dias of [1, 2, 3]) {
            const [linha] = consolidacao.consolidar({
                boletos: [boleto({ valor: 100, vencimento: `2026-09-${25 - dias}` })],
                titulos: [titulo({ docCod: 'T', valor: 100, vencimento: utc('2026-09-25') })],
                titulosEmLote: [],
            });
            expect(linha.situacao).toBe('SEM_TITULO');
            expect(linha.candidatos).toEqual([]);
            expect(linha.informativos?.[0]).toMatchObject({
                docCod: 'T',
                tier: 'VENCIDO_INFORMATIVO',
                diferencaDias: -dias,
            });
        }
    });

    it('REGRA EM CAMADAS: com lote pagando antes do vencimento do título, 1 dia antes é só ATENCAO', () => {
        const [linha] = consolidacao.consolidar({
            boletos: [boleto({ valor: 100, vencimento: '2026-09-24' })],
            titulos: [titulo({ docCod: 'T', valor: 100, vencimento: utc('2026-09-25') })],
            titulosEmLote: [
                {
                    filCod: 1,
                    docCod: 'T',
                    titCod: '1',
                    loteId: 'L',
                    status: 'RASCUNHO',
                    dataDebito: '2026-09-23',
                },
            ],
        });
        expect(linha.situacao).toBe('SEM_TITULO');
        expect(linha.informativos?.[0]).toMatchObject({ tier: 'ATENCAO', diferencaDias: -1 });
    });

    it('PEDRONI 34697/1: boleto 1 dia DEPOIS continua candidato (caso de 2026-09-23)', () => {
        const [linha] = consolidacao.consolidar({
            boletos: [boleto({ valor: 1412, vencimento: '2026-09-24' })],
            titulos: [
                titulo({
                    filCod: 2,
                    docCod: '34697',
                    credor: 'PEDRONI',
                    valor: 1412,
                    vencimento: utc('2026-09-23'),
                }),
            ],
            titulosEmLote: [],
        });
        expect(linha.situacao).toBe('CANDIDATO');
        expect(linha.candidatos[0]).toMatchObject({ docCod: '34697', diferencaDias: 1 });
    });

    it('vínculo gravado pelo Conexos → VINCULADO, e o título não vira candidato de outro boleto', () => {
        const [vinculado, outro] = consolidacao.consolidar({
            boletos: [
                boleto({
                    ditCod: 1,
                    filCod: 1,
                    docCod: '5046',
                    titCod: '1',
                    flpCod: 9,
                    valor: 4815.33,
                }),
                boleto({ ditCod: 2, valor: 4815.33, vencimento: '2026-09-24' }),
            ],
            titulos: [ADP],
            titulosEmLote: [],
        });
        expect(vinculado).toMatchObject({
            situacao: 'VINCULADO',
            vinculo: { docCod: '5046', credor: 'ADP BRASIL LTDA', flpCod: 9, diferencaDias: 1 },
        });
        expect(outro.situacao).toBe('SEM_TITULO');
    });

    it('vínculo a título fora da carteira (já pago) ainda mostra a chave', () => {
        const [linha] = consolidacao.consolidar({
            boletos: [boleto({ filCod: 2, docCod: '34697', titCod: '1' })],
            titulos: [],
            titulosEmLote: [],
        });
        expect(linha.vinculo).toEqual({ filCod: 2, docCod: '34697', titCod: '1' });
    });

    it('marca vencido pela data de Brasília e usa o lote mais recente do título', () => {
        const [linha] = consolidacao.consolidar({
            boletos: [boleto({ valor: 50, vencimento: '2026-09-22' })],
            titulos: [titulo({ docCod: 'X', valor: 50, vencimento: utc('2026-09-22') })],
            titulosEmLote: [
                { filCod: 1, docCod: 'X', titCod: '1', loteId: 'novo', status: 'RASCUNHO' },
                { filCod: 1, docCod: 'X', titCod: '1', loteId: 'antigo', status: 'FINALIZADO' },
            ],
        });
        expect(linha.vencido).toBe(true);
        expect(linha.candidatos[0]?.lote?.loteId).toBe('novo');
    });
});
