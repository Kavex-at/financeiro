import { z } from 'zod';

/**
 * Zod schemas que validam as rows WIRE do Conexos consumidas na Fatia 1 de
 * permutas. Validação nos boundaries (CLAUDE.md): coage números com segurança,
 * rejeita rows sem identidade (`docCod`/`priCod`). Sem `!` non-null.
 *
 * Conexos retorna muitos campos; `.passthrough()` preserva o resto sem falhar.
 */

/** Coage um valor wire (number | string numérica) para `number`; rejeita lixo. */
const wireNumber = z.union([z.number(), z.string()]).transform((v, ctx) => {
    const n = typeof v === 'number' ? v : Number.parseFloat(v);
    if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'not a finite number' });
        return z.NEVER;
    }
    return n;
});

/** Identidade de documento: `docCod`/`priCod` aceitos como number|string → string. */
const wireId = z.union([z.number(), z.string()]).transform((v) => String(v));

/**
 * Row de documento financeiro `com298` (PROFORMA/INVOICE). Exige `docCod` e
 * `priCod`; demais campos opcionais (o `ConexosClient` mapper coalesce defaults).
 */
export const com298RowSchema = z
    .object({
        docCod: wireId,
        priCod: wireId,
    })
    .passthrough();

export type Com298Row = z.infer<typeof com298RowSchema>;

/**
 * Row de título a-pagar `com308.finTituloFin` (taxa/principal da variação).
 * `titCod` obrigatório; taxa/valor opcionais (`undefined` distinto de `0`).
 */
export const com308RowSchema = z
    .object({
        titCod: wireId,
        titFltTaxaMneg: wireNumber.optional(),
        titMnyValorMneg: wireNumber.optional(),
        titMnyValor: wireNumber.optional(),
        titMnyTotPago: wireNumber.optional(),
        moeCodMneg: wireNumber.optional(),
        moeEspNome: z.union([z.string(), z.number()]).optional(),
    })
    .passthrough();

export type Com308Row = z.infer<typeof com308RowSchema>;

/**
 * Row de declaração aduaneira `imp019` (D.I) / `imp223` (DUIMP). Exige `priCod`
 * (vínculo + existência para o Gate 4 XOR).
 *
 * ⏸ GATED-P0-4: o campo wire da data-base NÃO é conhecido — por isso NÃO há
 * campo `dataBase` aqui (não chutar o nome). A extração da data fica no mapper
 * plugável `mapDeclaracaoDataBase` quando o probe capturar o campo.
 */
export const declaracaoRowSchema = z
    .object({
        priCod: wireId,
    })
    .passthrough();

export type DeclaracaoRow = z.infer<typeof declaracaoRowSchema>;
