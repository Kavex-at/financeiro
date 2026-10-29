import type { ValoresAbertoTitulo } from '../../libs/boleto/ValorAbertoLiquido.js';

/**
 * Boleto agrupado no SISPAG — 1 boleto DDA paga N ≥ 2 títulos do mesmo credor (I21, ADR-0077).
 * Ver `ontology/entities/grupo-boleto.md` e `ontology/business-rules/boleto-agrupado-sispag.md`.
 *
 * Valores monetários em CENTAVOS inteiros; datas civis `YYYY-MM-DD` (UTC meia-noite, ADR-0070).
 * O código de barras completo nunca aparece aqui: só a máscara 5+4 (I17j).
 */

/** Estado persistido do grupo. `ANULADO` e `PAGO` são terminais. */
export const GRUPO_BOLETO_ESTADO = {
    CONFIRMADO: 'CONFIRMADO',
    ANULADO: 'ANULADO',
    PAGO: 'PAGO',
} as const;
export type GrupoBoletoEstado = (typeof GRUPO_BOLETO_ESTADO)[keyof typeof GRUPO_BOLETO_ESTADO];

/** Sugestão do sistema confirmada (I21e) ou composição manual da analista (I21g). */
export const GRUPO_BOLETO_ORIGEM = {
    SUGERIDO: 'SUGERIDO',
    MANUAL: 'MANUAL',
} as const;
export type GrupoBoletoOrigem = (typeof GRUPO_BOLETO_ORIGEM)[keyof typeof GRUPO_BOLETO_ORIGEM];

/**
 * Como o grupo foi anulado (I21t): pela analista, ou pelo sistema na cascata da revogação do par
 * (I15l(2)). `sistema` só anula com `PAR_REVOGADO` (CHECK da 0090).
 */
export const GRUPO_BOLETO_TIPO_ANULACAO = {
    MANUAL: 'MANUAL',
    PAR_REVOGADO: 'PAR_REVOGADO',
} as const;
export type GrupoBoletoTipoAnulacao =
    (typeof GRUPO_BOLETO_TIPO_ANULACAO)[keyof typeof GRUPO_BOLETO_TIPO_ANULACAO];

/** Tipos da trilha só-inclusão `sispag_grupo_boleto_evento` (I21i; CHECK da 0090). */
export const GRUPO_BOLETO_EVENTO = {
    GRUPO_CONFIRMADO: 'GRUPO_CONFIRMADO',
    GRUPO_ANULADO: 'GRUPO_ANULADO',
    GRUPO_RETIRADO: 'GRUPO_RETIRADO',
    BORDERO_PREPARADO: 'BORDERO_PREPARADO',
    BORDERO_REAPROVEITADO: 'BORDERO_REAPROVEITADO',
    BORDERO_LIMPO: 'BORDERO_LIMPO',
    GRUPO_PAGO: 'GRUPO_PAGO',
    GRUPO_DIVERGENTE: 'GRUPO_DIVERGENTE',
} as const;
export type GrupoBoletoEvento = (typeof GRUPO_BOLETO_EVENTO)[keyof typeof GRUPO_BOLETO_EVENTO];

/**
 * Por que um grupo (ou um título dele) não é confirmável. Os do grupo vêm da I21a/b/d/h; os do
 * título, da I21c e da janela da I21g. Ordem da lista = precedência de exibição.
 */
