---
qa: Testability
qa_slug: testability
run_id: 2026-09-28-1550
agent: qa-testability
generated_at: 2026-09-28T15:50:00-03:00
scope: backend+frontend (delta `auth-email-transicao` vs `origin/main`)
score: 8.5
findings_count: 5
cards_count: 4
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev do próximo `/feature-tweak` (passo 2/3 do ADR-0051, quando `sub` do JWT deixar de ser `username`) | Altera a regra de unicidade e-mail/username, ou a guarda de desativação do último admin (R11), sem perceber que o SQL depende de serialização por `FOR UPDATE` | `UserRepository.deactivateGuarded` / `setEmail` / `create` (índices `lower()`, transação) | Pré-merge, CI, sem tocar produção | O gate de testes deve pegar a quebra ANTES do merge — inclusive a race de dois admins se desativando ao mesmo tempo, que uma unit test com mock não consegue provar | Regressão pega em CI com Postgres descartável, 0 incidentes tipo "zerou os admins ativos" chegando a produção; hoje essa prova só existe como gate manual (20/20, ad hoc, não versionado) |

## 2. Métricas observadas

**Métrica #1 — Tabela de cobertura por camada (delta desta feature)**

`--quick`: sem instrumentação de `--coverage` (já declarado não medível em `_shared-metrics.md`). A tabela abaixo usa presença de teste dedicado por arquivo/camada — medível sem rodar a suíte completa — como proxy defensável.

| Camada | Arquivos de fonte tocados | Arquivo de teste dedicado | Ratio | Observação |
|---|---|---|---|---|
| `domain/service/auth` | `AuthService.ts`, `UserAdminService.ts` | `AuthService.test.ts` (novo), `UserAdminService.test.ts` | 2/2 = 100% | Todo método público com `describe` próprio |
| `domain/repository/auth` | `UserRepository.ts` | `UserRepository.test.ts` | 1/1 = 100% | 11 métodos públicos, todos exercitados; guarda `deactivateGuarded` com 5 casos (deadlock de ordem, self, last-admin, operador, id inexistente) |
| `routes` (camada handler) | `routes/auth.ts`, `routes/usuarios.ts` | `routes/auth.test.ts` (novo), `routes/usuarios.test.ts` (novo) | 2/2 = 100% | HTTP real (`app.listen(0)` + `fetch`), não `supertest` simulado |
| `jobs` | `seed-admin.ts`, `SeedAdminConfig.ts` | `SeedAdminConfig.test.ts` (novo); `seed-admin.ts` sem teste direto | 1/2 = 50% | Ver F-testability-2 — entrypoint fino, aceitável, mas com gap pontual |
| `migrations` | `0064_app_user_email.sql` | `0064_app_user_email.test.ts` (novo) | 1/1 = 100% | Asserção sobre o SQL-fonte (padrão `rollbacks.test.ts` do repo) |
| `libs/environment` | `EnvironmentProvider.ts`, `EnvironmentVars.ts` | `EnvironmentProvider.test.ts` (estendido) | 1/1 = 100% | Cobre os dois caminhos (local `.env` e SSM/Lambda) |
| `frontend` (login + usuários) | 7 arquivos (`login/page.tsx`, `TransicaoEmailBanner.tsx`, `usuarios/page.tsx`, `EditarEmailDialog.tsx`, `NovoUsuarioDialog.tsx`, `lib/auth/transicao.ts`, `lib/usuarios.ts`) | 4 arquivos de teste (`login-page`, `transicao`, `usuarios-api`, `usuarios-page`) | 4/7 arquivos, mas 7/7 em cobertura comportamental (dialogs exercitados via composição dentro de `usuarios-page.test.tsx`, confirmado por `grep` nas linhas 108/158) | Sem `describe` 1:1 por arquivo, mas sem lacuna de comportamento |

