# Proposta — ADR-0068 passo 2: vincular o código de barras confirmado ao item do lote (valor igual)

> **Status:** PROPOSTA para aprovação do maintainer. Nada foi escrito em `ontology/`, código, versões ou
> CHANGELOG. Branch `feat/sispag-passo2-vinculo-codbar`. Base: app v0.67.0, ontologia 0.41.0, último ADR
> 0070. Número sugerido: **ADR-0071** (reconferir `origin/main` antes do ship: versões colidem entre
> sessões paralelas). Ontologia resultante sugerida: **0.42.0** (regra nova + ação nova).
>
> **Entradas lidas:** ADR-0068 (+4 emendas), ADR-0069 (+Emenda 1), regras
> `sugestao-boleto-dda-sispag` (I15a–l) e `boleto-exige-codigo-de-barras` (I16a–h), entidades
> `DecisaoSugestaoBoleto`, `ConfirmacaoEmissorBoleto`, `BoletoDda`, `_watchlist.md`, achados HML
> (`chore/sispag-hml-bind-experimentos:ontology/_inbox/sispag-passo2-hml-achados.md`), e o código:
> `RemessaService` (montagem do import, guarda I16, etapas), `RetiradaCodigoBarrasService`,
> `ConexosSispagWriteClient` (hoje **sem** `validacao`, `confirmaCodigoBarras` nem `PUT finItemSispag`;
> só `listarLinhasDigitaveisDoLote`, `removerItemDoRascunho`, `importarTitulos`),
> `CodigoBarrasBoleto` (`paraBarras` já confere os 3 DVs de campo e o DV geral),
> `AnaliseCodigoBarrasRepetido`.
>
> **Fatos aceitos sem rediscutir** (HML 2026-10-14): `importar` descarta o código; o código só chega ao
> item por `validacao/codigoBarras` → `confirmaCodigoBarras` → `PUT fin015/finItemSispag`; o ERP não
> valida DV nem compara com o título; `vldVinculoDda` continua 0; o `finalizar` recusa pagamento >
> `fin064.totalAberto`; barra de **valor igual** finaliza e a remessa sai (J: barra, valor, data de
> pagamento da barra; "vencimento" do J = data do título). **Escopo decidido pelo maintainer: só valor
> igual.** Acima do título: inviável via SISPAG; abaixo: não testado → fora.

---

## 0. Resumo executivo

1. O passo 2 **não** é "colar a barra no import": é uma **etapa nova da remessa** (`vincular_codbar`),
   entre o `importar` e a guarda I16, que edita o item no rascunho nativo depois de o ERP tê-lo criado
   **sem** código.
2. A **autoridade** de que o boleto é o do título continua humana (decisão `CONFIRMADA`, I15a) mais
   **verificações nossas** (DV, valor em centavos, data) — o ERP não faz nenhuma. A I15a muda de texto:
   a confirmação deixa de ser "só evidência" **para os itens elegíveis com a flag ligada**; a **validação
   ao vivo** deixa de ser "a única autoridade" e passa a ser "a autoridade para o caminho DDA"
   (emenda explícita, §2.3).
3. Rollout em três modos por filial: `off` (default) → `shadow` (calcula e registra, **zero escrita**) →
   `on`. Em PRD, `on` só depois de (a) permissão do robô verificada e (b) 1 título controlado.
4. Falha de ERP **transitória/ambígua** aborta e retoma (nunca retira); falha **determinística** do
   vínculo retira o item pela maquinaria da I16d com motivo novo. Nada vira pagamento a mais do que o
   título aberto.
5. Mudanças de ontologia: **1 regra nova** (`vinculo-codbar-item-sispag`, I17a–l), **1 ação nova**
   (`vincularCodigoBarrasAoItem`), **1 propriedade nova** em `ItemLote`, **emendas** em 4 arquivos,
   **sem entidade nova** e **sem estado novo** em `DecisaoSugestaoBoleto`.

---

## 1. Análise de candidatos (filtros A–E)

Legenda dos filtros: A = universalidade (A1 evidência 2+ clientes/Francinei; A2 outra trading
reconhece; A3 10º cliente), B = ontologia × configuração, C = permanência, D = já modelado, E = ação ×
estado.

