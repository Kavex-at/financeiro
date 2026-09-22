import { z } from 'zod';

/**
 * Números vindos do WIRE do Conexos — onde `null` significa AUSÊNCIA, não zero.
 *
 * Existe por causa de um comportamento do Zod que não é óbvio e que o repo já pagou duas vezes:
 * a coerção roda ANTES do `.optional()`, e `Number(null) === 0`. Medido na versão que usamos
 * (zod 3.25.76):
 *
 * | expressão                                  | `null`      | `''`        |
 * |--------------------------------------------|-------------|-------------|
 * | `z.coerce.number().optional()`             | **`0`** ⚠️  | **`0`** ⚠️  |
 * | `z.coerce.number().optional().catch(undef)`| **`0`** ⚠️  | **`0`** ⚠️  |
 * | `z.coerce.number().int()` (obrigatório)    | **`0`** ⚠️  | **`0`** ⚠️  |
 * | `z.coerce.number().int().optional().default(2)` | **`0`** ⚠️ | **`0`** ⚠️ |
 * | `z.coerce.number().nullish()`               | `null` ✅   | **`0`** ⚠️  |
 * | `z.coerce.number().int().positive()`        | FAIL ✅     | FAIL ✅     |
 *
 * Três consequências que motivam este helper:
 *
 * 1. **`.catch(undefined)` NÃO protege.** O `catch` só dispara em FALHA, e coagir `null` tem
 *    sucesso. Era a suposição por trás do `numOpt` original, e ela é falsa.
 * 2. **`.default(N)` com N≠0 é silenciosamente ignorado** para `null` — o default só vale para
 *    `undefined`. Um campo declarado `default(2)` entrega `0`.
 * 3. **`.nullish()` cobre `null` mas não `''`**, e o Conexos manda string vazia em campos de
 *    texto-numérico.
 *
 * O dano nunca é um erro: é um valor plausível. Zero vira "R$ 0,00", vira `1970-01-01` quando o
 * campo é epoch, vira o membro `0` de um enum — e, o pior, passa em `!= null` e em `!== undefined`,
 * derrotando exatamente os guards que o código escreve para detectar ausência.
 *
 * Precedente: `ConexosExtratoClient` já fazia este `preprocess` à mão desde que um
 * `exiMnyLctoCr: null` do `fin095` virou zero e descartou o lançamento. Este módulo é aquele
 * remédio, extraído para não depender de cada autor lembrar.
 */
export default class WireNumber {
    /**
     * `null` e `''` do ERP são AUSÊNCIA. Roda antes da coerção — que é o ponto: depois dela já
     * é tarde, o zero já foi fabricado.
     */
    private static readonly asAbsent = (v: unknown): unknown =>
        v === null || v === '' ? undefined : v;

    /**
     * Campo OPCIONAL: ausente vira `undefined`, e `undefined` é o que os guards a jusante
     * (`!= null`, `!== undefined`, `?? 'ausente'`) esperam encontrar. Valor ilegível também vira
     * `undefined` — para um campo que já é opcional, "não deu para ler" e "não veio" são a mesma
     * decisão para quem chama.
     */
    public static readonly optional = z.preprocess(
        WireNumber.asAbsent,
        z.coerce.number().optional().catch(undefined),
    );

    /** Idem, para campo inteiro. */
    public static readonly intOptional = z.preprocess(
        WireNumber.asAbsent,
        z.coerce.number().int().optional().catch(undefined),
    );

    /**
     * Campo OBRIGATÓRIO: ausente REJEITA o parse, em vez de virar zero.
     *
     * É a doutrina que o repo já aplica com `.positive()` nos identificadores de borderô
     * ("sem `borCod` numérico, abortamos — não cria borderô fantasma") estendida aos campos
     * em que `0` é um valor de domínio legítimo e por isso `.positive()` não serve: um código
     * de status, um percentual de rateio, uma data epoch. Aí o único jeito de separar "o ERP
     * não disse" de "o ERP disse zero" é recusar a linha e deixar o chamador decidir.
     */
    public static readonly required = z.preprocess(WireNumber.asAbsent, z.coerce.number());

    /** Idem, para campo inteiro obrigatório. */
    public static readonly intRequired = z.preprocess(WireNumber.asAbsent, z.coerce.number().int());
}
