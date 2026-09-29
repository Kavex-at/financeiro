import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Item TED/PIX sem destino de pagamento resolvível (ADR-0054 I10a): nem conta/chave ativa no
 * cadastro do Conexos, nem destino digitado no item. Irmão do `BoletoSemCodigoBarrasError`.
 *
 * No ENVIO é lançado ANTES do `criarLote` — nada de lote nativo pela metade. No `finalizarLote`
 * (checagem leve do Adendo), barra a finalização do mesmo jeito que "modalidade a definir".
 *
 * Nomeia os títulos (`docCod/titCod` e o credor), nunca conta ou chave (I10h). HTTP 409.
 */
export default class DestinoPagamentoAusenteError extends Error implements HandlerError {
    public readonly code = 'DESTINO_PAGAMENTO_AUSENTE';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: {
        itens: Array<{ docCod: string; titCod: string; credor?: string; modalidade?: string }>;
    }) {
        const nomes = params.itens.map(
            (i) =>
                `${i.docCod}/${i.titCod}${i.credor ? ` (${i.credor})` : ''}${i.modalidade ? ` — ${i.modalidade}` : ''}`,
        );
        super(
            `TED/PIX item(s) without payment destination: ${params.itens.map((i) => `${i.docCod}/${i.titCod}`).join(', ')}`,
        );
        this.name = 'DestinoPagamentoAusenteError';
        this.userMessage =
            `Sem destino de pagamento para: ${nomes.join('; ')}. O favorecido não tem conta ` +
            '(TED) ou chave PIX ativa no cadastro do Conexos, e nenhum destino foi informado no ' +
            'item. Informe o destino ou troque a forma de pagamento.';
        this.details = { itens: params.itens.map((i) => `${i.docCod}/${i.titCod}`) };
    }
}
