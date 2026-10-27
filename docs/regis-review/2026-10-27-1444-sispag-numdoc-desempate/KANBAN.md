---
type: regis-review-kanban
run_id: 2026-10-27-1444-sispag-numdoc-desempate
scope_mode: reduced (approved by Yuri on 2026-10-27)
total: 10
counts: { p0: 0, p1: 0, p2: 5, p3: 5 }
---

# Kanban — financeiro — 2026-10-27-1444-sispag-numdoc-desempate

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3.
> **Escopo reduzido** aprovado por Yuri em 2026-10-27 (Modifiability, Performance, Testability apenas).

---

## P0 — Crítico

_Nenhum._

## P1 — Alto

_Nenhum._

## P2 — Médio

### [modifiability-2] Declarar janela temporal / projeção em `listNumerosDocumento`

**QA**: Modifiability
**Tactic alvo**: Encapsulate
**Esforço**: S
**Findings**: F-modifiability-2 (cross-link F-performance-1)

**Problema**
> A nova query de guarda de duplicata faz full-scan de `titulo_a_pagar` sem `ativo`, sem `LIMIT` e sem janela temporal. Carrega todo o histórico do credor na memória do motor a cada ciclo, e a intenção ("quanto para trás precisa ver") não está no código.

**Melhoria Proposta**
> Parametrizar a janela (ex.: últimos 24 meses, ou por `pes_cod` requisitado pelo pendente) e tornar explícita a projeção; alternativamente, materializar como view indexada por `(pes_cod, doc_esp_numero_normalizado)`. Tactic: **Encapsulate** + **Defer Binding** (limites por configuração). Cross-link: Performance.

**Resultado Esperado**
> Query custo O(n_credores_pendentes × janela) em vez de O(histórico_total). Latência estável conforme a tabela cresce. (full-scan → scan limitado)

**Métricas de sucesso**
- Linhas lidas por `sugerirAgora`: full → janela declarada
- Latência de `sugerirAgora` com 10× histórico atual: medir baseline

**Risco de não fazer**
> A sugestão degrada silenciosamente com o tempo; ninguém saberá por que o motor ficou lento em 6 meses.

**Dependências**: alinhar janela com o produto; verificar se a watchlist já tem decisão.

---

### [performance-1] Introduzir LIMIT defensivo + telemetria em `listNumerosDocumento`

**QA**: Performance
**Tactic alvo**: Bound Execution Times / Reduce Overhead
**Esforço**: S
**Findings**: F-performance-1

**Problema**
> `listNumerosDocumento` faz full-scan de `titulo_a_pagar` sem LIMIT, sem recorte temporal (por desenho da ADR-0079 D6) e sem telemetria. Em 12–24 meses o custo deixa de ser desprezível, e hoje não há sinal para detectar isso.

**Melhoria Proposta**
> Adicionar `logService.info` com `duracaoMs` e `rows` em volta da chamada (reutilizar padrão do `calcularCenario`). Avaliar com DBA a criação de índice parcial `(pes_cod, doc_esp_numero) WHERE pes_cod IS NOT NULL AND doc_esp_numero IS NOT NULL AND doc_esp_numero <> ''`. Opcional: `LIMIT 100000` com `warn` se atingido (circuit-break antes de OOM).

**Resultado Esperado**
> p95 da query observável; alerta antes de passar de 1s. Baseline (hoje) → alvo: p95 ≤ 300ms em 24m, mesmo com crescimento 5× da tabela.

**Métricas de sucesso**
- Duração observável no log estruturado: ausente → p95 em dashboard
- Linhas retornadas: ~13k → telemetrizado, teto definido

**Risco de não fazer**
> Degradação invisível por 1–2 anos; incidente de latência quando passar o joelho da curva.

**Dependências**: nenhuma

---

### [performance-2] Reaproveitar cenário em cache em `confirmar` / `desfechosAgora` ou reduzir a leitura

**QA**: Performance
**Tactic alvo**: Maintain Multiple Copies of Computations
**Esforço**: S–M
**Findings**: F-performance-2

**Problema**
> `confirmar` e `desfechosAgora` chamam `sugerirAgora()` direto, bypass do `SugestaoBoletoCache`. Cada ação do analista dispara 9 queries paralelas, incluindo o novo scan de números. Em formação automática em lote, isso vira N × 9.

**Melhoria Proposta**
> Avaliar se `confirmar` pode consumir o cenário em cache (há TOCTOU explicado por `reler()` na l.260 — a releitura do próprio título já cuida da parte crítica). Alternativa: variante `sugerirAgoraSemAncoraNumero` para o caminho `confirmar`, já que a confirmação só precisa de `pares`/`datasDebito` + avaliação direta.

