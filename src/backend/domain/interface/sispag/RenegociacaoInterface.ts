import { z } from 'zod';
import type { ConexosService } from '../../../services/conexos.js';

/**
 * Sessão Conexos EXPLÍCITA (I18f, ADR-0073): quem chama passa a sessão do servidor
 * (`ConexosSessionRegistry.robot()`, credencial do ambiente). O client de renegociação nunca a
 * resolve pelo `ConexosSessionResolver` (que, dentro de uma request, devolveria a da analista).
 */
export type SessaoConexos = ConexosService;

const numOpt = z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.coerce.number().finite().optional().catch(undefined),
);
const strOpt = z.preprocess(
    (v) => (v === null || v === undefined ? undefined : String(v)),
    z.string().optional(),
);
const chave = z.union([z.string(), z.number()]).transform(String);

/** Cabeçalho da renegociação (`GET fin070/{frnCod}`, `fin070/list`), schema `FinReneg`. */
export const RENEGOCIACAO_SCHEMA = z
    .object({
        frnCod: z.coerce.number().int(),
        filCod: numOpt,
        pesCod: numOpt,
        frnEspObs: strOpt,
        frnVldFin: numOpt,
        frnVldCan: numOpt,
        frnVldTipo: numOpt,
        frnVldTpop: numOpt,
        frnMnyValor: numOpt,
        frnDtaReneg: z.unknown().optional(),
    })
    .passthrough();
export type RenegociacaoCabecalho = z.infer<typeof RENEGOCIACAO_SCHEMA>;

/** Título da renegociação (`fin070/titulos/list/{frnCod}`), schema `FinRenegTit`. */
export const RENEGOCIACAO_TITULO_SCHEMA = z
    .object({
        docCod: chave,
        titCod: chave,
        docTip: numOpt,
        titMnyValorAberto: numOpt,
        mnyValorTotal: numOpt,
    })
    .passthrough();

/** Renegociação lida: cabeçalho + o `mnyValorTotal` somado dos títulos (I18c, conferência). */
export interface Renegociacao {
    frnCod: number;
    finalizada: boolean;
    cancelada: boolean;
    obs?: string;
    /** Soma de `mnyValorTotal` dos títulos; ausente se algum título não o trouxe. */
    mnyValorTotal?: number;
    titulos: Array<{ docCod: string; titCod: string }>;
}

/** Linha do `fin064` do documento (I18d: achar o título novo; I18a: estado ao vivo). */
export const TITULO_FIN064_SCHEMA = z
    .object({
        docCod: chave,
        titCod: chave.optional().catch('1'),
        docTip: numOpt,
        pesCodFor: numOpt,
        pesCod: numOpt,
        titEspNumero: strOpt,
        titDtaVencimento: numOpt,
        pgtCod: numOpt,
        dupEspOrdem: strOpt,
        vldLib: numOpt,
        vldPago: numOpt,
        totalLiquido: numOpt,
        totalPago: numOpt,
        totalAberto: numOpt,
        titMnyValor: numOpt,
        titMnyJuros: numOpt,
        titMnyDesconto: numOpt,
    })
    .passthrough();
export type TituloFin064 = z.infer<typeof TITULO_FIN064_SCHEMA>;

/**
 * Situação do bloqueio no `fin103` (`ftbVldStatus`). Medido em HML 2026-10-19: depois do comando
 * APROVAR o bloqueio foi a `2`. Qualquer outro valor é tratado como NÃO liberado (fail-closed).
 */
export const FTB_VLD_STATUS = { LIBERADO: 2 } as const;

/** Linha da Liberação de Títulos (`fin103/list`), schema `FinTituloBloq`. `row` vai VERBATIM. */
export const BLOQUEIO_SCHEMA = z
    .object({
        filCod: numOpt,
        docTip: numOpt,
        docCod: chave,
        titCod: chave,
        fblCod: z.coerce.number().int(),
        ftbCod: numOpt,
        ftbVldStatus: numOpt,
        titMnyTotal: numOpt,
        ftbMnyValorLiberado: numOpt,
        ftbTimBloq: z.unknown().optional(),
    })
    .passthrough();
export interface BloqueioTitulo {
    docCod: string;
    titCod: string;
    fblCod: number;
    ftbCod?: number;
    ftbVldStatus?: number;
    titMnyTotal?: number;
    /** Linha crua do `fin103/list` — o `aplicarComando` a recebe verbatim (+ `fbaCod`). */
    row: Record<string, unknown>;
}

/** Comando da regra de bloqueio (`fin106/finBloqCmd/list/{fblCod}`), schema `FinBloqCmd`. */
export const COMANDO_BLOQUEIO_SCHEMA = z
    .object({
        fblCod: numOpt,
        fbaCod: z.coerce.number().int(),
        fbaDesNome: strOpt,
        fbaVldStatus: numOpt,
        fbaTimCan: z.unknown().optional(),
    })
    .passthrough();
export interface ComandoBloqueio {
    fbaCod: number;
    nome: string;
    /** Não cancelado (`fbaTimCan` vazio) e `fbaVldStatus` 1 ou ausente. A confirmar em G3. */
    ativo: boolean;
}

/** Corpo do `POST fin070` (cabeçalho). Espelha o que funcionou em HML (frnCod 3 e 4). */
export interface CriarRenegociacaoInput {
    filCod: number;
    pesCod: number;
    /** `BankingCalendar.todayBrt` em epoch do ERP (UTC meia-noite). */
    dataRenegEpoch: number;
    /** Observação já com o marcador de correlação; vai em MAIÚSCULA, sem código completo. */
    obs: string;
}

export interface TituloDaRenegociacaoInput {
    filCod: number;
    frnCod: number;
    docTip: number;
    docCod: string;
    titCod: string;
}

export interface ComposicaoInput extends TituloDaRenegociacaoInput {
    /** O MESMO valor aberto do original (reais). */
    valor: number;
    /** O vencimento ORIGINAL, epoch do ERP. */
    vencimentoEpoch: number;
    frgEspNumero?: string;
    pgtCod?: number;
    dupEspOrdem?: string;
}

export interface AjusteRenegociacaoInput {
    filCod: number;
    frnCod: number;
    frnMnyValor: number;
    frnVldTpop: 1 | 2;
}