export const MOTIVO_GRUPO_INELEGIVEL = {
    // ── forma do grupo (I21a, I21d) ──
    MENOS_DE_DOIS_TITULOS: 'MENOS_DE_DOIS_TITULOS',
    CRUZA_FILIAL: 'CRUZA_FILIAL',
    CREDORES_DIFERENTES: 'CREDORES_DIFERENTES',
    // ── o boleto (I21a, I21b, I21h) ──
    BOLETO_VINCULADO_ERP: 'BOLETO_VINCULADO_ERP',
    /** O boleto já tem `DecisaoSugestaoBoleto CONFIRMADA` para um título (I15q, exclusividade). */
    BOLETO_EM_DECISAO_1_1: 'BOLETO_EM_DECISAO_1_1',
    BOLETO_INDISPONIVEL: 'BOLETO_INDISPONIVEL',
    CODIGO_INVALIDO: 'CODIGO_INVALIDO',
    BOLETO_INCONSISTENTE: 'BOLETO_INCONSISTENTE',
    DATA_INDISPONIVEL: 'DATA_INDISPONIVEL',
    PAR_NAO_VIGENTE: 'PAR_NAO_VIGENTE',
    BOLETO_VENCIDO: 'BOLETO_VENCIDO',
    // ── a soma (I21b) ──
    VALOR_ABERTO_INDISPONIVEL: 'VALOR_ABERTO_INDISPONIVEL',
    SOMA_DIFERENTE: 'SOMA_DIFERENTE',
    // ── cada título (I21c, I21g) ──
    NAO_LIBERADO: 'NAO_LIBERADO',
    PAGO: 'PAGO',
    INATIVO: 'INATIVO',
    FORMA_NAO_BOLETO: 'FORMA_NAO_BOLETO',
    TEM_BOLETO_ERP: 'TEM_BOLETO_ERP',
    DECISAO_1_1_CONFIRMADA: 'DECISAO_1_1_CONFIRMADA',
    MARCA_RETENCAO_ATIVA: 'MARCA_RETENCAO_ATIVA',
    EM_LOTE_COMPROMETIDO: 'EM_LOTE_COMPROMETIDO',
    EM_OUTRO_GRUPO: 'EM_OUTRO_GRUPO',
    FORA_DA_JANELA: 'FORA_DA_JANELA',
} as const;
export type MotivoGrupoInelegivel =
    (typeof MOTIVO_GRUPO_INELEGIVEL)[keyof typeof MOTIVO_GRUPO_INELEGIVEL];

/** Texto ao operador (pt-BR) de cada motivo. `NAO_LIBERADO` é exibido como "aguardando alçada". */
export const MOTIVO_GRUPO_INELEGIVEL_TEXTO: Readonly<Record<MotivoGrupoInelegivel, string>> = {
    MENOS_DE_DOIS_TITULOS: 'um título só segue o caminho de um boleto por título',
    CRUZA_FILIAL: 'os títulos são de filiais diferentes: não suportado, pague à mão',
    CREDORES_DIFERENTES: 'os títulos são de credores diferentes',
    BOLETO_VINCULADO_ERP: 'o Conexos já vinculou o boleto a um título',
    BOLETO_EM_DECISAO_1_1: 'o boleto já está confirmado para um título (um boleto por título)',
    BOLETO_INDISPONIVEL: 'o código de barras do boleto não está disponível',
    CODIGO_INVALIDO: 'o código de barras do boleto é inválido',
    BOLETO_INCONSISTENTE: 'o valor ou o vencimento do código não batem com o DDA',
    DATA_INDISPONIVEL: 'o vencimento não está disponível',
    PAR_NAO_VIGENTE: 'o emissor do boleto não está confirmado para este credor',
    BOLETO_VENCIDO: 'o boleto vence antes da data de débito',
    VALOR_ABERTO_INDISPONIVEL: 'o valor em aberto de algum título não está disponível',
    SOMA_DIFERENTE: 'a soma dos títulos é diferente do valor do boleto',
    NAO_LIBERADO: 'aguardando alçada',
    PAGO: 'o título já está pago',
    INATIVO: 'o título saiu da carteira',
    FORMA_NAO_BOLETO: 'o título não é pago por boleto no Conexos',
    TEM_BOLETO_ERP: 'o Conexos já associou um boleto DDA ao título',
    DECISAO_1_1_CONFIRMADA: 'o título já tem um boleto confirmado',
    MARCA_RETENCAO_ATIVA: 'o título está retido (marca de duplicidade ou retirada ativa)',
    EM_LOTE_COMPROMETIDO: 'o título está em lote finalizado ou com remessa gerada',
    EM_OUTRO_GRUPO: 'o título já está em outro grupo confirmado',
    FORA_DA_JANELA: 'o título vence fora da janela do boleto',
};

/** Avisos que exigem reconhecimento validado no servidor (I21g, PI-2; padrão I15o). */
export const AVISO_GRUPO = {
    TITULO_VENCE_ANTES_DO_BOLETO: 'TITULO_VENCE_ANTES_DO_BOLETO',
} as const;
export type AvisoGrupo = (typeof AVISO_GRUPO)[keyof typeof AVISO_GRUPO];

