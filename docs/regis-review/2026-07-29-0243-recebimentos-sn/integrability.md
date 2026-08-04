---
qa: Integrability
qa_slug: integrability
run_id: 2026-07-29-0243-recebimentos-sn
agent: qa-integrability
generated_at: 2026-07-29T02:43:00-03:00
scope: all
score: 7.5
findings_count: 6
cards_count: 6
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time do produto (após HML/HAR do Conexos confirmar `gcdCod` real + shape final de `gerDocProcesso`) | Necessidade de sair do **dry-run** e cabear o `POST /api/com299/gerDocProcesso` de verdade — trocando `NotImplementedError` por chamada autenticada com handshake `ensureSid` + `postGeneric` (parity com `ConexosBaixaClient`) | Seam `SolicitacaoNumerarioService.enviarAoErp` (`SolicitacaoNumerarioService.ts:117-121`) + `ProcessoProviderStub` (via `PROCESSO_PROVIDER_TOKEN`) trocado por adapter Conexos real | Ambiente HML com credenciais dedicadas, feature-flag `dryRun` na rota, sem tráfego de PROD | Substituir o corpo de `enviarAoErp` por uma chamada `ConexosGerDocClient.gerDocProcesso(payload)` + atualizar a rota para passar `dryRun` real; trocar `ProcessoProviderStub` por `ConexosProcessoProvider` no `recebimentosContainer.ts` — **sem tocar** rota, service ou testes de service | ≤ 1 arquivo novo (client), 1 linha modificada em `recebimentosContainer.ts`, 0 mudanças em `routes/recebimentos.ts`/`SolicitacaoNumerarioService.gerar`; TTFC (time-to-first-call em HML) ≤ 1 dia; regressão de testes = 0 |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Public methods generic HTTP (`get/post/request/call`) em service/stub SN | 0 | 0 | ✅ | `grep -c "public " SolicitacaoNumerarioService.ts ProcessoProviderStub.ts` — 2/1, todas domain-specific (`gerar`, `enviarAoErp`, `listCandidatosParaTransacao`) |
| `axios`/`fetch(` direto em route/service SN | 0 | 0 | ✅ | `grep axios\|fetch(` em `routes/recebimentos.ts:1-239` + `SolicitacaoNumerarioService.ts:1-122` |
| Zod schemas exportados no boundary DTO (`GerDocProcesso.ts`) | 2 (`processoSchema`, `gerDocProcessoSelectionDTOCabSchema`) | 2 usadas | ⚠️ | `GerDocProcesso.ts:39-48,101-116` — declarados; **zero imports** no restante do backend (`grep -rn "gerDocProcessoSelectionDTOCabSchema\|processoSchema\b" src/backend` → só a definição + docstring de fixture) |
| Validação Zod real no boundary da rota SN | inline `gerarSolicitacaoNumerarioSchema` (`recebimentos.ts:181-190`) | schema reusa o DTO canônico | ⚠️ | duplicação entre `recebimentos.ts:181-190` e `GerDocProcesso.ts:39-48` — dois shapes convivem; drift silencioso possível |
| Distância do padrão `ConexosBaixaClient` (handshake `ensureSid` + `postGeneric` + `postGenericOnce` write-once) | seam `enviarAoErp` **não** herda de `ConexosBaseClient`; assinatura `(_payload) => never` — não está no diretório `client/` | reuso do handshake da família fin010 no futuro adapter | ⚠️ | `SolicitacaoNumerarioService.ts:117-121` vs `ConexosBaixaClient.ts:52-80` (padrão `singleton+injectable+ConexosBaseClient injetado`) |
| `gcdCod` no wire | `0` (placeholder) — `SOLICITACAO_NUMERARIO_DOC_CONFIG.gcdCod = 0` | valor real do HML | ❌ | `constants.ts:130-134` + `conexos-com299-gerdoc.md:18` (open-gap P0) |
| Ports SEAM implementados (`PROCESSO_PROVIDER_TOKEN` swappable) | 1/1 (`ProcessoProviderStub` bindado; consumidor usa `container.resolve<ProcessoProviderInterface>`) | 1/1 | ✅ | `recebimentosContainer.ts:55` + `routes/recebimentos.ts:171` |
| Fixture de resposta real (HAR) do `gerDocProcesso` versionada | 0 | ≥1 (para contract test) | ❌ | `ls src/backend/domain/interface/recebimentos/__fixtures__/` → só `processo.fixture.ts` (input); nenhum HAR/wire fixture do Conexos |
| Cross-boundary FE↔BE — DTO redigitado no FE (drift risk) | 4 tipos duplicados (`Processo`, `TmpCom068DTOItem`, `GerDocProcessoSelectionDTOCab`, `DocConfig`) | tipos compartilhados / codegen | ⚠️ | `src/frontend/lib/recebimentos.ts:311-362` vs `src/backend/domain/interface/recebimentos/GerDocProcesso.ts:19-134` |
| Versionamento do endpoint externo (`api-version` / `/v1/`) | ausente — path é `com299/gerDocProcesso` | pinning explícito quando o provider suportar | ⚠️ | `conexos-com299-gerdoc.md:36` — endpoint sem versão de URL/header (limitação do Conexos, não do repo) |
| LOC do delta SN (5 arquivos-core) | 554 | — | ✅ | `_shared-metrics.md` |
| Cobertura de contract test do seam `enviarAoErp` | throws `NotImplementedError` (verificado — `SolicitacaoNumerarioService.test.ts:78-88`) | idem por ora; teste de contract quando cabear | ✅ (temporário) | `SolicitacaoNumerarioService.test.ts:77-88` |

