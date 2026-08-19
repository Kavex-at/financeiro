# Columbia — Financeiro

> **Bootstrap (2026-06-10):** este repositório foi materializado a partir do template
> [`fechamento-processos`](../fechamento-processos/CLAUDE.md) (v0.10.2), que por sua vez herda o
> pipeline de [`produtizacao/nf-projects/`](../../produtizacao/nf-projects/CLAUDE.md). A arquitetura
> descrita abaixo (Lambda + Terraform + DDD + tsyringe + multi-tenant) é o **estado-alvo**. O código
> atual em `src/backend/` (Express puro) e `src/frontend/` (Next.js) ainda não satisfaz vários
> requisitos. As violações conhecidas estão em `ontology/_inbox/migration-debt.md`. O pipe
> (`/feature-new`, `/feature-tweak`, etc.) não negocia com o estado atual: cada feature nova deve
> cumprir os gates; código legado é migrado proporcionalmente em cada `/feature-tweak` que o tocar.
>
> **Domínio específico:** Automação Financeira da Columbia Trading — cinco frentes (**Permutas**,
> **SISPAG**, **Popula GED**, **Conciliação de Recebimentos**, **Workflow de Aprovação**). Propósito definido na proposta
> (`docs/proposta/`); narrativa em `docs-contexto/03_ontologia_financeiro.md`. Ver ADRs `0001` (bootstrap),
> `0002` (propósito, 3 frentes), `0022` (extensão para a 4ª frente) e `0038` (5ª frente).

## Estado Atual vs. Alvo (leitura obrigatória)

A meta deste doc descreve majoritariamente o **alvo** (AWS Lambda + Terraform). A infra que **roda hoje**
é outra. Tudo abaixo marcado **(alvo)** ainda **não existe** — não trate `infra/`, Terraform, SSM ou
handlers Lambda como presentes ao revisar mudanças.

| Camada | **Atual (hoje)** | **Alvo (roadmap)** |
|--------|------------------|--------------------|
| Backend | Express puro (`src/backend/`, `routes/` + `http/`) | AWS Lambda + API Gateway (`src/lambda/`) |
| Frontend | Next.js (deploy Vercel) | Next.js (igual) |
| Infra/Deploy | Render (deploy hook via GitHub Actions); **sem `infra/` / Terraform** | Terraform multi-tenant, uma conta AWS por cliente |
| Auth / DB | Supabase (JWT + Postgres) | SSO corporativo + RBAC; Postgres via SSM |
| Scheduler/Jobs | nenhum (Express request/response) | EventBridge + Lambda `job/` |

**Política de features:** código novo (via `/feature-new`) nasce **DDD/Lambda-ready** (tsyringe, Zod nos
boundaries, SQL parametrizado), mesmo executando em Express/Render hoje. A dívida do template é migrada
**proporcionalmente** em cada `/feature-tweak` que tocar o código relevante (ver
`ontology/_inbox/migration-debt.md`). As **Inviolable Rules** marcadas **(alvo)** aplicam-se a código novo,
não bloqueiam o legado Express até a migração.

## Overview
Automação assistida da área **Financeira da Columbia Trading**, entregue pela Kavex (created by
Clonex). Cinco frentes, todas integradas ao ERP **Conexos** (mesmo tenant do `fechamento-processos`),
multi-filial, com analista no controle (*human-in-the-loop*):

| Frente | Em uma frase | Integra |
|--------|--------------|---------|
| **I — Permutas** (Adiantamentos ↔ Invoices) | reconciliar PROFORMA × INVOICE na baixa; auto 1:1, assistido N:M | Conexos `fin010` |
| **II — SISPAG** (Pagamentos) | montar lote, gerar remessa, enviar ao banco, conciliar retorno | Conexos `com298` + Nexxera |
| **III — Popula GED** (NC/ND) | casar PDF do SharePoint com a NC/ND e subir no GED | SharePoint + GED |
| **IV — Conciliação de Recebimentos** (NDe) | importar extrato Nexxera, casar com recebíveis, ratear, aplicar regras, baixar e emitir a **Nota de Débito Eletrônica** | Nexxera + Conexos (`com299`/`gerDoc`) |
| **V — Workflow de Aprovação** (trilha) | rastrear a trilha de aprovação dos títulos a pagar: quem, quando, quanto tempo | Conexos `psq014` + `fin026` |

