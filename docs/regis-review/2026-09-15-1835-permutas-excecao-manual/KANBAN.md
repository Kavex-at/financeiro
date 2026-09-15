# KANBAN — Regis-Review 2026-09-15-1835-permutas-excecao-manual

Ordem: prioridade, depois esforço. Detalhe completo (Problema / Melhoria / Resultado / métricas) em cada seção do run (`<qa>.md`).
Total 27 · P0 0 · P1 2 · P2 14 · P3 11. Resolvido pelo pipeline: `bump-versao-v0.37.0`.

## P1
| # | Card | Título | QA(s) | Esforço |
|---|---|---|---|---|
| 1 | `security-1` | Sanitizar prefixo de fórmula nas células de texto de usuário do exportador Excel (Justificativa/Autor exceção) | Security | S |
| 2 | `availability-1` | Fail-open em `listAtivas` da eleição/cron com `BUSINESS_WARN` | Availability | S |

## P2
| # | Card | Título | QA(s) | Esforço |
|---|---|---|---|---|
| 3 | `availability-2` | Fail-open em `listAtivas` do `GET /permutas/gestao` | Availability | S |
| 4 | `availability-3` | Serializar `npm run migrate` do cron pelo mesmo advisory lock do boot | Availability | S |
| 5 | `deployability-1` | Kill-switch `PERMUTAS_EXCECAO_MANUAL_ENABLED` para marcar/desfazer | Deployability | S |
| 6 | `deployability-4` | Contador "N exceções ativas / M aplicadas" em `/health/pipelines` + query no runbook | Deployability | S |
| 7 | `integrability-2` | Diferenciar 401 `IDENTIDADE_AUSENTE` de sessão expirada no frontend | Integrability | S |
| 8 | `integrability-3` | Extrair `autorDoToken` + `IDENTIDADE_AUSENTE` para `http/auth.ts` | Integrability | S |
| 9 | `modifiability-1` | Derivar `podeMarcarExcecao` (FE) e `guardaSatisfeita` (BE) de uma const compartilhada | Modifiability | S |
| 10 | `rotulo-motivo-be-fe` | Fonte única (ou teste de consistência) para `ROTULO_MOTIVO` (BE) e `MOTIVO_LABEL` (FE) | Integrability + Modifiability | S |
| 11 | `fault-tolerance-1` | Reaper da invariante "exceção ativa ⇔ adto reclassificado ou aviso emitido" | Fault Tolerance | S |
| 12 | `fault-tolerance-2` | Medir `permuta_candidata_snapshot` antes de aplicar a 0059 em produção | Fault Tolerance | S |
| 13 | `security-2` | Fechar leitura sem RBAC de `GET /permutas/gestao` (payload ganhou justificativa/autor) | Security | S |
| 14 | `availability-4` | Rediscutir `VALIDATE CONSTRAINT` retroativo em `permuta_candidata_snapshot` | Availability | M |
| 15 | `performance-1` | Política de retenção para `permuta_candidata_snapshot` | Performance | M |
| 16 | `testability-1` | Teste automatizado da migration 0059 contra Postgres real | Testability | M |

## P3
| # | Card | Título | QA(s) | Esforço |
|---|---|---|---|---|
| 17 | `availability-5` | Dedup de `BUSINESS_WARN` por exceção inativa (24h) | Availability | S |
| 18 | `deployability-2` | Coordenar numeração com `feat/metricas-ciclo` — **informacional** (runner rastreia por nome) | Deployability | S |
| 19 | `deployability-3` | Runbook da janela FE↔BE + defensiva de 404 no `useExcecaoManual` | Deployability | S |
| 20 | `performance-2` | `durationMs` no `/gestao` | Performance | S |
| 21 | `performance-3` | Comentar o `SELECT` sem `LIMIT` do `listAtivas` (índice parcial) | Performance | S |
| 22 | `fault-tolerance-3` | Runbook de rollback do delta em `DEPLOY.md` | Fault Tolerance | S |
| 23 | `testability-2` | Auto-descobrir rotas de mutação no teste de RBAC | Testability | S |
| 24 | `testability-3` | Distinguir 409 de 422 no `useExcecaoManual` com teste por `code` | Testability | S |
| 25 | `testability-4` | Dividir `ExcecaoPermutaService.test.ts` (puro vs I/O) antes de 500 LOC | Testability | S |
| 26 | `modifiability-3` | `mapDomainError` (middleware) para o boilerplate de `try/catch` das rotas | Modifiability | S/M |
| 27 | `modifiability-4` | Tipar o par válido `(EstadoElegibilidade, MotivoBloqueio)` | Modifiability | M |

## Resolvido pelo pipeline
- `bump-versao-v0.37.0` — delta com `feat` → minor, aplicado no passo de ship.
