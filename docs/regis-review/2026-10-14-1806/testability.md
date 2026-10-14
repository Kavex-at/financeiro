---
qa: Testability
qa_slug: testability
run_id: 2026-10-14-1806
agent: qa-testability
generated_at: 2026-10-14T18:30:00-03:00
scope: backend
score: 8.5
findings_count: 4
cards_count: 3
---

# Testability — Regis-Review (reduzido, delta `fix/sispag-guarda-codbar-repetido`)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / AutoLoopRunner | Mudança na guarda de código de barras repetido (ou na PR 2 que a reutiliza) | `AnaliseCodigoBarrasRepetido`, `CodigoBarrasBoleto.paraBarras`, `RemessaService.verificarCodigoBarrasRepetido`, `RemessaCnabValidator` gate 5.1 | CI, sem ERP (SEM_GROUND_TRUTH) | Testes unitários determinísticos falham se um invariante I16 regride | 6 suites / 266 testes verdes em 8,4 s; cobertura de linhas >= 87% por arquivo do delta |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **1. Cobertura por arquivo do delta (linhas / branches / funções)** | ver tabela abaixo | 80% / 70% / 80% | ✅ (1 exceção em branches) | `npx jest ... --coverage` |
| Suites / testes rodados | 6 / 266 passando | 100% | ✅ | idem |
| Testes novos no delta | ~44 (RemessaService 10+2, Analise 9, paraBarras 9, Error 7, Cnab 5, Client 1, routes 1) | — | ✅ | `git diff origin/main HEAD` |
| Fontes de não-determinismo no código novo (`Date.now`/`new Date()`/`Math.random`) | 0 (`new Date(local.vencimento)` é conversão pura de input) | 0 | ✅ | grep nos arquivos novos |
| Chamadas de rede reais nos testes novos | 0 (`routes/sispag.test.ts` usa servidor local, ERP mockado) | 0 | ✅ | leitura dos testes |
| Asserções vacuosas encontradas | 0 (1 teste com cobertura de alvo parcial, ver F-testability-2) | 0 | ✅ | revisão manual |
| `BoletoSemCodigoBarrasError.ts` modificado | sem diff | sem diff | ✅ | shared-metrics + diff |

Cobertura por arquivo (Métrica 1):

| Arquivo | Stmts | Branch | Funcs | Linhas | Não cobertas |
|---|---|---|---|---|---|
| `libs/boleto/AnaliseCodigoBarrasRepetido.ts` | 100 | 100 | 100 | 100 | — |
| `libs/boleto/CodigoBarrasBoleto.ts` | 100 | 97,6 | 100 | 100 | L47 (ramo `codigo` undefined) |
| `errors/BoletoCodigoBarrasRepetidoError.ts` | 100 | 80 | 100 | 100 | ramos L68-72, 102-110, 150 |
| `libs/cnab/RemessaCnabValidator.ts` | 98,5 | 96 | 100 | 100 | L141, 265, 294 (fora do delta) |
| `service/sispag/RemessaService.ts` | 96,9 | 83,1 | 98,7 | 97,5 | L236, 545, 1230, 1448, 1516, 1549-1559 (nenhuma no método novo `verificarCodigoBarrasRepetido`) |
| `client/ConexosSispagWriteClient.ts` | 87,2 | 68,0 | 87,5 | 87,8 | L512-579, 745, 1016-1035 (fora do delta; o trecho `invalidos` L622-652 está coberto) |

Checklist de testes exigidos:

