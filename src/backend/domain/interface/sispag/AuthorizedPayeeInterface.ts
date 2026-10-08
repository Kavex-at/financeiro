import { z } from 'zod';

/**
 * `FavorecidoAutorizado` (code-facing `AuthorizedPayee`, ADR-0065). Favorecido que pode receber TED
 * ou PIX, amarrado à impressão digital do destino que o cadastro do Conexos (`cmn025`) resolvia na
 * aprovação. Ver `ontology/entities/favorecido-autorizado.md`, `state-machines/favorecido-autorizado.md`
 * e `business-rules/favorecido-autorizado-sispag.md` (I14).
 *
 * Nada aqui carrega o destino completo: só a impressão (HMAC) e a máscara (I10h, I14j).
 */

/** Estados (F1–F7). Terminais: `REJEITADO`, `REVOGADO`. Nunca string crua. */
export const AUTHORIZED_PAYEE_STATE = {
    PENDENTE: 'PENDENTE',
    AUTORIZADO: 'AUTORIZADO',
    REJEITADO: 'REJEITADO',
    REAPROVACAO_PENDENTE: 'REAPROVACAO_PENDENTE',
    REVOGADO: 'REVOGADO',
} as const;

export type AuthorizedPayeeState =
    (typeof AUTHORIZED_PAYEE_STATE)[keyof typeof AUTHORIZED_PAYEE_STATE];

/** Estados que ocupam o índice de vigência: no máximo um por (favorecido, modalidade). */
export const AUTHORIZED_PAYEE_ACTIVE_STATES: readonly AuthorizedPayeeState[] = [
    AUTHORIZED_PAYEE_STATE.PENDENTE,
    AUTHORIZED_PAYEE_STATE.AUTORIZADO,
    AUTHORIZED_PAYEE_STATE.REAPROVACAO_PENDENTE,
];

/** Modalidades autorizáveis. Boleto nunca passa pela guarda (I14a). */
export const AUTHORIZED_PAYEE_MODALITY = { TED: 'TED', PIX: 'PIX' } as const;

export type AuthorizedPayeeModality =
    (typeof AUTHORIZED_PAYEE_MODALITY)[keyof typeof AUTHORIZED_PAYEE_MODALITY];

/** De onde veio o pedido. */
export const PAYEE_REQUEST_ORIGIN = {
    ITEM: 'ITEM',
    RELATORIO: 'RELATORIO',
    MANUAL: 'MANUAL',
} as const;

export type PayeeRequestOrigin = (typeof PAYEE_REQUEST_ORIGIN)[keyof typeof PAYEE_REQUEST_ORIGIN];

/**
 * Resultado da função única `verificarDestinoAutorizado` (I14d). Precedência quando não é `OK`:
 * `FALHA_LEITURA` > `SEM_DADO_PAGAMENTO` > `FAVORECIDO_NAO_AUTORIZADO` > `DESTINO_ALTERADO`.
 */
export const PAYEE_CHECK_RESULT = {
    OK: 'OK',
    SEM_DADO_PAGAMENTO: 'SEM_DADO_PAGAMENTO',
    FAVORECIDO_NAO_AUTORIZADO: 'FAVORECIDO_NAO_AUTORIZADO',
    DESTINO_ALTERADO: 'DESTINO_ALTERADO',
    FALHA_LEITURA: 'FALHA_LEITURA',
} as const;

export type PayeeCheckResult = (typeof PAYEE_CHECK_RESULT)[keyof typeof PAYEE_CHECK_RESULT];

/** O selo do item no lote: o resultado da verificação, exceto a falha (que vira PENDENTE). */
export type PayeeItemWarning = Exclude<PayeeCheckResult, typeof PAYEE_CHECK_RESULT.FALHA_LEITURA>;

/** Resultado da "reconferir com o Conexos" (selo da tela de autorizações). */
export const PAYEE_RECHECK_RESULT = {
    IGUAL: 'IGUAL',
    DIFERENTE: 'DIFERENTE',
    SEM_DADO: 'SEM_DADO',
    FALHA_LEITURA: 'FALHA_LEITURA',
} as const;

export type PayeeRecheckResult = (typeof PAYEE_RECHECK_RESULT)[keyof typeof PAYEE_RECHECK_RESULT];

/** Eventos da trilha só-inclusão (I14j). Paridade com o CHECK da 0080. */
export const AUTHORIZED_PAYEE_EVENT = {
    SOLICITADO: 'SOLICITADO',
    CONFIRMADO: 'CONFIRMADO',
    APROVADO: 'APROVADO',
    REJEITADO: 'REJEITADO',
    REAPROVACAO_ABERTA: 'REAPROVACAO_ABERTA',
    REVOGADO: 'REVOGADO',
    DESTINO_REVELADO: 'DESTINO_REVELADO',
    CONFERIDO: 'CONFERIDO',
} as const;