> ⚠️ **Não medível localmente**: latência real do `gerDocProcesso` HML, taxa de erro por-dependência (Conexos vs. rota SN). Requer observabilidade em HML + APM. Recomendação: quando `enviarAoErp` for cabeado, instrumentar via `LogService` com `dependency=conexos-com299-gerdoc, outcome, latencyMs` e agregar em CloudWatch/logs estruturados.

## 3. Tactics — Cobertura no nf-projects

### Limit Dependencies

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `SolicitacaoNumerarioService` expõe **apenas** verbos de domínio (`gerar`, `enviarAoErp`); nenhum vazamento de `axios`/`fetch`; DTO `GerDocProcessoSelectionDTOCab` isola o wire com299 num único módulo | ✅ presente | `SolicitacaoNumerarioService.ts:44-122`, `GerDocProcesso.ts:63-87` |
| Use an Intermediary | `ProcessoProviderInterface` (`ports.ts:228-236`) + `PROCESSO_PROVIDER_TOKEN` (`ports.ts:351`) — port explícito entre a rota "Alocar" e a fonte de candidatos (stub hoje, Conexos/matching amanhã) | ✅ presente | `routes/recebimentos.ts:171` resolve por token; `recebimentosContainer.ts:55` bind swappable |
| Restrict Communication Paths | Rota → service (DI) → port; nenhum acesso lateral. `enviarAoErp` é o **único** caminho previsto para o wire — e está bloqueado (`throw`) | ✅ presente | `SolicitacaoNumerarioService.ts:117-121`; `recebimentos.ts:199-237` |
| Adhere to Standards | Payload espelha nomes wire do swagger com299 (`priCod`, `pesCod`, `gcdCod`, `TmpCom068DTOItem`) — política CLAUDE.md § "Language" permite pt-BR quando espelha ERP. Erro `NotImplementedError` segue `HandlerError` (`code`, `retryable`, `statusCode: 501`) | ✅ presente | `GerDocProcesso.ts:52-87`, `NotImplementedError.ts:11-25` |
| Abstract Common Services | `NotImplementedError` reusa `HandlerError`; `LogService` injetado pelo container. **Ponto fraco**: o adapter real de `enviarAoErp` **ainda não** herda de `ConexosBaseClient` — quando cabeado, deve reusar `ensureSid`/`postGeneric`/`postGenericOnce` (padrão de `ConexosBaixaClient.ts:52-80`) para não duplicar handshake | ⚠️ parcial | `SolicitacaoNumerarioService.ts:1-15` (importa erro + LogService, mas nada de ConexosBase) vs `ConexosBaixaClient.ts:52-80` |

