# Tasks: sispag-guarda-codbar-repetido

**Spec source:** ontology/_inbox/sispag-guarda-codbar-repetido-interview.md (draft + decisões finais do mantenedor, abaixo)
**Ontology diff:** yes (já aplicado, v0.40.1) — `ontology/business-rules/boleto-exige-codigo-de-barras.md` (I16a–e, `planned`), `ontology/decisions/0069-sispag-guarda-de-codigo-de-barras-repetido.md`
**entity_changed:** true (invariante nova; sem entidade/coluna nova)
**Branch / worktree:** `fix/sispag-guarda-codbar-repetido` · `.claude/worktrees/sispag-guarda-codbar-repetido`
**Estimated scope:** M (≈ 6 arquivos de produção, 5 de teste, 0 migration, 0 frontend)
**Versão do app:** 0.66.0 → **0.66.1** (patch, `fix`), FE == BE

## Contexto

`titVldReflexoDdaAssoc` significa "existe boleto DDA com mesmo valor e vencimento"; não reserva 1:1.
O ERP anexa o **mesmo** código de barras a cada item importado do grupo. Caso canônico PEDRONI
(fil 2): 10 títulos de R$ 1.412,00 vencendo em 14/10 para 2 boletos. Hoje a única guarda é de
**ausência** (`BoletoSemCodigoBarrasError`, ADR-0040); o `.REM` pagaria o mesmo boleto N vezes.
Esta entrega é a duplicidade **por boleto** (I16), irmã da duplicidade por título (I13g/ADR-0063) e
**pré-requisito do passo 2 da ADR-0068**.

Fatos de código (conferidos no worktree):
- `RemessaService.gerarRemessaSerializado`: `montarItensImport` (erro de ausência, ~l.1080) → `importarTitulos`
  (~l.610) → `setEtapa('finalizar')` → `finalizarLote` (~l.623) → `gerarRemessa` → gate 5.1
  `cnab.validar` (~l.677). O `catch` externo faz `ledger.fail(key, { mensagem: e.message })` +
  `logService.error` com `mensagem` — logo **`e.message` vai para ledger e log**: tem de conter só a forma mascarada.
- `ConexosSispagWriteClient.listarLinhasDigitaveisDoLote` devolve `{ itens, total, dropped }`; o parser
  (`LINHA_DIGITAVEL_SCHEMA`) **descarta** código inválido e, ao descartar, **perde a identidade** (`docCod/titCod`)
  do item. Para a mensagem de I16c ("ilegível para o título X") o client precisa passar a devolver a identidade
  dos descartados (T0).
- `CodigoBarrasBoleto` só tem 44 → 47 (`paraLinhaDigitavel`); falta 47 → 44. Seu `mascarar` hoje é
  "banco…últimos 4" (ADR-0068 I15k) e o `RemessaCnabValidator.mascarar` é "4 + x + 4": **nenhum é o
  "5 primeiros + 4 últimos" da I16e**. A guarda define a sua máscara (T1) e não altera as existentes.
- `routes/sispag.ts` `respondLoteError` mapeia qualquer `HandlerError` (`statusCode`, `code`, `userMessage`,
  `details`) — o 409 sai de graça ao implementar a interface. O frontend (`src/frontend/lib/sispag.ts`)
  tem ramo por `code`; código desconhecido cai no caminho genérico (verificar em T3, **sem tocar no frontend**).

## Decisões (finais, do mantenedor)

1. Abortar **antes de `finalizarLote`** com `BoletoCodigoBarrasRepetidoError` (409), listando `docCod/titCod`,
   valor, vencimento e o código **mascarado** (5 primeiros + 4 últimos; nunca o completo).
2. Marcar a execução da remessa como `failed` no ledger (via o `catch` existente); **deixar o rascunho nativo**
   (rascunho não se apaga por API); a analista retira o título repetido do lote **local** e gera de novo;
   a retomada reaproveita o rascunho. **Nada é descartado em silêncio** (human-in-the-loop).
3. Escopo: (a) dentro do lote, logo após `importarTitulos` e antes de `finalizarLote`, comparando os códigos
   normalizados de **44 dígitos** derivados de `itsNumCodbar` via `listarLinhasDigitaveisDoLote`;
   (b) segmentos **J (não J-52)** do `.REM` no `RemessaCnabValidator`, como rede de segurança.
