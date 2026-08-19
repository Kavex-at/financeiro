---
qa: Security
qa_slug: security
run_id: 2026-08-19-1603
agent: qa-security
generated_at: 2026-08-19T16:03:00-03:00
scope: backend + frontend
score: 7.5
findings_count: 8
cards_count: 6
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista autenticado (Supabase JWT) sem claim `filiais` provisionada | Faz `GET /aprovacoes?filCod=99` de uma filial em que não atua, ou `GET /aprovacoes/99:123:1/trilha` | `routes/aprovacoes.ts` → `AprovacoesPainelService` → `TituloAprovacaoRepository` (leitura sobre `aprovacao_titulo`) | Produção (Render), token válido, `aprovacoesEnabled=true`, JWT sem claim `filiais` (estado atual dos tokens Supabase) | Como não há allow-list no token, a rota devolve dados de TODAS as filiais do ERP (fallback documentado como PV-09). O painel é apenas leitura; nenhuma escrita no ERP alcança o Conexos (ADR-0038 D2, teste em `ConexosAprovacoesClient.test.ts:160`) | Zero endpoints de escrita expostos pela Frente V; 100% dos parâmetros SQL nomeados; 0 vazamentos de segredo em git; `AprovacaoIdInvalidoError` rejeitando ids fora de `^\d+:\d+:\d+$`; risco residual: exposição de valores/fornecedores/nomes de aprovadores entre filiais até a claim `filiais` ser provisionada. |

