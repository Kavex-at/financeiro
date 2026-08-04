---
qa: Security
qa_slug: security
run_id: 2026-07-29-0243-recebimentos-sn
agent: qa-security
generated_at: 2026-07-29T02:43:00Z
scope: all
score: 8
findings_count: 6
cards_count: 6
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista autenticado (Supabase JWT) da filial X | Tenta gerar uma Solicitação de Numerário (encomenda) em processo de importação da filial Y, mudando `filCod` no body ou usando `role != admin` | `POST /recebimentos/transacoes/:txnId/solicitacao-numerario` (SN dry-run) + `GET /recebimentos/transacoes/:txnId/processos` | Produção, feature flag ligada, sem seam de envio ao ERP alcançável (`enviarAoErp` lança `NotImplementedError`) | Rejeitar com 401/403; nada é enviado ao Conexos; tentativa registrada em log de aviso do middleware | 0% de payloads SN construídos para `filCod` fora da allow-list do usuário; 0% de rotas write-ish sem `requireRole('admin')` + `heavyRouteLimiter` + `assertUserCanActOnFilial`; 0 caminhos de escrita ERP alcançáveis nesta iteração |

Feature nasce em cenário DRY-RUN — o payload é construído e devolvido, mas o seam `SolicitacaoNumerarioService.enviarAoErp` (`src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:117-121`) lança `NotImplementedError`, que junto com a ausência de call-site é a segunda camada da defesa: mesmo se authz falhar, não há code path que empurre bytes ao Conexos até HAR confirmar `gcdCod`.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded nos arquivos SN | 0 | 0 | ✅ | `grep -rnE "(password\|secret\|token\|api[_-]?key\|credential)\s*[:=]\s*['\"][^'\"]{8,}"` em SolicitacaoNumerarioService.ts, GerDocProcesso.ts, recebimentos.ts |
| Uso de `process.env` cru no backend SN | 0 | 0 | ✅ | `grep -rn "process\.env" src/backend/domain/service/recebimentos …` |
| Rotas write-ish SN com `requireRole('admin')` | 1/1 (SN) + 1/1 (pipeline/run) | 100% | ✅ | `src/backend/routes/recebimentos.ts:58,202` |
| Rotas SN com Zod safeParse no boundary | 3/3 (painel N/A, GET :txnId/processos, POST SN) | 100% | ✅ | `src/backend/routes/recebimentos.ts:61,157,205` (`listCandidatosQuerySchema`, `gerarSolicitacaoNumerarioSchema`, `runPipelineSchema`) |
| Rotas write-ish SN com `assertUserCanActOnFilial` | 2/2 | 100% | ✅ | `src/backend/routes/recebimentos.ts:70,163,211` |
| Rotas write-ish SN com `heavyRouteLimiter` | 2/2 | 100% | ✅ | `src/backend/routes/recebimentos.ts:57,201` |
| SQL cru introduzido pela feature SN | 0 | 0 | ✅ | feature usa `ProcessoProviderStub` in-memory (sem repo Postgres) |
| `dangerouslySetInnerHTML` no frontend SN | 0 | 0 | ✅ | `grep -rn "dangerouslySetInnerHTML\|innerHTML" src/frontend/app/recebimentos src/frontend/lib/recebimentos.ts` |
| Testes que exercem `requireRole` (403 de não-admin) na rota SN | 0/1 | 1/1 | ❌ | `src/backend/routes/recebimentos.test.ts:234-287` — cobre `filCod` cross-filial e Zod, não cobre `role='user'` (checa `requireRole('admin')`) |
| Testes que exercem `filial cross-filial` (403) na rota SN | 1/1 | 1/1 | ✅ | `src/backend/routes/recebimentos.test.ts:260-273` |
| `filiais` claim provisionado no JWT Supabase hoje | não | sim | ⚠️ | `src/backend/http/filialAuthz.ts:14-18` docstring — guard é "backwards-compatible" (user sem claim passa); documentado como seam pendente |
| Backend `npm audit` (crit / high / mod / low) | 0 / 3 / 2 / 2 | 0 / 0 / ≤5 / — | ⚠️ | `cd src/backend && npm audit --json` — 3 high (axios <1.18.0), 2 moderate |
| Frontend `npm audit` (crit / high / mod / low) | 0 / 6 / 0 / 1 | 0 / 0 / ≤5 / — | ⚠️ | `cd src/frontend && npm audit --json` |
| Log SN contém segredo / CNPJ / valor bruto sensível? | dado exposto: `priCod`, `filCod`, `gcdDesNome`, `ator` (`sub`/`email`) | não expor `email` do usuário em log de negócio; usar `sub` | ⚠️ | `SolicitacaoNumerarioService.ts:97-107` — `ator` cai como `req.user?.sub ?? req.user?.email` (route l.219, l.81), então quando `sub` está presente o log carrega apenas o id opaco; se `sub` faltasse (não deve, `toAuthUser` exige), cairia o email |

