import { z } from 'zod';
import {
    LAYOUT_EMISSOR,
    SINAL_SUGESTAO,
    TIER_SUGESTAO,
    type LayoutEmissor,
    type SinalSugestao,
    type TierSugestao,
} from './SugestaoBoleto.js';

/**
 * Persistência da confirmação de emissor e das decisões por título (ADR-0068, I15; migration
 * 0084). EVIDÊNCIA, não autoridade: nada aqui altera `temBoleto`, lote nem Conexos (I15a/b).
 * Nenhuma estrutura guarda as barras completas nem a linha digitável (I15k).
 */

export const ESTADO_CONFIRMACAO_EMISSOR = {
    VIGENTE: 'VIGENTE',
    REVOGADA: 'REVOGADA',
} as const;
export type EstadoConfirmacaoEmissor =
    (typeof ESTADO_CONFIRMACAO_EMISSOR)[keyof typeof ESTADO_CONFIRMACAO_EMISSOR];

export const DECISAO_SUGESTAO_BOLETO = {
    CONFIRMADA: 'CONFIRMADA',
    REJEITADA: 'REJEITADA',
    /** Terminal; só se chega a ela a partir de `CONFIRMADA` (I15l). Libera título e boleto. */
    ANULADA: 'ANULADA',
} as const;
export type DecisaoSugestaoBoletoTipo =
    (typeof DECISAO_SUGESTAO_BOLETO)[keyof typeof DECISAO_SUGESTAO_BOLETO];

export const EVENTO_SUGESTAO_BOLETO = {
    PAR_CONFIRMADO: 'PAR_CONFIRMADO',
    DECISAO_CONFIRMADA: 'DECISAO_CONFIRMADA',
    DECISAO_REJEITADA: 'DECISAO_REJEITADA',
    DECISAO_ANULADA: 'DECISAO_ANULADA',
    PAR_REVOGADO: 'PAR_REVOGADO',
    LINHA_COPIADA: 'LINHA_COPIADA',
    /** ADR-0071: código gravado no item e CONFIRMADO na releitura (I17e). Único por (lote, título, decisão). */
    VINCULO_APLICADO: 'VINCULO_APLICADO',
    /** ADR-0071 (`shadow`): o que o vínculo faria; zero chamada ao ERP (I17k). */
    VINCULO_SIMULADO: 'VINCULO_SIMULADO',
    /** ADR-0071: o vínculo falhou (transitória ou determinística); só motivo + máscara. */
    VINCULO_FALHOU: 'VINCULO_FALHOU',
    /** ADR-0074 (`shadow`): o ajuste de centavos que seria feito; zero escrita (I18l). */
    AJUSTE_SIMULADO: 'AJUSTE_SIMULADO',
    /** ADR-0074: o título foi renegociado no `fin070` (X/Y → X/Z). */
    TITULO_RENEGOCIADO: 'TITULO_RENEGOCIADO',
    /** ADR-0074 (M1): a confirmação humana foi transferida ao título novo pelo sistema. */
    DECISAO_TRANSFERIDA: 'DECISAO_TRANSFERIDA',
    /** ADR-0074: ajuste recusado (inelegível na execução), com motivo. */
    AJUSTE_RECUSADO: 'AJUSTE_RECUSADO',
    /** ADR-0074: renegociação cancelada antes do `finalizar` (compensação). */
    AJUSTE_CANCELADO: 'AJUSTE_CANCELADO',
    /** ADR-0074: falha que exige ação humana (`indeterminado`) ou transitória. */
    AJUSTE_FALHOU: 'AJUSTE_FALHOU',
} as const;

/** Por que a decisão foi anulada (ADR-0074, 0088). Nulo no legado (derivado do motivo). */
export const TIPO_ANULACAO_DECISAO = {
    MANUAL: 'MANUAL',
    PAR_REVOGADO: 'PAR_REVOGADO',
    TITULO_RENEGOCIADO: 'TITULO_RENEGOCIADO',
} as const;
export type TipoAnulacaoDecisao =
    (typeof TIPO_ANULACAO_DECISAO)[keyof typeof TIPO_ANULACAO_DECISAO];
