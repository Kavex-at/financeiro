---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-15-1835-permutas-excecao-manual
agent: qa-deployability
generated_at: 2026-09-15T18:55:00Z
scope: backend+frontend
score: 8.2
findings_count: 4
cards_count: 4
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta permutas-excecao-manual)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Merge da branch `fix/permutas-excecao-manual` em `main` (`.github/workflows/ci.yml` gates de CI passam, push dispara autoDeploy do Render para o backend e da Vercel para o frontend em paralelo) | Deploy carrega: (a) migration nova `0059_excecao_permuta.sql` (CREATE TABLE `permuta_excecao_manual` + estende a CHECK `permuta_adiantamento_sem_estado_colapsado` da 0055 com o motivo `permutado-fora-do-painel` — `NOT VALID` + `VALIDATE`); (b) 2 rotas admin (POST/DELETE `/permutas/adiantamentos/:docCod/excecao-manual`); (c) campo aditivo `PermutaPendente.excecaoManual?: ExcecaoManualDetalhe` no contrato REST; (d) pós-passe `aplicarExcecoesManuais` na eleição (`EleicaoPermutasService:406,433-484`); (e) UI de marcar/desfazer + tag "Exceção manual" | Backend Render (`financeiro-backend`, plan starter, autoDeploy on push a `main`), frontend Vercel autoDeploy, Postgres Supabase compartilhado, 1 tenant (Columbia Trading). Migração roda no boot via `BootMigrator` (`SET LOCAL lock_timeout=30s`/`statement_timeout=10min` — `runMigrations.ts:26-29`), advisory lock `BOOT_MIGRATION_LOCK_KEY=314159265`. Sem canary/blue-green. | Produção prd, autoDeploy paralelo Render↔Vercel sem gate cruzado; branch `origin/feat/metricas-ciclo` viva em paralelo com **outra migration `0058_vw_metricas_ciclo.sql` e ADR-0045 reservados** — coordenação de numeração feita a priori (`tasks.md` §"Numeração reservada"). Kill-switches vigentes: `RECEBIMENTOS_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED`, `CONEXOS_WRITE_ENABLED`; **Permutas não tem um** e este delta não introduziu. | (1) BootMigrator aplica 0059 antes do `app.listen` — falha na migração → processo morre com exit 1 → Render mantém a versão anterior no ar (`DEPLOY.md §2`). (2) 0059 é aditivo puro (`CREATE TABLE IF NOT EXISTS` + `ADD CONSTRAINT ... NOT VALID` + `VALIDATE` idempotente); rollback do código sem reverter schema é o modo suportado (`rollback.md §"código e schema não voltam juntos"`, tabela "migration aditiva → seguro"). (3) Contrato REST é aditivo: campo `excecaoManual?` optional; FE antigo ignora silenciosamente, FE novo com BE antigo cai em 404 (chamada só ao clicar "Marcar exceção", admin only). (4) Sem kill-switch: bug em `ExcecaoPermutaService.marcar/desfazer` só reverte por `git revert` + redeploy (~3-5min do build Render). | Deploy verde = 0 corrupção de dado (guarda `NOT VALID`+`VALIDATE` prova que nenhuma linha existente viola a CHECK nova, `0059:73-82`). RTO de rollback ≈ 5min pelo botão "Rollback to this deploy" do Render, sem reverter schema (`rollback.md:38`). Janela de assimetria FE↔BE: ~30-60s (Vercel ~30s vs Render `npm ci && build` ~50s); durante a janela, único caminho quebrado é o clique admin em "Marcar exceção". Blast radius: 1 tenant, `admin` role obrigatório em ambas as rotas (`routes/permutas.ts:452,509`), única mutação escreve em tabela nova sem FK. Observabilidade: 3 pontos de `LogService.info`/`warn` — `ExcecaoPermutaService:159,189` (BUSINESS_INFO) e `EleicaoPermutasService:444` (BUSINESS_WARN `excecao-inaplicavel`). |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migrations novas no delta | 1 (`0059_excecao_permuta.sql`, +100 linhas) — aditiva pura (CREATE TABLE + CHECK NOT VALID + VALIDATE); rollback script **não requerido** por política (`rollbacks/README.md` — só exige reverse para UPDATE > 1000 linhas) | 0 ou N com reverse quando destrutiva | ✅ | `ls src/backend/migrations/0059_excecao_permuta.sql`; `rollbacks/README.md:33-39` |
| Numeração de migration coordenada com `origin/feat/metricas-ciclo` | `0058_vw_metricas_ciclo.sql` está no `origin/feat/metricas-ciclo` (`git ls-tree origin/feat/metricas-ciclo src/backend/migrations/`); este delta pulou o 0058 deliberadamente e usou 0059. Se `feat/metricas-ciclo` mergear DEPOIS deste PR, o `MigrationRunner` aplicará 0058 fora de ordem numérica no primeiro boot (aplica só quem falta em `schema_migrations`) — as duas migrations são independentes (0058=view sobre tabelas existentes, 0059=tabela nova + CHECK sobre `permuta_adiantamento`/`permuta_candidata_snapshot`), então a ordem inversa não quebra | numeração linear (0058→0059) | ⚠️ | `tasks.md §"Numeração reservada: migration 0059 (a 0058 está em origin/feat/metricas-ciclo)"`; `runMigrations.ts:66-76` (`.sort()` lexicográfico + skip por `schema_migrations`) |
| Passos automatizados commit→prd | Backend: 7 (`checkout`, `setup-node`, `npm ci`, `npm audit --audit-level=high`, `typecheck`, `lint`, `test --coverage`, `build`) + Render autoDeploy. Frontend: 5 (`checkout`, `setup-node`, `npm ci`, `typecheck`, `lint`, `test --coverage`) + Vercel autoDeploy. `tag-release` job idempotente cria tag/GH Release a partir da versão do `package.json` | ≥5 | ✅ | `.github/workflows/ci.yml:10-73` |
| Idempotência do 0059 | Aplicada 3× em Postgres 16 local descartável sem erro (`_shared-metrics.md`); `CREATE TABLE IF NOT EXISTS` + `DROP CONSTRAINT IF EXISTS` + `ADD ... NOT VALID` + `VALIDATE` para as 2 CHECKs; `CREATE UNIQUE INDEX IF NOT EXISTS` no índice parcial | idempotente | ✅ | `_shared-metrics.md §"Migration 0059 aplicada 3×"`; `0059_excecao_permuta.sql:43-84` |
| Rollback simétrico do delta | Código pode voltar sem reverter schema: tabela `permuta_excecao_manual` fica ociosa (código antigo nem sabe que existe); as CHECKs redefinidas seguem válidas porque o motivo `permutado-fora-do-painel` só é escrito por código novo (`0059:37-40` documenta este ponto). Reverse não escrito e não necessário (`rollbacks/README.md`) | RTO ≤ 5min | ✅ | `docs/runbooks/rollback.md:14-22`; `0059_excecao_permuta.sql:31-40` |
| Back-compat FE→BE (BE novo, FE antigo) | Novo campo `PermutaPendente.excecaoManual?: ExcecaoManualDetalhe` (`Gestao.ts:83-99`, `PermutaPendente:138-139`) é `optional` no TypeScript e ausente no JSON quando não há exceção — FE antigo simplesmente não lê a propriedade (o componente `ExcecaoManualDialog.tsx` e `useExcecaoManual.ts` são adição nova) | contrato aditivo | ✅ | `Gestao.ts:83-99,138-139`; `git diff --stat -- src/frontend/app/permutas/components/` mostra só arquivos novos ou linhas adicionadas |
| Back-compat FE→BE (FE novo, BE antigo, janela paralela Render↔Vercel) | Vercel promove tipicamente antes do Render (~30s vs `npm ci && build` do Render ~50s). Usuário admin abrindo o painel nessa janela e clicando "Marcar exceção manual" pega `404` em `POST /permutas/adiantamentos/:docCod/excecao-manual`. O `apiFetch` trata como `Error(\`API 404 — …\`)`, o `useExcecaoManual.ts` traduz para toast de erro. Não há corrupção de dado; único efeito é a UX confusa por até ~30s | quebra funcional zero | ⚠️ (janela curta, restrito a admin) | `render.yaml:5-17`; `.github/workflows/ci.yml`; `src/frontend/lib/api.ts:288-322`; `useExcecaoManual.ts` |
| Kill-switch para as rotas de exceção manual | **Ausente**: `routes/permutas.ts:449-514` não consulta `EnvironmentProvider`/`process.env` para as duas rotas novas. Precedente do repo: `RECEBIMENTOS_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED`, `CONEXOS_WRITE_ENABLED` (`render.yaml:41-71`, `sync:false` = dashboard) | flag opcional | ⚠️ (P2 mitigado por RBAC `admin` + 1 tenant + escrita só em `permuta_excecao_manual`) | `grep -n "process.env\|EnvironmentProvider" src/backend/routes/permutas.ts src/backend/domain/service/permutas/ExcecaoPermutaService.ts` → nenhuma ocorrência das rotas novas |
| Observabilidade do delta em prd | 3 pontos de log: `BUSINESS_INFO "exceção manual de permuta registrada"` (`ExcecaoPermutaService:159`), `BUSINESS_INFO "exceção manual de permuta desfeita"` (`:189`), `BUSINESS_WARN "excecao-inaplicavel"` na eleição (`EleicaoPermutasService:444`). Auditoria com `docCod`+`criadoPor`/`removidoPor`. Nenhum `LogService.error` sem `try/catch` novo | ≥1 log auditável por mutação + warn por transição inválida | ✅ | `grep -n "logService" src/backend/domain/service/permutas/ExcecaoPermutaService.ts src/backend/domain/service/permutas/EleicaoPermutasService.ts` |
| Guarda `NOT VALID` + `VALIDATE` para as CHECKs redefinidas | 0059 usa `ADD CONSTRAINT ... NOT VALID` seguido de `VALIDATE CONSTRAINT` (`0059:57-84`). Se qualquer linha existente violasse a nova CHECK, o `VALIDATE` levantaria erro → boot falha → Render mantém a versão anterior (padrão do `runMigrations.ts:26-29` com `lock_timeout=30s`) | validação sem lock exclusivo prolongado | ✅ | `0059_excecao_permuta.sql:57-84`; `runMigrations.ts:26-29` |
| Duração estimada do boot com 0059 | Migration só cria uma tabela pequena e valida 2 CHECKs sobre `permuta_adiantamento` (~1247 linhas em prd, `_shared-metrics.md` sibling) e `permuta_candidata_snapshot`; espera-se < 500ms de DDL; boot total influenciado por `npm ci && build` do Render ~50s | build+boot ≤ 90s | ✅ | ordem de grandeza; não medível localmente com dado de prd (sem acesso) |
| Reprodutibilidade de build | `package-lock.json` versionado em `src/backend` e `src/frontend`; `npm ci` no CI; Node fixado em `24` no `ci.yml:19-22` e nos crons de ingestão (a divergência 22/24 do ciclo anterior foi resolvida — `feat/metricas-ciclo` inclui bumps; este delta não regride) | lockfile + pin | ✅ | `.github/workflows/ci.yml:19-22`; `_shared-metrics.md §"gate results at green"` |
| Rotas HTTP novas | 2 (`POST` e `DELETE` em `/permutas/adiantamentos/:docCod/excecao-manual`), ambas `requireRole('admin')` | RBAC estrito para rotas de mutação | ✅ | `routes/permutas.ts:449-514` |
| Dependências novas em `package.json` | 0 (`git diff origin/main..HEAD -- src/backend/package.json src/frontend/package.json` sem mudança estrutural) | 0 se possível | ✅ | `git diff --stat origin/main..HEAD -- 'src/*/package*.json'` = vazio |
| Bump de versão do app (lockstep FE+BE) | Base `v0.36.5` (topo do `main` — `chore(release): v0.36.5`). Delta traz 4 `feat(permutas)` + 1 `fix(permutas-ui)` → qualifica para `minor` (`v0.37.0`). **Resolvido-pelo-pipeline** (step de ship do `/feature-tweak` — não é follow-up) | `v0.37.0` FE=BE + tag Git | ✅ (pipeline) | `jq -r .version src/*/package.json` → `0.36.5`; instrução do orquestrador |
| Escopo Terraform / IaC | ⚠️ **Não medível**: repo não tem `infra/`. Deploy = Render + Vercel; tactic multi-tenant IaC = N/A | — | ⚠️ N/A | `ls infra/` → inexistente; `_shared-metrics.md` |
| Blast radius do deploy | 100% dos usuários admin do único tenant (Columbia Trading, 1 serviço Render), mas mutação restrita a 1 adto por request e escrita SÓ na nova tabela `permuta_excecao_manual` — sem chamada ao ERP (`ADR-0047 §D6`: "Marcar e desfazer escrevem só no nosso banco. I4 intocado.") | — | ⚠️ (pré-existente do single-tenant) | `render.yaml:5-17`; ADR-0047 §D6 |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Deploy monolítico Render+Vercel, sem canary/blue-green. Delta compensa parcialmente com **RBAC `admin`** — a rota nova é literalmente inatingível para não-admins mesmo se algo der errado no auth (`routes/permutas.ts:451,510`). Convergência natural: `aplicarExcecoesManuais` só afeta adtos com exceção ativa (`ativas.length === 0` → early return em `EleicaoPermutasService:437-441`), então o path só ativa depois de alguém clicar "Marcar" | ⚠️ parcial | `routes/permutas.ts:451,510`; `EleicaoPermutasService:437-441` |
| Rollback | 0059 é aditivo puro; rollback do código sem reverter schema é a via padrão documentada. Runbook `rollback.md §"tabela aditiva → seguro"` cobre este caso; RTO ≈ 5min pelo botão do Render. Sem `.rollback.sql` para 0059 (política do repo dispensa: sem UPDATE em massa, sem DROP/RENAME de coluna) | ✅ presente | `docs/runbooks/rollback.md:14-42`; `rollbacks/README.md:33-39` |
| Script Deployment Commands | Herdado: `render.yaml` (build/start), `BootMigrator` (schema no boot, mata processo se falha), `scripts/bump-version.ps1` (versão FE+BE lockstep), `.github/workflows/ci.yml` `tag-release` job idempotente. Delta **não muda** script de deploy | ✅ presente | `render.yaml`; `BootMigrator.ts`; `ci.yml:44-73` |
| Logical Grouping | `ExcecaoPermutaService` isola marcar/desfazer + `aplicarExcecoes` (pós-passe puro reusável na eleição); `ExcecaoPermutaRepository` isola SQL da nova tabela. Reclassificação vive na MESMA transação (`ExcecaoPermutaService:147-158, 172-190`) para não deixar tabela e estado calculado divergentes | ✅ presente | `ExcecaoPermutaService.ts:44-190` |
| Physical Grouping | Backend em serviço único Render (pré-existente); crons GH Actions (pré-existente); nenhum grupo físico novo introduzido | ✅ presente | `render.yaml:5-17`; `.github/workflows/ingest-permutas.yml` |
| Package Dependencies | 0 dependências novas (`git diff -- src/*/package.json` sem adds) | ✅ presente | `git diff --stat origin/main..HEAD -- 'src/*/package*.json'` = vazio |
| Surge Protection | N/A — rota admin, sem consumo elástico esperado (< 10 exceções manuais projetadas em toda a base, ADR-0047 §Consequências "1 documento") | N/A | ADR-0047 §Contexto |
| Idempotent Deploys | Migration 0059 idempotente ponta-a-ponta (`_shared-metrics.md` aplicou 3×); código é DI puro sem side effect de boot; re-deploy do mesmo commit = mesmo estado | ✅ presente | `_shared-metrics.md §"Migration 0059 aplicada 3× (idempotente)"` |
| Drift Detection | Ausente para o novo estado T7 (`ja-permutado + permutado-fora-do-painel`): nada compara "quantas exceções ativas existem" com "quantas linhas no `permuta_adiantamento` estão com o motivo novo". Se `reclassificarAdiantamento` falhar silenciosamente numa run sem transação (não é o caso — a MESMA transação cobre insert+reclassify, `ExcecaoPermutaService:147-158`), não há detector externo. Baixo risco porque a transação protege, mas o detector seria a defesa em profundidade | ⚠️ parcial | `ExcecaoPermutaService:147-158`; grep de "drift\|reconciliar.*excecao" → vazio |
| Reproducible Builds | `package-lock.json` versionado, `npm ci` no CI, Node 24 pin. Pré-existente, não agravado | ✅ presente | `.github/workflows/ci.yml:19-22` |
| Per-tenant blast-radius limit | N/A — SaaSo mono-tenant (Columbia). RBAC `admin` limita raio dentro do tenant | N/A | `CLAUDE.md §Tenants`; `render.yaml:5-17` |
| Deployment observability | 2 `BUSINESS_INFO` (marcar/desfazer) com `docCod` + `criadoPor`/`removidoPor`; 1 `BUSINESS_WARN` na eleição (`excecao-inaplicavel`, detalhe indisponível). `/health` (pré-existente) devolve `{status, version}` para confirmar rollout | ✅ presente | `ExcecaoPermutaService.ts:159,189`; `EleicaoPermutasService.ts:444` |
| Health Checks | `/health` + `/health/pipelines` pré-existentes; nenhum health check confirma que a nova tabela está criada, mas o `BootMigrator` **já garante isso por construção** (processo não escuta enquanto migração pendente — falha = exit 1 → Render segura versão nova) | ✅ presente (por construção) | `BootMigrator.ts:60-80`; `DEPLOY.md §"As migrations rodam no BOOT"` |
| Feature Flags | Kill-switches existem para outras frentes (`RECEBIMENTOS_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED`, `CONEXOS_WRITE_ENABLED`). Delta **não introduz** um flag para as rotas de exceção manual — bug em `ExcecaoPermutaService` só se mitiga por `git revert` + esperar autoDeploy (~3-5min) ou por SQL manual (`UPDATE permuta_excecao_manual SET removido_em=now()...`) | ❌ ausente (para este delta) | `grep -n "process.env\|EnvironmentProvider" src/backend/routes/permutas.ts` — sem match nas rotas 449-514 |

