---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-28-2158-auth-permissoes-modulo
agent: qa-integrability
generated_at: 2026-09-28T22:01:50Z
scope: all
score: 7
findings_count: 3
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dono do ciclo / Columbia | Passo 3 do plano de auth (ADR-0051) troca o emissor do token para Supabase Auth; `sub` deixa de ser `app_user.username` e vira UUID | `AccessRepository.findAccessBySub`, `conexosIdentity.ts`, trilha de auditoria (`ator`/`criadoPor`/`executadoPor` nas rotas) | Runtime Express/Render, produção com ~15 usuários | Só o lookup `sub → app_user` muda; papéis, exceções e trilha ficam como estão (D3 da ADR-0053) | 1 arquivo tocado no lookup (`AccessRepository.ts`); 0 regressão nos ~32 sítios que hoje tratam `sub` como nome de usuário legível |
| `kavex-report-ciclo` (consumidor externo, fora do repo) | Login como usuário comum (`FINANCEIRO_API_USUARIO=admin`) para ler `/metricas/ciclo` a cada execução semanal | `routes/metricas.ts` (`exigirPermissao(METRICAS_VER)`), conta `admin` no `app_user` | Produção, sem usuário de serviço dedicado | Consumidor mantém `metricas:ver` mesmo quando os papéis reais da Columbia substituírem "todo mundo é Administrador" | 0 guard de código que impeça desativar a última conta com `metricas:ver` usada por um consumidor externo; mitigação = 1 nota em `DEPLOY.md` |
| Time Kavex | Adicionar a 10ª permissão ao catálogo | `domain/interface/auth/Permission.ts` (BE), `lib/permissoes.ts` (FE), `CHECK` da migration 0066, teste `permissoes-api.test.ts` | Dois pacotes npm (`src/backend`, `src/frontend`) sem pacote compartilhado | Item novo aparece na tela e é aceito pelas rotas sem quebrar nada por engano | 3 cópias manuais do catálogo (BE, FE, snapshot do teste FE) sem link em tempo de compilação entre BE e FE |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rotas autenticadas com exatamente 1 guard, verificadas por introspecção | 85 rotas / 346 casos comportamentais | 100% | ✅ | `_shared-metrics.md`; `src/backend/http/routePermissions.test.ts` (93 linhas na tabela, cobrindo os 8 routers montados) |
| Cópias manuais do catálogo de permissões (sem import cross-pacote) | 3 (`domain/interface/auth/Permission.ts`, `src/frontend/lib/permissoes.ts`, snapshot hardcoded em `src/frontend/__tests__/permissoes-api.test.ts:29-38`) | 1 fonte única (ou teste que falha se BE mudar sem FE mudar) | ⚠️ | `Grep PERMISSION_CATALOG\|CATALOGO_PERMISSOES` nos dois pacotes |
| Paridade catálogo ↔ `CHECK` do banco, testada | 2/2 colunas (`app_role_permission.permission`, `user_permission.permission`) | 100% | ✅ | `src/backend/migrations/0066_auth_permissoes_modulo.test.ts:78-84` |
| Sítios que tratam `req.user.sub` como nome de usuário legível (fora do lookup isolado da ADR) | 32 ocorrências em `routes/*.ts` + `http/conexosIdentity.ts` | Documentado no ADR como blast radius do passo 3 | ⚠️ | `grep -rn "req.user?.sub" src/backend/routes src/backend/http` (excluindo testes) |
| Zod na borda do repositório de acesso (linha do banco) | 2 schemas (`accessRowSchema`, `roleRowSchema`) cobrindo as leituras centrais | Presente nos pontos de escrita/leitura novos | ✅ | `src/backend/domain/repository/auth/AccessRepository.ts:123-138` |
| Chamadas de rede da nova superfície de auth passando pelo wrapper único (`apiFetch`) | 13 de 13 (`permissoes.ts`: 1, `usuarios.ts`: 12) | 100% via wrapper | ✅ | `grep -c apiFetch src/frontend/lib/permissoes.ts src/frontend/lib/usuarios.ts` |
| Guard técnico contra desativar a última conta usada por um consumidor externo (`metricas:ver`) | 0 (só existe guard para `usuarios:gerenciar`, D6/R9) | ≥1 para identidades de serviço conhecidas | ❌ | `src/backend/domain/repository/auth/AccessRepository.ts` (guarda só cobre `USUARIOS_GERENCIAR`); `DEPLOY.md:222-223` (mitigação documental) |
| Versionamento explícito de `/me/permissoes` e `/usuarios` | 0% (sem prefixo `/v1`) | N/A — nenhuma rota do backend usa versionamento de URL | ➖ | `grep -rn "/v[0-9]" src/backend/routes` (nenhuma ocorrência; convenção pré-existente, não introduzida por este delta) |