> **Não confundir NC/ND (Frente III) com NDe (Frente IV).** A Frente III **não emite** documento algum —
> a NC/ND nasce em planilha e sobe ao ERP como rascunho; a solução só anexa o PDF que destrava a baixa.
> A **NDe** é o artefato terminal de um `Recebimento` executado, **emitida pelo Conexos**. E **não existe
> "emissão de nota de crédito" em nenhuma frente** — `CreditoCliente` (Frente IV) é saldo local, não
> documento fiscal. Ver `ontology/glossary.md` e ADR-0022.

**SaaSo (alvo)** — cada cliente terá uma conta AWS isolada. **Monorepo (alvo)**: `backend/` (TypeScript
Lambda), `infra/` (Terraform), `frontend/` (Next.js). **Atual:** backend Express + frontend Next.js
(deploy Render/Vercel), auth/DB no Supabase; sem `infra/`.

## Architecture

### Data Flow **(alvo)**
```
Conexos ERP → Lambda handlers (read/compute) → Frontend
        ↑ (write-back, quando aplicável)
PostgreSQL (quando houver persistência própria)
```
> Domínio ainda não modelado — o fluxo concreto é definido pelas primeiras features (`/feature-new`).
> **Atual:** Express handlers em `src/backend/routes/` + `http/`; Postgres (Supabase) cablado mas sem uso.

### DDD Layers **(alvo)**
```
Lambda handler → Service (@injectable) → Repository (@injectable) → Client (@singleton @injectable)
```
> **Atual:** Express route handler → Service → … (mesma cadeia DDD a partir de Service; só o gatilho difere).

### Client Layer (`backend/src/domain/client/`)
All clients: `@singleton() @injectable()`. NEVER instantiate AWS SDK clients directly — always
`container.resolve()`. **(alvo)** Region: `process.env.aws_region ?? AWS_REGION ?? 'us-east-1'` — o atual
roda em Render/Supabase e não usa região AWS.

| Client | Purpose | Estado |
|--------|---------|--------|
| `ConexosClient` | Conexos ERP API (SSM em prod) | implementado (portado, mesmo tenant) |
| `PostgreeDatabaseClient` | PostgreSQL pool (SSM) | implementado (provisionado, sem uso ainda) |
| `BcbClient` | Banco Central (CDI/SGS) via axios | implementado (exemplo de client externo; prune se não usar) |

> Outros clients do estado-alvo (`SqsClient`, `S3Client`, `SesClient`, `OpenAiClient`, …) são
> adicionados sob demanda quando uma feature precisar — sempre `@singleton() @injectable()`.

### Directory Map
```
backend/src/domain/
  client/      # External clients
  interface/   # TypeScript interfaces
  libs/        # EnvironmentProvider, Logger, Executors, Handlers
  repository/  # Raw parameterized SQL
  service/     # Business logic
backend/src/lambda/        # (alvo) — ainda não existe; hoje as rotas vivem em backend/src/routes/
  api/         # API Gateway handlers
  job/         # Scheduled batch processing
infra/tenants/             # (alvo) — ainda não existe; deploy atual é Render hook (sem Terraform)
  modules/                      # Reusable Terraform modules
  tenants-vars/{env}/{client}/  # Per-client tfvars
```

## Conventions

### Language
- Identifiers: English only (classes, vars, functions, enums). No exceptions.
- DB columns/interface fields mirroring DB schema: Portuguese OK (`cnpj_prestador`)
- Errors, logs, commits: English only

### Naming
- Files: PascalCase for classes, camelCase for utilities
- Lambda folders: snake_case; Interfaces: `*Interface` suffix
- Terraform: `{env}-{client}-{alias}`; SSM: `/tenants/{env}/{client}/{name}`

### Formatting (Biome)
4 spaces, single quotes, trailing commas, semicolons, line width 100.
Run: `npm run lint` / `npm run lint:fix`

### TypeScript Style
- Export classes only — never plain functions or plain objects
- Methods as arrow functions: `public method = () => {}` (avoids `this` binding)
- Explicit access modifiers on all methods/properties
- Optional: `property?: Type` (never `Type | undefined`)
- No `!` non-null assertions — use Zod or guard functions
- Validate external inputs (API events, DB nullables, SSM) with Zod at boundaries

## Tenants

> **Estado inicial:** sem tenants provisionados. Será preenchido quando o scaffold de infra for
> criado (`/feature-new infra "terraform tenant scaffold para financeiro"`).

| Env | Client | Account ID |
|-----|--------|------------|
| _(vazio)_ | | |

Shared: _(a definir)_

