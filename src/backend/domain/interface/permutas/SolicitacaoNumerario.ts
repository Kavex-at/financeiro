/**
 * Tipos da geração de SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA (SN) no ERP Conexos
 * (tela `com068`, família `com299/gerDocProcesso`). Derivados da engenharia reversa do
 * bundle com068 + probes read-only (2026-07-31). Ver `~/com299/SPEC.md` (fora do repo) e
 * `ontology/entities/solicitacao-numerario.md`.
 *
 * O botão "Processar" passa a GERAR uma SN (em vez da baixa fin010): uma SN por
 * adiantamento; `valor` = `valorASerUsado` do modal (moeda negociada, sem conversão).
 */

/** Tipo do documento SN - ENCOMENDA (constante deliberada — ver entidade). */
export const GCD_ENCOMENDA = 150 as const;
export const DOC_TIP_SN = 1 as const;
export const GLOBAL_DOC_VLD_TIPO_SN = 9 as const;

/**
 * Constantes da Tela 3 (com297 — nota de débito) do guia "telas Conexos".
 * PRODUTO/NÚMERO são fixos por decisão do guia; TIPO_NOTA é a opção fiscal "Pagamento antecipado".
 * GCD/Configuração da nota de débito ainda NÃO confirmado (GAP — capturar HAR).
 */
export const PRODUTO_NOTA_DEBITO = 41978 as const;
export const NUMERO_NOTA_DEBITO = '0' as const;
export const TIPO_NOTA_DEBITO = 'Pagamento antecipado' as const;

/** Entrada de alto nível para gerar UMA SN a partir de um adiantamento. */
export interface GerarNumerarioInput {
    adiantamentoDocCod: string;
    executadoPor: string;
    /** Valor da SN (= `valorASerUsado` do modal), moeda negociada, sem conversão. */
    valor: number;
    /** Data de emissão/entrada do documento em epoch-ms (default: meia-noite UTC de hoje). */
    dataEmissao?: number;
    /** Número do documento (guia Tela 1: "data do dia" DDMMYYYY; default: hoje). */
    numeroDocumento?: string;
    /** Força dry-run (monta/loga o payload sem POST), mesmo com escrita habilitada. */
    dryRunOverride?: boolean;
}

/** `responseData` de `com299/gerDoc/validaConfigDoc` (config do documento por gcd). */
export interface ValidaConfigDocResult {
    tpcCod?: number;
    cfoEspCod?: string;
    /** Modo de rateio (1 plain, 2 byCentroCusto, 3 byCentroCustoCfop). */
    gcdVldFormaRateio?: number;
    gcdVldTela?: number;
    gcdVldPropria?: number;
    fisEspSerie?: string | null;
}

/**
 * `responseData` de `POST {tela}/validaConfigDocPessoa` — a Configuração de Documento (`gcd`) que o ERP
 * resolve PARA ESTE processo/pessoa. A "SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA" mapeia para MÚLTIPLOS gcds
 * (188/150/107 no histórico); qual vale é POR PROCESSO. `gcdDesNome` é o valor que o servidor valida como
 * `gcdDesNomeProc` — hardcodar 150 quebra (`gcdDesNomeProc NOT_VALID`) para um processo que resolve outro.
 * Passthrough do resto: só `gcdCod`/`gcdDesNome` são load-bearing. Ambos OPCIONAIS — ausência = processo
 * SEM configuração SN válida (ineligível), que o pré-flight classifica em vez de deixar o ERP dar 400.
 */
export interface ValidaConfigDocPessoaResult {
    gcdCod?: number;
    gcdDesNome?: string;
    [key: string]: unknown;
}

/** Linha de rateio servida pelo ERP (`com299/gerDoc/contasProj/list/...`). */
export interface ContaProjetoRow {
    prjCod: number;
    ctpCod: number;
    ctpDesNome?: string;
    tpcCod: number;
    tpcDesNome?: string;
    cfoEspCod: string;
    /** Percentual do rateio (100 = 100%). */
    total: number;
    /** Valor monetário da linha — preenchido = round2(valor × total/100). */
    tmpMnyValor?: number | null;
}

/**
 * Dados de cabeçalho resolvidos do adiantamento/processo para montar o body.
 * GAP (Open item #1): a fonte exata de `pdcDocFederal`/`endCodFis` precisa de confirmação
 * por probe HAR — resolvido best-effort do detalhe do adiantamento por ora.
 */
export interface NumerarioHeaderDados {
    pdcDocFederal?: string;
    endCodFis: number;
    priEspRefcliente?: string;
    dpeNomPessoa?: string;
}

/**
 * Body do `POST {tela}/gerDocProcesso/valida` — o pré-cheque NÃO recebe o header, e sim um WRAPPER
 * `{items:[{titVldPagopor, gcdCod, items:[<stub all-null>]}]}` (HAR doc 18339, filial 2). O stub
 * interno é uma linha de rateio com TODOS os campos `null` — o servidor só valida a existência da
 * configuração (`gcdCod`), não os valores. Enviar o header flat causava `SELECTION_ERROR`.
 */
