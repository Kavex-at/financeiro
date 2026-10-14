# Tasks: sispag-sugestao-boleto-dda

**Spec source:** ontology/_inbox/sispag-sugestao-boleto-dda-interview.md (seção DECISÕES) + ontology/_inbox/sispag-sugestao-boleto-dda-ontology-diff.md
**ADR:** ontology/decisions/0068-sispag-sugestao-de-boleto-confirmacao-de-emissor.md (já escrita; ontologia v0.40.0 aplicada)
**Ontology diff:** yes (aplicado) — entities/confirmacao-emissor-boleto.md, entities/decisao-sugestao-boleto.md, business-rules/sugestao-boleto-dda-sispag.md (I15a–k), actions/sispag/{sugerir-boleto-para-titulo,confirmar-sugestao-boleto,rejeitar-sugestao-boleto,revogar-confirmacao-emissor}.md (+ a quinta, de cópia auditada), entities/boleto-dda.md. `entity_changed = true`; os arquivos estão `planned` e T9 os leva a `implemented`.
**Estimated scope:** L (1 migration, 1 lib pura, 1 motor puro, 2 repositórios, 1 service, 5 rotas, 3 componentes de UI, ajuste de regra existente)
**Versão atual:** app v0.65.0 (FE==BE), ontologia v0.40.0, última migration 0083 em `origin/main` (verificado: `0083_titulo_doc_esp_numero.sql`) → a nova é **0084**. Conferir de novo na main antes do bump (memória: versão colide entre sessões paralelas).

> **Layout do repo:** `src/backend/` e `src/frontend/`, testes colocados `*.test.ts(x)`. Não há `infra/`: nenhuma task de Terraform, AwsInfraArchitect não é acionado.

## Contexto e decisões (recap)

Columbia vê poucos boletos associados no SISPAG: ~836 de ~1090 títulos BOLETO estão "boleto sem DDA". O ERP só sinaliza valor exato + dia exato (0 divergências em ~250 sinalizados), então não associa título cujo boleto difere em centavos/dias ou cuja conta emissora ele não conhece. **Passo 1 (esta feature):** mostrar ao analista, na aba de títulos, o boleto livre do `fin124` que provavelmente é o do título, com a evidência, e registrar a decisão dele por (credor `pesCod`, emissor `emissorChave`). **Zero escrita no Conexos.** Passo 2 (bind do código de barras ao item do lote, exige prova em HML) e passo 3 (automático só para pares confirmados) têm ADR e entrevista próprias e **não** são autorizados aqui.

Decisões do maintainer (2026-10-14), já em I15:

- **Q1** par + registro por título (`ConfirmacaoEmissorBoleto` + `DecisaoSugestaoBoleto`).
- **Q2** o par nunca alarga limite; limites globais constantes de código.
- **Q3** uma pessoa com `sispag:executar` confirma; segunda pessoa só no passo 3.
- **Q4** `sispag:ver` vê a sugestão com emissor mascarado; `sispag:executar` copia a linha digitável e confirma/rejeita/revoga.
- **Q5** layout real só 341 (Itaú) e 237 (Bradesco) = 244 de 290 (84 %); demais bancos chave genérica (`banco:<8 dígitos do campo livre>`), confirmável por humano, `layoutEmissor = GENERICO`, nunca elegível a automático.
- **Q-A** qualquer `sispag:executar` revoga, com motivo. **Q-B** limites: \|Δvalor\| ≤ R$ 0,05 no mesmo dia; ou valor igual e boleto vencendo 1–5 dias DEPOIS do título e não antes da data de débito.
- **Padrões (revisáveis):** Q-C data de débito sem lote = vencimento do título; Q-D disputa pelo menor vencimento, empate menor `docCod` (depois `filCod`, `titCod`); Q-E revogar cancela decisões não aplicadas (no passo 1 nenhuma); Q-F boleto vencido só informativo, não confirmável; Q-H métricas no log; **toda cópia de linha digitável é auditada** (`LINHA_COPIADA`).
- Confirmação é **evidência, não autoridade** (I15a): `temBoleto`, lote, título e Conexos não mudam; a validação ao vivo da remessa (ADR-0040) segue sendo a única autoridade.

### Fatos do código que moldam as tasks

- `ConsolidacaoBoletoDda` hoje (direção boleto → títulos) usa **valor exato** + vencimento em **±`JANELA_CANDIDATO_DIAS = 3`** (`Math.abs(diferencaDias)`). Essa regra **deixa de existir** (ver T3b): dias ANTES do título não são mais seguros e centavos passam a ser tratados.
- `JANELA_CANDIDATO_DIAS` / `janelaDias` aparecem em: `BoletoDdaService.ts:20,86`, `BoletoDdaService.test.ts:156`, `interface/sispag/BoletoDda.ts:123`, `frontend/lib/sispag.ts:1300`, `BoletosDdaTab.tsx:280` (texto "candidato = mesmo valor e vencimento em ±N dias"), `BoletosDdaTab.test.tsx:74`, `page.test.tsx:320`, `BoletosDoTituloDialog.test.tsx:32`.
- `CodigoBarrasBoleto` só expõe `paraLinhaDigitavel` e `bancoEmissor`; agência/conta é NOVO. Barras de 44 dígitos; as que começam com `8` (arrecadação) já caem fora.
- `GET /sispag/boletos-dda` é **admin** (aba "Boletos DDA"): **não muda**. O endpoint novo da sugestão segue o modelo de permissão do ADR-0053/0068 (`ver`/`executar`).
- Padrão a copiar para par + eventos + índice parcial + permissões: `0080_sispag_favorecido_autorizado.sql`, `AuthorizedPayeeService/Repository`, rotas `/favorecidos-autorizados` em `routes/sispag.ts` (~533+), máscara I14l, trigger append-only da 0078.

---

## Task list

