---
name: ajuste-centavos-titulo-sispag
type: business-rule
entity: TituloAPagar
invariant: I18
ontology_version: "0.44.0"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/AjusteCentavosTituloService.ts
  - src/backend/domain/libs/boleto/ElegibilidadeAjusteCentavos.ts
  - src/backend/domain/libs/boleto/EtapaAjusteCentavos.ts
  - src/backend/domain/libs/boleto/ModoAjusteCentavos.ts
  - src/backend/domain/libs/boleto/ValorAbertoLiquido.ts
  - src/backend/domain/client/ConexosRenegociacaoClient.ts
  - src/backend/domain/client/ConexosSispagWriteClient.ts
  - src/backend/domain/client/ConexosSessionResolver.ts
  - src/backend/domain/repository/sispag/AjusteCentavosExecucaoRepository.ts
  - src/backend/domain/repository/sispag/SugestaoBoletoRepository.ts
  - src/backend/domain/repository/sispag/TituloAPagarRepository.ts
  - src/backend/domain/repository/sispag/LotePagamentoRepository.ts
  - src/backend/domain/service/sispag/BoletoSuggestionService.ts
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/domain/libs/runtime/ServerProcessMarker.ts
  - src/backend/routes/sispag.ts
  - src/backend/migrations/0087_sispag_ajuste_centavos.sql
last_review: 2026-10-19
has_canonical_test: true
canonical_test: src/backend/domain/service/sispag/AjusteCentavosTituloService.test.ts
universality_evidence:
  - "HML 2026-10-19 (_inbox/sispag-centavos-hml-achados.md): fin070 frnVldTpop 1/2 renegocia o título para o valor do boleto (536/1 -> 536/2 líquido 53,54; 540/1 -> 540/2 líquido 178,77); fin103 APROVAR libera; vínculo e .REM ponta a ponta (J paga o valor da barra)"
  - "PRD 2026-10-19 (só leitura): 109 títulos BOLETO com número igual e |Δ| <= R$ 0,05 (todos NELSON +0,01), 0 entre R$ 0,06 e R$ 10, 25 > R$ 10 (outro problema)"
  - "1 cliente apenas (Columbia): universalidade a revisar com o Francinei (não bloqueante, watchlist; precedente Q-I do ADR-0068). Mecânica DDA/CNAB 240 é nacional e estável"
---

# Business Rule: ajuste de centavos do título por renegociação (I18)

> **Origem:** ADR-0073 (2026-10-19). **O valor do boleto é a verdade** (D1). Quando uma pessoa já confirmou
> que o boleto é deste título (I15, `CONFIRMADA`) e a diferença é de centavos (|Δ| ≤ `LIMITE_VALOR_MESMO_DIA`,
> R$ 0,05), a plataforma **renegocia o título no `fin070`** para que o seu líquido fique igual ao valor do
> boleto (juros quando o boleto está acima, desconto quando está abaixo), **libera no `fin103` só o bloqueio
> que a própria renegociação criou** e faz decisão, carteira e item seguirem o **novo `titCod`**. A partir daí
> o vínculo do código (I17, régua líquida) acha o título com valor igual. **Status: partial** (modo `off` por
> default; escrita em PRD só com go explícito do maintainer, depois dos portões G1–G5).

> **Status de implementação (2026-10-19, `partial`).** **Entregue** (código das Tasks 1-12 e 16, modo `off` por
> default): elegibilidade (I18a), régua líquida, executor com compensação e retomada (I18c-j), gatilho pós-commit
> do confirmar, rotas de "tentar de novo" e varredura, bloqueio do `finalizarLote` enquanto roda (I18g, I18k),
> migration `0087`, tela com estado do ajuste e nova tentativa. **Pendente:** os portões **G1** (sonda de leitura
> do login do servidor), **G2/G3** (HML: vencimento passado/hoje e cancelar a renegociação não finalizada),
> **G4** (medição do líquido/pagamento parcial, Task 13) e **G5** (rollout, ver
> `_inbox/sispag-ajuste-centavos-rollout-g5.md`); a rota `cancelarRenegociacao` do `fin070` segue
> `NotImplementedError` atrás de `CANCELAMENTO_FIN070_PROVADO = false`; o default da guarda I17m
> (`MODO_GUARDA_VALOR_J = BLOQUEIA`) aguarda a medição da Task 13. `on` em PRD continua proibido.

