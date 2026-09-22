---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-16-1650-metricas-historico
agent: qa-deployability
generated_at: 2026-09-18T00:00:00-03:00
scope: backend
score: 8
findings_count: 2
cards_count: 2
---

# Deployability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev (merge em `main`) | Push dispara **dois** deploys independentes e não coordenados: Render (backend, `autoDeploy: true`, migration `0060` embutida no boot) e Vercel (frontend, `?historico=true` novo) | `src/backend/routes/metricas.ts`, `MetricasCicloRepository.ts`, migration `0060`, `src/frontend/lib/metricas.ts` | Produção, single-tenant (Columbia), Postgres único (Supabase) | Qualquer combinação temporária FE-novo/BE-velho ou FE-velho/BE-novo deve responder 200 com dado coerente (nunca 500 por função/coluna inexistente) | 0 erros 500 atribuíveis a ordem de deploy; janela de inconsistência = 0s por construção (não por sorte de timing) |

Este é o cenário central pedido pelo escopo desta run: **não** há coordenação explícita entre o deploy do Vercel e o do Render — são hooks independentes no mesmo push. A pergunta é se o desenho do delta sobrevive a qualquer ordem de chegada.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Janela de inconsistência BE-novo servindo antes da migration `0060` aplicar | **0s** — `BootMigrator.run()` roda e precisa completar (ou lançar) antes de `app.listen()` | 0s | ✅ | `src/backend/index.ts:68-83` (`runMigrations` no `startServer`, antes de `listen`), `src/backend/http/bootstrap.ts` |
| Comportamento do BE-antigo (schema sem `historico`) recebendo `?historico=true` do FE-novo | `z.object({ inicio, fim })` sem `.strict()` → chave desconhecida é **descartada em silêncio**, resposta = comportamento pré-ADR-0048 (200, não 400/500) | Sem erro | ✅ | Verificado com Zod real: `s.safeParse({historico:'true'}) → {success:true, data:{}}`; `git show origin/main:src/backend/routes/metricas.ts` |
| Comportamento do BE-novo recebendo requisição do FE-antigo (sem `?historico=true`) | `historico` ausente → filtro sem a chave → piso `metricas.serie_inicio()`, resposta idêntica à de antes (opt-in por desenho) | Sem erro | ✅ | `src/backend/routes/metricas.ts` (`historico === 'true' ? {...} : {}`), `MetricasCicloService.ts` |
| Migration `0060` é idempotente | `CREATE OR REPLACE FUNCTION` + `REVOKE ALL ... FROM PUBLIC` — ambos re-executáveis sem efeito colateral; registrada em `schema_migrations` por nome, corrida uma vez por ambiente | Idempotente | ✅ | `src/backend/migrations/0060_metricas_historico_inicio.sql`, `runMigrations.ts:47-71` |
| Script de rollback dedicado para `0060` | Ausente (não há `0060_*.rollback.sql`) | Presente só se exigido pela política | ✅ (conforme política) | Política em `migrations/rollbacks/README.md`: rollback dedicado só é exigido para migration com `UPDATE` sobre >1.000 linhas; `0060` não tem DML — é puramente aditiva (nova função). Reverter o **código** e deixar a migration aplicada é o caminho documentado (`docs/runbooks/rollback.md`, tabela "aditiva → seguro") |
| Bump de versão lockstep FE/BE | `src/backend/package.json` = `0.38.0`; `src/frontend/package.json` = `0.38.0`; `CHANGELOG.md` datado 2026-09-18 | Igual nos dois | ✅ | `grep version` nos dois `package.json`; commit `16e91c3 chore(release): v0.38.0` |
| CI gate antes do deploy | `ci.yml`: `typecheck` + `lint` + `test --coverage` + `test:sql` (Postgres 17 real) + `build`, obrigatórios por branch protection antes de chegar em `main` | Presente | ✅ | `.github/workflows/ci.yml`; `render.yaml` comenta explicitamente "o gate é branch protection, não um job de deploy" |
| Aprovação humana entre merge e produção | Nenhuma — `autoDeploy: true` no Render, deploy automático na Vercel | Manual gate ou canary | ⚠️ | `render.yaml:11` (`autoDeploy: true`); `docs/runbooks/rollback.md` ("Não há passo humano entre o merge e a produção, então a reversão é o único freio") — **pré-existente, fora do delta**, citado só como contexto do cenário |
| Teste automatizado que trava o contrato de "chave desconhecida é descartada" (a garantia de que sustenta a segurança da ordem de deploy) | Não encontrado | Presente | ⚠️ | `grep -rn "strict\|passthrough" src/backend/routes` sem ocorrência de teste de contrato; a prova feita nesta review foi manual (node -e) |

