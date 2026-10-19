import { z } from 'zod';
import { ETAPA_AJUSTE, type EtapaAjuste } from '../../libs/boleto/EtapaAjusteCentavos.js';

/** Uma linha do ledger `sispag_ajuste_centavos_execucao` (ADR-0073, I18h). Só máscara 5+4. */
export interface AjusteCentavosExecucao {
    id: string;
    filCod: number;
    docCod: string;
    titCodOrigem: string;
    decisaoId: string;
    titCodNovo?: string;
    frnCod?: number;
    /** Marcador de correlação (vai na obs do `fin070`, I18i). */
    marcador: string;
    etapa: EtapaAjuste;
    /** Write-ahead: a chamada ao ERP em curso, gravada antes dela. */
    intencao?: string;
    motivo?: string;
    deltaCentavos?: number;
    frnVldTpop?: 1 | 2;
    valorBoletoCentavos?: number;
    codigoMascarado?: string;
    fblCod?: number;
    conexosUsername?: string;
    conexosUsnCod?: string;
    tentativas: number;
    criadoEm: string;
    atualizadoEm: string;
    concluidoEm?: string;
}

/** Gatilho que pediu o ajuste (I18g): só no processo do servidor. */
export const GATILHO_AJUSTE = {
    CONFIRMAR: 'confirmar',
    TENTAR_DE_NOVO: 'tentar_de_novo',
    VARREDURA: 'varredura',
} as const;
export type GatilhoAjuste = (typeof GATILHO_AJUSTE)[keyof typeof GATILHO_AJUSTE];

const textoOpcional = z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? undefined);
const numeroOpcional = z.coerce
    .number()
    .nullable()
    .optional()
    .transform((v) => (v == null ? undefined : v));
const dataIso = z
    .union([z.date(), z.string()])
    .transform((v) => (v instanceof Date ? v.toISOString() : v));

export const ajusteCentavosExecucaoRowSchema = z
    .object({
        id: z.string(),
        fil_cod: z.coerce.number().int(),
        doc_cod: z.string(),
        tit_cod_origem: z.string(),
        decisao_id: z.string(),
        tit_cod_novo: textoOpcional,
        frn_cod: numeroOpcional,
        marcador: z.string(),
        etapa: z.nativeEnum(ETAPA_AJUSTE),
        intencao: textoOpcional,
        motivo: textoOpcional,
        delta_centavos: numeroOpcional,
        frn_vld_tpop: numeroOpcional,
        valor_boleto_centavos: numeroOpcional,
        codigo_mascarado: textoOpcional,
        fbl_cod: numeroOpcional,
        conexos_username: textoOpcional,
        conexos_usn_cod: textoOpcional,
        tentativas: z.coerce.number().int(),
        criado_em: dataIso,
        atualizado_em: dataIso,
        concluido_em: dataIso.nullable().optional(),
    })
    .transform(
        (r): AjusteCentavosExecucao => ({
            id: r.id,
            filCod: r.fil_cod,
            docCod: r.doc_cod,
            titCodOrigem: r.tit_cod_origem,
            decisaoId: r.decisao_id,
            ...(r.tit_cod_novo ? { titCodNovo: r.tit_cod_novo } : {}),
            ...(r.frn_cod !== undefined ? { frnCod: r.frn_cod } : {}),
            marcador: r.marcador,
            etapa: r.etapa,
            ...(r.intencao ? { intencao: r.intencao } : {}),
            ...(r.motivo ? { motivo: r.motivo } : {}),
            ...(r.delta_centavos !== undefined ? { deltaCentavos: r.delta_centavos } : {}),
            ...(r.frn_vld_tpop === 1 || r.frn_vld_tpop === 2 ? { frnVldTpop: r.frn_vld_tpop } : {}),
            ...(r.valor_boleto_centavos !== undefined
                ? { valorBoletoCentavos: r.valor_boleto_centavos }
                : {}),
            ...(r.codigo_mascarado ? { codigoMascarado: r.codigo_mascarado } : {}),
            ...(r.fbl_cod !== undefined ? { fblCod: r.fbl_cod } : {}),
            ...(r.conexos_username ? { conexosUsername: r.conexos_username } : {}),
            ...(r.conexos_usn_cod ? { conexosUsnCod: r.conexos_usn_cod } : {}),
            tentativas: r.tentativas,
            criadoEm: r.criado_em,
            atualizadoEm: r.atualizado_em,
            ...(r.concluido_em ? { concluidoEm: r.concluido_em } : {}),
        }),
    );

/** Entrada do rechaveamento (I18j) — uma transação local. */
export interface RechaveamentoInput {
    execucaoId: string;
    /** Etapa atual do ledger (lock otimista da transição para `rechaveada`). */
    etapaAtual: EtapaAjuste;
    filCod: number;
    docCod: string;
    titCodAntigo: string;
    titCodNovo: string;
    frnCod: number;
    decisaoId: string;
    /** Motivo gravado no ledger junto com `rechaveada` (ex.: aprovação manual pendente, I18e). */
    motivo?: string;
    /** Título novo lido AO VIVO no `fin064`. */
    tituloNovo: {
        /** `titMnyValor` (base) — o que a carteira guarda. */
        valorBase: number;
        /** Líquido aberto (I17b) — o valor do item em RASCUNHO (M6). */
        valorLiquido: number;
        vencimentoEpoch: number;
        aprovado: boolean;
    };
}

export interface RechaveamentoResultado {
    /** `false` = a decisão já não estava CONFIRMADA (anulada pela analista): só carteira/item. */
    decisaoTransferida: boolean;
    novaDecisaoId?: string;
    lotesTocados: string[];
}
