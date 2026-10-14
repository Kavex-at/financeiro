/**
 * Sugestão e confirmação de boleto DDA (ADR-0068, I15). Ver
 * `ontology/business-rules/sugestao-boleto-dda-sispag.md`.
 *
 * Passo 1: mostrar ao analista o boleto livre do `fin124` que provavelmente é o do título e
 * registrar a decisão dele por (credor `pesCod`, emissor `emissorChave`). Confirmação é EVIDÊNCIA,
 * não autoridade (I15a): nada aqui escreve no Conexos.
 */

/**
 * Como a chave do emissor foi derivada do código de barras. Só 341 e 237 têm layout verificado
 * (medido em PRD 2026-10-14: 244 de 290 candidatos únicos, 84 %); os demais usam a chave genérica
 * e NUNCA são elegíveis a automático (I15i).
 */
export const LAYOUT_EMISSOR = {
    ITAU_341: 'ITAU_341',
    BRADESCO_237: 'BRADESCO_237',
    GENERICO: 'GENERICO',
} as const;
export type LayoutEmissor = (typeof LAYOUT_EMISSOR)[keyof typeof LAYOUT_EMISSOR];

/**
 * Conta emissora do boleto, derivada do código de barras de 44 dígitos.
 * `chave` e `mascarado` nunca contêm as barras completas nem a linha digitável (I15k).
 */
export interface EmissorBoleto {
    /** Código FEBRABAN do banco emissor (3 dígitos). */
    banco: string;
    layout: LayoutEmissor;
    /** `341:<agência>:<conta>`, `237:<agência>:<conta>` ou `<banco>:<8 dígitos do campo livre>`. */
    chave: string;
    /** Exibição: banco e agência completos, conta com os 4 últimos dígitos (padrão I14l). */
    mascarado: string;
}

/**
 * Tiers da sugestão, do mais ao menos forte (I15c):
 * - CONHECIDO: par (pesCod, emissorChave) VIGENTE e dentro dos limites globais;
 * - FORTE:     dentro dos limites globais, candidato único nos dois sentidos;
 * - ATENCAO:   fora dos limites globais — mostrada com a diferença com sinal, nunca como segura.
 */
export const TIER_SUGESTAO = {
    CONHECIDO: 'CONHECIDO',
    FORTE: 'FORTE',
    ATENCAO: 'ATENCAO',
} as const;
export type TierSugestao = (typeof TIER_SUGESTAO)[keyof typeof TIER_SUGESTAO];

/** Resultado da avaliação de um par título × boleto: um tier, ou um dos dois não-tiers. */
export const RESULTADO_SUGESTAO = {
    ...TIER_SUGESTAO,
    /** Boleto que vence antes da data de débito (I15h): só informação, nunca confirmável. */
    VENCIDO_INFORMATIVO: 'VENCIDO_INFORMATIVO',
    /** Fora do envelope de plausibilidade: não é candidato. */
    SEM_RELACAO: 'SEM_RELACAO',
} as const;
export type ResultadoSugestao = (typeof RESULTADO_SUGESTAO)[keyof typeof RESULTADO_SUGESTAO];

/** Sinais de evidência exibidos e gravados com a decisão. */
export const SINAL_SUGESTAO = {
    VALOR_IGUAL: 'VALOR_IGUAL',
    VALOR_ATE_5_CENTAVOS: 'VALOR_ATE_5_CENTAVOS',
    MESMO_DIA: 'MESMO_DIA',
    DIAS_DEPOIS: 'DIAS_DEPOIS',
    NUMERO_IGUAL: 'NUMERO_IGUAL',
    /** Número igual com valor/data fora dos limites (I15f): não sobe o tier. */
    COLISAO_NUMERO: 'COLISAO_NUMERO',
    EMISSOR_CONFIRMADO: 'EMISSOR_CONFIRMADO',
} as const;
export type SinalSugestao = (typeof SINAL_SUGESTAO)[keyof typeof SINAL_SUGESTAO];

/** Lado do título na avaliação. Datas civis `YYYY-MM-DD`, valores em reais. */
export interface TituloParaSugestao {
    valor: number;
    vencimento: string;
    /** `doc_esp_numero` do fornecedor. */
    numeroDocumento?: string;
}

/** Lado do boleto na avaliação. */
export interface BoletoParaSugestao {
    valor: number;
    vencimento: string;
    numero?: string;
}

export interface AvaliacaoSugestaoEntrada {
    titulo: TituloParaSugestao;
    boleto: BoletoParaSugestao;
    /** Data de débito: a do lote quando existe (I8); sem lote, o vencimento do título (Q-C). */
    dataDebito: string;
    /** Há par `VIGENTE` para (pesCod, emissorChave) deste boleto. */
    parConfirmado: boolean;
}

export interface AvaliacaoSugestao {
    resultado: ResultadoSugestao;
    /** boleto − título, em reais (2 casas). */
    deltaValor: number;
    /** (boleto − título) / título × 100, com sinal. */
    deltaPercentual: number;
    /** vencimento do boleto − vencimento do título, em dias, com sinal. */
    deltaDias: number;
    sinais: SinalSugestao[];
    /** Só os três tiers são confirmáveis; vencido e sem relação não. */
    confirmavel: boolean;
}

