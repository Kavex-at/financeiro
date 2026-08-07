import { injectable, singleton } from 'tsyringe';
import ErpAccessDenied from '../../errors/ErpAccessDenied.js';
import ErpResponseReader from '../../errors/ErpResponseReader.js';
import type { ErpMessage } from '../../errors/ErpResponseReader.js';

// `ErpMessage` mudou de casa (agora nasce no `ErpResponseReader`, junto da leitura crua que a produz);
// o re-export mantém os importadores existentes deste módulo funcionando.
export type { ErpMessage } from '../../errors/ErpResponseReader.js';

/** Leitura normalizada de um erro do ERP (Conexos `fin010`/`fin014`). */
export interface ErpErrorInterpretation {
    status?: number;
    data?: unknown;
    /** A KEY do erro (ex.: `Generic.ERROR_MESSAGE`, `FIN_010.*`). */
    key?: string;
    /** A RAZÃO REAL crua do ERP (`vars.msg`), quando presente. */
    reason?: string;
    /** Mensagem a exibir: razão real > tradução PT > key > `Error.message`. */
    friendly: string;
}

/**
 * ErpErrorInterpreter — fonte ÚNICA de tradução dos erros do `fin010` (unifica os mapas PT antes
 * divergentes de `routes/permutas.ts` e `ReconciliacaoPermutaService`). Extrai a razão REAL do ERP,
 * que vem escondida em `messages[0].vars.msg` quando a key é o envelope genérico `Generic.ERROR_MESSAGE`
 * (ex.: "CONTA DE DESCONTO NÃO INFORMADA!!!") — antes descartada, deixando o usuário com um texto genérico.
 *
 * `interpret` é para um erro CAPTURADO (lê `err.response.data` ou `err.cause.response.data`);
 * `describeMessage` é para uma mensagem de envelope já em mãos (guarda `valid==='ERRO'` do handshake).
 */
@singleton()
@injectable()
export default class ErpErrorInterpreter {
    /** Traduções PT por key — superset dos dois mapas anteriores. */
    private readonly ptByKey: Record<string, string> = {
        'FIN_014.DELETAR_REGISTRO_ESTORNO':
            'Não é possível excluir: este borderô tem um estorno vinculado no ERP.',
        'FIN_014.FIN_IMPOSSIVEL_ALTERAR_REGISTRO':
            'Não é possível alterar: borderô finalizado. Estorne antes de mexer.',
        'FIN_010.FIN_IMPOSSIVEL_ALTERAR_REGISTRO': 'Borderô finalizado — não é possível alterar.',
        'FIN_010.DATA_BLOQUEADA_PELA_CONTABILIDADE':
            'Data do borderô bloqueada pela contabilidade (período fechado). Use uma data em período aberto.',
        CnxValidatorMny: 'Valor monetário inválido (precisão > 2 casas).',
        CnxValidatorDescr: 'Descrição/comentário inválido (precisa estar em MAIÚSCULAS).',
        // Fallback só para o Generic SEM `vars.msg` — a razão real (quando existe) vence antes disto.
        'Generic.ERROR_MESSAGE':
            'O ERP recusou esta operação para o borderô (estado incompatível com a ação).',
    };

    /**
     * Itens de validação (`item`) com tradução PT-BR dedicada — surfacados a partir do envelope
     * `SELECTION_ERROR`/`VALIDATION` do `gerDocProcesso` (que o `{messages}` genérico NÃO cobre).
     */
    private readonly ptByItem: Record<string, (atributo: string) => string> = {
        gcdDesNomeProc: (a) =>
            `Este processo NÃO aceita a configuração de documento "${a}" — ou seja, não é elegível para ` +
            'esta Solicitação de Numerário. Escolha um processo que aceite essa configuração.',
        endCod: () =>
            'Endereço fiscal do processo inválido/ausente — regularize o cadastro da pessoa no Conexos.',
        pgtCod: () =>
            'Condição de pagamento incompatível com o cadastro da pessoa — ajuste antes de gerar.',
    };

