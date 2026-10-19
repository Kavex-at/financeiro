import ModoPorFilial from './ModoPorFilial.js';

/** Modos do ajuste de centavos do título, por filial (I18l, ADR-0073). Default `off`. */
export const MODO_AJUSTE = {
    /** Default. Nada acontece; a UI mostra "diferença de centavos — ajuste desligado". */
    OFF: 'off',
    /** I18a inteira AO VIVO (leituras no ERP), zero escrita; grava `AJUSTE_SIMULADO`. */
    SHADOW: 'shadow',
    /** Executa a renegociação (I18c–j). */
    ON: 'on',
} as const;
export type ModoAjuste = (typeof MODO_AJUSTE)[keyof typeof MODO_AJUSTE];

/** O que decide o modo efetivo — tudo vem do `EnvironmentProvider` e do marcador do processo. */
export interface ConfiguracaoModoAjuste {
    /** `SISPAG_AJUSTE_CENTAVOS_FILIAIS` bruto (mesmo parse da I17k). */
    filiais: string;
    /** `SISPAG_AJUSTE_CENTAVOS_LOGIN_SONDADO`: o login aprovado na sonda G1. */
    loginSondado: string;
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
    /** Por que o `on` configurado caiu para `shadow` (pt-BR, para o `warn`). */
    avisos: string[];
}

const normaliza = (login: string): string => login.trim().toLowerCase();

/**
 * Modo efetivo do ajuste na filial (I18f, I18l, M3). Puro, fail-closed:
 *  - parse da flag igual ao do vínculo (`ModoPorFilial`), inválido ⇒ `off` em tudo;
 *  - `on` só sobrevive no PROCESSO DO SERVIDOR, com credencial do servidor, login sondado (G1)
 *    igual ao do servidor e kill-switches ligados. Qualquer falha rebaixa a `shadow` (nunca
 *    promove `off`), com o motivo em `avisos`.
 */
export default class ModoAjusteCentavos {
    public static resolverModoEfetivo = (
        filCod: number,
        c: ConfiguracaoModoAjuste,
    ): ModoEfetivoAjuste => {
        const configurado = ModoPorFilial.daFilial(filCod, ModoPorFilial.parse(c.filiais));
        if (configurado !== MODO_AJUSTE.ON) return { modo: configurado, avisos: [] };
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
        } else if (
            c.loginSondado.trim() === '' ||
            normaliza(c.loginSondado) !== normaliza(c.conexosLogin)
        ) {
            avisos.push(
                'ajuste de centavos: login do servidor diferente do login sondado (G1) — só shadow até nova sonda',
            );
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
