---
qa: Testability
qa_slug: testability
run_id: 2026-10-27-1546
agent: qa-testability
generated_at: 2026-10-27T15:58:10.846683+00:00
scope: backend
score: 8
findings_count: 1
cards_count: 1
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista e executor Jest | Retomar grupo rejeitado ainda vinculado ao lote antigo | Preparação, retomada e retirada SISPAG | Rascunho novo completo ou parcial; leitura antiga pode falhar | Retirar grupo com alerta; preservar antigo; continuar avulso saudável | Zero importações indevidas e zero exclusões antigas; 314/314 testes focados verdes |

## 2. Métricas observadas

Métrica observável #1 — cobertura por camada. Razão de arquivos é presença de testes, não cobertura executada; percentuais de linhas/branches/funções desta revisão quick são **não medidos**.

| Camada | Fonte / teste | Razão teste/fonte | Cobertura executada | Alvo | Status | Fonte |
|---|---|---|---|---|---|---|
| domain/service | 113 / 107 | 94,7% | Não medida | Linhas/funções ≥80%; branches ≥70% | ⚠️ | Contagem Python rglob de .ts e .test.ts |
| domain/repository | 39 / 53 | 135,9% | Não medida | Linhas/funções ≥80%; branches ≥70% | ⚠️ | Mesmo comando; inclui .integration.test.ts |
| domain/client | 26 / 25 | 96,2% | Não medida | Contratos externos exercitados | ⚠️ | Mesmo comando |
| http | 23 / 19 | 82,6% | Não medida | Boundaries alterados cobertos | ⚠️ | Mesmo comando |
| routes | 10 / 33 | 330% | Não medida | Boundaries alterados cobertos | ⚠️ | Mesmo comando |
| lambda / infra | Ausentes | N/A | N/A | N/A: Express/Render atual | ✅ | CLAUDE.md |

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Gates finais do coordenador | 305 suites / 5979 testes; typecheck e lint exit 0; 124 warnings de lint no baseline; diff check 0 | Zero falhas | ✅ | _shared-metrics.md, atualização final do coordenador |
| Execução focada final | 4 suites, 314 testes aprovados; exit 0 | Zero falhas | ✅ | npm test -- --runInBand --silent + BorderoGrupoBoletoService.test.ts, RemessaService.test.ts, RetiradaCodigoBarrasService.test.ts, FechamentoGrupoBoleto.test.ts (7,897s) |
| Vínculo persistente | 4 estados nativos (0/1/2/3) bloqueados | Todos bloqueados enquanto item presente | ✅ | BorderoGrupoBoletoService.test.ts:1235 |
| Falta de prova de ausência | 7 casos: timeout, lote ausente, status desconhecido, chave divergente, banco/lote ausente, itens ilegíveis | Todos retiram sem escrita | ✅ | BorderoGrupoBoletoService.test.ts:1263 |
| Retomadas adotadas | 2 etapas (FAILED/IMPORTADO) bloqueadas | Ambas consultam antigo | ✅ | BorderoGrupoBoletoService.test.ts:1300 |
| Retomada orquestrada | 2 casos completo/parcial passam por preparar | 2/2 | ✅ | RemessaService.test.ts:4495,4535 |
| Composição real Retirada + Bordero | 1 caso remove só item novo, mantém item antigo e 3 baixas, avulso saudável | 1/1 sem exclusão antiga | ✅ | BorderoGrupoBoletoService.test.ts:1326 |
| Caminho positivo | 1 ausência observada permite reaproveitar mesmo com outro borderô antigo | 1/1 sem criar segundo borderô | ✅ | BorderoGrupoBoletoService.test.ts:1415 |
| CI cobertura | npm test -- --coverage; serviço: linhas 88%, branches 60% (limiares, não cobertura atual) | Gate executado a cada PR | ✅ | .github/workflows/ci.yml:29; src/backend/jest.config.cjs |
| Arquivos de testes focados | 1931 / 4664 / 629 / 298 linhas | Manter cenários localizáveis | ⚠️ | Python splitlines, ordem das quatro suites acima; contexto preexistente |
| Prova HML pós-correção | 0 rodadas registradas | 1 rodada com pós-condições | ⚠️ | Plano de reenvio, critérios de aceite; V7 anterior 5/6 não comprova correção |

