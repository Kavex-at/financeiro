# Regis-Review reduzido — sispag-ajuste-centavos (ADR-0074)

**Data:** 2026-10-19 · **Escopo:** delta da branch `feat/sispag-ajuste-centavos` · **QAs (escolhidos pelo
risco):** fault-tolerance, integrability, security, testability · **Cartões:** `KANBAN.md` nesta pasta.

> O `REPORT.md` não foi gravado pelo AutoLoopRunner (a escrita foi recusada pelo harness); este texto
> reproduz o resumo consolidado que ele devolveu.

## Notas por atributo

| Atributo | Nota |
|---|---|
| Fault tolerance | 6,5 |
| Integrability | 7 |
| Security | 8 |
| Testability | 8 |

## P0 (1)

- **Gate de merge da guarda I17m/I17n (Task 13).** A guarda "valor da barra = pagamento do J"
  (`MODO_GUARDA_VALOR_J = BLOQUEIA`) e a importação pelo líquido valem para **toda** remessa, mesmo com o
  ajuste em `off`. Pela decisão M8, o merge exige a medição somente leitura de 30 dias de `.REM` em PRD.
  Não é defeito de código: se a medição achar caso legítimo, trocar a constante para `AVISA` antes do merge.

## P1 remediados no mesmo worktree

- "Tentar de novo" em ledger cancelado, recusado ou indeterminado não reporta mais sucesso, e a tela não o oferece
  (`11ad4dc`).
- Ajuste `indeterminado` bloqueia o `finalizar` do lote (`d75ebd5`).
- O total da renegociação nunca é comparado quando uma linha do título vem ilegível (`f53e166`).

## Antes de `shadow`/`on` (follow-ups prioritários)

- Sinal de "título em lote nativo" pelos campos `its*` do `fin064` falha aberto se o ERP omitir os campos.
- Alerta de ledger parado (ObservabilityAdvisor).
- Reabertura de ledger encerrado.

Demais P1/P2/P3: `ontology/_inbox/sispag-ajuste-centavos-regis-followups.md`.