> ⚠️ **Não medível localmente**: latência real de `AccessService.resolver` sob concorrência de instâncias (o `_shared-metrics.md` já registra isso como não medível). Requer produção com `numInstances > 1`. Recomendação: instrumentar `AccessService.CACHE_TTL_MS` hit/miss via `LogService` antes de subir `numInstances`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `EffectivePermissionCalculator` é o único lugar que calcula permissões efetivas; middleware, guarda do último gestor e tela de usuários chamam-no, nenhum reimplementa | ✅ presente | `src/backend/domain/service/auth/EffectivePermissionCalculator.ts:21-28` |
| Use an Intermediary | Toda a nova superfície FE (`permissoes.ts`, `usuarios.ts`) passa por `apiFetch` + `withAuthHeaders`; nenhuma chamada crua | ✅ presente | 13/13 chamadas via `apiFetch` (métrica acima) |
| Restrict Communication Paths | Um guard por rota, imposto por teste estrutural (introspecção do `router.stack`) | ✅ presente | `src/backend/http/routePermissions.test.ts` (93 linhas de tabela) |
| Adhere to Standards | Convenção de nomes de permissão (`modulo:acao`) e Zod nas duas colunas do banco; porém o catálogo em si não segue um único ponto de verdade cross-stack | ⚠️ parcial | `Permission.ts:13-23` vs `lib/permissoes.ts:12-22` |
| Abstract Common Services | `AccessRepository.lockAndCheck` é reutilizado por `setRole`, `replaceExceptions` (mesmo arquivo) e por `UserRepository.setAtivo` (injeta `AccessRepository`); zero duplicação da lógica de trava/transação | ✅ presente | `src/backend/domain/repository/auth/UserRepository.ts:296-306` |
| Discover Service | Não aplicável nesta feature: a config de auth (`DEV_AUTH_BYPASS`, chaves JWT) vem de env/`EnvironmentProvider`, não de SSM — arquitetura Express/Render atual não tem registro de serviço | N/A — repo ainda não usa SSM (estado-alvo); nada nesta feature muda isso | `CLAUDE.md` (Estado Atual vs. Alvo) |
| Tailor Interface | `GET /me/permissoes` devolve `{ permissoes, papel, operacao }` pensado para dois consumidores (front novo e front legado) sem forçar o legado a mudar | ✅ presente | `src/backend/routes/me.ts:38-51`; `src/frontend/lib/permissoes.ts:62-82` |
| Configure Behavior | `DEV_AUTH_BYPASS` muda o comportamento de `resolverAcesso` inteiro sem tocar rotas; bloqueado fora de local/dev | ✅ presente | `src/backend/http/acesso.ts:59-71,108-123` |
| Manage Resources | Cache de acesso em memória com TTL de 30s, invalidado no próprio processo após escrita; ressalva explícita para múltiplas instâncias | ✅ presente, com risco documentado | `src/backend/domain/service/auth/AccessService.ts:41-44,94-98`; ADR-0053 D4 |
| Orchestrate | `UserAdminService` orquestra `UserRepository` + `AccessRepository` + `LogService` de forma síncrona e linear (sem fila); volume (~15 usuários) não justifica choreography | ✅ presente, adequado à escala | `src/backend/domain/service/auth/UserAdminService.ts` (295 linhas, chamadas em série) |
| Manage Resource Coupling | Duas tabelas de permissão (`app_role_permission`, `user_permission`) e a trilha compartilham o mesmo `CHECK` e o mesmo cálculo; acoplamento é intencional e testado (paridade) | ✅ presente | `src/backend/migrations/0066_auth_permissoes_modulo.test.ts:78-84` |
| Contract testing (consumer-driven / schema-pinned) | Backend-DB: testado (paridade `CHECK`). Backend-Frontend: **não** — o teste do FE é um snapshot hardcoded, não deriva do backend nem falha se o backend adicionar uma permissão | ⚠️ parcial | `src/frontend/__tests__/permissoes-api.test.ts:29-38` |
| Versioning strategy | Nenhuma rota do backend usa versionamento de URL/header; não é uma regressão desta feature, é o padrão do repo inteiro | N/A — convenção pré-existente do repo, fora do escopo desta feature | `grep -rn "/v[0-9]" src/backend/routes` (vazio) |
| Backward-compatibility shims | D4/D12 da ADR-0053: `/me/permissoes` sem o array `permissoes` faz o front cair no comportamento legado (`role='admin'` + chave `operacao`); `POST /usuarios` aceita `role:'admin'` como alias de `papelId` durante a janela de deploy | ✅ presente, bem testado | `src/frontend/lib/auth/PermissoesProvider.tsx:38-49`; ADR-0053 D12 |
| Observability of integration failures | Falha ao ler o banco de acesso loga em `LOG_TYPE.FLOW_ERROR` com `requestId`, usuário e rota antes do 503; permissão fora do catálogo loga `BUSINESS_WARN` | ✅ presente | `src/backend/http/acesso.ts:134-150`; `src/backend/domain/service/auth/AccessService.ts:74-81` |

