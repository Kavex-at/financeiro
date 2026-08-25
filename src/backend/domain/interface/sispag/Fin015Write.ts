/**
 * SISPAG fin015 — DTOs da ESCRITA (Fatia 3, geração de remessa `.REM`).
 *
 * Estes tipos descrevem as FERRAMENTAS de integração com a tela "Geração de Lotes
 * SISPAG" (fin015), não o fluxo de orquestração (que é decidido com o analista).
 * Cada campo espelha os payloads PROVADOS ao vivo em HML (sondas `probe-fin015-hml.ts`
 * / `probe-fin015-fluxo.ts`, 2026-07-09). É a 1ª superfície de ESCRITA do SISPAG no
 * Conexos — quebra a invariante I1 (read-only); ver a doutrina em `ConexosBaixaClient`.
 */

/**
 * Conta pagadora (a conta da Columbia de onde sai o dinheiro). O lote nativo fin015
 * é POR conta. Default empírico = Itaú `AG:0641/CT:55795-4` (8/8 lotes do HAR PRD);
 * Santander é exceção rara (roteamento a definir com o analista). Campos = os do DTO
 * `FinLoteSispag` provado no `POST /fin015`.
 */
export interface ContaPagadora {
    /** Código interno do banco no Conexos (Itaú=4). */
    bncCod: number;
    /** Número do banco na FEBRABAN (Itaú=341). */
    bncNumCodbanco: number;
    /** Código interno da conta corrente no Conexos. */
    ccoCod: number;
    /** Número da conta (sem dígito). */
    ccoNumConta: number;
    /** Dígito verificador da conta. */
    ccoEspDvconta: string;
    /** Código da agência (com zeros à esquerda, ex. '0641'). */
    ccoEspAgcod: string;
    /** Conta formatada (ex. '55795-4'). */
    conta: string;
    /** Layout exibido (ex. 'AG:0641/CT:55795-4'). */
    layoutConta: string;
}

/** Parâmetros para criar um lote nativo fin015 (`POST /fin015`). */
export interface CriarLoteParams {
    filCod: number;
    conta: ContaPagadora;
    /** Data de débito (epoch-ms). Regras R1 (≥ hoje) e R2 (≤ menor vencimento) validadas no finalizar. */
    dataDebito: number;
}

/** Lote nativo recém-criado — o crítico é o `flpCod` atribuído pelo ERP. */
export interface LoteNativoCriado {
    flpCod: number;
    filCod: number;
    bncCod: number;
}

/** Um título pendente elegível a importar num lote (linha de `titulosPendentes/list`). */
export interface TituloPendente {
    filCod: number;
    docCod: string;
    titCod: string;
    /** Forma de pagamento (7=boleto; há TED/PIX). O ERP escolhe o segmento CNAB por ela. */
    itsVldModalidade?: number;
    valor?: number;
    vencimento?: number;
    favorecido?: string;
    /** Linha crua do ERP — repassada no `importar` (o ERP exige o registro completo do item). */
    raw: Record<string, unknown>;
}

/**
 * Parâmetros para importar títulos selecionados num lote (`titulosPendentes/importar`).
 *
 * `itens` são as linhas do `titulosPendentes/list` VERBATIM (a identidade tem que bater:
 * `filCod` é a filial do TÍTULO, não a do lote), enriquecidas com a modalidade e o
 * destino do favorecido (`pctCodSeq` de `cmn025/ctcorr`). Os campos de SELEÇÃO
 * (`op`, `bncCodFin015`, `titVldReflexoDda*`) são montados pelo client nos dois níveis
 * que o ERP exige — ver `ConexosSispagWriteClient.importarTitulos`.
 */
export interface ImportarTitulosParams {
    filCod: number;
    bncCod: number;
    flpCod: number;
    /** Itens de seleção (linhas cruas do `titulosPendentes/list` dos títulos escolhidos). */
    itens: Array<Record<string, unknown>>;
    /** Operação da seleção. Default 1 (o valor provado em HML). */
    op?: number;
}

/** Parâmetros para gerar a remessa `.REM` de um lote FINALIZADO (`gerArquivosBancos/gerarRemessa`). */
export interface GerarRemessaParams {
    filCod: number;
    bncCod: number;
    flpCod: number;
    /** Config de remessa: 1 = "REMESSA SISPAG - ITAÚ" (confirmado). */
    grbCodSeq: number;
    /** Nº da remessa (auto na tela; obrigatório no POST). */
    seqNum: number;
    /** Nome do arquivo (padrão `PG{DDMM}{seq}.REM`; obrigatório no POST). */
    gabEspNomeArquivo: string;
}

/** Confirmação da geração de remessa (o ERP responde `valid:'SUCESSO'`). */
export interface RemessaGerada {
    sucesso: boolean;
    mensagem?: string;
}

/** Um arquivo de remessa gerado (linha de `gerArquivosBancos/list`) — traz o `.REM` inteiro. */
export interface ArquivoRemessa {
    gabCod: number;
    /** Nome do arquivo (ex. `PG171101.REM`). */
    nomeArquivo?: string;
    /** Nº da remessa. */
    numRemessa?: string;
    /** Conteúdo do `.REM` (CNAB 240 gerado nativamente) — `gabLngDados`. */
    conteudo?: string;
}

/**
 * Estado observado do lote nativo no fin015 — a fonte da verdade para retomar uma
 * sequência interrompida. Ver `ConexosSispagWriteClient.getLoteNativo` para o encoding
 * de `status`, que foi medido em produção e não inferido.
 */
export interface LoteNativoEstado {
    filCod: number;
    bncCod: number;
    flpCod: number;
    /** 0 aberto · 1 finalizado · 2 cancelado · 3 outro terminal. */
    status: number;
    titulosCount: number;
    soma: number;
    /** Conta pagadora do lote — parte da impressão digital na busca por órfão. */
    ccoCod?: number;
    /** `flpDtaCredito` — a data de débito pedida. Também compõe a impressão digital. */
    dataDebito?: number;
    finalizadoEm?: number;
}