## 4. Findings

### F-deployability-1: Sem kill-switch para desligar as rotas de exceção manual sem redeploy

- **Severidade**: P2
- **Tactic violada**: Feature Flags, Scale Rollouts
- **Localização**: `src/backend/routes/permutas.ts:449-514` (POST + DELETE); `src/backend/domain/service/permutas/ExcecaoPermutaService.ts` (arquivo inteiro — sem consulta a `EnvironmentProvider`); `render.yaml:34-71` (kill-switches vigentes das outras frentes)
- **Evidência (objetiva)**:
  ```
  $ grep -n "process.env\|EnvironmentProvider\|_ENABLED" src/backend/routes/permutas.ts src/backend/domain/service/permutas/ExcecaoPermutaService.ts
  src/backend/routes/permutas.ts:580: (comentário sobre CONEXOS_WRITE_ENABLED — rota antiga, não a nova)
  src/backend/routes/permutas.ts:621: (idem)
  src/backend/routes/permutas.ts:658: (idem)
  src/backend/routes/permutas.ts:826: (idem)
  (0 matches nas linhas 449-514 das rotas novas; 0 matches no ExcecaoPermutaService)

  # precedente no repo:
  render.yaml:41-71 → RECEBIMENTOS_ENABLED / SISPAG_LIVE_WRITE_ENABLED / CONEXOS_WRITE_ENABLED
                     (sync:false = dashboard flip, sem redeploy)
  ```
