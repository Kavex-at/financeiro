/**
 * Modos do ajuste de centavos do título (I18l, ADR-0074). Sem flag dedicada (emenda 2026-10-20):
 * o ajuste é ativo por padrão e o modo efetivo sai dos kill-switches de escrita e do processo.
 */
export const MODO_AJUSTE = {
    /** I18a inteira AO VIVO (leituras no ERP), zero escrita; grava `AJUSTE_SIMULADO`. */
    SHADOW: 'shadow',
    /** Executa a renegociação (I18c–j). */
    ON: 'on',
} as const;
export type ModoAjuste = (typeof MODO_AJUSTE)[keyof typeof MODO_AJUSTE];

/** O que decide o modo efetivo — tudo vem do `EnvironmentProvider` e do marcador do processo. */
export interface ConfiguracaoModoAjuste {
    /** `CONEXOS_USERNAME` do servidor (a identidade das escritas, I18f). */
    conexosLogin: string;
    sispagLiveWriteEnabled: boolean;
    conexosWriteEnabled: boolean;
    conexosDryRun: boolean;
    /** `ServerProcessMarker.ehServidor()`: falso em job/cron/script. */
    processoServidor: boolean;
}

export interface ModoEfetivoAjuste {
    modo: ModoAjuste;
    /** Por que o ajuste caiu para `shadow` (pt-BR, para o `warn`). */
    avisos: string[];
}

/**
 * Modo efetivo do ajuste (I18f, I18l). Puro, fail-closed: `on` só no PROCESSO DO SERVIDOR, com
 * credencial Conexos do servidor e os kill-switches de escrita ligados (`SISPAG_LIVE_WRITE_ENABLED`,
 * escrita no Conexos, sem `CONEXOS_DRY_RUN`). Qualquer falha rebaixa a `shadow`, com o motivo em
 * `avisos`.
 */
export default class ModoAjusteCentavos {
    public static resolverModoEfetivo = (c: ConfiguracaoModoAjuste): ModoEfetivoAjuste => {
        const avisos = ModoAjusteCentavos.motivosParaRebaixar(c);
        return avisos.length === 0
            ? { modo: MODO_AJUSTE.ON, avisos }
            : { modo: MODO_AJUSTE.SHADOW, avisos };
    };

    private static motivosParaRebaixar = (c: ConfiguracaoModoAjuste): string[] => {
        const avisos: string[] = [];
        if (!c.processoServidor) {
            avisos.push('ajuste de centavos fora do processo do servidor (job/cron): só shadow');
        }
        if (c.conexosLogin.trim() === '') {
            avisos.push('ajuste de centavos sem credencial Conexos do servidor: só shadow');
        }
        if (!c.sispagLiveWriteEnabled) {
            avisos.push('ajuste de centavos: SISPAG_LIVE_WRITE_ENABLED desligado — só shadow');
        }
        if (!c.conexosWriteEnabled) {
            avisos.push('ajuste de centavos: escrita no Conexos desligada — só shadow');
        }
        if (c.conexosDryRun) {
            avisos.push('ajuste de centavos: CONEXOS_DRY_RUN ligado — só shadow');
        }
        return avisos;
    };
}
