---
qa: Security
qa_slug: security
run_id: 2026-09-01-1944-copiar-barcode-item-lote
agent: qa-security
generated_at: 2026-09-01T19:44:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 3
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

Escopo `--quick`: delta da feature `copiar-barcode-item-lote`. A rota
`GET /sispag/lotes/:id/linhas-digitaveis` expõe a **linha digitável do boleto** (47 dígitos)
de cada item de lote SISPAG. A linha carrega, no campo livre do código de barras, banco,
agência e conta do cedente do boleto, além de valor e vencimento — ela é destino de
pagamento, na mesma classe de sensibilidade do CNAB 240 do `.REM` (LGPD Art. 6º + sigilo
bancário — LC 105).

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado sem privilégio (`viewer`) tenta baixar a linha digitável de qualquer lote | HTTP GET direto no endpoint | `routes/sispag.ts` → `SispagPainelService.linhasDigitaveisDoLote` | Prod | Middleware de auth valida JWT; `requireRole('admin')` responde 403; nada chega ao ERP | 100% dos GET `/lotes/:id/linhas-digitaveis` sem role `admin` → HTTP 403; 0 linhas digitáveis em logs de aplicação |
| Insider com acesso ao **stream de log do Render** | ERP Conexos retorna 4xx/5xx no `fin015/finItemSispag/list` durante uma janela de instabilidade | Interceptor axios em `services/conexos.ts` (linha 148-152) — log de erro sem redação | Prod | O interceptor faz `console.error('[CONEXOS ✗] body=${JSON.stringify(body)}')` com o corpo bruto; `redactSensitive` só cobre chaves de credencial (`password/senha/token/…`), não `itsNumCodbar` | 0 ocorrências de string de 47 dígitos numérica em stdout de prod nos últimos 7 dias |
| Admin comprometido (token roubado) | Loop de `curl` sobre `/sispag/lotes/:id/linhas-digitaveis` para cada lote listável | Rate-limit global (100 req/min por IP) + `requireRole('admin')` | Prod | Extração de carteira em minutos; o rate-limit atual não distingue read-heavy sensível de leitura mundana | Rate-limit alinhado com `POST /sispag/lotes/:id/remessa` (`heavyRouteLimiter` — 10/min) na rota de linha digitável |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rotas do delta com guard de authz | 1/1 | 100% | ✅ | `grep -n "requireRole" src/backend/routes/sispag.ts` (novo `requireRole('admin')` na L67) |
| Cobertura de teste do guard 403 | 1 teste (`role: 'viewer'` → 403) | ≥1 | ✅ | `src/backend/routes/sispag.test.ts:151-162` |
| Validação Zod no boundary do dado sensível | `z.string().regex(/^\d{47}$/)` presente | Regex estrita | ✅ | `src/backend/domain/client/ConexosSispagWriteClient.ts:87` |
| Redação do serviço no log de fallback | `linhaDigitavel` **NÃO** aparece em `logService.warn` (log de fallback só carrega `loteId`, `flpCod`, `motivo`) | 0 | ✅ | `src/backend/domain/service/sispag/SispagPainelService.ts:249-256` + teste de asserção em `SispagPainelService.test.ts:440-450` |
| `itsNumCodbar` na lista de chaves sensíveis do interceptor Conexos | ausente (lista é `password/senha/pwd/secret/token/authorization/sid/username/usuario`) | presente | ❌ | `src/backend/services/conexos.ts:20-30` |
| Log bruto do corpo de resposta em erro do Conexos | ativo, sem redação (`console.error('[CONEXOS ✗] body=…')`) | Redação por lista de chaves OU nenhum log de body de resposta | ❌ | `src/backend/services/conexos.ts:150-151` |
| Log bruto do corpo de resposta em sucesso do Conexos (`DEBUG_VERBOSE=1`) | ativo, sem redação | Redação ou desativado em prod | ⚠️ | `src/backend/services/conexos.ts:143` |
| Rate-limit na nova rota | `globalLimiter` (100/min por IP) | `heavyRouteLimiter` (10/min por IP) — mesma classe do `.REM` | ⚠️ | `src/backend/routes/sispag.ts:60-72` (sem `heavyRouteLimiter`); compare com L342/361/427/484 |
| Frontend: linha digitável em `localStorage`/`sessionStorage` | 0 escritas | 0 | ✅ | `grep -n "localStorage\|sessionStorage" src/frontend/app/sispag/components/LoteCard.tsx` (nenhuma ocorrência) |
| Frontend: SDK de telemetria com hook em erro (Sentry/PostHog/etc.) | ausente | — | ✅ (por ora — cf. Notas) | `grep -rn "Sentry\|posthog" src/frontend/{app,lib,components}` (0 hits) |
| Frontend: toast de sucesso repete os 47 dígitos | não — mostra só `Título ${docCod}/${titCod}` | 0 | ✅ | `src/frontend/app/sispag/components/LoteCard.tsx:180-183` |
| `npm audit --omit=dev` no backend (delta) | 2 moderate / 0 high / 0 critical (`exceljs`→`uuid`, indireta) | 0 high / 0 critical | ✅ | `cd src/backend && npm audit --omit=dev --json \| tail -20` |
| Outra rota fora do delta que também exponha `itsNumCodbar` | 0 (busca por `itsNumCodbar\|linhaDigitavel` em `routes/` e `service/` só encontra a nova) | 0 | ✅ | `grep -rn "itsNumCodbar\|linhaDigitavel" src/backend/{routes,domain/service}` |

