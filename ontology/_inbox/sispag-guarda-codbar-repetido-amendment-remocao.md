# Proposta de emenda — ADR-0069 / I16: de "abortar" para "retirar automaticamente"

> **Status: PROPOSTA, aguardando aprovação do Yuri.** Nenhum arquivo da ontologia foi alterado.
> Branch `fix/sispag-guarda-codbar-repetido`. `/feature-tweak`. `entity_changed = true`.
> Base: I16a–e (commit b306719), ADR-0069, ADR-0063 (I13g), ADR-0065, I13j (modo `RETIRAR`).

## 0. Resumo executivo

A decisão nova inverte a semântica de I16d: em vez de abortar e devolver a decisão à analista, a
solução **retira sozinha** os itens que repetem o código de barras (mantém um por código) e **segue**
a remessa, com a analista informada. Isto é coerente com o precedente I13j (retirada pelo sistema,
ator `sistema`, motivo na trilha), mas tem **três pontos que o I13j não resolve** e que exigem decisão:

1. **O lote local já está `FINALIZADO` quando `gerarRemessa` roda** e `removerItemPeloSistema` só
   age em `RASCUNHO` (`LotePagamentoRepository.ts:822`; teste `:679`). Retirar ali é uma exceção à
   máquina de estados do lote. (P0-1)
2. **A retirada precisa de uma marca que impeça o laço** (formação/remessa seguinte pegaria o
   título e bateria no mesmo boleto). O I13j não tem essa marca (`PendenciaCadastro` foi removida na
   ADR-0065), e o `BloqueioDuplicidade` tem condição de encerramento errada para este caso. (P0-2)
3. **Retirar um título é, financeiramente, "não pagar uma dívida real hoje".** A regra do "qual fica"
   é determinística, não é verdade financeira (no caso PEDRONI os títulos têm mesmo valor e mesmo
   vencimento; quem decide é o menor `docCod`). Por isso a notificação e a fila de retidos não são
   opcionais. (P1-1)

## 1. Análise de candidatos (Filtros A–E)

| Candidato | Resultado | Decisão |
|---|---|---|
| I16d passa de "aborta" a "retira e segue" | A:Y (qualquer trading com DDA 1:N), B:onto (semântica da regra), C:Y (estrutura do ERP, estável), D:existente (I16), E:ação | **ACCEPT** (emenda de I16d) |
| Retirada pelo sistema nasce **local primeiro, ERP depois** | A:Y, C:Y, E:ação | **ACCEPT** (invariante de I16d) |
| Marca de retenção do título retirado | A:Y, D:**existente** (`BloqueioDuplicidade`), E:estado | **ACCEPT como extensão** de `BloqueioDuplicidade` (discriminador `origem`), não entidade nova |
| Resume: "resíduo de retirada do sistema" não é intruso | A:Y, D:existente (regra de intrusos em `RemessaService`) | **ACCEPT** (nova etapa `limpar_retirados`) |
| Aviso no `LoteCard` + fila de retidos | A:Y, B:onto (o evento) / UI fica fora da ontologia | **ACCEPT** o evento na trilha; o desenho da UI é task |
| Persistir o código de barras (hash/HMAC) para cobrir entre lotes | A:?, C:volátil | **REJECT-PREMATURE** (segue no watchlist, §6) |
| Nova entidade `RetiradaPorCodigoRepetido` | D:duplica trilha + `BloqueioDuplicidade` | **REJECT-DUPLICATE** |
| Reusar `PendenciaCadastro` | entidade removida (ADR-0065) | **REJECT-DUPLICATE** |
| Reusar `AlertaItemLote` como marca | A:N: a alerta é por-lote e morre com o item | **REJECT-WORKAROUND** |
| Item BOLETO **sem código legível** após import também é retirado | A:?, instrução do mantenedor, mas é **suposição** minha de escopo | **NEEDS-CONFIRMATION** (P0-3); redigido abaixo como cláusula separada |

## 2. Antes / depois

### 2.1 I16d — semântica (arquivo `ontology/business-rules/boleto-exige-codigo-de-barras.md`)

**ANTES (I16d, trecho da tabela):**