Nenhuma camada tocada pelo delta ficou sem teste dedicado — o padrão do time ("um `.test.ts` por arquivo de lógica") foi seguido de ponta a ponta nesta feature.

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Ratio arquivo-fonte / arquivo-teste (delta) | 19 fonte / 13 teste, ~100% de cobertura por arquivo de lógica (excl. `.env.example`, SQL de migração já contado à parte) | ≥ 0.5 | ✅ | `git diff --name-status origin/main...HEAD` |
| `describe('integration: ...')` no repo inteiro | 0 | ≥1 por repositório com SQL complexo | ❌ | `grep -rn "describe(.integration" src/backend --include="*.test.ts"` |
| Script/harness de Postgres descartável versionado no repo | 0 (`docker-compose*`, `scripts/*test-db*` ausentes) | 1 | ❌ | `find . -iname "*docker-compose*"`; `ls src/backend/scripts` (inexistente) |
| Testes construindo o SUT com injeção de mock via construtor (`new XService(mock, ...)`) nos arquivos do delta | 6/6 arquivos de service/repository | alto | ✅ | Leitura de `AuthService.test.ts`, `UserAdminService.test.ts`, `UserRepository.test.ts` |
| `container.resolve` mockado nos testes do delta | 2 (`routes/auth.test.ts`, `routes/usuarios.test.ts`) — só para religar o service real com repo/env falsos no fio HTTP da rota, não para resolver o SUT em si | uso mínimo, justificado | ✅ | `grep -c "container.resolve" <arquivo>` |
| Sites de não-determinismo (`Date.now`/`new Date()`/`Math.random`) no CÓDIGO-FONTE do delta (backend + frontend tocados) | 0 | 0 | ✅ | `grep -rn "Date.now\|new Date()\|Math.random" <arquivos do delta>` (único hit é `AuthProvider.tsx`, fora do delta) |
| Maior arquivo de teste do delta | `UserRepository.test.ts`, 463 LOC | < 500 LOC | ⚠️ (perto do limite) | `wc -l` |
| `coverageThreshold` backend (`src/backend/jest.config.cjs`) | lines 72 / branches 54 / functions 78 | 80/70/80 em `domain/service` e `domain/repository` | ⚠️ (piso global, não por diretório) | `src/backend/jest.config.cjs` |
| `coverageThreshold` frontend (`src/frontend/jest.config.js`) | lines 33 / branches 23 / functions 28 | 80/70/80 em `features/`+`ui/` | ❌ (PRÉ-EXISTENTE, repo inteiro) | `src/frontend/jest.config.js` |
| Gate de teste bloqueando PR em CI | `npm test -- --coverage` em `.github/workflows/ci.yml:27,80` | presente, bloqueante | ✅ | `.github/workflows/ci.yml` |
| Uso de `fast-check`/PBT nos testes do delta | 0 | ≥1 nos boundaries de normalização (Zod + e-mail) | ⚠️ | `grep -rln "fast-check\|fc\." src/frontend/__tests__` (vazio) — também vazio no backend do delta |
| `TDDGuide` em `.claude/agents/` | ausente (só `pattern-guardian.md`) | presente, conforme CLAUDE.md | ❌ (PRÉ-EXISTENTE) | `find .claude/agents -iname "*tdd*"` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `SeedAdminConfig` extraída explicitamente do `seed-admin.ts` "para ser testável sem rodar o job (que conecta no banco no import)"; resultados tipados (`SET_EMAIL_RESULT`, `DEACTIVATE_RESULT`) em vez de booleanos ambíguos, dando ao teste um alvo de asserção exato | ✅ presente | `src/backend/jobs/SeedAdminConfig.ts:1-40`; `src/backend/domain/repository/auth/UserRepository.ts:40-52` |
| Recordable Test Cases | Feature não chama Conexos/Nexxera/GED (declarado em `_shared-metrics.md`) — não há chamada externa para gravar | N/A | Escopo do delta não inclui client externo |
| Sandbox | Gate manual desta rodada rodou 65 migrações + 20/20 casos contra um Postgres 16 descartável (ver `_shared-metrics.md`), mas isso NÃO existe como script/harness versionado no repo — é um procedimento ad hoc do ciclo, não reproduzível por outro dev sem reconstruir os passos | ⚠️ parcial | `_shared-metrics.md` ("Migrations ao vivo… Repositório ao vivo… 20/20"); ausência confirmada de `docker-compose*` / `src/backend/scripts/*test-db*` |
| Executable Assertions | Asserções muito específicas: SQL literal (`toContain`), forma exata de resposta HTTP (`toEqual({ ativo: true })`, nunca `toMatchObject` quando a forma completa importa), ordem de chamadas (`invocationCallOrder`), ausência de campo (`not.toHaveProperty('email')`), ausência de segredo no log (`JSON.stringify(params)).not.toContain(SENHA)`) | ✅ presente, forte | `UserRepository.test.ts:376-390`; `AuthService.test.ts:88-94`; `routes/auth.test.ts:121,128` |
| Abstract Data Sources | `PostgreeDatabaseClient` sempre injetado (nunca `pg` cru); `EnvironmentProvider` sempre injetado (nunca `process.env` cru) — os dois seams tornam `UserRepository` e `AuthService` 100% mockáveis sem tocar rede | ✅ presente | `UserRepository.ts:109-114`; `AuthService.ts:46-54` |
| Limit Structural Complexity | Services e repository mantêm um método por invariante, com docstring citando a regra (R11, I3, I5); `UserRepository.test.ts` cresceu para 463 LOC acumulando 5 responsabilidades (lookup de login, e-mail+unicidade, guarda de desativação+transação, vínculo Conexos, upsert de admin) — ainda organizado por `describe`, mas é o maior arquivo de teste do delta e o mais próximo do limiar de 500 LOC | ⚠️ parcial (ver F-testability-5) | `wc -l src/backend/domain/repository/auth/UserRepository.test.ts` → 463 |
| Limit Non-Determinism | Zero `Date.now`/`new Date()`/`Math.random` no código-fonte tocado pelo delta; custo de bcrypt reduzido para 4 rounds só no teste (`beforeAll`, comentário explícito "o que se testa é o fluxo, não o bcrypt") evitando testes lentos/flaky | ✅ presente | `AuthService.test.ts:15-18`; `grep -rn "Date.now\|new Date()\|Math.random"` sem hits no delta |

