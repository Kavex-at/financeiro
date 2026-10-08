---
qa: Testability
qa_slug: testability
run_id: 2026-10-08-2012-favorecido-autorizado
agent: qa-testability
generated_at: 2026-10-08T20:30:00Z
scope: all
score: 7.5
findings_count: 5
cards_count: 4
---

# Testability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / AutoLoopRunner | Mudança na regra de autorização de favorecido (aprovar, revogar, reconferir, verificar na remessa) | `AuthorizedPayeeService`, `AuthorizedPayeeRule`, `AuthorizedPayeeRepository`, rota `/sispag/favorecidos`, tela `favorecidos-autorizados` | CI (`npm test -- --coverage` + `test:sql` em Postgres) | Testes forçam cada estado e transição via injeção e detectam regressão sem depender de relógio, rede ou ordem | 100% das transições do ciclo do favorecido cobertas; 0 leituras de relógio/UUID sem seam; suíte determinística |

## 2. Métricas observadas

Escopo: apenas os arquivos do delta (149 caminhos em `_shared-metrics.md`). As suítes completas não foram reexecutadas, por instrução. Os números de gate vêm do `_shared-metrics.md`.

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **#1 Cobertura por camada (backend)** | ⚠️ Não medível neste run: `--coverage` não foi reexecutado. Piso do gate em `jest.config.cjs`: global 72% linhas / 54% branches / 78% funções; `./domain/service/` 88% linhas / 60% branches | 80% linhas e 70% branches em service e repository | ⚠️ | `src/backend/jest.config.cjs:39-55` |
| #1b Cobertura por camada (proxy: arquivo-fonte do delta com teste colocado) | `domain/service/sispag`: 8 de 13 `.ts` de fonte com `.test.ts` ao lado (os 5 sem teste são os `Excecao*`/`Pendencia*`, `ConferenciaLote*` e `LotePagamentoApiView`, ver nota); `domain/libs/sispag`: 4 de 7; `domain/repository/sispag`: 4 de 7 | ≥ 0,5 por camada | ✅ | `find` sobre `/tmp/delta.txt` |
| Gate backend | 223 suítes / 3967 testes verdes; typecheck 0; lint 0 | verde | ✅ | `_shared-metrics.md` |
| Gate frontend | 86 suítes / 866 testes verdes; typecheck 0; lint 0 erros | verde | ✅ | `_shared-metrics.md` |
| Razão arquivos de teste / fonte (repo, backend) | 248 testes / ~79k LOC de fonte | ≥ 0,5 por arquivo-fonte | ⚠️ | `_shared-metrics.md` |
| Testes do núcleo novo | `AuthorizedPayeeService` 22 casos em 5 `describe` (564 LOC); `AuthorizedPayeeRule` 21 casos; migration 0080 14 casos unitários e 12 de integração; rota `sispag.favorecidos` 8 casos | 1 `describe` por método público | ✅ | `grep -c "it("` |
| Cobertura de métodos públicos do `AuthorizedPayeeService` | 9 públicos (`listar`, `eventos`, `solicitar`, `aprovar`, `rejeitar`, `revogar`, `verificarDestinoAutorizado`, `reconferir`, `revelar`). `listar` e `eventos` sem `describe` próprio; os outros 7 cobertos | 9 de 9 | ⚠️ | `AuthorizedPayeeService.ts:102-373` vs `describe(` na suíte |
| Testes de integração com Postgres no delta | 4 arquivos (`AuthorizedPayeeRepository`, `VerificacaoTedPix`, migration 0080, mais o job `test:sql`). O CI roda `npm run test:sql` | ≥ 1 por repositório com SQL complexo | ✅ | `ci.yml:62`, `package.json test:sql` |
| Leituras de relógio sem seam no código novo | 6 em `AuthorizedPayeeService.ts` (linhas 131, 202, 345, 458, 509, 541). 0 usos de `useFakeTimers`/`setSystemTime` na suíte | 0 | ❌ | `grep "new Date("` |
| Aleatoriedade sem seam no código novo | `randomUUID` em `AuthorizedPayeeRepository` (L163, L234), `VerificacaoEventoRepository` (L48) e `LotePagamentoRepository` (L245) | 0 | ⚠️ | `grep randomUUID` |
| Testes de propriedade (fast-check) no delta | 0. `PayeeFingerprint.test.ts` e `AuthorizedPayeeRule.test.ts` sem `fc.` | ≥ 1 nas funções puras | ⚠️ | `grep fast-check` |
| Maior arquivo de teste tocado | `RemessaService.test.ts` 2256 LOC; `sispag.test.ts` 1351; `LotePagamentoService.test.ts` 1068 | ≤ 500 | ❌ | `wc -l` |
| Asserções de log no serviço novo | 9 menções a `logService`/`logger` em `AuthorizedPayeeService.test.ts` | caminhos de erro logados | ✅ | `grep -c` |
| Componentes novos do frontend com teste colocado | 5 testes (`CandidatosTab`, `page`, `LoteCard`, `LoteCard.verificacao`, `GerarRemessaDialog`). Sem teste próprio: `AutorizacoesTab`, `AutorizacoesTable`, `DecidirAutorizacaoDialog`, `MotivoAutorizacaoDialog`, `RevelarDestinoButton`, `SeloConferencia`, `SolicitarAutorizacaoDialog`, `formatar.ts` | ≥ 0,5 | ⚠️ | `find` |
| Gate de cobertura no CI | `coverageThreshold` presente (backend e frontend); `npm test -- --coverage` em `ci.yml:29,82` | presente e bloqueante | ✅ | `jest.config.*`, `ci.yml` |

