---
qa: Availability
qa_slug: availability
run_id: 2026-09-28-1550-auth-email-transicao
agent: qa-availability
generated_at: 2026-09-28T15:50:00-03:00
scope: backend, frontend
score: 7.5
findings_count: 5
cards_count: 3
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Admin/analista autenticando ou gerindo `/usuarios` | Instância única do Render reinicia (deploy, restart) no meio de um `POST /auth/login` ou `PATCH /usuarios/:id/email`; ou duas requisições de desativação de admin chegam simultaneamente | `AuthService`, `UserRepository`, `app_user` (Postgres/Supabase), rota `/usuarios/:id/ativo` | Produção, instância única, sem infra AWS (Render + Vercel) | Login não deve autenticar ambiguamente (mesmo identificador casando 2 linhas); desativação concorrente de admins não deve zerar todos os admins ativos; falha transitória de rede não deve travar a tela sem saída | 0 tokens emitidos para identificador ambíguo (medido: `AuthService.test.ts`); corrida de 2 admins concorrentes → exatamente 1 recusado, resta ≥1 admin ativo (medido ao vivo: 20/20 — ver `_shared-metrics.md`) |

Este QA, neste ciclo, cobre o caminho de **login e gestão de usuários** — o ponto de entrada de TODAS as frentes (Permutas/SISPAG/GED): uma falha aqui derruba o acesso da analista a tudo, mesmo sem tocar Conexos/Nexxera/GED diretamente. Não há chamada a sistemas externos financeiros neste delta (confirmado: `grep -rn "axios\.\|fetch(" src/backend` dentro dos arquivos do delta não retorna nenhum client novo de IO externo — só Postgres via `PostgreeDatabaseClient`, já instrumentado, pré-existente).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chamadas externas novas sem Executor (Retry/Fallback/Poll) | 0 (nenhum client de IO externo novo neste delta; único IO é Postgres via `PostgreeDatabaseClient`, que já embute `RetryExecutor` — pré-existente) | N/A para este delta | ✅ | `Read src/backend/domain/client/database/PostgreeDatabaseClient.ts:60-79` |
| Guardas de transição de estado (login ambíguo, desativação de admin) | 2 guardas novas: `AuthService.login` recusa >1 candidato (401 + log); `UserRepository.deactivateGuarded` recusa auto-desativação e último admin ativo, em transação com `FOR UPDATE` | Presente em toda escrita que possa corromper o acesso | ✅ | `src/backend/domain/service/auth/AuthService.ts:64-76`, `src/backend/domain/repository/auth/UserRepository.ts:280-312` |
| Corrida de 2 admins se autodesativando simultaneamente (teste ao vivo, Postgres descartável) | 1 passa, 1 recusado, resta 1 admin ativo — 20/20 | 0% de corridas que zerem os admins | ✅ | `_shared-metrics.md` § "Repositório ao vivo" |
| Idempotência das escritas novas | `setEmail`: UPDATE condicional (`IS DISTINCT FROM`), no-op no mesmo valor, sem reescrever `email_updated_*`; `create`: `NOT EXISTS` + `ON CONFLICT DO NOTHING` + índice `lower()` cobre a corrida (23505); `upsertAdmin`: UPSERT por `username` | Toda escrita de estado idempotente ou guardada | ✅ | `UserRepository.ts:227-260` (setEmail), `:174-216` (create), `:370-381` (upsertAdmin) |
| Migration 0064 — failure mode novo (guarda `RAISE EXCEPTION` bloqueando o boot inteiro) | Mitigado por infra pré-existente: `lock_timeout`/`statement_timeout` por migration + advisory lock + Render mantém a versão anterior no ar se o boot falhar | Boot falho não deve derrubar a versão em produção | ✅ (herda mitigação pré-existente) | `src/backend/migrations/runMigrations.ts:20-46` (comentário de arquitetura, pré-existente); `src/backend/migrations/0064_app_user_email.sql:16-32` |
| Catch silencioso sem log em código novo | 1 ocorrência: `TransicaoEmailBanner.tsx` — `.catch(() => undefined)` | 0 catches sem log em caminho que afeta produção | ⚠️ | `src/frontend/app/login/TransicaoEmailBanner.tsx:24` |
| Timeout explícito nas chamadas HTTP novas do frontend (`fetchTransicaoEmail`, `definirEmail`) | 0/2 — usam `fetch`/`apiFetch` sem `AbortController`/timeout | 100% | ⚠️ Não é debt novo — herdado do `apiFetch`/`fetch` pré-existentes, reproduzido pelo padrão já usado por toda `lib/usuarios.ts` | `src/frontend/lib/http.ts` (pré-existente, não tocado no delta), `src/frontend/lib/auth/transicao.ts:16` |
| Alarmes/dashboard CloudWatch | — | — | N/A | Não existe `infra/` neste repositório (Render/Vercel); ver `_shared-metrics.md` |
| DLQ em filas SQS | — | — | N/A | Não existe SQS/infra neste delta nem no repositório |

