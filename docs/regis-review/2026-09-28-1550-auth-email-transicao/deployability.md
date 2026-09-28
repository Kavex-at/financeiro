---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-28-1550-auth-email-transicao
agent: qa-deployability
generated_at: 2026-09-28T15:50:00-03:00
scope: all
score: 7
findings_count: 2
cards_count: 2
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

> **Nota de escopo (obrigatória):** a missão genérica deste agente assume AWS Lambda + Terraform
> multi-tenant. Este repositório **não** é isso hoje — é Express (`src/backend/`) + Next.js
> (`src/frontend/`), deploy via **Render** (backend, `autoDeploy: true` no push a `main`) + **Vercel**
> (frontend) + **Supabase** (Postgres), single-tenant (Columbia Trading). Não existe `infra/`. Toda
> métrica de Terraform/Lambda/tenant é **não medível** e tratada como N/A. Vocabulário de tactics Bass
> mantido em inglês conforme pedido.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev (merge em `main` de `feat/auth-email-transicao`) | Push dispara **dois** deploys independentes e não coordenados: Render (backend — migration `0064` aditiva embutida no boot) e Vercel (frontend — `NovoUsuarioDialog`/`EditarEmailDialog`/`TransicaoEmailBanner` novos) | `src/backend/routes/{auth,usuarios}.ts`, `UserRepository.ts`, migration `0064`, `src/frontend/app/usuarios/*`, `src/frontend/app/login/*` | Produção, single-tenant (Columbia), Postgres único (Supabase), `npm run seed:admin` manual pós-deploy | Qualquer ordem de chegada (Vercel antes do Render, ou vice-versa) deve degradar sem quebrar o login existente nem corromper `app_user`; a migration deve abortar o boot (não corromper dado) se encontrar `username` duplicado sem distinção de caixa | 0 erros 500/crash atribuíveis a ordem de deploy; migration reversível por "não fazer nada" (aditiva, sem backfill); rollback do código em ≤5min via runbook existente |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Gates automatizados commit→verde (backend) | 7: `npm ci` → `npm audit --audit-level=high` → `typecheck` → `lint` → `test --coverage` → `build` → `backend-sql` (Postgres 17 real) | ≥5 | ✅ | `.github/workflows/ci.yml:8-64` (PRÉ-EXISTENTE, não tocado pelo delta) |
| Gates automatizados commit→verde (frontend) | 4: `npm ci` → `typecheck` → `lint` → `test --coverage` | ≥5 | ⚠️ (sem `build` no CI do front; PRÉ-EXISTENTE) | `.github/workflows/ci.yml:66-80` |
| `terraform plan` antes de `apply` | N/A — não há Terraform neste repo | presente | N/A | CLAUDE.md §Estado Atual vs. Alvo; `find . -iname "*.tf"` vazio |
| Migration `0064` coberta por teste de integração contra Postgres real em CI | **0** — só teste estático de regex sobre o texto do `.sql` (`0064_app_user_email.test.ts`), não roda no job `backend-sql` (que só casa `migrations/.*\.integration\.test\.ts`, hoje só `vwMetricasCiclo.integration.test.ts`) | ≥1 (precedente do próprio repo) | ❌ | `src/backend/migrations/0064_app_user_email.test.ts:1-54`; `src/backend/package.json:24` (`test:sql`); `ls src/backend/migrations/*.integration.test.ts` |
| Migration `0064` aplicada do zero contra Postgres descartável (verificação manual desta review, `--quick`) | ✅ 65/65 aplicadas; guarda `DO $$` aborta com duplicata de caixa; índices `lower()` rejeitam colisão com 23505 | — | ℹ️ Informativo — não é um gate repetível, foi rodado uma vez por este agente | `_shared-metrics.md` §Gates medidos |
| Migration é aditiva (sem `DROP`/`ALTER TYPE`/backfill destrutivo) | Sim — só `ADD COLUMN IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS` | aditiva = reversão de código segura | ✅ | `src/backend/migrations/0064_app_user_email.sql:34-45` |
| Novas dependências npm no delta | 0 (lockfiles backend/frontend inalterados) | 0 preferível | ✅ | `git diff origin/main...HEAD -- **/package*.json` (vazio) |
| Feature flag `AUTH_TRANSICAO_EMAIL_BANNER` — default seguro | Ausente = desligado; só `'true'` liga; vale sem redeploy do front | fail-safe por padrão | ✅ | `EnvironmentVars.ts:25-29`; `configManifest.ts` (novo bloco, `criticidade: OPCIONAL`, `default: 'false'`) |
| Rotas novas testadas para tolerância "front antigo × back novo" (direção segura, backend primeiro) | 2/2 (`POST /usuarios` aceita `username` como alias; login aceita e-mail OU usuário) | 100% das rotas com contrato alterado | ✅ | `src/backend/routes/usuarios.test.ts:222-227`; `AuthService.test.ts` |
| Rotas novas testadas para a direção inversa ("front novo × back antigo", i.e. Vercel na frente do Render) | 0/3 (`POST /usuarios` com só `email`, `PATCH /:id/email`, `GET /auth/transicao`) — comportamento do 400/404 nesse cenário não é simulado em teste, só a UI de erro genérica (`usuarios-page.test.tsx:141-143`) cobre 400/409 vindos do backend já atualizado | ≥1 por rota com contrato novo | ❌ | `src/frontend/lib/usuarios.ts:73-87`, `src/frontend/app/login/TransicaoEmailBanner.tsx:18-24` |
| Rollback documentado com meta de tempo | Runbook dedicado, matriz aditiva×destrutiva, meta ≤5min, validação via `/health`+`/health/pipelines` | presente | ✅ (PRÉ-EXISTENTE, não tocado pelo delta; migration `0064` cai no caso "seguro reverter só o código") | `docs/runbooks/rollback.md:1-27` |
| `ADMIN_USERNAME` removido de todos os artefatos de deploy | 0 ocorrências em `DEPLOY.md`, `render.yaml`, `.env.example`, código-fonte | 0 | ✅ | `grep -rn "ADMIN_USERNAME"` (só sobra em docs de reviews antigas e no ADR, como histórico) |
| `ADMIN_EMAIL`/`ADMIN_PASSWORD` sem default no código | Confirmado — `SeedAdminConfig` usa `required_error`, sem `??` | sem segredo hardcoded | ✅ | `src/backend/jobs/SeedAdminConfig.ts:20-29` |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Scale Rollouts** (canary, blue-green, rolling) | Render faz cutover binário (`healthCheckPath: /health`); Vercel troca alias instantaneamente — sem tráfego parcial (PRÉ-EXISTENTE, arquitetura de instância única). O delta adiciona uma forma leve de rollout gradual: `AUTH_TRANSICAO_EMAIL_BANNER` é uma chave manual, default-off, que ativa comportamento sem redeploy — mesmo padrão já usado por `SISPAG_ENABLED`/`RECEBIMENTOS_ENABLED`. É "canário de configuração", não de tráfego. | ⚠️ parcial | `render.yaml:85-88`; `EnvironmentVars.ts:25-29` |
| **Rollback** | Runbook dedicado (PRÉ-EXISTENTE), aplicável sem alteração a este delta: migration `0064` é aditiva → cai no ramo "seguro reverter só o código" da matriz do runbook. | ✅ presente | `docs/runbooks/rollback.md:13-29` |
| **Script Deployment Commands** | `npm run build` (backend) copia `.sql` para `dist/migrations/`; `BootMigrator` aplica migrações pendentes com advisory lock antes de aceitar tráfego (PRÉ-EXISTENTE, não tocado pelo delta). `npm run seed:admin` continua sendo um passo **manual**, fora do boot e fora do CI/CD — inalterado por este delta, mas agora com pré-condição mais estrita (`ADMIN_EMAIL`/`ADMIN_PASSWORD` obrigatórias, sem default). | ⚠️ parcial (seed continua manual, PRÉ-EXISTENTE) | `src/backend/migrations/BootMigrator.ts:17-46`; `src/backend/jobs/seed-admin.ts:21-30`; `DEPLOY.md:142-159` |
| **Logical Grouping** | N/A para este delta — não há Terraform/módulos para agrupar; a "frente" lógica (auth) já vive isolada em `domain/service/auth/` + `domain/repository/auth/` + `routes/auth.ts`/`routes/usuarios.ts`, consistente com o resto do domínio. | N/A / ✅ organizacional | `src/backend/domain/service/auth/`, `src/backend/domain/repository/auth/` |
| **Physical Grouping** | N/A — deploy único (1 serviço Render + 1 site Vercel + 1 banco Supabase), sem regiões/AZs para esta feature decidir. | N/A — instância única | `DEPLOY.md:51-140` |
| **Package Dependencies** | 0 dependências novas neste delta (backend e frontend); nenhuma mudança de superfície de supply-chain. `bcryptjs` (já existente) é reutilizado para o hash do e-mail/senha do admin. | ✅ | `git diff origin/main...HEAD -- **/package*.json` (vazio) |
| **Surge Protection** | N/A ao delta — não há fila/rate-limit novo introduzido por esta feature (login e gestão de usuário são de baixo volume, `admin`-gated). Surge protection do sistema como um todo (pool do Supabase, budget de sessões) é PRÉ-EXISTENTE e documentado, não afetado. | N/A | `DEPLOY.md:20-47` (budget de sessões do pooler) |
| **Idempotent deploys** | Migration `0064` é idempotente por construção (`ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`); reaplica sem erro. `seed-admin` é idempotente (UPSERT por `username`). | ✅ | `src/backend/migrations/0064_app_user_email.sql:34-45`; `src/backend/jobs/seed-admin.ts:16` |
| **Drift detection** | N/A — sem Terraform, não há drift de estado de infraestrutura a detectar. O equivalente aqui (`ConfigDoctor` + `CONFIG_MANIFESTO`) foi atualizado para incluir `AUTH_TRANSICAO_EMAIL_BANNER`, então a "configuração esperada" do backend continua auto-documentada. | N/A (infra) / ✅ (config) | `configManifest.ts` (bloco novo, `CRITICIDADE.OPCIONAL`) |
| **Reproducible builds** | Lockfiles inalterados e commitados; `npm ci` no CI; sem timestamp embutido no build do delta (a migration não gera artefato dinâmico). PRÉ-EXISTENTE, não regredido pelo delta. | ✅ | `git diff` de `package-lock.json` vazio |
| **Per-tenant blast-radius limit** | N/A neste estágio — single-tenant (Columbia), sem isolamento por conta AWS (é o estado-alvo do CLAUDE.md, não implementado). O blast radius real do delta é "todo admin da Columbia", mitigado por `requireRole('admin')` em todas as rotas novas e pelo fato de a feature não escrever no ERP/Nexxera/GED. | N/A (arquitetura single-tenant) | `src/backend/routes/usuarios.ts:30`; CLAUDE.md §Estado Atual vs. Alvo |
| **Deployment observability** | `/health` reporta versão (usado no runbook de rollback para confirmar reversão); log de boot mostra `[boot-migrate] aplicada(s) N: <nome>.sql`. Nada de novo neste delta além do padrão já existente — a migration `0064` vai aparecer nesse log como qualquer outra. | ✅ (PRÉ-EXISTENTE) | `docs/runbooks/rollback.md:58-65,82-83` |

