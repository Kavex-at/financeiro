import type Adiantamento from './Adiantamento.js';
import type DeclaracaoImportacao from './DeclaracaoImportacao.js';
import type { EstadoElegibilidade, MotivoBloqueio } from './EstadoElegibilidade.js';
import type Invoice from './Invoice.js';
import type VariacaoCambial from './VariacaoCambial.js';

/**
 * Nome canônico de cada um dos 4 gates de elegibilidade (auditoria I5).
 * Ontology: `ontology/business-rules/elegibilidade-permuta.md`.
 */
export const GATE = {
    /** Gate 1 — tipo = PROFORMA (`tpdCod=99` + `adiantamento=SIM`). */
    PROFORMA: 'gate1-proforma',
    /** Gate 2 — `valorPermutar > R$1,00` (`getDetalheTitulos`; resíduo ≤ R$1,00 = zero, ADR-0046). */
    VALOR_PERMUTAR: 'gate2-valor-permutar',
    /** Gate 3 — TOTALMENTE PAGO (`mnyTitAberto ≤ R$1,00`, via `getDetalheTitulos`, ADR-0046). */
    TOTALMENTE_PAGO: 'gate3-totalmente-pago',
    /** Gate 4 — D.I XOR DUIMP atrelada. */
    DI_XOR_DUIMP: 'gate4-di-xor-duimp',
} as const;

export type GateName = (typeof GATE)[keyof typeof GATE];

/** Resultado de um gate avaliado (registro de auditoria por gate, I5). */
export interface GateResult {
    gate: GateName;
    passed: boolean;
    detail?: string;
}

/**
 * PermutaCandidata — a pendência elegível em si (shape 1:1, P0-5/P0-6).
 *
 * Ontology: `ontology/entities/permuta-candidata.md`. Composição derivada
 * (Adiantamento + Invoice casada + DeclaracaoImportacao + VariacaoCambial +
 * aging + estado de elegibilidade). É uma CANDIDATA, não uma permuta consumada
 * (Fatia 2). Mantém shape 1:1 — N:M vai para backlog (`composto-nm`).
 *
 * ⏸ GATED-P0-4: `aging` (`number`) só popula quando a `dataBase` da declaração
 * for lida; enquanto o probe P0-4 estiver aberto, `aging` fica `undefined`
 * ("pendente") e a candidata NÃO falha por isso.
 */
export default interface PermutaCandidata {
    priCod: string;
    adiantamento: Adiantamento;
    /** Lado-crédito — exatamente 1 invoice FINALIZADA (1:1). */
    invoiceCasada?: Invoice;
    /**
     * Invoices candidatas do casamento manual N:M (>1 INVOICE FINALIZADA no
     * processo) — preenchido só quando `estadoElegibilidade === CASAMENTO_MANUAL`.
     * Persistidas em `permuta_invoice` para o analista escolher uma na tela (ADR-0005).
     */
    invoicesCandidatas?: Invoice[];
    declaracaoImportacao?: DeclaracaoImportacao;
    variacaoCambial?: VariacaoCambial;
    /** ⏸ GATED-P0-4 — `hoje − dataBase` (dias); `undefined` enquanto pendente. */
    aging?: number;
    estadoElegibilidade: EstadoElegibilidade;
    motivoBloqueio?: MotivoBloqueio;
    gatesAvaliados: GateResult[];
}
