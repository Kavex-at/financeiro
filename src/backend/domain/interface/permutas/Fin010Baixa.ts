/**
 * Tipos do contrato de ESCRITA `fin010` (baixa/permuta de adiantamento) — Fase 3.
 * Derivados do HAR real (ver `ontology/business-rules/fin010-write-contract.md`).
 * A baixa é um handshake de 5 chamadas; estes tipos modelam entrada/saída de cada uma.
 */

/** Resposta do passo 1 — criação do borderô. */
export interface BorderoCriado {
    borCod: number;
    filCod: number;
    borVldTipo: number;
    borDtaMvto: number;
}

/** Estado vivo de um borderô (GET /fin010/{filCod}/{borCod}). */
export interface BorderoDetalhe {
    borCod: number;
    filCod: number;
    borDtaMvto?: number;
    /** 0 = EM CADASTRO, 1 = FINALIZADO. */
    borVldFinalizado?: number;
    /** Se != null, o borderô foi ESTORNADO. */
    borCodEstornado?: number | null;
    borDtaFinalizado?: number | null;
    usnDesNomeCad?: string | null;
    usnDesNomeFin?: string | null;
    vldHasBaixa?: number;
    /**
     * 1 enquanto o borderô está importado num lote SISPAG; volta a 0 quando o item sai (HML
     * 2026-10-20). **Só informativo**: não diz se foi ao banco (ADR-0077, emenda 2026-10-21).
     */
    vldHasRemessaPgto?: number;
    vlrTotalLiquido?: number;
    /** Carimbo de criação gravado pelo ERP (epoch ms, ao segundo). Identidade com `borCod`. */
    borTimCad?: number;
    /** Usuário que criou o borderô (código do ERP). */
    usnCodCad?: number;
}

/** Item da listagem de borderôs do ERP (`POST /fin010/list`). */
export interface BorderoListaItem {
    borCod: number;
    filCod: number;
    borDtaMvto?: number;
    borVldFinalizado?: number;
    borCodEstornado?: number | null;
    vlrTotalLiquido?: number;
    usnDesNomeCad?: string | null;
    /** Ver `BorderoDetalhe.vldHasRemessaPgto` — só informativo. */
    vldHasRemessaPgto?: number;
    borTimCad?: number;
    usnCodCad?: number;
}

/**
 * Borderô reconhecido pela identidade `filCod + borCod + borTimCad` (ADR-0077, emenda
 * 2026-10-21): o ERP reusa `borCod` depois de excluir; o `borTimCad` distingue as encarnações.
 */
export interface BorderoIdentificado {
    filCod: number;
    borCod: number;
    /** Epoch ms gravado pelo ERP na criação. */
    borTimCad: number;
    usnCodCad?: number;
    gerNum?: number;
    borDtaMvto?: number;
    borVldFinalizado?: number;
    /** Borderô que ESTE substituiu num estorno (este nasceu do estorno daquele). */
    borCodEstornado?: number;
    /** Borderô que substituiu ESTE num estorno (`borVldFinalizado = 3`). */
    borCodNovo?: number;
    vlrTotalLiquido?: number;
    /** Só informativo (não é guarda de limpeza). */
    vldHasRemessaPgto?: number;
    /**
     * Situação derivada do cabeçalho lido no `fin010/list` (`SituacaoBorderoFin010`). Ausente na
     * resposta do `POST fin010`; quem decide trata ausência como `indeterminado` (fail-closed).
     */
    situacao?: SituacaoBordero;
}

/**
 * Situação de um borderô no `fin010`, medida no HML em 2026-10-21 (achados T9: 269 borderôs das
 * filiais 1 e 2). `borVldFinalizado`: 0 em cadastro, 1 finalizado, 2 cancelado, 3 estornado
 * (sempre com `borCodNovo`, o borderô que nasceu do estorno e herdou as baixas). Qualquer outra
 * combinação é `INDETERMINADO`.
 */
export const SITUACAO_BORDERO = {
    EM_CADASTRO: 'em_cadastro',
    FINALIZADO: 'finalizado',
    CANCELADO: 'cancelado',
    ESTORNADO: 'estornado',
    INDETERMINADO: 'indeterminado',
} as const;
export type SituacaoBordero = (typeof SITUACAO_BORDERO)[keyof typeof SITUACAO_BORDERO];

