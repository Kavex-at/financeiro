---
qa: Deployability
qa_slug: deployability
run_id: 2026-09-28-2158-auth-permissoes-modulo
agent: qa-deployability
generated_at: 2026-09-28T21:58:00-03:00
scope: all
score: 7
findings_count: 4
cards_count: 4
---

# Deployability — Regis-Review

> **Nota de escopo.** Este repo roda hoje em **Render (backend Express) + Vercel (frontend
> Next.js) + Supabase (Postgres)**, não em Lambda/Terraform — o CLAUDE.md marca essa arquitetura
> como **(alvo)**, ainda não construída. Toda tactic abaixo foi reancorada na stack real. `--quick`:
> sem `npm audit` profundo; sem carga real do cache de acesso.

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Merge de `feat/auth-permissoes-modulo` em `main` | `git push` aciona `autoDeploy` do Render (build+boot com `BootMigrator`) **e**, de forma independente, o próximo dos 6 crons do GitHub Actions dispara `npm run migrate` contra o mesmo Supabase | Migration `0066_auth_permissoes_modulo.sql` (único `ALTER COLUMN ... SET NOT NULL` das 66 migrations existentes) + backend v0.43.1 (ainda no ar até o deploy do Render terminar) | Produção Columbia: 1 instância Render (`plan: starter`, sem `numInstances`), 15 usuários ativos, banco único Supabase | Migration aplicada de forma idempotente sob advisory lock; login e leituras continuam servidas pela versão antiga do backend; só `POST /usuarios` falha (o INSERT antigo não passa `role_id`, agora `NOT NULL`) | Janela ≤ 15 min (cron mais frequente, `reaper-sispag`, a cada 15 min); 0 usuários existentes perdem acesso; 1 rota degradada; 0 corrupção de dados; reverse documentado e presente (não exercitado em CI) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migrations com `ALTER COLUMN ... SET NOT NULL` sem lock explícito no runbook de rollback | 1 de 66 (`0066`) | 0, ou runbook cobrindo o caso | ⚠️ | `grep -l "SET NOT NULL" src/backend/migrations/*.sql` → só `0066` |
| Janela máxima de corrida "migração antes do backend novo" | ≤ 15 min (cron `reaper-sispag`: `10,25,40,55 * * * *`) | 0 (gatilho único) ou janela alarmada | ⚠️ | `.github/workflows/reaper-sispag.yml:25`; DEPLOY.md §5 "Janela de minutos a conhecer" |
| Workflows do GitHub Actions que rodam `npm run migrate` de forma independente do deploy do Render | 6 (`ingest-permutas`, `ingest-sispag`, `ingest-extratos`, `detect-staleness`, `reaper-sispag`, `reconciliar-nde`) | Coordenados com o deploy, ou migration com gate de compat garantido | ⚠️ | `grep -l "npm run migrate" .github/workflows/*.yml` |
| Cobertura de rotas autenticadas com exatamente 1 guard | 85/85 (100%), 346 casos comportamentais por linha | 100% | ✅ | `_shared-metrics.md`; `src/backend/http/routePermissions.test.ts` (434 linhas) |
| Validação de execução real da migration + reverse (from-zero, guarda, reaplicação) | 1x manual, Postgres 16 descartável | Repetível em CI a cada PR que toque `migrations/` | ⚠️ | `_shared-metrics.md` "Validação ao vivo"; docstring de `0066_auth_permissoes_modulo.test.ts` |
| Rollback SQL exercitado por CI (`test:sql`) | 0 — regex só pega `migrations/.*\.integration\.test\.ts`, não `rollbacks/*.sql` | ≥ 1 (aplicar o reverse contra Postgres efêmero) | ❌ | `src/backend/package.json:24`; `src/backend/migrations/rollbacks.test.ts` (só checa nome/política) |
| Instâncias web em produção | 1 (`render.yaml`: `plan: starter`, sem `numInstances`) | Invariante testada/alertada caso suba | ⚠️ | `render.yaml`; `AccessService.ts:30-31` (comentário do próprio autor) |
| Passos automatizados commit → prod (sem Terraform, adaptado) | `npm ci`, `npm audit`, `typecheck`, `lint`, `test --coverage`, `build`, `test:sql` (Postgres real), auto-deploy Render, boot migrate | ≥ 5 gates | ✅ | `.github/workflows/ci.yml` |
| Ordem de deploy FE/BE exigida | Indiferente por desenho (fallback legado D4 no front) | Indiferente, documentado | ✅ | DEPLOY.md §5; `src/frontend/lib/permissoes.ts:44-49` (`legado: boolean`) |
| Advisory lock serializando aplicação de migração entre boot e crons concorrentes | Presente (`pg_advisory_xact_lock`, chave `271828182`) | Presente | ✅ | `src/backend/migrations/runMigrations.ts:11-21,159-169` |