> ⚠️ **Não medível localmente (produção-only)**: taxa de tentativas rejeitadas por `assertUserCanActOnFilial` no ambiente real; alarme de authn falha; presença do claim `permissions.filiais` no token Supabase emitido em produção. Requer CloudWatch/Supabase logs. Recomendação: métrica CloudWatch `RecebimentosAuthzDenied` incrementada em cada `FilialForbiddenError` e alarme threshold > N/min.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | `[auth]` warn no rejeitar token + `[auth] forbidden` warn no `requireRole`; sem agregação/alarme | ⚠️ parcial | `src/backend/http/auth.ts:189-194,214-217` |
| Detect Service Denial | `heavyRouteLimiter` (10 req/min/IP) aplicado na rota SN | ✅ presente | `src/backend/routes/recebimentos.ts:57,201`; `src/backend/http/rateLimit.ts:28-35` |
| Verify Message Integrity | Zod `safeParse` no boundary + `idempotencyKey` namespaced pelo `sub` do usuário (evita colisão / carona) | ✅ presente | `recebimentos.ts:61,157,205`; namespacing `receb:${ator}:…` `recebimentos.ts:86` |
| Detect Message Delay | N/A — feature síncrona request/response, sem fila/timing constraints | N/A | — |
| Identify Actors | Middleware `buildAuthMiddleware` popula `req.user` com `sub`/`email`/`role`/`filiais` a partir do JWT Supabase | ✅ presente | `src/backend/http/auth.ts:117-196` |
| Authenticate Actors | Verificação JWT via `jose` — HS256 (secret) OU JWKS assimétrico, `audience: 'authenticated'`, `issuer: ${SUPABASE_URL}/auth/v1` | ✅ presente | `src/backend/http/auth.ts:158-175` |
| Authorize Actors | RBAC via `requireRole('admin')` + authz por-filial via `assertUserCanActOnFilial` — aplicados na SN write-ish; leitura autenticada mas sem `requireRole` | ✅ presente | `recebimentos.ts:58,70,202,211`; `filialAuthz.ts:53-60` |
| Limit Access | Rate-limit `heavyRouteLimiter` (10 req/min/IP) na SN e no pipeline/run | ✅ presente | `recebimentos.ts:57,201` |
| Limit Exposure | Seam `enviarAoErp` desenhado como `NotImplementedError` — não existe caminho de escrita alcançável ao Conexos nesta iteração; blast-radius = "log local + resposta ao usuário" | ✅ presente | `SolicitacaoNumerarioService.ts:117-121`; `NotImplementedError.ts:1-27` |
| Encrypt Data | TLS termination fora do escopo desta rota (Render); JWT verificado com secret/JWKS; nenhum PII criptografado at-rest pela feature (não persiste) | ⚠️ parcial | fora do delta (herdado da plataforma) |
| Separate Entities | DI via tsyringe — `SolicitacaoNumerarioService @injectable`, `ProcessoProviderInterface` atrás de `PROCESSO_PROVIDER_TOKEN` (swappable, não vaza acesso ao Conexos) | ✅ presente | `SolicitacaoNumerarioService.ts:43-48`; `recebimentosContainer.ts` + `ports.ts` |
| Change Default Settings | `DEV_AUTH_BYPASS` é opt-in explícito com warn no boot; `filiais` claim exige provisão explícita para restringir | ✅ presente | `src/backend/http/auth.ts:122-130` |
| Validate Input | Zod `safeParse` em todos os 3 endpoints touched (`runPipelineSchema`, `listCandidatosQuerySchema`, `gerarSolicitacaoNumerarioSchema`) — falha vira 400 antes do service | ✅ presente | `recebimentos.ts:42-51,143-146,181-190` |
| Revoke Access | Herdado do Supabase (revogação de token/usuário na plataforma); feature não persiste sessão própria | ⚠️ parcial | fora do delta |
| Lock Computer | N/A — não aplicável a sessão web SaaSo | N/A | — |
| Inform Actors | Resposta 403 traz `code: 'FILIAL_NAO_AUTORIZADA'` (frontend/analista) + warn no stderr (op) | ✅ presente | `recebimentos.ts:73-77,166,213-215` |
| Audit Trail | `logService.info` `type: 'BUSINESS_INFO'` no dry-run (write-only stdout — Render/CloudWatch); NÃO persiste em tabela `audit_log` (não há repo tocado nesta feature) | ⚠️ parcial | `SolicitacaoNumerarioService.ts:97-107` — audit "log-line-only", não queryable |
| Restore | N/A — feature não muta estado (dry-run puro); nada a restaurar | N/A | — |

