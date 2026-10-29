import type { ChaveTitulo } from './SispagInterface.js';

/**
 * Situação de pagamento do título (ADR-0075, regra `situacao-pagamento-titulo`).
 *
 * CONTRATO entre backend e frontend: o backend calcula (`SituacaoPagamentoResolver`) e a tela só
 * desenha. Qualquer mudança aqui precisa ser espelhada em `src/frontend/lib/sispag.ts`
 * (há teste de paridade). Constantes tipadas, nunca string crua (princípio P3 da ontologia).
 */

export const ESTADO_PAGAMENTO = {
    PRONTO: 'PRONTO',
    BLOQUEADO: 'BLOQUEADO',
} as const;
export type EstadoPagamento = (typeof ESTADO_PAGAMENTO)[keyof typeof ESTADO_PAGAMENTO];

/**
 * Motivos de bloqueio, na ORDEM DE PRIORIDADE: o primeiro que se aplica é o `principal` da linha.
 * Fora desta fatia (decisão D10): SEM_DESTINO e FAVORECIDO_NAO_AUTORIZADO de TED/PIX, que só se
 * conhecem dentro do lote.
 */
export const MOTIVO_PAGAMENTO = {
    ALCADA: 'ALCADA',
    TIPO_PERMUTA: 'TIPO_PERMUTA',
    VENCIDO: 'VENCIDO',
    FORMA_NAO_SISPAG: 'FORMA_NAO_SISPAG',
    DUPLICIDADE: 'DUPLICIDADE',
    RETIDO_CODBAR: 'RETIDO_CODBAR',
    AJUSTE_CENTAVOS_PENDENTE: 'AJUSTE_CENTAVOS_PENDENTE',
    CONFIRMACAO_A_REVISAR: 'CONFIRMACAO_A_REVISAR',
    BOLETO_SEM_DDA: 'BOLETO_SEM_DDA',
} as const;
export type MotivoPagamento = (typeof MOTIVO_PAGAMENTO)[keyof typeof MOTIVO_PAGAMENTO];

export const MOTIVOS_PAGAMENTO_ORDEM: readonly MotivoPagamento[] = Object.values(MOTIVO_PAGAMENTO);

/**
 * Subdivisão de `BOLETO_SEM_DDA` pelo desfecho da sugestão de boleto (ADR-0072, I19r): diz onde
 * está o trabalho da analista. Ordem = do mais rápido de resolver ao que não depende dela.
 *
 * - `PARA_CONFIRMAR`     `UNICA_SEGURA` ou `SO_ATENCAO`: há um boleto confirmável;
 * - `A_ESCOLHER`         `AMBIGUA` ou `DISPUTADA`: mais de um boleto possível, ou o candidato está
 *                        reservado a outro título;
 * - `CANDIDATO_FRACO`    `SO_FRACA` ou `SO_VENCIDA`: só candidato sem âncora ou já vencido;
 * - `SEM_CANDIDATO`      `SEM_CANDIDATO` ou desfecho ausente: nenhum boleto no pool de DDA;
 * - `AGUARDANDO_VINCULO` `CONFIRMADA` com o vínculo do código de barras desligado na filial.
 */
export const SUGESTAO_BOLETO_SEM_DDA = {
    PARA_CONFIRMAR: 'PARA_CONFIRMAR',
    A_ESCOLHER: 'A_ESCOLHER',
    CANDIDATO_FRACO: 'CANDIDATO_FRACO',
    SEM_CANDIDATO: 'SEM_CANDIDATO',
    AGUARDANDO_VINCULO: 'AGUARDANDO_VINCULO',
    /** I21v: há sugestão de grupo; confirmar na gaveta do título ou na aba Boletos DDA. */
    GRUPO_SUGERIDO: 'GRUPO_SUGERIDO',
} as const;
export type SugestaoBoletoSemDda =
    (typeof SUGESTAO_BOLETO_SEM_DDA)[keyof typeof SUGESTAO_BOLETO_SEM_DDA];

/** Quem resolve o bloqueio. */
export const DONO_PAGAMENTO = {
    VOCE: 'VOCE',
    APROVADOR: 'APROVADOR',
    PERMUTAS: 'PERMUTAS',
    CONTAS_A_PAGAR: 'CONTAS_A_PAGAR',
    /** Cadastro da pessoa no Conexos (conta ou chave PIX). Só aparece em pendência de lote (I20f). */
    CADASTRO: 'CADASTRO',
} as const;
export type DonoPagamento = (typeof DONO_PAGAMENTO)[keyof typeof DONO_PAGAMENTO];