Contexto adicional (SaaSo/financeiro):
> A Frente V é 100% leitura (nenhum método de escrita no `ConexosAprovacoesClient`), portanto a exposição direta a "mover dinheiro" via esta frente é zero. A superfície é o **vazamento cruzado entre filiais** de dados sensíveis (valor, fornecedor, nome de aprovador) e a **cópia de dados de PRD em disco** pelas sondas.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta da Frente V | 0 | 0 | ✅ | `grep -rEn "(password|secret|token|api[_-]?key|credential)\s*[:=]\s*['\"][^'\"]{8,}" src/backend src/frontend --include="*.ts"` (excluindo `.env` e testes) |
| `src/backend/.env` commitado | Não (só `.env.example`) | Não | ✅ | `git log --all --full-history -- src/backend/.env` (vazio); `.gitignore:42`, `src/backend/.gitignore:3` |
| Chaves AWS (AKIA…) no repo | 0 | 0 | ✅ | `grep -rEn "AKIA[0-9A-Z]{16}" src/` |
| Endpoints da Frente V validando entrada com Zod | 2/2 (`listQuerySchema`, `trilhaParamsSchema`) | 100% | ✅ | `src/backend/routes/aprovacoes.ts:57-83` |
| Endpoints da Frente V atrás de authn (`buildAuthMiddleware`) | 2/2 | 100% | ✅ | `src/backend/index.ts:90` (auth) e `:126` (mount) |
| Endpoints da Frente V atrás do `aprovacoesGate` (kill-switch) | 2/2 | 100% | ✅ | `src/backend/index.ts:126`; `src/backend/http/aprovacoesGate.ts` |
| Repositories da Frente V com SQL 100% parametrizado | 3/3 (`TituloAprovacaoRepository`, `EtapaAprovacaoRepository`, `AprovacaoIngestaoRunRepository`) | 100% | ✅ | Auditoria manual — nomes de parâmetro (`$f0`) são gerados do índice, valores viajam em `params` para `SqlBuilder.build` (`src/backend/domain/libs/sql/SqlBuilder.ts:7-33`) |
| Métodos de escrita expostos por `ConexosAprovacoesClient` | 0 (`listUniverso`, `listTrilha`) | 0 | ✅ | `src/backend/domain/client/ConexosAprovacoesClient.test.ts:160-175` |
| Tokens JWT em `localStorage` (superfície de XSS) | Sim, presente | Cookie `HttpOnly` + `SameSite` | ⚠️ | `src/frontend/lib/auth/AuthProvider.tsx:76,89,136-137,149-150` — herança, não introduzido pela Frente V |
| Sondas contra PRD com guarda `PROBE_ALLOW_PRD` | 2/2 | Guarda + revisão manual + retenção controlada | ⚠️ | `src/backend/jobs/probe-aprovacoes-fin026.ts:44-49`, `probe-aprovacoes-trilha.ts:47-49` |
| Sondas gravando dado de PRD em disco (`OUT_DIR`) | 2/2 (default `/tmp/probe-aprovacoes-fin026`, `C:/tmp/probe-trilha`) | Diretório com ACL restrita OU expurgo automático | ❌ | `probe-aprovacoes-fin026.ts:63,166,201`; `probe-aprovacoes-trilha.ts:57,87,99` |
| Filiais efetivamente restritas por claim JWT (fail-closed) | 0% dos tokens (`filiais` não é emitida — só sub/email/role) | 100% (Bass: Authorize Actors + Limit Access) | ❌ | `src/backend/http/auth.ts:47-72`; comentário em `filialAuthz.ts:16-19`; fallback em `routes/aprovacoes.ts:35-42` |
| `redactBody` cobre nomes de aprovadores / valores em log | Não (só chaves auth-shaped: `password`, `token`, `jwt`, `api_key`…) | Redação de PII financeira em logs | ⚠️ | `src/backend/http/redact.ts:9-21`; log de query em `src/backend/index.ts:56-57` |
| Cobertura de tactics do Bass (Detect/Resist/React/Recover) | 12/16 presentes ou parciais | ≥14/16 | ⚠️ | Ver §3 |
| `npm audit` (backend + frontend) | ⚠️ Não medível: flag `--quick` ativa | N/A | ⚠️ | `_shared-metrics.md` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Nenhuma detecção ativa (nenhum WAF, GuardDuty, IDS). Rate-limit global existe como mitigação, mas não é detecção. | ❌ ausente | `src/backend/index.ts:44` (`globalLimiter`) |
| Detect Service Denial | `globalLimiter` + `heavyRouteLimiter` para rotas Conexos. Frente V herda o global. | ⚠️ parcial | `src/backend/index.ts:44,100`; `src/backend/http/rateLimit.ts` |
| Verify Message Integrity | JWT assinado (HS256 ou JWKS assimétrico) verificado por `buildAuthMiddleware`; `SUPABASE_JWT_SECRET` ou JWKS remoto. | ✅ presente | `src/backend/http/auth.ts:105-190` |
| Detect Message Delay | N/A — o backend não age como replay-sensitive (nenhuma janela temporal de token exigida além do `exp` do JWT). | N/A | Frente V é leitura pura sobre snapshot local, não roda transação com nonce/timing. |
| Identify Actors | JWT `sub` (Supabase user id) e `email` decodificados em `AuthUser`. `requestIdMiddleware` correlaciona logs. | ✅ presente | `src/backend/http/auth.ts:60-70`; `src/backend/index.ts:49` |
| Authenticate Actors | `buildAuthMiddleware` valida assinatura, `aud=authenticated` e (quando `SUPABASE_URL` presente) `iss`. `DEV_AUTH_BYPASS` derruba em local — no-op em prod. | ✅ presente | `src/backend/http/auth.ts:132-155` |
| Authorize Actors | **PARCIAL**. `assertUserCanActOnFilial` existe e é chamado quando `filCod` é passado explicitamente. Porém, na ausência da claim `filiais` no JWT (estado atual dos tokens), o guard permite tudo — `userCanActOnFilial(..., filCod) === true` quando `permitidas === undefined`; o `resolverFilCodsAcessiveis` cai em "todas as filiais do ERP". Documentado como fail-open deliberado (PV-09) até a claim ser provisionada. | ⚠️ parcial | `src/backend/http/filialAuthz.ts:38-50`; `src/backend/routes/aprovacoes.ts:35-42` |
| Limit Access | Kill-switch `aprovacoesGate` (env `aprovacoesEnabled`) força 403 na frente inteira; `PAGE_SIZE_MAX=100` teto de página; teto do `AprovacaoIdInvalidoError` para ids fora do formato. **`detalhar` devolve `null` (→ 404) para título de filial fora da allow-list em vez de 403** — decisão explícita de não confirmar a existência do registro ao ator não autorizado (Limit Access forte). | ✅ presente | `src/backend/http/aprovacoesGate.ts:14-21`; `src/backend/routes/aprovacoes.ts:28,148-153,160`; `AprovacoesPainelService.ts:181-183` |
| Limit Exposure | **`ConexosAprovacoesClient` não expõe método de escrita** (ADR-0038 D2). Teste ativo afirma isso via reflexão do objeto, tornando o erro "inexpressável em vez de disciplinado" (`test:160-175`). Elimina o vetor "insider dispara `trocaBloqueio`/`aplicarComando` via a mesma tela do ERP". | ✅ presente | `src/backend/domain/client/ConexosAprovacoesClient.ts:29-38`; `.test.ts:155-175` |
| Encrypt Data | HTTPS via Render/Vercel (TLS na borda); JWT assinado. Postgres via Supavisor (`sslmode` gerenciado). Sem observação de secret-at-rest específico da Frente V — segredos no `.env` local (dev) e no painel Render (prod). | ⚠️ parcial | Herdado da infra atual — sem KMS/SSM. |
| Separate Entities | Frente V isola escrita no ERP via port (`TrilhaAprovacaoGatewayInterface`) que carece de qualquer método `apply`/`troca`/`regerar`. Ingestão roda em job separado (`jobs/ingest-aprovacoes.ts`) sob advisory lock. Múltiplos gates (`aprovacoesGate` × `recebimentosGate` × `sispagGate`) isolam frentes uma da outra. | ✅ presente | `src/backend/domain/interface/aprovacoes/ports.ts`; `src/backend/jobs/ingest-aprovacoes.ts:77-90` |
| Change Default Settings | `aprovacoesEnabled` provavelmente default off em prod (padrão dos gates recém-plugados); `DEV_AUTH_BYPASS` só ativa por env explícito. **Sondas** têm `PROBE_ALLOW_PRD` desligado por default. | ✅ presente | `src/backend/jobs/probe-aprovacoes-fin026.ts:46-49`; `aprovacoesGate.ts:17-19` |
| Validate Input | `listQuerySchema` (Zod) na rota, `trilhaParamsSchema` para `:id`; `AprovacaoIdInvalidoError.parseId` revalida em profundidade (`^\d+$` puro, `Number.isSafeInteger`, `> 0` — rejeita `+1`, `1e3`, `0`, ` 1 `, `1.0`). Camada dupla: uma regex no boundary, outra no service. Repositories usam parâmetros NOMEADOS via `SqlBuilder` (`$filCod`, `$f0`); os nomes `$f0/$d0/$t0` de `listByTitulos` são gerados do índice, **jamais** de valor de usuário — auditoria feita e reproduzida no teste `AprovacoesSql.test.ts`. | ✅ presente | `routes/aprovacoes.ts:57-83`; `AprovacoesPainelService.ts:205-220`; `EtapaAprovacaoRepository.ts:113-133` |
| Revoke Access | JWT tem `exp`; revogação server-side (denylist, rotação, logout server-side) não existe. Um token comprometido continua válido até `exp`. Fora do delta da Frente V, mas o painel herda. | ❌ ausente | `src/backend/http/auth.ts` (não há denylist) |
| Lock Computer | N/A — a superfície é web, não desktop. | N/A | — |
| Inform Actors | `FilialForbiddenError` → 403 explícito com `code: 'FILIAL_NAO_AUTORIZADA'`; `AprovacaoIdInvalidoError` → 400 com `userMessage` pt-BR. Painel exibe `snapshotEm` para tornar a idade do dado visível. Alerta ao usuário logado (locked-out, alteração de permissão) não existe. | ⚠️ parcial | `src/backend/http/filialAuthz.ts:24-33`; `AprovacaoIdInvalidoError.ts:16-21` |
| Restore | Ingestão retomável via `AprovacaoIngestaoRunRepository.salvarCursor` — um comprometimento do banco não perde a origem (o ERP é sempre reingerido). Sem backup dedicado da tabela `aprovacao_*` no delta. Overlap com Availability. | ⚠️ parcial | `AprovacaoIngestaoRunRepository.ts:38-70` |
| Audit Trail | `aprovacao_ingestao_run` grava `triggered_by`, `started_at`, `status`, cursor, totais — auditoria da ingestão. **Não há audit trail de acesso ao painel** (quem consultou qual trilha, quando) — a Frente V é 100% leitura, mas quem viu quais valores de fornecedor/aprovador não fica registrado. Overlap com Fault Tolerance. | ⚠️ parcial | `AprovacaoIngestaoRunRepository.ts:22-70`; `migrations/0049_aprovacao_trilha.sql` |

