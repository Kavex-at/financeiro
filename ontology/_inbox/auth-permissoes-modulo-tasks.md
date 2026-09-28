# Tasks: auth-permissoes-modulo

> Slug: `auth-permissoes-modulo` · Branch: `feat/auth-permissoes-modulo` · Base: `main` (@ `4c6b34f`, v0.43.1)
> Worktree: `.claude/worktrees/auth-permissoes-modulo` · Migration: **0066** · ADR: **0053** (reconferir as duas no rebase)
> Passo 2 de 3 do plano de auth (e-mails reais → **permissões no banco** → Supabase Auth).

**Spec source:** ontology/_inbox/auth-permissoes-modulo-interview.md (as seções **"Respostas (2026-09-28)"** e **"Atualização Q1"** prevalecem sobre o resto)
**Ontology diff:** no. `entity_changed = false`: papéis e permissões são infraestrutura de acesso, fora da ontologia de domínio. Só ADR (0053) e o ajuste de `ontology/ui-flows/navegacao-global.md`, que cita `OPERACAO_USUARIOS`
**Estimated scope:** XL (cerca de 50 arquivos: migration + 4 camadas no backend, guard em ~75 rotas, frontend em nav/home/7 páginas/botões de 3 frentes/tela de usuários, docs de deploy; toca autorização de tudo)

## Decisões que valem para todas as tasks

Vindas da entrevista (aprovadas):

- **Catálogo fixo no código**, nove valores: `permutas:ver`, `permutas:executar`, `sispag:ver`, `sispag:executar`, `recebimentos:ver`, `recebimentos:executar`, `operacao:ver`, `metricas:ver`, `usuarios:gerenciar`. Constantes tipadas, nenhuma string crua nas rotas.
- **Efetivas = fecho(pacote(papel) ∪ concedidas) − revogadas.** `fecho` adiciona `X:ver` para todo `X:executar`; revogar `X:ver` remove também `X:executar`; revogar vence conceder (Q2, Q8). Calculado **em um lugar só** (I7).
- **Um papel por usuário** (Q5). Pacotes mudam só por migration de dados (Q4); a tela atribui papel e edita exceções.
- **Dia do deploy:** papel `Administrador` com as **nove**, inclusive `operacao:ver`; todo usuário existente recebe esse papel. A migration **aborta** se houver `app_user.role` diferente de `'admin'` (Q3).
- **Allow-list de Operação aposentado nesta feature** ("Atualização Q1": `OPERACAO_USUARIOS` estava vazia em produção em 2026-09-28). `requireOperacaoAcesso()`, `http/operacaoAcesso.ts` (+ teste) e a env saem. `/operacao` exige só `operacao:ver` e, sem ela, responde **404** sem corpo explicativo (ADR-0042).
- **Permissão nunca vem do token** (I1). O token continua `sub = username` + claim `role` (compatibilidade com o front antigo na janela de deploy), mas **nenhum guard lê `role`**: `requireRole` é removido do código.
- **Lookup por requisição:** `sub → app_user` por `lower(username)`, permissões por `app_user.id`. Usuário inexistente ou inativo → **401**. Falha ao ler o banco → **503**, fail-closed.
- **Cache em memória, 30 s de TTL**, invalidado no próprio processo em toda escrita de acesso (papel, exceções, ativo). **Não** entra no `bootstrapAppContainer` (gotcha dos ~58 jobs): resolve-se sob demanda no middleware.
- **403:** `{ error: 'Você não tem permissão para esta ação.', permissao: '<código>' }` (Q9). Exceção: `operacao:ver` → 404 `{ error: 'Not found' }`, igual a hoje.
- **Flags primeiro** (I8): `sispagGate` e `recebimentosGate` continuam antes do guard de permissão, sem mudança.
- **Guarda R9/R-extra:** nenhuma mudança de papel, exceção ou `ativo` pode deixar zero usuários ativos com `usuarios:gerenciar` efetivo, nem tirar `usuarios:gerenciar` (ou o acesso) do próprio chamador. Checagem e escrita na mesma transação, com `FOR UPDATE`.
- **Auditoria:** tabela append-only `app_user_access_event` + uma linha de `LogService` em português por mudança (Q7). Leitura só por SQL.
- **Fora de escopo:** `filialAuthz` (Q12), tela de trilha de auditoria, criação/edição de papéis pela UI, remoção da coluna `app_user.role` (passo 3), usuário de serviço do `kavex-report-ciclo` (Q6: só registrar no ADR/DEPLOY).
- Mensagens ao operador (HTTP e log) em português; classes de erro e identificadores em inglês.

Decisões tomadas neste scoping (conferir no review; ver "Riscos e ambiguidades"):

- **D1 — `DEV_AUTH_BYPASS` = usuário fictício com acesso total (decisão do dono do ciclo, 2026-09-28, substitui o default do Q13):** com bypass ativo (só possível em local/dev — o `authEnv` já derruba o boot fora disso), o `resolverAcesso` preenche `req.user` e `req.acesso` com um usuário fictício constante (`sub = 'dev-bypass'`, papel `Administrador`, **todas** as 9 permissões) **sem consultar o banco**, e segue. Nenhuma linha em `app_user` é criada ou lida. Escritas feitas sob bypass gravam o ator `dev-bypass`. No front, `usePermissoes()` em `devBypass` devolve o catálogo inteiro. Teste obrigatório: com `environment` ≠ local/dev o bypass continua impossível (boot falha), e o usuário fictício nunca é produzido fora do ramo de bypass.
- **D2 — Criar usuário na janela de deploy:** `POST /usuarios` exige `papelId`. Para o front antigo (que manda `role`), `role: 'admin'` sem `papelId` é aceito como alias de Administrador; `role: 'operador'` (o default do diálogo antigo) dá 400 `'Atualize a página para escolher o papel do usuário.'`. O alias sai com a coluna `role` no passo 3.
- **D3 — Coluna `app_user.role`:** o código novo não escreve nela; o `DEFAULT 'admin'` da 0007 preenche. Assim o claim `role` do token de todo usuário continua `'admin'`, que é exatamente o que o front antigo espera hoje. Nenhum guard lê a coluna.
- **D4 — Front tolera backend antigo:** Vercel costuma publicar antes do Render terminar. Se `/me/permissoes` não trouxer o array `permissoes` (backend antigo), o front cai no comportamento legado: catálogo inteiro para `role === 'admin'` e `operacao:ver` conforme a chave `operacao`. Isso é só ergonomia (I2), e torna a ordem de deploy indiferente. Sai no tweak que remover a chave `operacao`.
- **D5 — Criar usuário e reativar geram evento de auditoria** (`papel` com `antes = null`; `ativo` com `false → true`): R12 diz "toda mudança de acesso".
- **D6 — `GET /usuarios` devolve, por usuário, `papel`, `excecoes` e `permissoesEfetivas`** (calculadas no servidor), em vez de uma rota nova por usuário. A tela precisa mostrar o efetivo (custo de Q2) e o cálculo não pode ser duplicado no front (I7).
- **D7 — Script de reverse para a 0066** em `migrations/rollbacks/`: com `role_id NOT NULL`, um rollback do backend para a v0.43 quebraria `POST /usuarios` e o `seed-admin` (o INSERT antigo não passa `role_id`). O reverse derruba as tabelas novas e a coluna (a trilha de auditoria se perde; registrado no próprio script).

## Plano de Validação Ground-Truth

**Veredito: `SEM_GROUND_TRUTH`.** A feature não calcula valor monetário e não lê nem escreve no Conexos, na Nexxera ou no GED. Os gates que se aplicam são: **invariância de comportamento no dia do deploy** (I6: todo usuário existente mantém exatamente o acesso de hoje, coberto pelos testes da Task 8 com um usuário Administrador e pelo roteiro de QA), e **invariância de identidade** (I5: `sub`, `executado_por`, `triggeredBy` e vínculo Conexos intocados, coberto pelo critério de payload do token na Task 11).

## Task list

### Task 1: Migration 0066: papéis, exceções, `app_user.role_id`, trilha de acesso

