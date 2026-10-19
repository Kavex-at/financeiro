---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-19-sispag-ajuste-centavos
agent: qa-integrability
generated_at: 2026-10-19T00:00:00-03:00
scope: backend
score: 7
findings_count: 5
cards_count: 4
---

# Integrability — Regis-Review (delta: ajuste de centavos, ADR-0073)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex | Conexos muda o contrato de fin070/fin103/fin106 (campo, codificação de status) ou o modo vai de `off` para `shadow`/`on` | `ConexosRenegociacaoClient`, `ConexosSispagClient.lerValoresAberto`, `RemessaCnabValidator` | Modo `off`, HML provado em 2 renegociações (frnCod 3 e 4) | Mudança contida no client e nos schemas Zod; premissa não provada falha fechada e vira ação humana | Arquivos tocados por mudança de contrato <= 2 (client + interface); 0 premissas não provadas que falham abertas |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Métodos genéricos (get/post/request) vazados no client novo | 0 (todos os públicos são de domínio: `criarRenegociacao`, `aplicarComando`...) | 0 | ✅ | `ConexosRenegociacaoClient.ts` |
| Consumidores do client novo | 1 (`AjusteCentavosTituloService`) | <= 2 | ✅ | `grep -rl ConexosRenegociacaoClient` |
| Imports de axios/fetch no delta (service/repo) | 0 | 0 | ✅ | grep no delta |
| Caminhos de escrita sem `conexosWriteEnabled` | 0 (`exigirEscrita` em `escrever`, `aplicarAjuste`, `cancelar`) | 0 | ✅ | `ConexosRenegociacaoClient.ts:333-336` |
| Respostas validadas com Zod | 6 schemas (cabeçalho, título, fin064, bloqueio, comando, POST) | 100% das leituras | ✅ | `RenegociacaoInterface.ts:21-110` |
| Premissas de contrato não provadas ao vivo | 4 (`fbaVldStatus` ativo, `ftbVldStatus=2` fora do caminho APROVAR, `its*` no fin064, rota `cancelar`) | 0 antes de `on` | ⚠️ | F-integrability-1..3 |
| Schemas distintos de fin064 no domínio | 2 (`TITULO_FIN064_SCHEMA` e `valoresAbertoRowSchema`) | 1 | ⚠️ | `RenegociacaoInterface.ts:62`, `ConexosSispagClient.ts:598-645` |
| Sítios de descarte silencioso por `safeParse` | 3 | 0 | ⚠️ | `ConexosRenegociacaoClient.ts:196,236,285` |
| Endpoints com fixture gravada (contract test) | 0 de 6 (mocks escritos à mão "com corpos do HML") | >= 1 por endpoint escrito | ⚠️ | `ConexosRenegociacaoClient.test.ts:44-317` |
| Versão de API pinada | N/A: Conexos não expõe versão em URL | N/A | N/A | - |
| Convenção SSM / infra | ⚠️ **Não medível localmente**: não há `infra/` neste repo | - | - | CLAUDE.md |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Todo o fin070/fin103/fin106 atrás de um client com métodos de domínio e Zod no retorno | ✅ presente | `ConexosRenegociacaoClient.ts` |
| Use an Intermediary | `AjusteCentavosTituloService` orquestra; `SessaoConexos` explícita (I18f) evita o resolver por-request | ✅ presente | `ConexosRenegociacaoClient.ts:322-326` |
| Restrict Communication Paths | Única porta de escrita; `exigirEscrita` + tentativa única (`postGenericOnce`/`putGenericOnce`) | ✅ presente | `:333,343` |
| Adhere to Standards | Mensagens do ERP via `ErpResponseReader`, KEY preservada em `codigoErp` | ✅ presente | `:60-70` |
| Abstract Common Services | `new ConexosBaseClient(buildLegacyConexosAdapter(...))` por chamada, duplicando a fiação do container | ⚠️ parcial | `:324` |
| Discover Service | N/A: ERP único com URL no `EnvironmentProvider`; sem registry a evoluir | N/A | - |
| Tailor Interface | Corpos espelham HML; `passthrough()` preserva a linha crua para reenvio verbatim no fin103 | ✅ presente | `RenegociacaoInterface.ts` |
| Configure Behavior | Modo `off/shadow/on` por filial; `conexosWriteEnabled`; mas `CANCELAMENTO_FIN070_PROVADO` e `MODO_GUARDA_VALOR_J` são constantes de código | ⚠️ parcial | `ConexosRenegociacaoClient.ts:26`; `RemessaCnabValidator.ts` |
| Manage Resources | Paginação até esgotar `count`, guarda de 40 páginas que lança; retry só em leitura | ✅ presente | `:361-395` |
| Orchestrate | Etapas com retomada, compensação e marcador de correlação (I18i) | ✅ presente | `AjusteCentavosTituloService.ts` |
| Manage Resource Coupling | Retomada no repositório; cancelamento ausente permite renegociação órfã | ⚠️ parcial | F-integrability-3 |
| Contract testing | Só mocks | ❌ ausente | F-integrability-4 |
| Versioning strategy | N/A: sem versão no Conexos; contrato documentado em `sispag-centavos-hml-achados.md` | ⚠️ parcial | `ontology/_inbox/sispag-centavos-hml-achados.md` |
| Backward-compatibility shims | Nenhum necessário (feature nova, modo `off`) | ✅ presente | - |
| Observability of integration failures | KEY do ERP preservada, determinística x transitória; sem log de linha descartada | ⚠️ parcial | F-integrability-5 |

