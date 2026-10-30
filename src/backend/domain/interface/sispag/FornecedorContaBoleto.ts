/**
 * Fornecedor de um boleto DDA, aprendido da conta do beneficiário nas barras (ADR-0081).
 *
 * Ordem de confiança (a menor vence): o vínculo do Conexos, a decisão da analista e a inferência
 * por valor + dia.
 */
export const FORNECEDOR_ORIGEM = {
    /** O Conexos vinculou o boleto a um título. */
    VINCULADO: 'VINCULADO',
    /** A analista confirmou o par boleto × título. */
    CONFIRMADO: 'CONFIRMADO',
    /** Boleto com um único título ativo de mesmo valor e mesmo dia. A tela marca "provável". */
    INFERIDO: 'INFERIDO',
} as const;
export type FornecedorOrigem = (typeof FORNECEDOR_ORIGEM)[keyof typeof FORNECEDOR_ORIGEM];

/** Prioridade: índice menor = mais confiável. */
export const FORNECEDOR_ORIGEM_PRIORIDADE: readonly FornecedorOrigem[] = [
    FORNECEDOR_ORIGEM.VINCULADO,
    FORNECEDOR_ORIGEM.CONFIRMADO,
    FORNECEDOR_ORIGEM.INFERIDO,
];

/** Fornecedor como a aba o mostra. */
export interface BoletoDdaFornecedor {
    pesCod: string;
    nome: string;
    origem: FornecedorOrigem;
}

/** Um boleto que diz "a conta `chave` é do fornecedor `pesCod`". */
export interface EvidenciaConta {
    chave: string;
    pesCod: string;
    credor?: string;
    origem: FornecedorOrigem;
    /** Identifica o boleto (as barras), para contar boletos distintos e não linhas duplicadas. */
    boleto: string;
    vistoEm: Date;
}

/** Linha de `sispag_fornecedor_conta_boleto`. */
export interface MapeamentoConta {
    chave: string;
    /** Ausente quando `ambiguo`. */
    pesCod?: string;
    credor?: string;
    origem: FornecedorOrigem;
    /** A chave já apontou para 2+ fornecedores distintos na origem mais confiável: não se nomeia. */
    ambiguo: boolean;
    evidencias: number;
    ultimaEvidenciaEm: Date;
}

export interface ResultadoAprendizadoFornecedor {
    chaves: number;
    ambiguas: number;
    porOrigem: Record<FornecedorOrigem, number>;
}