- **Impacto técnico**: se `ExcecaoPermutaService.marcar` gravar exceção em adto errado (ex.: bug de resolução de `docCod` no path param, corrida com a ingestão que reclassifica no MESMO segundo), a única mitigação é (a) `git revert` + esperar o autoDeploy do Render (~3-5min do build) ou (b) `UPDATE permuta_excecao_manual SET removido_em=now(), removido_por='ops-manual'` direto no Supabase. Não há forma de "desligar as rotas por 10 min enquanto investigo" via dashboard.
- **Impacto de negócio**: baixo em severidade porque (1) escrita SÓ na nova tabela `permuta_excecao_manual`, sem tocar ERP (ADR-0047 §D6: "Marcar e desfazer escrevem só no nosso banco"), (2) RBAC `admin` limita quem pode disparar, (3) público-alvo declarado no ADR é **1 documento** (adto 8721). Ainda assim, o precedente do repo diz que rotas de mutação de estado do painel merecem kill-switch — sem ele, o time perde ~5min de MTTR em qualquer incidente.
- **Métrica de baseline**: 3 kill-switches em `render.yaml` para outras frentes; 0 para as rotas de exceção manual; 5min de MTTR estimado para revert vs ~30s para dashboard flip.

### F-deployability-2: Numeração de migration 0058 pertence a `origin/feat/metricas-ciclo` — ordem de aplicação em prd depende da ordem de merge

