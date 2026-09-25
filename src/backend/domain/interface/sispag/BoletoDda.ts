/**
 * Boleto DDA — item do pool `fin124` (Importação de Arquivo DDA) do Conexos, e a consolidação
 * dele contra a carteira de títulos a pagar. Ver `ontology/entities/BoletoDda.md`.
 *
 * O pool é da CONTA PAGADORA, não da filial: um item só ganha filial quando o próprio Conexos o
 * vincula a um título (associação do fin015, `titVldReflexoDdaAssoc`).
 */

/** Arquivo DDA importado no `fin124` (uma linha de `fin124/list`). */
export interface ArquivoDda {
    ddcCod: number;
    nome?: string;
    /** epoch ms */
    importadoEm?: number;
    /** epoch ms — presente = arquivo cancelado no fin124 */
    canceladoEm?: number;
    status?: number;
}

/** Boleto do pool (uma linha de `fin124/itens/list/{ddcCod}`). */
export interface ItemDda {
    ddcCod: number;
    ditCod: number;
    numero?: string;
    valor: number;
    /** Data civil `YYYY-MM-DD`. */
    vencimento?: string;
    /** Código de barras de 44 dígitos. */
    codbar?: string;
    /** Vínculo gravado pelo Conexos. Todos ausentes = boleto livre. */
    filCod?: number;
    docCod?: string;
    titCod?: string;
    flpCod?: number;
    bncCod?: number;
}

/** Boleto persistido, com o arquivo de origem. */
export interface BoletoDda extends ItemDda {
    arquivo?: string;
    /** epoch ms */
    importadoEm?: number;
}

/**
 * Situação do boleto frente à carteira.
 * - VINCULADO:  o Conexos já ligou o boleto a um título.
 * - CANDIDATO:  livre, e exatamente UM título aberto tem o mesmo valor com vencimento na janela.
 * - AMBIGUO:    livre, e MAIS de um título casa (cobrança recorrente de mesmo valor).
 * - SEM_TITULO: livre, e nenhum título aberto casa.
 */
export const BOLETO_DDA_SITUACAO = {
    VINCULADO: 'VINCULADO',
    CANDIDATO: 'CANDIDATO',
    AMBIGUO: 'AMBIGUO',
    SEM_TITULO: 'SEM_TITULO',
} as const;
export type BoletoDdaSituacao = (typeof BOLETO_DDA_SITUACAO)[keyof typeof BOLETO_DDA_SITUACAO];

/** Lote local (SISPAG) em que o título está, se houver. */
export interface BoletoDdaLoteRef {
    loteId: string;
    status: string;
}

/** Título da carteira ligado ao boleto (vínculo do Conexos ou candidato nosso). */
export interface BoletoDdaTitulo {
    filCod: number;
    docCod: string;
    titCod: string;
    credor?: string;
    valor?: number;
    /** Data civil `YYYY-MM-DD`. */
    vencimento?: string;
    /** Vencimento do boleto − vencimento do título, em dias. 0 = mesmo dia. */
    diferencaDias?: number;
    /** O Conexos sinaliza boleto DDA para este título (`tem_boleto` da carteira). */
    temBoletoDda?: boolean;
    lote?: BoletoDdaLoteRef;
}

/** Linha da aba "Boletos DDA". */
export interface BoletoDdaConsolidado {
    ddcCod: number;
    ditCod: number;
    arquivo?: string;
    importadoEm?: number;
    numero?: string;
    valor: number;
    vencimento?: string;
    vencido: boolean;
    codbar?: string;
    linhaDigitavel?: string;
    /** Código FEBRABAN do banco emissor (3 primeiros dígitos das barras). */
    bancoEmissor?: string;
    situacao: BoletoDdaSituacao;
    /** Presente só em VINCULADO. */
    vinculo?: BoletoDdaTitulo & { flpCod?: number };
    /** Presente em CANDIDATO (1) e AMBIGUO (2+). */
    candidatos: BoletoDdaTitulo[];
}

export const BOLETO_DDA_ESCOPO = {
    /** Vencimento hoje ou depois — os boletos ainda pagáveis. Default da aba. */
    A_VENCER: 'a-vencer',
    TODOS: 'todos',
} as const;
export type BoletoDdaEscopo = (typeof BOLETO_DDA_ESCOPO)[keyof typeof BOLETO_DDA_ESCOPO];

/** Contagem por situação (chips da aba). `todas` = soma. */
export type BoletoDdaContagem = Record<BoletoDdaSituacao | 'todas', number>;

/** Uma PÁGINA da aba — o pool inteiro nunca vai ao navegador. */
export interface BoletosDdaResposta {
    boletos: BoletoDdaConsolidado[];
    total: number;
    pagina: number;
    tamanho: number;
    contagem: BoletoDdaContagem;
    filiais: number[];
    /** epoch ms da última sincronização com o fin124; ausente = nunca sincronizado. */
    sincronizadoEm?: number;
    janelaDias: number;
}

export interface SincronizacaoDdaResultado {
    arquivosNovos: number;
    arquivosRelidos: number;
    boletos: number;
    /** Arquivos cuja leitura falhou (não interrompem os demais). */
    falhas: number;
}