Nada nesta rodada é do tipo "não medível localmente" — o delta é pequeno o suficiente para
cobrir tudo por inspeção.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Identify Actors | JWT HS256 self-signed por `AuthService`, `sub` do usuário; captado por `buildAuthMiddleware` antes das rotas | ✅ presente | `src/backend/index.ts:89` + `src/backend/http/auth.ts:60-73` |
| Authenticate Actors | Auth middleware global; 401 sem token válido | ✅ presente | `src/backend/index.ts:89` + `src/backend/http/auth.ts` |
| Authorize Actors | `requireRole('admin')` na nova rota + 14 rotas SISPAG mutantes; teste 403 para `viewer` | ✅ presente | `src/backend/routes/sispag.ts:67`, `src/backend/routes/sispag.test.ts:151-162` |
| Limit Access | Guard por-rota; `sispagGate` (feature flag) na frente do router; rota `/lotes/:id/linhas-digitaveis` só devolve dado quando o lote tem `nativeFlpCod` (rascunho → `[]` sem chegar ao ERP) | ✅ presente | `src/backend/domain/service/sispag/SispagPainelService.ts:239-246` |
| Limit Exposure | Rate-limit global (100/min) cobre a rota; o `heavyRouteLimiter` (10/min) que já protege as demais rotas com fan-out ao Conexos **não** foi aplicado aqui | ⚠️ parcial | `src/backend/routes/sispag.ts:60-72` vs. `src/backend/routes/sispag.ts:341-342` |
| Encrypt Data | HTTPS na borda (Render/Vercel); nada no delta expõe dado em canal claro. Persistência da linha digitável — nenhuma neste delta (a leitura é read-through do ERP) | ✅ presente | Configuração de plataforma; delta não introduz storage novo |
| Separate Entities | O dado passa por client (`ConexosSispagWriteClient`) → service (`SispagPainelService`) → route; camada de client é a única com o wire format do ERP, camada de service devolve o shape enxuto (`{docCod,titCod,linhaDigitavel}`) | ✅ presente | `ConexosSispagWriteClient.ts:388-435` + `SispagPainelService.ts:237-263` |
| Change Default Settings | Rota nasce com `requireRole('admin')` por default; sem fallback público. `DEV_AUTH_BYPASS` fica atrás de env var | ✅ presente | `src/backend/routes/sispag.ts:67`, `src/backend/index.ts:85-89` |
| Validate Input | Zod `LINHA_DIGITAVEL_SCHEMA` no boundary do client (`/^\d{47}$/`); rows que não batem são **omitidas** (não coagidas a string vazia) | ✅ presente | `src/backend/domain/client/ConexosSispagWriteClient.ts:81-88, 424-433` |
| Detect Intrusion | Log de auth negada (`console.warn('[auth] forbidden…')`) presente; sem SIEM/agregação — Render logs apenas | ⚠️ parcial | `src/backend/http/auth.ts:216-218` |
| Detect Service Denial | Rate-limit responde 429; sem alarme sobre 429s (Render é a fronteira de observabilidade) | ⚠️ parcial | `src/backend/http/rateLimit.ts` |
| Verify Message Integrity | JWT HS256 assinado; sem HMAC de payload (o Conexos é o único destino de escrita, e a integridade da linha digitável se resolve na regex de 47 dígitos + decisão de omitir) | ✅ presente | `src/backend/http/auth.ts` |
| Detect Message Delay | N/A no delta (read síncrono; sem canal assíncrono novo) | N/A | delta não introduz fila/sqs |
| Revoke Access | Logout invalida token no cliente; token backend é self-signed sem lista de revogação — depende do TTL (12h por comentário do `apiFetch`) | ⚠️ parcial | `src/frontend/lib/http.ts:4-6` (comentário 12h) |
| Lock Computer | N/A (browser-level; fora do escopo) | N/A | — |
| Inform Actors | Toast confirma cópia sem revelar dados; log de auth negada existe no server. Sem canal para informar admin de tentativa em massa | ⚠️ parcial | `src/frontend/app/sispag/components/LoteCard.tsx:180-183` |
| Restore | Delta é read-only sobre o ERP; nada de estado próprio para restaurar | N/A | delta não persiste |
| Audit Trail | **Ausente para esta rota.** O download do `.REM` (mesma classe de dado) também não gera trilha própria; ambos apenas emitem log via interceptor. Cross-QA com Fault Tolerance | ❌ ausente | `src/backend/routes/sispag.ts:67-72` (sem `auditLog(…)`) e `sispag.ts:454-476` (idem) |