## 4. Findings (achados)

### F-security-1: Rota SN não tem teste que exerce `requireRole('admin')` (não-admin → 403)

- **Severidade**: P2 (médio — proteção presente mas sem regression-test)
- **Tactic violada**: Authorize Actors (cobertura de teste)
- **Localização**: `src/backend/routes/recebimentos.test.ts:234-287`
- **Evidência (objetiva)**:
  ```
  # grep -n "role: 'user'.*solicitacao\|forbidden.*sn" src/backend/routes/recebimentos.test.ts
  (sem resultado)
  # 3 it() no describe SN cobrem: 200 dry-run OK, 403 cross-filial, 400 Zod. Não há it("403 quando role != admin").
  ```
- **Impacto técnico**: se alguém remover acidentalmente o `requireRole('admin')` da linha `recebimentos.ts:202` ao refatorar (ex.: mesclar middlewares), o suite fica verde e a rota vira aberta para qualquer autenticado.
- **Impacto de negócio**: a rota é write-ish (constrói payload de SN, aciona `LogService`). Regressão silenciosa da ACL admin abaixa a barra da defesa em profundidade — o `assertUserCanActOnFilial` continua vetando, mas a promessa "só admin gera SN" fica sem garantia mecânica.
- **Métrica de baseline**: 0/1 test cases cobrindo `requireRole` na rota SN (vs. 1/1 no GET candidatos, que testa `role: 'user'` fora do admin gate — mas o GET não tem `requireRole`).

### F-security-2: Log de negócio da SN inclui `ator` que pode ser email do usuário

- **Severidade**: P2 (médio — LGPD/PII em log-line, dry-run só)
- **Tactic violada**: Limit Exposure / Encrypt Data (redaction em log)
- **Localização**: `src/backend/routes/recebimentos.ts:219` + `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:97-107`
- **Evidência (objetiva)**:
  ```ts
  // recebimentos.ts:219
  const ator = req.user?.sub ?? req.user?.email ?? 'unknown';
  // SolicitacaoNumerarioService.ts:97-107
  void this.logService.info({ type: 'BUSINESS_INFO', message: 'gerarSolicitacaoNumerario …',
      data: { dryRun: true, priCod, filCod, gcdDesNome, ator } });
  ```
- **Impacto técnico**: se por qualquer razão `req.user.sub` não estiver presente (bug futuro no middleware) o log passa a persistir email no stdout — que Render/CloudWatch coleta sem redaction.
- **Impacto de negócio**: emails de analistas viram PII em logs de produção sem gate LGPD; auditoria posterior confunde "id opaco" com "identidade" e vira um vetor de scraping se logs vazarem.
- **Métrica de baseline**: `SolicitacaoNumerarioService.ts:105` inclui campo `ator` no `data:`; hoje `toAuthUser` (auth.ts:61-73) requer `sub`, mas o fallback existe pela via da rota.

