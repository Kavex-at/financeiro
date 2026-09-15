import type { ProcessamentoStatus } from './Processamento.js';
import type { ESTADO_ELEGIBILIDADE, EstadoElegibilidade } from './EstadoElegibilidade.js';

/**
 * Shapes da resposta `GET /permutas/gestao` — espelham EXATAMENTE
 * `src/frontend/lib/types.ts` (a tela consome este JSON diretamente).
 */

/**
 * Status exibido no painel — **derivado** do estado de domínio, não redigitado
 * (Regis-Review 2026-09-08, card `assertNever-propagacao`).
 *
 * É exatamente `EstadoElegibilidade` menos `descoberta`: uma candidata só chega à
 * tela depois de avaliada, e `statusDoEstado` colapsa `descoberta` em `bloqueada`
 * para a linha nunca sumir do painel. Derivar em vez de repetir é o que faz um
 * estado novo no enum quebrar o build aqui — e, por consequência, na contagem do
 * painel, que é onde ele precisaria ganhar um balde.
 */
export type StatusElegibilidade = Exclude<
    EstadoElegibilidade,
    typeof ESTADO_ELEGIBILIDADE.DESCOBERTA
>;

/**
 * Tipo de permuta — classificação DERIVADA (apresentação), não é estado no banco.
 * Organiza a área de trabalho em abas por cardinalidade + escopo:
 *  - `simples`       — 1:1 ou 1 invoice → N adiantamentos (auto-casável).
 *  - `multiplas`     — 1 adiantamento → N invoices (mesmo processo).
 *  - `cross-over`    — N adiantamentos ↔ M invoices (mesmo processo).
 *  - `cross-process` — cliente-filtro: a invoice está em OUTRO processo.
 */
export type TipoPermuta = 'simples' | 'multiplas' | 'cross-over' | 'cross-process';

/**
 * Micro-informações de um adiantamento, exibidas ao expandir a linha na tela
 * (qualquer status). Campos opcionais dependem do que o modelo relacional tem:
 * `declaracao` existe se o processo tem D.I/DUIMP; `taxa*`/`variacao*` só para
 * casos COM casamento (permuta_casamento) — bloqueados/já-permutados não têm.
 */
export interface PermutaDetalhe {
    /** Processo (Conexos `priCod`) — chave de reconciliação manual no Conexos. */
    priCod: string;
    /** Totalmente pago? (Gate 3). */
    pago: boolean;
    /** Data de emissão do adiantamento (ISO). */
    dataEmissao?: string;
    /** Saldo a permutar (`mnyTitPermutar`). */
    valorPermutar?: number;
    /** Valor de FACE do título em BRL (`mnyTitValor`) — progresso de pagamento. */
    valorTotal?: number;
    /** Saldo em aberto do título em BRL (`mnyTitAberto`) — quanto falta pagar (Gate 3). */
    valorAberto?: number;
    /** D.I/DUIMP do processo (Gate 4) + data-base da variação. */
    declaracao?: { variante: 'DI' | 'DUIMP'; dataBase?: string };
    /** Taxa de fechamento do adiantamento (só p/ casados). */
    taxaAdiantamento?: number;
    /** Taxa de fechamento da invoice casada (só p/ casados). */
    taxaInvoice?: number;
    /** Classificação da variação cambial (JUROS/DESCONTO/NEUTRO) — só p/ casados. */
    variacaoClassificacao?: string;
    /** Resultado monetário da variação cambial (só p/ casados). */
    variacaoResultado?: number;
    /** Delta de taxa (adto − invoice) — só p/ casados. */
    variacaoDelta?: number;
}

/** Uma alocação manual adto↔invoice (Fase 2), exibida na linha do permuta-manual. */
export interface AlocacaoDetalhe {
    invoiceDocCod: string;
    invoicePriCod?: string;
    valorAlocado: number;
    moeda?: string;
    variacaoClassificacao?: string;
    variacaoResultado?: number;
    /** Taxa do adiantamento e da invoice — exibem a CONTA do juros/desconto na
     * tela: `valorAlocado × (taxaAdiantamento − taxaInvoice) = resultado`. */
    taxaAdiantamento?: number;
    taxaInvoice?: number;
    criadoPor?: string;
    criadoEm: string;
}

/**
 * Exceção manual "permutado fora do painel" de um adto (ADR-0047), exibida na linha e no
 * detalhe. Só existe quando há exceção ATIVA (não removida) para o adto.
 */
export interface ExcecaoManualDetalhe {
    justificativa: string;
    /** Identidade do JWT de quem marcou (ADR-0006). */
    criadoPor: string;
    /** ISO 8601. */
    criadoEm: string;
    /**
     * `true` quando a exceção está APLICADA: o adto aparece como `ja-permutado` com o motivo
     * `permutado-fora-do-painel`. `false` quando o cálculo do ERP venceu (I-Exc-2) — a exceção
     * segue registrada e a tela a sinaliza como inativa até alguém desfazê-la.
     */
    ativa: boolean;
}