Nota sobre a tabela de camadas: o delta mostra muitos `Excecao*` e `Pendencia*` como "sem teste", mas os arquivos de teste correspondentes aparecem na lista e não existem mais no disco. O delta os remove (feature substituída). Isso é ruído de remoção, não dívida.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Serviço e repositório recebem dependências por construtor (tsyringe). `EnvironmentProvider` expõe `sispagFavorecidoFingerprintKey` e `...KeyId`. O job de validação injeta a chave via `env`. | ✅ presente | `PayeeFingerprint.ts:46-55`, `validate-sispag-favorecido-autorizado-v1.ts:159` |
| Recordable Test Cases | Fixtures `.rem` redigidas para remessa. Nenhuma fixture de resposta do Conexos para o fluxo de favorecido. | ⚠️ parcial | `__fixtures__/*.rem` |
| Sandbox | `test:sql` em Postgres local/CI com migration 0080 e rollback testado (`rollbacks.test.ts`). | ✅ presente | `ci.yml:62`, `0080_...integration.test.ts` |
| Executable Assertions | Regras puras (`AuthorizedPayeeRule`) e erros tipados por transição (`AuthorizedPayeeStateError`, `PayeeApprovalBySolicitorError`, `PayeeNotAuthorizedAtRemittanceError`). Constraints na migration 0080 exercitadas em integração. | ✅ presente | `AuthorizedPayeeErrors.test.ts`, `0080_...test.ts` |
| Abstract Data Sources | Repositório atrás de classe injetável; o serviço é testado com repositório mockado e, em separado, com Postgres. | ✅ presente | `AuthorizedPayeeService.test.ts`, `AuthorizedPayeeRepository.integration.test.ts` |
| Limit Structural Complexity | `AuthorizedPayeeRule`, `PayeeFingerprint` e `MaskDestino` isolados como funções puras. Contra: `RemessaService.test.ts` com 2256 LOC mostra serviço grande. | ⚠️ parcial | `wc -l` |
| Limit Non-Determinism | Sem injeção de relógio nem de gerador de ID no código novo; testes dependem de `expect.any(Date)`/ordem. | ❌ ausente | `AuthorizedPayeeService.ts:131,202,345,458,509,541` |

## 4. Findings

### F-testability-1: Relógio e UUID lidos direto no serviço e nos repositórios novos

