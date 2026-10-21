import type { GrupoBoletoExecucao } from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import type { GrupoBoleto } from './GrupoBoletoInterface.js';
import type { LotePagamento, SystemRemovalReason } from './SispagInterface.js';

/**
 * Contrato do borderô do grupo de boleto (ADR-0076, I19l–q, I19s): preparar o borderô de um
 * grupo numa remessa e limpá-lo quando a regra permite. Implementado por
 * `BorderoGrupoBoletoService`; os chamadores (L8 na `RemessaService`, a retirada I19p(3) e o
 * cancelamento do lote local, G3) dependem só destes tipos.
 */

/** Margem constante de desvio de relógio servidor × ERP na busca por janela de `borTimCad` (I19s). */
export const MARGEM_RELOGIO_BORDERO_MS = 120_000;

/** Desfecho de `preparar` para um grupo. */
export const DESFECHO_PREPARACAO = {
    /** Borderô conferido e importado: o item nativo com o `borCod` foi observado (I19l, I19n). */
    PRONTO: 'pronto',
    /**
     * Falha determinística (I19p(3)) ou borderô antigo não resolvido (I19s): o chamador retira o
     * grupo do lote e, se o borderô foi criado nesta remessa, pede a limpeza (I19q).
     */
    RETIRAR: 'retirar',
    /** Estado do ERP que o sistema não reconhece (I19s): nada é tocado; `Alerta` emitido. */
    INDETERMINADO: 'indeterminado',
    /** Dry-run: montado e logado, nada escrito. */
    SIMULADO: 'simulado',
} as const;
export type DesfechoPreparacao = (typeof DESFECHO_PREPARACAO)[keyof typeof DESFECHO_PREPARACAO];

export interface PedidoPreparacaoBordero {
    lote: LotePagamento;
    /** Linha da `remessa_execucao` desta remessa, quando houver. */
    remessaExecucaoId?: number;
    /** Banco do lote nativo (também o `bncCodFin015` do `importar`). */
    bncCod: number;
    flpCod: number;
    /** Conta financeira da conta pagadora do lote, lida ao vivo do `fin005`; ausente ⇒ falha antes do `POST`. */
    gerNum?: number;
    /** Data de débito do lote `YYYY-MM-DD` = `borDtaMvto`. */
    dataDebito: string;
    grupo: GrupoBoleto;
}

export interface ResultadoPreparacaoBordero {
    desfecho: DesfechoPreparacao;
    execucaoId?: string;
    borCod?: number;
    borTimCad?: number;
    /** Sequencial do item nativo de borderô no rascunho (`PRONTO`). */
    itsCodSeq?: number;
    /** O borderô é o de um J rejeitado, adotado neste write-ahead (I19s, PI-9). */
    reaproveitado: boolean;
    /** Motivo da retirada (`RETIRAR`). */
    motivo?: SystemRemovalReason;
    /** Texto ao operador (pt-BR), sem código de barras completo. */
    detalhe?: string;
}

export interface PedidoConferenciaGrupos {
    lote: LotePagamento;
    grupos: GrupoBoleto[];
}

/** Desfecho de `limpar` (I19q). */
export const DESFECHO_LIMPEZA = {
    /** Ausência observada na releitura (item, baixas e borderô). */
    LIMPO: 'limpo',
    /** Não se pode (ou não se pôde) limpar: nada excluído além do permitido; `Alerta` emitido. */
    PENDENTE: 'pendente',
    /** Não há borderô nosso a apagar (nada escrito, já limpo ou já entregue à analista). */
    NADA_A_LIMPAR: 'nada_a_limpar',
} as const;
export type DesfechoLimpeza = (typeof DESFECHO_LIMPEZA)[keyof typeof DESFECHO_LIMPEZA];

export interface PedidoLimpezaBordero {
    execucao: GrupoBoletoExecucao;
    /** Por que se limpa (retirada I19p(3), lote local cancelado…), para a trilha e o log. */
    motivo: string;
}

export interface ResultadoLimpezaBordero {
    desfecho: DesfechoLimpeza;
    execucaoId: string;
}

/**
 * Port da limpeza (G3): o que o cancelamento do lote local e a retirada do grupo precisam.
 * `BorderoGrupoBoletoService` a implementa (Task 14).
 */
export interface LimpezaBorderoGrupoInterface {
    limpar: (pedido: PedidoLimpezaBordero) => Promise<ResultadoLimpezaBordero>;
}
