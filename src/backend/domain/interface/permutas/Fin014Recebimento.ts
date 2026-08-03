/**
 * Tipos do contrato de ESCRITA `fin014` (RECEBIMENTO DO CRÉDITO — Tela 2 do guia "telas Conexos").
 * fin014 é uma família borderô+baixa que ESPELHA fin010 (a-pagar), mas para a-receber (docTip=1).
 * Derivados do bundle `fin014.pretty.js` + probes read-only (borderô list/detalhe confirmados, 2026-07-31).
 * A baixa vincula o documento da SN (Tela 1) como título recebido, na conta financeira do FIN_134.
 */

/** Resposta da criação do borderô de recebimento (`POST /api/fin014`). */
export interface Fin014BorderoCriado {
    borCod: number;
    filCod: number;
    borDtaMvto: number;
    /** Descrição da conta financeira (`gerDes`) que o ERP ecoa na criação — reusada no payload da baixa. */
    gerDes?: string;
}

/** Uma linha do LOV `TituloBorderoReceber` — o título a-receber REAL (docCod/titCod/número) a baixar. */
export interface Fin014TituloReceber {
    docCod: number;
    titCod: number;
    titEspNumero: string;
    titMnyAberto?: number;
}

/** `responseData` da validação do título a receber (em-aberto vivo do ERP). */
export interface Fin014TituloBaixaValidacao {
    bxaMnyValor: number;
    bxaMnyLiquido?: number;
    /** Flag conta-corrente que a validação devolve (HAR 15-55: 1) — vai no payload da baixa. */
    bxaVldCcorrente?: number;
}

/** Resposta da baixa gravada (`POST /api/fin014/baixas`) — confirmação persistida. */
export interface Fin014BaixaGravada {
    bxaCodSeq: number;
    borCod?: number;
    docCod?: number;
    bxaMnyValor?: number;
    bxaMnyLiquido?: number;
}

/** Entrada de alto nível para registrar UM recebimento de crédito vinculado à SN. */
export interface Fin014RecebimentoInput {
    filCod: number;
    /** docCod da SN (Tela 1) a ser recebida. */
    docCod: number;
    /** Valor do recebimento (= valor da SN), moeda negociada. */
    valor: number;
    /** Data do recebimento do crédito em epoch-ms (default: hoje). */
    dataRecebimento: number;
    /** Conta financeira de baixa (`gerNum`) — a MESMA identificada na FIN_134 (config FIN014_CONTA_FINANCEIRA). */
    contaFinanceira: number;
    /** Título do documento (parcela) — default 1. */
    titCod?: number;
}

/** Resultado consolidado do recebimento fin014 (borderô + baixa + finalização). */
export interface Fin014RecebimentoResult {
    borCod: number;
    bxaCodSeq: number;
}
