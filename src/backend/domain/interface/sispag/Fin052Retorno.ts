/**
 * SISPAG fin052 — DTOs da perna de RETORNO ("Retorno de Bancos Pagfor").
 *
 * O banco devolve um arquivo `.RET` (CNAB); o Nexxera larga numa pasta/SharePoint;
 * o robô-poller sobe no `fin052` (`arquivosRetorno/carregar` → `processar`), que
 * parseia o arquivo e dá as **baixas** no `fin010`. Tipos espelham os schemas do
 * OpenAPI (`docs/conexos-api/090-fin0.json`, tag `fin-052-controller`) + a config
 * de layout `ger015` (`120-ger0.json`). Chave composta do arquivo de retorno:
 * `(filCod, bncCod, gtbCodSeq, garCodSeq)`.
 *
 * NÃO é o fluxo de orquestração (poller/baixa) — são as FERRAMENTAS de leitura +
 * o `carregar`. `processar`/`liberar` ficam para depois do HAR/`.RET` (analista).
 */

/**
 * Um arquivo de retorno carregado (linha do grid `arquivosRetorno/list`).
 * Fonte: schema `GerArquivosRetorno`.
 */
export interface ArquivoRetorno {
    filCod: number;
    bncCod: number;
    /** Config de layout de retorno (FK p/ ger015). */
    gtbCodSeq: number;
    /** Sequencial do arquivo carregado. */
    garCodSeq: number;
    /** Nome/spec do arquivo. */
    arquivo?: string;
    /** Status do arquivo (garVldStatus) — filtro da tela (=1). */
    status?: number;
    /** Status de processamento (garVldProcStatus). */
    statusProcessamento?: number;
    /** Nome da config de retorno (gtbDesNome) — ordenação da tela. */
    configNome?: string;
    banco?: string;
    /** Contagem de erros de parse. */
    erros?: number;
    /** Títulos rejeitados no retorno (retorno parcial/rejeitado). */
    titulosRejeitados?: number;
    cadastradoEm?: number;
    processadoEm?: number;
}

/**
 * Uma linha de DETALHE do retorno (`arquivosRetornoDetalhe/list`). É a **ponte com
 * a baixa fin010**: carrega `bxaCodSeq` + `borCod` + `titCod`/`docCod`. Fonte:
 * schema `GerArquivosRetDet`/`GerArquivosRetDetDTO`.
 */
export interface ArquivoRetornoDetalhe {
    /** Conta financeira da baixa (plano gerencial). */
    gerNum?: number;
    gerDes?: string;
    filCod: number;
    bncCod: number;
    gtbCodSeq: number;
    garCodSeq: number;
    /** Sequenciais da linha. */
    ardCodSeq?: number;
    flpCod?: number;
    itsCodSeq?: number;
    /** Código/descrição do evento bancário (fbeEspCod/fbeEspDescricao). */
    eventoCod?: string;
    eventoDescricao?: string;
    /** Título pago. */
    docTip?: number;
    docCod?: string;
    titCod?: string;
    /** Borderô (container da baixa no fin010). */
    borCod?: number;
    borVldTipo?: number;
    /** Sequencial da BAIXA gravada no fin010 — o link direto. */
    bxaCodSeq?: number;
    /** Favorecido. */
    pesCod?: string;
    favorecido?: string;
    vencimento?: number;
    valorPago?: number;
    observacao?: string;
}

/** Conta financeira (plano gerencial) da baixa — o `fin010` não a mostra na linha do borderô. */
// (campos acrescentados em ArquivoRetornoDetalhe: gerNum, gerDes)

/** Um erro de parse de uma linha do `.RET` (`arquivosRetorno/erro/list`). Schema `GerArquivosRetornoErro`. */
export interface ArquivoRetornoErro {
    bncCod: number;
    gtbCodSeq: number;
    garCodSeq: number;
    /** Sequencial do erro. */
    areCodSeq?: number;
    /** Número da linha no arquivo. */
    linha?: number;
    /** Mensagem de erro. */
    mensagem?: string;
}

/**
 * Uma config de layout de remessa/retorno (`ger015`). Descobre os `gtbCodSeq`
 * válidos por banco (o parse do `.RET` mora no `gtbLngSql`). Schema `GerRetornoBancos`.
 */
export interface RetornoConfig {
    bncCod: number;
    gtbCodSeq: number;
    nome?: string;
    banco?: string;
    status?: number;
    /** Identificação (grbEspIdent). */
    ident?: string;
}

/** Parâmetros do upload do `.RET` (`arquivosRetorno/carregar/{bnc}/{gtb}?fileName=`). */
export interface CarregarRetornoParams {
    filCod: number;
    bncCod: number;
    gtbCodSeq: number;
    /** Nome do arquivo (vai na query `fileName`). */
    fileName: string;
    /** Conteúdo do `.RET`. */
    conteudo: Buffer;
}