4. Código **presente porém inválido** (DV ruim, descartado pelo parser) **falha fechado**: aborta pedindo revisão.
5. Lote manual e automático compartilham o caminho. Sem permissão nova. **Nada do código é persistido**;
   log/ledger/mensagem só com a forma mascarada. Sem migration.
6. **Fora de escopo:** repetição entre lotes vivos e contra boleto já pago (follow-up: hash salgado persistido
   + migration + ADR próprio).
7. **Fato do ERP (HML, 14/10):** o ERP não valida o DV nem compara o código com o título, e `importar` descarta
   o código do payload; no passo 2 da ADR-0068 o código entra por `PUT fin015/finItemSispag` **depois** do
   import. Logo a guarda é uma **função pura sobre os códigos do lote**, independente do passo de import,
   reutilizável pelo passo 2 após a edição.

## Task list

### Task 1: Testes que falham — análise pura de código de barras repetido
**Files to change:**
- `src/backend/domain/libs/boleto/AnaliseCodigoBarrasRepetido.test.ts` (novo)

**Acceptance criteria:**
- [ ] Teste do caso canônico PEDRONI: 10 itens (`docCod/titCod` distintos, valor 1412, vencimento 2026-10-14)
      com **2 códigos sintéticos de 47 dígitos com DV válido** (gerados no teste a partir de barras de 44
      sintéticas via `CodigoBarrasBoleto.paraLinhaDigitavel`; nunca um código real) distribuídos 5+5 ⇒
      **2 grupos de repetição, 5 itens cada**, ordem estável (primeira ocorrência primeiro).
- [ ] Casos: todos distintos ⇒ sem grupos; 1 item ⇒ sem grupos; mesma linha digitável com espaços/pontos ⇒
      normaliza e agrupa; linha 47 e barras 44 do mesmo boleto no mesmo conjunto ⇒ agrupam;
      código inválido (DV de campo, DV geral, tamanho ≠ 47, letras) ⇒ item em `ilegiveis`, **não** entra em grupo;
      lista vazia ⇒ resultado vazio; código de arrecadação (inicia por 8) ⇒ `ilegiveis`.
- [ ] Máscara: 44 dígitos ⇒ `<5 primeiros>…<4 últimos>` (ex. `34191…9999`); asserção explícita de que a saída
      **não contém** o código completo nem qualquer janela contígua de 10+ dígitos do original.
- [ ] Testes falham (módulo inexistente) — red confirmado.

**Dependencies:** none

---

### Task 2: Implementar `AnaliseCodigoBarrasRepetido` (função pura, reutilizável)
**Files to change:**
- `src/backend/domain/libs/boleto/AnaliseCodigoBarrasRepetido.ts` (novo; classe `@injectable()`, métodos arrow,
  sem I/O, sem `process.env`)
- `src/backend/domain/libs/boleto/CodigoBarrasBoleto.ts` (+ `paraBarras(linha47)`: 47 → 44, inverso de
  `paraLinhaDigitavel`: `l[0..4] + l[32] + l[33..47] + l[4..9] + l[10..20] + l[21..31]`; valida DV dos 3 campos
  e o DV geral; `undefined` se inválido; **não altera** `mascarar`/`emissor`)
- `src/backend/domain/libs/boleto/CodigoBarrasBoleto.test.ts` (+ casos de `paraBarras`: ida e volta
  44→47→44 idêntica; DV de campo errado ⇒ `undefined`; prefixo 8 ⇒ `undefined`)

**Acceptance criteria:**
- [ ] API: `analisar(itens: Array<{ chave: string; codigo: string }>)` ⇒
      `{ grupos: Array<{ barras44: string; mascarado: string; chaves: string[] }>; ilegiveis: string[] }`.
      `codigo` aceita 47 ou 44 dígitos (normaliza). A função **não** conhece ERP, ledger nem título.
