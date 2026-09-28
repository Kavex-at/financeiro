---
qa: Security
qa_slug: security
run_id: 2026-09-28-1550-auth-email-transicao
agent: qa-security
generated_at: 2026-09-28T15:56:11Z
scope: all
score: 7.2
findings_count: 4
cards_count: 3
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao Financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Admin da plataforma (legítimo, ou uma sessão de admin sequestrada via phishing/token vazado) | Reseta a senha de outro usuário, troca o vínculo Conexos dele ou desativa/reativa o acesso pela tela `/usuarios` | `UserAdminService` / `UserRepository` (`app_user`) | Produção, single-tenant Columbia (estado atual — o isolamento multi-tenant por conta AWS é **alvo**, ainda não existe) | O sistema deve, no mínimo, persistir quem fez o quê e quando — porque `username` é o `sub` gravado como `executado_por`/`criado_por` em TODOS os ledgers de Permutas, SISPAG e Recebimentos (ADR-0051, D2): sequestrar a identidade de um usuário (senha ou vínculo Conexos) é sequestrar a autoria de baixas e remessas dele | 100% das ações que mudam senha, vínculo Conexos ou identidade de outro usuário devem gerar um registro persistido (coluna de auditoria ou `LogService`) — medido: **40%** (2 de 5) |

Esta revisão é sobre o **passo 1 de 3** do plano de auth (ADR-0051): e-mail real de login, sem tocar
RBAC granular (passo 2) nem Supabase Auth (passo 3). O escopo de multi-tenant/blast-radius da missão
(uma conta AWS por cliente) **não se aplica a este repo hoje** — não existe `infra/`, o deploy é
Render (backend) + Vercel (frontend) para um único cliente (Columbia). Tactics de isolamento entre
tenants são avaliadas como `N/A` nesta seção, com a ressalva de que são o maior risco do **estado-alvo**,
não deste delta.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta | 0 | 0 | ✅ | `git diff origin/main...HEAD \| grep -E "(password\|secret\|token\|credential)\s*[:=]\s*['\"]"` — só fixtures de teste (`'segredo12'`, `'errada123'`) |
| Chaves AWS no delta | 0 | 0 | ✅ | `grep -E "AKIA[0-9A-Z]{16}"` no diff |
| `.env` / `.tfstate` novos no delta | 0 | 0 | ✅ | `git diff --stat` — só `.env.example` (placeholders vazios) |
| Sites de SQL não-parametrizado no delta | 0 | 0 | ✅ | `src/backend/domain/repository/auth/UserRepository.ts` — 100% `$nome` via client parametrizado |
| Endpoints do delta validados com Zod | 6/6 (100%) | 100% | ✅ | `routes/auth.ts` (`loginBodySchema`), `routes/usuarios.ts` (`createUserSchema`, `setEmailSchema`, `setAtivoSchema`, `resetPasswordSchema`, `vinculoConexosSchema`) |
| Ações mutantes de `UserAdminService` com trilha de auditoria persistida | 2/5 (40%) — `create` (coluna `created_by`), `setEmail` (coluna `email_updated_by/at` + `LogService.info`) | 100% | ⚠️ | `src/backend/domain/service/auth/UserAdminService.ts` — `setVinculo`, `setAtivo`, `resetPassword` não gravam autor nem logam |
| Custo bcrypt | 12 rounds | ≥ 10 (OWASP) | ✅ | `AuthService.ts`/`UserAdminService.ts`/`seed-admin.ts` — `BCRYPT_ROUNDS = 12` |
| Expiração do JWT de login | 12h, sem revogação server-side | Revogável ou TTL curto + refresh | ⚠️ | `AuthService.ts:32` `TOKEN_EXPIRATION = '12h'`; nenhuma checagem de `ativo` por requisição (`http/auth.ts`, `http/conexosIdentity.ts` — pré-existentes, fora do delta) |
| Credencial default hardcoded no `seed-admin` | 0 (era 1 antes do delta: `ADMIN_PASSWORD ?? 'columbia2026'`) | 0 | ✅ (remediado por esta feature) | `git show origin/main:src/backend/jobs/seed-admin.ts` vs `src/backend/jobs/seed-admin.ts` + `SeedAdminConfig.ts` |
| `dangerouslySetInnerHTML`/`innerHTML` nos arquivos do delta (frontend) | 0 | 0 | ✅ | `grep` em `app/usuarios/*`, `app/login/*`, `lib/*` tocados pelo delta |
| `localStorage`/`sessionStorage` nos arquivos do delta (frontend) | 0 | 0 | ✅ | mesmo grep — usa `withAuthHeaders`/`apiFetch` pré-existentes |
| `npm audit` (profundo) | não medido | crítico=0, alto=0 | ⚠️ Não medível | `--quick` — omitido por instrução do run |
| Isolamento multi-tenant (blast radius) | não aplicável | N/A | N/A | não existe `infra/`; single-tenant Columbia |