```
| **I16d** | **Semântica do aborto.** Aborta **antes de `finalizarLote`**; o ledger de idempotência da
remessa é marcado `failed` com motivo e títulos; o **rascunho nativo permanece** e a retomada o
**reaproveita**. A solução **não decide** qual título fica com o boleto (julgamento financeiro,
human-in-the-loop) e **não descarta item em silêncio**: a analista tira o título repetido do lote
**local** (RETIRAR) e gera de novo. |
```

**DEPOIS:**

```
| **I16d** | **Retirada automática (emenda, ADR-0069 §Emenda 1).** Achada a repetição (I16a) ou item
sem código legível (I16c, cláusula "ausência" abaixo), a solução **retira** os itens ofensores e
**continua a remessa com o restante**. Nunca em silêncio: a analista é informada (I16f). Valem: |
```

E as sub-invariantes novas, inseridas logo após I16d (letras novas; nada é renumerado):

```
| **I16d.1** | **O que sai, o que fica.** Por grupo de itens BOLETO com o mesmo código normalizado de
44 dígitos, **fica exatamente um** e **saem os demais**. O que fica é o que a regra determinística
de disputa já usa: **menor `vencimento`, depois menor `docCod`, depois `filCod`, depois `titCod`**
(comparação numérica onde o campo é numérico). É heurística de desempate, **não** juízo financeiro
sobre qual dívida o boleto de fato quita; a retirada é reversível (I16g). **Nunca** se retira o
item que fica. |
| **I16d.2** | **Cláusula de ausência (SUPOSIÇÃO a confirmar, P0-3).** Item `modalidade = BOLETO` que,
**depois do import** (e, no passo 2 da ADR-0068, depois do `PUT`), segue sem código legível
(ausente, ou descartado pela leitura por DV inválido/tamanho incorreto: I16c) **também é retirado**.
Não há "o que fica": não há grupo. A retirada dele restabelece a comparabilidade que I16c exigia
(o código ilegível não está mais no lote); I16c deixa de "abortar" e passa a "retirar". |
| **I16d.3** | **Local primeiro, ERP depois.** Para cada item a retirar: (1) numa transação local,
remover o item do lote local, criar a marca de retenção (I16g) e gravar o evento na trilha do lote
(I16e/I16f); (2) só então `DELETE fin015/finItemSispag/{bncCod}/{flpCod}/{itsCodSeq}/{filCod}/{filCodLote}`
no rascunho nativo, com `itsCodSeq` lido **na hora** de `fin015/finItemSispag/list` (nunca de cache);
(3) reler a lista e **confirmar a ausência**: o sucesso é a ausência observada, não o `200` do
DELETE. A ordem inversa criaria o pior caso: item fora do ERP e ainda no lote local, que a retomada
reimportaria. |
| **I16d.4** | **Ator e motivo.** Ator `sistema` (`SISPAG_SYSTEM_ACTOR`). Motivo novo no enum de
retirada pelo sistema (`SystemRemovalReason`): `CODIGO_BARRAS_REPETIDO` e, na cláusula de ausência,
`CODIGO_BARRAS_AUSENTE_OU_ILEGIVEL`. O evento carrega: identidade do título retirado
(`filCod/docCod/titCod`), `valor`, `vencimento`, o **código mascarado** (5 primeiros + 4 últimos) e,
para repetição, a identidade do título **que ficou**. Nunca o código completo. |
| **I16d.5** | **Idempotência.** Reexecutar a guarda sobre o mesmo rascunho é seguro: item já fora do
lote local e já ausente da lista nativa não gera novo evento nem novo `DELETE`; item fora do lote
local e ainda presente no rascunho gera **só** o `DELETE` (I16h). O evento de trilha é único por
`(lote, título, motivo)` (chave natural; a marca `ATIVA` já é única por título). |
| **I16d.6** | **Falha parcial fecha.** Se algum `DELETE` falhar (ou a releitura ainda mostrar o
item): **não** se chama `finalizarLote`; o ledger vai a `failed` com motivo
`LIMPEZA_CODIGO_REPETIDO_INCOMPLETA` e os títulos pendentes de limpeza; erro nomeado novo
`BoletoCodigoBarrasRetiradaIncompletaError` (409). Os itens já retirados **permanecem retirados**
(não há compensação: o estado alvo é o mesmo). A retomada termina a limpeza (I16h). Falha de
**leitura** da lista nativa também não decide: trata-se como incompleta, nunca como "limpo". |
| **I16d.7** | **Pós-limpeza.** Depois de retirar, a guarda **relê** as linhas digitáveis e **reaplica**
I16a: só passa a `finalizarLote` com zero código repetido e zero item sem código. Lote que
**esvazia** (só possível na cláusula de ausência) falha com erro nomeado, ledger `failed`, rascunho
nativo vazio permanece (espelho de `BatchEmptiedByCheckError`). |
```