## 4. Findings

### F-integrability-1: Sinal `its*` de "título em lote nativo" falha aberto, apesar do comentário "fail-closed"
- **Severidade**: P1 (não é P0: com modo `off` o caminho não executa)
- **Tactic violada**: Tailor Interface
- **Localização**: `src/backend/domain/client/ConexosRenegociacaoClient.ts:219-223`
- **Evidência (objetiva)**:
  ```
  emItemSispag = raw => ['itsVldModalidade','itsDtaPgto','itsMnyVlrPgto'].some(k => raw[k] != null && raw[k] !== '')
  // doc: "A confirmar ao vivo em G2/G4"
  ```
  O grid de pendentes já omite `itsVldModalidade` (`ConexosSispagWriteClient.ts:1186`). Se o `fin064` também não trouxer `its*`, a função devolve `false` para todo título e o ajuste prossegue sobre título em lote nativo.
- **Impacto técnico**: ausência do campo é lida como "livre"; fail-closed exigiria provar a presença do campo antes de confiar na ausência.
- **Impacto de negócio**: renegociar título já em lote nativo pode duplicar ou cancelar pagamento.
- **Métrica de baseline**: 3 campos, 0 provados presentes em `fin064/list` ao vivo.

### F-integrability-2: Codificação de `fbaVldStatus` e `ftbVldStatus` só parcialmente provada
- **Severidade**: P2
- **Tactic violada**: Tailor Interface
- **Localização**: `ConexosRenegociacaoClient.ts:268-272`; `RenegociacaoInterface.ts:84,108`; `AjusteCentavosTituloService.ts:786,811`
- **Evidência (objetiva)**:
  ```
  ativo = !cancelado && (fbaVldStatus === undefined || fbaVldStatus === 1)
  ```
  `ftbVldStatus 2` provado só após APROVAR (achados.md:150). Ausente conta como ativo, mitigado por exigir exatamente 1 comando `APROVAR`.
- **Impacto técnico**: comando inativo com outra codificação pode ser executado; liberado com outra codificação trava em `manual` (seguro).
- **Impacto de negócio**: pior caso é aprovação manual da analista (retrabalho), não erro financeiro.
- **Métrica de baseline**: 1 amostra HML por codificação; 0 variações testadas.

### F-integrability-3: Compensação do fin070 sem rota provada (cancelamento `NotImplemented`)
- **Severidade**: P2
- **Tactic violada**: Manage Resource Coupling
- **Localização**: `ConexosRenegociacaoClient.ts:26,148-158`
- **Evidência (objetiva)**: `CANCELAMENTO_FIN070_PROVADO = false`; achados.md:179 "Em aberto: cancelamento das renegociações 3 e 4".
- **Impacto técnico**: falha antes do `finalizar` termina `indeterminado` e deixa renegociação aberta no ERP (alerta humano, comportamento declarado).
- **Impacto de negócio**: renegociação órfã até limpeza manual; portão G3 é pré-requisito explícito de `on`.
- **Métrica de baseline**: 0 cancelamentos provados; 2 renegociações HML sem cancelar.

### F-integrability-4: Sem contract test com fixture gravada; dois schemas para o mesmo `fin064`
- **Severidade**: P2
- **Tactic violada**: Contract testing; Abstract Common Services
- **Localização**: `ConexosRenegociacaoClient.test.ts`; `RenegociacaoInterface.ts:62-80` x `ConexosSispagClient.ts:598-645`
- **Evidência (objetiva)**: linhas de teste escritas à mão; `lerValoresAberto` reimplementa a leitura do fin064 (null juros/desconto → 0 só ali), enquanto `listarTitulosDoDocumento` usa `numOpt` (null → undefined).
- **Impacto técnico**: deriva entre duas leituras do mesmo endpoint; mudança no fin064 exige 2 edições.
- **Impacto de negócio**: divergência de valor líquido entre a régua I17b e o ajuste gera recusa do ERP.
- **Métrica de baseline**: 2 schemas fin064; 0 fixtures gravadas em 6 endpoints.