## 4. Findings (achados)

### F-security-1: fallback fail-open de filiais quando o JWT não carrega a claim `filiais`

- **Severidade**: P1 (alto — expõe dados financeiros de todas as filiais a qualquer analista autenticado até a claim ser provisionada)
- **Tactic violada**: Authorize Actors (Bass) / Limit Access
- **Localização**: `src/backend/http/filialAuthz.ts:38-45`, `src/backend/routes/aprovacoes.ts:35-42`
- **Evidência (objetiva)**:
  ```ts
  // filialAuthz.ts
  export const userCanActOnFilial = (user: FilialScopedUser | undefined, filCod: number): boolean => {
      if (!user) return false;
      const permitidas = filiaisPermitidas(user);
      if (permitidas === undefined) return true;   // ← fail-open documentado
      return permitidas.includes(filCod);
  };
  // routes/aprovacoes.ts
  const resolverFilCodsAcessiveis = async (user) => {
      const permitidas = filiaisPermitidas(user);
      if (permitidas && permitidas.length > 0) return permitidas;
      const cadastro = container.resolve(ConexosCadastroClient);
      const filiais = await cadastro.listFiliais();
      return filiais.map((f) => Number(f.filCod)).filter(...);   // ← todas as filiais do ERP
  };
  ```
- **Impacto técnico**: Qualquer usuário autenticado, sem restrição de scope, enxerga a lista completa de títulos com workflow — de todas as filiais — com fornecedor, valor, aprovador nomeado e trilha completa. O ADR-0038 D2 impede que isso vire escrita no ERP (o port não expõe `aplicarComando`), mas o vazamento é de PII/financeiro entre filiais.
- **Impacto de negócio**: Um analista de uma filial (ex.: SP) vê os valores de contas a pagar, fornecedores e aprovadores de MG, RJ, etc. Em um contexto multi-tenant/multi-filial, isso quebra a promessa que a proposta da Kavex faz explicitamente (RBAC por escopo). O risco cresce à medida que a Frente V é populada por ingestão (23.632 títulos só na filial 2 em 12 meses, conforme docstring do repo).
- **Métrica de baseline**: 0% dos tokens Supabase atuais carregam a claim `filiais` (`auth.ts:47-72` só emite `sub/email/role`). Denominador esperado: 100%. Rota `/aprovacoes` responde HTTP 200 para qualquer usuário autenticado independentemente da filial.

