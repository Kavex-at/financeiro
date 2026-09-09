---
type: regis-review-report
run_id: 2026-09-08-2011-permuta-snapshot-estados
generated_at: 2026-09-08T20:45:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
total_cards: 30
total_p0: 0
total_p1: 7
total_p2: 16
total_p3: 7
overall_score: 7.2
---

# Regis-Review — financeiro — 2026-09-08-2011-permuta-snapshot-estados

Delta em revisão: `/feature-tweak entities/permuta-candidata` (branch `fix/permuta-snapshot-estados`). Corrige bug de projeção em `permuta_candidata_snapshot.status` (2 → 5 estados) e promove `ja-permutado` a estado de primeira classe (ADR-0043). Medido em PRD: header dizia 329 bloqueadas / snapshot da MESMA run dizia 677 (2,06× de contradição em transação única); passivo externo real 249 (inflação 2,72×). 348 itens que são fila da equipe apareciam como passivo de terceiro. Gates verdes: typecheck, lint (66 warnings pré-existentes), 1745 testes (+22), SpecVerifier 101/101.

## 1. Executive scorecard

Pesos (financeiro multi-tenant SaaSo que executa escritas movimentando dinheiro — Conexos/Nexxera/GED):
Security 1,5 · Fault Tolerance 1,3 · Availability 1,2 · Modifiability 1,2 · Testability 1,0 · Performance 1,0 · Integrability 0,9 · Deployability 0,9. Total = 9,0.

Overall = (7,5·1,5 + 7,5·1,3 + 7,5·1,2 + 6,5·1,2 + 7,5·1,0 + 7,0·1,0 + 6,5·0,9 + 7,0·0,9) / 9,0 = **7,2**.

| QA | Score | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 7,5 | 0 | 2 | 2 | 1 | F-availability-1: `ADD CONSTRAINT CHECK` sobre 152.516 linhas sem `lock_timeout`/`NOT VALID` |
| Deployability | 7,0 | 0 | 2 | 3 | 2 | F-deployability-2: rollback simétrico código+schema não é oferecido pelo pipeline |
| Fault Tolerance | 7,5 | 0 | 2 | 3 | 3 | F-fault-tolerance-2: CHECK permissiva pós-migration + código antigo re-escreve `bloqueada` silenciosamente |
| Integrability | 6,5 | 0 | 1 | 4 | 1 | F-integrability-1: domínio de `status` ampliado retroativamente sem view de compat |
| Modifiability | 6,5 | 0 | 2 | 3 | 3 | F-modifiability-2: 1 sítio exaustivo / ≥20 sítios com igualdade nua = 5% de cobertura |
| Performance | 7,0 | 0 | 1 | 2 | 3 | F-performance-1: migration no caminho do boot (mitigação deliberada, ver §7) |
| Security | 7,5 | 0 | 1 | 1 | 3 | F-security-1: sonda RBAC era falso-verde (`.not.toBe(403)` sobre 500) — corrigida no delta |
| Testability | 7,5 | 0 | 2 | 2 | 3 | F-testability-1: migration 0054 (227 LOC, 152 k linhas) sem NENHUM teste automatizado |
| **Overall** | **7,2** | **0** | **7** | **16** | **7** | — |

Interpretação:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais ← **este delta**
- 9–10: estado-da-arte para o estágio atual

**Ausência de P0 é deliberada.** O delta corrige um bug real, passa 1745 testes, tem asserção pré-mutação, backfill idempotente por recomputação (não subtração) e substitui um `default: 'descoberta'` silencioso por `never` que quebra o build. Nenhum achado cumpre os dois testes de P0: (a) bloqueia o merge, (b) dano concreto se merge for feito. Todo P1 daqui é robustez operacional em cima de um patch que já é uma melhoria estrutural líquida.

## 2. Top 10 risks (cross-QA)

