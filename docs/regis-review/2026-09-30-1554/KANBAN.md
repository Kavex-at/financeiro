---
type: regis-review-kanban
run_id: 2026-09-30-1554
total: 28
counts: { p0: 0, p1: 1, p2: 19, p3: 8 }
---

# Kanban — financeiro — 2026-09-30-1554

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3. Dentro do mesmo esforço, ordem alfabética do ID.
> Escopo: `--quick`, feature `auth-supabase` (ADR-0056). Não há cards P0 neste ciclo.

---

## P0 — Crítico

_Nenhum card neste nível._

---

## P1 — Alto

### [availability-1] Distinguir indisponibilidade de expiração na renovação de sessão do front

**QA**: Availability
**Tactic alvo**: Degradation
**Esforço**: S
**Findings**: F-availability-1, F-availability-5

**Problema**
> `refreshSession` devolve `null` para qualquer `!res.ok` ou exceção, então 503 (GoTrue fora) e 429 viram "Sessão expirada" e abrem o modal de relogin, embora o refresh token siga válido.

**Melhoria Proposta**
> Tactic Degradation: só 401 do `/auth/refresh` encerra a sessão. Em 503/429/erro de rede, manter a sessão, repetir a renovação com backoff curto (ex.: 2 tentativas, 1 s e 3 s) e, esgotadas, propagar o erro original da requisição em vez de `SessionExpiredError`. Adicionar `AbortSignal.timeout` ao `fetch`. Tocar `lib/auth/session-refresh.ts` e `lib/http.ts`; cobrir em `__tests__/auth/api-fetch-refresh.test.ts`.

**Resultado Esperado**
> Um blip do GoTrue ou do Render não derruba sessão válida. Modais de sessão expirada por falha transitória: hoje 100% dos casos → 0.

**Métricas de sucesso**
- Códigos de indisponibilidade distinguidos de 401: 0 de 2 → 2 de 2
- Timeout no `fetch` de refresh: 0/1 → 1/1

**Risco de não fazer**
> cada instabilidade do Supabase vira relogin em massa dos analistas no meio do trabalho de alocação/lote.

**Dependências**: nenhuma

---

## P2 — Médio

### [availability-3] Formalizar e ensaiar o fallback de login para `AUTH_PROVIDER=local`

**QA**: Availability
**Tactic alvo**: Reconfiguration
**Esforço**: S
**Findings**: F-availability-2

**Problema**
> O GoTrue é ponto único de falha para novos logins; o único contorno é editar env e redeployar, sem tempo medido nem ensaio.

**Melhoria Proposta**
> Tactics Spare / Reconfiguration: documentar o critério de acionamento (ex.: 503 de login por mais de 10 min), ensaiar o rollback em dev medindo o tempo e avaliar como trocar o valor sem redeploy completo (`modoAtual()` já lê o env a cada requisição; falta o mecanismo operacional). Manter o hash local.

**Resultado Esperado**
> Tempo de restauração do login com o GoTrue fora conhecido e ≤ 15 min. Hoje: não medido.

**Métricas de sucesso**
- Tempo de rollback de login: não medido → registrado, ≤ 15 min

**Risco de não fazer**
> numa queda longa do Supabase, o time improvisa o rollback sob pressão.

**Dependências**: nenhuma

---

### [deployability-1] Tornar o rollback de código à prova da armadilha D14

**QA**: Deployability
**Tactic alvo**: Package Dependencies
**Esforço**: S
**Findings**: F-deployability-1

**Problema**
> O rollback de deploy no Render com `SUPABASE_URL` definida desloga todos os usuários (12 hoje), e a única proteção é um aviso em texto no DEPLOY.md.

**Melhoria Proposta**
> Tactic Package Dependencies: colocar um checklist "antes de qualquer Rollback do Render" no topo da seção 6 (não só na tabela) e um teste de contrato que fixe a aceitação de tokens HS256 sem `iss` na versão de transição. Avaliar tornar o verificador tolerante para eliminar a dependência de ordem.