- **Severidade**: P2
- **Tactic violada**: Package Dependencies (na dimensão "ordem de aplicação"), Script Deployment Commands
- **Localização**: `src/backend/migrations/0059_excecao_permuta.sql` (arquivo criado sem 0058 correspondente no worktree); `git ls-tree origin/feat/metricas-ciclo src/backend/migrations/` (contém `0058_vw_metricas_ciclo.sql`, blob `7a4a823a`); `src/backend/migrations/runMigrations.ts:66-76` (runner usa `readdirSync().sort()` + skip por `schema_migrations`)
- **Evidência (objetiva)**:
  ```
  # nesta branch
  $ ls src/backend/migrations/*.sql | tail -3
  0057_permuta_execucao_guard_reabertura.sql
  0059_excecao_permuta.sql       ← pulou 0058 deliberadamente

  # branch paralela
  $ git ls-tree origin/feat/metricas-ciclo -r --name-only src/backend/migrations/ | grep 005
  ...
  0057_permuta_execucao_guard_reabertura.sql
  0058_vw_metricas_ciclo.sql     ← view CREATE OR REPLACE sobre tabelas existentes

  # tasks.md §"Numeração reservada":
  #   "migration 0059 (a 0058 está em origin/feat/metricas-ciclo), ADR 0047"

  # runner:
  const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  for (const file of files) {
      if (applied.has(file)) continue;
      ...
  }
  ```