### Adapt

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Discover Service | N/A para esta iteração — endpoint com299 é resolvido via SSM downstream (o adapter real vai reusar `ConexosBaseClient` que já lê `EnvironmentProvider`). Não medível no delta SN | N/A | — |
| Tailor Interface | `GerarSolicitacaoNumerarioInput` (`SolicitacaoNumerarioService.ts:18-30`) é a interface tailored para o "Processar" — mapeia (`processo` + `valorTransacao` + `dataReferencia` + `ator`) → `GerDocProcessoSelectionDTOCab`, escondendo do caller a estrutura swagger | ✅ presente | `SolicitacaoNumerarioService.ts:18-30, 58-110` |
| Configure Behavior | `SOLICITACAO_NUMERARIO_DOC_CONFIG`, `SOLICITACAO_NUMERARIO_DOC_TIP`, `SOLICITACAO_NUMERARIO_DOC_VLD_TIPO`, `SOLICITACAO_NUMERARIO_MOE_COD` isolados em `constants.ts:130-140` — troca por SSM/param é uma mudança em 1 arquivo | ✅ presente | `constants.ts:130-140` |
| Manage Resources | Seam `enviarAoErp` marcado `NotImplementedError` com `retryable: false` (`NotImplementedError.ts:15`) impede `RetryExecutor` de tentar de novo. Bom sinal de disciplina — mas o adapter real precisará respeitar `ExternalCallOptions.timeoutMs` (`ports.ts:44-49`) para não pinar worker; hoje a assinatura `enviarAoErp(_payload)` **não** aceita `opts?: ExternalCallOptions` (regressão vs. os outros ports Frente IV) | ⚠️ parcial | `SolicitacaoNumerarioService.ts:117` vs `ports.ts:44-49, 193-207` |

### Coordinate

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Orchestrate | Rota `/solicitacao-numerario` faz **1** chamada síncrona (service.gerar) — não é um orquestrador multi-collaborator. `/pipeline/run` (existente) orquestra o coordinator. Escopo SN puro: linear/simples | ✅ presente | `recebimentos.ts:199-237` |
| Manage Resource Coupling | `PROCESSO_PROVIDER_TOKEN` é um Symbol dedicado (não compartilhado com Nexxera/ERP writes) — troca de fonte de dados não cascatéia; `SolicitacaoNumerarioService` **não injeta** `ProcessoProviderInterface` (o provider é resolvido só na rota de listagem), então SN e Alocar são coupled apenas via wire DTO | ✅ presente | `ports.ts:338-354`, `routes/recebimentos.ts:171, 220` |

### Modern facets

| Tactic (extra) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Contract testing (schema-pinned) | `SolicitacaoNumerarioService.test.ts` cobre a **construção** do payload (5 casos) + `enviarAoErp` throws (`SolicitacaoNumerarioService.test.ts:13-88`). **Ausente**: fixture HAR real do `gerDocProcesso` para pinar o shape esperado do lado provider. `gerDocProcessoSelectionDTOCabSchema` existe mas nenhum teste roda `.parse()` contra amostras de wire | ⚠️ parcial | `SolicitacaoNumerarioService.test.ts:13-88`; `GerDocProcesso.ts:101-116` órfão |
| Versioning strategy | `ontology_version: "0.11"` na integração + `open-gap` versionado (`conexos-com299-gerdoc.md:1-21`). URL do endpoint sem versão explícita (limitação do Conexos) | ⚠️ parcial | `conexos-com299-gerdoc.md:2-21` |
| Backward-compatibility shims | N/A — sem consumidores externos do payload SN ainda; DRY-RUN | N/A | — |
| Observability of integration failures | `logService.info({ type: 'BUSINESS_INFO', ... })` no `gerar` com `dryRun/priCod/filCod/gcdDesNome/ator` (`SolicitacaoNumerarioService.ts:97-107`). **Faltando**: contador por-dependência (SN não emite `MetricsEvent` via `METRICS_PORT_TOKEN`) — quando `enviarAoErp` for cabeado, será cego a taxa de erro isolada Conexos vs. app | ⚠️ parcial | `SolicitacaoNumerarioService.ts:97-107` vs `ports.ts:127-140, 209-218` |

## 4. Findings (achados)

### F-integrability-1: `enviarAoErp` não aceita `ExternalCallOptions` — regressão do contrato Frente IV

- **Severidade**: P1
- **Tactic violada**: Manage Resources
- **Localização**: `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:117-121`; contraste com `src/backend/domain/interface/recebimentos/ports.ts:44-49, 144-146, 193-207`
- **Evidência (objetiva)**:
  ```typescript
  // ports.ts (contrato Frente IV para toda chamada externa)
  export interface ExternalCallOptions {
      timeoutMs?: number;
      signal?: AbortSignal;
  }
  // Nexxera, ERP receivables, NDe todos aceitam `opts?: ExternalCallOptions`

  // SolicitacaoNumerarioService.ts:117
  public enviarAoErp = async (_payload: GerDocProcessoSelectionDTOCab): Promise<never> => {
      throw new NotImplementedError(...);
  };
  ```
