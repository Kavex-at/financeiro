---
name: vinculo-codbar-item-sispag
type: business-rule
entity: LotePagamento
invariant: I17
ontology_version: "0.49.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/RemessaService.ts
  - src/backend/domain/service/sispag/VinculoCodigoBarrasService.ts
  - src/backend/domain/client/ConexosSispagWriteClient.ts
  - src/backend/domain/libs/boleto/CodigoBarrasBoleto.ts
  - src/backend/domain/libs/boleto/AnaliseCodigoBarrasRepetido.ts
  - src/backend/domain/service/sispag/BoletoSuggestionService.ts
  - src/backend/domain/libs/boleto/ElegibilidadeVinculoCodigoBarras.ts
  - src/backend/domain/libs/cnab/RemessaCnabValidator.ts
  - src/backend/domain/client/ConexosSispagClient.ts
  - src/backend/domain/libs/boleto/ValorAbertoLiquido.ts
  - src/backend/domain/libs/sispag/ValorItemImport.ts
  - src/backend/domain/errors/NetValueUnavailableError.ts
  - src/backend/domain/errors/RemessaBarcodeAmountMismatchError.ts
last_review: 2026-10-20

last_review: 2026-10-26
has_canonical_test: true
universality_evidence:
  - "ADR-0068 passo 2; achados de HML 2026-10-14 (o ERP descarta o codigo no importar; o codigo so chega ao item por validacao/codigoBarras + confirmaCodigoBarras + PUT fin015/finItemSispag; nao valida DV nem compara com o titulo)"
  - "1 cliente apenas (Columbia): universalidade a revisar com o Francinei (nao bloqueante, watchlist; precedente Q-I do ADR-0068). Limitacao do ERP e de produto (Conexos), estavel"
---

# Business Rule: vínculo do código de barras confirmado ao item do lote (I17)

> **Origem:** ADR-0071 (2026-10-14). **Passo 2 do ADR-0068, escopo "valor igual".** Quando o ERP não
> associou o boleto DDA ao título, o código de barras de um boleto que **uma pessoa confirmou** para o
> título (I15) é gravado no item do rascunho nativo depois do `importar`, por uma etapa nova da remessa
> (`vincular_codbar`). **Status: implemented** (código entregue com o modo `off` por default; `on` em
> PRD só depois de V-PRD1/V-PRD2 — ver "Medições HML"). Passo 3 (automático sem
> decisão humana) continua **não autorizado**.

## Decisões do maintainer (2026-10-14)

| # | Decisão |
|---|---|
| P0-1 | A decisão humana `CONFIRMADA` + **verificações nossas** (I17b–d) autorizam o vínculo; a I15a é emendada (a validação ao vivo passa a ser a autoridade **do caminho DDA**). |
| P0-2 | Falha **determinística** pós-import retira o item pela maquinaria da I16d (motivo `VINCULO_CODIGO_BARRAS_FALHOU`) e a remessa segue; falha **transitória/ambígua** aborta e retoma, nunca retira. |
| P0-3 | Ordem em PRD: HML V1–V9 → sonda **somente leitura** de permissão do robô → `shadow` em PRD → **um** título real controlado. Sem permissão de `PUT` verificada o código sobe em `off`/`shadow`. |
| P1 | Janela de data `[0, +5]` dias (mesma constante global da I15c); `shadow` visível por endpoint + log (sem selo na tela); desempate da I16d.1 prefere o título com decisão humana vigente quando exatamente um no grupo; vínculo persistido como colunas de `ItemLote` (1 migration); endpoint `vinculos-previstos` incluído. |

## Invariantes