**Resultado Esperado**
> Rollback seguro sem conhecimento tácito: guardas contra D14 de 0 para 1.

**Métricas de sucesso**
- Guardas contra D14: 0 → 1

**Risco de não fazer**
> um rollback apressado durante incidente desloga toda a operação financeira.

**Dependências**: nenhuma

---

### [fault-tolerance-1] Agendar o `sync-supabase-auth` e alertar em `AUTH_DIVERGENCIA`

**QA**: Fault Tolerance
**Tactic alvo**: Reintroduction (State Resync) + Condition Monitoring
**Esforço**: S
**Findings**: F-fault-tolerance-2

**Problema**
> O sync que repara ban, e-mail e vínculo é manual e sem scheduler; a divergência só existe como linha de log. Há 6 workflows de job no repo e nenhum cobre isto.

**Melhoria Proposta**
> Criar workflow GH Actions diário rodando `job:sync-supabase-auth -- --execute` (padrão de `reaper-sispag.yml`; atenção ao gotcha de secrets e env estreito dos crons), com saída ≠ 0 falhando o run. Alerta por contagem de `AUTH_DIVERGENCIA` nas últimas 24 h (ex.: Painel Operação). Tactic: State Resync + Condition Monitoring.

**Resultado Esperado**
> Divergência reparada em ≤ 24 h sem intervenção humana; execuções agendadas 0 → 1/dia; alertas 0 → 1.

**Métricas de sucesso**
- Jobs de reparo agendados: 0 → 1
- Idade máxima de um ban pendente: indefinida → ≤ 24 h

**Risco de não fazer**
> em 6 meses, desativados acumulam sem ban no GoTrue e uma reversão de `AUTH_PROVIDER` ou outro consumidor do projeto expõe contas que deveriam estar cortadas.

**Dependências**: nenhuma

---

### [fault-tolerance-2] Registrar divergência quando a escrita no GoTrue expira com resultado incerto

**QA**: Fault Tolerance
**Tactic alvo**: Comparison / Condition Monitoring
**Esforço**: S
**Findings**: F-fault-tolerance-1

**Problema**
> Em timeout, a escrita pode ter sido aplicada no GoTrue; o rollback local ocorre sem `AUTH_DIVERGENCIA`, e a senha não é reconciliada pelo sync.

**Melhoria Proposta**
> Em `CredentialMirror.atualizar/criarEVincular`, capturar `SupabaseAuthUnavailableError` com reason `timeout` e marcar o estado como "incerto" para `aposFalha` logar operação e ids. Orientar no runbook (DEPLOY.md §6) redefinir a senha quando o log aparecer; documentar que senha não é reconciliável. Tactic: Comparison.

**Resultado Esperado**
> 100% dos timeouts de escrita rastreáveis (hoje 0 de 5 operações registram) e ação de suporte definida.

**Métricas de sucesso**
- Timeouts de escrita com log de divergência: 0% → 100%

**Risco de não fazer**
> divergência de senha sem rastro, investigada às cegas.

**Dependências**: nenhuma

---

### [integrability-1] Gravar fixtures reais do GoTrue e adicionar smoke de contrato

**QA**: Integrability
**Tactic alvo**: Contract testing
**Esforço**: S
**Findings**: F-integrability-1

**Problema**
> Os testes do `SupabaseAuthClient` validam os schemas Zod só contra JSON escrito à mão; uma mudança do GoTrue passaria despercebida até o login falhar em produção.

**Melhoria Proposta**
> Contract testing: capturar (sem segredos) respostas de `/token`, `/admin/users` e erros 4xx/422 num projeto de teste, guardar em `__fixtures__/` e rodar os schemas contra elas; adicionar um smoke opcional em `jobs/` (probe).