- [ ] `mascarar(barras44)` pública, formato da I16e (5 + 4).
- [ ] Todos os testes da Task 1 passam; `npm run typecheck` e `npm run lint` verdes no backend.
- [ ] Zero dependência de `RemessaService`/client (importável pelo passo 2 da ADR-0068 depois do `PUT`).

**Dependencies:** Task 1

---

### Task 3: Client devolve a identidade dos códigos ilegíveis (sem expor o código)
**Files to change:**
- `src/backend/domain/client/ConexosSispagWriteClient.test.ts` (teste primeiro)
- `src/backend/domain/client/ConexosSispagWriteClient.ts` (`listarLinhasDigitaveisDoLote`)
- `src/backend/domain/interface/sispag/Fin015Write.ts` (`LinhasDigitaveisDoLote` + `invalidos`)

**Acceptance criteria:**
- [ ] Teste que falha: linha com `itsNumCodbar` de DV inválido ⇒ `invalidos` contém `{ docCod, titCod }` dela
      (titCod default `'1'` como hoje) **e nenhum campo com o código**.
- [ ] Compatível: `itens`, `total`, `dropped` inalterados; invariante `itens.length + invalidos.length === total`
      e `dropped === invalidos.length`; os testes existentes (l.499–615) passam sem edição de asserção.
- [ ] Linha sem `docCod` (nem identidade recuperável) conta em `dropped`/`invalidos` com chave `docCod: ''`
      — nunca é ignorada em silêncio.
- [ ] `SispagPainelService.linhasDigitaveisDoLote` (consumidor existente) continua compilando; o campo novo
      **não** é exposto na API HTTP do painel.

**Dependencies:** none (paralelizável com Tasks 1–2)

---

### Task 4: Testes que falham — erro nomeado 409 e mapeamento
**Files to change:**
- `src/backend/domain/errors/BoletoCodigoBarrasRepetidoError.test.ts` (novo)

**Acceptance criteria:**
- [ ] `isHandlerError(err) === true`; `statusCode === 409`; `retryable === false`;
      `code === 'BOLETO_CODIGO_BARRAS_REPETIDO'`; `name === 'BoletoCodigoBarrasRepetidoError'`.
- [ ] `userMessage` em **pt-BR**, por grupo: lista `docCod/titCod`, valor (R$ pt-BR), vencimento
      (`dd/mm/aaaa`) e código mascarado; termina orientando "retire o título repetido do lote e gere a
      remessa de novo — o rascunho no Conexos será reaproveitado".
- [ ] Modo `ilegivel` (I16c): mensagem própria "código de barras ilegível/inválido para o título X — revise o
      boleto antes de gerar a remessa", sem código algum.
- [ ] Modo `arquivo` (rede do `.REM`): grupos identificados por **linha do arquivo** + mascarado (sem título,
      porque o `.REM` não carrega `docCod`).
- [ ] **Privacidade (teste dedicado):** dados de entrada contendo o código completo de 44 (e a linha de 47)
      ⇒ `message`, `userMessage`, `JSON.stringify(details)` e `String(err.stack)` **não contêm** o código nem
      nenhuma substring contígua ≥ 10 dígitos dele; contêm a forma mascarada.
- [ ] `message` (inglês, vai para o ledger) limitado: no máximo 20 títulos listados + `(+N)`; o `details`
      carrega todos os grupos (só chaves, valores, vencimentos, mascarado).

**Dependencies:** Task 2 (usa `mascarar`)

---

### Task 5: Implementar `BoletoCodigoBarrasRepetidoError`
**Files to change:**
- `src/backend/domain/errors/BoletoCodigoBarrasRepetidoError.ts` (novo; irmão de `BoletoSemCodigoBarrasError`,
  `implements HandlerError`)

**Acceptance criteria:**
- [ ] Testes da Task 4 passam; typecheck/lint verdes.
- [ ] O construtor **recebe só a forma mascarada** (o tipo de entrada não tem campo para o código completo):
      impossível vazar por construção.
- [ ] `routes/sispag.ts` **não precisa de edição** — teste de rota (supertest, padrão dos existentes) com o
      serviço lançando o erro ⇒ HTTP 409, `code: 'BOLETO_CODIGO_BARRAS_REPETIDO'`, `error` = `userMessage`,
      `retryable: false`.

**Dependencies:** Task 4

