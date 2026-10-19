---
name: boleto-exige-codigo-de-barras
type: business-rule
ontology_version: "0.44.0"
implementation_status: partial
status: active
owners: [yuri]
related_files:
  - src/backend/domain/errors/BoletoSemCodigoBarrasError.ts
  - src/backend/domain/errors/BoletoCodigoBarrasRepetidoError.ts
  - src/backend/domain/service/sispag/RemessaService.ts
  - src/backend/domain/libs/cnab/RemessaCnabValidator.ts
  - src/backend/domain/client/ConexosSispagWriteClient.ts
  - src/backend/domain/libs/boleto/AnaliseCodigoBarrasRepetido.ts
  - src/backend/domain/libs/boleto/CodigoBarrasBoleto.ts
last_review: 2026-10-19
---

# Boleto exige código de barras (fail-closed no envio)

> Um item de lote com `modalidade = BOLETO` só vira linha de remessa se o Conexos tiver um
> **boleto DDA associado** ao título. Sem isso, a geração da remessa **falha** com
> `BoletoSemCodigoBarrasError` — antes de qualquer escrita no ERP.

## A regra

```
modalidade === 'BOLETO'  ∧  ¬temBoletoDda  ∧  ¬(vínculo I17 elegível e executado)  ⇒   BoletoSemCodigoBarrasError (409)
```

> **Emenda ADR-0071.** Com o vínculo do passo 2 em modo `off`/`shadow` (default) o texto sem a exceção
> vale **literalmente**. A exceção só existe com `on` e item elegível (`business-rules/vinculo-codbar-item-sispag.md`, I17).

`temBoletoDda` = `titVldReflexoDdaAssoc === 1` na linha do grid de pendentes do `fin015`, lido
**ao vivo no envio**.

## Por que

O código de barras **não existe no título** — 0% de `titEspCodbar` em `fin064` (2000 títulos),
no grid de pendentes (2173) e no `com308` (50), medido em produção. Ele chega ao item só pela
associação do boleto DDA (`fin124`), que o ERP faz quando pedimos.

Sem essa associação, o item entra no lote com barras vazia e o `.REM` sai com **segmento J sem
código de barras**: um pagamento que o banco não liquida, descoberto depois do arquivo pronto —
possivelmente depois de entregue. Falhar antes é mais barato que falhar no banco.

## Por que no ENVIO e não no rascunho

Decisão do Yuri (2026-08-27), coerente com a doutrina anti-drift do SISPAG: o rascunho é onde a
analista pensa, e travar ali a obrigaria a resolver o boleto antes de montar o lote. A validação
autoritativa acontece **ao vivo**, com o estado do ERP no momento do envio — igual a
`prontoParaRemessa` (informativo) × validação real na remessa.

Na UI, o `LoteCard` já sinaliza antes: quando BOLETO está escolhido e não consta das formas
disponíveis, o item aparece com aviso *"sem boleto DDA — a remessa sairia sem código de barras"*.

## Não confundir com "favorecido sem conta"

São dois fail-closed diferentes:

| Situação | Erro | Saída |
|---|---|---|
| BOLETO sem boleto DDA | `BoletoSemCodigoBarrasError` | importar o DDA no `fin124`, ou trocar a forma |
| TED/crédito sem conta ativa | erro de destino (`cmn025`) | cadastrar a conta do favorecido |
| BOLETO sem DDA **com decisão confirmada** (valor igual, Δdias 0..5), modo `on` | vínculo I17 (ADR-0071); fora da faixa: `BoletoSemCodigoBarrasError` com a diferença com sinal na mensagem | ver o selo/aviso do lote |
| Dois itens BOLETO com o mesmo código de barras | **retirada automática** (I16d, ADR-0069 Emenda 1); `BoletoCodigoBarrasRepetidoError` só na rede do `.REM` (I16b(2)) | ver o aviso do lote (I16f); o título retirado fica retido (I16g) |

**Boleto não precisa de conta do favorecido** — o destino é o próprio código de barras. Exigir
conta para boleto rejeitava justamente o fornecedor que só aceita boleto (o caso comum: em PRD,
1 de 5 favorecidos amostrados tinha conta cadastrada).

## Um código de barras, um item (I16)

