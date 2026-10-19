---
qa: Testability
qa_slug: testability
run_id: 2026-10-19-sispag-ajuste-centavos
agent: qa-testability
generated_at: 2026-10-19T12:00:00-03:00
scope: all
score: 8
findings_count: 4
cards_count: 4
---

# Testability — Regis-Review (delta ADR-0073, ajuste de centavos)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / AutoLoopRunner | Mudança na sequência fin070 (renegociação) ou na máquina de estados do ledger | `AjusteCentavosTituloService`, `AjusteCentavosExecucaoRepository`, `ConexosRenegociacaoClient`, migração 0087 | Dev local, sem HML/PRD | Os testes expõem a regressão sem tocar o ERP | 13/13 casos canônicos da I18 com teste nomeado; 0 chamada remota; suíte do delta < 1 min |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **#1 Cobertura por camada (delta)**: arquivos de teste / arquivos novos | libs/boleto 3/3 puros com teste; service 1/1 (757 LOC de teste p/ 1189 LOC); repository 1/1 unit + 1 integração; client 2/2; route 1/1; migração estática + integração; FE selo, painel, hook, helper todos com teste | ≥ 0.5 por camada | ✅ | `git diff origin/main...HEAD --stat` |
| Cobertura em % por linha/branch | Não coletada (jest `--coverage` fora do escopo reduzido) | 80% linhas / 70% branches em service e repository | ⚠️ Não medido | — |
| Casos canônicos I18 1–13 com teste | 13/13. Casos 1–10, 12, 13 em `AjusteCentavosTituloService.test.ts`; caso 11 (`finalizarLote` durante ajuste) em `LotePagamentoService.test.ts` (não aparece no arquivo do service) | 13/13 | ✅ | `grep "caso N"`, `TitleAdjustmentInProgressError` |
| Backend (delta) rodado localmente | 35 suítes / 1232 testes verdes (inclui integração com Postgres local :55492) | 100% verde | ✅ | `npx jest ...` |
| Frontend `app/sispag` | 33 suítes / 365 testes verdes | 100% verde | ✅ | `npx jest app/sispag` |
| Testes de integração contra Postgres real | 2 arquivos (17 `it`: 10 migração, 7 repositório), com guarda `describe.skip` sem DSN e verificação de host local | ≥ 1 por repositório com SQL complexo | ✅ | `*.integration.test.ts` |
| Injeção de falha / rollback | `falha injetada no passo (5) desfaz (1)–(4)` (rollback integral) | presente | ✅ | `AjusteCentavosExecucaoRepository.integration.test.ts:369` |
| Leituras de relógio na fonte nova (service/repo) | 0 `Date.now()`/`new Date()` não derivados de dado (só `new Date(vencimentoEpoch)`) | 0 | ✅ | grep |
| Aleatoriedade na fonte nova | 1 `randomUUID` no repositório (`:90`), sem seam | 0 sem provider | ⚠️ | grep |
| Fidelidade do ledger fake × repositório real | Fake replica máquina e lock otimista (`:50`); fidelidade nunca verificada por teste de paridade | teste de contrato compartilhado | ⚠️ | service.test.ts:50 |
| Tamanho dos maiores testes novos | service.test 757 LOC | ≤ 500 | ⚠️ (proporcional a 1189 LOC de fonte) | `wc -l` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Seams de modo/etapa (`ModoAjusteCentavos`, `EtapaAjusteCentavos`), sessão `robot()` explícita, ledger atrás de repositório | ✅ | service.test.ts:709 |
| Recordable Test Cases | Clientes com corpos HML explícitos inline; sem arquivos `__fixtures__` | ⚠️ parcial | `ConexosRenegociacaoClient.test.ts` |
| Sandbox | Modo `shadow` testado (caso 12, login sondado diferente), modo `off`; Postgres local para integração | ✅ | service.test.ts:678,695,702 |
| Executable Assertions | Guardas de conferência (`mnyValorTotal`, elegibilidade recalculada, I18d) testadas | ✅ | service.test.ts:532-571 |
| Abstract Data Sources | Repositório e clientes injetados por construtor; advisory lock substituído por fake `tryLock` | ✅ | service.test.ts:355 |
| Limit Non-Determinism | Sem relógio direto; `BankingCalendar` já existente; `randomUUID` sem seam | ⚠️ parcial | repo.ts:90 |
| Limit Structural Complexity | Funções puras isoladas (`ValorAbertoLiquido`, elegibilidade); mas service de 1189 LOC | ⚠️ parcial | `wc -l` |

## 4. Findings

### F-testability-1: Fake em memória do ledger não tem teste de paridade com o repositório real
- **Severidade**: P2
- **Tactic violada**: Abstract Data Sources (fidelidade do duplo)
- **Localização**: `AjusteCentavosTituloService.test.ts:50`; `AjusteCentavosExecucaoRepository.integration.test.ts`
- **Evidência**: o fake reimplementa máquina de estados e lock otimista; a integração (7 `it`) e o service test (≈30 `it`) não rodam a mesma tabela de transições nos dois.
- **Impacto técnico**: uma transição aceita pelo fake e recusada pelo repositório (ou o contrário) passa verde nos 1232 testes.
- **Impacto de negócio**: ajuste de centavos em título real pode ficar preso/indeterminado sem que o CI avise.
- **Métrica de baseline**: 0 testes de contrato compartilhados entre fake e repositório.

