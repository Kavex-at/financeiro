---
qa: Integrability
qa_slug: integrability
run_id: 2026-07-24-2153
agent: qa-integrability
generated_at: 2026-07-24T21:53:00Z
scope: backend
score: 8.5
findings_count: 6
cards_count: 6
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

Contrato-first, fully-stubbed. O que estressa a integrabilidade **hoje** não é uma carga externa
em produção — é a próxima integração real: os 6 times de Frente IV vão preencher `NexxeraGateway`
(canal ainda em spike O7 — API vs SFTP/CNAB), `ErpReceivablesGateway` (retorno do handshake fin010
sem herdar o acoplamento a permuta), `NdeEmitter`, e os engines de match/rateio/regras. O scaffold
tem que absorver 6 substituições paralelas sem tocar o coordinator e sem tocar as outras 5 portas.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time de módulo (M1..M6) | swap do stub pelo impl real (uma porta) | `recebimentosContainer.ts` (1 binding) | dev/staging (feature-flag `RECEBIMENTOS_ENABLED`) | coordinator inalterado; testes verdes com o novo impl | LOC modificados fora do módulo: ≤ 1 (o `container.register(...)`) |
| Time O7 (canal Nexxera) | decisão HTTPS vs SFTP após spike | `NexxeraGatewayStub → NexxeraGatewayApi/Sftp` | pre-prod | `NexxeraGatewayInterface.fetch()` mantém assinatura | Arquivos alterados fora de `stubs/nexxera*`: 0 |
| Yuri (arquitetura) | upgrade do `fin010` (novo `borVldTipo` de recebimento) | `ErpReceivablesGatewayInterface.criarBordero` | prod | `borVldTipo`/`contaDestino` já são PARAM (não hardcoded) | Zero hardcodes de `borVldTipo` fora do coordinator input |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Portas (interfaces) exportadas em `ports.ts` | 32 | ≥ 20 (todos seams do §3 spec) | ✅ | `grep -c '^export interface' ports.ts` |
| DI tokens (`Symbol`) exportados | 14 | 14 (uma por porta injetável) | ✅ | `grep -c '^export const.*_TOKEN' ports.ts` |
| Deps do coordinator injetadas por token | 10/11 (10 tokens + LogService concreto) | 100% via token (LogService é @singleton compartilhado — OK) | ✅ | `RecebimentoPipelineService.ts:60-82` |
| Import sites do stub Nexxera fora do container | 0 | 0 (troca de canal é 1-linha) | ✅ | `grep -rn NexxeraGatewayStub src/backend` |
| Ports com Zod schema no boundary | 0/32 (Zod está nos DTOs de entidade, não nas portas) | ≥ 4 (Nexxera/ERP/NDe/Ingest — payload externo) | ⚠️ | `grep -n 'z\.object\|parse' ports.ts` |
| DTOs de entidade com Zod schema | 7/7 | 7/7 | ✅ | `grep -l zod interface/recebimentos/*.ts` |
| Hardcodes de `borVldTipo` fora do input | 0 (é PARAM em `CriarBorderoParams`) | 0 | ✅ | `grep -n 'borVldTipo:.*2' service/recebimentos/*.ts` |
| Contract tests por porta (conformance) | 0/8 portas de módulo | ≥ 1 (Nexxera + ERP + NDe) | ⚠️ | `find domain/service/recebimentos -name '*Contract*.test.ts'` |
| Cross-imports de módulo (fora de `ports.ts` + DTO) | 0 | 0 | ✅ | `grep -rn '/service/recebimentos/stubs/' src/backend \| grep -v recebimentosContainer` |
| Feature-flag para o gateway inteiro | `RECEBIMENTOS_ENABLED` (URL-gate 403) | on/off por env | ✅ | `http/recebimentosGate.ts:16-21` |
| Versionamento no port Nexxera (canal/API version) | ausente | metadado `channel`/`apiVersion` no `RawMovimento` ou `fetch()` | ⚠️ | `ports.ts:24-31,132-134` |
| `attributes: Record<string, ...>` protegido de PII por tipo | não (disciplina apenas) | branded type ou union enumerada | ⚠️ | `ports.ts:126` |

