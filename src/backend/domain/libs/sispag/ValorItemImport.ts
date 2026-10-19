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
 * Sem `titMnyLiquido`: usa `titMnyValor` SÓ se juros e desconto forem 0/ausentes; senão
 * indisponível (o chamador lança `NetValueUnavailableError`). Nunca o snapshot do item. Puro.
 */
export default class ValorItemImport {
    public static valorDoItem = (raw: Record<string, unknown>): ValorDoItem => {
        const lido = VALORES_PENDENTE_SCHEMA.safeParse(raw);
        if (!lido.success) return { disponivel: false };
        const { titMnyValor, titMnyLiquido, titMnyJuros, titMnyDesconto } = lido.data;
        if (titMnyLiquido !== undefined) return { disponivel: true, valor: titMnyLiquido };
        const semAcrescimos = (titMnyJuros ?? 0) === 0 && (titMnyDesconto ?? 0) === 0;
        const jurosIlegivel = raw.titMnyJuros != null && titMnyJuros === undefined;
        const descontoIlegivel = raw.titMnyDesconto != null && titMnyDesconto === undefined;
        if (!semAcrescimos || jurosIlegivel || descontoIlegivel || titMnyValor === undefined) {
            return { disponivel: false };
        }
        return { disponivel: true, valor: titMnyValor };
    };
}
