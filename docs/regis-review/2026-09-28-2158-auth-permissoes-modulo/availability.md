---
qa: Availability
qa_slug: availability
run_id: 2026-09-28-2158-auth-permissoes-modulo
agent: qa-availability
generated_at: 2026-09-28T22:30:00-03:00
scope: backend, frontend
score: 6.0
findings_count: 5
cards_count: 4
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista/admin usando qualquer tela autenticada (Permutas, SISPAG, Recebimentos, Métricas, Usuários, Operação) | Uma falha transitória de Postgres/Supabase (blip de rede, pool esgotado — classe de erro já documentada e tratada em `PostgreeDatabaseClient.ts`, ex. `MaxClientsInSessionMode`) ocorre bem no momento em que `resolverAcesso` faz a única consulta de acesso da requisição | `AccessService`/`AccessRepository` (backend), `PermissoesProvider`/`ExigePermissao` (frontend), rota `GET /me/permissoes` | Produção, instância única (Render `plan: starter`), sem infra AWS | Backend deve recusar com segurança (503, fail-closed — I1/D4 da ADR-0053) sem liberar por engano; o front deve deixar claro que é uma indisponibilidade transitória, não uma revogação de acesso, e se recuperar sozinho quando o banco voltar | Medido: 503 correto e logado no backend (`acesso.test.ts:128-145`). NÃO medido / ausente: o front colapsa para "Acesso negado" em 100% das páginas gateadas (7/7, ver §2) sem log e sem novo retry automático — ver F-availability-1 |