## 4. Findings (achados)

### F-security-1: Interceptor axios do Conexos loga o corpo bruto da resposta de erro sem redação — `itsNumCodbar` vaza para o stdout do Render

- **Severidade**: **P1** (alto — vazamento de dado sensível em log de plataforma quando o ERP oscila; probabilidade real, cenário observado historicamente com o Conexos)
- **Tactic violada**: Limit Access / Encrypt Data (em repouso — os logs do Render são um novo canal)
- **Localização**: `src/backend/services/conexos.ts:145-152` (interceptor de resposta, ramo de erro) + `src/backend/services/conexos.ts:20-30` (lista `SENSITIVE_KEYS`)
- **Evidência (objetiva)**:
  ```ts
  // src/backend/services/conexos.ts:20
  const SENSITIVE_KEYS = [
      'password', 'senha', 'pwd', 'secret', 'token',
      'authorization', 'sid', 'username', 'usuario',
  ];

  // src/backend/services/conexos.ts:132-152 (interceptor de resposta)
  this.client.interceptors.response.use(
      (resp) => {
          // …
          if (DEBUG_VERBOSE) console.log(`[CONEXOS ←] data=${JSON.stringify(resp.data)}`); // ← sem redação
          return resp;
      },
      (err) => {
          const { method, url } = err.config ?? {};
          const status = err.response?.status ?? 'ERR';
          const body = err.response?.data;
          console.error(`[CONEXOS ✗] ${(method ?? '?').toUpperCase()} ${url} → ${status}`);
          if (body) console.error(`[CONEXOS ✗] body=${JSON.stringify(body)}`); // ← sem redação
          return Promise.reject(err);
      },
  );
  ```
  `redactSensitive` só é chamado no ramo de **request** (`services/conexos.ts:128`) e, mesmo assim, apenas sobre uma lista fixa de chaves de credencial. `itsNumCodbar` (e `linhaDigitavel`, `codbar`, `boleto`) não aparecem em `SENSITIVE_KEYS`.
- **Impacto técnico**: quando o Conexos responde 4xx/5xx numa chamada `fin015/finItemSispag/list` mas ainda inclui `rows` no envelope de erro (comportamento observado do ERP em vários probes documentados), a linha digitável de cada item cai em `stdout`. O stream do Render é acessível a qualquer engenheiro com acesso à aplicação Render — trust boundary distinto do acesso ao ERP ou ao Postgres.
- **Impacto de negócio**: reconstrução da carteira de boletos da Columbia por operador com acesso ao painel do Render (LGPD Art. 6º, LC 105 sigilo bancário). O guard `requireRole('admin')` do finding acompanhado (`security-1`) fecha a porta da frente, este finding abre uma **porta lateral**: qualquer chamada bem-sucedida à rota já semeou stdout com o dado — basta uma falha do ERP para vazar corpo inteiro no log de erro (e `DEBUG_VERBOSE=1` acidental em prod semeia todas as respostas de sucesso).
- **Métrica de baseline**: `itsNumCodbar in SENSITIVE_KEYS` = **false**; `console.error("[CONEXOS ✗] body=…")` sem redação = **1 site**; `console.log("[CONEXOS ←] data=…")` sob `DEBUG_VERBOSE` sem redação = **1 site**.

### F-security-2: Nova rota fica no `globalLimiter` (100/min) e não no `heavyRouteLimiter` (10/min) — enumeração da carteira em minutos