### F-security-2: sondas de PRD gravam dado sensível em `/tmp` sem ACL nem expurgo

- **Severidade**: P2 (médio — data spillage local; guarda `PROBE_ALLOW_PRD` reduz a chance de execução acidental)
- **Tactic violada**: Limit Exposure / Encrypt Data (dado at-rest em `/tmp` fora do controle)
- **Localização**: `src/backend/jobs/probe-aprovacoes-fin026.ts:63,166,201`; `src/backend/jobs/probe-aprovacoes-trilha.ts:57,87,99`
- **Evidência (objetiva)**:
  ```ts
  // probe-aprovacoes-fin026.ts
  const OUT_DIR = process.env.OUT_DIR ?? '/tmp/probe-aprovacoes-fin026';
  ...
  writeFileSync(`${OUT_DIR}/${nome}`, JSON.stringify(dados, null, 2), 'utf8');
  ...
  console.log(JSON.stringify(resultado, null, 2).slice(0, 4000));   // stdout de PRD → drain Render
  ```
- **Impacto técnico**: Quando executadas com `PROBE_ALLOW_PRD=1`, as duas sondas persistem em disco (padrão `/tmp/probe-aprovacoes-fin026`, `C:/tmp/probe-trilha`) linhas brutas do Conexos — `usnDesNomeCmd` (nome do aprovador), `titValor`, `docEspNumero`, etc. — e ecoam ~4KB de JSON por chamada em stdout. Sem ACL, sem expurgo automático, sem `chmod 600`.
- **Impacto de negócio**: Insider com shell na máquina de desenvolvimento (ou análise forense pós-incidente que ache o `/tmp`) tem trilha completa de nomes de aprovadores + valores + fornecedores de contas a pagar reais. Rodar as sondas em uma máquina compartilhada (ex.: EC2 comunitária ou o próprio Render, via `PROBE_ALLOW_PRD=1`) espalha esse dado para além do investigador.
- **Métrica de baseline**: 2 sondas gravam em disco; 0 têm expurgo automático; 0 têm ACL restrita além do default do sistema; guarda é 1 variável de ambiente boolean.

### F-security-3: sem revogação server-side / denylist de JWT

- **Severidade**: P2 (médio — herança do stack Supabase; um token vazado é bom até `exp`)
- **Tactic violada**: Revoke Access
- **Localização**: `src/backend/http/auth.ts` (ausência); `src/frontend/lib/auth/AuthProvider.tsx:149-150` (logout local-only)
- **Evidência (objetiva)**: `buildAuthMiddleware` verifica `exp`/`iss`/`aud` mas não consulta nenhuma lista de tokens revogados. Logout no frontend só remove do `localStorage` — o token permanece válido no backend até expirar.
- **Impacto técnico**: Um token exportado por XSS/phishing/log leak vale até seu `exp` (padrão Supabase: 1h por access token). Sem denylist, revogar um usuário comprometido exige rotar `SUPABASE_JWT_SECRET`, o que invalida todos os tokens de todos os usuários.
- **Impacto de negócio**: janela de exposição de até 1h por incidente de vazamento de token. Aceitável para uma app de leitura pura como o painel Frente V; inaceitável quando a mesma sessão desbloqueia SISPAG/permuta.
- **Métrica de baseline**: 0 mecanismos de revogação server-side; TTL do access token = 1h (default Supabase).