/** Por que um grupo `CONFIRMADO` ficou órfão (I21u). Ordem = precedência. */
export const MOTIVO_GRUPO_ORFAO = {
    BOLETO_FORA_DO_POOL: 'BOLETO_FORA_DO_POOL',
    BOLETO_VINCULADO_ERP: 'BOLETO_VINCULADO_ERP',
    TITULO_PAGO: 'TITULO_PAGO',
    TITULO_INATIVO: 'TITULO_INATIVO',
    TITULO_COM_DDA_ERP: 'TITULO_COM_DDA_ERP',
    VALOR_LIQUIDO_DIVERGENTE: 'VALOR_LIQUIDO_DIVERGENTE',
} as const;
export type MotivoGrupoOrfao = (typeof MOTIVO_GRUPO_ORFAO)[keyof typeof MOTIVO_GRUPO_ORFAO];

export interface ChaveTituloGrupo {
    filCod: number;
    docCod: string;
    titCod: string;
}

/** Título de um grupo: snapshot da confirmação (I21b/c), relido ao vivo na remessa. */
export interface GrupoBoletoTitulo extends ChaveTituloGrupo {
    valorLiquidoCentavos: number;
    /** Data civil `YYYY-MM-DD`. */
    vencimento: string;
}

/** Registro persistido de que uma pessoa confirmou 1 boleto ↔ N títulos (I21i). */
export interface GrupoBoleto {
    id: string;
    filCod: number;
    pesCod: string;
    credor?: string;
    emissorChave: string;
    ddcCod: number;
    ditCod: number;
    numeroBoleto?: string;
    /** Máscara 5+4 (I16e/I17j). Nunca o código. */
    codbarMascarado: string;
    valorBoletoCentavos: number;
    /** Data civil; é a que vale para a formação automática e para L6 (I21j, PI-8). */
    vencimentoBoleto: string;
    titulos: GrupoBoletoTitulo[];
    somaTitulosCentavos: number;
    origem: GrupoBoletoOrigem;
    intercambiavel: boolean;
    avisosReconhecidos: AvisoGrupo[];
    confirmacaoEmissorId?: string;
    estado: GrupoBoletoEstado;
    confirmadoPor: string;
    confirmadoEm: Date;
    anuladoPor?: string;
    anuladoEm?: Date;
    motivoAnulacao?: string;
    tipoAnulacao?: GrupoBoletoTipoAnulacao;
    pagoObservadoEm?: Date;
    versao: number;
}

/** Entrada de `GrupoBoletoRepository.inserirConfirmado` (o serviço já validou I21a–d/h). */
export interface NovoGrupoBoleto {
    filCod: number;
    pesCod: string;
    credor?: string;
    emissorChave: string;
    ddcCod: number;
    ditCod: number;
    numeroBoleto?: string;
    codbarMascarado: string;
    valorBoletoCentavos: number;
    vencimentoBoleto: string;
    titulos: GrupoBoletoTitulo[];
    origem: GrupoBoletoOrigem;
    intercambiavel: boolean;
    avisosReconhecidos: AvisoGrupo[];
    confirmacaoEmissorId: string;
    confirmadoPor: string;
}

/** Linha da trilha só-inclusão do grupo (I21i). */
export interface GrupoBoletoEventoRegistro {
    id: string;
    grupoId: string;
    tipo: GrupoBoletoEvento;
    ator: string;
    ocorridoEm: Date;
    filCod?: number;
    loteId?: string;
    execucaoId?: string;
    borCod?: number;
    ddcCod?: number;
    ditCod?: number;
    codigoMascarado?: string;
    dados?: Record<string, unknown>;
}

/** Desfecho de uma transição de estado do grupo no repositório (o serviço decide o erro). */
export const RESULTADO_TRANSICAO_GRUPO = {
    APLICADO: 'APLICADO',
    /** Já estava no estado pedido (idempotência). */
    JA_APLICADO: 'JA_APLICADO',
    /** O estado atual não admite a transição (ex.: anular um grupo `PAGO`). */
    RECUSADO: 'RECUSADO',
    NAO_ENCONTRADO: 'NAO_ENCONTRADO',
} as const;
export type ResultadoTransicaoGrupo =
    (typeof RESULTADO_TRANSICAO_GRUPO)[keyof typeof RESULTADO_TRANSICAO_GRUPO];