**Resultado Esperado**
> Latência da ação `confirmar` deixa de crescer com |titulo_a_pagar|. Alvo: p95 `confirmar` sem relação com tamanho da tabela de títulos (hoje: cresce linearmente).

**Métricas de sucesso**
- Queries por confirmação: 9 → ≤ 4
- p95 `confirmar` sob lote de 50 confirmações: baseline a medir → sem crescimento linear

**Risco de não fazer**
> Formação automática do SISPAG sofre degradação proporcional ao crescimento da carteira; vira P1 em HML quando lotes de 100+ forem exercitados.

**Dependências**: performance-1 (telemetria para medir)

---

### [modifiability-1] Separar camada 0 do `MotorSugestaoBoleto` em um colaborador de âncoras

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: M
**Findings**: F-modifiability-1 (cross-link F-testability-2)

**Problema**
> O motor cresceu de 1023 para 1148 LOC absorvendo a âncora I15s. Camada 0 agora tem `escolhasPorAncora`, `reservarPorAncora`, `ancorarPorNumero` e `indiceNumeros` convivendo com o loop quente, as camadas 1-4 e o cálculo de desfecho. Uma próxima âncora empurra o módulo para fora de qualquer limite razoável de leitura.

**Melhoria Proposta**
> Extrair as rotinas de camada 0 para um colaborador (`AncoragemCamadaZero` ou similar) injetado via tsyringe. Motor consome a interface `{ escolher, reservar, ancorarPorNumero }`; `AncoraOrdemDps` e nova âncora de número viram implementações registradas. Tactic: **Split Module** + **Abstract Common Services**.

**Resultado Esperado**
> Motor volta para a faixa de 700-800 LOC. Próxima âncora acrescenta um arquivo novo, não LOC no concentrador. (1148 → ≤ 800 LOC no Motor)

**Métricas de sucesso**
- LOC `MotorSugestaoBoleto.ts`: 1148 → ≤ 800
- Nº de responsabilidades distintas em `analisar()`: 4 → 2 (camadas e desfecho)

**Risco de não fazer**
> Cada nova âncora (ex.: código de barras parcial, DACTE) acumula no mesmo módulo e torna o custo de revisão/testabilidade exponencial.

**Dependências**: nenhuma; pode ser feito após merge deste PR.

---

### [testability-1] Quebrar `MotorSugestaoBoleto` em módulos por âncora

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: M
**Findings**: F-testability-2 (cross-link F-modifiability-1)

**Problema**
> O motor tem 1148 LOC e já foi dividido em 3 arquivos de teste (`.test`, `.dps.test`, `.numero.test`). Cada âncora nova (I15p DPS, I15s número) vai somando. O custo de leitura cresce linearmente para o PatternGuardian e para o próximo autor.

**Melhoria Proposta**
> Extrair cada âncora (`AncoraOrdemDps` já existe; criar `AncoraNumeroConfiavel`) para um colaborador injetado, mantendo o motor como orquestrador de camada 0. Tactic: Limit Structural Complexity.

**Resultado Esperado**
> `MotorSugestaoBoleto.ts` 1148 LOC → ≤ 800 LOC; nova âncora passa a nascer num arquivo próprio ≤ 250 LOC.

**Métricas de sucesso**
- LOC do motor 1148 → ≤ 800
- Arquivos de teste por âncora: ≤ 1 novo por regra

**Risco de não fazer**
> Próxima âncora (watchlist cita "aprender por credor") inflá-lo para > 1300 LOC.

**Dependências**: nenhuma (refactor isolado; cross-QA com Modifiability — mesmo card que modifiability-1).

---

## P3 — Baixo

### [modifiability-3] Externalizar `NUMERO_CONFIAVEL_MIN_DIGITOS` quando houver segundo cliente/filial

**QA**: Modifiability
**Tactic alvo**: Defer Binding
**Esforço**: S
**Findings**: F-modifiability-3

**Problema**
> O limiar de dígitos vive hardcoded em `RegraSugestaoBoleto.ts`. Mesmo documentado e justificado por medição em PRD, qualquer retuning exige deploy. Para a Columbia hoje basta; para o segundo cliente (SaaSo-alvo) é fricção.

**Melhoria Proposta**
> Mover para `EnvironmentProvider` (`SISPAG_NUMERO_CONFIAVEL_MIN_DIGITOS`) com default 4. Tactic: **Defer Binding** (configuration externalization).

**Resultado Esperado**
> Retuning por SSM, sem código. (1 magic number em serviço → 0)

**Métricas de sucesso**
- Magic numbers em `domain/service/sispag`: baseline — 1