> ⚠️ **Não medível localmente**: MTTR real de um incidente de login em produção (ex.: tempo entre `AUTH_JWT_SECRET` ausente e a primeira detecção). Requer logs do Render + alertas configurados fora deste repositório. Recomendação: instrumentar um alerta externo (UptimeRobot/Render health-check ou similar) sobre `POST /auth/login` retornando 500 de forma sustentada, já que não há CloudWatch neste stack.

## 3. Tactics — Cobertura no financeiro (delta `auth-email-transicao`)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Detect Faults** | | | |
| Ping/Echo | N/A — não há serviço remoto próprio a este delta que exija ping ativo (Postgres já coberto pelo pool pré-existente) | N/A | — |
| Heartbeat | `/health` pré-existente, não tocado pelo delta | PRÉ-EXISTENTE | `src/backend/http/buildApp.ts:104` |
| Monitor | `LogService.error`/`LogService.info` chamados nos pontos novos de decisão (login ambíguo, e-mail atualizado) | ✅ presente | `AuthService.ts:67-74`, `UserAdminService.ts:137-141` |
| Timestamp | `email_updated_at` grava `now()` a cada troca de e-mail — trilha de quando o estado mudou | ✅ presente | `UserRepository.ts:234-243` (migration `0064_app_user_email.sql:35-36`) |
| Sanity Checking | Zod no boundary (`emailField`, `createUserSchema`, `setEmailSchema`) + guarda de duplicado por `lower()` na migration 0064 | ✅ presente | `UserAdminService.ts:20,38-67,73`; `0064_app_user_email.sql:16-32` |
| Condition Monitoring | `CONFIG_MANIFESTO` ganhou a entrada `AUTH_TRANSICAO_EMAIL_BANNER` (opcional, com `consequenciaSeAusente` documentada) — mecanismo pré-existente (`ConfigDoctor`), estendido pelo delta | ✅ presente | `src/backend/domain/interface/operacao/configManifest.ts:120-128` |
| Voting | N/A — instância única de Postgres, sem réplicas votantes | N/A | Não há topologia multi-réplica neste stack |
| Exception Detection | `AuthService.login` distingue explicitamente >1 candidato de 0/1 e recusa com log; rotas mapeiam erros de domínio (`EmailAlreadyInUseError`, `SelfDeactivationError`, `LastActiveAdminError`) para HTTP semântico | ✅ presente | `AuthService.ts:62-76`; `routes/usuarios.ts:44-69` |
| Self-Test | Nenhum self-test novo específico deste delta (ex.: checar no boot se `AUTH_JWT_SECRET` está setado antes do 1º login) — a falta só aparece no 1º `POST /auth/login` | ⚠️ parcial | `AuthService.ts:95-102` (lança só em tempo de uso, não no boot) |
| **Recover from Faults — Preparation & Repair** | | | |
| Active Redundancy | N/A — instância única (Render), sem redundância ativa neste stack | N/A | `_shared-metrics.md` (não existe `infra/`) |
| Passive Redundancy | N/A — mesma razão | N/A | — |
| Spare | N/A — mesma razão | N/A | — |
| Exception Handling | `errorMiddleware` central (pré-existente) + `respondError` novo em `routes/usuarios.ts` mapeia 3 erros de domínio para 409, sem vazar mensagem interna | ✅ presente | `src/backend/http/errorMiddleware.ts` (pré-existente); `routes/usuarios.ts:44-69` (novo) |
| Rollback | Nenhuma escrita nova deste delta deixa estado parcial que precise de rollback pós-falha: `create`/`setEmail`/`deactivateGuarded` são operações atômicas de único statement/transação — não há "desfazer" porque não há "meio-feito" | ✅ presente (por construção) | `UserRepository.ts:174-216, 227-260, 280-312` |
| Software Upgrade | Migration 0064 é só aditiva (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), sem backfill — herda o runner com lock + `statement_timeout` + Render preservando a versão anterior se o boot falhar (pré-existente, Regis-Review 2026-09-08) | ✅ presente | `0064_app_user_email.sql`; `runMigrations.ts:20-46` |
| Retry | Nenhum retry novo neste delta (nem precisa: escritas são request/response síncronas, únicas por clique do admin) — Postgres já retenta conexão via `RetryExecutor` (pré-existente) | ✅ presente (herdado) / N/A para o delta em si | `PostgreeDatabaseClient.ts:60-79` |
| Ignore Faulty Behavior | `TransicaoEmailBanner` ignora deliberadamente qualquer falha de rede/parse (fail-closed: banner some) | ✅ presente | `TransicaoEmailBanner.tsx:20-24`; `lib/auth/transicao.ts:14-25` |
| Degradation | Login continua funcionando por `username` OU `email` durante a janela de transição (front antigo ainda manda `username`, back aceita os dois) — o sistema não exige o e-mail para operar | ✅ presente | `UserAdminService.ts:38-66` (alias), ADR-0051 |
| Reconfiguration | `AUTH_TRANSICAO_EMAIL_BANNER` liga/desliga o banner sem redeploy do front (só restart do backend) | ✅ presente | `routes/auth.ts:52-64`; DEPLOY.md |
| **Recover from Faults — Reintroduction** | | | |
| Shadow | N/A — não há ambiente shadow/canário neste stack | N/A | — |
| State Resynchronization | N/A — não há réplica/cache a ressincronizar; `app_user` é fonte única | N/A | — |
| Escalating Restart | N/A — Render reinicia o processo inteiro; não há granularidade de subsistema neste app | N/A | — |
| Non-Stop Forwarding | N/A — não aplicável a uma API Express monolítica sem plano de controle separado | N/A | — |
| **Prevent Faults** | | | |
| Removal from Service | Guarda de "último admin ativo" e "autodesativação" impede remover do serviço o único operador capaz de destravar o sistema | ✅ presente | `UserRepository.ts:271-312` (`deactivateGuarded`, R11) |
| Transactions | `deactivateGuarded` roda em `withTransaction` com `FOR UPDATE` ordenado — a checagem e o UPDATE são atômicos, sem janela de corrida | ✅ presente | `UserRepository.ts:280-312` |
| Predictive Model | Nenhum neste delta (nem no restante do repo) | ❌ ausente | — |
| Exception Prevention | `SeedAdminConfig` exige `ADMIN_EMAIL`/`ADMIN_PASSWORD` sem default no código — evita semear um admin com credencial conhecida por omissão (antes, `.env.example` sugeria `ADMIN_USERNAME=admin`) | ✅ presente | `src/backend/jobs/SeedAdminConfig.ts:20-49` |
| Increase Competence Set | N/A — não há mecanismo de aprendizado/adaptação neste delta | N/A | — |

