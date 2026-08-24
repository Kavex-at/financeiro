import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * FAIL-CLOSED. Existe uma execução de remessa `reconciling` órfã para este lote: uma sequência
 * de escritas no fin015 foi iniciada e não confirmou. O estado real no ERP é DESCONHECIDO —
 * pode haver um lote nativo criado, títulos importados, ou até uma remessa gerada.
 *
 * Re-executar seria a única coisa pior do que parar: `criarLote`/`importarTitulos`/`gerarRemessa`
 * não são idempotentes, e um segundo lote significa pagar duas vezes. Exige conciliação humana:
 * olhar o `native_flp_cod` da trilha no fin015, cancelar o órfão, e só então liberar.
 *
 * Espelha a doutrina de `GerarSolicitacaoNumerarioService` (Recebimentos). Rota → HTTP 409.
 */
export default class RemessaEmDuvidaError extends Error implements HandlerError {
    public readonly code = 'REMESSA_EM_DUVIDA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    constructor(params: {
        loteId: string;
        idempotencyKey: string;
        nativeFlpCod?: number;
        etapa?: string;
        filCod?: number;
        bncCod?: number;
        criadoEm?: string;
    }) {
        super(`remessa IN-DOUBT for lote ${params.loteId} (key ${params.idempotencyKey})`);
        this.name = 'RemessaEmDuvidaError';
        this.userMessage = RemessaEmDuvidaError.montarMensagem(params);
        this.details = params;
    }

    /**
     * A mensagem TEM que dizer o que fazer. O caso fácil é quando o ledger já gravou o
     * `flpCod`: aponta-se o lote e acabou.
     *
     * O caso difícil é a morte na janela entre o `criarLote` responder e o ledger gravar —
     * aí não há `flpCod` nenhum, e a versão anterior desta mensagem simplesmente dizia
     * "confira o fin015", o que num grid de milhares de rascunhos não é uma instrução, é um
     * encolher de ombros. Com filial, banco e horário dá para varrer o intervalo certo.
     */
    private static montarMensagem = (p: {
        nativeFlpCod?: number;
        etapa?: string;
        filCod?: number;
        bncCod?: number;
        criadoEm?: string;
    }): string => {
        const abertura = 'Há uma geração de remessa anterior sem confirmação para este lote.';
        const risco = 'Repetir agora poderia gerar um segundo pagamento.';

        if (p.nativeFlpCod) {
            return `${abertura} O lote ${p.nativeFlpCod} pode ter ficado órfão no Conexos (parou em "${p.etapa ?? '?'}"). Confira no fin015 e cancele-o antes de tentar de novo — ${risco}`;
        }

        const desde = p.criadoEm
            ? new Date(p.criadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
            : undefined;
        const onde = [
            p.filCod !== undefined ? `filial ${p.filCod}` : undefined,
            p.bncCod !== undefined ? `banco ${p.bncCod}` : undefined,
        ]
            .filter(Boolean)
            .join(', ');

        return (
            `${abertura} A interrupção foi ANTES de registrarmos o número do lote, então pode existir ` +
            `um rascunho órfão no Conexos sem trilha nossa. Procure no fin015 por rascunhos${onde ? ` da ${onde}` : ''}` +
            `${desde ? `, criados a partir de ${desde}` : ''}, ainda em aberto e sem títulos — cancele o que encontrar ` +
            `antes de tentar de novo. ${risco}`
        );
    };
}