**Risco de não fazer**
> Baixo; vira P2 só se um segundo cliente entrar com padrão de numeração diferente.

**Dependências**: necessidade concreta de segundo tenant.

---

### [performance-3] Deduplicar fonte do `indiceNumeros.documentos`

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: S (≤ 1h)
**Findings**: F-performance-3

**Problema**
> O índice de documentos itera `[...entrada.titulos, ...entrada.titulosDoCredor]`, mas `titulosDoCredor` já é superconjunto. Trabalho duplicado barato, porém elimina-se com uma linha.

**Melhoria Proposta**
> Quando `titulosDoCredor` presente, iterar só sobre ele; cair para `titulos` apenas no caminho legado (`numeroAncoraDesligada`/entrada antiga).

**Resultado Esperado**
> Iterações do loop em `indiceNumeros`: (T + T') → T'. Memória de pico transiente reduzida ~proporcional a |carteira ativa|.

**Métricas de sucesso**
- Nº de pushes no `Set` por execução: T + T' → T'

**Risco de não fazer**
> Nenhum operacional; só higiene.

**Dependências**: nenhuma

---

### [testability-2] Property-based em `normalizarNumero` e detector de duplicata

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-3

**Problema**
> A normalização é hoje a única barreira de entrada entre strings cruas do ERP (`doc_esp_numero` arbitrário) e o critério de identidade. 4 asserções pontuais não cobrem combinações improváveis (letras + separadores + zeros intercalados).

**Melhoria Proposta**
> Adicionar `fc.property` em `RegraSugestaoBoleto.test.ts` que gere strings alfanuméricas e verifique idempotência (`norm(norm(x)) === norm(x)`) e invariante "≥ 4 dígitos ⇒ aceita como âncora". Tactic: Executable Assertions.

**Resultado Esperado**
> Property tests em `normalizarNumero` 0 → ≥ 2; `fast-check` passa a ser usado em código do SISPAG (hoje 0 usos neste domínio).

**Métricas de sucesso**
- ≥ 2 propriedades verdes
- Shrinker não encontra contra-exemplo em 1000 runs

**Risco de não fazer**
> Credor com numeração exótica cria falso NUMERO_CONFIAVEL.

**Dependências**: nenhuma

---

### [testability-3] Teste nomeando o cluster TIME LOG (risco residual aceito)

**QA**: Testability
**Tactic alvo**: Recordable Test Cases
**Esforço**: S
**Findings**: F-testability-4

**Problema**
> O ADR-0079 aceita o cluster TIME LOG (4 falsos sobre 79 vínculos, efeito financeiro nulo), mas não há teste que ancore essa aceitação. Qualquer refactor que mude silenciosamente o comportamento passa.

**Melhoria Proposta**
> Codificar 1 caso em `MotorSugestaoBoleto.numero.test.ts` com dois boletos de mesmo valor, dia e emissor e número igual ao do título: a âncora escolhe um; o teste documenta a aceitação ("efeito financeiro nulo"). Tactic: Recordable Test Cases.

**Resultado Esperado**
> Testes nomeando o cluster TIME LOG 0 → 1.

**Métricas de sucesso**
- 1 teste verde fixando o comportamento aceito pelo ADR

**Risco de não fazer**
> Regressão silenciosa invisível ao PatternGuardian.

**Dependências**: nenhuma

---

### [modifiability-4] Isolar o fetch do motor em `BoletoSuggestionService` em um Query Service

**QA**: Modifiability
**Tactic alvo**: Increase Semantic Coherence
**Esforço**: M
**Findings**: F-modifiability-4

**Problema**
> `BoletoSuggestionService` já tem 1161 LOC; `sugerirAgora` agora orquestra 8 fontes de dados em `Promise.all` incluindo fail-closed para âncora de número. Qualquer nova fonte toca o mesmo lugar.

**Melhoria Proposta**
> Extrair o fetch para um colaborador `MotorInputProvider` que concentra as 8 chamadas e retorna `EntradaMotorSugestao` pronta (incluindo o fail-closed de cada uma). Tactic: **Increase Semantic Coherence** + **Abstract Common Services**.

**Resultado Esperado**
> `BoletoSuggestionService` perde o conhecimento de cada repositório; adicionar uma 9ª fonte é 1 arquivo novo, não 10 LOC no service. (1161 → ≤ 900 LOC)

**Métricas de sucesso**
- LOC `BoletoSuggestionService.ts`: 1161 → ≤ 900
- Nº de repositórios conhecidos diretamente: baseline a medir

**Risco de não fazer**
> Cresce proporcional à evolução do motor; não é bloqueante.

**Dependências**: idealmente alinhado com o card modifiability-1.
