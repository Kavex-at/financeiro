---
qa: Testability
qa_slug: testability
run_id: 2026-10-27-1803-sispag-vinculo-data-divergente
agent: qa-testability
generated_at: 2026-10-27T18:03:00-03:00
scope: backend+frontend (delta only — git diff origin/main...HEAD, base dc4d2b9d, head 532dd766)
score: 8
findings_count: 5
cards_count: 5
---

# Testability — Regis-Review (delta ADR-0078, v0.76.0)

> Escopo reduzido: apenas o delta da feature `sispag-vinculo-data-divergente` (phase 1 — reconhecimento tipado da divergência de data, `prazoBoleto`, fator-de-vencimento, migration 0091, regras I15r/I17p/I17q). Phase 2 (binding real sob flag `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`) está fora do `src/` e, por diretiva, não é apontada aqui como gap.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista financeiro | Mudança de regra de reconhecimento (I15r equivalência de visto; I17p prazo bancário; I17q sétimo dígito do fator) | `BoletoSuggestionService`, `ConferenciaReconhecimento`, `PrazoBoletoCalculador`, `FatorVencimentoBoleto`, `PrazoFinalBoleto`, `SugestaoBoletoRepository`, UI `ReconhecerDivergenciaDialog`+`FaixaBloqueadosHoje` | Dev local + CI (jest colocado); HML probes não executados | Suite verde em < 30 s, cada regra ADR-0078 com asserção numérica dedicada, determinismo de relógio garantido via injeção | 100% das regras I15r/I17p/I17q com teste nominal; 0 leituras de `Date.now()/new Date()` sem injeção em código de domínio novo; 0 testes acessando rede/DB real |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos tocados no delta com teste associado (src) | 42 testes para 76 arquivos tocados (0.55) | ≥ 0.5 | ✅ | `_shared-metrics.md` |
| Suites backend / FE verdes após rebase | 312 / 123 | 100% verde | ✅ | gate-run 2026-10-27 em `_shared-metrics.md` |
| Testes backend / FE verdes | 6140 / 1383 | — | ✅ | idem |
| Cobertura por regra ADR-0078 (I15r, I17p, I17q, I19t) | 4/4 com teste nominal | 4/4 | ✅ | `ReconhecimentoDivergencia.test.ts`, `PrazoFinalBoleto.test.ts`, `FatorVencimentoBoleto.test.ts`, `PrazoBoletoCalculador.test.ts` |
| Determinismo de relógio em novos services | `BankingCalendar` injetado em `DebitDateService:40`; `hoje` como parâmetro em `PrazoBoletoCalculador.paraTitulo`; `FatorVencimentoBoleto` prova "não consulta o relógio" (teste explícito `FatorVencimentoBoleto.test.ts:48-56`) | 0 `Date.now()`/`new Date()` crus em domínio novo | ✅ | `grep -n "new Date\|Date.now" src/backend/domain/service/sispag/{PrazoBoletoCalculador,DebitDateService}.ts src/backend/domain/libs/boleto/*.ts` → só uso para parse ISO fail-closed |
| Interação com grouped-boleto (EM_GRUPO) coberta | 2 descrições dedicadas em `MotorSugestaoBoleto.test.ts:968` e `BoletoSuggestionService.test.ts:1758,1773` (listagem + confirmar 409) | ≥ 1 teste de confirmar e 1 de listar | ✅ | greps acima |
| Migration 0091 asserida (aditividade, CHECKs, tudo-ou-nada) | 10 asserções em `0091_sispag_reconhecimento_divergencia.test.ts` + 1 em `rollbacks.test.ts` | ≥ aditividade + CHECKs | ✅ | leitura do arquivo |
| Repositório `SugestaoBoletoRepository.inserirDecisao` com reconhecimento tipado | Teste parametrizado (hora do servidor, SQL parametrizado, round-trip da decisão) `SugestaoBoletoRepository.test.ts:298-347` | 1 teste de persistência + 1 de retrocompat | ✅ | idem |
| `AjusteCentavosExecucaoRepository`: nova decisão herda reconhecimento | Caso `L116` ("decisão nova HERDA o reconhecimento (I15r/I18j)") | ≥ 1 | ✅ | `AjusteCentavosExecucaoRepository.test.ts:116` |
| Serviço `ConferenciaReconhecimento.ts` (93 linhas, 1 ponto de uso) com teste unitário direto | 0 (coberto apenas indireto via `BoletoSuggestionService.test.ts` — 7+ casos) | ≥ 1 unit direto para a mesa de verdade (tipo, Δ=NaN, motivo 10/500, ator "sistema") | ⚠️ | `grep -r ConferenciaReconhecimento src/backend` → só o próprio service + o chamador + o teste do chamador |
| Testes `.test.tsx` para novos componentes FE | `SugestaoBoletoPainel.desfecho.test.tsx` cobre `ReconhecerDivergenciaDialog` em 3 descrições (A/B/C, L198-283); `TitulosAbaSituacao.test.tsx` referencia `prazoBoleto`; `FaixaBloqueadosHoje.tsx` (90 linhas de delta) e `VencimentoCelula.tsx` (22 linhas de delta) sem teste direto nem referência em teste de pai | ≥ 1 teste direto ou indireto por componente novo | ⚠️ | `grep -rln "FaixaBloqueadosHoje\|VencimentoCelula" src/frontend --include="*.test.*"` → vazio |
| Roteiro manual de QA executado (`ontology/_inbox/sispag-vinculo-data-divergente-roteiro-qa.md`) | 0 execuções registradas | ≥ V-HML1 (phase 1 ack) executado antes de PRD | ❌ | `_shared-metrics.md` ("Not run: manual QA script") |
| HML probe de rolagem no sábado (I17p, feriado-colado-com-fim-de-semana) | Caso unitário cobre domingo-finados → segunda `PrazoFinalBoleto.test.ts:21`; sábado colado com feriado útil não exercitado em HML real | ≥ 1 probe HML em ambiente real | ⚠️ (não medível localmente) | `_shared-metrics.md` ("Saturday-rollover HML probe") |

