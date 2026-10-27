---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-27-1444-sispag-numdoc-desempate
agent: qa-modifiability
generated_at: 2026-10-27T14:44:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 4
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Produto/Operação SISPAG | Nova âncora de identidade I15s (número confiável) somada à âncora I15p (DPS) existente, generalizando camada 0 para "âncoras fortes" | `MotorSugestaoBoleto`, `RegraSugestaoBoleto`, `BoletoSuggestionService`, `TituloAPagarRepository`, interface `SugestaoBoleto`, frontend label | Delta de rebaixamento assistido; green gates (283 suites BE, 114 FE) | Introduzir a âncora sem redesenhar as camadas, com fail-closed e um novo sinal `NUMERO_CONFIAVEL` encapsulado em `SINAIS_ANCORA` | Toque localizado em 6 arquivos de código + 1 interface; 125 LOC somadas ao Motor; 0 violação de camada; 0 novo erro de lint; abstração `ancoraForte` unificando DPS e número |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos de produção tocados pelo delta | 6 (Motor, Regra, Service, Repo, interface, FE) | ≤ 10 | ✅ | `git diff main --stat` |
| LOC adicionadas / removidas (delta total) | +387 / −55 | — | ✅ | `git diff main --stat` |
| LOC `MotorSugestaoBoleto.ts` (antes → depois) | 1023 → 1148 (+125) | ≤ 600 (alvo Split Module); pré-existente | ⚠️ | `_shared-metrics.md` |
| LOC `BoletoSuggestionService.ts` | 1161 | ≤ 600 | ⚠️ (pré-existente) | `_shared-metrics.md` |
| Camadas tocadas | Lambda(FE)/Service/Repository/Interface | ≤ 4 | ✅ | diff |
| Novos sinais no DSL `SINAL_SUGESTAO` | +1 (`NUMERO_CONFIAVEL`), com entrada em `SINAIS_ANCORA` e `TEXTO_SINAL` do FE | — | ✅ | `SugestaoBoleto.ts`, `sugestaoBoleto.ts` |
| Pontos de magic number introduzidos em serviços | 1 (`NUMERO_CONFIAVEL_MIN_DIGITOS = 4`) exportado e documentado | 0 cru; constantes nomeadas aceitas | ✅ | `RegraSugestaoBoleto.ts` |
| Fan-out do Motor (imports após delta) | +1 (`TituloNumeroDocumento`, `NUMERO_CONFIAVEL_MIN_DIGITOS`) | ≤ 15 | ✅ | diff |
| Violação de camada introduzida (Lambda↔Service↔Repository↔Client) | 0 | 0 | ✅ | diff |
| Cobertura de ontologia da regra I15s | ADR-0079 + `business-rules/sugestao-boleto-dda-sispag.md` atualizados; `_index.json`/`_coverage.json` bumpados | — | ✅ | git status |
| Repositório full-scan sem filtro `ativo` | 1 novo (`listNumerosDocumento`) | encapsulado; nota cross-QA | ⚠️ | `TituloAPagarRepository.ts:235` |