## 4. Findings (achados)

### F-testability-1: guarda de concorrência de `deactivateGuarded` só provada por gate manual, não por teste versionado

- **Severidade**: P1
- **Tactic violada**: Sandbox
- **Localização**: `src/backend/domain/repository/auth/UserRepository.ts:280-312` (guarda R11, `FOR UPDATE`); ausência em `src/backend/domain/repository/auth/UserRepository.test.ts`
- **Evidência (objetiva)**:
  ```
  # repo inteiro:
  grep -rn "describe(.integration" src/backend --include="*.test.ts"   → 0 hits
  find . -iname "*docker-compose*"                                     → (vazio)
  ls src/backend/scripts                                               → inexistente

  # _shared-metrics.md (gate desta rodada, não versionado como código):
  "Migrations ao vivo (Postgres 16 descartável, nunca prod) ✅ 65 aplicadas do zero; 0064
   idempotente; guarda aborta com duplicata de caixa"
  "Repositório ao vivo (mesmo Postgres descartável) ✅ 20/20: colisões cruzadas 409, índices
   lower() 23505, no-op do mesmo e-mail, corrida de dois admins (1 passa, 1 recusa, resta 1 ativo)"
  ```
- **Impacto técnico**: os testes unitários de `deactivateGuarded` (5 casos, ótimos) provam que o SQL certo é emitido e na ordem certa contra um mock — mas um mock não pode provar que `FOR UPDATE` de fato serializa duas transações concorrentes no Postgres real. Essa prova aconteceu manualmente nesta rodada (20/20) e não fica no repositório: o próximo dev que tocar `deactivateGuarded` (ex.: passo 2/3 do ADR-0051) não tem como re-rodar essa verificação sem reconstruir o procedimento do zero.
- **Impacto de negócio**: R11 existe para impedir que a plataforma fique sem nenhum admin ativo — um cenário de auto-bloqueio total (nenhum usuário consegue gerenciar usuários). Se uma mudança futura afrouxar a serialização sem que ninguém perceba (porque o mock ainda passa), o incidente só aparece em produção, sob concorrência real.
- **Métrica de baseline**: 0 arquivos `describe('integration: ...')` no repo; 0 scripts de Postgres descartável versionados; a única evidência de que a race foi provada é uma linha de texto em `_shared-metrics.md` desta rodada, não reproduzível por `npm test`.

### F-testability-2: `seed-admin.ts` sem teste direto dos caminhos de saída (exit 0 / exit 1)

