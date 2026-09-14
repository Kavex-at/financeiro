# Regis-Review follow-ups — metricas-ciclo

> Run: `2026-09-14-1624-metricas-ciclo` (escopo `backend --quick`, delta `14ca71a..HEAD`).
> REPORT: `docs/regis-review/2026-09-14-1624-metricas-ciclo/REPORT.md` ·
> KANBAN: `docs/regis-review/2026-09-14-1624-metricas-ciclo/KANBAN.md`
> Score 7.5/10 · 26 cards (P0 1 · P1 1 · P2 16 · P3 8), consolidados de 32.
>
> **P0 `CI-1` foi remediado no loop** (job `backend-sql` + `npm run test:sql`). Os cards abaixo **não**
> foram implementados: são P1/P2/P3 e, pela regra do pipeline, viram tickets.

| Card | Prioridade | Esforço | Finding(s) de origem | Resumo |
|---|---|---|---|---|
| `MOD-1` | P1 | S | F-modifiability-1 | Regra "borderô desfeito" duplicada SQL ↔ `BorderoGestaoService.situacaoDoItem`, sem teste espelho |
| `SEC-1` | P2 | S | F-security-1, F-security-5 | Guarda do teste de integração só por hostname; túnel SSH para produção passaria |
| `SEC-2` | P2 | S | F-security-2 | Runbook de rotação/revogação da senha do leitor |
| `SEC-4` | P2 | S | F-security-4 | Alertas de auth failure / permission denied do leitor |
| `AVAIL-1` | P2 | S | F-availability-1 | Heartbeat sobre `vw_metricas_ciclo` (hoje: detecção em ~7 dias) |
| `HAB-LEITOR` | P2 | S | F-deployability-1, F-availability-3 | Script + verificação do `ALTER ROLE ... LOGIN PASSWORD` |
| `INTEG-2` | P2 | S | F-integrability-2 | `metrics.py --fim` sem hora devolve 0 linhas em silêncio (gap K1) |
| `INTEG-3` | P2 | S | F-integrability-3 | `metricas.diagnostico()`: "vazia por design" vs "quebrou" |
| `MOD-3` | P2 | S | F-modifiability-3 | Constantes de fuso/janela/série nomeadas |
| `ROLLBACK-0058` | P2 | S | F-availability-4, F-deployability-2, F-fault-tolerance-4 | Reverse versionado da 0058 (role cluster-level) |
| `TEST-2` | P2 | S | F-testability-2 | Testar `metricas_ciclo_vigente()` com "agora" controlado (hoje tautológico) |
| `TEST-3` | P2 | S | F-testability-3 | `statement_timeout` do leitor provado por comportamento |
| `FT-2` | P2 | S/M | F-fault-tolerance-2 | Idade do cache `permuta_bordero` visível ao report (liga com G2) |
| `CROSS-CONTRACT` | P2 | M | F-integrability-1, F-modifiability-4, F-deployability-3 | Pact test cross-repo com `kavex-report-ciclo` + versão do contrato |
| `MOD-2` | P2 | M | F-modifiability-2 | Sub-funções por frente antes de SISPAG |
| `TEST-5` | P2 | M | F-testability-5 | `docker-compose.test.yml` para o teste de SQL local |
| `FT-1` | P2 | M | F-fault-tolerance-1 | Snapshot append-only do que cada ciclo leu (exige decisão: hoje a view é só leitura) |
| `INTEG-4` | P3 | S | F-integrability-4 | Versão explícita do contrato |
| `SEC-3` | P3 | S | F-security-3 | `OWNER TO` explícito nas funções |
| `SEC-5` | P3 | S | F-security-5 | Senha do teste gerada em runtime |
| `MOD-5` | P3 | S | F-modifiability-5 | Guardas estáticas menos dependentes de layout |
| `MOD-6` | P3 | S | F-modifiability-6 | Provisionamento de role separado da lógica nas próximas migrations |
| `FT-3` | P3 | S | F-fault-tolerance-3 | Pré-check de `CREATEROLE` no boot (produção verificada: `rolcreaterole = true`) |
| `PERF-1` | P3 | S | F-performance-1, F-performance-2 | Gatilho de índice funcional anotado (≥ 50 k linhas ou > 3 s) |
| `INTEG-5` | P3 | M | F-integrability-5 | Guarda de shape via `information_schema` (parcialmente coberta por `CI-1`) |

## Revisão após mover o acesso para a aplicação (2026-09-14, ADR-0045 D5)

O role só-leitura `metricas_ciclo_leitor` saiu da migration; a tela e o report leem `GET /metricas/ciclo`.
Efeito sobre os cards acima:

| Card | Situação | Por quê |
|---|---|---|
| `SEC-2`, `SEC-4`, `HAB-LEITOR`, `TEST-3`, `FT-3`, `MOD-6` | **obsoletos** | Tratavam do role de banco, da senha dele, do `statement_timeout` e do `CREATE ROLE` no boot; nada disso existe mais |
| `SEC-5` | **obsoleto** | O teste de integração não define mais senha nenhuma |
| `INTEG-2` | **resolvido** | A API trata `fim` só com data como o dia inteiro (`MetricasCicloService`, testado) |
| `SEC-1` | **rebaixado a P3** | O teste ainda faz `DROP DATABASE metricas_ciclo_it` guardado só por hostname, mas não mexe mais em role |
| `ROLLBACK-0058` | **rebaixado a P3** | Sem artefato cluster-level, o reverse é só `DROP VIEW/FUNCTION/SCHEMA` |
| `MOD-3` | **parcial** | A série virou `metricas.serie_inicio()`; fuso e intervalo continuam literais |
| `CROSS-CONTRACT` | **continua** | O contrato agora é JSON por HTTP; o teste da rota trava os 9 campos deste lado, falta o da skill |
| demais | **continuam** | — |

Regis-Review **não** foi reexecutado para a mudança de acesso. A superfície nova (rota autenticada de
leitura, tela) passou por PatternGuardian e DesignSystemReviewer, e por um teste ponta a ponta local:
skill → login → rota → Postgres.
