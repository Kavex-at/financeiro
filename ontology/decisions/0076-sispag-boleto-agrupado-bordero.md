---
adr_number: 0076
title: SISPAG — boleto agrupado (1 boleto → N títulos) pago pelo borderô do fin010
date: 2026-10-20
status: accepted
type: addition
related_entities: [GrupoBoleto, LotePagamento, TituloAPagar, BoletoDda, ConfirmacaoEmissorBoleto, DecisaoSugestaoBoleto, BloqueioDuplicidade, Alerta]
related_business_rules: [boleto-agrupado-sispag, vinculo-codbar-item-sispag, sugestao-boleto-dda-sispag, boleto-exige-codigo-de-barras, elegibilidade-titulo-lote, nao-duplicacao-titulo-lote, lote-uma-filial, sincronizacao-status-lote-sispag, retomada-remessa-sispag]
continues: [0040, 0068, 0069, 0071, 0074]
evidence:
  - ontology/_inbox/sispag-boleto-agrupado-interview.md
  - ontology/_inbox/sispag-boleto-agrupado-hml-achados.md
  - ontology/_inbox/sispag-boleto-agrupado-ontology-diff.md
  - "HML 2026-10-19: borderô 252 (gerNum 38) → lote flp 48 → PG191081.REM (um J de 2.346,94) → retorno gar 7: 552/1 e 558/1 pagos, borderô finalizado"
  - "PRD 2026-10-19 (só leitura): ~220 casos 1→N, 40+ credores; subset-sum livre = 922/2369 falsos"
  - "HML 2026-10-20 (Task 1): borCod reusado após excluirBordero; vldHasRemessaPgto reflete o import; GET ausente = 500 RECORDNOTFOUND; V2, V3, V5, G4 (emenda 2026-10-21)"
---

# ADR 0076: boleto agrupado pago pelo borderô do fin010

**Branch:** `feat/sispag-boleto-agrupado`. `/feature-tweak`. `entity_changed = true`. Ontologia **0.47.0**
(entidade, regra e ações `planned`, à frente do código). Migration prevista: **0090**. App: 0.72.0 (prevista;
decidida no ship).

> **Numeração.** 0.46.0 e ADR-0075 estão reservados pela branch não mergeada
> `docs/sispag-situacao-pagamento-ontology`; reconferir antes do ship. A proposta deste diff foi redigida
> como ADR-0075/0.46.0 e renumerada na aprovação.

## Contexto

Um boleto que paga vários títulos do mesmo credor (PEDRONI: 3 × R$ 525,00 → um boleto de R$ 1.575,00) não
cabe no SISPAG hoje: o item do lote é sempre um título, a sugestão casa um boleto com um título e o vínculo
(I17b) exige barra igual ao líquido de cada título. A analista tira os títulos do lote e paga à mão. Em HML,
o Conexos mostrou o caminho nativo: um borderô `fin010` em cadastro com uma baixa por título é oferecido pelo
`fin015` como **um** item (sem título, com `borCod`), recebe a barra, o J paga o total do borderô e o retorno
do banco finaliza o borderô e baixa os N títulos.

## Decisão

1. **Entidade nova `GrupoBoleto`** (1 boleto DDA ↔ N ≥ 2 títulos, confirmado por pessoa) e **regra nova
   `boleto-agrupado-sispag` (I19a–u)**: mesmo credor, mesma filial, soma exata ao centavo, títulos aprovados
   e não pagos, boleto do DDA com par de emissor vigente.
2. **Sugestão só de grupo fechado no mesmo vencimento**; a analista confirma. Grupo fechado com título ainda
   não aprovado aparece com o motivo e não é confirmável; nunca se sugere subconjunto. **Composição manual**
   aceita títulos até 10 dias antes do vencimento do boleto, com aviso reconhecido.
3. No lote, **N itens (um por título) ligados ao grupo**, que entram, saem e se movem juntos; na remessa,
   **um** item nativo de borderô. Na formação automática e em L6, o "vencido" do grupo é o do **boleto**.
4. O borderô nasce **na geração da remessa** (etapa `preparar_bordero`, write-ahead com `t0`/`t1` e a
   identidade `filCod` + `borCod` + `borTimCad`; emenda 2026-10-21), na conta
   financeira (`gerNum`) da conta pagadora do lote, lida ao vivo do `fin005`. **Nós nunca finalizamos o
   borderô**: quem finaliza é o retorno do banco.
5. Enquanto o lote nativo não está finalizado e não tem `.REM` gerado (lido ao vivo), o sistema desfaz **só o
   borderô que criou**. Depois disso nunca apaga nem cancela: `Alerta` e decisão da analista (emenda
   2026-10-21; `vldHasRemessaPgto` não é o sinal).