**I16c ANTES → DEPOIS** (consequência direta):

```
ANTES : ... o lote com BOLETO e `dropped > 0` **aborta** com o mesmo erro nomeado, em mensagem
        própria ("código de barras ilegível/inválido para o título X"). Nunca se ignora o item
        inválido para "seguir com o resto".
DEPOIS: ... o item com código descartado pela leitura (`dropped`) é **retirado** conforme I16d.2
        (motivo `CODIGO_BARRAS_AUSENTE_OU_ILEGIVEL`). Nunca se mantém no lote um item cujo código
        não pôde ser comparado, e nunca se "segue" com ele dentro.
```

**I16b (2) — rede de segurança no `.REM`: INALTERADA.** No `RemessaCnabValidator` o lote nativo já
está finalizado e o arquivo já existe; **não há retirada automática ali** (rascunho já não é
editável). Continua abortando com o tratamento do gate pós-geração.

### 2.2 I16e — privacidade (emenda necessária)

```
ANTES : ... O código completo **nunca** aparece em mensagem, log ou ledger, e **nada sobre o código
        de barras é persistido** por esta guarda: a leitura é ao vivo do ERP (sem migration). ...
DEPOIS: O código completo **nunca** aparece em mensagem, log, ledger ou trilha, e **nunca é
        persistido**. A única derivação persistida é o **código mascarado** (5 primeiros + 4
        últimos dígitos) dentro do evento de trilha e da marca de retenção (I16d.4, I16g), porque
        a analista precisa reconhecer o boleto depois de recarregar a tela. Nenhuma coluna de
        código completo, hash ou HMAC (follow-up segue no watchlist). Migration: **uma**, só para
        o discriminador `origem` e os campos de I16g (a guarda continua sem tabela própria de código).
```

> Isto **afrouxa** o "sem migration" da versão original. É consequência inevitável de reter o
> título (I16g): sem marca persistida há laço. Alternativa sem persistir código mascarado em §7 P1-3.

### 2.3 Interação com o resume (arquivo: regra em `RemessaService.classificar...`, ~860–925; ontologia: `business-rules/` do SISPAG que descreve a retomada de rascunho)

**ANTES (comportamento atual):**

```
intrusos = jaNoErp \ nossas   // chave filCod:docCod:titCod
intrusos.length > 0  ⇒ etapa 'indeterminado'  ("alguém mexeu pelo ERP")
```

**DEPOIS:**

```
intrusos = jaNoErp \ nossas
residuos = { k ∈ intrusos : existe marca de retenção ATIVA com origem = CODIGO_BARRAS_REPETIDO
             (ou _AUSENTE_OU_ILEGIVEL), loteIdOrigem = este lote, e evento de retirada do
             sistema nesta remessa }
estranhos = intrusos \ residuos

estranhos.length > 0 ⇒ etapa 'indeterminado'     // qualquer edição de terceiro continua vencendo
estranhos = ∅ ∧ residuos ≠ ∅ ⇒ etapa 'limpar_retirados' (nova): DELETE dos resíduos, reler,
                               depois reavaliar a classificação normal (importar/finalizar).
```

Invariantes:

- **I16h-a.** Item retirado pelo sistema **nunca é reimportado**: o conjunto `nossas` é o lote
  local (de onde o item já saiu), e `faltando = nossas \ jaNoErp` não o contém; a importação
  parcial (`apenas`) também é calculada sobre o lote local.
- **I16h-b.** A precedência é **fail-closed**: qualquer item estranho (nem nosso, nem resíduo
  reconhecido) mantém `indeterminado`, mesmo que haja resíduos legítimos junto. Nunca se limpa
  parcialmente num rascunho que um terceiro tocou.
