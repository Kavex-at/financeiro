---
qa: Testability
qa_slug: testability
run_id: 2026-10-13-2014
agent: qa-testability
generated_at: 2026-10-13T20:40:00-03:00
scope: all
score: 7.5
findings_count: 6
cards_count: 6
---

# Testability — Regis-Review (delta `5a17d3e..HEAD`, sispag-dda-na-ingestao)

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / AutoLoopRunner | Mudança em `IngestaoPagamentosService.sincronizarDda`, no prazo de 60 s do `BoletoDdaService`, no UPSERT de `titulo_a_pagar` ou no limiar de defasagem da aba DDA | Serviços de ingestão/DDA, `TituloAPagarRepository`, `ddaDefasado.ts`, `jobs/ingest-pagamentos.ts` | Dev local e CI (`npm test`, sem Postgres nem Conexos) | Cada ramo novo (`sincronizado/parcial/ocupada/falhou`, prazo, COALESCE, trim, limiar) é forçado por teste determinístico; uma regressão de coluna/SQL falha antes do deploy | 100% dos ramos novos com teste que falha se o ramo for removido; 0 leituras de relógio não injetáveis na lógica de prazo; SQL de leitura/escrita validado contra o schema real |

## 2. Métricas observadas

| # | Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|---|
| 1 | **Cobertura por camada (arquivos do delta)** — service `IngestaoPagamentosService.ts` | lines 99,28% / branches 89,39% / funcs 100% | 80/70/80 | ✅ | `npx jest ... --coverage --collectCoverageFrom` (backend) |
| 1 | service `BoletoDdaService.ts` | lines 100% / branches 80% / funcs 100% | 80/70/80 | ✅ | idem |
| 1 | repository `TituloAPagarRepository.ts` | lines 92,59% / branches 78,84% / funcs 78,57% (não coberto: 184-190, 207-212, fora do delta) | 80/70/80 | ⚠️ funcs 78,57% | idem |
| 1 | client `ConexosSispagClient.ts` | lines 96,99% / branches 74,49% / funcs 93,65% | 80/70/80 | ✅ | idem |
| 1 | job `jobs/ingest-pagamentos.ts` (17 linhas novas) | **0%** — sem suíte de job | >0 (nunca 0) | ❌ | `ls src/backend/jobs/*.test.ts` (5 suítes, nenhuma para este job) |
| 1 | frontend `ddaDefasado.ts` | lines 100% / branches 92,3% (linha 26 = default `agora = new Date()`) | 80/70/80 | ✅ | `npx jest ddaDefasado BoletosDdaTab --coverage` (frontend) |
| 1 | frontend `BoletosDdaTab.tsx` | lines 87,5% / branches 76,47% | 80/70/80 | ✅ | idem |
| 2 | Suítes executadas do delta (backend) | 5 suítes / 106 testes passando | 100% verde | ✅ | `npx jest IngestaoPagamentosService BoletoDdaService TituloAPagarRepository ConexosSispagClient migrations/0083` |
| 3 | Suítes executadas do delta (frontend) | 2 suítes / 17 testes passando (`ddaDefasado`, `BoletosDdaTab`) | 100% verde | ✅ | idem |
| 4 | Testes novos no delta | backend +9 (4 ingestão, 3 DDA, 1 repo, 1 client) + 2 migration; frontend +7 (5 + 2) | ≥1 por ramo novo | ✅ | `git diff 5a17d3e HEAD -- '*.test.*'` |
| 5 | Testes de integração contra Postgres real para `titulo_a_pagar` | 0 (existem 3 `*.integration.test.ts` no repo, nenhum para este repositório; rodam só com `METRICAS_CICLO_TEST_DSN`) | ≥1 por repositório com UPSERT/COALESCE | ❌ | `grep -rl integration src/backend` |
| 6 | Leituras de relógio sem injeção na lógica nova | 1 (`Date.now()` x2 em `BoletoDdaService.ts:116,139`); `ddaDefasado` recebe `agora` (injetável) | 0 | ⚠️ | `git diff` |
| 7 | Casos do prazo estourado | 1 (todos adiados com `prazoMs: -1`); caso misto (alguns arquivos lidos, resto adiado) = 0 | ≥2 | ⚠️ | `BoletoDdaService.test.ts` |
| 8 | Ramos de `avisoDaRun`/`sincronizarDda` sem asserção | 4 (parcial por `falhas>0`; combinação falhas+DDA; truncamentos `slice(0,300)`/`slice(0,120)`; rejeição não-`Error`) | 0 | ⚠️ | `IngestaoPagamentosService.test.ts` |
| 9 | Guarda SELECT/INSERT ↔ `TituloRow` | 0 genérica; só `toContain('doc_esp_numero')` pontual | 1 (genérica ou integração) | ⚠️ | `TituloAPagarRepository.test.ts:140-142` |
| 10 | Gate de cobertura no CI | `coverageThreshold` presente em backend (global 72/54/78; `./domain/service/` 88/60) e frontend | presente | ✅ | `src/backend/jest.config.cjs:39` |