## 3. Tactics — Cobertura no nf-projects (financeiro)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Scale Rollouts** (canary/blue-green/rolling) | Render faz cutover binário gated por `healthCheckPath: /health` (zero-downtime em plano pago), sem canário e sem rollout gradual; Vercel troca alias instantaneamente. Não há tráfego parcial nem observação incremental. | ⚠️ parcial | `render.yaml` (`healthCheckPath: /health`), `docs/runbooks/rollback.md` §2 (Vercel "Promote to Production" é troca de alias, instantânea) |
| **Rollback** | Documentado, com runbook dedicado, distinguindo migration aditiva (seguro reverter só o código) de destrutiva (não reverter sozinho); dois passos manuais (Render "Rollback to this deploy", Vercel "Promote to Production"), com verificação via `/health` e `/health/pipelines`. Não é "um comando", é um runbook de poucos cliques com meta de ≤5min. | ✅ presente | `docs/runbooks/rollback.md` (arquivo inteiro) |
| **Script Deployment Commands** | `render.yaml` declara build/start; `npm run migrate` existe como entrypoint standalone; boot roda `BootMigrator` antes de aceitar tráfego — nenhum passo manual de migration em produção. | ✅ presente | `render.yaml`, `src/backend/migrations/migrate.ts`, `src/backend/index.ts:68-75` |
| **Logical Grouping** | Monorepo com fronteira clara `src/backend/` (domínio+migrations) vs `src/frontend/` (UI); dentro do backend, o delta segue a estratificação `routes → service → repository → migration` sem vazar SQL para a rota. | ✅ presente | `git diff --stat` do delta (7 arquivos de produção, cada um na sua camada) |
| **Physical Grouping** | Um único serviço Render + um único banco Supabase — não há múltiplas instâncias físicas nem tenants isolados para agrupar (SaaS single-tenant hoje, ver CLAUDE.md "Estado Atual"). | N/A | Não há `infra/`/Terraform/multi-tenant neste repositório — confirmado em `_shared-metrics.md` |
| **Package Dependencies** | `package-lock.json` commitado nos dois lados, mantido ativamente (commits recentes de bump de dependência fora deste delta); delta não adiciona dependência nova. | ✅ presente | `ls -la src/backend/package-lock.json src/frontend/package-lock.json`; `git diff origin/main --stat` não lista nenhum `package.json` com dependência nova (só bump de versão) |
| **Surge Protection** | Fora do escopo do delta — não tocado pelas mudanças de `historico`. Pool do Postgres já documentado em `DEPLOY.md` ("Budget de sessões do pooler"), pré-existente. | N/A para este delta | `DEPLOY.md` §"Budget de sessões do pooler" |
| **Idempotent deploys** | `schema_migrations` registra por nome de arquivo; `CREATE OR REPLACE` + `REVOKE ALL` em `0060` são idempotentes; reaplicar o mesmo deploy (ou reiniciar o processo no meio) não duplica efeito. | ✅ presente | `runMigrations.ts:47-71`, `0060_metricas_historico_inicio.sql` |
| **Drift detection** | Nenhum job compara schema declarado vs. schema real do Postgres de produção fora do próprio boot (que só aplica o que falta, não detecta divergência manual). | ❌ ausente | Nenhuma ocorrência de "drift" nos workflows; não há Terraform para `plan` contra |
| **Reproducible builds** | Lockfiles commitados; `esbuild`/Next build fixados via `package-lock.json`; sem timestamp embutido observado no delta (migration é SQL estático, sem geração dinâmica). | ✅ presente | `package-lock.json` presente e versionado nos dois pacotes |
| **Per-tenant blast-radius limit** | Não aplicável — single-tenant hoje (nenhum tenant Terraform provisionado, ver CLAUDE.md §Tenants); o "blast radius" real é 100% da produção Columbia a cada deploy. | N/A (arquitetura ainda single-tenant) | CLAUDE.md §Tenants vazio; `_shared-metrics.md` |
| **Deployment observability** | `/health` e `/health/pipelines` expostos e usados no runbook para confirmar rollback; logs estruturados de boot (`[boot-migrate] aplicada(s) N: ...`) e do processo de migração. Nenhum alerta automático (Slack/PagerDuty) citado no delta — verificação é manual via `curl`. | ⚠️ parcial | `src/backend/migrations/BootMigrator.ts:74-78`, `docs/runbooks/rollback.md` §3 |