| # | Invariante |
|---|---|
| **I17a** | **Elegibilidade (todas, ao vivo no momento da remessa).** O item é `modalidade = BOLETO`, está no **rascunho** nativo, o ERP **não** o associou a DDA (`titVldReflexoDdaAssoc = 0` no grid de pendentes lido na remessa; I15e) e existe `DecisaoSugestaoBoleto` `CONFIRMADA`, **não órfã**, para o título, com par `ConfirmacaoEmissorBoleto` `VIGENTE` (I15l). Decisão e boleto são relidos **do banco/pool no momento do vínculo**, nunca do cache (`SugestaoBoletoCache`, anti-TOCTOU, I15a). O tier é **recalculado** agora e deve ser `CONHECIDO` ou `FORTE`; `ATENCAO` nunca vincula (I15d). **Nota (ADR-0072, sem mudança de regra):** candidato exibido sem âncora, ambíguo, disputado ou vencido nunca é elegível (`confirmavel = false` impede a decisão, I15m). **Exceção controlada (ADR-0078, `planned`):** `ATENCAO` **só por data** (valor igual em centavos, âncora presente, Δdias fora de 0..5 e dentro de ±10) vincula **apenas** pelo caminho `DATA_DIVERGENTE` (I17p), com **reconhecimento válido** (I15r) relido do banco no mesmo instante da decisão. `ATENCAO` por valor, sem âncora, ambíguo, disputado ou vencido continua nunca vinculando. |
| **I17b** | **Valor igual em centavos, contra o LÍQUIDO aberto (emendada ADR-0074, `implemented`: `ValorAbertoLiquido`).** `round(valorBoleto × 100) == round(abertoLiquido × 100)`, com `abertoLiquido = fin064.totalLiquido` (o `totalLiquido` **já desconta o pago**: medido em PRD em 2026-10-20, 15 de 15 títulos com pagamento parcial; subtrair `totalPago` de novo reprovaria todos), **conferido** contra `totalAberto + titMnyJuros − titMnyDesconto` (todos lidos ao vivo no `fin064`). As duas fórmulas divergirem, ou qualquer campo faltar ⇒ `VALOR_ABERTO_INDISPONIVEL`, item **inelegível** (fail-closed, I17g(1)). `valorBoleto` é **decodificado por nós** do código de barras (campo de 10 dígitos / 100) e conferido com o devolvido pelo ERP (`validacao/codigoBarras`). Nunca se compara com `ItemLote.valor` (snapshot) nem com a carteira (`titMnyValor`, base). A mesma régua vale nos três pontos: elegibilidade, conferência pré-`PUT` do executor e conferência pós-releitura. Para título sem juros/desconto e sem pagamento, `abertoLiquido = totalAberto`: **nenhuma mudança de comportamento**. Diferença de 1 centavo continua **inelegível**; ela se resolve **antes**, no título, pela I18 (`ajuste-centavos-titulo-sispag`, ADR-0074), nunca aqui. |
| **I17c** | **Data.** Com `Δdias = vencimentoBoleto − vencimentoTitulo` (data civil, UTC meia-noite; I15h): **elegível se `0 ≤ Δdias ≤ 5`** **e** `vencimentoBoleto ≥ dataDebito` do lote. A data de pagamento do item **acompanha a barra** e o ERP só exige `dataDebito ≤ min(itsDtaPgto)` (R2, I8); barra com vencimento ≥ título não reduz essa janela. Na janela padrão, barra vencida (antes da data de débito) ou anterior ao título é inelegível e `Δdias > 5` é `ATENCAO` (I15c) e fica fora **dela**; esses casos só vinculam pelo caminho `DATA_DIVERGENTE` (abaixo). Vencimento **igual** à data de débito é elegível. **Nota (ADR-0072, sem mudança de regra):** `Δdias < 0` é exatamente o sinal `VENCE_ANTES_DO_TITULO` (I15o); o motivo de `INELEGIVEL` no `shadow` e em `vinculos-previstos` pode citá-lo. **O passo 2 não lê situação nem âncora.** **Emenda (ADR-0078, `planned`):** (1) a janela padrão acima fica **inalterada**; (2) **caminho `DATA_DIVERGENTE` (I17p):** `Δdias ∈ [-10,-1] ∪ [6,10]`, valor igual em centavos (I17b **intacta**, sem tolerância) e **reconhecimento válido** (I15r); (3) **vigência da barra na data de débito (P0-3, vale para (1) e (2)):** o vencimento efetivo da barra é **rolado ao próximo dia útil bancário** (`BankingCalendar`: fim de semana e feriado nacional) e precisa ser `≥ dataDebito`; senão `VENCIDO_INFORMATIVO` (I15h), inelegível e **fora de escopo** (nada de juros/multa); (4) `|Δdias| > 10` ⇒ fora do envelope (`SEM_CANDIDATO`, I15m). **O passo 2 passa a ler o reconhecimento (I15r) e nada além dele**; `Δdias < 0` deixa de ser "nunca vincula" e passa a ser "só com reconhecimento válido". `[DEFAULT P1-6]` quando a data da barra vai ao `itsDtaPgto`, a guarda I17q se aplica. |
| **I17d** | **Verificações são nossas.** Antes de qualquer escrita e antes do `PUT`: (1) `CodigoBarrasBoleto.paraBarras(linha)` confere comprimento 44/47, DVs de campo e DV geral; (2) código não é arrecadação (inicia por `8`); (3) banco do código = banco informado pelo `confirmaCodigoBarras`; (4) valor decodificado = I17b; (5) data decodificada = `itsDtaPgtoResult` do confirm; (6) `itsMnyVlrPgtoResult == valorBoleto` (**juros e desconto = 0**; qualquer ≠ 0 aborta o item — o ERP soma juros ao valor da barra). Divergência ⇒ item **não vinculado** (I17g). Nenhuma checagem é delegada ao ERP. **(7) Fator de vencimento × DDA (ADR-0078, `implemented` Fase 1).** Decodificamos o **fator de vencimento** (posições 6–9 do código de 44 dígitos) para uma data civil e exigimos igualdade com `vencimentoBoleto` do pool DDA (`BoletoDda`). `0000` = barra **sem vencimento**; o fator é módulo 9000 e **reinicia em 22/02/2025** (1000 = 22/02/2025), então a data é a do ciclo **mais próxima** do `vencimentoBoleto` do DDA (ambiguidade resolvida **sem** consultar o relógio); resultado fora do ciclo plausível ⇒ divergente. Fator `0000`: **não aplicável** na janela padrão (comportamento atual preservado) e **inelegível no caminho `DATA_DIVERGENTE`** (sem data de barra não há o que reconhecer). Divergência decodificada × DDA ⇒ item **não vinculado** e, no pré-import/`shadow`, `INELEGIVEL(FATOR_VENCIMENTO_DIVERGE)`; pós-import é determinística (I17g(3)). O check (5) (data do `confirmaCodigoBarras`) **continua** e é independente: (5) confere o ERP, (7) confere o DDA com a norma FEBRABAN (checks (1)–(7)). **Nota (ADR-0074):** em (6), "juros e desconto = 0" refere-se ao que **nós declaramos** no `confirmaCodigoBarras`/item; juros/desconto **do título** (nascidos da renegociação I18) são esperados e o critério continua `itsMnyVlrPgtoResult == valorBoleto` (HML 536/2: confirm 53,54). |
| **I17e** | **Sequência por item (rascunho aberto).** `listar item (itsCodSeq vivo)` → `validacao/codigoBarras(47)` → `confirmaCodigoBarras(splitCodBar)` → `PUT fin015/finItemSispag` com **o item lido** alterado em exatamente `itsNumCodbar` (47), `itsNumBanco`, `bncDesNome`, `itsMnyVlrPgto`, `itsDtaPgto` (do resultado do confirm, conferidos em I17d) → **releitura**. A row do `PUT` é a lida **imediatamente antes** dele (o ERP não tem lock otimista, V3) e, quando o banco do código ≠ banco do lote, o item vai em **modalidade `7`** na validação, no confirma e no `PUT` (`itsVldModalidade`, 6º campo; `6` com banco igual — V4). O sucesso é a **observação na releitura** (código igual, banco/nome preenchidos, valor e data iguais ao enviado), não o `200` do `PUT`. `PUT` em **tentativa única, sem retry cego**; a repetição só ocorre depois de nova leitura. |
| **I17f** | **Idempotência e terceiros.** Item que já traz `itsNumCodbar` **igual** ao esperado (comparado em 44 dígitos) e valor/data coerentes = **já vinculado**: nenhuma chamada nova, nenhum evento duplicado (evento único por `(lote, título, decisaoId)`). `itsNumCodbar` **diferente** do esperado, ou valor/data diferentes do que gravaríamos, é **edição de terceiro**: não sobrescreve, etapa `indeterminado`, fail-closed (espelho de I16h(b)). Nunca se limpa nem se sobrescreve um rascunho tocado por outra pessoa. **Exceção (I17l):** código gravado por nós cuja decisão deixou de ser `CONFIRMADA` não é "digitado à mão" — o item é retirado. |
| **I17g** | **Falha: o que aborta e o que retira (P0-2).** (1) **Pré-import** (decisão, boleto, DV, valor, data, modo): item inelegível ⇒ comportamento **atual**, `BoletoSemCodigoBarrasError` antes de qualquer escrita. (2) **Pós-import, transitória ou ambígua** (timeout, 5xx, resposta ilegível, `PUT` sem releitura conclusiva, leitura incompleta): **aborta** com `VinculoCodigoBarrasIncompletoError` (409), ledger `failed`, rascunho **preservado**; a retomada refaz o item (I17f). **Nunca** vira retirada. (3) **Pós-import, determinística** (divergência de I17d depois do `validacao`/`confirma`; recusa de negócio 4xx do `PUT`; código já presente em outro item — I16): o item é **retirado** pela maquinaria da I16d (local primeiro, `DELETE`, releitura) com motivo `VINCULO_CODIGO_BARRAS_FALHOU`, marca de retenção `BloqueioDuplicidade` e aviso (I16f/g); a remessa segue com os demais. |
| **I17h** | **Guarda I16 sobre o conjunto final.** Depois do último `PUT` e da releitura, `AnaliseCodigoBarrasRepetido` roda sobre **todos** os códigos do rascunho (DDA + vinculados) antes do `finalizarLote`. Ordem: `importar → vincular_codbar → (guarda I16 / limpar_retirados) → finalizar → gerar_remessa`. Antes do `PUT`, o código do item é conferido contra os códigos **já presentes**: repetido ⇒ não vincula (I17g(3)). **Desempate (P1):** na I16d.1, quando **exatamente um** título do grupo tem decisão humana vigente (I17a), ele é o que fica; caso contrário vale a ordem vencimento/`docCod`/`filCod`/`titCod`. |
| **I17i** | **Só em rascunho aberto.** Nunca se vincula em lote nativo `FINALIZADO` (retomada em `gerar_remessa`): o ERP recusa alteração de item de lote não cadastrado (verificado para `DELETE` **e para `PUT`**: `FIN_015.IMPOSSIVEL_ALTERAR_REGISTRO_NAO_EM_CADASTRO`, HML 2026-10-14, V5). Nessa retomada o item sem código cai em I16c (ausência ⇒ aborta). |
| **I17j** | **Privacidade.** A linha digitável completa trafega **só em memória** (leitura do pool → `validacao` → `confirma` → `PUT`). Nunca em log, ledger, evento, evidência ou mensagem de erro; persiste **só o mascarado 5+4** (`AnaliseCodigoBarrasRepetido.mascarar`) em `ItemLote.vinculoCodigoBarras` e no evento. |
| **I17k** | **Modos e rollout (global ou por filial).** O valor pode ser um modo único (`on`/`shadow`/`off`), que vale para **todas** as filiais, ou uma lista por filial; as duas formas não se misturam (`"on,1:off"` ⇒ `off`). `off` (default): nada muda, I15b vale integral. `shadow`: roda **apenas** as pré-condições e verificações **locais** (I17a–d sobre o pool) e grava `VINCULO_SIMULADO`; **zero** chamada nova ao ERP; o comportamento da remessa é o de `off`; resultado visível só por endpoint (`GET /sispag/lotes/:id/vinculos-previstos`) e log. `on`: executa I17e. Modo desconhecido, filial ausente ou parse inválido ⇒ `off`. O kill-switch global `sispagLiveWriteEnabled` derruba também este vínculo; `SISPAG_DDA_ASSOC_ENABLED=false` **não** o desliga. **Ordem em PRD (P0-3):** HML V1–V9 → sonda somente leitura de permissão do robô → `shadow` em PRD → **um** título real controlado; `on` em PRD só depois de V-PRD1 e V-PRD2. Os valores de modo por filial são configuração (`EnvironmentProvider`), não ontologia. **`[DEFAULT P1-5]` (ADR-0078, `planned`):** o caminho `DATA_DIVERGENTE` tem **modo independente** do modo do vínculo, com a mesma sintaxe (`on`/`shadow`/`off`, global ou por filial), **default `off`**. `shadow` roda só verificações locais, **zero chamada ao ERP**, e grava `VINCULO_SIMULADO` com `deltaDias`, `caminho = DATA_DIVERGENTE`, reconhecimento presente/válido e o motivo de `INELEGIVEL`. Modo do vínculo `off` ⇒ o caminho novo também fica `off`. **Portões HML antes de `on` `[DEFAULT P1-5/P1-6]`:** (a) `confirm` com barra antes e depois do título; (b) `finalizar` com `itsDtaPgto` menor e maior que o título; (c) segmento J do `.REM` (a data que o J carrega: título ou barra). Se (c) mostrar J ≠ barra, o caminho fica `off` e a fase 2 vira pré-requisito. O nome da variável de ambiente é configuração, não ontologia. |
| **I17l** | **Vigência da decisão ≠ reversão do pagamento.** Anular a decisão (I15l) ou revogar o par depois do vínculo **não** desfaz o item no ERP na hora — a tela avisa na anulação que há item vinculado em lote vivo. **Mas a próxima `gerarRemessa`/retomada falha fechado:** o item que carrega código gravado por nós (`origem = DECISAO_HUMANA`) cuja decisão deixou de ser `CONFIRMADA` é **retirado** pela maquinaria da I16d (motivo `VINCULO_CODIGO_BARRAS_FALHOU`, detalhe `DECISAO_NAO_CONFIRMADA`), nunca tratado como "digitado à mão"; o boleto desfeito não chega ao `finalizar`. Se o lote nativo já está `FINALIZADO`, a retirada é impossível e vale o erro nomeado da I16d (aborta) / o cancelamento do lote nativo. A decisão também é relida imediatamente antes do `PUT`: anulada nesse intervalo ⇒ nenhum `PUT`, item retirado. O vínculo registra `decisaoId`, mas nunca reconfirma nem altera a decisão. **Emenda (ADR-0078, `planned`):** idem quando o **reconhecimento deixa de ser válido** (I15r: Δdias ou valor atuais ≠ os gravados no ack): item retirado, motivo `VINCULO_CODIGO_BARRAS_FALHOU`, detalhe `RECONHECIMENTO_INVALIDADO`, relido imediatamente antes do `PUT`. A decisão **continua `CONFIRMADA`** (não é anulada pelo sistema, I15g), mas passa a `orfa` com `motivoOrfa` (I15l(3)/I19i) até a analista anular e reconfirmar com novo ack. |
| **I17m** | **Guarda do `.REM`: barra == pagamento do J (ADR-0074, `implemented`: `RemessaCnabValidator` + `RemessaBarcodeAmountMismatchError`; default `BLOQUEIA` pendente da medição M8/Task 13).** Em todo segmento J cujo código de barras tem valor > 0, o valor da barra (campo de 10 dígitos / 100) **deve ser igual** ao valor do pagamento do próprio J. Divergência ⇒ `RemessaBarcodeAmountMismatchError` (409), código **mascarado** (5+4), tratamento do gate pós-geração da I16b(2) (lote nativo finalizado e arquivo no ERP para cancelamento manual). Barra com valor zerado (boleto de valor aberto) fica **fora** da guarda. Vale para **todo** J (DDA do ERP, vínculo I17 e ajuste I18) e é **pré-requisito** do modo `on` da I18. **Decisão M8:** bloqueia (fail-closed), com medição prévia só leitura dos `.REM` de PRD dos últimos 30 dias; se houver casos legítimos, nasce como `warn` e vira bloqueio por ADR curta. |
| **I17n** | **O item é importado pelo líquido (ADR-0074, `implemented`: `ValorItemImport` + `NetValueUnavailableError`; corrige bug de implementação).** O `importar` do `fin015` leva `itsMnyValor = itsMnyVlrPgto = titMnyLiquido` **do grid de pendentes** do título, nunca `titMnyValor` (base). `titMnyLiquido` ausente (o grid de PRD **nunca** o traz: 3136 de 3136 linhas em 2026-10-20; o título renegociado vem como `titMnyValor` + `titMnyJuros`/`titMnyDesconto`) ⇒ `titMnyValor + titMnyJuros − titMnyDesconto` (nulo = 0). Juros/desconto ilegível, base ausente ou resultado negativo ⇒ o item não é importado (erro nomeado, motivo `VALOR_LIQUIDO_INDISPONIVEL`). Vale para todo título, não só para os ajustados pela I18. |
| **I17o** | **Item de borderô (ADR-0077, `implemented`).** Para o item nativo com `borCod` de um `GrupoBoleto`: I17a ⇒ grupo `CONFIRMADO` não órfão + par `VIGENTE` (sem decisão por título); I17b ⇒ I21b e `== itsMnyValor`; I17c ⇒ I21g/h; **I17n não se aplica** (o valor vem do borderô, H6); modalidade 7/6 pela I21o; I17d, I17e, I17f, I17i, I17j e I17m inalteradas. **Não** depende do modo I17k (P0-5): só o kill-switch `sispagLiveWriteEnabled` o desliga. Ordem da I17h: `preparar_bordero → importar (títulos + borderôs) → vincular_codbar → guarda I16 → finalizar → gerar_remessa`. Ver `business-rules/boleto-agrupado-sispag.md`. |
| **I17p** | **Caminho `DATA_DIVERGENTE` (ADR-0078, `planned`).** Cumpridas I17a, I17b (valor igual, líquido, sem tolerância), I17d(1)–(7) e I17h, o item cujo `Δdias ∈ [-10,-1] ∪ [6,10]` é vinculado **se e somente se** (a) existe reconhecimento `DATA_DIVERGENTE` **válido** na decisão (I15r), (b) a barra está vigente na data de débito (I17c(3)), (c) o item tem **data candidata** possível (I8c) e está no lote dessa data, (d) o modo do caminho é `on` (I17k). A sequência de escrita é a **mesma** de I17e (sem passo novo). O `itsDtaPgto` do item acompanha a barra (HML: o `confirm` devolve a data da barra; a barra antes do título **reduz** o limite superior do lote, por isso I8c). `VINCULO_APLICADO` registra `caminho`, `deltaDias` e o `reconhecimentoId`. Falhas seguem I17g (determinística retira; transitória aborta e retoma). Nunca se altera o título nem a decisão (fase 2 é outra regra). |
| **I17q** | **Guarda de data do `.REM` (espelho da I17m) (ADR-0078, `planned`, `[DEFAULT P1-6]`).** Em todo segmento J gerado com código de barras de vencimento ≠ `0000`, a **data do pagamento do J deve ser igual ao `itsDtaPgto` do item**; divergência ⇒ erro nomeado (409), código **mascarado**, tratamento do gate pós-geração da I16b(2). **Fail-closed. Pré-requisito do modo `on` do caminho `DATA_DIVERGENTE`.** V12 (HML, 2026-10-26) mediu: data de pagamento do J = `itsDtaPgto` da barra (guarda satisfeita), mas o *vencimento* do J = título, divergindo do fator da barra; **se o banco aceita isso é o risco aberto** (ADR-0078, emenda 2026-10-26): o caminho fica `off` até um boleto real controlado em PRD. **Δ>0 permanece em aberto** até essa medição: não se decide aqui se o débito vai na data do título ou na da barra. |