> ⚠️ **Não medível localmente**: taxa de erro por dependência (per-integration error rate). Requer CloudWatch/métrica em prod; recomendação — expor `MetricsPortInterface.emit` com `outcome: 'error'` já reservado, e agregar por `stage` no Módulo 6.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Cada porta é uma interface pequena e domain-specific; nenhum método genérico (`get`/`post`/`request`) vaza; `ErpReceivablesGatewayInterface` expõe `criarBordero`/`gravarBaixa`, não HTTP. | ✅ presente | `ports.ts:132-171` |
| Use an Intermediary | O coordinator (`RecebimentoPipelineService`) é o único ponto que conhece as 8 portas; nenhum módulo importa outro módulo direto — só a porta + DTO. | ✅ presente | `RecebimentoPipelineService.ts:60-82` |
| Restrict Communication Paths | Rotas HTTP chegam via `recebimentosGate` → `routes/recebimentos.ts` → `container.resolve(RecebimentoPipelineService)`. Nenhum `container.resolve` no service; só nos tests. | ✅ presente | `routes/recebimentos.ts:93`, `service/recebimentos/*.ts` (0 hits) |
| Adhere to Standards | tsyringe DI + Zod nos DTOs + SQL parametrizado (`$key`, `$recebimentoId`) espelham o padrão de `ConexosBaixaClient` / `PermutaExecucaoRepository`. | ✅ presente | `RecebimentoExecucaoRepository.ts:39-69` |
| Abstract Common Services | `MetricsPortInterface` reusa `LogService` (não é logger paralelo); `RecebimentoExecucaoRepository` é irmão simétrico do `PermutaExecucaoRepository` (mesma semântica de idempotência). | ✅ presente | `stubs/MetricsPortStub.ts:13-30`, `RecebimentoExecucaoRepository.ts:39-69` |
| Discover Service | `EnvironmentProvider.resolveRecebimentosEnabled` decide habilitar; SSM/env é única fonte. Feature-flag por URL-gate espelha `sispagGate`. | ✅ presente | `EnvironmentProvider.ts:43-52,97`, `recebimentosGate.ts:14-22` |
| Tailor Interface | `NexxeraGatewayInterface.fetch(period)` é uma projeção mínima — o canal (API/SFTP) fica no impl. `RawMovimento.payload: unknown` deixa o wire livre; `normalized: unknown` na `TransacaoBancaria` mantém o adapter dono da tradução. | ✅ presente | `ports.ts:24-31,132-134`, `TransacaoBancaria.ts:31-32` |
| Configure Behavior | `borVldTipo` + `contaDestino` são PARAM no `CriarBorderoParams`/`GravarBaixaParams` — NUNCA hardcoded como `2` (o pecado atual do `ConexosBaixaClient`). `dryRun` também é PARAM. | ✅ presente | `ports.ts:78-107`, `RecebimentoPipelineService.ts:44-47,219-236` |
| Manage Resources | Registro é idempotente (`if (container.isRegistered(...)) return`) para suportar `container.reset()` em testes sem duplicar bindings. | ✅ presente | `recebimentosContainer.ts:41` |
| Orchestrate | Coordinator faz `withCorrelationId → 5 stages` linearmente; cada stage emite `metrics.emit({ started/ok })`, guardas de transição via `assertTransitionRecebimento`. | ✅ presente | `RecebimentoPipelineService.ts:85-95` |
| Manage Resource Coupling | 0 concrete-import cross-module; a única transição stub→real é `container.register(TOKEN, { useClass: X })` — 1 linha em `recebimentosContainer.ts`. | ✅ presente | `recebimentosContainer.ts:44-51` |
| **Contract testing** | Só existem testes end-to-end do coordinator com stubs (`RecebimentoPipelineService.test.ts`); nenhuma **suíte de conformance por porta** que os 6 times possam rodar contra o próprio impl real. | ⚠️ parcial | `RecebimentoPipelineService.test.ts:1-103` (não é contract test) |
| **Versioning strategy** | Ausente na `NexxeraGatewayInterface` (sem `apiVersion`/`channel`). O `fin010` já tem histórico de upgrade (Regis 2026-06-23 mudou path de exclusão); pipeline não versiona o handshake. | ⚠️ parcial | `ports.ts:24-31,132-134,162-171` |
| **Backward-compatibility shims** | Não aplicável no scaffold (nenhum consumer ainda). | N/A | — (todas as portas nasceram nesta fase) |
| **Observability of integration failures** | `MetricsPortInterface.emit` já tem `outcome: 'started' \| 'ok' \| 'error'` reservado; hoje o coordinator só emite `started`/`ok`; **falha entre hops de `executarRecebimento` NÃO chama `metrics.emit({outcome:'error'})` nem `execucaoRepository.markError`** — o ledger fica `reconciling` órfão. | ⚠️ parcial | `RecebimentoPipelineService.ts:183-264` (sem try/catch por hop) |

