# Shared metrics — Regis-Review `2026-09-08-1955-permutas-baixa-integridade`

> **GATE PÓS-IMPLEMENTAÇÃO** (`--quick`) do tweak `fix/permutas-baixa-integridade`, commit `8b18686`.
> **Escopo restrito ao DELTA** — não é review do módulo nem do repo. O review completo do módulo
> Permutas é o run anterior, `docs/regis-review/2026-09-08-1414-permutas/` (leia o REPORT.md dele
> pelo checkout principal: `/home/inteli/Área de trabalho/projects/kavex/financeiro/docs/regis-review/2026-09-08-1414-permutas/`).

## O que este delta é

Remediação de **R-1 (P0)** e **R-2** daquele run. Base `main` @ `47c48f8`.

`git diff --stat HEAD~1 -- src/` → **21 arquivos, +2.145 / −89** (o commit inteiro, com ontologia, é 32 arquivos / +3.965 / −152).

| Delta | Onde | Invariante |
|---|---|---|
| Advisory lock por `adiantamentoDocCod`, 409 | `ReconciliacaoPermutaService.ts:100-153` + `errors/ReconciliacaoEmAndamentoError.ts` | I-Recon-5 |
| Estado terminal `parcial` + `valor_residual_usd` + `BUSINESS_WARN` | `ReconciliacaoPermutaService.ts:559-588`, `PermutaExecucaoRepository.markParcial:287-338` | I-Recon-6/7, I-Write-8b |
| Pré-checagem de cobertura antes do 1º POST, 422 | `ReconciliacaoPermutaService.assertCobertura:679-703` + `errors/AlocacaoSemCoberturaError.ts` | I-Write-8a |
| `parcial-aguardando-finalizacao` na 2ª máquina | `BorderoGestaoService.ts` + `frontend/app/permutas/components/ui.tsx:124-143` | B1' |
| Migration do CHECK + coluna | `migrations/0056_permuta_execucao_parcial.sql` | — |
| `pago` no `fieldList` | `ConexosTitulosClient.ts` | I-Write-8a (corroboração) |

Especificação: `ontology/decisions/0043-*.md` **e sua emenda de 2026-09-08**, `business-rules/idempotencia-reconciliacao.md` (I-Recon-1 corrigida, I-Recon-5/6/7), `business-rules/fin010-write-contract.md` (I-Write-8a/8b), `state-machines/status-permuta-bordero.md` (B1').

## Baselines (medidos neste worktree, commit `8b18686`)

| Métrica | Resultado |
|---|---|
| Backend typecheck | ✅ 0 erros |
| Backend lint | ⚠️ **68 warnings, 0 erros** (baseline em `main` era 66) |
| Backend testes | ✅ **123 suites / 1.768 testes**, 0 falhas |
| Frontend typecheck | ✅ 0 erros |
| Frontend lint | ⚠️ 17 warnings, 0 erros |
| Frontend testes | ✅ **27 suites / 201 testes**, 0 falhas |
| LOC no escopo permutas (service+repository, sem teste) | 8.260 |
| `routes/permutas.ts` | 797 |
| Arquivos de teste com `permutas` no caminho | 26 |
| Erros novos | `AlocacaoSemCoberturaError` 59 · `ReconciliacaoEmAndamentoError` 43 |

## Testes novos que interessam a este gate

- **Concorrência** (inexistente antes deste delta): `Promise.allSettled([reconciliar(A), reconciliar(A)])` ⇒ 1× `gravarBaixaPermuta`, 1× `criarBordero`; e `Promise.all([reconciliar(A), reconciliar(B)])` ⇒ adtos distintos não se bloqueiam. `ReconciliacaoPermutaService.test.ts:787/827/857`.
- **Parcial**: cobertura insuficiente pós-POST ⇒ `markParcial` 1× / `markSettled` 0×; `BUSINESS_WARN` com os 4 campos; `parcial` preservado na re-execução; `parcial` não é apagado pela limpeza do borderô órfão.
- **Pré-checagem**: aborta 422 com cobertura baixa; **NÃO** dispara no fallback de título único (lista vazia — caminho majoritário em produção); fronteira ±0,005.
- **B1'**: badge com ramo próprio, 4 casos de render distintos.
- **Paridade FE↔BE**: `src/frontend/lib/types.test.ts` lê o arquivo do backend e compara os literais do union.

## Verificações já feitas ANTES deste gate (não repita, confirme se quiser)

- **SpecVerifier (cego)**: aprovou 40+ criteria; reprovou 3, todos de documentação (Task 13), **já corrigidos** — runbook e `_coverage.json` agora refletem o código.
- **PatternGuardian**: 3 achados, **1 procedente** (interpolação de `LIMIT` no probe, corrigida para `$limite`). Os outros 2 eram (a) código **pré-existente em `main`** que só pareceu novo porque o arquivo cresceu 120 linhas, e (b) falso-positivo — `NOT IN (${pairList})` interpola *placeholders* (`$fil_0`), não valores.
- **Elegibilidade sob `parcial`**: satisfeita **por construção** — `ElegibilidadeService.ts` não referencia status de execução, `parcial` nem `statusPorAdiantamento` (grep vazio); o badge chega por consulta lazy separada. Uma refatoração que acople as duas coisas é regressão, não limpeza.

## Contexto que calibra severidade

A escrita `fin010` está **LIGADA em produção desde 2026-06-24**: 137 execuções, R$ 38.466.226,25 baixados, 12 erros (`docs/impacto/h1-permutas-achados.md`). **Mas este delta ainda não está em produção** — commit em branch, sem PR, sem release. Findings sobre o caminho de escrita valem para quando entrar.

## Não medível neste run

| Métrica | Razão |
|---|---|
| Cobertura por arquivo | `--quick` — não rodada. A do módulo está no run `2026-09-08-1414-permutas` (94,74% stmts / 72,78% branch) |
| `npm audit` profundo | `--quick`. O run anterior mediu: frontend 8 HIGH, backend 3 moderate + 1 low |
| Terraform / tenants / IAM | ⚠️ **não existe `infra/`** neste repo — deploy por Render hook |
| Latência real / p95 | sem instrumentação de duração (card `availability-5` do run anterior) |
