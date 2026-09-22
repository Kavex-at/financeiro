# conexos-numopt-null — follow-ups (Batch B)

Branch `fix/conexos-numopt-null-safety` · 2026-09-22 · v0.39.3

Extensão da correção da v0.39.2 (SISPAG) ao resto dos clients do Conexos. Escopo desta leva,
decidido com o Yuri: **helper compartilhado + os alvos de dinheiro/fiscal de maior raio**.

## Semântica MEDIDA do zod 3.25.76 (fixada em `WireNumber.test.ts`)

| expressão | `null` | `''` |
|---|---|---|
| `z.coerce.number().optional()` | **0** ⚠️ | **0** ⚠️ |
| `z.coerce.number().optional().catch(undefined)` | **0** ⚠️ | **0** ⚠️ |
| `z.coerce.number().int()` (obrigatório) | **0** ⚠️ | **0** ⚠️ |
| `z.coerce.number().int().optional().default(2)` | **0** ⚠️ | **0** ⚠️ |
| `z.coerce.number().nullish()` | `null` ✅ | **0** ⚠️ |
| `z.coerce.number().int().positive()` | FAIL ✅ | FAIL ✅ |

Três achados que corrigem a premissa do ticket original:

1. **`.nullish()`/`.nullable()` JÁ protegem contra `null`** — `ZodNullable` curto-circuita antes da
   coerção. Isso tira da lista crítica boa parte das 82 ocorrências. Continuam expostos a `''`.
2. **`.catch(undefined)` NÃO protege** — o `catch` só dispara em FALHA, e coagir `null` tem êxito.
3. **`.optional().default(N≠0)` é ignorado para `null`** — armadilha de classe própria.

> A varredura por `z\.coerce\.number\(` **perde ~9 ocorrências** escritas multi-linha
> (`z.coerce\n.number()`). Qualquer auditoria futura precisa de um grep multi-linha.

## Feito nesta PR

| alvo | mudança |
|---|---|
| `domain/libs/zod/WireNumber.ts` (novo) | `optional`/`intOptional` (ausente → `undefined`) e `required`/`intRequired` (ausente → **falha o parse**) |
| `ConexosNdeFiscalClient` DOC_STATUS | `docVldNfehom`, `vldStatus`, `vldAutorizado`, `docMnyValor` → `intOptional`/`optional` |
| `ConexosNdeFiscalClient` DOC_FISCAL | `fisVldTipoNfDebito` → `intRequired` (é eco de escrita) |
| `ConexosGerDocProcessoClient` | `total` (percentual de rateio) → `required` |
| `ConexosExtratoClient` | `gerNum`, `exiDtaLcto`, `exiVldTipo` → `*Required`; `numOpt` local passa a apontar para o helper |

## Follow-ups (→ tickets, NÃO implementados)

| id | prio | finding | nota |
|----|------|---------|------|
| nn-1 | P1 | `SolicitacaoNumerarioListItem.ts:26,52,54,56,58,60` — `docDtaEmissao` vira **1970-01-01** na lista de SNs; `vldStatus` vira o rótulo **"SN 0"**; `docVldTipo`/`docVldTipoAdto` fazem a SN **sumir do seletor** sem warn (e a classificam como NC/ND, categoria errada); `mnyBruto`/`docMnyValor` são dinheiro exibido | todos required → `WireNumber.*Required` recusaria a linha. Mudança de comportamento visível ao analista (SN somem da lista em vez de aparecer errada) — merece ciclo próprio com medição antes |
| nn-2 | P1 | `ConexosGerDocProcessoClient.ts:47,48,49,65` `gcdVld*` — `null` vira `gcdVldTela: 0` **literal no payload de ESCRITA** da SN, em vez de campo omitido; 6 call-sites usam o idioma `!== undefined` | mesmo idioma que a coerção derrota. Toca payload de escrita: fazer junto com nn-1 |
| nn-3 | P2 | `ConexosGerDocProcessoClient.ts:148,149` `pesCod`/`endCodFis` entram na URL (`contasProj/list/{gcd}/{pes}/{end}`) — `null` consulta pessoa 0 / endereço 0 | |
| nn-4 | P2 | `ConexosNdeClient.ts:24` `docVldComvalidacoes` — `0` é um valor REAL medido em produção (NDe 18771), então o null coagido é indistinguível de um fato | |
| nn-5 | P2 | `ConexosBaixaClient.ts:23` `borVldTipo: …optional().default(2)` — `null` entrega **0**, ignorando o default declarado. Código de tipo de borderô numa confirmação de escrita irreversível | vale um grep por `optional().default(` com N≠0 no repo inteiro |
| nn-6 | P3 | `routes/sispag.ts:413,414` `gtbCodSeq`/`garCodSeq` usam `.nonnegative()`, que **aceita** o 0 fabricado → consulta ao ERP por config de retorno inexistente em vez de um 400 honesto | trocar por `.positive()` resolve |
| nn-7 | P3 | `http/schemas.ts:15` `page` — `?page=` (string vazia) vira 0, falha o `min(1)` e devolve **400 em vez de aplicar o default 1** | cosmético |
| nn-8 | P3 | `MetricasCicloRepository.ts:11` `valor: z.coerce.number()` — se a função SQL devolver NULL, o relatório de ciclo publica **0** como medição. O `baseline` ao lado é `.nullable()` "por contrato": assimetria | |

## Aprendizado — regra proposta para o CLAUDE.md

Reforça a **R1** já proposta no ciclo `sispag-boundary-fail-closed`, agora com a tabela medida:

```diff
  ### TypeScript Style
+ - **Zod no boundary: `z.coerce.number()` nunca sozinho em campo de ERP.** A coerção roda ANTES do
+   `.optional()`, e `Number(null) === 0` — então `null` vira um zero que passa em `!= null` e em
+   `!== undefined`, derrotando exatamente os guards escritos para detectar ausência. Use
+   `WireNumber` (`domain/libs/zod/WireNumber.ts`): `optional`/`intOptional` para campo opcional,
+   `required`/`intRequired` para obrigatório (que RECUSA a linha em vez de coagir).
+   Não confie em `.catch(undefined)` (só dispara em falha), nem em `.default(N)` (só vale para
+   `undefined`), nem em `.nullish()` sozinho (não cobre `''`). Já custou 3 bugs.
```