- **Impacto técnico**: quando o seam for cabeado, o autor terá de mudar a assinatura (+ callers) para injetar `timeoutMs`; alternativamente, esquecerá e um `await` puro sob incidente Conexos pinará o worker Express até o timeout global (mitigação `ERP_WRITE_TIMEOUT_MS` em `constants.ts:100` fica órfã). É exatamente o cenário que Frente IV tentou padronizar via `ExternalCallOptions`.
- **Impacto de negócio**: reintrodução do risco do incidente `LOGIN_ERROR_MAX_SESSIONS` (SISPAG) — chamadas Conexos travando workers e degradando o painel de Recebimentos. Custo estimado do fix pós-fato: ~1 dia (M) vs. 15min agora.
- **Métrica de baseline**: 3/3 ports write Frente IV honram `ExternalCallOptions` (`ports.ts:144, 196, 200, 206`); `enviarAoErp` = 0/1. Alvo 1/1.

### F-integrability-2: schemas Zod exportados órfãos — validação de boundary não é realmente aplicada

- **Severidade**: P1
- **Tactic violada**: Adhere to Standards (Zod at boundaries — CLAUDE.md § TypeScript Style)
- **Localização**: `src/backend/domain/interface/recebimentos/GerDocProcesso.ts:39-48, 101-116`; `src/backend/routes/recebimentos.ts:181-190`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "gerDocProcessoSelectionDTOCabSchema\|processoSchema\b" src/backend
  GerDocProcesso.ts:3:/** Sample `Processo` (candidato de importação) — valid against `processoSchema`. */  (fixture docstring)
  GerDocProcesso.ts:39:export const processoSchema = z.object({ ... })
  GerDocProcesso.ts:101:export const gerDocProcessoSelectionDTOCabSchema = z.object({ ... })
  # Zero consumers.
  ```
  A rota define **inline** `gerarSolicitacaoNumerarioSchema` (`recebimentos.ts:181-190`) que espelha `processoSchema` **manualmente** — dois schemas convivem para o mesmo campo (`priCod`, `filCod`, `pesCod`…).
- **Impacto técnico**: drift silencioso — mudar o DTO em um lugar não força atualização no outro; `gerDocProcessoSelectionDTOCabSchema` (validação do PAYLOAD final antes do POST) simplesmente **não roda** — nada garante que o payload construído por `gerar()` é válido antes de sair pela rede quando `enviarAoErp` for cabeado.
- **Impacto de negócio**: primeiro POST real ao Conexos pode enviar um shape divergente do swagger e o operador só descobre pelo erro do ERP (custo: HAR + debug + re-teste em HML). O contrato existe mas não protege ninguém.
- **Métrica de baseline**: 2 schemas exportados, 0 consumidores efetivos. Alvo: `gerar()` chama `.parse()` no payload antes de retornar, e a rota reusa `processoSchema.extend({ valorTransacao: z.number() })` em vez do inline.

### F-integrability-3: DTO SN duplicado literalmente entre backend e frontend — sem tipo compartilhado

- **Severidade**: P2
- **Tactic violada**: Use an Intermediary (contrato compartilhado)
- **Localização**: `src/frontend/lib/recebimentos.ts:311-362` (`Processo`, `TmpCom068DTOItem`, `GerDocProcessoSelectionDTOCab`, `DocConfig`, `SolicitacaoNumerarioDryRun`) vs `src/backend/domain/interface/recebimentos/GerDocProcesso.ts:19-134` (mesmos nomes, mesmos campos)
- **Evidência (objetiva)**:
  ```typescript
  // backend GerDocProcesso.ts:53-61
  export interface TmpCom068DTOItem { prjCod: number; ctpCod: number; tmpMnyValor: number; ... }

  // frontend lib/recebimentos.ts:323-331 (idêntico, redigitado à mão)
  export interface TmpCom068DTOItem { prjCod: number; ctpCod: number; tmpMnyValor: number; ... }
  ```
  Além disso o FE tem `buildDryRunFallback` (`recebimentos.ts:392-428`) que **reimplementa** a montagem do payload que o backend já faz — nova cópia da constante `gcdCod=0`, `docTip='SN'`, `moeCod=790`.
- **Impacto técnico**: qualquer mudança no swagger com299 força N edições (interface BE + interface FE + fallback FE + testes). Já há evidência de drift latente: o backend usa `SOLICITACAO_NUMERARIO_MOE_COD = 790` de `constants.ts`, o FE tem `790` hardcoded.
- **Impacto de negócio**: cada tweak do provider (HML corrigindo `docTip`, adicionando campo obrigatório) exige tocar 4+ arquivos; probabilidade de deploy inconsistente FE↔BE cresce com o tempo.
- **Métrica de baseline**: 4 interfaces duplicadas 1:1 + 1 fábrica duplicada; 0 tipos compartilhados. Alvo: 1 pacote/module shared ou codegen a partir do backend (2/4 mínimo).

### F-integrability-4: sem fixture HAR real do `gerDocProcesso` — contract test do lado provider ausente

- **Severidade**: P2
- **Tactic violada**: Contract testing
- **Localização**: `src/backend/domain/interface/recebimentos/__fixtures__/` (só `processo.fixture.ts` — INPUT); ontology gap `gcdCod-solicitacao-numerario-encomenda` (`conexos-com299-gerdoc.md:18`)
- **Evidência (objetiva)**:
  ```
  $ ls src/backend/domain/interface/recebimentos/__fixtures__/
  processo.fixture.ts
  # Nenhum HAR / wire response do Conexos.
  ```
  Todos os testes SN (`SolicitacaoNumerarioService.test.ts`) são **construção** de payload — nenhum valida contra uma resposta HAR real do `gerDocProcesso` (que hoje nem foi capturada).
- **Impacto técnico**: quando cabearem `enviarAoErp`, o parse da resposta será exercitado pela primeira vez em runtime — mesmo pattern que os P0 anteriores da Frente II (Zod tardio no `ConexosBaixaClient`).
- **Impacto de negócio**: dry-run atual esconde o problema; primeira homologação vira "test-in-prod" (HML). Custo: 1 rodada extra de HML por campo divergente.
- **Métrica de baseline**: 0 fixtures HAR versionadas; 0 testes de parse. Alvo: 1 fixture HAR + 1 teste `.parse()` antes de cabear `enviarAoErp`.

### F-integrability-5: `gcdCod=0` placeholder — endpoint externo com valor inválido no wire

- **Severidade**: P1
- **Tactic violada**: Configure Behavior (parametrização externa)
- **Localização**: `src/backend/domain/interface/recebimentos/constants.ts:130-134`; `conexos-com299-gerdoc.md:18` (open-gap P0)
- **Evidência (objetiva)**:
  ```typescript
  // constants.ts:130-134
  export const SOLICITACAO_NUMERARIO_DOC_CONFIG = {
      /** PLACEHOLDER — confirmar o `gcdCod` real via HML/HAR antes de qualquer envio ao ERP. */
      gcdCod: 0,
      gcdDesNome: 'Solicitação de Numerário - Encomenda',
  } as const;
  ```
  Bloqueio de segurança **está no lugar** (`enviarAoErp` throws) e o comentário é explícito. Mas o valor mora em código como constante literal; quando o HML confirmar, será um patch em constants.ts sem gate arquitetural que impeça um POST acidental com o `0` (basta remover o throw).
- **Impacto técnico**: um caminho single-line ("remover o throw") transforma o dry-run em POST inválido para o ERP; a defesa é **exclusivamente** o `NotImplementedError`. Sem write-enabled gate + dry-run gate (o mesmo padrão do `ConexosBaixaClient` — Homologação-first citado em `conexos-com299-gerdoc.md:76-78`), a superfície de erro é maior que precisa.
- **Impacto de negócio**: risco de criar documento SN com config errada no ERP (efeito colateral no financeiro do cliente — irreversível sem estorno manual). Baixa probabilidade mas alto impacto.
- **Métrica de baseline**: 1 constante placeholder (`gcdCod=0`); 0 gates de "write-enabled + HML-confirmed" no seam. Alvo: 1 gate (env flag `SN_LIVE_WRITE_ENABLED=false` por default, checado em `enviarAoErp`) — mesmo padrão de `ConexosBaixaClient` para fin010.

### F-integrability-6: sem observabilidade por-dependência para o seam SN (métricas de erro ausentes)

- **Severidade**: P2
- **Tactic violada**: Observability of integration failures
- **Localização**: `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:97-107`; port `METRICS_PORT_TOKEN` (`ports.ts:209-218`) já existe mas não é usado
- **Evidência (objetiva)**:
  ```typescript
  // SolicitacaoNumerarioService.ts:97-107 — só log BUSINESS_INFO, sem MetricsEvent
  void this.logService.info({
      type: 'BUSINESS_INFO',
      message: 'gerarSolicitacaoNumerario (dry-run) — nenhuma chamada ao ERP',
      data: { dryRun: true, priCod, filCod, gcdDesNome, ator },
  });
  // Nenhum metricsPort.emit({ stage: 'gerar-sn', outcome: 'ok', ... })
  ```
- **Impacto técnico**: quando `enviarAoErp` cabear, não haverá contador `dependency=conexos-com299-gerdoc` isolado — a taxa de erro ficará misturada com o resto do coordinator no `LogService`. Detectar degradação seletiva do provider vira grep em logs.
- **Impacto de negócio**: MTTR maior em incidente Conexos; não dá para alertar em "SN error rate > X%" sem re-instrumentar depois. Custo baixo agora (1h), alto depois de N features consumindo o mesmo padrão.
- **Métrica de baseline**: 0 `MetricsEvent` emitidos por `SolicitacaoNumerarioService`; port `METRICS_PORT_TOKEN` disponível mas não injetado. Alvo: 1 `emit({stage:'gerar-sn', outcome:'ok'|'error', attributes:{dryRun}})` por chamada de `gerar()` (sem PII — invariante do port).

## 5. Cards Kanban

### [integrability-1] Aceitar `ExternalCallOptions` no seam `enviarAoErp`

- **Problema**
  > A assinatura `enviarAoErp(_payload: GerDocProcessoSelectionDTOCab): Promise<never>` diverge dos outros ports write de Frente IV (`NexxeraGateway`, `ErpReceivablesGateway`, `NdeEmitter`), que aceitam `opts?: ExternalCallOptions` com `timeoutMs`/`signal`. Quando o seam for cabeado, um `await` puro sob incidente Conexos pinará o worker Express até o timeout global — reintroduzindo o cenário `LOGIN_ERROR_MAX_SESSIONS` que a Frente IV já mitigou em outros pontos.

- **Melhoria Proposta**
  > Ajustar `SolicitacaoNumerarioService.enviarAoErp` para aceitar `opts?: ExternalCallOptions` (com default de `ERP_WRITE_TIMEOUT_MS`, `constants.ts:100`) e envolvê-lo no `RetryExecutor + timeoutMs` no futuro adapter. Tactic Bass alvo: **Manage Resources**. Arquivos: `SolicitacaoNumerarioService.ts`, `SolicitacaoNumerarioService.test.ts`.

- **Resultado Esperado**
  > 1/1 ports write Frente IV com `ExternalCallOptions` (hoje 3/4). Impede regressão do incidente de sessões.

- **Tactic alvo**: Manage Resources
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Ports write Frente IV com `ExternalCallOptions`: 3/4 → 4/4
  - Tempo médio de request pinando worker sob incidente Conexos: sem teto → ≤ `ERP_WRITE_TIMEOUT_MS`
- **Risco de não fazer**: um cabeamento futuro esquece o `timeoutMs`, reproduz `LOGIN_ERROR_MAX_SESSIONS` em 6 meses; MTTR ~4h + rollback.
- **Dependências**: nenhuma.

### [integrability-2] Reusar Zod DTO canônico na rota e validar o payload antes do POST

- **Problema**
  > `gerDocProcessoSelectionDTOCabSchema` e `processoSchema` são exportados em `GerDocProcesso.ts:39-116` mas **nenhum** módulo do backend os importa. A rota redigita um schema inline (`recebimentos.ts:181-190`) para o mesmo shape — dois schemas convivem. `gerar()` também não valida o payload construído antes de devolver/enviar.

- **Melhoria Proposta**
  > (1) Trocar o inline por `processoSchema.extend({ valorTransacao: z.number() })` na rota `/solicitacao-numerario`; (2) chamar `gerDocProcessoSelectionDTOCabSchema.parse(payload)` no fim de `gerar()` — o custo é O(1) e garante que o payload dry-run já é válido para o futuro POST. Tactic Bass alvo: **Adhere to Standards / Encapsulate**. Arquivos: `routes/recebimentos.ts`, `SolicitacaoNumerarioService.ts`.

- **Resultado Esperado**
  > 2 schemas Zod exportados → 2 usados; 0 duplicações de shape entre rota e DTO canônico; primeira invocação de `enviarAoErp` ao vivo já sai com payload validado.

- **Tactic alvo**: Adhere to Standards
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Schemas exportados sem consumers: 2 → 0
  - Boundary Zod coverage do payload SN: 0% → 100%
- **Risco de não fazer**: primeiro POST real ao Conexos envia shape divergente; descoberta pelo erro do ERP. Custo: rodada extra HML.
- **Dependências**: nenhuma.

### [integrability-3] Compartilhar tipos SN entre backend e frontend (evitar redigitar DTO)

- **Problema**
  > `Processo`, `TmpCom068DTOItem`, `GerDocProcessoSelectionDTOCab`, `DocConfig`, `SolicitacaoNumerarioDryRun` estão duplicados 1:1 em `src/frontend/lib/recebimentos.ts:311-362` (redigitados à mão) e ainda há uma **fábrica de fallback** (`buildDryRunFallback`, `recebimentos.ts:392-428`) que reimplementa a montagem do payload — inclusive re-hardcoding `790` (moeda) e `'SN'` (docTip). Drift latente garantido.

- **Melhoria Proposta**
  > Extrair os DTOs para um módulo `shared/` (ou publicar como pacote), consumido por FE e BE. Alternativa mínima: expor um endpoint `/recebimentos/sn/schema` que devolve a config canônica (`gcdCod`, `docTip`, `moeCod`) e o FE lê no boot — matando o fallback duplicado. Tactic Bass alvo: **Use an Intermediary**. Arquivos: `src/frontend/lib/recebimentos.ts`, `src/backend/domain/interface/recebimentos/GerDocProcesso.ts` (extrair `shared/dto/gerdoc.ts`).

- **Resultado Esperado**
  > 4 interfaces duplicadas → 0; 1 fábrica duplicada → 0; qualquer tweak do swagger com299 muda **1** arquivo.

- **Tactic alvo**: Use an Intermediary
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — envolve build config (paths, tsconfig references)
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Interfaces SN duplicadas FE/BE: 4 → 0
  - Constantes SN hardcoded no FE: 2 (`790`, `'SN'`) → 0
- **Risco de não fazer**: em 6 meses, um deploy FE-only diverge do BE após atualização de swagger; sintoma é UI mostrando payload obsoleto no preview.
- **Dependências**: [integrability-2] (ter o DTO canônico como fonte única já ajuda).

### [integrability-4] Capturar HAR HML do `gerDocProcesso` e adicionar contract test de parsing

- **Problema**
  > Não existe fixture HAR real do `gerDocProcesso` versionada; `SolicitacaoNumerarioService.test.ts` cobre só a construção. Quando `enviarAoErp` for cabeado, o parse da resposta será exercitado pela primeira vez em runtime — mesmo pattern do que já viveu Frente II (Zod tardio nos returns do fin010).

- **Melhoria Proposta**
  > Capturar 1 HAR real do `gerDocProcesso` em HML (dentro do próximo ciclo com credencial) → salvar em `__fixtures__/gerDocProcesso.har.json` → criar `SolicitacaoNumerarioService.contract.test.ts` que roda `gerDocProcessoSelectionDTOCabSchema.parse(harRequest)` e um `gerDocProcessoResponseSchema.parse(harResponse)` a ser criado. Tactic Bass alvo: **Contract testing**. Arquivos: novo `__fixtures__/gerDocProcesso.har.json`, novo `GerDocProcesso.contract.test.ts`.

- **Resultado Esperado**
  > 0 fixtures HAR → 1; 0 contract tests → 1; garantia de que o primeiro POST live vem de payload já parseado contra shape real.

- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) uma vez que HML esteja acessível
- **Findings relacionados**: F-integrability-4, F-integrability-5
- **Métricas de sucesso**:
  - Fixtures HAR SN versionadas: 0 → 1
  - Testes de parse contra HAR: 0 → 1
- **Risco de não fazer**: primeira homologação vira "test-in-prod" HML; rodadas extras.
- **Dependências**: acesso credenciado ao HML (bloqueio externo — trata como pré-req).

### [integrability-5] Adicionar gate `SN_LIVE_WRITE_ENABLED` + `dryRun` gate no seam `enviarAoErp`

- **Problema**
  > A única defesa contra um POST real com `gcdCod=0` (placeholder) é o `throw new NotImplementedError` no seam. Um patch single-line ("remover o throw") transforma o dry-run em POST inválido. O padrão `ConexosBaixaClient` (Homologação-first, citado em `conexos-com299-gerdoc.md:76-78`) usa write-enabled + dry-run gate — a Frente IV precisa herdar isso antes de cabear.

- **Melhoria Proposta**
  > Adicionar env flag `SN_LIVE_WRITE_ENABLED=false` (via `EnvironmentProvider`) + `dryRun: boolean` no `enviarAoErp` — recusar POST quando `!liveEnabled || dryRun || gcdCod === 0`. Tactic Bass alvo: **Configure Behavior**. Arquivos: `EnvironmentProvider`, `SolicitacaoNumerarioService.ts`, `constants.ts` (adicionar `SN_MIN_VALID_GCD_COD > 0` guard).

- **Resultado Esperado**
  > 0 gates → 3 gates (env flag + dryRun + placeholder-detection). Impede que uma remoção acidental de `throw` alcance produção sem passar por config explícita.

- **Tactic alvo**: Configure Behavior
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-5
- **Métricas de sucesso**:
  - Gates independentes protegendo POST live: 1 (throw) → 3 (throw + env flag + placeholder guard)
  - Chance de POST com `gcdCod=0` após 1 patch trivial: alta → efetivamente nula
- **Risco de não fazer**: 1 PR sem revisão remove o throw e cria documento SN inválido no ERP; efeito colateral irreversível.
- **Dependências**: nenhuma.

### [integrability-6] Emitir `MetricsEvent` por-dependência no `gerar` e `enviarAoErp` (usar `METRICS_PORT_TOKEN`)

- **Problema**
  > `SolicitacaoNumerarioService` só emite `LogService.info` (`SolicitacaoNumerarioService.ts:97-107`). O port `METRICS_PORT_TOKEN` (`ports.ts:209-218`) — desenhado justamente para observabilidade por-dependência — não é injetado no service SN. Quando o seam cabear, a taxa de erro Conexos ficará misturada com o resto do coordinator; alerta seletivo em "SN error rate" fica impossível sem re-instrumentar.

- **Melhoria Proposta**
  > Injetar `@inject(METRICS_PORT_TOKEN) metricsPort: MetricsPortInterface` no `SolicitacaoNumerarioService` e emitir `MetricsEvent { stage: 'gerar-sn', outcome, attributes: { dryRun, filCod } }` em `gerar()` e (futuramente) em `enviarAoErp()`. Respeitar o invariante `no-PII` do port (contraparte/pesCod fora — só `filCod`/`dryRun`/`outcome`). Tactic Bass alvo: **Observability of integration failures**. Arquivos: `SolicitacaoNumerarioService.ts` + tests.

- **Resultado Esperado**
  > 0 `MetricsEvent` emitidos por SN → 1 por chamada; base para alerta "SN error rate > X%" no cabeamento.

- **Tactic alvo**: Observability of integration failures
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-6
- **Métricas de sucesso**:
  - Chamadas `gerar()` com metric emitida: 0% → 100%
  - Alertabilidade seletiva por-dependência (SN): não → sim
- **Risco de não fazer**: MTTR maior em incidente Conexos pós-cabeamento; próximas features Frente IV copiam o anti-padrão.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo restrito ao delta SN (5 arquivos-core + rota + FE lib). Frontend `AlocarProcessosDialog` inspecionado indiretamente via `lib/recebimentos.ts` (mesmas duplicações).
- Cross-QA: F-integrability-2 (Zod schemas órfãos) sobrepõe com **Security** (validação de boundary) e **Fault-Tolerance** (payload garantido antes de POST). F-integrability-5 (`gcdCod=0` gate) sobrepõe com **Availability** e **Modifiability**. F-integrability-1 (`ExternalCallOptions` ausente) sobrepõe com **Performance** (timeouts). Sinalizar ao consolidator para não duplicar cards.
- Não medível localmente: latência real HML, taxa de erro por-dependência (requer instrumentação + APM em HML/PROD).
- Score 7.5 = boas escolhas de encapsulation/tactic (port swappable + throw como gate + DTO isolado); pontos deixados na mesa em disciplina de contract (Zod órfão, DTO duplicado FE/BE, sem HAR).
