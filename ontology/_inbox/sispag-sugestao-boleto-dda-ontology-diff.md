## Ontology Diff Proposal — sispag-sugestao-boleto-dda

> **Status: PROPOSTA. Nada foi escrito em `ontology/` além deste arquivo.** Tudo abaixo é `planned`
> até o código entrar (ontologia à frente do código, como na ADR-0065 antes de implementada).
> Versão da ontologia: **0.39.2 → 0.40.0**. Próximo ADR: **0068** (verificado: `ontology/decisions/`
> do worktree e `origin/main` terminam em 0067).
> Fonte: `ontology/_inbox/sispag-sugestao-boleto-dda-interview.md` (seção DECISÕES de 2026-10-14).

---

### Candidate analysis

| # | Candidato | Filtros | Decisão |
|---|---|---|---|
| 1 | Entidade `ConfirmacaoEmissorBoleto` — "os boletos deste emissor pertencem a este credor", chave (`pesCod`, `emissorChave`) | A: 1 cliente, mas conceito universal (o DDA entrega boleto sem beneficiário legível em qualquer pagador; reconhecer o emissor do credor é problema de toda tesouraria). B: estrutura = ontologia, valores = dado. C: estável (DDA/código de barras são regulados pelo Bacen/Febraban). D: nenhuma entidade guarda isso (`FavorecidoAutorizado` autoriza DESTINO TED/PIX, é outro conceito). E: substantivo com estado | **ACCEPT** (universalidade a confirmar com o Francinei, não bloqueante — mesmo precedente da ADR-0065) |
| 2 | Registro por título `DecisaoSugestaoBoleto` (título × boleto, confirmada/rejeitada, delta, sinais, quem/quando) | A/C: idem 1. D: não é duplicata da sugestão (a sugestão é calculada, I-DDA1); é o registro da decisão humana. E: fato histórico imutável | **ACCEPT**. Nome: **não** `SugestaoBoleto`, para não confundir com a sugestão calculada, que continua não persistida |
| 3 | A sugestão em si (par título × boleto livre + evidência + tier) | D: extensão da relação `candidatos` de `BoletoDda`; E: resultado de ação, não entidade | **REJECT-DUPLICATE** — vira action `sugerirBoletoParaTitulo` (cálculo puro) e value object `SugestaoBoleto` na action, **sem** entidade nem tabela |
| 4 | Ações `confirmarSugestaoBoleto`, `rejeitarSugestaoBoleto`, `revogarConfirmacaoEmissor`, `copiarLinhaDigitavel`, `sugerirBoletoParaTitulo` | E: verbos com pré/pós-condições | **ACCEPT** (5 actions) |
| 5 | Máquina de estados própria para a confirmação | só 2 estados (`VIGENTE` → `REVOGADA`), 1 transição | **REJECT-DUPLICATE/overkill** — documentada na entidade; sem `state-machines/*.md` novo (contagem de SM inalterada) |
| 6 | Invariantes I15a–k (confirmação é evidência, zero escrita no ERP, escopo do par…) | A/B/C: estrutura durável | **ACCEPT** → `business-rules/sugestao-boleto-dda-sispag.md` |
| 7 | Troca de hipótese I-DDA3 por fato medido (ERP associa valor exato + dia exato; 0 divergências em ~250) | fato medido, substitui hipótese | **ACCEPT** (edição de `boleto-dda.md`) |
| 8 | Regra candidata "valor exato ±3 dias" → regra em camadas | A/C: o fato medido a justifica | **ACCEPT**, com valores numéricos como parâmetros globais (ver 9) |
| 9 | Valores numéricos: R$ 0,05; 1–5 dias; 1,6 %; R$ 10 | B: valor de limiar, não estrutura | **REJECT-CONFIG** — constantes de código globais (não por tenant, N4 da entrevista), citadas na regra como "valores vigentes", a validar com a Columbia. Sem `RegraNegocioCliente` por ora (1 tenant) |
| 10 | Chave do emissor por layout real só para 341 e 237 | A/C: layout FEBRABAN por banco é estável; cobertura medida 244/290 (84 %) | **ACCEPT** (propriedade `layoutEmissor`); bancos fora = chave genérica `banco + 8 dígitos do campo livre`, **nunca elegível a automático** |
| 11 | Parsing de agência/conta em `CodigoBarrasBoleto` | implementação | **fora da ontologia** (nota de implementação para o TaskScoper) |
| 12 | Segunda pessoa para o par virar automático (passo 3) | A: não visto; C: depende de ADR do passo 3 | **REJECT-PREMATURE** → watchlist; só registrado como restrição de I15 ("passo 3 terá ADR e entrevista próprias") |
| 13 | Bind do código de barras ao item do lote / escrita no Conexos (passo 2) | sem prova HML | **REJECT-PREMATURE** → watchlist; nenhuma action, estado `APLICADO_NO_ERP` ou campo de bind entra agora |
| 14 | Número do documento do fornecedor (`doc_esp_numero`) como critério de decisão | ~50 % de precisão; ADR-0067 já o registra como informativo | **ACCEPT apenas como sinal de apoio**: nunca suficiente (I15f) |
| 15 | "Analistas confirmam de manhã" / hábito de uso, métricas de taxa de confirmação | hábito/KPI, não domínio | **REJECT-NOT-DOMAIN** (métricas vão ao log, ver Q10 da entrevista; não entra no modelo) |
| 16 | Marcar o item do lote como "resolvido" ao confirmar (Q8) | enganaria o analista (a remessa segue barrada, I2) | **REJECT-WORKAROUND** → o aviso "sem boleto DDA" do lote permanece; no máximo informativo na aba de títulos |

---

### Changed files (ACCEPT candidates)

| # | Arquivo | Tipo | Mudança |
|---|---|---|---|
| 1 | `ontology/entities/confirmacao-emissor-boleto.md` | NEW | entidade (planned) |
| 2 | `ontology/entities/decisao-sugestao-boleto.md` | NEW | entidade (planned) |
| 3 | `ontology/business-rules/sugestao-boleto-dda-sispag.md` | NEW | invariantes I15a–k |
| 4 | `ontology/actions/sispag/sugerir-boleto-para-titulo.md` | NEW | action (planned) |
| 5 | `ontology/actions/sispag/confirmar-sugestao-boleto.md` | NEW | action (planned) |
| 6 | `ontology/actions/sispag/rejeitar-sugestao-boleto.md` | NEW | action (planned) |
| 7 | `ontology/actions/sispag/revogar-confirmacao-emissor.md` | NEW | action (planned) |
| 8 | `ontology/actions/sispag/copiar-linha-digitavel.md` | NEW | action (planned) |
| 9 | `ontology/entities/boleto-dda.md` | EDIT | I-DDA3 e regra candidata |
| 10 | `ontology/entities/titulo-a-pagar.md` | EDIT | relação + estado derivado informativo (ver bloco 10) |
| 11 | `ontology/business-rules/boleto-exige-codigo-de-barras.md` | EDIT | "Ver também" + 1 parágrafo: confirmação não é autoridade |
| 12 | `ontology/_index.json` | EDIT | entradas novas + `_meta` |
| 13 | `ontology/_coverage.json` | EDIT | contagens + `_meta` |
| 14 | `ontology/CHANGELOG.md` | EDIT | entrada v0.40.0 |
| 15 | `ontology/glossary.md` | EDIT | 2 termos |
| 16 | `ontology/decisions/0068-sispag-sugestao-de-boleto-confirmacao-de-emissor.md` | NEW | ADR-0068 |
| 17 | `ontology/_inbox/_watchlist.md` | APPEND | passos 2 e 3, 2ª pessoa, bancos fora de 341/237 |