    public interpret = (err: unknown): ErpErrorInterpretation => {
        const resp = this.extractResponse(err);
        const data = resp?.data as { messages?: ErpMessage[] } | undefined;
        const picked = this.pickMessage(data?.messages);
        const key = picked?.message;
        const reason = this.extractReason(picked);
        const fallback = err instanceof Error ? err.message : 'erro ao executar a ação no Conexos';
        // Envelope de VALIDAÇÃO por-item (SELECTION_ERROR/VALIDATION) — mais específico que o `{messages}`.
        const itemFriendly = this.interpretItemMessages(resp?.data);
        // Permissão negada vence tudo: o `ACCESS_DENIED` não traz `messages[]` nem `itemMessages`,
        // então sem esta leitura ele caía no `fallback` (= `Conexos call to <endpoint> failed`) e o
        // motivo real — qual tela falta, para quem — morria no payload.
        const negado = ErpAccessDenied.describeIfDenied(err);
        return {
            ...(resp?.status !== undefined ? { status: resp.status } : {}),
            ...(data !== undefined ? { data } : {}),
            ...(key !== undefined ? { key } : {}),
            ...(reason !== undefined ? { reason } : {}),
            friendly: negado ?? itemFriendly ?? this.friendlyFor(key, reason, fallback),
        };
    };

    /**
     * Extrai a 1ª mensagem de VALIDAÇÃO POR-ITEM dos envelopes do `gerDocProcesso`:
     *   `{type:"SELECTION_ERROR", validation:{main:{itemMessages:[{item, messages:[{message, vars:{atributo}}]}]}}}`
     *   `{type:"VALIDATION", itemMessages:[{item, messages:[{message, constraint}]}]}`
     * Vira um texto humano ("Campo X inválido: Y"), com tradução dedicada p/ itens conhecidos
     * (ex.: `gcdDesNomeProc` = processo inelegível). NUNCA lança — é um error-handler.
     */
    private interpretItemMessages = (data: unknown): string | undefined => {
        const d = data as
            | { validation?: { main?: { itemMessages?: unknown } }; itemMessages?: unknown }
            | undefined;
        const list = d?.validation?.main?.itemMessages ?? d?.itemMessages;
        if (!Array.isArray(list) || list.length === 0) return undefined;
        const first = list[0] as
            | {
                  item?: string;
                  messages?: Array<{
                      message?: string;
                      vars?: { atributo?: unknown };
                      constraint?: string;
                  }>;
              }
            | undefined;
        const item = typeof first?.item === 'string' ? first.item : undefined;
        const msg = Array.isArray(first?.messages) ? first?.messages[0] : undefined;
        const atributoRaw = msg?.vars?.atributo;
        const atributo = typeof atributoRaw === 'string' ? atributoRaw : String(atributoRaw ?? '');
        const detalhe = msg?.constraint ?? msg?.message ?? '';
        if (item !== undefined && this.ptByItem[item] !== undefined) {
            return this.ptByItem[item](atributo);
        }
        if (item !== undefined) {
            const suffix = atributo || detalhe;
            return `Campo "${item}" inválido no documento${suffix ? `: ${suffix}` : ''} — o ERP recusou a geração.`;
        }
        return undefined;
    };

    public describeMessage = (msg: ErpMessage): string => {
        const reason = this.extractReason(msg);
        return this.friendlyFor(msg.message, reason, msg.message ?? 'sem detalhe');
    };

    /** Prioridade: razão real (Generic) → tradução PT → razão → key → fallback. */
    private friendlyFor = (key?: string, reason?: string, fallback = ''): string => {
        if (key === 'Generic.ERROR_MESSAGE' && reason !== undefined) return reason;
        const mapped = key !== undefined ? this.ptByKey[key] : undefined;
        if (mapped !== undefined) return mapped;
        return reason ?? key ?? fallback;
    };

    // As três leituras cruas abaixo delegam ao `ErpResponseReader` — o MESMO ponto que o
    // `ConexosError` usa para decidir se a falha é recusa ou indisponibilidade. Tê-las duplicadas
    // aqui foi como a classificação e a tradução chegaram a discordar sobre o mesmo payload.

    /** `vars.msg` só conta se for string não-vazia (o ERP às vezes manda outros tipos ou vazio). */
    private extractReason = (msg?: ErpMessage): string | undefined =>
        ErpResponseReader.reasonOf(msg);

    /** Prefere a 1ª mensagem `valid==='ERRO'`; senão a 1ª do envelope. Robusto a envelope malformado. */
    private pickMessage = (messages?: ErpMessage[]): ErpMessage | undefined =>
        ErpResponseReader.pickMessage(messages);

    /** O erro do ERP pode vir direto (`err.response`) ou aninhado no `cause` (ConexosError). */
    private extractResponse = (err: unknown): { status?: number; data?: unknown } | undefined =>
        ErpResponseReader.responseOf(err);
}
