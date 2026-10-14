---
qa: Testability
qa_slug: testability
run_id: 2026-10-14-2030
agent: qa-testability
generated_at: 2026-10-14T20:45:00-03:00
scope: all
score: 8
findings_count: 4
cards_count: 4
---

# Testability — Regis-Review (delta `sispag-remocao-codbar-repetido`, PR 2/2)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / AutoLoopRunner | Mudança na guarda que retira item BOLETO repetido/ilegível e apaga do rascunho nativo (money-safety: nada finaliza com código repetido) | `RetiradaCodigoBarrasService`, `LotePagamentoRepository.retirarItemPorCodigoDeBarras`, `RemessaService`, migration 0085, `LoteCard`/`TitulosRetidosBadge` | Pré-merge, CI (`backend`, `backend-sql`, `frontend`) | Regressão em qualquer invariante I16d.1–I16d.8 / I16h(a–e) reprova um teste que nomeia o invariante, sem depender de HML | 100% dos invariantes com asserção de resultado (não só contagem de chamadas); 0 ramo de falha de efeito colateral sem teste |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **#1 Cobertura por camada do delta** (serviço novo `RetiradaCodigoBarrasService`) | Lines 98,2% / Branch 85,9% / Funcs 96,4% (linhas não cobertas: 308, 311–315) | 80% lines / 70% branches | ✅ | `npx jest domain/service/sispag/RemessaService.test.ts --coverage --collectCoverageFrom=...RetiradaCodigoBarrasService.ts` |
| #1b Cobertura `AnaliseCodigoBarrasRepetido` (domain/libs; só via RemessaService.test, o teste próprio cobre o resto) | Lines 93,9% / Branch 64,3% | 80/70 | ⚠️ (isolado) | mesmo comando |
| #1c Repositórios do delta | `RetiradaCodigoBarras.integration.test.ts` (9 casos) + `BloqueioDuplicidadeRepository.test` + `LotePagamentoRepository.test` + `VerificacaoEventoRepository.test`; todos os métodos novos com teste | ≥1 integração por SQL complexo | ✅ | `git diff --stat origin/main HEAD` |
| #1d Lambdas/rotas | `routes/sispag.test.ts` +154 linhas; `routePermissions.test.ts` atualizado | >0 | ✅ | diff stat |
| #1e Frontend do delta | 5 arquivos de teste tocados (`RetiradosPorCodigoBarrasAviso` 4 casos, `TitulosRetidosBadge` 5, `LoteCard` +3, `page` +3, `GerarRemessaDialog` +2) para 4 componentes/páginas alterados | ≥1 por componente | ✅ | `git diff origin/main HEAD -- '*.test.tsx'` |
| Arquivo de teste do serviço novo | 0 (`RetiradaCodigoBarrasService.ts` 558 LOC testado só via `RemessaService.test.ts`) | 1 colocado | ⚠️ | `ls src/backend/domain/service/sispag \| grep Retirada` |
| Tamanho de `RemessaService.test.ts` | 3174 LOC, 146 testes | ≤ 500 LOC | ❌ | `wc -l` |
| Invariantes I16d/I16h com teste de resultado | I16d.1 ✅, d.2 ✅, d.3 ✅ (ordem + ausência observada), d.4 ✅, d.5 ✅, d.6 ✅, **d.7 ⚠️ (metade)**, d.8 ✅ (integração); I16h(a) ✅ (b) ✅ (c) ✅ 3 variantes (d) ✅ (e) ✅ 3 casos | 100% | ⚠️ 14/15 ramos | leitura de `RemessaService.test.ts:2291-3050` |
| Ordem local → DELETE → releitura → finalizar | Assertada por `invocationCallOrder` (`RemessaService.test.ts:2477`) | sim | ✅ | idem |
| Injeção de falha por passo | leitura inicial ✅ (503), DELETE 200 sem sumir ✅, DELETE 5xx mas ausente ✅, releitura falha ✅, DELETE do resíduo falha ✅, falha parcial ✅; **transação local falha ✗; `removido:false` ✗; pós-limpeza reaplica I16a ✗** | todos os passos | ⚠️ | idem |
| Teste de migração (Postgres real) | `0085...integration.test.ts` 8 casos (backfill DUPLICIDADE_TITULO, CHECKs, índice ATIVO único) + `.test.ts` estático + `rollbacks.test.ts`; CI roda via `test:sql` com `CI=true` falhando se sem DSN | ≥1 | ✅ | `ci.yml:32-60`, `package.json:24` |
| Vazamento do código completo em log/ledger/erro | janela deslizante de 10 dígitos assertada em ledger+erro; `warn` mascarado | sim | ✅ | `RemessaService.test.ts:2803,2847` |
| Leituras de relógio/aleatoriedade no serviço novo | 1 (`new Date(local.vencimento)` — conversão de dado, não leitura do "agora") | 0 | ✅ | `RetiradaCodigoBarrasService.ts:498` |
| Fixtures gravadas HML do DELETE | achados medidos em HML documentados (`...-hml-achados.md`) e codificados no `nativoFake` (200 / 500 RECORDNOTFOUND / 400); probe não roda em CI | presente | ⚠️ parcial | `jobs/probe-hml-delete-item-inexistente.ts` |
| Baseline suíte (relatada) | backend 243 suites/4479; frontend 95/995 | verde | ✅ | `_shared-metrics.md` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `classificarIntrusos` público, `Analise.decidirRetirada` pura; leitura/DELETE via `ConexosSispagWriteClient` injetado | ✅ | `RetiradaCodigoBarrasService.ts:117`, `AnaliseCodigoBarrasRepetido.ts:96` |
| Recordable Test Cases | Medição HML virou `nativoFake` com comportamento do ERP (DELETE ausente ⇒ 500) e probe reexecutável; sem fixture JSON gravada | ⚠️ parcial | `RemessaService.test.ts` `nativoFake`; `probe-hml-delete-item-inexistente.ts` |
| Sandbox | `nativoFake` com estado mutável (`deleteIgnorado`, `deleteErroMasSai`, `relerFalha`) + `loteVivo` para o repositório local | ✅ | `RemessaService.test.ts:2435,2731-2790` |
| Executable Assertions | CHECKs SQL de máscara 5+4 e `origem`, índice ATIVO único; guard no repositório recusa máscara inválida | ✅ | migration 0085, `LotePagamentoRepository.ts:895` |
| Abstract Data Sources | DB via `PostgreeDatabaseClient.withTransaction`, repos injetados; atomicidade provada em Postgres real | ✅ | `RetiradaCodigoBarras.integration.test.ts:181` |
| Limit Structural Complexity | Serviço dedicado (558 LOC) extraído de `RemessaService`, mas testado dentro do arquivo de 3174 LOC | ⚠️ | `wc -l` |
| Limit Non-Determinism | Sem relógio/aleatório; DELETE de tentativa única (sem retry cego); releitura com `RetryExecutor` (delay real de 150 ms nos testes de falha) | ✅ | `RetiradaCodigoBarrasService.ts:101` |

