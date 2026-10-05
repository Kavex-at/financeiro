---
qa: Deployability
qa_slug: deployability
run_id: 2026-10-05-1625
agent: qa-deployability
generated_at: 2026-10-05T16:40:00-03:00
scope: all
score: 7
findings_count: 3
cards_count: 3
---

# Deployability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev Kavex | Merge do tweak `sispag-carteira-ao-abrir` (rota nova + 2 env vars + 2º schedule) | Render (backend), Vercel (frontend), `ingest-sispag.yml` | Produção, sem `infra/`/Terraform | Entrega sem quebrar o cron existente; desligar o refresh sem redeploy de código se o Conexos sofrer | Rollback do refresh em 1 mudança de env var; 0 colisão de sessão Conexos entre crons |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Gates automatizados do delta (typecheck, lint, jest BE, jest FE) | 4 verdes: 198 suítes/3644 testes BE; 16 suítes/197 testes FE | ≥ 4 | ✅ | `_shared-metrics.md` |
| Passos CI→prd do workflow de ingestão (ci, migrate, ingest, formar, alerta) | 5 | ≥ 5 | ✅ | `.github/workflows/ingest-sispag.yml:52-89` |
| Novas env vars documentadas em `DEPLOY.md`, `render.yaml` e `.env.example` | 0 de 2 | 2 de 2 | ❌ | grep `SISPAG_CARTEIRA` fora de `ontology/` e `src/` = vazio |
| Colisão de horário entre crons que usam a sessão Conexos | 1 (15:00 UTC: Permutas `0 9,15,21 * * *` e SISPAG `0 15,19 * * 1-5`) | 0 | ⚠️ | `ingest-permutas.yml:13`, `ingest-sispag.yml:27` |
| Rollback do refresh sem redeploy de código | 1 passo (env `SISPAG_CARTEIRA_TTL_MIN=1440`), documentado no ADR-0060 "Reversão" | ≤ 1 passo | ✅ | `ontology/decisions/0060-...md:74-76` |
| Execuções diárias de ingestão em dia útil | 3 (antes 1) | n/a | ✅ | `ingest-sispag.yml:25,27` |
| Pontualidade do schedule do GitHub | atraso de 2-5 h observado | n/a | ⚠️ | `_shared-metrics.md` |
| Bundle por Lambda, duração de build, módulos Terraform, drift, state | ⚠️ **Não medível localmente**: não existe `infra/` nem Lambda. Requer o scaffold de infra (alvo). |  |  |  |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Sem canary. O gate de formação por `github.event.schedule` é rollout seletivo de passo, não de versão. | ⚠️ parcial | `ingest-sispag.yml:65` |
| Rollback | Reversão por env var (TTL alto) mais revert do cron. O revert de código passa por novo deploy (Render hook). Não existe rollback de artefato. | ⚠️ parcial | ADR-0060 "Reversão" |
| Script Deployment Commands | `npm ci`, `migrate` e jobs em script; deploy via Render hook | ✅ presente | `ingest-sispag.yml:57-66` |
| Logical Grouping | Env vars lidas só via `EnvironmentProvider`; schedule único com `concurrency` | ✅ presente | `EnvironmentProvider.ts:35,250-251,343-344` |
| Physical Grouping | N/A: sem Lambda/Terraform hoje (Render + Actions). | N/A | CLAUDE.md "Estado Atual" |
| Package Dependencies | `npm ci` com lockfile | ✅ presente | `ingest-sispag.yml:57` |
| Surge Protection | Lock advisory, TTL 30 min, cooldown 5 min, `concurrency` sem cancel | ✅ presente | ADR-0060; `ingest-sispag.yml:31-33` |
| Idempotent deploys | `migrate` idempotente; ingestão com anti-fantasma | ✅ presente | `ingest-sispag.yml:58` |
| Drift detection | N/A: sem Terraform. Config de env no Render é manual e sem checagem. | ❌ ausente | `render.yaml` sem as vars |
| Reproducible builds | `npm ci`, Node 22 pinado | ✅ presente | `ingest-sispag.yml:53-57` |
| Per-tenant blast radius | N/A: tenant único hoje. | N/A | CLAUDE.md §Tenants |
| Deployment observability | Passo `failure()` de alerta (ADR-0042); `detect-staleness` | ✅ presente | `ingest-sispag.yml:79-89` |

## 4. Findings

### F-deployability-1: Duas novas env vars operacionais sem registro no catálogo de deploy

- **Severidade**: P2 (sem baseline numérica de incidente; rebaixado de P1)
- **Tactic violada**: Script Deployment Commands (config como parte do deploy)
- **Localização**: `DEPLOY.md:108` (tabela de vars), `render.yaml:45`, `src/backend/.env.example`
- **Evidência (objetiva)**:
  ```
  grep SISPAG_CARTEIRA em DEPLOY.md, render.yaml, .env.example -> 0 ocorrências
  (só em ontology/ e EnvironmentProvider.ts:250-251,343-344)
  ```