> ⚠️ **Não medível localmente**: tempo real de build/boot do Render vs. horário de disparo de um cron específico (dependeria de produção real). Recomendação: instrumentar o log de boot (`[boot-migrate] aplicada(s) N: ...`) com timestamp e cruzar com os logs dos 6 workflows por uma semana após o merge, para medir a janela real (hoje só o limite teórico de 15 min é conhecido).
> ⚠️ **Não medível localmente**: Terraform/infra — não existe `infra/` neste repositório (CLAUDE.md confirma: estado-alvo, não construído).

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Scale Rollouts** (canary, blue/green, rolling) | Render faz cutover direto (`autoDeploy: true`), 1 instância; sem canary nem blue/green. Mitigado por design de compat (D2/D3/D4 da ADR) que torna a ordem de deploy "indiferente", não por rollout gradual | ❌ ausente (mitigado por compat, não por rollout) | `render.yaml` (sem `numInstances`, sem staged rollout); ADR-0053 §D12 |
| **Rollback** | Render "Rollback to this deploy" (código, 1 clique) + reverse SQL manual (`migrations/rollbacks/0066...sql`), com **política testada**: `rollbacks.test.ts` exige reverse para migration com `UPDATE`/`NOT NULL` de risco | ✅ presente (parcial: reverse não é exercitado em CI, só a presença/nome — ver F-deployability-4) | `docs/runbooks/rollback.md`; `src/backend/migrations/rollbacks.test.ts:36-52`; `migrations/rollbacks/0066_auth_permissoes_modulo.rollback.sql` |
| **Script Deployment Commands** | `buildCommand`/`startCommand` no `render.yaml`; CI 100% scriptado (`ci.yml`); migração aplicada por script idempotente com advisory lock. Mas **dois scripts de migração independentes** (BootMigrator no boot do Render; `npm run migrate` em 6 crons do GH Actions) não são coordenados entre si — cada um "ganha a corrida" por acaso | ⚠️ parcial | `.github/workflows/ci.yml`; `render.yaml`; `src/backend/migrations/BootMigrator.ts:30-36` (docstring já descarta um 7º job de migração por push, mas os 6 crons pré-existentes não foram revisitados) |
| **Logical Grouping** | Rotas agrupadas por módulo/frente (`/permutas`, `/sispag`, `/recebimentos`, `/usuarios`, `/operacao`, `/metricas`) com 1 guard único por rota, testado por introspecção — reduz risco de "esqueci de proteger uma rota nova" a cada deploy | ✅ presente | `src/backend/http/routePermissions.test.ts`; ADR-0053 tabela de mapeamento (85 rotas) |
| **Physical Grouping** | N/A — não há múltiplas contas/regiões físicas; 1 backend (Render), 1 frontend (Vercel), 1 banco (Supabase), single-tenant Columbia. CLAUDE.md confirma: multi-tenant AWS é estado-alvo, não construído | N/A — sem infra multi-conta hoje | CLAUDE.md "Infra/Deploy: Render... sem infra/Terraform" |
| **Package Dependencies** | `package-lock.json` commitado (backend e frontend), `npm ci` em CI e no `buildCommand` do Render (instala exatamente o que o lock define) | ✅ presente | `.github/workflows/ci.yml` (`cache-dependency-path: src/backend/package-lock.json`); `render.yaml: buildCommand: npm ci && npm run build` |
| **Surge Protection** | Parcial: `AccessService` cacheia acesso por 30s por processo, reduzindo 1 SELECT/requisição a 1 SELECT/30s por usuário (proteção de carga no Postgres); budget de sessões do pooler documentado em `DEPLOY.md`. Mas não há rate limiting HTTP nem autoscaling — 1 instância fixa | ⚠️ parcial | `src/backend/domain/service/auth/AccessService.ts:42` (`CACHE_TTL_MS`); `DEPLOY.md` §1 "Budget de sessões do pooler" |
| **Idempotent deploys** | Migration 0066 idempotente (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`), verificado ao vivo (from-zero + reaplicação); `seed:admin` é UPSERT idempotente; advisory lock serializa aplicações concorrentes | ✅ presente | `0066_auth_permissoes_modulo.sql` (comentário "Idempotente"); `_shared-metrics.md`; `seed-admin.ts:19` |
| **Drift detection** | Ausente para schema (nada roda `terraform plan`-like para o banco fora do boot); N/A para infra (não existe Terraform) | ❌ ausente / N/A infra | busca por "drift" no repo: nenhum resultado |
| **Reproducible builds** | `package-lock.json` commitado; `npm ci` (não `npm install`) em CI e build; `tsc` determinístico; passo dedicado (`copy-to-dist.ts`) testado (`MigrationFiles.test.ts`) para garantir que `.sql` chega ao `dist/` | ✅ presente | `.github/workflows/ci.yml`; `render.yaml`; `src/backend/migrations/MigrationFiles.test.ts` |
| **Per-tenant blast-radius limit** | N/A — Columbia é o único cliente hoje, monolito single-tenant; CLAUDE.md tabela "Tenants" está vazia | N/A — sem multi-tenant ainda | CLAUDE.md §Tenants (vazia) |
| **Deployment observability** | Log de boot expõe `[boot-migrate] aplicada(s) N: <nome>.sql`; `/health` e `/health/pipelines` como sondas; trilha `app_user_access_event` audita mudanças de acesso pós-deploy. Não há alerta automático se o log de boot divergir do esperado (só inspeção manual do operador, conforme `DEPLOY.md`) | ⚠️ parcial | `DEPLOY.md` §2 "Como conferir um deploy com migração nova"; `docs/runbooks/rollback.md` §3 |

## 4. Findings (achados)

### F-deployability-1: Migração `0066` é a primeira a adicionar coluna `NOT NULL` sem coordenar os dois gatilhos de `npm run migrate`

- **Severidade**: P1
- **Tactic violada**: Script Deployment Commands (sincronização entre pipelines)
- **Localização**: `src/backend/migrations/0066_auth_permissoes_modulo.sql:111-117` (`ALTER TABLE app_user ADD COLUMN role_id...`; `ALTER COLUMN role_id SET NOT NULL`); `.github/workflows/reaper-sispag.yml:25`; `.github/workflows/{ingest-permutas,ingest-sispag,ingest-extratos,detect-staleness,reconciliar-nde}.yml`
- **Evidência (objetiva)**:
  ```
  $ grep -l "SET NOT NULL" src/backend/migrations/*.sql
  src/backend/migrations/0066_auth_permissoes_modulo.sql   # única, de 66 migrations

  $ grep -n "cron:" .github/workflows/*.yml
  reaper-sispag.yml:      - cron: '10,25,40,55 * * * *'   # a cada 15 min
  ingest-extratos.yml:    - cron: '20 * * * *'
  reconciliar-nde.yml:    - cron: '35 * * * *'
  detect-staleness.yml:   - cron: '45 * * * *'
  ingest-sispag.yml:      - cron: '0 10 * * *'
  ```
  Todos os 6 workflows rodam `npm run migrate` (via `tsx`, lendo a árvore-fonte de `main`) **antes** de seu job de negócio, sem qualquer coordenação com o `autoDeploy` do Render. A própria docstring do `BootMigrator` (linhas 30-36) já registra que um 7º job de migração-no-push foi descartado por perder a corrida contra o build do Render — mas os 6 crons pré-existentes, que rodam por agenda e não por push, não foram revisitados à luz dessa mesma corrida.
- **Impacto técnico**: no pior caso (merge poucos minutos antes de `:10/:25/:40/:55`), a `0066` é aplicada em produção com o backend v0.43.1 ainda no ar. `role_id` fica `NOT NULL`; o `INSERT` do `POST /usuarios` da v0.43.1 não o define → toda tentativa de criar usuário nessa janela recebe 500. A própria ADR-0053 (§D12) já documenta essa janela como aceitável ("são minutos, e só criar usuário é afetado").
- **Impacto de negócio**: se um operador da Columbia tentar cadastrar um usuário novo exatamente nessa janela (até 15 min após o merge), recebe erro sem explicação, sem ligação óbvia com um deploy — potencial ticket de suporte e desconfiança na tela de Usuários, mesmo sendo um evento raro e transitório.
- **Métrica de baseline**: 1 de 66 migrations usa `SET NOT NULL` (0%→1.5% do histórico); janela teórica máxima de exposição = 15 min (intervalo do cron mais frequente).

### F-deployability-2: O runbook de rollback rápido classifica "migration aditiva" como categoricamente segura, mas `0066` é aditiva-com-`NOT NULL` e quebra escrita do código antigo

- **Severidade**: P2
- **Tactic violada**: Rollback (qualidade da decisão em runbook operacional)
- **Localização**: `docs/runbooks/rollback.md:20-26` (tabela "A regra que decide tudo")
- **Evidência (objetiva)**:
  ```
  | Deploy com migration aditiva (coluna/tabela nova, índice) | seguro | A versão anterior
  simplesmente ignora o que não conhece. |
  ```
  Essa afirmação é falsa para `0066`: a versão anterior (v0.43.1) **não ignora** a coluna nova —
  o `INSERT INTO app_user (...)` dela não inclui `role_id`, que passou a ser `NOT NULL` sem
  `DEFAULT`. `ADR-0053 §D12` documenta exatamente essa exceção ("o INSERT antigo não passa
  `role_id`, que agora é obrigatório"), mas essa nuance não está na tabela de decisão de 5 minutos
  que um operador usaria sob pressão, e o runbook genérico não referencia o caso.
- **Impacto técnico**: um operador seguindo só `rollback.md` (o documento explicitamente desenhado
  para decidir em ≤ 5 min sem consultar ninguém) classificaria `0066` como "seguro reverter só o
  código", reverteria o backend para v0.43.1 e deixaria o schema como está — o que é o comportamento
  correto por acaso (D12 já concorda com isso), mas por um raciocínio que o próprio runbook não
  sustenta corretamente para esta classe de migration.
- **Impacto de negócio**: baixo hoje (o resultado prático coincide com o correto), mas o gap de
  raciocínio se generaliza: a próxima migration que adicionar `NOT NULL` consumida por um caminho de
  escrita mais crítico (ex.: baixa de permuta, remessa SISPAG) seria classificada pelo mesmo runbook
  como "seguro", quando pode não ser.
- **Métrica de baseline**: 1 exceção real (`0066`) não coberta por uma tabela de decisão com 3 categorias fixas (aditiva / destrutiva / nenhuma); 0 linhas do runbook mencionam "coluna NOT NULL sem default".

### F-deployability-3: A invariante "1 instância" de que `AccessService` depende não é testada nem imposta pelo pipeline de deploy

- **Severidade**: P2
- **Tactic violada**: Surge Protection / Physical Grouping (coordenação de estado replicado)
- **Localização**: `src/backend/domain/service/auth/AccessService.ts:30-36`; `render.yaml` (ausência de `numInstances`)
- **Evidência (objetiva)**:
  ```
  * ... Hoje há UMA instância web (`plan: starter`); se
  * `numInstances` subir, a invalidação não alcança as outras e o pior caso vira os 30 s.
  ```
  Não há teste, `ConfigDoctor` ou gate de CI/CD que falhe caso `render.yaml` (ou o dashboard) passe
  a declarar mais de uma instância. A garantia "ninguém fica com acesso revogado por mais de 30s" (D5
  da ADR) depende inteiramente de uma decisão operacional futura ser lembrada e revisitada.
- **Impacto técnico**: se alguém subir `numInstances` no dashboard do Render (fora deste PR, sem
  tocar `render.yaml` nem código) para lidar com carga, a invalidação de cache feita por
  `invalidar(userId)` some silenciosamente do lado das instâncias irmãs; usuário desativado ou com
  permissão revogada continua ativo em requisições atendidas por outra instância por até 30s — sem
  qualquer sinal de erro, alerta ou teste vermelho.
- **Impacto de negócio**: janela de acesso indevido pós-desligamento de funcionário, em um domínio
  financeiro (SISPAG, Permutas) — exatamente o cenário que a ADR-0053 foi desenhada para fechar (a
  lacuna de 12h da ADR-0051). O código documenta o risco, mas não o defende.
- **Métrica de baseline**: 1 comentário de aviso (fonte da verdade), 0 testes/alertas que o cubram; `render.yaml` hoje não declara `numInstances` (implícito = 1).

### F-deployability-4: Reverse da `0066` (e de toda a política de rollback) não é exercitado em CI — só verificado uma vez, manualmente

- **Severidade**: P2
- **Tactic violada**: Rollback (verificação contínua, não pontual)
- **Localização**: `src/backend/package.json:24` (`test:sql`); `src/backend/migrations/rollbacks.test.ts:36-58`; `src/backend/migrations/0066_auth_permissoes_modulo.test.ts:1-11`
- **Evidência (objetiva)**:
  ```
  "test:sql": "jest migrations/.*\\.integration\\.test\\.ts --testPathIgnorePatterns /node_modules/"
  ```
  `rollbacks/0066_auth_permissoes_modulo.rollback.sql` não termina em `.integration.test.ts` nem é
  chamado por nenhum teste — `rollbacks.test.ts` só confere que o arquivo **existe com o nome certo**
  (política), nunca que ele **executa sem erro** contra um Postgres real. A própria docstring do
  teste da migration admite isso: "A execução real (do zero, duas vezes, guarda e reverse) foi feita
  num Postgres 16 descartável" — manual, fora do CI, uma vez, neste ciclo.
- **Impacto técnico**: uma mudança futura e não relacionada (ex.: renomear `app_user.id`, adicionar
  `ON DELETE` diferente em outra tabela referenciando `app_role`) pode quebrar silenciosamente o
  reverse de `0066` sem que nenhum job de CI acuse — o vermelho só apareceria na hora real de um
  incidente, quando o reverse for de fato necessário.
- **Impacto de negócio**: o runbook de rollback promete "reverter em ≤ 5 minutos sem consultar
  ninguém"; um reverse SQL que falha no meio de um incidente real quebra exatamente essa promessa,
  e o operador descobre a quebra no pior momento possível.
- **Métrica de baseline**: 0 execuções automatizadas do reverse em CI; 4 arquivos de reverse existentes no repo (`0054`, `0055`, `0063`, `0066`), 0 cobertos por `test:sql`.

## 5. Cards Kanban

### [deployability-1] Blindar migrações `NOT NULL` contra a corrida entre o boot do Render e os crons do GitHub Actions

- **Problema**
  > A `0066` é a primeira das 66 migrations a fazer `ALTER COLUMN ... SET NOT NULL`, e os 6 crons do GitHub Actions rodam `npm run migrate` de forma independente do `autoDeploy` do Render (janela de até 15 min, cadência do `reaper-sispag`). Nesse intervalo, `POST /usuarios` do backend antigo falha com 500.

- **Melhoria Proposta**
  > Aplicar a tactic **Script Deployment Commands** de ponta a ponta: ou (a) os 6 workflows param de rodar `npm run migrate` por conta própria e passam a checar se a migração já foi aplicada pelo Render antes de prosseguir (poll em `schema_migrations` com timeout curto), ou (b) toda migration que adiciona `NOT NULL` sem `DEFAULT` ganha uma checklist de PR obrigatória (`PatternGuardian`) que force o autor a decidir explicitamente a estratégia de compat com o backend anterior — como já foi feito manualmente para a `0066` (D12), mas de forma repetível.

- **Resultado Esperado**
  > Janela de exposição documentada e testada, não apenas descrita em prosa na ADR. Métrica: 15 min (hoje, teórico) → 0 min (sincronizado) ou continua ≤15 min mas com teste de regressão que force a decisão consciente na próxima migration `NOT NULL`.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P1
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Migrations `NOT NULL` com decisão de compat documentada e testada: 1/1 (hoje, só por ADR em prosa) → 1/1 com gate automatizado
  - Workflows de cron cientes do estado do deploy: 0/6 → 6/6 (ou justificativa formal de por que não é necessário)
- **Risco de não fazer**: a próxima migration `NOT NULL` (ex.: recorte por filial, passo 3 da auth) repete a mesma corrida sem ninguém lembrar de revisitar manualmente, e dessa vez pode atingir uma rota mais crítica que criação de usuário.
- **Dependências**: nenhuma.

### [deployability-2] Corrigir a tabela de decisão do runbook de rollback para o caso "coluna NOT NULL sem default"

- **Problema**
  > `docs/runbooks/rollback.md` classifica toda "migration aditiva" como segura para reverter só o código, mas isso é falso quando a coluna nova é `NOT NULL` e consumida por um `INSERT` do código antigo — exatamente o caso de `0066` (documentado só na ADR-0053, não no runbook de incidente).

- **Melhoria Proposta**
  > Acrescentar uma 4ª linha à tabela de decisão (`rollback.md`): "migration aditiva com coluna `NOT NULL` sem `DEFAULT`" → "depende: reverter código é seguro só se nenhum caminho de escrita do código anterior grava a tabela afetada; confira `DEPLOY.md`/ADR da migration". Referenciar a seção 5 do `DEPLOY.md` como exemplo resolvido.

- **Resultado Esperado**
  > Runbook usado sob pressão deixa de ter uma afirmação genérica incorreta. Métrica: 3 categorias na tabela de decisão → 4, cobrindo o caso real já vivido neste ciclo.

- **Tactic alvo**: Rollback
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Categorias de migration cobertas pela tabela de decisão do runbook: 3 → 4
- **Risco de não fazer**: a próxima migration `NOT NULL` que afete um caminho de escrita mais crítico (SISPAG, Permutas) é classificada erroneamente como "seguro reverter só o código" por quem só consulta o runbook rápido.
- **Dependências**: nenhuma (documentação pura).

### [deployability-3] Tornar a invariante "1 instância web" testável ou alertável, não só comentada

- **Problema**
  > `AccessService` depende de haver exatamente uma instância do backend para que a invalidação de cache em memória (30s TTL) valha; hoje isso só existe como comentário no código (`AccessService.ts:30-31`), sem teste, `ConfigDoctor` ou alerta que dispare se alguém ligar `numInstances > 1` no Render.

- **Melhoria Proposta**
  > Adicionar uma checagem de boot (mesmo padrão do `ConfigDoctor` citado no CLAUDE.md) que leia uma env exposta pelo Render (`RENDER_INSTANCE_ID`/contagem, se disponível) ou, na ausência de sinal confiável, documentar explicitamente em `DEPLOY.md` como um item do checklist de "antes de escalar horizontalmente" com link direto para `AccessService.ts`. Alternativa mais forte: mover a invalidação para um canal compartilhado (ex.: `LISTEN/NOTIFY` do Postgres, já disponível) antes de qualquer aumento de `numInstances`.

- **Resultado Esperado**
  > A dependência de instância única deixa de ser tribal knowledge em comentário e vira algo verificável. Métrica: 0 alertas/testes hoje → ≥1 mecanismo (teste, `ConfigDoctor` ou item de checklist rastreável) antes de qualquer mudança de `numInstances`.

- **Tactic alvo**: Surge Protection / Physical Grouping
- **Severidade**: P2
- **Esforço estimado**: M (2-5d) para `LISTEN/NOTIFY`; S (≤1d) para o item de checklist
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Mecanismo de defesa da invariante "1 instância": 0 → 1
- **Risco de não fazer**: se a Columbia crescer e alguém escalar o Render para lidar com carga sem revisitar esta ADR, usuários desativados mantêm acesso por até 30s em instâncias que não receberam a invalidação — numa área financeira, essa é exatamente a lacuna que a ADR-0053 foi criada para fechar.
- **Dependências**: nenhuma para o checklist; avaliação de custo do Supavisor (budget de sessões, `DEPLOY.md` §1) para `LISTEN/NOTIFY`.

### [deployability-4] Exercitar o reverse da `0066` (e dos demais rollbacks) em CI, contra Postgres real

- **Problema**
  > O `test:sql` do CI (`backend-sql`, Postgres 17 real) só roda `migrations/.*\.integration\.test\.ts`; os 4 scripts em `migrations/rollbacks/*.rollback.sql` (incluindo `0066`) nunca são executados automaticamente — só a existência e o nome do arquivo são verificados (`rollbacks.test.ts`). A validação de execução real foi manual, uma vez, neste ciclo.

- **Melhoria Proposta**
  > Acrescentar ao job `backend-sql` do `ci.yml` um passo que, para cada par migration+reverse listado em `rollbacks.test.ts`, aplique as migrations do zero, aplique o reverse do alvo e confirme que o schema resultante bate com o esperado (equivalente ao que já foi feito manualmente e está descrito em `_shared-metrics.md`). Não precisa ser um `.integration.test.ts` novo por migration — um script único que itere `readdirSync(ROLLBACKS_DIR)` resolve para os 4 casos atuais e os futuros.

- **Resultado Esperado**
  > Rollback deixa de ser "documentado e testado uma vez" para "testado a cada PR que toque `migrations/`". Métrica: 0/4 reverses exercitados em CI → 4/4.

- **Tactic alvo**: Rollback
- **Severidade**: P2
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Reverses cobertos por execução automatizada em CI: 0/4 → 4/4
- **Risco de não fazer**: uma mudança futura não relacionada quebra silenciosamente o reverse de `0066` (ou de `0054`/`0055`/`0063`), e isso só é descoberto durante um incidente real, quebrando a promessa de "reverter em ≤5 min" do runbook.
- **Dependências**: nenhuma; reaproveita a infraestrutura já existente do job `backend-sql` (Postgres 17 em serviço do CI).

## 6. Notas do agente

- Escopo interpretado como a stack **real** do repo (Render/Vercel/Supabase/GH Actions), não a arquitetura-alvo (Lambda/Terraform) descrita genericamente no briefing da missão — CLAUDE.md é explícito que essa última ainda não existe aqui; tactics de infra multi-tenant/AWS foram marcadas N/A com justificativa.
- **Cross-QA para o consolidator**: F-deployability-3 (cache single-instance) tem leitura dupla em **Availability** (janela de 30s de acesso indevido pós-desativação) e nasce diretamente de uma decisão de **Modifiability/arquitetura** (cache em processo vs. distribuído, ADR-0053 "Alternativas consideradas"). F-deployability-1 também é relevante para **Testability**: a corrida entre crons e deploy não tem nenhum teste automatizado que a reproduza, só a narrativa da ADR.
- Não foi possível medir a janela real de corrida em produção (item "Não medível" na seção 2); a métrica usada é o limite teórico do cron mais frequente, não uma observação de campo.