### F-security-4: `redactBody` cobre só chaves auth-shaped, ignora PII financeira em log de erro

- **Severidade**: P2 (médio — o path que loga o body só dispara em `res.statusCode >= 400`, contendo dado da Frente V é raro mas possível)
- **Tactic violada**: Limit Access (log é surface secundária de acesso)
- **Localização**: `src/backend/http/redact.ts:9-21`; `src/backend/index.ts:52-72`
- **Evidência (objetiva)**:
  ```ts
  const DEFAULT_SENSITIVE_KEYS: ReadonlyArray<string> = [
      'password', 'senha', 'token', 'accesstoken', 'refreshtoken',
      'authorization', 'secret', 'api_key', 'apikey', 'jwt',
  ];
  ```
  Chaves como `responsavelNome`, `fornecedorNome`, `valor`, `cnpj` NÃO estão na lista. Em `index.ts:65-70`, `[RES] ... body=${JSON.stringify(redactBody(data))}` roda para toda resposta com status ≥ 400.
- **Impacto técnico**: Se uma resposta 500 acidentalmente ecoa o payload em vez de um erro genérico (por regressão em `respondHandlerError`), stdout do Render capta CNPJ/valor/aprovador. Query params (`?responsavel=<nome>&fornecedorCod=<n>`) são logados **sempre**, sem redação, no `[REQ]` (linha 55-56).
- **Impacto de negócio**: PII e dado financeiro em CloudWatch/logs de Render acessíveis a quem tem role de "read logs" (ampla, na prática — não é o mesmo grupo de quem pode ler o banco).
- **Métrica de baseline**: 10 chaves na denylist do `redactBody`, 0 delas são termos de negócio (`fornecedor`, `responsavel`, `cnpj`, `valor`). Query params logados sem redação em 100% dos `GET /aprovacoes`.

### F-security-5: sem audit trail de acesso ao painel (quem leu o quê)