## 3. Tactics — Cobertura no Financeiro (delta `auth-email-transicao`)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Logger genérico de request/response (console.log REQ/RES, com redação de corpo) — pré-existente, não tocado pelo delta; nenhuma detecção de padrão de ataque (ex.: N tentativas de login falhas de identificadores distintos do mesmo IP) | ⚠️ parcial | `src/backend/http/buildApp.ts` (pré-existente) |
| Detect Service Denial | `globalLimiter` (100 req/min/IP) e `heavyRouteLimiter` (10 req/min/IP) — pré-existentes, herdados automaticamente pelas rotas novas `/auth/login` e `/auth/transicao` | ✅ presente (herdado) | `src/backend/http/rateLimit.ts`, `buildApp.ts:47` |
| Verify Message Integrity | JWT HS256 assinado (`AUTH_JWT_SECRET`) garante integridade do token; TLS fica a cargo do edge Render/Vercel, não verificado na aplicação | ⚠️ parcial | `AuthService.ts:95-111` |
| Detect Message Delay | N/A — fluxo síncrono HTTP request/response, sem fila/mensageria neste delta | N/A — sem artefato de mensageria no escopo |
| Identify Actors | Identificador único (e-mail OU `username`, sem distinção de caixa), com guarda de ambiguidade (`candidates.length > 1` → recusa) e índices `lower()` que impedem duas linhas colidirem | ✅ presente | `UserRepository.ts:134-142`, migration `0064` linhas 13-32, 39-45 |
| Authenticate Actors | bcrypt (12 rounds) + JWT auto-assinado; resposta uniforme para "não existe" / "inativo" / "senha errada" (I2) — mas ver F-security-2 (oráculo de tempo) | ⚠️ parcial | `AuthService.ts:56-93` |
| Authorize Actors | `requireRole('admin')` (pré-existente) protege o router `/usuarios` inteiro; modelo de papel ainda é binário (`admin`/`operador`), sem escopo por filial/tenant no token (`filiais` claim opcional, ausente hoje — deferido ao passo 2 do ADR-0051) | ⚠️ parcial | `routes/usuarios.ts:32`, `http/auth.ts:200-215` (pré-existente) |
| Limit Access | Vínculo Conexos só disponível quando a chave de cripto está configurada (503 se ausente); rota de gestão de usuários fechada a não-admin | ✅ presente | `UserAdminService.ts:168-169`, `routes/usuarios.ts:57-62` |
| Limit Exposure | `GET /auth/transicao` devolve deliberadamente só `{ ativo: boolean }` — nada de contagem, nomes ou e-mails (I5, citado no próprio código) | ✅ presente, bem evidenciado | `routes/auth.ts:52-64` |
| Encrypt Data | Senha do vínculo Conexos cifrada (AES-GCM via `SecretCipher`) antes de persistir; senha de login nunca em claro (bcrypt); e-mail em claro (esperado — não é segredo) | ✅ presente | `UserAdminService.ts:160`, `UserRepository.ts:33-37` |
| Separate Entities | Monólito único (Express + Postgres); nenhuma separação nova introduzida pelo delta | N/A — sem infra multi-tenant no repo hoje |
| Change Default Settings | **Delta remove uma credencial default hardcoded** (`ADMIN_USERNAME ?? 'admin'` / `ADMIN_PASSWORD ?? 'columbia2026'`) e passa a EXIGIR `ADMIN_EMAIL`/`ADMIN_PASSWORD` sem fallback no código — o job falha (exit 1) em vez de semear uma conta com senha pública no repositório | ✅ presente, reforçado por este delta | `SeedAdminConfig.ts`, comparar com `git show origin/main:src/backend/jobs/seed-admin.ts` (linhas antigas 20-21) |
| Validate Input | Zod em 100% dos endpoints tocados (login, `/auth/transicao` não tem corpo, `/usuarios` POST/PATCH×3/POST reset) | ✅ presente | `routes/auth.ts:17-20`, `UserAdminService.ts:38-78` |
| Revoke Access | Desativar um usuário (`setAtivo`/`deactivateGuarded`) muda o estado no banco, mas o JWT já emitido continua válido por até 12h — nenhuma rota re-checa `ativo` por requisição (só a resolução de sessão Conexos checa `ativo = true`). **Mecanismo pré-existente, não introduzido por este delta** — mas o delta adiciona a guarda R11 (auto-desativação, último admin) ao redor da MESMA lacuna, então é o momento natural de endereçar | ⚠️ parcial (pré-existente) | `UserRepository.ts:262-269,280-312`, `http/auth.ts` (pré-existente, fora do delta) |
| Lock Computer | N/A — não há bloqueio de conta por tentativas falhas (nem pré-existente); ver F-security-2 | ❌ ausente |
| Inform Actors | Erro 409 nomeado (`EmailAlreadyInUseError`, `SelfDeactivationError`, `LastActiveAdminError`) devolve mensagem clara ao admin que operou; nenhum canal informa o USUÁRIO AFETADO (ex.: e-mail "sua senha foi redefinida") | ⚠️ parcial | `routes/usuarios.ts:44-69` |
| Restore | N/A para este delta — migration `0064` é só aditiva, sem script de reverse (documentado como decisão deliberada, não gap) | N/A — ver Availability/Deployability para rollback de deploy |
| Audit Trail | **Inconsistente**: `create` e `setEmail` persistem autor (coluna) e `setEmail` também loga; `setVinculo`, `setAtivo`, `resetPassword` não persistem quem agiu nem logam — apesar do delta ter introduzido `LogService` no `UserAdminService` justamente para isso | ⚠️ parcial — ver F-security-1 | `UserAdminService.ts:108-193` |