## Medições HML (2026-10-14) — `_inbox/sispag-passo2-vinculo-codbar-hml-achados.md`

| Caso | Resultado |
|---|---|
| V1 | 3+ itens vinculados e observados; guarda I16 sobre o conjunto limpa; `finalizar` e `gerarRemessa` passam; J com barra/valor/data da barra (vencimento do J = o do **título**). Sem título DDA em HML. |
| V2 | `PUT` repetido idempotente; `PUT` por cima de barra existente **substitui** (o ERP não protege). Serviço: reexecução = 0 `PUT`. |
| V3 | **Sem lock otimista**: `PUT` com row antiga sobrescreve a edição do terceiro. Defesa: releitura imediata + `ItemEditadoPorTerceiroError`. Janela residual de ms aceita. |
| V4 | Banco do código ≠ banco do lote: modalidade `6` ⇒ `FIN_015.TITULO_NAO_PERTENCE_AO_BANCO_EM_USO`; `7` ⇒ aceito, e o item **precisa** ficar em `7` (senão o `finalizar` recusa). Tratado na sequência (6º campo). |
| V5 | **I17i confirmada** para `PUT` em lote finalizado. |
| V6 | **Não observável em HML** (sem retorno bancário, sem pool com o boleto sintético). Aberto. |
| V7 | 237/104 ok com modalidade 7; 329 = `BANCO_NAO_CADASTRADO` em HML (recusa determinística ⇒ `retirar`). |
| V8 | `fin064.totalAberto` ≠ `titMnyValor` do grid em vários títulos: a igualdade é contra o `totalAberto` ao vivo (I17b); o valor da carteira/grid **não** é o aberto (o `shadow` é indicativo). |
| V9 | `finalizar` aceita barra = data de débito e barras até +10 dias do débito. |

