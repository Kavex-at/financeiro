import { inject, injectable } from 'tsyringe';
import ConexosCadastroClient from '../../client/ConexosCadastroClient.js';
import ConexosFinanceiroClient from '../../client/ConexosFinanceiroClient.js';
import ConexosTitulosClient, { siglaMoedaNegociada } from '../../client/ConexosTitulosClient.js';
import AlocacaoEmBorderoError from '../../errors/AlocacaoEmBorderoError.js';
import AlocacaoSaldoError from '../../errors/AlocacaoSaldoError.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import PermutaAlocacaoRepository from '../../repository/permutas/PermutaAlocacaoRepository.js';
import PermutaExecucaoRepository from '../../repository/permutas/PermutaExecucaoRepository.js';
import PermutaRelationalRepository from '../../repository/permutas/PermutaRelationalRepository.js';
import LogService from '../LogService.js';
import SaldoAlocacaoAdiantamentoService from './SaldoAlocacaoAdiantamentoService.js';
import VariacaoCambialPermutaService from './VariacaoCambialPermutaService.js';

/** Teto de invoices buscadas em paralelo no Conexos (3 chamadas/invoice). Cap = bound de I/O (performance-1). */
const INVOICES_CONCURRENCY = 8;

/** Invoice encontrada na busca cross-process (live no Conexos), p/ a alocação manual. */
export interface InvoiceBuscada {
    docCod: string;
    priCod: string;
    filCod: number;
    referencia?: string;
    exportador?: string;
    dataEmissao?: string;
    valorMoedaNegociada?: number;
    moeda?: string;
    taxa?: number;
    /** O processo da invoice tem D.I/DUIMP? (a alocação exige `true`). */
    temDi: boolean;
    /** Data-base da D.I (ISO) — âncora da variação/aging. */
    dataBase?: string;
    /**
     * Σ já alocado nesta invoice por OUTROS adiantamentos (exclui o adiantamento
     * que está alocando, quando informado). É o que o saldo da invoice já consumiu
     * num cenário N:M (invoice compartilhada). `valorMoedaNegociada − jaAlocado` =
     * disponível desta invoice — espelha o teto aplicado no `alocar`.
     */
    jaAlocado: number;
}

export interface AlocarInput {
    adiantamentoDocCod: string;
    invoiceDocCod: string;
    invoicePriCod: string;
    valorAlocado: number;
    criadoPor: string;
    observacao?: string;
}

/** Soma `valorNegociado` de todas as parcelas (com308) de um documento. */
const somaValorNegociado = (
    titulos: ReadonlyArray<{ valorNegociado?: number }>,
): number | undefined => {
    const comValor = titulos.filter((t) => t.valorNegociado !== undefined);
    if (comValor.length === 0) return undefined;
    return comValor.reduce((acc, t) => acc + (t.valorNegociado ?? 0), 0);
};

/**
 * AlocacaoPermutasService — alocação manual N:M CROSS-PROCESS (Fase 2).
 *
 * O analista, a partir de um adiantamento `permuta-manual`, busca invoices de
 * QUALQUER processo (live no Conexos) e distribui valores parciais. READ-ONLY no
 * ERP — a única escrita é a tabela própria `permuta_alocacao` (a baixa em `fin010`
 * é a Fase 3). Invariantes de saldo (em moeda NEGOCIADA): Σ por adto ≤ saldo a
 * permutar; Σ por invoice ≤ valor em aberto. Invoice DEVE ter D.I/DUIMP.
 */
