---
qa: Testability
qa_slug: testability
run_id: 2026-10-14-2230
agent: qa-testability
generated_at: 2026-10-14T23:10:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 3
---

# Testability — Regis-Review (delta: vínculo de código de barras, I17a–l)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / AutoLoopRunner | Alterar a regra de elegibilidade ou a sequência validação→confirma→PUT→releitura do vínculo | `ElegibilidadeVinculoCodigoBarras`, `VinculoCodigoBarrasService`, `RemessaService` (etapa `vincular_codbar`), migration 0086 | Pré-merge, modo `on` escreve no ERP | Suíte falha em qualquer regressão de invariante que mova dinheiro (valor ≠ centavos, edição de terceiro sobrescrita, escrita em shadow/off) | 100% das invariantes I17a–l com asserção de resultado; 0 ramos de falha de escrita sem teste |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| 1. Cobertura por camada (delta) — `VinculoCodigoBarrasService.ts` | 93,75% stmts / 77,97% branch / 100% funcs / 94,85% lines | 80/70/80 | ✅ | `jest --coverage` nos 2 suites do vínculo |
| 1. Cobertura por camada (delta) — `ElegibilidadeVinculoCodigoBarras.ts` (domain/libs) | 97,61 / 96,66 / 100 / 98,55 | 80/70/80 | ✅ | idem |
| 1. Cobertura por camada (delta) — `ModoVinculoCodigoBarras.ts` | 88 / 84,21 / 100 / 100 | 80/70/80 | ✅ | idem |
| 1. Cobertura por camada (delta) — repository (`LotePagamentoRepository`, `SugestaoBoletoRepository`) | ⚠️ Não medido por arquivo; coberto por `VinculoCodigoBarras.repository.test.ts` (231 LOC) + integration (218 LOC, Postgres real) | 80/70/80 | ⚠️ | arquivos de teste |
| 1. Cobertura por camada (delta) — routes/lambda (`routes/sispag.ts`, +36 LOC) | +135 LOC de teste em `sispag.test.ts` | > 0 | ✅ | git diff |
| 1. Cobertura por camada (delta) — frontend (`vinculoCodigoBarras.ts`, `VinculoCodigoBarrasSelo`, LoteCard) | 7 casos em `vinculoCodigoBarras.test.ts` + 104 LOC em `LoteCard.test.tsx`; % não medido | > 0 | ✅ | arquivos de teste |
| Razão teste/fonte no delta (linhas) | ~2.940 LOC de teste backend (Service 818, Privacidade 496, Remessa +607, integração 275+218, repo 231, Elegibilidade 254…) vs ~1.700 de fonte de produção (excl. sonda) | ≥ 0,5 | ✅ | `git diff --stat` |
| Testes do `VinculoCodigoBarrasService` + Elegibilidade | 68 passando, 2 suites | verde | ✅ | jest |
| Testes de integração SQL (migration 0086 + repo) | 11 + 5 casos, Postgres real | ≥ 1 por repo com SQL complexo | ✅ | `0086_*.integration.test.ts`, `VinculoCodigoBarras.integration.test.ts` |
| Ramos de falha de escrita sem teste | 2 (validação recusada; validação transitória) | 0 | ❌ | linhas 471-478 do Service sem cobertura |
| Leituras de relógio / aleatoriedade em código novo | não encontradas no delta (data via `calendar.fromErpEpoch`, civil/UTC testado) | 0 | ✅ | ver teste "data civil" |
| Chamadas de rede reais em teste | 0 (client `write` mockado, `h.write.*`) | 0 | ✅ | leitura do Service.test |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `prever({registrar:false})` (dry-run), rota `GET vinculos-previstos`, `ConexosSispagWriteClient` injetado | ✅ presente | Service.test:713 |
| Recordable Test Cases | Achados HML V1–V9 em `_inbox`, sonda HML; fixtures de payload ERP gravadas não identificadas como arquivos | ⚠️ parcial | `probe-hml-vinculo-codbar-v1.ts` |
| Sandbox | `shadow` (zero chamadas ao client, grava `VINCULO_SIMULADO`), flag por filial fail-closed, kill-switch | ✅ presente | Service.test:700-733 |
| Executable Assertions | CHECKs da 0086 (máscara ≤ 9, tudo-ou-nada, origem), trilha só-inclusão, unique idempotente | ✅ presente | migration integration:134-261 |
| Abstract Data Sources | Client/repositórios por DI; `calendar` injetado | ✅ presente | Service.test harness `umItem` |
| Limit Structural Complexity | `ElegibilidadeVinculoCodigoBarras` é função pura sem I/O; Service tem 958 LOC | ⚠️ parcial | Service.ts |
| Limit Non-Determinism | Sem relógio/random novo; releitura decide, não o status do PUT | ✅ presente | Service.test:385-405 |