**Resultado Esperado**
> Mudança de contrato detectada em CI/probe: fixtures reais 0 → ≥ 4; smoke 0 → 1.

**Métricas de sucesso**
- fixtures reais: 0 → ≥ 4
- smoke de contrato: 0 → 1

**Risco de não fazer**
> quebra silenciosa no primeiro upgrade do GoTrue, descoberta pelo usuário no login.

**Dependências**: projeto Supabase de teste

---

### [modifiability-1] Extrair a resolução do provider de auth para um ponto único

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services / Defer Binding
**Esforço**: S
**Findings**: F-modifiability-1

**Problema**
> `routes/auth.ts`, `http/acesso.ts` e `AdminSeeder.ts` decidem legado x Supabase com `if` próprio (4 pontos). Remover ou trocar o emissor exige caçar cada ramo.

**Melhoria Proposta**
> Definir `SessionProviderInterface` (`login`, `logout`, `refresh`) implementada por `AuthService` e `SupabaseSessionService`, com fábrica única que lê `authProvider` (Defer Binding + Abstract Common Services). Rotas dependem só da interface.

**Resultado Esperado**
> Pontos de ramificação por provider: 4 -> 1. Remoção do legado toca 1 fábrica + 1 classe.

**Métricas de sucesso**
- Pontos `if provider`: 4 -> 1

**Risco de não fazer**
> a remoção do modo legado no passo final segue cara e sujeita a ramo esquecido.

**Dependências**: fazer antes da remoção definitiva do legado.

---

### [modifiability-2] Quebrar `resolverAcesso` em funções menores

**QA**: Modifiability
**Tactic alvo**: Refactor
**Esforço**: S
**Findings**: F-modifiability-2

**Problema**
> Middleware com complexidade cognitiva 30 (limite 15), no caminho crítico de toda rota autenticada.

**Melhoria Proposta**
> Extrair `montarChave(user)`, `registrarDivergencia(...)` e `reescreverIdentidade(...)` (Refactor); manter o middleware como orquestrador.

**Resultado Esperado**
> Complexidade 30 -> <= 15; warnings no escopo 1 -> 0, sem mudança de comportamento (testes existentes cobrem).

**Métricas de sucesso**
- Complexidade de `resolverAcesso`: 30 -> <= 15

**Risco de não fazer**
> próxima regra de acesso (ex.: novo emissor) empilha mais ramos numa função já acima do limite.

**Dependências**: nenhuma.

---

### [performance-1] Compartilhar a consulta de acesso em miss concorrente (single-flight)

**QA**: Performance
**Tactic alvo**: Increase Concurrency
**Esforço**: S (≤1d)
**Findings**: F-performance-1

**Problema**
> `AccessService.resolver` não deduplica leituras concorrentes na mesma chave. Ao expirar o TTL, as chamadas paralelas de uma tela viram N consultas idênticas sobre um pool de 5 conexões.

**Melhoria Proposta**
> Guardar em `Map<string, Promise<ResolvedAccess | null>>` a promise em voo por chave e removê-la no `finally`. Não cachear rejeição, para manter o fail-closed. Tactic: Increase Concurrency / Reduce Overhead. Tocar `AccessService.ts` e o teste.

**Resultado Esperado**
> Consultas de acesso por page-load em miss: 5–10 → 1. Teste unitário: 10 `resolver` paralelos = 1 chamada ao repositório.

**Métricas de sucesso**
- Chamadas ao repositório por 10 `resolver` concorrentes: 10 → 1

**Risco de não fazer**
> pico de consultas idênticas a cada 30 s por usuário ativo, crescente com o número de usuários e de instâncias.

**Dependências**: nenhuma

---

### [performance-2] Reduzir o tempo de conexão presa pela escrita de credencial

**QA**: Performance
**Tactic alvo**: Schedule Resources
**Esforço**: S (≤1d)
**Findings**: F-performance-2