Não medível localmente: cobertura do frontend em escopo global (suíte `@radix-ui/react-dropdown-menu` ausente, ambiental, fora do delta — ver `_shared-metrics.md`).

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `sincronizar({prazoMs, releituraDias})` expõe parâmetros que deixam o teste forçar prazo e janela sem mexer em estado interno; `ddaDefasado(…, agora)` | ✅ presente | `BoletoDdaService.ts:90-100`, `ddaDefasado.ts:24-27` |
| Recordable Test Cases | `fin064Row({docEspNumero})` usa fixture de linha real; DDA mocka resposta do `fin124` por objeto literal, sem fixture gravada | ⚠️ parcial | `ConexosSispagClient.test.ts:65-80` |
| Sandbox | DB e Conexos totalmente mockados nos testes do delta; sem Postgres efêmero no `npm test` (só `test:sql` com DSN) | ⚠️ parcial | `AuthorizedPayeeRepository.integration.test.ts:15-21` |
| Executable Assertions | Falha do DDA vira `estado: falhou` + WARN + `error_message` na run (observável e assertável); `ddaDefasado` devolve `undefined` em vez de lançar | ✅ presente | `IngestaoPagamentosService.ts:196-222` |
| Abstract Data Sources | `BoletoDdaService` injetado por construtor na ingestão (`{sincronizar} as unknown as BoletoDdaService`); repositórios via `DatabaseClient` mockável | ✅ presente | `IngestaoPagamentosService.test.ts:112-118` |
| Limit Structural Complexity | `sincronizarDda`/`avisoDaRun` extraídos de `runIngestion` (complexidade 31→20 segundo `_shared-metrics`); porém a lógica de saída do job está dentro de `main()` sem seam | ⚠️ parcial | `jobs/ingest-pagamentos.ts:27-45` |
| Limit Non-Determinism | Relógio do prazo = `Date.now()` direto, não injetável; testes dependem de `prazoMs:-1` para contornar | ⚠️ parcial | `BoletoDdaService.ts:116,139` |

## 4. Findings

### F-testability-1: UPSERT/COALESCE e SELECT da coluna nova nunca executam contra Postgres

- **Severidade**: P2 (rebaixado de P1: baseline numérico é de testes, não de incidente em produção medido; a falha vira `numeroDocumento` indefinido, não perda financeira)
- **Tactic violada**: Sandbox
- **Localização**: `src/backend/domain/repository/sispag/TituloAPagarRepository.ts:91-134,159-168`; `TituloAPagarRepository.test.ts:69-81,122-142`
- **Evidência (objetiva)**:
  ```
  expect(sql).toMatch(/doc_esp_numero = COALESCE\(EXCLUDED\.doc_esp_numero, titulo_a_pagar\.doc_esp_numero\)/)
  expect(sql).toContain('doc_esp_numero')   // "a coluna da 0083 só serve se o SELECT a traz"
  ```
  O teste confere o TEXTO do SQL e devolve `rows` fabricadas; a semântica do COALESCE (preservar o último valor) nunca roda. A coluna foi esquecida no SELECT uma vez neste ciclo; a defesa adicionada é um `toContain` pontual, não uma guarda que cubra a próxima coluna (`TituloRow` tem 17 campos, mantidos à mão em 3 listas: INSERT, ON CONFLICT, SELECT).
- **Impacto técnico**: próxima coluna adicionada a `TituloRow` pode faltar no SELECT/INSERT sem teste vermelho; o regex passa mesmo que a ordem de colunas e a ordem de `tuples` divirja (INSERT com 19 posições, `$dn${i}` inserido entre `$fp` e `TRUE`).
- **Impacto de negócio**: coluna "número do documento" some silenciosamente da carteira SISPAG; analista não casa título com boleto DDA.
- **Métrica de baseline**: integração para `titulo_a_pagar` = 0 de 1 necessário; 3 arquivos `.integration.test.ts` existentes cobrem outros repositórios.