- **I16h-c.** O reconhecimento do resíduo exige o **par** marca `ATIVA` + evento do sistema neste
  lote. Um título retirado antes por **duplicidade de título** (`BloqueioDuplicidade` clássico,
  I13g) ou por I13j **não** é resíduo desta guarda; se aparecer no rascunho continua intruso.
  (Isso deixa de fora, de propósito, uma divergência existente: ver §7 P1-4.)
- **I16h-d.** A guarda roda em **todo** caminho que chega a `finalizarLote`, inclusive a etapa
  `finalizar` direta da retomada ("já tem os N títulos"): a leitura é idempotente e é o único
  momento em que o código existe.
- **I16h-e.** Idempotência do `DELETE`: o comportamento do ERP para `itsCodSeq` já inexistente não
  foi medido; decide-se pela releitura da lista, não pelo status do DELETE (P1-5).

### 2.4 O título retirado depois (marca de retenção)

**Proposta: estender `BloqueioDuplicidade` com um discriminador `origem`**, em vez de criar entidade.

Antes (`ontology/entities/bloqueio-duplicidade.md`): um único tipo de bloqueio, nascido de
`resolverAlertaDuplicidade(RETIRAR)`, que se **encerra** quando o título some do `fin064`.

Depois:

| Campo | Mudança |
|---|---|
| `origem` | **novo**, enum `DUPLICIDADE_TITULO` (atual, default dos existentes) `\|` `CODIGO_BARRAS_REPETIDO` `\|` `CODIGO_BARRAS_AUSENTE_OU_ILEGIVEL` |
| `alertaId` | passa a **opcional** (só existe em `DUPLICIDADE_TITULO`) |
| `tituloMantido` | **novo**, opcional: `(filCod, docCod, titCod)` do item que ficou com o boleto |
| `codigoMascarado` | **novo**, opcional, só para as origens de código de barras (I16e) |
| `marcadoPor` | `sistema` nas origens novas |

Ciclo de vida por origem (o resto do ciclo, `DESFEITO` pela analista com motivo e auditado, é igual):

| Origem | Encerra sozinho (`ENCERRADO`, ator `sistema`) quando |
|---|---|
| `DUPLICIDADE_TITULO` | inalterado: sumiu do `fin064` ou cancelado |
| `CODIGO_BARRAS_REPETIDO` | o título **mantido** deixa de disputar o código: foi pago, cancelado ou saiu do `fin064`/`ativo = false`; **ou** o título retido mudou de situação de boleto (a ingestão passa a ver `titVldReflexoDdaAssoc = 0`/boleto diferente: o vínculo que gerou a disputa se desfez); **ou** o lote de origem foi cancelado sem remessa gerada |
| `CODIGO_BARRAS_AUSENTE_OU_ILEGIVEL` | a ingestão vê a situação do boleto do título mudar (DDA sincronizado/boleto novo), ou desfeito pela analista |

**Efeito (mesmo de I13g):** o título com marca `ATIVA` **não entra** em `formarLotesAutomaticos`
nem em `incluirTituloNoLote` (`DuplicateHoldError`); aparece na aba de títulos com selo
"retido: boleto repetido" e na fila de retidos (I16f).

**Justificativa.**

- *Por que `BloqueioDuplicidade` e não `AlertaItemLote`:* a alerta é por-item-de-lote e é
  descartada junto com o item; sem item no lote, não há onde a marca viver. `BloqueioDuplicidade`
  já é a tabela "decisão que sobrevive à re-leitura da ingestão" (a mesma razão de não ser coluna
  de `titulo_a_pagar`) e já tem os filtros em formação e inclusão.
- *Por que não reusar o ciclo de I13g sem mudar:* "cancelamento pendente no Conexos" é falso aqui;
  o título **não é duplicata**, é dívida válida cujo boleto está compartilhado. Sem a condição de
  encerramento própria, ou ele ficaria retido para sempre (nunca some do `fin064`) ou a analista
  teria de desfazer à mão todo dia.
- *Por que não só "ficar fora" por conta de o título voltar a bater:* sem marca, a formação das
  07h o recoloca no lote seguinte e a guarda o retira de novo, **todo dia**, gerando evento e
  `DELETE` repetidos. É o laço que o pedido exige evitar.
