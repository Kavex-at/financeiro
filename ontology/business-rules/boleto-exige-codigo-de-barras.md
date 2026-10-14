---
name: boleto-exige-codigo-de-barras
type: business-rule
ontology_version: "0.10"
implementation_status: implemented
status: active
owners: [yuri]
related_files:
  - src/backend/domain/errors/BoletoSemCodigoBarrasError.ts
  - src/backend/domain/errors/BoletoCodigoBarrasRepetidoError.ts
  - src/backend/domain/service/sispag/RemessaService.ts
  - src/backend/domain/libs/cnab/RemessaCnabValidator.ts
  - src/backend/domain/client/ConexosSispagWriteClient.ts
last_review: 2026-10-14
---

# Boleto exige código de barras (fail-closed no envio)

> Um item de lote com `modalidade = BOLETO` só vira linha de remessa se o Conexos tiver um
> **boleto DDA associado** ao título. Sem isso, a geração da remessa **falha** com
> `BoletoSemCodigoBarrasError` — antes de qualquer escrita no ERP.

## A regra

```
modalidade === 'BOLETO'  ∧  ¬temBoletoDda   ⇒   BoletoSemCodigoBarrasError (409)
```

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
| Dois itens BOLETO com o mesmo código de barras | `BoletoCodigoBarrasRepetidoError` | retirar o título repetido do lote local e gerar de novo |

**Boleto não precisa de conta do favorecido** — o destino é o próprio código de barras. Exigir
conta para boleto rejeitava justamente o fornecedor que só aceita boleto (o caso comum: em PRD,
1 de 5 favorecidos amostrados tinha conta cadastrada).

## Um código de barras, um item (I16)

> **Status: I16 `planned`** — a ontologia está à frente do código (ADR-0069). Vira `implemented` no ship.

> `titVldReflexoDdaAssoc` significa "existe boleto DDA com mesmo valor e vencimento"; **não reserva 1:1**.
> O ERP anexa o **mesmo** código de barras a cada item importado do grupo (caso PEDRONI, fil 2: 10 títulos
> de R$ 1.412,00 vencendo no mesmo dia, 2 boletos). A regra de ausência acima nunca prometeu unicidade:
> sem esta guarda, o mesmo boleto sai duas vezes no `.REM`. Esta é a duplicidade **por boleto**; a
> duplicidade **por título** é a I13g (ADR-0063).

| # | Invariante |
|---|---|
| **I16a** | **Um código de barras, um item.** Dentro de um mesmo lote/remessa, dois ou mais itens `modalidade = BOLETO` não podem carregar o mesmo código de barras **normalizado de 44 dígitos** (a linha digitável de 47 dígitos de `itsNumCodbar` é convertida para barras de 44; o segmento J do `.REM` já carrega 44). Violação ⇒ `BoletoCodigoBarrasRepetidoError` (409). |
| **I16b** | **Pontos de checagem.** (1) **Principal:** logo após `importarTitulos` e **antes de `finalizarLote`**, sobre `listarLinhasDigitaveisDoLote` (único ponto em que o código já existe e o último antes de o lote nativo virar FINALIZADO; rascunho nativo não se apaga por API, finalizado se cancela). (2) **Rede de segurança:** `RemessaCnabValidator` compara o 44 dígitos dos segmentos J do `.REM` gerado, e cobre o caso em que (1) foi pulado (retomada de etapa) ou a leitura dropou itens. Falha em (2) é tardia e segue o tratamento já existente do gate pós-geração (lote nativo finalizado e arquivo no ERP para cancelamento manual). O mesmo caminho serve lote manual e automático. |
| **I16c** | **Falha fechada para código presente mas inválido.** Item cujo código de barras existe porém foi descartado pela leitura (`dropped`: DV inválido, tamanho incorreto) impede a comparação confiável: o lote com BOLETO e `dropped > 0` **aborta** com o mesmo erro nomeado, em mensagem própria ("código de barras ilegível/inválido para o título X"). Nunca se ignora o item inválido para "seguir com o resto". Ausência continua sendo tratada pela regra `BoletoSemCodigoBarrasError`, antes desta. |
| **I16d** | **Semântica do aborto.** Aborta **antes de `finalizarLote`**; o ledger de idempotência da remessa é marcado `failed` com motivo e títulos; o **rascunho nativo permanece** e a retomada o **reaproveita**. A solução **não decide** qual título fica com o boleto (julgamento financeiro, human-in-the-loop) e **não descarta item em silêncio**: a analista tira o título repetido do lote **local** (RETIRAR) e gera de novo. |
| **I16e** | **Mensagem e privacidade.** A mensagem é em pt-BR e lista, para cada grupo repetido, os títulos (`docCod/titCod`), `valor`, `vencimento` e o código de barras **mascarado** (primeiros 5 + últimos 4 dígitos). O código completo **nunca** aparece em mensagem, log ou ledger, e **nada sobre o código de barras é persistido** por esta guarda: a leitura é ao vivo do ERP (sem migration). A guarda roda dentro de `gerarRemessa`, sem permissão nova; o bloqueio é auditado por `LogService.warn` (mascarado) e pelo ledger. |

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
ou confirmação). A confirmação de emissor continua sendo evidência, não autoridade (I15a).

## Ver também

- ADR-0040 — o boleto vem da associação DDA do ERP
- ADR-0068 / `business-rules/sugestao-boleto-dda-sispag.md` — a **confirmação de emissor** é
  evidência humana; **não** faz `temBoletoDda` = true e **não** substitui esta validação (I15a)
- `ontology/_inbox/sispag-boleto-dda-sondagem.md` — as medições
- `business-rules/elegibilidade-titulo-lote.md` — I2, elegibilidade do item
- ADR-0063 / `business-rules/verificacao-ted-pix-sispag.md` — I13g, duplicidade por TÍTULO
- ADR-0069 — I16, duplicidade por BOLETO (um código de barras, um item); pré-requisito do passo 2 da ADR-0068