// ── Entrada e saída da regra pura (RegraGrupoBoleto) ─────────────────────────────────────────

/** Título candidato a grupo, já com o que a I21c precisa saber (o serviço resolve as fontes). */
export interface TituloGrupoEntrada extends ChaveTituloGrupo {
    pesCod?: string;
    /** Data civil `YYYY-MM-DD`; ausente ⇒ `DATA_INDISPONIVEL`. */
    vencimento?: string;
    liberado: boolean;
    pago: boolean;
    ativo: boolean;
    formaPagamentoConexos?: number;
    /** O ERP já associou boleto DDA ao título (`tem_boleto`). */
    temBoleto?: boolean;
    /**
     * Valores que formam o líquido aberto (I17b). Na confirmação e na remessa, lidos ao vivo no
     * `fin064`; na sugestão, a tupla local `ValorAbertoLiquido.semAcrescimos(valor)` (G1).
     */
    aberto?: ValoresAbertoTitulo;
    /** Tem `DecisaoSugestaoBoleto CONFIRMADA` (I15q). */
    decisaoConfirmada: boolean;
    /** Tem `BloqueioDuplicidade ATIVO`, de qualquer origem (inclusive `GRUPO_BOLETO`). */
    marcaRetencaoAtiva: boolean;
    /** Está em lote `FINALIZADO`/`REMESSA_GERADA` (ADR-0064). */
    emLoteComprometido: boolean;
    /** Id do grupo `CONFIRMADO` em que o título já está, se houver. */
    grupoConfirmadoId?: string;
}

/** O boleto do pool DDA. O código vive só em memória e morre na regra. */
export interface BoletoGrupoEntrada {
    ddcCod: number;
    ditCod: number;
    /** Barras (44) ou linha digitável (47). */
    codigo?: string;
    /** Valor/vencimento do pool — conferidos contra o que o código decodifica. */
    poolValor?: number;
    poolVencimento?: string;
    /** Vínculo gravado pelo ERP; todos presentes = boleto não livre. */
    filCod?: number;
    docCod?: string;
    titCod?: string;
}

export interface EntradaAvaliacaoGrupo {
    origem: GrupoBoletoOrigem;
    boleto: BoletoGrupoEntrada;
    titulos: TituloGrupoEntrada[];
    /** Par (`pesCod`, `emissorChave`) `VIGENTE`. */
    parVigente: boolean;
    /** O par pode ser confirmado no mesmo ato, pela mesma pessoa (I15g, P1-3). */
    parConfirmavelNoAto: boolean;
    /** Data de débito do lote; sem lote, vale o vencimento do boleto (I21h). */
    dataDebito?: string;
    /** Id do grupo reavaliado (não conta como "outro grupo"). */
    grupoId?: string;
}

export interface AvaliacaoTituloGrupo extends ChaveTituloGrupo {
    motivos: MotivoGrupoInelegivel[];
    valorLiquidoCentavos?: number;
    /** Vencimento do boleto − vencimento do título, em dias civis. */
    deltaDias?: number;
}

export interface AvaliacaoGrupo {
    confirmavel: boolean;
    /** Primeiro motivo pela precedência (do grupo, senão do primeiro título com motivo). */
    motivo?: MotivoGrupoInelegivel;
    /** Todos os motivos (grupo ∪ títulos), sem repetição, em ordem de precedência. */
    motivos: MotivoGrupoInelegivel[];
    /** Só os motivos do grupo como um todo. */
    motivosGrupo: MotivoGrupoInelegivel[];
    titulos: AvaliacaoTituloGrupo[];
    /** Avisos que exigem reconhecimento (I21g). */
    avisos: AvisoGrupo[];
    valorBoletoCentavos?: number;
    somaTitulosCentavos?: number;
    /** Boleto − soma, em centavos (com sinal). */
    deltaCentavos?: number;
    vencimentoBoleto?: string;
    codigoMascarado?: string;
    banco?: string;
    emissorChave?: string;
}

