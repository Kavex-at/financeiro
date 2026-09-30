---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-30-1554
agent: qa-modifiability
generated_at: 2026-09-30T16:10:00-03:00
scope: backend
score: 7.5
findings_count: 3
cards_count: 3
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex | Trocar/remover o emissor de auth (legado HS256 -> Supabase) ou adicionar um terceiro emissor | `http/auth.ts`, `http/acesso.ts`, `routes/auth.ts`, `domain/service/auth/*` | Desenvolvimento, `AUTH_PROVIDER` chaveado por env | Mudança localizada na camada de auth, sem tocar rotas de negócio | <= 6 arquivos de produção tocados; 0 rotas de negócio alteradas; rollback por env sem deploy de código |

## 2. Métricas observadas

Escopo: delta `76b5182..HEAD` (51 arquivos de produção adicionados/modificados em `src/`; testes excluídos). Débito pré-existente marcado como tal.

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos de auth > 600 LOC | 1 (`UserRepository.ts` 671 LOC, pré-existente, +249 LOC no delta); 0 arquivos novos | max <= 600 | ⚠️ pré-existente | `wc -l` sobre o delta |
| Arquivos novos > 400 LOC | 1 (`SupabaseAuthClient.ts` 406) | p95 <= 400 | ⚠️ marginal | `wc -l` |
| Services novos (CredentialMirror 234, SyncService 306, SessionService 164, AdminSeeder 92) | mediana 199 LOC | p50 <= 150 | ⚠️ | `wc -l` |
| Warnings de cognitive complexity no escopo | 1 (`http/acesso.ts:125`, complexidade 30, max 15) | 0 | ⚠️ | `npx biome lint` no escopo |
| Fan-out máx. no escopo novo | 15 imports (`app/operacao/page.tsx`); backend novo <= 13 (`UserAdminService`) | <= 15 | ✅ | `grep -c '^import '` |
| Fan-in dos módulos novos (arquivos de produção que referenciam) | SupabaseAuthClient 8, AuthService 6, AccessService 3, demais 2 | informativo | ✅ raio baixo | `grep -rlE` |
| Violações de camada (routes/http -> repository/client) | 1 (`http/processResources.ts` importa `PostgreeDatabaseClient`; pré-existente, fora do delta) | 0 | ⚠️ pré-existente | `grep domain/(repository\|client)` |
| Dependência circular | 0 detectada (amostra manual de 6 serviços) | 0 | ✅ | trace manual |
| Números mágicos em services de auth | 0 (limites ficam em `rateLimit.ts`, borda HTTP) | 0 | ✅ | `grep -E` em `domain/service/auth` |
| Pontos de ramificação por emissor/provider | 4 (`routes/auth.ts:100,150`, `http/acesso.ts:142`, `AdminSeeder.ts:46`) | <= 2 | ⚠️ | `grep authProvider\|emissor` |
| `process.env` cru em services/client novos | 0 (`loadAuthEnv` valida com Zod no boundary) | 0 | ✅ | `grep process.env` |
| Blast radius do delta em rotas de negócio | permutas 26 / recebimentos 10 / sispag 2 / operacao 2 linhas | mínimo | ✅ | `git diff --numstat` |
| Drift `_coverage.json` / `_index.json` | Não medido (--quick) | 0 | ⚠️ não medido | n/a |

### Apêndice A — Top-10 maiores arquivos de produção tocados pelo delta

| # | LOC | Imports | Arquivo | Observação |
|---|---|---|---|---|
| 1 | 1002 | 38 | `src/backend/routes/permutas.ts` | pré-existente, +26 no delta |
| 2 | 1000 | 34 | `src/backend/routes/recebimentos.ts` | pré-existente, +10 |
| 3 | 728 | 25 | `src/backend/routes/sispag.ts` | pré-existente, +2 |
| 4 | 671 | 7 | `src/backend/domain/repository/auth/UserRepository.ts` | +249 no delta |
| 5 | 623 | 1 | `src/frontend/lib/arquitetura/tecnica.ts` | dados/conteúdo |
| 6 | 471 | 13 | `src/backend/domain/service/auth/UserAdminService.ts` | +52 |
| 7 | 450 | 8 | `src/backend/domain/repository/auth/AccessRepository.ts` | +22 |
| 8 | 446 | 15 | `src/frontend/app/operacao/page.tsx` | +11 |
| 9 | 406 | 10 | `src/backend/domain/client/SupabaseAuthClient.ts` | novo |
| 10 | 383 | 6 | `src/backend/domain/libs/environment/EnvironmentProvider.ts` | +21 |