> **Status: I16a–c e I16e (aborto) `implemented`** (ADR-0069, app v0.66.1). **I16d–I16h
> (retirada automática, ADR-0069 Emenda 1, ontologia v0.41.0) `planned`: a ontologia está à frente do
> código** até a feature de remoção ship. Até lá o comportamento em produção continua sendo o aborto da
> ADR-0069 original.
>
> A guarda é uma função pura sobre os códigos do lote (`AnaliseCodigoBarrasRepetido`), chamada em
> `RemessaService` entre o import e o `finalizarLote` — inclusive em retomada — e, como rede, no gate
> 5.1 do `.REM`.
>
> Detalhes da entrega (PR 1):
> - `ConexosSispagWriteClient.listarLinhasDigitaveisDoLote` passou a devolver `invalidos`
>   (`docCod/titCod` dos códigos presentes porém ilegíveis — nunca o código) para que a mensagem de I16c
>   nomeie o título.
> - A máscara (5 primeiros + 4 últimos) é uma definição própria da guarda
>   (`AnaliseCodigoBarrasRepetido.mascarar`); não altera `CodigoBarrasBoleto.mascarar` (I15k, banco…4)
>   nem a máscara do `RemessaCnabValidator` para barras inválidas.
> - **Limite conhecido (R3):** `listarLinhasDigitaveisDoLote` é leitura de página única (500). Se
>   `itens + invalidos` for menor que o número de itens BOLETO do lote (leitura truncada ou item ainda sem
>   código), a guarda **avisa** (`LogService.warn`) e segue; a rede do `.REM` cobre. **Leitura
>   incompleta nunca vira retirada** (I16c, P0-3(c)); virar abort é decisão pendente.
> - **Limite conhecido (rascunho):** a leitura é do que está no rascunho nativo do ERP. O item já
>   importado só sai do rascunho nativo pelo `DELETE` de I16d.3 (verificado em HML, 2026-10-14).

> `titVldReflexoDdaAssoc` significa "existe boleto DDA com mesmo valor e vencimento"; **não reserva 1:1**.
> O ERP anexa o **mesmo** código de barras a cada item importado do grupo (caso PEDRONI, fil 2: 10 títulos
> de R$ 1.412,00 vencendo no mesmo dia, 2 boletos). A regra de ausência acima nunca prometeu unicidade:
> sem esta guarda, o mesmo boleto sai duas vezes no `.REM`. Esta é a duplicidade **por boleto**; a
> duplicidade **por título** é a I13g (ADR-0063).

