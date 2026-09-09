---
qa: Security
qa_slug: security
run_id: 2026-09-08-1955
agent: qa-security
generated_at: 2026-09-08T19:55:00-03:00
scope: backend
score: 8.0
findings_count: 4
cards_count: 3
---

# Security — Regis-Review

> **Escopo:** somente o delta do commit `8b18686` (`fix/permutas-baixa-integridade`),
> remediação de R-1/R-2 do run `2026-09-08-1414-permutas`. Os achados estruturais
> daquele run (`security-1` 12/12 `admin`, `security-2` conta compartilhada,
> `security-3` sem `assertUserCanActOnFilial` em Permutas, `security-4` 8 HIGH no
> frontend, `security-6` JWT em `localStorage`) **não são deste delta** e não são
> re-reportados aqui — este delta nem os agrava, nem os corrige. Auth continua
> Supabase JWT + HS256 próprio; `requireRole('admin')` continua o único gate.
> Sem `infra/` neste repo: IAM/least-privilege/CloudTrail/GuardDuty ⇒ não medível.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Operador da Columbia (mesmo `admin` compartilhado) e/ou concorrente/atacante interno com acesso ao repo | Dois cliques / duas abas / dois operadores acionam `POST /permutas/:docCod/reconciliar` para o MESMO `adiantamentoDocCod` no mesmo instante; ou uma alocação com déficit é submetida | `ReconciliacaoPermutaService.reconciliar` → `withAdvisoryLock` → `assertCobertura` → laço de POST `fin010` | Produção (escrita `fin010` LIGADA desde 2026-06-24, 137 execuções / R$ 38,4 M baixados) | O 2º caller recebe 409 `RECONCILIACAO_EM_ANDAMENTO` com `userMessage` em PT antes de qualquer POST; caso a cobertura seja insuficiente, 422 `ALOCACAO_SEM_COBERTURA` também antes do 1º POST; se um resíduo aparecer PÓS-POST, execução termina em `parcial` com `BUSINESS_WARN` contendo os 4 campos canônicos | 0 borderôs duplicados; 0 POSTs `fin010` para o par serializado bloqueado; `err.message` bruto NÃO viaja ao cliente (só `userMessage` curado); trilha `permuta_alocacao_execucao` afirma exatamente o que aconteceu — nunca `settled` sobre resíduo |

