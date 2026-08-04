import { z } from 'zod';
import VldTpNfAusenteError from '../../errors/VldTpNfAusenteError.js';
import VldTpNfDesconhecidoError from '../../errors/VldTpNfDesconhecidoError.js';
import {
    NDE_CONTINGENCIA_AVISO,
    NDE_CONTINGENCIA_TP_NF,
    NDE_HOMOLOGACAO_VERB,
    NDE_NORMAL_TP_NF_CONHECIDOS,
} from './constants.js';
import type { NdeHomologacaoVerb } from './constants.js';

/**
 * NDe fiscal (com297) — contratos da HOMOLOGAÇÃO + a decisão PURA de rota (contingência × normal).
 *
 * A rota é uma função pura de `vldTpNf` (fonte: o predicado client-side
 * `finDocIsContingenciaHomologacao`). Invertemos o predicado fail-open do UI: contingência = whitelist
 * `{11,12}`, normal = whitelist explícita, e QUALQUER outro valor (incluindo ausente) → RECUSA
 * (fail-loud). Ver `ontology/business-rules/homologacao-nde-com297.md`.
 */

/** Rota de homologação decidida a partir de `vldTpNf` (no momento do POST). */
export interface RotaHomologacao {
    contingencia: boolean;
    verbo: NdeHomologacaoVerb;
    /** Só na rota de contingência — DPEC (`11`) ou SCAN (`12`); `undefined` na rota normal. */
    aviso?: 'DPEC' | 'SCAN';
    /** O `vldTpNf` normalizado (string) que decidiu a rota — passe ESTE valor ao POST (não um read velho). */
    vldTpNf: string;
}

/** Conjuntos de decisão — injetáveis p/ teste; o default usa as constantes do módulo. */
export interface TpNfSets {
    contingencia: readonly string[];
    normaisConhecidos: readonly string[];
}

export const NDE_TP_NF_SETS_DEFAULT: TpNfSets = {
    contingencia: NDE_CONTINGENCIA_TP_NF,
    normaisConhecidos: NDE_NORMAL_TP_NF_CONHECIDOS,
};

/**
 * Normaliza `vldTpNf` p/ string estrita no boundary — um deserializador JSON pode entregar `11`
 * (number); o predicado original compara por string (`indexOf` em array de strings), então um number
 * não casaria. `null`/`undefined` viram `''` (ausente), tratado como erro a jusante.
 */
export const normalizeVldTpNf = (raw: unknown): string => (raw == null ? '' : String(raw).trim());

/**
 * Decide a rota de homologação a partir de `vldTpNf` — PURA. Inverte o predicado fail-open do UI:
 *   - ausente (`''`) → `VldTpNfAusenteError` (NÃO herdar o silent-normal do UI)
 *   - `∈ contingencia` (`{11,12}`) → `homologaNfeContingencia` (+ aviso DPEC/SCAN)
 *   - `∈ normaisConhecidos` → `homologaNfe`
 *   - qualquer outro → `VldTpNfDesconhecidoError` (recusa + alerta — o caso que realmente machuca)
 */
export const decidirRotaHomologacao = (
    rawVldTpNf: unknown,
    sets: TpNfSets = NDE_TP_NF_SETS_DEFAULT,
): RotaHomologacao => {
    const vldTpNf = normalizeVldTpNf(rawVldTpNf);
    if (vldTpNf === '') throw new VldTpNfAusenteError();
    if (sets.contingencia.includes(vldTpNf)) {
        return {
            contingencia: true,
            verbo: NDE_HOMOLOGACAO_VERB.CONTINGENCIA,
            aviso: NDE_CONTINGENCIA_AVISO[vldTpNf],
            vldTpNf,
        };
    }
    if (sets.normaisConhecidos.includes(vldTpNf)) {
        return { contingencia: false, verbo: NDE_HOMOLOGACAO_VERB.NORMAL, vldTpNf };
    }
    throw new VldTpNfDesconhecidoError(vldTpNf);
};

/**
 * Carrier opcional no `Recebimento`: o que a leg de GERAÇÃO com297 (fora do escopo desta fatia)
 * produz p/ a homologação. Enquanto ausente, `ConexosNdeEmitter` cai no fallback `pendente` (o
 * pipeline nunca quebra); presente + escrita ligada → homologação real.
 */
export interface EmissaoNde {
    /** `docCod` do documento com297 gerado (a homologar). Origem = leg de geração (info-gap). */
    com297DocCod: string;
    /** `vldTpNf` do documento — decide a rota. String estrita (normalizada no boundary). */
    vldTpNf: string;
}

export const emissaoNdeSchema = z.object({
    com297DocCod: z.string().min(1),
    vldTpNf: z.string().min(1),
});

/** Input do `ConexosNdeClient.homologar`. */
export interface HomologarNdeInput {
    /** `docCod` do documento com297 a homologar (vai no PATH, não no body). */
    docCod: string;
    filCod: number;
    rota: RotaHomologacao;
    correlationId: string;
}

/**
 * Resultado de uma homologação já ramificada por `docVldComvalidacoes` (200 ≠ sucesso). O client só
 * devolve isto nos casos EMITIDA (limpa ou com aviso); o `default` vira `HomologacaoRejeitadaError`.
 */
export interface HomologacaoNdeResult {
    docVldComvalidacoes: number;
    /** `true` quando `docVldComvalidacoes === 2` (homologada, mas com validações pendentes — com194). */
    avisoValidacoesPendentes: boolean;
    /** Número da NF-e homologada, quando presente (campo exato NÃO confirmado — best-effort/info-gap). */
    numeroNde?: string;
    /** Resposta crua do ERP (auditoria). */
    erpResponse: unknown;
}
