---
qa: Security
qa_slug: security
run_id: 2026-08-24-1830-sispag-remessa-retorno
agent: qa-security
generated_at: 2026-08-24T18:30:00-03:00
scope: backend+frontend
score: 5
findings_count: 8
cards_count: 6
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado à frente SISPAG)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Insider malicioso (dev / operador com token válido) OU atacante externo que roubou um JWT de sessão de 12 h | Chama `GET /sispag/contas-pagadoras?filCod=…` e `GET /sispag/lotes/:id/remessa/arquivo` de dentro do app | Rotas de leitura da frente SISPAG (contas bancárias da empresa + arquivo CNAB 240 com contas dos fornecedores) | Produção (Render), escrita habilitada (`CONEXOS_WRITE_ENABLED=true`, `CONEXOS_DRY_RUN=false`) | Sistema DEVE (a) exigir role apropriado (b) atribuir toda ação a um humano real (não-repúdio) (c) manter o `.env` fora do repo e (d) redigir segredos nos logs | 100 % das rotas com PII/dados bancários sob `requireRole('admin')`; 0 segredos em git; 0 ações sem `executado_por`; 0 credenciais de robô compartilhadas para operações rastreáveis |

> Aplicado ao delta: `POST /sispag/lotes/:id/remessa` e `POST /sispag/retornos/conciliar` estão sob `requireRole('admin') + heavyRouteLimiter`, atribuem `executado_por` no ledger `remessa_execucao`, escrevem via `ConexosSispagWriteClient` — que autentica com uma credencial PESSOAL (`MPS_FRANCINEI`) e não com uma credencial de robô. O incidente cabível é `.REM` (contas dos fornecedores) baixado por operador não-admin OU auditoria do ERP registrando "Francinei" em vez do humano real quando o usuário logado não tem vínculo Conexos.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rotas de escrita novas com `requireRole('admin')` | 2/2 (`POST /sispag/lotes/:id/remessa`, `POST /sispag/retornos/conciliar`) | 100 % | ✅ | `src/backend/routes/sispag.ts:401,445` |
| Rotas de leitura NOVAS com PII/dados bancários e sem `requireRole` | 2/2 (`GET /sispag/contas-pagadoras`, `GET /sispag/lotes/:id/remessa/arquivo`) — qualquer autenticado baixa | ≤ 0 | ❌ | `src/backend/routes/sispag.ts:368-380` e `sispag.ts:424-437` |
| Escritas SISPAG que gravam `executado_por` no ledger | 100 % (`beginExecution({...executadoPor: input.ator})`) | 100 % | ✅ | `RemessaExecucaoRepository.beginExecution` (`.../repository/sispag/RemessaExecucaoRepository.ts`) + `RemessaService.gerarRemessa` |
| Fallback de identidade quando o JWT não traz `sub` nem `email` | `ator = 'unknown'` (string) | Rejeitar 401/500 | ⚠️ | `src/backend/routes/sispag.ts:66` `const ator = (req: Request): string => req.user?.sub ?? req.user?.email ?? 'unknown'` |
| Credencial usada na escrita real ao ERP | Pessoal — `CONEXOS_USERNAME=MPS_FRANCINEI` (não é robô) | Segregada por usuário via `conexosIdentityMiddleware` | ⚠️ (o middleware existe, mas o fallback ainda cai no robô — `AuthProvider.tsx` fala em `conexosStatus='falha'`) | `src/backend/.env` linha 3 e `src/backend/http/conexosIdentity.ts` |
| `.env` com credenciais PROD gitignorado | Sim — `src/backend/.gitignore:3 .env` | gitignorado | ✅ | `git check-ignore -v src/backend/.env` retornou `.gitignore:3:.env` |
| Segredos vazados no histórico do git (pickaxe: `@Amarelo521`, `KsgFKoprJe`, `KavexCLX`, `Kavex@2026`, `MPS_FRANCINEI`) | 0 no diff — só o commit `538a3512` menciona a *palavra* `security-1` no `commit -m` | 0 | ✅ | `git log --all -S "<secret>"` |
| Redação de segredos no logger de request/response | `redactBody()` mascara `password/senha/token/secret/authorization/api_key/jwt` (case-insensitive, deep-copy) | presente | ✅ | `src/backend/http/redact.ts` + `src/backend/index.ts:57` |
| Rate limit nas rotas de escrita novas | `heavyRouteLimiter` (10 req/min/IP) aplicado em `remessa` e `retornos/conciliar` | presente | ✅ | `src/backend/http/rateLimit.ts:33` + `routes/sispag.ts:402,446` |
| Rate limit em `GET /sispag/contas-pagadoras` e `GET .../remessa/arquivo` | `globalLimiter` (100 req/min/IP) — herdado do `app.use` | ≥ presente | ✅ | `src/backend/index.ts:41` |
| SQL parametrizado no delta (SISPAG) | 100 % (nomeados `$key`, `$loteId`, `$status`, `$limit`, `$correlationId`, `$filCod`, `$bncCod`, `$newStatus`, `$dryRun`, `$executadoPor`) | 100 % | ✅ | `RemessaExecucaoRepository.ts`, `LotePagamentoRepository.ts` |
| CORS whitelist | `ALLOWED_ORIGINS` (env), default `http://localhost:3000` — sem `*` | não usar `*` | ✅ | `src/backend/index.ts:35-38` + `.env.example` |
| Validação Zod em `POST /sispag/retornos/conciliar` (body) | `conciliarSchema.safeParse` — 6 campos coeridos (`filCod`, `bncCod`, `gtbCodSeq`, `garCodSeq`, `processar`, `dryRun`) | presente | ✅ | `src/backend/routes/sispag.ts:388-398,451` |
| Validação Zod em `POST /sispag/lotes/:id/remessa` (body) | Sem schema (apenas leitura opcional de `req.body?.dryRun === true`) — payload não obrigatório | schema mínimo | ⚠️ | `src/backend/routes/sispag.ts:404-417` |
| JWT TTL | 12 h (`TOKEN_EXPIRATION = '12h'`) | ≤ 12 h | ✅ | `src/backend/domain/service/auth/AuthService.ts:24` |
| Segredo JWT em `.env` local aponta para PROD (Render) | O mesmo `.env` da máquina de dev traz `CONEXOS_BASE_URL=https://columbiatrading.conexos.cloud/api` (não HML) + Supabase pooler prod + `AUTH_JWT_SECRET` prod-shape | segredo local ≠ segredo produção | ❌ | `src/backend/.env` (todo o arquivo) — não há `.env.hml` / `.env.local` distinto |
| Frontend `useRole/useIsAdmin` usado no SISPAG (esconde botão de admin) | 0 usos em `src/frontend/app/sispag/` (só em `app/usuarios/page.tsx`) | ≥ 1 (UX; barreira real é backend) | ⚠️ | `grep -rn "useRole\|useIsAdmin" src/frontend/app` |
| Default de `role` no schema `app_user` | `role TEXT NOT NULL DEFAULT 'admin'` — todo usuário nasce admin; não há role `viewer`/`operator` implementado | `viewer` como default seguro | ❌ | `src/backend/migrations/0007_app_user.sql:8` |
| `npm audit` — backend (`src/backend`) | 8 vulnerabilidades (0 critical, **4 high**, 2 moderate, 2 low) — axios <1.18.0 (SSRF/DoS), exceljs → uuid <11.1.1 | 0 high, 0 critical | ❌ | `cd src/backend && npm audit` |
| `npm audit` — frontend (`src/frontend`) | 8 vulnerabilidades (0 critical, **7 high**, 0 moderate, 1 low) — next, postcss (XSS/path-traversal), sharp/libvips, ws (memory-exhaustion DoS) | 0 high, 0 critical | ❌ | `cd src/frontend && npm audit` |
| Dependabot na branch default (`main`) | 52 alertas reportados no remote (input do usuário — não medido localmente) | ≤ 5 high | ❌ | `--not-medível-localmente` — fonte: aviso do usuário |