O delta tanto **fecha um vetor de dano com efeito monetário** (dois borderôs pagando duas vezes o mesmo par) quanto **fortalece o audit trail** (novo terminal `parcial` + `valor_residual_usd` + WARN estruturado). É melhoria líquida em Security no eixo Limit Exposure e Audit Trail.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded nos arquivos do delta | 0 | 0 | ✅ | `grep -rEn "(password\|secret\|token\|api[_-]?key\|credential\|AKIA)…" ` nos 21 arquivos do delta — vazio |
| SQL parametrizado nas queries novas (`markParcial`, `beginExecution` alterado, `setBorCod`, migration `0054`) | 100% | 100% | ✅ | `PermutaExecucaoRepository.ts:73-101, 258-303`; `SqlBuilder` traduz `$key/$borCod/$valorResidualUsd` → `$1/$2/…` |
| SQL parametrizado no probe (`probe-com308-cobertura.ts` L131-138) | 100% (após remediação do PatternGuardian: `LIMIT $limite`) | 100% | ✅ | `src/backend/jobs/probe-com308-cobertura.ts:131-141` — `LIMIT $limite` bound; a "interpolação de `LIMIT`" que o PG achou foi corrigida antes deste gate |
| Advisory lock: valor injetado é number bound-parameter | ✅ (`[lockKey]`, integer) | ✅ | ✅ | `PostgreeDatabaseClient.ts:148, 153` — `pg_try_advisory_lock($1)` / `pg_advisory_unlock($1)` |
| Advisory lock: chave derivada de dado do usuário | `chaveDeLock` = hash int32 de `adiantamentoDocCod` (colisão custa serialização, nunca corretude) | não injeta em SQL | ✅ | `ReconciliacaoPermutaService.ts:175-181` |
| Rotas mutantes tocadas no delta com `requireRole('admin')` | 1/1 (`POST /permutas/:docCod/reconciliar`, L492) | 100% (não agrava) | ✅ (baseline pré-existente; ver `F-security-1/2/3` do run anterior) | `src/backend/routes/permutas.ts:492-522` |
| Rotas novas introduzidas pelo delta | 0 | — | ✅ | `git diff HEAD~1 -- src/backend/routes/permutas.ts` — só altera o `try/catch` da rota existente |
| Vazamento de `err.message` na resposta HTTP das rotas alteradas | 0 (delta INTRODUZ `respondHandlerError` no reconciliar; não-`HandlerError` cai no middleware global 500 sem eco) | 0 | ✅ | `src/backend/routes/permutas.ts:504-521` + `src/backend/http/respondHandlerError.ts:22-30` |
| Novos códigos de erro expostos ao cliente | 2 (`RECONCILIACAO_EM_ANDAMENTO` 409, `ALOCACAO_SEM_COBERTURA` 422) — `userMessage` em PT curada; `details` com números do adto/invoice/cobertura/déficit | avaliação por caso | ⚠️ | `errors/AlocacaoSemCoberturaError.ts:37-58`, `errors/ReconciliacaoEmAndamentoError.ts:28-42` |
| `BUSINESS_WARN` do caminho `parcial` — campos logados | `adiantamentoDocCod`, `invoiceDocCod`, `borCod`, `valorResidualUsd`, `titulos`, `bxaCodSeqs`, `totalBaixado` (necessários para I-Recon-7a: detector proativo lê estes campos) | 4 canônicos + suporte à busca (aceitável para audit) | ⚠️ | `ReconciliacaoPermutaService.ts:588-603` |
| Testes de concorrência introduzidos (regra I-Recon-5) | ✅ `Promise.allSettled` mesmo adto ⇒ 1× `gravarBaixaPermuta`, 1× `criarBordero`; adtos distintos passam em paralelo | ≥1 caso | ✅ | `ReconciliacaoPermutaService.test.ts:787, 827, 857` (via `_shared-metrics.md`) |
| Probe (`probe-com308-cobertura.ts`) tem guarda para PRD | ✅ `PROBE_ALLOW_PRD=1` obrigatório se `BASE` não contém `-hml`; sem write no ERP; sem write no Postgres | fail-closed no PRD | ✅ | `src/backend/jobs/probe-com308-cobertura.ts:52-60, 92-99` |
| Probe grava dados de PRD em disco local | ✅ escreve `achados.json` em `${OUT_DIR:-/tmp/probe-com308-cobertura}` com **umask default** (world-readable no dev host); confirmado em `/tmp/probe-com308-cobertura/achados.json` (docCods 9518/9471/9470/9320/…, base=PRD) | permissão restrita (0o600/0o700) OU marcador no header | ⚠️ | `src/backend/jobs/probe-com308-cobertura.ts:63, 254-261`; artefato local: `/tmp/probe-com308-cobertura/achados.json` |
| `npm audit` profundo | não rodado (`--quick`); baseline do run anterior: FE 8 HIGH, BE 3 moderate + 1 low | 0 crit / 0 high | ⚠️ **não medível neste run** | `_shared-metrics.md` L54-56 |
| Terraform / tenants / IAM least-privilege | não existe `infra/` neste repo (deploy Render) | — | ⚠️ **não medível** | `_shared-metrics.md` L64 |