### R-1: Deploy-rollback assimétrico — código antigo × schema novo re-corrompe silenciosamente
- **QA(s) afetados**: Fault Tolerance, Deployability, Availability
- **Findings**: F-fault-tolerance-2 (P1), F-deployability-2 (P1), F-availability-2 (P1)
- **Evidência sintetizada**: migration 0054 estende `permuta_candidata_snapshot.status_check` para 5 valores e `permuta_adiantamento.estado_elegibilidade_check` para 6. `origin/main` grava `elegivel|bloqueada` no snapshot e usa `default: 'descoberta'` no `toEstadoRow`. A CHECK nova **aceita** o comportamento antigo — não rejeita. Se o BE for revertido sem reverter a migration, **~80 linhas promovidas a `ja-permutado` voltam a `bloqueada`** na primeira ingestão, sem constraint violation.
- **Impacto técnico**: o bug corrigido reaparece com **zero sinal de fault**. Sem log, sem erro, sem alerta. Operador só descobre quando alguém abre o painel e vê o número inflado voltar.
- **Impacto de negócio**: o relatório de impacto v1 (348 itens de fila interna classificados como passivo de terceiro por ~3 meses) foi corrigido publicamente. Uma repetição custa mais que a primeira: o cliente lê a reincidência como falta de rigor.
- **Cards Kanban relacionados**: `rollback-assimetrico` (P1, M), `rollback-0054` (P1, S)
- **Custo de inação em 6 meses**: probabilidade de 1 rollback de emergência é significativa (base histórica: `preDeployCommand` que "nunca rodou" + incidente 2026-08-10 da ADR-0032). Premissa: 1 evento = ~40h de retrabalho + reconstrução da narrativa.

### R-2: Taxonomia de estados vive em 6 fontes TS paralelas + exaustividade ausente em ≥20 sítios
- **QA(s) afetados**: Modifiability, Integrability, Testability
- **Findings**: F-modifiability-1 (P1), F-modifiability-2 (P1), F-integrability-2 (P2), F-testability-3 (P2)
- **Evidência sintetizada**: `EstadoElegibilidade` em 6 lugares TS (enum canônico + 2 unions de repo/interface + 1 union do frontend + 2 arrays de labels). As 2 CHECKs SQL diferem **deliberadamente** em `descoberta` — presente em `permuta_adiantamento.estado_elegibilidade` (o estado transitório antes da avaliação) e ausente em `permuta_candidata_snapshot.status` porque uma candidata só é snapshotada *depois* da avaliação. Não é inconsistência; é invariante mais forte no snapshot (o banco rejeita gravar auditoria de algo não avaliado). O gap está no TypeScript. Cobertura de exaustividade: **1 sítio com `const _: never`** vs. **≥20 sítios com `status === '...'`** nua (5%). Delta atravessou ~10 arquivos para adicionar 1 estado.
- **Impacto técnico**: compilador ajuda em 1 sítio; outros 20+ silenciam. ADR-0013 já prevê `EXECUTADA` na Fase 3.
- **Impacto de negócio**: reintroduz **a classe exata** de defeito que este delta corrige. Registrado na Task 3 do próprio ciclo (`default: 'descoberta'` teria persistido `ja-permutado` como `descoberta` sem erro de compilação).
- **Cards Kanban relacionados**: `taxonomia-fonte-unica` (P1, M), `assertNever-propagacao` (P1, M)
- **Custo de inação em 6 meses**: 1 estado novo × 20 sítios × 5% de omissão por sítio = expectativa de 1 sítio esquecido; fila de trabalho volta a mentir.