**Problema**
> A escrita no GoTrue (até 10 s, sem retry) roda dentro da transação, com pool de 5 e `connectionTimeout` de 5 s. Com o GoTrue lento, poucas escritas admin esgotam o pool.

**Melhoria Proposta**
> Escolher e registrar no ADR-0056: (a) reduzir `REQUEST_TIMEOUT_MS` das escritas admin para 5 s; (b) limitar a 1–2 as escritas de credencial simultâneas (semáforo no `CredentialMirror`), reservando conexões às demais rotas. Manter o rollback como está. Tactic: Bound Execution Times / Schedule Resources.

**Resultado Esperado**
> Conexões presas por escritas admin em pior caso: 5 de 5 → no máximo 2 de 5. Hold máximo: 10 s → 5 s (se a opção a for adotada). Teste com GoTrue simulado lento: as demais rotas respondem enquanto 2 escritas estão pendentes.

**Métricas de sucesso**
- Máximo de conexões presas por escritas admin: 5 → 2
- Hold máximo: 10 000 ms → 5 000 ms

**Risco de não fazer**
> degradação do GoTrue combinada com atividade de admin derruba momentaneamente o backend inteiro (503).

**Dependências**: nenhuma

---

### [security-1] Registrar recusas de login e alarmar sobre elas

**QA**: Security
**Tactic alvo**: Detect Intrusion / Audit Trail
**Esforço**: S
**Findings**: F-security-1, F-security-3

**Problema**
> Em `AUTH_PROVIDER=supabase`, senha errada, usuário inexistente, inativo ou sem vínculo retornam 401 sem evento no `LogService` (0 de 4 caminhos). Sem trilha não há alarme de força bruta.

**Melhoria Proposta**
> Emitir `LogService.warn` `AUTH_SESSAO` com `username` normalizado, motivo genérico e IP em cada `return null` de `SupabaseSessionService.login` (e no `AuthService`); contar por janela e alarmar quando passar de um limiar. Nunca logar senha.

**Resultado Esperado**
> 100% das recusas de login com evento; alerta a partir de N falhas/15 min.

**Métricas de sucesso**
- Caminhos de recusa com log: 0/4 → 4/4
- Alarme de falha de login: ausente → presente

**Risco de não fazer**
> credential stuffing só é notado quando alguém entra.

**Dependências**: nenhuma.

---

### [security-3] Tornar o bloqueio por identificador menos abusável

**QA**: Security
**Tactic alvo**: Lock Computer
**Esforço**: S
**Findings**: F-security-3

**Problema**
> 10 falhas bloqueiam a conta por 15 min de qualquer IP; o balde vive em memória, sem teto de chaves, e some no restart.

**Melhoria Proposta**
> Chavear também por IP+identificador (o bloqueio total só após mais falhas), limitar o número de chaves do store, e emitir alerta ao Inform Actors quando um identificador é bloqueado. Persistir o store só se houver mais de uma instância.

**Resultado Esperado**
> Bloqueio de terceiros deixa de ser trivial e fica visível.

**Métricas de sucesso**
- Falhas de um único IP necessárias para trancar um usuário: 10 → limite por par IP+identificador
- Alerta de bloqueio: ausente → presente

**Risco de não fazer**
> negação de serviço dirigida a um analista na janela de fechamento.

**Dependências**: security-1.

---

### [testability-1] Fixar pisos de cobertura por arquivo no código de auth

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-4

**Problema**
> O delta de auth trouxe testes densos, mas o gate de CI não os protege: `lib/auth/` tem piso de 24% e o backend não tem piso por arquivo em `domain/service/auth/` nem em `http/auth*.ts`.

**Melhoria Proposta**
> Medir a cobertura atual desses arquivos e assentar pisos logo abaixo do medido, no padrão já usado para `gracefulShutdown`/`bootstrap`. Tocar `src/backend/jest.config.cjs` e `src/frontend/jest.config.js`.

