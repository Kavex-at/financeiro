import ModoPorFilial from './ModoPorFilial.js';

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

/**
 * Configuração `SISPAG_BIND_CODBAR_FILIAIS` (lida pelo `EnvironmentProvider`). Parse no
 * `ModoPorFilial` (parser único, fail-closed: entrada inválida ⇒ `off` em tudo).
 */
export default class ModoVinculoCodigoBarras {
    public static parse = (bruto: string | undefined): ReadonlyMap<number, ModoVinculo> =>
        ModoPorFilial.parse(bruto);

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
        return ModoPorFilial.daFilial(filCod, mapa);
    };
}
