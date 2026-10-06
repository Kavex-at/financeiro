import ExcelJS from 'exceljs';
import { inject, injectable } from 'tsyringe';
import RemittanceExportInvalidError from '../../errors/RemittanceExportInvalidError.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    type CelulaExport,
    type ColunaExport,
    type PlanilhaExport,
    STATUS_COM_REMESSA,
} from '../../interface/sispag/RemessaTitulosExport.js';
import type {
    ItemLote,
    ItemSituacao,
    LotePagamento,
    LotePagamentoStatus,
    Modalidade,
} from '../../interface/sispag/SispagInterface.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import LogService from '../LogService.js';

const FMT_MOEDA = '#,##0.00';
const FMT_DATA = 'dd/mm/yyyy';
const FMT_DATA_HORA = 'dd/mm/yyyy hh:mm';
/** Brasília é UTC−3 fixo desde 2019 (sem horário de verão). */
const OFFSET_BRT_MS = 3 * 60 * 60 * 1000;

const COLUNAS: ColunaExport[] = [
    { header: 'Lote', key: 'loteId', width: 38 },
    { header: 'Remessa nº', key: 'remessaNum', width: 11 },
    { header: 'Arquivo da remessa', key: 'remessaArquivo', width: 20 },
    { header: 'Gerada em', key: 'geradaEm', width: 17, numFmt: FMT_DATA_HORA },
    { header: 'Filial', key: 'filial', width: 7 },
    { header: 'Banco pagador', key: 'banco', width: 14 },
    { header: 'Conta pagadora', key: 'conta', width: 15 },
    { header: 'Data de débito', key: 'dataDebito', width: 14, numFmt: FMT_DATA },
    { header: 'Status do lote', key: 'statusLote', width: 20 },
    { header: 'Credor', key: 'credor', width: 36 },
    { header: 'Documento', key: 'documento', width: 26 },
    { header: 'Vencimento', key: 'vencimento', width: 12, numFmt: FMT_DATA },
    { header: 'Valor (R$)', key: 'valor', width: 14, numFmt: FMT_MOEDA },
    { header: 'Forma de pagamento', key: 'modalidade', width: 18 },
    { header: 'Situação', key: 'situacao', width: 16 },
    { header: 'Pago em', key: 'pagoEm', width: 12, numFmt: FMT_DATA },
    { header: 'Valor pago (R$)', key: 'valorPago', width: 15, numFmt: FMT_MOEDA },
    { header: 'Retorno do banco', key: 'retorno', width: 30 },
];

const STATUS_ROTULO: Record<LotePagamentoStatus, string> = {
    RASCUNHO: 'Rascunho',
    FINALIZADO: 'Finalizado',
    CANCELADO: 'Cancelado',
    REMESSA_GERADA: 'Remessa gerada',
    RETORNADO: 'Retornado (rejeição)',
    BAIXADO: 'Baixado',
};

const MODALIDADE_ROTULO: Record<Modalidade, string> = {
    BOLETO: 'Boleto',
    TED: 'TED',
    PIX: 'PIX',
    CREDITO_CONTA: 'Crédito em conta',
};

const SITUACAO_ROTULO: Record<ItemSituacao, string> = {
    PAGO: 'Pago',
    AGENDADO: 'Agendado',
    REJEITADO: 'Rejeitado',
    SEM_RETORNO: 'Sem retorno',
};

/**
 * RemessaTitulosExportService — planilha (.xlsx) com os títulos das remessas geradas, para a
 * revisão do time financeiro da Columbia. READ-ONLY e local: lê `lote_pagamento` e os itens,
 * não vai ao Conexos. Mesmo desenho do `RelatorioExportService` das Permutas: a projeção
 * (`montarPlanilha`) é separada da serialização (exceljs), para testar sem ler bytes.
 */
@injectable()
export default class RemessaTitulosExportService {
    public constructor(
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(LogService) private readonly logService: LogService,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
    ) {}

