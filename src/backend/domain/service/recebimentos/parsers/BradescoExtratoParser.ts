import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { injectable } from 'tsyringe';
import type {
    CabecalhoExtratoArquivo,
    ExtratoArquivoParseResult,
    ExtratoArquivoParserInterface,
    LinhaExtratoArquivo,
} from '../../../interface/recebimentos/ExtratoArquivoParser.js';

/** Rótulos de coluna esperados na grade de lançamentos (normalizados sem acento/caixa). */
const HEADER_LABELS = {
    data: 'data',
    descricao: 'lancamento',
    contraparteNome: 'razao social',
    contraparteDoc: 'cpf/cnpj',
    valor: 'valor',
    saldo: 'saldo',
} as const;

/**
 * Lançamentos que NÃO são transações — são marcadores de saldo do próprio extrato. Reconhecidos pelo
 * início da descrição (normalizada), nunca importados.
 */
const MARCADORES_SALDO = ['saldo anterior', 'saldo em conta corrente', 'saldo'];

/** Normaliza texto para comparação: sem acento, minúsculo, espaços colapsados. */
const norm = (value: string): string =>
    value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

/**
 * BradescoExtratoParser — lê o "Extrato de Lançamentos" (.xlsx) do Bradesco.
 *
 * Layout (medido no arquivo real `Extrato_Lançamentos_0641_557954_*.xlsx`):
 *   - linhas de topo com metadados por rótulo (Agência / Conta / Periodo / Nome);
 *   - uma linha de cabeçalho `Data | Lançamento | Razão social | CPF/CNPJ | Valor (R$) | Saldo (R$)`;
 *   - linhas de transação (crédito com Valor > 0, débito com Valor < 0);
 *   - marcadores `SALDO ANTERIOR` (topo) e `SALDO EM CONTA CORRENTE` (rodapé), ignorados.
 *
 * O cabeçalho é LOCALIZADO por conteúdo (não por índice de linha fixo): bancos deslocam linhas de
 * metadados entre exports, e amarrar na linha 10 quebraria no primeiro extrato com uma linha a mais.
 * Emite TODAS as linhas de transação (crédito + débito) — o filtro crédito-only é do serviço.
 */
@injectable()
export default class BradescoExtratoParser implements ExtratoArquivoParserInterface {
    public readonly banco: string = 'bradesco';

    public canParse = async (buffer: Buffer): Promise<boolean> => {
        try {
            const sheet = await this.carregarPrimeiraAba(buffer);
            return this.localizarCabecalho(sheet) !== undefined;
        } catch {
            return false;
        }
    };

    public parse = async (buffer: Buffer): Promise<ExtratoArquivoParseResult> => {
        const sheet = await this.carregarPrimeiraAba(buffer);
        const header = this.localizarCabecalho(sheet);
        if (!header) {
            throw new Error(
                'Extrato Bradesco inválido: cabeçalho "Data | Lançamento | … | Valor" não encontrado.',
            );
        }

        const cabecalho = this.lerCabecalho(sheet, header.rowNumber);
        const linhas = this.lerLinhas(sheet, header);
        return { cabecalho, linhas };
    };

    private carregarPrimeiraAba = async (buffer: Buffer): Promise<ExcelJS.Worksheet> => {
        const workbook = new ExcelJS.Workbook();
        const saneado = await this.removerCorePropsQuebrado(buffer);
        // @types/node v20 torna `Buffer` genérico (`Buffer<ArrayBufferLike>`); os tipos do exceljs
        // esperam o `Buffer` clássico. Cast estreito no boundary — não afeta o runtime.
        await workbook.xlsx.load(saneado as unknown as Parameters<typeof workbook.xlsx.load>[0]);
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error('Arquivo .xlsx sem nenhuma aba.');
        return sheet;
    };