| # | Invariante |
|---|---|
| **I16a** | **Um código de barras, um item.** Dentro de um mesmo lote/remessa, dois ou mais itens `modalidade = BOLETO` não podem carregar o mesmo código de barras **normalizado de 44 dígitos** (a linha digitável de 47 dígitos de `itsNumCodbar` é convertida para barras de 44; o segmento J do `.REM` já carrega 44). Violação ⇒ `BoletoCodigoBarrasRepetidoError` (409). |
| **I16b** | **Pontos de checagem.** (1) **Principal:** logo após `importarTitulos` e **antes de `finalizarLote`**, sobre `listarLinhasDigitaveisDoLote` (único ponto em que o código já existe e o último antes de o lote nativo virar FINALIZADO; rascunho nativo não se apaga por API, finalizado se cancela). (2) **Rede de segurança:** `RemessaCnabValidator` compara o 44 dígitos dos segmentos J do `.REM` gerado, e cobre o caso em que (1) foi pulado (retomada de etapa) ou a leitura dropou itens. Falha em (2) é tardia e segue o tratamento já existente do gate pós-geração (lote nativo finalizado e arquivo no ERP para cancelamento manual). O mesmo caminho serve lote manual e automático. **Emenda ADR-0073 (`planned`):** a rede (2) passa a conferir também **barra (> 0) == pagamento do J** (I17m, `RemessaBarcodeAmountMismatchError`), com o mesmo tratamento tardio. |
| **I16c** | **Código lido e descartado é retirado; ausência e leitura incompleta abortam (decisão P0-3(c)).** Item cujo código de barras **foi lido** do ERP porém descartado pela leitura (`dropped`: DV inválido, tamanho incorreto) impede a comparação confiável e **é retirado** conforme I16d.2 (motivo `CODIGO_BARRAS_ILEGIVEL`): nunca se mantém no lote um item cujo código não pôde ser comparado. **Ausência pura** (item BOLETO sem código: `BoletoSemCodigoBarrasError`, antes desta guarda) e **leitura incompleta ou falha de leitura** da lista nativa **continuam abortando**: podem ser falha do ERP, não problema do título, e **leitura incompleta nunca vira retirada**. |
| **I16d** | **Retirada automática (Emenda 1, ADR-0069).** Achada a repetição (I16a) ou item com código lido e descartado (I16c), a solução **retira** os itens ofensores e **continua a remessa com o restante**, antes de `finalizarLote` nativo. Nunca em silêncio: a analista é informada (I16f) e o título fica retido (I16g). Valem I16d.1–I16d.8. Vale para lote manual e automático (P1-2(a)). A rede do `.REM` (I16b(2)) **não** retira: continua abortando. |
| **I16d.1** | **O que sai, o que fica.** Por grupo de itens BOLETO com o mesmo código normalizado de 44 dígitos, **fica exatamente um** e **saem os demais**. O que fica: **menor `vencimento`, depois menor `docCod`, depois `filCod`, depois `titCod`** (comparação numérica onde o campo é numérico). Heurística de desempate, **não** juízo financeiro sobre qual dívida o boleto quita; a retirada é reversível (I16g). **Nunca** se retira o item que fica. **Emenda ADR-0071 (P1-1(b), `planned`):** quando houver **exatamente um** título do grupo com decisão humana vigente (ADR-0068, I17a), ele é o que fica, antes da ordem acima. |
| **I16d.2** | **Cláusula de código ilegível (P0-3(c)).** Item `modalidade = BOLETO` cujo código **foi lido e descartado** (DV inválido, tamanho incorreto: I16c), depois do import (e, no passo 2 da ADR-0068, depois do `PUT`: I17e/I17h, ADR-0071), **é retirado**, sem grupo e sem "o que fica". **Não** se retira por ausência pura nem por leitura incompleta: aí a guarda aborta (I16c). Só dois casos retiram: código **lido e repetido** (I16a) e código **lido e descartado**. |
| **I16d.3** | **Local primeiro, ERP depois.** Para cada item a retirar: (1) numa transação local, remover o item do lote local, criar a marca de retenção (I16g) e gravar o evento na trilha (I16e/I16f); (2) só então `DELETE fin015/finItemSispag/{bncCod}/{flpCod}/{itsCodSeq}/{filCod}/{filCodLote}` no rascunho nativo, com `itsCodSeq` lido **na hora** de `fin015/finItemSispag/list` (nunca de cache); (3) reler a lista e **confirmar a ausência**: o sucesso é a ausência observada, não o `200` do DELETE. A ordem inversa criaria item fora do ERP e ainda no lote local, que a retomada reimportaria. |
| **I16d.4** | **Ator e motivo.** Ator `sistema` (`SISPAG_SYSTEM_ACTOR`). Motivos novos no enum `SystemRemovalReason`: `CODIGO_BARRAS_REPETIDO` e `CODIGO_BARRAS_ILEGIVEL`; **ADR-0071 (`planned`):** `+ VINCULO_CODIGO_BARRAS_FALHOU` (falha determinística do vínculo pós-import, I17g(3)). O evento carrega: identidade do título retirado (`filCod/docCod/titCod`), `valor`, `vencimento`, o **código mascarado** (5+4) e, para repetição, a identidade do título **que ficou**. Nunca o código completo. |
| **I16d.5** | **Idempotência.** Reexecutar a guarda sobre o mesmo rascunho é seguro: item já fora do lote local e já ausente da lista nativa não gera novo evento nem novo `DELETE`; item fora do lote local e ainda presente no rascunho gera **só** o `DELETE` (I16h). Evento de trilha único por `(lote, título, motivo)`; marca `ATIVO` única por título. |
| **I16d.6** | **Falha parcial fecha.** Se algum `DELETE` falhar (ou a releitura ainda mostrar o item): **não** se chama `finalizarLote`; ledger `failed` com motivo `LIMPEZA_CODIGO_REPETIDO_INCOMPLETA` e os títulos pendentes; erro nomeado `BoletoCodigoBarrasRetiradaIncompletaError` (409). Itens já retirados **permanecem retirados**; a retomada termina a limpeza (I16h). Falha de **leitura** da lista nativa não decide: é incompleta, nunca "limpo". |
| **I16d.7** | **Pós-limpeza.** Depois de retirar, a guarda **relê** os códigos e **reaplica** I16a: só passa a `finalizarLote` com zero código repetido e zero item ilegível. Lote que **esvazia** (só possível pela cláusula de ilegível) falha com erro nomeado, ledger `failed`, rascunho nativo vazio permanece (espelho de `BatchEmptiedByCheckError`). |
| **I16d.8** | **Exceção estreita à máquina de estados do lote (P0-1(a)).** `gerarRemessa` roda com o lote local em `FINALIZADO` (L8). Durante essa chamada, e **só** para código repetido ou ilegível, o sistema retira o item do lote `FINALIZADO` **sem mudar o status**, com `versao` incrementada, evento na trilha e recálculo do total (valor e contagem). Nenhum outro caminho retira item de lote `FINALIZADO`. |
| **I16e** | **Mensagem e privacidade (emenda).** Mensagens em pt-BR, listando por grupo `docCod/titCod`, `valor`, `vencimento` e o código **mascarado** (5 primeiros + 4 últimos). O código completo **nunca** aparece em mensagem, log, ledger ou trilha e **nunca é persistido** (sem hash, sem HMAC; follow-up no watchlist). **Só o código mascarado persiste** (P1-3(a)), dentro do evento de trilha e da marca de retenção (I16d.4, I16g), porque a analista precisa reconhecer o boleto depois de recarregar a tela. Migration: **uma**, só para o discriminador `origem` e campos de I16g. Sem permissão nova; auditado por `LogService.warn` (mascarado), ledger e trilha. |
| **I16f** | **Quem foi informado e como.** Toda retirada automática é (1) evento só-inclusão na trilha do lote (`CODIGO_BARRAS_REPETIDO` / `CODIGO_BARRAS_ILEGIVEL`), ator `sistema`; (2) devolvida no resultado de `gerarRemessa` como `retiradosPorCodigoBarras: [{ titulo, valor, vencimento, codigoMascarado, tituloMantido? }]`; (3) exibida no `LoteCard` como aviso **persistente** enquanto o lote existir (lê a trilha); (4) listada na aba de títulos como "retidos por boleto repetido" com ação de desfazer com motivo (I16g). A remessa **conclui**, mas o resultado carrega `avisos` não vazio para a automação diária não tratar "tudo certo" quando houve retirada. UI em pt-BR, identificando por `docCod/titCod` e favorecido. |
| **I16g** | **Retenção do título retirado.** Todo item retirado por I16d ganha uma `BloqueioDuplicidade` `ATIVO` com `origem` correspondente (ciclo na entidade). A marca é criada **na mesma transação** da remoção local (I16d.3); no máximo uma `ATIVO` por título; o título retido não entra em formação nem inclusão (`DuplicateHoldError`). A analista pode **desfazer** com motivo (auditado): o título volta ao pool e, se o boleto ainda estiver compartilhado, a próxima guarda o retira de novo, com novo evento. Desfazer **não** troca o item que ficou; para pagar o retido, resolver o boleto no `fin124` ou mudar a forma de pagamento. |
| **I16h** | **Retomada (resume) com resíduos.** Em `RemessaService`, `intrusos = jaNoErp \ nossas`; `residuos` = intrusos com marca `ATIVO` de origem `CODIGO_BARRAS_REPETIDO`/`CODIGO_BARRAS_ILEGIVEL` **e** evento do sistema neste lote; `estranhos = intrusos \ residuos`. **(a)** item retirado **nunca é reimportado** (`nossas` é o lote local; a importação parcial também). **(b)** fail-closed: `estranhos` não vazio ⇒ etapa `indeterminado`, mesmo havendo resíduos; nunca se limpa parcialmente num rascunho tocado por terceiro. **(c)** reconhecimento exige o **par** marca + evento; retirada por `DUPLICIDADE_TITULO` ou por I13j **não** é resíduo (segue intruso; divergência herdada no watchlist, P1-4(a)). **(d)** a guarda roda em **todo** caminho que chega a `finalizarLote`, inclusive a etapa `finalizar` direta. **(e)** `estranhos = ∅ ∧ residuos ≠ ∅` ⇒ nova etapa `limpar_retirados`: `DELETE` dos resíduos, reler, reavaliar. O comportamento do ERP para `DELETE` de `itsCodSeq` foi **medido em HML (2026-10-14, P1-5 fechado)**: existente ⇒ `200` e a `soma` do lote cai o valor do item (`titulosCount` fica em 1); **já ausente ou nunca existente ⇒ `500 RECORDNOTFOUND`**; `filCod` do item ou do lote trocado ⇒ `500 RECORDNOTFOUND` sem efeito; em lote nativo **finalizado** ⇒ `400 FIN_015.IMPOSSIVEL_ALTERAR_REGISTRO_NAO_EM_CADASTRO` (a limpeza só existe antes do `finalizar`). Por isso a decisão continua sendo pela releitura da lista, nunca pelo status do `DELETE` (registro: `ontology/_inbox/sispag-remocao-codbar-repetido-hml-achados.md`). |