> ⚠️ **Não medível localmente**: contagem exata do Dependabot (52 alertas no `main`). O `npm audit` local já mostra 16 no delta atual; o gap para 52 vem de deps não incluídas no `package-lock.json` desta branch e/ou avisos que o Dependabot rankeia diferente (severidade por origem).

## 3. Tactics — Cobertura no delta SISPAG

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Detect Intrusion** | Não há WAF, IDS, GuardDuty ou signature-based detection. Só `console.warn` em token inválido/expirado (`http/auth.ts:184`). | ❌ ausente | `src/backend/http/auth.ts:183` |
| **Detect Service Denial** | Rate limiter global + estrito por rota; sem métrica agregada nem alarme. | ⚠️ parcial | `src/backend/http/rateLimit.ts` |
| **Verify Message Integrity** | JWT HS256 (`jose`) — integridade e autenticidade do token. CNAB 240 não passa por hash/HMAC próprio (o próprio banco valida no upload). | ✅ presente | `src/backend/http/auth.ts:154-181` |
| **Detect Message Delay** | Não aplicável ao delta HTTP síncrono; escrita ao ERP tem `timeout: 40000` (via `ConexosBaseClient`) — evita hang. | N/A | (timeout é *avoidance*, não *detection*) |
| **Identify Actors** | `sub` do JWT (`toAuthUser` exige `sub`); `ator(req)` usa `sub ?? email ?? 'unknown'` — o fallback `'unknown'` é o vazamento. | ⚠️ parcial | `src/backend/http/auth.ts:66-73` + `routes/sispag.ts:66` |
| **Authenticate Actors** | JWT HS256 assinado com `AUTH_JWT_SECRET`, TTL 12 h, `aud='authenticated'`, `iss` opcional. Bcrypt para `password_hash`. `DEV_AUTH_BYPASS` rejeitado em `prd/stg/hml` (fail-fast). | ✅ presente | `src/backend/domain/service/auth/AuthService.ts` + `http/authEnv.ts` |
| **Authorize Actors** | `requireRole('admin')` nas 2 rotas de escrita SISPAG. `filialAuthz` existe mas NÃO é aplicado no SISPAG (só em `/recebimentos`). Sem RBAC granular — role default é `admin` no banco (0007). | ⚠️ parcial | `src/backend/routes/sispag.ts` + `http/filialAuthz.ts` (docstring: "same tactic should be replicated on the SISPAG money-moving routes for parity") |
| **Limit Access** | `sispagGate` bloqueia toda a rota SISPAG em prod até `sispagEnabled=true`. `heavyRouteLimiter` na escrita. **Mas** `GET /sispag/contas-pagadoras` e `GET /sispag/lotes/:id/remessa/arquivo` são acessíveis a qualquer usuário autenticado. | ⚠️ parcial | `src/backend/http/sispagGate.ts` + `routes/sispag.ts:368-380,424-437` |
| **Limit Exposure** | `.env` gitignorado; `.REM` servido só por endpoint autenticado; escrita no ERP gated (`CONEXOS_WRITE_ENABLED` × `CONEXOS_DRY_RUN`). **Mas** o `.env` local aponta para PROD (não há `.env.hml` / dev-DB separado) — dev-machine ≡ prod-machine. | ⚠️ parcial | `src/backend/.env` (todos os endpoints prod) |
| **Encrypt Data** | TLS confia no LB do Render. `conexos_password_enc` (na tabela `app_user`) cifrado no banco. Postgres via Supabase pooler (TLS). **Mas** `.env` guarda senhas em plaintext, e o `.REM` (com contas bancárias) trafega `Content-Type: text/plain; charset=latin1` sem cifra própria — depende só do TLS de borda. | ⚠️ parcial | `src/backend/.env` + `routes/sispag.ts:432-434` |
| **Separate Entities** | Não há isolamento por filial no SISPAG: um admin da filial 2 pode operar `filCod=1` mudando o número no body. `filialAuthz.ts` existe (Recebimentos usa), a docstring já pede paridade e o SISPAG não aplicou. | ❌ ausente | `src/backend/http/filialAuthz.ts` docstring + zero uso em `routes/sispag.ts` |
| **Change Default Settings** | `role` default do `app_user` é **`'admin'`** — todo novo usuário nasce com acesso máximo. `CONEXOS_DRY_RUN=true` é default seguro (mas o `.env` de dev/prod tem `false`). | ❌ ausente | `src/backend/migrations/0007_app_user.sql:8` |
| **Validate Input** | Zod em `conciliar` + `criarLote` + `incluirTitulo` + `versao` + `contaPagadora` + `modalidade` + `listLotes`. `POST /sispag/lotes/:id/remessa` **não** valida o body (só faz `req.body?.dryRun === true`). | ⚠️ parcial | `src/backend/routes/sispag.ts:79-104,404-417` |
| **Revoke Access** | `app_user.ativo=false` desativa login (fake-inválido — não revela existência). `signOut()` local + `notifySessionExpired()` limpa `localStorage`. Sem revocation list server-side de JWT — token válido até `exp` (12 h). | ⚠️ parcial | `src/backend/domain/service/auth/AuthService.ts:52-54` + `src/frontend/lib/auth/AuthProvider.tsx:79-102` |
| **Lock Computer** | N/A (browser session; JWT expira em 12 h). | N/A | — |
| **Inform Actors** | `AuthProvider` mostra modal `sessionExpired`; banner de `conexosStatus='falha'` avisa quando a operação vai cair no robô. Sem canal para admin sobre 403 repetido. | ⚠️ parcial | `src/frontend/lib/auth/AuthProvider.tsx:79-108` |
| **Restore** | Ledger `remessa_execucao` write-ahead + `settled` idempotente + `RemessaEmDuvidaError` fail-closed dão base para recuperar sem duplicar dinheiro. Overlap com Fault Tolerance / Availability. | ✅ presente | `RemessaExecucaoRepository.beginExecution` + `RemessaService.gerarRemessa` |
| **Audit Trail** | `remessa_execucao.executado_por`, `criado_em`, `atualizado_em`, `erp_response`, `erro_mensagem`, `etapa`. `LogService.info(..., ator)` no `ConciliacaoRetornoService`. Middleware `[REQ]/[RES]` com `requestId`. | ✅ presente | migration `0049_sispag_remessa_retorno.sql` linhas 79-99 + `RemessaService.ts:174-197` + `ConciliacaoRetornoService.ts:98-104` |