> ⚠️ **Não medível localmente**: cobertura por linhas/branches do delta (não rodada por diretiva `--quick`). As métricas acima são contagens e correspondências regra↔teste, suficientes para a decisão de gate.

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Specialized Interfaces** | `DebitDateService` recebe `BankingCalendar` injetado; `PrazoBoletoCalculador.paraTitulo({ hoje })` recebe o dia como parâmetro em vez de ler relógio; `RegraSugestaoBoleto.avaliar` é função pura; `ReconhecimentoDivergencia.valido` é estático e sem efeito colateral | ✅ | `DebitDateService.ts:40,66`; `PrazoBoletoCalculador.test.ts:60`; `ReconhecimentoDivergencia.ts:28` |
| **Recordable Test Cases** | `hmlDataDivergenteCasos.ts` cataloga casos canônicos (V10/L-J/L-R2/L-ROLAGEM) consumidos pelos probes HML e pelo teste unitário (`hmlDataDivergenteCasos.test.ts`); `PrazoBoletoCalculador.test.ts` enumera "casos canônicos 15–20" com fixtures determinísticos | ✅ | `hmlDataDivergenteCasos.test.ts:9`; `PrazoBoletoCalculador.test.ts:65` |
| **Sandbox** | Repositórios testados com mock `db` injetado por construtor (padrão do repo); migration 0091 asserida no texto SQL (não roda contra Postgres sob Jest, por decisão arquitetural herdada 0084–0089) | ✅ | `SugestaoBoletoRepository.test.ts:298`; cabeçalho de `0091_sispag_reconhecimento_divergencia.test.ts` |
| **Executable Assertions** | Migration 0091 define 4 CHECKs (`reconhecimento_tudo_ou_nada_check`, `tipo IN ('DATA_DIVERGENTE')`, motivo 10–500 chars, reconhecedor ≠ 'sistema'); runtime: `ReconhecimentoDivergencia.valido` fail-closed em NaN | ✅ | `migrations/0091_sispag_reconhecimento_divergencia.sql`; `ReconhecimentoDivergencia.test.ts:46` |
| **Abstract Data Sources** | Mocks de repositório injetados no `BoletoSuggestionService.test.ts` por construtor (padrão `new Service(mockRepo as any)` do CLAUDE.md); `BankingCalendar.withClock()` abstrai relógio nas probes | ✅ | `BankingCalendar.withClock(() => new Date('2026-10-26T15:00:00Z'))` em `hmlDataDivergenteCasos.test.ts:5` |
| **Limit Structural Complexity** | Nova lib `boleto/` divide `FatorVencimentoBoleto` (62 LOC), `PrazoFinalBoleto` (31 LOC), `ReconhecimentoDivergencia` (28 LOC); `PrazoBoletoCalculador` isolado em serviço próprio com 91 LOC + 265 LOC de teste (ratio saudável) | ✅ | contagem `wc -l` nos arquivos citados |
| **Limit Non-Determinism** | Teste explícito "não consulta o relógio" em `FatorVencimentoBoleto.test.ts:48-56` (muta `jest.useFakeTimers().setSystemTime(2099)` e exige o mesmo output); `PrazoBoletoCalculador` injeta `hoje`; `DebitDateService` injeta `BankingCalendar` | ✅ | citado |