| # | Candidato | Filtros | Decisão |
|---|---|---|---|
| 1 | **Regra nova `vinculo-codbar-item-sispag` (I17a–l)**: pré-condições, verificações nossas, sequência, idempotência, fail-closed | A1:N (1 cliente), A2:Y, A3:Y → "dois YES": candidato, **revisão do Francinei não bloqueante** (mesmo precedente da Q-I do ADR-0068); B:onto; C:Y (limitação do ERP é de produto, estável); D:novo (I15/I16 não cobrem escrita); E:regra | **ACCEPT** (NEEDS-FRANCINEI não bloqueante, registrado) |
| 2 | **Ação `vincularCodigoBarrasAoItem`** (entidade `LotePagamento`/`ItemLote`) | E:verbo; D:novo; C:Y | **ACCEPT** |
| 3 | **Propriedade `ItemLote.vinculoCodigoBarras`** `{ origem, decisaoId, codigoMascarado, aplicadoEm }` (a marca visível ao analista; `origem ∈ ERP_DDA \| DECISAO_HUMANA`) | A2:Y; B:onto; D:propriedade antes de entidade | **ACCEPT** (1 migration, §2.2) |
| 4 | **Estado `APLICADO_NO_ERP` em `DecisaoSugestaoBoleto`** (a watchlist previa) | E: aplicação é **por remessa × tentativa**, não da decisão: a decisão sobrevive a lote cancelado e pode ser reaplicada; estado persistido mentiria | **REJECT-WORKAROUND** (ver §7-R1). Em vez disso: evento de trilha + derivado `aplicacao` (não persistido) |
| 5 | **Entidade nova `VinculoCodigoBarras`** | D:duplicata de trilha + `ItemLote.vinculoCodigoBarras` | **REJECT-DUPLICATE** |
| 6 | **Eventos de trilha** `VINCULO_APLICADO`, `VINCULO_SIMULADO`, `VINCULO_FALHOU` na trilha só-inclusão existente `sispag_sugestao_boleto_evento` | D:reaproveita; padrão ADR-0065/0068 | **ACCEPT** (mesma migration) |
| 7 | **`SystemRemovalReason` += `VINCULO_CODIGO_BARRAS_FALHOU`** (retirada determinística pós-import) | D:estende I13j/I16d.4; depende de P0-2 | **ACCEPT condicionado a P0-2** |
| 8 | **Etapa de memória `vincular_codbar`** em `retomada-remessa-sispag` | E:etapa de workflow; D:padrão `limpar_retirados` | **ACCEPT** (emenda) |
| 9 | **Faixa de elegibilidade** (valor igual em centavos; Δdias ∈ [0, +5]) como **constantes de código globais** (mesma postura de I15c) | B:constante global do domínio (limite do R2 do ERP, não preferência do cliente); C:Y | **ACCEPT** (ajustável por ADR curta) |
| 10 | **Lista de filiais e modo (`off/shadow/on`)** | B:valor operacional; não é domínio | **REJECT-CONFIG** → variável de ambiente via `EnvironmentProvider` (§5). A **existência** do modo é citada na regra (I17k); os valores não |
| 11 | **Boleto ACIMA do título** (NELSON +R$ 0,01; 93 de 94) | A:Y; mas sem endpoint viável; C:incerto | **REJECT-PREMATURE** → watchlist + pergunta Columbia/Conexos |
| 12 | **Boleto ABAIXO do título** (deixa saldo em aberto) | não medido; muda a semântica (baixa parcial?) | **REJECT-PREMATURE** → watchlist |
| 13 | **Vincular a decisão tier `ATENCAO`** (humano confirmou valor diferente) | contradiz I15d ("confirmação nunca alarga limite") e o escopo "valor igual" | **REJECT-VOLATILE/escopo** → fora do passo 2 |
| 14 | **Bind automático sem decisão humana** (passo 3) | já REJECT-PREMATURE no ADR-0068 | continua **REJECT-PREMATURE** |
| 15 | **"O ERP não valida o código"** como conhecimento | D:já em I16 (achado HML) e ADR-0069 | **REJECT-DUPLICATE** (só referenciado) |
| 16 | **Tratar a pergunta `FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA…`** | D:já decisão humana no `RemessaService`; independe do bind | **REJECT-NOT-DOMAIN** deste passo (inalterado) |
| 17 | **Hábito "a analista confere no portal do banco"** | — | **REJECT-NOT-DOMAIN** (motivação, não modelo) |

**Defaults aplicados:** reject antes de accept; propriedade antes de entidade; ação antes de workflow;
config antes de ontologia.

---

## 2. Diff de ontologia proposto (antes/depois)

> Convenção: `ANTES` é o texto vigente; `DEPOIS` é o proposto. Frontmatter: `ontology_version: "0.42.0"`,
> `last_review: 2026-10-14` nos arquivos tocados. `implementation_status: planned` em tudo que nasce
> aqui (ontologia à frente do código, como nas ADRs 0068/0069).

### 2.1 NOVO — `ontology/business-rules/vinculo-codbar-item-sispag.md` (invariante I17)

```yaml
---
name: vinculo-codbar-item-sispag
type: business-rule
entity: LotePagamento
invariant: I17
ontology_version: "0.42.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/RemessaService.ts
  - src/backend/domain/service/sispag/VinculoCodigoBarrasService.ts        # novo
  - src/backend/domain/client/ConexosSispagWriteClient.ts
  - src/backend/domain/libs/boleto/CodigoBarrasBoleto.ts
  - src/backend/domain/libs/boleto/AnaliseCodigoBarrasRepetido.ts
  - src/backend/domain/service/sispag/BoletoSuggestionService.ts
last_review: 2026-10-14
has_canonical_test: false
---
```

Corpo (pt-BR):

