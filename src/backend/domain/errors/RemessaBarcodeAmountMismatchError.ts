import type { DivergenciaValorJ } from '../libs/cnab/RemessaCnabValidator.js';
import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Uma divergência do `.REM`, com o título quando ele pôde ser identificado. */
export interface DivergenciaValorTitulo extends DivergenciaValorJ {
    docCod?: string;
    titCod?: string;
}

const formatar = (centavos: number): string =>
    `R$ ${(centavos / 100).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;

/** Defensivo: só a máscara 5+4 sai daqui, mesmo que alguém passe o código inteiro. */
const mascarar = (v: string): string => {
    const d = v.replace(/\D/g, '');
    return d.length >= 10 ? `${d.slice(0, 5)}…${d.slice(-4)}` : v;
};

/**
 * O `.REM` gerado tem segmento J cuja barra (valor > 0) difere do valor do pagamento do próprio J
 * (I17m, ADR-0074): o banco pagaria um valor diferente do boleto. Mesmo tratamento tardio do
 * `RemessaCorrompidaError` (I16b(2)): o lote não vai a `REMESSA_GERADA`, o `baixarArquivo` não
 * serve o arquivo, e arquivo e lote nativo ficam no ERP para cancelamento manual. HTTP 409.
 */
export default class RemessaBarcodeAmountMismatchError extends Error implements HandlerError {
    public readonly code = 'REMESSA_VALOR_BARRA_DIVERGENTE';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details: {
        nomeArquivo: string;
        flpCod?: number;
        gabCod?: number;
        divergencias: DivergenciaValorTitulo[];
    };

    public constructor(params: {
        nomeArquivo: string;
        flpCod?: number;
        gabCod?: number;
        divergencias: DivergenciaValorTitulo[];
    }) {
        const divergencias = params.divergencias.map((d) => ({
            ...d,
            barrasMascarada: mascarar(d.barrasMascarada),
        }));
        const resumo = divergencias
            .map(
                (d) =>
                    `${d.docCod !== undefined ? `${d.docCod}/${d.titCod ?? '?'} ` : ''}line ${d.linha} ${d.barrasMascarada} barcode ${d.valorBarraCentavos} payment ${d.pagamentoCentavos ?? 'unreadable'}`,
            )
            .join('; ');
        super(
            `remittance ${params.nomeArquivo}: ${divergencias.length} J segment(s) whose payment differs from the barcode amount: ${resumo}${params.flpCod !== undefined ? ` [flpCod ${params.flpCod}]` : ''}`,
        );
        this.name = 'RemessaBarcodeAmountMismatchError';
        const itens = divergencias
            .map((d) => {
                const titulo =
                    d.docCod !== undefined ? `título ${d.docCod}/${d.titCod ?? '?'}` : 'título';
                const pagamento =
                    d.pagamentoCentavos !== undefined ? formatar(d.pagamentoCentavos) : 'ilegível';
                return `${titulo} (código ${d.barrasMascarada}, linha ${d.linha}): boleto ${formatar(d.valorBarraCentavos)}, pagamento ${pagamento}`;
            })
            .join('; ');
        const lote =
            params.flpCod !== undefined ? ` O lote nativo ${params.flpCod}` : ' O lote nativo';
        this.userMessage =
            `O arquivo de remessa ${params.nomeArquivo} pagaria valor diferente do boleto — ${itens}. ` +
            `O arquivo foi gerado e${lote} está FINALIZADO no Conexos. NÃO envie este arquivo ao ` +
            'banco: cancele o arquivo e o lote no Conexos, confira o valor do título e gere a ' +
            'remessa de novo.';
        this.details = {
            nomeArquivo: params.nomeArquivo,
            ...(params.flpCod !== undefined ? { flpCod: params.flpCod } : {}),
            ...(params.gabCod !== undefined ? { gabCod: params.gabCod } : {}),
            divergencias,
        };
    }
}
