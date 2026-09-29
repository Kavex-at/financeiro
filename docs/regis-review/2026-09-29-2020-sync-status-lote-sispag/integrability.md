---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-29-2020
agent: qa-integrability
generated_at: 2026-09-29T20:30:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Conexos (ERP) | Muda formato de `fin064`/`fin052`/`com308` PSQ_018 ou revoga permissão do robô (403 em 22/09) | `ConexosSispagClient.lerSituacaoTitulo`, `ConexosTitulosClient.lerBaixasTitulo`, `SincronizacaoLoteService` | Cron horário 08–19 BRT, dias úteis | Leitura tri-estado (`legivel:false`), sem decidir status; falha visível (exit≠0 + alerta) | Mudança contida em 2 clients + schema Zod; 0 arquivos de service alterados; 0 lotes com status errado |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clients do delta com método HTTP genérico vazado | 0 (`lerSituacaoTitulo`, `lerBaixasTitulo` são de domínio) | 0 | ✅ | `git diff` dos 2 clients |
| Service/repo/rota do delta importando axios/fetch | 0 | 0 | ✅ | grep em `domain/service/sispag`, `repository/sispag`, `routes/sispag.ts` |
| Dependências injetadas em `SincronizacaoLoteService` | 8 (3 clients Conexos: Sispag, Titulos, Retorno) | ≤2 clients | ⚠️ | `SincronizacaoLoteService.ts:123-132` |
| Clients do delta com Zod na resposta | 2/2 (100%) | ≥80% | ✅ | `ConexosSispagClient.ts:95-121`, `ConexosTitulosClient.ts:137-158` |
| `process.env` cru no delta de service/job | 1 (`TRIGGERED_BY`, entrypoint de job) | 0 em service | ✅ | `jobs/sincronizar-lotes-sispag.ts:23` |
| Endpoints Conexos com versão explícita | 0/3 (`fin064/list`, `fin052/arquivosRetornoDetalhe/list`, `com308/.../baixas/list`) | N/A — Conexos não versiona URL | ⚠️ | clients |
| Testes de client com fixture gravada | 0 arquivos de fixture; mocks inline | 100% p/ Conexos | ⚠️ | `ConexosSispagClient.test.ts:65`, `ConexosTitulosClient.test.ts` |
| Config do job via secrets/EnvironmentProvider | 100% (CONEXOS_*, DB) | 100% | ✅ | `.github/workflows/sincronizar-lotes-sispag.yml` |
| Retry/sessão compartilhados | via `ConexosBaseClient.runWithRetry`/`paginate`; sem cópia nova | 0 duplicação | ✅ | delta dos clients |
| Helpers duplicados de status HTTP | 2 (`motivoDeFalha`, `statusDe`) | 1 | ⚠️ | F-integrability-2 |
| Convenção SSM `/tenants/...` | Não medível: não existe `infra/` | — | ⚠️ | CLAUDE.md |
| Taxa de erro por dependência | Não medível localmente; requer produção/painel de jobs | — | ⚠️ | — |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Métodos de domínio nos clients; service não vê HTTP | ✅ presente | `ConexosSispagClient.ts` `lerSituacaoTitulo`; `ConexosTitulosClient.ts` `lerBaixasTitulo` |
| Use an Intermediary | `ConexosBaseClient` (retry, paginate, parseDate); `DecisaoStatusLote` isola a regra | ✅ presente | `DecisaoStatusLote.ts` |
| Restrict Communication Paths | Service só fala com clients; frontend só via `apiFetch` | ✅ presente | `frontend/lib/sispag.ts:3` |
| Adhere to Standards | Zod nos boundaries; tipos tri-estado `LeituraTitulo`/`LeituraBaixas` | ✅ presente | `vldPagoEstrito` |
| Abstract Common Services | Retry/sessão no base client; extração de erro→motivo duplicada | ⚠️ parcial | F-integrability-2 |
| Discover Service | Secrets/env; sem SSM/infra | ⚠️ parcial | sem `infra/` |
| Tailor Interface | Clients adaptam campos (`totalAberto` vs `titMnyAberto`) | ✅ presente | schema `situacaoTituloSchema` |
| Configure Behavior | Cadência no workflow; `JANELA_ESTORNO_DIAS` constante no código | ⚠️ parcial | `SincronizacaoLoteService.ts:136` |
| Manage Resources | `BoundedConcurrency`, `concurrency` no workflow, aviso de sessões simultâneas | ✅ presente | workflow |
| Orchestrate | `SincronizacaoLoteService` (626 linhas) orquestra 3 clients em série, síncrono | ⚠️ parcial | F-integrability-1 |
| Manage Resource Coupling | Job read-only, independente de flags de escrita; disputa de sessão com `reconciliar-nde` (:35) só documentada | ⚠️ parcial | comentário do workflow |
| Contract testing | Sem fixtures gravadas de `fin064`/`com308` | ⚠️ parcial | F-integrability-3 |
| Versioning strategy | Sem detecção de drift de schema do Conexos | ⚠️ parcial | F-integrability-4 |
| Backward-compat shims | `numOpt`/`.catch` toleram formas; coexistem `getTituloAPagar` e `lerSituacaoTitulo` sobre o mesmo fin064 | ⚠️ parcial | `ConexosSispagClient.ts` |
| Observability of integration failures | Motivo por leitura + exit≠0 se nada lido + alerta ADR-0042 | ✅ presente | workflow, `SincronizarLotesSispagJob.ts` |