### R-3: Migration 0054 sem script de rollback (152.516 linhas + 250 headers destrutivamente reescritos)
- **QA(s) afetados**: Fault Tolerance, Deployability, Availability, Integrability, Modifiability
- **Findings**: F-fault-tolerance-1 (P1), F-deployability-1 (P1), F-availability-2 (P1), F-integrability-5 (P2), F-modifiability-8 (P3)
- **Evidência**: `ls migrations/ | grep -iE 'rollback|down|revert'` → vazio. `total_bloqueadas` histórico reescrito de 64.893 → 51.459 (Δ −13.434). `motivo_bloqueio` sobrevive intacto — reverse é determinístico, só falta escrevê-lo.
- **Impacto técnico**: uma vez commitada, único caminho de volta é PITR do Supabase (não testado). Descobrir erro no CASE do §6 semanas depois exige reconstruir SQL sob pressão.
- **Impacto de negócio**: KPI histórico foi consumido em relatório enviado ao cliente. Se consumidor externo quebrar após deploy, MTTR limitado pela velocidade do improviso.
- **Cards Kanban relacionados**: `rollback-0054` (P1, S)
- **Custo de inação em 6 meses**: baixa probabilidade, alto custo por evento. Reverse é ~1 dia hoje; construir sob pressão custa dezenas de horas + estresse.

### R-4: Migration 0054 (227 LOC, backfill de 152 k linhas) sem NENHUM teste automatizado
- **QA(s) afetados**: Testability, Fault Tolerance
- **Findings**: F-testability-1 (P1), F-testability-5 (P2), F-testability-6 (P1), F-fault-tolerance-3 (P2)
- **Evidência**: `BootMigrator.test.ts` cobre o runner (mocka `MigrationRunnerInterface`), não o SQL. Não existe `docker-compose.test.yml`, nem `--integration` no Jest, nem test-pg harness. Contrato de idempotência declarado no cabeçalho **não é testado**.
- **Impacto técnico**: `RAISE EXCEPTION` só exercitado em produção. Próxima migration corretiva herda mesma zona sem rede.
- **Impacto de negócio**: bug original custou "348 itens da fila interna como passivo externo por 3 meses". `_watchlist.md` já pauta 0054-like para recebimentos e pagamentos.
- **Cards Kanban relacionados**: `migration-test-harness` (P1, L), `pg-do-pos-backfill` (P2, S)
- **Custo de inação em 6 meses**: 1 migration destrutiva/trimestre × probabilidade de bug sutil = 1 incidente esperado em 12 meses.

### R-5: `lock_timeout`/`statement_timeout`/`NOT VALID` ausentes no runner de migrations
- **QA(s) afetados**: Availability, Performance
- **Findings**: F-availability-1 (P1), F-performance-4 (P3)
- **Evidência**: `grep -c "lock_timeout|statement_timeout|NOT VALID"` na 0054 = 0. Nenhuma das 55 migrations seta esses limites. `ADD CONSTRAINT CHECK` sem `NOT VALID` valida 152 k linhas sob **ACCESS EXCLUSIVE**.
- **Impacto técnico**: cenário-limite: deploy preso até Render matar boot por health-check timeout.
- **Impacto de negócio**: janela de manutenção com risco de suspender indefinidamente. Plano starter = 1 instância.
- **Cards Kanban relacionados**: `lock-timeout-not-valid` (P1, S)
- **Custo de inação em 6 meses**: pequeno hoje (tabela 22 MB), cresce linearmente (848 k projetados em 12 meses). Card barato, sem contrapartida.

### R-6: Domínio ampliado retroativamente sem view de compat — leitor externo quebra silenciosamente
- **QA(s) afetados**: Integrability, Availability
- **Findings**: F-integrability-1 (P1)
- **Evidência**: 152.516 linhas reclassificadas + 250 headers reescritos. Qualquer SQL externo `WHERE status='bloqueada'` devolve **20,7% menos** no agregado histórico (64.893 → 51.459) e **63% menos** na run viva (677 → 249). Sem erro, sem log. Não há `docs/api/CONTRACTS.md`, não há INVENTARIO-INTEGRACAO.md.
- **Impacto técnico**: mesma classe de defeito que o delta corrige — informação mudando sem sinal.
- **Impacto de negócio**: risco de repetir o relatório de impacto v1 **com sinal invertido** ("bloqueadas caíram 20%" lido como melhora operacional). ADR-0043 §Consequências antecipa; nenhuma defesa técnica instrumentada.
- **Cards Kanban relacionados**: `view-compat-snapshot` (P1, S)
- **Custo de inação em 6 meses**: alto se houver consumidor externo (não observável deste worktree). Card barato.

