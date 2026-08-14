---
adr_number: 0034
title: A máquina de estados da TransacaoBancaria ganha writers reais — `parcial` e `processada` derivados da Σ das alocações executadas, `erro` escrito na falha da execução, `conciliada`/`manual` reconhecidos como sem produtor até o Módulo 2 e removidos da tela; a tabela de transições vira autoritativa como guarda de origem em SQL; backfill da carteira travada
date: 2026-08-13
status: accepted
type: change
related_entities: [TransacaoBancaria, SolicitacaoNumerario]
related_actions: [gerarSolicitacaoNumerario, importarTransacoesExtrato, atribuirBaixa]
related_integrations: [conexos-com299-gerdoc]
supersedes_decisions: []
amends_decisions: [0031, 0033]
---

# ADR 0034: a carteira para de mentir sobre o próprio trabalho

**Cliente:** Columbia Trading · **Entrega:** Kavex (created by Clonex) · **Branch:**
`worktree-recebimentos-status-writers` (worktree, base `main`). **Fonte:** sessão de usabilidade da
"Gestão de Adiantamentos" com o Yuri (2026-08-13), aberta com quatro pedidos de tela e resolvida numa
causa raiz só. **`entity_changed = true`** — quatro dos seis status de `TransacaoBancaria` passam a
ter significado operacional pela primeira vez.

## Contexto

O Yuri abriu a conversa com quatro incômodos de usabilidade: (1) pagamentos processados deviam sair
da primeira tabela; (2) uma aba separada para processos cujo último estado é erro; (3) talvez valesse
bater o registro do banco com o Conexos; (4) pedir aos analistas que usassem a opção de arquivar.

A investigação mostrou que (1) e (2) eram o **mesmo defeito**, e não pedidos de tela. Os itens (3) e
(4) saíram do escopo por decisão dele: conciliar contra o Conexos não pertence a esta frente agora, e
o arquivamento é conversa com os analistas.

### 1. Quatro dos seis status nunca eram escritos

| Status | Quem escrevia, antes desta ADR |
|---|---|
| `importada` | nascimento (`normalizarLancamento`, `normalizarLinhaXlsx`) |
| `processada` | `TransacaoRepository.marcarProcessada`, desde a ADR-0033 (2026-08-10) |
| `conciliada`, `parcial`, `manual`, `erro` | **ninguém** |

Consequência direta na tela: os KPIs "Conciliadas", "Parciais", "Fila manual" e "Erro" eram
permanentemente zero; os botões de filtro correspondentes devolviam lista vazia sempre; e o card
"Fila manual" levava a uma aba placeholder. Um KPI que nunca sai de zero não é um número neutro — ele
ensina o analista a desconfiar de todos os outros números da mesma tela.

### 2. O terminal escapava, e a fuga era permanente

`marcarProcessada` nasceu na ADR-0033. Toda alocação executada **antes de 2026-08-10** deixou a
transação em `importada` por construção. E mesmo depois:

- a marcação era *best-effort* (falha virava WARN, deliberadamente — o dinheiro já se moveu no ERP e
  derrubar a resposta convidaria o analista a reprocessar uma baixa que já aconteceu);
- o curto-circuito de idempotência devolvia `skipped` **sem retentar a marcação**, e ninguém
  reprocessa uma alocação bem-sucedida.

Resultado medido na tela de produção do Yuri (captura de 2026-08-13): toda linha em `importada`,
incluindo um crédito de R$ 6.690.000,00.

### 3. A marcação era estruturalmente incapaz de representar cobertura parcial

A marcação era por `txn_id`; o ledger é por `(txn_id, pri_cod, valor)`. Um crédito dividido entre
quatro processos virava `processada` na **primeira** baixa, escondendo da carteira o dinheiro que
ainda faltava alocar. Isso não é desvio — é um campo que não consegue dizer a verdade.

### 4. A falha só existia no ledger

`registrarFalha` gravava `markError` no `solicitacao_numerario_execucao` e nada na transação, apesar
de ter o `txnId` em escopo. O analista não tinha como ver na carteira que uma alocação daquele
crédito havia quebrado. Era por isso que "aba de erro" não podia ser construída sobre o status.

