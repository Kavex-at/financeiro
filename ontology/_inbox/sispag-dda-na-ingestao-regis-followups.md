# Regis-Review 2026-10-13-2014 — follow-ups da feature `sispag-dda-na-ingestao`

> Origem: `docs/regis-review/2026-10-13-2014/` (REPORT.md, KANBAN.md). Escopo: o delta da feature
> (ADR-0067). **Nenhum P0 e nenhum P1**: nada abaixo bloqueia o merge e nada foi implementado nesta
> branch (regra 11: só P0 volta ao loop). Os 30 cards (22 P2, 8 P3) viram ~23 itens após fusão.

## Para decidir antes de mexer (negócio)

- **Limiar do aviso "DDA parado".** Hoje 8 h corridas; os crons deixam um vão de 15 h (16h→07h) em dia
  útil, então o aviso aparece ~7 h por dia útil com o pipeline saudável, e nas segundas cedo. Perguntas
  para Operações: o aviso deve valer fora do horário comercial? segunda cedo deve alertar? Proposta:
  trocar "horas corridas" por "rodada esperada perdida" (ou calcular no backend junto do cron).
  Cards: modifiability-3 = integrability-2; testability-6.
- **Teto da fase DDA:** 65 s (availability-1, performance-3) ou 90 s (fault-tolerance-1). Decidir um.

## 1. PR único de contenção da fase DDA (todos S)

| Item | Cards | Resultado esperado |
|---|---|---|
| Teto rígido: `Promise.race`/`AbortSignal` em `listarArquivos` e `listarItens`, orçamento restante | availability-1 = performance-3 = fault-tolerance-1 | fase DDA ≤ prazo + margem, com teste de client que não resolve |
| Folga do pool: escrita concorrente 3 → 2 no modo ingestão (pool `max: 5`, acquire 5 s) | performance-4 = fault-tolerance-2 = integrability-3 | pico 5/5 → ≤ 4/5 |
| Guarda contra substituição vazia: `salvarArquivo` não apaga arquivo cheio com lista vazia; contar linhas rejeitadas no parse | fault-tolerance-3 | 0 → 2 guardas, com teste por guarda |
| Redação do erro persistido/logado/exposto (`redactErrorMessage`, ADR-0042) | security-1 (security-2 vira dispensável) | 4 saídas → 0 sem redação |
| Teste do prazo estourando no meio da passada; relógio injetável | testability-2 | casos de prazo 1 → 3, `Date.now()` direto 2 → 0 |

## 2. Instrumentar

- `dda_estado`, `dda_duracao_ms`, `dda_arquivos_adiados`, `dda_falhas` na run (migration aditiva) e
  log de `ocupada`: performance-1 = availability-2 (S).
- Depois: alerta server-side de pool defasado via `StalenessDetector` (fault-tolerance-4, M, P3);
  razão de `numeroDocumento` nulo por rodada (integrability-5, M); circuit breaker após K falhas
  (availability-3, M, depende de availability-2).

## 3. Com dados em produção

- performance-2 (M): pular arquivos sincronizados há < N min e ordenar releituras por `sincronizado_em`
  mais antigo (evita inanição da cauda); `IS DISTINCT FROM` no upsert. Calibrar N com performance-1.
- Kill-switch e prazo por `EnvironmentProvider`: deployability-1 + modifiability-4.

## 4. Contrato e testes

- integrability-1: tipar `dda`/`arquivosAdiados`/`filiaisComFalha`/`filiaisSemFlagBoleto` em
  `frontend/lib/sispag.ts` e mostrar `dda.estado` no toast do botão.
- testability-3 (saída do job a 0%), modifiability-2 (predicado `FALHOU || PARCIAL` único),
  testability-4 (ramos de `avisoDaRun`), testability-1 (integração em `titulo_a_pagar` + paridade
  SELECT↔`TituloRow`: a coluna já foi esquecida no SELECT uma vez neste ciclo, pega pelo
  PatternGuardian), modifiability-1 (`runIngestion` 20 → ≤ 15), integrability-4 (porta estreita para o
  pool DDA), testability-5 (`releituraDias` sem chamador em produção).
- deployability-2 (P3): runbook do 1º dia pós-deploy — `parcial` esperado até `arquivosAdiados` → 0;
  rollback = redeploy 0.64.0, a coluna fica.

## Observações do PatternGuardian (já corrigidas no commit)

SELECT de `listAtivos` sem `doc_esp_numero` (P1, corrigido), JSDoc órfão em 2 lugares (P2, corrigido) e
literais de estado no job (P2, trocados por `DDA_NA_INGESTAO`).