export interface GerDocProcessoValidaStub {
    prjCod: null;
    ctpCod: null;
    tmpMnyValor: null;
    ctpDesNome: null;
    tpcCod: null;
    tpcDesNome: null;
    cfoEspCod: null;
    total: null;
}

export interface GerDocProcessoValidaGroup {
    titVldPagopor: null;
    gcdCod: number;
    items: GerDocProcessoValidaStub[];
}

export interface GerDocProcessoValidaWrapper extends Record<string, unknown> {
    items: GerDocProcessoValidaGroup[];
}

/** Item de rateio do body `gerDocProcesso` (frontModelName é removido do item). */
export interface GerDocProcessoItem {
    prjCod: number;
    ctpCod: number;
    tmpMnyValor: number;
    ctpDesNome?: string;
    tpcCod: number;
    tpcDesNome?: string;
    cfoEspCod: string;
    total: number;
}

/** Body do `POST com299/gerDocProcesso` (POST-once: header + itens num só corpo). */
export interface GerDocProcessoPayload extends Record<string, unknown> {
    docTip: number;
    globalDocVldTipo: number;
    frontModelName: 'gerDocProcesso';
    priCod: number;
    priEspRefcliente?: string;
    /**
     * Endereço fiscal. OPCIONAL: a SN Encomenda REAL só o envia quando conhecido (GAP de fonte — imp021
     * não o expõe; HAR usou 2). Os builders permutas ainda o preenchem sempre (`END_COD_FIS_DEFAULT`).
     */
    endCodFis?: number;
    pesCod: number;
    dpeNomPessoa?: string;
    pdcDocFederal?: string;
    gcdCod: number;
    gcdDesNome: string;
    gcdVldTela?: number;
    gcdVldPropria?: number;
    gcdVldFormaRateio?: number;
    fisEspSerie?: string | null;
    /** `null` na SN Encomenda (HAR doc 18339); a config só o preenche na nota de débito. */
    tpcCod?: number | null;
    tpcDesNome?: string | null;
    cfoEspCod?: string | null;
    valor: number;
    /** Datas de emissão/movimento em epoch-ms (guia Tela 1: "Data emissão"/"Data entrada"). */
    docDtaEmissao?: number;
    docDtaMovimento?: number;
    /** Número do documento (guia: "data do dia" na SN; "0" na nota de débito). */
    docEspNumero?: string;
    /** Produto — fixo 41978 na nota de débito (com297); ausente na SN. */
    prdCod?: number;
    /**
     * Itens de rateio. OPCIONAL: a SN Encomenda real NÃO envia `items` (HAR doc 18339 — header only;
     * `comDocProdutos/list` pós-geração devolveu count:0). Só o preview permutas/wire estático carrega
     * itens; o corpo REAL do com299/com297 omite a chave por completo.
     */
    items?: GerDocProcessoItem[];
}

/**
 * Payload da Tela 2 (fin014 — recebimento do crédito). GAP: campos/rota NÃO confirmados
 * (sem bundle fin014); montados a partir do guia "telas Conexos" para preview dry-run + fail-closed.
 */
export interface Fin014RecebimentoPayload extends Record<string, unknown> {
    filCod: number;
    /** Documento gerado na Tela 1 (SN) a ser vinculado ao recebimento. */
    docCod: number;
    /** Data do recebimento do crédito em epoch-ms. */
    dataRecebimento: number;
    /** Conta financeira de baixa — a MESMA identificada na tela FIN_134 (GAP: fonte não confirmada). */
    contaFinanceira?: number;
}

/** Onde a orquestração das 3 telas parou (para retomada/diagnóstico). */
export type NumerarioEtapa =
    | 'sn'
    | 'sn-finalizar'
    | 'fin014'
    | 'fin014-done'
    | 'nota-debito'
    | 'nota-debito-fiscal'
    | 'concluido';

/** Resposta da orquestração das 3 telas — cada `*DocCod` é o handle do ERP para reconciliação. */
export interface GerarNumerarioResult {
    adiantamentoDocCod: string;
    dryRun: boolean;
    writeEnabled: boolean;
    status: 'dry-run' | 'settled' | 'skipped' | 'error';
    valor: number;
    /** docCod da SN (Tela 1, com299). */
    docCod?: number;
    /** docCod da nota de débito (Tela 3, com297). */
    notaDebitoDocCod?: number;
    /** Última etapa alcançada (útil quando parou num GAP fail-closed). */
    etapa?: NumerarioEtapa;
    erro?: string;
    /** Payloads montados (preview dry-run das 3 telas). */
    payload?: GerDocProcessoPayload;
    payloadFin014?: Fin014RecebimentoPayload;
    payloadNotaDebito?: GerDocProcessoPayload;
}
