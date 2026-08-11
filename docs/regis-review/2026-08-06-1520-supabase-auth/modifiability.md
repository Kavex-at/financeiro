---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-08-06-1520-supabase-auth
agent: qa-modifiability
generated_at: 2026-08-06T15:20:00Z
scope: all
score: 6
findings_count: 9
cards_count: 7
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time da Kavex ou Yuri (produto) | Regra de domínio muda em uma frente (ex.: cortar SISPAG à meia-noite, trocar TTL de contexto de auth, ligar SSO Azure AD, mudar a conta gerencial de juros/desconto) | Serviços de domínio (`domain/service/*`), middlewares de auth (`http/auth.ts`, `http/appUserContext.ts`), rotas (`routes/*.ts`) e configuração externalizada | Working tree hoje (Express + Render single-instance, ADR-0030 recém-aceita, código não commitado) | Localizar a mudança em ≤ 2 arquivos por frente, sem tocar `routes/` para regras de domínio e sem quebrar as outras frentes | `# arquivos tocados por feature ≤ 5`, `# testes vermelhos por mudança de constante = 0`, `binding time da regra ≤ config (env) / não redeploy` |

Exemplo aplicado desta feature: *"decidir que o `role` do JWT do GoTrue (sempre `'authenticated'`) é descartado e o role real vem de `app_user` deve tocar UM middleware e zero rota de negócio → ADR-0030 §4 confirmou: `requireRole('admin')` fica byte-idêntico; só a origem de `req.user.role` mudou; superfície de mudança foi 3 arquivos + 1 middleware (`appUserContext.ts`), rotas intactas."*

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| p50 LOC por arquivo (backend `.ts`, sem testes, sem `node_modules`) | 84 | ≤ 150 | ✅ | `find src/backend -name '*.ts' -not -name '*.test.ts' -type f -exec wc -l` (n=216) |
| p95 LOC por arquivo (backend) | 537 | ≤ 400 | ⚠️ | idem |
| max LOC por arquivo (backend) | 1.536 (`RecebimentoNumerarioService.ts`) | ≤ 600 | ❌ | idem |
| p50 LOC em `domain/service/` | 147 | ≤ 150 | ✅ | `find src/backend/domain/service -type f -exec wc -l` (n=49) |
| p95 LOC em `domain/service/` | 776 | ≤ 400 | ❌ | idem |
| Média LOC em `domain/service/` | 238 | — | ⚠️ | shared-metrics (11.660 / 49) |
| Média LOC em `domain/client/` | 294 | — | ⚠️ | shared-metrics (6.174 / 21). Clients maiores que services é o inverso do desejável |
| Média LOC em `routes/` | 347 | ≤ 200 | ❌ | shared-metrics (2.432 / 7) |
| # arquivos `> 600 LOC` (candidatos a Split Module) | 6 (`RecebimentoNumerarioService`, `ConexosGerDocProcessoClient`, `EleicaoPermutasService`, `routes/recebimentos.ts`, `routes/permutas.ts`, `ReconciliacaoPermutaService`) | 0 | ❌ | `find … -exec wc -l \| sort -rn` |
| # warnings `noExcessiveCognitiveComplexity` (backend) | 38 (baseline `origin/main`: 35; delta desta feature: +3) | 0 | ⚠️ | `npm run lint -- --max-diagnostics=100`; ver shared-metrics |
| # funções com complexidade cognitiva ≥ 30 | 8 (piores: `EleicaoPermutasService.ts:621` **65**, `GestaoPermutasService.ts:262` **59**, `IngestaoPermutasService.ts:408` 43, `ConexosSispagRetornoClient.ts:164` 36, `validate-fin015-tools.ts:48` 36, `IngestaoPermutasService.ts:293` 35, `ReconciliacaoPermutaService.ts:92` 33, `recebimentos.e2e.hmlTituloZero.integration.test.ts:200` 31) | 0 | ❌ | idem lint log |
| # warnings novos desta feature | 3 (`SupabaseAdminClient.test.ts:220` 19 · `http/appUserContext.ts:135` 27 · `jobs/migrate-users-to-supabase.ts:56` 17) | 0 | ⚠️ | diff dos warnings vs baseline 35 |
| # violações layer-skipping em `routes/*.ts` (routes importando `domain/repository/` ou `domain/client/`) | 10 imports em 5 rotas (`permutas.ts` 5, `recebimentos.ts` 4, `sispag.ts` 1, `me.ts` 1, `conexos.ts` 1, `usuarios.ts` 2 de erros/tipos) | 0 (regra CLAUDE.md: Lambda→Service→Repo→Client) | ❌ | `grep -rn "from '.*domain/repository/\|from '.*domain/client/" src/backend/routes` |
| # violações domain→lambda | 0 | 0 | ✅ | `grep -rn "from '.*lambda/" src/backend/domain` — não há pasta `lambda/`, e o resto do domínio não importa do gatilho |
| # `container.resolve()` em `routes/` | 108 (58 só em `permutas` + `recebimentos` + `sispag`) | ≤ 1 por handler | ❌ | `grep -rEn "container\.resolve" src/backend/routes` |
| # magic numbers (constantes `= [0-9]{2,}`) em `domain/service/` | 20 (12 são valores de negócio: `MAX_TITULOS_POR_LOTE=25`, `TITULOS_CAP=400`, `PAGE_SIZE=500`, `MAX_PAGES=50`, `ADIANTAMENTOS_CONCURRENCY=10`, `CONTA_GER_JUROS=131`, `CONTA_GER_DESCONTO=130`, 5 locks pg_advisory) | Todos os valores de negócio via `EnvironmentProvider` OU documentados como constantes deliberadas | ⚠️ | `grep -rEn "const [A-Z_]+ *= *[0-9]{2,}" src/backend/domain/service` |
| # tokens `container.register` (defer binding por interface) | 17 (`recebimentosContainer.ts` — 15 tokens de porta, `appContainer.ts` — 1 legado, `ConexosBaseClient.ts` — 1 shape) | > 0 (existe e é usado) | ✅ | `grep -rEn "container\.register\|Symbol\(" src/backend --include="*.ts"` |
| # interfaces com múltiplas implementações registráveis (defer binding real) | 6+ nos ports de recebimentos (`NexxeraGatewayStub`, `NdeEmitterStub`, `ProcessoProviderStub` vs `ProcessoProviderConexos`, etc.) | > 0 | ✅ | `recebimentosContainer.ts:50-93` |
| ADR-0030 §6 rollback Fase 2: env var na Vercel, sem redeploy backend | `NEXT_PUBLIC_AUTH_PROVIDER=supabase` em `.env.example`, **nunca lido no código** frontend | Lido em runtime, com branch para `legacy` | ❌ | `grep -rEn "NEXT_PUBLIC_AUTH_PROVIDER\|AUTH_PROVIDER" src/frontend --include="*.ts" --include="*.tsx"` → 0 hits fora de `.env.example` |
| ADR-0030 §6 rollback backend: `AUTH_LEGACY_LOGIN_ENABLED` | Env var, lida em `authEnv.ts:100`, ramo testado em `auth.test.ts:87`/`:116` | Lido, testado, revogável sem code change | ✅ | `grep -rn "AUTH_LEGACY_LOGIN_ENABLED" src/backend/http/authEnv.ts` |
| TTL do contexto de auth | Constante tipada `APP_USER_CONTEXT_TTL_MS = 30_000` com racional escrito (`AppUserContextCache.ts:4-15`) e a restrição de instância única do Render explicitamente datada | Documentado + binding time consciente | ✅ | `src/backend/domain/service/auth/AppUserContextCache.ts:16` |
| # call sites reescritos para `auditActor` (Encapsulate + Refactor da regra I-Usuario-1) | 28 | Todos os sites de auditoria centralizados | ✅ | `grep -rn "auditActor(req" src/backend --include="*.ts" \| grep -v "\.test\." \| grep -v "http/auth.ts"` |
| Cobertura de guarda anti-regressão para I-Usuario-1 | 1 teste grep-based (`auditActor.guard.test.ts`) que varre `routes/` procurando `req.user?.sub ??` | Guarda que falha se a doutrina errada voltar | ✅ | `src/backend/http/auditActor.guard.test.ts:57-70` |
| Ontologia — drift entre `_index.json` (24 keys) e `actions/*.md` (23 arquivos + 1 sem chave) | 1 arquivo sem chave, ~5 drifts remanescentes reconhecidos em `_meta.note` | 0 | ⚠️ | `ontology/_index.json` `_meta.note` — vai para `/retro-ontology` |

