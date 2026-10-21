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
last_review: 2026-10-21
has_canonical_test: false
universality_evidence:
  - "HML 2026-10-19 (borderô 252, lote 48, PG191081.REM, retorno gar 7); PRD 2026-10-19 (PEDRONI 38883–38885 → boleto 332841)"
  - "HML 2026-10-20, medições da Task 1 (borderôs 253/254, lote flp 51, retorno gar 7): _inbox/sispag-boleto-agrupado-hml-achados.md"
  - "1 cliente apenas: universalidade a revisar com o Francinei (não bloqueante)"
---

# Business Rule: boleto agrupado no SISPAG — 1 boleto paga N títulos (I19)

> **Origem:** ADR-0076 (2026-10-20). Escopo: caso 1 (1 boleto → N títulos do mesmo credor). O ERP paga
> pelo **borderô** do `fin010`: em cadastro, uma baixa por título, importado como **um** item do lote
> SISPAG; o retorno do banco finaliza o borderô e baixa os N. **Sem flag e sem modos** (P0-5): ativo
> após o merge, sob o kill-switch existente `sispagLiveWriteEnabled` e o dry-run do Conexos.
> **Status: planned** (ontologia à frente do código; migration prevista 0090).
> **Emenda 2026-10-21** (medições HML da Task 1): guarda da limpeza = lote nativo, identidade do borderô =
> `filCod` + `borCod` + `borTimCad`, sem marcador de correlação. Ver a seção da emenda abaixo e a ADR-0076.

## Decisões do maintainer (2026-10-20)

Da entrevista (`_inbox/sispag-boleto-agrupado-interview.md`, "Respostas do maintainer"):

| # | Decisão |
|---|---|
| P0-1 | O sistema **sugere** grupos fechados; a analista **confirma** cada um; também pode **compor à mão** (o sistema só valida). Valores iguais ⇒ partição fixa "intercambiável", confirmada. |
| P0-2 | **Sugestão:** só **mesmo vencimento**. **Composição manual:** títulos até **10 dias antes** do vencimento do boleto, com aviso. |
| P0-3 | Grupo que cruza filial **bloqueado** ("não suportado, pagar à mão"); sonda V4 é follow-up. |
| P0-4 | Borderô nasce na **geração da remessa** (write-ahead, antes do `importar`). Antes do lote nativo finalizado, o sistema apaga **só o que criou**; depois (lote nativo finalizado ou com `.REM` gerado), nunca apaga nem cancela: `Alerta` + decisão da analista. *(Texto corrigido na emenda de 2026-10-21: a versão anterior usava `vldHasRemessaPgto = 1` como sinal de "depois".)* |
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
| PI-3 | `borDtaMvto` = data de débito do lote. ~~Marcador de correlação num campo de observação do `fin010`~~: **abandonado na emenda de 2026-10-21** (o cabeçalho do `fin010` não tem campo de observação; a identidade passa a ser `borCod` + `borTimCad`, I19l). |
| PI-4 | Modalidade `6` para barra do mesmo banco da conta (título próprio), `7` para banco diferente (I19o; **confirmado no HML em 2026-10-20**, V5). |
| PI-5 | Grupo inelegível na remessa **barra** a remessa antes de qualquer escrita (I19p(1)), espelho da I14a, em vez de retirar. |
| PI-6 | Anular grupo em lote `RASCUNHO` retira os N itens na mesma transação (I19t). |
| PI-7 | Grupo fechado no mesmo vencimento com título ainda não aprovado (ou que falha a I19c de outro modo) é **exibido com o motivo** ("aguardando alçada" etc.) e **não é confirmável**. O título nunca é descartado para sugerir um subconjunto (I19e). |
| PI-8 | O "vencido" do grupo, na formação automática e em L6, é o **vencimento do boleto** (dia civil em Brasília, ADR-0070) (I19j). |
| PI-9 | Depois de J rejeitado, o grupo só volta a uma remessa depois de a analista resolver o borderô antigo no ERP. Se o borderô antigo reaparecer em `borderosPendentes` do lote novo (V7), o sistema o **reaproveita** em vez de criar outro (I19r, I19s). V7 segue no watchlist como medição. |

## Emenda 2026-10-21 — medições HML da Task 1

