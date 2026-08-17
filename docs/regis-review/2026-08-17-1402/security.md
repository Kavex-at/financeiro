---
qa: Security
qa_slug: security
run_id: 2026-08-17-1402
agent: qa-security
generated_at: 2026-08-17T14:02:00-03:00
scope: backend
score: 6
findings_count: 5
cards_count: 5
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista autenticado de uma filial (ex.: filial 4), com token Supabase válido sem o claim `filiais` provisionado (situação real hoje — o token só carrega `sub`/`email`/`role`) | Envia `GET /recebimentos/painel` (sem `filCod`) | `NdeRepository.listParaPainel` + `contarPendentes` + `RecebimentosPainelService.hidratarNdes` (executa writes `setNdeAutorizado`/`updateNumeroNde` durante a hidratação) | Produção com `arquivadas=false` / carteira ativa | O sistema DEVE responder apenas com linhas das filiais explicitamente permitidas ao usuário, jamais devolvendo NDes/execuções/erros de outras filiais, e jamais gravando em execuções de outras filiais | 100% das linhas de resposta pertencem a filiais que o `sub` do usuário está autorizado a ver; 0 writes fora do escopo do usuário; nenhuma mensagem crua do ERP (Conexos) chega ao browser sem sanitização |

Cenário concreto de falha atualmente possível: um usuário autenticado com um token Supabase legítimo (analista de uma filial isolada) faz `GET /recebimentos/painel`. Como o token não carrega `filiais`, `filiaisPermitidas(req.user)` devolve `undefined`, o service cai no fallback `this.base.getFiliais()` e devolve TODAS as filiais do ERP — o usuário lê NDes, `numeroNde`, `ndDocCod` e `erroMensagem` de todas as filiais. Pior: o próprio GET dispara `setNdeAutorizado`/`updateNumeroNde` em `solicitacao_numerario_execucao`/`nota_debito_eletronica` de linhas de outras filiais, escritas silenciosas (`.catch(() => undefined)`), sem audit trail.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| SQL parametrizado nas queries novas (`listParaPainel`, `contarPendentes`) | 100% (`$filCods` via `SqlBuilder`, `ANY($1)` bindado como array pg — nenhum split/join manual) | 100% (Rule #5) | ✅ | `src/backend/domain/repository/recebimentos/NdeRepository.ts:22-27,88-115` + `src/backend/domain/libs/sql/SqlBuilder.ts:7-34` |
| Rotas do delta com `Authorize Actors` por-filial ANTES do repo (não só `Authenticate`) | 1/1 (`/painel` valida o `filCod` explícito via `assertUserCanActOnFilial`, mas o modo "todas as filiais" bypassa o guard por omissão) | 1/1 sem bypass | ⚠️ | `src/backend/routes/recebimentos.ts:113-150`; `src/backend/http/filialAuthz.ts:37-50` |
| Usuários hoje sem allow-list `filiais` no JWT (Supabase padrão) | 100% (o claim NÃO é emitido — comentário `filialAuthz.ts:11-19` e `auth.ts:24-27` explicitam) | 0% (todo usuário multi-tenant tem allow-list) | ❌ | `src/backend/http/auth.ts:20-27,79-86` + comentário-alvo em `filialAuthz.ts:11-24` |
| Writes disparadas por um método HTTP GET (violação de safe-method) | 2 (`setNdeAutorizado`, `updateNumeroNde` durante `hidratarNdes`) | 0 (mover para job / POST reconcile) | ❌ | `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:284-303` |
| Audit trail das reconciliações disparadas pelo GET (quem/quando/qual `idempotency_key`/valor antes-e-depois) | 0 registros — write silenciosa, `.catch(() => undefined)` sem log | ≥1 log estruturado por write, com `ator`, `idempotencyKey`, `numeroNde`, `filCod` | ❌ | `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:297-302` |
| Vazamento de mensagem crua do ERP (Conexos) ao browser via `erroMensagem` | 1 (backend expõe `String(r.erro_mensagem)`; frontend renderiza cru em `title=` + texto) | 0 (sanitizar / mapear para código estável) | ⚠️ | `src/backend/domain/repository/recebimentos/NdeRepository.ts:167`; `src/frontend/app/recebimentos/components/NdeTable.tsx:113-118` |
| Rate-limit no `/painel` (o endpoint agora carrega write side-effects) | 0 (sem `heavyRouteLimiter` — só rotas `POST` do arquivo o têm) | Rate-limit aplicado (mesmo teto do `heavyRouteLimiter`) | ⚠️ | `src/backend/routes/recebimentos.ts:113-150` (compare `pipeline/run:167` que usa `heavyRouteLimiter`) |
| Hardcoded secrets / `.env` no delta | 0 | 0 (Rule #1) | ✅ | `git diff main --stat` + inspeção de `NdeRepository.ts` / `RecebimentosPainelService.ts` |
| `npm audit` profundo | ⚠️ **Não medível localmente** neste run (`--quick` proíbe) | critical=0, high=0 | ⚠️ | Ver `_shared-metrics.md` (nota de escopo) |

> ⚠️ **Não medível localmente**: distribuição real de tokens (quantos têm o claim `filiais` provisionado em produção). Requer log de emissão de JWT ou dump de `permissions` do provisionamento no Supabase. Sem isso, o modelo assume o pior — nenhum token tem allow-list, e a rota é aberta a todas as filiais.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Ausente para a nova superfície (nenhum alarme para "usuário X leu N filiais fora do padrão") | ❌ ausente | (grep vazio por `logService`/`logger` em `RecebimentosPainelService.ts`) |
| Detect Service Denial | `heavyRouteLimiter` aplicado em POSTs money-moving, mas NÃO no novo `/painel` que agora dispara N `GET com297/{docCod}` por request | ⚠️ parcial | `src/backend/routes/recebimentos.ts:113-150` × `:167`; `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:250-271` |
| Verify Message Integrity | Zod no boundary do body/query; SQL parametrizado | ✅ presente | `src/backend/routes/recebimentos.ts:92-105`; `src/backend/domain/libs/sql/SqlBuilder.ts` |
| Detect Message Delay | N/A — GET síncrono; a hidratação usa best-effort `.catch(() => undefined)` e não mede latência do ERP para alertar | N/A | — |
| Identify Actors | `sub`/`email` extraídos do JWT (Supabase JWKS/HS256) | ✅ presente | `src/backend/http/auth.ts:61-73,118-196` |
| Authenticate Actors | `buildAuthMiddleware` valida assinatura, `aud=authenticated`, `iss=${SUPABASE_URL}/auth/v1` | ✅ presente | `src/backend/http/auth.ts:118-196` |
| Authorize Actors | Delta: `filiaisPermitidas` + `assertUserCanActOnFilial`. **Fail-OPEN** quando o claim está ausente (que é a situação real hoje) — a rota degrada para "todas as filiais" | ⚠️ parcial (fail-open) | `src/backend/http/filialAuthz.ts:37-50`; `src/backend/routes/recebimentos.ts:68-74,123-138`; `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:320-325` |
| Limit Access | `filCods` são o filtro principal do `WHERE e.fil_cod = ANY($filCods)` — quando a allow-list existe o repo é escopado; quando não existe, o service RESOLVE PARA TODAS antes do repo | ⚠️ parcial | `src/backend/domain/repository/recebimentos/NdeRepository.ts:24` + fallback `RecebimentosPainelService.ts:321-325` |
| Limit Exposure | `erroMensagem` do ERP (`err.message` do Conexos) flui cru pelo repo para o browser via `NdeTable.tsx` | ⚠️ parcial | `NdeRepository.ts:167`; `RecebimentoPipelineService.ts:317`; `NdeTable.tsx:113-118` |
| Encrypt Data | HTTPS em produção (Render/Vercel) — não alterado pelo delta | ✅ presente (pré-existente) | — |
| Separate Entities | Filiais isoladas por `fil_cod` na mesma tabela; sem isolamento por schema/DB — aceitável no modelo multi-filial (não multi-tenant AWS por conta) | ✅ presente (design) | `NdeRepository.ts:22-27` |
| Change Default Settings | N/A | N/A | — |
| Validate Input | Zod em `painelQuerySchema` (`filCod`/`limit`/`incluirTesouraria`/`arquivadas`) | ✅ presente | `src/backend/routes/recebimentos.ts:92-105,117-121` |
| Revoke Access | Delegado ao Supabase (revogação de token); não há revocation list local | ✅ presente (pré-existente) | — |
| Lock Computer | N/A (não faz sentido para API server) | N/A | — |
| Inform Actors | Nenhum aviso ao usuário/ops quando o fail-open é acionado (nenhum log "usuário sem allow-list ampliado para N filiais") | ❌ ausente | `RecebimentosPainelService.ts:320-325` |
| Restore | Escrita local reversível (`nde_autorizado` / `numero_nde` — updates por idempotency_key), sem soft-delete/versioning | ✅ presente (parcial) | `SolicitacaoNumerarioExecucaoRepository.ts:186-193`; `NdeRepository.ts:117-124` |
| Audit Trail | **AUSENTE** para as duas writes disparadas pelo GET. `.catch(() => undefined)` come inclusive a falha; nada em `logService` ou em tabela de auditoria | ❌ ausente | `RecebimentosPainelService.ts:297-302` |

## 4. Findings

### F-security-1: Fail-open de authz por-filial em `/painel` — token sem claim `filiais` vira acesso a todas as filiais

- **Severidade**: P0
- **Tactic violada**: Authorize Actors / Limit Access
- **Localização**: `src/backend/http/filialAuthz.ts:37-50`; `src/backend/routes/recebimentos.ts:68-74,123-138`; `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:320-325`
- **Evidência (objetiva)**:
  ```ts
  // filialAuthz.ts:45-50
  export const userCanActOnFilial = (user, filCod) => {
      if (!user) return false;
      const permitidas = filiaisPermitidas(user);
      if (permitidas === undefined) return true;   // ← fail-OPEN
      return permitidas.includes(filCod);
  };

  // RecebimentosPainelService.ts:321-325
  private resolverFilCods = async (permitidas?: number[]): Promise<number[]> => {
      if (permitidas && permitidas.length > 0) return permitidas;
      const filiais = await this.base.getFiliais();        // ← TODAS as filiais do ERP
      return filiais.map(f => Number(f.filCod)).filter(...);
  };

  // auth.ts:24-27 (documentando que o claim NÃO é emitido hoje)
  // "Absent today (Supabase tokens carry only sub/email/role) —
  //  the seam is ready for the real claim."
  ```
- **Impacto técnico**: qualquer usuário autenticado hoje (100% dos usuários, pois nenhum token Supabase carrega o claim `filiais` — vide `auth.ts:24-27`) lê NDes/execuções de TODAS as filiais no `GET /painel`. A rota é a superfície mais rica do delta: `numeroNde`, `ndDocCod`, `valor`, `correlationId`, `erroMensagem` cru do Conexos, e — via KPIs — o `count(*)` global de NDes pendentes de toda a empresa.
- **Impacto de negócio**: quebra do isolamento multi-filial (a maior promessa do produto para clientes multi-filial). Um analista de uma unidade extrai o backlog fiscal (NDes que travaram no SEFAZ) de outra unidade, junto com a mensagem crua do ERP que descreve o motivo — playbook para engenharia social interna e para reconhecimento de vulnerabilidade operacional. Piora se a base de usuários crescer sem a migração do claim.
- **Métrica de baseline**: 100% dos tokens em produção hoje NÃO carregam `filiais` (documentado no próprio código). Bypass = 100% dos usuários. Filiais expostas = N (todas as retornadas por `ConexosBaseClient.getFiliais()`).

### F-security-2: `GET /recebimentos/painel` executa WRITEs em `solicitacao_numerario_execucao` e `nota_debito_eletronica` (safe-method violation, sem audit)

- **Severidade**: P0
- **Tactic violada**: Audit Trail / Limit Exposure / (higiene HTTP: safe method)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:284-303`; `src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts:186-193`; `src/backend/domain/repository/recebimentos/NdeRepository.ts:117-124`
- **Evidência (objetiva)**:
  ```ts
  // RecebimentosPainelService.ts:284-303  (dentro de hidratarUma, chamado por GET /painel)
  await this.execucaoRepo.setNdeAutorizado(nde.idempotencyKey, true).catch(() => undefined);
  if (numeroNde !== undefined && numeroNde !== nde.numeroNde) {
      await this.ndeRepo
          .updateNumeroNde(nde.idempotencyKey, numeroNde)
          .catch(() => undefined);
  }
  ```
- **Impacto técnico**: (1) violação da semântica de GET (safe method) — proxies/CDN/retry automático podem replay-ar o GET e dobrar escritas; (2) as UPDATEs mudam o estado da NDe (`numero_nde`, `nde_autorizado`) que a UI mostra como "autorizada SEFAZ" — decisão fiscal do painel — SEM audit trail: `ator`, timestamp, valor antes/depois. `.catch(() => undefined)` come também qualquer falha, então uma constraint violation silenciosa some. Combinado com F-security-1 (fail-open), um usuário de uma filial dispara reconciliação em linhas de outras filiais.
- **Impacto de negócio**: quando uma NDe autorizada por erro depois virar disputa/estorno, não há trilha de "quem foi o requester que causou o `setNdeAutorizado(true)`". A escrita chega no Postgres como se fosse o sistema — indistinguível do poll oficial (`recebimentoNumerarioService`). Impossível fazer post-mortem de incidente fiscal.
- **Métrica de baseline**: 0 registros em qualquer log/tabela para as writes do painel. `grep -n "logService\|logger\." RecebimentosPainelService.ts` → vazio. Falhas silenciosas: `.catch(() => undefined)` em 297 e 300.

### F-security-3: Vazamento de mensagem crua do Conexos via `erroMensagem` (Limit Exposure)

- **Severidade**: P1
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/domain/repository/recebimentos/NdeRepository.ts:167`; `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts:317`; `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1649`; `src/frontend/app/recebimentos/components/NdeTable.tsx:113-118`
- **Evidência (objetiva)**:
  ```ts
  // NdeRepository.ts:167 — repo do delta
  ...(r.erro_mensagem != null ? { erroMensagem: String(r.erro_mensagem) } : {}),

  // RecebimentoPipelineService.ts:317 (produtor da mensagem, pré-existente)
  erroMensagem: err instanceof Error ? err.message : String(err),

  // NdeTable.tsx:113-118 (renderização no browser)
  {n.erroMensagem !== undefined && (
    <div className="mt-1 flex items-start gap-1.5 text-xs text-danger">
      <AlertTriangle ... />
      <span title={n.erroMensagem}>{n.erroMensagem}</span>
    </div>
  )}
  ```
- **Impacto técnico**: `err.message` de calls Conexos (com297/com299/fin014) contém stack semântica interna do ERP — códigos internos (`RECORDNOTFOUND`, `NDE_ACL_INSUFICIENTE`), nomes de tabelas legadas, às vezes SQL parcial em erros de leg fiscal. Renderizado em `<span title={...}>` e como texto visível na aba NDe do painel. Combinado com F-security-1, um usuário lê os erros do ERP de todas as filiais.
- **Impacto de negócio**: revela superfície interna do ERP (identificadores de negócio, nomes de campos) — insumo para insider preparar uma manipulação futura, e para vazamento externo se a UI aparecer em screenshots/vídeos de treinamento. Não bloqueia operação, mas erode a defesa em camadas.
- **Métrica de baseline**: 1 caminho ativo hoje (`erroMensagem` renderizado sem sanitização). Zero mapeamento erro-ERP → código-estável.

### F-security-4: `GET /painel` sem rate-limit apesar de disparar N chamadas ao Conexos e M writes locais

- **Severidade**: P1
- **Tactic violada**: Detect Service Denial (defesa contra amplificação)
- **Localização**: `src/backend/routes/recebimentos.ts:113-150` × comparar com `src/backend/routes/recebimentos.ts:165-167` (pipeline/run tem `heavyRouteLimiter`); `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:250-271` (loop de hidratação com `Promise.all` em lotes de `PAINEL_NDE_HIDRATACAO_LOTE`)
- **Evidência (objetiva)**:
  ```ts
  // recebimentos.ts:113 — SEM heavyRouteLimiter
  router.get(
      '/painel',
      asyncHandler(async (req, res) => { ... })
  );

  // pipeline/run POST — TEM
  router.post('/pipeline/run', heavyRouteLimiter, requireRole('admin'), ...)
  ```
- **Impacto técnico**: cada `GET /painel` agora dispara: 6 queries em paralelo (`Promise.all`), + fan-out de `GET com297/{docCod}` (uma por NDe candidata, capado em `PAINEL_NDE_HIDRATACAO_CAP`), + writes por linha reconciliada. Um usuário autenticado atacando com F5-loop amplifica: 1 request cliente → dezenas de requests ao ERP + writes no Postgres. O ERP Conexos é o gargalo compartilhado com todas as frentes (Permutas, SISPAG, GED).
- **Impacto de negócio**: degradação global — um analista sozinho pode derrubar o backend Conexos para todas as frentes financeiras. Sem alarme (F-security-1 e F-security-2 confirmam a ausência de logging aqui) o time descobre pelo suporte da Columbia.
- **Métrica de baseline**: 0 rate-limits em `/painel`. Fan-out atual = até `PAINEL_NDE_HIDRATACAO_CAP` GETs ao Conexos por request (constante já definida em `constants.ts`).

### F-security-5: Ausência de audit trail estruturado para as reconciliações disparadas pelo painel

- **Severidade**: P1
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:284-303` (writes) e `src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts:186-193` / `NdeRepository.ts:117-124` (queries UPDATE)
- **Evidência (objetiva)**:
  ```
  grep -n "logService\|logger\." /tmp/nde-painel-wt/src/backend/domain/service/recebimentos/RecebimentosPainelService.ts
  → (vazio)
  ```
  As duas UPDATEs sobem sem `who/when/before/after` — nem `ator`, nem `req.user.sub`, nem `req.headers['x-request-id']` propagam para o repo.
- **Impacto técnico**: um `setNdeAutorizado(key, true)` chegou ao banco — sem log, ninguém sabe qual request causou. Overlap direto com Fault Tolerance (a proposta faz audit trail requisito não-negociável em toda ação que resolva estado financeiro).
- **Impacto de negócio**: em uma disputa fiscal sobre uma NDe indevidamente autorizada, não é possível provar que a autorização veio do poll oficial e não de uma leitura do painel de um analista qualquer. Aumenta o custo de auditoria externa (Big-4 / Receita) e viola o requisito de trilha por ator na frente Recebimentos.
- **Métrica de baseline**: 0 logs por write. 0 registros em qualquer tabela `audit_*` para esse caminho.

## 5. Cards Kanban

### [security-1] Fechar o fail-open de authz por-filial no `/painel` (deny-by-default quando o claim não existe)

- **Problema**
  > Hoje, `filiaisPermitidas(req.user) === undefined` (que é o estado de 100% dos tokens Supabase, por documentação própria do código em `auth.ts:24-27`) faz o `RecebimentosPainelService.resolverFilCods` cair no fallback `base.getFiliais()` — o `GET /recebimentos/painel` devolve NDes de TODAS as filiais e o `WHERE e.fil_cod = ANY($filCods)` deixa de ser barreira. Combinado com F-security-2, o mesmo GET dispara writes em execuções de outras filiais.

- **Melhoria Proposta**
  > Inverter o default para deny-by-default: sem allow-list explícita no token, o usuário só vê as filiais expressamente configuradas em uma tabela `app_user_filial` (ou claim `permissions.filiais` no JWT). Emitir o claim `filiais` no Supabase (JWT hook / SQL function) ou provisionar a tabela e trocar `filiaisPermitidas` para lê-la fail-closed. O modo atual só sobrevive atrás de uma flag `AUTHZ_FILIAL_LEGACY_OPEN=true` (default false), com aviso vermelho no boot e log de cada request que a usa. Tactic: **Authorize Actors** + **Limit Access**.

- **Resultado Esperado**
  > `GET /recebimentos/painel` sem allow-list responde 403 (ou lista vazia com aviso "usuário sem filial vinculada — procure o admin"). Nenhum tenant multi-filial expõe NDes cruzadas.
  > Métrica: `% de usuários com allow-list provisionada` = 0% → 100%; `# de rotas com fallback fail-open` = 1 → 0.

- **Tactic alvo**: Authorize Actors
- **Severidade**: P0
- **Esforço estimado**: M (2–5d) — decisão + hook Supabase + migração de todos os usuários + reflexo em SISPAG (mesma primitiva)
- **Findings relacionados**: F-security-1, F-security-2 (multiplicador)
- **Métricas de sucesso**:
  - Cobertura do claim `filiais` nos tokens de produção: 0% → 100%
  - `# rotas com fail-open documentado`: 1 → 0
  - Novos testes: assert que sem allow-list o `/painel` devolve 403 (não 200 com N linhas)
- **Risco de não fazer**: quebra de isolamento multi-filial se manifesta como incidente de vazamento no primeiro cliente multi-filial (Columbia já é multi-filial); regulador/Big-4 tratam como perda de segregação de funções.
- **Dependências**: alinhamento com o time de auth Supabase (hook JWT) e com o OntologyCurator (entidade `UsuarioFilial`).

### [security-2] Remover as writes do path GET `/painel` (mover para POST reconcile ou job) e instrumentar audit trail

- **Problema**
  > `RecebimentosPainelService.hidratarUma` chama `execucaoRepo.setNdeAutorizado(key, true)` e `ndeRepo.updateNumeroNde(key, numeroNde)` dentro do `GET /recebimentos/painel`. Isso (a) viola a semântica de safe method (retry/preflight/CDN pode replay-ar), (b) não deixa audit trail (`.catch(() => undefined)` engole falha), (c) combinado com F-security-1 grava em linhas de outras filiais.

- **Melhoria Proposta**
  > Extrair as duas writes para um caminho explícito: (i) `POST /recebimentos/reconciliacao/nde/:idempotencyKey` idempotente + `requireRole('admin')` + `heavyRouteLimiter`, disparado pelo frontend quando o hydrate detecta autorização SEFAZ; OU (ii) mover para um `job/reconcile-nde-sefaz` no scheduler, que já é o dono natural do polling. Em ambos, logar `logService.info({ event: 'nde.reconciliado', ator, idempotencyKey, numeroNdeAntes, numeroNdeDepois, filCod })` e gravar em `nde_audit` (nova tabela). Tactic: **Audit Trail** + higiene de safe-method.

- **Resultado Esperado**
  > `GET /painel` é 100% read-only. Toda reconciliação de NDe deixa rastro por ator/timestamp em log estruturado e em tabela de auditoria.
  > Métrica: `# writes em handler GET` = 2 → 0; `# eventos auditados por reconciliação` = 0 → 1.

- **Tactic alvo**: Audit Trail (+ Verify Message Integrity via idempotência explícita)
- **Severidade**: P0
- **Esforço estimado**: M (2–5d) — extrair rota/job + migração de tabela `nde_audit` + testes de contrato
- **Findings relacionados**: F-security-2, F-security-5
- **Métricas de sucesso**:
  - Writes em GET: 2 → 0
  - Cobertura de log por reconciliação: 0% → 100%
  - Tabela `nde_audit` populada em todos os testes de integração de reconciliação
- **Risco de não fazer**: um incidente fiscal com NDe indevidamente autorizada é irrastreável; auditoria externa vira exercício de reconstituição manual de logs de HTTP.
- **Dependências**: security-1 (para o eventual `POST reconcile` já nascer com authz fechada).

### [security-3] Sanitizar `erroMensagem` do ERP antes de sair do backend (mapa erro→código estável)

- **Problema**
  > Mensagens cruas do Conexos (`err.message` capturado em `RecebimentoPipelineService.ts:317` e `RecebimentoNumerarioService.ts:1649`) chegam ao painel via `NdeRepository.mapPainelRow:167` e são renderizadas em `NdeTable.tsx:113-118` (texto + `title`). Com F-security-1 aberta, um usuário lê a superfície interna do ERP de todas as filiais.

- **Melhoria Proposta**
  > No backend, mapear `err.message` para um código estável (`NDE_ERR_RECORDNOTFOUND`, `NDE_ERR_ACL`, `NDE_ERR_TIMEOUT`, `NDE_ERR_DESCONHECIDO`) + mensagem curta pt-BR pré-aprovada. `erpResponse` continua persistido para audit interno, mas o `NdePainelRow.erroMensagem` deixa de ser passthrough. `NdeTable.tsx` renderiza `mensagemLegivel` + `codigo` (não mais o cru). Tactic: **Limit Exposure**.

- **Resultado Esperado**
  > O browser vê `"Documento não encontrado no ERP (NDE_ERR_RECORDNOTFOUND)"`, não `"RECORDNOTFOUND na tabela DBA.OWN_..."` cru.
  > Métrica: `# passthroughs de err.message → HTTP` = 1 → 0.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P1
- **Esforço estimado**: S (≤1d) — dicionário + sanitizador no repo + snapshot test do NdeTable
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Cobertura de códigos estáveis nos erros do painel: 0% → 100%
  - Nenhum snapshot do frontend contém tokens de campo do ERP (`RECORD`, `OWN_`, `DBA`, `NULL VALUE`)
- **Risco de não fazer**: screenshots de treinamento com erros crus viram material de reconhecimento; suporte da Columbia expõe internos do ERP sem intenção.
- **Dependências**: nenhuma técnica — precisa alinhamento com o suporte para o dicionário inicial.

### [security-4] Aplicar `heavyRouteLimiter` + backpressure no `GET /painel`

- **Problema**
  > `GET /recebimentos/painel` agora dispara 6 queries em paralelo + fan-out de `GET com297/{docCod}` pela hidratação. Um F5-loop autenticado amplifica em dezenas de calls ao Conexos por segundo — mesmo ERP compartilhado com Permutas/SISPAG/GED.

- **Melhoria Proposta**
  > Aplicar `heavyRouteLimiter` no `/painel` (mesmo teto do POST `/pipeline/run`); adicionar cache de resposta por-usuário-por-filial com TTL curto (≤ 30s) para reduzir hidratação redundante; considerar `ETag`/`If-None-Match`. Tactic: **Detect Service Denial** (defesa por rate-limit) + **Limit Exposure** (à amplificação).

- **Resultado Esperado**
  > Um único usuário não consegue amplificar a carga sobre o Conexos além do teto do limiter (já usado em POSTs money-moving).
  > Métrica: `# rotas GET com fan-out externo sem rate-limit` = 1 → 0.

- **Tactic alvo**: Detect Service Denial
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - QPS máximo por usuário em `/painel`: infinito → mesmo teto do `heavyRouteLimiter`
  - Alarme quando o limiter dispara acima de N/min por usuário
- **Risco de não fazer**: um analista curioso derruba o Conexos para todas as frentes em uma manhã de fechamento; incidente global com origem indistinguível.
- **Dependências**: nenhuma.

### [security-5] Log estruturado das reconciliações silenciosas (`.catch(() => undefined)` → log + métrica)

- **Problema**
  > `setNdeAutorizado(...).catch(() => undefined)` e `updateNumeroNde(...).catch(() => undefined)` engolem falhas sem log. Se o Postgres rejeitar (constraint, conflito), o painel não sabe — a UI mostra "autorizado" que não persistiu.

- **Melhoria Proposta**
  > Substituir `.catch(() => undefined)` por `.catch(err => logService.warn({ event: 'nde.reconciliacao.silenciosa.falhou', idempotencyKey, err: err.message }))`. Emitir métrica CloudWatch (ou o equivalente Render) `nde_reconcile_silent_failures`. Tactic: **Audit Trail** + **Inform Actors**.

- **Resultado Esperado**
  > Toda falha de reconciliação vira log + métrica; alarme quando > N/min.
  > Métrica: `# catches sem log em código novo` = 2 → 0.

- **Tactic alvo**: Audit Trail
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-5, F-security-2
- **Métricas de sucesso**:
  - Cobertura de log em `.catch` do RecebimentosPainelService: 0/2 → 2/2
  - Alarme configurado no observability
- **Risco de não fazer**: falhas silenciosas se acumulam; "reconciliado no painel, não persistido" vira um bug que só aparece quando o poll oficial roda depois e sobrescreve tudo (dificultando reproduzir).
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo respeitou DELTA + `--quick`: não rodei `npm audit` profundo; não auditei o restante do repo além do necessário para contextualizar (auth middleware, DB client / SqlBuilder para confirmar parametrização segura de `ANY($1)`).
- Confirmações positivas do delta: (a) SQL 100% parametrizado — `SqlBuilder.build` converte `$filCods` em `$1` e bindA o array como parâmetro pg, sem interpolação de string; (b) query nova respeita `fil_cod = ANY($filCods)` como filtro primário; (c) Zod no boundary.
- Cross-QA para o consolidator: **F-security-2 / card security-2** overlap direto com Fault Tolerance (audit trail) e Deployability (semantica de safe-method e replay); **card security-4** overlap com Availability (blast radius sobre Conexos); **F-security-3** overlap com Integrability (mapeamento estável de erros do ERP).
- P0s (security-1 e security-2) devem re-entrar no loop do AutoLoopRunner conforme regra do Regis-Review gate.
