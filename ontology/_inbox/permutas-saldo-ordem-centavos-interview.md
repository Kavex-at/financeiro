# Interview (tweak) — `permutas-saldo-ordem-centavos`

**Data:** 2026-09-14 · **Branch:** `fix/permutas-saldo-ordem-centavos` · **Worktree:** `~/kavex-worktrees/permutas-saldo-ordem-centavos`
**Base:** `origin/main` @ `3872903` (v0.36.4) · **Entidade:** `PermutaCandidata` / ação `avaliarElegibilidade` / `AlocacaoPermuta`
**Gatilho:** análise de bloqueados no painel de Permutas com dados reais do banco (ingestão 2026-09-14 15:36 UTC).
**Decisões:** tomadas pelo usuário (tech@kavex.at) em 2026-09-14, via perguntas estruturadas.

---

## Fix 1 — `saldoRestante` desconta alocações já consumidas pelo ERP (bug de implementação)

**Comportamento atual.** `GestaoPermutasService.ts:350-355` (e o teto em `AlocacaoPermutasService.alocar`,
`:241-257`, via `alocacaoRepository.sumByAdiantamento`) calcula:

```
saldoRestante = valorPermutar(ERP, BRL) / taxa  −  Σ TODAS as alocações do adto
```

Mas o `valorPermutar` (`mnyTitPermutar`, lido na ingestão) **já vem abatido** pelo ERP para as alocações
cujo borderô foi **finalizado**. Resultado: o valor consumido é descontado duas vezes.

**Evidência (banco, read-only):** 128 adtos com execução real `settled/parcial`:

| borVldFinalizado do borderô | ERP abateu `mnyTitPermutar`? | adtos |
|---|---|---|
| 1 (finalizado) | **sim** | 125 (+4 com histórico 1,2) |
| 1 | não | 2 · "outro" 1 |
| 0 (em cadastro) | não | 2 |
| 2 / 2,3 | não | 4 |
| borderô ausente de `permuta_bordero` | não | 4 |

Em todos, `permuta_adiantamento.last_seen_at` é posterior à execução. ⇒ **O ERP só abate quando o borderô
é finalizado.**

**Casos canônicos:**
- adto **12860** (INOX, permuta-manual): vmn USD 79.987,19; alocado 49.622,46 (borderô 19981 finalizado);
  ERP `valorPermutar/taxa` = **30.364,73**. Tela hoje: 30.364,73 − 49.622,46 = **−19.257,73** → sai da aba
  Cross-process como se estivesse completo. **Esperado: 30.364,73.**
- adto **9328**: vmn 75.000; alocado 35.347,53 (borderô 19534 finalizado); ERP 39.652,47. Tela hoje
  **4.304,94** (e o teto de nova alocação também). **Esperado: 39.652,47.**
- adtos **9335, 9869, 9870** (borderôs 19254/19255/19256, ausentes de `permuta_bordero`) e **10307**
  (borderô 14944, `borVldFinalizado=2`): ERP NÃO abateu → as alocações não consumidas devem continuar
  sendo descontadas (comportamento atual correto para eles).

**Comportamento desejado.**
```
saldoRestante = valorPermutar/taxa − Σ (parte AINDA NÃO CONSUMIDA de cada alocação)
```
- Alocação **consumida** = tem execução real (`dry_run=false`) `settled` num borderô **finalizado**
  (`borVldFinalizado=1`, não estornado). Para `parcial` finalizado, consome só a parte baixada
  (investigar: `valor_alocado − valor_residual_usd`, e a semântica de re-alocação do par — ADR-0044).
- **Não consumida** (continua descontando): rascunho sem execução, `pending`, `reconciling`, `error`,
  `settled` em borderô em cadastro/cancelado/estornado, ou status do borderô **desconhecido** (conservador:
  subestimar saldo nunca permite super-alocação).
- Aplicar no mesmo critério em TODO lugar que desconta alocações do saldo do adto: `GestaoPermutasService`
  (permuta-manual e casamento-manual) e `AlocacaoPermutasService.alocar` (teto). Uma única fonte da regra.
- Janela conhecida: borderô finalizado DEPOIS da última ingestão → saldo superestimado até a próxima
  ingestão (≤ 6h). Verificar se a baixa (`ReconciliacaoPermutaService`) valida o saldo do adto ao vivo;
  se não, registrar como follow-up (não ampliar escopo).

**Invariantes:** saldo do adto `Σ(alocado) ≤ saldo a permutar` (ADR-0008) continua — agora medido
corretamente. Sem mudança de regra na ontologia além de explicitar a definição de "consumida".

---

## Fix 2 — ordem dos motivos: "Sem D.I" mascara "não pago" e "já permutado" (bug de implementação)

**Comportamento atual.** `ElegibilidadeService.ts:84-91` retorna `BLOQUEADA/data-base-indisponivel`
**antes** de `motivoDoGateFalho` (`:161-172`), que implementa a prioridade documentada
`nao-pago → (ja-permutado | sem-saldo-permutar) → di-duimp-ambos`.
A ontologia (`ontology/actions/avaliar-elegibilidade.md`, "Motivos de bloqueio") já define essa prioridade
("causa-raiz primeiro"); `data-base-indisponivel` só não está citado explicitamente na lista.

**Evidência:** 208 adtos `data-base-indisponivel`:
- 67 **pagos e sem saldo** (INOX 1153: 63, 202: 4). **43** deles têm execução real `settled` pelo painel
  (R$ 18,0 mi baixados) — são permutas concluídas exibidas como "Bloqueada — Sem D.I" e fora do Histórico.
