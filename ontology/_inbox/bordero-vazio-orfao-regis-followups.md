# Regis-Review follow-ups — `bordero-vazio-orfao` (I-Write-7)

- **Run:** `2026-08-06-1945` (`--quick`, escopo restrito ao delta)
- **REPORT:** `docs/regis-review/2026-08-06-1945/REPORT.md`
- **KANBAN:** `docs/regis-review/2026-08-06-1945/KANBAN.md`
- **Gate:** ✅ **PASS** — **0 findings P0** e **0 P1**. Nenhum sub-loop de remediação foi
  disparado; o PR está liberado pelo Green Criterion #8.
- **Score geral:** 8.1 (Security 9 · Availability 8 · Deployability 8 · Fault Tolerance 8 ·
  Integrability 8 · Modifiability 8 · Performance 8 · Testability 7,5)

> Os cards abaixo **não foram implementados** — o pipeline só remedia P0. Ficam aqui como
> follow-ups priorizados.

## P2 — 13 cards

| Card | QA(s) | Esforço | Resumo |
|---|---|---|---|
| `cq-observabilidade-orfao` | Avail + Deploy + FT | S | Contadores estruturados + alarme para o best-effort de limpeza do órfão |
| `avail-1` | Availability | S | Diferenciar "ERP indisponível" de "borderô vazio" na mensagem ao analista |
| `ft-1` | Fault Tolerance | S | Split do catch de `removerBorderoOrfao` (ERP vs. cache) — o WARN atual mente na falha parcial |
| `ft-2` | Fault Tolerance | S | Logar quando `listBaixas` filtra rows silenciosamente (payload malformado → `[]` falso) |
| `ft-3` | Fault Tolerance | S | Teste do 2º nível de defesa (`excluirBordero` recusa borderô com item) |
| `deploy-1` | Deployability | S | Documentar ordem de deploy FE↔BE no ADR-0030 |
| `deploy-3` | Deployability | S | Kill-switch granular `CONEXOS_AUTO_CLEANUP_ORFAO_ENABLED` |
| `cq-shortcircuit-assert` | Perf + Integ | S | Curto-circuitar `assertBorderoTemItens` quando a trilha já tem `settled` (2 → 1 RTT) |
| `perf-2` | Performance | S | Instrumentar `duration_ms` por endpoint no `ConexosBaseClient` |
| `test-1` | Testability | S | Testar a guarda `vazio` do `BorderosPanel.tsx` (harness FE já existe) |
| `test-2` | Testability | S | Asserções de log nos 3 caminhos de `removerBorderoOrfao` |
| `integ-3` | Integ + Mod | M | Façade `Fin010BorderoFacade` (ACL) — 11 chamadas diretas ao client |
| `mod-2` | Mod + Test | M | Extrair o loop de `reconciliar` (204 LoC) para `baixarAlocacoesDoBordero` |

## P3 — 10 cards

`cq-predicado-vazio` · `cq-timeout-limpeza` · `deploy-4` (✅ já aplicado — bump v0.20.2) ·
`integ-1` · `integ-2` · `mod-3` · `sec-1` · `sec-2` · `test-3` · `test-4`

Detalhe completo de cada um no `KANBAN.md`.

## Duas correções aplicadas aos findings dos agentes

Registradas aqui porque mudam o que deve ser feito — não são nitpick de redação:

1. **`F-fault-tolerance-2` estava factualmente errada.** O agente afirmou que uma falha de I/O do
   `listBaixas` chega ao analista como *"não possui baixas — use Excluir"*. Falso:
   `ConexosBaixaClient.listBaixas` envelopa a chamada em try/catch e **lança** `ConexosError` —
   nunca devolve `[]` em erro; a exceção propaga e é interpretada como erro do ERP. O card `ft-2`
   foi reescrito para a variante **real**: `page.rows ?? []` + filtro `Number.isFinite` podem
   render `[]` para um borderô que TEM baixas se o ERP devolver 200 com payload malformado.
2. **`F-integrability-1` era fraca.** Ler só a página 1 (`pageSize: 200`) não torna a checagem de
   *vazio* um falso-positivo — se há qualquer baixa, ela está na página 1. Rebaixada de P2 para
   **P3** e reformulada como "documentar o teto de 200", não como risco de correção.

## Nota de escopo

As **14 falhas** do `npm test` full são **pré-existentes** (4 suites `routes/recebimentos.e2e.*`,
Frente IV, env var `COM297_GCD_NOTA_DEBITO` ausente) — confirmadas com `git stash` no baseline
limpo. Não são regressão deste delta, mas continuam **vermelhas na `main`** e merecem um item
próprio fora deste tweak.
