---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-09-1636-favorecido-busca
agent: qa-deployability
generated_at: 2026-10-09T16:50:00-03:00
scope: all
score: 8
findings_count: 3
cards_count: 2
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor Kavex | Merge da branch `feat/sispag-favorecido-busca` (busca de favorecido no cmn025, 2 rotas novas, diálogo reescrito) em `main` | Backend Render (`dist/`) + frontend Vercel | Produção, usuários SISPAG ativos, Conexos com teto de sessões | CI valida, deploy sem migração nem env nova, rollback do código sem passo manual de dados | 0 migrations, 0 envs novas, rollback = "Rollback" do Render/Vercel para v0.60.0, lead time commit-prd limitado ao CI |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passos automatizados no CI (backend) | 6 (audit, typecheck, lint, test+coverage, build, + job SQL Postgres 17) | ≥5 | ✅ | `.github/workflows/ci.yml:26-30,62` |
| Passos automatizados no CI (frontend) | 4 (typecheck, lint, test, build) | ≥4 | ✅ | `ci.yml:80-85` |
| Migrations SQL no delta | 0 (81 existentes, nenhuma alterada) | 0 para feature read-only | ✅ | `git status --short \| grep migrations` |
| Variáveis de ambiente novas | 0 (reusa `ConexosSispagClient`) | 0 | ✅ | `git diff origin/main --stat` (sem `EnvironmentProvider`/`.env` no delta) |
| Rotas novas / contrato quebrado | 2 novas, aditivas; `SolicitarAutorizacaoDialog` consome ambas | 0 breaking | ✅ | `_shared-metrics.md` |
| Acoplamento FE-BE no deploy | Frontend novo chama `POST /busca` e `GET /destino-atual`; se Vercel publicar antes do Render, 404 | ordem documentada | ⚠️ | `src/frontend/lib/sispag.ts` (+48) |
| Gates verdes pré-merge | typecheck, lint, 225 suites/4.016 testes BE, 88 suites FE | todos | ✅ | `_shared-metrics.md` |
| Feature flag para a busca | 0 | ≥1 para frente nova | ⚠️ | diff de `routes/sispag.ts` |
| Arquivo não-TS lido em runtime no delta | 0 | 0 (gotcha `dist/`) | ✅ | diff do delta |
| Rollback documentado | `DEPLOY.md:88` aponta `docs/runbooks/rollback.md` | presente | ✅ | `DEPLOY.md:88` |
| Bump de versão | `package.json` em 0.60.0, ainda não bumpado para o delta | bump `feat` → 0.61.0 no passo de release | ⚠️ | `src/backend/package.json:3` |
| Terraform / drift / bundle por Lambda | ⚠️ **Não medível**: não existe `infra/` nem Lambda (Render + Vercel). Recomendação: reavaliar quando o scaffold de infra for criado. | n/a | n/a | CLAUDE.md §Estado Atual |
| Build duration | ⚠️ **Não medível nesta rodada** (`--quick`; delta não toca o build). Recomendação: ler tempo do job `Backend` no Actions. | ≤60s | n/a | n/a |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Sem canary/blue-green; Render substitui a instância. Sem flag para ligar a busca por usuário/filial | ⚠️ parcial | `ci.yml`; ausência de flag no diff |
| Rollback | Rollback de deploy no Render/Vercel; delta sem migração, então rollback é puro código (sem reverse SQL) | ✅ presente | `DEPLOY.md:88`; 0 migrations no delta |
| Script Deployment Commands | CI + hook Render + `bump-version.ps1` (não roda em Linux, bump manual) | ⚠️ parcial | `ci.yml`; memória `bump-version-ps1` |
| Logical Grouping | Rotas SISPAG sob `sispag:executar`; serviço novo `PayeeSearchService` isolado | ✅ presente | `routes/sispag.ts`, `PayeeSearchService.ts` |
| Physical Grouping | BE (Render) e FE (Vercel) deployam separados; sem orquestração de ordem | ⚠️ parcial | `lib/sispag.ts` |
| Package Dependencies | `npm ci` + lockfile; `npm audit --audit-level=high` no CI; delta não adiciona dependências | ✅ presente | `ci.yml:23-26` |
| Surge Protection | Debounce 350 ms no FE, mínimo 3 letras, 20 linhas; sem rate limit no servidor | ⚠️ parcial | `_shared-metrics.md` |
| Idempotent deploys | Delta read-only e sem migração; reaplicar é no-op | ✅ presente | `_shared-metrics.md` |
| Drift detection | N/A: sem IaC; infra gerenciada em painel Render/Vercel | N/A | CLAUDE.md |
| Reproducible builds | `npm ci` e Node 24 fixados no CI; `tsc` determinístico | ✅ presente | `ci.yml:20` |
| Per-tenant blast-radius | N/A: tenant único (Columbia); blast radius = todos os usuários SISPAG | N/A | CLAUDE.md §Tenants |
| Deployment observability | `/health`, logs; sonda HML `probe-cmn025-busca-hml.ts` recusa base não-HML | ⚠️ parcial | `probe-cmn025-busca-hml.ts:17` |

## 4. Findings (achados)