## 4. Findings (achados)

### F-security-1: Trilha de auditoria incompleta nas ações administrativas sobre identidade de usuário

- **Severidade**: P1 (alto — degrada QA mensurável)
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/domain/service/auth/UserAdminService.ts:151-193` (`setVinculo`, `setAtivo`, `resetPassword`)
- **Evidência (objetiva)**:
  ```ts
  public setVinculo = async (id, vinculo) => { /* ...cifra e persiste... nenhuma chamada a logService, nenhuma coluna updated_by/at */ };
  public setAtivo = async (id, ativo, actorUsername) => { /* ...delega ao repository... nenhuma chamada a logService no caminho de sucesso */ };
  public resetPassword = async (id, password) => { /* ...bcrypt.hash + updatePassword... nenhuma chamada a logService, nenhuma coluna */ };
  ```
  Comparar com `setEmail` (mesmo arquivo, linhas 131-143), que loga `'e-mail de login do usuário atualizado'` com `{ id, ator: updatedBy }` — o padrão existe no arquivo, só não foi aplicado às outras três ações. `migrations/0064_app_user_email.sql` adiciona `email_updated_by`/`email_updated_at`, mas não há equivalente para senha, vínculo Conexos ou ativação/desativação.
- **Impacto técnico**: um admin (legítimo ou uma sessão de admin sequestrada) pode resetar a senha de qualquer usuário, trocar o vínculo Conexos dele, ou reativar uma conta desativada — sem que nenhum registro persistido diga QUEM fez, QUANDO. `routes/usuarios.test.ts` só cobre o log/ator para `PATCH /:id/email` (linhas 131-144) e para a guarda de desativação (linha 254) — não para reset de senha nem vínculo.
- **Impacto de negócio**: `username` é o `sub` gravado como `executado_por` nos ledgers de Permutas/SISPAG/Recebimentos e a chave do vínculo Conexos (ADR-0051, D2). Trocar a senha ou o vínculo Conexos de um usuário é, na prática, sequestrar a identidade sob a qual baixas e remessas são atribuídas no ERP — e hoje isso pode acontecer sem deixar rastro para uma investigação pós-incidente.
- **Métrica de baseline**: 2 de 5 ações mutantes de `UserAdminService` persistem autor (`create`, `setEmail`) = **40%**. Alvo: 100%.

### F-security-2: Oráculo de tempo em `AuthService.login` permite enumerar identificadores

- **Severidade**: P3 (baixo — melhoria opcional)
- **Tactic violada**: Authenticate Actors
- **Localização**: `src/backend/domain/service/auth/AuthService.ts:62-84`
- **Evidência (objetiva)**:
  ```ts
  const [user] = candidates;
  if (!user) return null;                 // falha RÁPIDA — sem bcrypt
  if (!user.ativo) return null;            // falha RÁPIDA — sem bcrypt
  const passwordMatches = await bcrypt.compare(password, user.passwordHash); // falha LENTA (~80-150ms, custo 12)
  ```
  O comentário do próprio código (linha 58-60) declara a intenção de não revelar se a conta existe
  ("os três com a mesma resposta"), mas os três caminhos têm tempos de execução mensuravelmente
  diferentes: identificador inexistente ou conta inativa retornam sem tocar bcrypt; senha errada só
  retorna depois do `bcrypt.compare`. Não medido empiricamente nesta revisão (sem acesso a produção),
  mas a diferença estrutural (chamada de bcrypt custo-12 vs. retorno imediato) é a assinatura clássica
  desse oráculo.
- **Impacto técnico**: um atacante consegue distinguir "identificador não existe/está inativo" de "identificador existe, senha errada" medindo a latência da resposta — enumeração de contas ativas.
- **Impacto de negócio**: baixo isoladamente (não vaza credencial), mas facilita phishing direcionado — o atacante aprende quais e-mails/usuários são contas ativas antes de atacá-las.
- **Métrica de baseline**: não medível localmente sem instrumentar timing em produção; achado estrutural do código, não de medição.

### F-security-3: Desativar um usuário não revoga o JWT já emitido (pré-existente, adjacente à guarda R11 deste delta)

- **Severidade**: P2 (médio — débito técnico defensável)
- **Tactic violada**: Revoke Access
- **Localização**: `src/backend/domain/repository/auth/UserRepository.ts:262-312` (mecanismo de desativação); checagem de token em `src/backend/http/auth.ts` (**PRÉ-EXISTENTE, fora do delta**)
- **Evidência (objetiva)**: `setAtivo`/`deactivateGuarded` mudam a coluna `ativo`, mas `buildAuthMiddleware` (pré-existente) só valida assinatura/expiração do JWT — nunca consulta `app_user.ativo`. A única checagem de `ativo` no caminho de escrita é em `getVinculoConexos` (`WHERE ... AND ativo = true`), específica do vínculo Conexos.
- **Impacto técnico**: um token de até 12h (`TOKEN_EXPIRATION`) emitido para um usuário continua autenticando normalmente em toda rota que não dependa do vínculo Conexos (ex.: leituras do Painel, `/metricas`, `/operacao`) mesmo depois de o admin desativá-lo.
- **Impacto de negócio**: no cenário mais provável — desligamento de um funcionário ou vazamento de credencial — a janela entre "admin desativa" e "token expira" pode chegar a 12h de acesso residual de leitura (e a qualquer escrita que não passe pelo Conexos).
- **Métrica de baseline**: TTL do token = 12h; 0 mecanismos de revogação server-side (blocklist/allowlist consultada por requisição). **Nota de escopo: mecanismo pré-existente** — este delta reforça a guarda de QUEM pode desativar (R11), não a revogação de sessão; não é P0/P1 desta feature, mas é o momento natural de endereçar.

### F-security-4 (REMEDIADO por este delta — sem card): credencial default hardcoded no `seed-admin` removida

- **Severidade**: era P0 antes do delta (fixture: `ADMIN_PASSWORD ?? 'columbia2026'`); **remediado nesta branch**, sem risco residual medido
- **Tactic violada (histórica)**: Change Default Settings
- **Localização**: `src/backend/jobs/seed-admin.ts`, `src/backend/jobs/SeedAdminConfig.ts`
- **Evidência (objetiva)**: `git show origin/main:src/backend/jobs/seed-admin.ts` (base) tinha
  `const username = process.env.ADMIN_USERNAME ?? 'admin'; const password = process.env.ADMIN_PASSWORD ?? 'columbia2026';`
  — uma senha hardcoded, pública no repositório, usada se o operador esquecesse de setar `ADMIN_PASSWORD` no Render. O delta troca isso por `new SeedAdminConfig().parse(process.env)`, que EXIGE `ADMIN_EMAIL`/`ADMIN_PASSWORD` (Zod, sem `.default()`) e lança `MissingSeedAdminEnvError` — o job sai com código 1 em vez de semear a conta com a senha pública.
- **Justificativa de não-card**: já resolvido dentro do próprio delta; documentado aqui como evidência positiva da tactic Change Default Settings e para registrar que o risco existiu (caso alguma cópia antiga do job ainda rode em algum ambiente não atualizado).

## 5. Cards Kanban

### [security-1] Persistir autor em toda ação administrativa sobre identidade de usuário

- **Problema**
  > `UserAdminService.setVinculo`, `setAtivo` e `resetPassword` não gravam quem executou a ação nem
  > emitem `LogService`, ao contrário de `create` (coluna `created_by`) e `setEmail` (coluna
  > `email_updated_by/at` + log). Como `username` é o `sub` usado como `executado_por` nos ledgers de
  > Permutas/SISPAG/Recebimentos, sequestrar a senha ou o vínculo Conexos de um usuário sequestra a
  > autoria dele no ERP — sem deixar rastro hoje.

- **Melhoria Proposta**
  > Aplicar o mesmo padrão de `setEmail` às outras três ações (tactic Audit Trail): `resetPassword` e
  > `setVinculo` já recebem (ou podem receber, como `setEmail`/`setAtivo` já recebem) o `actor` de
  > `req.user.sub` na rota — falta só (1) uma coluna `password_updated_by/at` e `vinculo_updated_by/at`
  > em `app_user` (migration aditiva, no padrão da `0064`), e (2) um `logService.info` em cada método de
  > `UserAdminService.ts`, com `{ id, ator }`. Adicionar teste espelhando
  > `routes/usuarios.test.ts:139-144` para as três rotas.

- **Resultado Esperado**
  > Cobertura de auditoria em `UserAdminService`: 40% (2/5) → 100% (5/5). Toda troca de senha, vínculo
  > Conexos ou reativação/desativação de usuário é rastreável a um `ator` e um timestamp.

- **Tactic alvo**: Audit Trail
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - % de ações mutantes de `UserAdminService` com trilha persistida: 40% → 100%
- **Risco de não fazer**: um incidente de conta comprometida (admin phishado, ou insider malicioso)
  que reseta senhas/vincula credenciais Conexos a terceiros fica sem trilha forense — a investigação
  não consegue provar quem fez o quê, e a atribuição de baixas no ERP (que depende do `username`)
  fica sujeita a dúvida.
- **Dependências**: nenhuma.

### [security-2] Revogar sessões ativas ao desativar um usuário

- **Problema**
  > `deactivateGuarded`/`setAtivo` mudam `app_user.ativo`, mas o middleware de auth (pré-existente)
  > só valida assinatura e expiração do JWT — nunca `ativo`. Um token de até 12h continua
  > autenticando em rotas que não dependem do vínculo Conexos, mesmo após a desativação
  > administrativa (F-security-3). Este delta acabou de reforçar a guarda de QUEM pode desativar
  > (R11) — é o momento natural de fechar a lacuna adjacente.

- **Melhoria Proposta**
  > Tactic Revoke Access: (a) caminho rápido — reduzir `TOKEN_EXPIRATION` (hoje `12h` em
  > `AuthService.ts`) e aceitar a janela residual menor; (b) caminho completo — o middleware de auth
  > (`http/auth.ts`) consultar `app_user.ativo` por requisição (com cache curto em memória/Redis para
  > não bater o Postgres a cada chamada) ou manter uma allowlist de sessões revogadas consultada no
  > `buildAuthMiddleware`. Acoplar à guarda R11 já testada nesta feature.

- **Resultado Esperado**
  > Janela de acesso residual pós-desativação: até 12h → configurável e auditável (ideal: segundos a
  > minutos, limitado pelo cache de revogação).

- **Tactic alvo**: Revoke Access
- **Severidade**: P2
- **Esforço estimado**: M (2-5d) — toca middleware compartilhado por todas as rotas
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Janela de acesso residual após desativação: 12h (TTL do token) → alvo definido pelo time (ex.: ≤5min)
- **Risco de não fazer**: desligamento de funcionário ou vazamento de credencial deixa até 12h de
  acesso de leitura (e escrita não-Conexos) ativo mesmo após a ação administrativa de desativar.
- **Dependências**: nenhuma; card independente de security-1.

### [security-3] Igualar o tempo de resposta do login entre identificador inexistente/inativo e senha errada

- **Problema**
  > `AuthService.login` retorna imediatamente (sem `bcrypt.compare`) quando o identificador não
  > existe ou a conta está inativa, e só depois de um `bcrypt.compare` (custo 12, ~dezenas a centenas
  > de ms) quando a senha está errada. A intenção declarada no código ("os três com a mesma
  > resposta") vale para o corpo HTTP, mas não para o tempo de resposta.

- **Melhoria Proposta**
  > Tactic Authenticate Actors: executar um `bcrypt.compare` contra um hash fixo/dummy nos caminhos
  > de "não existe"/"inativo" antes de retornar `null`, para igualar o tempo dos três caminhos — padrão
  > comum contra oráculo de tempo em login.

- **Resultado Esperado**
  > Diferença de latência entre os três caminhos de falha deixa de ser estruturalmente distinguível
  > (hoje: caminho rápido sem bcrypt vs. caminho lento com bcrypt custo-12).

- **Tactic alvo**: Authenticate Actors
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Presença de `bcrypt.compare` (real ou dummy) em 100% dos caminhos de retorno de `login`: hoje 1/3 → 3/3
- **Risco de não fazer**: enumeração de contas ativas/inativas por terceiros — risco baixo isolado,
  mas insumo para phishing direcionado.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo confirmado pelo `_shared-metrics.md`: revisão focada no delta (35 arquivos, 2688+/156-);
  `http/auth.ts`, `http/rateLimit.ts`, `http/cors.ts`, `http/buildApp.ts` (exceto a rota nova
  `/auth/transicao` testada nele) são **PRÉ-EXISTENTES** e citados só como contexto de como o delta se
  encaixa neles.
- F-security-3 (Revoke Access) é explicitamente marcado pré-existente e capado em P2 por instrução do
  escopo — não é P0/P1 desta feature, mas cruzo com Fault Tolerance (mesma lacuna afeta MTTR de um
  incidente de credencial vazada) e com Availability (sessões "zumbi" pós-desativação).
- F-security-1 (Audit Trail) cruza com Fault Tolerance — mesma seção "Audit Trail" do taxonomy overlap
  indicado na missão.
- Não medi `npm audit` (omitido por `--quick`, conforme `_shared-metrics.md`) nem timing real do
  oráculo de F-security-2 (exigiria instrumentação em produção, fora do escopo local).