## 4. Findings (achados)

### F-integrability-1: `RecebimentoPipelineService.executarRecebimento` não trata falha entre hops (ERP → NDe → ledger)

- **Severidade**: P1
- **Tactic violada**: Observability of integration failures / Manage Resource Coupling
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts:183-264`
- **Evidência (objetiva)**:
  ```typescript
  const bordero = await this.erp.criarBordero({...});      // hop 1
  const baixa   = await this.erp.gravarBaixa({...});       // hop 2 — se falhar, borderô já foi criado
  const nde     = await this.ndeEmitter.emitir(aprovado);  // hop 3 — se falhar, baixa já foi gravada
  await this.execucaoRepository.markSettled(idempotencyKey, {...});  // só chega aqui no happy-path
  ```
  Nenhum `try/catch` chama `markError` nem `metrics.emit({outcome:'error'})` entre hops. `RecebimentoExecucaoRepository.markError` existe (linhas 93-109) mas o coordinator não o invoca.
- **Impacto técnico**: quando os stubs virarem reais, uma falha em `gravarBaixa` ou `emitir` deixa `recebimento_execucao` preso em `reconciling` para sempre. Retry humano bate no `alreadySettled=false` do `beginExecution` (não é `settled`) e re-executa `criarBordero` — **duplica borderô**. Espelha exatamente a P0 remediada em `ConexosBaixaClient.gravarBaixaPermuta` (comentário de linhas 458-465).
- **Impacto de negócio**: baixa duplicada = super-quitação de recebível na trilha ERP + NDe duplicada emitida ao cliente. Retrabalho manual para conciliar; risco de auditoria fiscal.
- **Métrica de baseline**: 0/3 hops instrumentados com `markError`; 3/3 hops sem try/catch (linhas 219, 227, 237). Cobertura de erro-path do `executarRecebimento` = 0% (test suite só exercita happy + `alreadySettled` short-circuit).

### F-integrability-2: `NexxeraGatewayInterface` sem Zod no boundary do canal externo

- **Severidade**: P2
- **Tactic violada**: Encapsulate / Tailor Interface (validação faltante no seam externo)
- **Localização**: `src/backend/domain/interface/recebimentos/ports.ts:24-31,132-134`
- **Evidência (objetiva)**:
  ```typescript
  export interface RawMovimento {
      naturalKey: string; filCod: number; valor: number; moeda: string;
      dataMovimento: Date; payload: unknown;   // wire pass-through, zero validação
  }
  export interface NexxeraGatewayInterface {
      fetch: (period: NexxeraFetchPeriod) => Promise<RawMovimento[]>;
  }
  ```
  As 7 entidades locais têm Zod (`transacaoBancariaSchema`, `documentoAReceberSchema`, etc.), mas **a porta que fala com o mundo externo não declara um schema `rawMovimentoSchema`**. Compare com `ConexosBaixaClient.ts:20-35`, onde `BORDERO_CRIADO_SCHEMA`/`BAIXA_GRAVADA_SCHEMA` ficam no client — Regis P0 anterior.
- **Impacto técnico**: quando o adapter real (API ou SFTP/CNAB, pós-O7) começar a receber payload malformado do banco, o erro cai no meio do `IngestaoTransacoes.run` — não no boundary. Rastreio fica mais difícil; dedup por `naturalKey` pode receber string vazia sem detectar.
- **Impacto de negócio**: baixa em conta errada (moeda ou `filCod` inválido silenciosamente aceito). Débito de conciliação futura.
- **Métrica de baseline**: 0/4 portas externas (`NexxeraGateway`, `ErpReceivablesGateway`, `NdeEmitter`, `IngestaoTransacoes`) declaram schema Zod no boundary. Alvo: ≥ 4/4 quando o impl real for construído.

### F-integrability-3: `ErpReceivablesGatewayInterface` não força Zod nas respostas escritas (borCod/bxaCodSeq)

- **Severidade**: P2
- **Tactic violada**: Contract testing / Encapsulate
- **Localização**: `src/backend/domain/interface/recebimentos/ports.ts:90-113,162-166`
- **Evidência (objetiva)**:
  ```typescript
  export interface BorderoCriado { borCod: number; dryRun: boolean; }
  export interface BaixaGravada  { bxaCodSeq: number; dryRun: boolean; }
  export interface ErpReceivablesGatewayInterface {
      criarBordero: (params: CriarBorderoParams) => Promise<BorderoCriado>;
      gravarBaixa:  (params: GravarBaixaParams)  => Promise<BaixaGravada>;
  }
  ```
  `ConexosBaixaClient.criarBordero` (linhas 88 e 478) já **aprendeu** essa lição via `BORDERO_CRIADO_SCHEMA.parse(raw)` / `BAIXA_GRAVADA_SCHEMA.parse(raw)` — Regis P0 antigo. A porta de recebíveis nasce **sem replicar essa disciplina** — cabe ao impl real decidir se parse ou aceita `{}`.
- **Impacto técnico**: um impl que só faça `return await httpClient.post(...)` pode gravar `borCod=NaN` no ledger (`markSettled({borCod: undefined})`). O ledger aceita (`bor_cod = COALESCE($borCod, bor_cod)` — permanece `null`), mas o rastreio para reversão fica quebrado.
- **Impacto de negócio**: baixa registrada sem `borCod` recuperável → impossível reverter no ERP; retrabalho manual.
- **Métrica de baseline**: 0/2 métodos da porta força Zod na resposta; 2/2 métodos do `ConexosBaixaClient` equivalentes forçam. Diferença = 100% do padrão consolidado sendo perdido.

### F-integrability-4: Sem contract-test suite compartilhada por porta (conformance)

- **Severidade**: P2
- **Tactic violada**: Contract testing
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoPipelineService.test.ts:42-103` (é o único teste), `src/backend/domain/service/recebimentos/stubs/*.ts`
- **Evidência (objetiva)**:
  ```
  find src/backend/domain/service/recebimentos -name '*.test.ts'
    RecebimentoPipelineService.test.ts        # end-to-end com stubs — não é contract test
  ```
  Não existe `*Contract*.test.ts` ou `*Conformance*.test.ts` que possa ser rodado contra **qualquer** impl da porta. Cada time (M1..M6) vai escrever seus próprios testes ad-hoc; nada garante que o impl real preserva as semânticas do stub (ex.: `NdeEmitterStub` promete idempotência keying por `recebimento.id` — o impl real precisa manter).