> ⚠️ **Não medível localmente**: fan-in de `MotorSugestaoBoleto`/`BoletoSuggestionService` fora deste delta — fora do escopo "feature-scoped".

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Motor passa de 1023 para 1148 LOC; nova responsabilidade (`ancorarPorNumero`, `indiceNumeros`) acumulada no mesmo módulo | ⚠️ parcial (pré-existente) | `MotorSugestaoBoleto.ts:808-878` |
| Increase Semantic Coherence | Abstração `ancoraForte()` unifica DPS (I15p) e número (I15s) em uma única camada 0; `escolhasPorDps` renomeado para `escolhasPorAncora`; constante `SINAIS_ANCORA` concentra o DSL | ✅ presente | `MotorSugestaoBoleto.ts:154-168`, `507-569` |
| Encapsulate | Novo sinal, nova guarda e novos índices expostos só pela interface `EntradaMotorSugestao`; motor segue sem conhecer SQL | ✅ presente | `SugestaoBoleto.ts:83-108`, `MotorSugestaoBoleto.ts:293` |
| Use an Intermediary | `BoletoSuggestionService.numerosOuDesligado()` isola falha de leitura do repositório do motor via fail-closed | ✅ presente | `BoletoSuggestionService.ts:905-920` |
| Restrict Dependencies | Motor continua dependendo apenas de `RegraSugestaoBoleto`, calendar, libs/boleto; sem acoplamento a client/repo | ✅ presente | diff Motor |
| Refactor | Rename coerente (`porDps` → `ancoraForte`, `reservarPorDps` → `reservarPorAncora`, `escolhasPorDps` → `escolhasPorAncora`); comparador atualizado em um ponto | ✅ presente | `MotorSugestaoBoleto.ts:752,891,893` |
| Abstract Common Services | `ancoraForte` virou o único predicado de camada 0; `ancoradoPorDps`/`ancoradoPorNumero` permanecem como auxiliares com responsabilidades disjuntas | ✅ presente | `MotorSugestaoBoleto.ts:163-168` |
| Defer Binding | Kill-switch `numeroAncoraDesligada` + `NUMERO_CONFIAVEL_MIN_DIGITOS` como constante exportada e documentada permitem desligar ou retunar a âncora sem redeploy de código estrutural (ainda é constante, não runtime config) | ✅ presente (parcial em runtime config) | `MotorSugestaoBoleto.ts:50-56`, `RegraSugestaoBoleto.ts:42-48` |

## 4. Findings (achados)

### F-modifiability-1: Motor cresce +125 LOC e passa de 1023 para 1148 LOC

- **Severidade**: P2 (débito defensável, pré-existente ampliado pelo delta)
- **Tactic violada**: Split Module
- **Localização**: `src/backend/domain/service/sispag/MotorSugestaoBoleto.ts` (1148 LOC)
- **Evidência**:
  ```
  1148 src/backend/domain/service/sispag/MotorSugestaoBoleto.ts  (main: 1023)
  Novas responsabilidades no mesmo módulo:
    - ancorarPorNumero (816-849)
    - indiceNumeros (856-878)
    - escolhasPorAncora com detector de conflito (513-569)
    - reservarPorAncora propagando `conflitos` (908-932)
  ```
- **Impacto técnico**: o módulo que já é o maior do SISPAG continua absorvendo políticas de identidade; cada nova âncora (I15t? I15u?) empurra o mesmo arquivo acima de 1200 LOC e torna a leitura de bugs de ordenação mais cara.
- **Impacto de negócio**: cada ajuste nas âncoras passa pelo mesmo módulo-concentrador; o custo marginal de uma próxima camada 0 cresce mais rápido que o valor que entrega.
- **Métrica de baseline**: 1148 LOC vs. alvo p95 ≤ 400.

### F-modifiability-2: `TituloAPagarRepository.listNumerosDocumento` faz full-scan sem filtro `ativo` e sem paginação

- **Severidade**: P2 (modifiability + cross-link performance/deployability)
- **Tactic violada**: Encapsulate (fronteira do repositório correta) + ausência de Defer Binding em limites de leitura
- **Localização**: `src/backend/domain/repository/sispag/TituloAPagarRepository.ts:235-258`
- **Evidência**:
  ```sql
  SELECT fil_cod, doc_cod, tit_cod, pes_cod, doc_esp_numero
  FROM titulo_a_pagar
  WHERE pes_cod IS NOT NULL AND doc_esp_numero IS NOT NULL AND doc_esp_numero <> ''
  ```
  Sem `ativo`, sem `LIMIT`, sem janela temporal; mapeado para `TituloNumeroDocumento[]` carregado inteiro em memória do motor a cada `sugerirAgora`.
- **Impacto técnico**: cada mudança de schema em `titulo_a_pagar` ou crescimento da tabela histórica ripple-ia na latência do motor; se a tabela crescer N×, o Motor passa a varrer N× por chamada. A guarda está correta funcionalmente, mas o custo é opaco.
- **Impacto de negócio**: a sugestão fica lenta à medida que o histórico cresce; sem janela temporal declarada, qualquer refactor futuro (p.ex. mover para view materializada) precisa reler intenção.
- **Métrica de baseline**: 1 query full-scan por `sugerirAgora`; alvo: janela temporal explícita ou projeção por credor.