## 4. Findings (achados)

### F-deployability-1: Migration `0064` tem guarda de dado ao vivo (`RAISE EXCEPTION`) sem cobertura de integração em CI

- **Severidade**: P1
- **Tactic violada**: Reproducible builds / Idempotent deploys (a garantia de que a migration se comporta como projetada só foi verificada manualmente, uma vez, por esta revisão — não é um gate repetível)
- **Localização**: `src/backend/migrations/0064_app_user_email.sql:16-32` (guarda `DO $$ ... RAISE EXCEPTION`); `src/backend/migrations/0064_app_user_email.test.ts:1-54` (só regex sobre o texto do SQL); `.github/workflows/ci.yml:26-52` (job `backend-sql`, script `test:sql` = `jest migrations/.*\.integration\.test\.ts`)
- **Evidência (objetiva)**:
  ```
  $ ls src/backend/migrations/*.integration.test.ts
  src/backend/migrations/vwMetricasCiclo.integration.test.ts

  $ grep -n '"test:sql"' src/backend/package.json
  "test:sql": "jest migrations/.*\\.integration\\.test\\.ts --testPathIgnorePatterns /node_modules/",
  ```
  O único arquivo `*.integration.test.ts` do repositório cobre a migration `0060` (`vwMetricasCiclo`),
  criada especificamente por um card P0 de uma revisão anterior (2026-09-14, `testability-1`) que
  estabeleceu o precedente: migration com comportamento condicional a dado ao vivo precisa de teste
  contra Postgres real em CI. A `0064` tem exatamente esse perfil — um `RAISE EXCEPTION` cuja condição
  depende do conteúdo atual de `app_user` — mas seu teste (`0064_app_user_email.test.ts`) só faz
  `readFileSync` + regex sobre o texto do `.sql`; nunca conecta a um banco. A verificação "65
  migrações aplicadas do zero, guarda aborta com duplicata de caixa" registrada em `_shared-metrics.md`
  foi rodada manualmente por este agente de revisão, uma única vez, fora do CI.