---

### Task 6: Testes que falham — integração no `RemessaService` (antes de `finalizarLote`, inclusive retomada)
**Files to change:**
- `src/backend/domain/service/sispag/RemessaService.test.ts`

**Acceptance criteria (cada item = um teste que falha hoje):**
- [ ] **Canônico PEDRONI:** lote de 10 itens BOLETO (fil 2, R$ 1.412,00, venc. 2026-10-14) cujo
      `listarLinhasDigitaveisDoLote` devolve 10 linhas com 2 códigos sintéticos válidos (5+5) ⇒
      `gerarRemessa` rejeita com `BoletoCodigoBarrasRepetidoError`; `importarTitulos` foi chamado;
      **`finalizarLote`, `sugerirRemessa`, `gerarRemessa` (ERP) e `baixarArquivo` NÃO foram chamados**;
      o lote local continua `RASCUNHO` (sem `setRemessaGerada`/`transicionarStatus`).
- [ ] **Ledger:** `ledger.fail` chamado com mensagem que cita os títulos e o mascarado; o `setNativeFlpCod`
      do rascunho foi gravado (rascunho preservado para reuso).
- [ ] **Todos distintos** ⇒ fluxo segue até `finalizarLote` (regressão: comportamento de hoje).
- [ ] **Código ilegível** (`invalidos` não vazio no retorno do client) ⇒ aborta com o modo `ilegivel`,
      identificando o título; `finalizarLote` não chamado (fail-closed, I16c).
- [ ] **Retomada/retry NÃO pula a checagem:** (i) segunda chamada de `gerarRemessa` após a primeira ter falhado
      com o erro (ledger `error`, `nativeFlpCod` gravado, ERP mostra itens importados ⇒ `retomarDe`
      `'finalizar'`/`'importar'` com importação já feita): a checagem **roda de novo** e, com o lote local
      ainda repetido, falha de novo **sem** reimportar nem criar outro lote nativo (`criarLote` 0 chamadas);
      (ii) após a analista retirar o título repetido do lote local, a mesma retomada **passa** e chega ao
      `finalizarLote`, reutilizando o mesmo `flpCod`; (iii) retomada em `gerar_remessa` (finalizar já
      ocorrido) também roda a leitura antes de `sugerirRemessa`.
- [ ] **Ordem do código de ausência preservada:** item BOLETO sem DDA associado continua lançando
      `BoletoSemCodigoBarrasError` em `montarItensImport`, **antes** de qualquer escrita e antes da nova guarda;
      os testes existentes de `BoletoSemCodigoBarrasError` passam **sem nenhuma edição**.
- [ ] **Lote sem BOLETO** (só TED/PIX/crédito): `listarLinhasDigitaveisDoLote` **não** é chamado (0 chamadas
      novas ao ERP).
- [ ] **Privacidade:** nas chamadas de `logService.*` e `ledger.fail` capturadas, nenhuma string contém o
      código completo (44 nem 47 dígitos nem qualquer janela ≥ 10 dígitos); contêm o mascarado.
- [ ] **Log de auditoria:** exatamente um `logService.warn` (`BUSINESS_WARN`) com
      `message: 'remessa: código de barras repetido no lote — geração bloqueada'` e
      `data: { loteId, flpCod, grupos: n, titulosAfetados: n, ilegiveis: n }` (+ mascarados), sem código.
- [ ] **Dry-run** não executa a leitura (não há import).
- [ ] Mocks existentes do `RemessaService.test.ts` ganham `listarLinhasDigitaveisDoLote` com default
      "códigos distintos" para os lotes com BOLETO; nenhuma asserção antiga é afrouxada.

**Dependencies:** Tasks 2, 3, 5

---

### Task 7: Integrar a guarda no `RemessaService` (camada 1)
**Files to change:**
- `src/backend/domain/service/sispag/RemessaService.ts` (injetar `AnaliseCodigoBarrasRepetido`; novo método
  privado arrow `verificarCodigoBarrasRepetido`; chamada entre o bloco de import e `setEtapa('finalizar')`)