Nenhuma tactic é N/A no delta.

## 4. Findings

### F-testability-1: `ConferenciaReconhecimento` (93 LOC, mesa-de-verdade da regra I15r) sem teste unitário direto

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity (teste do serviço no ponto onde ele existe)
- **Localização**: `src/backend/domain/service/sispag/ConferenciaReconhecimento.ts` (93 linhas, criado neste delta)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "ConferenciaReconhecimento" src/backend --include="*.ts"
  src/backend/domain/service/sispag/BoletoSuggestionService.ts:68:import ConferenciaReconhecimento …
  src/backend/domain/service/sispag/BoletoSuggestionService.ts:325:        const tipado = ConferenciaReconhecimento.conferir({ … });
  src/backend/domain/service/sispag/ConferenciaReconhecimento.ts:37:export default class …
  ```
  Nenhum `ConferenciaReconhecimento.test.ts`.
- **Impacto técnico**: a tabela da regra (tipo DATA_DIVERGENTE, Δ visto vs atual, valor visto, motivo 10–500, ator ≠ 'sistema', timestamp) hoje só vem a verde via o service de alto nível; qualquer refactor de `BoletoSuggestionService` que delegue a conferência noutra ordem apaga toda a cobertura da regra sem a suite acusar.
- **Impacto de negócio**: regra ADR-0078 é o gating para pagamento com data divergente; perder a asserção direta aumenta o risco de regressão silenciosa (ex.: aceitar motivo com 9 chars) chegar em PRD.
- **Métrica de baseline**: 7 casos indiretos em `BoletoSuggestionService.test.ts` (L1555–1699); 0 casos diretos em `ConferenciaReconhecimento.test.ts`.

### F-testability-2: Componentes FE `FaixaBloqueadosHoje` e `VencimentoCelula` sem teste direto nem referência em teste de pai

- **Severidade**: P2
- **Tactic violada**: Observe System State (asserção sobre o que o usuário vê)
- **Localização**: `src/frontend/app/sispag/situacao/FaixaBloqueadosHoje.tsx` (+90 LOC no delta); `src/frontend/app/sispag/situacao/VencimentoCelula.tsx` (+22 LOC no delta)
- **Evidência (objetiva)**:
  ```
  $ grep -rln "FaixaBloqueadosHoje\|VencimentoCelula" src/frontend --include="*.test.*"
  (vazio)
  ```
  Em contraste, `ReconhecerDivergenciaDialog.tsx` é coberto indiretamente em `SugestaoBoletoPainel.desfecho.test.tsx:198-283`.
- **Impacto técnico**: `FaixaBloqueadosHoje` é o aviso visual do título bloqueado hoje por data divergente — comportamento regra-dependente. Sem teste, um `className`/condição a mais apaga a faixa sem CI avisar.
- **Impacto de negócio**: a UI é o único feedback do analista sobre o estado "exige reconhecimento". Degradação silenciosa = título não reconhecido vai para remessa com defeito (phase 2 futuro).
- **Métrica de baseline**: 0 testes referenciam esses dois componentes; `TitulosAbaSituacao.test.tsx:391` só nomeia `prazoBoleto` como prop.

### F-testability-3: Roteiro de QA manual (`sispag-vinculo-data-divergente-roteiro-qa.md`) não executado antes do merge/release 0.76.0

- **Severidade**: P1
- **Tactic violada**: Executable Assertions (o roteiro é a asserção human-in-the-loop para o caminho integrado)
- **Localização**: `ontology/_inbox/sispag-vinculo-data-divergente-roteiro-qa.md`
- **Evidência (objetiva)**:
  ```
  _shared-metrics.md:
  Not run: manual QA script (ontology/_inbox/sispag-vinculo-data-divergente-roteiro-qa.md);
          Saturday-rollover HML probe.
  ```
  Commit `532dd766 chore(release): v0.76.0` fez bump sem registro de execução.
- **Impacto técnico**: toda cadeia confirmar→gravar→listar foi exercitada só em mock; o round-trip real com o DB Supabase e com o `SugestaoBoletoRepository` sob Postgres (CHECKs 0091 ativos) nunca foi observado.
- **Impacto de negócio**: a release 0.76.0 defende um invariante que a suite não exercita no banco. Se o CHECK `reconhecimento_tudo_ou_nada_check` tiver uma coluna fora, o primeiro reconhecimento em HML quebra, não um teste.
- **Métrica de baseline**: 0 execuções do roteiro; 1 release já emitida (`v0.76.0`).

### F-testability-4: Probe HML de rolagem no sábado não executada; teste unitário cobre apenas domingo-feriado

- **Severidade**: P2
- **Tactic violada**: Recordable Test Cases (o caso canônico "sábado + feriado útil adjacente" nunca é gravado)
- **Localização**: `src/backend/jobs/probe-hml-vinculo-data-divergente-rem.ts` (468 LOC); `src/backend/domain/libs/boleto/PrazoFinalBoleto.test.ts`
- **Evidência (objetiva)**:
  ```
  PrazoFinalBoleto.test.ts cobre:
    - segunda/sexta → identidade
    - sábado/domingo → segunda
    - feriado nacional segunda (12/10) → terça
    - domingo-finados (02/11) → segunda
  Não cobre: sábado isolado adjacente a feriado útil anterior (ex.: cenário V11 do roteiro).
  ```
- **Impacto técnico**: a regra I17p é testada em 4 pontos canônicos; o caso de borda do roteiro HML (sábado após feriado-útil) permanece em probe desligado.
- **Impacto de negócio**: baixo em phase 1 (sem gravação), importante para habilitar phase 2 — sem o probe, o ganho de confiança para abrir o flag é empírico-zero.
- **Métrica de baseline**: 1 probe disponível, 0 execuções registradas; 4 casos no teste unitário vs ≥ 6 no roteiro.

### F-testability-5: Decodificação do fator de vencimento sem property-based testing apesar de `fast-check` disponível

- **Severidade**: P3
- **Tactic violada**: Limit Non-Determinism (o espaço de entrada é inteiro 0..9999 × data de referência — ideal para shrinking)
- **Localização**: `src/backend/domain/libs/boleto/FatorVencimentoBoleto.test.ts` (56 LOC, 8 casos de exemplo)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "fast-check\|fc\." src/backend/domain/libs/boleto --include="*.test.ts"
  (vazio)
  ```
  `fast-check` já é dependência do repo.