- *Por que `DUPLICIDADE_TITULO` continua sendo o default:* retrocompatibilidade com as linhas
  existentes; nenhuma regra de I13g muda para elas.

## 3. Aviso à analista (I16f, nova)

```
| **I16f** | **Quem foi informado e como.** Toda retirada automática (I16d) é (1) evento só-inclusão
na trilha do lote (`CODIGO_BARRAS_REPETIDO` / `..._AUSENTE_OU_ILEGIVEL`), ator `sistema`; (2) devolvida
no resultado de `gerarRemessa` como `retiradosPorCodigoBarras: [{ titulo, valor, vencimento,
codigoMascarado, tituloMantido? }]`; (3) exibida no `LoteCard` como aviso **persistente** enquanto
o lote existir (sobrevive a recarregar a tela, porque lê a trilha): "N títulos saíram do lote: o
boleto 12345…6789 é o mesmo do título <mantido>. Este ficou com o boleto: <mantido>." (4) listada
na fila/aba de títulos como "retidos por boleto repetido" com ação de desfazer com motivo (I16g).
A remessa **conclui** (não retorna erro), mas o resultado carrega `avisos` não vazio para que a
automação diária não trate "tudo certo" quando houve retirada. |
```

Decisão de linguagem na UI: pt-BR, sem o código completo; identifica os títulos por
`docCod/titCod` e favorecido.

## 4. Texto para ADR-0069 (emenda) e CHANGELOG

### 4.1 ADR-0069 — acrescentar ao frontmatter e ao corpo

Frontmatter: `amended_by: []` (acrescentar a si mesmo) e `status: accepted`. Corpo, nova seção:

```markdown
## Emenda 1 (2026-10-14, mesmo dia): de "abortar" para "retirar e seguir"

**Decisão do mantenedor.** Achada a repetição de código de barras (ou item BOLETO sem código legível
depois do import), a solução **retira** os itens ofensores automaticamente e continua a remessa com o
restante, informando a analista. Mantém **um** item por código (menor vencimento, depois menor
`docCod`, `filCod`, `titCod`) e retira os demais.

**O que a revoga.** O "Rejeitado: descartar o item repetido em silêncio / remover do rascunho por API
(REJECT-WORKAROUND)" desta ADR cai em duas das duas razões: (a) a remoção por API foi **verificada**
em HML (2026-10-14): `DELETE /api/fin015/finItemSispag/{bncCod}/{flpCod}/{itsCodSeq}/{filCod}/{filCodLote}`
remove um item de lote nativo em RASCUNHO, retorna 200 sem corpo e o título volta ao grid de
pendentes; lote nativo em rascunho continua sem poder ser apagado; (b) não é "em silêncio": há evento
na trilha, aviso persistente no lote e marca de retenção visível.

**Mecanismo.** Ver I16d.1–I16d.7, I16f, I16g, I16h na regra `boleto-exige-codigo-de-barras`.
Local primeiro, ERP depois; sucesso é a ausência observada na releitura; falha parcial fecha
(nada finaliza com código repetido restante) e a retomada termina a limpeza.

**Marca de retenção.** Extensão de `BloqueioDuplicidade` com `origem`; reusa a infraestrutura de
I13g (formação/inclusão) e muda só a condição de encerramento. Nenhuma entidade nova.

**Consequências.** (+) a remessa do dia não para por causa do caso PEDRONI. (−) a retirada é decisão
financeira tomada por heurística: fica gravada, é reversível e é avisada. (−) uma migration
(discriminador + campos da marca). (−) exceção à máquina de estados do lote local (P0-1).
Rede de segurança do `.REM` (I16b(2)) permanece abortando.

**Continua rejeitado.** Retirar o item que fica; apagar lote nativo; persistir o código completo ou
seu hash nesta entrega; guarda entre lotes vivos / contra boleto pago (watchlist).
```

### 4.2 CHANGELOG (entrada para a versão do ship; renumerar contra `main` no ship, ver aviso da ADR)