- **Impacto técnico**: um PR futuro que altere `runMigrations.ts`/`MigrationFiles.ts` ou reordene
  migrations pode quebrar silenciosamente a aplicação da `0064` (ex.: a guarda passa a rodar fora de
  transação, ou o `CREATE UNIQUE INDEX` falha por dado que a guarda deveria ter barrado) sem que
  nenhum gate fique vermelho antes do merge. O primeiro sinal seria o `BootMigrator` derrubando o
  boot em produção — uma falha segura (mantém a versão anterior no ar, por design), mas descoberta
  em deploy, não em PR.
- **Impacto de negócio**: um deploy que deveria ser rotineiro vira um incidente de boot em produção
  (ainda que autolimitado), consumindo o runbook de rollback e o tempo do operador, para um problema
  que o próprio repositório já sabe prevenir com um teste de integração — só não o aplicou aqui.
- **Métrica de baseline**: 0/1 migrations com guarda condicional a dado ao vivo cobertas por teste de
  integração em CI neste delta, contra 1/1 no precedente do repo (`vwMetricasCiclo`).

### F-deployability-2: Rotas novas de gestão de usuário não são tolerantes a "front novo × back antigo" (janela Vercel-à-frente-do-Render)

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands (ausência de orquestração/gate entre os dois deploys independentes) combinada com forward-compatibility de contrato não testada na direção de risco real
- **Localização**: `src/frontend/lib/usuarios.ts:73-87,116-123` (`criarUsuario`, `definirEmail`); `src/backend/domain/service/auth/UserAdminService.ts:29-45` (`createUserSchema`, aceita `email` OU `username`, mas exige um dos dois); `ontology/decisions/0051-auth-email-real-sub-continua-username.md:120-122` (consequência documentada só em prosa de ADR, não no runbook operacional)
- **Evidência (objetiva)**:
  ```
  # origin/main (backend ANTIGO) — username é obrigatório, `email` não existe no schema:
  export const createUserSchema = z.object({
      username: z.string().trim().toLowerCase().email('email inválido'),
      password: z.string().min(8, ...),
      ...
  });

  # HEAD (frontend NOVO) — NovoUsuarioDialog só envia `email`, nunca `username`:
  export async function criarUsuario(input: { email: string; password: string; role: UserRole; ... })
  ```
  `render.yaml` tem `autoDeploy: true` no Render e a Vercel também dispara no mesmo push, sem
  dependência entre os dois. O build do frontend (Next.js export estático) tende a terminar antes do
  build do backend (`tsc` + cópia de migrations + boot com `BootMigrator`/advisory lock). Nessa
  janela, um admin que abrir `/usuarios` no frontend já atualizado e tentar criar um usuário ou editar
  um e-mail bate em `POST /usuarios` (sem `username`, backend antigo recusa com 400 "Requisição
  inválida") ou em `PATCH /usuarios/:id/email` (rota que não existe no backend antigo → 404). O único
  lado testado é o inverso — front antigo × back novo — via
  `usuarios.test.ts:222-227` ("aceita username como alias (front antigo durante o deploy)"), que é
  justamente a ordem que a ADR-0051 (linha 120-122) recomenda mas não impõe.
- **Impacto técnico**: nenhum dado é corrompido (o `POST`/`PATCH` falha antes de qualquer escrita) e
  a UI já trata erro inline sem travar (`usuarios-page.test.tsx:141-143` cobre 400/409 genéricos), mas
  o cenário específico "rota inexistente" (404) não tem asserção própria. O banner de transição
  (`GET /auth/transicao`) já foi desenhado para falhar fechado (`TransicaoEmailBanner.tsx:18-24`,
  `.catch(() => undefined)`), então essa rota está coberta; as outras duas, não.
- **Impacto de negócio**: numa janela de poucos minutos a cada deploy que toque `/usuarios`, um admin
  da Columbia pode ver "Erro 400"/"Erro 404" ao tentar cadastrar um colega ou corrigir um e-mail —
  baixa frequência (feature admin-only, uso esporádico) e autorrecuperável (funciona assim que o
  Render termina), mas é um sintoma visível de um problema de classe já conhecido pelo repositório: a
  revisão de 2026-09-16 (`docs/regis-review/2026-09-16-1650-metricas-historico/deployability.md`)
  já havia proposto documentar essa garantia em `DEPLOY.md`/`docs/runbooks/` — recomendação que segue
  não implementada (PRÉ-EXISTENTE) e cuja ausência volta a se manifestar aqui.
- **Métrica de baseline**: 1/3 rotas novas com contrato alterado tolera explicitamente a direção de
  risco real (front novo × back antigo) com teste dedicado; 2/3 não têm asserção para esse cenário.

## 5. Cards Kanban

### [deployability-1] Integrar a migration `0064` (e futuras migrations com guarda condicional) ao job `backend-sql`

- **Problema**
  > A migration `0064_app_user_email.sql` tem um `RAISE EXCEPTION` cuja condição depende do dado ao
  > vivo de `app_user`, mas só é verificada por um teste de regex sobre o texto do arquivo — nunca
  > conecta a um Postgres real em CI. O repositório já estabeleceu o padrão correto para esse caso
  > (`vwMetricasCiclo.integration.test.ts`), mas não o aplicou aqui.

- **Melhoria Proposta**
  > Adicionar `src/backend/migrations/appUserEmail.integration.test.ts` (nome casando o padrão
  > `migrations/.*\.integration\.test\.ts` do script `test:sql`) que: (1) aplica as migrações 1→64 do
  > zero contra o Postgres efêmero do job `backend-sql` (`postgres:17-alpine`, já provisionado em
  > `ci.yml:26-33`); (2) insere dois `username` iguais sem distinção de caixa e confirma que a `0064`
  > aborta com a mensagem em português; (3) confirma que, sem duplicata, a `0064` aplica e os dois
  > índices `lower()` existem. Tactic Bass alvo: **Reproducible builds** / **Idempotent deploys** —
  > tornar automatizável uma garantia hoje só verificada manualmente por um humano de revisão.

- **Resultado Esperado**
  > A guarda da `0064` (e de qualquer migration futura no mesmo padrão) fica vermelha no PR se
  > regredir, antes de chegar ao boot de produção. Cobertura de migrations-com-guarda-de-dado por
  > teste de integração: 0/1 → 1/1 (mantém a paridade com `vwMetricasCiclo`).

- **Tactic alvo**: Reproducible builds
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Migrations com `RAISE EXCEPTION`/guarda de dado cobertas por teste de integração em CI: 0/1 → 1/1
  - Job `backend-sql` continua verde em ≤ tempo atual (não deve adicionar minutos relevantes — tabela `app_user` é pequena)
- **Risco de não fazer**: a próxima migration parecida (ou uma mudança no `MigrationRunner`) só
  quebra em produção, no boot — cada ocorrência custa um ciclo de runbook de rollback em vez de um
  PR vermelho.
- **Dependências**: nenhuma.

### [deployability-2] Registrar a garantia de ordem de deploy Render/Vercel no runbook operacional, e fechar a lacuna de teste nas 2 rotas não cobertas

- **Problema**
  > `POST /usuarios` (só `email`) e `PATCH /usuarios/:id/email` não toleram rodar contra o backend
  > anterior a esta feature — cenário real sempre que o build do Vercel (mais rápido) terminar antes
  > do Render. O único teste existente cobre a direção seguraz (front antigo × back novo). A
  > recomendação de documentar essa garantia (de uma revisão anterior, 2026-09-16) nunca foi
  > implementada em `DEPLOY.md`.

- **Melhoria Proposta**
  > (1) Acrescentar um teste de frontend que simula 404/400 nessas duas chamadas e confirma que a UI
  > degrada como já faz para 400/409 (sem crash, erro inline, diálogo aberto) — fecha a lacuna de
  > asserção sem exigir infraestrutura nova. (2) Acrescentar uma seção curta em `DEPLOY.md` (ou
  > `docs/runbooks/deploy-ordering.md`, reaproveitando a sugestão da revisão de 2026-09-16):
  > "backend antes do frontend quando o PR adicionar rota nova" — hoje essa regra só existe na prosa
  > da ADR-0051 (linha 120-122), não no runbook que o operador realmente consulta. Tactic Bass alvo:
  > **Deployment observability** (tornar visível uma garantia que hoje só existe na cabeça de quem
  > escreveu a ADR) + **Script Deployment Commands** (aproximar de um gate, já que orquestração real
  > entre Render e Vercel não é viável sem infra paga).

- **Resultado Esperado**
  > Rotas com contrato alterado cobertas para a direção de risco real: 1/3 → 3/3. `DEPLOY.md` passa a
  > ter uma seção "ordem de deploy" citável no checklist do operador, não só na ADR.

- **Tactic alvo**: Deployment observability
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Rotas novas com teste explícito para "front novo × back antigo": 1/3 → 3/3
  - `DEPLOY.md` contém uma seção de ordem de deploy referenciável (0 → 1)
- **Risco de não fazer**: cada feature futura que toque `/usuarios` ou `/auth` reintroduz a mesma
  janela de erro visível para o admin, sem que ninguém novo no time saiba que a ordem de deploy
  importa aqui — o conhecimento fica só nesta revisão e na ADR-0051.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: missão genérica assume Lambda+Terraform multi-tenant; adaptei 100% para Render+Vercel+
  Supabase single-tenant (CLAUDE.md §Estado Atual vs. Alvo confirma que `infra/` não existe). Métricas
  de Terraform/tenant marcadas N/A, não penalizadas.
- Não rodei nada contra banco/serviço real — toda evidência de "migração aplicada do zero" vem de
  `_shared-metrics.md` (já produzida antes desta seção, dentro do `--quick`).
- **Cross-QA**: F-deployability-1 tem sobreposição direta com Testability (mesma lacuna: teste
  estático em vez de integração) — o consolidator pode preferir um único card se `qa-testability`
  também flagrou a `0064`. F-deployability-2 tem sobreposição com Modifiability (o alias
  `email`/`username` em `createUserSchema` é dívida deliberada de transição, não estrutural) e com
  Security (mensagens de erro do 400/404 nessa janela não vazam dado sensível, confirmado por
  `usuarios-page.test.tsx:141-143`, mas vale o `qa-security` confirmar).
- Não encontrei nenhum P0: a arquitetura de deploy PRÉ-EXISTENTE (BootMigrator com advisory lock,
  fail-hard no boot, runbook de rollback com meta ≤5min) já cobre o risco de maior severidade
  (schema divergente do código) por construção, e este delta não a contorna.
