# Regis-Review — financeiro — 2026-09-15-1835-permutas-excecao-manual

**Delta:** `/feature-tweak permutas-excecao-manual` · branch `fix/permutas-excecao-manual` · base `origin/main` 2f03116 (v0.36.5) · ADR-0047
**Escopo:** exceção manual "permutado fora do painel" (caso real: adto 8721, R$ 20,4 mi) — migration 0059 aditiva, rotas admin marcar/desfazer, gancho na eleição, tag e diálogos no painel.
**Gates:** backend 137 suítes / 2012 testes · frontend 43 suítes / 361 testes · PatternGuardian PASS · DesignSystemReviewer PASS · SpecVerifier APROVADO · Ground-Truth N/A (classificação sobre dados já lidos).

> Consolidado a partir das 8 seções do run (o consolidador não conseguiu gravar em disco; conteúdo persistido pelo orquestrador).

## 1. Scorecard

Pesos: Security 1,5 · Fault Tolerance 1,3 · Availability 1,2 · Modifiability 1,2 · Testability 1,0 · Performance 1,0 · Integrability 0,9 · Deployability 0,9.

| QA | Score | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 7,5 | 0 | 1 | 3 | 1 | `listAtivas` do cron sem fail-open |
| Deployability | 8,2 | 0 | 0 | 2 | 2 | sem kill-switch para as rotas admin |
| Integrability | 8,5 | 0 | 0 | 3 | 4 | 3 cópias do rótulo pt-BR de motivos |
| Modifiability | 8,3 | 0 | 0 | 2 | 2 | guarda BE↔FE espelhada por string literal |
| Performance | 8,0 | 0 | 0 | 1 | 4 | `permuta_candidata_snapshot` sem retenção |
| Fault Tolerance | 8,5 | 0 | 0 | 2 | 4 | sem reaper da invariante ativa ⇔ reclassificada |
| Security | 8,0 | 0 | 1 | 1 | 5 | xlsx sem escape de fórmula (justificativa/autor) |
| Testability | 7,8 | 0 | 0 | 1 | 3 | migration 0059 sem teste automatizado em Postgres real |
| **Overall** | **8,1** | **0** | **2** | **14** | **11** | — |

27 cards após dedupe (28 nas seções): `integrability-1` + `modifiability-2` → `rotulo-motivo-be-fe`.
**Gate: passa — 0 P0.** P1/P2/P3 → `ontology/_inbox/permutas-excecao-manual-regis-followups.md`.

## 2. Top 5 riscos

1. **R-1 — Injeção de fórmula/hyperlink no xlsx** (Security; `security-1`, P1). `RelatorioExportService.celulasExcecao` escreve justificativa/autor crus; Zod só valida tamanho. ExcelJS grava como texto (Excel não avalia ao abrir), mas Save-as-CSV / LibreOffice / Power Query podem avaliar. Autoria restrita a admin. Mitigação: helper de escape de 3 linhas, reutilizável nos outros exportadores.
2. **R-2 — Falha transiente em `listAtivas` aborta a run inteira do cron** (Availability + Fault Tolerance; `availability-1` P1, `availability-2` P2). A leitura de config (≤ 20 linhas) não tem try/catch local; ausência deveria equivaler a "sem exceções". Mitigação: fail-open com `BUSINESS_WARN`, padrão `filiaisComFalha`.
3. **R-3 — Espelho BE↔FE por string literal** (Modifiability + Integrability + Testability; `modifiability-1`, `rotulo-motivo-be-fe`, P2). Guarda e rótulos duplicados; o `Record<string,string>` do FE não quebra o build ao surgir motivo novo.
4. **R-4 — `permuta_candidata_snapshot` cresce sem retenção** (Performance + Availability + Fault Tolerance; `performance-1`, `availability-4`, `fault-tolerance-2`, P2). ~216 mil linhas estimadas hoje; cada `VALIDATE CONSTRAINT` (0054→0055→0059) escala linear.
5. **R-5 — Sem detecção de drift entre exceção ativa e motivo gravado** (Fault Tolerance + Deployability; `fault-tolerance-1`, `deployability-4`, P2). Sem reaper nem contador agregado.

## 3. Notas do orquestrador

- **Numeração de migration (0059 × 0058 da `feat/metricas-ciclo`) — mitigado.** `runMigrations.ts:61-72` registra migrations aplicadas **por nome de arquivo** em `schema_migrations`; uma 0058 mergeada depois ainda aplica. `deployability-2` rebaixado a P3 informacional.
- **Bump de versão** (delta com `feat`) → minor **v0.37.0**, resolvido pelo passo de ship; não é follow-up.

## 4. Temas transversais
- CC-1 espelho BE↔FE sem workspace linking → `modifiability-1`, `rotulo-motivo-be-fe`
- CC-2 crescimento de `permuta_candidata_snapshot` → `availability-4`, `performance-1`, `fault-tolerance-2`
- CC-3 observabilidade da exceção em regime → `deployability-4`, `fault-tolerance-1`, `availability-5`, `performance-2`
- CC-4 trilha de identidade sem utilitário compartilhado → `integrability-2`, `integrability-3`
- CC-5 cobertura com banco real ausente em permutas → `testability-1`

## 5. Recomendação (30 dias)
- Sprint 1: os 2 P1 (`security-1`, `availability-1`) + quick wins P2 (`availability-2`, `deployability-1`, `fault-tolerance-1/2`, `integrability-2/3`).
- Sprint 2: P2 restantes + estratégicos M (`testability-1`, `performance-1`).
- Sprint 3: P3.