**O ERP não valida o código (achado HML, 2026-10-14).** Experimentos em HML mostraram que o Conexos
**não valida o dígito verificador** de um código de barras digitado **nem o compara com o título**;
`importar` **descarta** o código enviado no payload; o código só chega ao item via
`PUT fin015/finItemSispag`, depois de `validacao/codigoBarras` + `confirmaCodigoBarras`. (Resumo do
achado; o registro bruto vive na branch `chore/sispag-hml-bind-experimentos`, ainda fora desta.)
Consequências para I16: (i) a checagem de unicidade roda sobre o código de **44 dígitos derivado de
`itsNumCodbar` DEPOIS que o item é final**: pós-`importarTitulos` e, no passo 2 da ADR-0068, também
**pós-edição** (após o `PUT finItemSispag`), nunca sobre o que foi enviado; (ii) a guarda **não pode
confiar que o ERP rejeitou** um código malformado: DV inválido, tamanho errado e valor divergente do
título são responsabilidade nossa (I16c trata o inválido; a divergência de valor fica com a validação
do passo 2). **Esta guarda é pré-requisito do passo 2 da ADR-0068 (o bind de valor igual).**

**Escopo e limites.** Vale **dentro do lote**. A repetição **entre lotes vivos** (ex.: o mesmo boleto em dois
lotes por vencimento, ADR-0064) e contra boleto **já pago** NÃO é coberta; requer persistir hash salgado do
código (HMAC com segredo do `EnvironmentProvider`) + migration + ADR próprio. Follow-up registrado no
watchlist.