6. O grupo é `PAGO` só com os N títulos pagos; parte paga é divergência; J rejeitado devolve o grupo inteiro
   para "confirmado, sem lote", e ele só volta a uma remessa depois de a analista resolver o borderô antigo no
   ERP. Se o borderô antigo reaparecer pendente no lote novo, é **reaproveitado**, nunca duplicado.
7. **Sem flag e sem modos.** Ativo após o merge, sob o kill-switch existente (`sispagLiveWriteEnabled`) e o
   dry-run do Conexos. O vínculo da barra ao item de borderô **não** depende do modo da I17k.

## Decisões do maintainer (2026-10-20)

Da entrevista (`_inbox/sispag-boleto-agrupado-interview.md`, "Respostas do maintainer"):

| # | Decisão |
|---|---|
| P0-1 | Sugere grupos fechados; a analista confirma; composição manual possível; valores iguais ⇒ partição fixa "intercambiável". |
| P0-2 | Sugestão: mesmo vencimento. Manual: até 10 dias antes do vencimento do boleto, com aviso. |
| P0-3 | Grupo que cruza filial bloqueado; V4 é follow-up. |
| P0-4 | Borderô na geração da remessa; limpeza só do que criamos, só antes do lote nativo finalizado; depois, `Alerta`. |
| P0-5 | Sem flag/modos; permissões do robô conferidas pelo maintainer, não são portão; primeiro `.RET` real em watchlist. |
| P1-1 | N `ItemLote` ligados ao grupo; um grupo = um item nativo. |
| P1-2 | Soma exata ou nada. |
| P1-3 | Só boleto do DDA, par vigente ou confirmado no ato. |
| P1-4 | Grupo é uma unidade na formação automática. |
| P1-5 | `PAGO` com os N; parcial = divergência + `Alerta`; rejeição devolve o grupo. |

Da revisão do diff (`_inbox/sispag-boleto-agrupado-ontology-diff.md`, aprovado como proposto em 2026-10-20).
Os nove "Pontos inferidos" passam a decididos (PI-n = ponto n da proposta):

| # | Decisão |
|---|---|
| PI-1 a PI-6 | Aceitos como escritos: N ≥ 2; reconhecimento do aviso manual no servidor; `borDtaMvto` = débito (o marcador em campo de observação foi **abandonado** na emenda de 2026-10-21); modalidade 6/7 (V5 confirmado no HML em 2026-10-20); grupo inelegível na remessa **barra** antes de escrever; anular em `RASCUNHO` retira os N itens. |
| PI-7 | Grupo fechado do mesmo vencimento com título não aprovado (ou que falha a I19c de outro modo) é **exibido com o motivo** ("aguardando alçada" etc.) e **não é confirmável**; o título nunca é descartado para sugerir um subconjunto (I19e). |
| PI-8 | O "vencido" do grupo, na formação automática e em L6, é o **vencimento do boleto** (dia civil em Brasília, ADR-0070) (I19j). |
| PI-9 | Depois de J rejeitado, o grupo volta a uma remessa só depois de a analista resolver o borderô antigo no ERP; se ele reaparecer em `borderosPendentes` do lote novo (V7), o sistema o **reaproveita** em vez de criar outro (I19r, I19s, tabela da retomada). V7 segue no watchlist como medição. |
| Numeração | ADR-0075/0.46.0 → **ADR-0076/0.47.0** (reservados pela branch `docs/sispag-situacao-pagamento-ontology`). Migration segue 0090. |

## Emenda 2026-10-21 — medições HML da Task 1

