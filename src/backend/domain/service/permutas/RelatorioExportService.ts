import ExcelJS from 'exceljs';
import { inject, injectable } from 'tsyringe';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import type {
    GestaoPermutasResponse,
    InvoiceEmAberto,
    PermutaPendente,
    StatusElegibilidade,
} from '../../interface/permutas/Gestao.js';
import type {
    CelulaValor,
    RelatorioDefinicao,
    RelatorioTipo,
} from '../../interface/permutas/Relatorio.js';
import GestaoPermutasService from './GestaoPermutasService.js';
import LogService from '../LogService.js';

/**
 * Status → coluna do relatório "Reconciliação por processo".
 *
 * `casamento-manual` e `permuta-manual` caem na MESMA coluna (`manual`) de
 * propósito: para quem lê esse relatório, os dois são "depende do analista". O
 * `Record` acomoda isso naturalmente e ainda exige que todo status tenha destino.
 */
const COLUNA_RECONCILIACAO: Readonly<
    Record<StatusElegibilidade, 'elegiveis' | 'bloqueadas' | 'manual' | 'jaPermutado' | null>
> = {
    elegivel: 'elegiveis',
    bloqueada: 'bloqueadas',
    'casamento-manual': 'manual',
    'permuta-manual': 'manual',
    'ja-permutado': 'jaPermutado',
};

/**
 * Status → coluna do relatório "Clientes".
 *
 * `casamento-manual` é `null` — este relatório é sobre a carteira POR CLIENTE, e
 * o casamento N:M é intra-processo, não diz nada sobre o cliente. A exclusão é
 * deliberada e fica escrita; o que o mapa impede é a exclusão por esquecimento.
 */
const COLUNA_CLIENTES: Readonly<
    Record<StatusElegibilidade, 'elegiveis' | 'bloqueadas' | 'permutaManual' | 'jaPermutado' | null>
> = {
    elegivel: 'elegiveis',
    bloqueada: 'bloqueadas',
    'casamento-manual': null,
    'permuta-manual': 'permutaManual',
    'ja-permutado': 'jaPermutado',
};

/** Largura padrão de coluna (caracteres) quando a coluna não especifica. */
const LARGURA_PADRAO = 18;
/** Aba do Excel aceita no máximo 31 caracteres no nome. */
const MAX_NOME_ABA = 31;

/** Rótulo humano por tipo — vira nome da aba e base do nome do arquivo. */
const TITULO_POR_TIPO: Record<RelatorioTipo, string> = {
    adiantamentos: 'Adiantamentos pendentes',
    invoices: 'Invoices em aberto',
    'ja-permutado': 'Ja permutado',
    bloqueadas: 'Bloqueadas',
    'reconciliacao-processo': 'Reconciliacao por processo',
    clientes: 'Quebra por cliente',
};

/**
 * RelatorioExportService — gera planilhas Excel (.xlsx) dos relatórios do painel
 * de Permutas. READ-ONLY: reusa `GestaoPermutasService.exporGestao()` (uma
 * leitura), então cada export casa 1:1 com o que o painel mostra (snapshot
 * completo, sem filtros). A projeção (`montarDefinicao`) é separada da
 * serialização (`serializar`) para permitir teste sem ler bytes do xlsx.
 */
@injectable()
export default class RelatorioExportService {
    constructor(
        @inject(GestaoPermutasService) private gestaoService: GestaoPermutasService,
        @inject(LogService) private logService: LogService,
    ) {}