- **Severidade**: **P2** (médio — depende de admin comprometido; o download do `.REM` que carrega o mesmo dado tem o mesmo problema hoje, então é consistência + hardening)
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/routes/sispag.ts:60-72` (rota nova, sem `heavyRouteLimiter`) vs. `src/backend/routes/sispag.ts:341-342` e L361, L427, L484 (rotas que aplicam `heavyRouteLimiter`)
- **Evidência (objetiva)**:
  ```ts
  // src/backend/routes/sispag.ts:63 — nova rota
  router.get(
      '/lotes/:id/linhas-digitaveis',
      requireRole('admin'),                 // ← só o guard
      asyncHandler(async (req, res) => { … })
  );

  // src/backend/routes/sispag.ts:341-346 — precedente
  router.post(
      '/…/algo-pesado',
      requireRole('admin'),
      heavyRouteLimiter,                    // ← 10/min por IP
      asyncHandler(async (req, res) => { … })
  );
  ```
  Sob 100/min por IP, um admin (ou token roubado) pode consultar 100 lotes em 60 segundos. O número de lotes SISPAG ativos em produção é pequeno (dezenas por semana), então essa taxa exfiltra a carteira inteira em uma janela de rate-limit.
- **Impacto técnico**: enumeração massiva por loop de `curl` sem trigger de defesa (nenhum alarme em cima do rate-limiter).
- **Impacto de negócio**: mesma classe do `.REM` (banco/agência/conta do cedente). A dose faz o veneno — 1 consulta legítima é a operação normal; 100 consultas em 60s é padrão de exfiltração e deve custar tempo.
- **Métrica de baseline**: `heavyRouteLimiter` aplicado a esta rota = **não**; teto teórico de extração = **100 lotes/min por IP** (deveria ser 10/min).

### F-security-3: Rota mutadora/leitora de dado sensível sem trilha de auditoria persistida — sem "quem baixou a linha digitável de qual lote e quando"

- **Severidade**: **P2** (médio — dívida atravessada do `.REM`; para acomodar investigação post-mortem de vazamento é pré-requisito)
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/routes/sispag.ts:60-72` (nova rota) e `src/backend/routes/sispag.ts:453-476` (rota `.REM` — mesmo padrão, mesma dívida)
- **Evidência (objetiva)**:
  ```ts
  // O handler resolve o service e devolve JSON — não invoca nenhum
  // auditLog / audit repository / evento de domínio.
  router.get('/lotes/:id/linhas-digitaveis', requireRole('admin'), asyncHandler(async (req, res) => {
      await bootstrapAppContainer();
      const service = container.resolve(SispagPainelService);
      const itens = await service.linhasDigitaveisDoLote(String(req.params.id));
      res.json({ itens });
  }));
  ```
  `grep -rn "auditLog\|AuditRepository\|audit_events" src/backend/` na árvore de service/routes SISPAG não retorna nada. Cross-QA com Fault Tolerance (dívida do `.REM` já apontada em runs anteriores; esta rota herda a mesma superfície).
- **Impacto técnico**: se um vazamento for reportado, o forense parte de `console.log`s do Render (efêmeros, agregáveis por linha mas não por sessão de usuário) — não há tabela `audit_events` correlacionável com `req.user.sub` + `req.params.id` + timestamp.
- **Impacto de negócio**: LGPD Art. 37 pede registro de operações; sem trilha, uma auditoria interna não distingue "admin baixou 1 lote na sexta" de "admin baixou 42 lotes na sexta". Cross-ref: Fault Tolerance F-fault-tolerance-* (audit trail) e Availability (blast radius).
- **Métrica de baseline**: `# sites de "dado bancário sensível" cobertos por audit persistido` = **0/2** (`/linhas-digitaveis` + `/remessa/arquivo`).

### F-security-4: Estado React `linhas: Map<string, string>` mantém 47 dígitos vivos na página enquanto o card estiver expandido — sem risco imediato, mas convém explicitar