## 4. Findings (achados)

### F-deployability-1: Nenhum teste trava o contrato implícito de forward-compatibility entre deploys FE/Vercel e BE/Render

- **Severidade**: P2
- **Tactic violada**: Deployment observability / Rollback (garantia não testada)
- **Localização**: `src/backend/routes/metricas.ts:16-20` (schema sem `.strict()`), ausência em `src/backend/routes/metricas.test.ts`
- **Evidência (objetiva)**:
  ```
  const s = z.object({ inicio: z.string().optional(), fim: z.string().optional() });
  s.safeParse({ historico: 'true' })
  → { success: true, data: {} }
  ```
  A segurança de qualquer ordem de deploy (FE-novo antes do BE-novo) depende de este comportamento — chave desconhecida descartada, não rejeitada — mas nenhum teste do delta afirma isso como contrato. É uma propriedade do Zod usada implicitamente, não uma decisão documentada em código ou ADR.
- **Impacto técnico**: se um `.strict()`/`.passthrough()` for adicionado a `cicloQuerySchema` (ou a qualquer schema de rota) num PR futuro sem se dar conta de que ele sustenta a ordem de deploy, o primeiro efeito colateral é um 400 em produção durante toda janela em que Vercel estiver à frente do Render — sem alarme, porque o CI não teria como saber que essa propriedade importa.
- **Impacto de negócio**: janela de tela `/metricas` quebrada (erro visível ao analista) logo após cada deploy futuro que toque este padrão, até alguém perceber e reverter — sem sinal de causa óbvia, porque o "erro" não está no código novo, está na ausência de proteção contra ele.
- **Métrica de baseline**: 0 testes cobrindo "requisição com chave de query desconhecida" no schema atual (`grep -c "chave desconhecida\|unknown.*key\|strict" src/backend/routes/metricas.test.ts` = 0).

### F-deployability-2: Deploy de produção sem gate humano nem rollout gradual (canary/blue-green) — pré-existente, contexto do cenário

- **Severidade**: P3
- **Tactic violada**: Scale Rollouts
- **Localização**: `render.yaml:11` (`autoDeploy: true`), ausência de configuração de canário em Render/Vercel
- **Evidência (objetiva)**: `autoDeploy: true` + branch protection como único gate; `docs/runbooks/rollback.md`: "Não há passo humano entre o merge e a produção, então a reversão é o único freio."
- **Impacto técnico**: qualquer regressão passa direto para 100% do tráfego de produção antes de qualquer sinal automatizado de erro aparecer; a mitigação é reativa (runbook de rollback em ≤5min), não preventiva.
- **Impacto de negócio**: para o volume atual (single-tenant, uso interno) o custo de um rollback reativo é aceitável, mas o padrão não escalaria para múltiplos tenants (roadmap CLAUDE.md) sem canário por cliente.
- **Métrica de baseline**: 0 deploys canário/graduais nos últimos 5 commits de release observados no log (`git log --oneline -5` mostra 5 `feat`/`chore(release)` direto em `main`, todos full-cutover).

> Este finding é sobre a arquitetura de deploy geral (pré-existente), não sobre o delta desta run. Incluído por completude do template (tactic obrigatória) e porque o cenário central pedido (ordenação FE/BE) é justamente uma instância deste padrão sem-canário. Rebaixado a P3 porque não é introduzido nem agravado por este delta.

## 5. Cards Kanban

### [deployability-1] Testar o contrato de forward-compatibility que sustenta a ordem de deploy FE/BE

- **Problema**
  > A segurança de "Vercel pode subir antes do Render sem quebrar `/metricas`" depende de `cicloQuerySchema` não usar `.strict()`/`.passthrough()`, uma propriedade verificada manualmente nesta review (`z.object(...).safeParse({historico:'true'}) → data:{}`), não travada por teste. Qualquer PR futuro que endureça a validação de query em rotas compartilhadas pode quebrar essa garantia sem se dar conta de que ela existe.