## 4. Findings

### F-integrability-1: Orquestrador síncrono com 8 dependências (in-delta)

- **Severidade**: P2
- **Tactic violada**: Orchestrate / Use an Intermediary
- **Localização**: `src/backend/domain/service/sispag/SincronizacaoLoteService.ts:123-132`
- **Evidência (objetiva)**:
  ```
  constructor: loteRepo, sispag, titulos, retorno, decisao, notificacao, logService, bounded
  ```
  626 linhas; chama `sispag.lerSituacaoTitulo`, `titulos.lerBaixasTitulo` (:300-308) e 3 leituras do `retorno` (:433, :517, :562).
- **Impacto técnico**: trocar ou atualizar um dos 3 clients Conexos toca o service central; testes exigem 8 mocks.
- **Impacto de negócio**: upgrade do Conexos fica mais caro e arriscado no fluxo que decide o status do lote.
- **Métrica de baseline**: 3 clients Conexos por service (alvo ≤2 via fachada).

### F-integrability-2: Extração de erro→motivo duplicada entre clients (in-delta)

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `ConexosSispagClient.ts` (`motivoDeFalha`), `ConexosTitulosClient.ts` (`statusDe`)
- **Evidência (objetiva)**: ambos extraem `response.status`; `statusDe` também olha `cause`, `motivoDeFalha` não. O `ConexosError` lançado por `paginate` pode perder o status na leitura do fin064.
- **Impacto técnico**: diagnóstico de 403/5xx inconsistente entre as duas leituras.
- **Impacto de negócio**: motivo menos claro no alerta quando a permissão do robô cai.
- **Métrica de baseline**: 2 implementações do mesmo helper.

### F-integrability-3: Sem contract tests com fixtures reais para as leituras novas (in-delta)

- **Severidade**: P2
- **Tactic violada**: Contract testing
- **Localização**: `ConexosSispagClient.test.ts`, `ConexosTitulosClient.test.ts`
- **Evidência (objetiva)**: o schema cita fixtures reais de 2026-08-24/25, mas os testes montam objetos inline; 0 arquivos de fixture.
- **Impacto técnico**: mudança de forma no `fin064`/`com308` só aparece em produção, e como o schema é tri-estado, aparece como `legivel:false`, não como erro.
- **Impacto de negócio**: a sincronização degrada em silêncio (lotes sem decisão) e o analista segue no manual.
- **Métrica de baseline**: 0/3 endpoints com fixture-based parsing.

