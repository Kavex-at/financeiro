# Regis-Review follow-ups — sispag-numdoc-desempate (ADR-0079)

**Feature:** desempate SISPAG por âncora de número de documento (I15s), somada à âncora I15p (DPS) existente. Nova regra I15s abstraída em `ancoraForte`, novo sinal `NUMERO_CONFIAVEL`, nova guarda de duplicata em `listNumerosDocumento`, fail-closed via kill-switch `numeroAncoraDesligada`.
**Run:** `docs/regis-review/2026-10-27-1444-sispag-numdoc-desempate/` (REPORT.md + KANBAN.md).
**Escopo do run:** reduzido (Modifiability + Performance + Testability apenas), aprovado por Yuri em 2026-10-27. Availability, Deployability, Integrability, Fault Tolerance e Security **não executadas** (`não executado (escopo reduzido aprovado)`).
**Gates no fechamento:** backend typecheck/lint/tests verdes (283 suites / 5313 tests, lint 0 errors / 112 warnings = main); frontend typecheck/lint/tests verdes (114 suites / 1260 tests, lint 0 errors / 20 warnings = main).

> **P0 remediados EM-LOOP:** nenhum. O run não encontrou nenhum P0 nem P1; o delta é arquiteturalmente limpo (Encapsulate + Semantic Coherence bem aplicados, cobertura 10/10 das cláusulas D1–D10 do ADR-0079, fail-closed via kill-switch). Toda a dívida identificada é P2/P3 e vai para follow-up (abaixo).

---

## Regis-Review P2 (não implementados aqui — backlog)

- **F-modifiability-2 + F-performance-1 + F-performance-2 (cross-QA — mesma causa-raiz)** —
  `TituloAPagarRepository.listNumerosDocumento` faz full-scan de `titulo_a_pagar` sem `ativo`, sem `LIMIT`,
  sem recorte temporal (ADR-0079 D6 justifica a ausência de corte). Hoje ~13k linhas; cresce sem retenção.
  Pior: `BoletoSuggestionService.confirmar` (l.277) e `desfechosAgora` (l.883) chamam `sugerirAgora()`
  direto, bypass do `SugestaoBoletoCache`, então cada ação do analista = 9 queries paralelas incluindo esta.
  Resolver em dois passos:
  - **(a)** `performance-1` — telemetria `logService.info({ duracaoMs, rows })` + índice parcial Postgres
    `(pes_cod, doc_esp_numero) WHERE pes_cod IS NOT NULL AND doc_esp_numero IS NOT NULL AND doc_esp_numero <> ''`
    + opcional `LIMIT 100000` com `warn` (circuit-break). Esforço S. Tactic: **Bound Execution Times / Reduce Overhead**.
  - **(b)** `modifiability-2` — declarar janela temporal/projeção explícita, ou materializar como view
    indexada por `(pes_cod, doc_esp_numero_normalizado)`. Esforço S. Tactic: **Encapsulate** + **Defer Binding**.
  - **(c)** `performance-2` — avaliar se `confirmar` pode consumir cenário em cache (TOCTOU já é
    coberto por `reler()` l.260) ou criar variante `sugerirAgoraSemAncoraNumero` para o caminho `confirmar`.
    Esforço S–M. Tactic: **Maintain Multiple Copies of Computations**. **Gatilho:** antes da feature
    "confirmar todos" / formação automática em lote ir a PRD.

- **F-modifiability-1 + F-testability-2 (cross-QA — mesmo refactor)** —
  `MotorSugestaoBoleto.ts` passou de 1023 → 1148 LOC (+125) absorvendo `ancorarPorNumero`, `indiceNumeros`,
  `escolhasPorAncora` com detector de conflito, `reservarPorAncora`. Teste do motor já dividido em 3
  arquivos (`.test` 878, `.dps.test` 183, `.numero.test` 380 LOC) — indicador direto do tamanho do SUT.
  Resolver com **um único card** (modifiability-1 = testability-1): extrair camada 0 para colaborador
  `AncoragemCamadaZero` injetado via tsyringe; `AncoraOrdemDps` (já existe) e `AncoraNumeroConfiavel`
  (novo) como implementações registradas. Esforço M. Tactic: **Split Module + Abstract Common Services /
  Limit Structural Complexity**. Alvo: Motor 1148 → ≤ 800 LOC; nova âncora nasce em arquivo próprio ≤ 250 LOC.
  **Gatilho:** antes da próxima âncora entrar na backlog (watchlist cita "aprender por credor",
  código de barras parcial, DACTE).

