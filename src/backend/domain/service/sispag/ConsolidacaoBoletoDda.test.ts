import 'reflect-metadata';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import ConsolidacaoBoletoDda from './ConsolidacaoBoletoDda.js';

// "Hoje" = 23/09/2026 12h em Brasília.
const calendar = BankingCalendar.withClock(() => new Date('2026-09-23T15:00:00Z'));
const consolidacao = new ConsolidacaoBoletoDda(new CodigoBarrasBoleto(), calendar);

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

    it('fora da janela, valor diferente ou título pago → SEM_TITULO', () => {
        const resultado = consolidacao.consolidar({
            boletos: [boleto({ valor: 100, vencimento: '2026-09-25' })],
            titulos: [
                titulo({ docCod: 'longe', valor: 100, vencimento: utc('2026-09-21') }),
                titulo({ docCod: 'centavo', valor: 100.01, vencimento: utc('2026-09-25') }),
                titulo({ docCod: 'pago', valor: 100, vencimento: utc('2026-09-25'), pago: true }),
            ],
            titulosEmLote: [],
        });
        expect(resultado[0]).toMatchObject({ situacao: 'SEM_TITULO', candidatos: [] });
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