@injectable()
export default class AlocacaoPermutasService {
    constructor(
        @inject(ConexosFinanceiroClient) private conexosFinanceiroClient: ConexosFinanceiroClient,
        @inject(ConexosCadastroClient) private conexosCadastroClient: ConexosCadastroClient,
        @inject(ConexosTitulosClient) private conexosTitulosClient: ConexosTitulosClient,
        @inject(VariacaoCambialPermutaService)
        private variacaoCambialService: VariacaoCambialPermutaService,
        @inject(PermutaAlocacaoRepository)
        private alocacaoRepository: PermutaAlocacaoRepository,
        @inject(PermutaExecucaoRepository)
        private execucaoRepository: PermutaExecucaoRepository,
        @inject(PermutaRelationalRepository)
        private relationalRepository: PermutaRelationalRepository,
        @inject(LogService) private logService: LogService,
        @inject(BoundedConcurrency) private boundedConcurrency: BoundedConcurrency,
        @inject(SaldoAlocacaoAdiantamentoService)
        private saldoAlocacaoService: SaldoAlocacaoAdiantamentoService,
    ) {}

    /**
     * Busca LIVE as INVOICEs FINALIZADAS de um processo NA FILIAL dada, enriquece com
     * valor/taxa negociada (com308) e marca se o processo tem D.I/DUIMP.
     *
     * IMPORTANTE: o `priCod` NÃO é único entre filiais (cada filial numera seus
     * processos) — ex.: "523" na filial 4 = ZHEJIANG VOB, "523" na filial 6 = THE
     * ABSOLUT COMPANY. Por isso a busca é SEMPRE escopada à filial do adiantamento.
     *
     * `excludeAdtoDocCod` (opcional): ao buscar para um adiantamento específico,
     * o `jaAlocado` de cada invoice soma o que OUTROS adiantamentos já alocaram
     * nela (excluindo este) — assim a UI mostra o disponível real da invoice
     * compartilhada (N:M), idêntico ao teto que o `alocar` aplica.
     */
    public buscarInvoices = async (
        priCod: string,
        filCod: number,
        excludeAdtoDocCod?: string,
    ): Promise<InvoiceBuscada[]> => {
        const { invoices: todas } = await this.conexosFinanceiroClient.listFinanceiroAPagar({
            priCods: [priCod],
            docTip: 'INVOICE',
            filCod,
        });
        if (todas.length === 0) return [];
        // D.I do processo nesta filial (a alocação exige; é a âncora da variação).
        const declaracoes = await this.conexosCadastroClient.listDeclaracaoByProcesso({
            priCods: [priCod],
            filCod,
        });
        const decl = declaracoes[0];
        const dataBase = decl?.dataBase;
        // Cap de concorrência (performance-1): cada invoice dispara ~3 chamadas ao Conexos
        // (getDetalheTitulos + listTitulosAPagar + sumByInvoice). Sem teto, um processo com muitas
        // invoices estouraria o Conexos. `map` é drop-in do `Promise.all(items.map(...))` com bound.
        const mapeadas = await this.boundedConcurrency.map(
            todas,
            async (i): Promise<InvoiceBuscada | null> => {
                // EM ABERTO vem do DETALHE — o `pago`/`aberto` da lista vem null
                // (inconfiável, mesmo motivo do gate-3). Uma invoice já liquidada
                // (pago) não tem crédito a abater → fora da permuta.
                let aberta = true;
                try {
                    const det = await this.conexosTitulosClient.getDetalheTitulos({
                        docCod: i.docCod,
                        filCod,
                    });
                    aberta = det.pago !== true;
                } catch {
                    // detalhe indisponível — conservador: mantém (não esconde possível em-aberto).
                }
                if (!aberta) return null;
                let valorMoedaNegociada: number | undefined;
                let moeda: string | undefined = i.moeda;
                let taxa: number | undefined;
                try {
                    const tit = await this.conexosTitulosClient.listTitulosAPagar({
                        docCod: i.docCod,
                        filCod,
                    });
                    valorMoedaNegociada = somaValorNegociado(tit);
                    moeda = (tit[0] ? siglaMoedaNegociada(tit[0]) : undefined) ?? i.moeda;
                    taxa = tit[0]?.taxa;
                } catch {
                    // com308 indisponível — segue sem valor/taxa negociada.
                }
                // Quanto OUTROS adiantamentos já alocaram nesta invoice (N:M): o
                // disponível mostrado na UI = valorMoedaNegociada − jaAlocado.
                const jaAlocado = await this.alocacaoRepository.sumByInvoice(
                    i.docCod,
                    excludeAdtoDocCod,
                );
                return {
                    docCod: i.docCod,
                    priCod: i.priCod,
                    filCod,
                    ...(i.referencia !== undefined ? { referencia: i.referencia } : {}),
                    ...(i.exportador !== undefined ? { exportador: i.exportador } : {}),
                    ...(i.dataEmissao !== undefined
                        ? { dataEmissao: i.dataEmissao.toISOString() }
                        : {}),
                    ...(valorMoedaNegociada !== undefined ? { valorMoedaNegociada } : {}),
                    ...(moeda !== undefined ? { moeda } : {}),
                    ...(taxa !== undefined ? { taxa } : {}),
                    temDi: decl !== undefined,
                    ...(dataBase !== undefined ? { dataBase: dataBase.toISOString() } : {}),
                    jaAlocado,
                };
            },
            INVOICES_CONCURRENCY,
        );
        return mapeadas.filter((x): x is InvoiceBuscada => x !== null);
    };

