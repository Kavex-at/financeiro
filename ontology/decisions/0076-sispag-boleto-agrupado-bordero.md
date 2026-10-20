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
---

# ADR 0076: boleto agrupado pago pelo borderô do fin010

**Branch:** `feat/sispag-boleto-agrupado`. `/feature-tweak`. `entity_changed = true`. Ontologia **0.47.0**
(entidade, regra e ações `planned`, à frente do código). Migration prevista: **0089**. App: 0.72.0 (prevista;
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
4. O borderô nasce **na geração da remessa** (etapa `preparar_bordero`, write-ahead com marcador), na conta
   financeira (`gerNum`) da conta pagadora do lote, lida ao vivo do `fin005`. **Nós nunca finalizamos o
   borderô**: quem finaliza é o retorno do banco.
5. Antes do lote nativo finalizado, o sistema desfaz **só o borderô que criou**. Depois da remessa
   (`vldHasRemessaPgto = 1`) nunca apaga nem cancela: `Alerta` e decisão da analista.
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
| PI-1 a PI-6 | Aceitos como escritos: N ≥ 2; reconhecimento do aviso manual no servidor; `borDtaMvto` = débito e marcador em campo de observação (nome a medir); modalidade 6/7 (V5 no HML); grupo inelegível na remessa **barra** antes de escrever; anular em `RASCUNHO` retira os N itens. |
| PI-7 | Grupo fechado do mesmo vencimento com título não aprovado (ou que falha a I19c de outro modo) é **exibido com o motivo** ("aguardando alçada" etc.) e **não é confirmável**; o título nunca é descartado para sugerir um subconjunto (I19e). |
| PI-8 | O "vencido" do grupo, na formação automática e em L6, é o **vencimento do boleto** (dia civil em Brasília, ADR-0070) (I19j). |
| PI-9 | Depois de J rejeitado, o grupo volta a uma remessa só depois de a analista resolver o borderô antigo no ERP; se ele reaparecer em `borderosPendentes` do lote novo (V7), o sistema o **reaproveita** em vez de criar outro (I19r, I19s, tabela da retomada). V7 segue no watchlist como medição. |
| Numeração | ADR-0075/0.46.0 → **ADR-0076/0.47.0** (reservados pela branch `docs/sispag-situacao-pagamento-ontology`). Migration segue 0089. |

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
- **Entidade `BorderoGrupo`** — REJECT-DUPLICATE: o borderô é do ERP; `borCod` e marcador são execução do grupo.
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
V2, V3, V5, V7 medidas no HML durante o TDD; V4 é follow-up.

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