## 4. Findings

### F-security-1: `GET /sispag/contas-pagadoras` e `GET /sispag/lotes/:id/remessa/arquivo` sem `requireRole('admin')` — qualquer autenticado baixa contas bancárias

- **Severidade**: P0
- **Tactic violada**: Limit Access / Authorize Actors
- **Localização**: `src/backend/routes/sispag.ts:368-380` e `src/backend/routes/sispag.ts:424-437`
- **Evidência (objetiva)**:
  ```typescript
  // routes/sispag.ts:369  (contas da empresa)
  router.get(
      '/contas-pagadoras',
      asyncHandler(async (req, res) => {
          // ... await service.listContasCorrentes(filCod)  // fin005: banco, agência, conta, dvConta, gerNum
      }),
  );

  // routes/sispag.ts:425  (.REM CNAB 240 com contas dos FORNECEDORES)
  router.get(
      '/lotes/:id/remessa/arquivo',
      asyncHandler(async (req, res) => {
          // ...
          res.setHeader('Content-Disposition', `attachment; filename="${arquivo.nomeArquivo}"`);
          res.send(arquivo.conteudo);  // <- CNAB 240 texto puro
      }),
  );
  ```
  Compare com as escritas irmãs, todas com `requireRole('admin')`:
  ```typescript
  router.post('/lotes/:id/remessa', requireRole('admin'), heavyRouteLimiter, /*...*/);
  router.post('/retornos/conciliar', requireRole('admin'), heavyRouteLimiter, /*...*/);
  ```
