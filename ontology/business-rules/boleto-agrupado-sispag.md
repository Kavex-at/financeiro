---
name: boleto-agrupado-sispag
type: business-rule
entity: GrupoBoleto
invariant: I19
ontology_version: "0.47.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-20
has_canonical_test: false
universality_evidence:
  - "HML 2026-10-19 (borderô 252, lote 48, PG191081.REM, retorno gar 7); PRD 2026-10-19 (PEDRONI 38883–38885 → boleto 332841)"
  - "1 cliente apenas: universalidade a revisar com o Francinei (não bloqueante)"
---

# Business Rule: boleto agrupado no SISPAG — 1 boleto paga N títulos (I19)

> **Origem:** ADR-0076 (2026-10-20). Escopo: caso 1 (1 boleto → N títulos do mesmo credor). O ERP paga
> pelo **borderô** do `fin010`: em cadastro, uma baixa por título, importado como **um** item do lote
> SISPAG; o retorno do banco finaliza o borderô e baixa os N. **Sem flag e sem modos** (P0-5): ativo
> após o merge, sob o kill-switch existente `sispagLiveWriteEnabled` e o dry-run do Conexos.
> **Status: planned** (ontologia à frente do código; migration prevista 0089).

## Decisões do maintainer (2026-10-20)

Da entrevista (`_inbox/sispag-boleto-agrupado-interview.md`, "Respostas do maintainer"):

| # | Decisão |
|---|---|
| P0-1 | O sistema **sugere** grupos fechados; a analista **confirma** cada um; também pode **compor à mão** (o sistema só valida). Valores iguais ⇒ partição fixa "intercambiável", confirmada. |
| P0-2 | **Sugestão:** só **mesmo vencimento**. **Composição manual:** títulos até **10 dias antes** do vencimento do boleto, com aviso. |
| P0-3 | Grupo que cruza filial **bloqueado** ("não suportado, pagar à mão"); sonda V4 é follow-up. |
| P0-4 | Borderô nasce na **geração da remessa** (write-ahead, antes do `importar`). Antes do lote nativo finalizado, o sistema apaga **só o que criou**; com `vldHasRemessaPgto = 1`, nunca apaga nem cancela: `Alerta` + decisão da analista. |
| P0-5 | **Sem flag, sem off/shadow/on.** Permissões do robô conferidas pelo maintainer, **não** são portão. Primeiro `.RET` real: watchlist. |
| P1-1 | N `ItemLote` (um por título) ligados ao `GrupoBoleto`; um grupo = um item nativo; mover/retirar agem no grupo inteiro. |
| P1-2 | Soma exata ou não há grupo. Sem shadow. |
| P1-3 | Só boleto do **DDA**, par emissor `VIGENTE` ou confirmado no mesmo ato. |
| P1-4 | Grupo confirmado é **uma unidade** na formação automática; nunca dividido; títulos dele não entram avulsos. |
| P1-5 | `PAGO` só com os N pagos; parcial ⇒ divergência + `Alerta`; J rejeitado ⇒ grupo inteiro `REJEITADO`, volta a confirmado sem lote. |

Da revisão do diff (`_inbox/sispag-boleto-agrupado-ontology-diff.md`, aprovado em 2026-10-20; os pontos
inferidos 1–9 passam a decididos; PI-n = "Pontos inferidos" n da proposta):

| # | Decisão |
|---|---|
| PI-1 | N ≥ 2 títulos; um título segue o caminho 1:1 (I19a). |
| PI-2 | O aviso da composição manual exige reconhecimento validado no servidor, como a I15o (I19g). |
| PI-3 | `borDtaMvto` = data de débito do lote; marcador de correlação num campo de observação do `fin010` (nome a medir no HML). |
| PI-4 | Modalidade `6` para barra do mesmo banco da conta (título próprio), `7` para banco diferente (I19o; confirmar no HML, V5). |
| PI-5 | Grupo inelegível na remessa **barra** a remessa antes de qualquer escrita (I19p(1)), espelho da I14a, em vez de retirar. |
| PI-6 | Anular grupo em lote `RASCUNHO` retira os N itens na mesma transação (I19t). |
| PI-7 | Grupo fechado no mesmo vencimento com título ainda não aprovado (ou que falha a I19c de outro modo) é **exibido com o motivo** ("aguardando alçada" etc.) e **não é confirmável**. O título nunca é descartado para sugerir um subconjunto (I19e). |
| PI-8 | O "vencido" do grupo, na formação automática e em L6, é o **vencimento do boleto** (dia civil em Brasília, ADR-0070) (I19j). |
| PI-9 | Depois de J rejeitado, o grupo só volta a uma remessa depois de a analista resolver o borderô antigo no ERP. Se o borderô antigo reaparecer em `borderosPendentes` do lote novo (V7), o sistema o **reaproveita** em vez de criar outro (I19r, I19s). V7 segue no watchlist como medição. |