As medições de 2026-10-20 (`_inbox/sispag-boleto-agrupado-hml-achados.md`, seção "O que contradiz a ontologia
v0.47.0") contradisseram duas premissas aprovadas. Decisões do maintainer em 2026-10-21, emendadas no lugar
(0.47.0 ainda não mergeada, sem bump de versão):

1. **Guarda da limpeza = lote nativo, não `vldHasRemessaPgto`** (I19q, I19r, H9, `conexos.md` passos 8 e 10).
   Medido: a flag vira 1 quando o borderô é **importado** num lote e volta a 0 quando o item sai; não é o sinal
   de "foi ao banco". Lida antes do `DELETE` do item, a guarda antiga bloquearia toda limpeza; lida depois,
   seria sempre 0. **Decisão:** a limpeza só é permitida enquanto o lote nativo não está finalizado e não tem
   `.REM` gerado, estado lido ao vivo. Depois: nunca exclui nem cancela; `Alerta`
   `sispag-bordero-grupo-pendente` e a analista decide. Fato registrado: com o item no lote, o ERP recusa
   `excluirBaixa`/`excluirBordero` (`FIN_014.FIN_HAS_REMESSA_PGTO`); por isso a ordem é item → baixas →
   borderô. Depois de um J rejeitado, se o borderô segue ligado ao lote e qual o valor da flag é medição da V7,
   não premissa.
2. **Identidade do borderô = `filCod` + `borCod` + `borTimCad`** (I19l, I19s, I19q, tabela da retomada,
   `GrupoBoleto.execucao`, `conexos.md`). Medido: o ERP **reusa** `borCod` depois de `excluirBordero`
   (max+1 da filial); `borTimCad` é o carimbo de criação do ERP, ao segundo, inalterado depois de baixas,
   import e finalização (borderô 252). **O marcador de correlação em `borEspNrbanco` foi abandonado:** nada é
   escrito nesse campo. Write-ahead: `t0` antes do `POST fin010`, `t1` depois; `borCod` + `borTimCad` da
   resposta (ou da releitura). **Resposta perdida:** `fin010/list` por filial, `usnCodCad` = usuário do robô,
   `gerNum`, `borDtaMvto`, `borVldFinalizado = 0` e `borTimCad#GE` (`t0` − margem) / `#LE` (`t1` + margem) em
   epoch ms (medido: `#GE`/`#LE` com epoch ms funciona; ISO responde 500; `#GTE`/`#BETWEEN` não são aceitos).
   Exatamente um ⇒ adota; zero ⇒ cria; dois ou mais ⇒ `indeterminado` + `Alerta`. Em qualquer releitura, um
   borderô com o nosso `borCod` e outro `borTimCad` é **de outra pessoa** ⇒ `indeterminado`, nunca tocado. A
   margem (desvio de relógio) é constante de código, não domínio. Risco conhecido: Permutas também cria
   borderôs `fin010` com o mesmo usuário do robô; o filtro por `gerNum`, data e tipo existe por isso, e a
   colisão residual vira `indeterminado` (seguro).
3. **Ausência** (I19q, I19s): `GET fin010/{fil}/{bor}` de borderô ausente responde `500 RECORDNOTFOUND`, não
   404. Ausência observada = `fin010/list borCod#EQ` sem linhas (ou só com linhas de outro `borTimCad`).
4. **Fatos medidos, sem mudança de regra:** V2 (título com baixa em borderô em cadastro segue em aberto no
   `fin064` e sai do grid do `fin015`; `importarTitulos` com a linha velha é aceito depois da `FIN_041` ⇒ só a
   I19k e a releitura do grid impedem pagar duas vezes); V3 (ordem imposta pelo ERP); V5 (modalidade 6
   confirmada para barra do banco da conta); G4 (o retorno `fin052` traz **uma** linha J para o item de
   borderô, com `fil/bnc/flp/its` + `borCod`, sem `docCod/titCod` nem valor ⇒ I19r/I11i casam pela chave
   nativa e/ou `borCod`).
5. **G6 (P2):** boleto que bate com a soma de dois conjuntos fechados (dois credores, mesmo dia, mesma soma),
   ou dois boletos idênticos não intercambiáveis pela I19f que casam o mesmo conjunto ⇒ **nenhuma sugestão**;
   a analista compõe à mão. A GT1 (Task 22) mede a frequência (I19e, I19f).

Rejeitados nesta emenda:

- **Marcador de correlação em `borEspNrbanco`** — REJECT-WORKAROUND: o campo tem semântica nativa ("nº
  banco"), cabe só 15 maiúsculas e nunca foi provado num `.REM`; o `borTimCad` gravado pelo próprio ERP
  identifica o borderô sem escrever nada.
- **`vldHasRemessaPgto` como guarda da limpeza** — REJECT-DUPLICATE do estado do lote nativo, e semanticamente
  errado (reflete o import).
- **`borCod` sozinho como identidade** — rejeitado: o ERP reusa o número.

## Rejeitado

- **`fin146` (Baixa Agrupada)** — REJECT-WORKAROUND: baixa os títulos ao finalizar, antes de o banco pagar
  (HML, bagCod 1 cancelado).
- **Juntar os N títulos num só pelo `fin070`** — REJECT-WORKAROUND: altera o documento, volta à alçada
  (`fin103`), é mais lento, e o caminho nativo existe.
- **Deixar o boleto agrupado fora do SISPAG** — rejeitado pelo maintainer (D1).
- **Grupo que cruza filial** — REJECT-PREMATURE: depende da sonda V4 (o parser do retorno exige item e lote
  na mesma filial). Watchlist.
- **Flag por filial, modos `off/shadow/on`, permissão do robô como portão** — REJECT-NOT-DOMAIN (P0-5):
  rollout é operação, não modelo; precedente da emenda de 2026-10-20 do ADR-0074.
- **Janela de ±5/10 dias na sugestão** — rejeitado (P0-2): a sugestão é só no mesmo vencimento.
- **Subconjunto livre (subset-sum)** — REJECT-PREMATURE: 922 de 2369 falsos na medição de PRD.
- **Descartar o título não aprovado e sugerir os demais** — rejeitado (PI-7): quebra o "grupo fechado" e
  reabre o ruído do subconjunto.
- **`ItemLote.tipo = BORDERO` com títulos numa tabela filha** — REJECT-DUPLICATE (P1-1): esconderia os títulos
  de I2/I3/I4/I11.
- **Entidade `BorderoGrupo`** — REJECT-DUPLICATE: o borderô é do ERP; `borCod` + `borTimCad` são execução do grupo.
- **Persistir a sugestão de grupo** — REJECT-DUPLICATE (I-DDA1): só a confirmação persiste.
- **Criar o borderô na confirmação** — REJECT-WORKAROUND: viola I1 e deixa borderô parado por dias.
- **Finalizar o borderô nós mesmos / livro paralelo de baixa** — REJECT-WORKAROUND / REJECT-DUPLICATE: o
  retorno nativo baixa; a I11 observa o título.
- **Criar sempre um borderô novo depois de J rejeitado** — rejeitado (PI-9): deixaria dois borderôs vivos para
  o mesmo boleto; o antigo é reaproveitado quando reaparece pendente.
- **Absorver centavos numa baixa do borderô ou aplicar a I18 a um título do grupo** — REJECT-PREMATURE (P1-2).
- **Boleto digitado fora do DDA** — REJECT-PREMATURE (P1-3).
- **Caso 2 (N boletos → 1 título, VIBE LOG)** — REJECT-PREMATURE: fora do escopo (D2). Watchlist.
- **`gerNum` como configuração por filial** — REJECT-CONFIG: é lido ao vivo do `fin005`.

## Consequências

- **O item nativo do lote deixa de ser sempre um título.** Guarda I16, vínculo I17, retomada e sincronização
  passam a reconhecer o item de borderô (I16h: `borCod` nosso não é intruso).
- **A I1 continua:** nada vai ao ERP antes de `FINALIZADO`; o borderô faz parte do L8.
- **A I17n não vale para o item de borderô** (o valor vem do borderô); a I17m (barra == pagamento do J) vale.
- O SISPAG passa a escrever no `fin010` (antes só Permutas e Recebimentos); a identidade Conexos é registrada (I-2).
- Um J rejeitado deixa um borderô em cadastro no ERP: `Alerta` e decisão da analista (sem limpeza automática);
  o grupo só volta à remessa por inclusão manual, depois da resolução, e o borderô é reaproveitado se
  reaparecer pendente.
- `BloqueioDuplicidade` ganha a origem `GRUPO_BOLETO` (retirada do grupo na remessa) e `SystemRemovalReason`
  os motivos `GRUPO_BOLETO_FALHOU` e `BORDERO_ANTERIOR_NAO_RESOLVIDO`; `Alerta` ganha o tipo
  `sispag-bordero-grupo-pendente`.
- Universalidade: 1 cliente; revisão com o Francinei não bloqueante.

## Premissas e verificações (não bloqueiam; P0-5)

Permissões do CLONEX em PRD (V1, conferência do maintainer); primeiro `.RET` real com item de borderô (V6);
V2, V3 e V5 medidas no HML em 2026-10-20 (Task 1; ver a emenda); V7 segue em medição (agora também o valor de
`vldHasRemessaPgto` depois da rejeição); V4 é follow-up.

## CHANGELOG (app, para a analista)

> **Boleto que paga vários títulos agora vai pelo SISPAG.** Quando um fornecedor manda **um** boleto para
> pagar **vários** títulos (por exemplo, três de R$ 525,00 num boleto de R$ 1.575,00), o sistema sugere o
> grupo se os títulos do fornecedor que vencem no mesmo dia do boleto somam exatamente o valor dele. Você
> confere e confirma. Se algum desses títulos ainda estiver aguardando alçada, o grupo aparece com o motivo
> e só pode ser confirmado depois da aprovação. Também dá para montar o grupo à mão, com títulos que vencem
> até 10 dias antes do boleto (o sistema avisa e pede sua confirmação). No lote, o grupo aparece numa linha
> só, que abre para mostrar os títulos; ele entra, sai e muda de lote inteiro. Na remessa, o sistema cria um
> borderô no Conexos com uma baixa por título e paga o boleto **uma vez**; quando o banco devolve o retorno,
> o Conexos baixa todos os títulos. Se o banco rejeitar o pagamento, resolva o borderô antigo no Conexos
> antes de pôr o grupo num lote novo. A soma precisa bater ao centavo e todos os títulos precisam ser da
> mesma filial; se não for o caso, o pagamento continua sendo feito à mão.
