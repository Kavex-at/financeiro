# Frente V — follow-ups do Regis-Review

> Run: `docs/regis-review/2026-08-19-1603/` (REPORT.md + KANBAN.md).
> Política do pipe: **só P0 re-entra no loop**; P1/P2/P3 viram follow-up. Aqui estão os que ficaram.

## Fechados durante a execução (não retrabalhar)

`testability-1`, `testability-2` (os dois P0 de testability), `availability-1`, `performance-2`,
`performance-3`, `integrability-1`, `deployability-1`, `fault-tolerance-3`.

Commits `dea5ce7` (remediação) e `2418cdf` (validação de SQL contra Postgres real).

## Abertos — 1 P0, 15 P1, 26 P2, 5 P3

Detalhe completo em `docs/regis-review/2026-08-19-1603/KANBAN.md`. Os que mais importam:

| Card | Por que importa |
|---|---|
| `performance-1` (P0) | **Bloqueado por fora.** A premissa caiu: a `fin103` é fila pessoal, não listagem administrativa. Vira "existe projeção em massa de `FinTituloBloq`?" — pergunta ao fornecedor do ERP |
| `deployability-2` / `fault-tolerance-1` (P1) | Sem cron, o painel envelhece sem alarme — a Degradation deliberada da ADR-0038 D3 depende de snapshot fresco |
| `security-1` (P1) | Fail-open de filial. **Herdado da Frente IV**, vale para recebimentos e sispag também; corrigir só aqui deixaria a Frente V inconsistente |
| `deployability-6` (P2) | O `npm run verify:sql-aprovacoes` já existe — falta só plugá-lo no `ci.yml` |
| `integrability-2` / `modifiability-5` (P1) | Contrato duplicado FE↔BE: lacuna nova no backend não quebra o build do frontend |

## Dependências externas que travam cards

- **PV-07** — projeção em massa de `FinTituloBloq` (fornecedor do ERP). Trava `performance-1`.
- **PV-09** — claim `filiais` no JWT do Supabase. Trava `security-1` e `modifiability-7`.
- **Postgres em CI** — destrava `deployability-6` e `testability-8`. O script local já existe.

## Nota de método

Dos 3 P0 originais, **2 foram fechados nesta execução** e o restante não é código a escrever:
depende do fornecedor do ERP. A revisão qualificou isso como evidência de que a arquitetura do delta
está sólida — o que trava está fora do teclado.