## 4. Findings (achados)

### F-availability-1: Banner de transição falha em silêncio, sem nenhum registro

- **Severidade**: P3
- **Tactic violada**: Exception Detection (parcial — o erro é intencionalmente ignorado, mas sem nenhum rastro)
- **Localização**: `src/frontend/app/login/TransicaoEmailBanner.tsx:20-24`, `src/frontend/lib/auth/transicao.ts:14-25`
- **Evidência (objetiva)**:
  ```tsx
  fetchTransicaoEmail()
    .then((valor) => { if (!cancelado) setAtivo(valor) })
    .catch(() => undefined)
  ```
  `fetchTransicaoEmail` também engole `catch { return false }` sem log algum.
- **Impacto técnico**: se `GET /auth/transicao` começar a falhar sistematicamente em produção (ex.: CORS mal configurado após um deploy do front antes do back), ninguém percebe — o comportamento observável (banner ausente) é indistinguível de "chave desligada de propósito".
- **Impacto de negócio**: baixo — o banner é só um aviso informativo da transição de e-mail (ADR-0051); sua ausência não impede login nem nenhuma operação financeira. Risco real: mascarar um problema maior de rede/CORS que também afetaria `/auth/login` (mas esse SIM está instrumentado, ver F-availability-3).
- **Métrica de baseline**: 1 catch silencioso identificado em código novo deste delta (`grep -n "catch" src/frontend/app/login/TransicaoEmailBanner.tsx src/frontend/lib/auth/transicao.ts` → 2 ocorrências, nenhuma loga).

