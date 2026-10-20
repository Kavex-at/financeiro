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

/** Quem resolve o bloqueio. */
export const DONO_PAGAMENTO = {
    VOCE: 'VOCE',
    APROVADOR: 'APROVADOR',
    PERMUTAS: 'PERMUTAS',
    CONTAS_A_PAGAR: 'CONTAS_A_PAGAR',
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