| Exigência | Status | Evidência |
|---|---|---|
| PEDRONI canônico (10 títulos, 2 códigos sintéticos de DV válido) | ✅ | `Analise...test` (5+5, ordem estável) e `RemessaService.test` "PEDRONI" (aborta antes de `finalizarLote`, ledger `failed`, rascunho preservado via `setNativeFlpCod`) |
| Retomada (i) ainda repetido | ✅ | sem `criarLote`/`importarTitulos`/`finalizarLote`, 1 leitura |
| Retomada (ii) após remoção do analista | ⚠️ parcial | só troca a leitura do ERP para "distintos"; não remove item do lote local (ver F-testability-2) |
| Retomada (iii) em `gerar_remessa` | ✅ | lê antes de `sugerirRemessa`, que não é chamado |
| Privacidade (mensagem, userMessage, details, stack, ledger, log) | ⚠️ dividido | `Error.test` cobre message/userMessage/details/stack com janela de 10 dígitos; teste de serviço cobre log + ledger.fail; o erro lançado pelo serviço não é inspecionado (F-testability-2) |
| Lote sem BOLETO: 0 chamadas novas | ✅ | `listarLinhasDigitaveisDoLote` não chamado (também em dry-run) |
| `BoletoSemCodigoBarrasError` inalterado | ✅ | teste de ausência: erro antigo, 0 import, 0 leitura nova |
| DV edge cases de `paraBarras` | ⚠️ parcial | ✅ DV geral, ✅ DV do 1º campo, ✅ prefixo 8 (44 e 47), ✅ tamanho, ✅ letras, ✅ vazio, ✅ ida-e-volta. ❌ DV do 2º e do 3º campo não testados isoladamente (F-testability-1) |
| Rede J-52 excluído, A/B/O ignorados | ✅ | `RemessaCnabValidator.test` + teste de serviço (inválida tem precedência) |
| Leitura curta (WARN) | ✅ | `lidas: N-2, boletos: N`, `res.status === 'gerada'` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `AnaliseCodigoBarrasRepetido.analisar/mascarar` e `paraBarras` expostos como funções puras | ✅ presente | `AnaliseCodigoBarrasRepetido.ts` |
| Recordable Test Cases | Fixtures sintéticas geradas por `dvGeral`; sem gravação do ERP (SEM_GROUND_TRUTH) | ⚠️ parcial | helper `dvGeral` duplicado em 3 testes; o formato real do `itsNumCodbar` do ERP só foi confirmado em HML por probe, não por fixture |
| Sandbox | Mocks por injeção no construtor (`AnaliseCodigoBarrasRepetido` injetada) | ✅ presente | `make()` em `RemessaService.test.ts` |
| Executable Assertions | Falha fechada + `BoletoCodigoBarrasRepetidoError`; rede no `.REM` | ✅ presente | `RemessaService.ts` L625-631, validator gate 5.1 |
| Abstract Data Sources | `listarLinhasDigitaveisDoLote` atrás do `ConexosSispagWriteClient` | ✅ presente | `buildWrite()` |
| Limit Structural Complexity | Lógica extraída para classe pura; `verificarCodigoBarrasRepetido` ~90 linhas, 4 saídas | ⚠️ parcial | `RemessaService.ts` L1049-1130; arquivo já tem 138 testes e >1500 linhas |
| Limit Non-Determinism | Sem relógio/aleatoriedade no código novo; relógio do teste via `AGORA` | ✅ presente | grep |

## 4. Findings

### F-testability-1: DV do 2º e do 3º campo da linha digitável sem teste isolado

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (verificação de teste)
- **Localização**: `domain/libs/boleto/CodigoBarrasBoleto.test.ts:171-175`, `CodigoBarrasBoleto.ts` (`dvs = [c[9], c[20], c[31]]`)
- **Evidência (objetiva)**:
  ```
  it('DV de campo errado => undefined'): corrompe só linha[9] (DV do campo 1).
  Nenhum teste corrompe linha[20] ou linha[31].
  ```
- **Impacto técnico**: um erro de índice em `c[20]` ou `c[31]` (ou `campos[i]` fatiado errado) passaria com a suíte verde, e a guarda aceitaria como válido um código com campo 2/3 corrompido, ou rejeitaria códigos bons.
- **Impacto de negócio**: o rejeito indevido barra remessa legítima (fail-closed); o aceite indevido deixa um código mal lido virar chave de comparação.
- **Métrica de baseline**: 1 de 3 DVs de campo testados (33%); o mutante `dvs[1]`→`dvs[0]` sobrevive.

### F-testability-2: teste de privacidade e cenário "retry após remoção" com alvo parcial no nível do serviço

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `RemessaService.test.ts` "privacidade + auditoria" e "(ii) repetido resolvido"
- **Evidência (objetiva)**:
  ```
  await make(...).gerarRemessa(...).catch(() => undefined);   // erro lançado descartado
  chamadas = [log.info, log.warn, log.error, ledger.fail]       // sem err.message/userMessage/details/stack
  (ii): leitura do ERP troca para `distintos`; lote local continua com 10 itens
  ```
- **Impacto técnico**: o vazamento via `referencia()`/`mascarado` no objeto de erro montado pelo serviço só é coberto pelo teste isolado do erro, com entrada hostil sintética, não com a saída real do serviço. O caso (ii) não prova que a retomada reage à remoção local (na PR 1 ela não deveria, mas isso não é afirmado).
- **Impacto de negócio**: baixo hoje; vira regressão silenciosa quando a PR 2 mexer no caminho de retomada.
- **Métrica de baseline**: 0 de 4 campos do erro (message, userMessage, details, stack) inspecionados no teste de serviço; cobertura de linhas do método novo já em 100%, então é um problema de força da asserção, não de linha.

