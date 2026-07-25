---
qa: Security
qa_slug: security
run_id: 2026-07-24-2153
agent: qa-security
generated_at: 2026-07-24T21:53:00Z
scope: backend
score: 8.5
findings_count: 5
cards_count: 5
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Ator autenticado malicioso (analista com token válido) ou atacante externo com token roubado | POST em `/recebimentos/pipeline/run` com `correlationId`/`filCod`/`contaDestino`/`valorRecebido` escolhidos por ele — tenta abrir borderô, gravar baixa e emitir NDe em nome de outra filial | Rota Express + coordinator + write-ahead ledger `recebimento_execucao` (Módulo 5 emite crédito real ao ERP quando os stubs virarem reais) | Produção quando `RECEBIMENTOS_ENABLED=true` (fail-safe fora do prod) | Cadeia autentica JWT → `requireRole('admin')` → `recebimentosGate` (403 se disabled) → `heavyRouteLimiter` → Zod `safeParse` no body → ledger idempotente sob `Idempotency-Key` → SQL 100% parametrizado (`$id`,`$key`) | 0 SQL interpolado nos 6 repos, 100% dos writes atrás de `requireRole('admin')`, 100% dos boundaries com Zod, 0 leak de PII em logs (`redactBody` + convenção `MetricsEvent` sem PII), 0 segredos hardcoded, 100% do env via `EnvironmentProvider` |

