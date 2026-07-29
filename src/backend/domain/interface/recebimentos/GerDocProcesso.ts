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
    /** Referência externa/cliente (`priEspRefcliente`, "Referência Externa"). */
    priEspRefcliente: string;
    /** Invariante multi-filial — nunca `null`. */
    filCod: number;
    /** Código da pessoa (cliente) no ERP. */
    pesCod: number;
    /** Nome do cliente/pessoa (`dpeNomPessoa`). */
    dpeNomPessoa: string;
    /** Moeda do processo. */
    moeCod: number;
    /** Saldo/valor de referência do processo (base informativa do rateio). */
    valor?: number;
    /** Contraparte solta usada no filtro (espelha `TransacaoBancaria.contraparte`). */
    contraparte?: string;
}

/** Boundary validation (Zod at boundaries). */
export const processoSchema = z.object({
    priCod: z.number().int().positive(),
    priEspRefcliente: z.string().min(1),
    filCod: z.number().int().positive(),
    pesCod: z.number().int().positive(),
    dpeNomPessoa: z.string().min(1),
    moeCod: z.number().int().positive(),
    valor: z.number().optional(),
    contraparte: z.string().optional(),
});

// ─────────────────────────────────────────────── GerDocProcessoSelectionDTOCab (com299 swagger)

/** Item de rateio da SN (`TmpCom068DTOItem`) — espelha o wire do com299. */
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
 * Payload cabeçalho do `POST /api/com299/gerDocProcesso` (`GerDocProcessoSelectionDTOCab`).
 * Nomes de campo em português espelham o wire do ERP (permitido por CLAUDE.md).
 */
export interface GerDocProcessoSelectionDTOCab {
    filCod: number;
    docTip: string;
    docVldTipo: string;
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
    moeCod: number;
    items: TmpCom068DTOItem[];
}

/** Boundary validation do item de rateio. */
export const tmpCom068DTOItemSchema = z.object({
    prjCod: z.number().int(),
    ctpCod: z.number().int(),
    tmpMnyValor: z.number(),
    ctpDesNome: z.string(),
    tpcCod: z.number().int(),
    cfoEspCod: z.number().int(),
    total: z.number(),
});

/** Boundary validation do cabeçalho do payload com299. */
export const gerDocProcessoSelectionDTOCabSchema = z.object({
    filCod: z.number().int().positive(),
    docTip: z.string().min(1),
    docVldTipo: z.string().min(1),
    priCod: z.number().int().positive(),
    priEspRefcliente: z.string(),
    pesCod: z.number().int(),
    dpeNomPessoa: z.string(),
    gcdCod: z.number().int(),
    gcdDesNome: z.string().min(1),
    docDtaEmissao: z.string().min(1),
    dtaVencimento: z.string().min(1),
    valor: z.number(),
    moeCod: z.number().int(),
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