### R-7: Boot bloqueante sem observabilidade — `/health` retorna TCP-refused durante migração
- **QA(s) afetados**: Availability, Performance
- **Findings**: F-availability-3 (P2), F-performance-1 (P1 → P2 na consolidação, ver §7)
- **Evidência**: `app.listen()` só é chamado após `BootMigrator.run()`. 2,6 s local × fator de rede desconhecido.
- **Impacto técnico**: cegueira sobre estado da nova instância; bloqueante para rolling deploy futuro.
- **Impacto de negócio**: hoje pequeno (1 instância); cresce se migration encalhar por F-availability-1.
- **Cards Kanban relacionados**: `boot-observabilidade` (P2, M)
- **Custo de inação em 6 meses**: baixo. **Não** propor tirar migration do boot sem substituto (§7).

### R-8: Rota removida sem 410 Gone / Deprecation / política de versionamento
- **QA(s) afetados**: Integrability, Deployability
- **Findings**: F-integrability-4 (P2), F-deployability-6 (P3)
- **Evidência**: `GET /permutas/painel` deletado por deleção pura. `grep -rn "Sunset|Deprecation" src/backend/routes` = 0. Nenhuma rota versionada.
- **Impacto técnico**: consumidor externo hipotético recebe 404 mudo.
- **Impacto de negócio**: baixo hoje; registra padrão para próximas remoções.
- **Cards Kanban relacionados**: `deprecacao-rotas` (P2, M)
- **Custo de inação em 6 meses**: em ~6 meses outra rota vai sair com o mesmo raciocínio "zero call sites no repo"; algum consumidor (potencialmente do próprio cliente) quebra no dia do deploy.

### R-9: `EleicaoPermutasService.ts` atravessou 1000 LOC — 6 responsabilidades num arquivo
- **QA(s) afetados**: Modifiability, Testability
- **Findings**: F-modifiability-4 (P2), F-modifiability-5 (P2)
- **Evidência**: 1008 LOC pós-delta (+34). Fan-out Conexos + advisory lock + orquestração + hidratação + `contarPorEstado` + persistência.
- **Impacto técnico**: teste do delta cresceu 216 linhas num arquivo já grande.
- **Impacto de negócio**: médio no acumulado.
- **Cards Kanban relacionados**: `split-eleicao-service` (P2, L)
- **Custo de inação em 6 meses**: dívida cresce a cada mudança em qualquer das 6 responsabilidades.

### R-10: Retenção/particionamento de `permuta_candidata_snapshot` inexistente
- **QA(s) afetados**: Performance, Availability
- **Findings**: F-performance-3 (P2)
- **Evidência**: 1.906 lin/dia × 365 = 697 k novas em 12 meses (total 848 k). Zero hits para `partition|prune|retention` em 55 migrations. Scan de 848 k ≈ 14,5 s.
- **Impacto técnico**: em 12–18 meses, cada nova migração sobre snapshot vira decisão de janela de deploy.
- **Impacto de negócio**: baixo agora, cresce trimestralmente.
- **Cards Kanban relacionados**: `retencao-snapshot` (P2, L)
- **Custo de inação em 6 meses**: nulo a curto prazo. Prevenção arquitetural.

## 3. Cross-cutting findings