### F-deployability-1: Semântica do `cmn025/#LIKE` e formato de `pdcDocFederal` não validados ao vivo antes do deploy

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands (verificação pós-deploy automatizada ausente)
- **Localização**: `src/backend/domain/client/ConexosSispagClient.ts` (+107); `src/backend/jobs/probe-cmn025-busca-hml.ts`
- **Evidência (objetiva)**:
  ```
  HML recusou o usuário do .env de produção (Bad Credentials); sonda em produção não rodada
  (derruba sessão viva no teto de sessões).  -- _shared-metrics.md "Não medido"
  ```
- **Impacto técnico**: o primeiro uso real em produção é a validação; busca por nome pode retornar 0 resultados ou resultados diferentes do esperado (contém × começa com, acento, caixa).
- **Impacto de negócio**: o analista continuaria abrindo o Conexos para achar o código, ou seja, o ganho da feature não aparece, sem perda financeira (read-only).
- **Métrica de baseline**: 0 de 4 modos de busca (doc, doc formatado, razão social, fantasia) validados ao vivo; 0 escritas (rebaixado de P1: sem dano, só ganho não comprovado).

### F-deployability-2: Ordem de deploy FE/BE não documentada para as 2 rotas novas

- **Severidade**: P2
- **Tactic violada**: Physical Grouping / Scale Rollouts
- **Localização**: `src/frontend/lib/sispag.ts` (+48); `src/backend/routes/sispag.ts` (+33)
- **Evidência (objetiva)**:
  ```
  FE novo chama POST /sispag/favorecidos-autorizados/busca e GET .../destino-atual (2 rotas, 0 flags).
  Se Vercel publicar antes do Render, o diálogo de solicitar autorização dá 404.
  ```
- **Impacto técnico**: janela de minutos em que o diálogo reescrito (373 linhas) fica quebrado, e o fluxo antigo (digitar código) foi removido do diálogo, sem fallback.
- **Impacto de negócio**: o analista não consegue solicitar autorização de favorecido na janela; há o rollback do FE.
- **Métrica de baseline**: 2 rotas novas, 0 fallbacks, 0 flags.

### F-deployability-3: Versão não bumpada para o delta

- **Severidade**: P3
- **Tactic violada**: Script Deployment Commands
- **Localização**: `src/backend/package.json:3` (0.60.0); `ontology/CHANGELOG.md`
- **Evidência (objetiva)**: delta tem `feat`; `bump-version.ps1` indisponível em Linux, bump manual nos dois `package.json` e conferir colisão com sessões paralelas.
- **Impacto técnico**: tag de release do CI é derivada de `package.json`, então sem bump não há tag para rollback preciso.
- **Impacto de negócio**: rastreabilidade de release reduzida.
- **Métrica de baseline**: 0 de 2 `package.json` bumpados (FE e BE em lockstep).

## 5. Cards Kanban

### [deployability-1] Validar a busca cmn025 ao vivo logo após o deploy e registrar o resultado

- **Problema**
  > A semântica do `#LIKE` e o formato de `pdcDocFederal` não foram medidos (HML recusou credencial, sonda em produção derrubaria sessão). O primeiro uso real vira o teste.

- **Melhoria Proposta**
  > Após o deploy, com usuário de sessão própria e fora do horário de pico, executar uma busca por cada modo (CPF/CNPJ, razão social, fantasia, código) e registrar em `DEPLOY.md` ou na ontologia (`buscar-favorecido-conexos.md`) o que o Conexos devolveu. Se o HML for liberado, rodar `probe-cmn025-busca-hml.ts` antes.

- **Resultado Esperado**
  > 4 de 4 modos de busca validados e documentados (hoje 0 de 4).

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - modos de busca validados ao vivo: 0/4 → 4/4
- **Risco de não fazer**: busca por nome silenciosamente fraca; analistas voltam ao Conexos.
- **Dependências**: credencial HML válida ou janela de produção

### [deployability-2] Documentar a ordem de deploy (backend antes do frontend) e fazer o bump de versão

- **Problema**
  > O diálogo novo depende de 2 rotas novas e removeu o fluxo antigo; deploy FE antes do BE quebra a solicitação. A versão ainda está em 0.60.0.

- **Melhoria Proposta**
  > Adicionar a `DEPLOY.md` a nota "Render (backend) primeiro, depois Vercel" para esta versão e bumpar FE+BE para 0.61.0 à mão, conferindo versão, ADR e ontologia na `main` antes. Rollback: reverter FE e BE para v0.60.0 (sem reverse SQL).

- **Resultado Esperado**
  > Ordem escrita, versão 0.61.0 em lockstep, janela de 404 evitada.

- **Tactic alvo**: Physical Grouping
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2, F-deployability-3
- **Métricas de sucesso**:
  - rotas novas com ordem de deploy documentada: 0/2 → 2/2
  - `package.json` bumpados: 0/2 → 2/2
- **Risco de não fazer**: repetir janela de erro em cada feature com rota nova, sem tag de rollback.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: delta apenas. Terraform, drift, bundle por Lambda e tenants são N/A porque não existe `infra/`; marquei sem inventar números.
- Ponto forte: 0 migrations, 0 envs novas e 0 dependências novas, então rollback é puro código e o deploy é idempotente.
- Cross-QA: F-deployability-1 liga a Performance/Integrability (semântica do cmn025, teto de sessões do Conexos) e Security (sem rate limit servidor na rota de busca, já nos gaps do shared-metrics).
- Build duration não medido (`--quick`); delta não toca o script de build.
