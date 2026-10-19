/** Os três modos de rollout por filial (I17k, I18l): mesmos valores para vínculo e ajuste. */
export const MODO_POR_FILIAL = { OFF: 'off', SHADOW: 'shadow', ON: 'on' } as const;
export type ModoPorFilialValor = (typeof MODO_POR_FILIAL)[keyof typeof MODO_POR_FILIAL];

const MODOS_VALIDOS: ReadonlySet<string> = new Set(Object.values(MODO_POR_FILIAL));

/** Chave do modo GLOBAL no mapa (valor `on`/`shadow`/`off` sozinho); nenhuma filial real é 0. */
export const CHAVE_GLOBAL = 0;

/**
 * Parser ÚNICO das flags de rollout por filial (`SISPAG_BIND_CODBAR_FILIAIS`, ADR-0071, e
 * `SISPAG_AJUSTE_CENTAVOS_FILIAIS`, ADR-0073). Duas formas:
 *   - modo único `on` | `shadow` | `off`: vale para TODAS as filiais;
 *   - lista por filial `"1:shadow,7:off"`: filial ausente = `off`.
 * As duas formas não se misturam (`"on,1:off"` é inválido).
 *
 * FAIL-CLOSED: ausente, vazia, modo desconhecido, filial inválida/duplicada, token vazio ou
 * qualquer outro lixo ⇒ a entrada INTEIRA vira `off`. Parse inválido nunca vira parcial.
 */
export default class ModoPorFilial {
    public static parse = (bruto: string | undefined): ReadonlyMap<number, ModoPorFilialValor> => {
        const vazio = new Map<number, ModoPorFilialValor>();
        if (bruto === undefined || bruto.trim() === '') return vazio;
        const unico = bruto.trim();
        if (MODOS_VALIDOS.has(unico)) {
            return new Map([[CHAVE_GLOBAL, unico as ModoPorFilialValor]]);
        }
        const mapa = new Map<number, ModoPorFilialValor>();
        for (const token of bruto.split(',')) {
            const partes = token.split(':');
            if (partes.length !== 2) return vazio;
            const filBruto = (partes[0] as string).trim();
            const modo = (partes[1] as string).trim();
            if (!/^\d+$/.test(filBruto) || !MODOS_VALIDOS.has(modo)) return vazio;
            const filCod = Number(filBruto);
            if (!Number.isInteger(filCod) || filCod <= 0 || mapa.has(filCod)) return vazio;
            mapa.set(filCod, modo as ModoPorFilialValor);
        }
        return mapa;
    };

    /** Modo configurado da filial (sem kill-switch): a filial, senão o global, senão `off`. */
    public static daFilial = (
        filCod: number,
        mapa: ReadonlyMap<number, ModoPorFilialValor>,
    ): ModoPorFilialValor => mapa.get(filCod) ?? mapa.get(CHAVE_GLOBAL) ?? MODO_POR_FILIAL.OFF;
}