**Files to change:**
- `src/backend/migrations/0066_auth_permissoes_modulo.sql` (novo)
- `src/backend/migrations/0066_auth_permissoes_modulo.test.ts` (novo; asserções sobre o fonte, padrão de `0064_app_user_email.test.ts`, porque o runner usa `import.meta` e não roda sob Jest)
- `src/backend/migrations/rollbacks/0066_auth_permissoes_modulo.rollback.sql` (novo)
- `src/backend/migrations/rollbacks.test.ts` (lista de reverses esperados ganha a 0066)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `0066_auth_permissoes_modulo.test.ts` e a linha nova em `rollbacks.test.ts` escritos e falhando antes de existir o `.sql`
- [ ] Guarda antes de qualquer DDL: bloco `DO $$ ... RAISE EXCEPTION` com mensagem em português quando existe `app_user.role` diferente de `'admin'` (Q3). O teste verifica que o `RAISE EXCEPTION` aparece antes do primeiro `CREATE TABLE`
- [ ] `app_role(id SERIAL PK, nome TEXT NOT NULL, descricao TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())` com índice único em `lower(nome)`
- [ ] `app_role_permission(role_id INT NOT NULL REFERENCES app_role(id) ON DELETE CASCADE, permission TEXT NOT NULL, PRIMARY KEY (role_id, permission))`
- [ ] `user_permission(user_id INT NOT NULL REFERENCES app_user(id), permission TEXT NOT NULL, efeito TEXT NOT NULL CHECK (efeito IN ('conceder','revogar')), concedido_por TEXT NOT NULL, concedido_em TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, permission))`
- [ ] `CHECK (permission IN (...nove valores...))` nas duas colunas `permission` (R4). O teste compara a lista do `CHECK` com o catálogo do código (Task 2), para que um valor novo no código sem migration quebre o teste
- [ ] `app_user_access_event(id BIGSERIAL PK, ator TEXT NOT NULL, alvo_user_id INT NOT NULL REFERENCES app_user(id), tipo TEXT NOT NULL CHECK (tipo IN ('papel','excecao','ativo')), antes JSONB, depois JSONB, em TIMESTAMPTZ NOT NULL DEFAULT now())` + índice em `(alvo_user_id, em)`
- [ ] Seed idempotente: papel `Administrador` (descrição em português) com as **nove** permissões, inclusive `operacao:ver` (`ON CONFLICT DO NOTHING`)
- [ ] `app_user.role_id INT REFERENCES app_role(id)` adicionada `IF NOT EXISTS`, backfill `UPDATE app_user SET role_id = <Administrador> WHERE role_id IS NULL`, e só então `SET NOT NULL`. A coluna `role` **não** é apagada nem alterada (R8)
- [ ] Tudo idempotente (rodar duas vezes não falha nem duplica): `IF NOT EXISTS`, `ON CONFLICT`, `WHERE role_id IS NULL`
- [ ] Reverse em `rollbacks/` (fora do alcance do runner): derruba `app_user.role_id`, `app_user_access_event`, `user_permission`, `app_role_permission`, `app_role`, nessa ordem, com comentário dizendo que a trilha de auditoria se perde (D7). `rollbacks.test.ts` verde
- [ ] `npm run build` copia o `.sql` para `dist/migrations/`: o log `[build] N migração(ões) copiada(s)` conta uma a mais que na `main` (gotcha do `BootMigrator`)

**Dependencies:** Task 2 (catálogo, para o teste de paridade do `CHECK`)

---

### Task 2: Catálogo de permissões e cálculo das efetivas (domínio puro)

**Files to change:**
- `src/backend/domain/interface/auth/Permission.ts` (novo: constantes `PERMISSION`, lista `PERMISSION_CATALOG`, tipo `Permission`, schema Zod `permissionSchema`, `EXCEPTION_EFFECT` = `conceder | revogar`)
- `src/backend/domain/service/auth/EffectivePermissionCalculator.ts` (novo; classe exportada, métodos arrow)
- `src/backend/domain/service/auth/EffectivePermissionCalculator.test.ts` (novo)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `EffectivePermissionCalculator.test.ts` escrito antes
- [ ] O catálogo tem exatamente os nove valores da entrevista; um teste falha se alguém adicionar ou remover um sem atualizar o teste
- [ ] `calcular(pacote, excecoes)` devolve `Set<Permission>` = fecho(pacote ∪ concedidas) − revogadas. Casos de teste, um por linha:
  - pacote vazio + nada = vazio
  - `sispag:executar` no pacote ⇒ efetivas contêm `sispag:ver` (I7)
  - conceder `permutas:executar` ⇒ ganha `permutas:ver`
  - revogar `sispag:executar` com `sispag:ver` no pacote ⇒ fica só `sispag:ver`
  - revogar `sispag:ver` com `sispag:executar` no pacote ⇒ perde as duas
  - conceder e revogar a mesma permissão não coexistem (PK), mas revogar vence quando o pacote tem e a exceção revoga
  - Administrador (nove) sem exceções ⇒ nove
- [ ] Valor fora do catálogo vindo do banco (pacote ou exceção) é **ignorado** e reportado ao chamador (lista `ignoradas`) para que ele logue aviso; nunca lança (R4)
- [ ] Nenhum outro arquivo do backend reimplementa o fecho (verificado na revisão; o serviço de acesso e o `UserAdminService` chamam esta classe)

**Dependencies:** none

---

### Task 3: `AccessRepository`: leitura de acesso por `sub`, papéis, exceções

**Files to change:**
- `src/backend/domain/repository/auth/AccessRepository.ts` (novo, `@injectable()`)
- `src/backend/domain/repository/auth/AccessRepository.test.ts` (novo; db mockado como em `UserRepository.test.ts`)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): testes escritos antes
- [ ] `findAccessBySub(sub)`: **uma** ida ao banco. SQL parametrizado casando `lower(username) = lower($sub)`, devolvendo `{ userId, username, ativo, papel: { id, nome }, pacote: string[], excecoes: { permissao, efeito }[] }` ou `null` quando não existe. O teste verifica que é um único `select*` por chamada
- [ ] `listRoles()`: papéis com seus pacotes, ordenados por nome
- [ ] `listAccessForUsers()`: papel, pacote e exceções de todos os usuários em uma consulta (alimenta o `GET /usuarios`, D6), sem N+1
- [ ] `findRoleById(id)` para validar o papel antes da escrita
- [ ] Todo SQL com `$nome`, zero interpolação (Rule #5). Linhas nulas do banco validadas antes de mapear (sem `!`)

**Dependencies:** Task 1, Task 2

---

### Task 4: Escritas de acesso guardadas (R9/R-extra) + trilha de auditoria

**Files to change:**
- `src/backend/domain/repository/auth/AccessRepository.ts`
- `src/backend/domain/repository/auth/AccessRepository.test.ts`
- `src/backend/domain/repository/auth/UserRepository.ts` (`deactivateGuarded` reescrita sobre permissão efetiva; `create` e `upsertAdmin` gravam `role_id`; `setAtivo(true)` grava evento)
- `src/backend/domain/repository/auth/UserRepository.test.ts`
- `src/backend/domain/errors/LastUserManagerError.ts` (novo; substitui `LastActiveAdminError`)
- `src/backend/domain/errors/SelfAccessRemovalError.ts` (novo)
- `src/backend/domain/errors/LastActiveAdminError.ts` (removido, com seus usos)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): casos novos em `AccessRepository.test.ts` e `UserRepository.test.ts` para todos os itens abaixo
- [ ] Um único helper de guarda, usado pelas três escritas (`setRole`, `replaceExceptions`, `deactivateGuarded`): dentro de `withTransaction`, trava `SELECT ... FROM app_user WHERE ativo ORDER BY id FOR UPDATE` **antes** de ler o alvo, lê papel+pacote+exceções dos ativos na mesma transação, simula o estado **depois** da escrita com o `EffectivePermissionCalculator` e:
  - recusa com `LastUserManagerError` quando sobrariam zero usuários ativos com `usuarios:gerenciar` efetivo
  - recusa com `SelfAccessRemovalError` quando o alvo é o próprio chamador e ele perderia `usuarios:gerenciar` (troca de papel ou exceção)
  - recusa com `SelfDeactivationError` (já existe) quando o chamador desativa a si mesmo