`docs/ontologia.md` **não existe** neste repositório (verificado); `README.md` e READMEs de módulo não
citam BoletoDda/DDA (grep vazio). Sem diff de `docs/` a propor. `CLAUDE.md` diz "20 entities, ~25
actions" (v0.1, já defasado) — fora do escopo, sugiro tratar no `/retro-ontology`.

---

### Diff

#### 1. NEW `ontology/entities/confirmacao-emissor-boleto.md`

```markdown
---
name: ConfirmacaoEmissorBoleto
type: entity
ontology_version: "0.40.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
properties: [id, pesCod, credor, emissorChave, layoutEmissor, bancoEmissor, emissorMascarado, estado, evidencia, confirmadoPor, confirmadoEm, revogadoPor, revogadoEm, motivoRevogacao, versao]
relationships:
  - "ConfirmacaoEmissorBoleto N—1 Favorecido (pesCod no cmn025; sem entidade local, como em TituloAPagar e FavorecidoAutorizado)"
  - "ConfirmacaoEmissorBoleto 1—N DecisaoSugestaoBoleto (as decisões por título que a criaram ou que a usam; o vínculo é lógico por (pesCod, emissorChave), não FK obrigatória)"
  - "ConfirmacaoEmissorBoleto 1—N EventoSugestaoBoleto (trilha só-inclusão; ledger, não entidade de domínio)"
last_review: 2026-10-14
universality_evidence:
  - "Sondagem PRD 2026-10-13: ~836 de ~1090 títulos BOLETO sem DDA associado; o ERP só associa valor exato + dia exato (0 divergências em ~250 associados); o item fin124 não traz beneficiário (15 campos), só o código de barras"
  - "Medição PRD 2026-10-14 (boletos livres × títulos sem flag, candidato único): banco 237 = 162, 341 = 82, 104 = 17, 329 = 14, 422 = 7, 033 = 3 — 341+237 cobrem 244 de 290 (84 %)"
  - "Entrevista 2026-10-14 (decisões Q1–Q5 em ontology/_inbox/sispag-sugestao-boleto-dda-interview.md)"
  - "Conceito universal de contas a pagar no Brasil: o DDA entrega o boleto sem beneficiário legível; reconhecer qual conta emissora pertence a qual fornecedor é o passo que toda tesouraria faz à mão. Estrutura = ontologia; os pares confirmados = dado operacional"
  - "1 cliente apenas: revisar universalidade com o Francinei (não bloqueante, mesmo precedente da ADR-0065)"
---

# ConfirmacaoEmissorBoleto

> **Origem:** ADR-0068 (2026-10-14). Registro de que **os boletos emitidos por uma conta bancária
> (emissor) pertencem a um credor** — afirmado por um analista, com a evidência que ele viu.
> Code-facing: `BoletoIssuerConfirmation` (constante `BOLETO_ISSUER_CONFIRMATION_STATE`). Tabelas
> propostas: `sispag_confirmacao_emissor_boleto` e a trilha compartilhada só-inclusão
> `sispag_sugestao_boleto_evento` (trigger recusa UPDATE/DELETE/TRUNCATE, padrão ADR-0065).
> Regras em `business-rules/sugestao-boleto-dda-sispag.md` (I15).

## O que é e o que não é

- **É** evidência humana e auditada, com escopo exato no par (`pesCod`, `emissorChave`).
- **Não é** autoridade de pagamento. Confirmar **não** torna `temBoleto = true`, não escreve no Conexos
  e não dispensa a validação ao vivo da remessa (`BoletoSemCodigoBarrasError`, ADR-0040). I15a.
- **Não é** a `FavorecidoAutorizado`: aquela amarra um **destino de TED/PIX** do cadastro a duas
  pessoas; esta diz que uma **conta emissora de boleto** pertence a um credor, por uma pessoa.
- **Não é** autorização de valor: não alarga tolerância nenhuma (I15d).

## Propriedades

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | |
| `pesCod` · `credor` | number · string | Credor no `cmn025`; `credor` = snapshot do nome. Sem `filCod` (o emissor é do credor, não da filial). |
| `emissorChave` | string | Banco + agência + conta **derivados do código de barras de 44 dígitos**. Layout real para 341 (Itaú) e 237 (Bradesco), ex. `237:2656:0092740`. Outros bancos: chave genérica `banco:<8 dígitos do campo livre>`. Imutável. |
| `layoutEmissor` | `ITAU_341 \| BRADESCO_237 \| GENERICO` | Como a chave foi derivada. `GENERICO` **nunca** é elegível a automático (I15i). |
| `bancoEmissor` | string | Código FEBRABAN de 3 dígitos. |
| `emissorMascarado` | string | Exibição: banco e agência completos, conta com os 4 últimos dígitos (padrão I14l). A chave completa **não** aparece para quem só tem `sispag:ver`. |
| `estado` | `VIGENTE \| REVOGADA` | **No máximo 1 `VIGENTE`** por (`pesCod`, `emissorChave`) — índice único parcial. `REVOGADA` é terminal; reconfirmar cria **nova** linha. |
| `evidencia` | JSON | Snapshot imutável da decisão que criou o par: título (`filCod/docCod/titCod`, valor, vencimento, `doc_esp_numero`), boleto (`ddcCod`, `ditCod`, `numero`, valor, vencimento, `codbar` mascarado), delta com sinal, sinais usados, tier. Nunca a linha digitável completa. |
| `confirmadoPor` · `confirmadoEm` | string · Date | Pessoa com `sispag:executar`. **Nunca** `sistema` (I15g). |
| `revogadoPor` · `revogadoEm` · `motivoRevogacao` | string? · Date? · string? | Motivo obrigatório. |
| `versao` | number | Lock otimista. |

**Sem expiração.** Vive até ser revogada.

## Estado (2 estados, 1 transição — sem arquivo de state machine)

```
(nenhuma) --confirmarSugestaoBoleto--> VIGENTE --revogarConfirmacaoEmissor--> REVOGADA
```

Cada transição grava um evento na trilha só-inclusão com quem, quando e (na revogação) o motivo.
Confirmar sobre par já `VIGENTE` é no-op e devolve a linha existente (I15j).

## Diferenças para entidades vizinhas

- `FavorecidoAutorizado` (ADR-0065): destino TED/PIX, duas pessoas, fingerprint HMAC. Aqui: emissor
  de boleto, uma pessoa, chave em claro derivada de dado já público no DDA, exibida mascarada.
- `BoletoDda`: espelho somente leitura do pool; a confirmação **nunca** altera o pool.
- `DecisaoSugestaoBoleto`: a decisão **por título**; esta é o **par**.
```

#### 2. NEW `ontology/entities/decisao-sugestao-boleto.md`