### Task 1: Migration 0084 — tabelas de confirmação, decisão e trilha
**Files to change:**
- `src/backend/migrations/0084_sispag_sugestao_boleto.sql` (novo)
- `src/backend/migrations/0084_sispag_sugestao_boleto.test.ts` (novo; estático, como `0083_*.test.ts`)
- `src/backend/migrations/0084_sispag_sugestao_boleto.integration.test.ts` (novo; como `0080_*.integration.test.ts`)
- `src/backend/migrations/rollbacks/0084_sispag_sugestao_boleto.rollback.sql` (novo; só estrutura, README da pasta)

**Acceptance criteria:**
- [ ] `sispag_confirmacao_emissor_boleto`: `id UUID PK`, `pes_cod TEXT`, `credor`, `emissor_chave`, `layout_emissor` (CHECK `ITAU_341|BRADESCO_237|GENERICO`), `banco_emissor`, `emissor_mascarado`, `estado` (CHECK `VIGENTE|REVOGADA`), `evidencia JSONB`, `confirmado_por NOT NULL`, `confirmado_em`, `revogado_por/em`, `motivo_revogacao`, `versao`. Nenhuma coluna guarda a linha digitável completa nem o código de barras de 44 dígitos.
- [ ] Índice único **parcial** `(pes_cod, emissor_chave) WHERE estado = 'VIGENTE'`; teste de integração: segunda `VIGENTE` do mesmo par falha com `23505`; após `REVOGADA`, nova `VIGENTE` é aceita.
- [ ] CHECK: `estado = 'REVOGADA'` exige `motivo_revogacao` não vazio, `revogado_por` e `revogado_em`; `confirmado_por <> 'sistema'`.
- [ ] `sispag_decisao_sugestao_boleto`: chave do título (`fil_cod`, `doc_cod`, `tit_cod`), `pes_cod`, `credor`, `ddc_cod`, `dit_cod`, `numero_boleto`, `codbar_mascarado`, valores/vencimentos (snapshot, datas como `DATE`), `delta_valor`, `delta_percentual`, `delta_dias` (com sinal, boleto − título), `sinais JSONB`, `tier` (CHECK `CONHECIDO|FORTE|ATENCAO`), `emissor_chave`, `decisao` (CHECK `CONFIRMADA|REJEITADA`), `decidido_por`, `decidido_em`, `motivo`, `confirmacao_emissor_id` (FK nullable para a tabela de pares).
- [ ] CHECK: `decisao = 'REJEITADA'` exige `motivo`; `decisao = 'CONFIRMADA'` exige `confirmacao_emissor_id` e `tier` ≠ NULL.
- [ ] Índices únicos parciais: 1 `CONFIRMADA` por título `(fil_cod, doc_cod, tit_cod)`; 1 `CONFIRMADA` por boleto `(ddc_cod, dit_cod)`; 1 `REJEITADA` por `(fil_cod, doc_cod, tit_cod, ddc_cod, dit_cod)` (rejeitar de novo é no-op, I15j).
- [ ] `sispag_sugestao_boleto_evento`: só-inclusão, `tipo` CHECK `PAR_CONFIRMADO|DECISAO_CONFIRMADA|DECISAO_REJEITADA|PAR_REVOGADO|LINHA_COPIADA`, `ator NOT NULL`, `ocorrido_em`, `pes_cod`, `emissor_chave` nullable, chave do título/boleto nullable, `motivo`, `detalhe JSONB`. Trigger recusa UPDATE, DELETE e TRUNCATE (padrão 0078/0080); teste de integração prova as três recusas.
- [ ] Migration **idempotente** (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, trigger via `DROP TRIGGER IF EXISTS` + create) e **sem escrita em dado existente**; nenhuma permissão nova no catálogo (usa `sispag:ver`/`sispag:executar`).
- [ ] Arquivo `.sql` aparece na cópia do `npm run build` (gotcha do `dist/`): conferir `migrations/MigrationFiles.ts` e que o teste de paridade existente de migrations continua verde.
- [ ] `npm run typecheck` ✅

**Dependencies:** none (escreve-se junto com os testes: primeiro o `.test.ts` estático vermelho)

---

### Task 2: Chave do emissor em `CodigoBarrasBoleto` (puro)
**Files to change:**
- `src/backend/domain/libs/boleto/CodigoBarrasBoleto.ts`
- `src/backend/domain/libs/boleto/CodigoBarrasBoleto.test.ts`
- `src/backend/domain/interface/sispag/SugestaoBoleto.ts` (novo: `LAYOUT_EMISSOR`, `EmissorBoleto`)

**Acceptance criteria:**
- [ ] Novo método `emissor(codbar?: string): EmissorBoleto | undefined` com `{ banco, layout, chave, mascarado }`.
- [ ] Itaú 341: agência e conta do campo livre conforme layout FEBRABAN/Itaú (carteira, nosso número, agência, conta, DAC); chave `341:<agência>:<conta>` e `layout = ITAU_341`. Bradesco 237: agência (4) + conta (7) do campo livre; chave `237:<agência>:<conta>`, exemplo do ontology `237:2656:0092740`; `layout = BRADESCO_237`.
- [ ] Demais bancos: `layout = GENERICO`, chave `<banco>:<8 dígitos do campo livre>` (posições definidas e documentadas no código); nunca recebe selo de verificada.
- [ ] `mascarado`: banco e agência completos, conta com os 4 últimos dígitos (padrão I14l), ex.: `237 / 2656 / ***2740`.
- [ ] Testes com **barras no formato real** (44 dígitos, DV geral e fator de vencimento válidos), no mínimo: 237 caso MULTILOG BRASIL (cc 0092740) e 237 outra conta do mesmo credor → chaves **diferentes**; 341; 104, 329, 422, 033 (genérico); barras iniciadas em `8` → `undefined`; comprimento ≠ 44 → `undefined`; não numérico → `undefined`; `undefined`/vazio → `undefined`.
- [ ] Teste de não-vazamento: nenhuma saída (`chave`, `mascarado`) contém os 44 dígitos nem a linha digitável; `emissor()` nunca lança.
- [ ] Os métodos existentes (`paraLinhaDigitavel`, `bancoEmissor`) continuam com os testes atuais verdes.