- **Severidade**: P2
- **Tactic violada**: Specialized Interfaces (parcial — a extração parou em `SeedAdminConfig`, o `main()` continua não testável)
- **Localização**: `src/backend/jobs/seed-admin.ts:23-38`
- **Evidência (objetiva)**:
  ```
  find src/backend/jobs -name '*.test.ts'  → apenas SeedAdminConfig.test.ts
  ```
  `seed-admin.ts` chama `bootstrapAppContainer()`, `container.resolve(UserRepository)`, `repository.upsertAdmin`, e formata `console.log`/`console.error` + `process.exit(0|1)` — nenhuma dessas linhas tem asserção direta.
- **Impacto técnico**: `SeedAdminConfig` (a validação de env) e `UserRepository.upsertAdmin` (a persistência) estão cobertos; o que falta é o "cimento" entre os dois — se alguém trocar a ordem (ex.: conectar no banco antes de validar o env, quebrando a garantia "valida ANTES de conectar" documentada no próprio arquivo), nenhum teste pega.
- **Impacto de negócio**: baixo (é um job rodado sob demanda, `npm run seed:admin`, não em produção contínua) — mas é o único caminho de bootstrap do primeiro admin; falhar silenciosamente nesse fluxo vira um chamado ao time.
- **Métrica de baseline**: 1/2 arquivos de `jobs/` tocados pelo delta com teste direto (50%).

### F-testability-3 (PRÉ-EXISTENTE): piso de `coverageThreshold` do frontend muito abaixo do backend e do alvo Bass

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (o gate de CI existe, mas o piso não obriga cobertura real)
- **Localização**: `src/frontend/jest.config.js` (não tocado por este delta)
- **Evidência (objetiva)**:
  ```
  # src/backend/jest.config.cjs
  coverageThreshold: { global: { lines: 72, branches: 54, functions: 78 } }
  # src/frontend/jest.config.js
  coverageThreshold: { global: { lines: 33, branches: 23, functions: 28 } }
  ```
- **Impacto técnico**: esta feature elevou bastante a cobertura real do frontend tocado (login, banner, tela de usuários, os dois diálogos) — mas o piso GLOBAL do `jest.config.js` continua em 33/23/28, herdado do template. Uma regressão futura em qualquer componente não tocado por esta feature (ou mesmo numa parte não coberta de `EditarEmailDialog.tsx`) não derruba o CI.
- **Impacto de negócio**: o ganho de testabilidade desta feature não fica "travado" — é fácil, em um próximo ciclo sob pressão de prazo, reduzir a cobertura de volta sem que ninguém perceba no gate.
- **Métrica de baseline**: piso frontend 33/23/28 vs. piso backend 72/54/78 vs. alvo Bass 80/70/80 em código crítico. PRÉ-EXISTENTE: `jest.config.js` não está no diff desta feature.

### F-testability-4: normalização/colisão de e-mail sem teste baseado em propriedade

- **Severidade**: P3
- **Tactic violada**: Executable Assertions (uso pleno da ferramenta já disponível)
- **Localização**: `src/backend/domain/service/auth/UserAdminService.ts:38-67` (`createUserSchema`, `setEmailSchema`); `src/backend/domain/repository/auth/UserRepository.ts:134-142` (`findByLoginIdentifier`)
- **Evidência (objetiva)**:
  ```
  grep -rln "fast-check\|fc\." src/frontend/__tests__   → (vazio)
  # backend: mesma ausência nos arquivos do delta
  ```
  `fast-check` já é dependência do repo (conforme contexto da missão) mas não é usado em nenhum teste tocado por esta feature.
- **Impacto técnico**: os testes atuais cobrem exemplos pontuais (trim + lowercase, e-mail com espaço/caixa mista, e-mail == username, e-mail != username) — bem escolhidos, mas exemplos. A invariante real (I3: dois valores diferentes só depois de normalizar nunca devem casar a mesma linha; I4: todo e-mail persistido é sempre `trim().toLowerCase()`) é uma propriedade sobre TODO o espaço de strings, não só os 4-5 exemplos testados.
- **Impacto de negócio**: baixo no curto prazo (os exemplos escolhidos são bons) — mas é exatamente o tipo de lógica (normalização de string livre de usuário) onde um caractere Unicode incomum ou um espaço não-ASCII pode escapar de um teste por exemplo e não de um teste por propriedade.
- **Métrica de baseline**: 0 usos de `fast-check` nos 13 arquivos de teste do delta.