```markdown
---
name: DecisaoSugestaoBoleto
type: entity
ontology_version: "0.40.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
properties: [id, filCod, docCod, titCod, pesCod, credor, ddcCod, ditCod, numeroBoleto, codbarMascarado, valorTitulo, vencimentoTitulo, valorBoleto, vencimentoBoleto, deltaValor, deltaPercentual, deltaDias, sinais, tier, emissorChave, decisao, decididoPor, decididoEm, motivo, confirmacaoEmissorId]
relationships:
  - "DecisaoSugestaoBoleto N—1 TituloAPagar (chave filCod/docCod/titCod; vínculo lógico, sem escrita no título)"
  - "DecisaoSugestaoBoleto N—1 BoletoDda (chave ddcCod/ditCod; snapshot — o pool pode mudar)"
  - "DecisaoSugestaoBoleto N—0..1 ConfirmacaoEmissorBoleto (a confirmação que esta decisão criou ou reutilizou; só quando decisao = CONFIRMADA)"
last_review: 2026-10-14
universality_evidence:
  - "Mesmas fontes de ConfirmacaoEmissorBoleto (entrevista 2026-10-14; sondagens PRD 2026-10-13/14)"
  - "Conceito universal: toda conciliação assistida guarda QUEM aprovou QUAL par com QUE evidência (trilha de auditoria)"
  - "1 cliente apenas: revisar universalidade com o Francinei (não bloqueante)"
---

# DecisaoSugestaoBoleto

> **Origem:** ADR-0068 (Q1 = "par + registro por título"). Registro **imutável** de que uma pessoa
> olhou a sugestão (título × boleto) e a **confirmou** ou **rejeitou**. É o ponto de ancoragem do
> passo 2 (bind) e a trilha de auditoria do passo 1. Code-facing: `BoletoSuggestionDecision`.
> Tabela proposta: `sispag_decisao_sugestao_boleto`.

## Propriedades

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | |
| `filCod` · `docCod` · `titCod` | number | Chave do título (a mesma de `TituloAPagar`). |
| `pesCod` · `credor` | number · string | Snapshot do credor do título. |
| `ddcCod` · `ditCod` | number | Chave do item no `fin124`. Snapshot: no passo 2 o boleto é **relido ao vivo**. |
| `numeroBoleto` · `codbarMascarado` | string? · string | `ditEspNumero` do boleto; barras só mascaradas (emissor + últimos dígitos). A linha digitável completa não é persistida. |
| `valorTitulo` · `vencimentoTitulo` · `valorBoleto` · `vencimentoBoleto` | number · Date · number · Date | Snapshot na hora da decisão. Datas como data civil (UTC meia-noite, BRT). |
| `deltaValor` · `deltaPercentual` · `deltaDias` | number · number · number | **Com sinal**, boleto − título (mesma convenção de `diferencaDias`). Mostrados e gravados; **nunca** abençoados pelo par (I15d). |
| `sinais` | lista | Ex.: `VALOR_IGUAL`, `VALOR_ATE_5_CENTAVOS`, `MESMO_DIA`, `DIAS_DEPOIS`, `NUMERO_IGUAL`, `EMISSOR_CONFIRMADO`. |
| `tier` | `CONHECIDO \| FORTE \| ATENCAO` | Derivado na hora da decisão (ver regra I15c). |
| `emissorChave` | string | Chave do emissor derivada do `codbar` do boleto (par com `pesCod`). |
| `decisao` | `CONFIRMADA \| REJEITADA` | Imutável. |
| `decididoPor` · `decididoEm` | string · Date | `sispag:executar`. Nunca `sistema`. |
| `motivo` | string? | Obrigatório em `REJEITADA`. |
| `confirmacaoEmissorId` | string? | Preenchido em `CONFIRMADA`. |

## Unicidade

- No máximo **1 `CONFIRMADA` ativa por título** e **1 por boleto** (`ddcCod`,`ditCod`): índices únicos
  parciais. "Ativa" = o par ainda `VIGENTE` e nem o título nem o boleto ganharam vínculo/baixa no ERP
  (estado derivado, não persistido). Outro boleto para o mesmo título exige revogar o par antes.
- `REJEITADA` é por (título, boleto): esconde **aquele** boleto para **aquele** título; outro
  candidato aparece de novo. Não "envenena" o par do emissor.

## Derivados (não persistidos)

`ATIVA` (confirmada com par vigente e sem vínculo ERP) · `SUPERADA_PELO_ERP` (o Conexos associou o
título a um boleto — o que vale é o ERP) · `PAR_REVOGADO` (par `REVOGADA`: a decisão fica como
histórico, mas não vale para nada no passo 2).
```

#### 3. NEW `ontology/business-rules/sugestao-boleto-dda-sispag.md`

```markdown
---
name: sugestao-boleto-dda-sispag
type: business-rule
entity: ConfirmacaoEmissorBoleto
invariant: I15
ontology_version: "0.40.0"
implementation_status: planned
status: active
owners: [yuri]
related_files: []
last_review: 2026-10-14
has_canonical_test: false
---

# Business Rule: sugestão e confirmação de boleto DDA (I15)

> **Origem:** ADR-0068 (2026-10-14). Passo 1 de 3: **mostrar** ao analista o boleto livre do `fin124`
> que provavelmente é o do título "boleto sem DDA", e **registrar** a decisão dele por
> (credor, emissor). Passo 2 (bind do código de barras ao item do lote, exige prova em HML) e passo 3
> (automático só para pares confirmados) terão **ADR e entrevista próprias** — esta regra não os
> autoriza.

| # | Regra |
|---|---|
| **I15a** | **Confirmação é evidência, não autoridade.** Confirmar um par ou uma decisão não altera `temBoleto`, o lote, o título nem o Conexos. A **validação ao vivo na remessa** (`titVldReflexoDdaAssoc`, ADR-0040, `BoletoSemCodigoBarrasError`) segue sendo a **única** autoridade que move dinheiro. O pool local e qualquer confirmação nunca a substituem. |
| **I15b** | **Zero escrita no Conexos no passo 1:** nenhum `importar`, nenhum `validacao/codigoBarras`, nenhum `titVldReflexoDdaAssoc = 1`, nenhum `cancelar`. As únicas escritas são locais (confirmação, decisão, trilha). |
| **I15c** | **Sugestão calculada em camadas, não persistida** (mesma postura de I-DDA1). Para um título ativo, `forma = BOLETO`, `tem_boleto = false`, o candidato é um boleto **livre** (sem `docCod/titCod`). Tiers, do mais ao menos forte: **`CONHECIDO`** (par (`pesCod`, `emissorChave`) já `VIGENTE` **e** dentro dos limites globais); **`FORTE`** (dentro dos limites globais, candidato único nos dois sentidos); **`ATENCAO`** (fora dos limites, ex.: +1,6 % ou +R$ 10, mostrada com a diferença destacada, **nunca** como segura). Limites globais **vigentes** (parâmetros de código, a validar com a Columbia, não alteram a estrutura): \|Δvalor\| ≤ R$ 0,05 **e** mesmo dia (arredondamento); **ou** valor igual e boleto vencendo de 1 a 5 dias **depois** do título. |
| **I15d** | **A confirmação nunca alarga limite.** O delta (R$, %, dias, com sinal) é exibido e gravado na evidência; cada nova sugestão é reavaliada contra os limites **globais**. Um par confirmado com +R$ 0,01 não autoriza +R$ 10 nem +5 dias. Aprender tolerância por par é decisão do passo 3. |
| **I15e** | **Exclusões.** Não é candidato: (1) boleto vinculado pelo ERP a qualquer título (`docCod/titCod` preenchidos, I-DDA2); (2) boleto "usado" por título que o ERP já sinalizou (`tem_boleto = true` com mesmo valor e dia — o ERP o reservou); (3) boleto já sugerido a **outro** título — um boleto, um título: empate resolve-se por melhor evidência; sem desempate o boleto é `AMBIGUO` e **nada** é oferecido como confirmável; (4) título pago, inativo ou com `forma ≠ BOLETO`. |
| **I15f** | **Número do documento é sinal de apoio, nunca suficiente.** `doc_esp_numero` × `boleto_dda.numero` iguais (dígitos estritos) sobem a confiança, mas sozinhos têm ~50 % de precisão (propriedade do credor: 16 de 35 sempre casam, 18 nunca). Número igual com valor/data muito distantes é **colisão** e não é sugerido como seguro. |
| **I15g** | **Escopo = (`pesCod`, `emissorChave`).** Nunca global, nunca só por credor, nunca só por banco. MULTILOG BRASIL cc 0092740 confirmada **não** cobre MULTILOG S/A (cc 0006500) nem outra conta do mesmo credor. **Quem confirma é sempre uma pessoa** com `sispag:executar`; o sistema nunca confirma, e a segunda pessoa só entra quando o par virar automático (passo 3, ADR própria). |
| **I15h** | **Boleto que vence antes da data de débito nunca é seguro.** Está vencido (juros/multa): nunca `CONHECIDO` nem `FORTE`; no máximo `ATENCAO` com o motivo visível, e **nunca** elegível ao automático. Datas comparadas como data civil (UTC meia-noite, BRT). A data de débito é a do lote quando existe (I8, `data-debito-remessa-sispag`), senão o vencimento do título. |
| **I15i** | **Chave genérica nunca é elegível a automático.** Só 341 e 237 têm layout verificado (`layoutEmissor`). Os demais bancos podem ser sugeridos e confirmados por humano, mas a confirmação carrega `layoutEmissor = GENERICO` e fica **excluída** do passo 3 até o layout ser verificado. Desenhar a chave **como se** o passo 3 confiasse nela (I9 da entrevista). |
| **I15j** | **Idempotência.** Sugerir é puro. Confirmar sobre par `VIGENTE` é no-op (devolve a linha) e, para título/boleto sem decisão ativa, apenas grava a decisão; confirmar o mesmo (título, boleto) de novo devolve a decisão existente. Revogar par não `VIGENTE` e rejeitar (título, boleto) já rejeitado são no-ops. Concorrência: índices únicos parciais; perdedor da corrida relê e devolve a linha vencedora. |
| **I15k** | **Dado sensível por permissão.** `sispag:ver` enxerga a sugestão com o emissor **mascarado** (banco e agência completos, conta com 4 últimos dígitos) e a evidência; **só** `sispag:executar` copia a linha digitável e confirma/rejeita/revoga. Nunca a linha digitável completa em log, ledger, evidência ou mensagem de erro. **Toda cópia é auditada** (evento `LINHA_COPIADA`: quem, quando, título, boleto) — mais estrito que o lote atual (ADR-0053), de propósito. |

## Trilha só-inclusão

Eventos: `PAR_CONFIRMADO`, `DECISAO_CONFIRMADA`, `DECISAO_REJEITADA`, `PAR_REVOGADO`,
`LINHA_COPIADA`. Cada um com quem, quando, chaves envolvidas e (reprovação/revogação) o motivo.
Trigger recusa UPDATE/DELETE/TRUNCATE (padrão ADR-0065, I14j).

## Erros nomeados (sugestão)

| Erro | Onde | HTTP |
|---|---|---|
| `BoletoSuggestionNotAvailableError` | confirmar: boleto deixou de ser livre / título ganhou vínculo desde que a sugestão foi mostrada (anti-TOCTOU) | 409 |
| `BoletoAlreadySuggestedToOtherTitleError` | confirmar: boleto já `CONFIRMADA` para outro título | 409 |
| `IssuerConfirmationReasonRequiredError` | rejeitar/revogar sem motivo | 422 |
| `OverdueBoletoNotConfirmableAsSafeError` | confirmar boleto vencido sem reconhecer o aviso (se a UI exigir) | 422 |

## Ver também

`decisions/0068-*.md` · `entities/confirmacao-emissor-boleto.md` · `entities/decisao-sugestao-boleto.md` ·
`entities/boleto-dda.md` (I-DDA1–3) · `business-rules/boleto-exige-codigo-de-barras.md` ·
`business-rules/favorecido-autorizado-sispag.md` (I14, padrão da trilha e da máscara)
```