- **Severidade**: P2 (médio — a Frente V é leitura, mas dados são sensíveis e a Fault Tolerance exige rastreabilidade)
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/routes/aprovacoes.ts` (nenhuma persistência de acesso)
- **Evidência (objetiva)**: `aprovacao_ingestao_run` audita a ingestão (`triggered_by`, `started_at`), mas o `GET /aprovacoes/:id/trilha` — que devolve a timeline completa com nomes de aprovadores, alçadas e observações — não deixa rastro em banco. Só sobra o `console.log` transitório do `requestLogger`.
- **Impacto técnico**: Não é possível reconstruir, meses depois, quem viu qual trilha. Em um cenário de investigação (ex.: vazamento externo de trilha de pagamento a um fornecedor), a Frente V é opaca.
- **Impacto de negócio**: A proposta comercial da Kavex afirma "trilha de auditoria persistida em todas as frentes"; a Frente V hoje só a tem para ingestão, não para consulta. Compliance (LGPD art. 37, controles internos) exige log de acesso a PII/dado financeiro.
- **Métrica de baseline**: 1 tabela de auditoria existente (`aprovacao_ingestao_run`, cobre origem do dado); 0 tabelas cobrem consumo do dado. 0 registros de `GET /aprovacoes/:id/trilha` persistem.

### F-security-6: JWT em `localStorage` (herança) — token exfiltrável por XSS

- **Severidade**: P2 (médio — herança; XSS no Next.js atual está sob controle, mas o vetor está ativo)
- **Tactic violada**: Limit Exposure
- **Localização**: `src/frontend/lib/auth/AuthProvider.tsx:76,89,136-137,149-150`; `src/frontend/lib/auth/token.ts:5`
- **Evidência (objetiva)**: `window.localStorage.setItem(TOKEN_STORAGE_KEY, body.token)` — acessível por qualquer script no domínio. `dangerouslySetInnerHTML` **não** aparece no delta da Frente V (grep 0 resultados fora de `node_modules`), o que limita a superfície hoje, mas o padrão de armazenamento continua ruim.
- **Impacto técnico**: Uma XSS futura em qualquer rota do painel (`/aprovacoes` inclui filtros por `responsavel` e `busca` que a UI ecoa) permite `localStorage.getItem` do JWT.
- **Impacto de negócio**: idem F-security-3 — janela até `exp` para o atacante agir com identidade legítima.
- **Métrica de baseline**: 1 chave de storage (`TOKEN_STORAGE_KEY`), 100% dos tokens armazenados em `localStorage` (não em `HttpOnly` cookie).

### F-security-7: guarda de sonda por variável de ambiente é revertível por typo

- **Severidade**: P3 (baixo — combinado com F-security-2 vira P2, mas isoladamente é hardening)
- **Tactic violada**: Change Default Settings (a guarda existe, mas é frágil)
- **Localização**: `src/backend/jobs/probe-aprovacoes-fin026.ts:44-49`; `probe-aprovacoes-trilha.ts:47-49`
- **Evidência (objetiva)**:
  ```ts
  const IS_HML = BASE.includes('-hml');
  if (!IS_HML && process.env.PROBE_ALLOW_PRD !== '1') { ... process.exit(1); }
  ```
  A detecção de HML depende do substring `-hml` na URL. Uma base URL sem esse marcador (ex.: futuros tenants, aliases DNS) contorna a proteção mesmo em ambiente não-produtivo; e um tenant PRD sem `-hml` já cai no caminho de exigir `PROBE_ALLOW_PRD` — o que é o comportamento certo, mas depende de convenção de nomenclatura.
- **Impacto técnico**: Se algum dia a produção deixar de seguir a convenção de sufixo (fusão de tenants, migração de DNS), a guarda deixa de discriminar HML de PRD sem barulho.
- **Impacto de negócio**: dependência de convenção de string em código de segurança é dívida frágil.
- **Métrica de baseline**: 1 heurística string-based (`.includes('-hml')`); 0 lista explícita de bases PRD conhecidas.

### F-security-8: kill-switch `aprovacoesEnabled` sem log de auditoria da troca de estado

- **Severidade**: P3 (baixo — hardening)
- **Tactic violada**: Audit Trail (para operação do próprio kill-switch)
- **Localização**: `src/backend/http/aprovacoesGate.ts:14-21`; `EnvironmentProvider.resolveAprovacoesEnabled`
- **Evidência (objetiva)**: `aprovacoesGate` lê `env.aprovacoesEnabled` a cada request e retorna 403; a troca do valor (env var ou SSM cache) não gera registro.
- **Impacto técnico**: se o gate for desativado indevidamente e reativado logo depois, não fica rastro de quem desligou.
- **Impacto de negócio**: kill-switch é ferramenta de resposta a incidente; sem log da manipulação, é impossível reconstruir "às 14h a frente ficou 8min offline, quem foi?".
- **Métrica de baseline**: 0 audit-log entries por transição de `aprovacoesEnabled`.

## 5. Cards Kanban

### [security-1] Provisionar claim `filiais` no JWT e fechar o fallback fail-open

- **Problema**
  > Hoje, um analista autenticado sem a claim `filiais` no JWT vê **todas** as filiais do ERP no painel `/aprovacoes` — inclui fornecedor, valor, nome do aprovador e trilha completa. O comportamento é documentado (PV-09, `filialAuthz.ts:16-19`) mas ativo. É a maior lacuna de autorização da Frente V.

- **Melhoria Proposta**
  > Emitir a claim `permissions.filiais: number[]` no JWT (ou popular `app_user_filial` no banco e resolver na `buildAuthMiddleware`). Depois, inverter o default de `userCanActOnFilial` para **fail-closed**: usuário sem claim → 0 filiais → `filCods.length === 0` em `TituloAprovacaoRepository.list` já devolve `{ items: [], total: 0 }` (`TituloAprovacaoRepository.ts:106`). Reforçar com uma migration one-shot que provisione todos os usuários existentes. Tactic alvo: **Authorize Actors**.

- **Resultado Esperado**
  > 100% dos tokens carregam `filiais`; qualquer `GET /aprovacoes` sem claim devolve `{ items: [], total: 0 }` em vez do universo. Auditável via novo teste em `filialAuthz.test.ts` que rode o guard sem allow-list e espere `false`.

- **Tactic alvo**: Authorize Actors
- **Severidade**: P1
- **Esforço estimado**: M (2–5d) — envolve emissão de token no `authRouter` + backfill de `app_user_filial` + inversão do default
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - % de tokens com claim `filiais`: 0% → 100%
  - `userCanActOnFilial(user_sem_lista, X)`: `true` → `false`
  - Filiais expostas a analista de escopo único: N (todas) → 1
- **Risco de não fazer**: em 6 meses, com a ingestão populando ~25k títulos por filial, qualquer analista de qualquer filial baixa toda a carteira de contas a pagar da holding via paginação; incidente de vazamento inter-filial vira commodity de investigação.
- **Dependências**: nenhum bloqueio técnico; depende de decisão de ontologia (PV-09) e alinhamento com o `authRouter` já existente.

### [security-2] Endurecer sondas de PRD: expurgo automático + ACL + opt-in por auditoria

- **Problema**
  > As sondas `probe-aprovacoes-fin026.ts` e `probe-aprovacoes-trilha.ts` gravam JSON bruto do Conexos de produção (nomes de aprovadores, valores, fornecedores) em `/tmp/probe-*` sem expurgo, sem ACL restrita e sem persistir "quem rodou". A guarda `PROBE_ALLOW_PRD=1` protege contra execução acidental, mas não contra data spillage pós-execução legítima.

- **Melhoria Proposta**
  > Três mudanças pequenas: (a) `OUT_DIR` default para um subdiretório com `mkdirSync(..., { mode: 0o700 })` e um `setTimeout(() => rmSync(OUT_DIR, { recursive: true }), TTL)` no `main`; (b) registrar em `aprovacao_ingestao_run` (ou uma nova tabela `probe_run`) `{ script, triggered_by, base_url, started_at }` antes de qualquer chamada; (c) truncar valores no `console.log` para tirar `usnDesNomeCmd`, `titValor` e chaves com `_nome`/`_valor` do stdout. Tactic alvo: **Limit Exposure**.

- **Resultado Esperado**
  > Nenhum arquivo de sonda persiste além do TTL configurado; toda execução tem entrada no banco; stdout não carrega PII bruta. Verificável por `ls /tmp/probe-aprovacoes-fin026` após TTL retornar vazio.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2, F-security-7
- **Métricas de sucesso**:
  - `# arquivos de PRD persistentes em /tmp após 24h`: N → 0
  - `# execuções de sonda sem entrada em banco`: N → 0
  - `# aparições de nomes de aprovador em stdout`: >0 → 0