/** Janela de busca da resposta perdida do `POST fin010` (I21s). Tudo em epoch ms. */
export interface JanelaBorderoParams {
    filCod: number;
    /** Usuário do robô (da sessão/login ou da releitura de um borderô nosso). */
    usnCodCad: number;
    gerNum: number;
    /** Data de movimento (meia-noite UTC) = data de débito do lote. */
    borDtaMvto: number;
    /** Gravado ANTES do `POST`. */
    t0: number;
    /** Gravado depois do `POST`; ausente quando o processo morreu antes de persisti-lo. */
    t1?: number;
    /** Momento da retomada: limite superior quando não há `t1`. */
    agora: number;
    /** Desvio de relógio servidor × ERP (constante de código). */
    margemMs: number;
}

/** Resultado da busca pela identidade (`fin010/list borCod#EQ`). */
export interface BuscaIdentidadeBordero {
    /** `PRESENTE` = o nosso; `AUSENTE` = sem linha; `ALHEIO` = `borCod` reusado (outro `borTimCad`). */
    situacao: 'PRESENTE' | 'AUSENTE' | 'ALHEIO';
    bordero?: BorderoIdentificado;
}

/** Falha do ERP classificada para o serviço do borderô do grupo. */
export interface FalhaClassificada {
    tipo: 'DETERMINISTICA' | 'TRANSITORIA';
    /** Key crua do ERP (ex.: `FIN_014.FIN_HAS_REMESSA_PGTO`), quando houver. */
    codigoErp?: string;
}

/** `responseData` do passo 2 (validação do título da invoice). */
export interface TituloBaixaValidacao {
    /** Valor do título a baixar (fonte da verdade do ERP — moeda do título). */
    bxaMnyValor: number;
    bxaCodGerJuros?: number;
    bxaCodGerDesconto?: number;
    bxaCodGerMulta?: number;
    gerDesJuros?: string;
    gerDesDesconto?: string;
    gerDesMulta?: string;
}

/** `responseData` do passo 3 (validação do título da permuta / adiantamento). */
export interface TituloPermutaValidacao {
    gerNumPermuta: number;
    gerDesPermuta?: string;
    gerDes?: string;
    gerNum?: number;
    pesCod?: number;
    dpeNomPessoa?: string;
    bxaMnyValorPermuta?: number;
    bxaMnyLiquidoPermuta?: number | null;
}

/** Resposta do passo 5 — baixa gravada (confirmação). */
export interface BaixaGravada {
    /** Sequência da baixa no borderô — a confirmação que persistimos. */
    bxaCodSeq: number;
    bxaCodSeqPerm?: number;
    borCod: number;
    docCod: number;
    bxaDocCod: number;
    bxaMnyValor: number;
    bxaMnyJuros: number;
    bxaMnyLiquido: number;
    vldPermuta?: number;
}

/** Envelope `{ messages, responseData }` das rotas de validação do `fin010`. */
export interface Fin010ValidacaoResponse<T> {
    messages?: Array<{ valid?: string; message?: string; vars?: Record<string, unknown> }>;
    responseData?: T;
}

/** Entrada de alto nível para executar UMA baixa/permuta (um par adto→invoice). */
export interface ExecutarBaixaPermutaInput {
    filCod: number;
    /** Borderô já criado (encadeia múltiplos pares no mesmo borderô). */
    borCod: number;
    /** docCod da INVOICE (lado da baixa). */
    invoiceDocCod: number;
    /** docCod do ADIANTAMENTO (lado da permuta). */
    adiantamentoDocCod: number;
    /** Parcela / número do título — `1` por ora. */
    titCod: number;
    bxaTitCod: number;
    /** Valor da variação cambial (vai em `bxaMnyJuros` quando JUROS). */
    juros: number;
    /** Conta gerencial do juros (131 = VARIAÇÃO CAMBIAL PASSIVA REALIZADA). */
    contaJuros: number;
    /** Classificação da variação — decide se vai em juros ou desconto. */
    classificacao?: 'JUROS' | 'DESCONTO';
}