| # | Invariante |
|---|---|
| **I17a** | **Elegibilidade (todas, ao vivo no momento da remessa).** O item é `modalidade = BOLETO`, está no **rascunho** nativo, o ERP **não** o associou a DDA (`titVldReflexoDdaAssoc = 0` no grid de pendentes lido na remessa; I15e) e existe `DecisaoSugestaoBoleto` `CONFIRMADA`, **não órfã**, para o título, com par `ConfirmacaoEmissorBoleto` `VIGENTE` (I15l garante). Reler a decisão e o boleto **do banco/pool no momento do vínculo**, nunca do cache (`SugestaoBoletoCache`, anti-TOCTOU, I15a). |
| **I17b** | **Valor igual em centavos.** `round(valorBoleto × 100) == round(fin064.totalAberto × 100)`, com `valorBoleto` **decodificado por nós** do código de barras do `fin124` (campo de 10 dígitos / 100) e conferido com o devolvido pelo ERP (`validacao/codigoBarras`). Nunca se compara com `ItemLote.valor` (snapshot da inclusão): o aberto é lido ao vivo. Diferença de 1 centavo = **inelegível** (cai em "acima/abaixo", fora do escopo, REJECT-PREMATURE). |
| **I17c** | **Data.** Com `Δdias = vencimentoBoleto − vencimentoTitulo` (data civil, UTC meia-noite; I15h): **elegível se `0 ≤ Δdias ≤ 5`** **e** `vencimentoBoleto ≥ dataDebito` do lote. Justificativa: a data de pagamento do item **acompanha a barra** (HML #5/#12) e o ERP só exige `dataDebito ≤ min(itsDtaPgto)` (R2, I8); barra com vencimento ≥ título não reduz essa janela. Barra **vencida** (antes da data de débito) ou **antes** do título: inelegível — o `itsDtaPgto` cairia no passado e o R1/R2 do `finalizar` a recusaria, e I15h já a proíbe. `Δdias > 5` é `ATENCAO` (I15c) e fica fora do passo 2. Vencimento **igual** à data de débito é elegível (hoje é pagável). |
| **I17d** | **Verificações são nossas.** Antes de qualquer escrita, e antes do `PUT`: (1) `CodigoBarrasBoleto.paraBarras(linha)` confere comprimento 44/47, DVs de campo e DV geral; (2) código não é arrecadação (inicia por `8`); (3) banco do código = banco informado pelo `confirmaCodigoBarras`; (4) valor decodificado = I17b; (5) data decodificada = `itsDtaPgtoResult` do confirm; (6) `itsMnyVlrPgtoResult == valorBoleto` (**juros e desconto = 0**; qualquer ≠ 0 aborta o item — o ERP soma juros ao valor da barra, HML #4). Qualquer divergência ⇒ item **não vinculado** (I17g). Nenhuma checagem é delegada ao ERP (HML #3). |
| **I17e** | **Sequência por item (rascunho aberto).** `listar item (itsCodSeq vivo)` → `validacao/codigoBarras(47)` → `confirmaCodigoBarras(splitCodBar)` → `PUT fin015/finItemSispag` com **o item lido** alterado em exatamente: `itsNumCodbar` (47), `itsNumBanco`, `bncDesNome`, `itsMnyVlrPgto`, `itsDtaPgto` (vindos do resultado do confirm, conferidos em I17d) → **releitura**. O sucesso é a **observação na releitura** (`itsNumCodbar` igual, banco/nome preenchidos, valor e data iguais ao enviado), não o `200` do `PUT` (mesma postura de I16d.3). `PUT` em **tentativa única, sem retry cego**; a repetição só ocorre depois de nova leitura. O item só é "completo" com `itsNumBanco` e `bncDesNome` (HML #6). |
| **I17f** | **Idempotência e terceiros.** Item que já traz `itsNumCodbar` **igual** ao esperado (comparado em 44 dígitos) e valor/data coerentes = **já vinculado**: nenhuma chamada nova, nenhum evento duplicado (evento único por `(lote, título, decisaoId)`). `itsNumCodbar` **diferente** do esperado, ou valor/data do item diferentes do que gravaríamos, é **edição de terceiro**: não sobrescreve, etapa `indeterminado`, fail-closed (espelho de I16h(b)). Nunca se limpa nem se sobrescreve um rascunho tocado por outra pessoa. |
| **I17g** | **Falha: o que aborta e o que retira.** (1) **Pré-import** (decisão, boleto, DV, valor, data, flag): item inelegível ⇒ comportamento **atual**, `BoletoSemCodigoBarrasError` antes de qualquer escrita (nada muda para o analista). (2) **Pós-import, falha transitória ou ambígua** (timeout, 5xx, resposta ilegível, `PUT` sem releitura conclusiva, leitura incompleta): **aborta** com `VinculoCodigoBarrasIncompletoError` (409), ledger `failed`, rascunho **preservado**; a retomada refaz o item (I17f). **Nunca** vira retirada. (3) **Pós-import, falha determinística** (divergência de I17d depois do `validacao`/`confirma`; recusa de negócio 4xx do `PUT`; código já presente em outro item — I16): o item é **retirado** pela maquinaria da I16d (local primeiro, `DELETE`, releitura) com motivo `VINCULO_CODIGO_BARRAS_FALHOU`, marca de retenção `BloqueioDuplicidade` e aviso (I16f/g) — e a remessa segue com os demais. (decisão P0-2) |
| **I17h** | **Guarda I16 sobre o conjunto final.** Depois do último `PUT` e da releitura, `AnaliseCodigoBarrasRepetido` roda **sobre todos os códigos do rascunho** (DDA + vinculados) e antes do `finalizarLote`. Ordem das etapas: `importar → vincular_codbar → (guarda I16 / limpar_retirados) → finalizar → gerar_remessa`. Antes do `PUT`, o código do item é conferido contra os códigos **já presentes** no rascunho: repetido ⇒ não vincula (I17g(3)). O desempate de I16d.1 **não** consulta a decisão humana neste passo (ver P1-3). |
| **I17i** | **Só em rascunho aberto.** Nunca se vincula em lote nativo `FINALIZADO` (retomada em `gerar_remessa`): o ERP recusa alteração de item de lote não cadastrado (`IMPOSSIVEL_ALTERAR_REGISTRO_NAO_EM_CADASTRO`, verificado para `DELETE`; **assumido** para `PUT`, a provar em HML — §6). Nessa retomada o item sem código cai em I16c (ausência ⇒ aborta). |
| **I17j** | **Privacidade.** A linha digitável completa trafega **só em memória** (leitura do pool → `validacao` → `confirma` → `PUT`). Nunca em log, ledger, evento, evidência ou mensagem de erro; persiste **só o mascarado 5+4** (`AnaliseCodigoBarrasRepetido.mascarar`) em `ItemLote.vinculoCodigoBarras` e no evento. |
| **I17k** | **Modos por filial.** `off` (default): nada muda, I15b vale integral. `shadow`: roda **apenas** as pré-condições e verificações **locais** (I17a–d sobre o pool) e grava `VINCULO_SIMULADO`; **zero** chamada nova ao ERP; o comportamento da remessa é o de `off`. `on`: executa I17e. O kill-switch global `sispagLiveWriteEnabled` derruba também este vínculo. `SISPAG_DDA_ASSOC_ENABLED=false` **não** o desliga (são caminhos distintos). |
| **I17l** | **Vigência da decisão ≠ reversão do pagamento.** Anular a decisão (I15l) ou revogar o par depois do vínculo **não** desfaz o item no ERP: enquanto o lote estiver em rascunho a analista **retira o título do lote** (ação existente) — a tela avisa na anulação que há item vinculado em lote vivo (`flpCod`); depois do `finalizar` vale o cancelamento do lote nativo (já existente). O vínculo registra `decisaoId`, mas nunca "reconfirma" nem altera a decisão. |

### 2.2 EMENDA — `ontology/entities/lote-pagamento.md` (`ItemLote`)

- ANTES: `ItemLote` sem indicação de onde o código de barras veio.
- DEPOIS: nova propriedade em `ItemLote`:

```
vinculoCodigoBarras?: {
  origem: 'ERP_DDA' | 'DECISAO_HUMANA',   // quem fez o código chegar ao item
  decisaoId?: string,                      // DecisaoSugestaoBoleto (só DECISAO_HUMANA)
  codigoMascarado: string,                 // 5+4, nunca o código completo
  aplicadoEm: Date,
  flpCod: number                           // rascunho nativo onde foi aplicado
}
```

e relacionamento `ItemLote N—0..1 DecisaoSugestaoBoleto (a decisão que originou o código; I17)`.
Migration: **uma** (**cinco** colunas nullable em `lote_pagamento_item` + 3 valores novos de `tipo` na trilha
`sispag_sugestao_boleto_evento`). Item sem vínculo = `origem` ausente (legado = `ERP_DDA`
implícito, sem backfill).

### 2.3 EMENDA — `ontology/business-rules/sugestao-boleto-dda-sispag.md` (I15a, I15b, cabeçalho)

- **I15b ANTES:** "Zero escrita no Conexos no passo 1: nenhum `importar`, nenhum `validacao/codigoBarras`, …"
  **DEPOIS:** acrescenta "**… no passo 1.** O passo 2 (ADR-0071, I17) é a única exceção e vive em outra
  regra; este passo continua sem escrita, e a UI do passo 1 nunca dispara I17."
- **I15a ANTES:** "Confirmar … não altera `temBoleto`, o lote, o título nem o Conexos. A validação ao vivo …
  segue sendo a **única** autoridade que move dinheiro."
  **DEPOIS:** "No passo 1 … (igual). **Com o passo 2 ligado (I17k = `on`)** a decisão `CONFIRMADA` passa a
  ser **condição necessária** do vínculo do código ao item, nunca **suficiente**: o vínculo só ocorre
  depois das verificações nossas (I17b–d) e da releitura (I17e). A validação ao vivo (ADR-0040)
  continua a autoridade do caminho DDA."
- Cabeçalho "Passo 2 … terão ADR e entrevista próprias — esta regra não os autoriza" → aponta para I17 e
  ADR-0071 (passo 2 de valor igual); passo 3 continua não autorizado.
- `Ver também` += `business-rules/vinculo-codbar-item-sispag.md`.

### 2.4 EMENDA — `ontology/business-rules/boleto-exige-codigo-de-barras.md`

- **Regra de ausência — ANTES:** `modalidade === 'BOLETO' ∧ ¬temBoletoDda ⇒ BoletoSemCodigoBarrasError`.
  **DEPOIS:** `… ∧ ¬temBoletoDda ∧ ¬(vínculo I17 elegível e executado) ⇒ BoletoSemCodigoBarrasError`.
  Com a flag `off`/`shadow`, o texto antigo vale **literalmente**.
- **Tabela "Não confundir":** nova linha — "BOLETO sem DDA **com decisão confirmada** (valor igual,
  Δdias 0..5), flag `on`" → vínculo I17; fora da faixa → `BoletoSemCodigoBarrasError` com a diferença
  com sinal na mensagem.
- **I16h/I16d.2:** onde diz "depois do import (e, no passo 2 da ADR-0068, depois do `PUT`)" passa a
  referenciar I17e; adiciona-se a ordem de etapas (I17h).
- **Enum `SystemRemovalReason` (I13j):** `+ VINCULO_CODIGO_BARRAS_FALHOU` (condicional a P0-2).

### 2.5 EMENDA — `ontology/state-machines/lote-pagamento.md` e `retomada-remessa-sispag`

- Retomada: `ORDEM_ETAPAS` ganha `vincular_codbar` entre `importar` e `limpar_retirados`. **Etapa só de
  memória** (como `limpar_retirados`: o CHECK da 0049 não a conhece, nada vai ao ledger). A sincronização
  com o ERP devolve `vincular_codbar` quando: rascunho completo ∧ flag `on` ∧ existe item BOLETO sem
  código com decisão elegível (I17a). Sem estado novo de `LotePagamento`; sem transição nova (`L8`
  inalterado).

### 2.6 `DecisaoSugestaoBoleto` e `BoletoDda` — o que NÃO muda

- `decisao` continua `CONFIRMADA | REJEITADA | ANULADA`. **Sem `APLICADO_NO_ERP`** (§1 #4, §7-R1).
- Acrescenta apenas uma seção "Derivados": `aplicacao` (**não persistida**) =
  `NAO_APLICADA | SIMULADA(lote) | APLICADA(lote, flpCod) | FALHOU(motivo)`, lida da trilha + `ItemLote`.
- `BoletoDda` I-DDA2 inalterada: o boleto vinculado **pelo SISPAG** não ganha `docCod/titCod` no
  `fin124` (o ERP não registra vínculo); por isso o pool continua mostrando-o "livre". Para evitar
  reuso: a decisão `CONFIRMADA` já reserva o boleto (índice único), e **a guarda I16 cobre o lote**;
  a lacuna **entre lotes vivos** continua a do ADR-0069 (watchlist R11). **Risco explicitado no ADR**:
  um boleto pago via vínculo reaparece "livre" no pool até o arquivo DDA mudar (§6, V6).

### 2.7 Ação nova — `ontology/actions/sispag/vincular-codigo-barras-ao-item.md`

```yaml
---
name: vincularCodigoBarrasAoItem
type: action
entity: LotePagamento
ontology_version: "0.42.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: [VinculoCodigoBarrasService.ts, RemessaService.ts, ConexosSispagWriteClient.ts]
last_review: 2026-10-14
preconditions:
  - modo da filial = on                                   # I17k
  - item BOLETO no rascunho aberto, sem DDA do ERP        # I17a, I17i
  - decisão CONFIRMADA não órfã, par VIGENTE, relidos ao vivo   # I17a
  - valor igual em centavos; 0 ≤ Δdias ≤ 5; barra ≥ dataDebito # I17b, I17c
  - DV/banco/valor/data conferidos por nós                # I17d
postconditions:
  - item com itsNumCodbar (47), itsNumBanco, bncDesNome, valor e data da barra, observado na releitura
  - ItemLote.vinculoCodigoBarras preenchido (origem DECISAO_HUMANA)
  - evento VINCULO_APLICADO (mascarado)
  - guarda I16 reavaliada sobre o conjunto final
side_effects:
  - escrita no ERP: validacao/codigoBarras, confirmaCodigoBarras, PUT fin015/finItemSispag
  - trilha só-inclusão; LogService mascarado; ledger (etapa de memória)
---
```

Chamada **apenas** de `RemessaService.gerarRemessa` (nunca pela UI do passo 1). Sem permissão nova:
herda `sispag:executar` de quem gera a remessa; a decisão já tem autor próprio (I15g).

### 2.8 Erros nomeados (acréscimo à tabela da regra)

| Erro | Onde | HTTP |
|---|---|---|
| `VinculoCodigoBarrasIncompletoError` | I17g(2): falha transitória/ambígua pós-import; retomável | 409 |
| `VinculoCodigoBarrasDivergenteError` | I17d: valor/data/banco/juros divergentes (dispara retirada I17g(3)); mensagem pt-BR com `docCod/titCod`, valores, Δ com sinal, código **mascarado** | 409 |
| `ItemEditadoPorTerceiroError` | I17f: `itsNumCodbar`/valor/data diferentes do esperado; etapa `indeterminado` | 409 |

### 2.9 Documentação (Parte 9)

`docs/` e `README.md` **não** referenciam I15/I16 fora de `docs/regis-review/*` (relatórios datados,
não se editam). Conferir na implementação: `docs-contexto/03_ontologia_financeiro.md` (menção a
sugestão/passos), `CLAUDE.md` do repo (tabela de frentes/gotchas — nada a mudar além, talvez, de uma
linha em "Gotchas": *vínculo só no rascunho; PUT nunca em lote finalizado*). `_index.json`
(entidades→arquivos: regra e ação novas) e `_coverage.json` (+1 regra, +1 ação, planned) na aprovação.

---

## 3. Regra de elegibilidade exata

**Entrada:** título T (ao vivo: grid de pendentes + `fin064`), decisão D, boleto B (pool `fin124`, vivo),
lote L (data de débito `dataDebito`).

```
elegível(T, D, B, L) =
    modo(filial) ∈ {shadow, on}                                    # on para executar; shadow só simula
  ∧ T.modalidade = BOLETO ∧ T.temBoletoDda = false                 # I15e / ERP não associou
  ∧ D.decisao = CONFIRMADA ∧ ¬orfa(D) ∧ par(D).estado = VIGENTE    # I15l
  ∧ B livre no pool (sem docCod/titCod) ∧ (D.ddcCod, D.ditCod) = chave(B)
  ∧ B.codbar válido (DV campo + DV geral, 44/47, não arrecadação)  # I17d
  ∧ centavos(B.valor) = centavos(fin064.totalAberto de T)          # I17b
  ∧ 0 ≤ dias(B.vencimento − T.vencimento) ≤ 5                      # I17c
  ∧ B.vencimento ≥ L.dataDebito                                    # I17c / I15h
  ∧ tier recalculado agora ∈ {CONHECIDO, FORTE}                    # nunca ATENCAO
```

**Estados da sugestão que qualificam:** só `CONFIRMADA` ativa (não órfã). `REJEITADA`, `ANULADA`,
sugestão sem decisão e `ATENCAO` **não**. O tier é **recalculado** agora (a decisão guarda o do
momento; I15d: nada é "abençoado").

**Por que `[0, +5]` e não "qualquer data ≥ título":**

1. HML #5/#12: a data de pagamento do item **segue a barra**; o J mantém o vencimento do **título**
   no campo "vencimento" e a data da barra em "data de pagamento". Pagar com barra +N dias adia o
   pagamento em N dias relativamente ao que a analista planejou — decisão que a I15c já limitou a 5
   dias para o tier seguro. Reusar o **mesmo** limite global evita criar um segundo número.
2. R2 do ERP (I8): `dataDebito ≤ min(itsDtaPgto)`; barra ≥ título só **aumenta** `itsDtaPgto`, nunca
   quebra a janela. Barra **antes** do título a reduziria (potencialmente abaixo de `dataDebito`).
3. `Δ > 5` já é `ATENCAO` e é explicitamente "nunca segura" (I15c); incluí-lo aqui contradiria I15d.
4. Reversível: alargar é ADR curta + constante; apertar depois de produção é mais caro.

**Barra com vencimento = hoje/passado:** vencida (`< dataDebito`) ⇒ inelegível e não confirmável (I15h/
Q-F); `= dataDebito` ⇒ elegível. Se `dataDebito` for D+1 e a barra vencer D: inelegível (o ERP
recusaria e haveria juros/multa). **Observação:** com `0 ≤ Δ`, o caso "vence antes do débito" só
acontece quando o **título** já vence antes do lote — situação que o título vencido já exclui hoje.

**Valor:** igualdade **exata em centavos**; `0,01` de diferença é inelegível (é o caso NELSON,
inviável). Nenhuma tolerância.

---

## 4. Sequência, falha, idempotência e retomada

### 4.1 Onde entra em `RemessaService.gerarRemessa`

```
criar_lote → importar → [NOVO] vincular_codbar → guarda I16 (retirada.garantir) → finalizar → gerar_remessa
```

- **Pré-import** (`montarItensImport`): o `throw BoletoSemCodigoBarrasError` passa a ter exceção — item
  BOLETO com `temBoletoDda=false` **e** elegível (I17a–d, **só locais**: decisão/pool/DV/valor/data)
  segue para o import com `associarDda = false` e **sem** destino (barra define o destino, como hoje
  para boleto). Item inelegível: erro antigo, antes de qualquer escrita. Modo `shadow`: erro antigo
  + `VINCULO_SIMULADO` com o resultado (elegível/inelegível e o motivo).
- **Pós-import**: para cada item candidato, em série (não paralelo; poucos itens por lote), I17e.

### 4.2 Falhas (matriz)

| Situação | Estado no ERP | Resultado | Retomada |
|---|---|---|---|
| `validacao` OK, `confirma` falha transitório | item sem código | `VinculoCodigoBarrasIncompletoError`, ledger `failed`, rascunho preservado | refaz o item do zero (puro, repetível) |
| `confirma` OK, `PUT` falha/timeout | item sem código **ou** com código (ambíguo) | idem; **a releitura decide**: com código esperado = aplicado; sem código = refaz; código diferente = terceiro | idempotente por I17f |
| `PUT` 4xx de negócio (ex.: banco inválido) | item sem código | determinístico ⇒ **retira** item (I17g(3)), `VINCULO_CODIGO_BARRAS_FALHOU`, avisa | segue com os demais |
| `confirma` devolve juros ≠ 0, valor ≠ aberto, data ≠ barra | item sem código | determinístico ⇒ retira (I17g(3)) | idem |
| Item editado por terceiro (`itsNumCodbar` ≠ esperado, valor/data alterados) | rascunho tocado | `indeterminado`, aborta, nunca sobrescreve | humano decide |
| Código já presente em outro item do rascunho (DDA do ERP de outro título) | — | não vincula; retira o nosso (determinístico) | — |
| Lote nativo já `FINALIZADO` (retomada em `gerar_remessa`) | finalizado | não vincula (I17i); item sem código ⇒ aborta (I16c) | cancelar lote (existente) |
| Boleto pago por outro canal entre a confirmação e a remessa | `fin124`/DDA mudou | pool relido: boleto não livre ⇒ inelegível (I17a) ⇒ erro antigo | — |

### 4.3 Interações

- **I16 (guarda/retirada):** roda **depois** do vínculo, sobre o conjunto final (I17h). Item vinculado
  que seja repetido de outro item é retirado pela regra de sempre (I16d.1), com evento e marca; o
  vínculo desse item **não** é desfeito antes (o `DELETE` remove o item). A analista não vê "vinculado
  e retirado" como sucesso: o evento da retirada sobrepõe o `VINCULO_APLICADO` na tela.
- **Ledger:** `vincular_codbar` é etapa **de memória** (como `limpar_retirados`): não há migration no
  CHECK da 0049. O `setEtapa(key, 'finalizar')` continua gravado **antes** da guarda, o que mantém a
  retomada passando por `sincronizarComErp` → `vincular_codbar`.
- **Lote local `FINALIZADO` (L8):** o vínculo **não** é uma segunda exceção à máquina de estados: só
  atua em rascunho nativo aberto, e o lote local ainda está em transição para FINALIZADO. `versao` do
  lote incrementa ao gravar `ItemLote.vinculoCodigoBarras`.
- **Item editado antes da remessa pelo analista no lote local (TED/PIX → BOLETO):** a modalidade é
  decidida antes do import; o vínculo só considera o que está BOLETO no momento.

### 4.4 O analista vê e reverte

- **Antes:** no `LoteCard` e na aba Títulos, selo "boleto será vinculado na remessa (confirmação de
  <pessoa>, <data>)" — derivado (elegibilidade local I17a–d), **nunca** promete (a remessa relê).
  Inelegível por faixa: o motivo e o Δ com sinal.
- **Durante/depois:** selo persistente "vinculado por confirmação · barra 12345…6789 · R$ x · paga em
  dd/mm" a partir de `ItemLote.vinculoCodigoBarras`; aviso de resultado em `avisos` (padrão I16f) para
  a automação diária não tratar "tudo certo" quando houve vínculo/retirada.
- **Reverter:** (a) lote em rascunho: "Retirar do lote" (existente) — o título volta ao pool; a
  decisão continua `CONFIRMADA`; (b) não quer mais usar a confirmação: "Anular confirmação" (I15l) —
  a tela avisa se há item vinculado em lote vivo; (c) lote já finalizado: cancelamento nativo do lote
  (existente). **Não** se cria "desfazer vínculo" no ERP (editar o item de volta é escrita nova não
  provada; retirar o item é o caminho já verificado).

---

## 5. Rollout e flag

**Configuração (via `EnvironmentProvider`, nunca `process.env` em serviço):**

```
SISPAG_BIND_CODBAR_FILIAIS = "1:shadow,2:shadow,7:off"     # CSV filCod:modo; ausente/vazio = off em todas
SISPAG_BIND_CODBAR_FAIL    = "closed"                      # (fixo) valor inválido = off
```

- Modo desconhecido, filial ausente ou parse inválido ⇒ **off** (fail-closed).
- `sispagLiveWriteEnabled=false` ⇒ off em tudo (kill-switch existente). Não se reusa
  `SISPAG_DDA_ASSOC_ENABLED` (semântica diferente).
- **Escalada recomendada:** HML `on` (todas) → PRD `shadow` em todas as filiais 1 semana (mede
  elegibilidade real: quantos dos ~836 "sem DDA" confirmados caem na faixa de valor igual) → PRD `on`
  em **uma** filial com 1 título → ampliar. Em PRD **nunca** `on` sem V-PRD1 e V-PRD2 (§6).
- **Dry-run:** `shadow` **é** o dry-run (zero escrita no ERP; só trilha local). Um endpoint de leitura
  `GET /sispag/lotes/:id/vinculos-previstos` (sispag:ver) devolve a previsão por item, sem linha
  digitável.
- **Observabilidade:** `LogService` com contadores `elegiveis/vinculados/retirados/abortados` por
  remessa (mascarado), mais o evento de trilha; sem métrica nova no modelo (Q-H do ADR-0068).

---

## 6. Risco de PRD e plano de verificação

### 6.1 Provar em HML (escrita; credencial própria; ver memória "HML recusa usuário de produção")

| ID | O que provar |
|---|---|
| V1 | Sequência completa **no client de produção** (não só no probe): ≥ 3 itens no mesmo lote, 1 DDA do ERP + 2 vinculados, guarda I16 sobre o conjunto, `finalizar`, `gerarRemessa`, decodificação do `.REM` (J com a barra/valor/data). |
| V2 | **Idempotência:** repetir o `PUT` com o mesmo payload (200 e item igual); `PUT` num item já com a barra. |
| V3 | **Terceiro:** editar o item por outro caminho entre a leitura e o `PUT`; o que a releitura mostra. |
| V4 | **Modalidade/forma de lançamento:** após o `PUT`, o item é "boleto outro banco" (modalidade 7) vs "mesmo banco" (6)? O `.REM` leva o segmento J certo para banco emissor ≠ banco pagador (237 com conta 341)? O ERP deriva isto na associação DDA; no `PUT` **não** sabemos. |
| V5 | `PUT` em lote **FINALIZADO** (I17i assumido). |
| V6 | O pool `fin124` depois do pagamento por vínculo: o boleto reaparece livre? (risco de reuso entre lotes). |
| V7 | Barras com layout de 237/104/329 (não só 341): `validacao` e `confirma` com as barras reais do pool, `splitCodBar` correto. |
| V8 | Título com desconto/acréscimo no `fin064` (aberto ≠ valor): comparação por `totalAberto`. |
| V9 | Barra com vencimento = `dataDebito` e = título + 5 dias: R1/R2 do `finalizar`. |

### 6.2 Sonda **somente leitura** em PRD

- Permissões do robô CLONEX para `fin015/finItemSispag` **list** (já usado) e, se o ERP permitir sem
  efeito, para `validacao/codigoBarras` e `confirmaCodigoBarras` num rascunho existente. **Não** é
  prova de `PUT`. Precedente de risco: permissão `fin010` do robô (memória). Preferir pedir à
  Conexos/Columbia a **matriz de permissões do robô para o programa `fin015`** a sondar às cegas.
- Medição `shadow` em PRD (§5): distribuição real de elegibilidade e quantos candidatos o ERP já
  associaria. Isto **não** exige escrita.
- Probe local derruba sessão Conexos de PRD (memória): rodar com cuidado/fora do horário, `shadow`
  usa só dados locais, **não** sessão.

### 6.3 Precisa da Columbia / Conexos

- **V-PRD1:** o robô tem permissão de `PUT fin015/finItemSispag` em PRD? (não verificável sem escrever).
- **V-PRD2:** **um** título real, valor igual, confirmado por uma pessoa, com remessa que pagará
  de verdade: consentimento da Columbia e acompanhamento do retorno `.RET` (D+1) — trilha dos testes
  em PRD da memória (BD no dia seguinte, `00` em D+1).
- **Pergunta Conexos/Columbia (fora do passo 2):** como registrar acréscimo no título para boleto
  acima do aberto (NELSON +R$ 0,01).
- **Columbia:** confirmar que pagar na **data da barra** (até +5 dias do título) é o desejado.

---

## 7. Alternativas rejeitadas

| # | Alternativa | Categoria | Razão |
|---|---|---|---|
| R1 | Estado persistido `APLICADO_NO_ERP` na decisão | REJECT-WORKAROUND | A aplicação é por remessa × tentativa; lote cancelado reaplica. Mentiria. Fica derivado + trilha. |
| R2 | Enviar a barra no payload do `importar` | REJECT-WORKAROUND | O ERP descarta (HML #1). |
| R3 | Confiar em `validacao/codigoBarras` para validar DV/valor | REJECT-WORKAROUND | É só decodificador (HML #3). |
| R4 | Aceitar valor ≠ título (+R$ 0,01, juros) | REJECT-PREMATURE | O `finalizar` recusa; nenhum campo do item/título destrava (HML #7, #9, #10). |
| R5 | Alterar o `.REM` depois de gerado (injetar a barra no J) | REJECT-WORKAROUND | Arquivo diverge do item do ERP; quebra o casamento do retorno e a baixa. |
| R6 | Vincular na **formação** do lote local (antes do ERP) | REJECT-NOT-DOMAIN | O item nativo não existe; o código vive no ERP. Só a remessa tem o rascunho. |
| R7 | Retirar o item em **qualquer** falha | REJECT-WORKAROUND | Falha transitória retiraria títulos bons; "leitura incompleta nunca vira retirada" (I16c). |
| R8 | Flag só global | REJECT-VOLATILE | O gate de go-live da primeira remessa por filial já é por filial (memória: filial 7). |
| R9 | `ATENCAO` vinculável com confirmação | REJECT-PREMATURE | I15d; escopo "valor igual". |
| R10 | Nova entidade `VinculoCodigoBarras` | REJECT-DUPLICATE | Trilha + `ItemLote`. |
| R11 | Nova permissão `sispag:vincular` | REJECT-PREMATURE | Quem confirma já é `sispag:executar` (I15g); não há ação do analista nova. Reavaliar no passo 3. |
| R12 | Segunda pessoa para o vínculo | REJECT-PREMATURE | Passo 3 (par automático); aqui há confirmação humana por título. |

---

## 8. Perguntas ao maintainer

### P0 (bloqueiam o desenho; a implementação pode começar com o default se aprovado)

| # | Pergunta | Default recomendado |
|---|---|---|
| **P0-1** | **Autoridade (I15a):** aceitar que, com a flag `on`, a decisão humana `CONFIRMADA` + verificações nossas basta para vincular o código **sem** associação DDA do ERP, emendando I15a ("validação ao vivo = única autoridade" vira "autoridade do caminho DDA")? | **Sim**, nos limites I17 (valor igual, Δ 0..5, decisão não órfã, releitura). |
| **P0-2** | **Falha pós-import determinística:** retirar o item pela I16d (novo motivo `VINCULO_CODIGO_BARRAS_FALHOU`, marca de retenção, remessa segue) **ou** abortar a remessa inteira? Transitória/ambígua **sempre aborta e retoma**. | **Retirar** o determinístico; abortar o transitório. (Abortar tudo trava a remessa do dia por 1 título; retirar tudo viola I16c.) |
| **P0-3** | **Primeiro `on` em PRD:** aceitar 1 título real e controlado (escrita real no rascunho PRD + remessa que paga), em filial com remessa já validada, após V1–V9 em HML e permissão do robô verificada? | **Sim**, nessa ordem; `shadow` em PRD antes. Sem V-PRD1 resolvido o código sobe em `off`/`shadow`. |

### P1 (decidir antes do ship; default aplicado)

| # | Pergunta | Default |
|---|---|---|
| P1-1 | Faixa de data: `0 ≤ Δ ≤ 5` e `barra ≥ dataDebito` (§3). Alargar? | Manter; mesma constante da I15c. |
| P1-2 | `shadow` visível ao analista (selo "será vinculado") ou só log/endpoint? | Selo derivado só em `on`; `shadow` só endpoint + log. |
| P1-3 | Desempate I16d.1: preferir o título com decisão humana confirmada quando exatamente um do grupo (follow-up P1-1(b) do ADR-0069)? Hoje, com o vínculo, um título vinculado pode ser retirado em favor de outro por menor vencimento. | **Implementar junto**: quando houver exatamente um título com decisão vigente no grupo, ele fica. |
| P1-4 | Persistir `ItemLote.vinculoCodigoBarras` em coluna (recomendado) ou só ler da trilha? | Coluna (3 nullable, 1 migration). |
| P1-5 | `GET .../vinculos-previstos` no passo 2 ou depois? | No passo 2 (é o dry-run visível). |
| P1-6 | Universalidade com o Francinei (Q-I, não bloqueante). | Registrar na watchlist. |

---

## 9. Arquivos que mudariam e esboço de tarefas

### Ontologia (após aprovação)

- NOVO `ontology/business-rules/vinculo-codbar-item-sispag.md` (I17a–l)
- NOVO `ontology/actions/sispag/vincular-codigo-barras-ao-item.md`
- EMENDA `ontology/business-rules/sugestao-boleto-dda-sispag.md` (I15a, I15b, cabeçalho, ver também)
- EMENDA `ontology/business-rules/boleto-exige-codigo-de-barras.md` (ausência, tabela, I16d.2/h, enum I13j)
- EMENDA `ontology/entities/lote-pagamento.md` (`ItemLote.vinculoCodigoBarras`, relacionamento)
- EMENDA `ontology/entities/decisao-sugestao-boleto.md` (derivado `aplicacao`; sem estado novo)
- EMENDA `ontology/state-machines/lote-pagamento.md` (etapa `vincular_codbar`)
- `ontology/_index.json`, `_coverage.json`, `_inbox/_watchlist.md` (acima/abaixo do título; universalidade;
  desempate; retirada de "passo 2" de REJECT-PREMATURE)
- NOVO `ontology/decisions/0071-sispag-vinculo-codbar-ao-item-valor-igual.md` (+ ADR de rejeição curta
  para R1 só se o maintainer quiser; R1 cabe como "Rejeitado" dentro da 0071)

### Código (TaskScoper decide; esboço)

1. `ConexosSispagWriteClient`: `validarCodigoBarras`, `confirmarCodigoBarras`, `editarItemDoRascunho`
   (Zod nas respostas; tentativa única; header `cnx-filcod` = filial do lote), mais
   `lerItemDoRascunho` (a linha completa do `list`, hoje só chaves/códigos).
2. `VinculoCodigoBarrasService` (novo): elegibilidade pura (`ElegibilidadeVinculoCodigoBarras`, função
   pura testável sobre centavos/datas), executor da sequência, releitura, eventos.
3. `RemessaService`: exceção no `throw BoletoSemCodigoBarrasError`; etapa `vincular_codbar`;
   `sincronizarComErp` reconhece o rascunho a vincular; resultado ganha `vinculados`.
4. `RetiradaCodigoBarrasService`: motivo novo + desempate P1-3.
5. Repositório/migration: colunas de `ItemLote`, tipos de evento da trilha.
6. `EnvironmentProvider`/`EnvironmentVars`: `SISPAG_BIND_CODBAR_FILIAIS` (parse fail-closed).
7. Rota `GET /sispag/lotes/:id/vinculos-previstos` + selos no `LoteCard`/aba Títulos
   (DesignSystemReviewer).
8. Testes: unidade da elegibilidade (valor ±1 centavo, Δ −1/0/5/6, barra = débito/ontem, ATENCAO,
   órfã, par revogado); do serviço com fakes (transitório × determinístico × terceiro × já aplicado);
   integração Postgres (colunas/trilha); contrato do client contra respostas gravadas do HML;
   `RemessaService` fim a fim com `fin015` simulado; guarda I16 sobre conjunto misto.
9. Ground truth: script read-only `validate-sispag-vinculo-codbar-v1.ts` (compara, em HML, o item
   relido com a decisão e o `.REM` decodificado).
10. Regis-Review reduzido (delta + ~4 QAs: fault-tolerance, security, integrability, testability).

**Versão sugerida do app:** feat ⇒ minor (0.68.0), lockstep FE/BE, CHANGELOG; reconferir `main`.

---

## 10. Decisão solicitada

- **approve** (com os defaults de P0/P1) · **edit [item]** · **partial [...]** · **reject [motivo]**
- A resposta aos **P0-1..3** libera a entrevista curta (`/feature-new` já cobre o resto) e o diff final
  de ontologia; **nada** foi escrito fora deste arquivo.