## Decisões

### D1 — `processada` × `parcial` pela regra Σ, em centavos inteiros

Σ = `SUM(valor)` das linhas do ledger com `status = 'settled' AND dry_run = FALSE`, comparada com
`transacao_bancaria.valor`. `cents(Σ) >= cents(V)` → `processada`; `0 < cents(Σ) < cents(V)` →
`parcial`.

Comparação em **centavos inteiros** (`Math.round(x * 100)` em TS, `ROUND(x * 100)` sobre `NUMERIC` em
SQL), nunca com epsilon de ponto flutuante: três rateios de um terço e o clássico `0.1 + 0.2` são
exatamente os casos que uma comparação direta erra. `>=` e não `=` porque pagamento a maior é
trabalho concluído, não anomalia a esconder.

O filtro `status = 'settled' AND dry_run = FALSE` é obrigatório: a chave de idempotência é
`sn-real:{txnId}:{priCod}:{valor}`, então somar todos os status contaria duas vezes uma alocação
retentada com valor diferente.

### D2 — Σ indeterminada NÃO escreve nada

Quando a soma não pode ser medida (a query lançou, ou o ledger não conhece o `txnId`), o caminho de
settle **não escreve status nenhum** e deixa a decisão para a varredura de reconciliação.

> **Revisado durante a revisão adversarial desta fatia.** A decisão original era escrever
> `processada`, com o argumento de que isso reproduzia o comportamento anterior à regra Σ e portanto
> não regredia nada. **O argumento estava errado**, e a assimetria é o ponto: `processada` é o único
> terminal de verdade — `origensPermitidasPara` nunca o devolve, então nem a varredura, nem o
> backfill, nem reprocessar conseguem tirar um crédito de lá. Um `SUM` que falhasse por timeout de
> pool mandaria um crédito de R$ 1 milhão com R$ 250 mil alocados para fora da carteira **e** para
> fora do KPI "a distribuir", permanentemente, recuperável só por SQL manual. O fail-open antigo
> caía num estado recuperável (`importada`, visível na fila); este cairia no único do qual não se
> volta. Não são equivalentes.

Não escrever mantém o crédito **visível e recuperável**, e a varredura horária decide com a medição
feita **dentro do Postgres**, numa statement só, sem round-trip que possa falhar no meio. Errar para
"ainda aparece como pendente" é o erro barato; errar para "sumiu da carteira" não é.

Linhas de ledger com `valor` nulo (anteriores à migração 0042) são puladas pelo `SUM`, o que só pode
**subestimar** a Σ. No pior caso um crédito completo fica `parcial` e permanece na fila, onde o
analista o abre e vê saldo zero. Nunca o contrário — nunca escondemos dinheiro não alocado.

### D3 — `blocked` (pré-flight reprovado) NÃO escreve status

Três razões que se somam:

1. Nada foi tentado no ERP: o pré-flight é read-only e roda antes do `beginExecution`. O crédito
   segue 100% não alocado e pertence à fila `importada`.
2. Tirar a linha de `importada` a desligaria do refresh do cron por causa de uma pendência de
   **cadastro do cliente**, que não é fato do movimento bancário.
3. A aba de falhas passaria a misturar "nós falhamos" com "o cadastro do seu cliente está
   incompleto" — duas filas com donos diferentes.

Consequência aceita: `blocked` continua sem rastro persistido. O conserto seria abrir a linha de
ledger antes do pré-flight, o que muda a semântica de idempotência — fora de escopo, registrado no
`_inbox`.

### D4 — `conciliada` e `manual` ficam no domínio e saem da tela

Sem o motor de matching (Módulo 2) não há produtor possível. A ontologia é internamente contraditória
sobre o que `conciliada` significa — `state-machines/transacao-bancaria.md` diz "match resolvido **e
executado/pronto**", enquanto `actions/recebimentos/atribuir-baixa.md` diz que a mesma transição
produz "rascunho local, **nenhuma escrita no ERP**". Quem resolve isso é o Módulo 2, não esta fatia.

