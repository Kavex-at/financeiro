/**
 * SISPAG — ledger write-ahead da CONCILIAÇÃO do retorno (`conciliacao_execucao`, migration 0050).
 *
 * Espelha `RemessaExecucao` porque o problema é o mesmo: uma escrita IRREVERSÍVEL e não
 * idempotente contra o Conexos. `PUT fin052/arquivosRetorno/processar` gera as baixas no
 * fin010; chamado duas vezes, grava baixas em cima das antigas. Dois cliques na tela, ou um
 * restart do Render entre o PUT e a resposta HTTP, bastam.
 *
 * A identidade é o ARQUIVO de retorno: `(filCod, bncCod, gtbCodSeq, garCodSeq)`.
 */

export type ConciliacaoExecucaoStatus = 'pending' | 'reconciling' | 'settled' | 'error';

export interface ConciliacaoExecucaoRow {
    idempotencyKey: string;
    correlationId?: string;
    filCod: number;
    bncCod: number;
    gtbCodSeq: number;
    garCodSeq: number;
    status: ConciliacaoExecucaoStatus;
    dryRun: boolean;
    processou: boolean;
    totalLinhas?: number;
    pagos?: number;
    rejeitados?: number;
    varreduraIncompleta: boolean;
    erroMensagem?: string;
    executadoPor?: string;
    criadoEm?: string;
    atualizadoEm?: string;
}

export interface BeginConciliacaoExecucaoInput {
    idempotencyKey: string;
    correlationId?: string;
    filCod: number;
    bncCod: number;
    gtbCodSeq: number;
    garCodSeq: number;
    dryRun: boolean;
    executadoPor: string;
}

export interface BeginConciliacaoExecucaoResult {
    status: ConciliacaoExecucaoStatus;
    /** `true` quando o arquivo já foi conciliado antes — o serviço curto-circuita. */
    alreadySettled: boolean;
}

export interface ConciliacaoExecucaoSettleData {
    processou: boolean;
    totalLinhas: number;
    pagos: number;
    rejeitados: number;
    varreduraIncompleta: boolean;
}