**Resultado Esperado**
> Regressão de cobertura em auth reprova o CI. Pisos por arquivo em auth no backend: 0 → 5 entradas; frontend `lib/auth/` lines 24% → (medido menos 2 pontos).

**Métricas de sucesso**
- Pisos por arquivo em auth (backend): 0 → 5
- Piso `lib/auth/` lines: 24% → medido - 2

**Risco de não fazer**
> a cobertura de auth erode nas próximas features sem sinal no CI.

**Dependências**: rodar `npm test -- --coverage` uma vez (não feito em --quick).

---

### [testability-2] Injetar relógio nas decisões de expiração e banimento

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S
**Findings**: F-testability-1

**Problema**
> `SupabaseAuthClient` e `AuthProvider` leem `Date.now()` direto (6 sítios); o teste de `expiresAt` usa janela em vez de valor exato.

**Melhoria Proposta**
> Aceitar um `now: () => number` (backend: provider injetável ou parâmetro de construtor; frontend: parâmetro em `session-refresh.ts`) e usar relógio fixo/`jest.useFakeTimers` nos testes, incluindo a fronteira `banned_until == agora`.

**Resultado Esperado**
> Leituras de tempo não abstraídas no delta 6 → 0; casos exatos de fronteira de banimento e expiração 0 → 3.

**Métricas de sucesso**
- Leituras de tempo não abstraídas: 6 → 0
- Casos de fronteira exatos: 0 → 3

**Risco de não fazer**
> bug de fronteira em bloqueio/refresh só aparece em produção.

**Dependências**: nenhuma.

---

### [availability-2] Alertar sobre `AUTH_INDISPONIVEL` e `AUTH_DIVERGENCIA`

**QA**: Availability
**Tactic alvo**: Monitor
**Esforço**: M
**Findings**: F-availability-4

**Problema**
> Falhas do GoTrue e divergências app_user ↔ GoTrue são só linhas de log; não há painel nem alerta (0 consumidores do tipo `AUTH_INDISPONIVEL`).

**Melhoria Proposta**
> Tactic Monitor: expor no `painel-operacao` a contagem por `motivo` nas últimas 24 h de `AUTH_INDISPONIVEL` e `AUTH_DIVERGENCIA` (`duracaoMs`/`motivo` já são emitidos) e notificar o canal da Kavex quando `AUTH_INDISPONIVEL` passar de N ocorrências em 5 min. Como Self-Test, acrescentar um smoke de login pós-deploy ao runbook.

**Resultado Esperado**
> Falha do GoTrue detectada pelo operador antes do chamado do usuário. Alertas sobre auth: 0 → ≥ 1.

**Métricas de sucesso**
- Alertas/painéis de auth: 0 → ≥ 1
- Tempo até detecção de indisponibilidade: não medido → < 5 min

**Risco de não fazer**
> a indisponibilidade do login só é notada por reclamação; divergências acumulam até alguém rodar o sync.

**Dependências**: `painel-operacao` existente

---

### [availability-4] Tirar chamadas ao GoTrue de dentro do lock da linha quando possível

**QA**: Availability
**Tactic alvo**: Exception Prevention
**Esforço**: M
**Findings**: F-availability-3

**Problema**
> `criarEVincular` pode encadear create, listagem paginada e update, cada um até 10 s, com a linha do `app_user` travada e uma conexão do pool retida (até 30 s no pior caso).

**Melhoria Proposta**
> Tactic Exception Prevention: resolver o vínculo por e-mail (`adminFindUserByEmail`) antes de abrir a transação, ou reduzir o timeout das escritas admin dentro de transação (ex.: 5 s), mantendo a regra "erro = ROLLBACK". Tocar `CredentialMirror.ts`.

**Resultado Esperado**
> Lock máximo de escrita de credencial: 30 s → ≤ 10 s.

