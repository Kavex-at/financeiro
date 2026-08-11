# Migration Debt — Financeiro

> **P0 gating doc.** O esqueleto foi copiado do `fechamento-processos`, que é Express + Next.js
> puro (estado atual), enquanto o `CLAUDE.md` mira Lambda + DDD/tsyringe + Terraform multi-tenant.
> A dívida abaixo é herdada pelo `financeiro` e **paga proporcionalmente** em cada `/feature-tweak`
> que tocar o código relevante (senão o `PatternGuardian` bloqueia o merge).

**Bootstrap:** 2026-06-10 (a partir de fechamento-processos v0.10.2).
**Atualização 2026-06-17 (PR #1, feedback do Yuri):** poda do código só-fechamento sem reuso nas 3 frentes
+ reframe do `CLAUDE.md`/`.claude/` para "Atual (Render/Vercel/Supabase) vs. Alvo (Lambda/Terraform)". Ver
ADR-0003.

## Backend

| ID | Item | Status | Onde |
|----|------|--------|------|
| B1 | Express em vez de Lambda + API Gateway | OPEN | `src/backend/index.ts`, `routes/` |
| B2 | DDD parcial — camada `domain/` coexiste com legado `routes/`+`services/`. Métodos mortos de leitura de NF removidos do `services/conexos.ts` (ADR-0003); resta o legado de sessão/transporte usado pelo adapter. | PARTIAL | `src/backend/` |
| B3 | Cliente Conexos legado (sessão por cookie) bridge via adapter token. Read methods só-fechamento podados (ADR-0003); adapter mantém só o transporte genérico. | PARTIAL | `domain/client/legacyConexosAdapter.ts`, `services/conexos.ts` |
| B4 | Sem observabilidade estruturada (X-Ray, métricas CloudWatch) | OPEN | backend inteiro |

## Frontend

| ID | Item | Status | Onde |
|----|------|--------|------|
| F1 | Design System replicado de nf-projects (docs presentes, primitivas shadcn) | PARTIAL | `src/frontend/components/ui/`, `docs/design-system/` |
| F2 | Sem TanStack Query — `fetch` + Zod manual | OPEN | `src/frontend/lib/` |

## Infra

| ID | Item | Status | Onde |
|----|------|--------|------|
| I1 | Sem Terraform / tenant scaffold (deploy via Render hook) | OPEN | `.github/workflows/ci.yml` |
| I2 | Credenciais via `.env` local / SSM em deploy — sem multi-tenant isolado | PARTIAL | `EnvironmentProvider` |

## Específico do bootstrap financeiro

| ID | Item | Status | Onde |
|----|------|--------|------|
| O1 | Ontologia vazia — domínio ainda não modelado | OPEN (esperado) | `ontology/` |
| O2 | Agentes/comandos `.claude/` **totalmente repassados ao propósito financeiro** (identidade + exemplos de domínio: máquina de status NF→fluxos das 3 frentes, Qive→Nexxera/GED/SharePoint, CFOP/RECOF→permuta/lote/NC-ND, métricas `NfsProcessed`→`PermutasReconciled` etc., SSM `qive_credentials`→`nexxera_credentials`). Exemplos usam conceitos da proposta e estão marcados "(a modelar via /feature-new)" — sem inventar regras. Exceção proposital: `design-system-reviewer.md:160` ("bootstrapped from nf-projects", lineage real). | RESOLVED | `.claude/agents/`, `.claude/commands/` |
| O3 | **`ConexosClient` é READ-ONLY** — transporte só com `getGeneric` (os `post` são o protocolo de *query* do Conexos, NÃO mutação). Não há insert/update/baixa. Mas Permutas (executar na `fin010`) e SISPAG (conciliar baixa) exigem **caminho de escrita no ERP que NÃO existe e nunca foi validado**. A primeira `/feature-new` de Permutas/SISPAG deve desenhar e validar o contrato de escrita. ⚠️ **Risco arquitetural #1.** **Poda (ADR-0003, 2026-06-17):** removidos os 14 reads só-fechamento sem reuso (DI/DUIMP, variação cambial, NF saída, índices/cotações, encargos gerais, lançamentos contábeis, sol. numerário). **Mantidos como scaffold de leitura das frentes:** `listProcessos`, `listFinanceiroAPagar(ByGerNum)`, `getMnyTitPermutar`, `listAdiantamentoFinanceiroAPagar/AReceber`, `listTitulosAPagar`, `listBaixasTitulo`, `listFiliais`, `getFilCodDefault`. A decisão final de quais reads sobrevivem cabe à 1ª `/feature-new` de cada frente. **Permutas Fatia 1 (ADR-0004, 2026-06-17):** decidiu **re-introduzir** os reads `imp019` (D.I, data CI) e `imp223` (DUIMP, data desembaraço) — escopo restrito a **data-base + existência (XOR)**, NÃO os campos de taxa/variação do fechamento. **P0-4 RESOLVIDO (probe de rede 2026-06-18, filCod=2, 410 adiantamentos reais):** a re-introdução dos reads D.I/DUIMP agora **inclui a data-base** — campos wire `cdiDtaCi` (`imp019`) e `dioDtaDesembaraco` (`imp223`), epoch-ms, plugados em `ConexosClient.mapDeclaracaoDataBase`; XOR confirmado em dados reais. **Essa parte (re-introdução dos reads D.I/DUIMP com data-base) está CONCLUÍDA.** A escrita `fin010` permanece fora de escopo (Fatia 2) — risco #1 intocado. | PARTIAL | `domain/client/ConexosClient.ts`, `services/conexos.ts`, `legacyConexosAdapter.ts` |
| O4 | Skeleton é **Express request/response** — sem runtime de job/scheduler. A "cadência diária" das 3 frentes (lote SISPAG, reconciliação Permutas, watch SharePoint) não tem onde rodar. Sem mudança estrutural ainda; mapeado para o roadmap. | OPEN | `src/backend/index.ts` |
| O5 | **Postgres em uso (Permutas Fatia 1).** Snapshot/auditoria persistidos via `PermutaSnapshotRepository`. **P0-5 (2026-06-18):** `PostgreeDatabaseClient.withTransaction(fn)` adicionado (BEGIN/COMMIT/ROLLBACK em client dedicado do pool); `persistRun` agora roda em **1 transação atômica** com INSERT multi-row em chunks de 500 (round-trips N=200: 201→2) — fim do N+1 e do risco de cabeçalho `success` com snapshot truncado. **P0-1 (2026-06-18):** `MigrationRunner.run()` **cablado no bootstrap** (`bootstrapAppContainer`, antes do tráfego) + `npm run migrate` (CLI `migrations/migrate.ts`) + step CI pré-deploy — migration roda automática em ambiente novo. **P0-6 (2026-06-18):** pool `max` 1→5; `withAdvisoryLock` (`pg_try_advisory_lock`) + tabela `permuta_eleicao_idempotency` (TTL 24h, migration `0002`) para idempotência da eleição por `Idempotency-Key`. Backlog/aging, estado do lote e fila de exceções das demais frentes seguem por modelar. | PARTIAL | `domain/client/database/PostgreeDatabaseClient.ts`, `domain/repository/permutas/PermutaSnapshotRepository.ts`, `migrations/` |
| O6 | **Auditoria persistida em uso (Permutas Fatia 1).** Auditoria por run (`permuta_eleicao_run`: `flow_id`, `triggered_by`, `status`, `error_message`) + snapshot por candidata. **P0-2 (2026-06-18):** `fil_cod` propagado ponta-a-ponta (Conexos → `Adiantamento.filCod` → snapshot row → INSERT) — invariante multi-filial I6, antes 100% `NULL`. **RBAC por perfil RESOLVIDO (2026-08-06, ADR-0030 — feature `supabase-auth`):** o `role` deixa de vir do JWT e passa a ser resolvido de `app_user` **a cada request** (`appUserContext`), com **403 fail-closed** quando não há linha ou quando `ativo = false`; `requireRole('admin')` fica idêntico — muda só a *origem* de `req.user.role`. O item **`rbac-roles-permutas` está fechado** (amenda a ADR-0011 §1, que dizia *"o `role` já vem no JWT"*). **NOVO nesta frente:** a identidade de auditoria passa a ser `app_user.username`, **nunca** o `sub` do provedor (I-Usuario-1, 21 call sites) — valores idênticos aos já gravados, sem migração de dados. **Dívida REMANESCENTE, agora isolada e nomeada:** (a) o escopo por **filial** segue **fail-OPEN** (`http/filialAuthz.ts:48` retorna `true` sem allow-list, e a claim `filiais` nunca foi provisionada) — carry-over aberto desde 2026-06-22, 6º Regis-Review consecutivo; com a autorização vindo do banco, fechá-lo vira um `JOIN` (ver `_inbox/supabase-auth-regis-followups.md`); (b) mudanças de estado de `Usuario` (desativar / reset de senha / vincular Conexos) ainda **não registram quem fez** (I-Usuario-7). | PARTIAL | `http/auth.ts`, `http/appUserContext.ts`, `http/filialAuthz.ts`, `domain/repository/auth/UserRepository.ts`, `domain/repository/permutas/PermutaSnapshotRepository.ts` |
| O7 | Integrações **Nexxera / GED / SharePoint** inexistentes (sem client, sem config). Net-new por `/feature-new`. | OPEN | `domain/client/`, `EnvironmentVars.ts` |