## 4. Findings

### F-testability-1: I16d.7 (reaplicar I16a depois da limpeza) só tem a metade "esvazia" testada

- **Severidade**: P1
- **Tactic violada**: Executable Assertions (último portão antes de `finalizarLote` sem teste)
- **Localização**: `src/backend/domain/service/sispag/RetiradaCodigoBarrasService.ts:305-316` (`posLimpeza`, ramo `aindaRuins`)
- **Evidência (objetiva)**:
  ```
  RetiradaCodigoBarrasService.ts | 98.47 | 85.88 | 96.36 | 98.22 | 308,311-315
  ```
  O teste `RemessaService.test.ts:2658` cobre só `atual.itens.length === 0`. Nenhum teste faz a última releitura ainda trazer repetido/ilegível entre locais (ERP trocando o código entre leituras, item extra com mesmo código) e espera erro `modo:'limpeza'` sem `finalizarLote`.
- **Impacto técnico**: uma regressão que deixe o ramo virar `return atual` passaria 4479 testes e finalizaria lote com boleto repetido; a única rede restante seria o gate 5.1 do `.REM` (abort-only).
- **Impacto de negócio**: a classe do incidente original (boleto repetido pago duas vezes) volta a depender de uma única rede em vez de duas.
- **Métrica de baseline**: 8 linhas / 1 ramo (I16d.7 "zero repetido, zero ilegível") sem execução; ver nota de severidade na seção 6 (P1, não P0: o invariante primário I16d.1–I16d.3 está pinado e a rede 5.1 existe).

### F-testability-2: Falha da transação local e retorno `removido:false` nunca exercitados no serviço (e o serviço descarta o retorno)