### Apêndice A — Top-10 arquivos por LOC (backend, sem testes)

| # | Arquivo | LOC | Camada |
|---:|---|---:|---|
| 1 | `domain/service/recebimentos/RecebimentoNumerarioService.ts` | 1.536 | service |
| 2 | `domain/client/ConexosGerDocProcessoClient.ts` | 1.197 | client |
| 3 | `domain/service/permutas/EleicaoPermutasService.ts` | 911 | service |
| 4 | `routes/recebimentos.ts` | 853 | routes |
| 5 | `routes/permutas.ts` | 784 | routes |
| 6 | `domain/service/permutas/ReconciliacaoPermutaService.ts` | 776 | service |
| 7 | `domain/client/ConexosFinanceiroClient.ts` | 703 | client |
| 8 | `domain/service/permutas/GerarSolicitacaoNumerarioService.ts` | 650 | service |
| 9 | `domain/repository/permutas/PermutaRelationalRepository.ts` | 641 | repository |
| 10 | `domain/service/permutas/BorderoGestaoService.ts` | 546 | service |

### Apêndice B — Top-10 fan-in (services mais referenciados por outros arquivos de produção)

Fan-in = `import` estático + `container.resolve(...)` em qualquer arquivo `.ts` não-teste. Excluído auto-referência.

| # | Service | Fan-in | Comentário |
|---:|---|---:|---|
| 1 | `service/recebimentos/IngestaoTransacoesService.ts` | 5 (3 import + 2 resolve) | Ponto de entrada de Frente IV |
| 1 | `service/permutas/PainelService.ts` | 5 (4 + 1) | Fachada de leitura |
| 1 | `service/permutas/ErpErrorInterpreter.ts` | 5 (1 + 4) | Serviço compartilhado — mudanças aqui afetam todo tratamento de erro Conexos |
| 4 | `service/sispag/SispagPainelService.ts` | 4 | |
| 4 | `service/sispag/IngestaoPagamentosService.ts` | 4 | |
| 4 | `service/sispag/FormacaoLotesService.ts` | 4 | |
| 4 | `service/permutas/GestaoPermutasService.ts` | 4 | Também está entre os mais complexos (2 funções ≥ 28) |
| 4 | `service/auth/UserAdminService.ts` | 4 | **Novo desta feature**; centraliza a orquestração de dois sistemas |
| 9 | `service/recebimentos/RecebimentoNumerarioService.ts` | 3 | Único ponto de entrada; 1.536 LOC — muda muito devagar por tamanho, não por popularidade |
| 9 | `service/permutas/ReconciliacaoPermutaService.ts` | 3 | |

