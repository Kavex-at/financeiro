---
qa: Security
qa_slug: security
run_id: 2026-09-03-1901-tapar-furos-backend
agent: qa-security
generated_at: 2026-09-03T19:35:00-03:00
scope: backend
score: 8
findings_count: 2
cards_count: 2
---

# Security — Regis-Review

> Escopo restrito ao delta do tweak `fix/tapar-furos-backend` (5 arquivos + `package.json`).
> Repo inteiro entra só como pano de fundo. Não há `infra/` neste projeto (Render + Supabase, não
> Terraform/AWS): toda tactic que depende de IAM/SSM/VPC é declarada N/A com justificativa.

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Registry npm (upstream não confiável) | `npm run lint`/`npm run build` executando `npx <bin>` fora do lockfile em worktree recém-criado sem `node_modules` | Toolchain do CI/gate local (`biome`, `tsc-esm-fix`) | Build e Regis-Review em worktree novo (fluxo obrigatório da Inviolable Rule #10) | Comando falha com exit ≠ 0 se o binário exigido não estiver instalado; nunca baixar código arbitrário do registry para satisfazer o script | 0 chamadas de `npx <bin>` em scripts de build/lint do backend; supply-chain reduzida ao que está no `package-lock.json` |
| Erro do `pg` durante `pool.end()` no shutdown | SIGTERM do Render dispara `closePool()`; `pool` quebrado rejeita com mensagem carregando connection string / usuário | `console.log` do processo → drain de logs do Render (externo) | Redeploy ou restart em produção | Mensagem de erro passa pelo redator (`redactErrorMessage`) antes de sair no stdout, consistente com `JobExecucaoRepository` e `StalenessDetector` | 0 caminhos de log de erro no delta que ignorem o redator; 100% dos `console.log(...error.message)` novos redigidos |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `npx <bin>` em scripts de `src/backend/package.json` (lint/build) | 0 | 0 | ✅ | `cat src/backend/package.json` — `"lint": "biome check ."`, `"build": "tsc && tsc-esm-fix dist"` |
| `npx <bin>` em `src/frontend/package.json` | 0 | 0 | ✅ | `cat src/frontend/package.json` — `next`, `eslint`, `tsc`, `jest` chamados diretos |
| `npx <bin>` em `.github/workflows/` | 0 | 0 | ✅ | `grep -rEn '\bnpx\b' .github/workflows/` — vazio |
| Ocorrências residuais de `npx` no backend (docstrings de jobs one-off) | ~40 | N/A (não roda em CI/build) | ✅ | `grep -n 'npx tsx' src/backend/jobs/**/*.ts` — todas em comentários de `Run:` de scripts manuais fora do pipeline |
| Falso-verde do lint em worktree sem `node_modules` (BE-09) | eliminado | 0 | ✅ | `_shared-metrics.md` §"Validação empírica" — ANTES exit 0 mudo, DEPOIS exit 127 `biome: not found` |
| Segredos hardcoded no delta (`grep -E 'password\|secret\|token\|key\|credential.*=.*["'\''][^"'\'']{8,}'` nos 5 arquivos) | 0 | 0 | ✅ | `grep` nos arquivos tocados; menções em comentários (`/auth/login validates username/password`) não são valores |
| `redactErrorMessage` aplicado nos novos caminhos de log de erro em `gracefulShutdown.ts` | 0 de 1 | 1 de 1 | ⚠️ | `src/backend/http/gracefulShutdown.ts:94` — `log(\`[shutdown] falha ao encerrar o pool: ${asMessage(error)}\`)` sem redator |
| Handler idempotente (2º SIGTERM/SIGINT ignorado) | sim | sim | ✅ | `src/backend/http/gracefulShutdown.ts:59-63` — flag `shuttingDown` |
| Exit code do shutdown normal | 0 | 0 | ✅ | `src/backend/http/gracefulShutdown.ts:72-76` — decisão explícita e comentada |
| Timer de força-saída `unref()`ado (não segura event loop) | sim | sim | ✅ | `src/backend/http/gracefulShutdown.ts:83-84` |
| Superfície de sinal para atacante externo (SIGTERM/SIGINT) | inexistente em container Render | N/A | ✅ | Justificativa na §3, tactic "Limit Exposure" |
| Vazamento de referência do pool após handler de `error` (BE-05) | corrigido (`pool.end()` + guarda `pool === this.connectionPool`) | corrigido | ✅ | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:77-93` |
| `npm audit --audit-level=high` no CI | rodando | rodando | ✅ | `.github/workflows/ci.yml:20` — `- run: npm audit --audit-level=high` |
| Saída bruta de `npm audit` no delta | ⚠️ **Não coletada** (flag `--quick` do run) | — | — | `_shared-metrics.md` §"Notas para os agents" |

## 3. Tactics — Cobertura no delta

Nomes canônicos do Bass & Clements (en). Avaliação escopada ao delta; onde a tactic é do repo mais amplo e o delta não a toca, o status reflete se o delta piorou/melhorou algo.

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Middleware de logging (`req.id` + `redactBody`) e rate-limit global; nada específico do delta | ✅ presente (pré-existente) | `src/backend/index.ts:41-71` |
| Detect Service Denial | Rate-limit (`express-rate-limit`) e health probe pública (`/health`) que devolve 503 quando pipeline parado | ✅ presente (pré-existente) | `src/backend/http/rateLimit.ts`, `src/backend/routes/health.ts` |
| Verify Message Integrity | **Melhorada pelo delta**: removendo `npx <bin>` dos scripts, o `package-lock.json` volta a ser a única fonte de verdade da toolchain (Biome, tsc-esm-fix). Sem `node_modules`, o script FALHA em vez de baixar código do registry | ✅ presente | `src/backend/package.json:22,24` |
| Detect Message Delay | N/A neste delta — sem canal assíncrono novo | N/A | — |
| Identify Actors | JWT auth middleware + identidade Conexos (pré-existente, não tocado) | ✅ presente (pré-existente) | `src/backend/http/auth.ts`, `src/backend/http/conexosIdentity.ts` |
| Authenticate Actors | HS256 self-signed via `AuthService`; env validada por Zod (`authEnv.ts`) | ✅ presente (pré-existente) | `src/backend/index.ts:95` |
| Authorize Actors | Guards por rota (`sispagGate`, `recebimentosGate`, `filialAuthz`, `operacaoAcesso`); pré-existente | ✅ presente (pré-existente) | `src/backend/http/sispagGate.ts`, `src/backend/http/filialAuthz.ts` |
| Limit Access | Rate-limit global + limiter estrito nas rotas fan-out; CORS whitelist via `ALLOWED_ORIGINS` (não wildcard) | ✅ presente (pré-existente) | `src/backend/http/rateLimit.ts`, `src/backend/http/cors.ts` |
| Limit Exposure | **Melhorada pelo delta**: escopo de execução do build/lint agora limitado ao que está declarado em `dependencies`/`devDependencies` — `npx` deixa de ser vetor de baixa-e-executa-sob-demanda contra o registry npm. Superfície de sinal do shutdown limitada ao processo (só o orquestrador do container manda SIGTERM/SIGINT em Render; qualquer atacante que consiga mandar sinal já tem execução no host) | ✅ presente | `src/backend/package.json:22-24`; `src/backend/http/gracefulShutdown.ts:17` |
| Encrypt Data | HTTPS terminado no Render/Vercel; JWT HS256; SSM não se aplica (sem AWS) | ✅ presente (pré-existente, plataforma) | — |
| Separate Entities | N/A (sem multi-tenant AWS neste estado) — CLAUDE.md §"Estado Atual vs. Alvo" | N/A | — |
| Change Default Settings | Handlers de SIGTERM/SIGINT agora explícitos (o default do Node é `exit(128+n)` imediato) | ✅ melhorado pelo delta | `src/backend/http/gracefulShutdown.ts:108-113` |
| Validate Input | Zod nos boundaries (pré-existente); o delta não introduz input externo | ✅ presente (pré-existente) | `src/backend/http/schemas.ts`, `src/backend/http/authEnv.ts` |
| Revoke Access | N/A neste delta | N/A | — |
| Lock Computer | N/A neste delta | N/A | — |
| Inform Actors | `console.log` do shutdown descreve cada etapa e razão de saída — sysadmin/operador entende o desfecho pelo log drain do Render | ✅ presente | `src/backend/http/gracefulShutdown.ts:57,66,74,89-94` |
| Restore | Overlap com Availability/Fault-Tolerance: shutdown drena requisições em voo antes de sair, o que reduz órfãos em `reconciling` que hoje só o `reaper-sispag` conserta | ✅ presente (pelo delta) | `src/backend/http/gracefulShutdown.ts` (arquivo inteiro) |
| Audit Trail | Log de shutdown é o único trilho novo; cobre `signal recebido`, `pool encerrado`, `falha ao encerrar pool`, `drenagem excedeu Xms`. Não persiste em DB — vive só no log drain | ✅ presente, ⚠️ ver Finding F-security-1 (redator ausente) | `src/backend/http/gracefulShutdown.ts:57,89-94` |

## 4. Findings

### F-security-1: log do shutdown não passa erro do `pg` pelo redator

- **Severidade**: P2 (débito defensável — caminho pouco frequente, log drain admin-only, mas inconsistente com o padrão do próprio projeto)
- **Tactic violada**: Limit Access (redação de dado sensível antes de sair do processo)
- **Localização**: `src/backend/http/gracefulShutdown.ts:94`
- **Evidência (objetiva)**:
  ```typescript
  } catch (error) {
      // Falhar ao fechar o pool não pode virar processo zumbi que o
      // orquestrador precise matar com SIGKILL.
      log(`[shutdown] falha ao encerrar o pool: ${asMessage(error)}`);
  }
  ```
  O projeto tem `redactErrorMessage` em `src/backend/http/redact.ts:79` cuja docstring nomeia
  exatamente o cenário-alvo: *"`password authentication failed for user "financeiro"`,
  `connect ECONNREFUSED 10.0.0.5:5432`, uma connection string inteira, ou um `Cookie: sid=…`
  vindo de um erro embrulhado"*. Ele já é aplicado em dois outros sítios:
  - `src/backend/domain/repository/operacao/JobExecucaoRepository.ts:92` (antes de persistir em `job_execucao.error_message`);
  - `src/backend/domain/service/operacao/StalenessDetector.ts:165` (antes de persistir em `alerta.detalhe.erro`).

  O log do shutdown vai para `console.log` (drain externo do Render), não para DB — por isso não é
  P0/P1. Mas errors do `pg` durante `pool.end()` podem trazer o nome do usuário do Postgres, o
  host interno do Supabase, ou, no pior caso quando o driver embrulha o erro de conexão, a própria
  connection string.
- **Impacto técnico**: uma mensagem de erro do `pg` do tipo `password authentication failed for
  user "financeiro"` ou `connect ECONNREFUSED <host_interno_supabase>:5432` sai no stdout do
  container e vai para o drain de logs do Render sem redação. Depois, se o drain for enviado a um
  destino terceiro (ex.: agregador SaaS), o segredo/topologia interna aparece lá também.
- **Impacto de negócio**: exposição de detalhe de infraestrutura ou usuário do banco em um
  destino que pode não ter o mesmo nível de controle de acesso do processo original. Baixa
  probabilidade (path só é atingido em shutdown com pool já quebrado), mas o custo do fix é
  1 linha, o que torna assimétrico.
- **Métrica de baseline**: 0 de 1 caminhos de log de erro novos aplicam `redactErrorMessage`;
  padrão do projeto está em 2 de 2 caminhos que persistem erro em DB. Delta introduziu 1 caminho
  novo (não persistido) e não seguiu o padrão.

### F-security-2: `npx` residual em docstrings de jobs (contexto, não regressão)

- **Severidade**: P3 (higiene — não bloqueia, não regride, mas vale registrar para o consolidator)
- **Tactic violada**: — (informativo)
- **Localização**: `src/backend/jobs/*.ts` (docstrings `Run:` em ~40 scripts one-off), ex.:
  `src/backend/jobs/probe-fin052-retorno.ts:31-32`, `src/backend/jobs/execute-fin015-prd.ts:38`.
- **Evidência (objetiva)**:
  ```
  $ grep -rEn '\bnpx tsx\b' src/backend/jobs | wc -l
  ~40  # todas em comentários que instruem o operador a rodar o script à mão
  ```
- **Impacto técnico**: `npx tsx jobs/<script>.ts` no shell do operador **só** roda o `tsx` do
  `node_modules` local se ele estiver instalado; se não estiver, `npx` baixa e executa código do
  registry. Como `tsx` está em `devDependencies`, o caso feliz é seguro; o caso operador-que-roda-
  fora-do-repo é vulnerável.
- **Impacto de negócio**: nenhum enquanto o operador seguir a instrução `cd src/backend && ...`.
  Fora dela, mesma classe de risco de BE-09.
- **Métrica de baseline**: 40 docstrings — 0 delas afetam CI/build/lint; delta não introduziu
  novas. Registrado para o consolidator considerar em um follow-up de hardening (`npm run job:*`
  já cobre os jobs "oficiais" via `package.json`; os scripts `probe-*` / `validate-*` são one-off
  e nunca ganharam script).

## 5. Cards Kanban

### [security-1] Aplicar `redactErrorMessage` no log de falha do shutdown

- **Problema**
  > O novo `gracefulShutdown.ts:94` loga `falha ao encerrar o pool: ${error.message}` direto no
  > `console.log`. O `pg`, ao rejeitar `pool.end()` sobre um pool já quebrado, pode trazer nome
  > de usuário do Postgres, host interno do Supabase ou até connection string embrulhada. O drain
  > de logs do Render sai do perímetro do processo (pode ir para agregador SaaS terceiro), então
  > o que aparece no stdout é o que efetivamente escapa.

- **Melhoria Proposta**
  > Importar `redactErrorMessage` de `../http/redact.js` (mesmo padrão já usado em
  > `JobExecucaoRepository.ts:92` e `StalenessDetector.ts:165`) e envolver `asMessage(error)`:
  > `log(\`[shutdown] falha ao encerrar o pool: ${redactErrorMessage(asMessage(error))}\`)`.
  > Adicionar um teste em `gracefulShutdown.test.ts` que injeta um erro cuja `.message` contém
  > `password authentication failed for user "financeiro"` e assertar que o log final contém
  > `[REDACTED]`. Tactic Bass: Limit Access (redação antes da saída).

- **Resultado Esperado**
  > Nenhuma credencial, host interno ou connection string escapa via drain de logs do Render no
  > caminho de shutdown com pool quebrado. Métrica: 0 de 1 → 1 de 1 caminhos de log de erro no
  > `http/` aplicam `redactErrorMessage`.

- **Tactic alvo**: Limit Access (Bass)
- **Severidade**: P2
- **Esforço estimado**: S (≤1h — 1 linha de código + 1 teste)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Caminhos de log de erro em `http/` sem redator: 1 → 0
  - Teste `gracefulShutdown.test.ts` cobrindo o cenário `password authentication failed`: ausente → presente
- **Risco de não fazer**: em 6 meses o padrão inconsistente ("uns redigem, outros não") normaliza,
  e o próximo `console.log` de erro em novo módulo `http/` também esquece. Ao mesmo tempo aparece
  em post-mortem um trecho de log com nome de usuário do banco vazado para um agregador SaaS.
- **Dependências**: nenhuma

### [security-2] Padronizar jobs one-off para não depender de `npx`

- **Problema**
  > ~40 jobs em `src/backend/jobs/` (probes e validators one-off) trazem docstrings do tipo
  > `Run: PROBE_PRD=1 npx tsx jobs/probe-*.ts`. Quando o operador roda no diretório certo, o
  > `npx` resolve o `tsx` do `node_modules` local (seguro). Fora dele, `npx` baixa e executa
  > código do registry — mesma classe de risco que BE-09 já eliminou dos scripts oficiais.

- **Melhoria Proposta**
  > Reescrever as docstrings `Run:` para `node --loader tsx jobs/<script>.ts` **ou** promover os
  > jobs recorrentes para `scripts` do `package.json` (padrão `job:<nome>` já usado em
  > `job:reaper-sispag`, `job:capture-fixtures`, etc.). Documentar em `CLAUDE.md` §Commands que
  > `npx` está banido dos jobs. Tactic Bass: Limit Exposure (reduzir superfície de execução
  > não-lockfile).

- **Resultado Esperado**
  > Nenhum caminho de execução manual de job dependa de resolução dinâmica pelo registry npm.
  > Métrica: ~40 → 0 docstrings de `Run:` com `npx tsx`.

- **Tactic alvo**: Limit Exposure (Bass)
- **Severidade**: P3
- **Esforço estimado**: M (2–3h — 40 arquivos, achado mecânico, low-risk)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Docstrings `Run:` com `npx tsx` em `src/backend/jobs/`: ~40 → 0
  - Scripts `job:*` em `src/backend/package.json` para jobs promovidos: cobrir 100% dos que rodam
    mais de uma vez
- **Risco de não fazer**: baixo — mas mantém a assimetria "scripts oficiais são seguros, docs
  ensinam o inseguro", que corrói a lição do BE-09.
- **Dependências**: nenhuma

## 6. Notas do agente

- **Superfície de sinal (SIGTERM/SIGINT) do shutdown não é finding.** Em container Render, quem
  manda sinal é o orquestrador; um atacante com capacidade de sinalizar o processo já tem
  execução no host e pode simplesmente `kill -9`. Handler é idempotente (`shuttingDown` flag),
  usa `unref()` no timer de força-saída e sai com 0 (correto para shutdown ordenado). Sem
  finding.
- **BE-09 fecha um vetor real de supply chain.** `npx <bin>` sem `node_modules` baixa e executa
  código do registry fora do lockfile; o diff `npx biome check .` → `biome check .` promove
  Verify Message Integrity e Limit Exposure no gate local + CI. Confirmado que **não sobrou**
  `npx` em `src/backend/package.json`, `src/frontend/package.json` nem em `.github/workflows/`.
- **BE-05 é fault-tolerance/availability, não security direto.** O laço de retry sobre
  `too many clients` acelerando o esgotamento é um AZ (blast-radius do próprio serviço), sem
  vetor externo — deixo o card em Availability/Fault-Tolerance.
- **Cross-QA para o consolidator**:
  - Card `security-1` (redator no shutdown) toca **Fault-Tolerance** (Audit Trail — mensagens de
    erro têm que ser úteis ao operador sem virar vazamento);
  - `Limit Exposure` do BE-09 sobrepõe com **Deployability** (gate confiável em worktree novo) e
    com **Testability** (falso-verde do `npm run lint` era o mesmo bug que enganaria qualquer teste
    de CI que dependesse de lint como precondição);
  - `Restore` do shutdown gracioso sobrepõe com **Availability** (menos órfãos em `reconciling`
    para o `reaper-sispag` recuperar) e **Fault-Tolerance** (encerra pool, evita vazamento de
    conexão para a próxima instância).
- **Métrica não coletada por decisão do run**: `npm audit --json` profundo — `--quick` do run e
  o CI já roda `npm audit --audit-level=high` em toda push (`ci.yml:20`).
