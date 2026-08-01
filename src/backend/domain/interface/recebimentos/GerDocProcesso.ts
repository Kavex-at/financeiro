import { z } from 'zod';

/**
 * Frente IV — "Processar processo" → gerar uma **Solicitação de Numerário (encomenda)** via
 * com299 `gerDocProcesso` (DRY-RUN nesta iteração).
 *
 * `Processo` é um candidato de processo de importação para uma `TransacaoBancaria` (o operador
 * escolhe qual processar). `GerDocProcessoSelectionDTOCab` espelha o swagger do com299 (nomes de
 * campo do wire em português são permitidos para campos que espelham ERP — ver CLAUDE.md). O
 * resultado `SolicitacaoNumerarioDryRun` devolve o payload previsto SEM tocar o Conexos.
 *
 * SKELETON — o `gcdCod` exato + shape final vêm de HML/HAR (ver
 * `ontology/integrations/conexos-com299-gerdoc.md`).
 */

// ─────────────────────────────────────────────────────────── Processo (candidato)

/** Processo de importação candidato para uma transação (fonte: STUB por ora — sem matching-engine). */
export interface Processo {
    /** Nº do processo de importação (`priCod`, "Processo" no com299). */
    priCod: number;
    /**
     * Referência externa/cliente (`priEspRefcliente`, "Referência Externa").
     *
     * OPCIONAL: o `imp021` não a preenche em todo processo. Coalescer para um
     * placeholder aqui poluiria o payload do com299 com um valor inventado — o
     * `SolicitacaoNumerarioService` coalesce para `''` na hora de montar o
     * documento, onde a semântica é "campo vazio no ERP".
     */
    priEspRefcliente?: string;
    /** Invariante multi-filial — nunca `null`. */
    filCod: number;
    /** Código da pessoa (cliente) no ERP. */
    pesCod: number;
    /** Nome do cliente/pessoa (`dpeNomPessoa`). */
    dpeNomPessoa: string;
    /** Moeda do processo. */
    moeCod: number;
    /**
     * `true` quando `moeCod` NÃO veio do ERP e foi assumido (BRL/790).
     *
     * O `imp021` não expõe moeda do processo — só `moeCodConv` (conversão) e
     * `moeCodSeg` (seguro), verificado em produção. A UI exibe o aviso; assumir em
     * silêncio num payload financeiro é como o dry-run vira bug no dia em que
     * deixar de ser dry-run.
     */
    moeCodAssumido?: boolean;
    /** Saldo/valor de referência do processo (base informativa do rateio). */
    valor?: number;
    /** Contraparte solta usada no filtro (espelha `TransacaoBancaria.contraparte`). */
    contraparte?: string;
}

/** Boundary validation (Zod at boundaries). */
export const processoSchema = z.object({
    priCod: z.number().int().positive(),
    priEspRefcliente: z.string().optional(),
    filCod: z.number().int().positive(),
    pesCod: z.number().int().positive(),
    dpeNomPessoa: z.string().min(1),
    moeCod: z.number().int().positive(),
    moeCodAssumido: z.boolean().optional(),
    valor: z.number().optional(),
    contraparte: z.string().optional(),
});

// ─────────────────────────────────────────────── GerDocProcessoSelectionDTOCab (com299 swagger)

/**
 * Item de rateio de PREVIEW da SN (`TmpCom068DTOItem`) — resumo humano exibido no dry-run. NÃO é o
 * wire real da linha de rateio: o com299 persiste o rateio via `POST com299/comDocProdutos` com o shape
 * `ComDocProdutosLine` (abaixo). Mantido só como conveniência de preview.
 */
export interface TmpCom068DTOItem {
    prjCod: number;
    ctpCod: number;
    tmpMnyValor: number;
    ctpDesNome: string;
    tpcCod: number;
    cfoEspCod: number;
    total: number;
}

/**
 * Linha de rateio REAL do com299 (`POST com299/comDocProdutos`) — HAR-confirmada (doc 18202). Os
 * códigos são PROCESSO-derivados (variam por doc; fonte provável = `comDocProdutos/initialValues`, gap
 * G1). `dprPreTotalLiquido` é o líquido que o servidor soma no `calculaValorLiquidoDocumento`. Nomes de
 * wire em português espelham o ERP (permitido por CLAUDE.md).
 */