export type AuthorizedPayeeEvent =
    (typeof AUTHORIZED_PAYEE_EVENT)[keyof typeof AUTHORIZED_PAYEE_EVENT];

/** Avisos não bloqueantes gravados na aprovação (I14c). */
export const PAYEE_WARNING = {
    PIX_CHAVE_NAO_E_DOCUMENTO_DO_FAVORECIDO: 'PIX_CHAVE_NAO_E_DOCUMENTO_DO_FAVORECIDO',
} as const;

export type PayeeWarning = (typeof PAYEE_WARNING)[keyof typeof PAYEE_WARNING];

/** Ator do sistema (F4 e retiradas automáticas). Nunca conta como solicitante (I14c). */
export const PAYEE_SYSTEM_ACTOR = 'sistema';

/**
 * Destino normalizável que o resolvedor I10 escolheu — USO INTERNO (fingerprint, máscara, revelar).
 * Nunca persistido, nunca logado, nunca em mensagem de erro.
 */
export type PayeeDestination =
    | {
          tipo: typeof AUTHORIZED_PAYEE_MODALITY.TED;
          banco: string;
          agencia?: string;
          agenciaDv?: string;
          conta: string;
          contaDv?: string;
      }
    | {
          tipo: typeof AUTHORIZED_PAYEE_MODALITY.PIX;
          /** `CPF_CNPJ | EMAIL | TELEFONE | ALEATORIA`; ausente = tipo desconhecido no cadastro. */
          chaveTipo?: string;
          chave: string;
      };

/** A leitura do cadastro reduzida ao que a regra precisa (sem o valor). */
export type PayeeDestinationReading =
    | { status: 'OK'; fingerprint: string; keyId: string }
    | { status: 'SEM_DADO' }
    | { status: 'FALHA_LEITURA' };

/** Registro como sai do repositório. */
export interface AuthorizedPayee {
    id: string;
    pesCod: string;
    credor?: string;
    modalidade: AuthorizedPayeeModality;
    estado: AuthorizedPayeeState;
    fingerprint?: string;
    fingerprintChaveId?: string;
    destinoMascarado?: string;
    avisos: PayeeWarning[];
    fingerprintObservado?: string;
    destinoObservadoMascarado?: string;
    origemSolicitacao: PayeeRequestOrigin;
    /** Filial usada só para LER o cadastro (o `cmn025` é global). Não é chave. */
    filCodLeitura: number;
    solicitadoPor?: string;
    solicitadoEm?: string;
    decididoPor?: string;
    decididoEm?: string;
    motivoDecisao?: string;
    ultimaConferenciaEm?: string;
    ultimaConferenciaResultado?: PayeeRecheckResult;
    criadoEm?: string;
    versao: number;
}

/** Projeção para a API: sem a impressão do destino observado (só a máscara). */
export type AuthorizedPayeeApi = Omit<AuthorizedPayee, 'fingerprintObservado'>;

/** Linha da trilha (I14j). `dados` nunca carrega conta ou chave completas. */
export interface AuthorizedPayeeEventRecord {
    id: string;
    autorizacaoId: string;
    evento: AuthorizedPayeeEvent;
    ator: string;
    ocorridoEm: string;
    dados?: Record<string, unknown>;
}

/** Linha do banco (Zod no boundary de leitura; nulos do Postgres viram ausência). */
const nullableString = z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? undefined);

const dataIso = z
    .union([z.date(), z.string()])
    .nullable()
    .optional()
    .transform((v) => (v == null ? undefined : v instanceof Date ? v.toISOString() : v));