| V10 *(medido 2026-10-26, ADR-0078)* | O ERP não compara a barra com a data do título: aceita Δ −5..+10 e devolve a data da **barra** em `itsDtaPgtoResult`. Modalidade 6 aceita; modalidade 7 recusada quando o banco da barra = banco do lote (sem relação com a data). |
| V11 *(medido 2026-10-26; rolagem medida 2026-10-27)* | R2 confirmada: `finalizar` aceita `dataDebito ≤ min(itsDtaPgto)` e recusa acima ("EXISTEM TÍTULOS QUE IRÃO VENCER ANTES DA DATA DE PAGAMENTO"). **Rolagem (R8):** barra no sábado é comparada como a segunda seguinte (lote 68 aceito); feriado não rola (lote 55, Finados, recusado). Regra: débito em ou antes da data da barra rolada só sobre sábado/domingo (I8c, ADR-0078 emenda 2026-10-27). |
| V12 *(medido 2026-10-26)* | Segmento J do `.REM`: *vencimento* = data do **título**; *data de pagamento* = data da **barra** (`itsDtaPgto`). O código de barras do mesmo J carrega o fator da barra. **Não medido: se o banco recusa J com vencimento ≠ fator do código** (só um boleto real pequeno e controlado em PRD responde). |

**Abertos:** V6; V-PRD1 (permissão do robô para o `PUT`, sonda só de leitura implementada e **não
executada**) e V-PRD2 (1 título real controlado); janela residual do V3.