**Métricas de sucesso**
- Chamadas ao GoTrue dentro da transação: até 3 → ≤ 1

**Risco de não fazer**
> com o GoTrue lento, um cadastro travado segura o pool e bloqueia outras escritas de usuário.

**Dependências**: nenhuma

---

### [deployability-2] Scriptar as verificações do corte

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: M
**Findings**: F-deployability-2

**Problema**
> O corte tem ~20 verificações SQL/curl copiadas à mão em 9 passos.

**Melhoria Proposta**
> Tactic Script Deployment Commands: um job somente leitura (`job:verify-auth`) que checa contagens de `auth_user_id`, grants de `anon`/`authenticated`, `AUTH_PROVIDER` efetivo e login de teste, com saída pass/fail. Reutilizável no rollback.

**Resultado Esperado**
> Verificações automatizadas de 0 para ≥ 12; sobram as de painel do Supabase.

**Métricas de sucesso**
- Verificações automatizadas: 0 → ≥ 12

**Risco de não fazer**
> erro humano em passo de produção.

**Dependências**: nenhuma

---

### [modifiability-3] Dividir `UserRepository` por responsabilidade

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: M
**Findings**: F-modifiability-3

**Problema**
> 671 LOC (+249 no delta) com consultas de usuário, vínculo Supabase e listagens no mesmo repositório.

**Melhoria Proposta**
> Separar `UserAuthLinkRepository` (auth_user_id, sync) de `UserRepository` (CRUD/listagem) — Split Module; services ajustam a injeção.

**Resultado Esperado**
> Maior arquivo do repositório de auth: 671 -> <= 450 LOC.

**Métricas de sucesso**
- LOC `UserRepository`: 671 -> <= 450

**Risco de não fazer**
> o arquivo passa de 800 LOC na próxima evolução de usuários/permissões.

**Dependências**: nenhuma.

---

### [security-2] Endurecer a sessão do navegador (CSP e escopo do refresh token)

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: M
**Findings**: F-security-2

**Problema**
> Refresh token no `localStorage` (4 chaves) e nenhum CSP: um XSS rouba uma sessão renovável.

**Melhoria Proposta**
> Adicionar `Content-Security-Policy` (script-src 'self' + nonce) e demais cabeçalhos em `next.config`; avaliar levar o refresh token para cookie httpOnly SameSite=Strict via o proxy `/auth/*` (com proteção CSRF); revisitar a ADR-0056.

**Resultado Esperado**
> CSP presente; refresh token inacessível a JavaScript.

**Métricas de sucesso**
- Cabeçalhos CSP: 0 → 1
- Tokens legíveis por JS: 2 → 1 (access apenas)

**Risco de não fazer**
> uma dependência comprometida no front vira acesso a operações financeiras.

**Dependências**: nenhuma.

---

### [testability-3] Testes de integração contra `supabase start` e Postgres real para a 0070

**QA**: Testability
**Tactic alvo**: Sandbox
**Esforço**: M
**Findings**: F-testability-2, F-testability-3

**Problema**
> A migration 0070 é validada por regex sobre o fonte e o GoTrue é `fetchMock`; a execução real é roteiro manual de QA.

**Melhoria Proposta**
> Criar suíte `describe('integration: ...')` executada sob flag (fora do `npm test` padrão) que aplica a 0070 num Postgres com os roles e faz um ciclo login/refresh contra o GoTrue local, reaproveitando `probe-gotrue-local.ts`. Gravar respostas reais como fixtures do teste unitário do client. Opcional: teste do `main` dos jobs (dry-run não escreve).

**Resultado Esperado**
> Testes de integração de auth no delta 0 → 3 (migration, login/refresh, dry-run do sync); fixtures gravadas do GoTrue 0 → 4 respostas.

**Métricas de sucesso**
- Testes de integração de auth: 0 → 3
- Fixtures GoTrue: 0 → 4