## Commands
```bash
# Atual
cd src/backend  && npm run dev / npm test / npm run build / npm run lint / npm run lint:fix / npm run typecheck
cd src/frontend && npm run dev / npm test / npm run build / npm run lint / npm run typecheck
# (alvo) quando a infra Terraform existir:
cd infra/tenants && terraform plan -var-file="tenants-vars/{env}/{client}/account-vars.tfvars"
```

## Handlers (`backend/src/domain/libs/handler/`) **(alvo)**
Wrap every Lambda export with a Handler (auto: log metadata, error handling, SQS batch failures).
> **Atual:** o runtime é Express (`src/backend/http/` + `routes/`); estes Handlers existem como código
> pronto para o alvo Lambda, mas ainda não são o caminho de execução em produção.

| Handler | Trigger | Parameters | Extra metadata |
|---------|---------|------------|----------------|
| `ApiGatewayHandler` | API Gateway | `event`, `context` | — |
| `SqsHandler` | SQS | `event`, `context`, `record` | `messageId` |
| `EventBridgeLambdaHandler` | EventBridge | `event`, `context` | `eventId` |

```typescript
const sqsHandler = new SqsHandler();
export const handler = sqsHandler.handle(async ({ event, context, record }) => {
    const logService = container.resolve(LogService);
});
```

- `LogService` MUST be `@singleton()` — metadata set by Handler must propagate downstream
- Never double-log: Handler already calls `logService.error()` for unhandled throws

## Executors (`backend/src/domain/libs/executor/`)
All implement `IExecutor` (`execute<T>(fn: () => Promise<T>): Promise<T>`).
NEVER use manual `setTimeout` loops — always use Executors.

| Executor | Purpose |
|----------|---------|
| `RetryExecutor` | Retry with delay/attempts |
| `FallbackExecutor` | Primary → fallback sequence |
| `PollExecutor` | Polling with timeout/interval |

## Domain State Machines

> **Vazio no bootstrap.** O domínio financeiro ainda não tem máquinas de estado. Elas são
> modeladas via `/feature-new` (o `OntologyCurator` cria `ontology/state-machines/<nome>.md`) e
> documentadas aqui quando existirem. Convenções ao criar uma:
> - Status como constantes tipadas — nunca strings cruas.
> - Cada transição é uma ação nomeada com regra explícita (princípio P3 da ontologia).
> - Registrar a vigência/data de cada transição.

## Development Pipeline

Every feature or rule change goes through the pipeline. No exceptions.

### Entry points

| Situation | Command | Interview mode |
|-----------|---------|----------------|
| New entity / new flow | `/feature-new <intent>` | Deep (4 axes: Entity, Action, Invariant, Integration) |
| Adjust existing rule | `/feature-tweak <entity> "<intent>"` | Surgical (delta from current ontology) |
| Bug fix investigation | `/investigate <symptom>` | Root cause first, then tweak |
| Urgent hotfix | `/feature-tweak --urgent <entity> "<intent>"` | Skip interview; retroactive ADR in 24h |

### Pipeline flow

```
/feature-new or /feature-tweak
  → Step 0: git worktree dedicado (OBRIGATÓRIO — nunca no checkout principal; path curto em C:/tmp)
  → OfficeHoursInterviewer (interview)
  → OntologyCurator (diff if entity_changed=true, approve before code)
  → TaskScoper (tasks.md with acceptance criteria)
  → AutoLoopRunner (TDD → impl → typecheck → lint → tests → PatternGuardian → green)
     └── InfoGapBroker (if stuck on domain question — edit _inbox/gap.md to resume)
  → Regis-Review gate (OBRIGATÓRIO após verde, salvo --no-regis-review/--urgent/opt-out no prompt)
     ├── P0 (Crítico) → re-loop OfficeHours → Ontology → TaskScoper → AutoLoopRunner (mesmo worktree)
     │                  (anti-recursão: NÃO dispara outro Regis-Review)
     └── P1/P2/P3      → follow-ups em ontology/_inbox/<feature>-regis-followups.md (não implementados)
  → Rebase da base (default main) na branch local → resolver conflitos
  → Bump de versão do app (FE+BE lockstep) via scripts/bump-version.ps1 → commit chore(release) → PR
     (conflito não-trivial = pausa para o Yuri)
```

> **Worktree-first é inviolável.** Cada `/feature-new` e `/feature-tweak` cria seu próprio worktree para
> permitir desenvolvimentos paralelos sem conflito. Ver Inviolable Rule #10.

