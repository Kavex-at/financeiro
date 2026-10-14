/** Modos do vínculo do código de barras ao item, por filial (ADR-0071, I17k). */
export const MODO_VINCULO = {
    /** Default. Nada muda: a I15b vale integral. */
    OFF: 'off',
    /** Só pré-condições e verificações LOCAIS; zero chamada nova ao ERP. */
    SHADOW: 'shadow',
    /** Executa a sequência I17e no rascunho. */
    ON: 'on',
} as const;

export type ModoVinculo = (typeof MODO_VINCULO)[keyof typeof MODO_VINCULO];

const MODOS_VALIDOS: ReadonlySet<string> = new Set(Object.values(MODO_VINCULO));

/**
 * Configuração `SISPAG_BIND_CODBAR_FILIAIS="1:shadow,7:off"` (lida pelo `EnvironmentProvider`).
 *
 * FAIL-CLOSED: ausente, vazia, modo desconhecido, filial inválida/duplicada, token vazio ou
 * qualquer outro lixo ⇒ a entrada INTEIRA vira `off`. Parse inválido nunca vira parcial — uma
 * configuração torta jamais liga uma filial "pela metade".
 */
export default class ModoVinculoCodigoBarras {
    public static parse = (bruto: string | undefined): ReadonlyMap<number, ModoVinculo> => {
        const vazio = new Map<number, ModoVinculo>();
        if (bruto === undefined || bruto.trim() === '') return vazio;
        const mapa = new Map<number, ModoVinculo>();
        for (const token of bruto.split(',')) {
            const partes = token.split(':');
            if (partes.length !== 2) return vazio;
            const filBruto = (partes[0] as string).trim();
            const modo = (partes[1] as string).trim();
            if (!/^\d+$/.test(filBruto) || !MODOS_VALIDOS.has(modo)) return vazio;
            const filCod = Number(filBruto);
            if (!Number.isInteger(filCod) || filCod <= 0 || mapa.has(filCod)) return vazio;
            mapa.set(filCod, modo as ModoVinculo);
        }
        return mapa;
    };

    /**
     * Modo efetivo da filial. O kill-switch global `sispagLiveWriteEnabled` derruba também este
     * vínculo; `SISPAG_DDA_ASSOC_ENABLED=false` NÃO o desliga (nem entra aqui).
     */
    public static resolverModo = (
        filCod: number,
        mapa: ReadonlyMap<number, ModoVinculo>,
        liveWriteEnabled: boolean,
    ): ModoVinculo => {
        if (!liveWriteEnabled) return MODO_VINCULO.OFF;
        return mapa.get(filCod) ?? MODO_VINCULO.OFF;
    };
}