```markdown
- **Boleto repetido não trava mais a remessa.** Quando dois ou mais títulos do mesmo lote apontam
  para o **mesmo código de barras** (um boleto DDA reservado a vários títulos de mesmo valor e
  vencimento), a remessa agora **retira os repetidos sozinha** e segue com o restante. Fica um
  título por boleto: o de menor vencimento e, em empate, o de menor número de documento. O lote
  mostra quais títulos saíram e qual ficou com o boleto, e os títulos retirados ficam retidos
  (aba "Títulos a pagar", selo "retido: boleto repetido") até o boleto deixar de ser compartilhado
  ou você desfazer a retenção com motivo. Nenhum título é pago em duplicidade e nenhum código de
  barras completo é guardado ou exibido.
```

(Se P0-3 for confirmado, acrescentar: "O mesmo vale para boleto que continua sem código de barras
legível depois da importação.")

## 5. Retenção: invariante I16g

```
| **I16g** | **Retenção do título retirado.** Todo item retirado por I16d ganha uma
`BloqueioDuplicidade` `ATIVA` com `origem` correspondente (ciclo na seção 2.4). A marca é criada
**na mesma transação** da remoção local (I16d.3); no máximo uma `ATIVA` por título. A analista pode
**desfazer** com motivo (auditado): o título volta ao pool, e, se o boleto ainda estiver
compartilhado, a próxima guarda o retira de novo, com novo evento. Desfazer **não** troca o item
que ficou; para pagar o título retido primeiro, a analista resolve o boleto no `fin124` (DDA) ou
muda a forma de pagamento. |
```

## 6. Rejeitados (para documentar)

| # | Candidato | Categoria | Razão |
|---|---|---|---|
| R1 | Retirar também o item que **fica** (esvaziar o grupo, "nenhum paga") | REJECT-WORKAROUND | Tira todos os pagamentos de um boleto que existe e é devido por um dos títulos; transforma um problema de duplicidade em inadimplência certa. |
| R2 | Apagar lotes nativos em rascunho | REJECT-NOT-DOMAIN | Não há API (verificado); o lote vazio permanece e a retomada o reaproveita (já era assim). |
| R3 | Persistir código completo, hash ou HMAC nesta entrega | REJECT-PREMATURE | Serve à repetição **entre lotes**, que é outro escopo; continua no watchlist (HMAC com segredo do `EnvironmentProvider`). |
| R4 | Entidade nova `RetiradaPorCodigoRepetido` | REJECT-DUPLICATE | A trilha do lote + `BloqueioDuplicidade` cobrem o fato e a retenção. |
| R5 | Reaproveitar `PendenciaCadastro` | REJECT-DUPLICATE | Entidade removida na ADR-0065; e a pendência é de cadastro, aqui é de boleto. |
| R6 | Reaproveitar `AlertaItemLote` como marca | REJECT-WORKAROUND | Vive e morre com o item no lote; não impede o laço. |
| R7 | Retirada automática no gate do `.REM` (I16b(2)) | REJECT-WORKAROUND | Lote nativo já finalizado e arquivo gerado; ali só cabe abortar e cancelar. |
| R8 | `DELETE` antes da transação local ("ERP primeiro") | REJECT-WORKAROUND | Falha entre os dois passos deixa item fora do ERP e dentro do lote local: a retomada reimporta. |
| R9 | Usar o `200` do DELETE como prova | REJECT-WORKAROUND | Corpo vazio; o comportamento para item inexistente é desconhecido. Prova é a releitura. |

Watchlist (append): "guarda de código repetido **entre lotes vivos** / contra boleto pago (HMAC +
migration)", sem mudança de status.

## 7. Perguntas em aberto (precisam do mantenedor)

### P0 — bloqueiam o código

**P0-1. Retirar de um lote local `FINALIZADO`.**
`gerarRemessa` só roda com o lote local em `FINALIZADO` (L8). `removerItemPeloSistema` age só em
`RASCUNHO`. Mudar o lote após finalizado muda `soma`/contagem sem passar pelo `finalizarLote`.
- (a) **Exceção explícita**: o sistema retira item de lote `FINALIZADO` **durante `gerarRemessa`**,
  sem mudar o status, com bump de `versao`, evento e recálculo do total. *Recomendado*: é o único
  consistente com "continua a remessa com o resto" e com a automação sem intervenção.
- (b) Reabrir o lote (`FINALIZADO → RASCUNHO`), retirar e exigir que alguém refinalize. Conservador,
  mas é o aborto de antes com outro nome.