- **Risco de não fazer**: um pen-test (ou insider mal-intencionado) na máquina de desenvolvimento reconstrói a carteira de contas a pagar da Columbia inspecionando `/tmp`.
- **Dependências**: nenhuma.

### [security-3] Redator de PII/dado financeiro nos logs de request/response

- **Problema**
  > `redactBody` só cobre chaves de credencial (`password`, `token`, `jwt`, …). Query params do painel (`?responsavel=<nome>&fornecedorCod=<n>&busca=<termo>`) são logados **sempre** no `[REQ]`; bodies de resposta 4xx/5xx passam por `redactBody` mas não são redigidos quando trazem `responsavelNome`/`fornecedorNome`/`valor`. CloudWatch/drains do Render acumulam PII financeira.

- **Melhoria Proposta**
  > Expandir `DEFAULT_SENSITIVE_KEYS` com termos de negócio (`responsavel`, `responsavelnome`, `fornecedor`, `fornecedornome`, `cnpj`, `valor`) e aplicar `redactBody` também à `query` no `[REQ]`. Tactic alvo: **Limit Access**.

- **Resultado Esperado**
  > Grep no drain do Render por CNPJ ou nome próprio conhecido do quadro de aprovadores retorna 0 hits pós-mudança.

- **Tactic alvo**: Limit Access
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - `# chaves de PII/negócio em DEFAULT_SENSITIVE_KEYS`: 0 → ≥6
  - `# GETs de /aprovacoes com query logada sem redação`: 100% → 0%
- **Risco de não fazer**: LGPD art. 6, VI (transparência) e art. 46 (segurança) ficam frágeis; logs de sistemas terceirizados acabam expondo dados que a app protegeria em transporte.
- **Dependências**: nenhuma.

### [security-4] Persistir audit trail de consulta ao painel de aprovações

- **Problema**
  > A Frente V é leitura pura, mas os dados que ela expõe são exatamente os que a proposta trata como "sensíveis": aprovador, valor, fornecedor, trilha. Não há registro de quem consultou qual trilha, quando. `aprovacao_ingestao_run` cobre a **origem** do dado; falta cobrir o **consumo**.

- **Melhoria Proposta**
  > Nova tabela `aprovacao_acesso_log` com `(request_id, user_sub, endpoint, filCod, docCod, titCod, acessado_em)`, gravada pelo próprio `routes/aprovacoes.ts` no path do sucesso. Fire-and-forget: falha da gravação não bloqueia a resposta, mas gera métrica. Tactic alvo: **Audit Trail**. Overlap com Fault Tolerance.

- **Resultado Esperado**
  > 100% dos `GET /aprovacoes/:id/trilha` bem-sucedidos deixam linha em `aprovacao_acesso_log`. Consulta forense "quem viu a trilha do título 2:4156:1 em agosto?" respondida em segundos.

- **Tactic alvo**: Audit Trail
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — migration + repository + wiring na rota + teste
- **Findings relacionados**: F-security-5, F-security-8
- **Métricas de sucesso**:
  - Cobertura de audit trail em `/aprovacoes`: 0% → 100%
  - MTTR forense (reconstrução de "quem leu o quê"): impossível → < 5min
