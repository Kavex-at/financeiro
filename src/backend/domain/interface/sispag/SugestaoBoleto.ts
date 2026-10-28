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
    /**
     * O boleto vence ANTES do título (Δdias < 0) dentro do envelope (I15o, ADR-0072). Aviso derivado:
     * não altera tier, deltas nem `confirmavel`; confirmar exige o reconhecimento do analista.
     */
    VENCE_ANTES_DO_TITULO: 'VENCE_ANTES_DO_TITULO',
    /** Gravado no snapshot da decisão quando o analista reconheceu `VENCE_ANTES_DO_TITULO`. */
    RECONHECEU_VENCE_ANTES: 'RECONHECEU_VENCE_ANTES',
    /**
     * Gravado no snapshot da decisão quando a analista deu o reconhecimento TIPADO da divergência
     * de data (I15r, ADR-0078). Informativo: a prova é a propriedade `reconhecimento` da decisão.
     */
    DATA_DIVERGENTE_RECONHECIDA: 'DATA_DIVERGENTE_RECONHECIDA',
    /**
     * Âncora DPS direta (I15p(1), ADR-0073): o número do boleto é o DPS do título, lido do PDF da
     * NFS-e, seguido de `000`. Âncora como `NUMERO_IGUAL`: não sobe tier nem alarga limite.
     */
    DPS_IGUAL: 'DPS_IGUAL',
    /**
     * Âncora DPS por ordem (I15p(2), ADR-0073): no escopo (credor, emissor) provado por um DPS lido,
     * o k-ésimo título por NFS-e casa com o k-ésimo boleto por número. Não sobe tier.
     */
    ORDEM_DPS: 'ORDEM_DPS',
    /**
     * Âncora de número (I15s, ADR-0079): o número do documento é igual ao do boleto dentro do
     * envelope FORTE e sem nenhuma duplicata (pool, títulos do credor, candidatos). Sempre junto de
     * `NUMERO_IGUAL`. Prova de identidade como o DPS: não sobe tier nem alarga limite.
     */
    NUMERO_CONFIAVEL: 'NUMERO_CONFIAVEL',
} as const;
export type SinalSugestao = (typeof SINAL_SUGESTAO)[keyof typeof SINAL_SUGESTAO];

/** Lado do título na avaliação. Datas civis `YYYY-MM-DD`, valores em reais. */
export interface TituloParaSugestao {
    valor: number;
    vencimento: string;
    /** `doc_esp_numero` do fornecedor. */
    numeroDocumento?: string;
    /** Número da DPS lido do PDF da NFS-e (`titulo_dps`, I15p). */
    dps?: string;
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
    /** O par foi casado pela ordem de DPS do escopo (I15p(2)), calculada fora da regra. */
    ordemDps?: boolean;
}

/**
 * Reconhecimento exigido para confirmar (I15m/I15r, ADR-0078): derivado por candidato, nunca estado
 * nem persistido. `DATA_DIVERGENTE` = valor igual em centavos com Δdias ∈ [-10,-1] ∪ [6,10] e boleto
 * ainda vigente na data de débito.
 */
export const EXIGE_RECONHECIMENTO = {
    NENHUM: 'NENHUM',
    DATA_DIVERGENTE: 'DATA_DIVERGENTE',
} as const;
export type ExigeReconhecimento = (typeof EXIGE_RECONHECIMENTO)[keyof typeof EXIGE_RECONHECIMENTO];

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
    /**
     * Dias em que o boleto já estará vencido na data de débito (`débito − vencimento do boleto`,
     * ≥ 0). DERIVADO, nunca persistido (I15o): 0 quando o boleto ainda vale no débito.
     */
    diasVencidoNoDebito: number;
    /** Vencimento da barra rolado ao próximo dia útil bancário (I15h, ADR-0078). Ausente se a data é inválida. */
    prazoFinalBoleto?: string;
    /** Reconhecimento que a confirmação deste par exige (I15r). Derivado, nunca persistido. */
    exigeReconhecimento: ExigeReconhecimento;
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
    /** Autor humano da confirmação (herdado na transferência, ADR-0074 M1). */
    decididoPor?: string;
    /** `sistema` quando a decisão foi transferida ao título renegociado (ADR-0074 M1). */
    transferidaPor?: string;
    /**
     * O que a analista viu ao reconhecer a divergência de data (I15r, ADR-0078): o motor o confere
     * com o Δdias e o valor de AGORA e, se mudaram, mostra a decisão como órfã. Valor em centavos.
     */
    reconhecimento?: { deltaDiasVisto: number; valorBoletoVisto: number };
}

/** Par (credor, emissor) `VIGENTE`. */
export interface ParVigenteChave {
    pesCod: string;
    emissorChave: string;
}