**Relação com outras decisões.** Complementa a ADR-0063 (duplicidade por título; I13g) com a duplicidade por
boleto. É **pré-requisito do passo 2 da ADR-0068**: vincular o código de um boleto confirmado ao título passa
pelo mesmo import, e sem esta guarda confirmar o mesmo boleto para N títulos reproduz o caso PEDRONI por ação
humana. A guarda opera sobre `itsNumCodbar` pós-import, independente de como o código chegou (DDA flagado
ou confirmação). A confirmação de emissor continua sendo evidência, não autoridade (I15a). A retirada automática (I16d) consulta a decisão humana da ADR-0068 para escolher quem fica apenas a partir da emenda do ADR-0071 (`planned`, I17h).

## Ver também

- ADR-0040 — o boleto vem da associação DDA do ERP
- ADR-0068 / `business-rules/sugestao-boleto-dda-sispag.md` — a **confirmação de emissor** é
  evidência humana; **não** faz `temBoletoDda` = true e **não** substitui esta validação (I15a)
- `ontology/_inbox/sispag-boleto-dda-sondagem.md` — as medições
- `business-rules/elegibilidade-titulo-lote.md` — I2, elegibilidade do item
- ADR-0063 / `business-rules/verificacao-ted-pix-sispag.md` — I13g, duplicidade por TÍTULO
- ADR-0069 (+ Emenda 1) — I16, duplicidade por BOLETO (um código de barras, um item; retirada automática I16d–h); pré-requisito do passo 2 da ADR-0068
- `entities/bloqueio-duplicidade.md` — marca de retenção (`origem`), I16g
- ADR-0071 / `business-rules/vinculo-codbar-item-sispag.md` — I17, vínculo do código confirmado ao item (passo 2); etapa `vincular_codbar` antes da guarda
- ADR-0073 / `business-rules/ajuste-centavos-titulo-sispag.md` — I18 (ajuste de centavos no título) e I17m (barra == pagamento do J na rede do `.REM`)