    /** Gera o relatório `tipo`: devolve o nome de arquivo + o buffer xlsx. */
    public exportar = async (
        tipo: RelatorioTipo,
        requestId: string,
    ): Promise<{ filename: string; buffer: Buffer }> => {
        const gestao = await this.gestaoService.exporGestao(requestId);
        const definicao = this.montarDefinicao(tipo, gestao);
        const buffer = await this.serializar(definicao);
        const filename = this.nomeArquivo(tipo, gestao);
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'permuta relatorio exportado',
            data: { requestId, tipo, linhas: definicao.linhas.length },
        });
        return { filename, buffer };
    };

    /** Projeta a `GestaoPermutasResponse` na definição do relatório `tipo`. */
    public montarDefinicao = (
        tipo: RelatorioTipo,
        gestao: GestaoPermutasResponse,
    ): RelatorioDefinicao => {
        const titulo = TITULO_POR_TIPO[tipo];
        switch (tipo) {
            case 'adiantamentos':
                return this.defAdiantamentos(tipo, titulo, gestao.pendentes);
            case 'ja-permutado':
                return this.defAdiantamentos(
                    tipo,
                    titulo,
                    gestao.pendentes.filter((p) => p.status === 'ja-permutado'),
                );
            case 'bloqueadas':
                return this.defAdiantamentos(
                    tipo,
                    titulo,
                    gestao.pendentes.filter((p) => p.status === 'bloqueada'),
                );
            case 'invoices':
                return this.defInvoices(tipo, titulo, gestao.invoicesEmAberto);
            case 'reconciliacao-processo':
                return this.defReconciliacaoProcesso(tipo, titulo, gestao);
            case 'clientes':
                return this.defClientes(tipo, titulo, gestao);
        }
    };

    // ---- Projeções por relatório -------------------------------------------

    /**
     * Conta `adtos` nas colunas de um relatório, guiado por um mapa
     * `Record<StatusElegibilidade, coluna | null>`.
     *
     * Regis-Review 2026-09-08, card `assertNever-propagacao`. Antes era uma
     * sequência de `filter` nominais por coluna, e um status novo simplesmente
     * não seria contado em lugar nenhum — a linha do relatório fecharia com
     * números que não somam o total, sem nada reclamar. O mapa força a decisão
     * ("este status entra em qual coluna, ou em nenhuma?") no ponto certo, e o
     * `Record` faz o build quebrar lá quando a união crescer.
     */
    private contar = <C extends string>(
        adtos: ReadonlyArray<{ status: StatusElegibilidade }>,
        colunaDoStatus: Readonly<Record<StatusElegibilidade, C | null>>,
        zeros: Record<C, number>,
    ): Record<C, number> => {
        const total = { ...zeros };
        for (const adto of adtos) {
            const coluna = colunaDoStatus[adto.status];
            if (coluna === null) continue;
            total[coluna] += 1;
        }
        return total;
    };

    private defAdiantamentos = (
        tipo: RelatorioTipo,
        titulo: string,
        pendentes: PermutaPendente[],
    ): RelatorioDefinicao => ({
        tipo,
        titulo,
        colunas: [
            { header: 'Documento', key: 'docCod', width: 16 },
            { header: 'Filial', key: 'filCod', width: 8 },
            { header: 'Processo', key: 'priCod', width: 14 },
            { header: 'Referencia', key: 'referencia', width: 16 },
            { header: 'Exportador', key: 'exportador', width: 22 },
            { header: 'Importador (cliente)', key: 'importador', width: 24 },
            { header: 'Status', key: 'status', width: 16 },
            { header: 'Motivo bloqueio', key: 'motivoBloqueio', width: 18 },
            { header: 'Tipo permuta', key: 'tipoPermuta', width: 14 },
            { header: 'Valor (moeda neg.)', key: 'valorMoedaNegociada', width: 18 },
            { header: 'Moeda', key: 'moeda', width: 8 },
            { header: 'Valor BRL', key: 'valorBrl', width: 16 },
            { header: 'Dias em aberto', key: 'diasEmAberto', width: 14 },
            { header: 'Pago', key: 'pago', width: 8 },
            { header: 'Emissao', key: 'dataEmissao', width: 12 },
            { header: 'Valor a permutar (BRL)', key: 'valorPermutar', width: 20 },
            { header: 'Valor total (BRL)', key: 'valorTotal', width: 18 },
            { header: 'Valor em aberto (BRL)', key: 'valorAberto', width: 20 },
            { header: 'Declaracao', key: 'declaracao', width: 10 },
            { header: 'Data-base D.I/DUIMP', key: 'declaracaoDataBase', width: 18 },
            { header: 'Taxa adiantamento', key: 'taxaAdiantamento', width: 16 },
            { header: 'Taxa invoice', key: 'taxaInvoice', width: 14 },
            { header: 'Variacao (classif.)', key: 'variacaoClassificacao', width: 18 },
            { header: 'Variacao (resultado)', key: 'variacaoResultado', width: 18 },
            { header: 'Variacao (delta)', key: 'variacaoDelta', width: 16 },
            { header: 'Auto-elegivel', key: 'autoElegivel', width: 12 },
            { header: 'Saldo restante (moeda neg.)', key: 'saldoRestante', width: 24 },
            // Exceção manual "permutado fora do painel" (ADR-0047). `Motivo bloqueio` segue com
            // o código cru, como os demais motivos; o rótulo humano vive nesta coluna.
            { header: 'Exceção manual', key: 'excecaoManual', width: 36 },
            { header: 'Justificativa exceção', key: 'excecaoJustificativa', width: 48 },
            { header: 'Autor exceção', key: 'excecaoAutor', width: 24 },
            { header: 'Data exceção', key: 'excecaoData', width: 12 },
        ],
        linhas: pendentes.map((p) => {
            const d = p.detalhe;
            return {
                docCod: p.docCod,
                filCod: p.filCod,
                priCod: d?.priCod ?? null,
                referencia: p.referencia,
                exportador: p.exportador,
                importador: p.importador ?? null,
                status: p.status,
                motivoBloqueio: p.motivoBloqueio ?? null,
                tipoPermuta: p.tipoPermuta ?? null,
                valorMoedaNegociada: p.valorMoedaNegociada,
                moeda: p.moeda,
                valorBrl: p.valorBrl,
                diasEmAberto: p.diasEmAberto,
                pago: d?.pago ?? null,
                dataEmissao: this.soData(d?.dataEmissao),
                valorPermutar: d?.valorPermutar ?? null,
                valorTotal: d?.valorTotal ?? null,
                valorAberto: d?.valorAberto ?? null,
                declaracao: d?.declaracao?.variante ?? null,
                declaracaoDataBase: this.soData(d?.declaracao?.dataBase),
                taxaAdiantamento: d?.taxaAdiantamento ?? null,
                taxaInvoice: d?.taxaInvoice ?? null,
                variacaoClassificacao: d?.variacaoClassificacao ?? null,
                variacaoResultado: d?.variacaoResultado ?? null,
                variacaoDelta: d?.variacaoDelta ?? null,
                autoElegivel: p.autoElegivel === true,
                saldoRestante: p.saldoRestante ?? null,
                ...this.celulasExcecao(p),
            };
        }),
    });

    private defInvoices = (
        tipo: RelatorioTipo,
        titulo: string,
        invoices: InvoiceEmAberto[],
    ): RelatorioDefinicao => ({
        tipo,
        titulo,
        colunas: [
            { header: 'Documento', key: 'docCod', width: 16 },
            { header: 'Filial', key: 'filCod', width: 8 },
            { header: 'Processo', key: 'priCod', width: 14 },
            { header: 'Emissao', key: 'dataEmissao', width: 12 },
            { header: 'Referencia', key: 'referencia', width: 16 },
            { header: 'Exportador', key: 'exportador', width: 22 },
            { header: 'Importador (cliente)', key: 'importador', width: 24 },
            { header: 'Valor (moeda neg.)', key: 'valorMoedaNegociada', width: 18 },
            { header: 'Moeda', key: 'moeda', width: 8 },
            { header: 'Valor BRL', key: 'valorBrl', width: 16 },
            { header: 'Taxa', key: 'taxa', width: 12 },
        ],
        linhas: invoices.map((i) => ({
            docCod: i.docCod,
            filCod: i.filCod,
            priCod: i.priCod ?? null,
            dataEmissao: this.soData(i.dataEmissao),
            referencia: i.referencia,
            exportador: i.exportador,
            importador: i.importador ?? null,
            valorMoedaNegociada: i.valorMoedaNegociada,
            moeda: i.moeda,
            valorBrl: i.valorBrl,
            taxa: i.taxa ?? null,
        })),
    });

    private defReconciliacaoProcesso = (
        tipo: RelatorioTipo,
        titulo: string,
        gestao: GestaoPermutasResponse,
    ): RelatorioDefinicao => {
        const porProcesso = new Map<
            string,
            {
                importador?: string;
                adtos: PermutaPendente[];
                invoices: InvoiceEmAberto[];
            }
        >();
        const obter = (priCod: string) => {
            let g = porProcesso.get(priCod);
            if (!g) {
                g = { adtos: [], invoices: [] };
                porProcesso.set(priCod, g);
            }
            return g;
        };
        for (const p of gestao.pendentes) {
            const priCod = p.detalhe?.priCod ?? '(sem processo)';
            const g = obter(priCod);
            g.adtos.push(p);
            if (g.importador === undefined && p.importador !== undefined)
                g.importador = p.importador;
        }
        for (const i of gestao.invoicesEmAberto) {
            const priCod = i.priCod ?? '(sem processo)';
            const g = obter(priCod);
            g.invoices.push(i);
            if (g.importador === undefined && i.importador !== undefined)
                g.importador = i.importador;
        }

        const linhas = [...porProcesso.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([priCod, g]) => {
                const numAdtos = g.adtos.length;
                const numInvoices = g.invoices.length;
                const saldoAdtosUsd = this.soma(g.adtos.map((a) => a.valorMoedaNegociada));
                const somaInvoicesUsd = this.soma(g.invoices.map((i) => i.valorMoedaNegociada));
                const agings = g.adtos
                    .map((a) => a.diasEmAberto)
                    .filter((n): n is number => n !== null);
                return {
                    priCod,
                    importador: g.importador ?? null,
                    numAdtos,
                    numInvoices,
                    cardinalidade: this.cardinalidade(numAdtos, numInvoices),
                    saldoAdtosUsd,
                    somaInvoicesUsd,
                    coberturaPct:
                        somaInvoicesUsd > 0
                            ? Math.round((saldoAdtosUsd / somaInvoicesUsd) * 100)
                            : null,
                    ...this.contar(g.adtos, COLUNA_RECONCILIACAO, {
                        elegiveis: 0,
                        bloqueadas: 0,
                        manual: 0,
                        jaPermutado: 0,
                    }),
                    agingMedio:
                        agings.length > 0 ? Math.round(this.soma(agings) / agings.length) : null,
                    agingMax: agings.length > 0 ? Math.max(...agings) : null,
                };
            });

        return {
            tipo,
            titulo,
            colunas: [
                { header: 'Processo', key: 'priCod', width: 14 },
                { header: 'Importador (cliente)', key: 'importador', width: 24 },
                { header: '# Adiantamentos', key: 'numAdtos', width: 16 },
                { header: '# Invoices', key: 'numInvoices', width: 12 },
                { header: 'Cardinalidade', key: 'cardinalidade', width: 14 },
                { header: 'Saldo adtos (moeda neg.)', key: 'saldoAdtosUsd', width: 22 },
                { header: 'Soma invoices (moeda neg.)', key: 'somaInvoicesUsd', width: 24 },
                { header: 'Cobertura %', key: 'coberturaPct', width: 12 },
                { header: '# Elegiveis', key: 'elegiveis', width: 12 },
                { header: '# Bloqueadas', key: 'bloqueadas', width: 12 },
                { header: '# Manuais', key: 'manual', width: 12 },
                { header: '# Ja permutado', key: 'jaPermutado', width: 14 },
                { header: 'Aging medio (dias)', key: 'agingMedio', width: 16 },
                { header: 'Aging max (dias)', key: 'agingMax', width: 14 },
            ],
            linhas,
        };
    };

    private defClientes = (
        tipo: RelatorioTipo,
        titulo: string,
        gestao: GestaoPermutasResponse,
    ): RelatorioDefinicao => {
        const SEM_CLIENTE = '(sem importador)';
        const porCliente = new Map<
            string,
            { adtos: PermutaPendente[]; invoices: InvoiceEmAberto[] }
        >();
        const obter = (nome: string) => {
            let g = porCliente.get(nome);
            if (!g) {
                g = { adtos: [], invoices: [] };
                porCliente.set(nome, g);
            }
            return g;
        };
        for (const p of gestao.pendentes) obter(p.importador ?? SEM_CLIENTE).adtos.push(p);
        for (const i of gestao.invoicesEmAberto)
            obter(i.importador ?? SEM_CLIENTE).invoices.push(i);

        const linhas = [...porCliente.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([importador, g]) => {
                const agings = g.adtos
                    .map((a) => a.diasEmAberto)
                    .filter((n): n is number => n !== null);
                return {
                    importador,
                    numAdtos: g.adtos.length,
                    numInvoices: g.invoices.length,
                    valorAdtosUsd: this.soma(g.adtos.map((a) => a.valorMoedaNegociada)),
                    valorAdtosBrl: this.soma(g.adtos.map((a) => a.valorBrl)),
                    valorInvoicesUsd: this.soma(g.invoices.map((i) => i.valorMoedaNegociada)),
                    ...this.contar(g.adtos, COLUNA_CLIENTES, {
                        elegiveis: 0,
                        bloqueadas: 0,
                        permutaManual: 0,
                        jaPermutado: 0,
                    }),
                    agingMedio:
                        agings.length > 0 ? Math.round(this.soma(agings) / agings.length) : null,
                };
            });

        return {
            tipo,
            titulo,
            colunas: [
                { header: 'Importador (cliente)', key: 'importador', width: 28 },
                { header: '# Adiantamentos', key: 'numAdtos', width: 16 },
                { header: '# Invoices', key: 'numInvoices', width: 12 },
                { header: 'Valor adtos (moeda neg.)', key: 'valorAdtosUsd', width: 22 },
                { header: 'Valor adtos (BRL)', key: 'valorAdtosBrl', width: 18 },
                { header: 'Valor invoices (moeda neg.)', key: 'valorInvoicesUsd', width: 24 },
                { header: '# Elegiveis', key: 'elegiveis', width: 12 },
                { header: '# Bloqueadas', key: 'bloqueadas', width: 12 },
                { header: '# Permuta manual', key: 'permutaManual', width: 16 },
                { header: '# Ja permutado', key: 'jaPermutado', width: 14 },
                { header: 'Aging medio (dias)', key: 'agingMedio', width: 16 },
            ],
            linhas,
        };
    };

    // ---- Helpers ------------------------------------------------------------

    /** Soma uma lista de valores numéricos, ignorando `null`/`undefined`. */
    private soma = (valores: Array<number | null | undefined>): number =>
        valores.reduce<number>((acc, v) => acc + (v ?? 0), 0);

    /** Classifica a cardinalidade adtos×invoices de um processo. */
    private cardinalidade = (numAdtos: number, numInvoices: number): string => {
        if (numInvoices === 0) return 'sem-invoice';
        if (numAdtos <= 1 && numInvoices === 1) return '1:1';
        if (numAdtos <= 1) return '1:N';
        if (numInvoices === 1) return 'N:1';
        return 'N:M';
    };

    /** Extrai só a data (YYYY-MM-DD) de um ISO timestamp. `undefined` → null. */
    private soData = (iso?: string): string | null => (iso ? iso.slice(0, 10) : null);

    /**
     * As 4 células da exceção manual (ADR-0047). "Exceção manual" diz se ela está aplicada ou
     * só registrada (o cálculo do ERP venceu); sem exceção ativa, as 4 ficam em branco.
     */
    private celulasExcecao = (p: PermutaPendente): Record<string, CelulaValor> => {
        const excecao = p.excecaoManual;
        if (excecao === undefined) {
            return {
                excecaoManual: null,
                excecaoJustificativa: null,
                excecaoAutor: null,
                excecaoData: null,
            };
        }
        return {
            excecaoManual: excecao.ativa
                ? 'Permutado fora do painel (exceção manual)'
                : 'Registrada, não aplicada',
            excecaoJustificativa: excecao.justificativa,
            excecaoAutor: excecao.criadoPor,
            excecaoData: this.soData(excecao.criadoEm),
        };
    };

    /** Nome do arquivo: `permutas-<tipo>-<data-ingestao>.xlsx`. */
    private nomeArquivo = (tipo: RelatorioTipo, gestao: GestaoPermutasResponse): string => {
        const data = this.soData(gestao.geradoEm) ?? 'snapshot';
        return `permutas-${tipo}-${data}.xlsx`;
    };

    /** Serializa a definição em um buffer xlsx (exceljs). */
    private serializar = async (definicao: RelatorioDefinicao): Promise<Buffer> => {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Columbia Financeiro';
        const sheet = workbook.addWorksheet(definicao.titulo.slice(0, MAX_NOME_ABA));
        sheet.columns = definicao.colunas.map((c) => ({
            header: c.header,
            key: c.key,
            width: c.width ?? LARGURA_PADRAO,
        }));
        sheet.getRow(1).font = { bold: true };
        for (const linha of definicao.linhas) {
            sheet.addRow(linha as Record<string, CelulaValor>);
        }
        const arrayBuffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(arrayBuffer as ArrayBuffer);
    };
}