### F-testability-2: Os gaps G1–G5 só são testáveis em HML/PRD; corpos dos clientes são escritos à mão
- **Severidade**: P2
- **Tactic violada**: Recordable Test Cases
- **Localização**: `ConexosRenegociacaoClient.test.ts` (322 LOC), service.test.ts:500 (cancelamento não provado, G3)
- **Evidência**: não há fixtures gravadas; os corpos HML são inline. Comportamento real do cancelamento (G3), da releitura, do bloqueio de reaprovação não é verificável sem o ERP.
- **Impacto técnico**: se o ERP divergir do corpo suposto, testes seguem verdes (mock = hipótese).
- **Impacto de negócio**: o primeiro erro aparece em PRD, em dinheiro. A mitigação atual (shadow + estado `indeterminado` + alerta) é correta, mas depende de roteiro HML manual.
- **Métrica de baseline**: 0 fixtures gravadas; 5 gaps (G1–G5) sem teste automatizável.

### F-testability-3: `randomUUID` no repositório sem seam
- **Severidade**: P3
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `AjusteCentavosExecucaoRepository.ts:90`
- **Evidência**: `const id = randomUUID();`
- **Impacto técnico**: o unit test do repositório não consegue afirmar o id gerado; as integrações contornam lendo de volta.
- **Impacto de negócio**: baixo.
- **Métrica de baseline**: 1 ponto.

### F-testability-4: Service de 1189 LOC concentra a máquina inteira
- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `AjusteCentavosTituloService.ts`, test 757 LOC
- **Evidência**: um único `describe` de casos canônicos mais retomada, reaprovação e serialização.
- **Impacto técnico**: novos casos exigem fake grande; testes difíceis de ler.
- **Impacto de negócio**: custo de manutenção.
- **Métrica de baseline**: 1189 LOC fonte / 757 LOC teste.

## 5. Cards Kanban

### [testability-1] Teste de contrato compartilhado entre ledger fake e repositório real

- **Problema**
  > O ledger em memória do service test reimplementa a máquina e o lock otimista, sem prova de equivalência com o repositório Postgres. Divergência passa verde.
- **Melhoria Proposta**
  > Extrair uma tabela de transições (permitidas/recusadas, conflito de versão) executada por uma função `contratoLedger(fabrica)` contra o fake (unit) e contra o repositório (integração, DSN local). Tactic: Abstract Data Sources.
- **Resultado Esperado**
  > Testes de contrato do ledger 0 → 1 tabela rodando em 2 implementações; divergência fake×real detectada no CI.
- **Tactic alvo**: Abstract Data Sources
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Testes de contrato fake×real: 0 → ≥ 12 transições
- **Risco de não fazer**: ajuste preso em produção sem aviso do CI.
- **Dependências**: nenhuma

### [testability-2] Gravar fixtures das respostas fin070 após o roteiro HML (G1–G5)

- **Problema**
  > Corpos do cliente de renegociação são hipóteses escritas à mão; G1–G5 não têm cobertura automática.
- **Melhoria Proposta**
  > Ao executar o roteiro QaCoach em HML, salvar requisição/resposta (mascarando credenciais) em `__fixtures__` e fazer os testes do cliente e dos casos 6/9 lerem delas. Manter o shadow em PRD até V-PRD.
- **Resultado Esperado**
  > Fixtures gravadas por endpoint 0 → 6; gaps G1–G5 com ao menos 1 teste por caso, mudança de contrato do ERP quebra o teste.
- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Gaps com teste automatizado: 0/5 → 5/5
- **Risco de não fazer**: o primeiro contra-exemplo do ERP aparece em PRD.
- **Dependências**: acesso HML com credencial própria

### [testability-3] Injetar gerador de id no repositório do ledger

- **Problema**
  > `randomUUID` direto impede asserção determinística de id.
- **Melhoria Proposta**
  > Receber `() => string` no construtor com default `randomUUID`. Tactic: Limit Non-Determinism.
- **Resultado Esperado**
  > Pontos de aleatoriedade sem seam no delta 1 → 0.
- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Sites sem seam: 1 → 0
- **Risco de não fazer**: desprezível.
- **Dependências**: nenhuma

### [testability-4] Dividir service e teste do ajuste em módulos por etapa

- **Problema**
  > 1189 LOC no service e 757 no teste concentram renegociação, reaprovação e retomada.
- **Melhoria Proposta**
  > Extrair reaprovação (I18e) e retomada em colaboradores injetados, com testes próprios; manter casos canônicos no service. Fazer proporcionalmente no próximo tweak.
- **Resultado Esperado**
  > Maior arquivo de teste 757 → ≤ 500 LOC.
- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - LOC do service: 1189 → ≤ 700
- **Risco de não fazer**: custo de mudança crescente.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: delta de `origin/main...HEAD`, sem `probe-*.ts`. Rodei localmente 35 suítes backend (1232 verdes, com Postgres local :55492) e 33 suítes frontend em `app/sispag` (365 verdes); nesta máquina o radix não faltou. Não coletei cobertura em %.
- Sem P0: os 13 casos canônicos têm teste (o 11 mora em `LotePagamentoService.test.ts`) e o rollback é provado em Postgres real.
- Cross-QA: G1–G5 e fixtures ligam com Integrability; estados `indeterminado`/compensação com Fault Tolerance; `randomUUID` com Modifiability.
