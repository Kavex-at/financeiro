import 'reflect-metadata';
import ExcelJS from 'exceljs';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import type Clock from '../../libs/clock/Clock.js';
import PlanilhaXlsxWriter from '../../libs/xlsx/PlanilhaXlsxWriter.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type LogService from '../LogService.js';
import TitulosAPagarExportService from './TitulosAPagarExportService.js';

/** Relógio que anda 125 ms a cada leitura: início → fim do export = 125 ms. */
const relogio = () => {
    let t = 1_000;
    return {
        now: () => {
            const agora = t;
            t += 125;
            return agora;
        },
    } as unknown as Clock;
};

const titulo = (over: Partial<TituloAPagar> = {}): TituloAPagar => ({
    filCod: 7,
    docCod: '801',
    titCod: '1',
    credor: 'CRONOS LOGISTICA',
    valor: 150,
    moeda: 'BRL',
    // O ERP grava 15:00Z do dia pretendido: 08/10/2026.
    vencimento: Date.UTC(2026, 9, 8, 15),
    liberado: true,
    pago: false,
    banco: 'ITAÚ',
    temBoleto: true,
    formaPagamentoConexos: 6,
    prontoParaRemessa: true,
    ...over,
});

const make = ({
    titulos = [titulo()],
    rascunho = [] as Awaited<ReturnType<LotePagamentoRepository['listTitulosEmRascunho']>>,
    comprometidos = [] as Awaited<
        ReturnType<LotePagamentoRepository['listTitulosEmLotesComprometidos']>
    >,
} = {}) => {
    const tituloRepo = { listAtivos: jest.fn().mockResolvedValue(titulos) };
    const loteRepo = {
        listTitulosEmRascunho: jest.fn().mockResolvedValue(rascunho),
        listTitulosEmLotesComprometidos: jest.fn().mockResolvedValue(comprometidos),
    };
    const log = { info: jest.fn().mockResolvedValue(undefined) };
    // 06/10/2026 12:00 BRT.
    const calendar = BankingCalendar.withClock(() => new Date('2026-10-06T15:00:00Z'));
    const service = new TitulosAPagarExportService(
        tituloRepo as unknown as TituloAPagarRepository,
        loteRepo as unknown as LotePagamentoRepository,
        log as unknown as LogService,
        calendar,
        new PlanilhaXlsxWriter(),
        relogio(),
    );
    return { service, tituloRepo, loteRepo, log };
};

const chave = (t: Pick<TituloAPagar, 'filCod' | 'docCod' | 'titCod'>) => ({
    filCod: t.filCod,
    docCod: t.docCod,
    titCod: t.titCod,
});

describe('TitulosAPagarExportService', () => {
    it('uma linha por título pedido, com os dados da carteira', async () => {
        const { service } = make();
        const { linhas } = await service.montar([chave(titulo())]);
        expect(linhas).toHaveLength(1);
        expect(linhas[0]).toMatchObject({
            filial: 7,
            credor: 'CRONOS LOGISTICA',
            documento: '801/1',
            valor: 150,
            moeda: 'BRL',
            diasParaVencer: 2,
            boleto: 'Sim',
            formaConexos: 'BOLETO',
            aprovacao: 'Aprovado',
            prontoParaRemessa: 'Sim',
            lote: null,
            banco: 'ITAÚ',
        });
        // Vencimento no dia do ERP, sem deslocar pelo fuso.
        expect(linhas[0]?.vencimento).toEqual(new Date(Date.UTC(2026, 9, 8)));
    });

    it('mantém a ordem pedida (a da tela) e ignora chaves fora da carteira ativa', async () => {
        const a = titulo({ docCod: 'A' });
        const b = titulo({ docCod: 'B', valor: 10 });
        const { service } = make({ titulos: [a, b] });
        const { linhas, ignorados } = await service.montar([
            chave(b),
            { filCod: 7, docCod: 'X', titCod: '1' },
            chave(a),
        ]);
        expect(linhas.map((l) => l.documento)).toEqual(['B/1', 'A/1']);
        expect(ignorados).toBe(1);
    });

    it('título já pago não entra (o painel também o tira)', async () => {
        const { service } = make({ titulos: [titulo({ pago: true })] });
        const { linhas, ignorados } = await service.montar([chave(titulo())]);
        expect(linhas).toHaveLength(0);
        expect(ignorados).toBe(1);
    });

    it('coluna Lote: rascunho, finalizado ou remessa gerada', async () => {
        const r = titulo({ docCod: 'R' });
        const f = titulo({ docCod: 'F' });
        const g = titulo({
            docCod: 'G',
            liberado: false,
            temBoleto: false,
            formaPagamentoConexos: undefined,
            vencimento: undefined,
        });
        const { service } = make({
            titulos: [r, f, g],
            rascunho: [{ ...chave(r), loteId: 'L1', automatico: true }],
            comprometidos: [
                { ...chave(f), id: 'L2', status: 'FINALIZADO' },
                { ...chave(g), id: 'L3', status: 'REMESSA_GERADA' },
            ],
        });
        const { linhas } = await service.montar([chave(r), chave(f), chave(g)]);
        expect(linhas.map((l) => l.lote)).toEqual([
            'Rascunho (automático)',
            'Finalizado',
            'Remessa gerada',
        ]);
        expect(linhas[2]).toMatchObject({
            aprovacao: 'Bloqueado',
            boleto: 'Não',
            formaConexos: null,
            vencimento: null,
            diasParaVencer: null,
        });
    });

    it('linha de totais com a soma exata em centavos', async () => {
        const a = titulo({ docCod: 'A', valor: 0.1 });
        const b = titulo({ docCod: 'B', valor: 0.2 });
        const { service } = make({ titulos: [a, b] });
        const { totais } = await service.montar([chave(a), chave(b)]);
        expect(totais).toMatchObject({ documento: '2 título(s)', valor: 0.3 });
    });

    it('exportar devolve um xlsx legível, com nome datado, e registra o log', async () => {
        const { service, log } = make();
        const { filename, buffer } = await service.exportar([chave(titulo())], {
            requestId: 'req-1',
            ator: 'ana.silva',
            userId: 42,
        });
        expect(filename).toBe('sispag-titulos-a-pagar-2026-10-06.xlsx');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer as unknown as ArrayBuffer);
        const sheet = wb.worksheets[0];
        expect(sheet?.getRow(1).getCell(2).value).toBe('Credor');
        expect(sheet?.getRow(2).getCell(2).value).toBe('CRONOS LOGISTICA');
        expect(sheet?.rowCount).toBe(3); // cabeçalho + 1 título + totais
        expect(log.info).toHaveBeenCalledWith(
            expect.objectContaining({
                data: {
                    requestId: 'req-1',
                    ator: 'ana.silva',
                    userId: 42,
                    pedidos: 1,
                    titulos: 1,
                    ignorados: 0,
                    durationMs: 125,
                },
            }),
        );
    });
});