## Por que existe

O J do `.REM` paga o **valor do título**, não o do item (HML A2/B0/B1/B2). Nenhum campo do item, nem o
`PUT fin026`, nem o `fin062`, muda o que o banco recebe. Sem ajustar o título, um par confirmado com +R$ 0,01
**nunca é pago** pela plataforma (109 NELSON em PRD). A renegociação é o único caminho nativo provado que muda
o valor do título.

## Invariantes

| # | Invariante |
|---|---|
| **I18a** | **Elegibilidade (todas, recalculadas AO VIVO no início e de novo antes do `finalizar`).** (1) Existe `DecisaoSugestaoBoleto` `CONFIRMADA`, não órfã, para o título, com par `ConfirmacaoEmissorBoleto` `VIGENTE` (emissor confirmado — número igual **sozinho não basta**, caso MSC nº 12294). (2) Número do documento do título == número do boleto (dígitos estritos, I15f). (3) `0 < \|Δ\| ≤ LIMITE_VALOR_MESMO_DIA` (R$ 0,05; **a mesma constante da I15c**, sem constante nova), com `Δ = valorBoleto − abertoLiquido` (I17b), `valorBoleto` **decodificado por nós** da barra. (4) **Mesmo vencimento** (Δdias = 0, data civil UTC meia-noite). (5) Título original **aprovado** no ERP (`fin064.vldLib = 1`) e `aprovado` na carteira. (6) Não pago, **sem pagamento parcial** (`totalPago = 0`) e **sem juros/desconto prévios** (`titMnyJuros = titMnyDesconto = 0`). (7) Título **não** renegociado antes por nós (sem ledger `concluido` em que ele seja `titCodNovo`): no máximo um ajuste por linhagem. (8) Título fora de lote local `FINALIZADO`/`REMESSA_GERADA`/`RETORNADO` e **fora de qualquer rascunho nativo** do `fin015` (lido ao vivo). (9) Modo da filial = `on` (I18l) e kill-switches ligados. Qualquer item falso ⇒ **nenhuma escrita**; ledger `recusado` com motivo; aviso visível (I18m). |
| **I18b** | **Sentido e valor.** `Δ > 0` (boleto acima) ⇒ `frnVldTpop = 1` (acréscimo; o ERP lança juros); `Δ < 0` (abaixo) ⇒ `frnVldTpop = 2` (desconto). `frnMnyValor = \|Δ\|`. `frnVldTpop = 0` nunca leva valor (o ERP recusa, `TIPO_OP_NAO_PERMITE_VALOR`). |
| **I18c** | **Sequência no ERP (uma renegociação por título).** `POST fin070` (`pesCod = fin064.pesCodFor`, `frnVldTipo 2`, `frnVldTpop 0`, `frnDtaReneg` = hoje BRT, obs MAIÚSCULA com o **marcador de correlação** do ledger) → `POST fin070/titulos` (o título original) → `POST fin070/titulos/composicao` com **o mesmo valor aberto** do original, **o vencimento original**, `frgEspNumero`, `pgtCod`, `dupEspOrdem` copiados do original → `PUT fin070` com `frnMnyValor = \|Δ\|` e `frnVldTpop` da I18b → **conferência**: `mnyValorTotal` do `fin070` == `valorBoleto` (senão não finaliza, I18h) → `PUT fin070/finalizar/{frnCod}`. O ERP consome o título original e cria um título novo no mesmo `docCod`. Juros/desconto **nunca** vão na composição nem no item (o ERP os ignora ali). |
| **I18d** | **Pós-condição do título novo (conferida ao vivo no `fin064`).** Mesmo `docCod`, `titCod` novo, **vencimento = o original**, `abertoLiquido` (I17b) == `valorBoleto`, `titMnyJuros` ou `titMnyDesconto` == \|Δ\|, título original ausente. O título novo é identificado por: mesmo `docCod`, `titCod` que não existia antes, vencimento e líquido acima. Zero ou mais de um candidato ⇒ `indeterminado` (alerta, ação humana), nunca palpite. |
| **I18e** | **Reaprovação estreita (D4).** Só se o título **original** estava aprovado (I18a(5)). Libera **apenas** bloqueio do `fin103` que: (1) é do título novo; (2) nasceu no instante do nosso `finalizar` (não existia antes dele); (3) tem `titMnyTotal == valorBoleto`; (4) tem **exatamente um** comando ativo "APROVAR" em `fin106/finBloqCmd/list/{fblCod}`. Chamada: `POST fin103/validaSelecionado` → `POST fin103/aplicarComando { items: [<linha lida do fin103/list> + fbaCod] }` → releitura (`ftbVldStatus` liberado e `fin064.vldLib = 1`). Título novo **sem** bloqueio ⇒ nada a liberar. Bloqueio de **outra** natureza, outro valor, comando ausente/ambíguo, ou bloqueio que permanece após o nosso ⇒ **não libera** e o ajuste termina `aguardando_aprovacao_manual` com aviso (fluxo normal do Conexos, por outra pessoa). A regra de bloqueio, o `fblCod` e o `fbaCod` são **lidos ao vivo**, nunca configurados nem fixados. |
| **I18f** | **Identidade Conexos = sessão do servidor (resposta P0-1).** Toda escrita da I18 usa **explicitamente** a sessão da credencial do ambiente do servidor (`CONEXOS_USERNAME` via `EnvironmentProvider`), resolvida **fora** do caminho por-request do `ConexosSessionResolver`. **Nunca** a sessão da analista vinculada; **nunca** em processo de job/cron (crons rodam como CLONEX, sem `fin070`/`fin103`). Execução fora do processo do servidor, credencial ausente ou login não sondado (I18n, G1) ⇒ o modo efetivo é `shadow`, com `warn`. O ledger grava `conexos_username`/`conexos_usn_cod` (I-2). |
| **I18g** | **Disparo e retomada.** (1) Logo **depois do commit** do `confirmarSugestaoBoleto`, **fora** da transação dele, de forma assíncrona no processo do servidor; a resposta do `confirmar` não espera o ERP. (2) Ação "tentar de novo" (mesma ação, `sispag:executar`). (3) Varredura de retomada no processo do servidor (ao abrir a tela do SISPAG e após cada `confirmar`), que retoma ledgers não terminais. **Nunca** dentro da remessa, **nunca** dentro da transação do `confirmar`, **nunca** em cron. |
| **I18h** | **Ledger write-ahead e matriz de falhas.** Um ledger por tentativa, chave de idempotência `(filCod, docCod, titCodOrigem, decisaoId)`; **no máximo um ledger não terminal por título de origem** (índice único parcial). Cada etapa grava a intenção **antes** da chamada e o resultado depois: `pendente → renegociacao_criada(frnCod) → titulo_incluido → composicao_gravada → ajuste_aplicado → finalizada(titCodNovo) → liberada \| sem_bloqueio \| aguardando_aprovacao_manual → rechaveada ⇒ concluido`. **Antes de `finalizar`:** qualquer falha (determinística ou transitória sem reconhecimento) ⇒ **cancela** o `frnCod` (`PUT fin070/cancelar/{frnCod}` ou `DELETE`, a provar em HML, G3), relê, e o ledger vai a `cancelado`; o título original fica **intacto**. Cancelamento que falha ⇒ `indeterminado` + alerta (nunca se cria segunda renegociação por cima). **Depois de `finalizar`:** só **para a frente** (liberar, rechavear), nunca desfaz; falha ⇒ fica não terminal e a retomada continua. Transitório = retry com `RetryExecutor` (nunca `setTimeout` manual). |
| **I18i** | **Idempotência e reconhecimento ao vivo.** A retomada reconhece o estado **no ERP**, não só no ledger: `frnCod` existente (achado pelo marcador de correlação na obs quando a resposta do `POST` se perdeu), finalizado ou não, título novo presente, bloqueio liberado. Etapa já observada não é refeita; nenhum evento duplicado. Reexecutar sobre um ajuste `concluido` é no-op. |
| **I18j** | **Rechaveamento (uma transação local).** Na mesma transação: (1) decisão antiga `CONFIRMADA → ANULADA` com `tipoAnulacao = TITULO_RENEGOCIADO`, `anuladaPor = 'sistema'`, motivo "título renegociado X/Y → X/Z, frnCod N"; (2) nova `DecisaoSugestaoBoleto` `CONFIRMADA` no título novo, mesmo boleto, mesmo par, `decididoPor`/`decididoEm` **herdados da original**, `origemDecisaoId`, `transferidaPor = 'sistema'` (transferir **não** é confirmar, I15g); a ordem anula-antes-de-inserir preserva os índices únicos (I15l); (3) eventos `TITULO_RENEGOCIADO` e `DECISAO_TRANSFERIDA` na trilha; (4) **upsert** do título novo em `titulo_a_pagar` com os dados lidos ao vivo do `fin064` e `ativo = false` imediato no antigo (sem esperar o cron); (5) todo `ItemLote` em lote local `RASCUNHO` que aponta para o título antigo passa para o título novo (`titCod`, `valor` = líquido novo), `versao + 1`, evento na trilha do lote. O par `ConfirmacaoEmissorBoleto` **não muda**. Se a decisão foi anulada pela analista depois do `finalizar` (janela entre I18a e o rechaveamento), (1)/(2) não acontecem: carteira e item seguem o título novo, o ledger fecha `concluido_sem_decisao`, com aviso. |
| **I18k** | **Título em lote (resposta P0-3).** Lote local `RASCUNHO` ⇒ permitido, troca do item na I18j(5). Lote local `FINALIZADO`/`REMESSA_GERADA`/`RETORNADO`, ou título no rascunho nativo do `fin015` ⇒ **não renegocia** (`recusado`, motivo `TITULO_EM_LOTE_FINALIZADO`) e avisa. Enquanto houver ajuste não terminal, `finalizarLote` de lote que contém o título é **recusado** (`TitleAdjustmentInProgressError`, 409). |
| **I18l** | **Modos e kill-switch.** `off` (default): nada acontece; a UI mostra "diferença de centavos — ajuste desligado". `shadow`: I18a inteira **ao vivo** (leituras no ERP permitidas), **zero escrita**; grava `AJUSTE_SIMULADO` e lista os candidatos por endpoint + log. `on`: executa. Valor único global ou lista por filial, mesmas regras de parse da I17k (inválido ⇒ `off`). `sispagLiveWriteEnabled`, `conexosWriteEnabled` e `conexosDryRun` também derrubam o ajuste. Os valores por filial são **configuração** (`EnvironmentProvider`), não ontologia. |
| **I18m** | **Acima do limite, nada é automático.** \|Δ\| > R$ 0,05, Δdias ≠ 0, número diferente, par não vigente ou título não aprovado ⇒ **nenhuma escrita**; o vínculo continua `VALOR_DIFERENTE` (I17b) e o caminho é o fluxo manual do Conexos, por outra pessoa. A I18 **não alarga** a tolerância de nenhum par (I15d) nem cria tier novo. |
| **I18n** | **Portões de rollout em PRD (D6).** `on` em PRD só depois de: **G1** sonda **só leitura** de permissão (`ger014`) do login do servidor para `fin070` e `fin103` (espelho do V-PRD1; respeitar a memória "probe local derruba sessão"); **G2** HML provando composição com vencimento **passado e de hoje** (P1-3); **G3** HML provando cancelamento de renegociação **não finalizada** e reconhecimento pelo marcador na obs; **G4** medição só leitura em PRD do líquido em títulos com pagamento parcial e da divergência das duas fórmulas da I17b (P1-4), antes do merge; **G5** `shadow` em PRD e então **um** título real controlado, com go explícito do maintainer. |