**Risco de não fazer**
> divergência entre o mock e o GoTrue real derruba o login sem o CI perceber.

**Dependências**: Supabase CLI disponível no runner.

---

## P3 — Baixo

### [deployability-3] Corrigir ADR citado e cobrir indisponibilidade do Supabase Auth no runbook

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S
**Findings**: F-deployability-4

**Problema**
> DEPLOY.md e `render.yaml` citam ADR-0054 enquanto o registro é 0056, e não há linha de runbook para "GoTrue fora do ar".

**Melhoria Proposta**
> Alinhar o número do ADR e acrescentar à tabela de rollback a linha "Supabase Auth indisponível: `AUTH_PROVIDER=local` + deploy (enquanto `AUTH_JWT_SECRET` existir)".

**Resultado Esperado**
> 1 número de ADR por decisão; 1 linha de runbook para indisponibilidade.

**Métricas de sucesso**
- Números de ADR divergentes: 2 → 1
- Linhas de runbook de indisponibilidade: 0 → 1

**Risco de não fazer**
> MTTR maior em incidente de login.

**Dependências**: nenhuma

---

### [fault-tolerance-3] Limitar a exposição do pool durante a espera do GoTrue

**QA**: Fault Tolerance
**Tactic alvo**: Timeout
**Esforço**: S
**Findings**: F-fault-tolerance-3

**Problema**
> A tx com `FOR UPDATE` segura uma conexão por até 10–20 s enquanto espera o GoTrue.

**Melhoria Proposta**
> Reduzir o timeout das escritas admin (ex.: 5 s) e/ou medir a duração da tx e logar acima de um limiar; avaliar `lock_timeout` na tx. Sem mudar o desenho R6. Tactic: Timeout.

**Resultado Esperado**
> Pior caso de tx aberta 20 s → ≤ 10 s, com métrica observável.

**Métricas de sucesso**
- Pior caso de tx aberta: 20 s → ≤ 10 s

**Risco de não fazer**
> sob GoTrue lento, admins em paralelo esgotam o pool.

**Dependências**: nenhuma

---

### [fault-tolerance-4] Distinguir falha transitória de recusa na renovação de sessão do front

**QA**: Fault Tolerance
**Tactic alvo**: Timeout / Recovery (forward)
**Esforço**: S
**Findings**: F-fault-tolerance-4

**Problema**
> `refreshSession` trata 503, erro de rede e 401 do mesmo modo (`null`) e não tem timeout.

**Melhoria Proposta**
> Adicionar `AbortSignal.timeout` ao fetch; em 503/rede, tentar de novo com backoff curto e manter a sessão em vez de expirar; expirar só em 401/recusa. Teste em `session-refresh.test.ts`. Tactic: Timeout / Recovery (forward).

**Resultado Esperado**
> 0 expirações de sessão por 503 transitório (hoje 1 de 1 caminhos tratam 503 como recusa).

**Métricas de sucesso**
- Refresh com timeout: 0/1 → 1/1
- Caminhos que expiram sessão por 503: 1 → 0

**Risco de não fazer**
> analistas deslogados durante blips do provedor.

**Dependências**: nenhuma

---

### [integrability-3] Centralizar a base de URL do frontend de auth

**QA**: Integrability
**Tactic alvo**: Restrict Communication Paths
**Esforço**: S
**Findings**: F-integrability-3

**Problema**
> `lib/http.ts` e `session-refresh.ts` resolvem a URL da API separadamente.

**Melhoria Proposta**
> Restrict Communication Paths: exportar uma única `apiBaseUrl()` em `lib/` usada pelos dois sítios; manter o refresh fora do wrapper.

**Resultado Esperado**
> Sítios que resolvem a base: 2 → 1.

**Métricas de sucesso**
- sítios com resolução de `API`: 2 → 1

**Risco de não fazer**
> baixo; drift de configuração entre os dois caminhos.

**Dependências**: nenhuma