- **Severidade**: **P3** (baixo — não escreve em `storage`, não sai por telemetria; é observação de superfície)
- **Tactic violada**: Limit Exposure (defesa em profundidade no cliente)
- **Localização**: `src/frontend/app/sispag/components/LoteCard.tsx:153-167` (state) + `:180-183` (toast, já sem os 47 dígitos)
- **Evidência (objetiva)**:
  ```tsx
  const [linhas, setLinhas] = React.useState<Map<string, string>>(new Map())
  React.useEffect(() => {
    if (!aberto || isRascunho) return
    let vivo = true
    fetchLinhasDigitaveis(l.id)
      .then((itens) => {
        if (!vivo) return
        setLinhas(new Map(itens.map((i) => [`${i.docCod}:${i.titCod}`, i.linhaDigitavel])))
      })
      .catch(() => {
        if (vivo) setLinhas(new Map())
      })
    return () => { vivo = false }
  }, [aberto, isRascunho, l.id])
  ```
  Não há `localStorage`/`sessionStorage`. Não há SDK de telemetria (Sentry/PostHog) montado — verificado com grep na árvore `src/frontend/{app,lib,components}`. O toast só cita `docCod/titCod`. **Ainda assim**, a linha vive no heap do React DevTools enquanto o card estiver expandido, e o dia em que alguém adicionar Sentry ao frontend, um handler global de erro pode serializar props/state.
- **Impacto técnico**: nenhum hoje; abre risco quando o frontend ganhar telemetria de erro.
- **Impacto de negócio**: mínimo enquanto o SDK de erro não entrar; alto se entrar sem filtro.
- **Métrica de baseline**: `# integrações de telemetria no frontend` = **0** (por ora, o defensivo é: `linhaDigitavel` **nunca** deve viajar em breadcrumbs ou context de Sentry/similar quando montado).

## 5. Cards Kanban

### [security-1] Redigir `itsNumCodbar` no interceptor axios do Conexos (e adotar a redação também no ramo de resposta)

- **Problema**
  > O interceptor de resposta em `services/conexos.ts:145-152` faz `console.error('[CONEXOS ✗] body=${JSON.stringify(body)}')` sem redação. Sob `DEBUG_VERBOSE=1`, também loga o corpo de sucesso raw. A lista `SENSITIVE_KEYS` (L20-30) só cobre chaves de credencial — `itsNumCodbar` não está lá. Basta uma falha do ERP na chamada `fin015/finItemSispag/list` para semear a linha digitável (47 dígitos) no stdout do Render, canal legível por qualquer engenheiro com acesso à aplicação.

- **Melhoria Proposta**
  > (i) Adicionar `itsNumCodbar`, `numcodbar`, `linhadigitavel`, `codigo_barras`, `ditespcodbar` à `SENSITIVE_KEYS` em `services/conexos.ts:20`. (ii) Estender `redactSensitive` para valer também no ramo de resposta (sucesso e erro) do interceptor — hoje ele só é chamado no ramo de request. (iii) Cobrir com teste unitário do próprio interceptor: injetar um erro sintético cujo `err.response.data` contém `itsNumCodbar` de 47 dígitos e assertar que a string não aparece em nenhum `console.error` capturado. Tactic Bass: Limit Access (defesa em profundidade sobre logs).

- **Resultado Esperado**
  > Nenhuma linha digitável, ou qualquer dado bancário do fin015, aparece em stdout mesmo quando o ERP retorna 5xx com envelope preenchido. `itsNumCodbar` presente em `SENSITIVE_KEYS`: false → true. Sites de log de corpo de resposta sem redação: 2 → 0.

- **Tactic alvo**: Limit Access (Bass)
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - `itsNumCodbar in SENSITIVE_KEYS`: false → true
  - `console.error/log` sem redação no interceptor de resposta: 2 sites → 0
  - Teste unitário do interceptor que injeta `itsNumCodbar` no `err.response.data`: 0 → 1 (com assertion `expect(logs).not.toMatch(/\d{47}/)`)
- **Risco de não fazer**: o guard `requireRole('admin')` fecha a porta da frente; sem esta redação, cada oscilação do Conexos escreve, no log de erro, a linha digitável do lote em execução. Um insider com acesso ao Render extrai a carteira sem tocar na API.
- **Dependências**: nenhuma

### [security-2] Aplicar `heavyRouteLimiter` (10/min) na rota `/lotes/:id/linhas-digitaveis` — e no precedente `/lotes/:id/remessa/arquivo`

- **Problema**
  > `GET /sispag/lotes/:id/linhas-digitaveis` está apenas sob `globalLimiter` (100 req/min por IP). O `.REM` (mesma classe de dado — banco/agência/conta do cedente) está no mesmo teto. Um admin comprometido pode enumerar a carteira inteira em uma janela de 60s. As outras rotas SISPAG com fan-out ao Conexos já usam `heavyRouteLimiter` (10/min).

