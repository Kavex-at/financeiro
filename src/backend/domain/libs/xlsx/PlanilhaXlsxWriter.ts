import ExcelJS from 'exceljs';
import { injectable } from 'tsyringe';
import type { PlanilhaExport } from '../../interface/sispag/RemessaTitulosExport.js';

/**
 * PlanilhaXlsxWriter — serializa uma `PlanilhaExport` em `.xlsx`: cabeçalho em negrito e
 * congelado, formatos numéricos por coluna e linha de totais em negrito. Os exports do SISPAG
 * montam a projeção (testável sem bytes) e delegam a serialização para cá.
 */
@injectable()
export default class PlanilhaXlsxWriter {
    public serializar = async (planilha: PlanilhaExport): Promise<Buffer> => {
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