## Invariantes

| # | Invariante |
|---|---|
| **I19a** | **Forma do grupo.** Um boleto DDA **livre** (sem `docCod/titCod`, I15e(1)) e **N ≥ 2** títulos do **mesmo `pesCod`** (H3). O par (`pesCod`, `emissorChave`) está `VIGENTE` ou é confirmado no mesmo ato, pela mesma pessoa (I15g, P1-3). Um título = caminho 1:1 existente (I15/I17), nunca grupo (PI-1). |
| **I19b** | **Soma exata ao centavo (D3, P1-2).** `round(valorBoleto×100) == Σ round(abertoLiquido(t)×100)`, com `abertoLiquido` pela régua da I17b (`fin064.totalLiquido` conferido; divergência ou campo ausente ⇒ `VALOR_ABERTO_INDISPONIVEL`, fail-closed). `valorBoleto` decodificado por nós do código. Nenhuma tolerância; a I18 não se aplica a título de grupo. Conferido na confirmação (snapshot) e **de novo ao vivo** na remessa. |
| **I19c** | **Cada título elegível.** I2 (`liberado ∧ ¬pago`), ativo, `forma = BOLETO`, `tem_boleto ≠ true` (sem DDA do ERP), sem `DecisaoSugestaoBoleto CONFIRMADA`, sem `BloqueioDuplicidade ATIVO` (inclusive a de origem `GRUPO_BOLETO`: grupo retirado na remessa só volta a lote quando nenhum título dele tem marca ativa), fora de lote comprometido (ADR-0064) e fora de outro grupo `CONFIRMADO`. |
| **I19d** | **Uma filial (P0-3).** Todos os títulos na mesma `filCod`; o borderô e o lote são dessa filial (I4; §4 de `sispag-fin052-retorno-provado-hml.md`). Conjunto que cruza filial aparece com o motivo `CRUZA_FILIAL`, **não confirmável** ("não suportado, pagar à mão"). |
| **I19e** | **Sugestão = grupo fechado no mesmo vencimento (P0-1, P0-2).** Calculada, **não persistida** (I-DDA1). Para um boleto livre com par `VIGENTE` (ou candidato a par), o conjunto é **todos** os títulos em aberto do `pesCod` na filial com `vencimento == vencimentoBoleto` (dia civil). Só é sugerido se Σ == boleto (I19b). Nunca subconjunto (medição M1: 922/2369 falsos). Título do conjunto que falha I19c (ex.: ainda em alçada) ⇒ a sugestão é **exibida com o motivo** ("aguardando alçada" etc.) e **não é confirmável**; o título **nunca** é descartado para sugerir os demais (decisão PI-7). |
| **I19f** | **Intercambiáveis (PEDRONI).** K ≥ 2 boletos livres do mesmo (`pesCod`, `emissorChave`, vencimento, valor) e conjunto fechado de títulos **todos de mesmo valor**, com `valorBoleto = m × valorTitulo` (m inteiro) e Σ títulos = K × valorBoleto ⇒ partição determinística: boletos por (`ddcCod`, `ditCod`), títulos por (vencimento, `docCod`, `titCod`); o k-ésimo boleto leva o k-ésimo bloco de m títulos; grupo marcado `intercambiavel`; a analista confirma **cada** grupo. Qualquer outro caso com K ≥ 2 ⇒ sem sugestão (composição manual). |
| **I19g** | **Composição manual (P0-1, P0-2).** A analista escolhe boleto e títulos; o sistema valida I19a–d e I19h. Janela por título: `0 ≤ vencimentoBoleto − vencimentoTitulo ≤ 10` dias (dia civil); fora dela ⇒ recusa (`GroupedBoletoDueWindowError`, 422). Algum título com Δ > 0 ⇒ aviso `TITULO_VENCE_ANTES_DO_BOLETO`, que exige **reconhecimento validado no servidor** (padrão I15o, PI-2) e é gravado em `avisosReconhecidos`. O grupo manual **não** precisa ser fechado. |
| **I19h** | **Datas.** `vencimentoBoleto ≥ dataDebito` do lote (I15h); boleto vencido nunca é confirmável. Sem lote, a data de referência é o `vencimentoBoleto` (Q-C adaptada). Revalidado na inclusão e na remessa. |
| **I19i** | **Confirmação é humana e auditada.** Só `sispag:executar` confirma/anula; o sistema nunca confirma. Trilha só-inclusão: `GRUPO_CONFIRMADO`, `GRUPO_ANULADO`, `GRUPO_RETIRADO`, `BORDERO_PREPARADO`, `BORDERO_REAPROVEITADO`, `BORDERO_LIMPO`, `GRUPO_PAGO`, `GRUPO_DIVERGENTE`, com quem, quando, chaves e código **mascarado** (I17j). Confirmar o mesmo (boleto, títulos) de novo devolve o grupo existente (idempotência); índices únicos parciais `WHERE estado = 'CONFIRMADO'` em (boleto) e em (título). |
| **I19j** | **Unidade indivisível no lote (P1-1, P1-4).** O grupo entra no lote como N `ItemLote` (`modalidade = BOLETO`, `grupoBoletoId`), na mesma transação, ou não entra. Mover, retirar e cancelar agem no grupo inteiro; retirar **um** título do grupo ⇒ `GroupedBoletoIndivisibleError` (409). A formação automática põe o grupo inteiro no lote do **vencimento do boleto** e nunca põe título de grupo avulso. Para a janela da formação e para L6 (desfazer auto-lote com vencido), o "vencido" do grupo é o do **boleto**, por dia civil em Brasília (ADR-0070; decisão PI-8): um grupo manual com título vencendo antes do boleto não é desfeito no dia do título. Grupo órfão, retido (I19c) ou com rejeição não resolvida (I19r) não é lotado pelo cron. |
| **I19k** | **Um grupo = um item nativo.** Na remessa, título de grupo **nunca** vai em `importarTitulos`; o grupo vai por borderô (I19l–n). |
| **I19l** | **Borderô do grupo (`prepararBorderoDoGrupo`, P0-4).** Etapa `preparar_bordero` do L8, depois de `criarLote` e antes de `importar`, por grupo: (1) write-ahead: marcador de correlação gravado **antes** do `POST`; (2) `POST fin010` `{ filCod do lote, borVldTipo 2, borVldFinalizado 0, borDtaMvto = dataDebito, gerNum }`, `borCod` persistido logo após; (3) por título: `fin010/baixas/validacao/tituloBaixa` → `POST fin010/baixas` (juros/multa/desconto 0, líquido = valor validado); (4) releitura: N baixas, cada uma do título esperado, e `vlrTotalLiquido == valorBoleto` em centavos. `gerNum` = conta financeira da **conta pagadora do lote**, lida ao vivo do `fin005` (H2/H10); ausente ⇒ falha **antes** do `POST`. Identidade Conexos registrada (I-2). Grupo com J rejeitado antes: vale o reconhecimento da I19s (reaproveitar o borderô antigo ou criar um novo), nunca dois borderôs vivos para o mesmo grupo. |
| **I19m** | **Nós nunca finalizamos o borderô (D4).** Nenhuma chamada a `finalizarBordero`, `cancelarBordero` ou `fin146` sobre borderô de grupo. Quem o finaliza é o processamento nativo do retorno (`PRC_BAIXA_RETORNO_PAGFOR`, H7). |
| **I19n** | **Importar o borderô.** `fin015/finItemSispag/borderosPendentes/list/{fil}/{bnc}/{flp}` deve trazer a linha com o `borCod` do grupo (ausente ⇒ `BORDERO_NAO_PENDENTE`, determinística, causa provável `gerNum` — H2) → `borderosPendentes/importar` com a linha lida + `filCodLote`, `bncCod`, `flpCod`, **`itemy: 1`**, `op: 1`, `bncCodFin015`. O sucesso é **observado na releitura**: item com o `borCod`, sem `docCod/titCod`, `itsMnyValor == valorBoleto`. Resposta `SUCESSO` sem item observado (H4) ⇒ falha ambígua (aborta e retoma), nunca sucesso. |
| **I19o** | **Barra no item de borderô.** Mesma sequência da I17e sobre o item com `borCod`. Elegibilidade: `GrupoBoleto CONFIRMADO`, não órfão, par `VIGENTE`, boleto relido do pool (substitui a decisão por título da I17a); valor pela I19b **e** `== itsMnyValor` do item (vem do borderô, H6; a I17n não se aplica); datas pela I19g/h (substitui a I17c). Modalidade: `7` se banco da barra ≠ banco do lote; `6` (título próprio) se igual (H5; PI-4, a confirmar no HML, V5). Valem I17d, I17f, I17i, I17j e I17m. **Independe do modo I17k** (P0-5): só o kill-switch o desliga. |
| **I19p** | **Falhas.** (1) **Antes de qualquer escrita** (grupo inelegível ao vivo: título pago/não liberado, soma, boleto fora do pool, par revogado): `GroupedBoletoNotEligibleAtRemittanceError` (409) barra a remessa, nada escrito (espelho de I14a/I17g(1); PI-5). (2) **Depois do borderô, transitória/ambígua** (timeout, 5xx, releitura inconclusiva): aborta, ledger `failed`, borderô e rascunho preservados; a retomada continua (I19s). (3) **Depois do borderô, determinística** (recusa 4xx de baixa, `BORDERO_NAO_PENDENTE`, divergência de valor, barra recusada, código repetido — I16 — ou borderô antigo não resolvido — I19s): o grupo é **retirado** pela maquinaria da I16d (motivo `GRUPO_BOLETO_FALHOU` ou `BORDERO_ANTERIOR_NAO_RESOLVIDO`, N marcas de retenção `GRUPO_BOLETO`), o borderô que **nós criamos nesta remessa** é limpo (I19q; o borderô antigo de um J rejeitado nunca é limpo) e a remessa segue com os demais. |
| **I19q** | **Limpeza do borderô (`limparBorderoDoGrupo`, P0-4).** Só **antes** de `finalizarLote` nativo, só com `vldHasRemessaPgto = 0`, só o borderô achado pelo **marcador do nosso write-ahead**. Ordem: `DELETE` do item nativo (se importado) → releitura (ausência) → `excluirBaixa` de cada baixa → `excluirBordero` → releitura (ausência). Sucesso = ausência observada. Disparos: retirada I19p(3)/I16d, lote local cancelado com rascunho nativo aberto. **Depois** de `vldHasRemessaPgto = 1` ou do lote nativo finalizado: **nunca** exclui nem cancela; `Alerta` `sispag-bordero-grupo-pendente` e a analista decide. Borderô reaproveitado (I19s) que falha: só o item nativo do lote novo é removido; o borderô fica, com o `Alerta`. |
| **I19r** | **Retorno e sincronização (P1-5).** I11 roda por título (os N `ItemLote`). Fechamento do grupo: os N `PAGO` no `fin064` ⇒ grupo `PAGO` (terminal, evento `GRUPO_PAGO`); parte paga ⇒ `divergencia` nos N itens + `Alerta` `sispag-baixa-divergente`, nunca "parcialmente pago"; J rejeitado (evento do `fin052` casado pela chave do item nativo) ⇒ os N `REJEITADO`, lote `RETORNADO`, grupo volta a "confirmado, sem lote" com a situação `REJEITADO` + `Alerta` `sispag-bordero-grupo-pendente` (o borderô continua em cadastro no ERP, com `vldHasRemessaPgto = 1`). **Volta à remessa só depois de a analista resolver o borderô antigo no ERP** (decisão PI-9): a formação automática não o lota; a analista o inclui à mão; a remessa reconhece o borderô antigo ao vivo pela I19s (ausente/cancelado ⇒ cria novo; em `borderosPendentes` do lote novo ⇒ reaproveita; em cadastro e fora dos pendentes ⇒ retira o grupo). `borVldFinalizado` do borderô é corroboração, não prova (nível 4 de I11). |
| **I19s** | **Retomada e reaproveitamento.** Ver emenda em `retomada-remessa-sispag.md`. Borderô reconhecido **ao vivo**: pelo `borCod` do write-ahead, ou pelo marcador quando a resposta se perdeu (exatamente um ⇒ adota; dois ou mais ⇒ `indeterminado`); baixas faltantes completadas; baixa de título que não é do grupo ⇒ `indeterminado` (terceiro); borderô já importado ⇒ pula; borderô **finalizado** antes da remessa ⇒ `indeterminado` + `Alerta` (alguém baixou por fora). **Depois de J rejeitado (PI-9):** o `borCod` antigo é lido no `fin010` antes de criar outro. Ausente ou cancelado (a analista o resolveu) ⇒ cria um novo. Presente em `borderosPendentes` do lote novo (V7) ⇒ **reaproveita**: adota o `borCod` no write-ahead novo (evento `BORDERO_REAPROVEITADO`), confere as N baixas (títulos esperados, valores pela I19b ao vivo) e `vlrTotalLiquido == valorBoleto`, importa; **nunca** cria um segundo borderô para o mesmo grupo. Em cadastro mas fora dos pendentes, ou com baixas divergentes ⇒ I19p(3) com motivo `BORDERO_ANTERIOR_NAO_RESOLVIDO`, sem tocar no borderô antigo. |
| **I19t** | **Anulação.** Pessoa com `sispag:executar`, motivo 10–500. Libera títulos e boleto. Em lote `RASCUNHO`, retira os N itens na mesma transação (PI-6). Em lote comprometido, vale o espelho da I17l: a tela avisa, e a próxima `gerarRemessa`/retomada retira o grupo antes do `finalizar` (ou erro nomeado se o lote nativo já finalizou). Revogar o par anula os grupos `CONFIRMADO` dele na mesma transação (cascata I15l(2)). Anular encerra as marcas `GRUPO_BOLETO` dos títulos do grupo. |
| **I19u** | **Grupo órfão.** `CONFIRMADO` cujo boleto saiu do pool ou ganhou vínculo do ERP, ou com algum título pago, inativo, com DDA do ERP, ou com líquido diferente do snapshot ⇒ `orfao = true` com motivo; não entra em lote; anulável. Nunca some em silêncio. |