### F-testability-2: relógio do prazo de 60 s não é injetável; caso misto não testado

- **Severidade**: P2
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:116,139`; `BoletoDdaService.test.ts` (caso "prazo estourado")
- **Evidência (objetiva)**:
  ```
  const limite = input.prazoMs !== undefined ? Date.now() + input.prazoMs : undefined;
  ...
  if (limite !== undefined && Date.now() > limite) return null;
  // teste: sincronizar({ triggeredBy: 'teste', prazoMs: -1 })  -> TODOS adiados
  ```
  O teste usa prazo negativo, que só exerce o extremo "tudo adiado". O contrato de produção ("o que já está em voo termina; o que não começou fica para a próxima, novos primeiro") exige o caso em que o prazo vence NO MEIO — nunca exercido. Não há `jest.useFakeTimers`/`spyOn(Date,'now')`. `BoundedConcurrency` roda os arquivos em paralelo; a ordem arquivos novos > relidos só é defendida por `alvo` (fora do delta).
- **Impacto técnico**: regressão que inverta o `>` ou conte o adiado como falha em cenário misto passa nos 106 testes; branches de `BoletoDdaService` ficam em 80% (linhas 77-81,118,131,161).
- **Impacto de negócio**: pool DDA parado sem aviso (já aconteceu 08–13/10/2026, 5 dias) se o adiamento nunca for contado direito.
- **Métrica de baseline**: 1 caso de prazo (extremo) / 2 necessários; 2 `Date.now()` diretos.

### F-testability-3: saída do job `ingest-pagamentos.ts` sem nenhum teste

- **Severidade**: P2
- **Tactic violada**: Specialized Interfaces / Limit Structural Complexity
- **Localização**: `src/backend/jobs/ingest-pagamentos.ts:27-45`
- **Evidência (objetiva)**:
  ```
  ls src/backend/jobs/*.test.ts -> calcular-perfil-canal, jobsNaoLogamErroCru, SeedAdminConfig,
  sincronizar-lotes-sispag, validatePerfilUsuarioIsolation   (nenhum para ingest-pagamentos)
  ```
  17 linhas novas, 4 ramos (`result.dda` ausente, estados com/sem contadores, `::warning::` em `falhou|parcial`, `ocupada` sem aviso). As anotações `::warning::` do GitHub Actions são o único canal pelo qual o cron `ingest-sispag.yml` torna o pool defasado visível; um erro de digitação quebra o alarme sem teste vermelho.
- **Impacto técnico**: `main()` executa no import, sem seam; impossível assertar a saída sem subir o container.
- **Impacto de negócio**: o incidente que motivou a feature (pool 5 dias parado, ninguém viu) depende desta linha de log para ser percebido em CI.
- **Métrica de baseline**: cobertura do arquivo 0%; 0 testes para 4 ramos novos.

### F-testability-4: matriz de estados do DDA na ingestão incompleta

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/service/sispag/IngestaoPagamentosService.ts:203-222,268-290`; `IngestaoPagamentosService.test.ts:145-203`
- **Evidência (objetiva)**:
  ```
  const parcial = r.falhas > 0 || r.arquivosAdiados > 0;   // teste cobre só arquivosAdiados:12
  erro.slice(0, 300) / dda.erro.slice(0, 120)              // truncamentos sem asserção
  partes = [falhas, semFlagBoleto, ddaComAviso].filter(Boolean).join('; ')  // combinação nunca testada
  ```
  Casos presentes: sincronizado, falhou, ocupada, parcial (adiados). Ausentes: parcial por `falhas>0`; DDA `falhou` junto com filial não lida (aviso composto e `slice(0,500)` do `resumoFalhas`); rejeição com valor não-`Error` (`String(error)`); ordem DDA→`getFiliais` quando `getFiliais` lança depois do DDA (run `error`, mas WARN do DDA já emitido).
- **Impacto técnico**: ramos de `avisoDaRun` podem regredir sem teste vermelho; branches do arquivo 89,39%.
- **Impacto de negócio**: texto de `error_message` da run é o que o analista lê na aba de runs; aviso composto mal montado esconde a causa.
- **Métrica de baseline**: 4 ramos sem asserção; 4 de ~8 combinações de estado exercidas.

### F-testability-5: `releituraDias` tem teste, mas nenhum chamador de produção

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `BoletoDdaService.ts:99,114,126`
- **Evidência (objetiva)**: `grep -rn releituraDias src` → só definição, uso interno e teste; nenhum chamador (ingestão passa `prazoMs` apenas).
- **Impacto técnico**: parâmetro testado que não é exercido por nenhuma superfície; defende um caminho inalcançável (cobertura que parece defender invariante).
- **Impacto de negócio**: ruído de manutenção; baixa.
- **Métrica de baseline**: 1 parâmetro público, 0 chamadores, 1 teste.

### F-testability-6: teste do componente mocka a regra inteira; limiar fixa falso-positivo de segunda cedo

- **Severidade**: P3
- **Tactic violada**: Recordable Test Cases / Executable Assertions
- **Localização**: `BoletosDdaTab.test.tsx:24-26`, `ddaDefasado.test.ts:33-37`, `ddaDefasado.ts:28-35`
- **Evidência (objetiva)**:
  ```
  jest.mock('./ddaDefasado', () => ({ horasDdaDefasado: jest.fn() }))
  // ddaDefasado.test.ts: segunda 01:00 BRT com sync de 40 h atrás -> alerta (pinned)
  ```
  A regra e o componente são testados separadamente (bom), mas nenhum teste os junta. A regra só exclui sábado/domingo "de hoje", não horas úteis decorridas: último sync sexta 16h BRT + cron das 07h de segunda ⇒ ~63 h > 8 h, logo alerta toda segunda de madrugada até a ingestão rodar (o caso de teste fixa esse comportamento como correto).
- **Impacto técnico**: limiar tratado como contrato por um teste que pode estar codificando comportamento não-intencional.
- **Impacto de negócio**: alerta de fadiga na segunda cedo reduz a confiança no aviso que deveria sinalizar o incidente real.
- **Métrica de baseline**: 1 caso fixa o comportamento; 0 testes de integração componente+regra.

## 5. Cards Kanban

### [testability-1] Cobrir UPSERT/SELECT de `titulo_a_pagar` contra Postgres real

- **Problema**
  > O COALESCE de `doc_esp_numero` e o SELECT da coluna são validados por regex sobre o texto do SQL e por linhas fabricadas. A coluna já foi esquecida no SELECT uma vez neste ciclo; a defesa atual é um `toContain` pontual.

- **Melhoria Proposta**
  > Criar `TituloAPagarRepository.integration.test.ts` no padrão de `AuthorizedPayeeRepository.integration.test.ts` (roda em `test:sql` com `METRICAS_CICLO_TEST_DSN`): insere título com `numeroDocumento`, reinsere sem, lê via `listAtivos` e afirma que o valor foi preservado; mais um caso que insere todas as colunas de `TituloRow` e compara a ida e a volta. Alternativa barata: teste que deriva as colunas do `SELECT` e do `INSERT` e as confronta com as chaves de `TituloRow`.

- **Resultado Esperado**
  > Regressão de coluna/SQL falha no CI. Testes de integração em `titulo_a_pagar` 0 → 3 casos; guarda de paridade SELECT↔`TituloRow` 0 → 1.

- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - integração em `titulo_a_pagar`: 0 → 3 casos
  - guarda SELECT/INSERT ↔ `TituloRow`: 0 → 1
- **Risco de não fazer**: a próxima coluna esquecida só aparece como campo vazio em produção.
- **Dependências**: DSN de Postgres de teste já usado em `test:sql`.

### [testability-2] Tornar o relógio do prazo DDA injetável e testar o prazo no meio da passada

- **Problema**
  > `BoletoDdaService` lê `Date.now()` direto (2 sítios) e o único teste de prazo usa `prazoMs: -1`, exercendo só "tudo adiado". O caso real (prazo vence com N arquivos lidos) não existe.

- **Melhoria Proposta**
  > Injetar o relógio (reutilizar `calendar`/provider existente, ou `jest.spyOn(Date,'now')` mínimo) e adicionar casos: 2 de 5 arquivos lidos antes do prazo ⇒ `boletos` dos 2, `arquivosAdiados: 3`, `falhas: 0`; arquivo em voo no instante do prazo termina.

- **Resultado Esperado**
  > Casos de prazo 1 → 3; `Date.now()` não injetável na lógica de prazo 2 → 0; branches de `BoletoDdaService` 80% → ≥90%.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - casos de prazo: 1 → 3
  - sítios `Date.now()` diretos: 2 → 0
- **Risco de não fazer**: adiamento contado errado deixa o pool desatualizado sem alerta, como nos 5 dias de 08–13/10.
- **Dependências**: nenhuma.

### [testability-3] Extrair e testar a saída de `ingest-pagamentos.ts`

- **Problema**
  > As 17 linhas novas do job (resumo do pool e `::warning::`) têm 0% de cobertura e `main()` roda no import, sem seam. O `::warning::` é o canal do cron para o pool defasado.

- **Melhoria Proposta**
  > Extrair `formatarSaidaDda(dda)` para função/classe exportada (um módulo de apoio, não o job) devolvendo `{ log, warning? }`, e testar os 4 ramos: ausente, sincronizado, parcial/falhou com `::warning::`, ocupada sem warning.

- **Resultado Esperado**
  > Cobertura da saída do job 0% → 100%; ramos testados 0 → 4.

- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - cobertura da saída do job: 0% → 100%
  - ramos testados: 0 → 4
- **Risco de não fazer**: alarme de CI quebra por typo sem ninguém notar.
- **Dependências**: nenhuma.

### [testability-4] Completar a matriz de estados DDA em `IngestaoPagamentosService`

- **Problema**
  > Faltam asserções para parcial por `falhas>0`, aviso composto (DDA + filial não lida), truncamentos de erro (300/120) e rejeição não-`Error`.

- **Melhoria Proposta**
  > Quatro casos em `describe('pool DDA dentro da ingestão')`: `falhas: 2` ⇒ `parcial`; DDA `falhou` + `filiaisComFalha` ⇒ `error_message` contém ambas as partes separadas por `; `; erro de 500 chars ⇒ `dda.erro.length === 300` e trecho ≤120 na run; `mockRejectedValue('texto')` ⇒ `falhou` com `erro: 'texto'`.

- **Resultado Esperado**
  > Ramos sem asserção 4 → 0; branches de `IngestaoPagamentosService` 89,39% → ≥95%.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - ramos de `sincronizarDda`/`avisoDaRun` sem asserção: 4 → 0
  - branches do arquivo: 89,39% → ≥95%
- **Risco de não fazer**: o texto de `error_message` regride sem aviso.
- **Dependências**: nenhuma.

### [testability-5] Remover (ou ligar a um chamador) o parâmetro `releituraDias`

- **Problema**
  > O parâmetro e seu teste existem, mas nenhuma superfície o passa; o teste defende um caminho inalcançável.

- **Melhoria Proposta**
  > Remover o parâmetro e o teste, ou expô-lo ao job avulso (`--releitura-dias`) com teste do job.

- **Resultado Esperado**
  > Parâmetros públicos sem chamador 1 → 0.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - parâmetros sem chamador: 1 → 0
- **Risco de não fazer**: baixa; acúmulo de API sem uso.
- **Dependências**: nenhuma.

### [testability-6] Revisar o limiar de defasagem para horas úteis e juntar regra + componente em um teste

- **Problema**
  > Um teste fixa que segunda 01:00 BRT com sync de 40 h alerta, e o limiar de 8 h não desconta o fim de semana decorrido; o componente nunca é testado com a regra real.

- **Melhoria Proposta**
  > Decidir com o analista se segunda cedo deve alertar; se não, medir horas úteis (ou desconsiderar até o 1º cron do dia, 07h BRT) e ajustar o caso fixado. Adicionar 1 teste do `BoletosDdaTab` sem mock do módulo, com `jest.useFakeTimers().setSystemTime`.

- **Resultado Esperado**
  > Casos que fixam comportamento ambíguo 1 → 0; testes componente+regra reais 0 → 1.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-6
- **Métricas de sucesso**:
  - testes componente+regra sem mock: 0 → 1
- **Risco de não fazer**: fadiga de alerta na segunda de manhã.
- **Dependências**: confirmação de negócio sobre o horário esperado do 1º sync.

## 6. Notas do agente

- Escopo estrito ao delta; jest rodado para 5 suítes backend (106 testes) e 2 frontend (17 testes), todas verdes; cobertura medida só nos arquivos do delta.
- Pontos fortes: cobertura de ramos novos do serviço é alta, `agora` é parâmetro em `ddaDefasado` (determinístico), DI do `BoletoDdaService` por construtor; o COALESCE e o trim têm teste.
- Cross-QA: F-2 sobrepõe Modifiability (relógio injetável) e Availability/Fault Tolerance (prazo e estados DDA); F-1 sobrepõe Integrability (contrato SELECT↔tipo) e Deployability (gate `test:sql` não roda no CI padrão, não verificado aqui); F-3 sobrepõe Observability da run.