- **Impacto técnico**: 6 times × 8 portas = 48 pontos onde a semântica pode divergir; o coordinator só descobre no test end-to-end (que é 1, e usa stubs). O rebase de 6 features paralelas vira roleta.
- **Impacto de negócio**: incidentes de conciliação pós-integração — tempo de detecção alto porque nenhum gate compartilhado alerta divergência.
- **Métrica de baseline**: 0 contract tests / 8 portas de módulo. Alvo mínimo: 3 (Nexxera, ErpReceivables, NdeEmitter — as 3 stateful).

### F-integrability-5: `NexxeraGatewayInterface` sem versionamento explícito de canal/API

- **Severidade**: P3
- **Tactic violada**: Versioning strategy
- **Localização**: `src/backend/domain/interface/recebimentos/ports.ts:24-45,132-134`
- **Evidência (objetiva)**: `RawMovimento` e `NexxeraFetchPeriod` não carregam `channel: 'api' | 'sftp'` nem `apiVersion`. O comentário reconhece "channel-agnostic: API vs SFTP/CNAB, chosen after O7", mas o metadado não flui para o `IngestaoTransacoes` nem para o ledger. Se dois canais coexistirem no futuro (fallback API → SFTP), a rastreabilidade se perde.
- **Impacto técnico**: futuro upgrade do provedor ou coexistência de canais exige refactor do `RawMovimento` — quebra 2 portas (`NexxeraGateway`, `IngestaoTransacoes`).
- **Impacto de negócio**: risco de re-trabalho quando O7 fechar; conciliação forense difícil ("veio por qual canal?").
- **Métrica de baseline**: 0 campos de versionamento no seam externo (0/2 tipos: `RawMovimento`, `NexxeraFetchPeriod`).