**Acceptance criteria:**
- [ ] A chamada fica **fora** do `if (!pular('importar'))`: roda também quando o import foi pulado (retomada),
      desde que ainda não exista `gerarRemessa` concluída; **não** altera `pular()`, `ORDEM_ETAPAS` nem a
      lógica de sync/ledger.
- [ ] Só consulta o ERP se `lote.itens` tem algum `modalidade === BOLETO`; usa **uma** leitura
      (`listarLinhasDigitaveisDoLote`) — nenhuma chamada nova além dela.
- [ ] Junta `itens` do client ao lote local por `docCod:titCod` para obter valor/vencimento/credor; item do ERP
      sem correspondente local entra na mensagem só com `docCod/titCod`.
- [ ] Se `itens.length + invalidos.length` for menor que o nº de itens BOLETO do lote (leitura truncada pela
      página única de 500 ou item sem código pós-import), registra `logService.warn` com as contagens e
      **segue** (a rede da Task 9 cobre); ver "Riscos" R3 — não é abort nesta entrega.
- [ ] Erro lançado propaga ao `catch` existente (ledger `failed` + log `falha ao gerar remessa`); **sem
      try/catch novo que engula**; sem `process.env` (EnvironmentProvider não é necessário aqui).
- [ ] Todos os testes da Task 6 passam; `RemessaService.test.ts` inteiro verde; typecheck/lint verdes.
- [ ] Comentário no método registra o contrato de reuso: "a entrada é o conjunto de códigos finais do lote;
      o passo 2 da ADR-0068 chama de novo após o `PUT finItemSispag`".

**Dependencies:** Task 6

---

### Task 8: Testes que falham — rede de segurança no `.REM` (segmentos J)
**Files to change:**
- `src/backend/domain/libs/cnab/RemessaCnabValidator.test.ts`
- `src/backend/domain/service/sispag/RemessaService.test.ts` (caso de integração do gate 5.1)

**Acceptance criteria:**
- [ ] `.REM` sintético com 3 segmentos J, dois com as **mesmas** barras (44, DV válido, sintéticas) ⇒
      `repetidos` com 1 grupo contendo as **linhas** (1-indexed) das duas ocorrências e a barra mascarada;
      `invalidos` continua vazio.
- [ ] Segmentos **J-52** que repetem o CNPJ/identificação **não** contam (arquivo com J + J-52 por boleto e
      barras todas distintas ⇒ `repetidos` vazio).
- [ ] Segmento A/B/O repetindo valor/favorecido não conta; segmento J com barras inválidas continua em
      `invalidos` (não vira `repetidos`).
- [ ] `ResultadoValidacaoRemessa.repetidos` sempre presente (array), para os chamadores existentes.
- [ ] Nenhum campo do resultado contém as barras completas.
- [ ] Integração: com `cnab.validar` devolvendo `repetidos` não vazio no gate 5.1 ⇒
      `BoletoCodigoBarrasRepetidoError` (modo `arquivo`), lote **não** vai para `REMESSA_GERADA`,
      `baixarArquivo` não serve nada, ledger `failed` (mesmo tratamento tardio do `RemessaCorrompidaError`:
      arquivo e lote nativo ficam no ERP para cancelamento manual).
- [ ] Testes falham antes da implementação (red).

**Dependencies:** Task 5

---

### Task 9: Implementar a rede de segurança (camada 2)
**Files to change:**
- `src/backend/domain/libs/cnab/RemessaCnabValidator.ts` (`validar` acumula barras válidas dos J e reporta
  `repetidos: Array<{ barrasMascarada: string; linhas: number[] }>`; usa `AnaliseCodigoBarrasRepetido.mascarar`
  ou equivalente — sem duplicar a regra de máscara da I16e)
- `src/backend/domain/service/sispag/RemessaService.ts` (gate 5.1: lança o erro nomeado quando `repetidos`
  não vazio; inclui `repetidos` no log `verificação de integridade do .REM` apenas como **contagem**)