**Dependencies:** none

---

### Task 3a: Regra pura de par título × boleto (tiers e deltas)
**Files to change:**
- `src/backend/domain/service/sispag/RegraSugestaoBoleto.ts` (novo; classe exportada, métodos arrow, constantes globais)
- `src/backend/domain/service/sispag/RegraSugestaoBoleto.test.ts` (novo)
- `src/backend/domain/interface/sispag/SugestaoBoleto.ts` (tiers, sinais, delta)

**Acceptance criteria:**
- [ ] Constantes globais exportadas (não por tenant): `LIMITE_VALOR_MESMO_DIA = 0.05`, `DIAS_DEPOIS_MIN = 1`, `DIAS_DEPOIS_MAX = 5`. Comparação de valores em centavos inteiros (nada de `0.1 + 0.2`).
- [ ] `avaliar({ titulo, boleto, dataDebito, parConfirmado })` devolve `{ tier | VENCIDO_INFORMATIVO | SEM_RELACAO, deltaValor, deltaPercentual, deltaDias, sinais, confirmavel }`, deltas **com sinal, boleto − título**.
- [ ] Dentro dos limites globais: (a) \|Δvalor\| ≤ R$ 0,05 **e** Δdias = 0; ou (b) Δvalor = 0 **e** 1 ≤ Δdias ≤ 5 **e** boleto vence ≥ `dataDebito`. Dentro dos limites + par `VIGENTE` → `CONHECIDO`; dentro dos limites sem par → `FORTE` (a unicidade nos dois sentidos é decidida no motor, T3c).
- [ ] Fora dos limites (ex.: +1,6 %, +R$ 10,00, +6 dias, +R$ 0,06, valor igual com Δdias = 0 mas par ausente continua FORTE) → `ATENCAO`, com delta destacado; **nunca** `CONHECIDO` mesmo com par vigente: **par confirmado nunca alarga limite** (I15d). Teste explícito: par vigente + Δ = +R$ 10 → `ATENCAO`, não `CONHECIDO`.
- [ ] Boleto que vence **antes** da `dataDebito` → `VENCIDO_INFORMATIVO`, `confirmavel = false`, nunca `CONHECIDO` nem `FORTE` (I15h). Boleto vencendo antes do título **sem lote** (data de débito = vencimento do título) cai aqui.
- [ ] Número do documento (`doc_esp_numero` × `boleto.numero`, dígitos estritos) só adiciona o sinal `NUMERO_IGUAL`; número igual com valor/data fora do limite **não** sobe o tier e é marcado como colisão (I15f); número ausente não penaliza.
- [ ] Datas como data civil (UTC meia-noite, BRT), via `BankingCalendar`/helpers existentes; teste de virada de mês e de fim de semana (a data de débito ajustada é a do lote, I8).
- [ ] Teste de tabela cobrindo os casos medidos: NELSON +R$ 0,01 mesmo dia → FORTE; AR SOLUÇÕES +1 a +3 dias valor igual → FORTE; valor igual −1 dia → VENCIDO_INFORMATIVO ou ATENCAO conforme data de débito; +R$ 10 → ATENCAO.

**Dependencies:** T2 (para `emissorChave` no sinal `EMISSOR_CONFIRMADO`; a regra recebe `parConfirmado` já resolvido)

---

### Task 3b: Regra em camadas substitui "valor exato ±3 dias" na `ConsolidacaoBoletoDda`
**Files to change:**
- `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts` (remover `JANELA_CANDIDATO_DIAS` e o filtro `Math.abs(diferencaDias) <= janelaDias`; agrupamento por valor exato dá lugar a candidatos por `RegraSugestaoBoleto`)
- `src/backend/domain/service/sispag/ConsolidacaoBoletoDda.test.ts` (atualizar os casos existentes)
- `src/backend/domain/service/sispag/BoletoDdaService.ts` e `BoletoDdaService.test.ts` (linhas 20, 86 e 156: sem `JANELA_CANDIDATO_DIAS`)
- `src/backend/domain/interface/sispag/BoletoDda.ts` (campo `janelaDias` da resposta, ~linha 123)
- `src/frontend/lib/sispag.ts` (~linha 1300), `src/frontend/app/sispag/components/BoletosDdaTab.tsx` (texto da linha ~280), `BoletosDdaTab.test.tsx`, `BoletosDoTituloDialog.test.tsx`, `src/frontend/app/sispag/page.test.tsx` (fixtures com `janelaDias`)

**Acceptance criteria:**
- [ ] **A regra de candidato em camadas (T3a) substitui "valor exato ±3 dias" em `ConsolidacaoBoletoDda`.** Dias **antes** do título deixam de ser "seguros": um boleto 1–3 dias antes do vencimento do título **não** é mais candidato `FORTE`; passa a `VENCIDO_INFORMATIVO` (ou `ATENCAO` quando a data de débito do lote o permitir), com `diferencaDias` negativo visível. Nenhum teste existente pode continuar asserindo o ±3.
- [ ] Os testes existentes da `ConsolidacaoBoletoDda` que dependiam da janela ±3 / valor exato são **atualizados explicitamente** (listar no PR quais mudaram e por quê): os dois casos medidos em 2026-09-23 (PEDRONI 34697/1 e ADP 5046/1, boleto 1 dia DEPOIS) continuam candidatos; um boleto 2 dias ANTES deixa de ser; valor com diferença de R$ 0,01 passa a ser candidato `FORTE` (antes era `SEM_TITULO`).
- [ ] Situações da aba DDA (`CANDIDATO`/`AMBIGUO`/`SEM_TITULO`/`VINCULADO`) preservadas; `AMBIGUO` continua significando 2+ títulos concorrendo pelo mesmo boleto (a disputa I15e é resolvida só no motor de sugestão, T3c; a aba DDA continua expondo a ambiguidade como situação própria).
- [ ] O campo `janelaDias` e o texto "candidato = mesmo valor e vencimento em ±N dias" saem; no lugar entra um texto estático com a regra real (limites globais), vindo das constantes (um único lugar), e os testes de FE são atualizados.
- [ ] **O acesso admin-only da aba "Boletos DDA" e de `GET /sispag/boletos-dda` e `POST /sispag/boletos-dda/sincronizar` NÃO muda** (teste de rota existente permanece verde; nenhuma rota nova é pendurada nesse recurso).
- [ ] `npm run typecheck` e `npm test` em backend e frontend ✅