## 4. Findings

### F-testability-1: ramos de falha em `validacao` sem teste (recusa e transitória)

- **Severidade**: P2
- **Tactic violada**: Recordable Test Cases / Executable Assertions
- **Localização**: `src/backend/domain/service/sispag/VinculoCodigoBarrasService.ts:469-478`
- **Evidência (objetiva)**:
  ```
  catch (err) { if (this.ehRecusaDeNegocio(err)) { return this.falhar(... 'ERP_RECUSOU_VALIDACAO') }
                return abortar('VALIDACAO_TRANSITORIA', mascarado); }
  -> linhas 471-478 sem cobertura; nenhum teste faz validarCodigoBarras rejeitar
  ```
  Os testes só usam `validarCodigoBarras` com `mockResolvedValueOnce` de payload divergente (l.462). A matriz I17g tem teste para confirma transitório, PUT recusado, PUT transitório e leitura, mas não para validação.
- **Impacto técnico**: uma regressão que troque recusa (retira) por transitória (aborta), ou vice-versa, passa verde. Efeito: lote preso para sempre (retoma eternamente) ou item retirado por falha passageira. Não há escrita indevida (fail-closed), por isso não é P0.
- **Impacto de negócio**: título sai do lote sem motivo ou lote não gera remessa; trabalho do analista.
- **Métrica de baseline**: 2 ramos de 4 etapas de falha (validação/confirma/PUT/releitura) sem teste; branch do Service 77,97%.

### F-testability-2: empate "prefere decisão humana" testado só no RemessaService, com mock da guarda

- **Severidade**: P3
- **Tactic violada**: Abstract Data Sources (mock oculta o comportamento)
- **Localização**: `RemessaService.test.ts:3488-3500`, `:264`
- **Evidência (objetiva)**: o teste afirma que `preferidos` chega à guarda (`Set(['2:801:1'])`); o desempate real fica na guarda I16, onde `AnaliseCodigoBarrasRepetido.test.ts` ganhou 45 LOC. A junção service→guarda real não tem teste ponta a ponta.
- **Impacto técnico**: contrato entre `preferidos` e a análise pode divergir (formato da chave) sem teste vermelho.
- **Impacto de negócio**: baixo; no pior caso retira o título errado do par repetido, que o analista vê.
- **Métrica de baseline**: 0 testes que juntam `vincular_codbar` real + guarda real.

### F-testability-3: sem fixtures gravadas das respostas do ERP para os três endpoints novos

- **Severidade**: P3
- **Tactic violada**: Recordable Test Cases
- **Localização**: `Fin015Write.ts`, `probe-hml-vinculo-codbar-v1.ts`
- **Evidência (objetiva)**: payloads de `validacao`/`confirma`/`PUT` são construídos à mão no harness (`umItem`); achados V1–V9 só em markdown. V6 e V-PRD1/V-PRD2 abertos, PRD nunca exercitado.
- **Impacto técnico**: o mock pode divergir do ERP real (já ocorreu: V3 sem lock, V4 modalidade 7).
- **Impacto de negócio**: o `on` em produção depende de validação manual.
- **Métrica de baseline**: 0 fixtures de resposta real; 0 testes de contrato.

### F-testability-4: tarefas sem RED isolado — verificação

- **Severidade**: P3 (informativa)
- **Tactic violada**: n/a
- **Localização**: ver Notas
- **Evidência (objetiva)**: as invariantes que a equipe citou estão fixadas por asserção de resultado no estado atual: centavos (Elegibilidade 50-76), Δ −1/0/5/6 (`it.each` l.85), ATENCAO/VENCIDO/SEM_RELACAO (l.153), órfã (l.137), DV geral e de campo (181/190), arrecadação (201), modalidade 7 em validação+confirma+item (Service 319), terceiro não sobrescrito (367, 515, 527), shadow zero chamadas (700), off (720), kill-switch (728), idempotência (500), etapa nunca no ledger (Remessa 3322), migration 0086 (11 casos + CHECK), privacidade transversal (496 LOC). Não há ponto cego de invariante que mova dinheiro. A ausência de RED isolado é de processo, não de cobertura.
- **Impacto técnico**: sem RED registrado, só mutação provaria que os testes detectam a regressão.
- **Impacto de negócio**: nenhum direto.
- **Métrica de baseline**: mutation score não medido.