### F-modifiability-3: Constante de ajuste `NUMERO_CONFIAVEL_MIN_DIGITOS = 4` acoplada ao código

- **Severidade**: P3
- **Tactic violada**: Defer Binding (configuração externalizada)
- **Localização**: `src/backend/domain/service/sispag/RegraSugestaoBoleto.ts:42-48`
- **Evidência**:
  ```ts
  export const NUMERO_CONFIAVEL_MIN_DIGITOS = 4;
  ```
  Documentado via comentário citando medição PRD (15/15), mas qualquer ajuste exige redeploy.
- **Impacto técnico**: se o número precisar virar 3 ou 5 em um cliente específico (ex: filial que numera com 3 dígitos), a mudança não é desligável/retunável por SSM.
- **Impacto de negócio**: cada retuning ocupa um ciclo `/feature-tweak` em vez de um ajuste operacional. Baixo custo hoje (watchlist já cobre).
- **Métrica de baseline**: 1 magic number em serviço; alvo: parametrizável por `EnvironmentProvider` ou SSM se necessidade concreta aparecer.

### F-modifiability-4: `BoletoSuggestionService.ts` segue com 1161 LOC absorvendo novo passo `numerosOuDesligado`

- **Severidade**: P3 (débito pré-existente, delta minúsculo)
- **Tactic violada**: Split Module / Increase Semantic Coherence
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts` (+34/-8 LOC no delta)
- **Evidência**: `sugerirAgora` concentra 8 fontes de dados em `Promise.all` + o novo tratamento fail-closed; o service já era o maior do SISPAG antes do delta.
- **Impacto técnico**: cada nova fonte de dados do motor passa pelo mesmo método — risco de merge/conflito e dificuldade crescente de teste unitário.
- **Impacto de negócio**: baixo hoje; vira P2 se mais uma fonte de dados do motor for adicionada.
- **Métrica de baseline**: 1161 LOC vs. alvo ≤ 600.

## 5. Cards Kanban

### [modifiability-1] Separar camada 0 do `MotorSugestaoBoleto` em um colaborador de âncoras

- **Problema**
  > O motor cresceu de 1023 para 1148 LOC absorvendo a âncora I15s. Camada 0 agora tem `escolhasPorAncora`, `reservarPorAncora`, `ancorarPorNumero` e `indiceNumeros` convivendo com o loop quente, as camadas 1-4 e o cálculo de desfecho. Uma próxima âncora empurra o módulo para fora de qualquer limite razoável de leitura.
- **Melhoria Proposta**
  > Extrair as rotinas de camada 0 para um colaborador (`AncoragemCamadaZero` ou similar) injetado via tsyringe. Motor consome a interface `{ escolher, reservar, ancorarPorNumero }`; `AncoraOrdemDps` e nova âncora de número viram implementações registradas. Tactic: **Split Module** + **Abstract Common Services**.
- **Resultado Esperado**
  > Motor volta para a faixa de 700-800 LOC. Próxima âncora acrescenta um arquivo novo, não LOC no concentrador. (1148 → ≤ 800 LOC no Motor)
- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - LOC `MotorSugestaoBoleto.ts`: 1148 → ≤ 800
  - Nº de responsabilidades distintas em `analisar()`: 4 → 2 (camadas e desfecho)
- **Risco de não fazer**: cada nova âncora (ex.: código de barras parcial, DACTE) acumula no mesmo módulo e torna o custo de revisão/testabilidade exponencial.
- **Dependências**: nenhuma; pode ser feito após merge deste PR.

### [modifiability-2] Declarar janela temporal / projeção em `listNumerosDocumento`

- **Problema**
  > A nova query de guarda de duplicata faz full-scan de `titulo_a_pagar` sem `ativo`, sem `LIMIT` e sem janela temporal. Carrega todo o histórico do credor na memória do motor a cada ciclo, e a intenção ("quanto para trás precisa ver") não está no código.
- **Melhoria Proposta**
  > Parametrizar a janela (ex.: últimos 24 meses, ou por `pes_cod` requisitado pelo pendente) e tornar explícita a projeção; alternativamente, materializar como view indexada por `(pes_cod, doc_esp_numero_normalizado)`. Tactic: **Encapsulate** + **Defer Binding** (limites por configuração). Cross-link: Performance.
- **Resultado Esperado**
  > Query custo O(n_credores_pendentes × janela) em vez de O(histórico_total). Latência estável conforme a tabela cresce. (full-scan → scan limitado)
- **Tactic alvo**: Encapsulate
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Linhas lidas por `sugerirAgora`: full → janela declarada
  - Latência de `sugerirAgora` com 10× histórico atual: medir baseline
- **Risco de não fazer**: a sugestão degrada silenciosamente com o tempo; ninguém saberá por que o motor ficou lento em 6 meses.
- **Dependências**: alinhar janela com o produto; verificar se a watchlist já tem decisão.

### [modifiability-3] Externalizar `NUMERO_CONFIAVEL_MIN_DIGITOS` quando houver segundo cliente/filial

- **Problema**
  > O limiar de dígitos vive hardcoded em `RegraSugestaoBoleto.ts`. Mesmo documentado e justificado por medição em PRD, qualquer retuning exige deploy. Para a Columbia hoje basta; para o segundo cliente (SaaSo-alvo) é fricção.
- **Melhoria Proposta**
  > Mover para `EnvironmentProvider` (`SISPAG_NUMERO_CONFIAVEL_MIN_DIGITOS`) com default 4. Tactic: **Defer Binding** (configuration externalization).
- **Resultado Esperado**
  > Retuning por SSM, sem código. (1 magic number em serviço → 0)
- **Tactic alvo**: Defer Binding
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Magic numbers em `domain/service/sispag`: baseline — 1
- **Risco de não fazer**: baixo; vira P2 só se um segundo cliente entrar com padrão de numeração diferente.
- **Dependências**: necessidade concreta de segundo tenant.

### [modifiability-4] Isolar o fetch do motor em `BoletoSuggestionService` em um Query Service

- **Problema**
  > `BoletoSuggestionService` já tem 1161 LOC; `sugerirAgora` agora orquestra 8 fontes de dados em `Promise.all` incluindo fail-closed para âncora de número. Qualquer nova fonte toca o mesmo lugar.
- **Melhoria Proposta**
  > Extrair o fetch para um colaborador `MotorInputProvider` que concentra as 8 chamadas e retorna `EntradaMotorSugestao` pronta (incluindo o fail-closed de cada uma). Tactic: **Increase Semantic Coherence** + **Abstract Common Services**.
- **Resultado Esperado**
  > `BoletoSuggestionService` perde o conhecimento de cada repositório; adicionar uma 9ª fonte é 1 arquivo novo, não 10 LOC no service. (1161 → ≤ 900 LOC)
- **Tactic alvo**: Increase Semantic Coherence
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - LOC `BoletoSuggestionService.ts`: 1161 → ≤ 900
  - Nº de repositórios conhecidos diretamente: baseline a medir
- **Risco de não fazer**: cresce proporcional à evolução do motor; não é bloqueante.
- **Dependências**: idealmente alinhado com o card modifiability-1.

## 6. Notas do agente

- Delta está arquiteturalmente limpo: Encapsulate + Semantic Coherence bem aplicados (abstração `ancoraForte`, SINAIS_ANCORA concentrada, DSL de sinal estendido coerentemente FE+BE). Nenhum defeito introduzido pelo delta justifica P0.
- Cross-QA: **F-modifiability-2** (full-scan sem janela) é também achado de **Performance** (custo cresce com histórico) e **Deployability** (sem knob para desligar). **F-modifiability-1 / F-modifiability-4** amplificam **Testability** — o teste de `MotorSugestaoBoleto` já é o maior arquivo de teste do SISPAG (878 LOC em main, 1041 somando `.numero.test.ts`); split do produção vai aliviar o split do teste. **F-modifiability-3** overlap com **Deployability** (config não externalizada = redeploy a cada retuning).
- Boa prática deste delta a destacar na consolidação: o kill-switch `numeroAncoraDesligada` com fail-closed modela Defer Binding sem gold-plating, e deve ser padrão para próximas âncoras.