As medições de 2026-10-20 (`_inbox/sispag-boleto-agrupado-hml-achados.md`, "Medições do TDD") contradisseram
duas premissas. O maintainer decidiu em 2026-10-21:

| # | Decisão |
|---|---|
| E-1 | **Guarda da limpeza = lote nativo.** A limpeza só é permitida enquanto o lote nativo **não está finalizado e não tem `.REM` gerado**, lido ao vivo. Depois disso: nunca exclui nem cancela; `Alerta` `sispag-bordero-grupo-pendente` e a analista decide. `vldHasRemessaPgto` **deixa de ser guarda**. Fato medido: vira 1 quando o borderô é **importado** num lote e volta a 0 quando o item sai; com o item no lote, o ERP recusa `excluirBaixa`/`excluirBordero` (`FIN_014.FIN_HAS_REMESSA_PGTO`), e por isso a ordem é item → baixas → borderô (I19q). |
| E-2 | **Identidade do borderô = `filCod` + `borCod` + `borTimCad`.** O ERP **reusa** `borCod` depois de `excluirBordero` (max+1 da filial). `borTimCad` é o carimbo de criação gravado pelo ERP (ao segundo), medido inalterado depois de baixas, import e finalização (borderô 252). **Sem marcador**: nada é escrito em `borEspNrbanco`. Write-ahead com `t0` antes do `POST` e `t1` depois; resposta perdida ⇒ busca por janela de `borTimCad` (I19l, I19s). |
| E-3 | **Ausência observada** = `fin010/list` com `borCod#EQ` sem linhas, ou só com linhas de outro `borTimCad`. `GET fin010/{fil}/{bor}` de borderô ausente responde `500 RECORDNOTFOUND`, não 404. |
| E-4 | **Fatos medidos, sem mudança de regra:** V2 (I19k), V3 (I19q), V5 (I19o), G4 (I19r). |
| E-5 | **G6 (P2):** sugestão ambígua ⇒ **sem sugestão**; a analista compõe à mão (I19e, I19f). GT1 (Task 22) conta a frequência. |

## Invariantes