- **Impacto técnico**: a regra "decodificar(fator, ref) é determinística e idempotente" é afirmada por amostra; uma inversão de sinal no cálculo de ciclo poderia passar.
- **Impacto de negócio**: baixo — a regra tem incidente histórico só em transição de ciclo (22/02/2025); hoje coberta por exemplo direto.
- **Métrica de baseline**: 0 propriedades automatizadas vs 8 casos exemplares.

## 5. Cards Kanban

### [testability-1] Criar teste unitário direto para `ConferenciaReconhecimento`

- **Problema**
  > A regra I15r (tabela-de-verdade do reconhecimento tipado) hoje é afirmada só via `BoletoSuggestionService.test.ts`. Qualquer refactor do service que redirecione a chamada apaga toda a cobertura da regra sem CI reclamar. `ConferenciaReconhecimento.ts` tem 93 LOC e 1 chamador — perfil clássico de serviço sem teste direto.

- **Melhoria Proposta**
  > Criar `src/backend/domain/service/sispag/ConferenciaReconhecimento.test.ts` cobrindo: tipo exigido vs faltante, Δ visto == Δ atual (válido), Δ diverge por 1 dia, valor diverge por 1 centavo, motivo 9 chars (reject) / 10 (accept) / 500 (accept) / 501 (reject), ator 'sistema' (reject), reconhecimento sem exigência (inócuo). Tactic alvo: **Limit Structural Complexity** — teste no ponto da verdade.

