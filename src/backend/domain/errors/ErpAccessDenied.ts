import ErpResponseReader from './ErpResponseReader.js';

/** Recorte ÚTIL do envelope `ACCESS_DENIED` — só o que responde "quem, o quê, onde, com quem resolvo". */
export interface ErpAccessDeniedInfo {
    /** Usuário do ERP sob o qual a chamada correu (`usnDesNomeRequest`). */
    usuario?: string;
    /** Operação negada, em PT-BR (`CONSULTA`, `INCLUSÃO`, …), derivada do `generatedBy`. */
    acao?: string;
    /** Nome de arquivo da tela (`IMP_223`, `FIN_010`) — é o que o admin do ERP procura. */
    form?: string;
    /** Nome humano da tela (`DECLARAÇÃO ÚNICA DE IMPORTAÇÃO (DUIMP)`). */
    formNome?: string;
    /** Caminho de menu (`Despacho Aduaneiro / Pucomex`) — vai ao log, não à frase. */
    caminho?: string;
    /** Quem pode conceder o acesso (`gerentesUsuario`), sem a conta genérica do fornecedor. */
    gerentes: string[];
}

/**
 * ErpAccessDenied — leitura e tradução do envelope `ACCESS_DENIED` do Conexos, o único
 * erro do ERP que já chega dizendo exatamente como se resolve.
 *
 * Contexto (prod, 2026-08-06): o "Processar" da aba Automáticas morria em `API 500 —
 * Internal server error`. A causa estava inteira no corpo do 403 — o usuário do ERP, a
 * tela negada (`IMP_223`/DUIMP), a operação (`SELECT`) e a lista de quem libera — e era
 * descartada, porque este envelope não tem `messages[]` nem `itemMessages`: as duas formas
 * que o `ErpErrorInterpreter` sabia ler. O diagnóstico custava uma escavação no log do Render.
 *
 * Por que módulo próprio: o `ErpResponseReader` é leitura CRUA, sem tradução; o
 * `ErpErrorInterpreter` mora em `service/permutas` e o `ConexosError` (em `errors/`) não pode
 * depender dele. Este módulo é o dono do envelope de ponta a ponta — parse e frase — e os três
 * consumidores leem daqui. Um envelope, um lugar.
 *
 * NUNCA lança: todo consumidor está num caminho de tratamento de erro, onde um throw viraria
 * justamente o 500 genérico que este parser existe para explicar.
 */
export default class ErpAccessDenied {
    /** Operação do ERP → substantivo PT-BR. Valor fora do mapa é usado cru (rastreável). */
    private static readonly ACAO_PT: Record<string, string> = {
        SELECT: 'CONSULTA',
        INSERT: 'INCLUSÃO',
        UPDATE: 'ALTERAÇÃO',
        DELETE: 'EXCLUSÃO',
    };

    /**
     * Conta genérica do fornecedor: aparece em todo `gerentesUsuario`, mas não é uma pessoa a
     * quem o analista possa pedir acesso. Mandá-lo "falar com CONEXOS" é conselho morto.
     */
    private static readonly GERENTE_GENERICO = 'CONEXOS';

    /**
     * Lê o envelope de um erro capturado (direto ou aninhado no `cause`). `undefined` quando a
     * falha não é de permissão — o chamador então segue pelo caminho de erro normal.
     */
    public static parse = (err: unknown): ErpAccessDeniedInfo | undefined => {
        const data = ErpResponseReader.responseOf(err)?.data;
        if (data === null || typeof data !== 'object') return undefined;

        const envelope = data as { type?: unknown; permRequest?: unknown };
        const perm =
            envelope.permRequest !== null && typeof envelope.permRequest === 'object'
                ? (envelope.permRequest as Record<string, unknown>)
                : undefined;

        // Aceita o envelope pelo `type` OU por um `permRequest` que identifique a tela — o ERP já
        // variou a forma antes, e reconhecer a permissão negada vale mais que exigir o rótulo.
        const declarado = envelope.type === 'ACCESS_DENIED';
        const identificaTela = ErpAccessDenied.str(perm?.cpoDesArquivo) !== undefined;
        if (!declarado && !identificaTela) return undefined;

        const generatedBy =
            perm?.generatedBy !== null && typeof perm?.generatedBy === 'object'
                ? (perm.generatedBy as Record<string, unknown>)
                : undefined;

        const usuario = ErpAccessDenied.str(perm?.usnDesNomeRequest);
        const acao = ErpAccessDenied.acaoPt(ErpAccessDenied.str(generatedBy?.type));
        const form = ErpAccessDenied.str(perm?.cpoDesArquivo);
        const formNome = ErpAccessDenied.str(perm?.cpoDesNome);
        const caminho = ErpAccessDenied.str(perm?.caminho);

        return {
            ...(usuario !== undefined ? { usuario } : {}),
            ...(acao !== undefined ? { acao } : {}),
            ...(form !== undefined ? { form } : {}),
            ...(formNome !== undefined ? { formNome } : {}),
            ...(caminho !== undefined ? { caminho } : {}),
            gerentes: ErpAccessDenied.gerentesOf(perm?.gerentesUsuario),
        };
    };

    /**
     * A frase que o analista lê. PT-BR por ser texto de operação; nomeia a tela pelo
     * `cpoDesArquivo` porque é a chave que o admin do ERP usa para conceder o acesso.
     * Só o texto composto cruza para o browser — o `permRequest` cru fica no log.
     */
    public static describe = (info: ErpAccessDeniedInfo): string => {
        const quem =
            info.usuario !== undefined
                ? `Seu usuário Conexos (${info.usuario})`
                : 'Seu usuário Conexos';
        const oQue = info.acao ?? 'acesso';
        const onde = info.form ?? 'uma tela do ERP';
        const detalhe = info.formNome !== undefined ? ` — ${info.formNome}` : '';
        const comQuem =
            info.gerentes.length > 0 ? ` Peça liberação a: ${info.gerentes.join(', ')}.` : '';
        return `${quem} não tem permissão de ${oQue} em ${onde}${detalhe}.${comQuem}`;
    };

    /** Atalho para os consumidores que só querem a frase (ou nada). */
    public static describeIfDenied = (err: unknown): string | undefined => {
        const info = ErpAccessDenied.parse(err);
        return info !== undefined ? ErpAccessDenied.describe(info) : undefined;
    };

    /** String não-vazia, ou `undefined`. O ERP manda `null` e números onde promete texto. */
    private static str = (raw: unknown): string | undefined => {
        if (typeof raw !== 'string') return undefined;
        const trimmed = raw.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    };

    private static acaoPt = (tipo?: string): string | undefined =>
        tipo !== undefined ? (ErpAccessDenied.ACAO_PT[tipo] ?? tipo) : undefined;

    private static gerentesOf = (raw: unknown): string[] => {
        if (!Array.isArray(raw)) return [];
        return raw
            .map((g) =>
                g !== null && typeof g === 'object'
                    ? ErpAccessDenied.str((g as Record<string, unknown>).usnDesNome)
                    : undefined,
            )
            .filter((n): n is string => n !== undefined && n !== ErpAccessDenied.GERENTE_GENERICO);
    };
}