- [ ] Casos de teste da guarda: (a) desativar o único gestor ativo → `LastUserManagerError`; (b) trocar o papel do único gestor para um sem `usuarios:gerenciar` → `LastUserManagerError`; (c) revogar `usuarios:gerenciar` do único gestor → `LastUserManagerError`; (d) com dois gestores, revogar de um passa; (e) o chamador revoga de si mesmo com outro gestor ativo → `SelfAccessRemovalError`; (f) mudar acesso de um usuário **inativo** nunca é barrado pela contagem; (g) um usuário que tem `usuarios:gerenciar` só por exceção **conta** como gestor; (h) teste que prova que checagem e escrita acontecem na mesma transação (mesmo `tx`), como na guarda do passo 1
- [ ] `setRole(userId, roleId, ator)`: mesmo papel = no-op (sem `UPDATE`, sem evento). Papel inexistente = erro de NOT_FOUND distinto de usuário inexistente
- [ ] `replaceExceptions(userId, excecoes, ator)`: substitui o conjunto inteiro (DELETE + INSERT na mesma transação), grava `concedido_por = ator`. Mesmo conjunto = no-op sem evento
- [ ] Cada escrita efetiva grava **uma** linha em `app_user_access_event` **na mesma transação**, com `ator`, `alvo_user_id`, `tipo` e `antes`/`depois` em JSON (papel: `{ id, nome }`; exceção: lista ordenada; ativo: booleano). Criar usuário grava `papel` com `antes = null`; reativar grava `ativo` `false → true` (D5)
- [ ] Nenhum código faz `UPDATE` ou `DELETE` em `app_user_access_event` (teste sobre o fonte dos repositórios: append-only)
- [ ] `UserRepository.create` recebe `roleId` e grava `role_id`; **não** escreve `role` (D3). `upsertAdmin` resolve o papel `Administrador` por `lower(nome)` e grava `role_id` no INSERT e no `ON CONFLICT DO UPDATE`
- [ ] Nenhuma consulta de guarda usa `role = 'admin'` (teste sobre o fonte: a string `role = $role` sai do `UserRepository`)
- [ ] Classes de erro novas em inglês, exportadas como classes; SQL parametrizado

**Dependencies:** Task 2, Task 3

---

### Task 5: `AccessService`: resolução por requisição com cache de 30 s e invalidação

**Files to change:**
- `src/backend/domain/service/auth/AccessService.ts` (novo, `@singleton() @injectable()`)
- `src/backend/domain/service/auth/AccessService.test.ts` (novo)
- `src/backend/domain/appContainer.ts` (**não** muda; o teste da task verifica isso)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): testes escritos antes, com relógio injetável (sem `setTimeout` real e sem esperar 30 s)
- [ ] `resolver(sub)` devolve `{ userId, username, ativo, papel, permissoes: Set<Permission> }` ou `null` (inexistente). Usa `AccessRepository.findAccessBySub` + `EffectivePermissionCalculator`; valores ignorados pelo calculador geram `LogService.warn` em português (R4)
- [ ] Cache em memória por usuário, TTL de **30 s**: duas chamadas dentro de 30 s fazem **uma** ida ao repositório; a chamada depois de 30 s faz outra. Casar `sub` sem distinção de caixa (`Admin` e `admin` são a mesma entrada)
- [ ] `invalidar(userId)`: a próxima `resolver` daquele usuário vai ao banco, mesmo dentro dos 30 s. Não afeta a entrada de outro usuário
- [ ] Usuário inexistente **não** é cacheado; inativo é cacheado (e a invalidação cobre a reativação)
- [ ] Erro do repositório **propaga** (quem responde 503 é o middleware) e **não** é cacheado
- [ ] Sem `process.env` (TTL é constante nomeada da classe)
- [ ] `appContainer.ts` sem diff em relação à `main` (gotcha dos ~58 jobs): teste sobre o fonte verifica que `bootstrapAppContainer` não referencia `AccessService` nem cache

**Dependencies:** Task 2, Task 3

---

### Task 6: Middleware `resolverAcesso` + guard `exigirPermissao`; `requireRole` sai

**Files to change:**
- `src/backend/http/acesso.ts` (novo: `resolverAcesso`, `exigirPermissao(p)`, `somenteAutenticado()` e a marca que permite inspecionar o guard de cada rota)
- `src/backend/http/acesso.test.ts` (novo)
- `src/backend/http/auth.ts` (remove `requireRole`; `AuthUser.role` fica, só para log/compat)
- `src/backend/http/auth.test.ts` (remove os casos de `requireRole`)
- `src/backend/http/buildApp.ts` (monta `resolverAcesso` logo depois de `buildAuthMiddleware` e antes de `conexosIdentityMiddleware`)
- `src/backend/http/buildApp.test.ts`

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `acesso.test.ts` e os casos novos de `buildApp.test.ts` escritos antes
- [ ] `resolverAcesso`: sem `req.user` → 401 `{ error: 'Não autenticado.' }` (com `DEV_AUTH_BYPASS` ativo, em vez disso usa o usuário fictício com acesso total do D1). Chama `bootstrapAppContainer()` (idempotente) e resolve `AccessService` sob demanda. `null` ou `ativo = false` → **401** `{ error: 'Sessão encerrada: seu acesso foi desativado ou não existe mais.' }` (o front já trata 401 como sessão encerrada). Sucesso → `req.acesso = { userId, papel, permissoes }` e `next()`
- [ ] Falha ao resolver (banco fora) → **503** `{ error: 'Não foi possível verificar suas permissões agora. Tente novamente em instantes.' }` + `LogService.error` em português com `requestId`; **nunca** `next()` (fail-closed, R7). Teste com repositório lançando
- [ ] `exigirPermissao(p)`: `p ∈ req.acesso.permissoes` → `next()`; senão **403** `{ error: 'Você não tem permissão para esta ação.', permissao: p }` + `console.warn`/`LogService.warn` em português com usuário, método, rota e permissão. Para `p = operacao:ver` → **404** `{ error: 'Not found' }` (ADR-0042). Sem `req.acesso` (middleware fora de ordem) → 500 via erro, nunca `next()`
- [ ] `exigirPermissao` e `somenteAutenticado` marcam o middleware devolvido (propriedade ou símbolo exportado) com a permissão exigida / `'autenticado'`, para o teste de cobertura da Task 7
- [ ] `requireRole` não existe mais: `grep -rn "requireRole" src/backend --include=*.ts` só acha comentários (e nenhum em código executável); nenhum arquivo lê `req.user.role` para decidir acesso (I1, R1)
- [ ] `buildApp.test.ts`: `/health`, `/health/pipelines`, `POST /auth/login` e `GET /auth/transicao` continuam respondendo sem token (não passam pelo `resolverAcesso`); qualquer rota montada depois do auth com token de usuário inativo recebe 401
- [ ] A ordem em `buildApp.ts` fica documentada no comentário de contrato do módulo (auth → acesso → identidade Conexos)

**Dependencies:** Task 5

---

### Task 7: Guard por rota nas frentes, métricas, `/conexos` e `/me` + teste de cobertura exaustivo