- **Resultado Esperado**
  > Testes diretos de `ConferenciaReconhecimento`: 0 → ≥ 8 casos. Regra I15r coberta nominalmente no arquivo da própria regra, não só no chamador.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Testes diretos em `ConferenciaReconhecimento.test.ts`: 0 → ≥ 8
  - Mapa `_index.json` referencia 1→1 regra I15r a arquivo de teste homônimo
- **Risco de não fazer**: regressão silenciosa na checagem de motivo/ator chega em PRD junto com phase 2 (quando a gravação for executada).
- **Dependências**: nenhuma

### [testability-2] Adicionar testes para `FaixaBloqueadosHoje` e `VencimentoCelula`

- **Problema**
  > Dois componentes alterados neste delta (+90 e +22 LOC) não aparecem em nenhum `.test.tsx`. `FaixaBloqueadosHoje` é o aviso visual de "título com data divergente bloqueado hoje" — comportamento que depende diretamente de I15r/I17p e muda com a prop `prazoBoleto`.

- **Melhoria Proposta**
  > Criar `FaixaBloqueadosHoje.test.tsx` (render com 0, 1 e N títulos bloqueados; esconder quando lista vazia; mostrar contador) e `VencimentoCelula.test.tsx` (origem `BOLETO_SUGERIDO` vs `TITULO` vs `TITULO_FALLBACK`; marcador "perdido"). Tactic alvo: **Observe System State** no boundary da UI. Usar Testing Library (jest-environment-jsdom já configurado).

- **Resultado Esperado**
  > Cobertura dos dois componentes: 0 testes → ≥ 6 (3 por componente).

- **Tactic alvo**: Observe System State
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - `grep -l "FaixaBloqueadosHoje\|VencimentoCelula" src/frontend --include="*.test.*"`: 0 → 2
- **Risco de não fazer**: o único canal de feedback visual do estado "exige reconhecimento" degrada sem aviso.
- **Dependências**: nenhuma

### [testability-3] Executar roteiro manual HML antes de habilitar phase 2 em PRD

- **Problema**
  > `ontology/_inbox/sispag-vinculo-data-divergente-roteiro-qa.md` nunca foi executado; v0.76.0 saiu com a cadeia confirmar→gravar→listar observada apenas em mocks. Os CHECKs da migration 0091 (`reconhecimento_tudo_ou_nada_check`, enum do tipo, faixa do motivo, ator ≠ 'sistema') nunca foram vistos sob dados reais.

- **Melhoria Proposta**
  > Rodar o roteiro em HML (V10 completo + V-HML1 ack phase 1), colar o resultado em `ontology/_inbox/sispag-vinculo-data-divergente-roteiro-qa.md` (seção "Execução — <data>"), e só então abrir `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS` em PRD. Tactic alvo: **Executable Assertions** (o roteiro é o único check-list human-in-the-loop vs o banco real).

