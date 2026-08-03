import 'reflect-metadata';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import BradescoExtratoParser from './BradescoExtratoParser.js';

/**
 * Monta um `.xlsx` em memória que replica o layout do "Extrato de Lançamentos" do Bradesco
 * (`Extrato_Lançamentos_0641_557954_*.xlsx`): metadados de topo, uma linha de cabeçalho, marcadores
 * `SALDO ANTERIOR`/`SALDO EM CONTA CORRENTE` e linhas de crédito/débito.
 */
const construirExtrato = async (opts: { linhaExtra?: boolean } = {}): Promise<Buffer> => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Extrato');

    ws.addRow(['Atualização:', '03/08/2026 14:37:29']);
    ws.addRow(['Nome:', 'COLUMBIA TRADING S/A']);
    if (opts.linhaExtra) ws.addRow([]); // desloca o cabeçalho — testa tolerância a shift
    ws.addRow(['Agência:', '0641']);
    ws.addRow(['Conta:', '0055795-4']);
    ws.addRow([]);
    ws.addRow(['Lançamentos']);
    ws.addRow(['Periodo:', '03/08/2026 até 03/08/2026']);
    ws.addRow([]);
    ws.addRow(['Data', 'Lançamento', 'Razão social', 'CPF/CNPJ', 'Valor (R$)', 'Saldo (R$)']);
    ws.addRow(['02/08/2026', 'SALDO ANTERIOR', '', '', '', 573557.05]);
    // crédito, célula numérica:
    ws.addRow([
        '03/08/2026',
        'TED RECEBIDA 033.3945.MACDON',
        'MACDON BRASIL AGRIBUSINESS LTDA.',
        '20.440.034/0001-04',
        17804.86,
        '',
    ]);
    // crédito, valor como string pt-BR:
    ws.addRow([
        '03/08/2026',
        'PIX RECEBIDO MULTILO',
        'MULTILOG S/A',
        '78.614.229/0001-03',
        '1.234,56',
        '',
    ]);
    // débito (Valor < 0) — deve aparecer na saída do parser (o filtro é do serviço):
    ws.addRow([
        '03/08/2026',
        'BOLETO PAGO INTERNACIONA',
        'INTERNACIONAL SERV',
        '36.364.875/0001-10',
        -690.0,
        '',
    ]);
    // débito com Razão social / CPF vazios:
    ws.addRow(['03/08/2026', 'SISCOMEX PROT 3588861965', '', '', -12837.08, '']);
    // crédito com Razão social / CPF vazios:
    ws.addRow(['03/08/2026', 'PIX RECEBIDO SEMDOC', '', '', 100.0, '']);
    ws.addRow(['03/08/2026', 'SALDO EM CONTA CORRENTE', '', '', '', 1551849.73]);

    return Buffer.from(await wb.xlsx.writeBuffer());
};

/**
 * Reescreve `docProps/core.xml` com um `<lastModifiedBy>` SEM prefixo `cp:` — a forma que quebra o
 * parser XML do exceljs (`Unexpected xml node in parseOpen`), medida no arquivo real do Bradesco.
 */
const comCorePropsQuebrado = async (buffer: Buffer): Promise<Buffer> => {
    const zip = await JSZip.loadAsync(buffer);
    zip.file(
        'docProps/core.xml',
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<coreProperties xmlns="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
            'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
            '<dcterms:created xsi:type="dcterms:W3CDTF">2023-09-01T14:41:36Z</dcterms:created>' +
            '<dc:creator>Desconhecido</dc:creator>' +
            '<lastModifiedBy>Fulana de Tal</lastModifiedBy>' +
            '<dcterms:modified xsi:type="dcterms:W3CDTF">2025-04-03T13:35:47Z</dcterms:modified>' +
            '</coreProperties>',
    );
    return zip.generateAsync({ type: 'nodebuffer' });
};

const parser = new BradescoExtratoParser();

describe('BradescoExtratoParser', () => {
    it('canParse reconhece o layout Bradesco e rejeita lixo', async () => {
        expect(await parser.canParse(await construirExtrato())).toBe(true);
        expect(await parser.canParse(Buffer.from('não é um xlsx'))).toBe(false);
    });

    it('lê o cabeçalho (agência, conta, período)', async () => {
        const { cabecalho } = await parser.parse(await construirExtrato());
        expect(cabecalho.banco).toBe('bradesco');
        expect(cabecalho.agencia).toBe('0641');
        expect(cabecalho.conta).toBe('0055795-4');
        expect(cabecalho.periodoDe?.toISOString().slice(0, 10)).toBe('2026-08-03');
        expect(cabecalho.periodoAte?.toISOString().slice(0, 10)).toBe('2026-08-03');
    });

    it('pula os marcadores SALDO ANTERIOR e SALDO EM CONTA CORRENTE', async () => {
        const { linhas } = await parser.parse(await construirExtrato());
        expect(linhas.some((l) => /saldo/i.test(l.descricao))).toBe(false);
        // 3 créditos + 2 débitos = 5 linhas de transação.
        expect(linhas).toHaveLength(5);
    });

    it('emite créditos E débitos (o filtro crédito-only é do serviço)', async () => {
        const { linhas } = await parser.parse(await construirExtrato());
        expect(linhas.filter((l) => l.valor > 0)).toHaveLength(3);
        expect(linhas.filter((l) => l.valor < 0)).toHaveLength(2);
    });

    it('parseia valor pt-BR (string e número) e normaliza CPF/CNPJ para só-dígitos', async () => {
        const { linhas } = await parser.parse(await construirExtrato());
        const multilog = linhas.find((l) => l.descricao.includes('MULTILO'));
        const macdon = linhas.find((l) => l.descricao.includes('MACDON'));
        const internacional = linhas.find((l) => l.descricao.includes('INTERNACIONA'));

        expect(multilog?.valor).toBeCloseTo(1234.56, 2); // "1.234,56" → 1234.56
        expect(macdon?.valor).toBeCloseTo(17804.86, 2);
        expect(macdon?.contraparteDoc).toBe('20440034000104');
        expect(internacional?.valor).toBeCloseTo(-690, 2); // débito preserva o sinal
    });

    it('tolera Razão social / CPF-CNPJ vazios (undefined, sem crash)', async () => {
        const { linhas } = await parser.parse(await construirExtrato());
        const semDoc = linhas.find((l) => l.descricao.includes('SEMDOC'));
        expect(semDoc).toBeDefined();
        expect(semDoc?.contraparteNome).toBeUndefined();
        expect(semDoc?.contraparteDoc).toBeUndefined();
    });

    it('data vira Date e localiza o cabeçalho mesmo com uma linha extra de topo', async () => {
        const { linhas } = await parser.parse(await construirExtrato({ linhaExtra: true }));
        expect(linhas).toHaveLength(5);
        const primeira = linhas[0];
        expect(primeira?.data).toBeInstanceOf(Date);
        expect(primeira?.data.getUTCFullYear()).toBe(2026);
        expect(primeira?.data.getUTCMonth()).toBe(7); // agosto (0-based)
    });

    it('lê um arquivo com `docProps/core.xml` no formato real do Bradesco (lastModifiedBy sem prefixo)', async () => {
        const buffer = await comCorePropsQuebrado(await construirExtrato());
        expect(await parser.canParse(buffer)).toBe(true);
        const { linhas } = await parser.parse(buffer);
        expect(linhas).toHaveLength(5);
    });
});