### F-integrability-6: `MetricsEvent.attributes` PII-safe apenas por disciplina (tipo permissivo demais)

- **Severidade**: P3
- **Tactic violada**: Tailor Interface (falha de anti-corruption entre metrics e PII)
- **Localização**: `src/backend/domain/interface/recebimentos/ports.ts:115-127`
- **Evidência (objetiva)**:
  ```typescript
  attributes?: Record<string, number | string | boolean>;
  // ↑ o próprio comentário admite: "The type does not enforce this;
  //   it is a discipline constraint. Módulo 6: never surface
  //   TransacaoBancaria.contraparte, referenciaBancaria, rawPayload..."
  ```
- **Impacto técnico**: qualquer módulo pode passar `attributes: { contraparte: transacao.contraparte }` sem o compilador reclamar. Módulo 6 emite para CloudWatch/logs; PII vaza.
- **Impacto de negócio**: exposição de CNPJ/nome do pagador em log agregado. Cross-QA: overlap com **Security** (PII) e **Fault Tolerance** (log poisoning).
- **Métrica de baseline**: 0 barreiras de tipo (branded type / whitelisted-keys type). Alvo: 1 branded type `MetricAttribute` ou `type Attributes = { count?: number; stage?: string; dryRun?: boolean; ... }` fechado.

## 5. Cards Kanban

### [integrability-1] Envolver os 3 hops de `executarRecebimento` em try/catch com `markError` + `metrics.emit({outcome:'error'})`

- **Problema**
  > O coordinator faz 3 chamadas ao ERP/NDe em série sem tratamento de erro entre elas. Falha em `gravarBaixa` deixa `recebimento_execucao` em `reconciling` órfão; retry humano re-cria borderô (duplicado). Espelha o problema que o `ConexosBaixaClient.gravarBaixaPermuta` já resolveu (comentário de linhas 458-465). Cross-QA: Fault-Tolerance / Availability.
- **Melhoria Proposta**
  > Envolver cada hop (`criarBordero` / `gravarBaixa` / `emitir`) em try/catch que chame `execucaoRepository.markError({ erroMensagem, borCod? })` com o `borCod` já conhecido e emita `metrics.emit({ outcome: 'error', stage: 'executarRecebimento.<hop>' })`. Rejeitar (re-throw) para o caller. Tactic Bass alvo: **Observability of integration failures + Manage Resource Coupling**. Arquivo único: `RecebimentoPipelineService.ts:183-264`.
- **Resultado Esperado**
  > 100% dos hops instrumentados; cobertura de erro-path adicionada ao `RecebimentoPipelineService.test.ts` (3 novos casos). Métrica: `# hops com markError` 0/3 → 3/3.
- **Tactic alvo**: Observability of integration failures
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Hops instrumentados com `markError`: 0/3 → 3/3
  - Testes de erro-path de `executarRecebimento`: 0 → 3
- **Risco de não fazer**: primeira falha real na Fase 5 = borderô duplicado em produção; retrabalho manual + risco fiscal.
- **Dependências**: nenhuma — pode ser feito no scaffold antes de qualquer módulo real.

### [integrability-2] Adicionar `rawMovimentoSchema` (Zod) e obrigar parse no impl de `NexxeraGatewayInterface`

- **Problema**
  > A porta que fala com o canal externo (Nexxera) usa `payload: unknown` sem schema Zod, quebrando o padrão consolidado em `ConexosBaixaClient` (Regis P0 antigo). Payload malformado só vai estourar no meio de `IngestaoTransacoes.run`.
- **Melhoria Proposta**
  > Exportar `rawMovimentoSchema: z.ZodSchema<RawMovimento>` em `ports.ts` (ou em `NexxeraGateway.ts` novo). Comentar na interface: "impls MUST parse antes de retornar". Adicionar contract test em [integrability-4] verificando que um impl não pode retornar `rawMovimentoSchema.parse(raw)` que quebre. Tactic Bass alvo: **Encapsulate + Tailor Interface**.