*Nota metodológica:* o repositório é DI-heavy (`container.resolve` em vez de `import` do concreto), então fan-in por imports subestima o acoplamento real. O contador aqui soma os dois canais. Fan-in absoluto é modesto (max 5) porque cada service tende a ter **um** ponto de entrada em `routes/`; a coluna interessante é onde essa entrada se localiza — em routes gordos que já são candidatos a split.

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | Applied on the auth surface (`http/auth.ts` + `http/appUserContext.ts` + `domain/service/auth/AppUserContextCache.ts` — cada um com uma responsabilidade), mas ausente nos 6 arquivos > 600 LOC — `RecebimentoNumerarioService` (1.536 LOC / 32 métodos / 2 públicos) e `EleicaoPermutasService` (911 LOC) são candidatos primários | ⚠️ parcial | `wc -l` top-10; `grep -cE "^    (public\|private) " RecebimentoNumerarioService.ts` |
| **Increase Semantic Coherence** | `AppUserContextCache` isolado como serviço `@singleton` com racional próprio; `auditActor` centralizado (28 sites via helper). Contra-exemplo: `http/auth.ts` mistura `buildAuthMiddleware` (factory de middleware), `requireRole` (RBAC guard) e `auditActor` (invariante de auditoria) num arquivo só — três responsabilidades semânticas distintas | ⚠️ parcial | `http/auth.ts:145-291` |
| **Encapsulate** | `EnvironmentProvider` encapsula `process.env` (Inviolable Rule #8); `SupabaseAdminClient` encapsula a GoTrue Admin API; `AppUserContextCache` encapsula o cache do 403 fail-closed | ✅ presente | `src/backend/domain/libs/environment/EnvironmentProvider.ts`; `src/backend/domain/client/SupabaseAdminClient.ts` |
| **Use an Intermediary** | `appUserContext` middleware é o intermediário canônico entre JWT (identidade) e `app_user` (autorização) — a decisão central da feature; `ConexosBaseClient` é intermediário entre os sub-clients Conexos e o legado shape (via `LEGACY_CONEXOS_TOKEN`) | ✅ presente | `http/appUserContext.ts:82`; `domain/client/ConexosBaseClient.ts:6,152` |
| **Restrict Dependencies** | Regra "Lambda → Service → Repository → Client" declarada no CLAUDE.md e vigiada pelo PatternGuardian. **Ativamente violada em 5 rotas de produção**: `routes/permutas.ts` importa 5 repositórios + 1 interpreter de erro; `routes/recebimentos.ts` importa 3 clients + 2 repositórios; `routes/sispag.ts` 1 repositório. Os handlers também fazem `container.resolve(RepoX)` diretamente (58 vezes em 3 arquivos) | ❌ ausente/violada | `grep -rn "from '.*domain/repository/\|from '.*domain/client/" src/backend/routes` |
| **Refactor** | Feature refatorou 28 call sites para `auditActor` — Refactor + Abstract Common Services executados juntos, com teste-guarda anti-regressão. Contra-exemplo: as 8 funções ≥ 30 de complexidade cognitiva estão intocadas (dívida pré-existente) | ⚠️ parcial | `git diff origin/main -- src/backend/routes` (auditActor); `noExcessiveCognitiveComplexity` list |
| **Abstract Common Services** | `auditActor` é o exemplo canônico introduzido nesta feature (a mesma expressão em 28 sites virou 1 helper testável); `LogService` @singleton; `RetryExecutor`/`FallbackExecutor`/`PollExecutor` (`domain/libs/executor/`) | ✅ presente | `http/auth.ts:264`; `domain/libs/executor/` |
| **Defer Binding — configuration files** | `.env.example` (backend + frontend) documenta as vars; `AUTH_LEGACY_LOGIN_ENABLED` (env) permite rollback da Fase 3 sem code change; `NEXT_PUBLIC_ENV`/`NEXT_PUBLIC_DEV_AUTH_BYPASS` gateiam bypass. **Contra-exemplo**: `NEXT_PUBLIC_AUTH_PROVIDER=supabase` declarado em `.env.example` mas **nunca lido** no código FE — a promessa da ADR-0030 §6 ("rollback da Fase 2 é uma variável na Vercel, sem redeploy") não é enforçada por nenhum arquivo `.ts`/`.tsx` | ⚠️ parcial | `grep -rEn "PROVIDER" src/frontend` → 1 hit, e é o próprio `.env.example` |
| **Defer Binding — polymorphism / tokens** | tsyringe com 17 tokens de porta em `recebimentosContainer.ts` (Ports & Adapters real: `NEXXERA_GATEWAY_TOKEN`, `NDE_EMITTER_TOKEN`, `MATCHING_ENGINE_TOKEN` — todos com stubs registráveis) + `LEGACY_CONEXOS_TOKEN` para a shape do adapter | ✅ presente | `domain/recebimentosContainer.ts:50-93`; `domain/client/ConexosBaseClient.ts:6` |
| **Defer Binding — runtime registration / plugin** | Verificação de JWT é **alg-aware por token** (HS256 ↔ ES256/JWKS): a mesma deploy funciona sob rotação de chave sem code change (`http/auth.ts:191-208`). Duas `JWTVerifyOptions` separadas — a armadilha do `issuer` compartilhado documentada como regressão nomeada (ADR-0030 §6 + `auth.test.ts`) | ✅ presente | `http/auth.ts:161-208`; `auth.test.ts` |
| **Defer Binding — build-time (feature flags)** | `AUTH_LEGACY_LOGIN_ENABLED` (backend Phase 3 switch) + `DEV_AUTH_BYPASS` (gated por `NEXT_PUBLIC_ENV=local`) + `NDE_ACL_PREFLIGHT` (gate operacional para escrita real) — todos são env-var flags com fallback seguro (default = mais restritivo) | ✅ presente | `http/authEnv.ts:100-140`; `routes/recebimentos.ts:492` |

## 4. Findings (achados)

### F-modifiability-1: Serviços gigantes na Frente IV e Permutas — 3 arquivos entre 776 e 1.536 LOC

- **Severidade**: P1
- **Tactic violada**: Split Module · Increase Semantic Coherence
- **Localização**:
  - `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` (1.536 LOC, 32 métodos, apenas 2 públicos)
  - `src/backend/domain/service/permutas/EleicaoPermutasService.ts` (911 LOC, 13 métodos)
  - `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts` (776 LOC, 12 métodos)
- **Evidência (objetiva)**:
  ```
  1536 src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts
   911 src/backend/domain/service/permutas/EleicaoPermutasService.ts
   776 src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts
  # methods in RecebimentoNumerarioService: 32 (2 public → 30 helpers privados, o padrão do God Service)
  ```
- **Impacto técnico**: cada mudança de regra na SN, NDe fiscal ou Reconciliação lê e testa esses arquivos por inteiro. `RecebimentoNumerarioService` orquestra o pipeline SN→baixa→NDe→ledger; `EleicaoPermutasService.buildCandidata` (complexidade cognitiva **65**) mistura hidratação de detalhe, avaliação de elegibilidade, roteamento para cliente-filtro e monta a candidata — quatro decisões num mesmo lambda de 200+ linhas.
- **Impacto de negócio**: cada bug fix ou mudança de regra na Frente IV custa mais horas do que deveria; risco de regressão silenciosa alto porque leitura completa é impraticável em code review.
- **Métrica de baseline**: p95 de LOC em `domain/service/` = 776 (alvo ≤ 400); max = 1.536 (alvo ≤ 600). Pré-existente, não introduzido por esta feature.

### F-modifiability-2: 8 funções com complexidade cognitiva ≥ 30 — teto real 65

- **Severidade**: P1
- **Tactic violada**: Refactor · Split Module
- **Localização**:
  - `domain/service/permutas/EleicaoPermutasService.ts:621` — `buildCandidata` — **65**
  - `domain/service/permutas/GestaoPermutasService.ts:262` — helper de mapeamento — **59**
  - `domain/service/permutas/IngestaoPermutasService.ts:408` — **43**
  - `domain/client/ConexosSispagRetornoClient.ts:164` — mapper de linha de retorno — **36**
  - `jobs/validate-fin015-tools.ts:48` — **36**
  - `domain/service/permutas/IngestaoPermutasService.ts:293` — **35**
  - `domain/service/permutas/ReconciliacaoPermutaService.ts:92` — **33**
  - `routes/recebimentos.e2e.hmlTituloZero.integration.test.ts:200` — **31** (teste)
- **Evidência (objetiva)**:
  ```
  ! Excessive complexity of 65 detected (max: 15).  ← buildCandidata
  ! Excessive complexity of 59 detected (max: 15).  ← GestaoPermutasService.ts:262
  ```
- **Impacto técnico**: essas funções concentram lógica que só a autora original entende; teste unitário exige montar dezenas de fixtures; qualquer branch novo aumenta o número monotonicamente.
- **Impacto de negócio**: mesma classe de risco de F-1 amplificada — a próxima regra de negócio que cair numa dessas funções tem chance mensurável de introduzir defeito silencioso (o Biome sinaliza mas não bloqueia — é `warn`).
- **Métrica de baseline**: 38 warnings totais (baseline `origin/main`: 35); 8 delas ≥ 30. Alvo do Biome: 15.

### F-modifiability-3: Rotas com lógica de negócio — 5 rotas importando repositórios e clients diretamente

- **Severidade**: P2
- **Tactic violada**: Restrict Dependencies · Increase Semantic Coherence
- **Localização**:
  - `src/backend/routes/permutas.ts` — 784 LOC, importa 5 repositórios + `ErpErrorInterpreter`
  - `src/backend/routes/recebimentos.ts` — 853 LOC, importa 3 clients + 3 repositórios
  - `src/backend/routes/sispag.ts` — 359 LOC, importa 1 repositório
  - `src/backend/routes/me.ts` — importa `ConexosSessionResolver` (client)
  - `src/backend/routes/conexos.ts` — importa `ConexosCadastroClient`
- **Evidência (objetiva)**:
  ```
  # container.resolve em routes/
  routes/permutas.ts:  25 resolves (repos + services + clients)
  routes/recebimentos.ts:  ~20 resolves
  routes/sispag.ts:  ~13 resolves
  # bloco pré-serviço em routes/recebimentos.ts:448-505 — 57 linhas de handler
  # que fazem: parse Zod, resolve TransacaoRepository, findById, validação de gerNum,
  # assertUserCanActOnFilial, resolve NumerarioAclChecker, pré-flight fail-closed,
  # e finalmente resolve o service.
  ```
- **Impacto técnico**: a regra CLAUDE.md diz "Lambda → Service → Repository → Client" e o PatternGuardian deveria enforçar. Na prática as rotas orquestram diretamente. Cada mudança de fluxo (ex.: adicionar um novo passo antes da SN) exige tocar a rota, o service E potencialmente o teste E2E — que hoje passa por `routes/recebimentos.e2e.*.test.ts` (4 suítes de 800+ LOC cada, todas com 17 falhas por fixture datada, ver Testability).
- **Impacto de negócio**: cada nova regra transversal (auth, ACL, dry-run, feature flag) espalha entre rota e serviço, aumentando a superfície de mudança e a chance de esquecer uma rota.
- **Métrica de baseline**: 10 imports de camadas puladas + 108 `container.resolve` em `routes/` (ideal ≤ 1 por handler, um `service.execute(input)`). Pré-existente. Follow-up: a regra Restrict Dependencies precisa de PatternGuardian ativo — ver `ontology/_inbox/supabase-auth-regis-followups.md` para trabalho já aberto.

### F-modifiability-4: `http/auth.ts` acumula 3 responsabilidades semânticas — `auditActor` não pertence a este arquivo

- **Severidade**: P3
- **Tactic violada**: Increase Semantic Coherence
- **Localização**: `src/backend/http/auth.ts:1-291`
- **Evidência (objetiva)**:
  - `buildAuthMiddleware` (145-229) — factory do middleware que valida JWT (identidade / JWKS+HS)
  - `requireRole` (274-291) — middleware factory de RBAC (autorização por role)
  - `auditActor` (264-265) — helper de **invariante de auditoria** (I-Usuario-1) — não é middleware, não é HTTP; é regra de persistência
  ```
  export const auditActor = (req: Request, fallback = 'unknown'): string =>
      req.user?.username ?? fallback;
  ```
  O helper depende de `Request` do Express (razão nominal para estar em `http/`), mas o que ele **enforça** é uma regra de domínio: "o ator do ledger é `username`, nunca `sub`" — descrita em `ontology/business-rules/ator-da-trilha-de-auditoria.md`.
- **Impacto técnico**: um leitor procurando "onde vive a regra da trilha de auditoria" olha em `domain/` primeiro. Encontrar em `http/auth.ts` exige leitura do teste-guarda `auditActor.guard.test.ts` para entender o motivo. Aumenta o custo cognitivo de mudar a invariante (ex.: quando I-Usuario-1 for estendido para cobrir Azure AD).
- **Impacto de negócio**: baixo, mas cumulativo: cada nova invariante colada em `http/auth.ts` polui o arquivo e mascara o dia em que ele passa a ter 4+ responsabilidades.
- **Métrica de baseline**: `http/auth.ts` = 291 LOC, 3 responsabilidades semânticas distintas. Alvo: 1 por arquivo.

### F-modifiability-5: `buildAppUserContextMiddleware` — complexidade cognitiva 27 em middleware quente

- **Severidade**: P2
- **Tactic violada**: Reduce Size of Module (dentro da função) · Split Module
- **Localização**: `src/backend/http/appUserContext.ts:135` (o `RequestHandler` retornado)
- **Evidência (objetiva)**:
  ```
  http/appUserContext.ts:135:83 lint/complexity/noExcessiveCognitiveComplexity
    ! Excessive complexity of 27 detected (max: 15).
  ```
  O handler faz, na ordem: bypass, extração de `sub`, bootstrap do container, cache lookup (com 2 saídas: 403 se `null`, 403 se `!ativo`, aplica se ok), SELECT no repository (com set do cache), 403 se `null`, se `!ativo` → `resolveInactive` (que consulta o GoTrue Admin API), decide entre `INACTIVE` ou `PENDING_INVITE`, `markConviteAceito`, reescreve cache, aplica. **6 pontos de retorno, 2 caminhos assíncronos independentes.**
- **Impacto técnico**: este é o middleware que **toda request autenticada** executa. Sua complexidade é o preço direto de um dia em que uma nova regra (ex.: ban por IP, quarentena por tentativas falhas) precisar aterrissar aqui. Já é o segundo maior warning novo introduzido pela feature.
- **Impacto de negócio**: latência de decisão pequena (SELECT + potencial chamada Admin API), mas raio de bug ampliado — este é o gate do 403 fail-closed. Um bug aqui é raio máximo.
- **Métrica de baseline**: 27 (alvo 15). **Delta novo desta feature** — ver F-9 para a leitura dos 3 warnings novos como conjunto.

### F-modifiability-6: `NEXT_PUBLIC_AUTH_PROVIDER=supabase` é cargo-cult — cria uma promessa que o código não cumpre

- **Severidade**: P2
- **Tactic violada**: Defer Binding — configuration files
- **Localização**: `src/frontend/.env.example:18` — a var é declarada com comentário explícito ("`legacy` é o rollback, e vale SEM redeploy do backend"); busca no código: **0 hits fora do próprio `.env.example`**.
- **Evidência (objetiva)**:
  ```
  $ grep -rEn "PROVIDER|authProvider|AUTH_PROVIDER" src/frontend --include="*.ts" --include="*.tsx"
  (nenhum resultado)
  ```
  A ADR-0030 §6 afirma: *"O rollback da Fase 2 é uma variável de ambiente na Vercel, sem redeploy do backend."* Isso só é verdade se a UI da rota de login **ler** essa var e ramificar entre `@supabase/ssr` (Supabase) e o form HS256 legado (backend). Nenhuma rota, nenhum componente, nenhum hook lê. Trocar de `supabase` para `legacy` na Vercel hoje não faz nada.
- **Impacto técnico**: falso senso de segurança. Se a Fase 2 quebrar em produção, o operador vai correr para virar a flag na Vercel e descobrir que a flag é ornamental. O rollback real exige revert de PR + redeploy.
- **Impacto de negócio**: um rollback que a ADR promete em ≤ 5 min (mudar env var + refresh) na verdade custa 15-30 min (revert + Vercel deploy + smoke). Sob incidente vivo, essa diferença conta.
- **Métrica de baseline**: 0 leitores da var em código. Alvo: ≥ 1, com branch testado.

### F-modifiability-7: Magic numbers de negócio em `domain/service/` (12 constantes) — cada um é um dia sem redeploy

- **Severidade**: P3
- **Tactic violada**: Defer Binding — configuration files
- **Localização**:
  - `sispag/FormacaoLotesService.ts:19` `MAX_TITULOS_POR_LOTE = 25` — regra de banco/operação
  - `sispag/SispagPainelService.ts:23` `TITULOS_CAP = 400` — teto de UI
  - `permutas/EleicaoPermutasService.ts:68-89` `PAGE_SIZE=500`, `MAX_PAGES=50`, `ADIANTAMENTOS_CONCURRENCY=10`
  - `permutas/ReconciliacaoPermutaService.ts:18,25` `CONTA_GER_JUROS=131`, `CONTA_GER_DESCONTO=130` — **contas gerenciais do ERP hardcoded**
  - `recebimentos/ProcessoProviderConexos.ts:15` `CACHE_TTL_MS = 10 * 60 * 1000`
  - `recebimentos/ImportacaoExtratoArquivoService.ts:81` `PREVIEW_AMOSTRA_MAX = 50`
- **Evidência (objetiva)**: 20 constantes numéricas em `domain/service/`; das 12 de valor de negócio, apenas o `APP_USER_CONTEXT_TTL_MS = 30_000` desta feature tem racional documentado defendendo por que **não** é env var (ver `AppUserContextCache.ts:4-15`). As outras 11 são silenciosas.
- **Impacto técnico**: se o Bradesco quiser 30 títulos por lote em vez de 25, se o CFO trocar a conta gerencial 131 por outra, ou se o Conexos ficar mais lento e o `ADIANTAMENTOS_CONCURRENCY=10` virar contra-produtivo — todos exigem PR + review + deploy. Trocar por `EnvironmentProvider` (que já existe e é Inviolable Rule #8) reduziria o binding time para "SSM/env var".
- **Impacto de negócio**: casa mal com Deployability — cada tunable é 1 janela de deploy. Frequência real dessas mudanças é baixa hoje, por isso P3, mas cresce à medida que o produto amadurece.
- **Métrica de baseline**: 12 valores de negócio hardcoded; 1 (o TTL da auth) tem racional de decisão de binding time documentado.

### F-modifiability-8: A costura SSO Azure AD do ADR-0030 é sólida na **auditoria** (via `username`), frágil no **middleware** — três acoplamentos escondidos a nomear

- **Severidade**: P3
- **Tactic violada**: Defer Binding — polymorphism / configuration
- **Localização**:
  - `src/backend/http/auth.ts:61` `const AUTHENTICATED_AUDIENCE = 'authenticated'` — audience Supabase-específico, hardcoded
  - `src/backend/http/auth.ts:159` `${authEnv.supabaseUrl}/auth/v1` — pattern de issuer Supabase-específico, derivado
  - `src/backend/http/auth.ts:176` `${issuer}/.well-known/jwks.json` — pattern JWKS Supabase-específico
  - `src/frontend/lib/supabase/client.ts:3,20` — `createBrowserClient` do `@supabase/ssr` **por nome**, sem interface intermediária
  - `src/frontend/middleware.ts` (24 LOC) — chama `updateSession` diretamente (também `@supabase/ssr`)
- **Evidência (objetiva)**: a decisão da ADR-0030 §5 e a `business-rules/ator-da-trilha-de-auditoria.md` são explícitas: **o que preserva a trilha entre IdPs é o `username` (e-mail), não a wiring do middleware**. Isso é **verdade** e é o ponto sólido. Mas a afirmação lateral "trocar de IdP sem reescrever o backend" tem duas leituras muito diferentes:
  - **Leitura A ("Supabase como gateway OIDC")**: Azure AD entra como third-party provider *dentro* do próprio Supabase Auth. Os tokens continuam vindo com `iss = ${supabaseUrl}/auth/v1` e `aud = 'authenticated'`. **Zero mudança no backend.** ✅ Claim justificada.
  - **Leitura B ("substituir Supabase por Azure AD direto")**: os tokens passam a vir com issuer e audience diferentes. É preciso mexer em `auth.ts:61,159,176`, `authEnv.ts` (novos nomes de env var), e reescrever `src/frontend/lib/supabase/*` (5 arquivos, 241 LOC — todos importam `@supabase/ssr` por nome). ❌ Claim não sustenta.
- **Impacto técnico**: se em 6 meses o cliente decidir migrar para Azure AD sob a Leitura B, o esforço não é "zero", é ~1-2 dias no backend + reescrita das 5 factories de client no frontend. A ADR deveria dizer isso — do jeito atual, quem lê §5 pode presumir A quando o cliente estava propondo B.
- **Impacto de negócio**: menor entre os findings — a Leitura A é o caminho preferencial descrito no CLAUDE.md ("SSO corporativo"), e ela **funciona**. Este achado é uma nota de precisão, não um bug.
- **Métrica de baseline**: 3 tokens Supabase-específicos no backend + 5 arquivos importando `@supabase/ssr` no frontend. Nenhuma abstração entre o app e o SDK.

### F-modifiability-9: 3 warnings novos de complexidade — 2 justificáveis, 1 é dívida nascendo

- **Severidade**: P3
- **Tactic violada**: Refactor (dívida delta)
- **Localização**:
  - `src/backend/domain/client/SupabaseAdminClient.test.ts:220` — complexidade 19 — teste de guarda (função `walk` que varre o `src/frontend` procurando `SUPABASE_SERVICE_ROLE_KEY`). **Justificado**: é um teste, e a complexidade vem da walk recursiva; simplificar acrescentaria pouco valor.
  - `src/backend/jobs/migrate-users-to-supabase.ts:56` — complexidade 17 — job one-shot, **nasce com data de morte** (Fase 4). **Justificado**: refatorar código que morre em 4 semanas é gasto negativo.
  - `src/backend/http/appUserContext.ts:135` — complexidade **27** — middleware quente, permanente. **NÃO justificado**: cabe no scope do próprio card F-modifiability-5. Ver aquele card para o split proposto.
- **Evidência (objetiva)**:
  ```
  baseline (origin/main):  35 warnings
  feat/supabase-auth:      38 warnings
  delta:                   +3 (identificados acima)
  ```
- **Impacto técnico**: dos 3 delta, 2 são aceitáveis e 1 é o middleware da autorização — o que exige o card dedicado. Baseline continua sendo o problema estrutural.
- **Impacto de negócio**: baixo por si — é o baseline que carrega o custo, não os 3 novos.
- **Métrica de baseline**: +3 warnings, 1 permanente e quente.

## 5. Cards Kanban

### [modifiability-1] Split RecebimentoNumerarioService em pipeline nomeado

- **Problema**
  > `RecebimentoNumerarioService.ts` tem 1.536 LOC, 32 métodos (2 públicos, 30 helpers privados). Cada regra nova de SN/NDe passa por leitura completa desse arquivo. Sinaliza o padrão God Service: os 30 helpers são etapas de um pipeline (parse do processo, validação de ACL, montagem do payload SN, chamada `com297`, tratamento de erro do ERP, montagem da NDe, escrita no ledger de execução). Cada uma dessas etapas tem coesão interna maior do que o conjunto — é o critério do Split Module por semântica.

- **Melhoria Proposta**
  > Aplicar **Split Module** dirigido pelo pipeline já implícito: extrair `SnPayloadAssembler`, `AclPreflightService` (que já existe parcialmente em `NumerarioAclChecker`), `NdePayloadAssembler`, `RecebimentoLedgerRecorder` como serviços @injectable dedicados. `RecebimentoNumerarioService` fica sendo o **orquestrador** (`processarAlocacao` + `classificarAlocacao`) e chama os 4 novos. Cada extração é PR incremental com o mesmo teste E2E existente por rede de segurança (as 4 suítes de `routes/recebimentos.e2e.*.test.ts`, hoje com 17 falhas por fixture datada — ver Testability).

- **Resultado Esperado**
  > `RecebimentoNumerarioService` cai para ≤ 400 LOC. Cada novo helper tem ≤ 250 LOC. p95 de LOC em `domain/service/` cai de 776 para ≤ 400.

- **Tactic alvo**: Split Module · Increase Semantic Coherence
- **Severidade**: P1
- **Esforço estimado**: L (1–2 semanas — extração incremental com testes E2E cobrindo)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - LOC de `RecebimentoNumerarioService.ts`: 1.536 → ≤ 400
  - # métodos privados: 30 → ≤ 12 no service orquestrador
  - p95 de LOC em `domain/service/`: 776 → ≤ 400
- **Risco de não fazer**: em 6 meses, cada novo requisito de NDe (regra fiscal, novo tipo de doc) acrescenta 30-80 LOC no mesmo arquivo. Chegando a ~2.000 LOC, review de PR vira leitura por amostragem — bug silencioso a jusante.
- **Dependências**: nenhuma bloqueante; depende de manter as 4 suítes E2E verdes (que hoje falham por fixture datada — ver Testability). Fazer em paralelo é aceitável.

### [modifiability-2] Refatorar as 3 funções com complexidade cognitiva ≥ 35 em serviços de Permutas

- **Problema**
  > `EleicaoPermutasService.buildCandidata` (65), `GestaoPermutasService` linha 262 (59) e `IngestaoPermutasService` linha 408 (43) concentram 4-5 decisões cada num único lambda. `buildCandidata` orquestra hidratação de detalhe, `ConexosError` handling, avaliação de elegibilidade E roteamento cliente-filtro — cada uma é candidata a extração.

- **Melhoria Proposta**
  > Aplicar **Refactor** em cada uma: extrair helpers privados nomeados por decisão (ex.: `hydrateDetalhe`, `avaliarERotear`, `mapearParaCandidata`). Preservar a semântica com testes de caracterização existentes.

- **Resultado Esperado**
  > Nenhuma função `> 25` de complexidade cognitiva em `domain/service/permutas/`. Warnings do Biome caem para ≤ 25.

- **Tactic alvo**: Refactor
- **Severidade**: P1
- **Esforço estimado**: M (2–5 dias)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Complexidade cognitiva máxima em `domain/service/permutas/`: 65 → ≤ 25
  - # warnings `noExcessiveCognitiveComplexity` em `domain/service/permutas/`: 12 → ≤ 5
- **Risco de não fazer**: a próxima regra de elegibilidade cai numa função de complexidade 65 que já passa dos limites do que review de PR captura. Regressão silenciosa mensurável.
- **Dependências**: nenhuma.

### [modifiability-3] Extrair a orquestração de rotas para serviços de aplicação — Restrict Dependencies real

- **Problema**
  > `routes/permutas.ts`, `routes/recebimentos.ts` e `routes/sispag.ts` importam repositórios e clients diretamente e fazem `container.resolve` de repositórios dentro do handler (58 vezes em 3 arquivos). O handler de `routes/recebimentos.ts:448` tem 90 linhas com resolução de `TransacaoRepository`, `NumerarioAclChecker`, `EnvironmentProvider` e o service final — pilha inteira do domínio orquestrada na rota. A regra CLAUDE.md "Lambda → Service → Repository → Client" está declarada mas não é executada nem policiada pelo PatternGuardian.

- **Melhoria Proposta**
  > Introduzir **Application Services** (um por rota gorda) que encapsulem a orquestração: `IniciarSolicitacaoNumerarioAppService`, `PermutarAppService`, `CriarLoteSispagAppService`. Rota fica com parse Zod + `service.execute(input)` + tradução de erro. Aplicar **Restrict Dependencies** removendo `import Repository from '../domain/repository/*'` de `routes/`.

- **Resultado Esperado**
  > Rota média em `routes/`: 347 LOC → ≤ 200. `container.resolve` em `routes/`: 108 → ≤ 15 (só service + interpreter de erro).

- **Tactic alvo**: Restrict Dependencies · Encapsulate · Increase Semantic Coherence
- **Severidade**: P2
- **Esforço estimado**: L (1–2 semanas por frente — 3 frentes)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - # imports layer-skipping em `routes/`: 10 → 0
  - # `container.resolve` em `routes/permutas.ts`: 25 → ≤ 5
  - Média LOC em `routes/`: 347 → ≤ 200
- **Risco de não fazer**: qualquer regra transversal (nova ACL, nova auditoria, dry-run global) que hoje toca `appUserContext` + rota + serviço passa a exigir tocar as 3 rotas + os N services. Custo de mudança cresce N×.
- **Dependências**: PatternGuardian precisa de regra que impeça `routes/` de importar `repository/` ou `client/`. Follow-up já aberto — ver `ontology/_inbox/supabase-auth-regis-followups.md`.

### [modifiability-4] Mover `auditActor` para o domínio da auditoria; deixar `http/auth.ts` com o que é HTTP

- **Problema**
  > `http/auth.ts` (291 LOC) tem três responsabilidades semanticamente distintas: middleware factory de JWT (identidade), `requireRole` (RBAC HTTP) e `auditActor` (regra de persistência da trilha, I-Usuario-1). O último não é HTTP: é uma invariante de persistência que o resto do domínio consome. Está aqui só porque a assinatura recebe `Request`.

- **Melhoria Proposta**
  > Aplicar **Increase Semantic Coherence**: mover `auditActor` para `domain/libs/audit/auditActor.ts` (ou `domain/service/audit/`), com a mesma assinatura e o mesmo teste-guarda `auditActor.guard.test.ts` (o teste hoje varre `routes/` — a assertion é sobre a superfície, não sobre a localização do helper). Adicionalmente, alinhar o `impl_files` de `business-rules/ator-da-trilha-de-auditoria.md` para o novo local.

- **Resultado Esperado**
  > `http/auth.ts` sob 250 LOC, com apenas as duas responsabilidades HTTP restantes. Regra de auditoria encontrável em `domain/` na primeira busca.

- **Tactic alvo**: Increase Semantic Coherence · Split Module
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d — refactor puro, 28 imports para atualizar via IDE)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - `http/auth.ts` LOC: 291 → ≤ 250
  - # arquivos com "regra de auditoria" ambigua: 1 → 0
- **Risco de não fazer**: baixo isolado; cumulativo — o dia em que I-Usuario-1 for estendido para cobrir SSO Azure AD, o próximo autor cola a extensão no mesmo lugar e a mistura cresce.
- **Dependências**: nenhuma.

### [modifiability-5] Split de `buildAppUserContextMiddleware` em decisões nomeadas

- **Problema**
  > O middleware retornado por `buildAppUserContextMiddleware` (`http/appUserContext.ts:135`) tem complexidade cognitiva 27 e concentra: bypass, cache lookup com 2 saídas 403, SELECT, decisão de convite pendente vs revogado, chamada Admin API, reescrita de cache. É o middleware que **toda request autenticada** executa — raio máximo. É também um dos 3 warnings novos que a feature adicionou.

- **Melhoria Proposta**
  > Extrair 3 helpers privados dentro do mesmo módulo (o middleware pode permanecer factory): `respondFromCache(cached, req, res)` (retorna `'served' | 'forbid' | 'miss'`), `loadAndDecide(sub, repository, cache)` (retorna a mesma união com o contexto) e `handleInactive` (já existe parcialmente em `resolveInactive`). O handler top-level fica com o fluxo: bypass → sub? → cache → load → apply.

- **Resultado Esperado**
  > Complexidade cognitiva do middleware retornado ≤ 15. 3 warnings novos passam a 2.

- **Tactic alvo**: Split Module (dentro do arquivo)
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d — testes existentes em `appUserContext.test.ts` cobrem)
- **Findings relacionados**: F-modifiability-5, F-modifiability-9
- **Métricas de sucesso**:
  - Complexidade cognitiva de `http/appUserContext.ts:135`: 27 → ≤ 15
  - # warnings backend: 38 → 37