- **Impacto técnico**: coordenação de numeração é **explícita e a priori** (`tasks.md`), o que reduz muito a severidade. Cenário residual: se este PR mergear PRIMEIRO em `main`, o boot aplica só 0059 (0058 ainda não existe no repo). Quando `feat/metricas-ciclo` rebasear e mergear depois, o boot seguinte encontrará `0058_vw_metricas_ciclo.sql` como "não aplicada" e a aplicará **APÓS** 0059 já ter rodado — o `.sort()` é lexicográfico mas o loop pula quem já está em `schema_migrations`, então a ordem cronológica de aplicação em prd fica `0059 → 0058`. As duas migrations são **independentes** (0058 = view em `permuta_bordero`/`permuta_execucao`, 0059 = tabela nova + CHECK em `permuta_adiantamento`/`permuta_candidata_snapshot`), então a inversão não quebra funcionalmente — mas fere a garantia implícita de que a numeração reflete a ordem de execução, o que costuma ser assumido em runbooks e análises post-mortem.
- **Impacto de negócio**: mínimo (funcional). O risco é de degradação de futuro: qualquer terceira migration que **assuma** "0058 já rodou antes de mim porque 0058 < eu" falhará silenciosamente se rodar antes de 0058 em prd mas depois em dev. Nenhuma migration futura declarou essa dependência ainda, mas o precedente é frágil.
- **Métrica de baseline**: 1 gap numérico (0058); 2 branches vivas com migrations sobrepostas na mesma janela de release; `runMigrations.ts` sem verificação de sequência (não checa se `0058` existe antes de aplicar `0059`, e nem checa se `applied[0057]` é predecessor de `applied[0059]`).

### F-deployability-3: Assimetria FE↔BE no autoDeploy paralelo causa janela de 404 na rota nova até o Render terminar o build