**Files to change:**
- `src/backend/routes/permutas.ts`
- `src/backend/routes/sispag.ts` (inclui o laço `/lotes/:id/{finalizar|reabrir|cancelar|retorno}`)
- `src/backend/routes/recebimentos.ts`
- `src/backend/routes/metricas.ts`
- `src/backend/routes/conexos.ts`
- `src/backend/routes/me.ts` (`/conexos-status`; `/permissoes` fica na Task 8)
- `src/backend/http/routePermissions.test.ts` (novo: tabela da entrevista + cobertura)
- `src/backend/routes/permutas.test.ts`, `sispag.test.ts`, `recebimentos.test.ts`, `recebimentos.e2e.gates.test.ts`, `metricas.test.ts` (ajuste dos mocks de auth: onde hoje injetam `role: 'admin'`, passam a injetar `req.acesso` ou o `AccessService` mockado)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `routePermissions.test.ts` escrito antes, falhando
- [ ] Toda rota da seção "Mapeamento por rota" da entrevista recebe o guard da coluna **Proposta**, no lugar do antigo `requireRole('admin')` (ou onde não havia guard). Posição: onde estava o `requireRole`, isto é, **antes** de `filialAuthz` e depois do `heavyRouteLimiter` quando a rota já o tinha
- [ ] Rotas "autenticado + ativo" (`GET /me/conexos-status`, `GET /me/permissoes`, `GET /conexos/filiais`) usam `somenteAutenticado()` explícito (JC-6)
- [ ] **Teste de cobertura por introspecção:** `routePermissions.test.ts` importa cada router (`permutas`, `sispag`, `recebimentos`, `usuarios`, `operacao`, `metricas`, `me`, `conexos`), percorre `router.stack`, e para cada rota (método + caminho, prefixada pelo mount) exige **exatamente um** guard marcado. O conjunto de rotas encontradas tem de ser **igual** ao conjunto da tabela do teste: rota nova sem linha na tabela, ou linha sem rota, falha o teste com mensagem que nomeia a rota
- [ ] A tabela do teste é a da entrevista, linha por linha: **27** rotas em `/permutas`, **27** em `/sispag` (as quatro do laço contam separadas), **15** em `/recebimentos`, **10** em `/usuarios` (7 + 3 novas, Task 9), **2** em `/operacao`, 1 em `/metricas`, 2 em `/me`, 1 em `/conexos`. As públicas (`/health`, `/health/*`, `/auth/*`) ficam numa lista explícita de públicas
- [ ] O teste também confere, sobre o fonte de `buildApp.ts`, que o conjunto de `app.use('/<prefixo>', ...)` é exatamente o conhecido pelo teste (um router novo montado sem entrar na tabela falha)
- [ ] **Teste comportamental por linha** (table-driven, mesmo arquivo ou `routePermissions.http.test.ts`): app de teste com `resolverAcesso` real sobre `AccessService` mockado, flags SISPAG e Recebimentos ligadas, handlers nunca alcançados (o `bootstrapAppContainer` mockado lança um erro sentinela). Para cada linha:
  - usuário com o catálogo inteiro **menos** a permissão exigida (e, para `X:ver`, menos também `X:executar`, pelo fecho) → 403 com `body.permissao` igual à esperada (404 `{ error: 'Not found' }` para `operacao:ver`)
  - usuário com **só** a permissão exigida (mais o fecho) → passa do guard (chega ao sentinela)
- [ ] JC-2 verificado explicitamente: usuário só com `permutas:ver` passa de `GET /permutas/status`, `GET /permutas/borderos?live=true` e `GET /permutas/borderos/:borCod/baixas`
- [ ] JC-3/JC-4 verificados explicitamente: só `sispag:ver` recebe 403 em `GET /sispag/contas-pagadoras`, `GET /sispag/lotes/:id/remessa/arquivo` e `GET /sispag/execucoes`; só `recebimentos:ver` passa de `GET /recebimentos/contas` e recebe 403 em `GET /recebimentos/execucoes`
- [ ] I8: com `SISPAG_ENABLED=false`, usuário **sem** `sispag:ver` recebe a resposta do `sispagGate` (403 "indisponível"), não a do guard de permissão. Idem `recebimentosGate`
- [ ] **I6 (dia do deploy):** usuário com o papel Administrador passa de **todas** as linhas da tabela
- [ ] `filialAuthz` em `POST /recebimentos/transacoes/:txnId/solicitacao-numerario` continua depois do guard e sem mudança (Q12)
- [ ] Os testes de rota existentes continuam verdes após o ajuste dos mocks

**Dependencies:** Task 6

---

### Task 8: Operação sem allow-list + `/me/permissoes` novo

**Files to change:**
- `src/backend/routes/operacao.ts` (`requireRole('admin') + requireOperacaoAcesso()` → `exigirPermissao(operacao:ver)` nas duas rotas)
- `src/backend/routes/operacao.test.ts`
- `src/backend/http/operacaoAcesso.ts` (**removido**)
- `src/backend/http/operacaoAcesso.test.ts` (**removido**)
- `src/backend/routes/me.ts` (`GET /permissoes`)
- `src/backend/routes/me.test.ts` (novo)
- `src/backend/domain/libs/environment/model/EnvironmentVars.ts` (sai `operacaoUsuarios`)
- `src/backend/domain/libs/environment/EnvironmentProvider.ts` (sai `resolveOperacaoUsuarios`, nos dois caminhos: env local/Render e SSM/Lambda)
- `src/backend/domain/libs/environment/EnvironmentProvider.test.ts`
- `src/backend/domain/interface/operacao/configManifest.ts` (sai a entrada `OPERACAO_USUARIOS`, `:112`)
- `src/backend/domain/service/operacao/ConfigDoctor.test.ts` (se referenciar a var)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `me.test.ts` e os casos novos de `operacao.test.ts` escritos antes
- [ ] `GET /operacao` e `POST /operacao/alertas/:id/reconhecer`: sem `operacao:ver` → 404 `{ error: 'Not found' }` (mesmo corpo de hoje); com → segue ao handler. Reconhecer exige só `operacao:ver` (JC-5)
- [ ] `grep -rn "OPERACAO_USUARIOS\|operacaoUsuarios\|requireOperacaoAcesso\|usuarioPodeVerOperacao" src/` devolve vazio (código, testes e comentários do front incluídos)
- [ ] `GET /me/permissoes` responde `{ permissoes: string[] (ordenado, efetivas), papel: { id, nome }, operacao: boolean }`, com `operacao === permissoes.includes('operacao:ver')` (R10; a chave fica pela janela de deploy). Teste com `toEqual` exato para Administrador e para um usuário só com `permutas:ver`
- [ ] `GET /me/permissoes` responde com `Cache-Control: no-store`
- [ ] `ConfigDoctor.test.ts` e `EnvironmentProvider.test.ts` verdes sem a var

**Dependencies:** Task 6

---

### Task 9: `/usuarios`: guard `usuarios:gerenciar`, papéis, atribuir papel, editar exceções

**Files to change:**
- `src/backend/domain/service/auth/UserAdminService.ts`
- `src/backend/domain/service/auth/UserAdminService.test.ts`
- `src/backend/routes/usuarios.ts`
- `src/backend/routes/usuarios.test.ts`
- `src/backend/routes/usuarios.vinculo.test.ts` (ajuste do mock de auth)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): casos novos em `usuarios.test.ts` e `UserAdminService.test.ts` escritos antes
- [ ] `router.use(exigirPermissao(usuarios:gerenciar))` no lugar de `requireRole('admin')`. Usuário sem a permissão recebe 403 com `permissao: 'usuarios:gerenciar'` em **cada** rota do router (coberto também pela Task 7)
- [ ] `GET /usuarios/papeis` → `{ papeis: [{ id, nome, descricao?, permissoes }], catalogo: string[] }` (o `catalogo` alimenta o diálogo do front sem duplicar a lista, D6)
- [ ] `GET /usuarios`: cada usuário ganha `papel: { id, nome }`, `excecoes: [{ permissao, efeito }]` e `permissoesEfetivas: string[]` calculadas pelo `EffectivePermissionCalculator` (D6), sem N+1 (uma consulta de acesso para a lista). `role` continua no JSON (front antigo)
- [ ] `PATCH /usuarios/:id/papel` body `{ papelId }` (Zod, inteiro positivo): 200 `{ id, papel }`; 400 `'Requisição inválida'`; 404 `'Usuário não encontrado.'` ou `'Papel não encontrado.'`; 409 com as mensagens da guarda (abaixo). Mesmo papel = 200 sem evento
- [ ] `PUT /usuarios/:id/permissoes` body `{ excecoes: [{ permissao, efeito }] }`: `permissao` validada contra o catálogo (Zod enum), `efeito ∈ {conceder, revogar}`, permissão repetida no array = 400 `'Cada permissão pode aparecer uma vez só.'`, fora do catálogo = 400 `'Permissão desconhecida.'`. 200 `{ id, excecoes, permissoesEfetivas }`
- [ ] `respondError` mapeia: `LastUserManagerError` → 409 `'Não é possível remover o último usuário com permissão de gerenciar usuários.'`; `SelfAccessRemovalError` → 409 `'Você não pode remover a sua própria permissão de gerenciar usuários.'`; `SelfDeactivationError` mantém `'Você não pode desativar o próprio acesso.'`. Um teste por status em cada uma das três rotas de escrita (papel, permissoes, ativo)
- [ ] Toda escrita que muda acesso (papel, exceções, ativo em qualquer direção, criação) chama `AccessService.invalidar(id)` **depois** do commit, e emite `LogService.info` em português com ator, alvo, tipo e antes → depois. Teste: após `PATCH /:id/ativo {ativo:false}`, a próxima resolução do alvo vai ao banco
- [ ] `POST /usuarios` exige `papelId` (Q3, sem default). Compatibilidade D2: sem `papelId` e com `role: 'admin'` → papel Administrador; com `role: 'operador'` ou sem nenhum dos dois → 400 `'Atualize a página para escolher o papel do usuário.'`. `papelId` inexistente → 404 `'Papel não encontrado.'`. Um teste por caso
- [ ] `USER_ROLES`, `UserRole` e o `.default('operador')` saem do `UserAdminService` (grep vazio para `'operador'` em `src/backend` fora de migrations antigas)
- [ ] O ator vem de `req.user.sub`; sem ele, as rotas de escrita recusam com 401 (como o `PATCH /:id/ativo` já faz)