    /**
     * Cria/atualiza uma alocação adto↔invoice (rascunho). Re-busca a invoice LIVE
     * (saldo/taxa/D.I atuais), valida os invariantes de saldo dos dois lados,
     * recalcula a variação cambial pela taxa da invoice + valor alocado e persiste.
     */
    public alocar = async (
        input: AlocarInput,
        // performance-1/2: lista de invoices já buscada (mesmo processo/filial), p/ a auto-alocação em
        // lote NÃO re-buscar o Conexos a cada item (era O(N²)). `undefined` → busca normalmente.
        prefetchedInvoices?: InvoiceBuscada[],
    ): Promise<void> => {
        const { adiantamentoDocCod, invoiceDocCod, invoicePriCod, valorAlocado } = input;
        if (!(valorAlocado > 0)) {
            throw new AlocacaoSaldoError({
                lado: 'adiantamento',
                disponivel: 0,
                pedido: valorAlocado,
            });
        }

        const adto = await this.relationalRepository.findAdiantamento(adiantamentoDocCod);
        if (!adto) throw new Error(`adiantamento ${adiantamentoDocCod} not found`);

        // Múltiplas/cross-over (casamento-manual) só permutam no MESMO processo do
        // adiantamento; só cross-process (permuta-manual = cliente-filtro) casa com
        // invoice de OUTRO processo. Rede de segurança contra alocação cross-process indevida.
        if (adto.estadoElegibilidade === 'casamento-manual' && invoicePriCod !== adto.priCod) {
            throw new Error(
                `same-process allocation required: invoice process ${invoicePriCod} != adiantamento process ${adto.priCod}`,
            );
        }

        // Invoice ao vivo — fonte confiável de saldo/taxa/D.I. Escopada à filial do
        // adiantamento (priCod não é único entre filiais).
        if (adto.filCod === undefined) {
            throw new Error(`adiantamento ${adiantamentoDocCod} without filial`);
        }
        // Reusa a lista pré-buscada quando o caller já a tem (auto-alocação em lote, mesmo processo) —
        // snapshot consistente E sem re-fetch O(N²). Senão busca ao vivo.
        const invoices =
            prefetchedInvoices ?? (await this.buscarInvoices(invoicePriCod, adto.filCod));
        const invoice = invoices.find((i) => i.docCod === invoiceDocCod);
        if (!invoice)
            throw new Error(`invoice ${invoiceDocCod} not found in process ${invoicePriCod}`);
        if (!invoice.temDi) {
            throw new Error(`invoice ${invoiceDocCod} without D.I/DUIMP — cannot be permuted`);
        }

        // Moeda negociada do adto e da invoice DEVEM coincidir — não se permuta um
        // adiantamento em USD contra uma invoice em BRL (moedas distintas; o saldo e a
        // variação cambial não fariam sentido). Compara só quando ambas são conhecidas.
        if (
            adto.moedaNegociada !== undefined &&
            invoice.moeda !== undefined &&
            adto.moedaNegociada !== invoice.moeda
        ) {
            throw new Error(
                `currency mismatch: adiantamento ${adto.moedaNegociada} != invoice ${invoice.moeda}`,
            );
        }

        // Saldo do ADIANTAMENTO (em moeda negociada): saldoPermutar(BRL) / taxaAdto, menos as
        // alocações dos OUTROS pares ainda NÃO consumidas pelo ERP (ADR-0046 D3) — mesma regra do
        // `saldoRestante` da tela (fonte única: SaldoAlocacaoAdiantamentoService).
        const taxaAdto = adto.taxa;
        const saldoAdtoNeg =
            adto.valorPermutar !== undefined && taxaAdto !== undefined && taxaAdto > 0
                ? adto.valorPermutar / taxaAdto
                : undefined;
        const jaAdto = await this.saldoAlocacaoService.somaNaoConsumidaDoAdiantamento(
            adiantamentoDocCod,
            invoiceDocCod,
        );
        if (saldoAdtoNeg !== undefined && valorAlocado > saldoAdtoNeg - jaAdto + 0.005) {
            throw new AlocacaoSaldoError({
                lado: 'adiantamento',
                disponivel: Math.max(0, saldoAdtoNeg - jaAdto),
                pedido: valorAlocado,
            });
        }

        // Saldo da INVOICE (valor em aberto, moeda negociada).
        const saldoInvoiceNeg = invoice.valorMoedaNegociada;
        const jaInvoice = await this.alocacaoRepository.sumByInvoice(
            invoiceDocCod,
            adiantamentoDocCod,
        );
        if (saldoInvoiceNeg !== undefined && valorAlocado > saldoInvoiceNeg - jaInvoice + 0.005) {
            throw new AlocacaoSaldoError({
                lado: 'invoice',
                disponivel: Math.max(0, saldoInvoiceNeg - jaInvoice),
                pedido: valorAlocado,
            });
        }

        // Variação cambial pela taxa da INVOICE escolhida + valor alocado (parcial).
        const moeda = adto.moedaNegociada ?? invoice.moeda ?? 'USD';
        const variacao =
            taxaAdto !== undefined && invoice.taxa !== undefined
                ? this.variacaoCambialService.calcular({
                      moeda,
                      principalMoeda: valorAlocado,
                      taxaAdiantamento: taxaAdto,
                      taxaInvoice: invoice.taxa,
                      ...(invoice.dataBase !== undefined
                          ? { dataBase: new Date(invoice.dataBase) }
                          : {}),
                  })
                : undefined;

        await this.alocacaoRepository.upsertAlocacao({
            adiantamentoDocCod,
            invoiceDocCod,
            invoicePriCod,
            valorAlocado,
            moeda,
            ...(variacao?.classificacao !== undefined
                ? { variacaoClassificacao: variacao.classificacao }
                : {}),
            ...(variacao?.resultado !== undefined ? { variacaoResultado: variacao.resultado } : {}),
            ...(variacao?.delta !== undefined ? { variacaoDelta: variacao.delta } : {}),
            ...(taxaAdto !== undefined ? { taxaAdiantamento: taxaAdto } : {}),
            ...(invoice.taxa !== undefined ? { taxaInvoice: invoice.taxa } : {}),
            // Data-base da D.I/DUIMP → vira a Data do borderô (borDtaMvto) na baixa fin010.
            ...(invoice.dataBase !== undefined ? { dataBase: new Date(invoice.dataBase) } : {}),
            criadoPor: input.criadoPor,
            ...(input.observacao !== undefined ? { observacao: input.observacao } : {}),
        });

        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'permuta alocacao manual gravada',
            data: { adiantamentoDocCod, invoiceDocCod, invoicePriCod, valorAlocado },
        });
    };

    public remover = async (adiantamentoDocCod: string, invoiceDocCod: string): Promise<void> => {
        // TRAVA DE INTEGRIDADE (inviolável): uma alocação JÁ usada para abrir um borderô no ERP NÃO pode
        // ser removida — isso descasaria a trilha do que foi baixado no fin010 (o saldo do adiantamento
        // voltaria integral) e abriria porta para DUPLA baixa. Reverter = cancelar/excluir o borderô na
        // aba Borderôs (estorna no ERP), nunca apagar a alocação. Vale p/ múltipla/cross-over/cross-process.
        const borCod = await this.execucaoRepository.borderoDoPar(
            adiantamentoDocCod,
            invoiceDocCod,
        );
        if (borCod !== null) {
            throw new AlocacaoEmBorderoError({ adiantamentoDocCod, invoiceDocCod, borCod });
        }
        await this.alocacaoRepository.deleteAlocacao(adiantamentoDocCod, invoiceDocCod);
    };

    /**
     * AUTO-ALOCAÇÃO (regra 2026-06-24) — múltipla AUTOMÁTICA: cria as alocações sozinho quando o
     * adiantamento é casamento-manual, ÚNICO casamento-manual do processo (1 adto → N invoices, ≠
     * cross-over), e o saldo do adto COBRE todas as invoices do processo (adto saldoNeg ≥ Σ invoices,
     * USD negociado). Aloca cada invoice (com D.I) o seu disponível, reaproveitando `alocar` (caps +
     * variação + dataBase). Idempotente: se já houver alocação, devolve true sem recriar. Retorna
     * false (segue manual) quando não é elegível — defesa server-side do "auto-alocar no Baixar".
     */
    public autoAlocarSeElegivel = async (
        adiantamentoDocCod: string,
        criadoPor: string,
    ): Promise<boolean> => {
        const jaAlocado = (await this.alocacaoRepository.listAtivas()).some(
            (a) => a.adiantamentoDocCod === adiantamentoDocCod,
        );
        if (jaAlocado) return true; // já tem rascunho → nada a fazer

        const adto = await this.relationalRepository.findAdiantamento(adiantamentoDocCod);
        if (
            !adto ||
            adto.estadoElegibilidade !== 'casamento-manual' ||
            adto.filCod === undefined ||
            adto.taxa === undefined ||
            adto.taxa <= 0 ||
            adto.valorPermutar === undefined
        ) {
            return false;
        }

        // Múltipla = ÚNICO casamento-manual do processo (cross-over com N adtos fica manual).
        const ativos = await this.relationalRepository.listAdiantamentosAtivos();
        const casamManualDoProcesso = ativos.filter(
            (a) => a.priCod === adto.priCod && a.estadoElegibilidade === 'casamento-manual',
        ).length;
        if (casamManualDoProcesso !== 1) return false;

        // Invoices vivas do processo (buscadas UMA vez — reusadas no lote, performance-2).
        const invoicesAll = await this.buscarInvoices(adto.priCod, adto.filCod);
        const invoices = invoicesAll.filter((i) => i.temDi); // sem D.I não permuta
        if (invoices.length === 0) return false;

        // O adto COBRE todas as invoices? saldoNeg(USD) ≥ Σ invoices(USD). Senão → manual.
        const saldoNeg = adto.valorPermutar / adto.taxa;
        const somaInvoices = invoices.reduce((s, i) => s + (i.valorMoedaNegociada ?? 0), 0);
        if (somaInvoices <= 0 || saldoNeg + 1 < somaInvoices) return false;

        // Cria as alocações (adto → cada invoice o seu disponível). `alocar` capa no disponível da
        // invoice e no saldo do adto; como saldoNeg ≥ Σ invoices, tudo cabe. ATÔMICO (all-or-nothing).
        const itens = invoices
            .map((inv) => ({
                invoiceDocCod: inv.docCod,
                invoicePriCod: adto.priCod,
                valorAlocado: (inv.valorMoedaNegociada ?? 0) - inv.jaAlocado,
            }))
            .filter((it) => it.valorAlocado > 0);
        // Passa a lista já buscada → `alocar` não re-busca por item (O(N) em vez de O(N²)).
        return this.criarRascunhosAtomico(adiantamentoDocCod, itens, criadoPor, invoicesAll);
    };

    /**
     * Cria os rascunhos de alocação adto→invoice de forma ATÔMICA (all-or-nothing): se um `alocar`
     * falhar no meio (ex.: queda do Conexos), REVERTE os já criados nesta chamada — evita rascunho
     * PARCIAL que viraria meia-permuta no `fin010` na baixa seguinte. Re-lança o erro original.
     * Retorna `true` só se TODOS foram criados; `false` se a lista veio vazia.
     */
    private criarRascunhosAtomico = async (
        adiantamentoDocCod: string,
        itens: Array<{ invoiceDocCod: string; invoicePriCod: string; valorAlocado: number }>,
        criadoPor: string,
        // performance-2: quando todos os itens são do MESMO processo, passa a lista já buscada uma vez
        // (evita o re-fetch do Conexos a cada `alocar` — antes O(N²)).
        prefetchedInvoices?: InvoiceBuscada[],
    ): Promise<boolean> => {
        if (itens.length === 0) return false;
        const criadas: string[] = [];
        try {
            for (const it of itens) {
                await this.alocar({ adiantamentoDocCod, ...it, criadoPor }, prefetchedInvoices);
                criadas.push(it.invoiceDocCod);
            }
        } catch (err) {
            // Rollback dos rascunhos criados nesta chamada (compensação — são rascunhos no banco
            // próprio, sem efeito no ERP ainda). Garante que a baixa não veja alocação parcial.
            for (const invoiceDocCod of criadas) {
                try {
                    await this.remover(adiantamentoDocCod, invoiceDocCod);
                } catch {
                    // best-effort: a baixa ainda relê em-aberto vivo e capa por invoice.
                }
            }
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'auto-alocação revertida (falha parcial) — nada persistido',
                data: {
                    adiantamentoDocCod,
                    revertidas: criadas.length,
                    erro: err instanceof Error ? err.message : String(err),
                },
            });
            throw err;
        }
        return criadas.length > 0;
    };

    /**
     * AUTO-ALOCAÇÃO a partir do CASAMENTO (simples/elegível): cria as alocações do adiantamento
     * conforme o casamento já calculado na eleição (adto → invoice, `valorASerUsado` do greedy).
     * Usado pelo "Processar" da aba Automáticas, que vira baixa real (borderô) como nos manuais.
     * Idempotente: se já houver alocação, devolve true. Retorna false quando não há casamento.
     */
    public autoAlocarDeCasamento = async (
        adiantamentoDocCod: string,
        criadoPor: string,
    ): Promise<boolean> => {
        const jaAlocado = (await this.alocacaoRepository.listAtivas()).some(
            (a) => a.adiantamentoDocCod === adiantamentoDocCod,
        );
        if (jaAlocado) return true;

        const casamentos = (await this.relationalRepository.listCasamentos()).filter(
            (c) => c.adiantamentoDocCod === adiantamentoDocCod,
        );
        if (casamentos.length === 0) return false;

        const itens = casamentos
            .filter((c) => c.valorASerUsado !== undefined && c.valorASerUsado > 0)
            .map((c) => ({
                invoiceDocCod: c.invoiceDocCod,
                invoicePriCod: c.priCod,
                valorAlocado: c.valorASerUsado as number,
            }));
        return this.criarRascunhosAtomico(adiantamentoDocCod, itens, criadoPor);
    };
}