- **Impacto técnico**: qualquer usuário com token válido (12 h) chama `curl -H "Authorization: Bearer $JWT" /sispag/contas-pagadoras?filCod=2` e recebe todas as contas correntes da filial (17 contas na filial 2, segundo o próprio comentário da rota); e `/sispag/lotes/:id/remessa/arquivo` devolve o CNAB 240 com CNPJ, banco, agência e conta bancária de cada fornecedor pago no lote.
- **Impacto de negócio**: PII (CNPJ + conta de fornecedores) e "carteira de bancos" da Columbia expostas a qualquer operador. LGPD Art. 6º (finalidade/necessidade) e sigilo bancário (LC 105) — dados que só o financeiro pode ver estão a um clique de qualquer front-end autenticado. Um viewer que rode `wget` em loop levanta o mapa de fornecedores concorrentes.
- **Métrica de baseline**: 2 rotas expondo PII/dados bancários sem gate de role, versus alvo 0. Rotas irmãs (as 4 escritas do delta) têm `requireRole('admin')` — a assimetria é o defeito.

### F-security-2: `.env` local aponta para PROD (Conexos + Supabase + JWT) — dev-machine ≡ prod-machine

- **Severidade**: P0
- **Tactic violada**: Limit Exposure / Separate Entities / Encrypt Data
- **Localização**: `src/backend/.env` (arquivo inteiro, não versionado — verificado local)
- **Evidência (objetiva)**:
  ```
  CONEXOS_BASE_URL=https://columbiatrading.conexos.cloud/api      # PRD (não é o -hml)
  CONEXOS_USERNAME=MPS_FRANCINEI
  CONEXOS_PASSWORD=@Amarelo521                                    # PRD, pessoa real
  databaseConnectionString=postgresql://postgres.kngrpoqzaxtuzkcugsyl:KavexCLX%40CLC@aws-1-sa-east-1.pooler.supabase.com:5432/postgres   # Supabase compartilhada = PRD
  AUTH_JWT_SECRET=KsgFKoprJeDiMWZB2X6OwazzZdXCoxTqizrHH7gVSuxBwxT6EE4tNQJzySSrGYP/  # segredo de assinatura de token PRD
  ADMIN_PASSWORD=Kavex@2026
  CONEXOS_WRITE_ENABLED=true
  CONEXOS_DRY_RUN=false
  ```
  Boas notícias: `git check-ignore -v src/backend/.env` → `.gitignore:3` (ignorado); `git log --all -S "@Amarelo521"` → 0 hits (nunca commitado).
- **Impacto técnico**: qualquer laptop com esse `.env` (dev, contractor, worktree do pipeline `/feature-*`) pode (i) assinar tokens JWT válidos para os usuários prod porque tem o `AUTH_JWT_SECRET`; (ii) rodar SQL direto na Supabase com senha `KavexCLX@CLC`; (iii) disparar `Gerar remessa` com escrita LIGADA (`CONEXOS_WRITE_ENABLED=true`, `CONEXOS_DRY_RUN=false`) contra o ERP produção. Sem HSM, sem rotação, sem separação de credencial `local/hml/prd`.
- **Impacto de negócio**: um roubo/perda de laptop escala imediatamente para: forjar sessão de qualquer admin, ler/alterar Postgres da Columbia, gerar remessa não autorizada. `.gitignore` só protege da via commit — não protege de `cat .env` ou de um backup de dev sincronizado em nuvem pessoal.
- **Métrica de baseline**: 1 arquivo `.env` combinando 4 segredos prod (Conexos, Supabase, JWT signing, admin bcrypt-seed) em nível de conta root. Alvo: 4 arquivos separados por env, com placeholders para `local/hml`, e prod nunca em disco de dev.

### F-security-3: dependências com vulnerabilidades altas — axios <1.18.0 no backend, next/postcss/sharp/ws no frontend