/** Próximo passo da linha (o botão). O rótulo vem pronto; o `codigo` diz o que a tela faz. */
export const ACAO_PAGAMENTO = {
    ABRIR_NO_CONEXOS: 'ABRIR_NO_CONEXOS',
    ABRIR_EM_PERMUTAS: 'ABRIR_EM_PERMUTAS',
    RENEGOCIAR_NO_CONEXOS: 'RENEGOCIAR_NO_CONEXOS',
    CORRIGIR_FORMA_NO_CONEXOS: 'CORRIGIR_FORMA_NO_CONEXOS',
    TRATAR_DUPLICIDADE: 'TRATAR_DUPLICIDADE',
    DESFAZER_RETENCAO: 'DESFAZER_RETENCAO',
    TENTAR_AJUSTE: 'TENTAR_AJUSTE',
    VER_BOLETO: 'VER_BOLETO',
} as const;
export type AcaoPagamento = (typeof ACAO_PAGAMENTO)[keyof typeof ACAO_PAGAMENTO];

/** Fontes de contexto que o cálculo consulta; uma indisponível vira aviso, nunca silêncio. */
export const FONTE_SITUACAO = {
    DUPLICIDADE: 'DUPLICIDADE',
    AJUSTE_CENTAVOS: 'AJUSTE_CENTAVOS',
    BOLETO: 'BOLETO',
} as const;
export type FonteSituacao = (typeof FONTE_SITUACAO)[keyof typeof FONTE_SITUACAO];

export interface SituacaoPagamento {
    estado: EstadoPagamento;
    /** Todos os motivos que se aplicam, em ordem de prioridade. Vazio quando PRONTO. */
    motivos: MotivoPagamento[];
    /** O mais urgente (`motivos[0]`). Ausente quando PRONTO. */
    principal?: MotivoPagamento;
    /** Texto curto do motivo principal, pronto para a tela ("Aguardando aprovação"). */
    rotulo?: string;
    dono?: DonoPagamento;
    acao?: { codigo: AcaoPagamento; rotulo: string };
    /** Complemento do motivo principal ("venceu há 4 dias", "pode já ter permuta parcial…"). */
    detalhe?: string;
    /** Só quando `principal = BOLETO_SEM_DDA`: em que pé está a sugestão de boleto (I19r). */
    sugestaoBoleto?: SugestaoBoletoSemDda;
}

export interface TotalSituacao {
    qtd: number;
    valor: number;
}

/**
 * Contagens e valores sobre a carteira INTEIRA (não sobre o corte de payload). Alimenta os cards,
 * o filtro externo e os chips de motivo. `porMotivo` conta pelo motivo PRINCIPAL, então a soma
 * dos motivos é igual a `porEstado.BLOQUEADO`.
 */
export interface ResumoSituacao {
    porEstado: Record<EstadoPagamento, TotalSituacao>;
    porMotivo: Partial<Record<MotivoPagamento, TotalSituacao>>;
    porDono: Partial<Record<DonoPagamento, TotalSituacao>>;
    /** Fontes que falharam nesta montagem. Não vazio = a tela avisa "situação incompleta". */
    fontesIndisponiveis: FonteSituacao[];
}

// ============================================================ prontidão do lote (ADR-0076, I20)

/** `PRONTO` ⇔ nenhuma pendência (I20b). */
export const ESTADO_PRONTIDAO = {
    PRONTO: 'PRONTO',
    COM_PENDENCIA: 'COM_PENDENCIA',
} as const;
export type EstadoProntidao = (typeof ESTADO_PRONTIDAO)[keyof typeof ESTADO_PRONTIDAO];

/** `BARRA`: a finalização recusa enquanto existir. `SAI`: a finalização retira o item. */
export const EFEITO_PENDENCIA = {
    BARRA: 'BARRA',
    SAI: 'SAI',
} as const;
export type EfeitoPendencia = (typeof EFEITO_PENDENCIA)[keyof typeof EFEITO_PENDENCIA];