Redefinir agora seria pior: o único candidato a writer seria "alocação registrada mas ainda não
executada", e esse estado **não existe** no fluxo atual — `processarAlocacao` é síncrono, vai de
"nada" a `settled`/`error` numa requisição. Inventar um estado sem instante de vida é inventar um bug.

Apagar do enum também seria pior: obrigaria a recriar o `CHECK`, mexer no union type do frontend e no
`Record` exaustivo dos badges — churn puro para desfazer daqui a uma fatia.

Então: os valores ficam no enum, no `CHECK`, na tabela de transições e na resposta da API; **saem dos
KPIs, dos botões de filtro e da aba placeholder**.

### D5 — A tabela de transições vira autoritativa como GUARDA DE ORIGEM em SQL

O docblock de `TransacaoRepository.marcarProcessada` estava **certo no princípio e errado no
mecanismo**. Certo: "se o ERP confirmou a baixa, a transação ESTÁ processada — recusar por causa do
estado anterior deixaria a tela mentindo". Errado: concluir daí que a máquina precisava ser
*bypassada*. O que não pode acontecer é **lançar** num caminho onde o dinheiro já se moveu; não
escrever nada é seguro.

`origensPermitidasPara(destino)` deriva de `TRANSACAO_ALLOWED` e é aplicada como
`WHERE status = ANY($origens)` — atômica, sem `throw`. `TRANSACAO_ALLOWED` ganha seu primeiro
chamador de produção. `assertTransitionTransacao` (a forma que lança) segue exportada para o Módulo 2,
que decide **antes** de escrever no ERP e pode falhar-fechado.

Garantia que cai de graça: `PROCESSADA` não é origem de nada, logo nenhuma escrita tardia consegue
rebaixar o terminal — aplicado dentro do `WHERE`, não numa leitura anterior.

**Emenda mínima na tabela:** `[ERRO]` e `[MANUAL]` passam a admitir `PARCIAL`. Sem isso, a retomada
de uma perna que falhou e settla apenas parte é barrada **em silêncio** (a guarda não lança) e o
crédito fica `erro` para sempre com dinheiro parcialmente alocado atrás.

### D6 — Reparo por reprocessamento + varredura horária

Os **dois** curto-circuitos de idempotência ressincronizam o status antes de devolver `skipped`:
`checarBloqueio` (o que realmente dispara num re-POST, porque roda antes do pré-flight) e
`begin.alreadySettled` (a janela de corrida). Com isso, "processar de novo" vira o botão de conserto,
sem rota nova. Custo zero quando já está certo: a guarda `status <> destino` transforma a escrita num
UPDATE de zero linhas.

Como ninguém reprocessa uma alocação bem-sucedida, `reconciliarStatusPorLedger` roda ao fim de cada
run de ingestão (cadência horária, ADR-0028), dentro de `try/catch` — importar extrato é o trabalho
principal, reconciliar rótulo é manutenção.

### D7 — Latch da reingestão reforçado com `NOT EXISTS` sobre o ledger

O latch do `upsertMany` era `status = 'importada'`. Um crédito cuja marcação falhou continuava
`importada` e **portanto continuava sendo refrescado toda hora** — com `valor` incluído, que é o
denominador da regra Σ. O cron podia mexer no denominador debaixo de uma alocação em curso: o buraco
do desvio e o buraco do latch se encontravam na mesma linha.

Agora: `status = 'importada'` **E** nenhuma linha de ledger apontando para o crédito. Estritamente
mais forte, nunca mais fraco — qualquer linha de ledger significa que um humano mirou nele.

Efeito colateral aceito: todo crédito que sai de `importada` deixa de ter
`valor`/`contraparte`/`visto_em_run_id` atualizados pelo cron. Para `processada` isso é desejável (o
passado não deve mudar). Para `parcial` é deliberado — não queremos o denominador se mexendo debaixo
de uma alocação em curso — mas significa que uma correção de extrato pelo banco deixa de ser vista
nesses créditos.

### D8 — Backfill 0047, com medição ANTES de aplicar