- **Resultado Esperado**
  > Execuções registradas do roteiro: 0 → 1 (V-HML1 completo com evidências).

- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (meia-tarde do analista + um worker acompanhando)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Execuções do roteiro registradas: 0 → ≥ 1
  - CHECKs 0091 observados sob dados reais: 0 → 4
- **Risco de não fazer**: o primeiro reconhecimento em PRD é a primeira execução integrada da regra; se o CHECK estiver mal escrito, o erro aparece como `postgres error 23514` para o analista.
- **Dependências**: HML com migration 0091 aplicada (gate independente deste card).

### [testability-4] Rodar probe HML de rolagem no sábado e armar o caso canônico

- **Problema**
  > `PrazoFinalBoleto.test.ts` cobre segunda/sexta identidade, sábado/domingo→segunda, feriado-nacional-segunda e domingo-finados; o caso "sábado isolado adjacente a feriado útil anterior" fica só na probe HML — que não rodou. Phase 2 abre a gravação sob flag; sem a probe, a decisão de habilitar fica empírica-zero.

- **Melhoria Proposta**
  > Executar `probe-hml-vinculo-data-divergente-rem.ts` no HML em um sábado real adjacente a feriado útil anterior; registrar o par (`barraVenc`, `prazoEfetivo`) e promover o par para `PrazoFinalBoleto.test.ts` como caso nominal "sábado após feriado útil → próxima segunda". Tactic alvo: **Recordable Test Cases**.

- **Resultado Esperado**
  > Casos no teste unitário: 4 → ≥ 5; probe registrada em `_shared-metrics.md` próximo ciclo.

- **Tactic alvo**: Recordable Test Cases
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Casos em `PrazoFinalBoleto.test.ts`: 4 → ≥ 5
  - Execuções da probe sábado: 0 → ≥ 1
- **Risco de não fazer**: phase 2 abre em feriado colado com sábado e desconta um dia útil silenciosamente da ponta do prazo.
- **Dependências**: HML calendário com um sábado após feriado útil disponível na janela.

### [testability-5] Property-based test da decodificação do fator de vencimento

- **Problema**
  > `FatorVencimentoBoleto.decodificar` tem 8 casos exemplares; o espaço real é 0000..9999 × 1997..2049. A regra "é idempotente e não lê relógio" é afirmada por 1 teste de muting `useFakeTimers`. `fast-check` já é dependência e é usado em outros cantos.

- **Melhoria Proposta**
  > Adicionar `fc.property(fc.integer({min:0,max:9999}), ..., (f,ref) => decodificar(f,ref)===decodificar(f,ref))` em `FatorVencimentoBoleto.test.ts`, além de uma propriedade "para todo fator válido, `addDays(1997-10-07, fator) === vencimento` dentro do ciclo escolhido". Tactic alvo: **Limit Non-Determinism**.

- **Resultado Esperado**
  > Propriedades no fator de vencimento: 0 → ≥ 2; cobertura efetiva do domínio sobe de 8 casos para 10⁴.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Propriedades fast-check em `FatorVencimentoBoleto.test.ts`: 0 → ≥ 2
- **Risco de não fazer**: baixo; inversão de ciclo passa até alguém se queixar no dia do reinício.
- **Dependências**: nenhuma

## 6. Notas do agente

- Delta mostra higiene de testabilidade acima da média: 42 arquivos de teste para 76 tocados, cada regra ADR-0078 (I15r/I17p/I17q/I19t) com teste nominal, determinismo de relógio explicitamente provado em `FatorVencimentoBoleto.test.ts:48-56`. Nenhum achado P0.
- Cross-QA: F-testability-3 (roteiro HML não executado) dialoga com **Fault-Tolerance** (CHECKs 0091 só verificados contra texto SQL) e com **Deployability** (release 0.76.0 saiu antes do gate human-in-the-loop). F-testability-4 (probe sábado) dialoga com **Availability** do calendário bancário.
- Métrica de cobertura por linhas/branches do delta não rodada por diretiva `--quick`; contagens regra↔teste bastam para a decisão.