/** O que se sabe ao vivo de um grupo confirmado, para a I21u. */
export interface EstadoVivoGrupo {
    /** O boleto no pool agora; ausente = saiu do pool. */
    boleto?: { filCod?: number; docCod?: string; titCod?: string };
    /** Os títulos na carteira agora; título ausente = saiu da carteira (inativo). */
    titulos: Array<
        ChaveTituloGrupo & {
            pago: boolean;
            ativo: boolean;
            temBoleto?: boolean;
            /** Líquido aberto agora, se lido; ausente = não conferido (não acusa órfão). */
            liquidoCentavos?: number;
        }
    >;
}

export interface ResultadoOrfao {
    orfao: boolean;
    motivo?: MotivoGrupoOrfao;
    titulo?: ChaveTituloGrupo;
}

// ── Saída do motor de sugestão (MotorGrupoBoleto) ────────────────────────────────────────────

/** Título de uma sugestão de grupo: a avaliação da regra + o que a tela mostra. */
export interface TituloSugestaoGrupo extends AvaliacaoTituloGrupo {
    /** `valor` local da carteira, em centavos (G1: a sugestão não lê o Conexos). */
    valorCentavos: number;
    vencimento: string;
}

/**
 * Sugestão de grupo fechado no mesmo vencimento (I21e) — calculada, NUNCA persistida (I-DDA1).
 * Exibir ≠ confirmar: um conjunto fechado com título que falha a I21c aparece com o motivo e
 * `confirmavel = false` (PI-7). A analista confirma cada grupo, inclusive os intercambiáveis.
 */
export interface SugestaoGrupoBoleto {
    filCod: number;
    pesCod: string;
    credor?: string;
    ddcCod: number;
    ditCod: number;
    numeroBoleto?: string;
    codbarMascarado?: string;
    emissorChave?: string;
    valorBoletoCentavos: number;
    vencimentoBoleto: string;
    somaTitulosCentavos?: number;
    titulos: TituloSugestaoGrupo[];
    /** Partição fixa entre K boletos iguais e títulos de mesmo valor (I21f). */
    intercambiavel: boolean;
    parVigente: boolean;
    confirmavel: boolean;
    motivo?: MotivoGrupoInelegivel;
    motivos: MotivoGrupoInelegivel[];
    /**
     * Avisos que exigem reconhecimento antes de confirmar (I21i, I21g). A tela os mostra e os
     * devolve em `reconheceAvisos`; o servidor os confere de novo. Hoje só a composição manual os
     * gera (a sugestão é do mesmo vencimento), mas o contrato é o mesmo.
     */
    avisos: AvisoGrupo[];
}

// ── Entrada e saída do serviço (GrupoBoletoService) ──────────────────────────────────────────

/** `confirmarGrupoBoleto` (I21i): o ator vem do JWT, nunca do corpo; nunca `sistema`. */
export interface EntradaConfirmarGrupo {
    origem: GrupoBoletoOrigem;
    ddcCod: number;
    ditCod: number;
    titulos: ChaveTituloGrupo[];
    /** Avisos que a pessoa reconheceu na tela (conferidos contra a avaliação recalculada). */
    reconheceAvisos?: string[];
    ator: string;
}

export interface ResultadoConfirmacaoGrupo {
    /** `false` = o mesmo (boleto, títulos) já estava confirmado (idempotência): nada gravado. */
    criado: boolean;
    grupo: GrupoBoleto;
}

/** Grupo num lote comprometido (`FINALIZADO`/`REMESSA_GERADA`) no momento da anulação (I21t). */
export interface AvisoLoteComprometidoGrupo {
    loteId: string;
    status: string;
    /** Texto ao operador (pt-BR): a próxima geração de remessa retira o grupo. */
    mensagem: string;
}

export interface ResultadoAnulacaoGrupo {
    /** `false` = o grupo já estava `ANULADO` (idempotência): nada gravado. */
    anulado: boolean;
    grupo: GrupoBoleto;
    /** Lote `RASCUNHO` de onde os N itens saíram na mesma transação (PI-6). */
    retiradoDoLoteId?: string;
    avisoLoteComprometido?: AvisoLoteComprometidoGrupo;
}

/** Grupo como a listagem o devolve: estado persistido + situação derivada + órfão (I21u). */
export interface GrupoBoletoListado extends GrupoBoleto {
    /** `SituacaoGrupo` (`libs/boleto/SituacaoGrupoBoleto.ts`), recalculada a cada leitura. */
    situacao: string;
    orfao: ResultadoOrfao;
    loteId?: string;
    loteStatus?: string;
}