- **Severidade**: P1
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/backend/domain/service/sispag/AuthorizedPayeeService.ts:131,202,345,458,509,541`; `AuthorizedPayeeRepository.ts:163,234`
- **Evidência (objetiva)**:
  ```
  AuthorizedPayeeService.ts:202: const agora = new Date();
  AuthorizedPayeeService.ts:541: janelaInicio: new Date(vigente.decididoEm ?? vigente.solicitadoEm ?? Date.now()),
  AuthorizedPayeeService.test.ts: 0 ocorrências de useFakeTimers/setSystemTime
  ```
- **Impacto técnico**: `solicitadoEm`, `decididoEm`, `ultimaConferenciaEm` e `janelaInicio` não são controláveis. Os testes não conseguem afirmar a janela de validade nem a ordem dos eventos de auditoria sem `expect.any`. O fallback `Date.now()` na linha 541 fica sem teste determinístico.
- **Impacto de negócio**: a auditoria de quem autorizou o favorecido e quando é o ponto central da feature. Uma regressão na data gravada não seria pega.
- **Métrica de baseline**: 6 leituras de relógio sem seam; 0 testes com tempo congelado.

### F-testability-2: Nenhum teste de propriedade nas funções puras de segurança

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `domain/libs/sispag/PayeeFingerprint.ts`, `AuthorizedPayeeRule.ts`, `MaskDestino.ts` e seus testes
- **Evidência (objetiva)**:
  ```
  grep -l "fast-check" nos testes do delta -> 0 arquivos
  ```
- **Impacto técnico**: o fingerprint do destino (HMAC com chave versionada) e a máscara só têm exemplos fixos. Invariantes como "destino diferente gera fingerprint diferente", "mesmo destino com formatação diferente gera o mesmo" e "máscara nunca revela o dígito completo" não são exploradas.
- **Impacto de negócio**: se o fingerprint colidir ou variar por formatação, um destino alterado passa por autorizado, ou um autorizado é bloqueado sem motivo.
- **Métrica de baseline**: 0 propriedades; `fast-check` já é dependência.

### F-testability-3: Arquivos de teste muito grandes nos serviços tocados

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `RemessaService.test.ts` (2256), `routes/sispag.test.ts` (1351), `LotePagamentoService.test.ts` (1068), `SispagPainelService.test.ts` (705), `LotePagamentoRepository.test.ts` (695)
- **Evidência (objetiva)**:
  ```
  wc -l: 2256 / 1351 / 1068 / 705 / 695 (limite de referência 500)
  ```
- **Impacto técnico**: o gate de favorecido autorizado entrou em `RemessaService`, que já era grande. Setup repetido e acoplado encarece cada mudança no gate.
- **Impacto de negócio**: custo de teste por alteração no SISPAG cresce; revisão fica mais lenta.
- **Métrica de baseline**: 5 arquivos acima de 500 LOC, o maior com 4,5x o limite.

### F-testability-4: Componentes novos da tela sem teste próprio e `listar`/`eventos` sem `describe`

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/frontend/app/sispag/favorecidos-autorizados/components/*` (8 arquivos sem teste colocado); `AuthorizedPayeeService.ts:102,105`
- **Evidência (objetiva)**:
  ```
  testes colocados: CandidatosTab.test.tsx, page.test.tsx; sem teste: DecidirAutorizacaoDialog, MotivoAutorizacaoDialog, RevelarDestinoButton, SolicitarAutorizacaoDialog, SeloConferencia, AutorizacoesTab/Table, formatar.ts
  ```
- **Impacto técnico**: validações de motivo obrigatório, confirmação de reaprovação e revelação de destino dependem apenas do `page.test.tsx`. Não verifiquei quanto desses ramos o `page.test.tsx` exercita (cobertura por arquivo não foi medida).
- **Impacto de negócio**: o fluxo de decisão é o controle humano do pagamento. Um defeito de UI poderia enviar decisão sem motivo; o backend barra (`PayeeDecisionReasonRequiredError`), então o risco é de retrabalho e não de pagamento indevido.
- **Métrica de baseline**: 0 de 8 componentes com teste próprio; 2 de 9 métodos públicos sem `describe`.