Três statements idempotentes, nesta ordem: cobertura total → `processada`; cobertura parcial →
`parcial`; último evento do ledger não terminou bem → `erro`. `erro` por último porque **quem escreve
o status é o último evento do ledger**, que é a regra do caminho vivo — um backfill que produz um
estado que o runtime nunca produziria é pior que nenhum backfill.

A terceira statement casa `status = 'error'` **ou** `reconciling` mais velho que a janela de
interrupção (ver D10). É a mesma cláusula da varredura, e é o que impede a divergência oposta: sem
ela, um crédito com uma perna paga e outra travada seria rebaixado de `erro` para `parcial` pela
varredura e sairia da aba de falhas uma hora depois, sem que nada tivesse sido consertado.

> Numerada `0047` e não `0046`: já existe `0046_transacao_bancaria_transferencia_interna.sql`. O
> runner chaveia `schema_migrations` pelo nome completo, então duas `0046` aplicariam — mas a ordem
> passaria a ser alfabética em vez de intencional, o que quebraria em banco novo e não em produção.

Crédito sem nenhuma linha de ledger fica **intocado**: segue `importada` e segue sendo refrescado.

**A carteira vai encolher visivelmente no deploy e o "a distribuir" vai cair de uma vez.** Por decisão
do Yuri, as consultas de medição (no rodapé da migração) rodam primeiro e os números vão a ele para
aprovação antes de a migração entrar.

> ⚠️ **Números medidos: pendentes.** Preencher esta seção antes do merge.

### D9 — A aba de falhas lê o `/painel`, não o `/execucoes`

`GET /recebimentos/execucoes` é `requireRole('admin')` e devolve `erp_response`/`request_payload` —
corpos crus do ERP sem redação. `/painel` não é admin-only. Pendurar a aba no endpoint mais restrito
produziria uma aba que dá 403 só para parte de quem vê a tela: o pior tipo de bug de permissão,
porque só aparece para o usuário errado. `/execucoes` continua sendo a ferramenta de auditoria
profunda do admin.

A aba busca com `?status=erro` **no servidor**, e não filtrando a lista já carregada: o painel corta
em 500 linhas por data decrescente, então uma falha antiga ficaria fora da página — e é justamente
ela que precisa de atenção. Uma tela de exceções que esconde a exceção mais velha é pior que nenhuma.

O detalhe por linha vem de `listUltimaFalhaPorTxnIds`, que seleciona `etapa`, `erro_mensagem`,
`pri_cod`, `valor`, `doc_cod`, `nd_doc_cod`, `executado_por` — e **nunca** os payloads.
`erro_mensagem` é segura por construção: `registrarFalha` grava a frase amigável do
`ErpErrorInterpreter`, nunca o 400 cru.

### D10 — Execuções INTERROMPIDAS entram na aba, com rótulo próprio

Uma linha presa em `reconciling` além de 15 minutos significa que o processo morreu entre o
`beginExecution` e o fecho. É o estado mais perigoso do sistema — pode haver `doc_cod` criado no
Conexos sem nada observando (é exatamente por isso que o handle é gravado antes do próximo POST) — e
**nada no sistema o mostrava**. Entra na aba marcado `interrompida`, separado das falhas registradas:
o gesto certo ali é conferir o ERP, não reprocessar às cegas.

**Três writers, porque o caminho normal não existe aqui.** A revisão adversarial mostrou que a aba
sozinha não bastava: ela lista créditos com `status = 'erro'`, mas um processo que morre **nunca roda
o `catch`**, logo nunca chama `registrarFalha`, logo nada escreveria `erro` — e o crédito ficaria
`importada`, invisível na única tela feita para mostrá-lo. `EXECUCAO_INTERROMPIDA_MINUTOS` viraria
código morto exatamente no caso para o qual foi escrito. Então:

1. a varredura de reconciliação escreve `erro` quando o último evento do ledger é um `reconciling`
   velho (a linha aparece na aba dentro de uma hora);
2. o backfill faz o mesmo para o histórico;
3. o curto-circuito de órfão do `checarBloqueio` — que devolve `error` **sem** passar por
   `registrarFalha` — passa a marcar a transação, para que reprocessar também torne o problema
   visível em vez de só devolver uma mensagem ao analista.

