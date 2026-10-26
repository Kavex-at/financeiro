---
qa: Testability
qa_slug: testability
run_id: 2026-10-26-1700-sispag-boleto-agrupado
agent: qa-testability
generated_at: 2026-10-26T18:30:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Testability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor Kavex | Muda a regra do boleto agrupado (elegibilidade, write-ahead do borderô, fecho pago/rejeitado, autorização por filial) | `GrupoBoletoService`, `BorderoGrupoBoletoService`, `FechamentoGrupoBoleto`, `CasamentoRetornoGrupo`, `DecisaoStatusLote`, `routes/sispag.ts` | CI (PR) e local, sem rede nem relógio real | Testes unitários (ledger/ERP falsos, `calendar` injetado) e SQL integration quebram na regressão | Toda unidade de negócio do delta com teste; 0 chamadas reais a Conexos/Nexxera; cenário de queda e retomada coberto por tabela |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos de teste no delta (todos) | 59 | n/a | ✅ | `git diff --name-only origin/main..HEAD` |
| Arquivos de teste do grupo (backend 27 + frontend 8) | 35 | ≥1 por unidade | ✅ | idem, filtro `grupo\|bordero\|remessa\|...` |
| Serviços/repositórios/rotas/clients novos sem teste | 0 de 30 fontes tocadas (amostragem) | 0 | ✅ | cruzamento fonte × `*.test.ts` |
| Integration SQL (PG real) do grupo | 5 (`GrupoBoletoRepository`, `GrupoBoletoExecucaoRepository`, `LotePagamentoGrupoLock`, `GrupoBoletoService`, migration 0090) | ≥1 por repo com SQL novo | ✅ | `*.integration.test.ts` |
| Suítes/testes verdes (BE) | 305 suites / 5.939 testes (antes das correções); após: 60 suites / 1.740 testes nas pastas `domain/service/sispag`, `domain/client/ConexosBaixaClient`, `routes/sispag` | 100% | ✅ | `_shared-metrics.md` + execução local |
| Suítes/testes verdes (FE) | 122 suites / 1.355 testes | 100% | ✅ | `_shared-metrics.md` |
| Teste da retomada pós-queda (I21s) | Tabela de reconhecimento em `BorderoGrupoBoletoService.test.ts` (janela: 0, 1, 2+ achados; borCod reusado; baixas parciais; varredura larga F-ft-1) | todo ramo de `recuperarIdentidade` | ✅ | `BorderoGrupoBoletoService.test.ts:1014+` |
| Teste de 403 por filial nas rotas de escrita do grupo | 4/4 (confirmar, anular, incluir, retirar) após o commit `8b81e760`; antes 1/4 | 4/4 | ✅ | `routes/sispag.grupoBoleto.test.ts` |
| Leituras de relógio real na fonte do delta | 0 (`calendar.now()` injetado) | 0 | ✅ | grep em `BorderoGrupoBoletoService.ts`, `FechamentoGrupoBoleto.ts` |
| Rede real em testes | 0 (ERP/ledger falsos em memória; fetch só no servidor express local) | 0 | ✅ | inspeção |
| Maior arquivo de teste do delta | `BorderoGrupoBoletoService.test.ts` 1.697 LOC (58 casos) para fonte de 1.487 LOC | <500 | ⚠️ | `wc -l` |
| Fixtures de wire real do grupo (HAR/`__fixtures__`) | 1 antiga; fakes do ERP são sintéticos | ≥1 por response-shape | ⚠️ | ver F-integrability-1 |
| Prova viva da retomada (HML `falha`/`retomada`) | pendente | feita antes do PRD | ❌ | `_shared-metrics.md` |
| Cobertura percentual do delta | não medida (sem `--coverage` nesta rodada) | ≥70% | ⚠️ Não medível aqui | — |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Ledger, clients Conexos, `calendar` e `identidade` injetados por tsyringe; fakes com `jest.fn` e trilha de chamadas (`semEscrita(m)`) | ✅ presente | `BorderoGrupoBoletoService.test.ts:200-720` |
| Record/Playback | Sem gravação de tráfego real do grupo; fake do ERP é sintético | ⚠️ parcial | F-testability-1 |
| Sandbox | SQL integration em PG real; HML com kill-switch (`SIMULADO`) | ✅ presente | `*.integration.test.ts`, `BorderoGrupoBoletoService.ts` (dry-run) |
| Executable Assertions | Zod `.strict()` nos 3 bodies, `z.guid()` nos ids; erros nomeados com status | ✅ presente | `GrupoBoletoSchemas.ts`; `sispag.grupoBoleto.test.ts` |
| Abstract Data Sources | Repositórios atrás de serviços; rotas testadas com serviços registrados no container | ✅ presente | `sispag.grupoBoleto.test.ts:97-125` |
| Limit Structural Complexity | `BorderoGrupoBoletoService` 1.487 LOC concentra preparação, retomada, limpeza e alertas | ⚠️ parcial | F-testability-2 |
| Limit Non-Determinism | Tempo injetado; sem aleatoriedade; ordem de execução fixa | ✅ presente | grep |

