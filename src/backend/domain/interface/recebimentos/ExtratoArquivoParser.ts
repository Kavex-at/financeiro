/**
 * Porta de parsing de extrato bancário por ARQUIVO (canal manual — upload .xlsx).
 *
 * Segunda fonte do Módulo 1 da Frente IV, ao lado do `ConexosExtratoClient` (fin095, automático).
 * O extrato do Conexos entra pelo ERP; este canal cobre o cenário de FALLBACK — o analista baixa o
 * extrato no internet banking (ex.: Bradesco) e sobe o `.xlsx`. A porta é agnóstica ao banco: cada
 * layout ganha um parser (`BradescoExtratoParser` hoje) e o serviço de importação escolhe pelo
 * `canParse`. Ver `ontology/actions/recebimentos/importar-transacoes-extrato.md`.
 */

/** Uma linha de transação lida do arquivo — crédito OU débito (o filtro crédito-only é do serviço). */
export interface LinhaExtratoArquivo {
    /** Data do lançamento (meio-dia UTC — o arquivo só traz a data, sem hora). */
    data: Date;
    /** Descrição do lançamento (coluna "Lançamento": TED RECEBIDA, PIX RECEBIDO, BOLETO PAGO…). */
    descricao: string;
    /** Razão social da contraparte, quando o banco a informa (pode faltar). */
    contraparteNome?: string;
    /** CPF/CNPJ da contraparte, só-dígitos (pode faltar). */
    contraparteDoc?: string;
    /** Valor com SINAL — positivo = crédito, negativo = débito. O serviço filtra `> 0`. */
    valor: number;
    /** Número da linha na planilha (desempate determinístico da chave natural). */
    linhaIndice: number;
    /** Célula a célula original — auditoria + reprocessamento. */
    raw: Record<string, unknown>;
}

/** Metadados do cabeçalho do extrato (linhas de topo antes da grade de lançamentos). */
export interface CabecalhoExtratoArquivo {
    /** Identificador do layout/banco (ex.: `'bradesco'`). */
    banco: string;
    agencia?: string;
    conta?: string;
    nome?: string;
    periodoDe?: Date;
    periodoAte?: Date;
}

/** Resultado do parse: cabeçalho + TODAS as linhas de transação (marcadores SALDO* já removidos). */
export interface ExtratoArquivoParseResult {
    cabecalho: CabecalhoExtratoArquivo;
    linhas: LinhaExtratoArquivo[];
}

/** Contrato de um parser de extrato por arquivo. Implementações: um por layout/banco. */
export interface ExtratoArquivoParserInterface {
    /** Identificador do banco/layout que este parser entende. */
    readonly banco: string;
    /** Sniff barato: este buffer parece ser deste layout? */
    canParse(buffer: Buffer): Promise<boolean>;
    /** Parse completo → cabeçalho + linhas. Lança se o arquivo não for reconhecível. */
    parse(buffer: Buffer): Promise<ExtratoArquivoParseResult>;
}