| # | Invariante |
|---|---|
| **I19a** | **Forma do grupo.** Um boleto DDA **livre** (sem `docCod/titCod`, I15e(1)) e **N ≥ 2** títulos do **mesmo `pesCod`** (H3). O par (`pesCod`, `emissorChave`) está `VIGENTE` ou é confirmado no mesmo ato, pela mesma pessoa (I15g, P1-3). Um título = caminho 1:1 existente (I15/I17), nunca grupo (PI-1). |
| **I19b** | **Soma exata ao centavo (D3, P1-2).** `round(valorBoleto×100) == Σ round(abertoLiquido(t)×100)`, com `abertoLiquido` pela régua da I17b (`fin064.totalLiquido` conferido; divergência ou campo ausente ⇒ `VALOR_ABERTO_INDISPONIVEL`, fail-closed). `valorBoleto` decodificado por nós do código. Nenhuma tolerância; a I18 não se aplica a título de grupo. Conferido na confirmação (snapshot) e **de novo ao vivo** na remessa. |
| **I19c** | **Cada título elegível.** I2 (`liberado ∧ ¬pago`), ativo, `forma = BOLETO`, `tem_boleto ≠ true` (sem DDA do ERP), sem `DecisaoSugestaoBoleto CONFIRMADA`, sem `BloqueioDuplicidade ATIVO` (inclusive a de origem `GRUPO_BOLETO`: grupo retirado na remessa só volta a lote quando nenhum título dele tem marca ativa), fora de lote comprometido (ADR-0064) e fora de outro grupo `CONFIRMADO`. |
| **I19d** | **Uma filial (P0-3).** Todos os títulos na mesma `filCod`; o borderô e o lote são dessa filial (I4; §4 de `sispag-fin052-retorno-provado-hml.md`). Conjunto que cruza filial aparece com o motivo `CRUZA_FILIAL`, **não confirmável** ("não suportado, pagar à mão"). |
| **I19e** | **Sugestão = grupo fechado no mesmo vencimento (P0-1, P0-2).** Calculada, **não persistida** (I-DDA1). Para um boleto livre com par `VIGENTE` (ou candidato a par), o conjunto é **todos** os títulos em aberto do `pesCod` na filial com `vencimento == vencimentoBoleto` (dia civil). Só é sugerido se Σ == boleto (I19b). Nunca subconjunto (medição M1: 922/2369 falsos). Título do conjunto que falha I19c (ex.: ainda em alçada) ⇒ a sugestão é **exibida com o motivo** ("aguardando alçada" etc.) e **não é confirmável**; o título **nunca** é descartado para sugerir os demais (decisão PI-7). **Ambiguidade (G6, emenda 2026-10-21):** o boleto bate com a soma de **dois** conjuntos fechados (dois credores, mesmo dia, mesma soma) ⇒ **nenhuma** sugestão para esse boleto; a analista compõe à mão (I19g). GT1 (Task 22) mede a frequência. |
| **I19f** | **Intercambiáveis (PEDRONI).** K ≥ 2 boletos livres do mesmo (`pesCod`, `emissorChave`, vencimento, valor) e conjunto fechado de títulos **todos de mesmo valor**, com `valorBoleto = m × valorTitulo` (m inteiro) e Σ títulos = K × valorBoleto ⇒ partição determinística: boletos por (`ddcCod`, `ditCod`), títulos por (vencimento, `docCod`, `titCod`); o k-ésimo boleto leva o k-ésimo bloco de m títulos; grupo marcado `intercambiavel`; a analista confirma **cada** grupo. Qualquer outro caso com K ≥ 2 ⇒ sem sugestão (composição manual); em particular (G6, emenda 2026-10-21), dois boletos idênticos que **não** são intercambiáveis por esta regra e casam o mesmo conjunto fechado ⇒ **nenhuma** sugestão para nenhum dos dois. |
| **I19g** | **Composição manual (P0-1, P0-2).** A analista escolhe boleto e títulos; o sistema valida I19a–d e I19h. Janela por título: `0 ≤ vencimentoBoleto − vencimentoTitulo ≤ 10` dias (dia civil); fora dela ⇒ recusa (`GroupedBoletoDueWindowError`, 422). Algum título com Δ > 0 ⇒ aviso `TITULO_VENCE_ANTES_DO_BOLETO`, que exige **reconhecimento validado no servidor** (padrão I15o, PI-2) e é gravado em `avisosReconhecidos`. O grupo manual **não** precisa ser fechado. |
| **I19h** | **Datas.** `vencimentoBoleto ≥ dataDebito` do lote (I15h); boleto vencido nunca é confirmável. Sem lote, a data de referência é o `vencimentoBoleto` (Q-C adaptada). Revalidado na inclusão e na remessa. |
| **I19i** | **Confirmação é humana e auditada.** Só `sispag:executar` confirma/anula; o sistema nunca confirma. Trilha só-inclusão: `GRUPO_CONFIRMADO`, `GRUPO_ANULADO`, `GRUPO_RETIRADO`, `BORDERO_PREPARADO`, `BORDERO_REAPROVEITADO`, `BORDERO_LIMPO`, `GRUPO_PAGO`, `GRUPO_DIVERGENTE`, com quem, quando, chaves e código **mascarado** (I17j). Confirmar o mesmo (boleto, títulos) de novo devolve o grupo existente (idempotência); índices únicos parciais `WHERE estado = 'CONFIRMADO'` em (boleto) e em (título). |
| **I19j** | **Unidade indivisível no lote (P1-1, P1-4).** O grupo entra no lote como N `ItemLote` (`modalidade = BOLETO`, `grupoBoletoId`), na mesma transação, ou não entra. Mover, retirar e cancelar agem no grupo inteiro; retirar **um** título do grupo ⇒ `GroupedBoletoIndivisibleError` (409). A formação automática põe o grupo inteiro no lote do **vencimento do boleto** e nunca põe título de grupo avulso. Para a janela da formação e para L6 (desfazer auto-lote com vencido), o "vencido" do grupo é o do **boleto**, por dia civil em Brasília (ADR-0070; decisão PI-8): um grupo manual com título vencendo antes do boleto não é desfeito no dia do título. Grupo órfão, retido (I19c) ou com rejeição não resolvida (I19r) não é lotado pelo cron. |
| **I19k** | **Um grupo = um item nativo.** Na remessa, título de grupo **nunca** vai em `importarTitulos`; o grupo vai por borderô (I19l–n). **O ERP não protege contra pagar duas vezes** (V2, HML 2026-10-20): título com baixa em borderô em cadastro continua em aberto no `fin064`, mas some do grid `titulosPendentes` do `fin015`; e um `importarTitulos` com a linha "velha" (lida antes da baixa) é **aceito** depois da pergunta `FIN_041`, deixando o título no lote e no borderô ao mesmo tempo. Só esta invariante e a releitura do grid antes do `importar` impedem o pagamento duplo. |
| **I19l** | **Borderô do grupo (`prepararBorderoDoGrupo`, P0-4).** Etapa `preparar_bordero` do L8, depois de `criarLote` e antes de `importar`, por grupo: (1) write-ahead: `t0` (relógio do servidor) gravado **antes** do `POST`; (2) `POST fin010` `{ filCod do lote, borVldTipo 2, borVldFinalizado 0, borDtaMvto = dataDebito, gerNum }`; `t1` gravado depois; `borCod` **e** `borTimCad` da resposta (ou da releitura) persistidos logo após. **Identidade do borderô = `filCod` + `borCod` + `borTimCad`** (emenda 2026-10-21): o ERP reusa `borCod` depois de `excluirBordero` (max+1); `borTimCad` é o carimbo de criação do ERP, ao segundo, inalterado por baixas, import e finalização. Nada é escrito em `borEspNrbanco` (sem marcador); (3) por título: `fin010/baixas/validacao/tituloBaixa` → `POST fin010/baixas` (juros/multa/desconto 0, líquido = valor validado); (4) releitura do borderô com a identidade conferida (`borTimCad` igual ao persistido): N baixas, cada uma do título esperado, e `vlrTotalLiquido == valorBoleto` em centavos. `gerNum` = conta financeira da **conta pagadora do lote**, lida ao vivo do `fin005` (H2/H10); ausente ⇒ falha **antes** do `POST`. Identidade Conexos registrada (I-2). Grupo com J rejeitado antes: vale o reconhecimento da I19s (reaproveitar o borderô antigo ou criar um novo), nunca dois borderôs vivos para o mesmo grupo. |
| **I19m** | **Nós nunca finalizamos o borderô (D4).** Nenhuma chamada a `finalizarBordero`, `cancelarBordero` ou `fin146` sobre borderô de grupo. Quem o finaliza é o processamento nativo do retorno (`PRC_BAIXA_RETORNO_PAGFOR`, H7). |
| **I19n** | **Importar o borderô.** `fin015/finItemSispag/borderosPendentes/list/{fil}/{bnc}/{flp}` deve trazer a linha com o `borCod` do grupo (ausente ⇒ `BORDERO_NAO_PENDENTE`, determinística, causa provável `gerNum` — H2; a linha não traz `borTimCad`, por isso a identidade é conferida antes no `fin010`, I19l(4)) → `borderosPendentes/importar` com a linha lida + `filCodLote`, `bncCod`, `flpCod`, **`itemy: 1`**, `op: 1`, `bncCodFin015`. O sucesso é **observado na releitura**: item com o `borCod`, sem `docCod/titCod`, `itsMnyValor == valorBoleto`. Resposta `SUCESSO` sem item observado (H4) ⇒ falha ambígua (aborta e retoma), nunca sucesso. |
| **I19o** | **Barra no item de borderô.** Mesma sequência da I17e sobre o item com `borCod`. Elegibilidade: `GrupoBoleto CONFIRMADO`, não órfão, par `VIGENTE`, boleto relido do pool (substitui a decisão por título da I17a); valor pela I19b **e** `== itsMnyValor` do item (vem do borderô, H6; a I17n não se aplica); datas pela I19g/h (substitui a I17c). Modalidade: `7` se banco da barra ≠ banco do lote; `6` (título próprio) se igual (H5; PI-4). Medido no HML em 2026-10-20 (V5): barra do banco da conta com `6` é aceita; com `7`, o `confirmarCodigoBarras` recusa (`FIN_015.TITULO_DEVE_SER_MODALIDADE_TITULO_PROPRIO`); barra de outro banco com `6` é recusada (`FIN_015.TITULO_NAO_PERTENCE_AO_BANCO_EM_USO`); a recusa vem antes de qualquer escrita no item. Valem I17d, I17f, I17i, I17j e I17m. **Independe do modo I17k** (P0-5): só o kill-switch o desliga. |
| **I19p** | **Falhas.** (1) **Antes de qualquer escrita** (grupo inelegível ao vivo: título pago/não liberado, soma, boleto fora do pool, par revogado): `GroupedBoletoNotEligibleAtRemittanceError` (409) barra a remessa, nada escrito (espelho de I14a/I17g(1); PI-5). (2) **Depois do borderô, transitória/ambígua** (timeout, 5xx, releitura inconclusiva): aborta, ledger `failed`, borderô e rascunho preservados; a retomada continua (I19s). (3) **Depois do borderô, determinística** (recusa 4xx de baixa, `BORDERO_NAO_PENDENTE`, divergência de valor, barra recusada, código repetido — I16 — ou borderô antigo não resolvido — I19s): o grupo é **retirado** pela maquinaria da I16d (motivo `GRUPO_BOLETO_FALHOU` ou `BORDERO_ANTERIOR_NAO_RESOLVIDO`, N marcas de retenção `GRUPO_BOLETO`), o borderô que **nós criamos nesta remessa** é limpo (I19q; o borderô antigo de um J rejeitado nunca é limpo) e a remessa segue com os demais. |
| **I19q** | **Limpeza do borderô (`limparBorderoDoGrupo`, P0-4).** Só enquanto o **lote nativo** **não está finalizado e não tem `.REM` gerado**, estado lido **ao vivo** no `fin015` antes de excluir (emenda 2026-10-21), e só o borderô **nosso**: `filCod` + `borCod` + `borTimCad` do write-ahead desta remessa, conferidos na releitura (o mesmo `borCod` com outro `borTimCad` é de outra pessoa: nunca tocado). Ordem: `DELETE` do item nativo (se importado) → releitura (ausência) → `excluirBaixa` de cada baixa → `excluirBordero` → releitura (ausência). A ordem é **imposta pelo ERP** (V3, HML 2026-10-20): com o item no lote, `excluirBaixa`/`excluirBordero` ⇒ `400 FIN_014.FIN_HAS_REMESSA_PGTO`. Ausência observada = `fin010/list` `borCod#EQ` sem linhas, ou só com outro `borTimCad`; `GET fin010/{fil}/{bor}` de borderô ausente responde `500 RECORDNOTFOUND`, não 404. Sucesso = ausência observada. **`vldHasRemessaPgto` não é guarda:** medido, vira 1 no `importar` para um lote e volta a 0 no `DELETE` do item; reflete o import, não "foi ao banco". Disparos: retirada I19p(3)/I16d, lote local cancelado com rascunho nativo aberto. **Depois** de o lote nativo ser finalizado ou ter `.REM` gerado: **nunca** exclui nem cancela; `Alerta` `sispag-bordero-grupo-pendente` e a analista decide. Borderô reaproveitado (I19s) que falha: só o item nativo do lote novo é removido; o borderô fica, com o `Alerta`. |
| **I19r** | **Retorno e sincronização (P1-5).** I11 roda por título (os N `ItemLote`). Fechamento do grupo: os N `PAGO` no `fin064` ⇒ grupo `PAGO` (terminal, evento `GRUPO_PAGO`); parte paga ⇒ `divergencia` nos N itens + `Alerta` `sispag-baixa-divergente`, nunca "parcialmente pago"; J rejeitado (evento do `fin052` casado pela chave do item nativo) ⇒ os N `REJEITADO`, lote `RETORNADO`, grupo volta a "confirmado, sem lote" com a situação `REJEITADO` + `Alerta` `sispag-bordero-grupo-pendente` (o borderô continua em cadastro no ERP; se ele segue ligado ao lote rejeitado e qual o valor de `vldHasRemessaPgto` nesse estado é **medição da V7**, não premissa). **Casamento do retorno (G4, HML 2026-10-20, gar 7):** o `fin052` traz **uma** linha para o item de borderô (o J), com `filCod/bncCod/flpCod/itsCodSeq` + `borCod`, sem `docCod/titCod` e sem valor pago; casa-se pela chave do item nativo e/ou pelo `borCod`; os N títulos vêm do grupo local, e o pagamento de cada um é confirmado no `fin064`. **Volta à remessa só depois de a analista resolver o borderô antigo no ERP** (decisão PI-9): a formação automática não o lota; a analista o inclui à mão; a remessa reconhece o borderô antigo ao vivo pela I19s (ausente/cancelado ⇒ cria novo; em `borderosPendentes` do lote novo ⇒ reaproveita; em cadastro e fora dos pendentes ⇒ retira o grupo). `borVldFinalizado` do borderô é corroboração, não prova (nível 4 de I11). |
| **I19s** | **Retomada e reaproveitamento.** Ver emenda em `retomada-remessa-sispag.md`. Borderô reconhecido **ao vivo** pela identidade `filCod` + `borCod` + `borTimCad` (emenda 2026-10-21). **Com `borCod` no write-ahead:** `fin010/list` `borCod#EQ`; linha com o mesmo `borTimCad` ⇒ é o nosso; linha com o `borCod` e **outro** `borTimCad` ⇒ o ERP reusou o número, o borderô é de **outra pessoa** ⇒ `indeterminado`, nunca tocado. **Resposta perdida** (`t0` gravado, `borCod` ausente): busca no `fin010/list` por `filCod`, `usnCodCad` = usuário do robô, `gerNum`, `borDtaMvto`, `borVldTipo 2`, `borVldFinalizado = 0` e `borTimCad#GE` (`t0` − margem) / `borTimCad#LE` (`t1` + margem), em epoch ms: exatamente um ⇒ adota (persiste `borCod` + `borTimCad`); zero ⇒ cria; dois ou mais ⇒ `indeterminado` + `Alerta`. A margem (desvio de relógio entre servidor e ERP) é **constante de código**, não domínio. Risco conhecido: Permutas também cria borderôs `fin010` com o mesmo usuário do robô; o filtro por `gerNum`, data e tipo existe por isso, e a colisão que sobrar cai em `indeterminado` (seguro); baixas faltantes completadas; baixa de título que não é do grupo ⇒ `indeterminado` (terceiro); borderô já importado ⇒ pula; borderô **finalizado** antes da remessa ⇒ `indeterminado` + `Alerta` (alguém baixou por fora). **Depois de J rejeitado (PI-9):** o borderô antigo é lido no `fin010` pela identidade (`borCod` + `borTimCad`) antes de criar outro. Ausente (sem linha, ou o número reusado com outro `borTimCad`) ou cancelado (a analista o resolveu) ⇒ cria um novo, sem tocar no borderô alheio. Presente em `borderosPendentes` do lote novo (V7) ⇒ **reaproveita**: adota o `borCod` e o `borTimCad` no write-ahead novo (evento `BORDERO_REAPROVEITADO`), confere as N baixas (títulos esperados, valores pela I19b ao vivo) e `vlrTotalLiquido == valorBoleto`, importa; **nunca** cria um segundo borderô para o mesmo grupo. Em cadastro mas fora dos pendentes, ou com baixas divergentes ⇒ I19p(3) com motivo `BORDERO_ANTERIOR_NAO_RESOLVIDO`, sem tocar no borderô antigo. |
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
resolvido (grupo retirado) e reaparecido nos pendentes (reaproveitado, sem segundo borderô); `borCod` do
write-ahead reusado pelo ERP com outro `borTimCad` (`indeterminado`, borderô alheio intocado); resposta do
`POST fin010` perdida com dois borderôs na janela de `borTimCad` (`indeterminado` + `Alerta`); limpeza pedida
com o lote nativo finalizado (nada excluído, `Alerta`); boleto que bate com dois conjuntos fechados (sem
sugestão, G6).

## Ver também

`decisions/0076-sispag-boleto-agrupado-bordero.md` · `entities/grupo-boleto.md` ·
`entities/lote-pagamento.md` (`ItemLote.grupoBoletoId`) · `business-rules/vinculo-codbar-item-sispag.md`
(I17o) · `business-rules/sugestao-boleto-dda-sispag.md` (I15q) · `business-rules/boleto-exige-codigo-de-barras.md`
(I16, item de borderô) · `business-rules/retomada-remessa-sispag.md` (`preparar_bordero`) ·
`business-rules/sincronizacao-status-lote-sispag.md` (I11i) · `integrations/conexos.md` (borderô do boleto
agrupado) · `_inbox/sispag-boleto-agrupado-hml-achados.md`