- **Resultado Esperado**
  > 4/4 portas externas com Zod no boundary (Nexxera, ErpReceivables, NdeEmitter, IngestaoTransacoes). Impls não conseguem retornar payload sem parse.
- **Tactic alvo**: Encapsulate
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Portas externas com Zod schema: 0/4 → 4/4
  - Impls que passam contract test: 0 → 8/8 stubs + reais
- **Risco de não fazer**: em 3 meses, 6 impls reais nascem sem parse boundary; cada uma introduz uma variante silenciosa de tolerância.
- **Dependências**: recomendável antes de M1 começar a implementar o adapter real (Fase 1, pós-O7).

### [integrability-3] Publicar `BorderoCriadoSchema` / `BaixaGravadaSchema` no `ports.ts` (herdar disciplina do `ConexosBaixaClient`)

- **Problema**
  > `ErpReceivablesGatewayInterface` promete `borCod: number` / `bxaCodSeq: number` mas não declara Zod schema. O impl real pode retornar payload frouxo e o ledger grava `NaN`/`null`, quebrando a reversão pelo `borCod`. `ConexosBaixaClient.ts:20-35` já resolveu isso via Regis P0 — a lição não foi transferida para a nova porta.
- **Melhoria Proposta**
  > Reexportar (ou re-declarar) `BorderoCriadoSchema` e `BaixaGravadaSchema` em `ports.ts` (ou num arquivo separado `ports/schemas.ts`) e documentar: "toda impl de `ErpReceivablesGatewayInterface` DEVE `parse(...)` a resposta". Tactic Bass alvo: **Encapsulate + Contract testing**.
- **Resultado Esperado**
  > Schemas de resposta de escrita ERP publicados junto com a porta; qualquer impl que retornar `borCod` inválido falha o parse no boundary.
- **Tactic alvo**: Encapsulate
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Métodos com schema declarado: 0/2 → 2/2
  - Divergência entre `ConexosBaixaClient` (padrão consolidado) e `ErpReceivablesGateway` (novo): 100% → 0%
- **Risco de não fazer**: reintroduzir a mesma falha já corrigida na Frente I (Regis P0 do `ConexosBaixaClient`).
- **Dependências**: recomendado junto com [integrability-2].

### [integrability-4] Criar contract-test suite compartilhada por porta (Nexxera, ErpReceivables, NdeEmitter)

- **Problema**
  > O único teste do scaffold é end-to-end do coordinator **com stubs**. Nenhuma suíte de conformance existe para os 6 times rodarem contra seus impls reais. Semânticas críticas (idempotência do `NdeEmitter`, `dryRun` preservado no `ErpReceivablesGateway`, dedup por `naturalKey` na `NexxeraGateway`) só vão ser validadas end-to-end — tarde demais.
- **Melhoria Proposta**
  > Criar `src/backend/domain/service/recebimentos/__contracts__/` com um arquivo por porta stateful:
  > - `NexxeraGatewayContract.test.ts` — factory `(impl: NexxeraGatewayInterface) => void`, casos: fetch com período vazio → array vazio; dedup entre dois fetches sobrepostos; payload → passa Zod.
  > - `ErpReceivablesGatewayContract.test.ts` — `dryRun` preservado no retorno; `borVldTipo` passado no request; `borCod` numérico obrigatório.
  > - `NdeEmitterContract.test.ts` — mesmo `Recebimento` → mesmo `idempotencyKey`.
  > O stub roda o contract test hoje; o impl real roda o MESMO teste quando pronto. Tactic Bass alvo: **Contract testing**.
- **Resultado Esperado**
  > Contract tests: 0/8 → 3/8 portas stateful cobertas; qualquer swap stub→real dispara o mesmo gate. CI verde = semântica preservada.
- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-integrability-4, F-integrability-2, F-integrability-3
- **Métricas de sucesso**:
  - Portas com contract test: 0 → 3 (Nexxera, ErpReceivables, NdeEmitter)
  - Cobertura de semânticas críticas (dryRun, idempotency, dedup): 0% → 100%