### CC-1: Rollback determinístico da 0054 (script `.down.sql` + dump prévio)
- **Aparece em**: Availability, Deployability, Fault Tolerance, Integrability, Modifiability
- **Findings**: F-availability-2 (P1), F-deployability-1 (P1), F-fault-tolerance-1 (P1), F-integrability-5 (P2), F-modifiability-8 (P3)
- **Diagnóstico unificado**: 5 agentes distintos identificaram o mesmo gap. Reverse é determinístico porque `motivo_bloqueio` sobrevive à migration — ausência é por omissão, não impossibilidade. Padrão do repo (55 migrations, 0 `.down.sql`) sinaliza que este é o momento de inaugurar a prática.
- **Recomendação consolidada**: 1 card (`rollback-0054`, P1, S). `0054_estado_ja_permutado.rollback.sql` + `permuta_candidata_snapshot__pre0054` (backup opcional) + `docs/runbooks/rollback-0054.md`. Política: migration com `UPDATE` sobre >1000 linhas exige script de reverse na review.

### CC-2: Deploy-rollback assimétrico (CHECK permissiva pós-migration + código antigo)
- **Aparece em**: Fault Tolerance, Deployability
- **Findings**: F-fault-tolerance-2 (P1), F-deployability-2 (P1)
- **Diagnóstico unificado**: CHECK nova aceita silenciosamente o comportamento antigo. Rollback do BE reintroduz achatamento sem violação de constraint. `BootMigrator` cobre forward; "rollback deploy" do Render só reverte código. **Este é o risco não mitigado do delta**, distinto do CC-1.
- **Recomendação consolidada**: 1 card (`rollback-assimetrico`, P1, M). Preferida: TRIGGER `BEFORE INSERT/UPDATE` que rejeite `estado_elegibilidade='bloqueada' AND motivo_bloqueio='ja-permutado'` (combo antigo) — se código antigo tentar reintroduzir, INSERT falha alto. Alternativa leve: runbook explícito forçando reverter migration antes do código.

### CC-3: Taxonomia em 6 fontes TS paralelas + exaustividade ausente
- **Aparece em**: Modifiability, Integrability, Testability
- **Findings**: F-modifiability-1 (P1), F-modifiability-2 (P1), F-modifiability-7 (P3), F-integrability-2 (P2), F-testability-3 (P2)
- **Diagnóstico unificado**: 6 fontes TS (enum + 2 unions repo/interface + 1 union frontend + 2 arrays de labels). As 2 CHECKs SQL diferem em `descoberta` **por design, não por descuido**: `descoberta` é o estado transitório antes da avaliação e o snapshot só grava candidatas já avaliadas — a diferença é uma invariante mais forte, não uma inconsistência. Adicionar 1 estado quebra o build em **1 lugar** e silencia em **≥20** (5% de cobertura). Padrão que permitiu o bug original permanece parcialmente exposto — no TypeScript, não no schema.
- **Recomendação consolidada**: 2 cards.
  - `taxonomia-fonte-unica` (P1, M): `ESTADO_ELEGIBILIDADE` como única fonte; frontend importa via barrel/codegen; a diferença deliberada em `descoberta` fica documentada como comentário em ambas as CHECKs.
  - `assertNever-propagacao` (P1, M): helper `src/backend/domain/libs/assertNever.ts`; refatorar 6+ sítios para `switch` + `default: assertNever`.

### CC-4: Boot bloqueante sem observabilidade
- **Aparece em**: Availability, Performance
- **Findings**: F-availability-3 (P2), F-performance-1 (P1 → P2 na consolidação)
- **Diagnóstico unificado**: **não é para tirar migration do boot** — é mitigação deliberada pós-incidente 2026-08-10 (§7). O que resta é observabilidade.
- **Recomendação consolidada**: 1 card (`boot-observabilidade`, P2, M). Mini-server respondendo `/health` `{status:'migrating'}` antes de `BootMigrator.run()`. `SET LOCAL statement_timeout` no runner.