### F-integrability-5: `safeParse` descarta linhas sem log e a soma de `mnyValorTotal` usa só as sobreviventes
- **Severidade**: P2
- **Tactic violada**: Observability of integration failures
- **Localização**: `ConexosRenegociacaoClient.ts:196-199,236,285`
- **Evidência (objetiva)**: `.filter(r => r.success)` em títulos da renegociação; `completo` calculado sobre os restantes, sem comparar com `count`.
- **Impacto técnico**: contrato quebrado vira "menos dados" em vez de erro.
- **Impacto de negócio**: a conferência I18c pode validar valor parcial.
- **Métrica de baseline**: 3 sítios; 0 logs/contadores de descarte.

## 5. Cards Kanban

### [integrability-1] Provar `its*` no fin064 e garantir fail-closed antes de `shadow`
- **Problema**
  > `emItemSispag` trata ausência de `its*` como título livre; o sinal nunca foi visto ao vivo no `fin064/list`.
- **Melhoria Proposta**
  > Gravar fixture HML/PRD (só leitura) de título em lote nativo e de título livre; exigir a chave presente na linha, senão `indeterminado`/manual. Tocar `ConexosRenegociacaoClient.ts` e testes.
- **Resultado Esperado**
  > Ausência do campo deixa de significar "livre". Campos `its*` provados: 0/3 → 3/3.
- **Tactic alvo**: Tailor Interface
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Campos `its*` provados: 0/3 → 3/3
- **Risco de não fazer**: ajuste sobre título em lote nativo ao ligar `shadow`/`on`.
- **Dependências**: portões G2/G4

### [integrability-2] Fixar codificações de status e cancelamento com prova HML
- **Problema**
  > `fbaVldStatus`, `ftbVldStatus` e a rota `cancelar` dependem de uma amostra ou de nenhuma.
- **Melhoria Proposta**
  > Executar G3 (cancelar renegociação aberta), registrar no achados.md, trocar a constante por prova; tratar `fbaVldStatus` ausente como inativo.
- **Resultado Esperado**
  > Compensação funcional; renegociações HML órfãs 2 → 0.
- **Tactic alvo**: Manage Resource Coupling
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-2, F-integrability-3
- **Métricas de sucesso**:
  - Cancelamentos provados: 0 → 1
  - Renegociações HML órfãs: 2 → 0
- **Risco de não fazer**: renegociações órfãs e aprovações manuais em produção.
- **Dependências**: portão G3

### [integrability-3] Unificar a leitura do fin064 e gravar fixtures de contrato
- **Problema**
  > Dois schemas e duas leituras do mesmo endpoint, nenhum teste com payload gravado.
- **Melhoria Proposta**
  > `lerValoresAberto` delegar a `listarTitulosDoDocumento`; fixtures JSON anonimizadas dos 6 endpoints (frnCod 3/4) usadas pelos testes.
- **Resultado Esperado**
  > Schemas fin064: 2 → 1; endpoints com fixture: 0 → 6.
- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Schemas fin064: 2 → 1
  - Endpoints com fixture: 0 → 6
- **Risco de não fazer**: deriva silenciosa quando o Conexos alterar o fin064.
- **Dependências**: nenhuma

### [integrability-4] Falhar ou logar quando `safeParse` descarta linha de renegociação
- **Problema**
  > Linhas ilegíveis somem e a soma de conferência usa um subconjunto.
- **Melhoria Proposta**
  > Em `lerRenegociacao`, lançar `ConexosError` se houver descartes ou títulos < `count`; nos demais sítios, contar descartes no log (sem código de barras).
- **Resultado Esperado**
  > Sítios de descarte silencioso: 3 → 0.
- **Tactic alvo**: Observability of integration failures
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-5
- **Métricas de sucesso**:
  - Sítios silenciosos: 3 → 0
- **Risco de não fazer**: conferência I18c validando valor parcial.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta; `jobs/probe-*.ts` ignorado. Sem P0: com modo `off` nada chega ao ERP e a escrita exige `conexosWriteEnabled`.
- Guarda J 153–167 e `ValorItemImport` são puros e fail-closed (ilegível = divergência/indisponível); sem achados. `MODO_GUARDA_VALOR_J = BLOQUEIA` depende da medição de .REM de PRD (Task 13) antes do merge: cruzar com Security/Fault Tolerance.
- Cross-QA: Encapsulate sobrepõe Modifiability; F-integrability-5 sobrepõe Fault Tolerance (Validate Input).