- **Risco de não fazer**: o próximo requisito (ex.: rate-limit por usuário, ban por IP, quarentena) cai neste mesmo lambda. Complexidade 27 vira 40+ silenciosamente.
- **Dependências**: nenhuma. Testes de contrato em `appUserContext.test.ts` (415 LOC) e `middlewareWiring.test.ts` protegem a semântica.

### [modifiability-6] Ligar de verdade o `NEXT_PUBLIC_AUTH_PROVIDER` — ou removê-lo

- **Problema**
  > `.env.example:18` declara `NEXT_PUBLIC_AUTH_PROVIDER=supabase` com comentário explícito ("`legacy` é o rollback, e vale SEM redeploy do backend"). Grep no `src/frontend/**/*.{ts,tsx}` retorna **zero** hits. A ADR-0030 §6 promete rollback da Fase 2 pela Vercel; o código não cumpre. Sob incidente, virar a flag na Vercel não faz nada.

- **Melhoria Proposta**
  > Duas alternativas honestas:
  > **A (defender a promessa)**: criar `src/frontend/lib/auth/provider.ts` que lê `process.env.NEXT_PUBLIC_AUTH_PROVIDER` e exporta uma união `type AuthProvider = 'supabase' | 'legacy'`. A rota de login (`app/login/page.tsx` — verificar caminho real) ramifica entre form Supabase (via `@supabase/ssr`) e form HS256 (via `NEXT_PUBLIC_API_URL/auth/login`). Adicionar teste E2E que fixa a flag em `legacy` e verifica o POST no backend.
  > **B (honestidade)**: remover a linha do `.env.example` e mudar a ADR-0030 §6 para dizer que rollback da Fase 2 é revert de PR + Vercel redeploy (custo real ~15 min).
  > Preferência: **A** (mantém o binding time prometido, casa com a promessa da ADR). Aplicar **Defer Binding — configuration files**.