**Dependencies:** T3a

---

### Task 3c: Motor de sugestão por título (puro: exclusões, disputa, unicidade)
**Files to change:**
- `src/backend/domain/service/sispag/MotorSugestaoBoleto.ts` (novo, `@injectable`, puro, sem I/O)
- `src/backend/domain/service/sispag/MotorSugestaoBoleto.test.ts` (novo)

**Acceptance criteria:**
- [ ] `sugerir(entrada)` recebe carteira (títulos BOLETO ativos com `tem_boleto = false`), pool de boletos, pares `VIGENTE`, decisões `REJEITADA` e `CONFIRMADA` ativas, datas de débito dos lotes; devolve, por título, no máximo 1 sugestão (melhor candidato) ou nenhuma, sem mutar a entrada e sem I/O.
- [ ] **Exclusões (I15e):** boleto com `docCod/titCod` preenchidos (vinculado pelo ERP, I-DDA2); boleto "reservado" por título que o ERP já sinalizou (`tem_boleto = true`, mesmo valor e mesmo dia); título pago, inativo ou `forma ≠ BOLETO`; boleto `REJEITADO` para **aquele** título (outro candidato reaparece); boleto já `CONFIRMADA` para outro título (`BoletoAlreadySuggestedToOtherTitle`).
- [ ] **Disputa (I15e):** dois títulos contestando o mesmo boleto → o boleto fica com o de **menor vencimento**; empate → **menor `docCod`**, depois `filCod`, depois `titCod`. O perdedor aparece **sem** o boleto (outro candidato dele, se houver, é reavaliado). Teste determinístico: permutar a ordem da entrada não muda o resultado.
- [ ] **Unicidade nos dois sentidos:** um título com 2+ boletos empatados dentro do limite não recebe `FORTE` (fica `ATENCAO` ambíguo ou sem sugestão — documentar a escolha); um boleto só vai a um título (MULTILOG: 77 títulos × mesmo valor não geram 77 sugestões do mesmo boleto).
- [ ] Par `VIGENTE` por `(pesCod, emissorChave)` promove `FORTE` → `CONHECIDO` apenas dentro dos limites globais (T3a); par de outro `emissorChave` do mesmo credor **não** promove (caso MULTILOG BRASIL cc 0092740 × MULTILOG S/A cc 0006500).
- [ ] Sugestão `VENCIDO_INFORMATIVO` é devolvida com `confirmavel = false` e motivo visível; nunca sobe de tier.
- [ ] Performance: complexidade documentada e teste com ~1100 títulos × ~1500 boletos em < 1 s (índice por valor em centavos, sem O(n·m) ingênuo).

**Dependencies:** T2, T3a

---

### Task 4: Repositórios (confirmação, decisão, trilha)
**Files to change:**
- `src/backend/domain/repository/sispag/SugestaoBoletoRepository.ts` (novo) e `.test.ts`
- `src/backend/domain/repository/sispag/SugestaoBoletoRepository.integration.test.ts` (novo)
- `src/backend/domain/repository/sispag/BoletoDdaRepository.ts` / `TituloAPagarRepository.ts` (só se faltar uma leitura: boletos livres e títulos candidatos, incluindo `doc_esp_numero` e `pes_cod`)

**Acceptance criteria:**
- [ ] SQL **parametrizado** (`$1…`), nenhuma interpolação; `@injectable`, métodos arrow, linhas mapeadas por Zod no boundary (colunas nullable tratadas, sem `!`).
- [ ] Métodos: `listarParesVigentes(pesCods?)`, `buscarParVigente(pesCod, emissorChave)`, `inserirPar`, `revogarPar` (lock otimista por `versao`), `inserirDecisao`, `listarDecisoes(filtro)`, `inserirEvento`, `listarEventos`. Inserções de par/decisão/evento da confirmação na **mesma transação**.
- [ ] Corrida: o perdedor do índice único parcial (`23505`) **relê e devolve a linha vencedora** (I15j); teste de integração com duas inserções concorrentes.
- [ ] Nenhum método grava `codbar` completo nem linha digitável (teste: `JSON.stringify` das linhas persistidas não contém 44 dígitos seguidos).
- [ ] Leitura "boletos livres + títulos sem flag" cobre só o pool local; nenhuma chamada ao Conexos.

**Dependencies:** T1

---

### Task 5: `BoletoSuggestionService` (sugerir, confirmar, rejeitar, revogar, copiar)
**Files to change:**
- `src/backend/domain/service/sispag/BoletoSuggestionService.ts` (novo, `@injectable`) e `.test.ts`
- `src/backend/domain/errors/` — `BoletoSuggestionNotAvailableError.ts` (409), `BoletoAlreadySuggestedToOtherTitleError.ts` (409), `IssuerConfirmationReasonRequiredError.ts` (422), `OverdueBoletoNotConfirmableError.ts` (422), com testes no padrão `AuthorizedPayeeErrors.test.ts`
- `src/backend/domain/appContainer.ts` (registro, se o container exigir)

