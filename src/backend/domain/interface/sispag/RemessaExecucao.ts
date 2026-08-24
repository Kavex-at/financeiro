/**
 * SISPAG — ledger write-ahead da geração de REMESSA (`remessa_execucao`, migration 0049).
 *
 * Espelha `solicitacao_numerario_execucao` (Recebimentos) porque o problema é o mesmo: uma
 * sequência de escritas NÃO-idempotentes contra o Conexos. `criarLote`, `importarTitulos` e
 * `gerarRemessa` criam registro novo a cada chamada — um retry após timeout duplica um LOTE
 * DE PAGAMENTO, ou seja, dinheiro saindo duas vezes.
 */

/** Estados do ledger. `reconciling` = escrita em voo (write-ahead). */
export type RemessaExecucaoStatus = 'pending' | 'reconciling' | 'settled' | 'error';

/** Passo alcançado — diz o que já existe no ERP quando algo falha no meio. */
export type RemessaEtapa =
    | 'criar_lote'
    | 'importar'
    | 'finalizar'
    | 'gerar_remessa'
    | 'concluido';

export interface RemessaExecucaoRow {
    idempotencyKey: string;
    correlationId?: string;
    loteId: string;
    filCod: number;
    bncCod: number;
    status: RemessaExecucaoStatus;
    dryRun: boolean;
    nativeFlpCod?: number;
    nativeGabCod?: number;
    etapa?: RemessaEtapa;
    erpResponse?: unknown;
    erroMensagem?: string;
    executadoPor?: string;
    criadoEm?: string;
    atualizadoEm?: string;
}

export interface BeginRemessaExecucaoInput {
    idempotencyKey: string;
    correlationId?: string;
    loteId: string;
    filCod: number;
    bncCod: number;
    dryRun: boolean;
    executadoPor: string;
}

export interface BeginRemessaExecucaoResult {
    status: RemessaExecucaoStatus;
    /** `true` quando a execução já foi concluída antes — o serviço curto-circuita. */
    alreadySettled: boolean;
}

/** Dados da conclusão bem-sucedida. */
export interface RemessaExecucaoSettleData {
    nativeFlpCod: number;
    nativeGabCod?: number;
    arquivo?: string;
    numRemessa?: number;
    erpResponse?: unknown;
}