### F-availability-2: Nenhum self-test de `AUTH_JWT_SECRET` no boot — a ausência só aparece no primeiro login

- **Severidade**: P2
- **Tactic violada**: Self-Test
- **Localização**: `src/backend/domain/service/auth/AuthService.ts:95-102`
- **Evidência (objetiva)**:
  ```ts
  private signToken = async (username: string, role: string): Promise<string> => {
      const env = await this.environmentProvider.getEnvironmentVars();
      if (!env.authJwtSecret) {
          throw new Error('AUTH_JWT_SECRET is not configured — cannot sign login tokens. ...');
      }
      ...
  ```
- **Impacto técnico**: um deploy sem `AUTH_JWT_SECRET` sobe verde (build/typecheck/lint/testes não dependem do env real) e só quebra no primeiro `POST /auth/login` de um usuário real, como 500 — não como falha de boot.
- **Impacto de negócio**: nenhum analista consegue entrar no sistema (bloqueio total de Permutas/SISPAG/GED) até alguém tentar logar e reportar o erro; não há nenhum sinal automático antes disso.
- **Métrica de baseline**: `AUTH_JWT_SECRET` já está no `CONFIG_MANIFESTO` (linha 84, pré-existente) como variável rastreada pelo `ConfigDoctor` — mas este delta não conecta essa checagem ao boot da instância que serve `/auth`; a validação em `AuthService` só roda por chamada. Esta é uma lacuna pré-existente que o delta teve a oportunidade de fechar (a rota `/auth/transicao`, nova, já lê `EnvironmentProvider` no boot da requisição) mas não fechou.
- **Nota de escopo**: a variável em si é pré-existente; o gap (nenhum self-test no boot) também é pré-existente e não foi introduzido por este delta — listado aqui porque o delta adicionou testes e rotas de auth sem endereçá-lo, e é o tipo de achado que a auditoria de Availability deve nomear mesmo quando herdado.

### F-availability-3: Login recusa ambiguidade e loga o incidente — tactic presente (achado positivo)

- **Severidade**: — (achado positivo, não gera card)
- **Tactic violada**: nenhuma — Exception Detection presente
- **Localização**: `src/backend/domain/service/auth/AuthService.ts:62-76`
- **Evidência (objetiva)**:
  ```ts
  if (candidates.length > 1) {
      await this.logService.error({
          type: 'BUSINESS_ERROR',
          message: `login recusado: o identificador casa com ${candidates.length} usuários ...`,
          statusCode: 401,
          data: { ids: candidates.map((c) => c.id) },
      });
      return null;
  }
  ```
  Coberto por teste: `AuthService.test.ts:77` ("mais de uma linha: null, sem bcrypt.compare, e loga erro com os ids").
- **Impacto técnico**: nenhum — isto é o comportamento correto. Registrado aqui para justificar por que a introdução de "login por e-mail OU usuário" (uma mudança que aumenta a superfície de ambiguidade) não é, por si, uma regressão de disponibilidade.
- **Impacto de negócio**: positivo — evita autenticação indeterminística (logar como o usuário errado) sem quebrar o login para os demais.
- **Métrica de baseline**: teste ao vivo confirma 0 colisões de identificador em produção hoje (`_shared-metrics.md`: "0 usuários com `username` colidindo").

### F-availability-4: Chamadas HTTP novas do frontend herdam `apiFetch`/`fetch` sem timeout — PRÉ-EXISTENTE