- **Resultado Esperado**
  > `NEXT_PUBLIC_AUTH_PROVIDER=legacy` na Vercel + refresh reverte a UI para o form HS256 sem redeploy nem revert. Ou a promessa é retirada, e o custo real fica documentado.

- **Tactic alvo**: Defer Binding — configuration files
- **Severidade**: P2
- **Esforço estimado**: M (2–3d na alternativa A; S na B)
- **Findings relacionados**: F-modifiability-6
- **Métricas de sucesso**:
  - # leitores de `NEXT_PUBLIC_AUTH_PROVIDER` em código FE: 0 → ≥ 1 (alternativa A)
  - Tempo real de rollback Fase 2: ~20 min → ≤ 3 min (alternativa A)
- **Risco de não fazer**: sob incidente vivo na Fase 2, o operador segue o playbook da ADR e descobre o gap às 3h da manhã. Custo direto: horas extras + eventual perda de janela de retenção da sessão dos usuários.
- **Dependências**: nenhuma técnica; decisão de produto (A vs B).

### [modifiability-7] Externalizar as 3 constantes de negócio mais susceptíveis a mudança

- **Problema**
  > 12 valores de negócio hardcoded em `domain/service/` (ver F-7). Três são particularmente susceptíveis a mudança operacional: `MAX_TITULOS_POR_LOTE=25` (regra Bradesco/Nexxera pode mudar), `CONTA_GER_JUROS=131` / `CONTA_GER_DESCONTO=130` (contas gerenciais do plano do cliente, muito comuns de mudarem em virada de ano contábil). Cada mudança dessas hoje = PR + review + deploy.