- **Severidade**: P1
- **Tactic violada**: Sandbox / injeção de falha por passo
- **Localização**: `RetiradaCodigoBarrasService.ts:~395-412` (`retirarLocal` devolve `void`, ignora `{removido}`); mock default `RemessaService.test.ts:134` (`mockResolvedValue({ removido: true })`)
- **Evidência (objetiva)**: `grep` no teste: nenhum `retirarItemPorCodigoDeBarras.mockRejected*` nem `{ removido: false }`. No repositório, `removido:false` é o resultado quando o lote deixou de estar `FINALIZADO` ou o item já saiu (`LotePagamentoRepository.ts:~920`; provado na integração `:171`). O serviço, nesse caso, segue para o `DELETE` nativo e ainda contabiliza o item em `retirados` (valor/vencimento do snapshot `locais`), **sem marca nem evento** gravados.
- **Impacto técnico**: o par "local primeiro" (I16d.3) é provado só para o caminho feliz; a ordem inversa (item fora do ERP, sem trilha/marca) é exatamente o hazard que o invariante descreve e está sem teste. O `versaoEsperada` do `transicionarStatus` seguinte limita o dano, mas isso é acidente, não asserção.
- **Impacto de negócio**: retirada silenciosa sem retenção (viola "nunca em silêncio", I16d/I16g) em corrida com cancelamento/edição concorrente.
- **Métrica de baseline**: 0 de 2 caminhos de falha do passo local testados no serviço (transação rejeita; `removido:false`).

### F-testability-3: Serviço de 558 LOC sem arquivo de teste próprio; asserções no `RemessaService.test.ts` de 3174 LOC

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `RemessaService.test.ts:2291-3050` (≈760 linhas do bloco novo dentro de um arquivo de 3174)
- **Evidência (objetiva)**: `wc -l` = 3174; `RetiradaCodigoBarrasService` só é importado por `RemessaService.ts` e pelo teste dele. Cobrir `reler`/`posLimpeza`/`classificarIntrusos` exige montar `RemessaService` completo (ledger, write, loteRepo, 7 mocks).
- **Impacto técnico**: custo marginal de testar a guarda alto; F-1 e F-2 sobreviveram por isso (precisam de montagem de teste cara).
- **Impacto de negócio**: ciclos de mudança nessa guarda (prevista: "prefira confirmado por humano", P1-1b) pagam a taxa de contexto toda vez.
- **Métrica de baseline**: 3174 LOC / 146 testes num arquivo; 0 testes unitários diretos do serviço.

### F-testability-4: Comportamento do ERP para o DELETE só é regressível via fake mantido à mão

- **Severidade**: P3
- **Tactic violada**: Recordable Test Cases
- **Localização**: `jobs/probe-hml-delete-item-inexistente.ts`, `nativoFake`
- **Evidência (objetiva)**: respostas medidas (200 sem corpo; 500 RECORDNOTFOUND; 400 FIN_015.IMPOSSIVEL_ALTERAR_REGISTRO_NAO_EM_CADASTRO) estão no markdown de achados e no código do fake; não há fixture compartilhada com `ConexosSispagWriteClient.test.ts` (+110 linhas) que ateste que o cliente classifica as três respostas como o fake supõe.
- **Impacto técnico**: o fake pode divergir do cliente real sem teste vermelho.
- **Impacto de negócio**: baixo; o desenho decide pela releitura, não pelo status.
- **Métrica de baseline**: 3 respostas medidas, 0 fixtures compartilhadas.

## 5. Cards Kanban

### [testability-1] Pinar I16d.7: pós-limpeza com repetido/ilegível remanescente não finaliza

- **Problema**
  > O ramo `aindaRuins` de `posLimpeza` (linhas 308–315) é o último portão antes de `finalizarLote` e não executa em nenhum teste; só a metade "lote esvazia" de I16d.7 está pinada.
- **Melhoria Proposta**
  > Adicionar em `RemessaService.test.ts` (ou no novo arquivo do card 3) caso com `nativoFake` cuja releitura final devolve um repetido residual entre itens locais, e outro com ilegível. Esperar `BoletoCodigoBarrasRetiradaIncompletaError modo:'limpeza'`, ledger `failed`, `finalizarLote` não chamado, `retirados` contabilizando os já confirmados.
- **Resultado Esperado**
  > Linhas não cobertas do serviço 8 → 0; branch 85,9% → ≥ 95%; I16d.7 com 2/2 metades pinadas.
- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Casos de teste de pós-limpeza: 1 → 3
  - Linhas 308–315 cobertas: 0% → 100%