/** O que falta, na ordem em que a tela lista dentro de cada efeito (I20c, I20d, I20e). */
export const PENDENCIA_LOTE = {
    LOTE_VAZIO: 'LOTE_VAZIO',
    SEM_CONTA: 'SEM_CONTA',
    SITUACAO_BLOQUEADA: 'SITUACAO_BLOQUEADA',
    SITUACAO_NAO_CONFERIDA: 'SITUACAO_NAO_CONFERIDA',
    DUPLICIDADE_ABERTA: 'DUPLICIDADE_ABERTA',
    AJUSTE_EM_ANDAMENTO: 'AJUSTE_EM_ANDAMENTO',
    SEM_FORMA: 'SEM_FORMA',
    VERIFICACAO_PENDENTE: 'VERIFICACAO_PENDENTE',
    SEM_DADO_PAGAMENTO: 'SEM_DADO_PAGAMENTO',
    FAVORECIDO_NAO_AUTORIZADO: 'FAVORECIDO_NAO_AUTORIZADO',
    DESTINO_ALTERADO: 'DESTINO_ALTERADO',
} as const;
export type PendenciaLoteCodigo = (typeof PENDENCIA_LOTE)[keyof typeof PENDENCIA_LOTE];

/** Ações próprias do lote; a pendência de situação usa a `ACAO_PAGAMENTO` do título. */
export const ACAO_PENDENCIA_LOTE = {
    PEDIR_AUTORIZACAO: 'PEDIR_AUTORIZACAO',
    ABRIR_CADASTRO_NO_CONEXOS: 'ABRIR_CADASTRO_NO_CONEXOS',
} as const;
export type AcaoPendenciaLote = (typeof ACAO_PENDENCIA_LOTE)[keyof typeof ACAO_PENDENCIA_LOTE];

export interface PendenciaLote {
    efeito: EfeitoPendencia;
    codigo: PendenciaLoteCodigo;
    /** Texto curto, pronto para a tela ("Possível duplicidade", "Sem forma de pagamento"). */
    rotulo: string;
    detalhe?: string;
    dono: DonoPagamento;
    /**
     * Botão da pendência. Ausente quando o passo é na própria tela do lote (escolher a forma,
     * definir a conta) ou quando a finalização tenta de novo sozinha (`detalhe` diz o que fazer).
     */
    acao?: { codigo: AcaoPagamento | AcaoPendenciaLote; rotulo: string };
    /** Item da pendência; ausente = pendência do lote (vazio, sem conta). */
    chave?: ChaveTitulo;
    /** Só em `SITUACAO_BLOQUEADA`: o motivo principal do título. */
    motivo?: MotivoPagamento;
}

/** Resumo de prontidão de um lote RASCUNHO (I20a). */
export interface ProntidaoLote {
    estado: EstadoProntidao;
    /** Itens que vão ao finalizar (todos menos os que saem). */
    itensQueVao: number;
    /** Itens com pelo menos uma pendência `BARRA`. */
    barram: number;
    /** Itens com pendência `SAI` (e nenhuma `BARRA`). */
    saem: number;
    /** `BARRA` primeiro, depois `SAI`; dentro do efeito, pelo valor do item (maior primeiro). */
    pendencias: PendenciaLote[];
    /** Fontes da situação de pagamento que falharam nesta montagem (I19l). */
    fontesIndisponiveis: FonteSituacao[];
}

// ============================================================ POST /sispag/lotes/por-filial

export interface CriarLotesPorFilialInput {
    titulos: ChaveTitulo[];
    /**
     * ADR-0064: título que está em OUTRO lote RASCUNHO sai de lá e entra no lote novo. Sem a flag,
     * a inclusão é recusada (`TituloEmOutroLoteError`) e o título aparece em `recusados`.
     */
    mover?: boolean;
}

export const RESULTADO_LOTE_FILIAL = {
    CRIADO: 'CRIADO',
    PARCIAL: 'PARCIAL',
    RECUSADO: 'RECUSADO',
} as const;
export type ResultadoLoteFilial =
    (typeof RESULTADO_LOTE_FILIAL)[keyof typeof RESULTADO_LOTE_FILIAL];

export interface TituloRecusadoNoLote {
    chave: ChaveTitulo;
    /** Código estável do erro de domínio (ex.: `TITULO_NAO_ELEGIVEL`). */
    codigo: string;
    /** Motivo de pagamento, quando a recusa foi por situação. */
    motivo?: MotivoPagamento;
    mensagem: string;
}

/** Um lote por filial; um lote que falha não desfaz os outros. */
export interface LoteCriadoPorFilial {
    filCod: number;
    resultado: ResultadoLoteFilial;
    /** Id do lote criado; ausente em RECUSADO. */
    loteId?: string;
    incluidos: ChaveTitulo[];
    recusados: TituloRecusadoNoLote[];
}

export interface CriarLotesPorFilialResult {
    lotes: LoteCriadoPorFilial[];
}
