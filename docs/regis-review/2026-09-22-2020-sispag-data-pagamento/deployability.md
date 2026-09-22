---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-22-2020-sispag-data-pagamento
agent: qa-deployability
generated_at: 2026-09-22T20:45:00-03:00
scope: backend + frontend (delta da feature; infra não existe neste repo)
score: 8
findings_count: 2
cards_count: 2
---

# Deployability — Regis-Review

> **Nota de escopo (leia antes das tabelas):** o brief genérico deste QA presume Lambda + Terraform
> multi-tenant. **Este repositório não é esse alvo.** Por `CLAUDE.md` §"Estado Atual vs. Alvo", a
> stack de deploy real da Columbia Financeiro é **Render (backend Express) + Vercel (frontend
> Next.js) + Supabase (Postgres)**, single-tenant, sem `infra/`/Terraform. Toda métrica pedida no
> brief para Lambda (bundle size, `local.api_lambdas`, módulos Terraform) é **não aplicável** aqui —
> substituída pelas tactics equivalentes na stack real, encontradas em `render.yaml`, `DEPLOY.md` e
> `docs/runbooks/rollback.md`. A revisão avalia a feature `sispag-data-pagamento` (ADR-0049, delta
> de 34 arquivos + migration `0061`) contra essa stack real.