- **Severidade**: P3
- **Tactic violada**: Scale Rollouts (ordem indeterminada de deploy FE↔BE)
- **Localização**: `src/frontend/lib/api.ts:288-322` (`marcarExcecaoManual`/`desfazerExcecaoManual`); `src/backend/routes/permutas.ts:449-514` (rotas novas); `render.yaml:12-17` (`autoDeploy: true` sem gate cruzado com Vercel)
- **Evidência (objetiva)**:
  ```
  # FE novo chama rota que só existe no BE novo:
  export async function marcarExcecaoManual(docCod: string, justificativa: string): Promise<void> {
    const res = await apiFetch(
      `${API}/permutas/adiantamentos/${encodeURIComponent(docCod)}/excecao-manual`,
      { method: 'POST', ... },
    )
    if (!res.ok) await lancarErroExcecao(res)
  }
  # (lib/api.ts:288-301)

  # apiFetch com res.status=404 e sem body { message } (Express default) cai em:
  throw new Error(`API 404 — ...`)
  # (lib/api.ts:283-284)

  # Render build típico do repo: npm ci + tsc + esbuild ≈ 40-60s
  # Vercel typical Next.js build: ≈ 25-45s
  # Janela de assimetria ≈ 15-30s no pior caso
  ```
- **Impacto técnico**: janela curta (~30s) durante o push em `main` na qual o admin abrindo o painel e clicando "Marcar exceção manual" recebe toast de erro genérico "API 404 — invalid request". Zero corrupção de dado, zero perda funcional persistente. A janela é pequena, o público-alvo é `admin` e o volume esperado é ~1 clique/dia (ADR-0047 §Consequências: "1 documento"). O caminho reverso (BE novo, FE antigo) é **totalmente seguro** porque `excecaoManual?` é optional aditivo — FE antigo nunca lê a chave.
- **Impacto de negócio**: mínimo. Registrado por completude do modelo Bass e para o runbook mencionar "após deploy, esperar 90s para exercitar `/excecao-manual`". Sem card ativo — a mitigação é operacional (documentação).
- **Métrica de baseline**: 2 pipelines autoDeploy paralelos sem gate cruzado; 1 rota nova sem defensiva no FE contra 404 transitório; janela típica ~30s medida pelo tempo de build Render vs Vercel.

### F-deployability-4: Sem detector de drift entre `permuta_excecao_manual` ativa e o motivo real gravado em `permuta_adiantamento`