### Apêndice B — Fan-in dos módulos de auth (arquivos de produção que referenciam)

| # | Fan-in | Módulo |
|---|---|---|
| 1 | 8 | `SupabaseAuthClient` |
| 2 | 6 | `AuthService` |
| 3 | 3 | `AccessService` |
| 4 | 2 | `SupabaseSessionService` |
| 5 | 2 | `CredentialMirror` |
| 6 | 2 | `UserAdminService` |
| 7 | 2 | `SupabaseAuthSyncService` |
| 8 | 2 | `AdminSeeder` |
| 9-10 | n/a | ranking global de `domain/service/` não coletado (--quick) |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Auth dividida em SessionService / CredentialMirror / SyncService / AdminSeeder / Client; `UserRepository` (671) e as 3 routes grandes seguem grandes | ⚠️ parcial | Apêndice A |
| Increase Semantic Coherence | Serviços novos com responsabilidade única; `UserAdminService` delega o espelho no GoTrue ao CredentialMirror | ✅ presente | `domain/service/auth/` |
| Encapsulate | `SupabaseAuthClient` esconde GoTrue; erros de domínio tipados (`SupabaseAuth*Error`); `loadAuthEnv` valida env uma vez | ✅ presente | `SupabaseAuthClient.ts`, `authEnv.ts` |
| Use an Intermediary | `resolverAcesso` reescreve `req.user` para `{sub: username}` (I2), isolando rotas do emissor do token | ✅ presente | `http/acesso.ts:142-190` |
| Restrict Dependencies | Sem violação nova de camada; routes usam service via `container.resolve` | ✅ presente | grep de camadas |
| Refactor | `resolverAcesso` com complexidade 30; ramificações por emissor espalhadas | ⚠️ parcial | `acesso.ts:125` |
| Abstract Common Services | `AuthService` e `SupabaseSessionService` fazem login/logout sem interface comum | ❌ ausente | `routes/auth.ts:100-102` |
| Defer Binding | `AUTH_PROVIDER` por env chaveia legado/supabase; rollback sem redeploy de código. Escolha por `if`, não por token DI | ⚠️ parcial | `routes/auth.ts:59,100`; `AdminSeeder.ts:46` |

## 4. Findings (achados)

### F-modifiability-1: Provider de auth escolhido por condicionais espalhadas, sem interface comum

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services / Defer Binding
- **Localização**: `src/backend/routes/auth.ts:100-102,150`; `src/backend/http/acesso.ts:142`; `src/backend/domain/service/auth/AdminSeeder.ts:46`
- **Evidência (objetiva)**:
  ```
  (await modoAtual()) === 'supabase'
      ? await container.resolve(SupabaseSessionService).login(credenciais)
      : await container.resolve(AuthService).login(credenciais);
  ```
- **Impacto técnico**: um terceiro emissor (ou a remoção do legado) exige tocar 4 pontos; risco de ramo esquecido.
- **Impacto de negócio**: a remoção planejada do modo legado (passo final da transição) custa mais e é mais sujeita a erro do que precisa.
- **Métrica de baseline**: 4 pontos de ramificação por provider/emissor (alvo <= 2).

### F-modifiability-2: `resolverAcesso` com complexidade cognitiva 30

- **Severidade**: P2
- **Tactic violada**: Refactor
- **Localização**: `src/backend/http/acesso.ts:125`
- **Evidência (objetiva)**:
  ```
  http/acesso.ts:125:83 noExcessiveCognitiveComplexity — Excessive complexity of 30 detected (max: 15)
  ```
- **Impacto técnico**: middleware no caminho de toda rota autenticada; o delta adicionou ramo por vínculo, validação UUID, log de divergência e reescrita de `req.user` (+50 LOC) numa única função.
- **Impacto de negócio**: mudança futura em regra de acesso é arriscada e difícil de testar isoladamente.
- **Métrica de baseline**: complexidade 30 vs. limite 15.