## 1. Cenário Geral (Bass General Scenario aplicado à Columbia Financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev (Kavex) faz merge de `fix/sispag-data-pagamento` em `main` | push dispara `autoDeploy: true` do Render; migration `0061` (coluna `data_debito`) e novo payload `flpDtaCredito` (data escolhida, não mais `hojeUtc()`) entram no caminho de escrita do fin015 | `RemessaService.gerarRemessa`, `lote_pagamento`, arquivo `.REM` gerado para o banco | Produção, 100% do tráfego, sem cohort de teste — Render Starter não tem canary/blue-green | Deploy sobe sem corromper o schema (migration aditiva/idempotente), sem quebrar remessas em voo, e com um caminho de reversão em ≤5min caso a data de débito calculada esteja errada | `BootMigrator` aplica `0061` uma vez (lock 314159265), `/health` 200 pós-boot, `docs/runbooks/rollback.md` classifica esta migration como "segura" (aditiva, nullable, sem backfill) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| CI: passos automatizados commit→prd (gate) | 6: `npm audit`, `typecheck`, `lint`, `test --coverage`, `build`, `test:sql` (Postgres 17 real) | ≥5 | ✅ | `.github/workflows/ci.yml` |
| Gate de merge protegendo `main` | Render `autoDeploy: true` documentado como dependente de "GitHub branch protection (CI checks required to merge)" | Presente | ✅ | `render.yaml:9-13` |
| Migration `0061` idempotente | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS data_debito DATE` | Idempotente | ✅ | `src/backend/migrations/0061_lote_data_debito.sql` |
| Migration aditiva/reversível sem `DROP` | Nullable, sem backfill, sem `rollbacks/0061_*.sql` (não precisa) | Aditiva | ✅ | mesmo arquivo + `docs/runbooks/rollback.md` tabela §"a regra que decide tudo" |
| Lockfiles commitados (FE+BE) | `src/backend/package-lock.json` (394KB), `src/frontend/package-lock.json` (482KB) | Presentes | ✅ | `ls -la` |
| Rollback documentado, tempo-alvo | `docs/runbooks/rollback.md`, meta explícita "≤5 minutos sem consultar ninguém" | Documentado | ✅ | `docs/runbooks/rollback.md:1-8` |
| Kill-switch específico para o novo comportamento I8 (escolha da data de débito) | Nenhum — só o `SISPAG_LIVE_WRITE_ENABLED` (global ao fin015+fin052) e o `CONEXOS_DRY_RUN` (global a 3 frentes) cobrem esta escrita | Flag dedicada ou aceitar risco documentado | ⚠️ | `grep` em `src/backend/domain/libs/environment/` (0 ocorrências de flag específica) + `render.yaml:34-38` |
| Rollout faseado (canary/blue-green) para mudança no payload de escrita do fin015 | Ausente — `render.yaml plan: starter`, `autoDeploy: true`, 100% do tráfego imediatamente após o health check | Presente ou mitigação documentada | ⚠️ | `render.yaml:6-13` |
| Advisory lock serializando migração entre instâncias | `pg_try_advisory_lock` com 30 tentativas / 2s, `BOOT_MIGRATION_LOCK_KEY=314159265` (namespaced, distinto de outros locks do domínio) | Presente | ✅ | `src/backend/migrations/BootMigrator.ts:14-19,120-146` |
| `npm run typecheck`/`lint`/`test` do delta | exit 0 / exit 0 (73 warnings pré-existentes) / 144 suites (BE) + 48 suites (FE) | Verde | ✅ | `_shared-metrics.md` |
| Bundle size / cold start Lambda | N/A — não é Lambda | N/A | N/A | `CLAUDE.md` §Layout |
| Drift detection (IaC) | N/A — não há Terraform; `render.yaml` usa `sync: false` deliberado para envs sensíveis, evitando a corrida "yaml vs. dashboard" já registrada como P0 num Regis-Review anterior (`deployability-3`, 2026-09-03) | Mitigado por design | ⚠️ (mitigado, não automatizado) | `render.yaml:comentário SISPAG_LIVE_WRITE_ENABLED/CONEXOS_*` |

> ⚠️ **Não medível localmente**: tempo real de build/deploy em produção (Render), tamanho do pool
> de conexões no pico real (o teto do Supavisor não foi lido — ver `DEPLOY.md` §"Teto real: a
> preencher"). Requer acesso ao dashboard Supabase/Render. Fora do escopo `--quick`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Scale Rollouts** (canary/blue-green/rolling) | Ausente na plataforma (Render Starter = instância única, sem canary nativo). Mitigado parcialmente por `dryRun`/`CONEXOS_DRY_RUN` (simula sem escrever) e `SISPAG_LIVE_WRITE_ENABLED` (kill-switch pós-deploy sem redeploy), mas nenhum dos dois faz rollout **gradual** — é tudo-ou-nada | ⚠️ parcial | `render.yaml:6,9`; `RemessaService.ts:203` (`dryRunOverride`) |
| **Rollback** | Runbook dedicado com tabela de decisão migration aditiva-vs-destrutiva, meta de ≤5min, verificação via `/health` e `/health/pipelines`, e regra explícita "código e schema não voltam juntos". A migration `0061` desta feature cai no caso "seguro" da tabela | ✅ presente | `docs/runbooks/rollback.md:1-100` |
| **Script Deployment Commands** | `render.yaml` declara `buildCommand`/`startCommand` versionados; `package.json` scripts (`migrate`, `seed:admin`, `build`) idênticos entre dev/CI/prod via `npm ci` | ✅ presente | `render.yaml:14-15`; `.github/workflows/ci.yml` |
| **Logical Grouping** | Feature flags por "frente" de negócio (`SISPAG_ENABLED`, `RECEBIMENTOS_ENABLED`) e kill-switch por tipo de escrita (`SISPAG_LIVE_WRITE_ENABLED`, `CONEXOS_WRITE_ENABLED`), todos `sync: false` (dashboard como fonte única). A capacidade nova desta feature (escolha de `dataDebito`) **não** tem grupo lógico próprio — herda o guarda-chuva do SISPAG | ⚠️ parcial | `render.yaml:29-53` |
| **Physical Grouping** | N/A — serviço único (`financeiro-backend`) sem topologia física particionável; Vercel/Supabase são plataformas gerenciadas sem decisão de grouping física no controle do time | N/A | justificativa acima |
| **Package Dependencies** | Lockfiles commitados (FE+BE), `npm ci` (não `npm install`) em CI e build, `npm audit --audit-level=high` como gate obrigatório | ✅ presente | `.github/workflows/ci.yml:20-22` |
| **Surge Protection** | `heavyRouteLimiter` nas 4 rotas de remessa tocadas por este delta (incluindo a nova `GET .../remessa/janela` e a `POST .../remessa` modificada); sem autoscaling de plataforma documentado (Render Starter) | ⚠️ parcial | `src/backend/routes/sispag.ts:343,362,461,527` |
| **Idempotent deploys** | `BootMigrator` com advisory lock nomeado e retry (30×2s), migration `0061` com `ADD COLUMN IF NOT EXISTS` — reaplicar o boot é no-op seguro | ✅ presente | `BootMigrator.ts:120-146`; migration `0061` |
| **Drift detection** | Sem job automatizado comparando `render.yaml`/dashboard/schema. Mitigação de design (`sync: false` nas envs sensíveis) reduz a chance, mas não a detecta se ocorrer | ⚠️ parcial | `render.yaml` comentários |
| **Reproducible builds** | Lockfiles presentes, `npm ci`, build determinístico (`tsc`, sem timestamp embutido observado no delta) | ✅ presente | `package-lock.json` (FE+BE); `src/backend/package.json` script `build` |
| **Per-tenant blast-radius limit** | N/A — sistema single-tenant hoje (só Columbia Trading); a arquitetura multi-tenant Terraform é "alvo" e não existe neste repo (`CLAUDE.md` §Tenants: tabela vazia) | N/A | `CLAUDE.md` §Tenants |
| **Deployment observability** | `/health` e `/health/pipelines` usados no próprio runbook de rollback como critério de sucesso; `LogService` estruturado nos novos `resolverDataDebito`/`DebitDateService` (`BUSINESS_WARN` para lote legado, etc.). Sem APM/alerting externo citado nos arquivos revisados | ⚠️ parcial | `docs/runbooks/rollback.md:§3`; `RemessaService.ts` (chamadas a `logService.warn/info`) |

## 4. Findings (achados)

### F-deployability-1: Mudança no payload de escrita do fin015 sobe para 100% do tráfego sem rollout faseado

- **Severidade**: P2
- **Tactic violada**: Scale Rollouts
- **Localização**: `render.yaml:6-13` (plataforma); `src/backend/domain/service/sispag/RemessaService.ts:330-334` (ponto de escrita afetado)
- **Evidência (objetiva)**:
  ```
  # render.yaml
  plan: starter
  branch: main
  autoDeploy: true          # 100% do tráfego assim que o processo passa no health check
  # sem preDeployCommand, sem canary, sem blue-green — deliberado (ver comentário no arquivo)
  ```
  O delta troca a origem de `flpDtaCredito` de `hojeUtc()` (constante, sem input do usuário) para
  `dataDebito` calculada por `BankingCalendar`/`DebitDateService` (194 + 138 linhas novas,
  `EASTER_OFFSETS`/`FIXED_HOLIDAYS` com gap documentado no próprio arquivo: "Fora de escopo (gap
  P1): feriados municipais/estaduais e 31/12" — `BankingCalendar.ts:36`). Um erro nesse cálculo
  afeta a **primeira** remessa gerada após o deploy, não uma amostra.
- **Impacto técnico**: se `BankingCalendar.isBusinessDay`/`holidays` calcular um dia útil errado
  (ex.: feriado estadual não coberto, ou uma futura mudança de calendário como a do 20/11 em 2024),
  a primeira tentativa de gerar remessa após o deploy já usa a data errada — sem cohort prévio para
  pegar o erro antes de 100% do uso.
- **Impacto de negócio**: a proteção existente (`SISPAG_LIVE_WRITE_ENABLED=false`, `CONEXOS_DRY_RUN`,
  e o próprio R1/R2 do ERP recusando `flpDtaCredito` inválido) reduz o risco a "erro visível, não
  corrupção silenciosa" — mas o gate humano é reativo (alguém precisa notar e desligar o switch no
  dashboard do Render), não preventivo.
- **Métrica de baseline**: `render.yaml` confirma `autoDeploy: true` + `plan: starter` (sem
  suporte a canary/blue-green nesse tier) — 0 de 2 tactics de rollout gradual presentes na
  plataforma.

### F-deployability-2: Kill-switch da escrita SISPAG é grosso demais para conter um bug isolado no I8 (data de débito)

- **Severidade**: P3
- **Tactic violada**: Logical Grouping
- **Localização**: `render.yaml:34-38`; ausência de flag em `src/backend/domain/libs/environment/`
- **Evidência (objetiva)**:
  ```
  # render.yaml
  - key: SISPAG_LIVE_WRITE_ENABLED   # cobre fin015 remessa + fin052 conciliação, junto
    sync: false
  - key: CONEXOS_DRY_RUN             # GLOBAL — levaria Permutas e Recebimentos junto
    sync: false
  ```
  `grep -rn "DATA_DEBITO\|DEBIT_DATE\|I8" src/backend/domain/libs/environment/` → 0 ocorrências.
- **Impacto técnico**: se um bug for isolado à escolha da data de débito (I8), a única alavanca sem
  redeploy é desligar `SISPAG_LIVE_WRITE_ENABLED` por inteiro — o que também derruba a conciliação
  de retorno (fin052), uma capacidade não relacionada ao bug.
- **Impacto de negócio**: um incidente pequeno (data de débito errada) vira um blast radius maior
  (conciliação de retorno também pausada) só porque não existe um interruptor no grão certo —
  operação manual extra para quem estiver respondendo ao incidente.
- **Métrica de baseline**: 1 kill-switch cobrindo 2 capacidades distintas (`remessa` + `conciliação`)
  documentado explicitamente no próprio `render.yaml`; 0 flags específicas para I8.

## 5. Cards Kanban

### [deployability-1] Adicionar cohort de validação antes de liberar `dataDebito` escolhida pela analista para todas as filiais

- **Problema**
  > O deploy da escolha de data de débito (ADR-0049/I8) vai para 100% do tráfego de remessa
  > SISPAG assim que o Render termina o health check (`autoDeploy: true`, sem canary — F-deployability-1).
  > `BankingCalendar` já documenta um gap conhecido (feriados municipais/estaduais fora de escopo),
  > então um erro de cálculo afeta a primeira remessa real pós-deploy, não uma amostra controlada.

- **Melhoria Proposta**
  > Tactic alvo: **Scale Rollouts**. Como o Render Starter não tem canary nativo, simular via
  > aplicação: introduzir uma flag temporária (`SISPAG_DEBIT_DATE_MANUAL_REVIEW`, no padrão
  > `sync: false` já usado em `render.yaml`) que, quando ligada, força `dryRunOverride: true` no
  > `RemessaService.gerarRemessa` mesmo com `SISPAG_LIVE_WRITE_ENABLED=true` — permitindo rodar em
  > produção contra dados reais sem escrever, por N remessas de validação, antes de liberar a
  > escrita de verdade. Remover a flag depois do go-live (mesmo padrão do `SISPAG_LIVE_WRITE_ENABLED`
  > original documentado em `DEPLOY.md`).

- **Resultado Esperado**
  > A primeira exposição da lógica de calendário bancário a dados reais de produção acontece em
  > modo simulado (dry-run forçado), não em escrita real. Métrica: 0 → N remessas de validação
  > geradas em dry-run antes da primeira escrita real pós-deploy desta feature.

- **Tactic alvo**: Scale Rollouts
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — reusa o mecanismo `dryRunOverride` já existente
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Remessas em dry-run de validação antes da 1ª escrita real: 0 → ≥3 (cobrindo pelo menos uma janela com fim de semana/feriado)
  - Incidentes de data de débito incorreta pós-go-live: sem baseline (feature nova) → 0
- **Risco de não fazer**: se `BankingCalendar` tiver um erro sutil (ex.: feriado estadual não
  coberto, calculado incorretamente como dia útil), a primeira remessa real já sai com a data
  errada, exigindo cancelamento manual do lote nativo no fin015 (custo operacional documentado em
  `RemessaService.ts` como "a única falha irrecuperável do fluxo" se a marca d'água se perder).
- **Dependências**: nenhuma — usa infraestrutura de flag já existente no `render.yaml`.

### [deployability-2] Separar o kill-switch de escrita do fin015 (remessa) do de conciliação (fin052)

- **Problema**
  > `SISPAG_LIVE_WRITE_ENABLED` cobre duas capacidades não relacionadas (geração de remessa e
  > conciliação de retorno). Um incidente isolado na lógica de data de débito (I8) só pode ser
  > contido desligando as duas — F-deployability-2.

- **Melhoria Proposta**
  > Tactic alvo: **Logical Grouping**. Dividir em `SISPAG_REMESSA_WRITE_ENABLED` e
  > `SISPAG_CONCILIACAO_WRITE_ENABLED` (ou equivalente), cada um lido no ponto de escrita
  > correspondente (`RemessaService`/`ConciliacaoRetornoService`), mantendo o comportamento atual
  > combinado como default até a migração ser validada em produção.

- **Resultado Esperado**
  > Um bug isolado em uma das duas capacidades passa a ser contido sem desligar a outra. Métrica:
  > 1 kill-switch cobrindo 2 capacidades → 2 kill-switches independentes, 1 por capacidade.

- **Tactic alvo**: Logical Grouping
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Capacidades cobertas por um único switch: 2 → 1 (remessa isolada de conciliação)
- **Risco de não fazer**: baixo no curto prazo (mitigado por dry-run e validação R1/R2 do ERP);
  cresce se mais capacidades forem penduradas no mesmo switch ao longo do roadmap das 4 frentes.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo ajustado para a stack real (Render/Vercel/Supabase) — o brief padrão deste QA presume
  Lambda+Terraform, que é o **alvo** documentado em `CLAUDE.md`, não o estado atual do repo.
- Nenhum P0 encontrado no delta: a migration `0061` é aditiva/idempotente/nullable (caso "seguro"
  do próprio runbook de rollback), e todo o novo código usa spreads condicionais (`...(x !==
  undefined ? {} : {})`) que preservam compatibilidade com o formato antigo — reverter o deploy
  desta feature é seguro segundo a própria matriz de decisão de `docs/runbooks/rollback.md`.
  Não verifiquei se o bump de versão (`chore(release)`) e o `CHANGELOG.md` já foram feitos: pela
  ordem do pipeline em `CLAUDE.md`, o Regis-Review roda **antes** do rebase e do bump — sua
  ausência agora não é um achado.
- **Cross-QA**: F-deployability-1 (sem rollout faseado) e a lacuna de cobertura de feriados
  municipais em `BankingCalendar.ts:36` são, na raiz, um achado de **Fault-Tolerance/Testability**
  (correção do cálculo de dia útil) que a Deployability só amplifica ao entregá-lo a 100% do
  tráfego de uma vez — vale o consolidador linkar com o QA de Fault-Tolerance se ele também
  flagrou o gap de feriados estaduais/municipais.