- **Severidade**: P1
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/package.json` (axios direto), `src/frontend/package.json` (next, sharp, ws, postcss transitivos)
- **Evidência (objetiva)**:
  ```
  backend  npm audit: 8 vulns (0 critical, 4 high, 2 moderate, 2 low)
    axios <1.18.0     — high (proxy-inheritance CVE, SSRF vetor)
    exceljs → uuid    — moderate (bounds check)
    js-yaml           — low

  frontend npm audit: 8 vulns (0 critical, 7 high, 0 moderate, 1 low)
    next              — high (várias)
    postcss <=8.5.22  — high (XSS + path-traversal em sourceMappingURL)
    sharp <0.35.0     — high (CVE libvips 33327/33328/35590/35591)
    ws 8.0.0-8.20.1   — high (memory exhaustion + uninitialized memory)
  ```
  Aviso do usuário: Dependabot no `main` reporta **52 alertas** — não conferido localmente.
- **Impacto técnico**: `axios` é o cliente que chama o Conexos ERP (server-side) — a CVE `GHSA-gcfj-64vw-6mp9` (proxy inherited via interceptor cloning) pode redirecionar chamadas HTTP para um host controlado pelo atacante em cenários de SSRF. `sharp/libvips` opera sobre imagens uploadadas (não é o vetor SISPAG, mas o frontend depende). `postcss` XSS impacta o pipeline de build.
- **Impacto de negócio**: `npm audit fix` em axios é semver-menor e não quebra a API — não fazer é dívida gratuita; o Dependabot já está mostrando 52 na branch default, sinal de que a rotina de patch não está oleada.
- **Métrica de baseline**: backend 4 high + frontend 7 high = 11 high, versus alvo `0 high`.

### F-security-4: SISPAG sem `filialAuthz` — um admin da filial 2 opera `filCod=1` mudando o número no body

- **Severidade**: P1
- **Tactic violada**: Separate Entities / Authorize Actors
- **Localização**: `src/backend/routes/sispag.ts` (nenhum `assertUserCanActOnFilial`) versus `src/backend/http/filialAuthz.ts:15-20` (docstring: *"The same tactic should be replicated on the SISPAG money-moving routes for parity"*)
- **Evidência (objetiva)**:
  ```typescript
  // routes/sispag.ts:445  (nenhum filialAuthz)
  router.post(
      '/retornos/conciliar',
      requireRole('admin'),
      heavyRouteLimiter,
      asyncHandler(async (req, res) => {
          const parsed = conciliarSchema.safeParse(req.body);
          // parsed.data.filCod chega DIRETO no service — sem checar allow-list do user
          await service.conciliar({ filCod: parsed.data.filCod, /*...*/ });
      }),
  );
  ```
  Comparar com `routes/recebimentos.ts:51,239` — Recebimentos já importa `filialAuthz` e chama `assertUserCanActOnFilial(req.user, filCod)`.
- **Impacto técnico**: hoje é benigno porque o `role` default é `admin` e não há segregação por filial (F-security-5). Amanhã, quando o vínculo por filial existir no JWT (`filiais: number[]`, já previsto no `AuthUser`), o SISPAG **não** vai bloquear — o guard nem é chamado.
- **Impacto de negócio**: um analista da filial de SP dispara conciliação da filial de MG. A escrita já saiu no ERP como `MPS_FRANCINEI` — a rastreabilidade fica no `executado_por` do ledger, mas a autoridade para agir sobre aquela filial nunca foi checada.
- **Métrica de baseline**: 4 rotas de escrita SISPAG × 0 chamadas de `assertUserCanActOnFilial`. Recebimentos, 11/11 nas rotas que carregam `filCod`.

### F-security-5: `app_user.role` default `'admin'` — todo usuário nasce com poder máximo; `requireRole('admin')` vira no-op universal

- **Severidade**: P1
- **Tactic violada**: Change Default Settings
- **Localização**: `src/backend/migrations/0007_app_user.sql:8`
- **Evidência (objetiva)**:
  ```sql
  CREATE TABLE IF NOT EXISTS app_user (
      ...
      role TEXT NOT NULL DEFAULT 'admin',
      ...
  );
  ```
  `grep -rn "role.*viewer\|role.*'user'\|role IN" src/backend` → 0 usos de qualquer role ≠ `'admin'` no código. `UserAdminService.createUserSchema` aceita `role` opcional; o teste `UserAdminService.test.ts:44` só exige role ∈ enum, sem obrigar `viewer` como default.
- **Impacto técnico**: `requireRole('admin')` é uma barreira nominal — todo `app_user` cadastrado passa. Regis nº `security-1` de junho de 2026 (`commit 538a3512`) plantou o RBAC server-side, mas o modelo de roles ficou vazio: só existe `admin`.
- **Impacto de negócio**: quando o time expandir para operadores/analistas do financeiro, o `.env.example`+seed atual entrega admin. `viewer`/`operator` precisam ser modelados antes que a segunda pessoa não-Yuri/não-Marco receba credencial.
- **Métrica de baseline**: 1 role definida (`admin`), alvo ≥ 3 (`viewer` para leituras, `operator` para lote-rascunho, `admin` para remessa/conciliação).

### F-security-6: frontend SISPAG não gate a UI por role — LoteCard mostra "Gerar remessa/Conciliar/Cancelar" para qualquer autenticado

- **Severidade**: P2
- **Tactic violada**: Inform Actors (UX layer da defesa)
- **Localização**: `src/frontend/app/sispag/components/LoteCard.tsx` (nenhum `useRole`/`useIsAdmin`) e `src/frontend/app/sispag/page.tsx` (idem)
- **Evidência (objetiva)**: `grep -rn "useRole\|useIsAdmin" src/frontend/app` retorna só `app/usuarios/page.tsx:20,37`. Nada em `app/sispag/`. Botões de escrita renderizados incondicionalmente (`LoteCard.tsx:184-256`).
- **Impacto técnico**: o gate real é server-side (backend 403). O impacto aqui é ergonômico: viewer clica em "Gerar remessa" e leva um toast de erro genérico em vez de nem ver o botão. Não é vazamento — é ruído no fluxo.
- **Impacto de negócio**: baixo hoje (todos são admin). Vira alto no dia em que existir `viewer` (F-security-5): pior UX + risco de o viewer disparar 10 tentativas e comer o `heavyRouteLimiter` do próprio time.
- **Métrica de baseline**: 0/6 botões de escrita SISPAG guardados por role no frontend. Alvo: 6/6.

### F-security-7: `ator` fallback para `'unknown'` — não-repúdio quebra silenciosamente se o JWT vier sem `sub`/`email`

- **Severidade**: P2
- **Tactic violada**: Identify Actors / Audit Trail
- **Localização**: `src/backend/routes/sispag.ts:66`
- **Evidência (objetiva)**:
  ```typescript
  const ator = (req: Request): string => req.user?.sub ?? req.user?.email ?? 'unknown';
  ```
  `toAuthUser` (`http/auth.ts:64-73`) já lança quando `payload.sub` falta; então em tese `req.user.sub` é garantido pós-middleware. Mas o fallback está lá, e se um dia o middleware for trocado (ou pulado por `DEV_AUTH_BYPASS=true` em `local` — que passa `next()` sem popular `req.user`) toda escrita entra no ledger como `executado_por='unknown'`.
- **Impacto técnico**: em dev-bypass a escrita já é impedida por `sispagGate` só em prod; mas se alguém habilitar SISPAG em hml/dev com bypass, o ledger perde a atribuição.
- **Impacto de negócio**: `remessa_execucao.executado_por='unknown'` para uma transação de milhões — impossível dizer quem apertou o botão. Auditoria fiscal e forense de fraude perdem o vetor.
- **Métrica de baseline**: 1 linha de fallback silencioso; alvo: throw 500 (`assertUser(req)`) se `req.user?.sub` faltar em qualquer rota de escrita.

### F-security-8: `POST /sispag/lotes/:id/remessa` aceita body sem schema Zod — só lê `req.body?.dryRun === true`

- **Severidade**: P3
- **Tactic violada**: Validate Input
- **Localização**: `src/backend/routes/sispag.ts:400-417`
- **Evidência (objetiva)**:
  ```typescript
  router.post(
      '/lotes/:id/remessa',
      requireRole('admin'),
      heavyRouteLimiter,
      asyncHandler(async (req, res) => {
          // ...
          ...(req.body?.dryRun === true ? { dryRunOverride: true } : {}),
      }),
  );
  ```
  As rotas irmãs (`conciliar`, `lotes`, `itens`, `modalidade`, etc.) usam Zod. Esta não.
- **Impacto técnico**: hoje o handler ignora tudo exceto `dryRun`. Um body malformado grande passa por `express.json()` até o body-parser default (100 kb). Sem vetor de exploração direto — o defeito é de higiene.
- **Impacto de negócio**: pequeno; entra como consistência arquitetural. Manter TODAS as rotas de escrita com Zod deixa o `PatternGuardian` executável.
- **Métrica de baseline**: 1/6 rotas de escrita SISPAG sem Zod no body (o resto tem).

## 5. Cards Kanban

### [security-1] Fechar `GET /sispag/contas-pagadoras` e `GET /sispag/lotes/:id/remessa/arquivo` sob `requireRole('admin')`

- **Problema**
  > Qualquer usuário autenticado (JWT válido de 12 h, hoje todos `admin` por default) baixa (i) a lista completa de contas correntes pagadoras da filial (`fin005`, 17 contas na filial 2) e (ii) o arquivo `.REM` CNAB 240 do lote, que contém CNPJ, banco, agência e conta bancária de cada fornecedor. As rotas irmãs de escrita têm `requireRole('admin')`; as duas de leitura ficaram sem.
- **Melhoria Proposta**
  > Aplicar `requireRole('admin')` em `router.get('/contas-pagadoras', ...)` (linha 369) e `router.get('/lotes/:id/remessa/arquivo', ...)` (linha 425) em `src/backend/routes/sispag.ts`. Quando o modelo de roles introduzir `viewer` (card `security-5`), reavaliar se essas duas rotas ficam `admin`-only ou passam a `viewer` (leitura). Tactic Bass: **Authorize Actors** / **Limit Access**.
- **Resultado Esperado**
  > Rotas de PII/dados bancários com role gate: 0/2 → 2/2. Um viewer autenticado recebe 403; auditor prova em `curl` que a lista de contas do fornecedor precisa de role explícito.
- **Tactic alvo**: Authorize Actors / Limit Access
- **Severidade**: P0
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - rotas de leitura sensíveis com `requireRole`: 0/2 → 2/2
  - `curl -H "Authorization: Bearer $VIEWER_JWT" .../contas-pagadoras`: 200 → 403
- **Risco de não fazer**: LGPD Art. 46 (segurança) + LC 105 (sigilo bancário) — vazamento de contas de fornecedor por qualquer operador logado. Concorrência mapeia carteira Columbia com um `wget` em loop.
- **Dependências**: nenhuma

### [security-2] Sair da máquina de dev com credencial PROD — separar `.env` por ambiente e rotacionar segredos comprometidos

- **Problema**
  > O `.env` de desenvolvimento aponta para Conexos PRD (`columbiatrading.conexos.cloud/api`), Supabase pool compartilhada, `AUTH_JWT_SECRET` de assinatura de token e `ADMIN_PASSWORD`, todos em plaintext. Está gitignorado e o histórico limpo, mas cada laptop de dev (incluindo worktrees efêmeros do pipeline `/feature-*`) carrega credencial que assina tokens de qualquer usuário prod, roda SQL direto no banco prod e dispara remessa real (`CONEXOS_WRITE_ENABLED=true`, `CONEXOS_DRY_RUN=false`).
- **Melhoria Proposta**
  > (1) Criar `.env.local` / `.env.hml` / `.env.prd` separados; máquina de dev usa `.env.local` apontando para `columbiatrading-hml.conexos.cloud/api` e para uma base Supabase de dev. (2) Rotacionar imediatamente: `AUTH_JWT_SECRET`, `CONEXOS_PASSWORD` de `MPS_FRANCINEI`, `ADMIN_PASSWORD`, `databaseConnectionString` — todos foram lidos por qualquer humano/agente com acesso ao filesystem. (3) `EnvironmentProvider` (já existe) recusa `CONEXOS_WRITE_ENABLED=true` fora do runtime do Render (checar `RENDER` env var ou hash de host). (4) Documentar no `DEPLOY.md` e no `CLAUDE.md` que máquina local NUNCA pode ter secret prd. Tactic Bass: **Limit Exposure** / **Separate Entities**.
- **Resultado Esperado**
  > Máquinas de dev nunca mais assinam token prod nem conectam no Postgres prod. Segredos comprometidos rotacionados. Regra explícita no `.env.example` — hoje o exemplo mostra `CONEXOS_USERNAME=` vazio, mas o `.env` vivo tem `MPS_FRANCINEI` + senha; a doutrina existe e não é reforçada.
- **Tactic alvo**: Limit Exposure / Separate Entities / Encrypt Data
- **Severidade**: P0
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - `.env` de dev apontando para host prod: 1 arquivo → 0
  - segredos prod compartilhados entre máquinas: 4 (`AUTH_JWT_SECRET`, `CONEXOS_PASSWORD`, `ADMIN_PASSWORD`, `databaseConnectionString`) → 0 (rotacionados; prod só no dashboard do Render)
  - `EnvironmentProvider` que rejeita `CONEXOS_WRITE_ENABLED=true` fora do runtime autorizado: ausente → presente
- **Risco de não fazer**: perda/roubo/foto de tela de um laptop de dev = fraude eletrônica autenticada como qualquer usuário prod. Isto é o P0 que a arquitetura tem hoje.
- **Dependências**: coordenar rotação com Yuri (o `MPS_FRANCINEI` é conta pessoal no Conexos — trocar senha exige a Francinei junto).

### [security-3] Rodar `npm audit fix` nos dois pacotes e ligar Dependabot auto-PR para high/critical

- **Problema**
  > `src/backend` tem 4 vulnerabilidades high (`axios <1.18.0` incluso, que é o cliente HTTP do Conexos), `src/frontend` tem 7 high (next/postcss XSS/path-traversal, sharp/libvips CVEs, ws memory-exhaustion). Dependabot no `main` reporta 52 alertas — não conferido localmente. Nenhum path de exploração direto no delta, mas cliente HTTP do ERP na versão vulnerável a `GHSA-gcfj-64vw-6mp9` é dívida de risco visível.
- **Melhoria Proposta**
  > `npm audit fix` no `src/backend` (deve resolver axios sem semver-major); no `src/frontend` `npm audit fix` (postcss/ws/sharp/next). Se algum precisar de `--force`, PR separado com validação. Ligar Dependabot auto-PR para high/critical no `.github/dependabot.yml` (weekly grouped) e habilitar `pnpm outdated` ou `npm outdated` como gate no CI. Tactic Bass: **Limit Exposure**.
- **Resultado Esperado**
  > `npm audit` reporta 0 high e 0 critical nos dois pacotes; Dependabot fecha os 52 alertas do `main` ou os categoriza como aceitos (com justificativa).
- **Tactic alvo**: Limit Exposure
- **Severidade**: P1
- **Esforço estimado**: M (2–5d — inclui verificar breaking em ws/postcss)
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - backend high: 4 → 0
  - frontend high: 7 → 0
  - Dependabot alerts em `main`: 52 → ≤ 5 (aceitos com justificativa)
- **Risco de não fazer**: SSRF via axios proxy inheritance CVE se algum interceptor for adicionado; XSS/path-traversal via postcss no build; auditor externo (LGPD/ISO) reprova `high` sem tratativa.
- **Dependências**: nenhuma

### [security-4] Aplicar `filialAuthz` nas 4 rotas de escrita SISPAG (paridade com Recebimentos)

- **Problema**
  > `POST /sispag/lotes` / `/lotes/:id/itens` / `/lotes/:id/remessa` / `/retornos/conciliar` recebem `filCod` no body e não chamam `assertUserCanActOnFilial(req.user, filCod)`. A docstring do `http/filialAuthz.ts` explicitamente pede: *"The same tactic should be replicated on the SISPAG money-moving routes for parity"*. Hoje é inócuo porque não há segregação por filial no JWT, mas cria seam para quando existir.
- **Melhoria Proposta**
  > Importar `assertUserCanActOnFilial` em `routes/sispag.ts` e chamar antes de resolver o service em cada rota de escrita que carrega `filCod`. Espelhar o padrão de `routes/recebimentos.ts:239-260`. Escrever o teste equivalente ao de `routes/recebimentos.test.ts` (usuário sem `filiais` claim = passa; usuário com claim que não inclui `filCod` alvo = 403). Tactic Bass: **Separate Entities** / **Authorize Actors**.
- **Resultado Esperado**
  > 4/4 rotas de escrita SISPAG com `filialAuthz`. Quando o claim `filiais` chegar no JWT (`AuthUser.filiais` já existe), o lock ativa sem edit de rota — só reprovisionar o token.
- **Tactic alvo**: Separate Entities / Authorize Actors
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - rotas SISPAG money-moving cobertas por `filialAuthz`: 0/4 → 4/4
  - teste "user allow-list [1] tenta filCod=2" retorna 403: ausente → presente
- **Risco de não fazer**: qualquer expansão do modelo de roles para operadores por filial vira retrabalho — 4 rotas mais o teste. E a docstring do próprio filialAuthz continua acusando falta de paridade.
- **Dependências**: nenhuma (o guard já está pronto)

### [security-5] Modelo de roles ≠ `admin` — introduzir `viewer` como default e `operator` intermediário

- **Problema**
  > `role TEXT NOT NULL DEFAULT 'admin'` (migration 0007) faz cada usuário nascer admin. `requireRole('admin')` está espalhado no código mas hoje não bloqueia ninguém no `app_user`. Um cadastro novo (via `/usuarios`) sem override de role vira admin — e a UI de gestão também default para admin.
- **Melhoria Proposta**
  > Migration para (a) mudar default para `'viewer'`; (b) adicionar `CHECK (role IN ('viewer','operator','admin'))`; (c) atualizar `UserAdminService.createUserSchema` para exigir role explícito e default seguro. Documentar no `README` / `docs/roles.md` o mapa role → rotas. Backfill: usuários existentes ficam admin (não regride ninguém); só novos entram como viewer. Tactic Bass: **Change Default Settings**.
- **Resultado Esperado**
  > `SELECT role, count(*) FROM app_user` mostra distribuição plausível (a maioria viewer, poucos admin). `requireRole('admin')` passa a funcionar como barreira real. Cards `security-1`, `security-4` e `security-6` ganham semântica.
- **Tactic alvo**: Change Default Settings
- **Severidade**: P1
- **Esforço estimado**: M (2–5d — inclui runbook de reclassificação dos usuários atuais)
- **Findings relacionados**: F-security-5, F-security-6
- **Métricas de sucesso**:
  - roles definidas: 1 → ≥ 3
  - default de novo usuário: `admin` → `viewer`
  - `CHECK` constraint no `role`: ausente → presente
- **Risco de não fazer**: o primeiro operador contratado fora do time atual recebe admin por default; qualquer credencial vazada é super-admin.
- **Dependências**: coordenar com o time de gestão de acesso (Yuri decide o mapa role → ação)

### [security-6] Endurecer `ator()` e adicionar Zod em `POST /sispag/lotes/:id/remessa`

- **Problema**
  > `ator(req)` cai em `'unknown'` se `sub`/`email` sumirem do token — não-repúdio quebra silenciosamente. `POST /sispag/lotes/:id/remessa` é a única rota de escrita SISPAG sem `safeParse` no body. Ambos são higiene arquitetural, mas fecham vetores de inconsistência.
- **Melhoria Proposta**
  > (1) Trocar o fallback por `throw new Error('missing user identity')` (ou 500 explícito) em `routes/sispag.ts:66` e replicar nas outras rotas que usam `ator()`. Idealmente extrair `assertUser(req): AuthUser` em `http/auth.ts` e usar em vez do fallback. (2) Adicionar `const remessaSchema = z.object({ dryRun: z.coerce.boolean().optional() })` e `safeParse` na rota `/lotes/:id/remessa`. Tactic Bass: **Identify Actors** / **Validate Input**.
- **Resultado Esperado**
  > Toda escrita SISPAG grava `executado_por` com um `sub` real; nenhuma rota de escrita passa por `req.body` sem Zod.
- **Tactic alvo**: Identify Actors / Validate Input
- **Severidade**: P2/P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-7, F-security-8
- **Métricas de sucesso**:
  - ocorrências de `'unknown'` em `remessa_execucao.executado_por` (24 h): 0 hoje mas fallback existe → 0 (impossível por construção)
  - rotas de escrita SISPAG sem Zod no body: 1 → 0
- **Risco de não fazer**: baixo hoje, alto se `DEV_AUTH_BYPASS` for habilitado em hml com SISPAG ligado — todo remessa gravada como `'unknown'` deixa auditoria fiscal sem culpado.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo restrito às 47 alterações listadas em `_shared-metrics.md` (branch `fix/sispag-fin015-import-shape`, PR #60). Não avaliei rotas fora do SISPAG salvo comparação (Recebimentos serviu de baseline para `filialAuthz`).
- Não há `infra/` neste repo — deploy é Render (ver `DEPLOY.md`). IAM/Terraform/CloudTrail marcados N/A.
- `git log --pickaxe-regex -S "<segredo>"` para `@Amarelo521`, `KsgFKoprJe`, `KavexCLX`, `Kavex@2026`, `MPS_FRANCINEI` — 0 hits em conteúdo commitado; a única aparição em git é a *palavra* `security-1` no `commit -m` de junho.
- Cross-QA para o consolidator:
  - **Audit Trail** (`remessa_execucao.executado_por`, `LogService.info(ator)`) casa com **Fault Tolerance** (mesmo ledger cobre idempotência e recuperação de órfão) — a mesma tabela serve dois QA.
  - **Limit Exposure** (`.env` local prod + `CONEXOS_WRITE_ENABLED=true`) casa com **Availability** (blast radius: um retry ao vivo duplica R$ real).
  - **Validate Input** (Zod ausente em `remessa`) casa com **Integrability** — o `PatternGuardian` deveria pegar a assimetria entre rotas irmãs.