### Ontology

- Domain source of truth lives in `ontology/`
- 20 entities, ~25 actions, 3 state-machines, 3 business rules, 2 integrations (v0.1)
- `ontology/_index.json` — entity → implementation files map
- `ontology/_coverage.json` — implementation coverage metrics
- `ontology/_inbox/` — open questions (InfoGapBroker writes here; you answer here)

### Green criteria (AutoLoopRunner loop ends when)

1. `npm run typecheck` ✅
2. `npm run lint` ✅
3. `npm test` ✅
4. PatternGuardian ✅
5. All task acceptance criteria ✅
6. If `entity_changed=true` → ontology diff present ✅
7. If `frontend/src/` touched → DesignReviewer ✅
8. **Regis-Review gate** ran and all **P0 (Crítico)** findings remediated (P1/P2/P3 → inbox follow-ups) ✅
   — salvo `--no-regis-review` / `--urgent` / opt-out explícito no prompt
9. **Rebase da branch base** (default `main`) aplicado sem conflitos pendentes, gates ainda verdes ✅
10. **Bump de versão do app** — se o delta tem `feat`/`fix`/`perf` em `src/`, versão do app (FE==BE, lockstep)
    bumpada por semver via `scripts/bump-version.ps1 -Execute` + `CHANGELOG.md` atualizado (commit `chore(release): vX.Y.Z`).
    Sem `feat`/`fix`/`perf` no delta → no-op (sem bump). NÃO confundir com `ontology/_coverage.json` (versão da ontologia). ✅

### Human-in-the-loop (loop always pauses for)

- InfoGapBroker P0 question → answer in `ontology/_inbox/<feature>-gap.md`
- QaCoach roteiro (new handler/job/UI) → execute in dev tenant
- `--high-risk` flag → `/pair-review` before PR

### Maintenance

```
/retro-ontology    # weekly health check — stale entities, open gaps, coverage drift
/stop-loop <slug>  # graceful pause with state persistence
/regis-review      # Bass & Clements 8-QA architecture review (renomeado de /arch-review; alias mantido)
```

### Agents active in this pipeline

| Agent | Role |
|-------|------|
| `OfficeHoursInterviewer` | Socratic interview, new + tweak modes |
| `OntologyCurator` | Maintains `ontology/`, proposes diffs, writes ADRs |
| `TaskScoper` | Spec → tasks.md with acceptance criteria |
| `AutoLoopRunner` | Orchestrates TDD → impl → gates → ship |
| `InfoGapBroker` | P0/P1 questions, pause + resume |
| `PatternGuardian` | DDD/tsyringe/SQL/tenant isolation gate |
| `CodebaseNavigator` | File lookup via `_index.json` |
| `AwsInfraArchitect` | **(alvo)** Called when `infra/` is touched — hoje não há `infra/`/Terraform, então não é acionado |
| `ObservabilityAdvisor` | Called when new Lambda handler/job added |
| `Regis-Review` (8× `qa-*` + `qa-consolidator`) | Mandatory post-impl architecture review; only P0 findings re-enter the loop |

## Inviolable Rules
1. Never commit `.env`, AWS credentials, or `terraform.tfstate` **(alvo — quando a infra Terraform existir)**
2. Never hardcode tenant values — use `EnvironmentProvider`
3. **(alvo)** Never `terraform apply` without `-var-file` (não há Terraform hoje)
4. **(alvo)** Lambda only — **não adicionar** Express/Fastify/HTTP frameworks a **código novo**. O backend
   atual *é* Express (legado do template, migrado proporcionalmente); a regra veta crescer o legado, não o
   exige reescrever de imediato. Código novo nasce DDD/Lambda-ready.
5. Always parameterized SQL (`$1`, `$2`) — never string interpolation
6. Always start Lambda handlers with `import 'reflect-metadata'`
7. Always `@injectable()` / `@singleton()` decorators on DI classes
8. Always `EnvironmentProvider` — never raw `process.env` in services
9. Always explicit access modifiers; always arrow function methods; always export classes
10. Always run `/feature-new` and `/feature-tweak` in a dedicated git worktree (never the main checkout) — short path under `C:/tmp` on Windows
11. Always run the Regis-Review gate after green (remediate only P0; P1/P2/P3 → inbox) unless `--no-regis-review`/`--urgent`/explicit opt-out
12. Always rebase the base branch (default `main`) into the feature branch before opening the PR; non-trivial conflicts pause for Yuri