**Acceptance criteria:**
- [ ] `listarSugestoes(usuario, filtro)`: lê pool + carteira, roda `MotorSugestaoBoleto`, devolve a sugestão com emissor **mascarado** e **sem** linha digitável para `sispag:ver`; devolve `linhaDigitavel` somente se o chamador tem `sispag:executar` **e** ela é pedida pelo endpoint de cópia (T6) — a listagem nunca inclui a linha, nem para `executar` (I15k).
- [ ] `confirmar({ titulo, boleto })` (`executar`): **relê** título e boleto do banco e reavalia a regra (anti-TOCTOU); se o boleto deixou de ser livre ou o título ganhou vínculo → `BoletoSuggestionNotAvailableError` (409); boleto já `CONFIRMADA` a outro título → `BoletoAlreadySuggestedToOtherTitleError` (409); `VENCIDO_INFORMATIVO` → `OverdueBoletoNotConfirmableError` (422). Sucesso: cria o par `VIGENTE` se não existe (ou reutiliza), grava a `DecisaoSugestaoBoleto` com evidência (deltas com sinal, sinais, tier) e eventos `PAR_CONFIRMADO` (só se criou) e `DECISAO_CONFIRMADA`, **numa transação**.
- [ ] `confirmar` do mesmo (título, boleto) de novo devolve a decisão existente sem novo evento (I15j); `confirmar` sobre par já `VIGENTE` grava só a decisão.
- [ ] `ATENCAO` é confirmável (com a diferença destacada), mas a confirmação **não** altera os limites: reavaliar a mesma sugestão depois continua `ATENCAO` (I15d).
- [ ] Confirmar com `layoutEmissor = GENERICO` grava `GENERICO` e a marca de **não elegível a automático** (I15i).
- [ ] `rejeitar({ titulo, boleto, motivo })`: motivo obrigatório (`IssuerConfirmationReasonRequiredError`, 422); esconde só aquele boleto para aquele título; rejeitar já rejeitado é no-op; não toca o par.
- [ ] `revogarPar({ id, motivo })` (`executar`; **qualquer** pessoa com `executar`, I15g/Q-A): motivo obrigatório; par `VIGENTE` → `REVOGADA`, evento `PAR_REVOGADO`; revogar par não `VIGENTE` é no-op; as decisões do par passam a derivado `PAR_REVOGADO` (sem escrita extra no passo 1, Q-E).
- [ ] `copiarLinha({ titulo, boleto })` (`executar`): devolve a linha digitável (via `CodigoBarrasBoleto`) e grava `LINHA_COPIADA` (quem, quando, título, boleto) **antes** de devolver; se a trilha falhar, a linha **não** é devolvida (fail-closed).
- [ ] **Nunca** o ator `sistema`; o `usuario` vem do token autenticado, nunca do body.
- [ ] Nenhuma chamada ao Conexos em nenhum caminho (teste: o `ConexosBaseClient`/`ConexosDdaClient` injetados são spies e não são chamados); `temBoleto`, lote e título intactos (I15a/b).
- [ ] `LogService` em português para o operador, sem linha digitável/barras completos em nenhum log nem mensagem de erro (teste de captura de log).
- [ ] Métricas (taxa de confirmação por tier) saem como log estruturado `sugestao_boleto.decisao` (Q-H), sem tabela nova.

**Dependencies:** T2, T3c, T4

---

### Task 6: Rotas, Zod e permissões
**Files to change:**
- `src/backend/routes/sispag.ts`
- `src/backend/routes/sispag.sugestaoBoleto.test.ts` (novo, no padrão de `sispag.favorecidos.test.ts`)
- `src/backend/domain/interface/sispag/SugestaoBoletoSchemas.ts` (novo: schemas Zod de body/query)

**Acceptance criteria:**
- [ ] `GET /sispag/sugestoes-boleto` (`?filCod=&pesCod=&tier=&pagina=&tamanho=`) — `sispag:ver`; resposta: sugestão com emissor mascarado, deltas com sinal, sinais, tier, `confirmavel`, `ddaDefasado`/aviso de frescor do DDA (ADR-0067); **sem** linha digitável e sem barras.
- [ ] `POST /sispag/sugestoes-boleto/confirmar` — `sispag:executar`; body `{ filCod, docCod, titCod, ddcCod, ditCod }` (Zod, strict, 400 em body inválido).
- [ ] `POST /sispag/sugestoes-boleto/rejeitar` — `sispag:executar`; body com `motivo` obrigatório.
- [ ] `POST /sispag/sugestoes-boleto/copiar-linha` — `sispag:executar`; devolve `{ linhaDigitavel }` e grava `LINHA_COPIADA`; resposta com `Cache-Control: no-store`.
- [ ] `POST /sispag/confirmacoes-emissor/:id/revogar` — `sispag:executar`; `motivo` obrigatório; `GET /sispag/confirmacoes-emissor` — `sispag:ver`, só emissor mascarado.
- [ ] Mapeamento de erros: 409 (`BoletoSuggestionNotAvailable`, `BoletoAlreadySuggestedToOtherTitle`), 422 (`IssuerConfirmationReasonRequired`, `OverdueBoletoNotConfirmable`), 404 par inexistente, 403 sem permissão, 401 sem token.
- [ ] **Matriz de permissão testada:** `ver` lê a lista e NÃO consegue confirmar, rejeitar, revogar nem copiar (403); `executar` copia, confirma, rejeita e revoga; usuário sem `sispag:*` recebe 403 em tudo; **`GET /sispag/boletos-dda` continua `admin`** (teste existente verde, sem relaxar).
- [ ] Rate limit nas rotas de cópia/confirmar, no padrão de `buildPayeeSearchLimiter`.
- [ ] Nenhuma permissão nova no catálogo (ADR-0053): teste de paridade da 0066 permanece verde.

**Dependencies:** T5

---