## 4. Findings (achados)

### F-testability-1: fakes do ERP sintéticos escondem divergência de wire

- **Severidade**: P2
- **Tactic violada**: Record/Playback
- **Localização**: `src/backend/domain/service/sispag/BorderoGrupoBoletoService.test.ts` (`erpFake`); `src/backend/domain/client/ConexosBaixaClient.test.ts`
- **Evidência**: `buscarBorderosNaJanela`, `buscarBorderoPorIdentidade` e `criarBorderoDoGrupo` são reimplementados em memória; o fake filtra `borTimCad` em epoch ms como o ERP real, mas a semântica de filtros (`#GE`, `#LE`, paginação truncada) só é provada pelo teste do client contra respostas escritas à mão.
- **Impacto técnico**: o fake e o ERP podem divergir sem teste vermelho (ex.: a varredura larga do F-ft-1 depende de o ERP aceitar a faixa de 48h).
- **Métrica de baseline**: 0 respostas reais gravadas do grupo; 1 fase HML (`canonico`) de 4.

### F-testability-2: arquivo de teste e fonte do borderô do grupo passam de mil linhas

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `BorderoGrupoBoletoService.ts` (1.487 LOC), `BorderoGrupoBoletoService.test.ts` (1.697 LOC)
- **Evidência**: `wc -l`. Um único `describe` por tema, mas o helper `montar` tem ~500 linhas.
- **Impacto técnico**: leitura e manutenção lentas; novo caso exige entender o fake inteiro.
- **Métrica de baseline**: 1 arquivo >1.500 LOC; alvo <500 por arquivo de teste.

### F-testability-3: cenários de queda e de relógio desencontrado só existem em fake

- **Severidade**: P2
- **Tactic violada**: Sandbox (prova no ambiente real)
- **Localização**: `docs/regis-review/.../_shared-metrics.md` (HML `falha`/`retomada`/`v7` pendentes)
- **Evidência**: o teste novo do F-ft-1 prova a decisão (indeterminado em vez de criar), não que o `fin010/list` aceita a faixa larga em HML.
- **Impacto técnico**: o caminho de recuperação só foi exercido com fakes.
- **Métrica de baseline**: 0 execuções reais de retomada.

## 5. Cards Kanban

### [testability-1] Gravar respostas reais do `fin010` do grupo como fixtures e rodá-las contra o client

- **Problema**
  > O fake do ERP dos testes do borderô é sintético; um filtro ou campo novo do Conexos não derruba nenhum teste.
- **Melhoria Proposta**
  > Gravar (redigidas) as respostas de `fin010/list` (janela, identidade), `criarBorderoDoGrupo` e `borderosPendentes` na HML e alimentar `ConexosBaixaClient.test.ts` com elas; checar que o fake devolve o mesmo shape.
- **Resultado Esperado**
  > ≥1 fixture real por response-shape do grupo (hoje 0).
- **Tactic alvo**: Record/Playback
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1, F-integrability-1
- **Métricas de sucesso**:
  - Fixtures reais do grupo: 0 → ≥4
- **Risco de não fazer**: mudança de contrato do ERP só aparece em produção.
- **Dependências**: acesso HML (fase `retomada`).

### [testability-2] Quebrar `BorderoGrupoBoletoService.test.ts` por tema e extrair o fake do ERP

- **Problema**
  > 1.697 linhas num arquivo; o fake do ERP e do ledger moram dentro dele.
- **Melhoria Proposta**
  > Mover `erpFake`/`ledgerFake`/`montar` para `__fixtures__/` e separar os `describe` (preparação, retomada, limpeza, alertas) em arquivos.
- **Resultado Esperado**
  > Nenhum arquivo de teste do serviço >600 LOC.
- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Maior arquivo de teste: 1.697 → <600 LOC
- **Risco de não fazer**: custo crescente de manutenção.
- **Dependências**: nenhuma.

### [testability-3] Provar a retomada e a varredura larga em HML antes de ligar o PRD

- **Problema**
  > A decisão de falhar fechado só foi testada com fakes.
- **Melhoria Proposta**
  > Fase HML `retomada`: matar o processo entre o `POST fin010` e `registrarBordero`; confirmar o reconhecimento pela janela e, com `borTimCad` fora dela, o desfecho `indeterminado`.
- **Resultado Esperado**
  > 2 cenários de retomada provados em HML (hoje 0).
- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-3, F-ft-7
- **Métricas de sucesso**:
  - Fases HML concluídas: 1/4 → 4/4
- **Risco de não fazer**: primeiro uso real da recuperação com dinheiro de verdade.
- **Dependências**: HML disponível (fora do alcance desta rodada).

## 6. Notas do agente

- Cross-QA: F-testability-3 coincide com F-ft-7 e integrability-3; testability-1 com integrability-1.
- Os testes do `security-1` e do `ft-1` foram escritos antes do código (vermelho confirmado) nos commits `8b81e760` e `a7de54fa`.