> ⚠️ **Não medível localmente**: cobertura por arquivo, `npm audit` fresco, política IAM. `--quick` + repositório sem `infra/`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | WARN `com308 divergente` quando ERP se contradiz (`pago=1` + em-aberto derivado ≠ 0) — corroboração sem gate; alimenta detecção de contrato quebrado | ✅ presente (NOVO no delta) | `ReconciliacaoPermutaService.ts:687-703` |
| Detect Service Denial | `heavyRouteLimiter` já cobria a rota (L493); advisory lock elimina o vetor de auto-DoS por dois cliques | ✅ parcial (herdado) | `routes/permutas.ts:493`; `ReconciliacaoPermutaService.ts:152-171` |
| Verify Message Integrity | `assertCobertura` faz Σ derivado (`face − pagoBrl/taxa`) e compara com `valorAlocado ± TOLERANCIA_FECHAMENTO_NEG`; recusa se ERP indica que a invoice não cobre | ✅ presente (NOVO) | `ReconciliacaoPermutaService.ts:679-712` |
| Detect Message Delay | N/A no delta — não há polling nem timeouts novos; `PollExecutor` não é usado aqui | N/A | — |
| Identify Actors | `req.user.sub` / `req.user.email` alimentam `executadoPor`; `IdentityProvider.currentParams()` grava `conexos_username`/`conexos_usn_cod` na trilha (delta preserva) | ⚠️ herdado (fraqueza estrutural `security-2` — conta compartilhada — persiste, delta não agrava) | `routes/permutas.ts:503`; `PermutaExecucaoRepository.ts:293-296` |
| Authenticate Actors | Supabase JWT + HS256 próprio — não tocado pelo delta | ⚠️ herdado | `_shared-metrics.md` do run anterior |
| Authorize Actors | `requireRole('admin')` mantido em todas as rotas de Permutas (12 sítios); delta não adiciona rota nem afrouxa gate | ⚠️ herdado (`security-1/2/3` do run anterior — não deste) | `routes/permutas.ts:189, 224, 286, 308, 356, 398, 462, 492, 538` |
| Limit Access | `heavyRouteLimiter` na rota `reconciliar` (L493) — limita fan-out Conexos por IP | ✅ herdado | `routes/permutas.ts:493` |
| Limit Exposure | **Advisory lock por `adiantamentoDocCod` (I-Recon-5)** — o 2º caller barrado NÃO toca o ERP; zero borderô, zero baixa. Reduz blast-radius de dois cliques simultâneos de "dois pagamentos duplicados no `fin010`" para "409 + trilha limpa" | ✅ presente (NOVO — melhoria líquida) | `ReconciliacaoPermutaService.ts:152-171`; teste `Promise.allSettled` em `ReconciliacaoPermutaService.test.ts:787-857` |
| Encrypt Data | Postgres via Supabase (TLS em trânsito); nada mais tocado pelo delta | ⚠️ herdado | — |
| Separate Entities | Advisory lock separa execuções por adto sem serializar o repo inteiro; adtos distintos seguem em paralelo (teste de baseline) | ✅ presente (NOVO) | `ReconciliacaoPermutaService.ts:155`; teste em `ReconciliacaoPermutaService.test.ts:857` |
| Change Default Settings | Probe recusa PRD sem `PROBE_ALLOW_PRD=1` explícito (default = **fail-closed** para PRD) | ✅ presente | `probe-com308-cobertura.ts:52-60` |
| Validate Input | `assertCobertura` é a validação de invariante ANTES da 1ª escrita (I-Write-8a) — pré-check fail-closed com custo zero; Zod nos boundaries (herdado) | ✅ presente (NOVO — reforço) | `ReconciliacaoPermutaService.ts:679-712` |
| Revoke Access | N/A no delta | N/A | — |
| Lock Computer | N/A no delta | N/A | — |
| Inform Actors | `AlocacaoSemCoberturaError.userMessage` orienta re-alocar (não retryable); `ReconciliacaoEmAndamentoError.userMessage` orienta esperar (retryable). Frontend consome `code` + `error` e mostra a mensagem em PT sem prefixo genérico. | ✅ presente (NOVO) | `errors/AlocacaoSemCoberturaError.ts:37-52`; `errors/ReconciliacaoEmAndamentoError.ts:34-40`; `src/frontend/lib/api.ts:262-274` |
| Restore | Fora de escopo do delta (roll-forward do `parcial` é RE-alocação, coberta por `markParcial` + I-Recon-6) | ✅ presente por adjacência | `PermutaExecucaoRepository.ts:64-105` |
| Audit Trail | **Terminal `parcial` + `valor_residual_usd` + `BUSINESS_WARN` com 4 campos canônicos.** Antes deste delta, resíduo era silenciado (`settled` mudo); agora a trilha AFIRMA a verdade — cross-ref Fault Tolerance. | ✅ presente (NOVO — reforço substancial) | `migrations/0054_permuta_execucao_parcial.sql`; `PermutaExecucaoRepository.markParcial:258-303`; `ReconciliacaoPermutaService.ts:583-604` |