### Task 7: Sugestão na aba de títulos (UI) — estende os diálogos existentes
**Files to change:**
- `src/frontend/lib/sispag.ts` (cliente: `fetchSugestoesBoleto`, `confirmarSugestaoBoleto`, `rejeitarSugestaoBoleto`, `copiarLinhaSugestao`; tipos)
- `src/frontend/app/sispag/components/BoletosDoTituloDialog.tsx` e `.test.tsx` (já há `DiferencaBadge`)
- `src/frontend/app/sispag/components/CandidatosBoletoDialog.tsx` (+ teste novo)
- `src/frontend/app/sispag/components/FormaPagamentoBadge.tsx` e `.test.tsx` (o estado "boleto sem DDA" ganha o selo "sugestão disponível" / "confirmado")
- `src/frontend/app/sispag/page.tsx` (carregar/atualizar as sugestões; reaproveitar `ddaDefasado.ts`)
- `src/frontend/app/sispag/components/SugestaoBoletoPainel.tsx` (novo, organismo; ver docs de design system em `src/frontend/docs/`)

**Acceptance criteria:**
- [ ] No título "boleto sem DDA" com sugestão, o diálogo mostra: boleto (número, vencimento, valor), **delta com sinal** em R$, % e dias (boleto − título; "paga a mais"/"vence depois" destacados, nunca só absoluto), sinais de evidência (valor igual, mesmo dia, número igual, emissor confirmado), **tier** (CONHECIDO/FORTE/ATENCAO) e emissor **mascarado**.
- [ ] `ATENCAO` é renderizada com destaque de atenção e a diferença em evidência, sem texto de "seguro"; `VENCIDO_INFORMATIVO` mostra o motivo e **não** exibe botão Confirmar.
- [ ] Usuário com `sispag:ver` vê a sugestão e a evidência, **sem** os botões Confirmar, Rejeitar e Copiar (ocultos, não só desabilitados, e o backend recusa de qualquer forma); usuário com `sispag:executar` vê Confirmar, Rejeitar (pede motivo) e "Copiar linha digitável".
- [ ] "Copiar" chama o endpoint de cópia (auditoria) e só então escreve na área de transferência; falha da API = nada copiado, mensagem em português.
- [ ] Após confirmar, o título mostra "boleto confirmado (emissor X)" **informativo**; o aviso "sem boleto DDA" no lote permanece inalterado (a remessa continua bloqueada até o passo 2; Q8): texto explícito "ainda não associado no ERP".
- [ ] Estado de frescor do DDA (`ddaDefasado`) aparece ao lado da sugestão quando defasado.
- [ ] Estados de carregamento, erro e vazio tratados; acessibilidade (foco no diálogo, rótulos); sem hex hardcoded, tokens do design system.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` (frontend) ✅; **DesignSystemReviewer gate** ✅

**Dependencies:** T6

---

### Task 8: Revogação do par (UI)
**Files to change:**
- `src/frontend/app/sispag/components/ConfirmacoesEmissorPainel.tsx` (novo) + teste
- `src/frontend/app/sispag/page.tsx` (ponto de entrada; só visível com `sispag:ver`, ação com `executar`)
- `src/frontend/lib/sispag.ts` (`fetchConfirmacoesEmissor`, `revogarConfirmacaoEmissor`)

**Acceptance criteria:**
- [ ] Lista os pares `VIGENTE` e `REVOGADA` (credor, emissor mascarado, layout, quem/quando confirmou, evidência resumida); chave completa nunca exibida.
- [ ] Botão Revogar só para `sispag:executar`; exige motivo não vazio; após sucesso, o par some das vigentes e as sugestões do par deixam de ser `CONHECIDO` (voltam a `FORTE`).
- [ ] Par `GENERICO` mostra o selo "não elegível a automático".
- [ ] Erros 404/409/422 com mensagem em português; testes de renderização por permissão.
- [ ] Gates de FE (typecheck, lint, test) e DesignSystemReviewer ✅

**Dependencies:** T7

---

### Task 9: Ontologia para `implemented` + índices
**Files to change:**
- `ontology/entities/confirmacao-emissor-boleto.md`, `ontology/entities/decisao-sugestao-boleto.md`, `ontology/business-rules/sugestao-boleto-dda-sispag.md` (`implementation_status: implemented`, `related_files`, `has_canonical_test: true`)
- `ontology/actions/sispag/{sugerir-boleto-para-titulo,confirmar-sugestao-boleto,rejeitar-sugestao-boleto,revogar-confirmacao-emissor}.md` + a ação de cópia auditada
- `ontology/entities/boleto-dda.md` (regra de candidato em camadas no lugar de "valor exato ±3 dias"; reconciliar a hipótese de I-DDA3 com a medição de 2026-10-13)
- `ontology/_index.json`, `ontology/_coverage.json`
- `ontology/decisions/0068-*.md` (status → implementado, com o que mudou de fato)

**Acceptance criteria:**
- [ ] Cada arquivo aponta para os arquivos reais criados em T1–T8 (verificar que existem: paths conferidos por script/`ls`).
- [ ] `_index.json` lista as duas entidades novas e as rotas; `_coverage.json` atualizado sem regressão de cobertura.
- [ ] `ontology/glossary.md` ganha os termos novos, se ainda não estiverem.
- [ ] Versão da ontologia só muda se o contrato mudou (conferir na main antes: memória "versão colide entre sessões").

**Dependencies:** T1–T8

---

### Task 10: Documentação, CHANGELOG e versão
**Files to change:**
- `CHANGELOG.md`, `src/backend/package.json` e `src/frontend/package.json` (lockstep), docs de SISPAG/`DEPLOY.md` se citarem a regra de candidato

**Acceptance criteria:**
- [ ] Delta contém `feat` em `src/` → bump **minor** FE==BE (provável v0.66.0, **conferir a main no Ship**; `scripts/bump-version.ps1` não roda nesta máquina — aplicar a regra de semver à mão nos dois `package.json`, memória).
- [ ] `CHANGELOG.md` com entrada `feat(sispag)` descrevendo: sugestão em camadas, confirmação de emissor, trilha, e a **mudança de regra** de candidato da aba DDA (antes valor exato ±3 dias).
- [ ] Commit `chore(release): vX.Y.Z` separado; rebase da main limpo e gates ainda verdes.

**Dependencies:** T9

---

## Plano de Validação Ground-Truth

**Slug do validador:** `validate-sispag-sugestao-boleto-dda-v1.ts` (em `src/backend/jobs/`, ao lado de `validate-permuta-centavos-adto-v1.ts`). Executa **depois** do verde da AutoLoopRunner e **antes** do Regis-Review. Não há catálogo `ontology/ground-truths/` neste repo; a fonte é nomeada aqui.

### Premissa honesta: o que tem e o que não tem ground truth

| População | Ground truth | Veredito do plano |
|---|---|---|
| Títulos **recusados/sem flag no ERP** (as ~836 "boleto sem DDA") | **Não existe.** O ERP não diz qual boleto seria o certo; é exatamente o buraco que a feature cobre. | **`SEM_GROUND_TRUTH`** — não se declara taxa de acerto de sugestão nessa população. O que vale é a decisão humana (confirmação) e, no passo 1, a validação ao vivo na remessa (ADR-0040). |
| Títulos **sinalizados pelo ERP** (`tem_boleto = true`, boleto com `docCod/titCod` no pool, ~250) | **Existe:** o boleto que o próprio Conexos associou. | **Gate de sanidade read-only** abaixo. |

Isto **não** prova que a sugestão está certa para os recusados; prova que o motor, quando o ERP sabe a resposta, **não a contradiz** e se comporta de forma coerente com os limites. Está declarado assim no relatório do validador para ninguém ler "100 %" como precisão.

### Gate de sanidade (read-only) sobre títulos sinalizados

- **Fonte:** `titulo_a_pagar` com `tem_boleto = true` e `boleto_dda` com `fil_cod/doc_cod/tit_cod` preenchidos (o boleto que o ERP casou) — somente `SELECT`, em transação `READ ONLY` verificada antes da leitura (padrão do `validate-permuta-centavos-adto-v1`). **Zero** chamadas ao Conexos, zero escrita.
- **Procedimento:** para cada título sinalizado, **desreserva** o boleto que o ERP associou (finge-o livre), mantém o resto do pool como está (com os outros sinalizados ainda reservados) e roda o **`MotorSugestaoBoleto` de produção** (instanciado de verdade, não reescrito no script — "um validador que reescreve a fórmula valida a si mesmo"). Para o tier `CONHECIDO`, o par `(pesCod, emissorChave)` é derivado dos próprios vínculos do ERP **excluindo o título em teste** (leave-one-out), para não vazar a resposta.
- **Classificação por título:**
  - `REPRODUZ` — o motor devolve exatamente o boleto que o ERP associou, em tier `CONHECIDO` (ou `FORTE` quando o credor só tem esse título, sem par leave-one-out possível — reportado em coluna separada);
  - `DIVERGE_OUTRO_BOLETO` — o motor sugere **outro** boleto livre (colisão: MULTILOG, PEDRONI) — gate falhando para análise;
  - `SEM_SUGESTAO` — o motor não sugere nada (ex.: emissor/valor/dia que o limite global não cobre) — reportado, não é falha;
  - `VENCIDO_INFORMATIVO` — boleto do ERP vence antes da data de débito; reportado.
- **Critério de aprovação:** `DIVERGE_OUTRO_BOLETO` = **0** entre os sinalizados com valor + dia exatos (o ERP associou exatamente esse par; um motor que escolhe outro boleto igual-valor-igual-dia só pode estar errado na disputa/desempate). Esses casos de empate real (mesmo valor, mesmo dia, mesmo credor, dois boletos) são listados à parte como `EMPATE_LEGITIMO` (não divergência) **somente** se o motor tratou como ambíguo (sem `FORTE`). O relatório imprime: `N sinalizados → X reproduz (CONHECIDO), Y reproduz (FORTE), Z sem sugestão, W ambíguo legítimo, D diverge` e a lista nominal de `D`.
- **Tolerância:** `D = 0`. `Z` e `W` não falham, mas `X + Y + W + Z` tem de somar N (nada some). Qualquer `D > 0` é P0 e volta ao loop.

### Amostra concreta

Rodar sobre **todos** os sinalizados de PRD (read-only, ~250) — pequeno o bastante para não amostrar — e **destacar nominalmente** estes casos na saída:

1. **NELSON** (+R$ 0,01 em 93/94): sinalizado com boleto de valor igual no ERP; confere o ramo \|Δ\| ≤ R$ 0,05 do mesmo dia (usado no desenvolvimento).
2. **AR SOLUÇÕES** (+1 a +3 dias): confere o ramo "valor igual, 1–5 dias depois" (usado no desenvolvimento).
3. **PEDRONI 34697/1 e ADP 5046/1** (boleto 1 dia DEPOIS, os dois casos de 2026-09-23 que motivaram a janela antiga): confere que a regra nova **continua** cobrindo-os (usados no desenvolvimento).
4. **MULTILOG BRASIL cc 0092740 × MULTILOG S/A cc 0006500** (escopo por emissor, I15g; ~77 títulos de mesmo valor): confere que o par de uma conta **não** promove a outra e que o motor não distribui o mesmo boleto a vários títulos (usado no desenvolvimento).
5. **Caso NÃO usado no desenvolvimento (cego):** sortear com semente fixa **10 títulos sinalizados cujo credor não aparece em nenhum fixture, teste ou nota desta feature** (excluir os 4 acima e qualquer `pesCod` citado nos testes de T2/T3/T5); registrar a semente e os `docCod/titCod` sorteados no relatório para reprodução. Pelo menos 1 deles de banco ≠ 341/237 (chave genérica) se existir no conjunto; se nenhum existir, declarar `SEM_AMOSTRA_GENERICO` em vez de fingir cobertura.

O relatório separa "casos de desenvolvimento" de "casos cegos" para que a taxa dos cegos seja lida à parte.

### Saída e execução

```
cd src/backend && npx tsx jobs/validate-sispag-sugestao-boleto-dda-v1.ts
```

- Imprime o quadro acima, mais: distribuição de `emissorChave` por banco entre os sinalizados (para conferir os 84 % de 341/237 contra a medição de PRD) e a contagem de boletos com barras não parseáveis (`emissor() = undefined`).
- Nunca imprime linha digitável nem barras; só `emissorMascarado`, número do documento e chaves de título.
- **Segurança operacional (memória do projeto):** rodar com `databaseConnectionString` apontando ao banco, **sem** sessão Conexos — o script não usa o Conexos; não deve sequer instanciar `ConexosClient` (evita derrubar sessão viva do robô e a contaminação da sessão `columbia-default`).
- Para a população `SEM_GROUND_TRUTH`: o relatório também imprime a **cobertura** (de ~836 sem flag, quantos recebem sugestão por tier e quantos ficam sem) como número **descritivo**, rotulado `SEM_GROUND_TRUTH`, sem taxa de acerto.

---

## Observabilidade e auto-triggers

- **ObservabilityAdvisor: sim, chamar** (não há handler Lambda nem job novo, mas há **5 rotas novas** e **linhas de auditoria** novas — a trilha `LINHA_COPIADA` é um sinal de segurança). Escopo da consulta: (a) log estruturado por decisão (`sugestao_boleto.decisao` com tier, banco, layout — sem barras), (b) alerta de volume anormal de `LINHA_COPIADA` por usuário/hora, (c) contagem de `OverdueBoletoNotConfirmable`/409 como sinal de dado defasado do DDA, (d) latência de `GET /sispag/sugestoes-boleto` (varre o pool inteiro; ver o teto da T3c).
- **AwsInfraArchitect: não** — não há `infra/` neste repo nem arquivo de Terraform tocado.
- **DesignSystemReviewer: sim** — `src/frontend/` tocado (T3b, T7, T8).
- **PatternGuardian: sim**, no arquivo inteiro (memória: ele revisa o arquivo todo; conferir P0 fora do delta contra a main antes de remediar). Pontos de atenção: SQL parametrizado, `@injectable`, `EnvironmentProvider`, sem `process.env` cru, métodos arrow e export de classe.
- **Regis-Review:** obrigatório após o verde (disparar com `model=sonnet`, conferir a pasta de saída — memória sobre limite em Opus).

## Riscos e ambiguidades detectados

1. **Mudança de regra na aba DDA (T3b)** altera o que o analista admin já vê como "candidato"; o FE e os testes mudam. Mitigação: CHANGELOG explícito e lista dos testes alterados no PR.
2. **Layout das posições de agência/conta (Itaú 341 e Bradesco 237)** precisa ser confirmado contra barras reais do pool de PRD antes de congelar o parser; sem isso `emissorChave` pode agrupar errado. T2 exige barras reais; se o fixture real não estiver disponível, abrir InfoGapBroker P0.
3. **Chave genérica** (`banco:<8 dígitos do campo livre>`) pode colidir entre contas distintas de bancos não verificados; por isso é confirmável por humano mas nunca elegível ao passo 3 (I15i). Aceito.
4. **Unicidade "nos dois sentidos"** (T3c) deixa o comportamento do empate de dois boletos para o mesmo título parcialmente em aberto (`ATENCAO` ambíguo vs. nenhuma sugestão); decidir no TDD e registrar em I15e.
5. **Frescor do DDA:** a sugestão depende do pool local; mostrar `ddaDefasado` (ADR-0067) e reavaliar no confirmar (T5).
6. **Data de débito com lote vs. sem lote (Q-C)** é default revisável; se a Columbia discordar, só a função de resolução da data muda.
7. **Concorrência com sessões paralelas:** migration 0084, versão e CHANGELOG podem colidir; reconferir `origin/main` no rebase.

## Definition of Done

All tasks complete AND:

- [ ] `npm run typecheck` ✅ (backend e frontend)
- [ ] `npm run lint` ✅ (backend; frontend usa `npm run lint`, não `prettier --check`)
- [ ] `npm test` ✅ (backend e frontend), incluindo os testes atualizados de `ConsolidacaoBoletoDda`
- [ ] PatternGuardian gate ✅
- [ ] `entity_changed = true`: diff de ontologia presente e T9 aplicada (`implemented`, `_index.json`, `_coverage.json`) ✅
- [ ] `src/frontend/` tocado: DesignSystemReviewer gate ✅
- [ ] Novas rotas/linhas de auditoria: ObservabilityAdvisor review ✅
- [ ] Critério explícito: regra em camadas **substitui** "valor exato ±3 dias" em `ConsolidacaoBoletoDda`, testes antigos atualizados ✅
- [ ] Critério explícito: aba "Boletos DDA" e `GET /sispag/boletos-dda` continuam **admin-only**; a sugestão segue o modelo `ver` (mascarado) / `executar` (copia, confirma, rejeita, revoga), toda cópia auditada ✅
- [ ] Nenhuma escrita no Conexos em qualquer caminho (testes com spies) ✅
- [ ] Ground-Truth gate: `validate-sispag-sugestao-boleto-dda-v1.ts` executado, `DIVERGE_OUTRO_BOLETO = 0`, população recusada rotulada `SEM_GROUND_TRUTH` ✅
- [ ] Regis-Review gate ran, P0 remediados (P1/P2/P3 → `ontology/_inbox/sispag-sugestao-boleto-dda-regis-followups.md`) ✅
- [ ] Rebase da `main` sem conflito pendente, gates ainda verdes ✅
- [ ] `src/` com `feat`: versão do app bumpada (FE==BE) à mão (sem pwsh) + `CHANGELOG.md` atualizado, commit `chore(release)` ✅
