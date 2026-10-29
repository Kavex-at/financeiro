import type {
    ChaveBoletoDda,
    ChaveTitulo,
    EmissorBoletoView,
    ResultadoSugestao,
} from './SugestaoBoleto.js';

/**
 * Confirmação em conjunto de títulos irmãos (I15t, ADR-0080): da gaveta de um título, a analista
 * confirma de uma vez os títulos do mesmo credor e filial cujo boleto foi escolhido pela âncora de
 * número (I15s). Cada linha passa pelo MESMO `confirmar` de hoje; o resultado é por linha.
 */

/** I15t(3): teto de linhas por pedido. Constante global de código, ajustável por ADR curta. */
export const CONFIRMACAO_CONJUNTO_MAXIMO = 30;

/** I15t(5): avisos derivados por linha. Nenhum impede a marcação. */
export const AVISO_CONJUNTO = {
    /** 0 < |Δvalor| e Δdias > 0: a I18a(4) não ajusta; a renegociação é manual no Conexos. */
    FAIXA_AJUSTE_MANUAL: 'FAIXA_AJUSTE_MANUAL',
    /** Outro boleto do mesmo emissor, valor e vencimento no pool: só o número desempata. */
    ESCOLHIDO_SO_PELO_NUMERO: 'ESCOLHIDO_SO_PELO_NUMERO',
} as const;
export type AvisoConjunto = (typeof AVISO_CONJUNTO)[keyof typeof AVISO_CONJUNTO];

/** I15t(4): desfecho de uma linha do conjunto. */
export const STATUS_LINHA_CONJUNTO = {
    CONFIRMADA: 'CONFIRMADA',
    JA_CONFIRMADA: 'JA_CONFIRMADA',
    RECUSADA: 'RECUSADA',
} as const;
export type StatusLinhaConjunto =
    (typeof STATUS_LINHA_CONJUNTO)[keyof typeof STATUS_LINHA_CONJUNTO];

/** Chave de uma linha: o título e o boleto escolhido. */
export type ChaveLinhaConjunto = ChaveTitulo & ChaveBoletoDda;

/** Uma linha elegível da gaveta (I15t(1)): o título irmão e o boleto escolhido pela âncora. */
export interface IrmaoConjunto extends ChaveTitulo, ChaveBoletoDda {
    /** O título em que a gaveta foi aberta (sempre a primeira linha quando elegível). */
    origem: boolean;
    numeroDocumento?: string;
    numeroBoleto?: string;
    valorTitulo: number;
    vencimentoTitulo: string;
    valorBoleto: number;
    vencimentoBoleto: string;
    /** boleto − título, em reais, com sinal. */
    deltaValor: number;
    /** vencimento do boleto − vencimento do título, em dias, com sinal. */
    deltaDias: number;
    tier: ResultadoSugestao;
    emissor?: EmissorBoletoView;
    avisos: AvisoConjunto[];
    /** 0 < |Δ| ≤ R$ 0,05 no mesmo dia: o ajuste de centavos de hoje (I18g) deve rodar. */
    ajusteAutomatico: boolean;
}

export interface IrmaosConjunto {
    origem: ChaveTitulo;
    irmaos: IrmaoConjunto[];
    maximo: number;
}

/** Contexto que o conjunto passa a cada `confirmar` (I15t(1), I15t(7)). */
export interface ContextoConjunto {
    id: string;
    origem: ChaveTitulo;
    pesCod: string;
}

export interface ResultadoLinhaConjunto {
    chave: ChaveLinhaConjunto;
    status: StatusLinhaConjunto;
    /** Por que a linha foi recusada (pt-BR); ausente quando confirmou. */
    motivo?: string;
}

export interface ResultadoConjunto {
    conjuntoId: string;
    resultados: ResultadoLinhaConjunto[];
    confirmadas: number;
    recusadas: number;
}