export type EventoSugestaoBoleto =
    (typeof EVENTO_SUGESTAO_BOLETO)[keyof typeof EVENTO_SUGESTAO_BOLETO];

/** Par (credor, emissor) — uso interno: `emissorChave` contém a conta completa. */
export interface ConfirmacaoEmissor {
    id: string;
    pesCod: string;
    credor?: string;
    emissorChave: string;
    layoutEmissor: LayoutEmissor;
    bancoEmissor: string;
    emissorMascarado: string;
    estado: EstadoConfirmacaoEmissor;
    evidencia: Record<string, unknown>;
    confirmadoPor: string;
    confirmadoEm: string;
    revogadoPor?: string;
    revogadoEm?: string;
    motivoRevogacao?: string;
    versao: number;
}

/** Projeção para a API: sem a chave do emissor (só a máscara) e com a marca de elegibilidade. */
export type ConfirmacaoEmissorView = Omit<ConfirmacaoEmissor, 'emissorChave'> & {
    /** `GENERICO` nunca é elegível a automático (I15i). */
    elegivelAutomatico: boolean;
};

export interface DecisaoSugestao {
    id: string;
    filCod: number;
    docCod: string;
    titCod: string;
    pesCod: string;
    credor?: string;
    ddcCod: number;
    ditCod: number;
    numeroBoleto?: string;
    codbarMascarado: string;
    valorTitulo: number;
    vencimentoTitulo: string;
    valorBoleto: number;
    vencimentoBoleto: string;
    deltaValor: number;
    deltaPercentual: number;
    deltaDias: number;
    sinais: SinalSugestao[];
    tier?: TierSugestao;
    emissorChave: string;
    decisao: DecisaoSugestaoBoletoTipo;
    decididoPor: string;
    decididoEm: string;
    motivo?: string;
    confirmacaoEmissorId?: string;
    /** Lock otimista da anulação (I15l). */
    versao: number;
    anuladaPor?: string;
    anuladaEm?: string;
    motivoAnulacao?: string;
    /** ADR-0074: por que foi anulada (nulo no legado). */
    tipoAnulacao?: TipoAnulacaoDecisao;
    /** ADR-0074 (M1): decisão original quando esta foi TRANSFERIDA ao título renegociado. */
    origemDecisaoId?: string;
    /** ADR-0074 (M1): `sistema` quando transferida; o autor humano fica em `decididoPor`. */
    transferidaPor?: string;
}

export interface EventoSugestaoRegistro {
    id: string;
    tipo: EventoSugestaoBoleto;
    ator: string;
    ocorridoEm: string;
    pesCod?: string;
    emissorChave?: string;
    filCod?: number;
    docCod?: string;
    titCod?: string;
    ddcCod?: number;
    ditCod?: number;
    motivo?: string;
    detalhe?: Record<string, unknown>;
    /** Lote local (eventos `VINCULO_*`, 0086). */
    loteId?: string;
    /** Decisão que autorizou o vínculo (eventos `VINCULO_*`, 0086). */
    decisaoId?: string;
}

// ── Linhas do banco (Zod no boundary; nulos viram ausência) ──────────────────────────────────

const textoOpcional = z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? undefined);

const dataIso = z
    .union([z.date(), z.string()])
    .transform((v) => (v instanceof Date ? v.toISOString() : v));

const dataIsoOpcional = z
    .union([z.date(), z.string()])
    .nullable()
    .optional()
    .transform((v) => (v == null ? undefined : v instanceof Date ? v.toISOString() : v));

/** `DATE` civil: o driver pode devolver `Date` (meia-noite local) ou `YYYY-MM-DD` (to_char). */
const dataCivil = z.union([z.date(), z.string()]).transform((v) => {
    if (typeof v === 'string') return v.slice(0, 10);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
});