**Dependencies:** Task 4, Task 5, Task 6

---

### Task 10: `seed-admin` e token: compatibilidade com o passo 1

**Files to change:**
- `src/backend/jobs/seed-admin.ts`
- `src/backend/jobs/SeedAdminConfig.test.ts` (ou teste novo do upsert, se o fonte do job continuar sem teste direto)
- `src/backend/domain/service/auth/AuthService.ts` (sem mudança de comportamento; só se o `role` precisar vir de outro lugar)
- `src/backend/domain/service/auth/AuthService.test.ts`

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): casos novos escritos antes
- [ ] `seed:admin` cria ou atualiza o usuário com `role_id` = papel `Administrador` (via `upsertAdmin`, Task 4). Se o papel não existir (migration não aplicada), sai com código 1 e mensagem em português que manda rodar as migrations
- [ ] **I5/I1 (gate de identidade):** o payload do token continua com exatamente `sub`, `role`, `aud`, `iat`, `exp` (teste com `jose.decodeJwt`), `sub` = `username` canônico, e **nenhum** claim de permissão, papel novo ou `id`
- [ ] `AuthService.login` de usuário inativo continua 401 (já coberto; o teste permanece)

**Dependencies:** Task 4

---

### Task 11: Docs de deploy, env e ontologia de UI

**Files to change:**
- `DEPLOY.md`
- `src/backend/.env.example`
- `render.yaml` (conferir; hoje não cita `OPERACAO_USUARIOS`)
- `ontology/ui-flows/navegacao-global.md`

**Acceptance criteria:**
- [ ] `DEPLOY.md` ganha uma seção "Permissões por módulo (v0.44)" com: a migration 0066 e o que ela semeia; o que um usuário novo precisa (papel escolhido na criação); a ordem de deploy e por que ela é indiferente (D4) ou, se o D4 cair na revisão, backend antes do frontend; o roteiro de rollback (reverse da 0066 **depois** de voltar o backend, D7); que `OPERACAO_USUARIOS` foi aposentada (vazia em produção em 2026-09-28) e pode ser apagada do Render; e que desativar a conta `admin` quebra o `kavex-report-ciclo` até `FINANCEIRO_API_USUARIO` ser trocada (Q6)
- [ ] Onde o `DEPLOY.md` descreve o acesso a Operação ou "admin vê tudo", o texto passa a falar de permissões
- [ ] `grep -rn OPERACAO_USUARIOS` no repo (fora de `node_modules`, `ontology/_inbox`, `ontology/decisions` e `docs/regis-review`) devolve vazio
- [ ] `navegacao-global.md` descreve a visibilidade de cada item de nav pela permissão (tabela "Mapeamento no frontend" da entrevista)

**Dependencies:** Task 8

---

### Task 12: Front, camada de API: `lib/permissoes.ts` e `lib/usuarios.ts`

**Files to change:**
- `src/frontend/lib/permissoes.ts` (novo: constantes do catálogo espelhadas, tipo `Permissao`, `fetchMinhasPermissoes()`)
- `src/frontend/lib/operacao.ts` (sai `fetchPermissoes`/`Permissoes`; os chamadores migram)
- `src/frontend/lib/usuarios.ts` (`AppUser` ganha `papel`, `excecoes`, `permissoesEfetivas`; novas `listarPapeis`, `atribuirPapel`, `definirExcecoes`; `criarUsuario` envia `papelId`; sai `UserRole`)
- `src/frontend/__tests__/permissoes-api.test.ts` (novo)
- `src/frontend/__tests__/usuarios-api.test.ts`

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): testes escritos antes, com `fetch` mockado
- [ ] `fetchMinhasPermissoes()` devolve `{ permissoes: Set<Permissao>, papel?: { id, nome } }`. Valores desconhecidos no array são descartados
- [ ] **Compatibilidade D4:** resposta sem o array `permissoes` (backend antigo, só `{ operacao }`) → o resultado é marcado como `legado: true` e o chamador decide pelo `role` do token (Task 13). Teste com o corpo antigo exato
- [ ] Erro de rede ou 5xx → rejeita (o provider trata como fail-closed); 401 segue o caminho do `apiFetch` (modal de sessão)
- [ ] `atribuirPapel(id, papelId)` → `PATCH /usuarios/:id/papel`; `definirExcecoes(id, excecoes)` → `PUT /usuarios/:id/permissoes`; `listarPapeis()` → `GET /usuarios/papeis`. Fora de 2xx, lançam `UsuariosApiError` com a mensagem e o `status` do backend (409 preservado)

**Dependencies:** Task 8, Task 9

---

### Task 13: Front, `usePermissoes` no lugar de `useIsAdmin`; nav e cards da home

**Files to change:**
- `src/frontend/lib/auth/PermissoesProvider.tsx` (novo; ou dentro do `AuthProvider.tsx`, desde que o hook seja único)
- `src/frontend/lib/auth/AuthProvider.tsx` (sai `useIsAdmin`; `useRole` fica só para o fallback D4)
- `src/frontend/components/nav/app-nav.tsx`
- `src/frontend/components/nav/app-nav.test.tsx`
- `src/frontend/app/page.tsx` (cards Permutas / SISPAG / Adiantamentos)
- `src/frontend/app/page.test.tsx`
- `src/frontend/components/home/OperacaoHomeCard.tsx`
- `src/frontend/components/home/AdminHomeCard.tsx`
- `src/frontend/__tests__/AppShell.test.tsx`
- `src/frontend/__tests__/auth/permissoes-provider.test.tsx` (novo)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `permissoes-provider.test.tsx` e os casos novos de `app-nav.test.tsx` e `page.test.tsx` escritos antes
- [ ] `usePermissoes()` devolve `{ carregando, tem(p): boolean }`. Busca `/me/permissoes` **uma vez por sessão** e de novo quando o token muda (login/troca de usuário); não refaz a cada navegação
- [ ] `devBypass` → catálogo inteiro (D1). Resposta legada (D4) → catálogo inteiro se `useRole() === 'admin'`, e `operacao:ver` conforme a chave `operacao`. Erro → conjunto vazio (fail-closed), sem quebrar a tela
- [ ] `useIsAdmin` não existe mais (`grep -rn useIsAdmin src/frontend` vazio)
- [ ] Nav: "Permutas" (e filhos) ⇐ `permutas:ver`; "SISPAG" ⇐ `isSispagEnabled() && sispag:ver`; "Adiantamentos" ⇐ `recebimentos:ver`; "Operação" ⇐ `operacao:ver`; "Métricas" ⇐ `metricas:ver`; "Usuários" ⇐ `usuarios:gerenciar`. Item sem permissão é **escondido**, nunca desabilitado (R11). Teste table-driven: para cada item, com e sem a permissão
- [ ] Enquanto `carregando`, nenhum item condicionado pisca (não aparece e some); o teste cobre o estado pendente
- [ ] Home: cards Permutas / SISPAG / Adiantamentos escondidos sem o `:ver`; o esmaecimento do SISPAG por flag continua como está; `OperacaoHomeCard` ⇐ `operacao:ver`; `AdminHomeCard` ⇐ `usuarios:gerenciar`. Os dois cards deixam de chamar `fetchPermissoes` por conta própria
- [ ] Comentários que citam `OPERACAO_USUARIOS` ou "allow-list" são atualizados

**Dependencies:** Task 12

---

### Task 14: Front, guard de página ("Você não tem acesso a esta área.")