- (c) Mover a guarda para **antes** do `finalizarLote` **local** (no `finalizarLote`, não só na
  remessa). Só funciona se o código já existir no rascunho nativo naquele ponto; hoje ele só existe
  depois do `importarTitulos`, que é da remessa. Exige mudar a ordem import/finalização. Não recomendo agora.

**P0-2. A marca de retenção (§2.4) e a migration.**
- (a) **Estender `BloqueioDuplicidade`** com `origem` (proposto). *Recomendado.*
- (b) Tabela própria `sispag_retencao_codigo_barras`. Mais limpa na semântica, mas duplica filtros de
  formação/inclusão e vai contra "entidade existente antes de nova".
- (c) Sem marca; aceitar o laço diário com evento repetido. Não recomendo: gera ruído e `DELETE`
  todo dia e esconde o problema.

**P0-3. A cláusula de ausência é do escopo?** (Suposição minha, a pedido do mantenedor.)
"BOLETO sem código legível depois do import" **não tem par** e a causa é outra (boleto não associado,
DV inválido); retirá-lo também deixa o título "sem pagar hoje". A regra de ausência original
(`BoletoSemCodigoBarrasError`, `titVldReflexoDdaAssoc`) já falha **antes** do import.
- (a) **Retirar** (como pedido; I16d.2). Marca com `CODIGO_BARRAS_AUSENTE_OU_ILEGIVEL`.
- (b) **Abortar** só nesse caso (mantém o I16c/I16d antigo para ausência) e retirar só repetição.
- (c) Retirar só o **ilegível** (`dropped`) e abortar a ausência pura (que indica falha de leitura
  do ERP, não problema do título: retirar por "ausente" quando a leitura caiu retiraria itens bons).
  *Recomendado:* **(c)**. Falha de leitura/lista incompleta nunca pode virar retirada; só item
  **cujo código foi lido e descartado** ou **lido e repetido** é retirado.

### P1 — decisão de produto, não bloqueiam a escrita da ontologia

**P1-1. Quem ficar com o boleto.**
No caso PEDRONI (mesmo valor e vencimento) quem decide é o menor `docCod`: arbitrário.
- (a) Regra como decidida (vencimento, `docCod`, `filCod`, `titCod`). *Default.*
- (b) Preferir o título com **confirmação humana** de boleto (ADR-0068) quando houver exatamente um;
  só depois a regra. Respeita decisão humana prévia. *Recomendado como adendo.*
- (c) Preferir o título cujo `docEspNumero` bate com o número do documento do boleto (sinal do
  ADR-0068). Exige o dado no DDA; não confirmado.
Observação: a regra "mais próximo do vencimento do boleto" do ADR-0068 e "menor vencimento" daqui são
**diferentes**; dentro de um grupo DDA elas coincidem na prática (mesmo vencimento), o desempate
real é sempre `docCod`.

**P1-2. Lote manual.** A analista incluiu o título à mão e o sistema o retira.
- (a) Mesmo comportamento (I16 vale para os dois, como já decidido em I16b). *Default.*
- (b) Em lote manual, retirar mas com aviso **bloqueante** (confirmar a ciência antes da próxima etapa).

**P1-3. Persistir o código mascarado.**
- (a) Mascarado (5+4) no evento e na marca. *Default* (consistente com I16e original, que já o exibe).
- (b) Só a identidade do título mantido; sem nada do código. Mais pobre para reconhecer o boleto.

**P1-4. Divergência herdada de I13j.** Itens retirados pelo sistema por `SEM_DADO_PAGAMENTO` etc. não
têm marca de retenção e, se estiverem no rascunho nativo por queda, caem em `indeterminado`.
- (a) Fora de escopo agora (não alterar I13j). *Default.* Registrar no watchlist.
- (b) Estender o reconhecimento de resíduo para todas as retiradas do sistema.

**P1-5. `DELETE` de item já inexistente.** Não medido. Antes do ship, medir em HML (404? 200? 500?) e
registrar; a regra I16h-e já não depende disso, mas a mensagem ao operador sim.

**P1-6. Quando a retenção deve encerrar sozinha para `CODIGO_BARRAS_REPETIDO`.** Proposta em §2.4
(mantido pago/cancelado, boleto mudou, lote cancelado). Alternativa mais simples: só **desfazer
manual** + expiração. *Default:* proposta de §2.4; confirmar se o sinal "boleto mudou" é detectável
na ingestão sem custo novo (depende de `titVldReflexoDdaAssoc` e do `fin124`).