    /**
     * Remove `docProps/core.xml` do zip antes de entregar ao exceljs.
     *
     * Medido no arquivo real `Extrato_Lançamentos_0641_557954_*.xlsx`: o internet banking do Bradesco
     * grava `<lastModifiedBy>` SEM o prefixo `cp:` em `docProps/core.xml`. É válido pelo namespace
     * default do OOXML, mas o parser XML do exceljs só reconhece a forma prefixada e lança
     * `Unexpected xml node in parseOpen` — o arquivo real não carrega. `docProps/` é metadado de
     * autoria que este parser nunca lê, então removê-lo é seguro. Se o buffer não for um zip válido
     * (lixo de entrada), o `loadAsync` lança e o erro sobe normalmente — `canParse` já trata isso.
     */
    private removerCorePropsQuebrado = async (buffer: Buffer): Promise<Buffer> => {
        const zip = await JSZip.loadAsync(buffer);
        if (!zip.file('docProps/core.xml')) return buffer;
        zip.remove('docProps/core.xml');
        return zip.generateAsync({ type: 'nodebuffer' });
    };

    /**
     * Acha a linha de cabeçalho e mapeia rótulo → índice de coluna. Uma linha é o cabeçalho quando
     * contém, ao menos, `data`, `lancamento` e `valor`.
     */
    private localizarCabecalho = (
        sheet: ExcelJS.Worksheet,
    ): { rowNumber: number; cols: Record<keyof typeof HEADER_LABELS, number> } | undefined => {
        let found:
            | { rowNumber: number; cols: Record<keyof typeof HEADER_LABELS, number> }
            | undefined;

        sheet.eachRow((row, rowNumber) => {
            if (found) return;
            const cols: Partial<Record<keyof typeof HEADER_LABELS, number>> = {};
            row.eachCell((cell, colNumber) => {
                const texto = norm(this.cellText(cell.value));
                if (texto === '') return;
                for (const [key, label] of Object.entries(HEADER_LABELS)) {
                    if (texto === label || texto.startsWith(label)) {
                        cols[key as keyof typeof HEADER_LABELS] = colNumber;
                    }
                }
            });
            if (cols.data && cols.descricao && cols.valor) {
                found = { rowNumber, cols: cols as Record<keyof typeof HEADER_LABELS, number> };
            }
        });

        return found;
    };

    /** Lê metadados (Agência/Conta/Periodo/Nome) das linhas ANTES do cabeçalho, por rótulo. */
    private lerCabecalho = (
        sheet: ExcelJS.Worksheet,
        headerRow: number,
    ): CabecalhoExtratoArquivo => {
        const cabecalho: CabecalhoExtratoArquivo = { banco: this.banco };

        for (let r = 1; r < headerRow; r++) {
            const row = sheet.getRow(r);
            const rotulo = norm(this.cellText(row.getCell(1).value));
            const valor = this.cellText(row.getCell(2).value).trim();
            if (valor !== '') this.aplicarMetadado(cabecalho, rotulo, valor);
        }

        return cabecalho;
    };

    /** Aplica um par (rótulo, valor) do topo ao cabeçalho — extraído para achatar a complexidade. */
    private aplicarMetadado = (
        cabecalho: CabecalhoExtratoArquivo,
        rotulo: string,
        valor: string,
    ): void => {
        if (rotulo.startsWith('agencia')) cabecalho.agencia = valor;
        else if (rotulo.startsWith('conta')) cabecalho.conta = valor;
        else if (rotulo.startsWith('nome')) cabecalho.nome = valor;
        else if (rotulo.startsWith('periodo')) {
            const periodo = this.parsePeriodo(valor);
            if (periodo.de) cabecalho.periodoDe = periodo.de;
            if (periodo.ate) cabecalho.periodoAte = periodo.ate;
        }
    };

    /** `03/08/2026 até 03/08/2026` → { de, ate }. Tolera separadores e ausência do "até". */
    private parsePeriodo = (texto: string): { de?: Date; ate?: Date } => {
        const datas = texto.match(/\d{2}\/\d{2}\/\d{4}/g) ?? [];
        return {
            de: datas[0] ? this.parseDataBr(datas[0]) : undefined,
            ate: datas[1] ? this.parseDataBr(datas[1]) : this.parseDataBr(datas[0] ?? ''),
        };
    };