## 4. Findings (achados)

### F-integrability-1: Catálogo de permissões triplicado sem contrato verificável entre backend e frontend

- **Severidade**: P2
- **Tactic violada**: Adhere to Standards / Contract testing (schema-pinned)
- **Localização**: `src/backend/domain/interface/auth/Permission.ts:13-23`, `src/frontend/lib/permissoes.ts:12-22`, `src/frontend/__tests__/permissoes-api.test.ts:29-38`
- **Evidência (objetiva)**:
  ```
  // backend/domain/interface/auth/Permission.ts
  export const PERMISSION = { PERMUTAS_VER: 'permutas:ver', ... } as const; // 9 valores

  // frontend/lib/permissoes.ts
  export const PERMISSAO = { PERMUTAS_VER: 'permutas:ver', ... } as const // 9 valores, cópia manual

  // frontend/__tests__/permissoes-api.test.ts:29-38
  expect([...CATALOGO_PERMISSOES].sort()).toEqual(
    ['metricas:ver', 'operacao:ver', 'permutas:executar', ...].sort()  // 3ª cópia, hardcoded
  )
  ```
  `src/backend` e `src/frontend` são pacotes npm separados (sem workspace compartilhado); nenhum import cruza a fronteira. A paridade backend↔banco é testada (`0066_auth_permissoes_modulo.test.ts:78-84`); a paridade backend↔frontend não é.
- **Impacto técnico**: adicionar/renomear uma permissão no backend não quebra build nem teste do frontend — o item novo é silenciosamente descartado por `isPermissao` (`lib/permissoes.ts:39-40`) e o botão/página correspondente some da tela sem erro visível, só perceptível em QA manual.
- **Impacto de negócio**: um módulo novo (ou renomeação de permissão) pode ficar invisível na tela de gestão de usuários e no `/usuarios` por um deploy inteiro, gerando um "por que ninguém consegue ver X" que só se resolve olhando os dois catálogos lado a lado.
- **Métrica de baseline**: 3 cópias manuais do catálogo, 0 delas ligadas por import ou teste cross-pacote.