/**
 * DPS conhecido de um título (`titulo_dps` com status `LIDO`, I15p). Guarda credor e NFS-e para
 * provar o escopo mesmo depois que o título sai da carteira.
 */
export interface DpsConhecido {
    filCod: number;
    docCod: string;
    titCod: string;
    pesCod?: string;
    /** Nº da NFS-e lido do PDF (cai para `doc_esp_numero` quando o PDF não traz). */
    nfse?: string;
    dps: string;
}

/** `motivoOrfa` quando o reconhecimento tipado deixa de valer (I15r/I19i, ADR-0078). */
export const MOTIVO_ORFA_RECONHECIMENTO_INVALIDADO =
    'Reconhecimento de data divergente invalidado: o vencimento do título ou o valor do boleto mudaram depois da confirmação. Anule a confirmação e confirme de novo com um novo reconhecimento.';

/**
 * Número do documento de um título de QUALQUER situação (ativo ou não), para a guarda de duplicata
 * da âncora de número (I15s). Só o que a guarda lê.
 */
export interface TituloNumeroDocumento {
    filCod: number;
    docCod: string;
    titCod: string;
    pesCod?: string;
    numeroDocumento?: string;
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
    /**
     * Nº do documento do fornecedor (`doc_esp_numero`) — o que a âncora de número (I15s) compara
     * com o nº do boleto. Exposto para a tela conferir a âncora sem abrir o Conexos.
     */
    numeroDocumento?: string;
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
    /** CONFIRMADA: autor humano (herdado na transferência, ADR-0074 M1). */
    decididoPor?: string;
    /** CONFIRMADA transferida ao título renegociado: `sistema` (ADR-0074 M1). */
    transferidaPor?: string;
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

/**
 * Desfecho de um título elegível (I15m, ADR-0072): derivado, nunca persistido, calculado pelo
 * motor a cada cenário. Todo título elegível tem exatamente um.
 *
 * - `UNICA_SEGURA`  um boleto CONHECIDO/FORTE sem rival: confirmável;
 * - `SO_ATENCAO`    melhor candidato livre é ATENCAO com âncora (emissor ou número): confirmável;
 * - `AMBIGUA`       2+ seguros de mesma força: exibidos, não confirmáveis (rejeite os outros);
 * - `SO_FRACA`      só ATENCAO sem âncora: exibido, não confirmável;
 * - `SO_VENCIDA`    só boleto vencido na data de débito: informativo (I15h);
 * - `DISPUTADA`     o melhor candidato está reservado a outro título (I15n);
 * - `SEM_CANDIDATO` nenhum boleto livre dentro do envelope (I15f);
 * - `CONFIRMADA`    decisão ativa do analista; `ORFA` confirmação que perdeu o boleto/título (I15l);
 * - `EM_GRUPO`      o título está num `GrupoBoleto CONFIRMADO` (I15q, ADR-0077): um boleto paga
 *                   este e outros títulos do credor; nunca confirmável no 1:1.
 */
export const SITUACAO_SUGESTAO_TITULO = {
    UNICA_SEGURA: 'UNICA_SEGURA',
    AMBIGUA: 'AMBIGUA',
    SO_ATENCAO: 'SO_ATENCAO',
    SO_FRACA: 'SO_FRACA',
    SO_VENCIDA: 'SO_VENCIDA',
    DISPUTADA: 'DISPUTADA',
    SEM_CANDIDATO: 'SEM_CANDIDATO',
    CONFIRMADA: 'CONFIRMADA',
    ORFA: 'ORFA',
    EM_GRUPO: 'EM_GRUPO',
} as const;
export type SituacaoSugestaoTitulo =
    (typeof SITUACAO_SUGESTAO_TITULO)[keyof typeof SITUACAO_SUGESTAO_TITULO];

/** Limite de EXIBIÇÃO de candidatos por título — não é regra de domínio. */
export const SUGESTAO_TOP_CANDIDATOS = 3;

/**
 * Gravidade do aviso `VENCE_ANTES_DO_TITULO` do melhor candidato: `ATENCAO` = o boleto ainda vale
 * na data de débito (confirmar exige reconhecimento); `CRITICO` = já estará vencido no débito
 * (I15h: só informativo).
 */
export const AVISO_VENCE_ANTES = {
    NENHUM: 'NENHUM',
    ATENCAO: 'ATENCAO',
    CRITICO: 'CRITICO',
} as const;
export type AvisoVenceAntes = (typeof AVISO_VENCE_ANTES)[keyof typeof AVISO_VENCE_ANTES];

export interface ChaveTitulo {
    filCod: number;
    docCod: string;
    titCod: string;
}

/** Um boleto candidato de um título, com a avaliação do par e o que impede a confirmação. */
export interface CandidatoTitulo {
    ddcCod: number;
    ditCod: number;
    numeroBoleto?: string;
    valorBoleto: number;
    vencimentoBoleto: string;
    emissor?: EmissorBoleto;
    avaliacao: AvaliacaoSugestao;
    /** Emissor confirmado (par vigente) OU número do documento igual. */
    ancorado: boolean;
    /** Só o candidato escolhido (`UNICA_SEGURA`/`SO_ATENCAO`) é confirmável. */
    confirmavel: boolean;
    /** Boleto exibido em mais de um título sem reserva (fraco/vencido não reservam). */
    compartilhado?: boolean;
    /** O boleto está reservado ao título indicado (disputa, I15e/I15n). */
    reservadoParaTitulo?: ChaveTitulo;
    /** Por que não é confirmável (pt-BR); ausente quando confirmável. */
    motivo?: string;
    /** CONFIRMADA: autor humano (herdado na transferência, ADR-0074 M1). */
    decididoPor?: string;
    /** CONFIRMADA transferida ao título renegociado: `sistema` (ADR-0074 M1). */
    transferidaPor?: string;
}

/** Desfecho por título: até `SUGESTAO_TOP_CANDIDATOS` candidatos, ranqueados. */
export interface DesfechoTitulo extends ChaveTitulo {
    pesCod?: string;
    credor?: string;
    /**
     * Nº do documento do fornecedor (`doc_esp_numero`) — o que a âncora de número (I15s) compara
     * com o nº do boleto. Exposto para a tela conferir a âncora sem abrir o Conexos.
     */
    numeroDocumento?: string;
    valorTitulo: number;
    vencimentoTitulo: string;
    dataDebito: string;
    situacao: SituacaoSugestaoTitulo;
    candidatos: CandidatoTitulo[];
    /** Candidatos dentro do envelope (antes do corte de exibição). */
    totalCandidatos: number;
    motivo: string;
    /** Confirmação órfã (I15l): motivo da perda do boleto/título. */
    motivoOrfa?: string;
    /** `EM_GRUPO` (I15q): o `GrupoBoleto CONFIRMADO` que contém o título. */
    grupoBoletoId?: string;
}

/** Candidato como a API o expõe: emissor MASCARADO, sem barras nem linha digitável (I15k). */
export type CandidatoTituloView = Omit<CandidatoTitulo, 'emissor'> & {
    emissor?: EmissorBoletoView;
    /** Par (credor, emissor) vigente do boleto, quando existe — para revogar pela tela. */
    confirmacaoEmissorId?: string;
};

export type DesfechoTituloView = Omit<DesfechoTitulo, 'candidatos'> & {
    candidatos: CandidatoTituloView[];
    avisoVenceAntes: AvisoVenceAntes;
    /** Dias vencido na data de débito do melhor candidato (0 quando não há). */
    diasVencidoNoDebito: number;
};

export interface FiltroSugestoes {
    filCod?: number;
    pesCod?: string;
    tier?: ResultadoSugestao;
    situacao?: SituacaoSugestaoTitulo;
    pagina?: number;
    tamanho?: number;
}

export interface ListagemSugestoes {
    sugestoes: SugestaoBoletoView[];
    /** Uma linha por título elegível (I15m): o desfecho e o melhor candidato. */
    titulos: DesfechoTituloView[];
    /** Títulos do conjunto filtrado (antes da paginação); `total` segue contando `sugestoes`. */
    totalTitulos: number;
    total: number;
    pagina: number;
    tamanho: number;
    /** Contagem por resultado, sobre o conjunto filtrado por filial/credor (antes do `tier`). */
    contagem: Record<ResultadoSugestao, number>;
    /** Contagem por situação do título, sobre o conjunto filtrado por filial/credor. */
    contagemSituacao: Record<SituacaoSugestaoTitulo, number>;
    /** epoch ms da última sincronização do DDA; ausente = nunca sincronizado (ADR-0067). */
    sincronizadoEm?: number;
    /** Horas de defasagem do DDA quando passou de 8 h em dia útil; ausente = em dia (ADR-0067). */
    ddaDefasadoHoras?: number;
}

export const SUGESTAO_TAMANHO_PADRAO = 50;
/**
 * Teto de uma página. A tela busca tudo numa chamada só (o cenário vem do cache em processo), então
 * o teto cobre a carteira real (~1,1 mil títulos); acima disso a tela avisa que está truncado.
 */
export const SUGESTAO_TAMANHO_MAXIMO = 2000;
/** Horas sem sincronizar o DDA, em dia útil, a partir das quais a tela avisa (ADR-0067). */
export const DDA_DEFASADO_HORAS = 8;