- **Risco de não fazer**: refatoração do loop de retirada remove a reaplicação sem teste vermelho.
- **Dependências**: nenhuma

### [testability-2] Cobrir falha da transação local e `removido:false` na retirada (e tratar o retorno)

- **Problema**
  > O serviço nunca é testado com `retirarItemPorCodigoDeBarras` rejeitando ou devolvendo `removido:false`, e `retirarLocal` ignora o retorno: segue ao DELETE nativo e contabiliza como retirado sem marca/evento.
- **Melhoria Proposta**
  > Testes: (a) transação rejeita ⇒ nenhum `removerItemDoRascunho`, `finalizarLote` não chamado, ledger `failed`; (b) `removido:false` para alvo não-resíduo ⇒ decidir e assertar (aborta como incompleta, ou só DELETE sem contar como retirado com marca). Ajustar `retirarLocal` para devolver o resultado e o loop reagir. Mock default passa a incluir um caso `removido:false`.
- **Resultado Esperado**
  > Caminhos de falha do passo local testados 0/2 → 2/2; I16d.3 (local primeiro) pinado também no sentido de falha.
- **Tactic alvo**: Sandbox (injeção de falha)
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Testes de falha do passo local: 0 → 2
  - Retiradas contabilizadas sem marca/evento: indefinido → 0 por asserção
- **Risco de não fazer**: corrida com cancelamento gera item apagado do ERP, sem retenção nem trilha.
- **Dependências**: decisão de produto do comportamento em `removido:false` (abortar vs seguir)

### [testability-3] Extrair `RetiradaCodigoBarrasService.test.ts` e enxugar o `RemessaService.test.ts`

- **Problema**
  > 558 LOC de lógica de segurança testados dentro de um arquivo de 3174 LOC; cada caso exige montar o `RemessaService` inteiro.
- **Melhoria Proposta**
  > Mover os ≈760 LOC do bloco `guarda de código de barras que retira` para teste colocado do serviço (injeção direta dos 7 colaboradores) mantendo no `RemessaService.test.ts` só a integração de etapas (retomada/ledger/finalizar).
- **Resultado Esperado**
  > `RemessaService.test.ts` 3174 → ≈2400 LOC; serviço novo com arquivo próprio (0 → 1); tempo de montagem por caso reduzido.
- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Arquivos de teste do serviço: 0 → 1
  - Maior arquivo de teste do sispag: 3174 → ≤ 2400 LOC
- **Risco de não fazer**: próximos invariantes da guarda (P1-1b) repetem o padrão de lacunas por custo de montagem.
- **Dependências**: fazer junto com testability-1/2

### [testability-4] Fixture compartilhada das respostas HML do DELETE entre fake e cliente

- **Problema**
  > As três respostas medidas do DELETE vivem em prosa e no fake do teste de serviço; nada garante que o cliente as classifique como o fake supõe.
- **Melhoria Proposta**
  > Criar `__fixtures__/fin015-delete-item.json` (200 sem corpo, 500 RECORDNOTFOUND, 400 FIN_015...), consumida por `ConexosSispagWriteClient.test.ts` e pelo `nativoFake`.
- **Resultado Esperado**
  > Fixtures gravadas para o DELETE 0 → 3; divergência fake×cliente falha em CI.
- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Respostas medidas com fixture: 0/3 → 3/3
- **Risco de não fazer**: mudança do ERP detectada só em produção.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: delta apenas. Medi cobertura só dos arquivos novos (via `RemessaService.test.ts`); não rodei a suíte inteira nem `test:sql` (sem Postgres local): integração/migração avaliadas por leitura e pelo gate de CI.
- Nenhum P0: o invariante principal (ordem local→DELETE→releitura, ausência observada, falha parcial fecha, ilegível ≠ ausência, I16h(a–e) incluindo 3 variantes de "não é resíduo", frontend aviso/undo) está pinado com asserção de resultado. F-1 seria P0 se a rede do `.REM` (gate 5.1) não existisse.
- A remoção de `VencimentoCivil.integration.test.ts` e do ADR-0070 aparece no `git diff origin/main HEAD` mas não pertence a este tweak: provável avanço da `main`; conferir com `git diff origin/main...HEAD` antes de ler como perda de teste.
- Cross-QA: F-2 sobrepõe Fault Tolerance (falha parcial/corrida); testability-4 sobrepõe Integrability (contract fixtures do Conexos); `test:sql` no CI sobrepõe Deployability.