### F-integrability-2: Identidade de serviço do `kavex-report-ciclo` não é um cidadão de primeira classe do modelo de acesso

- **Severidade**: P1
- **Tactic violada**: Discover Service / Manage Resource Coupling (o consumidor externo não tem uma identidade gerenciável pelo próprio sistema de permissões que ele depende)
- **Localização**: `src/backend/routes/metricas.ts:30-33`, `ontology/decisions/0053-auth-permissoes-por-modulo-no-banco.md:244-247` (D11/Q6), `DEPLOY.md:222-223`
- **Evidência (objetiva)**:
  ```
  // routes/metricas.ts:30-33
  * Consumida pela tela Métricas e pelo `kavex-report-ciclo` (que faz login na API como qualquer
  * usuário). Exige `metricas:ver` (ADR-0053) — a conta do report precisa mantê-la quando os papéis
  * da Columbia chegarem.

  // DEPLOY.md:222-223
  - Antes de **desativar a conta compartilhada `admin`**, trocar `FINANCEIRO_API_USUARIO` do
    `kavex-report-ciclo` para outra conta com `metricas:ver`: desativar `admin` quebra o report até lá.
  ```
  A guarda de "último gestor" (D6 da ADR, `AccessRepository.lockAndCheck`) só protege `usuarios:gerenciar`; não existe guarda equivalente para "última conta ativa com `metricas:ver` usada por um consumidor externo". A única proteção é uma frase em `DEPLOY.md`.
- **Impacto técnico**: quando a Columbia migrar de "todo mundo é Administrador" para papéis reais (o próprio roadmap desta ADR, seção "Consequências"), desativar ou reduzir o papel da conta `admin` sem lembrar dessa nota derruba `GET /metricas/ciclo` para o `kavex-report-ciclo` com 403, silenciosamente — o job do report roda fora deste repo e não aparece em nenhum dashboard do financeiro.
- **Impacto de negócio**: o report semanal da Columbia (métricas de ciclo) para de atualizar sem alarme; o precedente já existe no histórico do time (`crons-gh-actions-secrets-conexos-desatualizados`: um cron rodou "com sucesso" processando 0 títulos por credencial desatualizada).
- **Métrica de baseline**: 1 conta compartilhada (`admin`) sustenta o único consumidor externo de `/metricas/ciclo`; 0 guardas de código; 1 nota de texto como única mitigação.

### F-integrability-3: A ADR subestima o raio de mudança do passo 3 (Supabase Auth) ao afirmar que só o lookup `sub → app_user` muda

- **Severidade**: P2
- **Tactic violada**: Tailor Interface (o seam declarado é mais estreito do que o código real)
- **Localização**: `ontology/decisions/0053-auth-permissoes-por-modulo-no-banco.md` (seção D3, "muda só a primeira metade do lookup... papéis, exceções e trilha ficam como estão"); `src/backend/http/conexosIdentity.ts:14-15`; 32 ocorrências de `req.user?.sub` em `src/backend/routes/*.ts`
- **Evidência (objetiva)**:
  ```
  // ADR-0053, D3
  "muda só a primeira metade do lookup, e papéis, exceções e trilha ficam como estão."

  // http/conexosIdentity.ts:14 (NÃO tocado por este delta — git diff vazio)
  const platformUsername = req.user?.sub;  // assume sub == username Conexos

  // routes/permutas.ts, recebimentos.ts, sispag.ts, usuarios.ts, operacao.ts
  const executadoPor = req.user?.sub ?? req.user?.email ?? 'unknown';  // repetido 32x
  ```
