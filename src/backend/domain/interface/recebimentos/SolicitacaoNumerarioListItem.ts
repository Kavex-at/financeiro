import { z } from 'zod';

/**
 * Frente IV — "Selecionar SN existente antes de Processar" (ADR-0027 / v0.13).
 *
 * DTO da lista de **Solicitações de Numerário (SN)** já existentes de um processo, servida pelo
 * `POST /api/com299/list` (HAR-confirmado). O analista escolhe uma SN existente (baixa fin014 +
 * NDe com297 contra o `docCod` dela) OU "Criar novo SN" (fluxo completo, inalterado).
 *
 * `Row` espelha o wire com299 (`.passthrough()` no boundary — o ERP devolve dezenas de campos; só
 * os load-bearing são tipados). `SolicitacaoNumerarioListItem` é a PROJEÇÃO LÓGICA devolvida à API
 * (nomes em inglês, `data` já em ISO, `descricao` derivada). O discriminador da SN é
 * `docVldTipo===9 && docVldTipoAdto===1`; uma NC/ND no mesmo processo é `docVldTipoAdto===0` e é
 * EXCLUÍDA (o filtro do servidor já exclui, mas guardamos defensivamente no client).
 */

/** Linha crua do `com299/list` — só os campos usados são tipados; o resto passa livre. */
export const SOLICITACAO_NUMERARIO_ROW_SCHEMA = z
    .object({
        docCod: z.coerce.number().int(),
        docEspNumero: z
            .string()
            .nullish()
            .transform((v) => v ?? ''),
        /** Epoch ms da emissão do documento. */
        docDtaEmissao: z.coerce.number().int(),
        tpdDesNome: z
            .string()
            .nullish()
            .transform((v) => v ?? undefined),
        gcdDesNome: z
            .string()
            .nullish()
            .transform((v) => v ?? undefined),
        gerDes: z
            .string()
            .nullish()
            .transform((v) => v ?? undefined),
        /** Status do documento no ERP (1 = Aberta, 3 = Finalizada — best-effort, ver abaixo). */
        vldStatus: z.coerce.number().int(),
        /** Discriminador de SN: === 9 na SN. */
        docVldTipo: z.coerce.number().int(),
        /** Discriminador de adiantamento: === 1 na SN; === 0 numa NC/ND (excluída). */
        docVldTipoAdto: z.coerce.number().int(),
        /** Valor solicitado (bruto) da SN. */
        mnyBruto: z.coerce.number(),
        /** Valor do documento. */
        docMnyValor: z.coerce.number(),
    })
    .passthrough();

export type SolicitacaoNumerarioRow = z.infer<typeof SOLICITACAO_NUMERARIO_ROW_SCHEMA>;

/** Envelope paginado do `com299/list` — `{ count, pageNumber, rows }`. */
export const SOLICITACAO_NUMERARIO_LIST_ENVELOPE_SCHEMA = z
    .object({
        count: z.coerce
            .number()
            .int()
            .nullish()
            .transform((v) => v ?? undefined),
        pageNumber: z.coerce
            .number()
            .int()
            .nullish()
            .transform((v) => v ?? undefined),
        rows: z.array(SOLICITACAO_NUMERARIO_ROW_SCHEMA).default([]),
    })
    .passthrough();

export type SolicitacaoNumerarioListEnvelope = z.infer<
    typeof SOLICITACAO_NUMERARIO_LIST_ENVELOPE_SCHEMA
>;

/**
 * Mapa `vldStatus → rótulo humano`.
 *
 * ⚠️ vldStatus→label mapping is a best-effort assumption (only vldStatus=3 seen in the HAR) —
 * confirm on HML. Um `vldStatus` fora do mapa cai no fallback `SN ${vldStatus}` (nunca chuta um
 * rótulo). Esta incerteza é um follow-up CONHECIDO, não um bloqueador.
 */
export const SOLICITACAO_NUMERARIO_STATUS_LABEL: Readonly<Record<number, string>> = {
    1: 'Aberta',
    3: 'Finalizada',
};

/** Rótulo do status da SN; fallback `SN ${vldStatus}` para valores não mapeados. */
export const solicitacaoNumerarioStatusLabel = (vldStatus: number): string =>
    SOLICITACAO_NUMERARIO_STATUS_LABEL[vldStatus] ?? `SN ${vldStatus}`;

/**
 * Projeção LÓGICA de uma SN devolvida à API (nomes em inglês; `data` em ISO; `descricao` derivada).
 * O teto de valor (≤ saldo real da SN) NÃO é imposto aqui — a lista é document-level; o teto vive na
 * baixa (fin014, leitura do título).
 */
export interface SolicitacaoNumerarioListItem {
    /** `docCod` da SN — o handle que a baixa fin014 + NDe com297 usam. */
    docCod: number;
    /** Número do documento (`docEspNumero`). */
    numero: string;
    /** Emissão em ISO (derivada de `docDtaEmissao` epoch ms). */
    data: string;
    /** Descrição preferindo `gcdDesNome`, senão `tpdDesNome`, senão `gerDes`. */
    descricao: string;
    /** `vldStatus` cru do ERP. */
    status: number;
    /** Rótulo humano do status (best-effort). */
    statusLabel: string;
    /** Valor solicitado (`mnyBruto`). */
    solicitado: number;
    /** Valor do documento (`docMnyValor`). */
    valor: number;
}