### F-testability-5: `UserRepository.test.ts` é o maior arquivo de teste do delta e acumula 5 responsabilidades

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/domain/repository/auth/UserRepository.test.ts` (463 LOC); `src/backend/domain/repository/auth/UserRepository.ts` (404 LOC)
- **Evidência (objetiva)**: `wc -l` → 463 LOC, organizado em `describe` por método, cobrindo: lookup de login, e-mail + unicidade cruzada, guarda de desativação transacional, vínculo Conexos, upsert de admin.
- **Impacto técnico**: nenhum agora — o arquivo está bem segmentado por `describe`. É um sinal de tendência: o próximo passo do ADR-0051 (passo 2/3, `sub` deixando de ser `username`) provavelmente adiciona mais métodos a esta mesma classe.
- **Impacto de negócio**: nenhum imediato.
- **Métrica de baseline**: 463 LOC (limiar de alerta do heurístico: 500 LOC).
- Sem card dedicado nesta rodada — abaixo do limiar de ação; reavaliar quando o passo 2/3 do ADR-0051 tocar `UserRepository` de novo (se cruzar 500 LOC, extrair a guarda de desativação para um colaborador próprio, ex.: `AdminDeactivationGuard`).

## 5. Cards Kanban

### [testability-1] Versionar o teste de integração da guarda de concorrência de `UserRepository`

- **Problema**
  > A guarda R11 (`deactivateGuarded`, `FOR UPDATE`) e a unicidade cruzada de e-mail/username (`23505` sob corrida) só foram provadas contra Postgres real por um gate manual desta rodada (20/20, ver `_shared-metrics.md`), sem ficar como teste executável no repositório. Um mock não consegue provar serialização de transação.

- **Melhoria Proposta**
  > Criar `src/backend/domain/repository/auth/UserRepository.integration.test.ts` (ou `describe('integration: UserRepository', ...)` seguindo o padrão já sugerido no CLAUDE.md do template) contra um Postgres descartável — reaproveitando o setup já usado manualmente nesta rodada (subir Postgres 16, aplicar as 65 migrações, rodar os 20 casos). Adicionar um `npm run test:integration` separado do `npm test` padrão (não precisa bloquear CI imediatamente se subir um serviço for custoso, mas precisa existir e ser rodável por qualquer dev). Tactic alvo: **Sandbox**.

- **Resultado Esperado**
  > `describe('integration: ...')` no repo: 0 → ≥1 (cobrindo `UserRepository`); a corrida de dois admins se desativando ao mesmo tempo passa a ser reexecutável em qualquer máquina/CI, não só num gate manual de uma rodada.

- **Tactic alvo**: Sandbox
- **Severidade**: P1
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - `describe('integration: ...')` no repo: 0 → ≥1
  - Scripts/harness de Postgres descartável versionados: 0 → 1
- **Risco de não fazer**: a próxima mudança em `deactivateGuarded` (esperada no passo 2/3 do ADR-0051) pode afrouxar a serialização sem que nenhum teste automatizado detecte — o incidente aparece em produção como "todos os admins ficaram inativos".
- **Dependências**: nenhuma.

### [testability-2] Cobrir os caminhos de saída de `seed-admin.ts`

- **Problema**
  > `SeedAdminConfig` (validação) e `upsertAdmin` (persistência) têm teste direto; o `main()` de `seed-admin.ts` que os conecta — incluindo a ordem "valida ANTES de conectar no banco" documentada no arquivo — não tem nenhuma asserção.

- **Melhoria Proposta**
  > Extrair `main` para uma função exportada e testável (mesmo padrão já aplicado a `SeedAdminConfig`), mockando `bootstrapAppContainer`/`container.resolve`/`process.exit`, e testar: (a) env inválido nunca chama `bootstrapAppContainer`; (b) sucesso loga a mensagem e sai com 0; (c) falha do repositório loga o erro (sem vazar a senha) e sai com 1. Tactic alvo: **Specialized Interfaces**.

- **Resultado Esperado**
  > `jobs/` do delta: 1/2 arquivos com teste direto → 2/2.

- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Cobertura de arquivo em `jobs/` (delta): 50% → 100%
- **Risco de não fazer**: baixo — job sob demanda, não em produção contínua; mas um refactor futuro pode inverter "validar antes de conectar" sem que nada pegue.
- **Dependências**: nenhuma.

### [testability-3] Elevar o piso de `coverageThreshold` do frontend

- **Problema**
  > O piso global de `src/frontend/jest.config.js` (33/23/28) é pré-existente e muito abaixo do backend (72/54/78) e do alvo defensável (80/70/80) para caminhos críticos. Esta feature elevou a cobertura real de login/usuários bem acima disso, mas o piso do CI não trava esse ganho.

- **Melhoria Proposta**
  > Medir a cobertura real do frontend após esta feature (rodar `npm test -- --coverage` fora do `--quick`) e subir `coverageThreshold` para um valor próximo do medido, com um caminho declarado para 80/70/80 em `features/` e `shared/components/ui/`. Tactic alvo: **Executable Assertions** (transformar o piso em gate de fato, não decorativo).

- **Resultado Esperado**
  > `coverageThreshold` do frontend: 33/23/28 → valor medido pós-feature (a definir na próxima medição sem `--quick`), com plano explícito até 80/70/80 nos diretórios críticos.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) para o bump do piso; M para fechar o caminho até 80/70/80
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - `coverageThreshold.global.lines` (frontend): 33 → medido pós-feature (esperado > 40, a confirmar)
- **Risco de não fazer**: o ganho de testabilidade desta feature erode silenciosamente em ciclos futuros sob pressão de prazo — nenhum gate impede.
- **Dependências**: uma rodada de `regis-review` sem `--quick` (ou execução manual de `npm test -- --coverage --silent` no frontend) para medir o valor real antes de fixar o novo piso.

### [testability-4] Testes baseados em propriedade para normalização/colisão de e-mail

- **Problema**
  > `createUserSchema`, `setEmailSchema` e `findByLoginIdentifier` implementam invariantes de normalização (I3, I4) testadas hoje só por exemplos pontuais (4-6 casos por função), embora `fast-check` já seja dependência do repo e esteja subutilizado.

- **Melhoria Proposta**
  > Adicionar `fc.assert` sobre `createUserSchema`/`setEmailSchema`: para qualquer string `s` com um `@` válido, `parse({ email: s })` sempre devolve `s.trim().toLowerCase()`; e para qualquer par de strings que normalizam para o mesmo valor, o schema as trata como equivalentes. Tactic alvo: **Executable Assertions** (propriedade como asserção sobre um espaço de entradas, não só exemplos).

- **Resultado Esperado**
  > Usos de `fast-check` nos testes de auth/usuários: 0 → ≥2 (um em `UserAdminService.test.ts`, um em `UserRepository.test.ts` para `findByLoginIdentifier`).

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Arquivos de teste do delta usando `fast-check`: 0 → ≥2
- **Risco de não fazer**: baixo — os exemplos hoje já cobrem os casos de negócio conhecidos; o risco é um caractere/Unicode-edge-case não previsto escapando.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: avaliei só os 32 arquivos do delta (`git diff --stat origin/main...HEAD`); `AuthProvider.tsx` (único outro uso de `Date.now()` encontrado na busca) foi confirmado FORA do delta (`git diff --stat` vazio para ele) e não entrou nos achados.
- Não rodei `npm test`/`--coverage` (proibido pela missão); os números de cobertura numérica ficam como "não medível nesta execução" — já declarado em `_shared-metrics.md` para `--quick`. A tabela de cobertura por camada usa presença de teste dedicado como proxy, não `%` de linhas/branches.
- Cross-QA: F-testability-1 (Sandbox para a guarda de concorrência) é o mesmo achado que a Fault Tolerance deveria citar para R11 (o último-admin-ativo é uma invariante de disponibilidade, não só de auth) — vale casar os dois cards no consolidator. F-testability-3 (piso de coverage do frontend) espelha o mesmo tema que Deployability deveria levantar sobre gates pré-deploy.
- Não encontrei `TDDGuide` em `.claude/agents/` (só `pattern-guardian.md`) — pré-existente, mencionado no CLAUDE.md como parte do pipeline mas não confirmei se é aspiracional ou dívida; não abri card por ser P3 e fora do escopo desta feature específica.