- **Impacto técnico**: quando `sub` virar o UUID do Supabase (passo 3), `conexosIdentity.ts` para de casar o usuário logado com o vínculo Conexos (a sessão cai para o robô em silêncio — o mesmo padrão de falha já catalogado em `conexos-robo-clonex-sem-permissao-fin010`), e a trilha de auditoria (`ator`, `criadoPor`, `executadoPor`) passa a gravar UUIDs opacos em vez de nomes de usuário legíveis, sem que nenhuma dessas ~32 linhas apareça na lista de arquivos a revisar no passo 3.
- **Impacto de negócio**: o passo 3 (próximo da fila, conforme `auth-transicao-tres-passos`) corre risco de reabrir a mesma lacuna operacional que a ADR-0051 fechou (Conexos "sem vínculo, opera via robô, em silêncio") e de degradar a trilha de auditoria de acesso recém-criada por esta feature.
- **Métrica de baseline**: 32 sítios em `routes/*.ts` + 1 middleware (`conexosIdentity.ts`) tratam `sub` como nome de usuário legível; 0 desses sítios são citados no texto da ADR como parte do raio de mudança do passo 3.

## 5. Cards Kanban

### [integrability-1] Gerar o catálogo de permissões do frontend a partir do backend (ou travar a paridade por teste)

- **Problema**
  > O catálogo de 9 permissões existe em 3 cópias manuais (`Permission.ts`, `lib/permissoes.ts`, snapshot hardcoded do teste FE) sem nenhum link verificável entre backend e frontend — só a paridade backend↔banco é testada.

- **Melhoria Proposta**
  > Tactic: Adhere to Standards / Contract testing. Caminho mais barato sem monorepo de tipos: publicar `PERMISSION_CATALOG` como JSON estático gerado no build do backend (ex.: `scripts/export-permission-catalog.ts` → `src/frontend/lib/permission-catalog.generated.json`) e o teste FE (`permissoes-api.test.ts`) importar esse arquivo gerado em vez do array hardcoded. Alternativa mais leve: um script de CI que compara as duas listas textualmente e falha o PR se divergirem.

- **Resultado Esperado**
  > Adicionar uma permissão no backend sem replicar no frontend passa a falhar um gate automatizado, em vez de só sumir silenciosamente da tela. Cópias manuais sem link: 3 → 1 fonte + 1 artefato derivado.

- **Tactic alvo**: Adhere to Standards
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Cópias manuais sem verificação automática: 3 → 0
  - Teste de paridade cross-pacote: ausente → 1 (roda no CI do frontend ou num script de release)
- **Risco de não fazer**: cada nova permissão (e a Columbia já sinalizou que papéis reais vêm a seguir) carrega risco de "sumiço silencioso" de funcionalidade na UI, descoberto só em QA manual ou por usuário reportando.
- **Dependências**: nenhuma.

### [integrability-2] Dar ao `kavex-report-ciclo` uma identidade de serviço gerenciável pelo próprio sistema de permissões

- **Problema**
  > O único consumidor externo de `/metricas/ciclo` depende da conta humana compartilhada `admin` continuar ativa com `metricas:ver`; a única proteção contra quebrá-lo é uma frase em `DEPLOY.md` (D11/Q6 da ADR-0053), sem guarda de código equivalente à de "último gestor" (D6).

- **Melhoria Proposta**
  > Tactic: Manage Resource Coupling / Discover Service. Criar um papel `Relatório` (ou usuário de serviço dedicado) com só `metricas:ver`, migrar `FINANCEIRO_API_USUARIO` para ele, e estender a guarda de `AccessRepository.lockAndCheck` (ou uma nova, mais barata) para recusar desativar/rebaixar a última conta ativa com uma permissão marcada como "usada por consumidor externo" (lista pequena e explícita, hoje só `metricas:ver`).

- **Resultado Esperado**
  > Desativar a conta `admin` no dia em que os papéis reais da Columbia chegarem deixa de depender de alguém lembrar de ler o `DEPLOY.md`. Guardas de código para identidades externas: 0 → 1.