const objeto = z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .transform((v) => v ?? {});

export const confirmacaoEmissorRowSchema = z
    .object({
        id: z.string(),
        pes_cod: z.string(),
        credor: textoOpcional,
        emissor_chave: z.string(),
        layout_emissor: z.enum([
            LAYOUT_EMISSOR.ITAU_341,
            LAYOUT_EMISSOR.BRADESCO_237,
            LAYOUT_EMISSOR.GENERICO,
        ]),
        banco_emissor: z.string(),
        emissor_mascarado: z.string(),
        estado: z.enum([ESTADO_CONFIRMACAO_EMISSOR.VIGENTE, ESTADO_CONFIRMACAO_EMISSOR.REVOGADA]),
        evidencia: objeto,
        confirmado_por: z.string(),
        confirmado_em: dataIso,
        revogado_por: textoOpcional,
        revogado_em: dataIsoOpcional,
        motivo_revogacao: textoOpcional,
        versao: z.coerce.number().int(),
    })
    .transform(
        (r): ConfirmacaoEmissor => ({
            id: r.id,
            pesCod: r.pes_cod,
            ...(r.credor ? { credor: r.credor } : {}),
            emissorChave: r.emissor_chave,
            layoutEmissor: r.layout_emissor,
            bancoEmissor: r.banco_emissor,
            emissorMascarado: r.emissor_mascarado,
            estado: r.estado,
            evidencia: r.evidencia,
            confirmadoPor: r.confirmado_por,
            confirmadoEm: r.confirmado_em,
            ...(r.revogado_por ? { revogadoPor: r.revogado_por } : {}),
            ...(r.revogado_em ? { revogadoEm: r.revogado_em } : {}),
            ...(r.motivo_revogacao ? { motivoRevogacao: r.motivo_revogacao } : {}),
            versao: r.versao,
        }),
    );

const tierSchema = z
    .enum([TIER_SUGESTAO.CONHECIDO, TIER_SUGESTAO.FORTE, TIER_SUGESTAO.ATENCAO])
    .nullable()
    .optional()
    .transform((v) => v ?? undefined);

const sinaisSchema = z
    .array(z.nativeEnum(SINAL_SUGESTAO))
    .nullable()
    .optional()
    .transform((v) => v ?? []);