### CC-5: `lock_timeout` + `statement_timeout` + `NOT VALID` ausentes
- **Aparece em**: Availability, Performance
- **Findings**: F-availability-1 (P1), F-performance-4 (P3)
- **Diagnóstico unificado**: nenhuma das 55 migrations seta timeouts. Volume atual pequeno (22 MB), cresce linearmente.
- **Recomendação consolidada**: 1 card (`lock-timeout-not-valid`, P1, S). Custo mínimo, sem contrapartida. `SET LOCAL lock_timeout='30s' / statement_timeout='5min'` no `MigrationRunner.run`; convenção `NOT VALID` + `VALIDATE CONSTRAINT` em tabela >10 k linhas.

### CC-6: Deprecação de rota sem política HTTP (410 Gone / Sunset)
- **Aparece em**: Integrability, Deployability
- **Findings**: F-integrability-4 (P2), F-deployability-6 (P3)
- **Diagnóstico unificado**: deleção pura sem versionamento; `docs/api/CONTRACTS.md` inexiste.
- **Recomendação consolidada**: 1 card (`deprecacao-rotas`, P2, M). Publicar `docs/api/CONTRACTS.md`; política: 1 sprint antes = `Deprecation: true` + `Sunset` + log `BUSINESS_WARN`; remoção = 410 Gone com body por 1 sprint; depois 404.

### CC-7: Anti-padrão `.not.toBe(<código HTTP>)` em teste de autorização
- **Aparece em**: Security, Testability
- **Findings**: F-security-1 (P1 — neutralizado pelo delta), F-security-2 (P3), F-testability-4 (P3), F-testability-5 (P3)
- **Diagnóstico unificado**: descoberta metodológica — sonda RBAC em `origin/main` passava por acidente. Delta corrige. Padrão morto no repo, nada impede reintrodução.
- **Recomendação consolidada**: 1 card (`lint-not-tobe`, P3, S). Regra do PatternGuardian ou script CI que proíbe `\.not\.toBe\((200|201|401|403)\)` em teste dentro de `describe` contendo `RBAC|requireRole|role|auth`.

## 4. Quick wins (≤5 dias úteis, esforço S, severidade ≥ P2)

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| `rollback-0054` | FT + 4 (CC-1) | S | P1 | Caminho scriptado (RTO ≈ 5 min) em vez de "avançar corrigindo" |
| `lock-timeout-not-valid` | AV + PE (CC-5) | S | P1 | Boot travado em lock: ∞ → ≤ 30 s |
| `view-compat-snapshot` | IN | S | P1 | Leitor externo com `WHERE status='bloqueada'` preserva semântica |
| `cobertura-motivos` | AV | S | P2 | Motivos silenciosamente absorvidos por `ELSE`: possível → 0 |
| `pg-do-pos-backfill` | FT | S | P2 | Cobertura I5 sobre histórico: pré-condição → linha a linha |
| `job-audit-i5` | FT | S | P2 | Divergência silenciosa detectada em ≤ 24 h |
| `migration-begin-commit` | FT | S | P2 | Atomicidade multi-statement passa a ser invariante testada |
| `fast-check-i5` | TE | S | P2 | Formatos de input para I5: 1 → ≥ 100 |
| `metricas-camelcase` | IN + MO | S | P2 | 6/6 chaves em camelCase ASCII |
| `colapsar-scans-0054` | PE | S | P2 | Passes de tabela cheia: 4 → 2 (para próxima migration) |
| `rbac-gestao-adr` | SE | S | P2 | Política de leitura `/gestao` documentada por ADR ou gatiada por role |
| `bump-version-node` | DP | S | P2 | Dev Linux completa o Ship sem `pwsh` |
| `changelog-promover` | DP | S | P2 | `## Não lançado` promovido sem merge manual |
| `node-unificar` | DP | S | P2 | 1 versão de Node em todo o pipeline |