- **Tactic alvo**: Manage Resource Coupling
- **Severidade**: P1
- **Esforço estimado**: M (2-5d) — inclui criar o papel, trocar a credencial do report (coordenação fora deste repo) e a guarda nova
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Contas de serviço com permissão dedicada (não herdada de "todo mundo é Administrador"): 0 → 1
  - Guarda de código contra desativar a última conta com `metricas:ver`: ausente → presente, com teste de corrida (como os 10/10 de D6)
- **Risco de não fazer**: o report semanal para de atualizar no exato momento em que a feature de papéis reais (o próximo passo natural desta ADR) é entregue — o timing de maior risco é também o de menor atenção, porque ninguém está olhando para o `kavex-report-ciclo` durante o rollout de papéis.
- **Dependências**: nenhuma bloqueante; pode andar em paralelo à modelagem de papéis reais da Columbia.

### [integrability-3] Auditar e listar explicitamente todo sítio que trata `sub` como nome de usuário antes do passo 3 (Supabase Auth)

- **Problema**
  > ADR-0053 D3 afirma que o passo 3 muda "só a primeira metade do lookup" (`AccessRepository.findAccessBySub`), mas 32 sítios em `routes/*.ts` e o middleware `conexosIdentity.ts` (não tocados por esta feature) tratam `req.user.sub` como o nome de usuário Conexos ou como identificador legível de auditoria.

- **Melhoria Proposta**
  > Tactic: Tailor Interface. Antes de iniciar o passo 3, gerar (via grep/script, não manualmente) a lista completa de sítios que consomem `req.user.sub` como string legível e decidir, por sítio, se ele precisa de um segundo campo (`req.user.username` ou `req.user.displayName`, resolvido no mesmo lookup do `AccessService`) em vez de continuar lendo `sub` diretamente. Registrar a lista em `ontology/_inbox/auth-supabase-migracao-gap.md` para o `/feature-new` do passo 3 herdar pronta.

- **Resultado Esperado**
  > O `/feature-new` do passo 3 começa com o raio de mudança real (33 arquivos) em vez do raio otimista (1 arquivo) hoje escrito na ADR-0053, reduzindo a chance de regressão silenciosa em `conexosIdentity.ts` (sessão cai pro robô sem aviso) ou na trilha de auditoria (UUID em vez de nome).

- **Tactic alvo**: Tailor Interface
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — é levantamento, não código
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Sítios que tratam `sub` como username, catalogados: 0 → 33 (32 + `conexosIdentity.ts`)
  - Inbox do passo 3 com a lista pronta: ausente → presente
- **Risco de não fazer**: o passo 3 é subestimado no escopo, reabrindo (silenciosamente) a lacuna "sem vínculo, opera via robô" que a ADR-0051 fechou, desta vez para usuários que TÊM vínculo mas cujo `sub` deixou de casar.
- **Dependências**: nenhuma; é insumo para o `/feature-new` do passo 3, não bloqueia esta feature.

## 6. Notas do agente

- Escopo desta revisão: só os diretórios listados em `_shared-metrics.md` (auth backend + auth frontend); não avaliei `ConexosClient` nem os clients de infra, que estão fora do delta desta feature.
- F-integrability-1 e F-integrability-3 são cross-QA com Modifiability: a mesma duplicação de catálogo (BE/FE) e a mesma suposição `sub == username` espalhada custam tanto em esforço de mudança quanto em risco de integração — o consolidator deve costurar um único card se Modifiability já tiver achado o mesmo ponto.
- Não encontrei axios/fetch cru fora dos clients/wrappers nesta parte do código (backend usa `pg` via repositórios; frontend usa `apiFetch`), então não há finding de "Cross-layer leakage" (item A.3 do plano) para este delta.
- F-integrability-2 tem overlap com Fault Tolerance/Availability (falha do consumidor externo por 403 não tem alarme) — se essa QA já tiver um achado equivalente sobre `kavex-report-ciclo`, mesclar.