export interface PermutaPendente {
    docCod: string;
    filCod: number;
    referencia: string;
    exportador: string;
    /** Cliente = importador do processo (`imp021`). Analistas buscam por ele. Opcional. */
    importador?: string;
    /** Valor em moeda negociada (com308). `null` quando não buscado (não-pago) → tela mostra "-". */
    valorMoedaNegociada: number | null;
    /** Valor de FACE do documento em BRL (`docMnyValor`) — base da consolidação em reais. */
    valorBrl: number | null;
    moeda: string;
    diasEmAberto: number | null;
    status: StatusElegibilidade;
    motivoBloqueio?: string;
    /** Status do analista (botão "Processar"), quando registrado. */
    processamentoStatus?: ProcessamentoStatus;
    /** Tipo de permuta (classificação derivada p/ as abas) — ver `TipoPermuta`. */
    tipoPermuta?: TipoPermuta;
    /**
     * Alocações manuais N:M (Fase 2) — `permuta-manual`, `casamento-manual` e `ja-permutado` (este
     * só p/ exibição no Histórico, ADR-0046 D4).
     */
    alocacoes?: AlocacaoDetalhe[];
    /** Saldo a permutar AINDA não alocado (moeda negociada) — `permuta-manual`. */
    saldoRestante?: number;
    /**
     * Invoices candidatas do casamento manual (N:M) — invoices em aberto do mesmo
     * processo (`priCod`). Preenchido só quando `status === 'casamento-manual'`
     * (ADR-0005). O analista escolhe UMA e processa.
     */
    candidatas?: InvoiceEmAberto[];
    /**
     * Múltipla (1 adto → N invoices do mesmo processo) onde o saldo do adto COBRE todas as invoices
     * (adto ≥ Σ invoices, USD negociado) → é AUTOMÁTICA: aparece na aba "Automáticas" e a baixa
     * auto-aloca (adto → cada invoice) num clique. `Σ invoices > adto` segue manual. (Regra 2026-06-24)
     */
    autoElegivel?: boolean;
    /** Exceção manual ativa do adto (ADR-0047). Ausente quando não há exceção ativa. */
    excecaoManual?: ExcecaoManualDetalhe;
    /** Micro-informações exibidas ao expandir a linha (qualquer status). */
    detalhe?: PermutaDetalhe;
}

export interface InvoiceEmAberto {
    docCod: string;
    filCod: number;
    /** Processo (Conexos `priCod`) — código em comum com o adiantamento. */
    priCod?: string;
    /** Data de emissão da invoice (ISO). */
    dataEmissao?: string;
    referencia: string;
    exportador: string;
    /** Cliente = importador do processo (`imp021`), juntado por priCod. Opcional. */
    importador?: string;
    valorMoedaNegociada: number | null;
    /** Valor de FACE do documento em BRL (`docMnyValor`) — base da consolidação em reais. */
    valorBrl: number | null;
    moeda: string;
    /** Taxa de câmbio negociada da invoice (`com308` `titFltTaxaMneg`). */
    taxa?: number;
}

export interface CasamentoAdiantamento {
    docCod: string;
    referencia: string;
    valorASerUsado: number;
    moeda: string;
    /**
     * Saldo restante do adiantamento (em moeda negociada) após a distribuição
     * Simples: `valorPermutar/taxa − valorASerUsado`. Quando o greedy consome só
     * parte do saldo (ex.: o maior adto cobre a invoice sozinho), o restante fica
     * em aberto. Opcional — ausente sem valorPermutar/taxa legíveis.
     */
    saldoRestante?: number;
    /** Status do analista (botão "Processar"), quando registrado. */
    processamentoStatus?: ProcessamentoStatus;
}

export interface CasamentoSugerido {
    /**
     * Código do PROCESSO (Conexos `priCod`) — número em comum entre invoice e
     * adiantamento; chave de reconciliação manual no Conexos. Exibido no lugar do
     * código da invoice na tela.
     */
    priCod: string;
    invoice: InvoiceEmAberto;
    adiantamentos: CasamentoAdiantamento[];
}

export interface GestaoPermutasResponse {
    geradoEm?: string;
    fonte: 'banco';
    pendentes: PermutaPendente[];
    invoicesEmAberto: InvoiceEmAberto[];
    casamentos: CasamentoSugerido[];
    totais: {
        pendentes: number;
        invoicesEmAberto: number;
        elegiveis: number;
        bloqueadas: number;
        /** N:M que passaram os 4 gates, aguardando escolha de invoice (ADR-0005). */
        casamentoManual: number;
        /** Adtos de clientes-filtro (pago + saldo) p/ permuta manual cross-process. */
        permutaManual: number;
        /** Já permutados (pago + 100% consumido em permuta anterior) — estado CONCLUÍDO, fora de bloqueadas. */
        jaPermutado: number;
    };
}