#### 4. NEW actions (cinco arquivos; frontmatter no padrão de `revogar-autorizacao-favorecido.md`)

**`ontology/actions/sispag/sugerir-boleto-para-titulo.md`**
```markdown
---
name: sugerirBoletoParaTitulo
type: action
entity: BoletoDda
ontology_version: "0.40.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-14
preconditions:
  - "Usuário com `sispag:ver`."
  - "Título ativo, não pago, `forma = BOLETO`, `tem_boleto = false`."
postconditions:
  - "Devolve 0..N SugestaoBoleto (value object, NÃO persistido): boleto (ddcCod, ditCod, numero, emissor mascarado), delta com sinal (valor R$/%, dias), sinais, tier (CONHECIDO|FORTE|ATENCAO), `ambiguo`, motivo de vencido (I15h)."
  - "Nenhuma sugestão excluída por I15e aparece; boleto contestado por dois títulos sai como AMBIGUO."
side_effects:
  - "Nenhum. Leitura local de `titulo_a_pagar`, `boleto_dda` e das confirmações. Zero chamadas ao Conexos."
---

# sugerirBoletoParaTitulo

ADR-0068 / I15c–f, I15h. Cálculo puro, igual a `candidatos` de `BoletoDda` (I-DDA1): não grava nada.
Mostra o `ddaDefasado` ao lado quando o pool está parado (ADR-0067).
```

**`ontology/actions/sispag/confirmar-sugestao-boleto.md`**
```markdown
---
name: confirmarSugestaoBoleto
type: action
entity: DecisaoSugestaoBoleto
ontology_version: "0.40.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-14
preconditions:
  - "Usuário com `sispag:executar`; identidade do JWT (nunca `sistema`)."
  - "A sugestão (título, boleto) ainda é válida ao vivo-local: boleto livre, título sem vínculo, sem decisão ativa conflitante (anti-TOCTOU, I15e)."
  - "Vencido (I15h) exige reconhecimento explícito do aviso."
postconditions:
  - "1 DecisaoSugestaoBoleto CONFIRMADA com evidência (snapshot, delta com sinal, sinais, tier)."
  - "Se o par (pesCod, emissorChave) não estava VIGENTE: cria ConfirmacaoEmissorBoleto VIGENTE na MESMA transação; se estava, reutiliza (no-op no par)."
  - "Eventos DECISAO_CONFIRMADA (+ PAR_CONFIRMADO quando criou o par)."
  - "temBoleto, lote, título e ERP intactos (I15a, I15b)."
side_effects:
  - "Escrita local apenas."
---

# confirmarSugestaoBoleto

ADR-0068, Q1 (par + registro por título). Idempotente (I15j). A UI mostra o título como
"boleto confirmado (emissor X) — remessa ainda depende do ERP" e **mantém** o aviso do lote.
```

**`ontology/actions/sispag/rejeitar-sugestao-boleto.md`**
```markdown
---
name: rejeitarSugestaoBoleto
type: action
entity: DecisaoSugestaoBoleto
ontology_version: "0.40.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-14
preconditions:
  - "Usuário com `sispag:executar`; motivo obrigatório."
postconditions:
  - "1 DecisaoSugestaoBoleto REJEITADA para (título, boleto): esconde aquele boleto para aquele título."
  - "Evento DECISAO_REJEITADA. O par do emissor NÃO é tocado."
side_effects:
  - "Escrita local apenas."
---

# rejeitarSugestaoBoleto

ADR-0068, Q1. "Este boleto não é deste título" não envenena o par. Outro candidato para o mesmo
título volta a ser sugerido.
```

**`ontology/actions/sispag/revogar-confirmacao-emissor.md`**
```markdown
---
name: revogarConfirmacaoEmissor
type: action
entity: ConfirmacaoEmissorBoleto
ontology_version: "0.40.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-14
preconditions:
  - "Usuário com `sispag:executar` (PROPOSTA — ver Q-A do diff); motivo obrigatório."
  - "Par VIGENTE."
postconditions:
  - "→ REVOGADA, terminal; evento PAR_REVOGADO."
  - "Decisões por título do par ficam como histórico (derivado PAR_REVOGADO); sugestões futuras do par perdem o tier CONHECIDO."
side_effects:
  - "Escrita local apenas. Nada a desfazer no ERP (I15b)."
---

# revogarConfirmacaoEmissor

ADR-0068. Sem expiração: revogar é a única saída de `VIGENTE`. Reconfirmar cria nova linha.
```