    /** Exporta os títulos dos lotes pedidos. Recusa tudo se algum lote não tem remessa. */
    public exportar = async (
        loteIds: string[],
        requestId: string,
    ): Promise<{ filename: string; buffer: Buffer }> => {
        const ids = [...new Set(loteIds)];
        const lotes = await this.loteRepo.listLotesPorIds(ids);
        const achados = new Map(lotes.map((l) => [l.id, l]));
        const inexistentes = ids.filter((id) => !achados.has(id));
        const semRemessa = lotes
            .filter((l) => !STATUS_COM_REMESSA.includes(l.status))
            .map((l) => l.id);
        if (inexistentes.length > 0 || semRemessa.length > 0) {
            throw new RemittanceExportInvalidError({ inexistentes, semRemessa });
        }
        const planilha = this.montarPlanilha(lotes);
        const buffer = await this.serializar(planilha);
        const filename = this.nomeArquivo(lotes);
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'títulos de remessas exportados',
            data: { requestId, lotes: lotes.length, titulos: planilha.linhas.length },
        });
        return { filename, buffer };
    };

    /** Projeta os lotes na planilha: uma linha por título + linha de totais. */
    public montarPlanilha = (lotes: LotePagamento[]): PlanilhaExport => {
        const linhas = lotes.flatMap((lote) => lote.itens.map((i) => this.linha(lote, i)));
        const centavos = (campo: 'valor' | 'valorPago') =>
            lotes
                .flatMap((l) => l.itens)
                .reduce((acc, i) => acc + Math.round((i[campo] ?? 0) * 100), 0) / 100;
        return {
            titulo: 'Títulos das remessas',
            colunas: COLUNAS,
            linhas,
            totais: {
                loteId: 'TOTAL',
                documento: `${linhas.length} título(s) em ${lotes.length} remessa(s)`,
                valor: centavos('valor'),
                valorPago: centavos('valorPago'),
            },
        };
    };

    private linha = (lote: LotePagamento, item: ItemLote): Record<string, CelulaExport> => ({
        loteId: lote.id,
        remessaNum: lote.remessaNum ?? null,
        remessaArquivo: lote.remessaArquivo ?? null,
        geradaEm: this.dataHoraBrt(lote.remessaGeradaEm),
        filial: lote.filCod,
        banco: lote.banco ?? null,
        conta: lote.conta ?? null,
        dataDebito: this.dataCivil(lote.dataDebito),
        statusLote: STATUS_ROTULO[lote.status],
        credor: item.credor ?? null,
        documento: `${item.docCod}/${item.titCod}`,
        vencimento: item.vencimento != null ? this.diaUtc(new Date(item.vencimento)) : null,
        valor: item.valor ?? null,
        modalidade: item.modalidade ? MODALIDADE_ROTULO[item.modalidade] : 'A definir',
        situacao: item.situacao ? SITUACAO_ROTULO[item.situacao] : 'Não sincronizado',
        pagoEm: this.diaBrt(item.pagoEm),
        valorPago: item.valorPago ?? null,
        retorno: [item.retornoEvento, item.retornoDescricao].filter(Boolean).join(' · ') || null,
    });

    /** `YYYY-MM-DD` → data do Excel no mesmo dia (meia-noite UTC: o exceljs serializa em UTC). */
    private dataCivil = (civil?: string): Date | null => {
        if (!civil) return null;
        const [a, m, d] = civil.split('-').map(Number);
        if (!a || !m || !d) return null;
        return new Date(Date.UTC(a, m - 1, d));
    };

    /**
     * Data (ISO) → dia em Brasília. `YYYY-MM-DD` puro é data civil (não desloca); um instante
     * com hora é convertido para BRT antes de truncar — senão 01:00Z viraria o dia seguinte.
     */
    private diaBrt = (iso?: string): Date | null => {
        if (!iso) return null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return this.dataCivil(iso);
        const t = new Date(iso).getTime();
        return Number.isNaN(t) ? null : this.diaUtc(new Date(t - OFFSET_BRT_MS));
    };

    /** Trunca para o dia (UTC). O ERP grava vencimento às 15:00Z do dia pretendido. */
    private diaUtc = (d: Date): Date | null =>
        Number.isNaN(d.getTime())
            ? null
            : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

    /** Instante ISO → "relógio de parede" de Brasília, para o Excel mostrar a hora local. */
    private dataHoraBrt = (iso?: string): Date | null => {
        if (!iso) return null;
        const t = new Date(iso).getTime();
        return Number.isNaN(t) ? null : new Date(t - OFFSET_BRT_MS);
    };

    private nomeArquivo = (lotes: LotePagamento[]): string => {
        const hoje = this.calendar.todayBrt();
        const unico = lotes.length === 1 ? lotes[0]?.remessaArquivo : undefined;
        const base = unico ? unico.replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '') : '';
        return base
            ? `sispag-titulos-${base}-${hoje}.xlsx`
            : `sispag-titulos-remessas-${hoje}.xlsx`;
    };

    private serializar = async (planilha: PlanilhaExport): Promise<Buffer> => {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Columbia Financeiro';
        const sheet = workbook.addWorksheet(planilha.titulo.slice(0, 31));
        sheet.columns = planilha.colunas.map((c) => ({
            header: c.header,
            key: c.key,
            width: c.width,
            ...(c.numFmt ? { style: { numFmt: c.numFmt } } : {}),
        }));
        sheet.getRow(1).font = { bold: true };
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
        for (const linha of planilha.linhas) sheet.addRow(linha);
        sheet.addRow(planilha.totais).font = { bold: true };
        const arrayBuffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(arrayBuffer as ArrayBuffer);
    };
}
