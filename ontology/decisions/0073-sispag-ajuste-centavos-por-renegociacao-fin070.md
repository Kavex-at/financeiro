---
adr_number: 0073
title: SISPAG — ajuste de centavos do título por renegociação no fin070 (o valor do boleto é a verdade)
date: 2026-10-19
status: accepted
type: addition
related_entities: [TituloAPagar, DecisaoSugestaoBoleto, ConfirmacaoEmissorBoleto, LotePagamento]
related_business_rules: [ajuste-centavos-titulo-sispag, vinculo-codbar-item-sispag, sugestao-boleto-dda-sispag, boleto-exige-codigo-de-barras, identidade-execucao-conexos]
continues: [0068, 0071, 0072]
evidence:
  - ontology/_inbox/sispag-ajuste-centavos-interview.md
  - ontology/_inbox/sispag-centavos-hml-achados.md
  - "HML 2026-10-19: fin070 frnCod 3 (536/1 -> 536/2, tpop 1) e 4 (540/1 -> 540/2, tpop 2), liberação fin103 fbaCod 3, vínculo e .REM PG191074/PG191075 com J pagando o valor da barra"
  - "PRD 2026-10-19 (só leitura): 109 títulos <= R$ 0,05 com número igual (todos NELSON +0,01); 0 entre R$ 0,06 e R$ 10; 25 > R$ 10"
---

# ADR 0073: ajuste de centavos do título por renegociação (fin070)

**Branch:** `feat/sispag-ajuste-centavos`. `/feature-tweak`. `entity_changed = true`. Ontologia **0.44.0**
(regra e ação `planned`, à frente do código). Migration prevista: **0087**.

> Reconferir antes do ship: `origin/main` em 2026-10-19 = app v0.69.0, ontologia 0.43.0, último ADR 0072,
> última migration 0086.

## Contexto

A sugestão (I15c) deixa a analista confirmar pares com |Δ| ≤ R$ 0,05 no mesmo dia, mas o vínculo (I17b)
exige barra == `fin064.totalAberto` ao centavo. Resultado: par confirmado que nunca é pago — 109 títulos
NELSON HEUSI em PRD, todos +R$ 0,01. Os experimentos de HML mostraram que o J do `.REM` paga o **valor do
título**, não o do item; nenhum campo do item, nem `PUT fin026`, nem `fin062` resolve. A Renegociação de
Pagamentos (`fin070`) com `frnVldTpop 1/2` muda o título (juros/desconto), o título novo volta a bloquear na
`fin103` e, liberado, vincula e gera o J com pagamento = barra. Também se achou um bug latente: o `importar`
manda `titMnyValor` (base) como valor do item, não o líquido.

## Decisão

1. **O valor do boleto é a verdade** (D1). Acima ⇒ juros (`frnVldTpop 1`); abaixo ⇒ desconto (`frnVldTpop 2`).
2. **Nova regra `ajuste-centavos-titulo-sispag` (I18a–n) e nova ação `ajustarCentavosTitulo`.** Elegível só
   com |Δ| ≤ `LIMITE_VALOR_MESMO_DIA` (R$ 0,05, constante reaproveitada), mesmo vencimento, número igual
   **e** par de emissor `VIGENTE` (o falso par MSC prova que o número sozinho colide), decisão `CONFIRMADA`,
   título original aprovado, não pago, sem pagamento parcial.
3. **Reaprovação estreita** (D4): só o bloqueio que a nossa renegociação criou, com valor = boleto, pelo único
   comando "APROVAR" ativo; qualquer outro bloqueio volta ao fluxo normal.
4. **Identidade = sessão do servidor** (`CONEXOS_USERNAME` do ambiente), explícita; nunca a analista, nunca
   cron (CLONEX). Correção da entrevista: o "robô" do resolver é a credencial do ambiente, não necessariamente
   o CLONEX.
5. **Disparo** logo após o commit do `confirmar`, fora da transação dele, com "tentar de novo" e varredura de
   retomada no processo do servidor. Ledger write-ahead com marcador de correlação; antes do `finalizar` a
   falha cancela a renegociação; depois, só para a frente.
6. **Rechaveamento numa transação local:** decisão antiga `ANULADA` (`TITULO_RENEGOCIADO`, sistema), nova
   `CONFIRMADA` no título novo com o autor humano herdado (transferir não é confirmar), upsert da carteira,
   troca do item em lote `RASCUNHO`. Lote finalizado/remessa/rascunho nativo ⇒ não renegocia e avisa;
   `finalizarLote` fica bloqueado enquanto o ajuste corre.