- **Impacto técnico**: o plano de reversão do ADR-0060 depende de setar `SISPAG_CARTEIRA_TTL_MIN` no Render. Quem opera às 2h não acha a variável no `DEPLOY.md`.
- **Impacto de negócio**: o kill switch existe mas é difícil de achar; um 403 em massa do robô vira incidente mais longo.
- **Métrica de baseline**: 0 de 2 vars documentadas.

### F-deployability-2: Gate de formação acoplado à string literal do cron

- **Severidade**: P2
- **Tactic violada**: Script Deployment Commands
- **Localização**: `.github/workflows/ingest-sispag.yml:25,65`
- **Evidência (objetiva)**:
  ```
  - cron: '0 10 * * *'
  if: github.event_name == 'workflow_dispatch' || github.event.schedule == '0 10 * * *'
  ```
- **Impacto técnico**: editar o cron da manhã (por exemplo, mudar a hora) sem editar o `if` faz a formação de lotes parar em silêncio. O passo é pulado e o workflow fica verde. O alerta `failure()` não dispara. O `detect-staleness` só cobre a formação se houver pipeline próprio.
- **Impacto de negócio**: lotes deixam de ser formados sem alarme, e a Columbia só nota ao abrir a tela.
- **Métrica de baseline**: 2 literais idênticos que precisam mudar juntos; 0 testes ou checagens os acoplam. Frequência de falha não medível localmente.

### F-deployability-3: Cron SISPAG das 15:00 UTC coincide com o de Permutas

- **Severidade**: P2
- **Tactic violada**: Surge Protection
- **Localização**: `ingest-sispag.yml:27` e `ingest-permutas.yml:13`
- **Evidência (objetiva)**:
  ```
  sispag:   '0 15,19 * * 1-5'
  permutas: '0 9,15,21 * * *'   -> ambos às 15:00 UTC em dia útil
  ```
- **Impacto técnico**: o cabeçalho do workflow diz que evita conflito de sessão Conexos (+1h de deslocamento) e as duas ingestões usam grupos de `concurrency` distintos. Na prática o GitHub atrasa 2-5 h, então o escalonamento não é garantido de qualquer forma. A abertura da tela também pode disparar a ingestão ao mesmo tempo.
- **Impacto de negócio**: sessão Conexos derrubada gera `falha_recente` e carteira velha (já houve caso de credencial: Bad Credentials em 23/09).
- **Métrica de baseline**: 1 horário nominal em comum (15:00 UTC) de 2 novos (15:00, 19:00).

## 5. Cards Kanban

### [deployability-1] Documentar SISPAG_CARTEIRA_TTL_MIN e COOLDOWN_MIN no deploy

- **Problema**
  > As duas vars novas não aparecem em `DEPLOY.md`, `render.yaml` nem `.env.example`. A reversão do ADR-0060 depende delas.

- **Melhoria Proposta**
  > Adicionar as duas linhas à tabela de `DEPLOY.md:108`, ao `.env.example` e a `render.yaml` (com default 30 e 5), e incluir o passo "TTL=1440" no runbook de incidente do SISPAG.

- **Resultado Esperado**
  > Kill switch achável em um grep. Vars documentadas: 0/2 → 2/2.

- **Tactic alvo**: Rollback
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Vars documentadas: 0/2 → 2/2
- **Risco de não fazer**: reversão lenta num incidente com o Conexos.
- **Dependências**: nenhuma

### [deployability-2] Desacoplar o gate de formação da string do cron

- **Problema**
  > O `if` compara `github.event.schedule` com o literal do cron. Mudar o cron sem mudar o `if` faz a formação sumir sem alarme.

- **Melhoria Proposta**
  > Separar em dois workflows (ingestão+formação na manhã; só ingestão no dia útil), ou comentar com um teste de CI (grep) que garanta que os dois literais coincidem. Alternativa: um passo que loga "formação pulada" explicitamente.

- **Resultado Esperado**
  > Literais acoplados sem checagem: 2 → 0 (ou 2 com checagem automática).

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Checagens que acoplam os literais: 0 → 1
- **Risco de não fazer**: formação para silenciosamente na próxima edição de horário.
- **Dependências**: nenhuma

### [deployability-3] Escalonar o cron SISPAG de 15:00 UTC fora do de Permutas

- **Problema**
  > O 2º schedule do SISPAG cai no mesmo horário nominal do de Permutas (15:00 UTC), contra a intenção declarada no cabeçalho.

- **Melhoria Proposta**
  > Mover para `0 14,19 * * 1-5` ou `30 15`. Registrar a regra de escalonamento no cabeçalho dos dois workflows.

- **Resultado Esperado**
  > Horários nominais em comum: 1 → 0.

- **Tactic alvo**: Surge Protection
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Colisões nominais: 1 → 0
- **Risco de não fazer**: disputa de sessão Conexos e carteira velha.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta (`--quick`); sem build, sem coverage, sem terraform. Nenhum `infra/` existe.
- O ADR está em `ontology/decisions/0060-...md` (não em `docs/adr`). A reversão é adequada: env var sem mudança de código. O revert do cron exige commit e merge, e o schedule só dispara a partir de `main`.
- Cross-QA: Availability e Performance (GitHub atrasa 2-5 h; refresh síncrono de ~10 s na abertura da tela); Security (reuso do robô com 403 em FIN_041).
