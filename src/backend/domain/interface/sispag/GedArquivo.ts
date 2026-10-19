/**
 * GED do Conexos (`arq020`, Arquivamento de Documentos), lido para achar o PDF da NFS-e de um
 * título a pagar (ADR-0073, I15p). Só leitura.
 */

/** `docTip` dos documentos a pagar no `psq014` (Pesquisa de Documentos a Pagar). */
export const DOC_TIP_PAGAR = 2;

/** Documento financeiro cujo GED se quer abrir (o que o `psq014` passa ao `arq020`). */
export interface DocumentoGed {
    filCod: number;
    docCod: string;
    docTip: number;
    priCod: number;
}

/** Pasta do GED de um processo (`dcmCod`), achada na árvore do `arq020/TelaDocumento/list`. */
export interface PastaGed {
    dcmCod: number;
    descricao?: string;
}

/** Arquivo de uma pasta (`arq020/arqDocFiles/list/{dcmCod}`). */
export interface ArquivoGed {
    dcmCod: number;
    adfCodSeq: number;
    /** Nome do arquivo (ex.: `NF_86666.PDF`). */
    nome: string;
    /** Tipo informado pelo Conexos (ex.: `PDF`). */
    tipo?: string;
    tamanho?: number;
}