- **Severidade**: P2
- **Tactic violada**: Drift Detection, Deployment observability
- **Localização**: `src/backend/domain/service/permutas/ExcecaoPermutaService.ts:147-158, 172-190` (transação encapsulada); nenhum job em `src/backend/jobs/` compara exceções ativas × estado real; `src/backend/migrations/0059_excecao_permuta.sql:57-71` (CHECK impede o estado colapsado mas não confirma consistência)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "drift\|reconciliar.*excecao\|verificar.*excecao" src/backend/jobs src/backend/domain/service/permutas
  (vazio)

  # A guarda vigente:
  # ExcecaoPermutaService:147-158 — insert + reclassify na MESMA transação
  # 0059:57-71 — CHECK proíbe (bloqueada AND motivo IN ('ja-permutado','permutado-fora-do-painel'))
  # ADR-0047 §D4 — "O ERP vence": eleição pode reverter estado da exceção se valorPermutado > 0

  # Cenário de drift:
  # exceção ativa em permuta_excecao_manual + ingestão do Conexos passa e o adto acaba com
  # valorPermutado > 0 → estado natural JA_PERMUTADO / ja-permutado (não mais 'permutado-fora-do-painel')
  # → exceção fica "registrada, não aplicada" (D4). Nenhum contador informa quantos adtos
  # estão neste estado; só aparece pela flag `ativa: false` no payload da linha na tela.
  ```
- **Impacto técnico**: a transação (`withTransaction`) e a CHECK garantem que insert+reclassify não fica pela metade. Porém, o "vetor de drift" descrito no ADR §D4 ("o ERP vence") produz linhas onde `permuta_excecao_manual` está ativa mas `permuta_adiantamento.motivo_bloqueio ≠ 'permutado-fora-do-painel'`. Isso é **comportamento correto**, não bug — mas sem detector, o operador não tem contador agregado ("N exceções registradas, M aplicadas") e depende de olhar linha a linha na tela. Se, por outra via (ex.: SQL manual, bug futuro), a tabela e o estado divergirem além do caminho D4 previsto, ninguém notará até um analista abrir o adto específico.
- **Impacto de negócio**: baixo mas monotônico com o uso. Hoje é 1 documento (8721). Se o padrão crescer para dezenas, a ausência de "contador de saúde" força auditoria manual. Runbook não menciona query de reconciliação.
- **Métrica de baseline**: 0 jobs de reconciliação para `permuta_excecao_manual`; 3 pontos de log por linha individual (marcar/desfazer/eleição), 0 agregados; N=1 caso de negócio hoje, expectativa < 10.

## 5. Cards Kanban

### [deployability-1] Introduzir kill-switch `PERMUTAS_EXCECAO_MANUAL_ENABLED` para as rotas de marcar/desfazer

- **Problema**
  > As rotas POST/DELETE `/permutas/adiantamentos/:docCod/excecao-manual` não consultam `EnvironmentProvider`. Se `ExcecaoPermutaService.marcar` gravar em adto errado (bug em resolução de `docCod` ou corrida com ingestão), a única mitigação é `git revert` + esperar o autoDeploy do Render (~5min de build) ou `UPDATE` manual no Supabase. Não existe forma de desligar as rotas por 10 min via dashboard, embora o precedente do repo (`RECEBIMENTOS_ENABLED`, `SISPAG_LIVE_WRITE_ENABLED`, `CONEXOS_WRITE_ENABLED`) demonstre que rotas admin de mutação recebem essa apólice.

- **Melhoria Proposta**
  > Adicionar `PERMUTAS_EXCECAO_MANUAL_ENABLED` em `render.yaml` (`sync: false`, default `true`), lido por `EnvironmentProvider`. Em `routes/permutas.ts:449, 500`, gate antes de `bootstrapAppContainer()`: se `false`, devolver `503 { error: 'permutas-excecao-manual-desligada' }`. Mesmo padrão do `RECEBIMENTOS_ENABLED` em `http/permissions.ts` (frente que já usa esse gate). Tactic Bass: **Feature Flags + Scale Rollouts**.

- **Resultado Esperado**
  > Se aparecer bug na feature, o operador flipa a env no dashboard do Render e ambas as rotas devolvem 503 em segundos, sem redeploy. `git revert` fica como fix definitivo, sem pressão de MTTR. `/health/pipelines` opcional expõe o estado da flag.

- **Tactic alvo**: Feature Flags
- **Severidade**: P2
- **Esforço estimado**: S (≤0.5d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Kill-switches para rotas admin de Permutas: 0 → 1
  - MTTR para desligar `marcar`/`desfazer`: ~5min (revert+deploy) → ~30s (dashboard flip)
- **Risco de não fazer**: bug em `ExcecaoPermutaService` escala para incidente com 5min de MTTR fixo — pequeno em severidade porque só toca `permuta_excecao_manual`, mas evitável.
- **Dependências**: nenhuma. Segue exatamente o padrão do `RECEBIMENTOS_ENABLED`.

### [deployability-2] Coordenar a numeração de migration com `origin/feat/metricas-ciclo` no momento do merge (rebase-then-rename)

- **Problema**
  > `origin/feat/metricas-ciclo` tem `0058_vw_metricas_ciclo.sql`; este delta pulou 0058 e usou 0059 (documentado em `tasks.md §"Numeração reservada"`). Se este PR mergear primeiro, no boot seguinte o `MigrationRunner` aplicará **`0059` antes de `0058`** (0058 ainda não existe em `main`; ele chega no merge posterior). O runner só verifica presença em `schema_migrations`, não sequência; as duas migrations são independentes hoje, mas o precedente frágil permanece.

- **Melhoria Proposta**
  > (a) Fluxo operacional: quem mergear em segundo lugar **renomeia** sua migration para o próximo número livre em `main` (ex.: `feat/metricas-ciclo` renomeia `0058_vw_metricas_ciclo.sql` → `0060_vw_metricas_ciclo.sql` antes do PR se este delta mergear primeiro). (b) Guarda defensiva de longo prazo: adicionar em `MigrationRunner.run()` um `assert(sequencial(files))` que loga um `WARN` se detectar gap na numeração (`0057, 0059` sem `0058`) — não bloqueia, só sinaliza. (c) Registrar no `CLAUDE.md §Development Pipeline` a regra "renomeia quem chegar por último". Tactic Bass: **Script Deployment Commands + Package Dependencies (ordem)**.

- **Resultado Esperado**
  > Boot em prd sempre aplica migrations em ordem lexicográfica = ordem cronológica de merge. `schema_migrations` fica com sequência sem gaps. Runbook consegue afirmar "0057 precede 0058 precede 0059" e post-mortem futuro não tem que explicar por que a ordem de execução divergiu da numeração.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P2
- **Esforço estimado**: S (≤0.5d) — coordenação no PR + 20 linhas de guarda no runner
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Migration com numeração sequencial pós-merge: gap `0058` → sem gap (renomeada por quem chegar por último)
  - Regra no CLAUDE.md: ausente → presente
  - Guarda `WARN` no runner para gap detectado: ausente → presente (opcional, se aceito)
- **Risco de não fazer**: baixo hoje (migrations independentes), mas o dia em que alguém escrever uma 0060 que **dependa** de 0058 e for aplicada antes de 0058 em prd, a falha é silenciosa até um `SELECT` bater na view faltante.
- **Dependências**: coordenação com o autor de `feat/metricas-ciclo` no momento do merge (mecânica de PR, não de código).

### [deployability-3] Documentar a janela de assimetria FE↔BE no runbook de rollout e adicionar defensiva de 404 no `useExcecaoManual`

- **Problema**
  > Vercel e Render sobem em paralelo no mesmo push a `main`, sem gate cruzado (`render.yaml` `autoDeploy: true`; Vercel dispara direto). Janela típica ~30s onde o FE novo chama `POST /permutas/.../excecao-manual` e o BE ainda é o antigo → 404 com toast genérico "API 404 — invalid request". Impacto pequeno (~30s, admin only, ~1 clique/dia esperado) mas o admin que topar com isso vai reabrir como bug.

- **Melhoria Proposta**
  > (a) Em `useExcecaoManual.ts`, distinguir 404 transitório (deploy em andamento) de 404 estrutural: se `res.status === 404`, tentar `HEAD /health` — se `version` for a esperada, é bug; se for a anterior, mensagem "Aguardando o deploy do servidor terminar; tente de novo em 1 min". (b) Adicionar no `docs/runbooks/rollback.md` seção "Rollout FE-first (deploy inicial da feature)" descrevendo a janela e a mitigação. Tactic Bass: **Deployment observability + Scale Rollouts**.

- **Resultado Esperado**
  > Admin que abrir o painel nos primeiros 90s após o push vê mensagem clara "espere 1 min", não "API 404". Runbook menciona a janela para o operador do deploy.

- **Tactic alvo**: Scale Rollouts
- **Severidade**: P3
- **Esforço estimado**: S (≤0.5d)
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Mensagem 404 transitória distinguida da estrutural: ausente → presente
  - Seção "Rollout FE-first" no runbook: ausente → presente
- **Risco de não fazer**: baixo — 1 admin, 30s, 1 clique/dia. Registrado por completude.
- **Dependências**: nenhuma.

### [deployability-4] Publicar contador de saúde "N exceções ativas / M aplicadas" em `/health/pipelines` e query de reconciliação no runbook

- **Problema**
  > ADR-0047 §D4 ("o ERP vence") produz linhas onde a exceção está ativa mas o motivo real do adto não é `permutado-fora-do-painel` (ingestão passou e ERP entregou `valorPermutado > 0`). Isso é correto por design, mas nenhum contador agregado informa "temos X exceções registradas, Y aplicadas, Z divergiram para 'ativa, não aplicada'". Se o padrão crescer além de 1 documento, auditoria vira manual.

- **Melhoria Proposta**
  > (a) Expor em `/health/pipelines` (endpoint já existente) um bloco `permutas.excecoes: { ativas, aplicadas, registradas_mas_calculo_venceu }` — 3 `SELECT COUNT(*)` baratos, cacheados 60s. (b) Adicionar em `docs/runbooks/` seção "Reconciliar exceções manuais" com a query `SELECT e.adiantamento_doc_cod, a.motivo_bloqueio FROM permuta_excecao_manual e JOIN permuta_adiantamento a ON a.doc_cod = e.adiantamento_doc_cod WHERE e.removido_em IS NULL`. Tactic Bass: **Drift Detection + Deployment observability**.

- **Resultado Esperado**
  > Operador consulta `/health/pipelines` e vê "3 ativas / 2 aplicadas / 1 cálculo venceu" — dado agregado, sem varrer a tela. Runbook tem query one-shot para post-mortem.

- **Tactic alvo**: Drift Detection
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Contadores agregados em `/health/pipelines`: ausente → 3 métricas
  - Query de reconciliação no runbook: ausente → presente
- **Risco de não fazer**: baixo hoje (N=1), monotônico com uso. Se a feature crescer inesperadamente, a ausência dificulta auditoria.
- **Dependências**: nenhuma. Sinergiza com deployability-1 (o kill-switch e a métrica compartilham arquivo de config).

## 6. Notas do agente

- **Bump de versão v0.36.5 → v0.37.0 é resolvido-pelo-pipeline** (step de ship do `/feature-tweak`, não follow-up) — orquestrador confirmou; delta tem 4 `feat` + 1 `fix` sobre regra de painel, qualifica para minor por semver.
- **Cross-QA para o consolidator**: F-deployability-1 (kill-switch) casa com **fault-tolerance** (Isolate Faults — o gate é uma forma de contenção) e com **modifiability** (a flag encaixa em 3 linhas no serviço puro). F-deployability-2 (numeração 0058/0059) casa com **modifiability** (regra do CLAUDE.md sobre coordenação de branches paralelas). F-deployability-4 (drift detector) tem sobreposição com **testability** (o contador é E2E-observável) e com **availability** (`/health/pipelines`).
- **Não medível localmente**: duração real do build do Render vs Vercel (janela FE↔BE em prd), volume real de exceções manuais criadas (esperado < 10 mas não medível sem prd), tempo de `VALIDATE CONSTRAINT` sobre `permuta_adiantamento` e `permuta_candidata_snapshot` em prd (esperado <500ms; local com fixtures não mede).
- **Coordenação de numeração ADR/migration foi feita a priori** (`tasks.md §"Numeração reservada"` e `ADR-0047:25` "ADR-0045 está reservada pela branch feat/metricas-ciclo") — o gap `0058` é deliberado, não oversight; a severidade P2 vem do risco residual (migrations aplicadas fora de ordem no cenário "este PR mergeia primeiro"), não da coordenação atual.
- **Rollback de código sem reverter schema é seguro** por design da 0059 (aditivo puro; CHECK só rejeita o motivo novo, que só é escrito por código novo — `0059:37-40` documenta este ponto). Nenhum finding sobre rollback do delta.