7. **Base (vale para toda remessa, com ou sem ajuste):** I17b compara com o **líquido aberto** (fail-closed na divergência
   das duas fórmulas); **I17n** o import do item leva o líquido; **I17m** o `.REM` bloqueia J cuja barra (> 0)
   difere do pagamento.
8. **Rollout** (D6): flag `off/shadow/on` por filial, default `off`; `on` em PRD só depois de G1–G5 e go do
   maintainer. *(Substituído pela emenda 2026-10-20: sem flag dedicada, ativo após o merge.)*

## Decisões do maintainer (2026-10-19)

Da entrevista (`_inbox/sispag-ajuste-centavos-interview.md`, "Respostas do maintainer"):

| # | Decisão |
|---|---|
| D1 | O valor do boleto é a verdade: acima ⇒ juros; abaixo ⇒ desconto. |
| D3 | Limite R$ 0,05 (`LIMITE_VALOR_MESMO_DIA`, reaproveitada) **e** número do documento igual **e** emissor confirmado (par `VIGENTE`) **e** mesmo vencimento. |
| D4 | Dentro do limite a plataforma reaprova só o bloqueio criado pela própria renegociação, e só se o título original estava aprovado. Acima, nada automático. |
| P0-1 | Identidade = **sessão do servidor** (credencial do ambiente, `CONEXOS_USERNAME`, hoje MPS_FRANCINEI). Nunca a sessão da analista, nunca cron (crons rodam como CLONEX, sem `fin070`/`fin026`/`fin103`). O "robô" do resolver é a credencial do ambiente, não necessariamente o CLONEX. Antes de `on`: sonda só leitura de `fin070`/`fin103` em PRD. |
| P0-2 | Disparo logo após a confirmação do par, fora da transação do `confirmar`, com "tentar de novo" e varredura de retomada. |
| P0-3 | Lote local `RASCUNHO` ⇒ o item passa ao título novo na mesma transação; lote finalizado, com remessa gerada ou no rascunho nativo ⇒ não renegocia e avisa. |
| P1 | Liberar só o bloqueio nascido da nossa renegociação; só mesmo vencimento; vencimento passado/hoje provado em HML antes de `on`; líquido com pagamento parcial medido em PRD antes do merge; renegociações 3 e 4 de HML ficam; conta contábil é premissa. |

Da revisão do diff (`_inbox/sispag-ajuste-centavos-ontology-diff.md`, aprovado em 2026-10-19):

| # | Decisão |
|---|---|
| M1 | **Transferência auditada:** a decisão antiga vai a `ANULADA` pelo sistema com `tipoAnulacao = TITULO_RENEGOCIADO`; nasce `CONFIRMADA` no título novo com `decididoPor`/`decididoEm` herdados da analista original, `origemDecisaoId` e `transferidaPor = 'sistema'`. I15g emendada ("transferir não é confirmar") e CHECKs da 0084 relaxados **só** para esse caso. |
| M2 | Varredura de retomada só no processo do servidor (após o `confirmar`, no "tentar de novo", ao abrir a tela do SISPAG); nunca em cron nem no `bootstrapAppContainer`. |
| M3 | Identidade esperada fixada por configuração: `on` exige sonda G1 aprovada para o login configurado; login trocado ⇒ `shadow` até nova sonda. |
| M4 | Título com pagamento parcial fica fora do ajuste (I18a(6)). |
| M5 | `finalizarLote` recusa lote com título em ajuste não terminal (`TitleAdjustmentInProgressError`). |
| M6 | Na troca do item em `RASCUNHO`, `ItemLote.valor` passa ao líquido do título novo. |
| M7 | `shadow` do ajuste faz leituras ao vivo no ERP, zero escrita. |
| M8 | I17m bloqueia (fail-closed), com medição prévia só leitura dos `.REM` de PRD dos últimos 30 dias; casos legítimos ⇒ nasce `warn` e vira bloqueio por ADR curta. |
| M9 | Cancelamento de renegociação não finalizada e reconhecimento pelo marcador são portão G3 (HML) antes de `on`. |

## Rejeitado

- **Corrigir o documento no `com298` (estornar → editar → finalizar)** — REJECT-PREMATURE: não testado, mexe no
  documento inteiro (todas as parcelas, contabilização de origem) e depende de a Columbia preferir isso à
  renegociação (D7). Watchlist.
- **Desconto nativo `fin062`/`fin063`** — REJECT-WORKAROUND: recusado em HML (`docCod Generic.NOT_VALID`,
  mesmo com título a vencer) e não cobre acréscimo, que é 125 de 126 casos.
- **Declarar juros/desconto/valor no item** (`itsMnyRecbrac`, `titMnyJuros`, `titMnyDesconto`, `itsMnyValor`,
  `titMnyLiquido`) — REJECT-WORKAROUND: o J paga o título (A2 recusa; B0/B1/B2 pagam 1 centavo a mais que a barra).