**Acceptance criteria:**
- [ ] Testes da Task 8 passam; testes existentes do validador e do gate 5.1 verdes sem edição de asserção.
- [ ] Ordem no gate: `invalidos` (RemessaCorrompidaError) tem precedência sobre `repetidos`.
- [ ] Nenhuma mudança em `POS`, nas regras de DV nem nos avisos ADR-0054.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` do backend verdes.

**Dependencies:** Task 8

---

### Task 10: Ontologia → `implemented`, CHANGELOG e bump de versão
**Files to change:**
- `ontology/business-rules/boleto-exige-codigo-de-barras.md` (I16: remover o aviso `planned`; ajustar o
  frontmatter/`related_files`; nota sobre `listarLinhasDigitaveisDoLote.invalidos` e a máscara 5+4)
- `ontology/decisions/0069-sispag-guarda-de-codigo-de-barras-repetido.md` (`Status da implementação: implemented`)
- `ontology/_index.json`, `ontology/_coverage.json` (patch da versão da ontologia — **reconferir na `main`**)
- `CHANGELOG.md` (entrada `## v0.66.1`, pt-BR, voltada ao analista: o que muda e o que fazer ao ver o aviso)
- `src/backend/package.json`, `src/frontend/package.json` (+ lockfiles, se versionam) — 0.66.0 → 0.66.1

**Acceptance criteria:**
- [ ] **Reconferir na `main` antes de bumpar** (memória: versão colide entre sessões paralelas): número do ADR
      (0069), versão da ontologia (0.40.1) e versão do app; renumerar/ajustar se colidir.
- [ ] `scripts/bump-version.ps1` não roda nesta máquina (sem pwsh): aplicar a regra de semver à mão nos dois
      `package.json`, FE == BE; commit `chore(release): v0.66.1`.
- [ ] CHANGELOG nomeia o erro ("código de barras repetido"), diz que nada é descartado em silêncio e o que a
      analista faz (retirar o título repetido do lote e gerar de novo); **não** menciona código real.
- [ ] I16a–e coerentes com o comportamento entregue (inclusive R3 como limite conhecido).
- [ ] Registrar follow-ups em `ontology/_inbox/` (entre lotes + já pago com hash salgado; passo 2 da ADR-0068
      chamar a mesma função pós-`PUT`; R3).

**Dependencies:** Tasks 7, 9 (e verde dos gates)

## Ground-truth

**Veredito: `SEM_GROUND_TRUTH` para o ERP.** Não há fonte nativa do Conexos que diga "este boleto aparece
duas vezes neste lote": o ERP **não valida** nem o DV nem a correspondência com o título (achado HML
14/10), e o código de barras de cada item **só é conhecido depois do import**, isto é, depois de uma escrita
no ERP. Portanto **não se aplica** um script read-only de validação sobre dados de produção (não há
população pré-existente de lotes importados a comparar sem criar rascunhos nativos) e **nenhuma validação
ao vivo no ERP é inventada**. O gate de ground-truth é substituído por:

1. **Teste canônico determinístico baseado em fixture** (Tasks 1, 6, 8): PEDRONI fil 2 reproduzido com
   códigos **sintéticos** de DV válido, exercitando função pura, integração no serviço (antes de
   `finalizarLote`) e `.REM` sintético; mais os casos negativos (distintos, J-52, ausência, ilegível).
2. **Medição de PRD já registrada** como evidência de existência do problema (27 títulos flagados em grupos
   com mais títulos que boletos; ADR-0069), não como oráculo da implementação.
3. **Roteiro de QA em HML** (QaCoach, humano, não automático): lote com 2 títulos de mesmo valor/vencimento e
   1 boleto DDA ⇒ geração bloqueia **antes** de finalizar, rascunho nativo permanece, a retirada do título
   no lote local e nova geração reaproveita o rascunho. Credencial própria de HML necessária (memória:
   HML recusa o usuário de produção).

## ObservabilityAdvisor

**Chamada leve, não a pipeline de Lambda.** Não há handler/job novo (então o gatilho "novo handler" não
dispara), mas há um **novo sinal operacional**: o bloqueio. Escopo do review: (a) a linha de `logService.warn`
`remessa: código de barras repetido no lote — geração bloqueada` e os campos `data` (Task 6), (b) o motivo
no ledger (`mensagem` do erro, mascarada), (c) se o `reason`/`code` `BOLETO_CODIGO_BARRAS_REPETIDO` é
filtrável no painel de operação existente. Nenhum alarme/dashboard novo é necessário. `AwsInfraArchitect`
**não** é chamado (sem `infra/`). `DesignSystemReviewer` **não** é chamado (frontend intocado — o caminho
genérico de erro mostra `error`; confirmar na Task 7 lendo `src/frontend/lib/sispag.ts` ~l.800–840).