## Privacidade e trilha

Nenhuma linha digitável completa em ledger, log, evento ou obs do `fin070` (I17j/I15k): só o mascarado 5+4.
A obs do `fin070` leva o marcador de correlação e a referência do boleto mascarada, em MAIÚSCULA.

Eventos novos na trilha `sispag_sugestao_boleto_evento` (só-inclusão): `AJUSTE_SIMULADO`, `TITULO_RENEGOCIADO`,
`DECISAO_TRANSFERIDA`, `AJUSTE_RECUSADO`, `AJUSTE_CANCELADO`, `AJUSTE_FALHOU`. Na trilha do lote:
`ITEM_TITULO_RENEGOCIADO` (título antigo → novo, valor antigo → novo).

## Erros nomeados

| Erro | Onde | HTTP |
|---|---|---|
| `TitleAdjustmentInProgressError` | `finalizarLote` com item cujo título tem ajuste não terminal (I18k) | 409 |
| `CentsAdjustmentIncompleteError` | falha transitória/ambígua; retomável (I18h) | 409 |
| `CentsAdjustmentNotEligibleError` | "tentar de novo" sobre título que deixou de ser elegível (I18a), com o motivo | 409 |

## Premissas pendentes com a Columbia (não bloqueiam; ADR-0073)

Renegociação em vez de correção do documento; conta contábil de juros/desconto (premissa: o default do
`fin070`); usuário de aprovação no `fin103` (premissa: a sessão do servidor); acesso do login do servidor a
`fin070`/`fin103` em PRD (G1).