- **`PUT fin026` para valor** — REJECT-WORKAROUND: aceito e ignorado.
- **Alargar a I17b para Δ ≤ R$ 0,05 sem mudar o título** — REJECT-WORKAROUND: o banco recebe J com pagamento ≠ barra.
- **Renegociar dentro da remessa ou na transação do `confirmar`** — REJECT-WORKAROUND: título já importado;
  total do lote muda depois do `finalizar`; 5–7 escritas no ERP acopladas a uma transação local.
- **Sessão da analista ou cron (CLONEX)** — rejeitado por D4/P0-1 (autoria errada ou 403).
- **Ajuste acima de R$ 0,05** — REJECT-PREMATURE: os 25 casos > R$ 10 são outro problema (valor previsto,
  retenção, falso par). Watchlist.
- **Entidade `RenegociacaoTitulo`/`AjusteCentavos`** — REJECT-DUPLICATE: ledger de execução (padrão I-2) +
  trilha da decisão.
- **`titCodOrigem`/`frnCod`/`valorLiquido` em `TituloAPagar`** — REJECT-WORKAROUND (UPSERT apaga) /
  REJECT-PREMATURE (o list do `fin064` traz o líquido?).
- **Estado persistido `AJUSTADA` na decisão** e **`UPDATE` do `tit_cod`** — REJECT-WORKAROUND (decisão
  imutável; execução é derivada, precedente `APLICADO_NO_ERP` da ADR-0071).
- **Constante nova para o limite** — REJECT-DUPLICATE (`LIMITE_VALOR_MESMO_DIA`).
- **Filiais, modo, regra 19, `fbaCod`, login, conta contábil na ontologia** — REJECT-CONFIG / lidos ao vivo.

## Consequências

- **I1 deixa de ser absoluta para `TituloAPagar`:** a plataforma passa a escrever no título do ERP, em um caso
  estreito (I18). Toda a escrita no título fica nesta regra.
- **I15g é emendada:** "o sistema nunca confirma" continua; a **transferência** de uma confirmação humana para o
  título renegociado é ação do sistema, auditada, que herda o autor. CHECK da 0084 relaxado só para
  `tipoAnulacao = TITULO_RENEGOCIADO` (migration 0087).
- Ledgers de escrita irreversível no ERP passam de seis para **sete** (I-2).
- O CNAB ganha uma guarda nova (I17m) que vale para todo J — medir antes (M8).
- O título renegociado volta a ter `titMnyValor` base na carteira e na sugestão (Δ continua +0,01, dentro da
  I15c); a UI mostra o líquido a partir do ledger.

## Premissas pendentes com a Columbia (não bloqueiam)

Renegociação × correção do documento; conta contábil de juros/desconto (default do `fin070`); usuário de
aprovação no `fin103` (sessão do servidor); permissão do login do servidor em `fin070`/`fin103` em PRD
(o CLONEX não tem `fin070`/`fin026`/`fin103` no menu). HML: renegociações 3 e 4 ficam como estão (P1-5).
Universalidade: 1 cliente, revisão com o Francinei não bloqueante.

## Emenda 2026-10-20: sem flag dedicada; ativo após o merge

**Decisão do maintainer.** O ajuste de centavos não tem mais flag própria: as variáveis de modo por filial e
de login sondado foram removidas (código, `EnvironmentProvider`, docs e testes). O ajuste fica **ativo logo
após o merge**. Isso substitui o item 8 da Decisão (flag `off/shadow/on` por filial, default `off`) e a M3
(login sondado fixado por configuração).

- **Modo efetivo** (`ModoAjusteCentavos.resolverModoEfetivo`, global, sem filial): `on` quando o processo é o
  servidor (`ServerProcessMarker`), há credencial Conexos do servidor, `SISPAG_LIVE_WRITE_ENABLED` ligado,
  escrita no Conexos ligada e `CONEXOS_DRY_RUN` desligado; qualquer falha ⇒ `shadow` (leitura ao vivo, zero
  escrita), com os motivos em `warn`. Não existe mais `off` por configuração.
- **Kill-switch:** `SISPAG_LIVE_WRITE_ENABLED=false` (derruba também as demais escritas do SISPAG).
- **Racional:** flags demais para operar a mesma frente; a G1 (sonda de permissão de `fin070`/`fin103`) já
  passou em PRD para o login do servidor (MPS_FRANCINEI), então o portão que a M3 protegia está cumprido.
  Trocar o `CONEXOS_USERNAME` do servidor passa a exigir nova sonda como procedimento operacional, não como
  configuração.