export interface ComDocProdutosLine {
    prjCod: number;
    ctpCod: number;
    /** Conta contábil espelho do `ctpCod` (ex.: 330037 p/ ctpCod 690). */
    ctpEspConta?: string;
    tpcCod: number;
    cfoEspCod: string;
    ccuCod: number;
    prdCod: number;
    undCod: number;
    ungCod: number;
    dprPreTotalLiquido: number;
}

/**
 * Payload cabeçalho do `POST /api/com299` (`GerDocProcessoSelectionDTOCab`). Nomes de campo do wire em
 * português espelham o ERP (permitido por CLAUDE.md). `docTip`/`docVldTipo`/`docVldTipoAdto` são
 * NUMÉRICOS (HAR-confirmado); `moeCod` é `null` neste tipo de doc (BRL implícito).
 */
export interface GerDocProcessoSelectionDTOCab {
    filCod: number;
    docTip: number;
    docVldTipo: number;
    /** Marca o doc como adiantamento (`docVldTipoAdto = 1`). */
    docVldTipoAdto: number;
    /** Nº do processo ("Processo"). */
    priCod: number;
    /** Referência externa ("Referência Externa"). */
    priEspRefcliente: string;
    pesCod: number;
    /** Nome do cliente. */
    dpeNomPessoa: string;
    /** Cód. Configuração de Documento (`gcd`). */
    gcdCod: number;
    /** Nome da configuração — ex.: "Solicitação de Numerário - Encomenda". */
    gcdDesNome: string;
    docDtaEmissao: string;
    dtaVencimento: string;
    valor: number;
    /** Moeda — `null` na SN Encomenda (BRL implícito; a suposição 790 era errada). */
    moeCod: number | null;
    items: TmpCom068DTOItem[];
}

/** Boundary validation do item de rateio de PREVIEW. */
export const tmpCom068DTOItemSchema = z.object({
    prjCod: z.number().int(),
    ctpCod: z.number().int(),
    tmpMnyValor: z.number(),
    ctpDesNome: z.string(),
    tpcCod: z.number().int(),
    cfoEspCod: z.number().int(),
    total: z.number(),
});

/** Boundary validation da linha de rateio REAL (`comDocProdutos`). */
export const comDocProdutosLineSchema = z.object({
    prjCod: z.number().int(),
    ctpCod: z.number().int(),
    ctpEspConta: z.string().optional(),
    tpcCod: z.number().int(),
    cfoEspCod: z.string().min(1),
    ccuCod: z.number().int(),
    prdCod: z.number().int(),
    undCod: z.number().int(),
    ungCod: z.number().int(),
    dprPreTotalLiquido: z.number(),
});

/** Boundary validation do cabeçalho do payload com299. */
export const gerDocProcessoSelectionDTOCabSchema = z.object({
    filCod: z.number().int().positive(),
    docTip: z.number().int(),
    docVldTipo: z.number().int(),
    docVldTipoAdto: z.number().int(),
    priCod: z.number().int().positive(),
    priEspRefcliente: z.string(),
    pesCod: z.number().int(),
    dpeNomPessoa: z.string(),
    gcdCod: z.number().int(),
    gcdDesNome: z.string().min(1),
    docDtaEmissao: z.string().min(1),
    dtaVencimento: z.string().min(1),
    valor: z.number(),
    moeCod: z.number().int().nullable(),
    items: z.array(tmpCom068DTOItemSchema),
});

// ─────────────────────────────────────────────────────────── Resultado dry-run

/** Configuração de documento (`gcd`) escolhida — devolvida no preview. */
export interface DocConfig {
    gcdCod: number;
    gcdDesNome: string;
}

/**
 * Resultado do "Processar" — SEMPRE `dryRun: true` nesta iteração. Constrói e devolve o payload
 * exato que SERIA enviado ao ERP, sem NENHUM POST no Conexos. O caminho de envio real ainda não
 * existe (o service lança `NotImplementedError` se o seam de envio for invocado).
 */
export interface SolicitacaoNumerarioDryRun {
    dryRun: true;
    docConfig: DocConfig;
    payload: GerDocProcessoSelectionDTOCab;
}