/** Chave de um boleto do pool `fin124`. */
export interface ChaveBoletoDda {
    ddcCod: number;
    ditCod: number;
}

/** Decisão por título já registrada (a chave do título + a do boleto). */
export interface DecisaoChaveada extends ChaveBoletoDda {
    filCod: number;
    docCod: string;
    titCod: string;
}

/**
 * Decisão `CONFIRMADA` com o snapshot que a gravou. O motor usa o snapshot só para mostrar uma
 * confirmação ÓRFÃ (boleto que saiu do pool, título sinalizado pelo ERP) com o que foi decidido
 * (I15l); os campos são opcionais porque os chamadores que só têm a chave continuam válidos.
 */
export interface DecisaoConfirmadaChaveada extends DecisaoChaveada {
    numeroBoleto?: string;
    valorTitulo?: number;
    vencimentoTitulo?: string;
    valorBoleto?: number;
    vencimentoBoleto?: string;
    deltaValor?: number;
    deltaPercentual?: number;
    deltaDias?: number;
    sinais?: SinalSugestao[];
    tier?: TierSugestao;
}

/** Par (credor, emissor) `VIGENTE`. */
export interface ParVigenteChave {
    pesCod: string;
    emissorChave: string;
}

/** Estado da sugestão devolvida para um título. */
export const ESTADO_SUGESTAO = {
    /** Proposta pelo motor; nenhuma decisão registrada. */
    SUGERIDA: 'SUGERIDA',
    /** O analista já a confirmou (decisão `CONFIRMADA` ativa). */
    CONFIRMADA: 'CONFIRMADA',
} as const;
export type EstadoSugestao = (typeof ESTADO_SUGESTAO)[keyof typeof ESTADO_SUGESTAO];

/**
 * Sugestão por título (I15c). NUNCA carrega as barras nem a linha digitável: o emissor sai
 * mascarado e a linha só é obtida pelo endpoint de cópia, auditado (I15k).
 */
export interface SugestaoBoletoTitulo {
    filCod: number;
    docCod: string;
    titCod: string;
    pesCod?: string;
    credor?: string;
    valorTitulo: number;
    /** Data civil `YYYY-MM-DD`. */
    vencimentoTitulo: string;
    /** Data de débito considerada: a do lote (I8) ou, sem lote, o vencimento do título (Q-C). */
    dataDebito: string;
    ddcCod: number;
    ditCod: number;
    numeroBoleto?: string;
    valorBoleto: number;
    vencimentoBoleto: string;
    emissor?: EmissorBoleto;
    avaliacao: AvaliacaoSugestao;
    estado: EstadoSugestao;
    /** Motivo legível (pt-BR) quando a sugestão é só informativa. */
    motivo?: string;
    /**
     * Confirmação ÓRFÃ (I15l): a decisão `CONFIRMADA` segue ativa, mas o boleto deixou de estar
     * livre no pool (ou o ERP já sinalizou o título). Não é confirmável; a tela oferece "Anular".
     */
    orfa?: boolean;
    /** Por que a confirmação ficou órfã (pt-BR). */
    motivoOrfa?: string;
}

/** Emissor como a API o expõe: só a máscara (a chave carrega a conta completa). */
export interface EmissorBoletoView {
    banco: string;
    layout: LayoutEmissor;
    mascarado: string;
}

/**
 * Sugestão como a API a devolve (`sispag:ver`): emissor MASCARADO, sem barras e sem linha digitável
 * (I15k). A linha só sai pelo endpoint de cópia, auditado.
 */
export type SugestaoBoletoView = Omit<SugestaoBoletoTitulo, 'emissor'> & {
    emissor?: EmissorBoletoView;
    /** Só uma sugestão ainda não decidida e dentro dos três tiers pode ser confirmada. */
    confirmavel: boolean;
    /** Par (credor, emissor) vigente do boleto, quando existe — para revogar pela tela. */
    confirmacaoEmissorId?: string;
};

export interface FiltroSugestoes {
    filCod?: number;
    pesCod?: string;
    tier?: ResultadoSugestao;
    pagina?: number;
    tamanho?: number;
}

export interface ListagemSugestoes {
    sugestoes: SugestaoBoletoView[];
    total: number;
    pagina: number;
    tamanho: number;
    /** Contagem por resultado, sobre o conjunto filtrado por filial/credor (antes do `tier`). */
    contagem: Record<ResultadoSugestao, number>;
    /** epoch ms da última sincronização do DDA; ausente = nunca sincronizado (ADR-0067). */
    sincronizadoEm?: number;
    /** Horas de defasagem do DDA quando passou de 8 h em dia útil; ausente = em dia (ADR-0067). */
    ddaDefasadoHoras?: number;
}

export const SUGESTAO_TAMANHO_PADRAO = 50;
export const SUGESTAO_TAMANHO_MAXIMO = 100;
/** Horas sem sincronizar o DDA, em dia útil, a partir das quais a tela avisa (ADR-0067). */
export const DDA_DEFASADO_HORAS = 8;
