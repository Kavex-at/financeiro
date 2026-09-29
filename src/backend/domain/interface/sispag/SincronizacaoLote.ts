import type { AlertaTipo } from '../operacao/Alerta.js';
import type {
    BaixaFonte,
    ItemLote,
    ItemSituacao,
    LeituraBaixas,
    LeituraTitulo,
    LotePagamentoStatus,
    OrigemBaixa,
} from './SispagInterface.js';

/**
 * Tipos da sincronização do lote SISPAG pelo título (L11, ADR-0055, regra I11).
 * Ver `ontology/business-rules/sincronizacao-status-lote-sispag.md`.
 */

/** Chave de um item do lote (a mesma do `lote_pagamento_item`). */
export interface ChaveItemLote {
    filCod: number;
    docCod: string;
    titCod: string;
}

/**
 * Um evento do fin052 que casou com o item (linha de `arquivosRetornoDetalhe`, casada pela chave
 * composta com o `filCod` DA LINHA — ADR-0055).
 */
export interface EventoRetornoItem {
    eventoCod: string;
    descricao?: string;
    /** `fbeVldTpret = 2` no cadastro de eventos do banco. */
    rejeitado: boolean;
    borCod?: number;
    bxaCodSeq?: number;
}

/**
 * Estado COMPLETO de um item depois de uma passada. É o que se grava: campo ausente vira NULL.
 */
export interface EstadoSincronizacaoItem extends ChaveItemLote {
    situacao?: ItemSituacao;
    retornoEvento?: string;
    retornoDescricao?: string;
    rejeitado: boolean;
    borCod?: number;
    bxaCodSeq?: number;
    baixaFonte?: BaixaFonte;
    origemBaixa?: OrigemBaixa;
    pagoEm?: string;
    valorPago?: number;
    pagoObservadoEm?: string;
    divergencia: boolean;
    divergenciaDetalhe?: string;
    sincronizadoEm?: string;
}

/** O que a decisão recebe por item: o estado atual e as leituras desta passada. */
export interface EntradaItemDecisao {
    atual: ItemLote;
    /** Leitura do fin064 (nível 1 — prova de pagamento). */
    titulo: LeituraTitulo;
    /** Eventos do fin052 lidos NESTA passada (níveis 2 e 3). Vazio = nada lido. */
    eventos: EventoRetornoItem[];
    /** Baixas do título (PSQ_018, nível 4). Ausente = não consultado. */
    baixas?: LeituraBaixas;
}

export interface EntradaDecisaoLote {
    loteId: string;
    status: LotePagamentoStatus;
    itens: EntradaItemDecisao[];
    /** Relógio injetado — a decisão não lê o relógio. */
    agora: Date;
}

export interface ItemDecidido extends EstadoSincronizacaoItem {
    /** Algum campo material mudou (exclui `sincronizadoEm`) — I11h. */
    mudou: boolean;
    /** O fin064 deste item foi lido nesta passada. */
    tituloLido: boolean;
}

export interface DivergenciaItem {
    chave: ChaveItemLote;
    detalhe: string;
}

export interface AlertaDecidido {
    tipo: AlertaTipo;
    alvo: string;
    detalhe: Record<string, unknown>;
}

export interface ResultadoDecisaoLote {
    itens: ItemDecidido[];
    /** Para onde o lote vai. Ausente = permanece onde está (I11e). */
    destino?: LotePagamentoStatus;
    /** Todo fin064 do lote foi lido (I11c: senão, nada transiciona). */
    leituraCompleta: boolean;
    /** Divergências NOVAS nesta passada (I11f). */
    divergencias: DivergenciaItem[];
    /** Alertas a emitir — só quando algo mudou (I11h). */
    alertas: AlertaDecidido[];
    /** Houve transição ou mudança material em algum item. */
    mudou: boolean;
}