- **Melhoria Proposta**
  > Movê-las para `EnvironmentProvider` como campos tipados (`sispagMaxTitulosLote`, `contaGerJuros`, `contaGerDesconto`), lidos via SSM em produção. Aplicar **Defer Binding — configuration files**. Não mexer nas outras 9 constantes nesta rodada (custo/benefício ruim).

- **Resultado Esperado**
  > Mudar a conta gerencial de juros: `render.yaml` env var + restart (segundos) em vez de PR + deploy (dezenas de minutos).

- **Tactic alvo**: Defer Binding — configuration files
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-modifiability-7
- **Métricas de sucesso**:
  - # constantes numéricas de negócio hardcoded em `domain/service/`: 12 → ≤ 9
  - Tempo real para trocar `MAX_TITULOS_POR_LOTE`: ~30 min (deploy) → ≤ 5 min (env var + restart)
- **Risco de não fazer**: quando o cliente mudar o plano de contas em 01/2027, cada mudança vira 1 janela de deploy. Interseção direta com Deployability.
- **Dependências**: nenhuma. `EnvironmentProvider` já é o veículo canônico (Inviolable Rule #8).

## 6. Notas do agente

- **Cross-QA (para o consolidator):**
  - **F-modifiability-1/2 ↔ Testability**: as 4 suítes `routes/recebimentos.e2e.*` (17 falhas persistentes por fixture datada — verificado no shared-metrics como pré-existente) são o teste de caracterização que qualquer Split Module do `RecebimentoNumerarioService` precisa. Split sem essa rede verde é aposta.
  - **F-modifiability-3 ↔ Integrability**: Restrict Dependencies real depende do PatternGuardian, já em follow-up.
  - **F-modifiability-6/7 ↔ Deployability**: cada magic number e cada flag ornamental é uma janela de deploy sob incidente. `NEXT_PUBLIC_AUTH_PROVIDER` é o pior deles porque a ADR já promete "sem redeploy" — a modifiability aqui está travada num redeploy invisível.
  - **F-modifiability-4 ↔ Security**: mover `auditActor` para `domain/` **não** enfraquece o teste-guarda `auditActor.guard.test.ts` (a assertion varre `routes/`, é sobre superfície). Confirmar com o QA de Security se enxergar risco.
  - **F-modifiability-8 ↔ Integrability**: o dia de trocar de IdP é problema dos dois QAs.
- **Escolha de escopo**: não abri card contra o `filialAuthz` fail-OPEN (achado #1 da tabela "já conhecidos") — é carry-over e reportá-lo aqui infla o report.
- **Escolha de escopo**: incluí F-modifiability-8 como P3 porque a claim da ADR **é** defensível na leitura preferencial (Supabase como gateway OIDC). O achado é uma nota de precisão para que a próxima releitura da ADR entenda qual dos dois caminhos ela cobre.
- **Métrica não coletada**: dependências circulares. `madge` não está instalado; amostragem manual sobre 5 services do `permutas` não encontrou ciclo, mas a amostra é pequena. Recomendação: adicionar `madge --circular src/backend` ao pipeline de gates — 1 comando, 1 min.