**Files to change:**
- `src/frontend/components/auth/AcessoNegado.tsx` (novo) e `src/frontend/components/auth/ExigePermissao.tsx` (novo; ou um só componente composto, conforme o DS)
- `src/frontend/app/permutas/page.tsx`, `src/frontend/app/permutas/borderos/page.tsx`, `src/frontend/app/permutas/clientes-filtro/page.tsx` ⇐ `permutas:ver`
- `src/frontend/app/sispag/page.tsx` ⇐ `sispag:ver` (depois do bloqueio por flag que já existe)
- `src/frontend/app/recebimentos/layout.tsx` ou `page.tsx` ⇐ `recebimentos:ver`
- `src/frontend/app/metricas/page.tsx` ⇐ `metricas:ver`
- `src/frontend/app/usuarios/page.tsx` ⇐ `usuarios:gerenciar` (substitui o `isAdmin`)
- `src/frontend/__tests__/auth/exige-permissao.test.tsx` (novo) + casos nos `page.test.tsx` existentes

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): testes escritos antes
- [ ] Sem a permissão, a página renderiza **só** o estado vazio "Você não tem acesso a esta área." com link para a home; **não** redireciona e **não** dispara as chamadas de dados da página (teste: nenhum `fetch` de dados do módulo)
- [ ] Com a permissão, a página renderiza como hoje. Enquanto `carregando`, mostra o carregamento padrão do DS, nunca o "sem acesso" (sem pisca)
- [ ] `/operacao` continua tratando o 404 do backend como "não existe" (sem mudança; o teste existente continua verde)
- [ ] Componente com tokens semânticos (sem cor crua), texto em português, ícone `aria-hidden`, light e dark

**Dependencies:** Task 13

---

### Task 15: Front, Permutas: botões de ação ⇐ `permutas:executar`

**Files to change:**
- `src/frontend/app/permutas/page.tsx`
- `src/frontend/app/permutas/BorderosPanel.tsx`
- `src/frontend/app/permutas/borderos/page.tsx`
- `src/frontend/app/permutas/clientes-filtro/page.tsx`
- `src/frontend/app/permutas/components/` (os pontos de entrada dos diálogos: `PermutaPendenteTable.tsx`, `VisaoGeralTable.tsx`, `AbaAutomaticas.tsx`, `AbaMultiplas.tsx`, `AbaCrossOver.tsx`, `AbaCrossProcess.tsx`, `AbaHistorico.tsx`, conforme o botão morar em cada um)
- `src/frontend/__tests__/permutas-components.test.tsx` (+ teste novo `permutas-executar.test.tsx` se ficar grande)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): testes escritos antes
- [ ] Com só `permutas:ver`, **não** aparecem: ingestão ("Atualizar dados"), eleição, alocar, exceção manual e desfazer exceção, processar, reconciliar, gerar numerário, reconciliar lote, finalizar/cancelar/estornar/excluir borderô, remover baixa, adicionar/remover cliente-filtro. Teste table-driven: um caso por botão, procurando pelo nome acessível
- [ ] Com `permutas:executar`, todos aparecem como hoje (mesmo teste, outro ramo)
- [ ] Leituras continuam para quem só vê: `/permutas/status` no load, lista de borderôs e baixas (JC-2), exportar relatórios `.xlsx` (é `ver`)
- [ ] Nenhum botão é desabilitado por permissão: ausente = escondido (R11)

**Dependencies:** Task 13

---

### Task 16: Front, SISPAG: botões de ação ⇐ `sispag:executar`

**Files to change:**
- `src/frontend/app/sispag/page.tsx`
- `src/frontend/app/sispag/components/LoteCard.tsx`
- `src/frontend/app/sispag/components/BoletosDdaTab.tsx`
- `src/frontend/app/sispag/components/GerarRemessaDialog.tsx`
- `src/frontend/app/sispag/components/IngestaoDialog.tsx`, `AdicionarTituloDialog.tsx`, `RetirarDoLoteDialog.tsx`, `ConfirmarAcaoDialog.tsx` (pontos de entrada)
- `src/frontend/app/sispag/page.test.tsx`, `components/LoteCard.test.tsx`, `components/BoletosDdaTab.test.tsx`

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): testes escritos antes
- [ ] Com só `sispag:ver`, **não** aparecem: novo lote, formar lotes, incluir/remover item, retirar do lote, modalidade, escolher conta, finalizar/reabrir/cancelar, gerar remessa, baixar `.REM`, conciliar retorno, ingestão, sincronizar DDA. Um caso de teste por botão
- [ ] Com só `sispag:ver`, a tela **não** chama `GET /sispag/contas-pagadoras` nem `GET /sispag/lotes/:id/remessa/arquivo` (JC-3). Teste sobre o `fetch` mockado
- [ ] Com `sispag:executar`, tudo como hoje
- [ ] A simulação de retorno (só dev local) continua restrita ao que já era e também exige `sispag:executar`

**Dependencies:** Task 13

---

### Task 17: Front, Adiantamentos e Operação: botões de ação

**Files to change:**
- `src/frontend/app/recebimentos/page.tsx`
- `src/frontend/app/recebimentos/components/AcoesLinhaMenu.tsx`
- `src/frontend/app/recebimentos/components/ImportarExtratoDialog.tsx`, `AlocarProcessosDialog.tsx`, `FalhasTable.tsx`, `NdeTable.tsx` (pontos de entrada)
- `src/frontend/app/recebimentos/page.test.tsx` e testes dos componentes tocados
- `src/frontend/app/operacao/page.tsx` (botão "Reconhecer")
- `src/frontend/app/operacao/page.test.tsx`

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): testes escritos antes
- [ ] Com só `recebimentos:ver`, **não** aparecem: rodar pipeline, ingestão, upload de extrato (preview incluso), solicitação de numerário / alocar processos, arquivar/desarquivar. Um caso por ação, incluindo os itens do `AcoesLinhaMenu`
- [ ] Com `recebimentos:executar`, tudo como hoje
- [ ] Operação: "Reconhecer" aparece para quem tem `operacao:ver` (é quem chega à página); o teste existente continua verde

**Dependencies:** Task 13

---

### Task 18: Front, `/usuarios`: papel do banco, criação com papel, "Editar acesso"

**Files to change:**
- `src/frontend/app/usuarios/page.tsx`
- `src/frontend/app/usuarios/NovoUsuarioDialog.tsx`
- `src/frontend/app/usuarios/EditarAcessoDialog.tsx` (novo)
- `src/frontend/__tests__/usuarios-page.test.tsx`
- `src/frontend/__tests__/editar-acesso-dialog.test.tsx` (novo)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): testes escritos antes, com a lib mockada
- [ ] A coluna "Papel" mostra `papel.nome` vindo do banco (não mais `admin`/`operador` fixos) e indica quando o usuário tem exceções (ex.: badge "com exceções", sem depender só de cor)
- [ ] `NovoUsuarioDialog`: o seletor "Papel" lista `listarPapeis()`, **sem valor pré-selecionado**; "Criar" fica bloqueado até escolher (Q3). Envia `papelId`
- [ ] Ação "Editar acesso" na linha abre `EditarAcessoDialog` com: seletor de papel; a lista do `catalogo` agrupada por módulo (ver/executar) mostrando, para cada permissão, **o efetivo** e a origem (papel, concedida, revogada); controles para conceder/revogar/voltar ao papel
- [ ] Regra de UI do Q8: marcar "executar" marca "ver"; desmarcar "ver" desmarca "executar". Teste para as duas direções
- [ ] Salvar chama `atribuirPapel` (se o papel mudou) e `definirExcecoes` (se as exceções mudaram); sucesso = toast, fecha, recarrega a lista. 409 da guarda (último gestor, a própria permissão) aparece **inline no diálogo**, que continua aberto (padrão de `docs/design-system/forms.md`)
- [ ] Na própria linha (`souEu`), o diálogo avisa que remover a própria `usuarios:gerenciar` não é permitido; o servidor continua sendo o gate
- [ ] Desativar: o 409 de "último gestor" mostra a mensagem nova do backend e o switch volta (reversão otimista existente)
- [ ] Tokens semânticos do DS, light e dark; acessível por teclado; rótulos em português

**Dependencies:** Task 12, Task 14

---

### Task 19: ADR 0053: permissões por módulo lidas do banco

