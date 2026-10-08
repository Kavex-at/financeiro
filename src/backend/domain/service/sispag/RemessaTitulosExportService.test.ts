import 'reflect-metadata';
import ExcelJS from 'exceljs';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import PlanilhaXlsxWriter from '../../libs/xlsx/PlanilhaXlsxWriter.js';
import type { LotePagamento } from '../../interface/sispag/SispagInterface.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type LogService from '../LogService.js';
import RemessaTitulosExportService from './RemessaTitulosExportService.js';

const item = (over: Partial<LotePagamento['itens'][number]> = {}) => ({
    loteId: 'L1',
    filCod: 7,
    docCod: '801',
    titCod: '1',
    credor: 'CRONOS LOGISTICA',
    valor: 150,
    vencimento: Date.UTC(2026, 9, 8, 15),
    modalidade: 'BOLETO' as const,
    incluidoPor: 'ana',
    divergencia: false,
    situacao: 'SEM_RETORNO' as const,
    ...over,
});

const loteRemessa = (over: Partial<LotePagamento> = {}): LotePagamento => ({
    id: 'L1',
    filCod: 7,
    banco: 'ITAÚ',
    conta: '55795-4',
    status: 'REMESSA_GERADA',
    criadoPor: 'ana',
    versao: 4,
    dataDebito: '2026-10-08',
    remessaArquivo: 'PG061001.REM',
    remessaNum: 61,
    remessaGeradaEm: '2026-10-06T13:30:00.000Z',
    itens: [item(), item({ docCod: '802', valor: 100.25, credor: 'ACME', modalidade: 'PIX' })],
    ...over,
});

const make = (lotes: LotePagamento[]) => {
    const repo = { listLotesPorIds: jest.fn().mockResolvedValue(lotes) };
    const log = { info: jest.fn().mockResolvedValue(undefined) };
    const calendar = BankingCalendar.withClock(() => new Date('2026-10-06T15:00:00Z'));
    const service = new RemessaTitulosExportService(
        repo as unknown as LotePagamentoRepository,
        log as unknown as LogService,
        calendar,
        new PlanilhaXlsxWriter(),
    );
    return { service, repo, log };
};