## Riscos e ambiguidades

- **R1 — Máscara:** a I16e fixa "5 primeiros + 4 últimos", diferente de `CodigoBarrasBoleto.mascarar`
  (I15k, banco…4) e do `RemessaCnabValidator.mascarar` (4 + x + 4). Plano: nova `mascarar` na análise pura;
  as existentes ficam. Se o mantenedor preferir unificar, é follow-up (mexe em I15k e em testes de painel).
- **R2 — Identidade perdida dos ilegíveis:** sem a Task 3, I16c não consegue dizer "qual título". É mudança
  aditiva no client e na interface; sem efeito HTTP.
- **R3 — Leitura única (pageSize 500) e itens sem código pós-import:** `listarLinhasDigitaveisDoLote` é página
  única. Lotes têm ≤ 25 itens na prática, mas se `itens + invalidos < nº de BOLETO` a checagem é parcial.
  Nesta entrega vira **warn + segue** (a rede do `.REM` cobre); decidir com o Yuri se deve virar abort
  (fail-closed total) — afetaria a retomada de lotes em que o ERP ainda não preencheu `itsNumCodbar`.
- **R4 — Falha tardia da camada 2:** lote já FINALIZADO e arquivo gerado no ERP (cancelamento manual). Por
  isso a camada 1 é a principal; a 2 existe para retomadas e leitura incompleta.
- **R5 — Concorrência:** duas analistas gerando o mesmo lote — já serializado por `gerarRemessaSerializado`;
  a guarda não adiciona estado.
- **R6 — Entre lotes:** o mesmo boleto em dois lotes (vencimentos distintos, ADR-0064) segue **não
  detectado**; declarado como limite na I16 e no CHANGELOG.
- **R7 — PatternGuardian revisa o arquivo inteiro** (`RemessaService.ts` tem 1700 linhas, com dívida fora do
  delta): conferir contra `main` antes de remediar P0 que não seja do delta.

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` (src/backend) ✅
- [ ] `npm run lint` (src/backend) ✅ — se o hook Biome reportar "Checked 0 files" em worktree, conferir com `npx biome check`
- [ ] `npm test` (src/backend) ✅ — incluindo testes antigos de `BoletoSemCodigoBarrasError` **sem edição**
- [ ] **`BoletoSemCodigoBarrasError` inalterado:** mesmo arquivo sem diff, mesmo ponto de lançamento
      (`montarItensImport`), mesma mensagem e mesmo `code`/409; nenhum teste dele alterado ✅
- [ ] PatternGuardian gate ✅ (classe exportada, arrow methods, modificadores explícitos, tsyringe, sem `!`,
      SQL — nenhuma nova — parametrizado, sem `process.env`)
- [ ] entity_changed ⇒ diff da ontologia presente (I16 `implemented`, ADR-0069, `_index`/`_coverage`) ✅
- [ ] Zero ocorrência do código de barras completo em mensagem/log/ledger (testes das Tasks 4 e 6) ✅
- [ ] Zero migration, zero permissão nova, zero chamada nova ao ERP além da leitura já existente ✅
- [ ] ObservabilityAdvisor review (linha de log + motivo no ledger) ✅
- [ ] Ground-truth: `SEM_GROUND_TRUTH` registrado (fixture canônica no lugar) ✅
- [ ] Frontend intocado ⇒ DesignSystemReviewer não se aplica ✅
- [ ] Regis-Review gate (P0 remedia; P1–P3 → `ontology/_inbox/sispag-guarda-codbar-repetido-regis-followups.md`) ✅
- [ ] Rebase da `main` aplicado (nunca merge); conflito não trivial pausa para o Yuri ✅
- [ ] Versão do app bumpada FE+BE lockstep (0.66.1) + `CHANGELOG.md` atualizado, à mão (sem pwsh), após
      reconferir colisão na `main` ✅