**14 quick wins** ≈ 14 dias úteis distribuíveis entre 2–3 devs = **1 sprint**.

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| `rollback-assimetrico` | FT + DP (CC-2) | M | Sanity Checking + Rollback | Fecha a janela **não mitigada** do delta: ~80 linhas de `ja-permutado` viram `bloqueada` em rollback do BE sem constraint violation |
| `taxonomia-fonte-unica` | MO + IN (CC-3a) | M | Restrict Dependencies + Encapsulate | Adicionar 1 estado toca 1 arquivo TS em vez de 6; próxima ampliação (`EXECUTADA` ADR-0013) sai por metade do custo (~10 → ≤ 4 arquivos) |
| `assertNever-propagacao` | MO + TE + IN (CC-3b) | M | Refactor + Abstract Common Services | Sítios exaustivos: 1 → ≥ 6 (5% → 75%+). Estado novo quebra build em cada lugar que decide sobre ele |
| `boot-observabilidade` | AV + PE (CC-4) | M | Ping/Echo + Bound Execution Times | Sonda vê `{status:'migrating'}`; destrava rolling deploy; cronometra próxima migration (não medido em PRD hoje) |
| `deprecacao-rotas` | IN + DP (CC-6) | M | Versioning strategy | Próxima remoção passa por 410 Gone + Sunset; base para `docs/api/CONTRACTS.md`. Alto ROI institucional |
| `totals-record` | MO | M | Increase Semantic Coherence | Novo estado propaga automaticamente; 4 declarações duplicadas → 1 |
| `migration-test-harness` | TE + DP | L | Sandbox + Executable Assertions | Harness reutilizável para próximas 0054-like (`_watchlist.md` já pauta em recebimentos/pagamentos) |
| `split-eleicao-service` | MO | L | Split Module | 1008 LOC → 3 arquivos ≤ 500; testes deixam de empilhar |
| `retencao-snapshot` | PE | L | Bound Queue Sizes | DDLs sobre snapshot: linear em 12M rows → constante em 1M (partição do mês). Prevenção arquitetural |

## 6. O que está bem (e por quê)

1. **Convergência header ↔ snapshot por construção** — `EleicaoPermutasService.contarPorEstado` alimenta o mesmo objeto de totais que vai ao header (`...totals`) e o snapshot vem da mesma coleção `candidatas`. Tactic: **State Resynchronization eliminada por design**. Provada com service+repo REAIS contra DB mockado (`EleicaoPermutasService.test.ts:1259-1281`), não por afirmação em mock.
2. **Asserção de reconciliação ANTES das mutações** (`DO $$ ... RAISE EXCEPTION` na §4 do 0054). Tactic: **Sanity Checking + Comparison**. Aborta a transação inteira se header e snapshot reclassificado divergirem em qualquer das 250 runs — atomicidade garantida pelo simple-query protocol.
3. **Backfill recomputa `total_bloqueadas` por JOIN, não por subtração** (§7 do 0054). Idempotência preservada mesmo em replay.
4. **Exaustividade com `const _: never` em `IngestaoPermutasService.toEstadoRow`** (`:287`) — substitui o `default: 'descoberta'` de `origin/main` que era o vetor de silenciamento.
5. **Fail-loud na leitura**: `parseStatusSnapshot` e `parseEstadoElegibilidadeRow` lançam em valor fora do enum; catch-all silencioso do read-path removido.
6. **Sonda de RBAC falso-verde substituída por asserção real**: `origin/main` mockava `montarPainel` enquanto a rota chamava `exporNoPainel` — 500 ≠ 403, e `.not.toBe(403)` passava por acidente. Delta troca por `toBe(200)` + `toHaveBeenCalled()`.
7. **`ja-permutado` promovido a estado de primeira classe** (ADR-0043; transição T6 documentada) — sai da categoria "bloqueada+motivo" que inflacionava indevidamente a fila de terceiro.
8. **Trilha de auditoria + advisory lock + idempotency-key** cobrindo o gatilho crítico da eleição. 5 chaves distintas de advisory lock sem colisão cross-frente.

## 7. Limitações da análise

