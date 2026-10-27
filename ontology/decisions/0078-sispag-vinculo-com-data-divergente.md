---
adr_number: 0078
title: SISPAG — vínculo de código de barras com data divergente (ack tipado, 7º check do fator de vencimento e prazo efetivo visível)
date: 2026-10-26
status: accepted
type: change
related_entities: [DecisaoSugestaoBoleto, ItemLote, LotePagamento, TituloAPagar, BoletoDda]
related_business_rules: [vinculo-codbar-item-sispag, sugestao-boleto-dda-sispag, data-debito-remessa-sispag, situacao-pagamento-titulo]
continues: [0068, 0071, 0072, 0075]
amends: [0071, 0072, 0075]
evidence:
  - ontology/_inbox/sispag-vinculo-data-divergente-interview.md (P0-1..P0-4, "Visibilidade do prazo efetivo" e "Respostas à revisão do diff", maintainer 2026-10-26)
  - ontology/_inbox/sispag-vinculo-data-divergente-ontology-diff.md (aprovado pelo maintainer em 2026-10-26)
  - "ADR-0071 (I17c: 'nunca vincula Δ<0', 'passo 2 não lê ack'); ADR-0072 (I15o, reconheceAvisos); ADR-0070 (vencido por dia civil); ADR-0075 (I19)"
---

# ADR 0078: vínculo com data divergente

**Ontologia à frente do código:** tudo o que é novo ou emendado nasce `planned`. **P1-5 e P1-6 foram
aprovados como defaults** (modo próprio `off`; guarda de data do `.REM` fail-closed; medição do J em HML antes
de qualquer código; **Δ>0 em aberto até a medição**).

## Contexto
O passo 2 (ADR-0071) só vincula boleto com valor igual e Δdias ∈ [0,5]. Boleto com valor igual mas data fora
disso (antes do título, ou 6–10 dias depois) fica sem código de barras e a remessa aborta, apesar de a
analista já ter reconhecido o par. Além disso o vencimento da barra pode puxar o prazo real de pagamento para
antes do vencimento do título, e a tela não mostra isso.

## Decisão
1. Novo caminho `DATA_DIVERGENTE` (I17p): valor igual em centavos (I17b intacta, sem tolerância),
   Δ ∈ [-10,-1] ∪ [6,10], exige **reconhecimento tipado** válido (I15r).
2. Reconhecimento = **propriedade** de `DecisaoSugestaoBoleto` (checkbox + motivo 10–500 + Δ e valor vistos);
   inválido se Δ ou valor mudarem; mesma analista; sem segunda pessoa; sem estado novo. **Substitui** o
   `reconheceAvisos` simples em Δ<0 com valor igual (implica `RECONHECEU_VENCE_ANTES`). **Δ>5 com valor igual
   também pede o ack** na confirmação (muda o passo 1).
3. 7º check de I17d: fator de vencimento (módulo 9000, reinício em 22/02/2025, `0000` = sem vencimento)
   cruzado com a data do DDA; `0000` não se aplica na janela padrão e é inelegível no caminho novo.
4. Boleto vencido na data de débito segue `VENCIDO_INFORMATIVO`; vigência da barra com rolagem ao próximo dia
   útil bancário (P0-3).
5. Data efetiva do lote: min(título, prazo final do boleto) ≥ hoje (I8c, P0-4); Δ<0 não puxa os demais itens.
6. `prazoBoleto` derivado (I19t): prazo efetivo = min(título, prazo final do candidato acionável); acionável =
   `CONHECIDO/FORTE` (ambíguos seguros pelo mais cedo, `totalCandidatos`), `ATENCAO` ancorada ou `CONFIRMADA`;
   alimenta a faixa "bloqueados vencem hoje", contador, filtro "Vencidos" e de/até. **"Perdido"** (barra < hoje):
   linha separada e presente no filtro "Vencidos", **sem** virar motivo `VENCIDO` (ADR-0070) e sem entrar em
   "vencem hoje". `VENCIDO` (I19e) e a ordem de motivos (I19b) **não mudam**.
   *Nota (2026-10-26, gap G1, decisão do maintainer):* "perdido" cobre também o par de valor igual + âncora
   `VENCIDO_INFORMATIVO` com barra `< hoje` e título a vencer, **sem** puxar o `prazoEfetivo` (emenda à I19t(3)/(5)).
7. `[DEFAULT P1-5]` modo próprio `off` por default, `shadow` registra Δ; `[DEFAULT P1-6]` guarda de data do
   `.REM` (I17q), fail-closed, e medição do J (V10–V12) em HML antes de qualquer código. Se o J ≠ `itsDtaPgto`
   da barra, o caminho fica `off` e a fase 2 vira pré-requisito.

## Numeração
ADR 0078, ontologia 0.49.0 e migration ≥ 0091 por colisão com `feat/sispag-boleto-agrupado` (reserva 0077,
0.48.0 e a migration 0090). Reconferir no rebase: se aquela branch cair fora ou mergear antes, renumerar.

## Rejeitado
- **REJECT-DUPLICATE:** entidade `ReconhecimentoDivergencia` (duplica a decisão e o reconhecimento de I15o;
  sem identidade nem ciclo de vida próprios); estado `CONFIRMADA_COM_RESSALVA`/`AGUARDANDO_ACK` ou valor novo em
  `SituacaoSugestaoTitulo` (é propriedade + derivado `exigeReconhecimento`); motivo `BOLETO_VENCE_HOJE` ou
  mudança em `VENCIDO` (o prazo do boleto é propriedade, não motivo); tolerância de valor no caminho novo (é I18).