export const decisaoSugestaoRowSchema = z
    .object({
        id: z.string(),
        fil_cod: z.coerce.number().int(),
        doc_cod: z.string(),
        tit_cod: z.string(),
        pes_cod: z.string(),
        credor: textoOpcional,
        ddc_cod: z.coerce.number().int(),
        dit_cod: z.coerce.number().int(),
        numero_boleto: textoOpcional,
        codbar_mascarado: z.string(),
        valor_titulo: z.coerce.number(),
        vencimento_titulo: dataCivil,
        valor_boleto: z.coerce.number(),
        vencimento_boleto: dataCivil,
        delta_valor: z.coerce.number(),
        delta_percentual: z.coerce.number(),
        delta_dias: z.coerce.number().int(),
        sinais: sinaisSchema,
        tier: tierSchema,
        emissor_chave: z.string(),
        decisao: z.enum([
            DECISAO_SUGESTAO_BOLETO.CONFIRMADA,
            DECISAO_SUGESTAO_BOLETO.REJEITADA,
            DECISAO_SUGESTAO_BOLETO.ANULADA,
        ]),
        decidido_por: z.string(),
        decidido_em: dataIso,
        motivo: textoOpcional,
        confirmacao_emissor_id: textoOpcional,
        versao: z.coerce.number().int(),
        anulada_por: textoOpcional,
        anulada_em: dataIsoOpcional,
        motivo_anulacao: textoOpcional,
        tipo_anulacao: z
            .nativeEnum(TIPO_ANULACAO_DECISAO)
            .nullable()
            .optional()
            .transform((v) => v ?? undefined),
        origem_decisao_id: textoOpcional,
        transferida_por: textoOpcional,
    })
    .transform(
        (r): DecisaoSugestao => ({
            id: r.id,
            filCod: r.fil_cod,
            docCod: r.doc_cod,
            titCod: r.tit_cod,
            pesCod: r.pes_cod,
            ...(r.credor ? { credor: r.credor } : {}),
            ddcCod: r.ddc_cod,
            ditCod: r.dit_cod,
            ...(r.numero_boleto ? { numeroBoleto: r.numero_boleto } : {}),
            codbarMascarado: r.codbar_mascarado,
            valorTitulo: r.valor_titulo,
            vencimentoTitulo: r.vencimento_titulo,
            valorBoleto: r.valor_boleto,
            vencimentoBoleto: r.vencimento_boleto,
            deltaValor: r.delta_valor,
            deltaPercentual: r.delta_percentual,
            deltaDias: r.delta_dias,
            sinais: r.sinais,
            ...(r.tier ? { tier: r.tier } : {}),
            emissorChave: r.emissor_chave,
            decisao: r.decisao,
            decididoPor: r.decidido_por,
            decididoEm: r.decidido_em,
            ...(r.motivo ? { motivo: r.motivo } : {}),
            ...(r.confirmacao_emissor_id ? { confirmacaoEmissorId: r.confirmacao_emissor_id } : {}),
            versao: r.versao,
            ...(r.anulada_por ? { anuladaPor: r.anulada_por } : {}),
            ...(r.anulada_em ? { anuladaEm: r.anulada_em } : {}),
            ...(r.motivo_anulacao ? { motivoAnulacao: r.motivo_anulacao } : {}),
            ...(r.tipo_anulacao ? { tipoAnulacao: r.tipo_anulacao } : {}),
            ...(r.origem_decisao_id ? { origemDecisaoId: r.origem_decisao_id } : {}),
            ...(r.transferida_por ? { transferidaPor: r.transferida_por } : {}),
        }),
    );

export const eventoSugestaoRowSchema = z
    .object({
        id: z.string(),
        tipo: z.nativeEnum(EVENTO_SUGESTAO_BOLETO),
        ator: z.string(),
        ocorrido_em: dataIso,
        pes_cod: textoOpcional,
        emissor_chave: textoOpcional,
        fil_cod: z.coerce.number().int().nullable().optional(),
        doc_cod: textoOpcional,
        tit_cod: textoOpcional,
        ddc_cod: z.coerce.number().int().nullable().optional(),
        dit_cod: z.coerce.number().int().nullable().optional(),
        motivo: textoOpcional,
        detalhe: z.record(z.string(), z.unknown()).nullable().optional(),
        lote_id: textoOpcional,
        decisao_id: textoOpcional,
    })
    .transform(
        (r): EventoSugestaoRegistro => ({
            id: r.id,
            tipo: r.tipo,
            ator: r.ator,
            ocorridoEm: r.ocorrido_em,
            ...(r.pes_cod ? { pesCod: r.pes_cod } : {}),
            ...(r.emissor_chave ? { emissorChave: r.emissor_chave } : {}),
            ...(r.fil_cod != null ? { filCod: r.fil_cod } : {}),
            ...(r.doc_cod ? { docCod: r.doc_cod } : {}),
            ...(r.tit_cod ? { titCod: r.tit_cod } : {}),
            ...(r.ddc_cod != null ? { ddcCod: r.ddc_cod } : {}),
            ...(r.dit_cod != null ? { ditCod: r.dit_cod } : {}),
            ...(r.motivo ? { motivo: r.motivo } : {}),
            ...(r.detalhe ? { detalhe: r.detalhe } : {}),
            ...(r.lote_id ? { loteId: r.lote_id } : {}),
            ...(r.decisao_id ? { decisaoId: r.decisao_id } : {}),
        }),
    );