**Métricas não medíveis localmente:**
- Duração real da 0054 em PRD (Supabase Session-pooler) — só container local cronometrado (2,6 s).
- MTTR observado de rollback via git revert + redeploy.
- Janela em que `/health` fica sem resposta durante deploy.
- Timeout efetivo do health-check do Render (dashboard, não versionado).
- Cobertura (`--coverage`) e `npm audit` — desativados por `--quick`.
- Consumidores externos da tabela e do endpoint removido (BI, planilhas, jobs Airflow do cliente) — não há inventário formal.

**O que o pipe NÃO cobre**: chaos engineering, threat modeling formal, custo cloud, UX/acessibilidade, IaC (não há `infra/`).

**Contextos deliberados (não são omissões):**
- **Migration no caminho do boot** (`src/backend/index.ts:147-173`): mitigação adotada pós-incidente 2026-08-10 (código da ADR-0032 chegou a PRD antes da 0044). `preDeployCommand` do Render é indisponível no plano atual. Nenhum card propõe desfazer isso — a janela "código novo × schema velho" está estruturalmente impedida. Resta a janela inversa (CC-2) e observabilidade do boot (CC-4).
- **Chaves em pt-BR com espaço/acento no `JobRunReadModel.metricas`**: decisão explícita do Yuri para evitar tocar o frontend e acionar o DesignSystemReviewer. Registrado como **dívida consciente** com card `metricas-camelcase` (P2). Não é descuido — é apresentação dentro do contrato HTTP.
- **CHECK de `descoberta` presente em `permuta_adiantamento` e ausente em `permuta_candidata_snapshot`**: **não é divergência** — é invariante mais forte no snapshot. Uma candidata só é snapshotada depois da avaliação; `descoberta` é o estado transitório antes disso. O banco rejeita gravar auditoria de algo não avaliado. O card `taxonomia-fonte-unica` documenta essa diferença como intencional em ambas as CHECKs.
- **Volume medido em PRD**: PostgreSQL 17.6, tabela 22 MB / 152.516 linhas, índice em `(run_id)` existe. Os 2,6 s locais são plausíveis. **Risco da 0054 é de corretude e ordem de deploy, não janela de lock.** F-performance-1 foi rebaixado de P1 para P2 na consolidação; F-performance-5 já era P3 no arquivo.
- **Nenhum P0**: por decisão explícita. Se algum revisor discordar, o ônus é apresentar baseline numérico + cenário concreto de dano que o merge cause. O prompt do orquestrador confirma este juízo.

**Janela temporal**: snapshot de 2026-09-08. Código é vivo — refazer trimestralmente. Este delta em particular já pauta 3 seguidas no `_watchlist.md` (recebimentos, pagamentos, permutas).

## 8. Ações recomendadas (próximos 30 dias, em ordem)

1. **Antes do merge:** aplicar `rollback-0054` (P1, S) e `lock-timeout-not-valid` (P1, S). Custo mínimo, fecha a janela P1 mais barata (CC-1 + CC-5). O merge do delta atual passa; o próximo deploy tem defesas que não existem hoje.
2. **Sprint 1 pós-merge:** endereçar 100% dos P1 restantes — `rollback-assimetrico` (CC-2), `taxonomia-fonte-unica` (CC-3a), `assertNever-propagacao` (CC-3b), `migration-test-harness`, `view-compat-snapshot`. Estes cinco cards previnem que o padrão que causou o bug original reintroduza-se com o próximo estado (ADR-0013 Fase 3).
3. **Sprint 2:** limpar backlog de P2 barato (14 quick wins da §4).
4. **Trimestre:** cards L (`split-eleicao-service`, `retencao-snapshot`, `migration-test-harness` se não coube na sprint 1).
5. **Governança contínua:** rodar Regis-Review no próximo delta que tocar `EstadoElegibilidade` ou qualquer migration >50 LOC para verificar se os cards P1 foram absorvidos.