- **REJECT-WORKAROUND:** persistir `prazoBoleto` (cache de derivado; I19n/I-DDA1).
- **REJECT-VOLATILE:** envelope > ±10 dias.
- **REJECT-PREMATURE:** fase 2 (ajustar a data do título via `fin026/alteraDataVencimento` ou `fin070`; vira
  pré-requisito só se V12 mostrar J ≠ barra); boleto vencido na data de débito (juros/multa); segunda pessoa
  para o ack (reservada ao passo 3, I15g); calendário municipal/estadual na rolagem.
- **REJECT-NOT-DOMAIN:** texto/layout da linha ("Boleto sugerido vence hoje…", "N candidatos", "perdido").
- **REJECT-CONFIG:** nome e valores da flag `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`.

## Consequências
(+) Fecha o buraco "par reconhecido mas sem código"; o prazo real do boleto fica visível.
(−) Confirmação de Δ > 5 com valor igual passa a pedir ack (hoje confirmava sem; sem vínculo era inútil).
(−) Δ > 0: data de débito (título ou barra) depende do J, ainda não medido.
(−) O 7º check pode retirar boletos cujo DDA e fator divergem (esperado: é o ganho).
(−) A rolagem da barra ao próximo dia útil é "nossa"; o ERP (R2) compara `dataDebito` com `itsDtaPgto` não
    rolado. Vale o mais restritivo (fail-closed) até a medição V11.
(−) Universalidade: 1 cliente (Columbia); o fator de vencimento é norma FEBRABAN. Revisão com o Francinei,
    não bloqueante (precedente Q-I do ADR-0068).

## Emenda 2026-10-26: medições HML V10–V12 e pré-condição de habilitação em PRD

Evidência: `_inbox/sispag-vinculo-data-divergente-medicao.md` (HML, barras sintéticas, filial 2, banco 4).

**Premissas confirmadas**
- **V10:** o ERP não compara a data da barra com a do título; aceita Δ de −5 a +10 e devolve a data da **barra**
  em `itsDtaPgtoResult` (o item acompanha a barra). Modalidade 6 aceita; modalidade 7 é recusada quando o banco
  da barra é o do lote (regra já conhecida, sem relação com a data).
- **V11 (R2):** `finalizar` aceita `dataDebito ≤ min(itsDtaPgto)` e recusa acima ("EXISTEM TÍTULOS QUE IRÃO
  VENCER ANTES DA DATA DE PAGAMENTO DESTE LOTE"). A janela do lote é a data da barra.
- **V12:** no segmento J, o *vencimento* leva a data do **título** e a *data de pagamento* a da **barra**; a guarda
  I17q (data do J = `itsDtaPgto`) é satisfeita. O número da remessa deve vir de `sugerirRemessa`.

**Inconclusivo:** rolagem de sábado. O caso medido caiu em feriado (Finados) e não distingue "o ERP não rola" de
"rola só até a segunda". Vale o fail-closed: débito em ou antes da data da barra, sem rolar.

**Risco aberto (banco).** O J mistura datas: o vencimento do título e o código de barras com o fator da barra. HML não
tem banco, então **não se sabe se o banco recusa um J cujo vencimento difere do fator do código**. Isso decide a
Δ ≠ 0 e a "fase 2" (ajustar a data do título) continua rejeitada por prematura, mas passa a ser o plano B se o
banco recusar.

**Pré-condição para habilitar em PRD.** `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS` permanece **`off`** até um teste
controlado em PRD com **um boleto real pequeno** de data divergente, remetido e liquidado sem recusa do banco
(maintainer decide o título e o valor). Antes disso, no máximo `shadow`. Recusa do banco ⇒ caminho fica `off` e a fase 2
vira pré-requisito.

Resíduo em HML (não há cancelar lote no client): lotes 53 (finalizado, remessa PG261002.REM), 54 e 55;
documentos 284, 232, 640 e 642 consumidos.

*Versão da ontologia: sem bump (mesma convenção da emenda 2026-10-20 da ADR-0074).*

## Emenda 2026-10-27: rolagem de sábado medida (R8)

Evidência: `_inbox/sispag-vinculo-data-divergente-medicao.md`, seção "V11/R8 — rolagem de sábado" (HML, lote **68**).

**Medido.** Item com barra no sábado 07/11 e `dataDebito` na segunda 09/11: o `finalizar` **aceita**. Com o lote **55**
(barra no sábado 31/10, débito na terça 03/11, segunda 02/11 = Finados) **recusado**, a leitura é: o ERP compara a
`dataDebito` com o `itsDtaPgto` **rolado sobre sábado/domingo para a segunda**, e **não considera feriado**.

**Decisão do maintainer (2026-10-27), substitui o fail-closed "sem rolar" da emenda anterior.** A janela do lote (R2,
I8c) usa a data da barra **rolada só sobre sábado/domingo** (sábado ou domingo ⇒ segunda seguinte); **feriado não rola**.
A vigência bancária da I15h (próximo dia útil bancário, pula feriados) continua valendo para o **prazo exibido** e o
"perdido" (I19t), não para a janela do ERP. Não medidos: outros feriados e barra vencendo em feriado de dia de semana
(nesses casos vale a data da barra sem rolar).

**Débito de código (antes de ligar a Fase 2).** `DataCandidataItem` (I8c) usa `PrazoFinalBoleto`, que rola com o
`BankingCalendar` (pula feriados): mais permissivo que o ERP em sábado seguido de feriado. Inalcançável na Fase 1 (só
item vinculado pelo caminho `DATA_DIVERGENTE`, que não existe sem a Fase 2); corrigir para rolagem só de fim de semana
antes do `on`. Registrado em `_inbox/sispag-vinculo-data-divergente-regis-followups.md` (`r8-rolagem-fim-de-semana`).