### F-security-3: Audit trail da SN é "log-line only" (não persistido em tabela auditável)

- **Severidade**: P2 (médio — proposal exige audit persistido em toda ação; SN é dry-run e o custo hoje é baixo, mas o débito precisa ficar visível para quando `enviarAoErp` for cabeado)
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:97-107`
- **Evidência (objetiva)**: `logService.info(...)` grava JSON no `process.stdout` (`src/backend/domain/service/LogService.ts:26`). Não há `INSERT INTO audit_log`, não há tabela dedicada, não há retentor queryable — apenas o stream de logs da plataforma.
- **Impacto técnico**: se o Render/CloudWatch rotar/expirar antes de 90/180 dias, a evidência "quem gerou qual SN e quando" some. A proposta Kavex de "auditoria persistida em toda ação" (CLAUDE.md §Frente IV; ontology `gerar-solicitacao-numerario.md`) fica não-atendida.
- **Impacto de negócio**: quando `enviarAoErp` sair do `NotImplementedError` e virar POST real ao Conexos, essa dívida vira P0 imediato — sem tabela `audit_log`, a Columbia não consegue provar quem disparou uma SN de R$ X para o processo Y. Corrigir agora (com dry-run) é 10× mais barato que depois.
- **Métrica de baseline**: 0 tabelas de audit persistida tocadas pela feature; 1 log-line stdout por dry-run.

### F-security-4: `filiais` claim ainda não provisionado — allow-list ausente → guard passa

- **Severidade**: P1 (alto — a defesa "cross-filial" só funciona 100% quando o claim existe; hoje é backwards-compat)
- **Tactic violada**: Authorize Actors
- **Localização**: `src/backend/http/filialAuthz.ts:14-18,45-50`
- **Evidência (objetiva)**:
  ```ts
  // filialAuthz.ts:45-50
  export const userCanActOnFilial = (user, filCod) => {
      if (!user) return false;
      const permitidas = filiaisPermitidas(user);
      if (permitidas === undefined) return true; // ← seam: sem claim, libera
      return permitidas.includes(filCod);
  };
  ```
  Docstring reconhece: "current Supabase JWT only carries `sub`/`email`/`role` — there is NO per-filial claim yet".
- **Impacto técnico**: em produção, hoje, um `admin` de qualquer filial pode gerar SN de qualquer outra — a defesa que o Regis security-1 mandou colocar existe estruturalmente, mas está desarmada até o claim ser cabeado no Supabase (JWT custom claim) ou por table `app_user_filial`.
- **Impacto de negócio**: multi-tenant / multi-filial promise fica em "fingerprint-only". Um analista de SP cria SN em MG sem receber 403. Baixo-risco enquanto for dry-run; alto quando `enviarAoErp` for cabeado — mas o vetor já está aberto agora para *qualquer* rota write-ish.
- **Métrica de baseline**: 0 tokens Supabase carregando o claim `filiais` ou `permissions.filiais` hoje (verificar em `authEnv.ts` / produção — não medível localmente); 100% dos usuários caem no ramo "sem claim → true".

### F-security-5: Backend `npm audit` — 3 high (axios <1.18.0) + 2 moderate

- **Severidade**: P1 (alto — vulnerabilidades known-CVE em runtime deps)
- **Tactic violada**: Limit Exposure (dependência com CVE)
- **Localização**: `src/backend/package.json` — `axios` em versão vulnerável
- **Evidência (objetiva)**:
  ```
  BACKEND: {'info': 0, 'low': 2, 'moderate': 2, 'high': 3, 'critical': 0, 'total': 7}
  Advisories: GHSA-42h9-826w-cgv3 (DoS recursion), GHSA-xj6q-8x83-jv6g (prototype pollution auth), GHSA-pmv8-rq9r-6j72 (DoS recursion) — range >=1.0.0 <1.18.0
  ```
- **Impacto técnico**: `axios` é usado por `BcbClient` e (futuramente) pelo cliente Conexos — vetor de DoS por payload malformado ou prototype pollution em auth subfields.
- **Impacto de negócio**: exposição da API a exhaustion attack via cliente HTTP (backend faz retry/poll com axios). Feature SN não usa axios diretamente hoje (só stub in-memory) — dívida herdada, não introduzida — mas é obrigação da review sinalizar antes que a feature seja cabeada ao Conexos via axios.
- **Métrica de baseline**: 3 high + 2 moderate no backend (bar do gate: `high ≤ 0`).

### F-security-6: Frontend `npm audit` — 6 high

- **Severidade**: P1 (alto — dependências web-facing com CVE)
- **Tactic violada**: Limit Exposure
- **Localização**: `src/frontend/package.json`
- **Evidência (objetiva)**:
  ```
  FRONTEND: {'info': 0, 'low': 1, 'moderate': 0, 'high': 6, 'critical': 0, 'total': 7}
  ```
- **Impacto técnico**: pacotes web-facing com CVE high — potencial XSS/prototype pollution/SSRF dependendo do package (necessita `npm audit --json` full para triagem). Feature SN acrescenta apenas componentes React shadcn + `apiFetch`; não introduz dep nova.
- **Impacto de negócio**: dívida herdada mas material — frontend serve o painel de conciliação (money-adjacent). Card documenta que a feature entra num campo com dívida transversal.
- **Métrica de baseline**: 6 high + 1 low no frontend (bar do gate: `high ≤ 0`).

## 5. Cards Kanban

### [security-1] Adicionar teste de regressão `role != admin` para POST SN

- **Problema**
  > A rota `POST /recebimentos/transacoes/:txnId/solicitacao-numerario` aplica `requireRole('admin')` (`recebimentos.ts:202`), mas o teste `recebimentos.test.ts:234-287` não cobre o caminho `role: 'user' → 403`. Uma remoção acidental do middleware ao refatorar não é pega pelo suite atual (740/740 green).
- **Melhoria Proposta**
  > Adicionar `it('403 when role is not admin')` no describe de SN, montando `buildApp({ sub: 'u', role: 'user', filiais: [4] })` e postando `snPayload()`. Espera `res.status === 403`. Mesmo padrão do teste `role: 'user'` já usado no pipeline/run (`recebimentos.test.ts:196-207`).
- **Resultado Esperado**
  > 1 novo test case verde exercendo `requireRole('admin')` na SN — remove a possibilidade de regressão silenciosa.

- **Tactic alvo**: Authorize Actors
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Test cases cobrindo `requireRole` na SN: 0/1 → 1/1
  - Suite: 740 → 741 passes
- **Risco de não fazer**: 6 meses depois, ao unificar middlewares recebimentos+sispag, alguém encapsula `requireRole` num factory e esquece de aplicá-lo à SN — o suite fica verde e a rota vira aberta a qualquer usuário autenticado.
- **Dependências**: nenhuma

### [security-2] Redigir campo `ator` no log de negócio da SN (nunca vazar email)

- **Problema**
  > `SolicitacaoNumerarioService.ts:97-107` loga `data: { …, ator }` onde `ator = req.user?.sub ?? req.user?.email ?? 'unknown'` (`recebimentos.ts:219`). Hoje `sub` é sempre presente (garantido por `toAuthUser` em `auth.ts:61-73`), mas o fallback pela via da rota abre porta para email cair em log estruturado — que Render/CloudWatch coleta sem redaction.
- **Melhoria Proposta**
  > Trocar a resolução do `ator` para sempre um id opaco (`req.user?.sub`) e rejeitar (500) quando `sub` faltar. Se `email` for útil para operação, gravar em campo separado `actorEmailHash` (SHA-256 truncado) ou emitir só no log de auth, não no log de negócio. Alternativa mais barata: remover `ator` do `data:` do `logService.info` e deixar o middleware de auth ser a única fonte de identidade.
- **Resultado Esperado**
  > Log-line de `gerarSolicitacaoNumerario` nunca carrega email do analista. LGPD: email não é PII persistida sem controle.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Campos com email cru no log de negócio SN: 1 → 0
  - Teste que asserte `expect(logCall.data.ator).not.toMatch(/@/)`: 0 → 1
- **Risco de não fazer**: log rotation de 90 dias em Render/CloudWatch acumula emails de analistas em plain-text — vetor para scraping se logs vazarem, e não-conformidade com controle LGPD de dados de colaboradores.
- **Dependências**: nenhuma

### [security-3] Provisionar tabela `audit_log` (append-only) e persistir a SN dry-run nela

- **Problema**
  > A ação `gerarSolicitacaoNumerario` (mesmo em dry-run) é observada apenas via `logService.info` → stdout (`SolicitacaoNumerarioService.ts:97-107` + `LogService.ts:26`). Não há tabela persistida queryable. A proposta Kavex e a ontology (`gerar-solicitacao-numerario.md`) exigem audit persistido em toda ação — enquanto o volume ainda é dry-run, o custo de criar a estrutura é baixo. Quando `enviarAoErp` sair do `NotImplementedError`, essa dívida vira P0.
- **Melhoria Proposta**
  > Provisionar tabela `audit_log(id, action, entity, entity_id, actor_sub, filCod, payload_hash, occurred_at)` e um `AuditLogRepository` (SQL parametrizado, sem valores brutos — só hash). Injetar no `SolicitacaoNumerarioService` e chamar `.append()` antes do `return`. Espelhar padrão da Frente II (SISPAG) que já tem `sispag_audit` (se ainda não tem, criar juntas, um só schema).
- **Resultado Esperado**
  > Toda geração de SN (dry-run e futura real) fica queryable: `SELECT * FROM audit_log WHERE entity='solicitacao_numerario' AND actor_sub=$1 AND occurred_at BETWEEN $2 AND $3`.

- **Tactic alvo**: Audit Trail
- **Severidade**: P2 (P0 quando `enviarAoErp` for cabeado)
- **Esforço estimado**: M
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Ações SN persistidas em `audit_log`: 0 → 100%
  - Query `SELECT COUNT(*) FROM audit_log WHERE action='gerar_solicitacao_numerario'` retorna valor coerente com contagem de POSTs no CloudWatch
- **Risco de não fazer**: no dia em que a Columbia pedir "quem gerou a SN X do processo Y em 3 meses atrás", a única evidência é log-line rotado — resposta "não sei". Compliance + reputação da automação em risco.
- **Dependências**: alinhar schema com Fault Tolerance (audit overlap) e com o time do SISPAG (mesma tabela).

### [security-4] Provisionar claim `permissions.filiais` no JWT Supabase e travar guard

- **Problema**
  > `filialAuthz.ts:45-50` é backwards-compatible: se o token não tem `filiais` claim, o guard passa (`return true`). Isso é intencional (docstring), mas em produção HOJE nenhum token traz o claim — então a defesa "cross-filial" da SN e do pipeline/run é uma promessa não-materializada. Um `admin` de SP hoje faz POST SN com `filCod: 9` (MG) e recebe 200.
- **Melhoria Proposta**
  > Duas frentes complementares: (1) Emitir claim `permissions.filiais: number[]` no JWT Supabase via Edge Function `on_login` (lê `app_user_filial`); (2) Mudar `filialAuthz.ts:47` para `if (permitidas === undefined) return false` (deny-by-default) ASSIM QUE todos os tokens ativos carregarem o claim (rollout coordenado). Ontology follow-up já registra em `_inbox/frente-iv-recebimentos-nde-plan.md`.
- **Resultado Esperado**
  > Chamada com `filCod` fora da allow-list do usuário retorna 403 em 100% dos casos. Métrica CloudWatch `RecebimentosAuthzDenied` incrementa.

- **Tactic alvo**: Authorize Actors
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - Tokens Supabase com claim `filiais`: 0% → 100%
  - `userCanActOnFilial(user_sem_claim, X)`: `true` → `false` (após deny-by-default)
- **Risco de não fazer**: quando `enviarAoErp` sair do `NotImplementedError`, um analista de SP posta SN de MG e move dinheiro real — o guard existe estruturalmente mas nunca dispara. Overlap direto com o cenário multi-tenant do Bass (blast radius).
- **Dependências**: alinhamento com plataforma Supabase (custom claim setup) e com tabela `app_user_filial`.

### [security-5] Atualizar `axios` para ≥1.18.0 (backend) — fecha 3 CVE high

- **Problema**
  > `npm audit` no backend reporta 3 high + 2 moderate no `axios` (range `>=1.0.0 <1.18.0`) — GHSA-42h9-826w-cgv3, GHSA-xj6q-8x83-jv6g (prototype pollution auth), GHSA-pmv8-rq9r-6j72. Feature SN não usa axios diretamente (stub in-memory), mas o `BcbClient` sim e o futuro cliente Conexos (quando `enviarAoErp` for cabeado) também dependerá.
- **Melhoria Proposta**
  > `npm install axios@^1.18.0` (ou latest LTS) em `src/backend/`, rodar `npm audit fix`, revalidar `npm test` e `npm run typecheck`. Se o bump quebrar `BcbClient`, seguir migration guide (mudanças de tipos em interceptors).
- **Resultado Esperado**
  > `npm audit --json` no backend: `high: 3 → 0`.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-security-5
- **Métricas de sucesso**:
  - Backend `high` vulns: 3 → 0
  - Backend `moderate` vulns: 2 → 0
- **Risco de não fazer**: quando `enviarAoErp` for cabeado, o cliente HTTP que envia payload SN ao Conexos é uma versão CVE-vulnerable — DoS por recursion em resposta malformada do ERP derruba o worker.
- **Dependências**: nenhuma (dep herdada, não introduzida pela feature)

### [security-6] Triagem e patching de 6 CVE high no frontend

- **Problema**
  > `npm audit` no frontend reporta 6 high + 1 low. Feature SN não introduz deps novas, mas monta UI money-adjacent (painel de conciliação) sobre esse baseline vulnerável.
- **Melhoria Proposta**
  > Rodar `cd src/frontend && npm audit --json > audit.json`, triar cada high (root cause + fix availability), aplicar `npm audit fix` onde não-breaking, abrir cards individuais para os que exigem major bump (Next.js/React ecosystem tende a exigir migration). Priorizar packages com superfície de execução (XSS, prototype pollution).
- **Resultado Esperado**
  > `npm audit --json` no frontend: `high: 6 → 0` (ou justificativa por CVE com risco documentado).

- **Tactic alvo**: Limit Exposure
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-security-6
- **Métricas de sucesso**:
  - Frontend `high` vulns: 6 → 0
- **Risco de não fazer**: XSS ou prototype pollution no painel money-adjacent onde analistas revisam contrapartes de PIX/TED — potencial vetor para hijack de sessão e disparo de POST SN em nome do analista quando a rotação de escrita for cabeada.
- **Dependências**: audit_json disponível para triagem por-CVE

## 6. Notas do agente

- Feature SN é sólida em fundamentos: 3/3 endpoints Zod-validados no boundary, 2/2 rotas write-ish com `requireRole('admin')` + `heavyRouteLimiter` + `assertUserCanActOnFilial`, seam `enviarAoErp` deliberadamente `NotImplementedError` (defesa em profundidade — mesmo se authz falhar, não há caminho de escrita).
- P0 evitado: nenhum secret hardcoded, nenhum `process.env` cru no backend SN, nenhum SQL cru (stub in-memory), nenhum `dangerouslySetInnerHTML`.
- Cross-QA para o consolidator: Audit Trail (F-3) overlaps com Fault Tolerance; Limit Exposure via CVE (F-5/F-6) overlaps com Availability (blast radius via DoS em axios); Authorize Actors (F-4) overlaps com Modifiability (o seam `filiais` claim é change-friendly).
- Não medível localmente: presença do claim `permissions.filiais` em tokens de produção, taxa de authn falha, dependency license compliance (skipped — `license-checker` não avaliado).