- **Risco de não fazer**: 6 impls paralelos divergem silenciosamente; incidentes de conciliação pós-Fase 5.
- **Dependências**: [integrability-2] e [integrability-3] publicam os schemas; contract test os usa.

### [integrability-5] Adicionar `channel`/`apiVersion` em `RawMovimento` / `NexxeraFetchPeriod`

- **Problema**
  > O canal Nexxera é decidido pós-spike O7 (API vs SFTP/CNAB). O tipo hoje é agnóstico ao ponto de não conseguir dizer "esse movimento veio por qual canal" nem "qual versão da API foi usada". Se dois canais coexistirem (fallback), a rastreabilidade se perde.
- **Melhoria Proposta**
  > Adicionar `channel: 'api' | 'sftp'` e `apiVersion?: string` em `RawMovimento` (ou em um envelope `NexxeraFetchResult`). Persistir junto ao `TransacaoBancaria.importRunId`. Tactic Bass alvo: **Versioning strategy**.
- **Resultado Esperado**
  > Todo movimento carrega origem/versão do canal; fallback e forensics ficam triviais.
- **Tactic alvo**: Versioning strategy
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-5
- **Métricas de sucesso**:
  - Campos de versionamento no seam externo: 0 → 2 (channel + apiVersion)
- **Risco de não fazer**: refactor caro quando Nexxera versionar API ou quando fallback SFTP virar necessário.
- **Dependências**: idealmente resolvido antes do spike O7 fechar; caso contrário, refactor pós-Fase 1.

### [integrability-6] Fechar o tipo `MetricsEvent.attributes` para impedir PII (branded/whitelist)

- **Problema**
  > `attributes?: Record<string, number | string | boolean>` aceita qualquer chave. Módulo 6 vai emitir para CloudWatch. O próprio comentário admite ser "discipline constraint" — sem barreira de compilador, um `attributes: { contraparte: ... }` passa. Cross-QA: Security (PII) + Fault Tolerance.
- **Melhoria Proposta**
  > Substituir por union fechado ou branded type:
  > ```typescript
  > type MetricAttributes = {
  >     stage?: string; outcome?: 'started' | 'ok' | 'error';
  >     count?: number; total?: number; deduplicadas?: number;
  >     classificacao?: MatchClassificacao; score?: number;
  >     dryRun?: boolean; alreadySettled?: boolean;
  >     ajustes?: number; parcelas?: number; valorAlocado?: number;
  >     borCod?: number;
  > };
  > ```
  > Ou branded type `type MetricAttrKey = Brand<string, 'MetricAttrKey'>`. Tactic Bass alvo: **Tailor Interface**.
- **Resultado Esperado**
  > O compilador rejeita qualquer chave PII no metrics port. Cross-QA (Security): risco de PII em log agregado = 0.
- **Tactic alvo**: Tailor Interface
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-6
- **Métricas de sucesso**:
  - Chaves PII permitidas pelo tipo: infinitas → 0
- **Risco de não fazer**: exposição de CNPJ/nome do pagador em CloudWatch em 3-6 meses.
- **Dependências**: nenhuma; pode ser feito antes do Módulo 6 escrever o emitter real.

## 6. Notas do agente

- Judged fully-stubbed scope: NÃO abri findings por lógica ausente nos stubs (que era a diretriz). Todos os 6 findings são sobre o **desenho dos seams**, não sobre business logic.
- Coordinator + ports.ts + container = design **exemplar** de token DI: 14 tokens, 10 injetados por token no coordinator, zero cross-imports de módulo, único import site do stub Nexxera é o container. Score reflete isso (8.5 alto).
- Cross-QA alerts para o consolidator: **F-integrability-1** (falha entre hops) sobrepõe com **Fault Tolerance** e **Availability** (ledger órfão / MTTR); **F-integrability-6** (PII em metrics) sobrepõe com **Security**. **F-integrability-4** (contract tests) sobrepõe com **Testability**. Recomendo agrupar no REPORT.
- Métrica que tentei coletar e não deu: taxa de erro por dependência em runtime — não medível no scaffold (nem em prod hoje). Recomendação já embutida na Métrica #12 (§2).
- P0 zero: nenhum finding tem impacto de produção comprovado no scaffold hoje (sistema está gated por `RECEBIMENTOS_ENABLED=false` em prod).