⚠️ **Não medível localmente**: cobertura executada por camada e validade real do contrato ERP pós-correção. A primeira requer execução com coverage; a segunda, fixture HML autorizada. Gates completos são responsabilidade do coordenador; não se repetiram nesta seção.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Dependências por construtor permitem forçar falhas do ERP e ledger | ✅ presente | BorderoGrupoBoletoService.test.ts:1263; composição:1326 |
| Recordable Test Cases | Fake reproduz regras HML documentadas; falta captura pós-correção | ⚠️ parcial | BorderoGrupoBoletoService.test.ts:49; plano de reenvio |
| Sandbox | Fake em memória, repositório e transação substituídos; nenhum ERP/DB real nas quatro suites | ✅ presente | BorderoGrupoBoletoService.test.ts:1326 |
| Executable Assertions | Motivo, alerta, ausência de escrita, preservação antiga e avulso verificados | ✅ presente | BorderoGrupoBoletoService.test.ts:1235-1444; RemessaService.test.ts:4495-4576 |
| Abstract Data Sources | Clients e repositories injetados; serviço de retirada real compõe com serviço de borderô real | ✅ presente | BorderoGrupoBoletoService.test.ts:1360 |
| Limit Structural Complexity | Cenários nomeados e parametrizados; testes longos já existentes exigem navegação | ⚠️ parcial | Quatro arquivos medidos; nenhum achado sistêmico fora do delta |
| Limit Non-Determinism | AGORA fixo e BankingCalendar controlável; respostas e erros programados | ✅ presente | BorderoGrupoBoletoService.test.ts:74; mocks na matriz de leitura |

## 4. Findings (achados)

### F-testability-1: Falta comprovar a guarda corrigida no contrato real do ERP

- **Severidade**: P2 (médio — validação de integração pendente)
- **Tactic violada**: Recordable Test Cases
- **Localização**: `ontology/_inbox/sispag-boleto-agrupado-reenvio-rejeitado-plano.md`, critérios de aceite 6; `src/backend/domain/service/sispag/BorderoGrupoBoletoService.test.ts:1235`
- **Evidência (objetiva)**:
  ```
  314/314 testes locais aprovados com dependências externas substituídas.
  0 rodadas HML pós-correção registradas; V7 anterior = 5/6.
  ```
- **Impacto técnico**: O fake não comprova sozinho que a leitura completa e a retirada do item novo preservam as pós-condições no Conexos real.
- **Impacto de negócio**: O gate de merge da Task 21 continua pendente; considerar importação isolada como sucesso repetiria o falso positivo anterior.
- **Métrica de baseline**: 0 rodadas HML pós-correção com guarda RETIRADO e preservação antiga comprovadas.

## 5. Cards Kanban

### [testability-1] Registrar prova HML da guarda e da retirada seletiva

- **Problema**
  > Os 314 testes locais passam, mas não há rodada HML pós-correção registrada. A integração anterior falhou na finalização apesar da importação aceita.
- **Melhoria Proposta**
  > Aplicar Recordable Test Cases na fixture HML autorizada da Task 21; registrar leituras completas, RETIRADO, alerta, preservação de item/baixas antigos e continuidade do avulso. Anexar evidência saneada e converter divergências do ERP em fixture de regressão. Não testar liberação automática nesta rodada.
- **Resultado Esperado**
  > Rodadas com pós-condições reais comprovadas: 0 → 1; nenhuma exclusão no antigo ou segundo borderô.
- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Rodadas HML pós-correção com evidência: 0 → 1.
  - Item antigo e suas baixas: contagem anterior → mesma contagem posterior.
- **Risco de não fazer**: Promover em produção uma suposição de integração que só foi confirmada no fake.
- **Dependências**: Fixture e execução HML autorizadas; gate obrigatório antes do merge já previsto na Task 21.

## 6. Notas do agente

Revisão quick do delta; não houve ERP, rede, banco ou alteração de código.
As duas falhas já corrigidas (bypass de retomada e limpeza bloqueando avulso) não permanecem findings.
Sandbox/Recordable Test Cases conectam Integrability; retomadas e preservação conectam Fault Tolerance.
Limit Structural Complexity conecta Modifiability; cobertura CI conecta Deployability.
A execução focada confirma estado local; gates completos e HML não são inferidos.