---

### [performance-3] Busca direcionada por e-mail no GoTrue

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: S (≤1d)
**Findings**: F-performance-3

**Problema**
> `adminFindUserByEmail` pagina todos os usuários e filtra em memória, sob transação aberta. O custo cresce com a base de usuários.

**Melhoria Proposta**
> No job `sync-supabase-auth`, que já lista todos os usuários, montar um `Map` por e-mail uma vez e usá-lo em `criarEVincular`. Para a rota avulsa, mover a leitura para antes de abrir a transação. Tactic: Reduce Overhead.

**Resultado Esperado**
> Listagens GoTrue durante transação aberta: 1 ou mais → 0. Listagens no job de sync: N → 1.

**Métricas de sucesso**
- Listagens GoTrue durante transação aberta: ≥1 → 0

**Risco de não fazer**
> baixo; degradação gradual se a base passar de algumas centenas de usuários.

**Dependências**: nenhuma

---

### [security-4] Revogar o refresh token também com access token expirado

**QA**: Security
**Tactic alvo**: Revoke Access
**Esforço**: S
**Findings**: F-security-4

**Problema**
> `/auth/logout` só revoga quando o access token ainda verifica; vencido, responde 204 sem revogar.

**Melhoria Proposta**
> Aceitar token vencido no logout (verificar assinatura com `clockTolerance` ou ignorar `exp`) só para extrair `sub` e chamar o `logout` do GoTrue; ou aceitar o refresh token no corpo.

**Resultado Esperado**
> Todo logout de sessão Supabase revoga no servidor.

**Métricas de sucesso**
- Caminhos de logout sem revogação: 1 → 0

**Risco de não fazer**
> refresh tokens copiados sobrevivem ao "sair".

**Dependências**: nenhuma.

---

### [security-5] Fixar data para fechar o caminho HS256 e girar os segredos

**QA**: Security
**Tactic alvo**: Separate Entities
**Esforço**: S
**Findings**: F-security-5

**Problema**
> O caminho HS256 fica aberto enquanto `AUTH_JWT_SECRET` existir, sem data para acabar.

**Melhoria Proposta**
> Registrar no runbook (`DEPLOY.md` §6) a data-alvo para apagar `AUTH_JWT_SECRET`, girar a chave secreta do Supabase após o corte, e alarmar (via `ConfigDoctor`) se `AUTH_PROVIDER=supabase` e o segredo HS256 ainda existirem após a data.

**Resultado Esperado**
> 1 caminho HS256 aberto → 0 após o corte.

**Métricas de sucesso**
- Caminhos de verificação abertos: 2 → 1
- Segredos de longa vida em Render: 2 → 1

**Risco de não fazer**
> o segredo legado permanece indefinidamente, com o mesmo alcance de um token válido.

**Dependências**: corte completo para o modo supabase.

---

### [integrability-2] Extrair transporte HTTP comum para os próximos clients

**QA**: Integrability
**Tactic alvo**: Abstract Common Services
**Esforço**: M
**Findings**: F-integrability-2

**Problema**
> O transporte (timeout, log de falha, mapeamento de status, `RetryExecutor`) do `SupabaseAuthClient` é próprio; Nexxera/GED/SharePoint repetiriam.

**Melhoria Proposta**
> Abstract Common Services: extrair `HttpTransport` (timeout + log + erro tipado) a partir do `SupabaseAuthClient` quando o primeiro client novo (Nexxera/GED) entrar via `/feature-new`; não refatorar Conexos preventivamente.

**Resultado Esperado**
> Novo client sem reimplementar transporte: ~130 LOC → ~30 LOC por client.

**Métricas de sucesso**
- LOC de transporte por client novo: ~130 → ≤ 30

**Risco de não fazer**
> divergência de política de timeout/log entre integrações.

**Dependências**: primeiro `/feature-new` de Nexxera ou GED

---