### F-testability-5: Pisos de cobertura não protegem os arquivos novos de maior risco

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/jest.config.cjs:39-55`
- **Evidência (objetiva)**:
  ```
  pisos por arquivo existem para gracefulShutdown.ts e bootstrap.ts; nenhum para AuthorizedPayeeService/Rule/Repository
  ```
- **Impacto técnico**: só o piso de `./domain/service/` (88% linhas) cobre o serviço novo. `domain/libs` e `domain/repository` ficam no bucket global (72%/54%).
- **Impacto de negócio**: uma queda de cobertura no gate de autorização se perderia no bucket global.
- **Métrica de baseline**: 0 pisos dedicados; global 72% linhas.

## 5. Cards Kanban

### [testability-1] Injetar relógio e gerador de ID no módulo de favorecido autorizado

- **Problema**
  > `AuthorizedPayeeService` lê `new Date()` em 6 pontos e os repositórios chamam `randomUUID()`. A suíte não congela o tempo, então as datas de autorização, reconferência e `janelaInicio` não são verificadas com valor exato.

- **Melhoria Proposta**
  > Criar `ClockProvider` e `IdProvider` `@singleton() @injectable()` e injetá-los em `AuthorizedPayeeService` e `AuthorizedPayeeRepository`. Tactic: Limit Non-Determinism. Reescrever as asserções que usam `expect.any(Date)` para valores fixos, e cobrir o fallback da linha 541.

- **Resultado Esperado**
  > Leituras de relógio sem seam no módulo 6 → 0; testes com tempo fixo 0 → ≥ 6 (um por escrita de data); `randomUUID` direto 3 → 0 nos repositórios do favorecido.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Leituras de relógio sem seam: 6 → 0
  - Testes com data exata: 0 → ≥ 6
- **Risco de não fazer**: regressão silenciosa nas datas de auditoria da autorização.
- **Dependências**: nenhuma; reaproveitável por outros módulos do SISPAG.

### [testability-2] Adicionar testes de propriedade ao fingerprint, à regra e à máscara

- **Problema**
  > As funções puras que decidem se um destino está autorizado só têm exemplos fixos, e `fast-check` não é usado no delta.

- **Melhoria Proposta**
  > Escrever propriedades com `fast-check` para `PayeeFingerprint` (determinismo, sensibilidade a cada campo, invariância a formatação, separação por `keyId`), `AuthorizedPayeeRule` (transições inválidas sempre rejeitadas) e `MaskDestino` (nunca expõe o valor completo).

- **Resultado Esperado**
  > Propriedades no delta 0 → ≥ 6; cada uma com ≥ 100 execuções geradas.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Arquivos com `fast-check` no módulo: 0 → 3
- **Risco de não fazer**: colisão ou variação de fingerprint só aparece em produção.
- **Dependências**: nenhuma.

### [testability-3] Dividir os testes grandes do SISPAG e cobrir os componentes sem teste

- **Problema**
  > `RemessaService.test.ts` tem 2256 LOC e outros 4 arquivos passam de 500. Oito componentes da tela de favorecidos não têm teste próprio, e `listar`/`eventos` não têm `describe`.

- **Melhoria Proposta**
  > Extrair do `RemessaService.test.ts` um arquivo só para o gate de favorecido autorizado, com builders de fixture compartilhados. Adicionar testes de `DecidirAutorizacaoDialog`, `MotivoAutorizacaoDialog`, `RevelarDestinoButton` e `SolicitarAutorizacaoDialog`, e `describe` para `listar` e `eventos`.

- **Resultado Esperado**
  > Arquivos de teste acima de 500 LOC no SISPAG 5 → ≤ 3; componentes com teste próprio 0 de 8 → 4 de 8; métodos públicos com `describe` 7 de 9 → 9 de 9.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-3, F-testability-4
- **Métricas de sucesso**:
  - Maior arquivo de teste: 2256 → ≤ 1200 LOC
- **Risco de não fazer**: o custo de testar o SISPAG continua crescendo a cada feature.
- **Dependências**: nenhuma.

### [testability-4] Fixar pisos de cobertura por arquivo para o núcleo de autorização

- **Problema**
  > Só `./domain/service/` tem piso próprio. Regra, fingerprint e repositório do favorecido caem no piso global de 72% linhas.

- **Melhoria Proposta**
  > Medir a cobertura atual de `AuthorizedPayeeRule`, `PayeeFingerprint`, `AuthorizedPayeeRepository` e `AuthorizedPayeeService` com `--coverage` e registrar pisos por arquivo em `jest.config.cjs`, arredondados para baixo como já se faz para `bootstrap.ts`.

- **Resultado Esperado**
  > Pisos dedicados 0 → 4 arquivos; o CI passa a falhar se qualquer um cair abaixo do medido.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Pisos por arquivo no módulo: 0 → 4
- **Risco de não fazer**: queda de cobertura no gate de autorização passa despercebida.
- **Dependências**: rodar `--coverage` uma vez para obter os valores.

## 6. Notas do agente

- Escopo limitado ao delta. A cobertura por camada (métrica #1) não foi medida porque a instrução proíbe reexecutar as suítes; o `--coverage` completo é o passo seguinte do card testability-4.
- Os `Excecao*` e `Pendencia*` listados como sem teste foram removidos pelo delta junto com seus testes; não contam como dívida.
- Cross-QA: testability-1 toca Modifiability (relógio e ID injetáveis); a cobertura de transições do favorecido (solicitar, aprovar, rejeitar, revogar, reconferir) toca Fault Tolerance e Security; o `test:sql` no CI toca Deployability.
- Nenhum P0: não há defeito evidenciado por este delta que mande dinheiro a destino errado. O gate de remessa tem testes e erros tipados.