## Erros nomeados

| Erro | Onde | HTTP |
|---|---|---|
| `VinculoCodigoBarrasIncompletoError` | I17g(2): falha transitória/ambígua pós-import; retomável | 409 |
| `VinculoCodigoBarrasDivergenteError` | I17d: valor/data/banco/juros divergentes (dispara retirada I17g(3)); mensagem pt-BR com `docCod/titCod`, valores, Δ com sinal, código **mascarado** | 409 |
| `ItemEditadoPorTerceiroError` | I17f: `itsNumCodbar`/valor/data diferentes do esperado; etapa `indeterminado` | 409 |
| `RemessaBarcodeDateMismatchError` *(nome provisório, I17q, ADR-0078, `planned`)* | J com barra de vencimento ≠ `0000` cuja data de pagamento ≠ `itsDtaPgto` do item; mensagem pt-BR, código **mascarado** | 409 |
| `RemessaBarcodeAmountMismatchError` | I17m (ADR-0074, `implemented`): J com barra > 0 e pagamento ≠ barra no `.REM` gerado; mensagem pt-BR com `docCod/titCod`, os dois valores e o código **mascarado** | 409 |

## Fora do escopo (watchlist)

Boleto acima/abaixo do título **até R$ 0,05**, mesmo vencimento, número igual e emissor confirmado: resolvido
**antes do vínculo**, no título, pela I18 (ADR-0074); o vínculo continua exigindo valor igual ao líquido.
**Acima de R$ 0,05** segue fora (watchlist: 25 títulos > R$ 10 em PRD, outro problema). Vínculo de tier
`ATENCAO` **fora** do caso de data divergente com valor igual (que vincula pelo I17p); vínculo automático sem decisão humana (passo 3); guarda entre lotes vivos / contra boleto pago. **ADR-0078:** fase 2 (ajustar a data do título via `fin026/alteraDataVencimento` ou `fin070`), boleto vencido na data de débito (juros/multa) e `|Δdias| > 10` seguem fora.