**P1-7. Janela de reversão.** Depois que a remessa chega ao banco, o título retido não aparece mais
no lote; confirmar se a fila de retidos deve ter filtro por filial/credor e quem tem permissão de
desfazer (hoje: a mesma de I13g).

## 8. Arquivos que mudariam na aprovação (nada foi escrito)

1. `ontology/business-rules/boleto-exige-codigo-de-barras.md` — I16c, I16d, I16d.1–.7, I16e, I16f, I16g, I16h; tabela "Não confundir" (linha do boleto repetido: saída passa a "retirado automaticamente; ver aviso do lote"); `ontology_version`.
2. `ontology/decisions/0069-sispag-guarda-de-codigo-de-barras-repetido.md` — Emenda 1 (§4.1); ajusta "Decisão" e "Rejeitado".
3. `ontology/entities/bloqueio-duplicidade.md` — `origem`, `tituloMantido`, `codigoMascarado`, `alertaId` opcional, ciclo por origem, `universality_evidence` (PEDRONI).
4. `ontology/business-rules/verificacao-ted-pix-sispag.md` — I13g: nota "o bloqueio tem origens; ver I16g"; I13j: lista de `SystemRemovalReason`.
5. `ontology/decisions/` — ADR de rejeição curto (R1, R8, R9) **só se o mantenedor pedir**; senão ficam na própria Emenda 1.
6. `ontology/_inbox/_watchlist.md` — entre lotes (inalterado) e P1-4.
7. `ontology/_index.json`, `ontology/_coverage.json` — `last_review`, I16 volta de `implemented` para `planned` (a ontologia fica à frente do código), bump `ontology_version` v0.40.1 → v0.41.0 (nova ação de retirada e extensão de entidade, não só property fix; reconferir colisão contra `main`).
8. `docs/ontologia.md` e `CHANGELOG.md` — texto de §4.2; checar se `docs/` menciona "aborta" para boleto repetido.
9. Código (não é meu, para o TaskScoper): `SystemRemovalReason`, `LotePagamentoRepository.removerItemPeloSistema` (P0-1), `ConexosSispagWriteClient.removerItemDoRascunho`, `RemessaService` (guarda + etapa `limpar_retirados`), `BoletoCodigoBarrasRetiradaIncompletaError`, migration, UI do `LoteCard`.

## 9. Pergunta de aprovação

Responder: **approve** (aplica tudo com os defaults acima, P0-1(a), P0-2(a), P0-3(c)), **edit
[item] [instrução]**, ou **partial**. P0-1/P0-2/P0-3 precisam de resposta explícita antes do
`TaskScoper`.


---

## DECISÕES DO MANTENEDOR (2026-10-14) — valem para o PR 2 (remoção automática)

| # | Pergunta | Decisão |
|---|---|---|
| P0-1 | Retirar item de lote local `FINALIZADO` | **(a) Exceção explícita do sistema**: durante `gerarRemessa` o sistema retira o item do lote `FINALIZADO`, sem mudar o status, com `versao` incrementada, evento na trilha e recálculo do total. Escopo estreito: só nessa chamada e só para código repetido ou ilegível. |
| P0-2 | Marca de retenção do título retirado | **(a) Estender `BloqueioDuplicidade`** com `origem` (+ `alertaId`, `tituloMantido`, `codigoMascarado`), com migration e condição de liberação própria. |
| P0-3 | Cláusula de ausência | **(c) Retirar o item cujo código foi LIDO e descartado (DV inválido) ou LIDO e repetido; ABORTAR na ausência pura** (pode ser falha de leitura do ERP; leitura incompleta nunca vira retirada). |

Pendências do PR 2 que ainda pedem decisão (P1 do documento): qual título fica com o boleto
(preferir o confirmado por humano na ADR-0068?), lotes manuais, persistir o código mascarado
(I16e muda para "só o mascarado persiste"), medir o comportamento do `DELETE` de item inexistente em
HML e o sinal de liberação automática da retenção.

Pré-requisito já entregue no PR 1: detecção + aborto (ADR-0069, v0.66.1).