### F-modifiability-3: `UserRepository` acima de 600 LOC (pré-existente, agravado)

- **Severidade**: P2 (pré-existente; +249 LOC no delta)
- **Tactic violada**: Split Module
- **Localização**: `src/backend/domain/repository/auth/UserRepository.ts`
- **Evidência (objetiva)**:
  ```
  671 LOC, 7 imports (alvo max 600)
  ```
- **Impacto técnico**: SQL cru de leitura, escrita e vínculo `auth_user_id` no mesmo arquivo; mudança de schema em `app_user` ripple nele.
- **Impacto de negócio**: cada evolução de usuário/permissão toca um arquivo de alto churn.
- **Métrica de baseline**: 671 LOC (alvo <= 600); 0 arquivos novos acima de 600.

## 5. Cards Kanban

### [modifiability-1] Extrair a resolução do provider de auth para um ponto único

- **Problema**
  > `routes/auth.ts`, `http/acesso.ts` e `AdminSeeder.ts` decidem legado x Supabase com `if` próprio (4 pontos). Remover ou trocar o emissor exige caçar cada ramo.

- **Melhoria Proposta**
  > Definir `SessionProviderInterface` (`login`, `logout`, `refresh`) implementada por `AuthService` e `SupabaseSessionService`, com fábrica única que lê `authProvider` (Defer Binding + Abstract Common Services). Rotas dependem só da interface.

- **Resultado Esperado**
  > Pontos de ramificação por provider: 4 -> 1. Remoção do legado toca 1 fábrica + 1 classe.

- **Tactic alvo**: Abstract Common Services / Defer Binding
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Pontos `if provider`: 4 -> 1
- **Risco de não fazer**: a remoção do modo legado no passo final segue cara e sujeita a ramo esquecido.
- **Dependências**: fazer antes da remoção definitiva do legado.

### [modifiability-2] Quebrar `resolverAcesso` em funções menores

- **Problema**
  > Middleware com complexidade cognitiva 30 (limite 15), no caminho crítico de toda rota autenticada.

- **Melhoria Proposta**
  > Extrair `montarChave(user)`, `registrarDivergencia(...)` e `reescreverIdentidade(...)` (Refactor); manter o middleware como orquestrador.

- **Resultado Esperado**
  > Complexidade 30 -> <= 15; warnings no escopo 1 -> 0, sem mudança de comportamento (testes existentes cobrem).

- **Tactic alvo**: Refactor
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Complexidade de `resolverAcesso`: 30 -> <= 15
- **Risco de não fazer**: próxima regra de acesso (ex.: novo emissor) empilha mais ramos numa função já acima do limite.
- **Dependências**: nenhuma.

### [modifiability-3] Dividir `UserRepository` por responsabilidade

- **Problema**
  > 671 LOC (+249 no delta) com consultas de usuário, vínculo Supabase e listagens no mesmo repositório.

- **Melhoria Proposta**
  > Separar `UserAuthLinkRepository` (auth_user_id, sync) de `UserRepository` (CRUD/listagem) — Split Module; services ajustam a injeção.

- **Resultado Esperado**
  > Maior arquivo do repositório de auth: 671 -> <= 450 LOC.

- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - LOC `UserRepository`: 671 -> <= 450
- **Risco de não fazer**: o arquivo passa de 800 LOC na próxima evolução de usuários/permissões.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo --quick sobre o delta `76b5182..HEAD`; fan-in global de `domain/service/` e `_coverage.json`/`_index.json` não coletados. Apêndice B cobre só os módulos de auth.
- Pontos fortes: env validado por Zod no boundary, `req.user` normalizado (I2), 0 números mágicos e 0 ciclos nos serviços novos; blast radius em rotas de negócio <= 26 linhas.
- Cross-QA: F-modifiability-1/2 tocam Integrability (Encapsulate) e Testability (complexidade 30 dificulta teste isolado); `AUTH_PROVIDER` é o mecanismo de rollback (Deployability). O warning de `acesso.ts` é do escopo do delta; os 75 warnings do backend são pré-existentes.