- **Severidade**: P3 (rebaixado — débito herdado, não introduzido por este delta)
- **Tactic violada**: Timeout/Retry (fora da taxonomia estrita de Bass, mas relevante para "Ignore Faulty Behavior"/UX de disponibilidade percebida)
- **Localização**: `src/frontend/lib/auth/transicao.ts:16` (`fetch` puro), `src/frontend/lib/usuarios.ts:116-123` (`definirEmail`, via `apiFetch`); mecanismo raiz em `src/frontend/lib/http.ts` (não tocado neste delta)
- **Evidência (objetiva)**: `apiFetch` (pré-existente) é um wrapper fino de `fetch` sem `AbortController`/timeout — `definirEmail` o reutiliza tal como `setUsuarioAtivo`/`resetarSenha`/`criarUsuario` (todos pré-existentes) já faziam.
- **Impacto técnico**: se o backend ficar sem responder (não retornar nem erro nem sucesso), o botão "Salvar" do `EditarEmailDialog` fica girando (`saving=true`) indefinidamente, sem timeout que force um erro visível.
- **Impacto de negócio**: baixo e já presente em toda a tela `/usuarios` antes deste delta — a nova função `definirEmail` apenas reproduz o padrão existente, não adiciona superfície nova de risco.
- **Métrica de baseline**: 0/2 pontos de chamada HTTP novos deste delta têm timeout explícito; mesma proporção (0%) já existia nas ~6 funções pré-existentes de `lib/usuarios.ts`.
- **Nota de escopo**: **PRÉ-EXISTENTE** — não vira card de severidade alta para este ciclo; registrado para reforçar (via `ontology/_inbox/`) que qualquer `/feature-tweak` futuro em `lib/http.ts` deveria endereçar isto de uma vez para toda a tela, não arquivo a arquivo.

### F-availability-5: Migration 0064 herda corretamente a proteção de boot contra falha — tactic presente (achado positivo)

- **Severidade**: — (achado positivo, não gera card)
- **Tactic violada**: nenhuma — Software Upgrade / Removal from Service presentes
- **Localização**: `src/backend/migrations/0064_app_user_email.sql:16-32`, `src/backend/migrations/runMigrations.ts:20-46`
- **Evidência (objetiva)**: a migration introduz uma guarda nova (`RAISE EXCEPTION` se houver `username` duplicado sem distinção de caixa) — um failure mode que, sem a infraestrutura pré-existente de `lock_timeout`/`statement_timeout` por migration e o comportamento do Render de manter a versão anterior no ar quando o `/health` não responde, derrubaria a instância inteira num boot. A infra já existe (Regis-Review 2026-09-08, card `lock-timeout-not-valid`) e cobre esta migration nova sem trabalho adicional.
- **Impacto técnico**: nenhum — o pior caso (colisão de `username` em produção) já foi medido como 0 casos em 2026-09-28 (`_shared-metrics.md`), e mesmo se ocorresse, o boot falharia alto sem derrubar a versão em produção.
- **Impacto de negócio**: positivo — reduz o risco de uma migration aditiva nova se tornar um incidente de disponibilidade total.
- **Métrica de baseline**: 0 rollback script para 0064, corretamente dispensado pela política (`rollbacks/README.md`: script de reverse só obrigatório para `UPDATE` sobre >1.000 linhas; 0064 não faz `UPDATE`).

## 5. Cards Kanban

### [availability-1] Self-test de `AUTH_JWT_SECRET` no boot, não só no primeiro login

- **Problema**
  > `AuthService.signToken` só descobre que `AUTH_JWT_SECRET` está ausente quando o primeiro usuário tenta logar (`src/backend/domain/service/auth/AuthService.ts:95-102`), retornando 500 sem qualquer sinal anterior. Como `AUTH_JWT_SECRET` já é uma env obrigatória rastreada pelo `CONFIG_MANIFESTO` (linha 84), a checagem existe — mas não roda no boot da instância que serve `/auth`.

- **Melhoria Proposta**
  > Adicionar uma checagem de `authJwtSecret` no `ConfigDoctor` (ou equivalente) rodando no boot do servidor (`index.ts`, nunca em `bootstrapAppContainer` — ver Gotcha do CLAUDE.md sobre os ~58 jobs), com `console.error`/`LogService` fail-loud caso ausente em produção. Tactic: **Self-Test**.

- **Resultado Esperado**
  > `AUTH_JWT_SECRET` ausente em produção aparece no log de boot da instância, não apenas no primeiro 500 de um usuário tentando logar. Métrica: tempo entre deploy sem a variável e a primeira detecção — de "até o 1º login de um usuário real" para "no boot, antes de servir tráfego".

- **Tactic alvo**: Self-Test
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Self-test de `AUTH_JWT_SECRET` no boot: ausente → presente
- **Risco de não fazer**: um deploy futuro sem a variável (ex.: rotação de segredo mal executada) derruba o login de todos os usuários sem qualquer sinal até o primeiro relato manual.
- **Dependências**: nenhuma.

### [availability-2] Registrar (mesmo que só `console.warn`) a falha do banner de transição