## Casos canônicos de teste

1. NELSON 462,49 × boleto 462,50, mesmo vencimento, nº igual, par vigente ⇒ `frnVldTpop 1`, 0,01; título novo
   com líquido 462,50; I17b passa; J = barra 462,50 / título 462,49 / mora 0,01 / pagamento 462,50.
2. 178,78 × 178,77 ⇒ `frnVldTpop 2`, 0,01; líquido 178,77; J com abatimento 0,01, pagamento 178,77.
3. Δ = R$ 0,06 ⇒ zero chamada ao `fin070`; segue `VALOR_DIFERENTE`.
4. MSC nº 12294 × boleto de outro emissor ⇒ recusado (sem par `VIGENTE`).
5. Título sem juros/desconto e Δ = 0 ⇒ I17b idêntica ao comportamento atual (regressão).
6. Falha depois de `POST fin070/titulos` ⇒ cancela o `frnCod`; título original intacto.
7. Título novo com bloqueio de outra regra ou valor ≠ boleto ⇒ não libera; `aguardando_aprovacao_manual`.
8. Retomada depois de `finalizar` e antes de liberar ⇒ nenhuma segunda renegociação.
9. Resposta do `POST fin070` perdida ⇒ retomada acha o `frnCod` pelo marcador e continua.
10. Título em lote local `RASCUNHO` ⇒ item trocado na transação do rechaveamento; em `FINALIZADO` ⇒ recusado.
11. `finalizarLote` durante ajuste em curso ⇒ `TitleAdjustmentInProgressError`.
12. Execução em processo de job ⇒ modo efetivo `shadow`, nenhuma escrita.
13. Título com pagamento parcial ⇒ recusado (I18a(6)).

## Ver também

`decisions/0073-*.md` · `actions/sispag/ajustar-centavos-titulo.md` · `business-rules/vinculo-codbar-item-sispag.md`
(I17b, I17m, I17n) · `business-rules/sugestao-boleto-dda-sispag.md` (I15c, I15g) ·
`entities/decisao-sugestao-boleto.md` · `entities/titulo-a-pagar.md` · `business-rules/identidade-execucao-conexos.md`
· `_inbox/sispag-centavos-hml-achados.md`