**`ontology/actions/sispag/copiar-linha-digitavel.md`**
```markdown
---
name: copiarLinhaDigitavel
type: action
entity: BoletoDda
ontology_version: "0.40.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-14
preconditions:
  - "Usuário com `sispag:executar`."
  - "Boleto presente no pool local (`boleto_dda.codbar`)."
postconditions:
  - "Devolve a linha digitável (derivada de `codbar`) ao navegador do usuário; evento LINHA_COPIADA (quem, quando, título, boleto)."
side_effects:
  - "Escrita local apenas (trilha). A linha completa nunca vai para log nem ledger (I15k)."
---

# copiarLinhaDigitavel

ADR-0068, I15k. Existe para o analista conferir no portal do banco/ERP sem digitar. Auditada a cada
cópia; `sispag:ver` não a vê.
```

#### 5. EDIT `ontology/entities/boleto-dda.md`

**5a. Frontmatter**
```diff
-ontology_version: "0.29"
+ontology_version: "0.40.0"
...
 relationships:
   - "BoletoDda N—1 ArquivoDda (via ddcCod — o arquivo DDA do banco importado no fin124)"
   - "BoletoDda 0..1—1 TituloAPagar (via filCod/docCod/titCod — vínculo gravado PELO CONEXOS na associação do fin015; nunca por nós)"
-  - "BoletoDda 0..N—0..N TituloAPagar (candidatos — SUGESTÃO calculada, não persistida: mesmo valor, vencimento a ±3 dias)"
+  - "BoletoDda 0..N—0..N TituloAPagar (candidatos — SUGESTÃO calculada, não persistida: regra em camadas I15c; só o que o ERP não associou)"
+  - "BoletoDda 0..N—N DecisaoSugestaoBoleto (snapshot por ddcCod/ditCod; decisão humana registrada, ADR-0068)"
-last_review: 2026-09-25
+last_review: 2026-10-14
 universality_evidence:
   ...
+  - "ontology/_inbox/sispag-sugestao-boleto-dda-interview.md — medição PRD 2026-10-13: o ERP associa valor exato + dia exato, 0 divergências em ~250 associados; ~836 de ~1090 títulos BOLETO sem DDA"
```

**5b. Tabela "Situação" — linha `CANDIDATO`**
```diff
-| `CANDIDATO` | Livre, e **um** título aberto tem o mesmo valor (ao centavo) com vencimento a ±3 dias. |
+| `CANDIDATO` | Livre, e **um** título aberto cai nas camadas de I15c (valor ≤ R$ 0,05 e mesmo dia; ou valor igual e 1–5 dias depois), sem estar reservado por título que o ERP já sinalizou (I15e). **Desde a v0.40.0** os limites vêm de `business-rules/sugestao-boleto-dda-sispag.md`; a janela antiga "valor exato ±3 dias" (`JANELA_CANDIDATO_DIAS`) deixa de ser a regra (ela inclui dias ANTES do título, que são vencidos — I15h). |
```

**5c. Invariante I-DDA3**
```diff
-- **I-DDA3 — diferença de vencimento é exposta.** `diferencaDias` = vencimento do boleto −
-  vencimento do título. Os dois casos medidos em 2026-09-23 tinham +1 dia, e o Conexos não associou
-  nenhum dos dois (hipótese: exige vencimento idêntico — não confirmada).
+- **I-DDA3 — diferença de valor e de vencimento é exposta, com sinal.** `diferencaDias` = vencimento
+  do boleto − vencimento do título; `diferencaValor` = valor do boleto − valor do título.
+  **Fato medido (2026-10-13, PRD):** o ERP associa **valor exato e dia exato** — 0 divergências entre
+  ~250 títulos com `titVldReflexoDdaAssoc = 1`. Os dois casos de 2026-09-23 (+1 dia: PEDRONI 34697/1,
+  ADP 5046/1) não foram associados por isso. (Substitui a hipótese "exige vencimento idêntico — não
+  confirmada".) Consequência: tudo o que sobra "sem DDA" é, por construção, o que o ERP **não**
+  consegue associar (centavos, dias, conta emissora desconhecida) — é o território da sugestão.
+- **I-DDA4 — a sugestão tem camadas e decisão humana registrada** (ADR-0068, I15). Ver
+  `business-rules/sugestao-boleto-dda-sispag.md`. I-DDA1 (candidato não é gravado) permanece:
+  a sugestão é calculada; o que se persiste é a **decisão** (`DecisaoSugestaoBoleto`) e o **par**
+  (`ConfirmacaoEmissorBoleto`), nunca o candidato.
```

**5d. Seção "Acesso"**
```diff
 `GET /sispag/boletos-dda` e `POST /sispag/boletos-dda/sincronizar` exigem `admin`: o código de
 barras carrega banco, agência e conta do cedente (mesmo guard das linhas digitáveis do lote).
+
+**Sugestão por título (ADR-0068, planned):** `sispag:ver` vê a sugestão com o emissor mascarado;
+copiar a linha digitável, confirmar, rejeitar e revogar exigem `sispag:executar`. O `GET` de
+sugestões é uma rota **nova** (por título) — não abre o pool inteiro a quem não é `admin`.
```

**5e. Seção "Sincronização", parágrafo "Não há beneficiário"** — acrescentar uma frase:
```diff
 O emissor só se deriva do código de barras (banco + agência + conta). `titulo_a_pagar.doc_esp_numero`
-(0083) guarda o número do documento do fornecedor para confirmar casamentos — não é usado em decisão.
+(0083) guarda o número do documento do fornecedor para confirmar casamentos — **sinal de apoio**
+(I15f, nunca suficiente). Layout real da chave do emissor só para 341 e 237 (84 % dos casos
+medidos); demais bancos usam chave genérica (I15i).
```

#### 6. EDIT `ontology/business-rules/boleto-exige-codigo-de-barras.md`

```diff
 ## Ver também
 
 - ADR-0040 — o boleto vem da associação DDA do ERP
+- ADR-0068 / `business-rules/sugestao-boleto-dda-sispag.md` — a **confirmação de emissor** é
+  evidência humana; **não** faz `temBoletoDda` = true e **não** substitui esta validação (I15a)
 - `ontology/_inbox/sispag-boleto-dda-sondagem.md` — as medições
```
(+ bump `last_review: 2026-10-14`; `ontology_version` inalterado — a regra não muda.)

#### 7. EDIT `ontology/entities/titulo-a-pagar.md`

Não li o arquivo neste ciclo (fora da lista do prompt para edição); a proposta é **só relacional**,
sem nova propriedade persistida:
```diff
 relationships:
+  - "TituloAPagar 0..N—N DecisaoSugestaoBoleto (decisão humana sobre qual boleto livre do fin124 é o deste título; não altera o título, I15a)"
```
e uma linha de texto: *"`temBoleto` continua sendo SÓ o flag do ERP (ADR-0040). Uma confirmação de
emissor ou decisão por título é exibida ao lado (informativo), nunca no lugar do flag."* O maintainer
deve abrir o arquivo e posicionar o trecho; nenhuma propriedade nova.

#### 8. `ontology/_index.json`

`_meta.version`: `"0.39.1"` → `"0.40.0"` (**drift pré-existente:** o `_meta` do `_index.json` ainda diz
0.39.1 enquanto `_coverage.json` e o CHANGELOG dizem 0.39.2; alinhar os dois a 0.40.0) e acrescentar
ao `note` o texto: `v0.40.0 (2026-10-14, ADR-0068, feature sispag-sugestao-boleto-dda): NEW entities ConfirmacaoEmissorBoleto e DecisaoSugestaoBoleto, 5 actions e business rule sugestao-boleto-dda-sispag (I15), todos planned; BoletoDda I-DDA3 passa de hipotese a fato medido e a regra candidata vira camadas.`