## 4. Findings (achados)

### F-security-delta-1: `AlocacaoSemCoberturaError.details` ecoa valores financeiros da invoice ao cliente HTTP

- **Severidade**: P3
- **Tactic violada**: Limit Exposure (defense-in-depth em resposta de erro)
- **Localização**: `src/backend/domain/errors/AlocacaoSemCoberturaError.ts:52-58` + `src/backend/http/respondHandlerError.ts:24-27`
- **Evidência (objetiva)**:
  ```typescript
  // AlocacaoSemCoberturaError.ts:52-58
  this.details = {
      adiantamentoDocCod: String(params.adiantamentoDocCod),
      invoiceDocCod: String(params.invoiceDocCod),
      cobertura: params.cobertura,
      valorAlocado: params.valorAlocado,
      deficit,
  };
  // respondHandlerError.ts:24-27
  res.status(err.statusCode).json({
      error: err.userMessage,
      code: err.code,
      retryable: err.retryable,
      ...(err.details !== undefined ? { details: err.details } : {}),
  ```
- **Impacto técnico**: A resposta 422 devolve `cobertura` (Σ em aberto USD da invoice), `valorAlocado` (par) e `deficit` (diferença). Hoje isso é seguro porque `requireRole('admin')` gate a rota E todos os usuários têm `admin` (findings do run anterior `security-1/2`) — o caller já enxerga esse dado no ERP. **Assim que `security-1/2/3` forem implementados** (role operador, `assertUserCanActOnFilial`), esse `details` vira um canal lateral que devolve valores de invoices de outras filiais para um operador em cross-filial: o gate futuro estará na rota, mas o payload de erro já resolveu o número antes de qualquer checagem de escopo por filial.
- **Impacto de negócio**: Enquanto a base for 12/12 `admin`, zero. Após remediação do `security-1/2/3`, o `details` de erro passa a expor faturamento em aberto por invoice a um role que não deveria enxergá-lo — sem que o card `security-3` (assertUserCanActOnFilial) sozinho resolva, porque o gate é na rota, mas o `details` é montado no serviço.
- **Métrica de baseline**: 1 rota nova respondendo com `details` financeiro (`invoiceDocCod` + `cobertura` USD + `valorAlocado` + `deficit`). Runtime dependência: cross-ref com `security-1/2/3` (P0/P1 do run anterior).

### F-security-delta-2: Probe versionado grava dados de PRD em `/tmp` com umask default

- **Severidade**: P3
- **Tactic violada**: Limit Exposure (dados financeiros em artefato local com permissão frouxa)
- **Localização**: `src/backend/jobs/probe-com308-cobertura.ts:63, 254-261`; artefato observado em `/tmp/probe-com308-cobertura/achados.json`
- **Evidência (objetiva)**:
  ```
  # ls -la /tmp/probe-com308-cobertura/
  -rw-rw-r--  1 inteli inteli  9639 set  8 15:34 achados.json
  # head do achados.json
  { "base": "https://columbiatrading.conexos.cloud/api", ...
    "docCod":"9518","filCod":2}, {"docCod":"9471","filCod":4}, ...
  ```
  O código:
  ```typescript
  const OUT_DIR = process.env.OUT_DIR ?? '/tmp/probe-com308-cobertura';
  mkdirSync(OUT_DIR, { recursive: true });        // umask default (~022 ⇒ 0755)
  writeFileSync(arquivo, JSON.stringify(...));    // umask default (0644)
  ```