## Regis-Review P3 (nice-to-have)

- **F-modifiability-3** — `NUMERO_CONFIAVEL_MIN_DIGITOS = 4` hardcoded em `RegraSugestaoBoleto.ts:42-48`.
  Documentado por comentário citando medição PRD (15/15), mas qualquer retuning exige deploy. Mover para
  `EnvironmentProvider` (`SISPAG_NUMERO_CONFIAVEL_MIN_DIGITOS`, default 4) só quando entrar segundo
  cliente/filial com padrão de numeração diferente. Esforço S. Tactic: **Defer Binding**.
- **F-modifiability-4** — `BoletoSuggestionService.ts` em 1161 LOC; `sugerirAgora` orquestra 8 fontes
  de dados em `Promise.all` + o novo `numerosOuDesligado`. Extrair fetch para colaborador `MotorInputProvider`
  que retorna `EntradaMotorSugestao` pronta (fail-closed por fonte). Esforço M. Tactic: **Increase Semantic
  Coherence + Abstract Common Services**. Alvo: 1161 → ≤ 900 LOC. Idealmente alinhado com modifiability-1.
- **F-performance-3** — `indiceNumeros` em `MotorSugestaoBoleto.ts:862-882` itera
  `[...entrada.titulos, ...(entrada.titulosDoCredor ?? [])]`, mas `titulosDoCredor` já é superconjunto.
  Trabalho duplicado benigno (Set deduplica), elimina-se com uma linha: quando `titulosDoCredor` presente,
  iterar só sobre ele; cair para `titulos` apenas no caminho legado. Esforço S (≤ 1h). Tactic: **Reduce Overhead**.
- **F-testability-3** — `normalizarNumero` sem property-based test. 4 asserções pontuais em
  `RegraSugestaoBoleto.test.ts:379-390`; `fast-check` já é dependência instalada, 0 uso no SISPAG.
  Adicionar `fc.property` que gere strings alfanuméricas e verifique idempotência
  (`norm(norm(x)) === norm(x)`) + invariante "≥ 4 dígitos ⇒ aceita como âncora". Esforço S.
  Tactic: **Executable Assertions**.
- **F-testability-4** — cluster TIME LOG do ADR-0079 só existe em prosa (4 falsos sobre 79 vínculos,
  efeito financeiro nulo aceito). Codificar 1 caso em `MotorSugestaoBoleto.numero.test.ts` com dois
  boletos de mesmo valor/dia/emissor e número igual ao do título; teste documenta a aceitação. Esforço S.
  Tactic: **Recordable Test Cases**.

## DesignSystemReviewer (UX, pode ser resolvido neste PR)

- **[RESOLVIDO neste PR — 2026-10-27, Yuri escolheu a opção (i): `NUMERO_IGUAL` suprimido no FE quando há `NUMERO_CONFIAVEL`, via `sinaisVisiveis`]** **UX — redundância visual de sinais quando um candidato tem `NUMERO_CONFIAVEL` E `NUMERO_IGUAL`
  simultaneamente.** O `TEXTO_SINAL` do FE (`src/frontend/app/sispag/components/sugestaoBoleto.ts`)
  renderiza os dois rótulos como bullets separados; o analista vê duas linhas quase idênticas ("Número
  confiável do documento" + "Número igual ao do título") para a mesma evidência. Candidatos a resolução:
  **(i)** suprimir `NUMERO_IGUAL` no FE quando `NUMERO_CONFIAVEL` presente (regra de precedência de
  renderização, não de domínio); **(ii)** fundir ambos em um único rótulo quando co-ocorrem
  ("Número confiável — igual ao do título"); **(iii)** manter como está e aceitar o ruído visual.
  **Pode ser resolvido neste PR pendente da decisão do Yuri** (recomendação do DesignSystemReviewer:
  opção (i), menor delta e preserva o DSL de sinal intacto no backend).
