import { z } from 'zod';

const numOpt = z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.coerce.number().finite().optional().catch(undefined),
);

/** Campos de valor da linha do grid de pendentes do `fin015` (`titulosPendentes/list`). */
const VALORES_PENDENTE_SCHEMA = z
    .object({
        titMnyValor: numOpt,
        titMnyLiquido: numOpt,
        titMnyJuros: numOpt,
        titMnyDesconto: numOpt,
    })
    .passthrough();

export type ValorDoItem = { disponivel: true; valor: number } | { disponivel: false };

/**
 * Valor com que o item vai ao `importar` do `fin015` (I17n, ADR-0073): o LÍQUIDO do título no grid
 * de pendentes (`titMnyLiquido`), nunca o base (`titMnyValor`) quando há juros/desconto. HML
 * 536/2: o `.REM` paga o valor do título; importar pelo base pagaria 1 centavo a menos.
 *
 * Sem `titMnyLiquido` (o grid de PRD nunca o traz: 3136 de 3136 linhas em 2026-10-20; o título
 * renegociado 536/2 vem como `titMnyValor 53,53` + `titMnyJuros 0,01`): `titMnyValor + juros −
 * desconto`, com nulo/ausente = 0. Juros/desconto ilegível, base ausente ou líquido negativo ⇒
 * indisponível (o chamador lança `NetValueUnavailableError`). Nunca o snapshot do item. Puro.
 */
export default class ValorItemImport {
    public static valorDoItem = (raw: Record<string, unknown>): ValorDoItem => {
        const lido = VALORES_PENDENTE_SCHEMA.safeParse(raw);
        if (!lido.success) return { disponivel: false };
        const { titMnyValor, titMnyLiquido, titMnyJuros, titMnyDesconto } = lido.data;
        if (titMnyLiquido !== undefined) return { disponivel: true, valor: titMnyLiquido };
        const jurosIlegivel = raw.titMnyJuros != null && titMnyJuros === undefined;
        const descontoIlegivel = raw.titMnyDesconto != null && titMnyDesconto === undefined;
        if (jurosIlegivel || descontoIlegivel || titMnyValor === undefined) {
            return { disponivel: false };
        }
        const centavos =
            Math.round(titMnyValor * 100) +
            Math.round((titMnyJuros ?? 0) * 100) -
            Math.round((titMnyDesconto ?? 0) * 100);
        if (centavos < 0) return { disponivel: false };
        return { disponivel: true, valor: centavos / 100 };
    };
}
