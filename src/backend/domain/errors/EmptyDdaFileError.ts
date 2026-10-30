/**
 * O `fin124` devolveu ZERO itens para um arquivo DDA que tem itens no snapshot local
 * (v0.53.0, `entities/boleto-dda.md` §Sincronização). Gravar a lista vazia apagaria todos os
 * boletos do arquivo; uma resposta vazia do ERP é mais provável que uma falha de leitura do que o
 * banco ter esvaziado o arquivo. O snapshot é mantido e a passada conta o arquivo como falha.
 * Arquivo cancelado continua saindo pelo `cancelado_em`, não por aqui.
 */
export default class EmptyDdaFileError extends Error {
    public readonly code = 'DDA_FILE_EMPTY';

    constructor(
        public readonly ddcCod: number,
        public readonly itensNoSnapshot: number,
    ) {
        super(
            `o fin124 devolveu 0 itens para o arquivo DDA ${ddcCod}, que tem ${itensNoSnapshot} no snapshot; snapshot mantido`,
        );
        this.name = 'EmptyDdaFileError';
    }
}