    private lerLinhas = (
        sheet: ExcelJS.Worksheet,
        header: { rowNumber: number; cols: Record<keyof typeof HEADER_LABELS, number> },
    ): LinhaExtratoArquivo[] => {
        const linhas: LinhaExtratoArquivo[] = [];
        sheet.eachRow((row, rowNumber) => {
            if (rowNumber <= header.rowNumber) return;
            const linha = this.construirLinha(row, rowNumber, header.cols);
            if (linha) linhas.push(linha);
        });
        return linhas;
    };

    /** Texto de uma célula por índice de coluna (que pode nem existir no layout). */
    private lerCelula = (row: ExcelJS.Row, col: number | undefined): string =>
        col !== undefined ? this.cellText(row.getCell(col).value) : '';

    /** Uma linha de transação, ou `undefined` se for marcador de saldo / linha sem data-valor. */
    private construirLinha = (
        row: ExcelJS.Row,
        rowNumber: number,
        cols: Record<keyof typeof HEADER_LABELS, number>,
    ): LinhaExtratoArquivo | undefined => {
        const dataCell = row.getCell(cols.data).value;
        const descricao = this.cellText(row.getCell(cols.descricao).value).trim();
        const valorCell = row.getCell(cols.valor).value;

        // Marcadores de saldo e linhas sem data/valor não são transações.
        if (MARCADORES_SALDO.includes(norm(descricao))) return undefined;
        const data = this.parseData(dataCell);
        const valor = this.parseValor(valorCell);
        if (!data || valor === undefined) return undefined;

        const contraparteNome = this.lerCelula(row, cols.contraparteNome).trim();
        const contraparteDoc = this.lerCelula(row, cols.contraparteDoc).replace(/\D/g, '');

        return {
            data,
            descricao,
            ...(contraparteNome !== '' ? { contraparteNome } : {}),
            ...(contraparteDoc !== '' ? { contraparteDoc } : {}),
            valor,
            linhaIndice: rowNumber,
            raw: {
                data: this.cellText(dataCell),
                lancamento: descricao,
                razaoSocial: contraparteNome,
                cpfCnpj: contraparteDoc,
                valor: this.cellText(valorCell),
                saldo: this.lerCelula(row, cols.saldo),
            },
        };
    };

    /** Valor da célula em texto — cobre string, número, data, rich-text e fórmula do exceljs. */
    private cellText = (value: ExcelJS.CellValue): string => {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (value instanceof Date) return value.toISOString();
        if (typeof value === 'object') {
            const obj = value as {
                richText?: Array<{ text: string }>;
                result?: unknown;
                text?: string;
            };
            if (Array.isArray(obj.richText)) return obj.richText.map((t) => t.text).join('');
            if (obj.result !== undefined) return this.cellText(obj.result as ExcelJS.CellValue);
            if (typeof obj.text === 'string') return obj.text;
        }
        return String(value);
    };

    /** Data da célula — aceita Date do exceljs ou string `dd/mm/yyyy`. */
    private parseData = (value: ExcelJS.CellValue): Date | undefined => {
        if (value instanceof Date) return value;
        const texto = this.cellText(value).trim();
        if (texto === '') return undefined;
        return this.parseDataBr(texto);
    };

    /** `dd/mm/yyyy` → Date ao meio-dia UTC (evita virada de dia por fuso). */
    private parseDataBr = (texto: string): Date | undefined => {
        const m = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!m) return undefined;
        const [, dd, mm, yyyy] = m;
        return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0));
    };

    /**
     * Valor COM SINAL. Aceita número direto (célula numérica) e string pt-BR (`R$ 1.234,56`, `-690,00`).
     * `undefined` quando a célula está vazia/ilegível — o chamador trata como "não é transação".
     */
    private parseValor = (value: ExcelJS.CellValue): number | undefined => {
        if (typeof value === 'number') return value;
        let texto = this.cellText(value).trim();
        if (texto === '') return undefined;

        texto = texto.replace(/r\$/i, '').replace(/\s/g, '');
        const negativo = texto.startsWith('-') || /^\(.*\)$/.test(texto);
        texto = texto.replace(/[()]/g, '').replace(/^-/, '');
        // pt-BR: ponto = milhar, vírgula = decimal.
        texto = texto.replace(/\./g, '').replace(',', '.');

        const n = Number(texto);
        if (!Number.isFinite(n)) return undefined;
        return negativo ? -n : n;
    };
}