```json
// entities (inserir)
"ConfirmacaoEmissorBoleto": {
  "file": "entities/confirmacao-emissor-boleto.md",
  "status": "planned",
  "impl_files": [],
  "resolved_by": ["ADR-0068"],
  "note": "ADR-0068: par (pesCod, emissorChave) confirmado por 1 pessoa (sispag:executar); VIGENTE|REVOGADA; indice unico parcial no vigente; trilha so-inclusao compartilhada; chave derivada do codbar (layout real 341/237, generico nos demais, nunca elegivel a automatico). Evidencia, nao autoridade (I15a). Code: BoletoIssuerConfirmation."
},
"DecisaoSugestaoBoleto": {
  "file": "entities/decisao-sugestao-boleto.md",
  "status": "planned",
  "impl_files": [],
  "resolved_by": ["ADR-0068"],
  "note": "ADR-0068, Q1: registro imutavel por titulo (CONFIRMADA|REJEITADA) com snapshot do boleto, delta com sinal, sinais, tier. Ancora do passo 2. Code: BoletoSuggestionDecision."
},

// actions (inserir; mesma forma de revogarAutorizacaoFavorecido, status "planned", impl_files [], resolved_by ["ADR-0068"])
"sugerirBoletoParaTitulo":     { "file": "actions/sispag/sugerir-boleto-para-titulo.md",     "entity": "BoletoDda",                  "status": "planned", "impl_files": [], "resolved_by": ["ADR-0068"], "note": "Calculo puro, nao persistido (I-DDA1/I15c)." },
"confirmarSugestaoBoleto":     { "file": "actions/sispag/confirmar-sugestao-boleto.md",      "entity": "DecisaoSugestaoBoleto",      "status": "planned", "impl_files": [], "resolved_by": ["ADR-0068"], "note": "Grava decisao + par na mesma transacao; zero escrita no ERP (I15b)." },
"rejeitarSugestaoBoleto":      { "file": "actions/sispag/rejeitar-sugestao-boleto.md",       "entity": "DecisaoSugestaoBoleto",      "status": "planned", "impl_files": [], "resolved_by": ["ADR-0068"], "note": "Por (titulo, boleto); motivo obrigatorio; nao toca o par." },
"revogarConfirmacaoEmissor":   { "file": "actions/sispag/revogar-confirmacao-emissor.md",    "entity": "ConfirmacaoEmissorBoleto",   "status": "planned", "impl_files": [], "resolved_by": ["ADR-0068"], "note": "VIGENTE -> REVOGADA; motivo obrigatorio." },
"copiarLinhaDigitavel":        { "file": "actions/sispag/copiar-linha-digitavel.md",         "entity": "BoletoDda",                  "status": "planned", "impl_files": [], "resolved_by": ["ADR-0068"], "note": "Auditada; so sispag:executar (I15k)." },

// business_rules (inserir)
"sugestao-boleto-dda-sispag": {
  "file": "business-rules/sugestao-boleto-dda-sispag.md",
  "entity": "ConfirmacaoEmissorBoleto",
  "invariant": "I15",
  "status": "planned",
  "has_canonical_test": false,
  "impl_files": [],
  "resolved_by": ["ADR-0068"],
  "note": "I15a-k: confirmacao e evidencia; zero escrita ERP; tiers CONHECIDO/FORTE/ATENCAO; limites globais; escopo (pesCod, emissorChave); vencido nunca seguro; chave generica nunca automatica; linha digitavel por permissao e auditada."
}
```
Em `entities.BoletoDda`: `"note"` ganha o prefixo `"v0.40.0 (ADR-0068): I-DDA3 hipotese -> fato medido; candidato em camadas (I15c); relacao com DecisaoSugestaoBoleto. "`. Em `entities.TituloAPagar`: acrescentar a relação. Estados `state_machines`: **sem mudança**.
`workflows` / `integrations` / `ui_flows`: sem mudança (a tela é extensão do `BoletosDoTituloDialog` — se o maintainer quiser, registrar o `ui_flow` na implementação).

#### 9. `ontology/_coverage.json`

`_meta.version` `"0.39.2"` → `"0.40.0"`, `_meta.generated` `"2026-10-14"`, e prefixo do `note`:
`v0.40.0 (2026-10-14, feature sispag-sugestao-boleto-dda, ADR-0068): +2 entities, +5 actions e +1 business rule, todos planned; ontologia a frente do codigo.`

| Contador (`summary`) | Antes | Depois |
|---|---|---|
| `entities_total` | 25 | **27** |
| `entities_custom` | 25 | **27** |
| `entities_planned` | 5 | **7** |
| `entities_implemented` | 18 | 18 |
| `entities_partial` | 2 | 2 |
| `entities_coverage_pct` | 72 | **67** (18/27) |
| `actions_total` | 37 | **42** |
| `actions_planned` | 6 | **11** |
| `actions_implemented` | 30 | 30 |
| `actions_coverage_pct` | 81 | **71** (30/42) |
| `business_rules_total` | 27 | **28** |
| `business_rules_planned` | 10 | **11** |
| `business_rules_implemented` | 17 | 17 |
| `business_rules_with_tests` | 13 | 13 |
| `state_machines_*` | — | **inalterado** (decisão: sem SM nova) |

`by_entity` (inserir):
```json
"ConfirmacaoEmissorBoleto": { "status": "planned", "actions": ["confirmarSugestaoBoleto", "revogarConfirmacaoEmissor"], "impl_pct": 0, "note": "ADR-0068: ontologia a frente do codigo (planned ate o codigo entrar)." },
"DecisaoSugestaoBoleto":    { "status": "planned", "actions": ["confirmarSugestaoBoleto", "rejeitarSugestaoBoleto"], "impl_pct": 0, "note": "ADR-0068." }
```
`by_entity.BoletoDda`: manter `implemented`; acrescentar `"open_gap": "ADR-0068 a frente do codigo (candidato em camadas e I-DDA4 planned)"` e, para honestidade, o `impl_pct` **cai** do valor atual para o que for (o maintainer decide como nos ciclos anteriores — ex.: v0.25.0 baixou 100→95 "de propósito"). `by_business_rule` (inserir): `"sugestao-boleto-dda-sispag": { "invariant": "I15", "status": "planned", "has_test": false, "note": "ADR-0068." }`.
`health_flags`: nenhuma pergunta P0 aberta ao ontologista; as abertas abaixo (Q-A…Q-F) ficam em `open_gaps_p1`.

> Conferir os totais antes de aplicar (`entities_implemented`+`partial`+`planned` = `total`: 18+2+7 = 27).
> Ações: 30+1 (partial)+11 = 42.

#### 10. `ontology/CHANGELOG.md` (inserir antes da v0.39.2)