### F-integrability-4: Linhas de baixa inválidas são descartadas sem sinal (in-delta)

- **Severidade**: P2
- **Tactic violada**: Adhere to Standards (validação de boundary) / Observability of integration failures
- **Localização**: `src/backend/domain/client/ConexosTitulosClient.ts` `lerBaixasTitulo` (`flatMap` com `safeParse`)
- **Evidência (objetiva)**:
  ```
  const baixas = rows.flatMap((row) => { parsed.success ? [map] : [] });
  return { legivel: true, baixas };
  ```
  Se todas as linhas falharem no schema (ex.: `borCod` renomeado), devolve `legivel:true` com `baixas: []`, o que contradiz a promessa I11c do próprio docstring.
- **Impacto técnico**: drift de schema vira ausência de trilha, não "não consegui ler".
- **Impacto de negócio**: trilha de baixa some sem alerta (não decide status, por isso P2 e não P1).
- **Métrica de baseline**: 0 contadores de linhas rejeitadas.

## 5. Cards Kanban

### [integrability-1] Devolver `legivel:false` quando linhas de baixa falham no schema

- **Problema**
  > `lerBaixasTitulo` descarta linhas inválidas e retorna `legivel:true` com lista vazia, mascarando drift do `com308`.
- **Melhoria Proposta**
  > Se `rows.length > 0` e alguma linha falhar no schema, retornar `legivel:false` com motivo "N linhas com schema inválido" e logar a contagem. Unificar `motivoDeFalha`/`statusDe` em um helper no `ConexosBaseClient`.
- **Resultado Esperado**
  > Drift de schema aparece no motivo/alerta; um único extrator de status HTTP.
- **Tactic alvo**: Adhere to Standards / Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-4, F-integrability-2
- **Métricas de sucesso**:
  - Linhas rejeitadas silenciosas: N → 0
  - Helpers de status HTTP: 2 → 1
- **Risco de não fazer**: mudança de layout do Conexos passa despercebida por meses.
- **Dependências**: nenhuma

### [integrability-2] Gravar fixtures reais de fin064, fin052 detalhe e com308 e testar o parsing

- **Problema**
  > Os clients novos são testados com objetos inline, sem contract test contra respostas gravadas.
- **Melhoria Proposta**
  > Capturar respostas anonimizadas (as de 24–25/08 já citadas no código) em `__fixtures__/` e usá-las nos testes de `lerSituacaoTitulo`, `lerBaixasTitulo` e `listDetalhe`; incluir casos com `titMny*` NULL e 403.
- **Resultado Esperado**
  > 3/3 leituras com teste de contrato por fixture.
- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Endpoints com fixture: 0/3 → 3/3
- **Risco de não fazer**: regressão de forma só descoberta em produção como lote sem decisão.
- **Dependências**: nenhuma

### [integrability-3] Extrair fachada de leitura de situação do título (anti-corruption layer)

- **Problema**
  > O `SincronizacaoLoteService` depende de 3 clients Conexos e 8 dependências no total, o que encarece qualquer upgrade do Conexos.
- **Melhoria Proposta**
  > Criar um gateway `@injectable` que agrega `lerSituacaoTitulo`, `lerBaixasTitulo` e as leituras de retorno, expondo tipos de domínio; o service depende só do gateway. Fazer no próximo `/feature-tweak` que tocar o service.
- **Resultado Esperado**
  > Clients Conexos injetados no service: 3 → 1.
- **Tactic alvo**: Use an Intermediary / Orchestrate
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Dependências do service: 8 → 6
- **Risco de não fazer**: upgrade do Conexos v2 cascateia pelo service central.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo `--quick` restrito ao delta; nenhum P0 (nenhum defeito crítico medido). Todos os findings são in-delta; pré-existentes não auditados.
- Não medível: SSM/infra (`infra/` inexistente); taxa de erro por dependência (requer produção).
- Cross-QA: F-integrability-4 e o tri-estado tocam Fault Tolerance e Security (Validate Input); F-integrability-1 tem overlap com Modifiability.