- **Problema**
  > `TransicaoEmailBanner`/`fetchTransicaoEmail` engolem qualquer erro de rede/parse sem nenhum rastro (`src/frontend/app/login/TransicaoEmailBanner.tsx:24`, `src/frontend/lib/auth/transicao.ts:22-24`). O design de "fail closed" está correto; a ausência total de log não está.

- **Melhoria Proposta**
  > Trocar `.catch(() => undefined)` por um `console.warn` (ou telemetria de frontend, se existir) que não afete o `setAtivo(false)`. Tactic: **Exception Detection**.

- **Resultado Esperado**
  > Uma falha sustentada de `/auth/transicao` (ex.: CORS quebrado) deixa rastro no console do navegador, detectável em suporte, sem mudar o comportamento visual (banner continua ausente).

- **Tactic alvo**: Exception Detection
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Catches silenciosos em código novo deste delta: 1 → 0
- **Risco de não fazer**: baixo — o pior cenário é um problema de rede mais amplo (que afetaria `/auth/login`, já instrumentado) passar despercebido um pouco mais na sua manifestação mais branda (banner ausente).
- **Dependências**: nenhuma.

### [availability-3] Padronizar timeout client-side em `lib/http.ts` (não neste delta — abrir follow-up)

- **Problema**
  > `apiFetch`/`fetch` (pré-existentes, `src/frontend/lib/http.ts`) não têm `AbortController`/timeout. A nova `definirEmail` reproduz esse padrão, junto com todas as outras ~6 funções de `lib/usuarios.ts` que já existiam. Um backend hung deixa qualquer diálogo de mutação (`EditarEmailDialog` incluso) girando sem saída.

- **Melhoria Proposta**
  > Adicionar timeout (ex.: 15-20s) com `AbortController` em `apiFetch`, um ponto central que beneficia toda a tela `/usuarios` e `/login` de uma vez — não arquivo a arquivo. Tactic: **Ignore Faulty Behavior** (falha explícita ao invés de travar) / degradação de UX previsível.

- **Resultado Esperado**
  > Qualquer chamada via `apiFetch` que não responda em N segundos falha com um erro tratável pelo `catch` já existente em cada tela, em vez de girar indefinidamente. Métrica: pontos de chamada HTTP no frontend com timeout explícito — 0/N (N = todas as funções de `lib/usuarios.ts` + `lib/auth/transicao.ts`) → N/N.

- **Tactic alvo**: Ignore Faulty Behavior
- **Severidade**: P3
- **Esforço estimado**: S (≤1d) — muda 1 arquivo central (`lib/http.ts`), mas é trabalho pré-existente, não deste ciclo
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Funções de `lib/usuarios.ts`/`lib/auth/transicao.ts` com timeout: 0/8 → 8/8
- **Risco de não fazer**: baixo hoje (Render raramente trava sem responder); cresce se o backend passar a fazer chamadas síncronas mais longas em rotas que a tela `/usuarios` invoca.
- **Dependências**: nenhuma. **Não é debt introduzido por este delta** — registrado como follow-up em `ontology/_inbox/auth-email-transicao-regis-followups.md`, não bloqueia o merge.

## 6. Notas do agente

- Escopo: sem chamadas a Conexos/Nexxera/GED neste delta (confirmado por grep) — a maior parte da taxonomia de Bass voltada a redundância de infraestrutura (Active/Passive Redundancy, Spare, Shadow, State Resync, Escalating Restart, Non-Stop Forwarding, Voting) é N/A porque não existe `infra/` nem topologia multi-instância neste repositório (Render single-instance + Vercel).
- F-availability-2 e F-availability-4 nomeiam gaps que já existiam antes do delta (variável/rota já rastreadas, mecanismo `apiFetch` não tocado) — mantidos como achados porque a auditoria deve nomear a lacuna mesmo herdada, mas rebaixados/anotados como PRÉ-EXISTENTE conforme instrução de escopo; nenhum vira P0/P1 deste ciclo.
- Cross-QA: F-availability-2 (self-test de `AUTH_JWT_SECRET`) tem sobreposição direta com `qa-fault-tolerance` (mesmo arquivo, mesmo mecanismo) — sinalizar ao consolidator para não duplicar o card.
- MTTR real de incidente de login em produção não é medível localmente (sem CloudWatch/infra) — ver nota na seção 2.
