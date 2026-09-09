/**
 * Constantes tipadas de estado/motivo da elegibilidade de uma PermutaCandidata.
 *
 * Ontology: `ontology/state-machines/elegibilidade-permuta-candidata.md`.
 * Estados como CONSTANTES TIPADAS — nunca strings cruas (P3 / Domain State
 * Machines). `EXECUTADA` está FORA DE ESCOPO (Fatia 2).
 */
export const ESTADO_ELEGIBILIDADE = {
    DESCOBERTA: 'descoberta',
    ELEGIVEL: 'elegivel',
    BLOQUEADA: 'bloqueada',
    /**
     * Passou os 4 gates, mas o casamento de invoice é N:M (>1 INVOICE FINALIZADA
     * no processo) — falta SÓ o analista escolher a invoice. Não é uma reprovação
     * de mérito (≠ BLOQUEADA): a candidata está pronta para casamento manual.
     * Escopo: motivos `composto-nm` / `multiplas-invoices` (ADR-0005).
     */
    CASAMENTO_MANUAL: 'casamento-manual',
    /**
     * Adiantamento de um **cliente filtro** (importador cadastrado) que será
     * permutado MANUALMENTE e CROSS-PROCESS — a invoice vem de qualquer outro
     * processo, escolhida pelo analista (Fatia 2). Não é reprovação de mérito:
     * está pago e com saldo, só não há invoice no próprio processo. A D.I não é
     * exigida na manual (vem da invoice escolhida). Motivo: `cliente-filtro`.
     */
    PERMUTA_MANUAL: 'permuta-manual',
    /**
     * Adiantamento **pago** cujo saldo a permutar já foi 100% consumido numa
     * permuta anterior (`valorPermutar = 0` E `valorPermutado > 0`,
     * `mnyTitPermuta` do detalhe). Estado **CONCLUÍDO** — o trabalho foi feito —,
     * NÃO uma reprovação de mérito (≠ BLOQUEADA): mantê-lo dentro do balde de
     * bloqueadas inflava o passivo externo em 2,72× (ADR-0043).
     *
     * **Terminal dentro de uma run**: sem saldo, não origina alocação nem a
     * transição T5 (`→ EXECUTADA`) — uma aresta para lá contaria a mesma permuta
     * duas vezes. A máquina é recomputada do zero a cada run, então um estorno no
     * ERP devolve `valorPermutar > 0` e a próxima eleição reclassifica.
     *
     * Motivo informativo: `MOTIVO_BLOQUEIO.JA_PERMUTADO` (mesmo padrão de
     * `composto-nm`/`CASAMENTO_MANUAL` e `cliente-filtro`/`PERMUTA_MANUAL`).
     * ADR-0043 · state-machine `elegibilidade-permuta-candidata` (T6).
     */
    JA_PERMUTADO: 'ja-permutado',
} as const;

export type EstadoElegibilidade = (typeof ESTADO_ELEGIBILIDADE)[keyof typeof ESTADO_ELEGIBILIDADE];

/**
 * Taxonomia de motivos do estado BLOQUEADA (P0-5/P0-6/P0-8 RESOLVIDO).
 * Toda candidata `bloqueada` carrega um motivo.
 */
export const MOTIVO_BLOQUEIO = {
    /** Várias proformas/invoices no processo — N:M (backlog nesta fatia). */
    COMPOSTO_NM: 'composto-nm',
    /** 0 INVOICE FINALIZADA no processo (aguardando emissão). */
    SEM_INVOICE: 'sem-invoice',
    /** >1 INVOICE FINALIZADA — distinguível do composto N:M (mesma família). */
    MULTIPLAS_INVOICES: 'multiplas-invoices',
    /** Gate 3 reprovado — adiantamento NÃO está totalmente pago (mnyTitAberto > 0). */
    NAO_PAGO: 'nao-pago',
    /** Gate 2 reprovado — sem saldo a permutar (mnyTitPermutar = 0), embora pago. */
    SEM_SALDO_PERMUTAR: 'sem-saldo-permutar',
    /**
     * Gate 2 reprovado, mas o adiantamento está pago E seu saldo a permutar já
     * foi 100% consumido numa permuta anterior (`valorPermutado > 0`,
     * `mnyTitPermuta` do detalhe). Estado CONCLUÍDO, não um erro: distingue-se
     * de `SEM_SALDO_PERMUTAR` (nunca teve saldo) para não confundir o operador.
     */
    JA_PERMUTADO: 'ja-permutado',
    /** Gate 4 anomalia — D.I E DUIMP presentes no mesmo processo (XOR violado). */
    DI_DUIMP_AMBOS: 'di-duimp-ambos',
    /** Fallback — falhou um gate sem motivo específico mapeado (não esperado). */
    FALHA_GATE: 'falha-gate',
    /** Gate 4 sem D.I nem DUIMP — sem âncora de data-base. */
    DATA_BASE_INDISPONIVEL: 'data-base-indisponivel',
    /**
     * Importador cadastrado como "cliente filtro": o adiantamento (pago + com
     * saldo) é roteado para `PERMUTA_MANUAL` (permuta manual cross-process) em vez
     * de bloqueada. Motivo informativo do estado `permuta-manual`, não um bloqueio.
     */
    CLIENTE_FILTRO: 'cliente-filtro',
    /**
     * Leitura do DETALHE da PROFORMA (`getDetalheTitulos`) indisponível após
     * retries — blip transiente do Conexos, NÃO uma reprovação legítima de gate
     * (P0-3). Distingue "não consegui ler o valor a permutar" de `falha-gate`
     * ("li e o gate reprovou"), para não enterrar uma candidata possivelmente
     * elegível como bloqueada por mérito. Re-avaliável na próxima run.
     */
    DETAIL_INDISPONIVEL: 'detail-indisponivel',
} as const;

export type MotivoBloqueio = (typeof MOTIVO_BLOQUEIO)[keyof typeof MOTIVO_BLOQUEIO];