- **Melhoria Proposta**
  > Aplicar `heavyRouteLimiter` **antes** do handler nas duas rotas: `routes/sispag.ts:63` (novo) e `routes/sispag.ts:454` (`/remessa/arquivo`). Manter o `requireRole('admin')`. Tactic Bass: Limit Exposure.

- **Resultado Esperado**
  > Teto de exfiltração cai de 100 lotes/min para 10 lotes/min por IP em ambas as rotas de dado bancário. Rate-limiter passa a compor com o guard, reduzindo blast radius de um token de admin comprometido.

- **Tactic alvo**: Limit Exposure (Bass)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Rotas de dado bancário cobertas por `heavyRouteLimiter`: 0/2 → 2/2
  - Teto teórico de extração por minuto: 100 → 10
- **Risco de não fazer**: token de admin roubado ou script malicioso de operador legítimo consome a carteira inteira sem trigger. Se o card `security-3` ainda não estiver de pé, o forense não tem nem log estruturado para reconstituir o incidente.
- **Dependências**: convém alinhar com o card de audit trail (`security-3`) para dar ao alarme algo para se apoiar.

### [security-3] Trilha de auditoria persistida para as rotas que expõem dado bancário do lote (`linhas-digitaveis`, `.REM`)

- **Problema**
  > Nenhuma das duas rotas registra "quem baixou a linha digitável / o `.REM` de qual lote e quando" numa tabela local. O único vestígio é o `console.log` do interceptor Conexos — efêmero, agregável por linha mas não por sessão de usuário. Uma auditoria LGPD (Art. 37) não consegue diferenciar "1 consulta legítima" de "42 consultas em 5 minutos".

- **Melhoria Proposta**
  > Persistir uma linha em `audit_events` (a criar, ou reaproveitar tabela análoga se já vier de outra frente) na entrada dos dois handlers: `{ user_sub, user_role, action: 'sispag.linhas-digitaveis.read' | 'sispag.remessa.download', lote_id, filCod, timestamp, request_id, ip }`. **Nunca** persistir a linha digitável em si — só o metadata do acesso. Alarmar em `count > N por (user_sub, hora)`. Tactic Bass: Audit Trail. Cross-QA com Fault Tolerance (mesma dívida) e Availability (blast radius de admin comprometido).

- **Resultado Esperado**
  > Toda leitura de dado bancário do lote fica gravada com autor + alvo + hora, permitindo forense em minutos ao invés de horas. Cobertura de audit em rotas sensíveis: 0/2 → 2/2. Base para o alarme de enumeração (card futuro).

- **Tactic alvo**: Audit Trail (Bass)
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — inclui a tabela + migration + repo + integração nos handlers + testes
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Rotas de dado bancário com audit persistido: 0/2 → 2/2
  - Colunas obrigatórias em `audit_events`: `user_sub, action, target_id, ts` — todas NOT NULL, sem `linhaDigitavel` gravada
- **Risco de não fazer**: acúmulo de dívida atravessa a implantação; um vazamento reportado 30 dias depois não é rastreável.
- **Dependências**: alinhamento com o consolidador — Fault Tolerance provavelmente já tem card análogo; consolidar em UM único card se for o caso.

## 6. Notas do agente

- Escopo `--quick` respeitado: sem `infra/` neste repo, sem varreduras de dependência profundas (só `npm audit --omit=dev`; 2 moderate transitivas, dentro do alvo).
- **Controles do delta que valem repetir**: `requireRole('admin')` + teste 403 + Zod `/^\d{47}$/` + service que não loga o valor. A frente está bem servida — o gap está na **camada de client** (interceptor axios, herdado do template) e no **rate-limit** (herdado da postura do `.REM`).
- Cross-QA para o consolidador: (i) `security-3` overlap direto com Fault Tolerance (audit trail); (ii) `security-2` overlap com Availability (blast radius e proteção do fan-out ao Conexos); (iii) validação Zod da linha digitável tangencia Integrability (o Conexos vira o pino do contrato — regex estrita evita o `?? ''` do ADR-0040).
- **Finding F-security-4** (heap do React) é P3 mais como aviso ao futuro: no dia em que Sentry/PostHog entrarem no frontend, esta linha vira breadcrumb se ninguém filtrar. Registro aqui para que o consolidator lembre no próximo run pós-instrumentação.
- Rate-limit não instrumentado com alarme — Render não expõe métricas granulares de 429; considerar migrar o `express-rate-limit` para um store Redis com contador exportável quando o time tiver observability layer.