- **Melhoria Proposta**
  > Adicionar um teste em `src/backend/routes/metricas.test.ts` (ou um teste de contrato mais genérico em `http/`) que simula explicitamente uma requisição "do frontend futuro contra o schema atual" — chave de query desconhecida deve retornar 200, nunca 400/500. Documentar a intenção no comentário do schema (`cicloQuerySchema`): "não usar `.strict()` aqui — a ordem de deploy Vercel/Render depende de chaves desconhecidas serem ignoradas, ver ADR-0048". Tactic Bass: **Deployment observability** (tornar visível uma garantia que hoje só existe na cabeça de quem fez esta review).

- **Resultado Esperado**
  > Teste de contrato presente: 0 → 1+ (`metricas.test.ts` ou `http/contractCompat.test.ts`); qualquer regressão futura no schema falha o CI antes de chegar em produção, em vez de aparecer como 400 intermitente pós-deploy.

- **Tactic alvo**: Deployment observability
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Testes de contrato de compatibilidade de schema de query: 0 → ≥1
  - Comentário explícito no código ligando a decisão de schema à ordem de deploy: ausente → presente
- **Risco de não fazer**: próxima "limpeza" de validação que adicione `.strict()` a uma rota compartilhada reintroduz exatamente o incidente que a ADR-0048 evitou (tela em branco / erro), só que desta vez por 400 em vez de dado vazio — mais difícil de diagnosticar porque parece um bug de contrato de API, não um problema de dado.
- **Dependências**: nenhuma

### [deployability-2] Registrar a ordem de deploy segura no runbook/DEPLOY.md

- **Problema**
  > `docs/runbooks/rollback.md` documenta muito bem a direção *reversa* (o que fazer quando um deploy quebra), mas nenhum documento afirma, para a frente, que Render e Vercel podem chegar em qualquer ordem com segurança — essa conclusão só existe nesta revisão de arquitetura, não no repositório.

- **Melhoria Proposta**
  > Acrescentar uma seção curta em `DEPLOY.md` (ou um novo `docs/runbooks/deploy-ordering.md`) explicando: (1) BootMigrator garante que o backend nunca serve com migration pendente; (2) rotas usam Zod não-`.strict()` de propósito, então parâmetro novo do frontend contra backend antigo degrada sem erro; (3) portanto Vercel e Render podem deployar em qualquer ordem. Referenciar `BootMigrator.ts` e o teste do card `deployability-1` como prova viva da garantia.

- **Resultado Esperado**
  > Próximo desenvolvedor que adicionar um parâmetro de query fim-a-fim (rota nova + tela nova) encontra a regra documentada em vez de precisar re-derivá-la lendo `BootMigrator` e o Zod schema do zero.

- **Tactic alvo**: Deployment observability / Script Deployment Commands (documentação como parte do pipeline)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Seção "ordem de deploy FE/BE" em `DEPLOY.md`: ausente → presente
- **Risco de não fazer**: conhecimento tribal — a garantia sobrevive só enquanto quem a descobriu (esta review) estiver disponível para explicá-la de novo.
- **Dependências**: nenhuma (independente do card 1, mas reforça o mesmo achado)

## 6. Notas do agente

- Escopo `--quick`, restrito ao delta (7 arquivos de produção). Mecanismos citados como evidência (`BootMigrator`, `render.yaml`, `docs/runbooks/rollback.md`) são pré-existentes, não deste delta — citados porque são exatamente o que determina se o desenho do delta é seguro na ordem de deploy pedida pelo escopo.
- **Conclusão central**: a pergunta do escopo ("frontend sobe antes da migration rodar?") tem resposta verificada: **janela de inconsistência = 0s**, por construção (`BootMigrator` bloqueia `/health` até a migration completar ou o processo morrer) e por desenho opt-in (`historico=true` é ignorado, não rejeitado, por schemas antigos). Nenhum P0 encontrado neste eixo.
- **Cross-QA**: `F-deployability-1` (contrato Zod não-`.strict()` como mecanismo de compatibilidade) é também um achado de **Modifiability** em potencial — a próxima pessoa que "padronizar" os schemas de rota com `.strict()` por higiene de tipagem quebra esta garantia sem saber. Sinalizar para o consolidator cruzar com `modifiability.md`.
- Não coletei cobertura de teste (`--coverage`) nem `npm audit` profundo — fora do escopo `--quick` e já cobertos pelo baseline compartilhado (`_shared-metrics.md`).
