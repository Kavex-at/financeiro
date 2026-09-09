import { inject, injectable } from 'tsyringe';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import type {
    CasamentoSugerido,
    GestaoPermutasResponse,
    InvoiceEmAberto,
    PermutaDetalhe,
    PermutaPendente,
    StatusElegibilidade,
} from '../../interface/permutas/Gestao.js';
import type { ProcessamentoStatus } from '../../interface/permutas/Processamento.js';
import type {
    AdiantamentoAtivo,
    CasamentoRow,
    DeclaracaoRow,
    EstadoElegibilidadeRow,
    InvoiceRow,
} from '../../repository/permutas/PermutaRelationalRepository.js';
import PermutaRelationalRepository from '../../repository/permutas/PermutaRelationalRepository.js';
import type { AlocacaoRow } from '../../repository/permutas/PermutaAlocacaoRepository.js';
import PermutaAlocacaoRepository from '../../repository/permutas/PermutaAlocacaoRepository.js';
import PermutaProcessamentoRepository from '../../repository/permutas/PermutaProcessamentoRepository.js';
import PermutaSnapshotRepository from '../../repository/permutas/PermutaSnapshotRepository.js';
import LogService from '../LogService.js';

/** Baldes de contagem POR STATUS do painel (fora `pendentes` e `invoicesEmAberto`,
 *  que não são baldes de status). */
type GestaoTotaisPorStatus = Pick<
    GestaoPermutasResponse['totais'],
    'elegiveis' | 'bloqueadas' | 'casamentoManual' | 'permutaManual' | 'jaPermutado'
>;

/**
 * Status de elegibilidade → balde de contagem do painel.
 *
 * `Record<StatusElegibilidade, …>` exige TODAS as chaves da união: um status novo
 * quebra o build AQUI. Regis-Review 2026-09-08, card `assertNever-propagacao`.
 * A cadeia de quebra é encadeada de propósito — um estado novo no enum quebra
 * primeiro o `statusDoEstado` (por incompatibilidade de tipo), o dev o acrescenta
 * a `StatusElegibilidade`, e então quebra aqui, onde se decide o balde.
 */
const BALDE_DO_STATUS: Record<StatusElegibilidade, keyof GestaoTotaisPorStatus> = {
    elegivel: 'elegiveis',
    bloqueada: 'bloqueadas',
    'casamento-manual': 'casamentoManual',
    'permuta-manual': 'permutaManual',
    'ja-permutado': 'jaPermutado',
};

/**
 * GestaoPermutasService — monta o payload da tela `GET /permutas/gestao` a
 * partir do modelo relacional (Fase B). Junta adiantamentos ativos + estado de
 * processamento do analista → `pendentes`; invoices em aberto → `invoicesEmAberto`;
 * casamentos automáticos → `casamentos`. `fonte:'banco'`. READ-ONLY.
 */
@injectable()
export default class GestaoPermutasService {
    constructor(
        @inject(PermutaRelationalRepository)
        private relationalRepository: PermutaRelationalRepository,
        @inject(PermutaProcessamentoRepository)
        private processamentoRepository: PermutaProcessamentoRepository,
        @inject(PermutaAlocacaoRepository)
        private alocacaoRepository: PermutaAlocacaoRepository,
        @inject(PermutaSnapshotRepository)
        private snapshotRepository: PermutaSnapshotRepository,
        @inject(LogService) private logService: LogService,
    ) {}