```markdown
## v0.40.0 — SISPAG: sugestão de boleto DDA e confirmação de emissor (2026-10-14, ADR-0068)

Feature: `sispag-sugestao-boleto-dda` (`/feature-new`). `entity_changed = true`. **Ontologia à frente
do código** (tudo `planned`). Passo 1 de 3: mostrar a sugestão e registrar a decisão humana; sem
nenhuma escrita no Conexos.

- **NEW entity `ConfirmacaoEmissorBoleto`** (planned): par (`pesCod`, `emissorChave`), `VIGENTE`|
  `REVOGADA`, 1 pessoa (`sispag:executar`), índice único parcial no vigente, trilha só-inclusão,
  evidência em snapshot. Padrão da `FavorecidoAutorizado` (ADR-0065), conceito distinto.
- **NEW entity `DecisaoSugestaoBoleto`** (planned): registro imutável por título (`CONFIRMADA`|
  `REJEITADA`) com snapshot do boleto, delta com sinal, sinais e tier. Ancora do passo 2.
- **NEW business rule `sugestao-boleto-dda-sispag`** (planned, **I15a–k**): confirmação é evidência,
  não autoridade (a validação ao vivo da remessa, ADR-0040, segue única autoridade); zero escrita no
  ERP; camadas `CONHECIDO`/`FORTE`/`ATENCAO` com limites globais; a confirmação nunca alarga
  limite; exclusões (boleto do ERP, reservado, sugerido a outro título); número do documento só
  apoia; escopo (credor, emissor); vencido nunca seguro; chave genérica nunca automática;
  linha digitável por permissão e auditada.
- **NEW actions** (planned): `sugerirBoletoParaTitulo` (puro), `confirmarSugestaoBoleto`,
  `rejeitarSugestaoBoleto`, `revogarConfirmacaoEmissor`, `copiarLinhaDigitavel`.
- **BoletoDda — I-DDA3:** hipótese ("exige vencimento idêntico") vira **fato medido** em 2026-10-13: o
  ERP associa valor exato + dia exato (0 divergências em ~250). Candidato "valor exato ±3 dias" vira a
  regra em camadas (I15c). Novo I-DDA4. I-DDA1 (candidato não persistido) preservado.
- **Rejeitado/adiado** (ver ADR-0068): bind no ERP e automático (passos 2 e 3), segunda pessoa,
  aprendizado de tolerância por par, chave de emissor para bancos fora de 341/237.
- Coverage: entities 25→27 (planned 5→7, 72→67 %); actions 37→42 (planned 6→11, 81→71 %);
  business_rules 27→28 (planned 10→11). State machines inalteradas.
```

#### 11. `ontology/glossary.md` (inserir junto de "Favorecido autorizado")

```markdown
| **Confirmação de emissor** | Registro de que os boletos de uma conta bancária emissora (banco + agência + conta, derivados do código de barras) pertencem a um credor, por **uma pessoa** (`sispag:executar`). Escopo exato (credor, emissor); revogável; **evidência, não autoridade** — a validação da remessa continua ao vivo (entidade `ConfirmacaoEmissorBoleto`, ADR-0068). |
| **Sugestão de boleto** | Boleto livre do pool DDA (`fin124`) proposto para um título "boleto sem DDA", com diferença de valor/dias com sinal e um tier (`CONHECIDO`/`FORTE`/`ATENCAO`). **Calculada, nunca persistida**; o que se grava é a decisão do analista (`DecisaoSugestaoBoleto`, ADR-0068). Não confundir com o vínculo do ERP. |
```

#### 12. NEW `ontology/decisions/0068-sispag-sugestao-de-boleto-confirmacao-de-emissor.md`

```markdown
---
adr_number: 0068
title: SISPAG — sugestão de boleto DDA para título sem associação e confirmação de emissor (passo 1 de 3)
date: 2026-10-14
status: accepted
type: addition
related_entities: [ConfirmacaoEmissorBoleto, DecisaoSugestaoBoleto, BoletoDda, TituloAPagar]
related_actions: [sugerirBoletoParaTitulo, confirmarSugestaoBoleto, rejeitarSugestaoBoleto, revogarConfirmacaoEmissor, copiarLinhaDigitavel]
related_business_rules: [sugestao-boleto-dda-sispag, boleto-exige-codigo-de-barras]
related_state_machines: []
related_integrations: []
continues: [0040, 0065, 0067]
evidence:
  - ontology/_inbox/sispag-sugestao-boleto-dda-interview.md (entrevista + decisões Q1–Q5, 2026-10-14)
  - ontology/_inbox/sispag-sugestao-boleto-dda-ontology-diff.md
  - "medição PRD 2026-10-13: ~836 de ~1090 títulos BOLETO sem DDA; ERP associa valor exato + dia exato, 0 divergências em ~250 associados"
  - "medição PRD 2026-10-14: bancos emissores dos candidatos únicos — 237=162, 341=82, 104=17, 329=14, 422=7, 033=3; 341+237 = 244/290 (84 %)"
---

# ADR 0068: sugestão de boleto DDA e confirmação de emissor

**Branch:** `feat/sispag-sugestao-boleto-dda`. `/feature-new`. `entity_changed = true`.

## Contexto

Após a ADR-0067 o pool `fin124` fica fresco, mas a Columbia ainda vê poucos boletos associados: ~836
de ~1090 títulos BOLETO estão "sem DDA". O ERP associa **só valor exato e dia exato** (medido: 0
divergências entre ~250 associados; a hipótese de I-DDA3 está confirmada). Sobra, portanto, o que o ERP
**não pode** associar: boleto com centavos ou dias de diferença, ou de uma conta emissora que ele não
conhece. O item DDA não traz beneficiário; o emissor só sai do código de barras. Hoje a analista
confere à mão no portal do banco, título a título.

## Decisão

1. **Passo 1 mostra e registra; não escreve no ERP.** A UI sugere, para o título "boleto sem DDA", o
   boleto livre do `fin124` com a evidência (diferença de valor e de dias com sinal, número do
   documento, emissor mascarado) e permite **confirmar** ou **rejeitar**. Nenhuma escrita no Conexos
   (I15b). Passo 2 (bind no lote, prova em HML) e passo 3 (automático só para par confirmado) terão
   ADR e entrevista **próprias**.
2. **A confirmação é evidência, não autoridade (I15a).** O dinheiro continua sendo movido apenas
   pela validação **ao vivo** do envio (ADR-0040). Confirmar não altera `temBoleto` nem tira o aviso
   do lote.
3. **Duas entidades** (Q1): `ConfirmacaoEmissorBoleto` (par `pesCod` × `emissorChave`; vigente/
   revogada; índice único parcial; trilha só-inclusão, padrão ADR-0065) e `DecisaoSugestaoBoleto`
   (por título; confirmada/rejeitada; imutável; snapshot). A sugestão em si **não** é persistida
   (I-DDA1).
4. **Escopo exato e limites globais (Q2).** A confirmação vale para (credor, emissor), nunca mais
   largo, e **nunca alarga** o limite de valor/dias: o delta é mostrado e gravado, não abençoado
   (I15d, I15g).
5. **Uma pessoa, `sispag:executar` (Q3).** Nada move dinheiro no passo 1; a segunda pessoa é
   exigida onde o dinheiro passa a mover sozinho (passo 3). `sispag:ver` vê a sugestão com o emissor
   mascarado; só `executar` copia a linha digitável (auditada), confirma, rejeita e revoga (Q4, I15k).
6. **Chave do emissor (Q5).** Layout real só para 341 e 237 (84 % dos casos medidos); demais bancos
   usam chave genérica (banco + 8 dígitos do campo livre), podem ser confirmados por humano e **nunca**
   são elegíveis a automático até o layout ser verificado (I15i).
7. **Regra em camadas** (I15c) substitui "valor exato ±3 dias": `CONHECIDO` / `FORTE` / `ATENCAO`,
   com limites globais vigentes (≤ R$ 0,05 e mesmo dia; ou valor igual e 1–5 dias depois), a validar com
   a Columbia. Boleto vencendo antes da data de débito nunca é seguro (I15h); número do documento só
   apoia (I15f); boleto do ERP, reservado ou sugerido a outro título sai da disputa (I15e).
8. **`BoletoDda` I-DDA3** troca a hipótese pelo fato medido.

## Não muda

- Nenhuma escrita no Conexos; nenhuma regra da remessa; `BoletoSemCodigoBarrasError` e a validação
  ao vivo (ADR-0040) intactas; vínculo continua sendo do ERP; sincronização do pool (ADR-0067).

## Consequências

- Mais boletos ficam **visivelmente** casados para o analista, sem risco de pagamento errado: o passo 1
  não move dinheiro. O aviso "sem boleto DDA" do lote permanece até o passo 2 existir (honesto).
- Os dados do par e das decisões alimentam o passo 2 (decisão por título → bind) e o passo 3 (par).
  A chave foi desenhada **como se** o passo 3 confiasse nela.
- Custo: 2 tabelas + trilha, uma rota nova de sugestão por título, parsing de agência/conta em
  `CodigoBarrasBoleto` (implementação).
- Risco: confirmação errada vira evidência errada exibida (sem dinheiro). Mitigado por revogação,
  trilha, escopo exato e pela validação ao vivo.

## Rejeitado

- **Persistir a sugestão** (REJECT-DUPLICATE de I-DDA1): candidato muda com o pool e a carteira.
- **Confirmar só o par, sem registro por título** (Q1a): o passo 2 não teria o que ligar.
- **Confirmar o par somente após N instâncias** (Q1c): atrito sem ganho de segurança no passo 1.
- **Par que abençoa tolerância** (Q2b/c): alarga limite em silêncio; fica para a entrevista do passo 3.
- **Duas pessoas já no passo 1** (Q3b): atrito sem dinheiro em jogo; a analista deixaria de usar.
- **Linha digitável só para `admin`** (Q4c): o lote já a entrega a `ver`; mas a **cópia** é auditada.
- **Chave genérica elegível a automático** (Q5b): errada é pior do que ausente — o passo 3 a obedeceria.
- **Marcar o item do lote como resolvido** (Q8): enganaria o analista; a remessa segue barrada.
- **Reaproveitar `FavorecidoAutorizado`**: conceito, chave e quantidade de pessoas diferentes.
```

