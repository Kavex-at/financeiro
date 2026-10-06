---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-06-1356
agent: qa-integrability
generated_at: 2026-10-06T14:30:00Z
scope: backend
score: 7.5
findings_count: 4
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex | Conexos muda o shape de fin064/fin010/cmn025 (ou um novo gateway substitui a leitura de perfil de canal) | `ConexosSispagClient`, `ConexosPagamentosRealizadosClient` e consumidores em `service/sispag` | Produção, filiais múltiplas, delta de 137 arquivos | Mudança absorvida dentro do client (schema Zod), sem tocar services | ≤2 arquivos fora do client por mudança de shape; fixture quebra no CI antes de produção |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clients novos no delta | 2 (`ConexosSispagClient` +112 linhas, `ConexosPagamentosRealizadosClient` +164) | n/a | ✅ | `git diff --stat` |
| Clients novos com métodos genéricos get/post vazados | 0 (todos `list*`/`get*`/`ler*` de domínio) | 0 | ✅ | grep `public ` nos 2 clients |
| Clients novos com Zod no response | 2/2 (100%), com `preprocess` p/ null | ≥80% | ✅ | `ConexosSispagClient.ts:52-209`, `ConexosPagamentosRealizadosClient.ts:16-28` |
| Services do delta que injetam `ConexosBaseClient` (transporte) direto | 1 (`PerfilCanalService`, para `getFiliais`) | 0 | ⚠️ | `PerfilCanalService.ts:70,91` |
| Services do delta com >3 colaboradores | 3 (`LotePagamentoService` 10, `VerificacaoTedPixService` 12, `PerfilCanalService` 6 dependências) | ≤5 | ⚠️ | constructors |
| axios/fetch em service/repository do delta | 0 | 0 | ✅ | grep em `service/sispag` |
| Fixture real-shaped para parsing | 1 (`fin064-fil4-6173-6702.json`, usado no DuplicateDetector); sem fixture para fin010/baixas e cmn025 | 100% p/ stateful | ⚠️ | `service/sispag/__fixtures__`, `ConexosPagamentosRealizadosClient.test.ts` |
| Config via EnvironmentProvider | Novas vars lidas por `EnvironmentProvider` (sem `process.env` novo em services) | 100% | ✅ | `EnvironmentProvider.ts` no diff |
| Endpoint com versão explícita | Conexos não versiona URLs (`fin010/baixas/list/...`) | N/A pelo provedor | ⚠️ | `ConexosPagamentosRealizadosClient.ts:124` |
| Contract test contra a Conexos real | 0 (script manual `validate-sispag-verificacoes-ted-pix-v1.ts` e `probe-*`) | 1 job agendado | ⚠️ | `src/backend/jobs/` |
| Observabilidade por dependência | Não medível localmente. Recomendação: contador de erro por endpoint Conexos no LogService | — | ⚠️ | — |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Leituras novas em clients de domínio (`listTitulosFavorecidoParaDuplicidade`, `listBaixasPagamento`) | ✅ presente | `ConexosSispagClient.ts:501-535` |
| Use an Intermediary | `ConexosBaseClient` centraliza sessão/HTTP; `DestinoPagamentoResolver`, `DuplicateDetector` isolam regra do shape | ✅ presente | `ConexosPagamentosRealizadosClient.ts:65` |
| Restrict Communication Paths | `PerfilCanalService` fala com o transporte base, contornando o client de domínio | ⚠️ parcial | `PerfilCanalService.ts:70,91` |
| Adhere to Standards | Zod + `@singleton @injectable` | ✅ presente | clients |
| Abstract Common Services | Auth/lock/retry herdados de `ConexosBaseClient`, não duplicados nos clients novos | ✅ presente | `ConexosPagamentosRealizadosClient.ts:4` |
| Discover Service | SSM/tenants: N/A (sem infra/); URLs vêm do EnvironmentProvider | N/A | sem `infra/` |
| Tailor Interface | Schemas Zod com transform/coerce adaptam payload Conexos ao modelo interno (`ChannelPayment`) | ✅ presente | `ConexosSispagClient.ts:62-143` |
| Configure Behavior | `CONEXOS_WRITE_ENABLED` com guarda de produção; env estreito | ✅ presente | `EnvironmentProvider.ts:111` |
| Manage Resources | Sessão Conexos com cap; job semanal evita leitura ao vivo de fin010/fin095 no caminho do analista | ✅ presente | `calcular-perfil-canal.yml` |
| Orchestrate | `LotePagamentoService` orquestra linearmente 10 colaboradores; sem eventos | ⚠️ parcial | `LotePagamentoService.ts:60-71` |
| Manage Resource Coupling | Perfil de canal materializado em tabela (desacopla da latência Conexos) | ✅ presente | `PerfilCanalFornecedorRepository` |
| Contract testing | Uma fixture gravada (fin064); demais clients com mocks | ⚠️ parcial | `DuplicateDetector.test.ts:22` |
| Versioning strategy | Ausente; Conexos não expõe versão, sem detector de drift | ❌ ausente | — |
| Backward-compatibility shims | `.catch(undefined)`/preprocess toleram nulos; sem shim para campos renomeados | ⚠️ parcial | `ConexosSispagClient.ts:52-57` |
| Observability of integration failures | Logs por serviço; sem taxa de erro por endpoint | ⚠️ parcial | não medível |

## 4. Findings

### F-integrability-1: PerfilCanalService injeta ConexosBaseClient (transporte) diretamente