## Erros nomeados (planned)

| Erro | Onde | HTTP |
|---|---|---|
| `GroupedBoletoSumMismatchError` | confirmar: Σ ≠ boleto (I19b) | 422 |
| `GroupedBoletoTitleIneligibleError` | confirmar/incluir: título falha I19c | 409 |
| `GroupedBoletoCrossBranchError` | confirmar: filiais diferentes (I19d) | 422 |
| `GroupedBoletoDueWindowError` | confirmar manual fora de [0, 10] d (I19g) | 422 |
| `GroupedBoletoIndivisibleError` | retirar/mover um título de grupo (I19j) | 409 |
| `GroupedBoletoNotEligibleAtRemittanceError` | remessa, antes de escrita (I19p(1)) | 409 |
| `GroupBorderoIncompleteError` | remessa, falha transitória pós-borderô (I19p(2)) | 409 |
| `WarningAcknowledgementRequiredError` | reutilizado: aviso I19g sem reconhecimento | 422 |

## Teste canônico

PEDRONI fil 2: 38883/38884/38885 (3 × R$ 525,00, venc. 21/10) → boleto 332841 R$ 1.575,00 venc. 21/10 ⇒
sugerido, confirmado, 3 `ItemLote`, 1 borderô com 3 baixas, 1 item nativo, 1 J de R$ 1.575,00. Caso
333111 (venc. 26/10 × títulos 25/10): **não** sugerido; aceito na composição manual com aviso. HML AR
SOLUÇÕES (552/1 + 558/1 → borderô 252 → flp 48 → gar 7). Negativos: ±R$ 0,01; dois credores; outra
filial; título pago na remessa; título em outro lote vivo; título em alçada no conjunto fechado (exibido,
não confirmável); `gerNum` errado; `importar` sem item observado; J rejeitado com borderô antigo não
resolvido (grupo retirado) e reaparecido nos pendentes (reaproveitado, sem segundo borderô).

## Ver também

`decisions/0076-sispag-boleto-agrupado-bordero.md` · `entities/grupo-boleto.md` ·
`entities/lote-pagamento.md` (`ItemLote.grupoBoletoId`) · `business-rules/vinculo-codbar-item-sispag.md`
(I17o) · `business-rules/sugestao-boleto-dda-sispag.md` (I15q) · `business-rules/boleto-exige-codigo-de-barras.md`
(I16, item de borderô) · `business-rules/retomada-remessa-sispag.md` (`preparar_bordero`) ·
`business-rules/sincronizacao-status-lote-sispag.md` (I11i) · `integrations/conexos.md` (borderô do boleto
agrupado) · `_inbox/sispag-boleto-agrupado-hml-achados.md`