describe('RemessaTitulosExportService', () => {
    it('uma linha por título, com os dados da remessa e do lote', async () => {
        const { service } = make([loteRemessa()]);
        const planilha = service.montarPlanilha([loteRemessa()]);
        expect(planilha.linhas).toHaveLength(2);
        expect(planilha.linhas[0]).toMatchObject({
            loteId: 'L1',
            remessaNum: 61,
            remessaArquivo: 'PG061001.REM',
            filial: 7,
            banco: 'ITAÚ',
            conta: '55795-4',
            statusLote: 'Remessa gerada',
            credor: 'CRONOS LOGISTICA',
            documento: '801/1',
            valor: 150,
            modalidade: 'Boleto',
            situacao: 'Sem retorno',
        });
        // Datas viram data do Excel no dia certo (sem deslocamento de fuso).
        expect(planilha.linhas[0]?.vencimento).toEqual(new Date(Date.UTC(2026, 9, 8)));
        expect(planilha.linhas[0]?.dataDebito).toEqual(new Date(Date.UTC(2026, 9, 8)));
        // Geração em horário de Brasília: 13:30Z = 10:30 BRT.
        expect(planilha.linhas[0]?.geradaEm).toEqual(new Date(Date.UTC(2026, 9, 6, 10, 30)));
        expect(planilha.linhas[1]).toMatchObject({ documento: '802/1', modalidade: 'PIX' });
    });

    it('linha de totais: quantidade de títulos e somas exatas em centavos', () => {
        const { service } = make([]);
        const planilha = service.montarPlanilha([
            loteRemessa(),
            loteRemessa({
                id: 'L2',
                itens: [item({ loteId: 'L2', valor: 0.1, valorPago: 0.1, situacao: 'PAGO' })],
            }),
        ]);
        expect(planilha.linhas).toHaveLength(3);
        expect(planilha.totais).toMatchObject({
            loteId: 'TOTAL',
            documento: '3 título(s) em 2 remessa(s)',
            valor: 250.35,
            valorPago: 0.1,
        });
    });

    it('campos ausentes viram célula em branco, nunca "undefined"', () => {
        const { service } = make([]);
        const planilha = service.montarPlanilha([
            loteRemessa({
                banco: undefined,
                remessaNum: undefined,
                remessaGeradaEm: undefined,
                dataDebito: undefined,
                itens: [
                    item({
                        credor: undefined,
                        modalidade: undefined,
                        situacao: undefined,
                        vencimento: undefined,
                    }),
                ],
            }),
        ]);
        const linha = planilha.linhas[0] ?? {};
        expect(linha.banco).toBeNull();
        expect(linha.remessaNum).toBeNull();
        expect(linha.geradaEm).toBeNull();
        expect(linha.vencimento).toBeNull();
        expect(linha.modalidade).toBe('A definir');
        expect(linha.situacao).toBe('Não sincronizado');
        expect(JSON.stringify(planilha)).not.toContain('undefined');
    });

    it('pago em: data civil não desloca; instante com hora vira o dia de Brasília', () => {
        const { service } = make([]);
        const planilha = service.montarPlanilha([
            loteRemessa({
                itens: [
                    item({ pagoEm: '2026-10-08' }),
                    item({ docCod: '802', pagoEm: '2026-10-09T01:00:00.000Z' }),
                ],
            }),
        ]);
        expect(planilha.linhas[0]?.pagoEm).toEqual(new Date(Date.UTC(2026, 9, 8)));
        expect(planilha.linhas[1]?.pagoEm).toEqual(new Date(Date.UTC(2026, 9, 8)));
    });

    it('retorno do banco e pagamento aparecem quando existem', () => {
        const { service } = make([]);
        const planilha = service.montarPlanilha([
            loteRemessa({
                status: 'RETORNADO',
                itens: [
                    item({
                        situacao: 'REJEITADO',
                        retornoEvento: 'BE',
                        retornoDescricao: 'CONTA INVALIDA',
                    }),
                ],
            }),
        ]);
        expect(planilha.linhas[0]).toMatchObject({
            statusLote: 'Retornado (rejeição)',
            situacao: 'Rejeitado',
            retorno: 'BE · CONTA INVALIDA',
        });
    });

    it('exportar: busca pelos ids, gera xlsx legível com cabeçalho, linhas e totais', async () => {
        const { service, repo, log } = make([loteRemessa()]);
        const { filename, buffer } = await service.exportar(['L1'], 'req-1');
        expect(repo.listLotesPorIds).toHaveBeenCalledWith(['L1']);
        // Uma remessa só: o arquivo leva o nome da remessa, para a analista achar depois.
        expect(filename).toBe('sispag-titulos-PG061001-2026-10-06.xlsx');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer as unknown as ArrayBuffer);
        const sheet = wb.worksheets[0];
        expect(sheet?.getRow(1).getCell(1).value).toBe('Lote');
        expect(sheet?.rowCount).toBe(4); // cabeçalho + 2 títulos + totais
        expect(log.info).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ lotes: 1, titulos: 2 }) }),
        );
    });

    it('várias remessas: nome genérico com a data de hoje (BRT)', async () => {
        const lotes = [loteRemessa(), loteRemessa({ id: 'L2', remessaArquivo: 'PG061002.REM' })];
        const { service } = make(lotes);
        const { filename } = await service.exportar(['L1', 'L2'], 'req-1');
        expect(filename).toBe('sispag-titulos-remessas-2026-10-06.xlsx');
    });

    it('recusa o pedido inteiro com lote inexistente ou sem remessa (nada sai pela metade)', async () => {
        const { service } = make([loteRemessa(), loteRemessa({ id: 'L2', status: 'FINALIZADO' })]);
        await expect(service.exportar(['L1', 'L2', 'L3'], 'req-1')).rejects.toMatchObject({
            code: 'EXPORT_REMESSA_INVALIDO',
            statusCode: 422,
            details: { inexistentes: ['L3'], semRemessa: ['L2'] },
        });
    });

    it('ids repetidos contam uma vez', async () => {
        const { service, repo } = make([loteRemessa()]);
        await service.exportar(['L1', 'L1'], 'req-1');
        expect(repo.listLotesPorIds).toHaveBeenCalledWith(['L1']);
    });
});