- **Severidade**: P2
- **Tactic violada**: Restrict Communication Paths
- **Localização**: `src/backend/domain/service/sispag/PerfilCanalService.ts:70,91`
- **Evidência (objetiva)**:
  ```
  @inject(ConexosBaseClient) private readonly base: ConexosBaseClient
  const filiais = (await this.base.getFiliais()).map(...)
  ```
- **Impacto técnico**: o service conhece o client de transporte (que expõe request genérico); troca do provedor/shape de filiais exige tocar o service.
- **Impacto de negócio**: baixo hoje; aumenta custo de upgrade da API Conexos.
- **Métrica de baseline**: 1 service com dependência direta de transporte (alvo 0).

### F-integrability-2: Contract tests só cobrem fin064; fin010/baixas e cmn025 sem fixture real

- **Severidade**: P2
- **Tactic violada**: Contract testing
- **Localização**: `ConexosPagamentosRealizadosClient.test.ts`, `ConexosSispagClient.test.ts`, `service/sispag/__fixtures__/`
- **Evidência (objetiva)**:
  ```
  __fixtures__/ contém 1 arquivo (fin064-fil4-6173-6702.json)
  ```
- **Impacto técnico**: o parser Zod de baixas (fonte do perfil de canal) pode divergir do payload real sem o CI acusar; `.catch(undefined)` mascara drift silenciosamente.
- **Impacto de negócio**: perfil de canal errado gera alertas de TED/PIX falsos ou ausentes.
- **Métrica de baseline**: 1 de 3 fontes Conexos novas (33%) com fixture.

### F-integrability-3: Sem detecção de drift nem taxa de erro por dependência

- **Severidade**: P2
- **Tactic violada**: Versioning strategy / Observability of integration failures
- **Localização**: `src/backend/jobs/validate-sispag-verificacoes-ted-pix-v1.ts`, `calcular-perfil-canal.ts`
- **Evidência (objetiva)**:
  ```
  validação do contrato é script manual (validate-*/probe-*); sem job que compare o schema
  ```
- **Impacto técnico**: `.catch` e `preprocess` degradam campos em silêncio; mudança no Conexos só é vista pelo analista.
- **Impacto de negócio**: verificação de duplicidade pode falhar aberta sem alerta.
- **Métrica de baseline**: 0 contadores de linhas descartadas/degradadas por parse (não medível localmente).

### F-integrability-4: Orquestradores síncronos com 10-12 dependências

- **Severidade**: P3
- **Tactic violada**: Orchestrate
- **Localização**: `LotePagamentoService.ts:60-71`, `VerificacaoTedPixService.ts:91-103`
- **Evidência (objetiva)**: 10 e 12 parâmetros injetados.
- **Impacto técnico**: trocar um client ou repo cascateia em testes/mocks de 2 serviços grandes.
- **Impacto de negócio**: custo de mudança maior em SISPAG.
- **Métrica de baseline**: 2 services com ≥10 dependências (alvo ≤6).

## 5. Cards Kanban

### [integrability-1] Mover getFiliais para um client de domínio

- **Problema**
  > `PerfilCanalService` depende do `ConexosBaseClient` de transporte só para `getFiliais`.
- **Melhoria Proposta**
  > Expor `listFiliais` em client de domínio já existente (`ConexosCadastroClient` ou `ConexosPagamentosRealizadosClient`) e remover a injeção do base no service. Tactic: Restrict Communication Paths.
- **Resultado Esperado**
  > Services do delta dependendo do transporte: 1 → 0.
- **Tactic alvo**: Restrict Communication Paths
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Services com `ConexosBaseClient` direto: 1 → 0
- **Risco de não fazer**: o padrão se replica e o upgrade do transporte atinge services.
- **Dependências**: nenhuma

### [integrability-2] Gravar fixtures de fin010/baixas e cmn025 e testar o parse

- **Problema**
  > Só fin064 tem fixture; os parsers das demais fontes são testados com mocks.
- **Melhoria Proposta**
  > Capturar respostas reais anonimizadas (via probe já existente, nunca ad hoc em produção) e adicionar testes de parse nos dois clients. Tactic: Contract testing.
- **Resultado Esperado**
  > Fontes com fixture: 1/3 → 3/3.
- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Fontes Conexos novas com fixture: 33% → 100%
- **Risco de não fazer**: drift do payload passa no CI e quebra o perfil de canal.
- **Dependências**: nenhuma

### [integrability-3] Contar linhas degradadas pelo Zod e alertar drift

- **Problema**
  > `.catch(undefined)` e `preprocess` engolem desvios de schema sem sinal.
- **Melhoria Proposta**
  > Contar campos degradados por endpoint no `LogService` e expor no painel de operação e no job semanal. Tactic: Observability of integration failures.
- **Resultado Esperado**
  > Drift visível em ≤1 semana; hoje 0 contadores.
- **Tactic alvo**: Versioning strategy
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-3, F-integrability-4
- **Métricas de sucesso**:
  - Endpoints Conexos novos com contador de degradação: 0 → 3
- **Risco de não fazer**: duplicidade falha aberta sem ninguém notar.
- **Dependências**: integrability-2

## 6. Notas do agente

- Escopo `--quick`, delta. O delta é bem encapsulado: clients de domínio, Zod com cuidado de null, herança de `ConexosBaseClient`. Sem P0/P1.
- F-integrability-4 não tem card próprio, é residual (P3) e entra no card 3 apenas como contexto. Comparte com Modifiability.
- Cross-QA: o `.catch` do Zod engolindo drift é também Fault Tolerance e Security (Validate Input).
- Não medível: SSM, Terraform e taxa de erro por dependência.