    public exporGestao = async (requestId: string): Promise<GestaoPermutasResponse> => {
        const [
            adiantamentos,
            invoices,
            casamentos,
            processamentos,
            declaracoes,
            alocacoes,
            ultimaIngestao,
        ] = await Promise.all([
            this.relationalRepository.listAdiantamentosAtivos(),
            this.relationalRepository.listInvoicesEmAberto(),
            this.relationalRepository.listCasamentos(),
            this.processamentoRepository.listProcessamentos(),
            this.relationalRepository.listDeclaracoes(),
            this.alocacaoRepository.listAtivas(),
            this.snapshotRepository.findLatestIngestFinishedAt(),
        ]);

        // Alocações manuais (Fase 2) agrupadas por adiantamento.
        const alocacoesByAdto = new Map<string, AlocacaoRow[]>();
        for (const a of alocacoes) {
            const list = alocacoesByAdto.get(a.adiantamentoDocCod) ?? [];
            list.push(a);
            alocacoesByAdto.set(a.adiantamentoDocCod, list);
        }

        const statusByDocCod = new Map<string, ProcessamentoStatus>(
            processamentos.map((p) => [p.adiantamentoDocCod, p.status]),
        );
        const invoiceByDocCod = new Map<string, InvoiceRow>(invoices.map((i) => [i.docCod, i]));
        // Detalhe: declaração por processo (1ª variante DI/DUIMP) + casamento por
        // adiantamento (taxa/variação só existem para os casos casados).
        const declaracaoByPriCod = new Map<string, DeclaracaoRow>();
        for (const d of declaracoes) {
            if (!declaracaoByPriCod.has(d.priCod)) declaracaoByPriCod.set(d.priCod, d);
        }
        const casamentoByAdtoDocCod = new Map<string, CasamentoRow>(
            casamentos.map((c) => [c.adiantamentoDocCod, c]),
        );

        // Invoices em aberto agrupadas por processo (priCod) — base das candidatas
        // do casamento manual N:M (o analista escolhe UMA do mesmo processo).
        const invoicesByPriCod = new Map<string, InvoiceRow[]>();
        for (const i of invoices) {
            const lista = invoicesByPriCod.get(i.priCod) ?? [];
            lista.push(i);
            invoicesByPriCod.set(i.priCod, lista);
        }

        // Nº de adiantamentos `casamento-manual` por processo — distingue `multiplas`
        // (1 adto → N invoices) de `cross-over` (N adtos ↔ M invoices) no `tipoPermuta`.
        const adtosCasamentoPorPriCod = new Map<string, number>();
        for (const a of adiantamentos) {
            if (a.estadoElegibilidade === 'casamento-manual') {
                adtosCasamentoPorPriCod.set(
                    a.priCod,
                    (adtosCasamentoPorPriCod.get(a.priCod) ?? 0) + 1,
                );
            }
        }

        // REGRA (2026-06-24): quando o conjunto de adtos de uma invoice ULTRAPASSA o em-aberto dela
        // (sobra adiantamento), a permuta sai de "simples/automática" e vira MANUAL (múltipla) — o
        // analista decide a alocação do excedente. Sinal já presente nos dados: a distribuição greedy
        // capa o total usado no em-aberto vivo da invoice, então Σ(saldoNeg) > Σ(valorASerUsado) ⇒
        // a invoice foi o limite ⇒ ultrapassou. Se Σ(saldoNeg) ≤ em-aberto (tudo consumido), segue
        // simples e a invoice pode ficar parcialmente em aberto.
        const adtosReclassificadosManual = this.adtosQueUltrapassamInvoice(
            casamentos,
            adiantamentos,
        );

        const pendentes = adiantamentos.map((a) =>
            this.toPendente(
                a,
                statusByDocCod,
                invoicesByPriCod,
                declaracaoByPriCod,
                casamentoByAdtoDocCod,
                alocacoesByAdto.get(a.docCod) ?? [],
                adtosCasamentoPorPriCod,
                adtosReclassificadosManual,
            ),
        );
        // Cliente (importador) por processo — o adto tem; a invoice não. Junta por priCod p/ que
        // a busca por cliente e o detalhe funcionem também do lado da invoice (mesmo processo).
        const importadorByPriCod = new Map<string, string>();
        for (const a of adiantamentos) {
            if (a.importador !== undefined && !importadorByPriCod.has(a.priCod)) {
                importadorByPriCod.set(a.priCod, a.importador);
            }
        }
        const invoicesEmAberto = invoices.map((i) =>
            // Prefere o importador da PRÓPRIA invoice (ingestão via imp021, universo completo);
            // cai no join por processo (adto) só se a invoice não tiver.
            this.toInvoiceEmAberto(i, i.importador ?? importadorByPriCod.get(i.priCod)),
        );

        // Múltiplas AUTOMÁTICAS (adto cobre todas as invoices) viram CASAMENTOS SINTÉTICOS: já
        // pré-distribuídos (adto → cada invoice do processo, valor cheio) e exibidos na aba
        // Automáticas como um caso simples (com "Processar"), em vez do fluxo manual Alocar/Baixar.
        const adtoByDocCod = new Map<string, AdiantamentoAtivo>(
            adiantamentos.map((a) => [a.docCod, a]),
        );
        const autoCasamentos: CasamentoRow[] = [];
        for (const p of pendentes) {
            if (p.autoElegivel !== true) continue;
            const a = adtoByDocCod.get(p.docCod);
            if (!a) continue;
            for (const inv of invoicesByPriCod.get(a.priCod) ?? []) {
                autoCasamentos.push({
                    invoiceDocCod: inv.docCod,
                    adiantamentoDocCod: a.docCod,
                    priCod: a.priCod,
                    valorASerUsado: inv.valorMoedaNegociada ?? 0,
                    ...(a.moedaNegociada !== undefined ? { moeda: a.moedaNegociada } : {}),
                });
            }
        }

        // Os casamentos que ultrapassam a invoice saem da lista de auto-sugeridos (viram manual).
        const casamentosSugeridos = this.toCasamentos(
            [...casamentos, ...autoCasamentos],
            invoiceByDocCod,
            adiantamentos,
            statusByDocCod,
            importadorByPriCod,
        ).filter((g) => !g.adiantamentos.some((a) => adtosReclassificadosManual.has(a.docCod)));

        const { elegiveis, bloqueadas, casamentoManual, permutaManual, jaPermutado } =
            this.contarPorStatus(pendentes);

        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'permuta gestao served',
            data: {
                requestId,
                pendentes: pendentes.length,
                invoicesEmAberto: invoicesEmAberto.length,
                casamentos: casamentosSugeridos.length,
            },
        });

        return {
            // Carimbo da ÚLTIMA INGESTÃO (finished_at do último run bem-sucedido),
            // não a hora desta requisição — é o que o painel exibe ao analista.
            ...(ultimaIngestao !== null ? { geradoEm: ultimaIngestao.toISOString() } : {}),
            fonte: 'banco',
            pendentes,
            invoicesEmAberto,
            casamentos: casamentosSugeridos,
            totais: {
                pendentes: pendentes.length,
                invoicesEmAberto: invoicesEmAberto.length,
                elegiveis,
                bloqueadas,
                casamentoManual,
                permutaManual,
                jaPermutado,
            },
        };
    };

    /**
     * Mapa de adto docCod → tipo MANUAL, para os casamentos que ULTRAPASSAM o em-aberto da invoice
     * (Σ saldoNeg dos adtos do grupo > Σ valorASerUsado, que o greedy já capou no em-aberto vivo).
     * Esses saem de "simples" e viram revisão manual. O tipo distingue:
     *   - **cross-over** quando o grupo tem >1 adto p/ a MESMA invoice (N adtos ↔ 1 invoice);
     *   - **multiplas** quando é 1 adto que sozinho ultrapassa a invoice (1 adto → N invoices).
     */
    private adtosQueUltrapassamInvoice = (
        casamentos: CasamentoRow[],
        adiantamentos: AdiantamentoAtivo[],
    ): Map<string, 'cross-over' | 'multiplas'> => {
        const adtoByDoc = new Map<string, AdiantamentoAtivo>(
            adiantamentos.map((a) => [a.docCod, a]),
        );
        const porInvoice = new Map<string, { usado: number; saldo: number; adtos: string[] }>();
        for (const c of casamentos) {
            const adto = adtoByDoc.get(c.adiantamentoDocCod);
            const usado = c.valorASerUsado ?? adto?.valorMoedaNegociada ?? 0;
            const saldoNeg =
                adto?.valorPermutar !== undefined && adto?.taxa !== undefined && adto.taxa > 0
                    ? adto.valorPermutar / adto.taxa
                    : usado;
            const g = porInvoice.get(c.invoiceDocCod) ?? { usado: 0, saldo: 0, adtos: [] };
            g.usado += usado;
            g.saldo += saldoNeg;
            g.adtos.push(c.adiantamentoDocCod);
            porInvoice.set(c.invoiceDocCod, g);
        }
        const reclass = new Map<string, 'cross-over' | 'multiplas'>();
        for (const g of porInvoice.values()) {
            // tolerância de 1 (moeda negociada) p/ ruído de ponto flutuante.
            if (g.saldo - g.usado <= 1) continue;
            const tipo = g.adtos.length > 1 ? 'cross-over' : 'multiplas';
            for (const d of g.adtos) {
                // cross-over vence (se o adto cai em mais de um grupo, prioriza N:M).
                if (reclass.get(d) !== 'cross-over') reclass.set(d, tipo);
            }
        }
        return reclass;
    };

    /**
     * Status de tela a partir do estado gravado — LEITURA, não reconstrução.
     *
     * Até ADR-0043 `ja-permutado` não existia no banco e esta derivação o
     * reconstruía a partir de `motivoBloqueio`, o que significava que um adto no
     * estado certo mas sem o motivo aparecia como `bloqueada`. Com a migration
     * 0054 o estado vem íntegro do relacional e a apresentação só o repassa.
     *
     * `descoberta` não é produzido pela eleição (toda candidata passa por
     * `avaliarElegibilidade`); se aparecer — ingestão interrompida no meio —
     * cai em `bloqueada`, como já caía, para a linha nunca sumir da tela.
     */
    /**
     * Contagem por status do painel ao vivo, exaustiva por construção.
     *
     * Regis-Review 2026-09-08, card `assertNever-propagacao`. Antes eram cinco
     * `filter` nominais em sequência: um status novo simplesmente não seria
     * contado, e a soma dos baldes deixaria de fechar com `pendentes.length` sem
     * que nada reclamasse. `BALDE_DO_STATUS` é um `Record<StatusElegibilidade, …>`,
     * então acrescentar um status quebra o build lá, e não aqui — que é o lugar
     * certo, porque lá é onde se decide em qual balde ele entra.
     */
    private contarPorStatus = (pendentes: PermutaPendente[]): GestaoTotaisPorStatus => {
        const totais: GestaoTotaisPorStatus = {
            elegiveis: 0,
            bloqueadas: 0,
            casamentoManual: 0,
            permutaManual: 0,
            jaPermutado: 0,
        };
        for (const pendente of pendentes) {
            totais[BALDE_DO_STATUS[pendente.status]] += 1;
        }
        return totais;
    };

    private statusDoEstado = (estado: EstadoElegibilidadeRow): StatusElegibilidade =>
        estado === 'descoberta' ? 'bloqueada' : estado;

    private toPendente = (
        a: AdiantamentoAtivo,
        statusByDocCod: Map<string, ProcessamentoStatus>,
        invoicesByPriCod: Map<string, InvoiceRow[]>,
        declaracaoByPriCod: Map<string, DeclaracaoRow>,
        casamentoByAdtoDocCod: Map<string, CasamentoRow>,
        alocacoesDoAdto: AlocacaoRow[],
        adtosCasamentoPorPriCod: Map<string, number>,
        adtosReclassificadosManual: Map<string, 'cross-over' | 'multiplas'>,
    ): PermutaPendente => {
        // Reclassificação (regra 2026-06-24, ADR-0014): adto elegível cujo casamento
        // ULTRAPASSA a invoice vira casamento-manual (múltipla) — execução manual
        // pelo analista. Ortogonal a este ciclo, e mantém a precedência que tinha
        // sobre o estado lido do banco.
        const ultrapassaInvoice =
            a.estadoElegibilidade === 'elegivel' && adtosReclassificadosManual.has(a.docCod);
        const status: StatusElegibilidade = ultrapassaInvoice
            ? 'casamento-manual'
            : this.statusDoEstado(a.estadoElegibilidade);
        const processamentoStatus = statusByDocCod.get(a.docCod);
        // Casamento manual (N:M): candidatas = invoices em aberto do MESMO processo.
        const candidatas =
            status === 'casamento-manual'
                ? (invoicesByPriCod.get(a.priCod) ?? []).map((i) => this.toInvoiceEmAberto(i))
                : undefined;
        const detalhe = this.toDetalhe(a, declaracaoByPriCod, casamentoByAdtoDocCod);
        // Alocações manuais (Fase 2) + saldo restante (moeda negociada): para os
        // casos que usam a alocação N:M — permuta-manual (cross-process) E
        // casamento-manual (múltiplas/cross-over, distribuir 1 adto em N invoices).
        // saldoNeg = saldoPermutar(BRL)/taxa; restante = saldoNeg − Σ alocado.
        const podeAlocar = status === 'permuta-manual' || status === 'casamento-manual';
        const alocacoes =
            podeAlocar && alocacoesDoAdto.length > 0
                ? alocacoesDoAdto.map((al) => this.toAlocacaoDetalhe(al))
                : undefined;
        const saldoNeg =
            a.valorPermutar !== undefined && a.taxa !== undefined && a.taxa > 0
                ? a.valorPermutar / a.taxa
                : undefined;
        const saldoRestante =
            podeAlocar && saldoNeg !== undefined
                ? saldoNeg - alocacoesDoAdto.reduce((s, al) => s + al.valorAlocado, 0)
                : undefined;
        // Tipo de permuta (derivado, p/ as abas). cross-process = cliente-filtro;
        // casamento-manual divide-se por nº de adtos do processo: 1 → multiplas
        // (1 adto → N invoices), >1 → cross-over (N:M); elegível auto-casável → simples.
        const tipoPermuta = ultrapassaInvoice
            ? // reclassificado: cross-over (N adtos ↔ 1 invoice) ou multiplas (1 adto → N invoices)
              (adtosReclassificadosManual.get(a.docCod) ?? 'multiplas')
            : status === 'permuta-manual'
              ? ('cross-process' as const)
              : status === 'casamento-manual'
                ? (adtosCasamentoPorPriCod.get(a.priCod) ?? 1) > 1
                    ? ('cross-over' as const)
                    : ('multiplas' as const)
                : status === 'elegivel'
                  ? ('simples' as const)
                  : undefined;

        // AUTO-ELEGÍVEL (regra 2026-06-24): múltipla (1 adto → N invoices, casamento-manual ORIGINAL,
        // tipoPermuta 'multiplas') cujo saldo do adto COBRE todas as invoices do processo
        // (adto saldoNeg ≥ Σ invoices, USD negociado). Vira AUTOMÁTICA (baixa auto-aloca num clique).
        // Σ invoices > adto → segue manual. NÃO se aplica a cross-over nem aos reclassificados (rule 1).
        const somaInvoicesProcesso = (invoicesByPriCod.get(a.priCod) ?? []).reduce(
            (s, i) => s + (i.valorMoedaNegociada ?? 0),
            0,
        );
        const autoElegivel =
            a.estadoElegibilidade === 'casamento-manual' &&
            tipoPermuta === 'multiplas' &&
            saldoNeg !== undefined &&
            somaInvoicesProcesso > 0 &&
            saldoNeg + 1 >= somaInvoicesProcesso; // tolerância de 1 (USD) p/ centavos

        return {
            docCod: a.docCod,
            filCod: a.filCod ?? 0,
            referencia: a.referencia ?? a.docCod,
            ...(a.referenciaExterna != null ? { referenciaExterna: a.referenciaExterna } : {}),
            exportador: a.exportador ?? '',
            // Cliente (importador do processo) — analistas buscam por ele. Vem do adto (imp021).
            ...(a.importador !== undefined ? { importador: a.importador } : {}),
            // `null` quando não buscado (não-pago) → a tela mostra "-".
            valorMoedaNegociada: a.valorMoedaNegociada ?? null,
            // Valor de face em BRL (vem do list — presente até em não-pagos).
            valorBrl: a.valor ?? null,
            // A coluna exibe `valorMoedaNegociada` (moeda ESTRANGEIRA do título):
            // o rótulo deve ser a moeda NEGOCIADA (USD), não a do documento (BRL).
            moeda: a.moedaNegociada ?? a.moeda ?? 'USD',
            diasEmAberto: a.agingDays ?? null,
            status,
            ...(a.motivoBloqueio !== undefined ? { motivoBloqueio: a.motivoBloqueio } : {}),
            ...(processamentoStatus !== undefined ? { processamentoStatus } : {}),
            ...(tipoPermuta !== undefined ? { tipoPermuta } : {}),
            ...(candidatas !== undefined ? { candidatas } : {}),
            ...(alocacoes !== undefined ? { alocacoes } : {}),
            ...(saldoRestante !== undefined ? { saldoRestante } : {}),
            ...(autoElegivel ? { autoElegivel: true } : {}),
            detalhe,
        };
    };

    /** Mapeia uma AlocacaoRow para o shape exibido na tela (AlocacaoDetalhe). */
    private toAlocacaoDetalhe = (
        al: AlocacaoRow,
    ): import('../../interface/permutas/Gestao.js').AlocacaoDetalhe => ({
        invoiceDocCod: al.invoiceDocCod,
        ...(al.invoicePriCod !== undefined ? { invoicePriCod: al.invoicePriCod } : {}),
        valorAlocado: al.valorAlocado,
        ...(al.moeda !== undefined ? { moeda: al.moeda } : {}),
        ...(al.variacaoClassificacao !== undefined
            ? { variacaoClassificacao: al.variacaoClassificacao }
            : {}),
        ...(al.variacaoResultado !== undefined ? { variacaoResultado: al.variacaoResultado } : {}),
        ...(al.taxaAdiantamento !== undefined ? { taxaAdiantamento: al.taxaAdiantamento } : {}),
        ...(al.taxaInvoice !== undefined ? { taxaInvoice: al.taxaInvoice } : {}),
        ...(al.criadoPor !== undefined ? { criadoPor: al.criadoPor } : {}),
        criadoEm: al.criadoEm.toISOString(),
    });

    /**
     * Monta as micro-informações do adiantamento (exibidas ao expandir a linha).
     * `declaracao` vem do processo (priCod); taxa/variação só existem quando há
     * casamento (elegíveis/casamento) — bloqueados/já-permutados não têm.
     */
    private toDetalhe = (
        a: AdiantamentoAtivo,
        declaracaoByPriCod: Map<string, DeclaracaoRow>,
        casamentoByAdtoDocCod: Map<string, CasamentoRow>,
    ): PermutaDetalhe => {
        const variacao = this.variacaoDetalhe(casamentoByAdtoDocCod.get(a.docCod));
        return {
            priCod: a.priCod,
            pago: a.pago,
            ...(a.dataEmissao !== undefined ? { dataEmissao: a.dataEmissao.toISOString() } : {}),
            ...(a.valorPermutar !== undefined ? { valorPermutar: a.valorPermutar } : {}),
            // Progresso de pagamento (face + saldo em aberto) — a UI deriva % pago e
            // quanto falta nos bloqueados por `nao-pago`.
            ...(a.valorTotal !== undefined ? { valorTotal: a.valorTotal } : {}),
            ...(a.valorAberto !== undefined ? { valorAberto: a.valorAberto } : {}),
            ...this.declaracaoDetalhe(declaracaoByPriCod.get(a.priCod)),
            ...variacao,
            // Não-casados não têm `permuta_casamento`, mas a taxa do PRÓPRIO título
            // existe (com308 → coluna `taxa`): usa como fallback p/ "Taxa adiantamento".
            ...(variacao.taxaAdiantamento === undefined && a.taxa !== undefined
                ? { taxaAdiantamento: a.taxa }
                : {}),
        };
    };

    /** Parte do detalhe vinda da declaração do processo (D.I/DUIMP). */
    private declaracaoDetalhe = (decl?: DeclaracaoRow): Pick<PermutaDetalhe, 'declaracao'> => {
        if (decl === undefined) return {};
        return {
            declaracao: {
                variante: decl.variante,
                ...(decl.dataBase !== undefined ? { dataBase: decl.dataBase.toISOString() } : {}),
            },
        };
    };

    /** Parte do detalhe vinda do casamento (taxa/variação) — só p/ casados. */
    private variacaoDetalhe = (
        cas?: CasamentoRow,
    ): Pick<
        PermutaDetalhe,
        | 'taxaAdiantamento'
        | 'taxaInvoice'
        | 'variacaoClassificacao'
        | 'variacaoResultado'
        | 'variacaoDelta'
    > => {
        if (cas === undefined) return {};
        return {
            ...(cas.taxaAdiantamento !== undefined
                ? { taxaAdiantamento: cas.taxaAdiantamento }
                : {}),
            ...(cas.taxaInvoice !== undefined ? { taxaInvoice: cas.taxaInvoice } : {}),
            ...(cas.variacaoClassificacao !== undefined
                ? { variacaoClassificacao: cas.variacaoClassificacao }
                : {}),
            ...(cas.variacaoResultado !== undefined
                ? { variacaoResultado: cas.variacaoResultado }
                : {}),
            ...(cas.variacaoDelta !== undefined ? { variacaoDelta: cas.variacaoDelta } : {}),
        };
    };

    private toInvoiceEmAberto = (i: InvoiceRow, importador?: string): InvoiceEmAberto => ({
        docCod: i.docCod,
        filCod: i.filCod ?? 0,
        priCod: i.priCod,
        ...(i.dataEmissao !== undefined ? { dataEmissao: i.dataEmissao.toISOString() } : {}),
        referencia: i.referencia ?? i.docCod,
        ...(i.referenciaExterna != null ? { referenciaExterna: i.referenciaExterna } : {}),
        exportador: i.exportador ?? '',
        ...(importador !== undefined ? { importador } : {}),
        valorMoedaNegociada: i.valorMoedaNegociada ?? null,
        // Valor de face em BRL — base da consolidação em reais.
        valorBrl: i.valor ?? null,
        // Rótulo da moeda NEGOCIADA (USD), não a do documento (BRL).
        moeda: i.moedaNegociada ?? i.moeda ?? 'USD',
        ...(i.taxa !== undefined ? { taxa: i.taxa } : {}),
    });

    /**
     * Agrupa os casamentos automáticos por invoice. Cada invoice vira um
     * `CasamentoSugerido` com seus adiantamentos. Resolve o shape da invoice via
     * o map (ou um stub mínimo se a invoice não estiver entre as "em aberto",
     * ex.: já paga mas com casamento histórico). O `valorASerUsado` cai no
     * `valorMoedaNegociada` do adiantamento quando o casamento não o trouxe.
     */
    private toCasamentos = (
        casamentos: CasamentoRow[],
        invoiceByDocCod: Map<string, InvoiceRow>,
        adiantamentos: AdiantamentoAtivo[],
        statusByDocCod: Map<string, ProcessamentoStatus>,
        importadorByPriCod: Map<string, string>,
    ): CasamentoSugerido[] => {
        const adiantamentoByDocCod = new Map<string, AdiantamentoAtivo>(
            adiantamentos.map((a) => [a.docCod, a]),
        );
        const grupos = new Map<string, CasamentoSugerido>();
        for (const c of casamentos) {
            let grupo = grupos.get(c.invoiceDocCod);
            if (!grupo) {
                const inv = invoiceByDocCod.get(c.invoiceDocCod);
                grupo = {
                    // Processo (priCod) — número em comum invoice×adiantamento,
                    // chave de reconciliação manual no Conexos.
                    priCod: c.priCod,
                    invoice: inv
                        ? this.toInvoiceEmAberto(inv, importadorByPriCod.get(c.priCod))
                        : {
                              docCod: c.invoiceDocCod,
                              filCod: 0,
                              referencia: c.invoiceDocCod,
                              exportador: '',
                              ...(importadorByPriCod.get(c.priCod) !== undefined
                                  ? { importador: importadorByPriCod.get(c.priCod) }
                                  : {}),
                              valorMoedaNegociada: 0,
                              valorBrl: null,
                              moeda: c.moeda ?? 'USD',
                          },
                    adiantamentos: [],
                };
                grupos.set(c.invoiceDocCod, grupo);
            }
            const adto = adiantamentoByDocCod.get(c.adiantamentoDocCod);
            const processamentoStatus = statusByDocCod.get(c.adiantamentoDocCod);
            const valorASerUsado = c.valorASerUsado ?? adto?.valorMoedaNegociada ?? 0;
            // Saldo restante do adiantamento na permuta Simples (distribuição greedy
            // pode consumir só parte do saldo): saldoNeg(valorPermutar/taxa) − usado.
            // Mesmo cálculo do saldoNeg usado em permuta-manual/casamento-manual.
            const saldoNeg =
                adto?.valorPermutar !== undefined && adto?.taxa !== undefined && adto.taxa > 0
                    ? adto.valorPermutar / adto.taxa
                    : undefined;
            const saldoRestante =
                saldoNeg !== undefined ? Math.max(0, saldoNeg - valorASerUsado) : undefined;
            grupo.adiantamentos.push({
                docCod: c.adiantamentoDocCod,
                referencia: adto?.referencia ?? c.adiantamentoDocCod,
                valorASerUsado,
                // Moeda NEGOCIADA do adiantamento (USD). `c.moeda` já é a sigla
                // negociada (ingestão), mas o `adto` lido é a fonte mais fresca.
                moeda: adto?.moedaNegociada ?? c.moeda ?? adto?.moeda ?? 'USD',
                ...(saldoRestante !== undefined ? { saldoRestante } : {}),
                ...(processamentoStatus !== undefined ? { processamentoStatus } : {}),
            });
        }
        return [...grupos.values()];
    };
}