> **Emenda à I17k (2026-10-28):** na previsão local (`shadow` e o endpoint `vinculos-previstos`), o valor em
> aberto de um título renegociado pelo ajuste de centavos é o líquido do ledger (`valor_boleto_centavos`,
> I18j(5)), não o `valor` da carteira, que é o `titMnyValor` base, um centavo abaixo do boleto. Sem isso a
> tela avisava "valor do boleto diferente do valor em aberto (+R$ 0,01)" num título cujo líquido ao vivo
> já bate com o boleto (PRD, NELSON HEUSI 41027/2 e 41032/2). Continua sem chamada ao ERP. O modo `on` não
> muda: lê o líquido ao vivo no `fin064` (I17b).
>
> **Emenda à I17e (2026-10-28):** o `importar` do item elegível (modo `on`) vai em chamada própria e
> responde `YES` à pergunta `FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA…` (troca para a forma "título"),
> que o ERP faz quando o favorecido não tem conta no banco do lote. Sem isso o caminho parava em
> `ErpPerguntaError` (PRD, NELSON HEUSI). Escopo e justificativa: ADR-0040, emenda 2026-10-28.

## Ver também

`decisions/0071-*.md` · `actions/sispag/vincular-codigo-barras-ao-item.md` ·
`business-rules/sugestao-boleto-dda-sispag.md` (I15) · `business-rules/boleto-exige-codigo-de-barras.md`
(I16) · `entities/lote-pagamento.md` (`ItemLote.vinculoCodigoBarras`) ·
`entities/decisao-sugestao-boleto.md` · `entities/bloqueio-duplicidade.md` ·
`business-rules/retomada-remessa-sispag.md` · `_inbox/sispag-passo2-vinculo-codbar-proposta.md` ·
`decisions/0074-*.md` · `business-rules/ajuste-centavos-titulo-sispag.md` (I18) ·
`decisions/0076-*.md` · `business-rules/boleto-agrupado-sispag.md` (I21, item de borderô)

`decisions/0078-*.md` (data divergente, I17q/q) · `business-rules/data-debito-remessa-sispag.md` (I8c)