#### 13. Watchlist (`ontology/_inbox/_watchlist.md`, append)

```markdown
## 2026-10-14 — sispag-sugestao-boleto-dda
- **Passo 2: bind do código de barras ao item do lote** — REJECT-PREMATURE. Precisa de credencial HML
  própria (HML recusa o usuário de produção) e prova de `finItemSispag/validacao/codigoBarras` ou
  `titulosPendentes/importar` + `FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO`. Estado
  `APLICADO_NO_ERP` por instância só entra com a ADR do passo 2.
- **Passo 3: automático para pares confirmados** — REJECT-PREMATURE. Exige segunda pessoa na primeira
  vez que o par vira automático, tolerância por par (Q2c), exclusão de chave genérica (I15i).
- **Layout de emissor para 104, 329, 422, 033** — REJECT-PREMATURE: 34 de 290 casos medidos; revisitar
  se algum passar de ~10 % ou aparecer em outro cliente.
- **Universalidade com o Francinei** — 1 cliente apenas (não bloqueante, como ADR-0065).
```

---

### Rejections to document

Todas **inline** (candidate analysis acima, linhas 3, 5, 9, 11–16, e "Rejeitado" da ADR-0068). Nenhuma
exige ADR separada: o ADR-0068 já carrega as rejeições relevantes. Se o Yuri preferir, a rejeição 16
(marcar o item do lote) merece nota própria no `boleto-exige-codigo-de-barras.md` (já feita no bloco 6).

### Watchlist additions

Ver bloco 13 (passos 2 e 3, bancos fora de 341/237, universalidade).

### ADR needed for accepts? **Sim — ADR-0068** (bloco 12). Decisão-chave: confirmação é evidência, não
autoridade; passo 1 de 3, zero escrita no ERP.

---

### Open questions (restam — nenhuma bloqueia a aplicação do diff, todas bloqueiam a implementação que as toca)

| # | Pergunta | Proposta do ontologista | Bloqueia |
|---|---|---|---|
| **Q-A** | **Quem revoga um par?** As decisões cobrem confirmar/copiar/ver, não revogar. | `sispag:executar` (revogar reduz confiança, é o sentido seguro). Alternativa: só quem confirmou ou `admin`. | action `revogarConfirmacaoEmissor` |
| **Q-B** | **Limites numéricos** (≤ R$ 0,05 e mesmo dia; 1–5 dias depois; destaque a partir de +1,6 % / +R$ 10) são **propostos**, não validados com a Columbia. A entrevista antiga (Q12) falava em `max(R$10; 2 %)`; as DECISÕES a substituíram — confirmar que a intenção é essa. | Constantes de código globais; ajustáveis por ADR curta, sem mudança estrutural. | tiers de I15c |
| **Q-C** | **"Data de débito" quando o título não está em lote.** I15h usa a do lote (I8) ou, sem lote, o vencimento do título. Há título sem lote com data de débito própria? | Usar vencimento do título e dizer isso na UI. | I15h |
| **Q-D** | **Empate: dois títulos disputam o mesmo boleto.** I15e diz "melhor evidência, senão AMBIGUO e nada confirmável". Qual é a ordem de "melhor evidência" (número igual > menor \|Δvalor\| > menor \|Δdias\|)? | Definir na tasks.md; testar com MULTILOG (77 títulos) e NELSON. | I15e |
| **Q-E** | **Revogar o par e decisões já confirmadas no passo 2.** Quando o passo 2 existir, uma decisão cujo par foi revogado antes do bind deve ser recusada no bind? | Sim (derivado `PAR_REVOGADO` já previsto); a regra efetiva fica na ADR do passo 2. | passo 2 |
| **Q-F** | **Confirmar boleto vencido** (I15h): permitir com aviso reconhecido, ou bloquear a confirmação? Proposto: permitir como `ATENCAO`, exigindo reconhecimento; nunca entra no passo 3. | Permitir com aviso. | `OverdueBoletoNotConfirmableAsSafeError` |
| **Q-G** | **Migração/implementação:** parsing de agência/conta em `CodigoBarrasBoleto` (hoje só `paraLinhaDigitavel` e `bancoEmissor`), colunas das 2 tabelas + trilha, rota `GET` nova por título (permissão `ver`). Fora da ontologia — nota para o TaskScoper. | — | TaskScoper |
| **Q-H** | **Métricas** (taxa de confirmação por tier; concordância posterior com o ERP; cobertura sobre as 836): ficam fora do modelo, no log, conforme Q10 da entrevista. | Registrar em tasks.md. | — |
| **Q-I** | **Universalidade** com o Francinei (1 cliente). Não bloqueante. | — | — |

### Honestidade planned × implemented

- **Tudo `planned`:** 2 entidades, 5 actions, a business rule I15, as tabelas e a trilha. Nada existe
  em código. `ontology_version` das 8 novas = `0.40.0`.
- **`implemented` hoje e inalterado:** `BoletoDda` (pool, sincronização, candidato antigo ±3 dias). A
  edição de `boleto-dda.md` é de **texto**: o que o código faz hoje (janela ±3 dias, `JANELA_CANDIDATO_DIAS`)
  diverge da regra em camadas até a implementação — `BoletoDda` fica "implemented com open_gap".
- A mudança de regra de `CANDIDATO` (fim da janela que aceita dias **antes** do título) é
  **comportamental** quando implementada: a aba "Boletos DDA" e `candidatos` mudam. Deve constar nos
  critérios de aceite da tasks.md.

---
Please review and respond:
- **approve** — escrever as mudanças como propostas, criar o ADR-0068, atualizar watchlist
- **edit [arquivo] [instrução]** — modificar antes de escrever
- **reject [motivo]** — bloquear o diff inteiro
- **partial [accept itens …] [reject itens …]** — aceitar alguns, rejeitar outros