Este QA cobre o efeito mais amplo desta feature sobre a disponibilidade: a ADR-0053 troca uma
autorização que não tocava o banco (claim `role` do token) por uma que consulta o Postgres a cada
requisição (com cache de 30 s). Isso é uma decisão de segurança correta e bem documentada (D4/D5 da
ADR) — mas também é, por construção, uma redução de disponibilidade do "read path" de autorização:
antes, uma indisponibilidade do Postgres derrubava só as rotas que liam/escreviam dados de negócio;
depois desta feature, ela derruba **toda rota autenticada**, incluindo o próprio painel de incidentes
(`/operacao`) e a navegação do frontend inteiro. O restante desta seção quantifica esse raio de
blast e como ele se propaga (ou não) até o usuário final.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rotas autenticadas com guard único, cobertas por teste de introspecção | 85/85 | 100% | ✅ | `src/backend/http/routePermissions.test.ts` (citado em `_shared-metrics.md`) |
| Executors (`RetryExecutor`/`FallbackExecutor`/`PollExecutor`) na consulta de acesso por requisição (`AccessService.resolver` → `AccessRepository.findAccessBySub`) | 0 | ≥1 (retry curto antes do fail-closed) | ⚠️ | `grep -rl "RetryExecutor\|FallbackExecutor\|PollExecutor" src/backend/http src/backend/domain/{service,repository}/auth` → vazio |
| Conexão com o banco (`PostgreeDatabaseClient.init`) já usa `RetryExecutor` (5 tentativas) — mas só na abertura do pool, não por query | 5 tentativas / 2000 ms de delay, só no `init()` | N/A (pré-existente, fora do delta) | ⚠️ parcial (não cobre a query em si) | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:94-98` |
| Tamanho do pool de conexões compartilhado por TODA leitura/escrita, incluindo a nova checagem por requisição | `poolMaxConnections = 5` | — (referência: com cache de 30 s e ~15 usuários, carga adicional é desprezível, conforme a própria ADR) | ⚠️ Não é regressão de carga (ADR já mede isso como desprezível); é regressão de acoplamento — ver F-availability-2 | `PostgreeDatabaseClient.ts:37` |
| Páginas de topo (uma por frente) que colapsam para "Acesso negado" em QUALQUER falha de `GET /me/permissoes` (503, timeout, erro de rede, CORS) | 7/7 (`metricas`, `permutas`, `permutas/borderos`, `permutas/clientes-filtro`, `sispag`, `recebimentos`, `usuarios`) | 0 páginas devem tratar "indisponível" como "negado" | ⚠️ | `grep -rln "<ExigePermissao" src/frontend/app` → 7 arquivos; `src/frontend/components/auth/ExigePermissao.tsx:22-34` |
| Retry automático do front após falha de `/me/permissoes` | 0 (só refaz a consulta se o token mudar; recuperação exige reload manual da página) | ≥1 retry com backoff curto antes de assumir "sem permissão" | ❌ | `src/frontend/lib/auth/PermissoesProvider.tsx:63-76` |
| Log da falha de `/me/permissoes` no cliente | 0 (catch silencioso, nem `console.warn`) | ≥1 (mesmo nível de disciplina do backend, que sempre loga via `LogService`) | ❌ | `src/frontend/lib/auth/PermissoesProvider.tsx:70` vs. `src/backend/http/acesso.ts:134-148` |
| `/operacao` (painel citado no próprio código como "a tela que se consulta durante um incidente") depende da mesma checagem de banco que pode estar causando o incidente | Sim — montado depois de `resolverAcesso` | Painel de incidente deveria sobreviver à classe de falha que ele existe para diagnosticar | ❌ | `src/backend/http/buildApp.ts:124-167` |
| Guardas de transição de estado em escritas de acesso (último gestor, auto-remoção, auto-desativação) | 3 guardas, testadas 10/10 ao vivo em corrida concorrente | 0% de corridas que zerem os gestores | ✅ | ADR-0053 §D6; `_shared-metrics.md` § "Repositório ao vivo" |
| Idempotência das escritas de acesso (`setRole`, `replaceExceptions`) | Mesmo papel / mesmo conjunto de exceções = no-op, sem `UPDATE`, sem evento | Toda escrita de estado idempotente | ✅ | `AccessRepository.ts:230-268, 274-315` |
| Migration 0066 — idempotência e guarda pré-DDL | Confirmada ao vivo (rodar 2x não falha/duplica); guarda aborta com mensagem em português se houver `role ≠ 'admin'` antes de qualquer DDL | Migration segura de reaplicar | ✅ | `_shared-metrics.md` § "Validação ao vivo"; `0066_auth_permissoes_modulo.sql:29-41` |
| Alarmes/dashboard sobre o novo 503 de `resolverAcesso` | — | — | N/A | Não existe `infra/`/CloudWatch neste repositório (Render/Vercel) |
| DLQ em filas SQS | — | — | N/A | Não existe SQS/infra neste delta nem no repositório |

> ⚠️ **Não medível localmente**: frequência real, em produção, da classe de erro que `PostgreeDatabaseClient` já trata como transitória (`'too many clients'`/`MaxClientsInSessionMode`) e o MTTR de um 503 sustentado de `resolverAcesso`. Requer logs do Render/Supabase fora deste repositório. Recomendação: instrumentar uma contagem de `LOG_TYPE.FLOW_ERROR` com a mensagem `'falha ao verificar permissões do usuário'` (já emitida em `acesso.ts:136-145`) e um alerta externo (UptimeRobot/Render health-check) sobre uma taxa sustentada de 503 em qualquer rota autenticada — hoje esse log existe mas não alimenta nenhum painel.

## 3. Tactics — Cobertura no financeiro (delta `auth-permissoes-modulo`)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Detect Faults** | | | |
| Ping/Echo | N/A — não há serviço remoto próprio a este delta que exija ping ativo | N/A | — |
| Heartbeat | `/health`, pré-existente, não tocado pelo delta; permanece público e fora de `resolverAcesso` | PRÉ-EXISTENTE | `src/backend/http/buildApp.ts:89-104` |
| Monitor | `LogService.error`/`.warn` chamados nos pontos novos de decisão (falha de acesso, permissão fora do catálogo, mudança de papel/exceção/ativo) | ✅ presente (backend) / ❌ ausente (frontend, ver F-availability-4) | `acesso.ts:136-145`; `AccessService.ts:75-81`; `PermissoesProvider.tsx:70` |
| Timestamp | `app_user_access_event.em` grava `now()` em cada mudança de acesso | ✅ presente | `0066_auth_permissoes_modulo.sql:80-91` |
| Sanity Checking | Zod na borda (`accessRowSchema`/`roleRowSchema`); `CHECK` no banco sobre os valores de permissão; `EffectivePermissionCalculator` descarta (sem lançar) valores fora do catálogo | ✅ presente | `AccessRepository.ts:123-138`; `0066_...sql:55-72`; `EffectivePermissionCalculator.ts:40-53` |
| Condition Monitoring | `routePermissions.test.ts` confere, por introspecção do `router.stack`, que toda rota montada tem exatamente 1 guard — falha nomeando a rota se divergir | ✅ presente | `src/backend/http/routePermissions.test.ts` |
| Voting | N/A — instância única, sem réplicas votantes | N/A | — |
| Exception Detection | `resolverAcesso` distingue explicitamente: sem `sub` → 401; inexistente/inativo → 401; erro do repositório → 503; cada caminho testado individualmente | ✅ presente | `acesso.ts:117-160`; `acesso.test.ts:94-145` |
| Self-Test | Nenhum self-test de boot específico deste delta (ex.: checar no boot se o papel `Administrador` existe antes de aceitar tráfego) — a falta só aparece no primeiro `POST /usuarios` sem `role_id`, ou no `seed-admin`, que trata isso explicitamente | ⚠️ parcial | `SeedAdminConfig.ts:51-63` (trata no job) vs. nenhuma checagem equivalente no boot do servidor web |
| **Recover from Faults — Preparation & Repair** | | | |
| Active Redundancy | N/A — instância única (Render `plan: starter`, sem `numInstances`), risco já documentado na própria ADR (D4) | N/A | ADR-0053 §D4 "Ressalva de instâncias" |
| Passive Redundancy | ❌ ausente para o caso específico do `/operacao`: não há fonte secundária (ex.: claim `role` do token, ainda emitido por compatibilidade) para manter o painel de incidente no ar quando a fonte primária (Postgres) falha | ❌ ausente | `buildApp.ts:124-167`; ver F-availability-3 |
| Spare | N/A — mesma razão de Active Redundancy | N/A | — |
| Exception Handling | `resolverAcesso` sempre responde e sempre loga (com fallback best-effort se o próprio log falhar); erros de domínio (`LastUserManagerError`, `SelfAccessRemovalError`, `AdminRoleMissingError`) mapeados para HTTP/mensagem específica | ✅ presente | `acesso.ts:131-151`; `AccessRepository.ts:359-370`; `SeedAdminConfig.ts:51-63` |
| Rollback | Escritas de acesso são atômicas dentro de `withTransaction` (sem estado "meio-feito"); migration 0066 tem rollback script dedicado, com `\copy` para exportar a trilha antes de derrubar as tabelas | ✅ presente | `AccessRepository.ts:230-315`; `migrations/rollbacks/0066_auth_permissoes_modulo.rollback.sql` |
| Software Upgrade | Migration 0066 idempotente (`IF NOT EXISTS`/`ON CONFLICT DO NOTHING`), com guarda pré-DDL que aborta em vez de especular; aplicação serializada por advisory lock no boot (pré-existente, `BootMigrator`) | ✅ presente | `0066_...sql:29-41`; `src/backend/migrations/BootMigrator.ts:119-150` |
| Retry | Presente na abertura do pool de conexão (pré-existente, 5 tentativas); AUSENTE na consulta de acesso por requisição em si — uma falha de query único (não de conexão) vai direto a 503, sem 1 nova tentativa | ⚠️ parcial | `PostgreeDatabaseClient.ts:94-98` (presente, mas não cobre a query); `AccessService.ts:62-92` / `acesso.ts:131-151` (ausente na query); ver F-availability-2 |
| Ignore Faulty Behavior | `EffectivePermissionCalculator` tolera e ignora valores de permissão fora do catálogo sem lançar (✅); mas o front trata QUALQUER falha de `/me/permissoes` (503, rede, CORS) de forma indistinguível de "sem permissão", sem sinalizar degradação | ⚠️ parcial | `EffectivePermissionCalculator.ts:40-53` (bom); `PermissoesProvider.tsx:78-87` (ruim); ver F-availability-1 |
| Degradation | ❌ ausente para o novo acoplamento: uma falha do Postgres não degrada para um modo mais restrito/somente-leitura ou para o último estado conhecido além do TTL — degrada direto para 503 total (backend) e "Acesso negado" total (frontend). O fail-closed é uma escolha de segurança correta (D4/D5 da ADR), mas não há um degrau intermediário entre "tudo" e "nada" | ❌ ausente | `AccessService.ts:62-92` (sem grace window pós-TTL); `ExigePermissao.tsx:22-34` |
| Reconfiguration | `DEV_AUTH_BYPASS` troca o modo de autorização inteiro sem redeploy do código (só variável de ambiente); fallback legado do front (D4 da ADR) se adapta a um backend anterior sem novo deploy do front | ✅ presente | `acesso.ts:108-123`; `PermissoesProvider.tsx:42-49` |
| **Recover from Faults — Reintroduction** | | | |
| Shadow | N/A — não há ambiente shadow/canário neste stack | N/A | — |
| State Resynchronization | Toda escrita de acesso feita pela tela chama `invalidar(userId)` DEPOIS do commit da transação — a próxima requisição do alvo relê o banco em vez de servir o cache velho | ✅ presente | `UserAdminService.ts:241,271,310,389,396` (todas após `await this.accessRepository.*`/`this.userRepository.*` retornarem) |
| Escalating Restart | N/A — Render reinicia o processo inteiro; não há granularidade de subsistema | N/A | — |
| Non-Stop Forwarding | N/A — API Express monolítica, sem plano de controle separado | N/A | — |
| **Prevent Faults** | | | |
| Removal from Service | Guarda "último usuário com `usuarios:gerenciar` efetivo" impede remover do serviço o único operador capaz de destravar o sistema de gestão de acesso | ✅ presente | `AccessRepository.ts:317-371` (`lockAndCheck`, R9/R-extra) |
| Transactions | `lockAndCheck` roda DENTRO da transação da escrita, com `FOR UPDATE` ordenado nos usuários ativos antes de ler o alvo — checagem e escrita atômicas, sem janela de corrida (verificado 10/10 ao vivo) | ✅ presente | `AccessRepository.ts:332-372`; `_shared-metrics.md` |
| Predictive Model | Nenhum neste delta (nem no restante do repo) | ❌ ausente | — |
| Exception Prevention | Zod nos boundaries; `CHECK` no banco espelhando o catálogo do código (teste compara os dois lados); `loadAuthEnv` derruba o boot se `DEV_AUTH_BYPASS=true` chegar fora de local/dev; migration aborta antes de qualquer DDL se achar estado inesperado | ✅ presente | `AccessRepository.ts:123-138`; `0066_...sql:55-72` + `0066_auth_permissoes_modulo.test.ts`; `authEnv.ts:89-99`; `0066_...sql:29-41` |
| Increase Competence Set | N/A — não há mecanismo de aprendizado/adaptação neste delta | N/A | — |

## 4. Findings (achados)

### F-availability-1: Falha de `/me/permissoes` colapsa 100% das páginas de topo para "Acesso negado", sem log e sem retry

- **Severidade**: P1
- **Tactic violada**: Ignore Faulty Behavior / Degradation (falha tratada como negação definitiva, não como indisponibilidade transitória)
- **Localização**: `src/frontend/lib/auth/PermissoesProvider.tsx:63-87`, `src/frontend/lib/permissoes.ts:66-68`, `src/frontend/components/auth/ExigePermissao.tsx:22-34`
- **Evidência (objetiva)**:
  ```tsx
  // PermissoesProvider.tsx:63-76
  fetchMinhasPermissoes()
    .then((dados) => { if (vivo) setResposta({ token, dados }) })
    .catch(() => {
      if (vivo) setResposta({ token, dados: null })   // sem log, sem retry
    })
  ```
  ```tsx
  // ExigePermissao.tsx:32
  if (!tem(permissao)) return <AcessoNegado />
  ```
  `grep -rln "<ExigePermissao" src/frontend/app` → 7 arquivos (`metricas`, `permutas`, `permutas/borderos`,
  `permutas/clientes-filtro`, `sispag`, `recebimentos`, `usuarios`), ou seja, **toda** página de topo do
  produto. O próprio teste do provider documenta o comportamento como intencional: `erro: conjunto
  vazio (fail-closed), sem quebrar a tela` (`src/frontend/__tests__/auth/permissoes-provider.test.tsx:102`)
  — mas para uma página inteira sob `<ExigePermissao>`, "sem quebrar a tela" na prática substitui a
  tela inteira por "Acesso negado".
- **Impacto técnico**: qualquer falha de `GET /me/permissoes` — o 503 fail-closed do próprio `resolverAcesso` (D4 da ADR-0053), um timeout de rede, ou uma regressão de CORS — é indistinguível, do ponto de vista do usuário, de "você perdeu o acesso". Não há retry automático: o `useEffect` só reconsulta quando o `token` muda, então a recuperação depende de o usuário recarregar a página manualmente depois que o backend volta.
- **Impacto de negócio**: durante qualquer degradação breve do Postgres (a classe de erro que o próprio `PostgreeDatabaseClient` já trata como recorrente), todo analista logado em qualquer uma das 3 frentes vê "Acesso negado" em vez de uma mensagem de indisponibilidade — risco de pânico/ticket de suporte em massa ("perdi acesso a tudo") durante um incidente que, no backend, já estava corretamente sinalizado como transitório.
- **Métrica de baseline**: 7/7 páginas de topo gateadas por `<ExigePermissao>` tratam erro de rede/503 = negação; 0 delas mostram um estado "indisponível, tente novamente" distinto de "sem permissão".

### F-availability-2: Nenhum retry na consulta de acesso por requisição — um erro de query único vira 503 imediato para toda rota autenticada

- **Severidade**: P1
- **Tactic violada**: Retry
- **Localização**: `src/backend/domain/service/auth/AccessService.ts:62-92`, `src/backend/http/acesso.ts:108-161`
- **Evidência (objetiva)**: `grep -rl "RetryExecutor\|FallbackExecutor\|PollExecutor" src/backend/http src/backend/domain/service/auth src/backend/domain/repository/auth` não retorna nenhum arquivo. `AccessService.resolver` chama `this.accessRepository.findAccessBySub(sub)` uma única vez; qualquer rejeição propaga direto para o `catch` de `resolverAcesso`, que responde 503 sem segunda tentativa (`acesso.ts:131-151`). O `RetryExecutor` existente no projeto (`PostgreeDatabaseClient.ts:94-98`, 5 tentativas) só cobre a ABERTURA do pool de conexão, não uma falha de query já com pool aberto.
- **Impacto técnico**: antes da ADR-0053, autorização vinha só do claim `role` do token — zero dependência de banco por requisição. Depois dela, TODA rota autenticada (Permutas, SISPAG, Recebimentos, Métricas, Usuários e o próprio `/operacao`) depende de uma consulta ao Postgres bem-sucedida a cada 30 s de cache frio, sem nenhuma tentativa extra antes do fail-closed. Uma falha de rede de um único round-trip — não uma indisponibilidade sustentada do banco — já é suficiente para negar a requisição.
- **Impacto de negócio**: aumenta a superfície que uma falha transitória do Postgres (classe já documentada como recorrente neste código, `PostgreeDatabaseClient.ts:110-116`, "too many clients"/`MaxClientsInSessionMode`) precisa para derrubar visivelmente o produto inteiro, em vez de só a query específica que a encontrou.
- **Métrica de baseline**: 0 arquivos com Executor na cadeia `resolverAcesso → AccessService → AccessRepository`; `poolMaxConnections = 5` (`PostgreeDatabaseClient.ts:37`) compartilhado entre essa nova consulta e toda leitura/escrita de negócio.

### F-availability-3: `/operacao` — o painel de incidente — depende da mesma checagem de banco que pode estar causando o incidente

- **Severidade**: P1
- **Tactic violada**: Passive Redundancy (ausência de fonte secundária de autorização para uma rota de diagnóstico)
- **Localização**: `src/backend/http/buildApp.ts:124-167`
- **Evidência (objetiva)**:
  ```ts
  // buildApp.ts:127
  app.use(resolverAcesso({ devBypass: authEnv.devBypass }));
  ...
  // buildApp.ts:163-167
  // Painel de Operação (ADR-0042) — saúde dos pipelines, alertas e diagnóstico de configuração.
  // NÃO leva `heavyRouteLimiter`: é a tela que se consulta durante um incidente...
  app.use('/operacao', operacaoRouter);
  ```
  `/operacao` está montado DEPOIS de `resolverAcesso` — herda o 503 fail-closed. Antes desta ADR, o gate de `/operacao` era `requireOperacaoAcesso()` sobre o allow-list `OPERACAO_USUARIOS`, que só lia o claim do token (sem tocar o banco); a ADR-0053 o substitui por `operacao:ver`, resolvido pela mesma consulta ao Postgres (D10 da ADR-0053, ontology/decisions/0053...: "OPERACAO_USUARIOS, requireOperacaoAcesso() e http/operacaoAcesso.ts saem").
- **Impacto técnico**: a classe de incidente mais provável de acionar o fail-closed (degradação do Postgres) é exatamente a classe que o `/operacao` foi desenhado para diagnosticar. Com o Postgres degradado, o operador não consegue abrir o painel para confirmar/diagnosticar — precisa recorrer direto aos logs brutos do Render.
- **Impacto de negócio**: aumenta o MTTR percebido de qualquer incidente de banco: a ferramenta de primeira resposta fica indisponível justamente quando mais necessária. Não é um caso hipotético isolado — é uma contradição direta com o comentário que descreve o propósito da rota no próprio código.
- **Métrica de baseline**: `/health` e `/health/pipelines` continuam públicos (não afetados, mounted antes de `resolverAcesso` — `buildApp.ts:98-109`), mas `/operacao` — a única tela com contexto humano para diagnóstico — não tem a mesma garantia.

### F-availability-4: Catch silencioso no frontend, sem log, para a mesma falha que o backend sempre loga

- **Severidade**: P2
- **Tactic violada**: Exception Detection
- **Localização**: `src/frontend/lib/auth/PermissoesProvider.tsx:70`
- **Evidência (objetiva)**: `.catch(() => { if (vivo) setResposta({ token, dados: null }) })` — nenhum `console.warn`/telemetria. Comparar com o backend, que SEMPRE loga a mesma classe de falha via `LogService.error` com `requestId` (`acesso.ts:134-148`).
- **Impacto técnico**: uma falha sustentada de `/me/permissoes` (CORS quebrado após um deploy do front antes do back, ou uma degradação prolongada do Postgres) não deixa nenhum rastro no lado do cliente — só é detectável pelo log do backend (se alguém estiver olhando) ou por reclamação do usuário.
- **Impacto de negócio**: baixo isoladamente, mas soma-se a F-availability-1/2/3: reduz ainda mais a chance de o time perceber, pelo telemetria de frontend, que está em curso o cenário descrito no §1.
- **Métrica de baseline**: 1 catch sem log identificado no caminho crítico deste delta (`PermissoesProvider.tsx:70`), contra 100% de cobertura de log no caminho equivalente do backend (`acesso.ts:134-148`).

### F-availability-5: Guardas de concorrência e transações — tactic presente (achado positivo)

- **Severidade**: — (achado positivo, não gera card)
- **Tactic violada**: nenhuma — Transactions / Removal from Service / Sanity Checking presentes
- **Localização**: `src/backend/domain/repository/auth/AccessRepository.ts:317-372`
- **Evidência (objetiva)**: `lockAndCheck` trava (`FOR UPDATE`, ordenado por id) todos os usuários ativos ANTES de ler o alvo, dentro da mesma transação da escrita, e recusa (`SelfDeactivationError`/`SelfAccessRemovalError`/`LastUserManagerError`) antes de qualquer `UPDATE`. Verificado ao vivo: 10/10 corridas concorrentes de dois gestores tentando se desativar mutuamente resultaram em exatamente 1 sucesso + 1 rejeição (`_shared-metrics.md`).
- **Impacto técnico**: nenhum — é o comportamento correto, e a única guarda de concorrência real deste domínio (gestão de acesso) está bem coberta.
- **Impacto de negócio**: positivo — elimina o cenário "zero gestores ativos", que travaria a própria tela usada para consertar o problema.
- **Métrica de baseline**: 10/10 corridas corretas ao vivo (Postgres descartável); 27/27 checagens de `AccessRepository`/`UserRepository` reais, conforme `_shared-metrics.md`.

## 5. Cards Kanban

### [availability-1] Distinguir "serviço indisponível" de "sem permissão" no frontend, com retry curto

- **Problema**
  > `PermissoesProvider` trata qualquer falha de `GET /me/permissoes` (503, timeout, erro de rede) exatamente como "usuário sem nenhuma permissão" (`src/frontend/lib/auth/PermissoesProvider.tsx:70-87`), e as 7 páginas de topo do produto (`grep -rln "<ExigePermissao" src/frontend/app`) renderizam "Acesso negado" em tela cheia nesse caso, sem log e sem nova tentativa automática — só um reload manual recupera.

- **Melhoria Proposta**
  > Adicionar um terceiro estado ao `PermissoesContextValue` (`indisponivel: boolean`, distinto de `carregando`/permissões vazias); `ExigePermissao` renderiza uma tela de "não foi possível verificar suas permissões, tentando novamente..." em vez de `AcessoNegado` quando `indisponivel = true`. Acoplar um retry curto (1-2 tentativas com backoff, ex. 2s/5s) em `fetchMinhasPermissoes` antes de marcar como indisponível. Tactic: **Ignore Faulty Behavior** / **Degradation**.

- **Resultado Esperado**
  > Uma falha transitória de `/me/permissoes` (ex.: um 503 isolado de `resolverAcesso`) se resolve sozinha em segundos, sem o usuário ver "Acesso negado"; só uma falha sustentada (após as tentativas) mostra o estado de indisponibilidade, textualmente distinto de negação de permissão. Métrica: páginas que distinguem "indisponível" de "negado" — 0/7 → 7/7.

- **Tactic alvo**: Ignore Faulty Behavior / Degradation
- **Severidade**: P1
- **Esforço estimado**: M (2-5d) — toca `PermissoesProvider`, `ExigePermissao`, `AcessoNegado` e os testes das 7 páginas
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Páginas com estado "indisponível" distinto de "negado": 0/7 → 7/7
  - Retries automáticos antes de marcar indisponível: 0 → ≥1
- **Risco de não fazer**: qualquer degradação breve do Postgres (classe já documentada como recorrente em `PostgreeDatabaseClient.ts`) gera a aparência de perda total de acesso para todo usuário logado, em toda tela, até um reload manual — risco de pânico e tickets de suporte durante um incidente que o backend já classificou corretamente como transitório.
- **Dependências**: nenhuma.

### [availability-2] Retry curto na consulta de acesso por requisição antes do fail-closed

- **Problema**
  > `AccessService.resolver` faz uma única tentativa de `AccessRepository.findAccessBySub`; qualquer rejeição (erro de query, não necessariamente indisponibilidade sustentada) vai direto a 503 em `resolverAcesso` (`src/backend/http/acesso.ts:131-151`), sem nenhum Executor (`RetryExecutor`/`FallbackExecutor`) no caminho — diferente da abertura do pool de conexão, que já tem retry (`PostgreeDatabaseClient.ts:94-98`).

- **Melhoria Proposta**
  > Envolver a chamada a `accessRepository.findAccessBySub` num `RetryExecutor` com 1-2 tentativas e delay curto (ex.: 100-300ms) antes de propagar o erro para o fail-closed — usando o primitivo já existente no projeto (`src/backend/domain/libs/executor/RetryExecutor.ts`), sem mudar a semântica de fail-closed quando as tentativas se esgotarem. Tactic: **Retry**.

- **Resultado Esperado**
  > Uma falha de rede de um único round-trip (não uma indisponibilidade sustentada do banco) deixa de virar 503 visível; só uma falha persistente através das tentativas continua fail-closed, como hoje. Métrica: chamadas de `findAccessBySub` com retry — 0 → 1 (`RetryExecutor` envolvendo a chamada).

- **Tactic alvo**: Retry
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Executors na cadeia `resolverAcesso → AccessService → AccessRepository`: 0 → 1
- **Risco de não fazer**: uma falha de rede pontual num único round-trip ao Postgres — não uma indisponibilidade real do banco — já é suficiente para negar toda requisição autenticada do sistema, ampliando desnecessariamente a superfície de um fail-closed que deveria reagir só a degradação sustentada.
- **Dependências**: nenhuma.

### [availability-3] Dar ao `/operacao` uma via de acesso que sobrevive à degradação do Postgres

- **Problema**
  > `/operacao` — o próprio comentário do código o descreve como "a tela que se consulta durante um incidente" (`src/backend/http/buildApp.ts:163-167`) — está montado depois de `resolverAcesso` (`buildApp.ts:127`) e por isso herda o mesmo 503 fail-closed de qualquer outra rota quando o Postgres degrada. Antes da ADR-0053, o gate de `/operacao` (`requireOperacaoAcesso`) só lia o claim do token, sem tocar o banco.

- **Melhoria Proposta**
  > Dar ao guard de `operacao:ver` especificamente um fallback: se `resolverAcesso` falhar por erro do repositório (não por usuário inexistente/inativo), permitir a leitura de `/operacao` para quem tem `role: 'admin'` no claim do token (ainda emitido, por compatibilidade — D3/D12 da ADR-0053), com log explícito de que o fallback foi usado. Usar o primitivo `FallbackExecutor` já existente no projeto para modelar "tenta o banco, se falhar cai no claim do token só para esta rota". Tactic: **Passive Redundancy**.

- **Resultado Esperado**
  > O painel de incidente permanece acessível durante uma degradação do Postgres que não seja causada por dado de usuário (inexistente/inativo) — exatamente o cenário em que ele é mais necessário. Métrica: `/operacao` acessível durante um `AccessRepository` indisponível — hoje não (503) → sim (fallback pelo claim do token, logado).

- **Tactic alvo**: Passive Redundancy
- **Severidade**: P1
- **Esforço estimado**: S (≤1d) — restrito à rota `/operacao`, não muda o restante do modelo de autorização
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - `/operacao` disponível quando `AccessRepository.findAccessBySub` falha: não → sim (via fallback logado)
- **Risco de não fazer**: a ferramenta de primeira resposta do time fica indisponível justamente durante a classe de incidente mais provável de acioná-la, aumentando o MTTR percebido de qualquer degradação do Postgres.
- **Dependências**: nenhuma. Reavaliar quando o passo 3 (Supabase Auth) remover o claim `role` do token (D12 da ADR-0053) — o fallback precisa de outra fonte secundária nessa hora.

### [availability-4] Logar a falha de `/me/permissoes` no frontend

- **Problema**
  > `PermissoesProvider.tsx:70` engole qualquer erro de rede/parse com `.catch(() => { ... })`, sem nenhum log — ao contrário do backend, que sempre loga a mesma classe de falha via `LogService.error` com `requestId` (`acesso.ts:134-148`).

- **Melhoria Proposta**
  > Trocar o catch silencioso por um `console.warn` (ou telemetria de frontend, se existir) com o erro e o `token` (sem vazar dado sensível), sem mudar o comportamento de fail-closed. Tactic: **Exception Detection**.

- **Resultado Esperado**
  > Uma falha sustentada de `/me/permissoes` deixa rastro no console do navegador, útil para suporte/triagem, sem mudar o comportamento visual atual. Métrica: catches silenciosos no caminho crítico de permissões — 1 → 0.

- **Tactic alvo**: Exception Detection
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Catches sem log em `PermissoesProvider.tsx`: 1 → 0
- **Risco de não fazer**: baixo isoladamente; some ao déficit de visibilidade que agrava a detecção do cenário de F-availability-1/2/3.
- **Dependências**: nenhuma. Pode ser feito junto com `availability-1`.

## 6. Notas do agente

- Escopo `--quick`: sem carga real/produção, os números de "desprezível" da própria ADR (uma consulta a mais por usuário a cada 30s) não foram contestados — o achado central deste QA é sobre **acoplamento/blast radius** de uma falha rara, não sobre volume de tráfego.
- F-availability-1/2/3 descrevem a MESMA causa raiz (novo acoplamento de toda autorização ao Postgres, sem grau intermediário entre "tudo" e "nada") vista em três camadas (frontend, backend, painel de operação) — o consolidator pode preferir um card único de "graceful degradation do acesso" se preferir consolidar `availability-1/2/3`.
- Cross-QA: F-availability-3 tem sobreposição direta com qualquer achado de `qa-fault-tolerance` sobre `buildApp.ts`/ordem de middlewares — sinalizar para não duplicar o card.
- Frequência real de degradação do Postgres em produção e MTTR de um 503 sustentado não são medíveis localmente (sem CloudWatch/infra) — ver nota na seção 2.