- **Impacto técnico**: O probe é read-only no ERP (bem), mas escreve `achados.json` contendo `docCod`s reais de invoices já baixadas em PRD, filiais, contagens, USD faces e derivações. Em host de dev multi-usuário (ou VM compartilhada), `/tmp/probe-com308-cobertura/achados.json` fica `rw-r--r--` e qualquer outra conta do sistema pode ler. O script é executado sob demanda por um dev; o risco é local, não em produção.
- **Impacto de negócio**: Baixo. Requer host compartilhado onde alguém rode o probe e outro usuário do mesmo host leia `/tmp`. Zero exposição na aplicação em execução. Hardening óbvio.
- **Métrica de baseline**: `stat -c '%a' /tmp/probe-com308-cobertura/achados.json` = `664` (contém docCods 9518/9471/9470/9320/8877/8529/7993/7369 e valores USD associados).

### F-security-delta-3: `BUSINESS_WARN` do `parcial` grava 7 campos com valor financeiro USD no log

- **Severidade**: P3 (informativo; ver Nota 6)
- **Tactic violada**: nenhuma — na verdade este WARN **implementa** a tactic Audit Trail (I-Recon-7a). Registrado como finding para reconhecer a superfície e evitar reincidir num card "mesma coisa, escrita duas vezes".
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:588-603`
- **Evidência (objetiva)**:
  ```typescript
  await this.logService.warn({
      type: LOG_TYPE.BUSINESS_WARN,
      message: 'permuta reconciliacao PARCIAL — alocado NÃO fechou; resíduo a re-alocar',
      data: {
          adiantamentoDocCod, invoiceDocCod, borCod,
          valorResidualUsd: residuoUsd, titulos: bxaCodSeqs.length,
          bxaCodSeqs, totalBaixado: totalBaixadoBrl,
      },
  });
  ```
- **Impacto técnico**: `valorResidualUsd`, `totalBaixadoBrl` e `bxaCodSeqs` viajam para o coletor de logs. É **exigido pelo invariante I-Recon-7a** (detector proativo depende desses 4 campos). Diferente do `security-8` do run anterior (dry-run preview logando taxa/valor sem necessidade operacional), aqui os campos são o produto da tactic — remover é regressão de Audit Trail. Registrado só para não ser recontabilizado como novo canal de log-com-PII.
- **Impacto de negócio**: Zero incremental — a mesma população que já lia o log já lia `securityContext`, `borCod`, `valorBaixado`. Vai junto com o design.
- **Métrica de baseline**: 1 WARN novo com 7 chaves, das quais 3 são financeiras. Todas exigidas pela invariante.

### F-security-delta-4: Sem `assertUserCanActOnFilial` na rota alterada (herdado)

- **Severidade**: **não é achado deste delta** — registrado só para consolidação
- **Tactic violada**: Authorize Actors / Separate Entities (tenant/filial scoping)
- **Localização**: `src/backend/routes/permutas.ts:492-522`
- **Evidência (objetiva)**: `grep -n "assertUserCanActOnFilial" src/backend/routes/permutas.ts` — vazio. `filCod` do adiantamento é resolvido no serviço via `findAdiantamento(adiantamentoDocCod)`, não validado contra `req.user.filiais`.
- **Impacto técnico**: Idêntico ao do run anterior (`F-security-3`). O delta não introduz nem corrige. Enquanto a base for 12/12 `admin` compartilhado, é P0 estrutural desta base, não deste delta.
- **Impacto de negócio**: Ver `security-3` do run anterior.
- **Métrica de baseline**: mesma métrica reportada em `docs/regis-review/2026-09-08-1414-permutas/security.md`.

## 5. Cards Kanban

### [security-delta-1] Redigir `details` de `AlocacaoSemCoberturaError` para não devolver valores brutos ao cliente

- **Problema**
  > A resposta 422 do `/permutas/:docCod/reconciliar` inclui `details.{cobertura, valorAlocado, deficit, invoiceDocCod}` — o USD em aberto da invoice, o alocado do par, e o déficit. Hoje é irrelevante (todos são `admin`), mas o dia em que `security-1/2/3` forem implementados, o `details` do erro passa a devolver faturamento em aberto por invoice para um role operador que provavelmente não deveria enxergá-lo cross-filial. A analista já vê os números na tela onde alocou, então o `details` só serve para logs/debug — não para renderização.

- **Melhoria Proposta**
  > Em `AlocacaoSemCoberturaError.ts:52-58`, dividir em dois: manter `this.details` (server-side, para logs/audit) e adicionar `this.clientDetails` (apenas `adiantamentoDocCod` e `invoiceDocCod` — o mínimo para a UI orientar re-alocar) OU alterar `respondHandlerError.ts:24-27` para NÃO propagar `details` a menos que o erro sinalize `publicDetails: true`. Preferível a segunda: uma decisão por classe de erro, no ponto de emissão. Tactic Bass: Limit Exposure. Arquivos: `src/backend/domain/errors/AlocacaoSemCoberturaError.ts`, `src/backend/http/respondHandlerError.ts`, e revisão de `IngestLockBusyError`/`RemessaEmAndamentoError` para consistência.

- **Resultado Esperado**
  > Resposta 422 devolve `error` + `code` + `retryable`, sem valores financeiros; UI segue mostrando `userMessage` (que continua contendo os números — mas isso é decisão explícita da mensagem, não default do middleware). Métrica: `details` com campo numérico financeiro em resposta HTTP: **1 → 0**.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-delta-1
- **Métricas de sucesso**:
  - `curl -s -X POST /permutas/{X}/reconciliar` com alocação inválida devolve `error`+`code`+`retryable`, sem `details.cobertura|valorAlocado|deficit`: sim
  - Testes de contrato de erro atualizados em `ReconciliacaoPermutaService.test.ts`
- **Risco de não fazer**: Após `security-1/2/3` landing, resposta 422 vira canal lateral de exfiltração de faturamento em aberto por invoice para roles não-admin — sem que `security-3` sozinho resolva.
- **Dependências**: idealmente antes de `security-1` do run anterior chegar ao merge, para não ter que revisitar dois PRs.

### [security-delta-2] Restringir permissões do artefato de `probe-com308-cobertura.ts` (0o700 dir, 0o600 file)

- **Problema**
  > O probe versionado escreve `achados.json` em `/tmp/probe-com308-cobertura/` com umask default (dir 0755, arquivo 0644, verificado localmente). Contém `docCod`s reais de invoices em PRD e USD face por título. Em host multiusuário (ou VM compartilhada com CI runner), qualquer outra conta local lê. É read-only no ERP e não roda em CI — o risco é de dev-machine hygiene, não de aplicação.

- **Melhoria Proposta**
  > `mkdirSync(OUT_DIR, { recursive: true, mode: 0o700 })` + `writeFileSync(arquivo, ..., { mode: 0o600 })` no `src/backend/jobs/probe-com308-cobertura.ts:63, 258`. Adicionar linha no header explicando que o arquivo contém `docCod`s de PRD e que o probe **não** deve ser rodado em host compartilhado com outras contas. Tactic Bass: Limit Exposure + Change Default Settings.

- **Resultado Esperado**
  > `stat -c '%a' /tmp/probe-com308-cobertura/achados.json` = `600`, `stat -c '%a' /tmp/probe-com308-cobertura` = `700`. Header do probe adverte sobre compartilhamento do host.
  > Métrica: permissão do artefato: **664 → 600**.

- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-delta-2
- **Métricas de sucesso**:
  - `stat -c '%a'` do output = 600 / dir 700
  - Comentário no cabeçalho reflete a restrição
- **Risco de não fazer**: Baixo. Dev que rode o probe em host compartilhado (VM de laboratório com múltiplos usuários, CI runner, dev-container multi-tenant) deixa `docCod`s + USD legíveis para outras contas locais.
- **Dependências**: nenhuma.

### [security-delta-3] Deixar registrado no _inbox: os P0/P1 estruturais do run anterior continuam de pé

- **Problema**
  > O delta remediou R-1 (P0 do run `2026-09-08-1414-permutas` — dois cliques criando dois borderôs) e R-2 (P1 do mesmo run — resíduo silenciado como `settled`). NÃO tocou: `security-1` (12/12 `admin`), `security-2` (conta compartilhada), `security-3` (falta `assertUserCanActOnFilial` nas rotas de Permutas), `security-4` (8 HIGH no frontend), `security-6` (JWT em `localStorage`). Todos permanecem exatamente como estavam. Este card existe para que o consolidator NÃO trate a ausência de re-menção como "resolvido".

- **Melhoria Proposta**
  > Registro em `ontology/_inbox/permutas-baixa-integridade-regis-followups.md`: os cards `security-1/2/3/4/6` do run `2026-09-08-1414-permutas` **continuam abertos**. Este PR os deixou intactos por escopo (foi remediação de R-1/R-2), não por descarte. Tactic Bass alvo dos originais: Authorize Actors / Identify Actors / Separate Entities.

- **Resultado Esperado**
  > Follow-up registrado; consolidator do run `2026-09-08-1955` referencia os cards do run anterior em vez de re-emitir. Métrica: cards duplicados entre runs: **0**.

- **Tactic alvo**: (meta — rastreabilidade)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-delta-4
- **Métricas de sucesso**:
  - Inbox de follow-up atualizado
  - REPORT.md do run atual não recontabiliza `security-1/2/3/4/6`
- **Risco de não fazer**: Consolidator sobrecontabiliza P0 estruturais e a nota do Security do delta é injustamente puxada para baixo por defeitos que este PR não introduziu nem podia resolver.
- **Dependências**: consolidator do run atual.

## 6. Notas do agente

- Score 8.0: delta é **melhoria líquida** em Security. Novo: Limit Exposure (advisory lock), Audit Trail (`parcial` + WARN 4-campos), Validate Input (`assertCobertura`), Detect Intrusion (WARN de divergência ERP `pago=1` × aberto≠0), Inform Actors (409/422 com `userMessage`). Sem cards P0/P1 no delta. Os -2 pontos vêm de: (a) débito estrutural do run anterior segue de pé (não é deste delta corrigir), (b) `details` de erro devolvendo números financeiros ao cliente é hardening pendente (F-security-delta-1), (c) probe grava PRD com umask frouxa (F-security-delta-2).
- Verificado que o PatternGuardian já corrigiu a única violação real (`LIMIT $limite` no probe). As outras 2 alegadas eram falso-positivo — confirmado por leitura direta do código.
- **Cross-QA**:
  - **Fault Tolerance** — `parcial` + WARN estruturado é reforço mútuo de Audit Trail (Security) e Idempotency/Recover (Fault Tolerance). Consolidator: alinhar cards para não duplicar.
  - **Availability** — o advisory lock é Limit Exposure (Security) e blast-radius cap (Availability). Um card só.
  - **Integrability** — `assertCobertura` é Validate Input (Security) e contract-check no boundary (Integrability). Cross-ref.
  - **Deployability** — a ordem de deploy da migration `0054` é explícita no arquivo e é requisito de Security também: sem ela, o INSERT de `parcial` falha em runtime **depois** do POST bem-sucedido, deixando a trilha mentindo (`error` sobre baixa confirmada). Não é card, é nota para o consolidator.
- Não consegui medir `npm audit` (respeitei `--quick`) e IAM/CloudTrail (não existe `infra/` neste repo). Ambos declarados na seção 2.
