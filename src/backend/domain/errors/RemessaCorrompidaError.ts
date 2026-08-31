import type { HandlerError } from '../libs/handler/HandlerError.js';
import type { SegmentoJInvalido } from '../libs/cnab/RemessaCnabValidator.js';

/**
 * O `.REM` foi gerado pelo ERP, mas não passa na verificação de integridade: há segmento J
 * (boleto) sem código de barras válido.
 *
 * O arquivo **existe** no `fin015` quando este erro sobe — não dá para "desgerar". O que o
 * erro garante é que ele **não vira entregável**: o lote não transiciona para
 * `REMESSA_GERADA`, o `baixarArquivo` não o serve, e a execução fica registrada como falha
 * com o `gabCod` para quem for cancelar no ERP.
 *
 * Por que existe: o defeito que a ADR-0040 corrigiu era invisível até o banco recusar a
 * liquidação — dias depois, com o fornecedor cobrando de novo. Verificar o artefato final
 * custa uma leitura do arquivo que já baixamos.
 */
export default class RemessaCorrompidaError extends Error implements HandlerError {
    public readonly code = 'REMESSA_CORROMPIDA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: {
        nomeArquivo: string;
        gabCod?: number;
        segmentosJ: number;
        invalidos: SegmentoJInvalido[];
    }) {
        const linhas = params.invalidos.map((i) => i.linha).join(', ');
        super(
            `remessa ${params.nomeArquivo}: ${params.invalidos.length} de ${params.segmentosJ} segmento(s) J sem código de barras válido (linhas ${linhas})`,
        );
        this.name = 'RemessaCorrompidaError';
        const motivos = [...new Set(params.invalidos.map((i) => i.motivo))].join(', ');
        this.userMessage =
            `O arquivo de remessa ${params.nomeArquivo} saiu com ${params.invalidos.length} de ` +
            `${params.segmentosJ} boleto(s) sem código de barras válido (${motivos}) e NÃO foi ` +
            'liberado para envio — o banco recusaria a liquidação. O lote nativo e o arquivo ' +
            'ficaram no Conexos: cancele o lote no fin015 e confira o cadastro do boleto antes ' +
            'de gerar de novo.';
        this.details = params;
    }
}