> Frente IV é escopo money-moving (Módulo 5 chamará `criarBordero` + `gravarBaixa` + `emitirNde` no ERP). No SKELETON toda a execução é stubbed; o julgamento aqui é sobre a POSTURA DE SEGURANÇA DOS SEAMS — se as costuras estão certas para o dia em que o token for trocado do stub para a implementação real. Auth em write-routes + SQL safety são as jóias da coroa.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| SQL parametrizado nos 6 repos novos | 6 / 6 (100%) — todos usam `$key`/`$id`/`$correlationId` | 100% (Inviolable Rule #5) | ✅ | `grep -rEn '\$\{' src/backend/domain/repository/recebimentos/` → 0 hits |
| Boundaries Zod na rota (`/recebimentos/pipeline/run`) | 1 / 1 (100%) — `runPipelineSchema.safeParse(req.body)` | 100% | ✅ | `routes/recebimentos.ts:35-42,52` |
| Write-routes com `requireRole` | 1 / 1 (`POST /pipeline/run`) — espelha `sispag.ts` | 100% dos writes | ✅ | `routes/recebimentos.ts:49` + `http/auth.ts:183-200` |
| Segredos hardcoded no scaffold | 0 | 0 (Inviolable Rule #1) | ✅ | `grep -rEn "(password\|secret\|token\|api[_-]?key)\s*[:=]\s*['\"][^'\"]{8,}"` → 0 |
| `process.env` direto (fora de `EnvironmentProvider`) | 0 no scaffold Frente IV | 0 (Inviolable Rule #8) | ✅ | `grep -rn 'process\.env' src/backend/domain/{interface,repository,service}/recebimentos/ routes/recebimentos.ts http/recebimentosGate.ts` |
| Recebimentos gate posture fora de prod | `RECEBIMENTOS_ENABLED=true|false` força; ausente → habilitado NÃO-prod, bloqueado EM prod (fail-safe) | fail-safe em prod | ✅ | `EnvironmentProvider.resolveRecebimentosEnabled:47-52` |
| PII em `MetricsEvent.attributes` | Convenção documentada ("Counters/flags/enums only — NEVER PII"); MetricsPortStub reencaminha via `LogService.info`, que passa pelo `redactBody` do middleware inbound apenas — mas o `emit` sai fora do path do redactor | Tipo não impede; disciplina documentada | ⚠️ (parcial — sem enforcement runtime) | `ports.ts:117-127` + `MetricsPortStub.ts:18-26` |
| Aceitação de `correlationId`/`filCod`/`contaDestino`/`valorRecebido` como body | O cliente escolhe TODOS os campos que compõem a intenção da execução (inclusive a filial-alvo e a conta de destino) | RBAC + tenant-check server-side deveria escopar `filCod` ao usuário | ⚠️ (scaffold OK; produção precisa de authz por filial) | `routes/recebimentos.ts:46-108` |
| Tests do scaffold passando | 675 tests / 63 suites | verde | ✅ | `_shared-metrics.md` |

> ⚠️ **Não medível localmente**: distribuição real de roles em produção (contagem de usuários `admin`) e cobertura de authz por filial. Requer inspeção do `app_user` no Supabase de prod. Recomendação: adicionar teste de integração que valide `filCod` do body contra a filial-permitida do `req.user`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Log `[auth] rejected request ...` em token inválido/expirado; log `[auth] forbidden ...` em role insuficiente — mas sem agregação/alarme por umbral | ⚠️ parcial | `http/auth.ts:167-171,192-195` |
| Detect Service Denial | `globalLimiter` + `heavyRouteLimiter` — `heavyRouteLimiter` aplicado à rota `POST /pipeline/run` (peso alto do fan-out ao ERP downstream) | ✅ presente | `routes/recebimentos.ts:48` |
| Verify Message Integrity | Zod no boundary + `naturalKey` UNIQUE em `transacao_bancaria` (0032) + `idempotency_key` UNIQUE em `nota_debito_eletronica` (0038) + optimistic-lock `versao` no `Recebimento` | ✅ presente | `routes/recebimentos.ts:35-56` + `RecebimentoRepository.ts:44,54` |
| Detect Message Delay | N/A no scaffold — não há atividade ping/heartbeat na cadeia; será relevante quando o cron de ingestão Nexxera existir (Módulo 1, Fase 1) | N/A | Fora do escopo Fase 0 (justificativa: coordinator ainda é síncrono e stubbed) |
| Identify Actors | `req.user.sub`/`email` propagado como `ator` para o ledger e para os campos `criadoPor`/`aprovadoPor`/`executadoPor`/`estornadoPor` do `Recebimento` | ✅ presente | `routes/recebimentos.ts:57` + `RecebimentoRepository.ts:32-33,55-58` |
| Authenticate Actors | JWT HS256/JWKS verificado por `buildAuthMiddleware` antes de qualquer `/recebimentos/*` — token inválido → 401 | ✅ presente | `index.ts:84` + `http/auth.ts:96-174` |
| Authorize Actors | `requireRole('admin')` no `POST /pipeline/run` (espelha o padrão SISPAG) — MAS falta authz por-filial: `filCod` vem do body sem checagem de que o usuário tem permissão sobre aquela filial | ⚠️ parcial | `routes/recebimentos.ts:49` + `http/auth.ts:183-200` |
| Limit Access | `recebimentosGate` fecha 403 fora de `recebimentosEnabled` (fail-safe em prod). GET `/painel` fica aberto a qualquer usuário autenticado (read-only, mesmo padrão SISPAG) | ✅ presente | `http/recebimentosGate.ts` + `EnvironmentProvider.ts:47-52` |
| Limit Exposure | Módulo 5 fará o write ao Conexos atrás de `conexosWriteEnabled` (default false) + `conexosDryRun` (default true) — o coordinator já aceita `dryRun` explícito no body (`dryRun: parsed.data.dryRun ?? true`) | ✅ presente | `EnvironmentVars.ts:60-61` + `routes/recebimentos.ts:106` |
| Encrypt Data | JWT HS256 em trânsito; SSM SecureString para credenciais Conexos/Supabase; `conexosCredEncKey` AES-256-GCM para as credenciais por-usuário. No scaffold Frente IV não há novo segredo em disco — SSM segue via `EnvironmentProvider.parseSSMCredentials` com `WithDecryption: true` | ✅ presente | `EnvironmentProvider.ts:144-155` + `EnvironmentVars.ts:29-36` |
| Separate Entities | Ports com `Symbol()` tokens desacoplam módulos (nenhum módulo importa impl de outro — só o DTO + a interface); Módulo 5 (execução ERP) fica isolado atrás do `ErpReceivablesGatewayInterface` | ✅ presente | `interface/recebimentos/ports.ts:269-284` + `recebimentosContainer.ts:44-63` |
| Change Default Settings | `recebimentosEnabled` FAIL-SAFE em prod (default false quando env ausente); `conexosDryRun` default true; `conexosWriteEnabled` default false — todos os defaults MAIS SEGUROS | ✅ presente | `EnvironmentProvider.ts:47-52,93-94` |
| Validate Input | Zod `runPipelineSchema` no boundary + 7 schemas Zod por entidade (`transacaoBancariaSchema` etc.); `schemas.test.ts` verificando | ✅ presente | `routes/recebimentos.ts:35-56` + `interface/recebimentos/TransacaoBancaria.ts:39-67` |
| Revoke Access | Sem revocation list server-side de JWT (herdado — depende do TTL do token Supabase e do `/auth/logout`); fora do escopo do scaffold Frente IV | N/A no scaffold (justificativa: herdado da plataforma; Frente IV não introduziu identidade) | — |
| Lock Computer | N/A — não aplicável a backend HTTP stateless | N/A | — |
| Inform Actors | `res.status(403).json({ error: 'Recebimentos indisponível.' })` no gate + `{ error: 'Forbidden: insufficient role' }` no RBAC + `{ error: 'Payload inválido', details: parsed.error.flatten() }` no Zod | ✅ presente | `http/recebimentosGate.ts:18` + `http/auth.ts:195` + `routes/recebimentos.ts:54` |
| Restore (Audit Trail) | Ledger `recebimento_execucao` (0035) preserva `settled` (retry NUNCA regride nem duplica) + `RecebimentoRepository` grava `criadoPor`/`aprovadoPor`/`executadoPor`/`estornadoPor` + `NdeRepository` guarda `idempotency_key` UNIQUE | ✅ presente | `RecebimentoExecucaoRepository.ts:39-69` + `RecebimentoRepository.ts:31-33,55-58` |
| Audit Trail (business) | Ledger + spine + `MetricsEvent`s por stage (`started`/`ok`/`error`) sob correlation-id — mas o `MetricsPortStub` só loga via `LogService.info`; o real (Módulo 6) precisará persistir | ⚠️ parcial | `service/recebimentos/RecebimentoPipelineService.ts:98-115` + `stubs/MetricsPortStub.ts:18-26` |

## 4. Findings (achados)

### F-security-1: Rota `POST /recebimentos/pipeline/run` aceita `filCod` do body sem checagem de autorização por filial

- **Severidade**: P1
- **Tactic violada**: Authorize Actors (Bass)
- **Localização**: `src/backend/routes/recebimentos.ts:35-108` (schema + handler)
- **Evidência (objetiva)**:
  ```typescript
  const runPipelineSchema = z.object({
      correlationId: z.string().min(1),
      filCod: z.coerce.number().int().positive(),  // ← cliente escolhe a filial
      valorRecebido: z.number(),
      dryRun: z.boolean().optional(),
      borVldTipo: z.coerce.number().int().positive(),
      contaDestino: z.string().min(1),  // ← cliente escolhe a conta de destino
  });
  // ...
  const transacao: TransacaoBancaria = {
      // ...
      filCod: parsed.data.filCod,  // ← nenhum check contra req.user
  ```
  `requireRole('admin')` valida que o usuário É `admin` mas NÃO que ele pode agir sobre aquela `filCod`. O `conexosIdentityMiddleware` popula identidade do ERP no ALS mas não há um check `assertUserCanActOnFilial(req.user, parsed.data.filCod)`.
- **Impacto técnico**: quando o Módulo 5 for real, um usuário `admin` com acesso à filial A pode disparar um borderô/baixa/NDe na filial B só mudando o `filCod` no body. O mesmo vale para `contaDestino` (routing bancário) e `borVldTipo`.
- **Impacto de negócio**: em domínio financeiro multi-filial, um analista com acesso legítimo a "SP" pode mover dinheiro de "MG" — quebra do princípio de menor privilégio e complica a trilha de auditoria (o `ator` é registrado, mas a ação já ocorreu). Financeiro chama isso de "segregation of duties".
- **Métrica de baseline**: 1 de 1 rota de escrita da Frente IV sem authz por-filial (100% dos writes vulneráveis a cross-filial abuse). Contexto: financial-money-movement domain.

### F-security-2: `POST /recebimentos/pipeline/run` deixa o cliente cravar `correlationId` (e portanto a `idempotency_key`)

- **Severidade**: P1
- **Tactic violada**: Validate Input (Bass) / Limit Exposure
- **Localização**: `src/backend/routes/recebimentos.ts:35,58-70`
- **Evidência (objetiva)**:
  ```typescript
  const runPipelineSchema = z.object({
      correlationId: z.string().min(1),   // ← cliente cravado; sem prefixo, sem tenant-scope, sem UUID guard
      // ...
  });
  // ...
  const idempotencyKey =
      req.header('Idempotency-Key') ?? `receb:${parsed.data.correlationId}`;
  // ...
  const transacao: TransacaoBancaria = {
      id: idempotencyKey,      // ← id = idempotencyKey = header || `receb:${cliente.correlationId}`
      naturalKey: idempotencyKey,
      // ...
  };
  ```
  O cliente escolhe `correlationId` livre (só `min(1)`), o servidor concatena `receb:` e usa como `id`, `naturalKey` E `idempotencyKey` no ledger. Não há tenant-scope no prefixo, não há UUID guard, não há collision-check entre atores.
- **Impacto técnico**: colisões maliciosas de idempotency-key entre usuários — o Ator A pode "envenenar" a key `receb:X` para que o Ator B, ao chamar com o mesmo `correlationId`, receba um `alreadySettled: true` e não execute (denial-de-execução) OU pegue carona no execução do outro. Também trivializa fingerprinting/scan de `recebimento_execucao`.
- **Impacto de negócio**: ledger é o coração da idempotência money-moving. Se um analista pode envenenar a chave de execução de outro, a garantia de reversibilidade/rastreamento vira folclore.
- **Métrica de baseline**: 1 idempotency-key derivada de input de cliente sem UUID/prefixo-tenant; `z.string().min(1)` aceita qualquer string incluindo prefixos "receb:" (o cliente pode auto-colidir com `Idempotency-Key` header). Formato desejado: `z.string().uuid()` + prefixo tenant/user server-side.

### F-security-3: `MetricsEvent.attributes` sem enforcement runtime contra PII/dados bancários

- **Severidade**: P2
- **Tactic violada**: Limit Access
- **Localização**: `src/backend/domain/interface/recebimentos/ports.ts:117-127` + `src/backend/domain/service/recebimentos/stubs/MetricsPortStub.ts:18-26`
- **Evidência (objetiva)**:
  ```typescript
  export interface MetricsEvent {
      stage: string;
      correlationId: string;
      outcome: 'started' | 'ok' | 'error';
      /**
       * Counters/flags/enums only — NEVER PII. The type does not enforce this; it is a discipline
       * constraint. Módulo 6: never surface `TransacaoBancaria.contraparte`, `referenciaBancaria`,
       * `rawPayload` or `normalized` (payer name/CNPJ/bank ref/raw extract) in metric attributes.
       */
      attributes?: Record<string, number | string | boolean>;
  }
  ```
  Comentário documenta a regra mas `Record<string, number | string | boolean>` aceita literalmente qualquer string — incluindo CNPJ, nome do pagador, referência bancária, extrato cru. O `MetricsPortStub` reencaminha para `LogService.info` que sai fora do path do `redactBody` (aquele middleware só cobre body de request/response do Express).
- **Impacto técnico**: quando o Módulo 6 implementar (CloudWatch/OpenTelemetry), qualquer teammate distraído que faça `metrics.emit({ ..., attributes: { contraparte: transacao.contraparte } })` vaza CNPJ do pagador para métricas — que costumam ser retidas por meses e replicadas para dashboards.
- **Impacto de negócio**: LGPD (dados de PJ do fornecedor/cliente da Columbia). Log-drain do Render é público-a-quem-tem-acesso; CloudWatch é público-a-quem-tem-IAM. PII em métricas é "encontrar por SEARCH" — pior que num banco.
- **Métrica de baseline**: 0 enforcement runtime; 1 stage-emit por estágio × 5 estágios = 5 pontos de emissão sem guard. Alvo: introduzir type-branded `PiiSafeString`/`Counter` ou um scrubber no MetricsPort real.

### F-security-4: `GET /recebimentos/painel` fica aberto a qualquer usuário autenticado (sem `requireRole`)

- **Severidade**: P2
- **Tactic violada**: Authorize Actors
- **Localização**: `src/backend/routes/recebimentos.ts:27-33`
- **Evidência (objetiva)**:
  ```typescript
  router.get(
      '/painel',
      asyncHandler(async (_req, res) => {
          await bootstrapAppContainer();
          res.json({ geradoEm: new Date().toISOString(), recebimentos: [], kpis: {} });
      }),
  );
  ```
  Mesma abertura que `GET /sispag/painel` (padrão herdado — leitura para qualquer usuário autenticado). No scaffold responde `{ recebimentos: [], kpis: {} }` — inofensivo hoje. Quando a Fase 3 popular, cada usuário `viewer` (não `admin`) verá todos os recebimentos de todas as filiais.
- **Impacto técnico**: sem RBAC de leitura, um usuário JR com token válido enxerga o pipeline financeiro de toda a Columbia.
- **Impacto de negócio**: confidencialidade — recebimentos e conciliação bancária vazam contexto negocial (quem paga quanto, quando). Painéis financeiros costumam ser vistos apenas por finance-ops.
- **Métrica de baseline**: 1 de 1 rota de leitura da Frente IV sem RBAC; espelha o débito já registrado no SISPAG (mesma severidade, mesmo padrão).

### F-security-5: `runPipelineSchema` valida shape mas não faixa/precisão de `valorRecebido`

- **Severidade**: P3
- **Tactic violada**: Validate Input
- **Localização**: `src/backend/routes/recebimentos.ts:35-42`
- **Evidência (objetiva)**:
  ```typescript
  const runPipelineSchema = z.object({
      // ...
      valorRecebido: z.number(),   // ← aceita 0, negativo, Infinity, NaN, 1e308, 0.000001
      borVldTipo: z.coerce.number().int().positive(),
      contaDestino: z.string().min(1),   // ← aceita "a" como conta
  });
  ```
  `z.number()` aceita `-Infinity`, `NaN`, `1e308`, negativos e 0. `contaDestino: z.string().min(1)` aceita qualquer string. `borVldTipo` está OK (int positivo).
- **Impacto técnico**: quando a execução real chegar ao Módulo 5, um `valorRecebido` = `NaN` ou negativo pode chegar ao ERP; um `contaDestino` = `"x"` também.
- **Impacto de negócio**: dinheiro. Ordinariamente qualquer input degenerado deveria ser rejeitado no boundary, não no ERP.
- **Métrica de baseline**: 2 campos monetários/estruturais sem validação de faixa (`valorRecebido` sem `.positive().finite()`, `contaDestino` sem regex de conta bancária); 1 boundary Zod exercido.

## 5. Cards Kanban

### [security-1] Introduzir authz por-filial (assertUserCanActOnFilial) em `POST /recebimentos/pipeline/run`

- **Problema**
  > A rota `POST /recebimentos/pipeline/run` aceita `filCod` no body e delega direto ao coordinator, com apenas `requireRole('admin')` — sem checar que o `req.user` tem permissão sobre aquela filial. Em domínio money-moving multi-filial, um analista de SP pode disparar borderô/baixa/NDe em MG só mudando um número no body.

- **Melhoria Proposta**
  > Criar `assertUserCanActOnFilial(req.user, filCod)` como middleware ou helper server-side. Popular a lista de filiais permitidas pela identidade do usuário (via `app_user`, `conexosIdentityMiddleware` ou JWT claim `permissions`). Rejeitar com 403 quando `filCod` não estiver na lista. Aplicar no `POST /pipeline/run` (e replicar a mesma tactic no SISPAG `POST /lotes` e `POST /lotes/:id/finalizar` para paridade). Tactic: **Authorize Actors**. Arquivos: `src/backend/http/auth.ts`, `src/backend/routes/recebimentos.ts`, `src/backend/routes/sispag.ts`.

- **Resultado Esperado**
  > 100% das rotas money-moving validam `filCod` do body contra a filial-permitida do usuário. Analista de SP disparando na filial MG → 403 (log + audit trail). Métrica: rotas de write com authz por-filial: 0 → 2 (Frente II + Frente IV).

- **Tactic alvo**: Authorize Actors
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Rotas money-moving com authz por-filial: 0 → 2 (`POST /recebimentos/pipeline/run`, `POST /sispag/lotes/:id/finalizar`)
  - Test de integração cobrindo `filCod` cross-tenant: 0 → 1 por rota
- **Risco de não fazer**: quando o Módulo 5 virar real, um admin com acesso legítimo pode mover dinheiro de outra filial e a auditoria só registra o "quem", não impede o "onde". Segregation-of-duties quebrada.
- **Dependências**: modelagem da relação `app_user × filial` (pode viver em `app_user_filial` ou em claim JWT `permissions.filiais: number[]`).

### [security-2] Blindar `correlationId`/`idempotencyKey` contra colisão maliciosa entre atores

- **Problema**
  > O cliente cravou `correlationId` livre (`z.string().min(1)`), o servidor concatena `receb:` e usa como `id`/`naturalKey`/`idempotencyKey`. O Ator A pode envenenar a chave `receb:X` para que o Ator B receba `alreadySettled: true` ao rodar com o mesmo `correlationId` — denial-of-execution OU carona no ledger do outro. O ledger é o coração da idempotência money-moving.

- **Melhoria Proposta**
  > No `runPipelineSchema`: `correlationId: z.string().uuid()`. Na composição da idempotency-key, incluir o `sub` do `req.user` (ou o `filCod` autorizado) no prefixo — `receb:${req.user.sub}:${uuid}` — para que a colisão exija também colisão de sub. Tactic: **Validate Input** + **Limit Exposure**. Arquivo: `src/backend/routes/recebimentos.ts`.

- **Resultado Esperado**
  > Colisão de idempotency-key entre atores diferentes é impossível por construção. Métrica: 1 idempotency-key sem tenant/user-scope → 0.

- **Tactic alvo**: Validate Input
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Idempotency-keys sem UUID guard: 1 → 0
  - Idempotency-keys sem user/tenant-scope: 1 → 0
- **Risco de não fazer**: um insider (ou script que scan-brute-forceie `correlationId` sequenciais) transforma o ledger em bloqueio-de-execução do time inteiro. Sintoma visto: recebimentos legítimos retornam `alreadySettled: true` sem NDe emitida.
- **Dependências**: nenhuma (mudança local à rota).

### [security-3] Enforcement runtime de PII-safety no `MetricsPortInterface`

- **Problema**
  > O comentário em `MetricsEvent.attributes` proíbe PII ("NEVER PII"), mas o tipo `Record<string, number | string | boolean>` aceita qualquer string — incluindo `contraparte` (nome/CNPJ do pagador), `referenciaBancaria` ou `rawPayload` do extrato Nexxera. Quando o Módulo 6 virar real (CloudWatch/OTel), 1 esquecimento de code-review vaza CNPJ para dashboards retidos por meses.

- **Melhoria Proposta**
  > Introduzir type-branding: `type MetricAttr = number | boolean | (string & { readonly __pii_free: unique symbol })` OU um helper `piiSafe(s: string): PiiFreeString` que valide contra regex CNPJ/CPF/IBAN. Adicionar um scrubber runtime no `MetricsPort` real (Módulo 6) que rejeite/redija atributos que casem `\d{11,14}` (CPF/CNPJ) ou palavras-chave (`contraparte`, `iban`, `rawPayload`). Tactic: **Limit Access** + **Encrypt Data**. Arquivos: `src/backend/domain/interface/recebimentos/ports.ts`, o futuro `MetricsPortImpl`.

- **Resultado Esperado**
  > `metrics.emit({ attributes: { contraparte: '12.345.678/0001-90' } })` é rejeitado em compile-time OU redigido em runtime. Métrica: pontos-de-emissão com enforcement PII: 0/5 → 5/5.

- **Tactic alvo**: Limit Access
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Pontos de emissão com scrubber ou branded type: 0/5 → 5/5
  - Testes cobrindo emissão de CNPJ (deveria falhar): 0 → 1
- **Risco de não fazer**: LGPD — vazamento de dados PJ da carteira Columbia em métricas retidas.
- **Dependências**: alinhamento com Módulo 6 (Observabilidade) sobre a shape final de `MetricsEvent`.

### [security-4] Adicionar RBAC leve na leitura de `/recebimentos/painel` (viewer/analyst/admin)

- **Problema**
  > `GET /recebimentos/painel` fica aberto a qualquer usuário autenticado — mesmo padrão herdado do SISPAG. No scaffold retorna `{ recebimentos: [], kpis: {} }`. Quando popular, expõe todo o pipeline financeiro (quem paga quanto, quando) a qualquer usuário JR com token válido.

- **Melhoria Proposta**
  > Aplicar `requireRole('admin', 'analyst', 'viewer')` (ou similar) explicitamente para deixar a intenção clara e permitir revogação futura. Escopar o payload por-filial (mesmo helper do card `security-1`). Tactic: **Authorize Actors** + **Limit Access**. Arquivos: `src/backend/routes/recebimentos.ts`, `src/backend/routes/sispag.ts` (mesma dívida).

- **Resultado Esperado**
  > Cada rota de leitura declara explicitamente qual role vê o quê; usuários sem role autorizada recebem 403 (com log). Métrica: rotas de leitura Frente IV sem RBAC explícito: 1 → 0.

- **Tactic alvo**: Authorize Actors
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - Rotas Frente IV com RBAC explícito: 1/2 → 2/2
  - Test cobrindo user sem role → 403: 0 → 1
- **Risco de não fazer**: quando o painel encher (Fase 3), qualquer conta comprometida (phishing) enxerga a carteira financeira da Columbia sem passar por role-check.
- **Dependências**: taxonomia de roles definida (hoje só `admin` é usado; introduzir `analyst`/`viewer` requer alinhamento com auth).

### [security-5] Apertar `runPipelineSchema` — `valorRecebido.positive().finite()` e regex em `contaDestino`

- **Problema**
  > `runPipelineSchema.valorRecebido` = `z.number()` aceita `NaN`, `-Infinity`, negativos, 0 e valores > `1e308`. `contaDestino` = `z.string().min(1)` aceita `"x"`. Quando o Módulo 5 chamar o ERP, esses degenerados atravessam o boundary.

- **Melhoria Proposta**
  > `valorRecebido: z.number().finite().positive().multipleOf(0.01)` (limita a duas casas decimais — moeda). `contaDestino: z.string().regex(/^\d{4,20}(-\d)?$/)` (ou o formato exato do Conexos, alinhar com Módulo 5). Tactic: **Validate Input**. Arquivo: `src/backend/routes/recebimentos.ts`.

- **Resultado Esperado**
  > Input degenerado é 400 no boundary, não erro no ERP. Métrica: campos money/estruturais sem faixa: 2 → 0.

- **Tactic alvo**: Validate Input
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-5
- **Métricas de sucesso**:
  - Campos monetários com `.positive().finite()`: 0/1 → 1/1
  - Campos de conta com regex: 0/1 → 1/1
- **Risco de não fazer**: quando a integração ERP virar real, um NaN/Infinity produz erro obscuro do lado do Conexos + log ruim + retry mal-comportado no ledger.
- **Dependências**: alinhamento com Módulo 5 sobre o formato exato de `contaDestino` (regex Conexos).

## 6. Notas do agente

- SQL parametrizado nos 6 repos: 100% limpo — `grep '\${'` retorna 0 hits em `repository/recebimentos/`. Não há string interpolation em nenhum SQL; todos usam placeholders nomeados (`$id`, `$key`) via `PostgreeDatabaseClient.update/selectFirst/selectMany`. Nenhum P0 disparado. **A jóia da coroa foi honrada.**
- `EnvironmentProvider` foi corretamente estendido (`resolveRecebimentosEnabled` espelhando `resolveSispagEnabled`, com fail-safe em prod). `RECEBIMENTOS_ENABLED` NÃO é segredo (é toggle) — segue via `process.env` como o irmão SISPAG. Nenhum novo segredo introduzido pelo scaffold.
- Cross-QA (para o consolidator): **Audit Trail** overlaps com Fault Tolerance (F-fault-tolerance verificar o ledger `recebimento_execucao`); **Validate Input** overlaps com Integrability (schemas Zod compartilhados) e Fault Tolerance (rejeição no boundary vs. downstream); **Authorize Actors** por-filial (card `security-1`) é a mesma dívida do SISPAG — deveria virar cross-cutting concern (helper compartilhado) em vez de duas rotas separadas.
- Nada medido sobre revocation de JWT (herdado da plataforma, não introduzido pela Frente IV); nada sobre GuardDuty/CloudTrail (`--quick` + infra fora do escopo do worktree).