export const authorizedPayeeRowSchema = z
    .object({
        id: z.string(),
        pes_cod: z.string(),
        credor: nullableString,
        modalidade: z.enum([AUTHORIZED_PAYEE_MODALITY.TED, AUTHORIZED_PAYEE_MODALITY.PIX]),
        estado: z.enum([
            AUTHORIZED_PAYEE_STATE.PENDENTE,
            AUTHORIZED_PAYEE_STATE.AUTORIZADO,
            AUTHORIZED_PAYEE_STATE.REJEITADO,
            AUTHORIZED_PAYEE_STATE.REAPROVACAO_PENDENTE,
            AUTHORIZED_PAYEE_STATE.REVOGADO,
        ]),
        fingerprint: nullableString,
        fingerprint_chave_id: nullableString,
        destino_mascarado: nullableString,
        avisos: z
            .array(z.enum([PAYEE_WARNING.PIX_CHAVE_NAO_E_DOCUMENTO_DO_FAVORECIDO]))
            .nullable()
            .optional()
            .transform((v) => v ?? []),
        fingerprint_observado: nullableString,
        destino_observado_mascarado: nullableString,
        origem_solicitacao: z.enum([
            PAYEE_REQUEST_ORIGIN.ITEM,
            PAYEE_REQUEST_ORIGIN.RELATORIO,
            PAYEE_REQUEST_ORIGIN.MANUAL,
        ]),
        fil_cod_leitura: z.coerce.number().int(),
        solicitado_por: nullableString,
        solicitado_em: dataIso,
        decidido_por: nullableString,
        decidido_em: dataIso,
        motivo_decisao: nullableString,
        ultima_conferencia_em: dataIso,
        ultima_conferencia_resultado: z
            .enum([
                PAYEE_RECHECK_RESULT.IGUAL,
                PAYEE_RECHECK_RESULT.DIFERENTE,
                PAYEE_RECHECK_RESULT.SEM_DADO,
                PAYEE_RECHECK_RESULT.FALHA_LEITURA,
            ])
            .nullable()
            .optional()
            .transform((v) => v ?? undefined),
        criado_em: dataIso,
        versao: z.coerce.number().int(),
    })
    .transform(
        (r): AuthorizedPayee => ({
            id: r.id,
            pesCod: r.pes_cod,
            modalidade: r.modalidade,
            estado: r.estado,
            avisos: r.avisos,
            origemSolicitacao: r.origem_solicitacao,
            filCodLeitura: r.fil_cod_leitura,
            versao: r.versao,
            ...(r.credor !== undefined ? { credor: r.credor } : {}),
            ...(r.fingerprint !== undefined ? { fingerprint: r.fingerprint } : {}),
            ...(r.fingerprint_chave_id !== undefined
                ? { fingerprintChaveId: r.fingerprint_chave_id }
                : {}),
            ...(r.destino_mascarado !== undefined ? { destinoMascarado: r.destino_mascarado } : {}),
            ...(r.fingerprint_observado !== undefined
                ? { fingerprintObservado: r.fingerprint_observado }
                : {}),
            ...(r.destino_observado_mascarado !== undefined
                ? { destinoObservadoMascarado: r.destino_observado_mascarado }
                : {}),
            ...(r.solicitado_por !== undefined ? { solicitadoPor: r.solicitado_por } : {}),
            ...(r.solicitado_em !== undefined ? { solicitadoEm: r.solicitado_em } : {}),
            ...(r.decidido_por !== undefined ? { decididoPor: r.decidido_por } : {}),
            ...(r.decidido_em !== undefined ? { decididoEm: r.decidido_em } : {}),
            ...(r.motivo_decisao !== undefined ? { motivoDecisao: r.motivo_decisao } : {}),
            ...(r.ultima_conferencia_em !== undefined
                ? { ultimaConferenciaEm: r.ultima_conferencia_em }
                : {}),
            ...(r.ultima_conferencia_resultado !== undefined
                ? { ultimaConferenciaResultado: r.ultima_conferencia_resultado }
                : {}),
            ...(r.criado_em !== undefined ? { criadoEm: r.criado_em } : {}),
        }),
    );

export const authorizedPayeeEventRowSchema = z
    .object({
        id: z.string(),
        autorizacao_id: z.string(),
        evento: z.enum([
            AUTHORIZED_PAYEE_EVENT.SOLICITADO,
            AUTHORIZED_PAYEE_EVENT.CONFIRMADO,
            AUTHORIZED_PAYEE_EVENT.APROVADO,
            AUTHORIZED_PAYEE_EVENT.REJEITADO,
            AUTHORIZED_PAYEE_EVENT.REAPROVACAO_ABERTA,
            AUTHORIZED_PAYEE_EVENT.REVOGADO,
            AUTHORIZED_PAYEE_EVENT.DESTINO_REVELADO,
            AUTHORIZED_PAYEE_EVENT.CONFERIDO,
        ]),
        ator: z.string(),
        ocorrido_em: z
            .union([z.date(), z.string()])
            .transform((v) => (v instanceof Date ? v.toISOString() : v)),
        dados: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .transform(
        (r): AuthorizedPayeeEventRecord => ({
            id: r.id,
            autorizacaoId: r.autorizacao_id,
            evento: r.evento,
            ator: r.ator,
            ocorridoEm: r.ocorrido_em,
            ...(r.dados ? { dados: r.dados } : {}),
        }),
    );