- 50 **não pagos** (38 sem saldo, 12 com saldo) — deveriam aparecer como "Não totalmente pago".

**Comportamento desejado.** Prioridade única:
`nao-pago` → `ja-permutado` (estado `JA_PERMUTADO`) / `sem-saldo-permutar` → `data-base-indisponivel` /
`di-duimp-ambos` → casamento de invoice.
- Roteamento de cliente-filtro inalterado (`BLOQUEADA && pago && saldo > tolerância` → `permuta-manual`):
  um adto pago, com saldo e sem D.I continua `BLOQUEADA/data-base-indisponivel` e é roteado.
- Um adto pago, sem saldo e com `valorPermutado > 0` vira `JA_PERMUTADO` mesmo sem D.I.

**Invariantes:** I2 (D.I XOR DUIMP) inalterado; só a precedência de exibição do motivo muda.

---

## Fix 3 — tolerância de resíduo de centavos: **R$ 1,00** nos Gates 2 e 3 (MUDANÇA DE REGRA)

**Comportamento atual.**
- Gate 2: `valorPermutar > 0` (`ElegibilidadeService.ts:68`; roteamento `EleicaoPermutasService.ts:821`).
- Gate 3: `pago = mnyTitAberto === 0` (`ConexosTitulosClient.mapDetalheTitulos`).

**Evidência:**
- **28** adtos `permuta-manual` (INOX) já baixados ficam na fila com `valorPermutar` residual de
  USD 0,00–0,02 (R$ < 0,15): docs 10208, 10571, 10865, 11286, 11296, 12884, 17081, 17286, 17292, 17872,
  17873, 17890, 17901, 17927, 17930, 20434, 21145, 21147, 23111, 24162, 24164, 25783, 25895, 7639, 7646,
  9879 (+ ver query). Resíduo anterior à âncora I-Write-6 (commit c798bbf, 2026-07-17).
- doc **8721** (COPPER, proc 124): `mnyTitAberto` = **R$ 0,02** sobre R$ 20.373.009,89; `valorPermutar = 0`.
  Hoje `BLOQUEADA/nao-pago`.

**Decisão do usuário (2026-09-14):**
- Tolerância **absoluta de R$ 1,00 (BRL)** — mesmo teto já usado pela baixa para absorver resíduo
  (`ReconciliacaoPermutaService.ts:934`, `limiteResiduo = 1`). Idealmente uma única constante de domínio.
- Aplicar em **ambos**:
  - Gate 2: `valorPermutar ≤ R$ 1,00` ⇒ sem saldo (→ `ja-permutado` se `valorPermutado > 0`, senão
    `sem-saldo-permutar`). Roteamento de cliente-filtro usa o mesmo critério.
  - Gate 3: `mnyTitAberto ≤ R$ 1,00` ⇒ totalmente pago. Aplicar na regra de domínio da elegibilidade do
    ADIANTAMENTO (não alterar a semântica de `pago` usada na busca de invoices nem na baixa sem decisão
    explícita — se o mapper do client for compartilhado, separar).
- **Não** afetar os resíduos de R$ 21,01 / 327,10 / 1.472,06 / 1.621,34 / 2.175,86 (docs 3754, 20418,
  5885, 21841, 4576) — seguem `nao-pago` (em verificação com a Columbia).

**Invariantes:** I3 ("TOTALMENTE PAGO") passa a significar "em aberto ≤ R$ 1,00". Requer diff na ontologia
(`actions/avaliar-elegibilidade.md`, `business-rules/elegibilidade-permuta.md` se existir, state-machine) +
ADR. Fecha o follow-up `residual-pago-centavos` (P2) de `permutas-pagamento-parcial-regis-followups.md`.

---

## Fix 4 (escopo aprovado) — Histórico inclui `ja-permutado` com borderô do painel

**Comportamento atual.** `src/frontend/app/permutas/page.tsx` monta o Histórico só a partir de
`casamentosSugeridos`, `multiplasManuais`, `crossOver`, `crossProcess`. Um adto que migra para
`ja-permutado` (após Fix 2/3) some do Histórico, embora tenha borderô gerado pelo painel.

**Desejado.** O Histórico também lista adtos `ja-permutado` que têm borderô vinculado (`statusPorAdto`),
sem duplicar entradas (dedupe por adto+borderô). Tipo exibido: `Cross-process` quando o importador é
cliente-filtro; nos demais, o tipo derivável (ou rótulo neutro) — decidir no scoping com o
DesignSystemReviewer. Verificar se `/permutas/gestao` já devolve os `ja-permutado` com dados suficientes
(alocações, priCod, importador) e se `/status` cobre esses adtos.

---

## Ground truth (plano)

Validação AO VIVO read-only contra Conexos (`com298` detail: `mnyTitPermutar`, `mnyTitPermuta`,
`mnyTitAberto`; status do borderô `fin010`) para: 43 INOX executados (→ `ja-permutado`), 12860 e 9328
(saldo esperado = ERP), 9335/9869/9870/10307 (saldo desconta alocação), os 28 resíduos (→ `ja-permutado`),
8721, e os 5 resíduos ≥ R$ 21 (continuam `nao-pago`). Tolerância de comparação: R$ 0,01 / USD 0,01.

## Fora de escopo (follow-ups)
- Invoices em processo 524 (4 invoices BRL idênticas) — dado, não código.
- 27 proformas "nada pago" há > 6 meses — saneamento no ERP.
- Busca de invoice por importador; execução em lote do cross-process.