**Files to change:**
- `ontology/decisions/0053-auth-permissoes-por-modulo-no-banco.md` (novo; via OntologyCurator, sem diff de entidade)
- `ontology/decisions/0011-*.md` e `ontology/decisions/0042-*.md` (nota "emendada pela ADR-0053" no topo, se for o costume do repo)
- `ontology/CHANGELOG.md` (entrada, se for o costume para ADR sem diff de entidade)

**Acceptance criteria:**
- [ ] A ADR registra: catálogo fixo de nove permissões; papéis como pacotes e exceções conceder/revogar; fórmula das efetivas; "permissão nunca no token" (I1) e por que a chave é `app_user.id` (passo 3 troca só a metade `sub → app_user`); cache de 30 s com invalidação no processo e fail-closed (503); 401 para inexistente/inativo (fecha a lacuna das 12 h da ADR-0051); R9/R-extra; a trilha append-only; o mapeamento por rota com JC-1…JC-6 e a assimetria de JC-3
- [ ] **Emenda a ADR-0011**: `requireRole('admin')` deixa de existir; toda rota autenticada tem guard explícito, conferido por teste de cobertura
- [ ] **Emenda a ADR-0042**: `OPERACAO_USUARIOS` aposentada; registra que ela estava **vazia em produção em 2026-09-28**, então todo admin já via o painel e `operacao:ver` no Administrador preserva exatamente quem vê; o 404 sem corpo é mantido
- [ ] Registra Q6 (desativar `admin` quebra o `kavex-report-ciclo` até trocar `FINANCEIRO_API_USUARIO`), Q12 (`filialAuthz` ainda lê o token; quando for feito, vem do banco), D1 (bypass), D2–D4 (janela de deploy) e D7 (reverse)
- [ ] Número 0053 reconferido contra a `main` no rebase
- [ ] Nenhum arquivo em `ontology/entities/` muda

**Dependencies:** none

---

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` ✅ (backend **e** frontend)
- [ ] `npm run lint` ✅ (backend **e** frontend; no frontend o gate é o `lint`, não o `prettier --check`)
- [ ] `npm test` ✅ (backend **e** frontend), incluindo o teste de cobertura de rotas da Task 7
- [ ] PatternGuardian gate ✅ (tsyringe, `@singleton` no `AccessService`, Zod nas bordas, SQL parametrizado, sem `process.env` cru em service, métodos arrow, modificadores explícitos, classes exportadas). Conferir P0 contra a `main`: o agente revisa o arquivo inteiro
- [ ] SpecVerifier: todos os critérios acima aprovados
- [ ] `bootstrapAppContainer` sem diff (gotcha dos ~58 jobs) ✅
- [ ] [entity_changed=false] sem diff de entidade; só a ADR 0053 e `ui-flows/navegacao-global.md` ✅
- [ ] [frontend touched] DesignSystemReviewer gate ✅ (`AcessoNegado`, `ExigePermissao`, `EditarAcessoDialog`, `NovoUsuarioDialog`, nav, home)
- [ ] [new handler/job] não se aplica: nenhum handler Lambda nem job novo. ObservabilityAdvisor não é acionado
- [ ] [infra/] não se aplica: não existe `infra/`. AwsInfraArchitect não é acionado
- [ ] Roteiro de QA manual abaixo executado e anotado no PR
- [ ] Regis-Review rodado (os `qa-*` com `model=sonnet`); **P0 remediados**; P1/P2/P3 vão para `auth-permissoes-modulo-regis-followups.md`
- [ ] Rebase de `origin/main` limpo e gates ainda verdes; número da migration (0066) e da ADR (0053) reconferidos
- [ ] [delta com feat em `src/`] versão do app bumpada (minor → v0.44.0, FE+BE em lockstep) **à mão** nos dois `package.json` (não há `pwsh` nesta máquina), conferindo antes a versão real da `main`, + `CHANGELOG.md` atualizado ✅
- [ ] Nota no PR sobre deploy (seção abaixo)

## Notas de deploy

- **Ordem:** o desenho não depende de ordem (D2, D3, D4), mas o seguro é **backend primeiro**. Com Vercel e Render publicando no merge, o front novo pode chegar antes: ele lê `/me/permissoes` antigo (só `{ operacao }`), cai no fallback legado e mostra tudo para `role = 'admin'`, que é todo mundo.
- **Front antigo × backend novo:** o token continua com `role: 'admin'` para todos (D3), então `useIsAdmin` antigo segue mostrando "Usuários"; `/me/permissoes.operacao` continua existindo; `GET /usuarios` continua trazendo `role`; `POST /usuarios` aceita `role: 'admin'` e recusa `'operador'` com "Atualize a página…" (D2). Todas as rotas que o front antigo chama são permitidas ao Administrador.
- **Instância antiga durante o switch do Render:** continua com `requireRole` e sem ler o banco. Ninguém perde acesso. A lacuna das 12 h só fecha quando a instância nova estiver sozinha.
- **Migration:** aplicada pelo `BootMigrator` no boot. Se abortar pela guarda do Q3 (algum `role` diferente de `'admin'`), o boot falha alto: corrigir a linha à mão e subir de novo. Produção tinha 15 usuários, todos `admin`, em 2026-09-28.
- **Rollback:** voltar o backend para a v0.43.1 **e depois** aplicar `rollbacks/0066_auth_permissoes_modulo.rollback.sql` à mão (com `role_id NOT NULL`, o `POST /usuarios` antigo falha até o reverse). A trilha de acesso gravada no intervalo se perde.
- **Pós-deploy:** apagar `OPERACAO_USUARIOS` do Render (já vazia). Antes de desativar a conta `admin`, trocar `FINANCEIRO_API_USUARIO` do `kavex-report-ciclo` (Q6).
- **Custo:** uma consulta a mais por requisição a cada 30 s por usuário (cache frio). Com ~15 usuários, desprezível.

## Roteiro de QA manual (Postgres descartável, local)

**Nunca contra o banco de produção** (ver memória "sessão do robô contaminável por dev local"). Conexos não é necessário: o que se testa é o guard, e telas que dependem do ERP podem mostrar erro de dados sem invalidar o teste.

**Preparação**

```bash
docker run --rm -d --name fin-qa -p 5433:5432 \
  -e POSTGRES_USER=financeiro -e POSTGRES_PASSWORD=devlocal -e POSTGRES_DB=financeiro postgres:16