## 5. Cards Kanban

### [testability-1] Cobrir recusa e falha transitória em `validarCodigoBarras`

- **Problema**
  > `VinculoCodigoBarrasService.ts:469-478` (recusa de negócio → retira; transitória → aborta) não tem teste. A matriz I17g cobre as outras três etapas de falha.
- **Melhoria Proposta**
  > Dois casos no `describe('matriz de falha')`: `write.validarCodigoBarras` rejeita com `rejeicao()` ⇒ `retirar` com `ERP_RECUSOU_VALIDACAO`, evento `VINCULO_FALHOU`, nenhum `confirmaCodigoBarras`/PUT; rejeita com `transitorio()` ⇒ `VinculoCodigoBarrasIncompletoError`, nada retirado.
- **Resultado Esperado**
  > Branch do Service 77,97% → ≥ 82%; ramos de falha de escrita sem teste 2 → 0.
- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Linhas 471-478 cobertas: 0 → 8
  - Etapas de falha com teste: 2/4 → 4/4
- **Risco de não fazer**: regressão na classificação recusa×transitória entra sem sinal, vira lote preso ou item retirado indevidamente.
- **Dependências**: nenhuma.

### [testability-2] Teste de junção `vincular_codbar` real + guarda I16 real no desempate

- **Problema**
  > O desempate "prefere decisão humana" só é provado com a guarda mockada (`RemessaService.test.ts:264`).
- **Melhoria Proposta**
  > Um caso em `RemessaService.test.ts` (ou suíte `test:sql`) com `AnaliseCodigoBarrasRepetido` real e `preferidos` vindo do Service real; afirmar qual título fica e qual é retirado com `VINCULO_CODIGO_BARRAS_FALHOU`/guarda.
- **Resultado Esperado**
  > Testes que ligam as duas etapas reais: 0 → 2.
- **Tactic alvo**: Abstract Data Sources
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Casos de junção: 0 → 2
- **Risco de não fazer**: mudança no formato da chave `filCod:docCod:...` quebra o desempate sem teste vermelho.
- **Dependências**: nenhuma.

### [testability-3] Gravar fixtures das respostas HML dos 3 endpoints e usá-las como contrato

- **Problema**
  > Mocks são montados à mão; achados V1–V9 vivem só em markdown; V4 mostrou que o ERP surpreende.
- **Melhoria Proposta**
  > Fazer a sonda HML emitir os payloads (códigos mascarados) em `__fixtures__/` e alimentar o harness `umItem` com eles; teste de contrato que falha se a forma mudar. Opcional: rodar mutação (Stryker) em `ElegibilidadeVinculoCodigoBarras` e no Service.
- **Resultado Esperado**
  > Fixtures reais por endpoint: 0 → 3; mutation score medido (hoje não medido) ≥ 80% nos dois arquivos.
- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-3, F-testability-4
- **Métricas de sucesso**:
  - Fixtures de resposta ERP: 0 → 3
  - Mutation score: não medido → ≥ 80%
- **Risco de não fazer**: o `on` em PRD (V-PRD1/V-PRD2) segue dependendo de validação manual e de mocks que podem divergir do ERP.
- **Dependências**: V6 e V-PRD1/V-PRD2 resolvidos para os casos de PRD.

## 6. Notas do agente

- Escopo: só delta. Cobertura rodada em 2 suites (68 testes verdes); suíte completa e `test:sql` não reexecutados (baselines do AutoLoopRunner aceitos).
- Nenhum P0: toda invariante que move dinheiro tem asserção de resultado. Sobrescrita de terceiro, shadow, off, kill-switch e releitura-decide são provados com `not.toHaveBeenCalled` e asserção de estado.
- Cross-QA: shadow/kill-switch/off → Deployability; ramos de falha e retomada → Fault Tolerance; fixtures → Integrability; teste de privacidade (496 LOC) → Security.
- Não verificado: teste de render do `VinculoCodigoBarrasSelo` isolado (só a função pura e o LoteCard); cobertura frontend em % não rodada.