### D11 — `valorNaoAlocado` passa a subtrair o já alocado

Antes: Σ do valor de face de `importada` + `parcial`. Como nada saía de `importada`, todo crédito já
baixado no Conexos contava integralmente como "a distribuir". Com a máquina de estados viva a
distorção mudaria de lugar mas não sumiria: uma linha rotulada `parcial` na tabela apareceria no KPI
logo acima pelo valor cheio — o painel se contradizendo na mesma tela.

Agora: Σ `(valor − alocado)` sobre **todo status que não é `processada`**, e não sobre uma lista fixa.
Enumerar status faria o número cair silenciosamente assim que uma linha transicionasse.

O corte em zero é feito **por crédito, dentro do SQL** (`GREATEST(t.valor - COALESCE(s.alocado,0), 0)`),
e não subtraindo os dois totais do grupo depois. A revisão adversarial pegou a diferença: nada valida
Σ alocações ≤ valor do crédito (a regra Σ tolera `>=` de propósito, para pagamento a maior), então um
crédito sobre-alocado geraria saldo negativo que **cancelaria** o saldo aberto de outro crédito do
mesmo status — e o KPI esconderia dinheiro real a distribuir.

### D12 — `onProcessado` no diálogo de alocação

Sem esse callback, o status recém-escrito no backend não chega à tela: a linha processada ficaria na
carteira até o analista clicar "Recarregar" à mão, e a impressão seria a de que a mudança não
funcionou — exatamente o sintoma que esta ADR existe para eliminar. Dispara em `settled` **e** em
`error` (os dois mudam o status do crédito); não dispara em dry-run nem em `blocked`, onde nada foi
escrito.

## Alternativas rejeitadas

**Derivar o status do ledger em tempo de leitura** (join no `/painel`, coluna vira cache não
autoritativo). Atraente: self-healing, sem backfill, e há precedente na própria tela — o painel já
prefere o fato do ledger à previsão para a coluna de modalidade. Rejeitada porque `marcarProcessada`
só nasceu em 2026-08-10: a esmagadora maioria das linhas travadas é história anterior à marcação, não
defeito arquitetural. Pagaríamos um agregado permanente sobre uma tabela que cresce monotonicamente,
na consulta mais quente da frente, para consertar um buraco histórico que um `UPDATE` resolve. Some-se
que o Postgres é consultado direto (Supabase) — uma coluna cujo valor real mora noutro lugar é pior
que uma coluna errada, porque a incorreção passa a depender de conhecer a convenção.

**Rota `/recebimentos/falhas` nova.** Seria um alias do painel com outra authz para manter.

**Apagar `conciliada`/`manual` do enum.** Ver D4.

**Escrever `erro` no `blocked`.** Ver D3.

**Endpoint de retry.** Desnecessário: o re-POST com a mesma tripla bate na chave de idempotência e
**retoma pela etapa gravada** em vez de recriar documentos. Um endpoint próprio duplicaria as
validações de posse da SN e de filial.

## Consequências

- A carteira passa a ser uma fila de trabalho de verdade: `processada` sai dela por consequência do
  filtro default, que agora casa.
- O filtro de status vira server-side, então o histórico processado para de consumir o teto de 500
  linhas da fila.
- `parcial` passa a significar **dinheiro já baixado no ERP**, não um palpite de match — os tooltips
  foram reescritos, e a distinção precisa sobreviver ao Módulo 2 (ver `_inbox`).
- Uma corrida benigna aparece: duas alocações do mesmo crédito settlando em paralelo podem ambas ler
  a Σ antes do `markSettled` da outra e ambas decidirem `parcial`. Direção segura (o crédito fica na
  fila) e a varredura horária conserta. A alternativa livre de corrida acoplaria o
  `TransacaoRepository` à tabela do ledger numa statement só, quebrando a fronteira de porta — não
  vale o preço.
- `ndePendentes` continua fixo em 0 e a aba NDe segue vazia (Módulo 5). É o próximo KPI decorativo a
  incomodar; registrado no `_inbox` para não ser descoberto numa demo.