cd src/backend
npm run migrate:local                       # aplica até a 0066
export databaseConnectionString=postgresql://financeiro:devlocal@localhost:5433/financeiro
ADMIN_EMAIL=adm@qa.local ADMIN_PASSWORD='Qa-senha-123' npm run seed:admin
# backend com auth real (sem DEV_AUTH_BYPASS), SISPAG_ENABLED=true, RECEBIMENTOS_ENABLED=true
npm run dev
cd ../frontend && npm run dev
```

Logado como `adm@qa.local` (Administrador), pela tela `/usuarios`: criar `ver@qa.local` (papel Administrador) e `inativo@qa.local` (Administrador). Em "Editar acesso" de `ver@qa.local`, **revogar** `permutas:executar`, `sispag:executar`, `recebimentos:executar`, `operacao:ver` e `usuarios:gerenciar` (fica só com `permutas:ver`, `sispag:ver`, `recebimentos:ver`, `metricas:ver`). Logar como `inativo@qa.local` num segundo navegador e **guardar o token** (DevTools → storage). Depois, como `adm`, desativar `inativo@qa.local`.

1. **Migration e seed.** `psql` na base de QA: `app_role` tem `Administrador` com 9 linhas em `app_role_permission`; todo `app_user` tem `role_id` preenchido; rodar `npm run migrate:local` de novo não falha. Numa base nova, inserir antes um `app_user` com `role = 'operador'` e migrar: a 0066 aborta com a mensagem em português.
2. **Administrador vê tudo (I6).** Como `adm`: nav com Permutas (e filhos), SISPAG, Adiantamentos, Operação, Métricas, Usuários; home com todos os cards; todos os botões de ação presentes nas três frentes. `GET /me/permissoes` devolve as nove, `papel.nome = "Administrador"` e `operacao: true`.
3. **Só-leitura: nav, home, páginas.** Como `ver@qa.local`: nav **sem** Operação e Usuários; home sem `OperacaoHomeCard` e `AdminHomeCard`; `/permutas`, `/permutas/borderos`, `/sispag`, `/recebimentos`, `/metricas` abrem; `/usuarios` mostra "Você não tem acesso a esta área." com link para a home, sem redirecionar.
4. **Só-leitura: botões.** Nas três frentes, nenhum botão de ação aparece (ingestão, eleição, reconciliar, finalizar borderô, novo lote, gerar remessa, baixar `.REM`, conciliar retorno, sincronizar DDA, upload de extrato, arquivar…). Nada aparece desabilitado: some. Em `/sispag`, a aba de rede **não** mostra chamada a `/sispag/contas-pagadoras`. `/permutas` carrega os badges (`/permutas/status` responde 200).
5. **403 com mensagem e código.** Com o token de `ver@qa.local`:
   `curl -s -X POST -H "Authorization: Bearer $TOKEN" localhost:<porta>/permutas/ingestao` → 403 `{"error":"Você não tem permissão para esta ação.","permissao":"permutas:executar"}`. Repetir para `GET /sispag/contas-pagadoras` (`sispag:executar`), `POST /recebimentos/pipeline/run` (`recebimentos:executar`), `GET /usuarios` (`usuarios:gerenciar`).
6. **Operação sem permissão = 404.** Com o token de `ver@qa.local`: `GET /operacao` e `POST /operacao/alertas/1/reconhecer` → 404 `{"error":"Not found"}`, sem menção a permissão; nav sem o item Operação. Acessar `/operacao` direto no navegador mostra o "não existe" de hoje. Confirmar que `OPERACAO_USUARIOS` não é lida (defini-la com qualquer valor e reiniciar não muda nada para `adm` nem para `ver`).
7. **Cache de 30 s e invalidação imediata.**
   (a) Pela UI: como `adm`, conceder `sispag:executar` a `ver@qa.local`; no navegador de `ver`, recarregar a página: o botão "Novo lote" aparece na hora (o front refaz `/me/permissoes` no reload; o backend foi invalidado no processo). O `curl` do passo 5 para uma rota de `sispag:executar` passa imediatamente.
   (b) Por SQL (sem invalidação): `DELETE FROM user_permission WHERE user_id = <ver> AND permission = 'sispag:executar'` direto no `psql`. O `curl` continua passando por **até 30 s** e depois recebe 403. Anotar o tempo observado.
8. **Token de usuário desativado é recusado.** Com o token guardado de `inativo@qa.local`: `GET /me/permissoes` → 401 com a mensagem de sessão encerrada; no navegador dele, qualquer ação abre o modal de sessão expirada. Reativar pela UI: o mesmo token volta a funcionar na próxima requisição (invalidação).
9. **Guarda do último gestor.** Garantir que `adm` é o único ativo com `usuarios:gerenciar`. Como `adm`: tentar revogar a própria `usuarios:gerenciar` → 409 "Você não pode remover a sua própria permissão de gerenciar usuários." inline no diálogo; desativar a si mesmo → switch desabilitado e, via `curl`, 409 "Você não pode desativar o próprio acesso.". Conceder `usuarios:gerenciar` a `ver@qa.local`, logar como `ver` e desativar `adm`: passa (sobra `ver`). Como `ver`, tentar revogar a própria `usuarios:gerenciar`: 409 (a própria). Reativar `adm`.
   O 409 "Não é possível remover o último usuário com permissão de gerenciar usuários." **não é alcançável pela tela em uso normal**: quem chama está ativo e tem `usuarios:gerenciar`, e a regra "a própria" é checada antes. Ele protege as corridas (dois gestores removendo um ao outro ao mesmo tempo) e a janela de cache. A cobertura é a dos testes da Task 4 (casos a–c e h). Para vê-lo à mão: abrir duas abas como `adm` e `ver` (ambos gestores), e nas duas, ao mesmo tempo, revogar `usuarios:gerenciar` do outro. Uma passa, a outra recebe o 409.
10. **Trilha de auditoria.** `SELECT ator, alvo_user_id, tipo, antes, depois, em FROM app_user_access_event ORDER BY id;` mostra uma linha por mudança feita acima (criação com `antes = null`, cada exceção, desativação, reativação), com `ator` = `username` de quem fez. Salvar o mesmo conjunto de exceções de novo não gera linha. No log do backend, uma linha em português por mudança. A mudança feita por SQL no passo 7b **não** aparece (esperado).
11. **Flags antes da permissão.** `SISPAG_ENABLED=false`, reiniciar: com o token de `ver`, `GET /sispag/painel` devolve o 403 "indisponível" do gate, não o de permissão; nav sem SISPAG.
12. **Banco fora = 503.** Parar o container (`docker stop fin-qa`) com o backend no ar: uma rota autenticada (depois de 30 s, ou com usuário ainda não cacheado) devolve 503 com a mensagem em português, nunca 200. `/health` continua respondendo.
13. **Identidade inalterada (I5).** Decodificar o token de `adm`: chaves `sub`, `role`, `aud`, `iat`, `exp`, sem permissão. Uma ação de escrita local qualquer (ex.: arquivar/desarquivar transação em Adiantamentos, se houver dado) grava o `username` como ator.
14. **Compatibilidade do front antigo.** Com o backend novo e o frontend da `main` (v0.43.1) em outra porta: login, nav completa, criar usuário escolhendo "Administrador" funciona; com "Operador" aparece "Atualize a página para escolher o papel do usuário.".

Ao fim: `docker stop fin-qa` (o `--rm` apaga o container).

## Riscos e ambiguidades

1. **`DEV_AUTH_BYPASS` libera tudo (D1).** O bypass passa a ser "usuário fictício com todas as permissões", decidido pelo dono do ciclo. O risco é o bypass vazar para produção; a trava já existe (`authEnv` derruba o boot fora de local/dev) e ganha teste explícito nesta feature.
2. **Compatibilidade de criação na janela (D2).** O diálogo antigo nasce com `operador` selecionado; quem criar usuário pelo front antigo durante o deploy leva 400 até recarregar. Janela de minutos, mensagem explícita.
3. **Fallback legado no front (D4)** é fail-open **de UI** (mostra tudo) quando o backend é antigo. Não abre porta (o backend antigo gateia por `role`), mas precisa sair no tweak que remover a chave `operacao` de `/me/permissoes`; senão vira caminho morto.
4. **R9 com poucas linhas, trava ampla.** A guarda trava **todas** as linhas ativas de `app_user` em cada escrita de acesso. Com ~15 usuários é trivial; se a base crescer muito, vira ponto de contenção. Registrar como P3 se o Regis apontar.
5. **Cache em memória e mais de uma instância.** Hoje é uma instância (`plan: starter`). Se `numInstances` subir, a invalidação no processo não alcança as outras e o pior caso vira 30 s para qualquer mudança feita pela tela. Está no Q11; a ADR precisa dizer isso.
6. **Teste de cobertura depende da forma interna do Express 5** (`router.stack`, `layer.route.path`, `route.methods`). Se uma atualização do Express mudar isso, o teste quebra alto (bom), mas pede manutenção. O teste comportamental por linha é a segunda rede e não depende de internals.
7. **`CHECK` do catálogo no banco** acopla o catálogo do código a uma migration: adicionar uma permissão exige migration que troque o `CHECK`. É o que a R4 pede; o teste de paridade da Task 1 torna o esquecimento visível.
8. **Rollback exige passo manual (D7).** Sem o reverse, o backend antigo não cria usuários. Está no `DEPLOY.md`.
9. **Os 409 do passo 1 mudam de texto.** "Não é possível desativar o último administrador ativo." vira a mensagem de "último gestor". O front novo mostra a mensagem do backend; nenhum teste do front deve depender do texto antigo.
10. **"Último gestor" só acontece em corrida.** Como inativo agora leva 401, todo chamador que chega a `/usuarios` está ativo e tem `usuarios:gerenciar`. Uma mudança sobre outro usuário deixa sempre ao menos o chamador. A guarda de contagem (I4) só atua em concorrência ou com o cache defasado (gestor que perdeu a permissão por SQL há menos de 30 s). Ela continua obrigatória (I4 é o risco de "tranca a gestão"), mas o teste relevante é o transacional da Task 4, não o roteiro manual.
11. **Tamanho.** XL: a AutoLoopRunner deve fechar backend (Tasks 1–11) verde antes do frontend (12–18). Tasks 15–17 são paralelizáveis entre si.