- **Risco de não fazer**: compliance (LGPD, controles internos) e resposta a incidente sem dado — mesma classe de risco que a proposta Kavex declara resolver.
- **Dependências**: nenhuma.

### [security-5] Denylist server-side de JWT + logout server-side

- **Problema**
  > Um token vazado é válido até `exp` (~1h). Logout hoje é local-only (`localStorage.removeItem`). Não há mecanismo de revogação server-side para responder a um incidente sem rotar `SUPABASE_JWT_SECRET` (que invalida todo mundo).

- **Melhoria Proposta**
  > Tabela `revoked_token(jti, revoked_at, revoked_by, reason)` consultada por `buildAuthMiddleware` após a verificação de assinatura. Endpoint `POST /auth/revoke` (self ou admin). Tactic alvo: **Revoke Access**.

- **Resultado Esperado**
  > Tempo para invalidar sessão comprometida: até `exp` (~60min) → < 60s do request seguinte.

- **Tactic alvo**: Revoke Access
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-security-3, F-security-6
- **Métricas de sucesso**:
  - Latência de revogação: 60min → < 1min
  - `# endpoints com verificação de denylist`: 0 → todos os `app.use(...)` pós `buildAuthMiddleware`
- **Risco de não fazer**: primeiro incidente de exfiltração de token custa 1h de janela de ataque com identidade legítima; se o usuário afetado tiver acesso ao SISPAG (fora do escopo Frente V, mas mesmo stack), o risco é financeiro direto.
- **Dependências**: nenhuma — a rota `/auth` já emite JWT próprio, adicionar `jti` é uma linha.

### [security-6] Substituir `localStorage` por cookie `HttpOnly` + `SameSite=Strict` para o JWT

- **Problema**
  > O token é armazenado em `localStorage`, acessível a qualquer script no domínio. Nenhuma XSS foi identificada no delta da Frente V (grep 0), mas o padrão é frágil por design.

- **Melhoria Proposta**
  > Mover a emissão do `authRouter` para `Set-Cookie: token=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600` e adaptar `buildAuthMiddleware` a ler `req.cookies.token` como alternativa ao `Authorization: Bearer`. CSRF fica sob a proteção de `SameSite=Strict` para o mesmo-site. Tactic alvo: **Limit Exposure**.

- **Resultado Esperado**
  > `document.cookie` não expõe o JWT no browser; XSS futura não consegue exfiltrar credencial de sessão.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — mudança cross-camadas (auth, middleware, fetch client)
- **Findings relacionados**: F-security-6
- **Métricas de sucesso**:
  - `# tokens acessíveis via JS no cliente`: 1 → 0
  - `# rotas suscetíveis a CSRF sem token`: N → 0 (via `SameSite=Strict`)
- **Risco de não fazer**: XSS futura → exfiltração automática de todos os JWTs ativos.
- **Dependências**: alinhamento com o fluxo de auth (fora do delta da Frente V, mas herança que a frente propaga).

## 6. Notas do agente

- **Escopo**: revisão priorizou o delta `feat/frente-v-aprovacoes` conforme `_shared-metrics.md`. Achados herdados (JWT em `localStorage`, revogação) entraram porque a Frente V os propaga, com severidade P2 (não introduzidos por ela).
- **Métricas não coletáveis com `--quick`**: `npm audit` profundo (pulado), CloudWatch, `terraform plan` (não há `infra/` neste repo — ver `CLAUDE.md §Estado Atual vs. Alvo`). Recomendação: rodar `npm audit` full em run sem `--quick`.
- **Positivo forte**: o teste `ConexosAprovacoesClient.test.ts:160-175` (a superfície não expõe escrita) é o padrão de "erro inexpressável" que o consolidator pode citar como referência para outras frentes — em especial SISPAG e Permutas, cujos clients podem herdar o mesmo teste inverso.
- **Cross-QA**:
  - Fault Tolerance: F-security-4 (redator) e F-security-5 (audit trail) são co-owned. O consolidator deve casá-los.
  - Availability: F-security-8 (kill-switch sem audit) espelha o blast-radius da tactic `Limit Exposure`.
  - Integrability: F-security-1 (fail-open) tem raiz na integração Supabase — o Integrability agent pode identificar a mesma lacuna a partir do lado dos claims.
  - Deployability: rotação de `SUPABASE_JWT_SECRET` (implícita em F-security-5) precisa entrar no runbook.
- **Nota sobre severidade P1**: F-security-1 tem baseline numérico (0% dos tokens carregam `filiais`; universo esperado = 100%; N filiais expostas indevidamente = todas do ERP). Baseline defensável — não é palpite.