### F-testability-3: helper `dvGeral`/gerador de barras sintéticas copiado em 4 arquivos de teste

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `AnaliseCodigoBarrasRepetido.test.ts`, `RemessaService.test.ts`, `RemessaCnabValidator.test.ts` (`comDvOk`), `CodigoBarrasBoleto.test.ts` (outro helper)
- **Evidência (objetiva)**: 3 reimplementações do módulo-11 nos testes, mais a de produção `dvGeralValido`.
- **Impacto técnico**: se a regra do DV mudar, o teste e o código podem divergir juntos sem alarme; um espelho do algoritmo no teste não é oráculo independente.
- **Impacto de negócio**: nenhum imediato.
- **Métrica de baseline**: 3 cópias do algoritmo de DV nos testes.

### F-testability-4: ramos não cobertos em `BoletoCodigoBarrasRepetidoError`

- **Severidade**: P3
- **Tactic violada**: Specialized Interfaces
- **Localização**: `domain/errors/BoletoCodigoBarrasRepetidoError.ts:68-72,102-110,150`
- **Evidência (objetiva)**: branches 80% (linhas 100%).
- **Impacto técnico**: ramos de formatação opcional (valor/credor/vencimento ausentes, combinações de modo) sem exemplo.
- **Impacto de negócio**: mensagem ao analista pode sair malformada em dado incompleto (ex.: título removido do lote local).
- **Métrica de baseline**: 3 trechos de branch não cobertos.

## 5. Cards Kanban

### [testability-1] Testar o DV do 2º e 3º campo de `paraBarras` com `it.each`

- **Problema**
  > Só o DV do 1º campo da linha digitável é corrompido nos testes; mutações nos índices 20 e 31 sobrevivem.
- **Melhoria Proposta**
  > Em `CodigoBarrasBoleto.test.ts`, parametrizar a corrupção por posição `[9, 20, 31]` e acrescentar o caso `undefined` na entrada. Tactic: Executable Assertions.
- **Resultado Esperado**
  > DVs de campo testados 1/3 → 3/3; branches de `CodigoBarrasBoleto.ts` 97,6% → 100%.
- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - DVs de campo com teste isolado: 1 → 3
  - branches `CodigoBarrasBoleto.ts`: 97,6% → 100%
- **Risco de não fazer**: erro de índice no cálculo do DV não detectado; a guarda aceita ou recusa errado.
- **Dependências**: nenhuma

### [testability-2] Fortalecer asserções de privacidade e retomada no teste de serviço

- **Problema**
  > O teste de serviço descarta o erro lançado e não inspeciona message/userMessage/details/stack; o cenário "retry após remoção" não altera o lote local.
- **Melhoria Proposta**
  > No teste de privacidade, capturar `err` e aplicar a varredura de janela de 10 dígitos nos 4 campos junto com log/ledger. No caso (ii), remover os itens repetidos do `lote` local e afirmar o comportamento esperado na PR 1 (permanece abortando até descartar o rascunho, ou passa conforme a leitura do ERP). Tactic: Executable Assertions.
- **Resultado Esperado**
  > Campos do erro inspecionados no teste de serviço 0/4 → 4/4; variantes de retry com lote local alterado 0 → 1.
- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - campos do erro verificados no serviço: 0 → 4
  - cenários de retomada com lote local alterado: 0 → 1
- **Risco de não fazer**: regressão de privacidade ou de retomada entra silenciosa na PR 2.
- **Dependências**: nenhuma; idealmente antes da PR 2.

### [testability-3] Extrair gerador de barras sintéticas para um helper de teste compartilhado

- **Problema**
  > O módulo-11 está copiado em 3 testes, com espelho do algoritmo de produção.
- **Melhoria Proposta**
  > Criar `domain/libs/boleto/__testing__/barrasSinteticas.ts` (ou fixture com valores literais pré-calculados) usado por Analise, RemessaService, Cnab e CodigoBarras tests; preferir literais com DV conferido por fonte externa. Tactic: Recordable Test Cases.
- **Resultado Esperado**
  > Cópias do algoritmo de DV nos testes 3 → 0 (literais) ou 1 (helper); testes importando fixture comum 0 → 4.
- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-3, F-testability-4
- **Métricas de sucesso**:
  - cópias do algoritmo de DV em testes: 3 → 0
  - branches `BoletoCodigoBarrasRepetidoError.ts`: 80% → >= 90%
- **Risco de não fazer**: DV de teste e de produção divergem juntos; manutenção duplicada.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta; as linhas não cobertas de `ConexosSispagWriteClient.ts` e `RemessaService.ts` fora de `verificarCodigoBarrasRepetido` e do trecho `invalidos` não foram avaliadas.
- Nenhum P0/P1: o delta tem 100% de linhas nos arquivos novos e todos os testes exigidos existem e fazem asserção de comportamento.
- Cross-QA: Security (privacidade do código; F-testability-2) e Fault Tolerance (retomada e fail-closed; F-testability-2).
- Não medível localmente: ground truth do `itsNumCodbar` no ERP (SEM_GROUND_TRUTH); um teste de contrato exigiria gravar fixture em HML.
