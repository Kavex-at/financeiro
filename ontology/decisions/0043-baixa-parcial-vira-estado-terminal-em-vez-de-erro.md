---
adr_number: 0043
title: A baixa parcial da permuta vira estado terminal `parcial` — fail-closed antes do POST, registro honesto depois — e a reconciliação passa a serializar por adiantamento
date: 2026-09-08
status: accepted
type: change
related_entities: [Permuta]
related_actions: [reconciliarPermuta]
related_integrations: [conexos-fin010, conexos-com308]
evidence:
  - src/backend/jobs/probe-com308-cobertura.ts
  - docs/conexos-api/070-com3.json
supersedes_decisions: []
amends_decisions: [0013, 0014]
---

# ADR 0043: fail-closed enquanto é verdade, `parcial` quando deixa de ser

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Branch:**
`fix/permutas-baixa-integridade`. **Fonte:** Regis-Review `2026-09-08-1414-permutas`, riscos **R-1**
(P0, card `fault-tolerance-1`) e **R-2** (card `fault-tolerance-4`) — as duas únicas conclusões do
run com **derivação independente** (o agente `qa-fault-tolerance` e a passada manual do consolidator
chegaram às mesmas conclusões sem se falarem). **`entity_changed = true`** — a máquina de estados da
primeira escrita irreversível do sistema ganha um terminal.

## Contexto

Duas falhas na baixa do `fin010`, ambas medidas no código, ambas com **zero ocorrências conhecidas
por sorte, não por construção** (R$ 38,4 M em 137 execuções; média R$ 280 k por execução):

1. **Corrida concorrente (R-1).** `ReconciliacaoPermutaService.reconciliar` não serializa. O
   `ON CONFLICT DO UPDATE` de `beginExecution` (`PermutaExecucaoRepository.ts:236-256`) só preserva
   `settled`; dois callers em `reconciling` passam os dois, cada um cria borderô e grava baixa no
   `fin010`, e a trilha registra só o último `bor_cod`/`bxaCodSeq` (last-write-wins). O borderô
   perdedor fica invisível ao painel e só é achável varrendo `listBaixas` no ERP.
2. **Resíduo mudo (R-2).** No laço de baixa por título (`ReconciliacaoPermutaService.ts:412-440`),
   se `Σ titulos.usd < aloc.valorAlocado`, o `restanteUsd` sobra positivo e `markSettled` grava a
   execução como liquidada assim mesmo. O anti-drift (I-Write-1) protege **por título**, não pelo
   agregado. *(O gatilho concreto foi corrigido na emenda de 2026-09-08 — ver ao fim.)*

## Decisão

### 1. `reconciliar` serializa por `adiantamentoDocCod` (R-1)

Advisory lock do Postgres com chave por hash estável de 32 bits do `adiantamentoDocCod`; o caller
barrado recebe **409** (`ReconciliacaoEmAndamentoError`, retryable) e **não toca o ERP**. É a
aplicação direta do precedente já escrito no SISPAG (`RemessaService.gerarRemessa`,
`RemessaEmAndamentoError`), cujo docblock já redigiu o argumento: **o ledger write-ahead protege
contra interrupção, não contra concorrência**, e o rate-limiter é por IP, logo não alcança dois
operadores em máquinas diferentes. Nenhuma doutrina nova — paridade. Novo invariante **I-Recon-5**.

### 2. Fail-closed **antes** do primeiro POST (R-2, caso previsível)

Com os títulos da invoice já lidos e **nada ainda escrito**, se a **cobertura em aberto** for menor
que `valorAlocado − 0,005` a execução **aborta** com `AlocacaoSemCoberturaError` (422). Novo
invariante **I-Write-8a** — irmão-déficit do `AlocacaoSaldoError`, que barra o excesso.

> **A cobertura é derivada, não lida** — `Σ (titMnyValorMneg − titMnyTotPago / titFltTaxaMneg)` sobre
> os títulos ATIVOS. Somar a face (`Σ titulos.usd`, como esta seção dizia na primeira redação) foi
> **refutado por sonda em produção**: `titVldStatus` é ciclo de vida do registro, não "em aberto".
> Ver a emenda de 2026-09-08, ao fim.

### 3. Estado terminal `parcial` **depois** do primeiro POST (R-2, caso imprevisível)

Para o que 8a não alcança — título **renegociado/cancelado após a alocação**, ou lista incompleta —
a execução termina em
**`parcial`**, com `valor_residual_usd` gravado — nunca em `settled`, nunca em `error`. Novos
invariantes **I-Recon-6** (o estado) e **I-Recon-7** (a visibilidade), mais **I-Write-8b** no
contrato de escrita. `settled` passa a significar estritamente *"o alocado foi integralmente
baixado"*.

## Por que as duas coisas, e não uma

O card `fault-tolerance-4` recomendou fail-closed puro: *"Preferência: **erro** (fail-closed,
coerente com o resto do módulo)."* O card estava certo sobre o princípio e incompleto sobre o
instante. **Fail-closed é honesto ANTES do primeiro POST e desonesto DEPOIS dele** — e o
`reconciliar` atravessa os dois momentos.

**Antes:** nada foi escrito no ERP, nenhum borderô consumido. Uma trilha que diz "não executado"
está dizendo a verdade, e abortar não custa nada. Fail-closed aqui é de graça — e por isso entra
(I-Write-8a).

**Depois:** as baixas dos títulos já consumidos **foram POSTadas** e são irreversíveis por nós (o
estorno é manual, na UI do `fin010`). Gravar `error` sobre uma linha cujo dinheiro **já se moveu**
não é fail-closed: é uma **afirmação falsa no livro-razão**, e a pior das duas — porque `error`
convida ao retry, e o retry sobre uma escrita parcialmente aplicada é super-pagamento, exatamente o
perigo que o ADR-0013 existe para conter.

E a pré-checagem não cobre tudo: um título pode ser **renegociado ou cancelado depois da alocação**,
saindo do filtro `titVldStatus = 1` sem erro nenhum, ou a lista pode vir incompleta. Por isso
`parcial` continua necessário mesmo com I-Write-8a em vigor.

> **Corrigido na emenda de 2026-09-08.** Esta seção dizia que o gatilho do R-2 era "um título vivo
> baixado externamente entre a eleição e o POST". **Está errado:** esse caso já **lança erro** hoje,
> no passo 2 — `baixarTitulo` recusa em-aberto ≤ 0 (I-Recon-3) — e responde por parte das 12 falhas
> reais observadas em produção. Falha ruidosa não é resíduo silencioso.

Não é meio-termo nem concessão. É **uma regra só — I-Write-8, "a baixa consome o alocado
integralmente ou o desvio é registrado" — aplicada em dois instantes em que o estado do ERP é
diferente**, e portanto em que a resposta honesta é diferente. `parcial` não é tolerância a escrita
incompleta: é o registro fiel de uma escrita que aconteceu pela metade.

## O risco que esta decisão cria, e como ele é endereçado

Nomeado pelo Yuri no ato de decidir: **"'parcial' vira o novo silêncio se ninguém olhar."** É o risco
certo. Trocar um silêncio (`settled` mentindo) por outro (um estado que ninguém consulta) não seria
progresso.

Por isso a visibilidade é **invariante (I-Recon-7)**, não recomendação. Um terminal `parcial`
obrigatoriamente: (a) emite `BUSINESS_WARN` com adto, invoice, `borCod` e resíduo; (b) aparece com o
resíduo em `GET /permutas/adiantamentos/:docCod/execucoes`; (c) é alvo elegível do detector proativo
da trilha (card `cc-reaper-permutas`), na mesma classe de `reconciling` preso. **`parcial` é trabalho
pendente, não linha de log.**

Resolução do resíduo: **re-alocar** o par. A chave de idempotência inclui o `atualizado_em` da
alocação, então re-alocar cunha chave nova e libera o lançamento do que faltou — sem endpoint novo e
sem exceção à idempotência.

## A segunda máquina: o badge, e a armadilha que ele quase criou

A baixa `parcial` também produz borderô no `fin010`, então `status-permuta-bordero.md` precisava
responder por ela. Duas premissas iniciais foram medidas e caíram:

1. **O borderô de uma execução `parcial` nunca esteve invisível.**
   `PermutaExecucaoRepository.listComBordero:129` filtra `bor_cod IS NOT NULL` — **sem** filtro de
   status. `refreshCache` já o resgatava para `permuta_bordero`, e ele já aparecia na aba Borderôs
   como `EM CADASTRO`, que é exatamente a tela onde `finalizar`/`cancelar` acontecem. O que faltava
   era só o **badge** no painel de permutas (`statusPorAdiantamento:493` filtra `r.status !==
   'settled'`).
2. **Reusar `aguardando-finalizacao` teria criado um silêncio novo — alternativa recusada.**
   `PermutaStatus` é **um** valor por adiantamento, e o `pendente` que mantém a permuta viva é
   produzido pela **omissão** do adto no mapa. Devolver `aguardando-finalizacao` para uma execução
   `parcial` **substituiria** esse `pendente`, tirando o adiantamento da leitura de "aberto" e
   deixando o resíduo sem cobrança. Seria o defeito do R-2 **mudado de lugar**, não corrigido — e
   com o agravante de parecer resolvido.

**Decisão:** valor **distinto**, `parcial-aguardando-finalizacao` (transição **B1'**), que afirma as
duas verdades ao mesmo tempo — o borderô aguarda finalização **e** o resíduo aguarda re-alocação. A
propriedade "**não remove o adiantamento da fila de elegibilidade**" é registrada como parte da
transição, não como detalhe de UI: é precisamente a armadilha que estamos evitando. Fica escrito no
topo daquela máquina que ela é um **badge sobre o borderô e nunca um input de elegibilidade**.

**Seam nomeado:** um borderô `parcial` que é finalizado devolve `finalizado` — a máquina responde
sobre o borderô, e o borderô está concluído. O resíduo não fica sem dono: segue rastreado pelo
terminal `parcial` do ledger, pelo WARN, pelo detector, e mantém o saldo do adto em aberto. Registrado
para que ninguém o redescubra como bug.

## Correção de drift documental (sem mudança de comportamento)

`idempotencia-reconciliacao.md` afirmava `idempotency_key = "permuta:{adto}:{invoice}"` e que a
UNIQUE garantia I-Recon-1. O código sempre montou
`permuta:{adto}:{invoice}:{alocacao.atualizadoEm}` (`ReconciliacaoPermutaService.ts:161`). A UNIQUE
portanto garante *uma execução terminal por par **por versão da alocação***:

- **re-alocar** o par muda `atualizado_em`, cunha chave nova e libera relançamento — **por decisão,
  não por acidente** (e é exatamente o caminho de resolução do resíduo de `parcial`);
- **concorrência** nunca esteve coberta por ela — passa a ser barrada por I-Recon-5.

Só a ontologia muda aqui. **Revisão do comportamento de re-alocação é follow-up**, não decisão desta
ADR (registrada em `ontology/_inbox/permutas-baixa-integridade-followups.md`).

## Consequências

- **Migration `0054_permuta_execucao_parcial.sql`**: `CHECK (status IN
  ('pending','reconciling','settled','error','parcial'))` e coluna `valor_residual_usd NUMERIC`. O
  CHECK atual está em `0015_permuta_alocacao_execucao.sql:20`.
- **União `ExecucaoStatus` em dois lugares espelhados à mão**:
  `PermutaExecucaoRepository.ts:5` e `src/frontend/lib/types.ts:255`. O acoplamento fica registrado:
  um estado novo exige as duas edições, sem nada que force a paridade.
- **`PermutaStatus`** (`BorderoGestaoService.ts:21`) ganha `parcial-aguardando-finalizacao`, e o
  filtro `r.status !== 'settled'` de `statusPorAdiantamento:493` passa a aceitar os dois terminais.
- **`beginExecution` deve preservar `parcial` na CASE do `ON CONFLICT`**, junto de `settled` — o
  critério é "houve escrita irreversível sob esta chave?", e em `parcial` houve.
- **`markSettled` ganha irmão** (`markParcial`) — não é `markSettled` com um campo a mais: os dois
  terminais afirmam coisas diferentes.
- **Classes de erro novas**: `ReconciliacaoEmAndamentoError` (409, espelho do
  `RemessaEmAndamentoError`) e `AlocacaoSemCoberturaError` (422, irmão-déficit do
  `AlocacaoSaldoError`).
- **`ConexosTitulosClient`**: o `fieldList` do `com308/financeiroAPagar/list` precisará pedir `pago`,
  `titMnyTotPago` e `titFltTaxaMneg` — sem eles a cobertura de 8a não é calculável (emenda de
  2026-09-08).
- **Card `cc-reaper-permutas`** passa a ter dois alvos: `reconciling` preso **e** `parcial` não
  resolvido.
- **Runbook `docs/runbooks/fin010-write-cutover.md`** perde a linha que aceitava o resíduo silencioso
  como "follow-up de um job de conciliação".
- **Ontologia à frente do código neste ciclo.** I-Recon-5/6/7, I-Write-8a/8b e B1' estão modelados e
  **não** implementados; `_coverage.json` registra o recuo de `Permuta` de 90 para 85 de propósito,
  em vez de esconder a lacuna.

## Emenda 2026-09-08 — a forma de I-Write-8a, decidida por sonda ao vivo

> Mesma data da ADR. A decisão (as três acima) não muda; muda a **forma** de I-Write-8a, porque uma
> premissa da modelagem foi **refutada por medição** antes de virar código.

### A premissa refutada

A redação original de I-Write-8a somava `Σ titulos.usd` — a face dos títulos que o
`ConexosTitulosClient` já filtra por `titVldStatus = 1` — e tratava isso como "o que ainda está em
aberto na invoice". O swagger versionado deste repo (`docs/conexos-api/070-com3.json`, schema
`FinTituloFin`) diz outra coisa:

- `titVldStatus`: **ciclo de vida do registro** — `1 ATIVO · 2 RENEGOCIADO · 3 CANCELADO`;
- `pago`: a dimensão "em aberto" — `1 TOTALMENTE PAGO · 2 PARCIALMENTE PAGO · 3 NÃO PAGO`.

Um título **quitado** continua `ATIVO`. A soma da face sobre os ATIVOS não é cobertura; é o valor
original da invoice. Uma pré-checagem sobre esse número nasceria **sistematicamente frouxa** —
aprovando exatamente o caso que o invariante existe para recusar.

### A sonda e o que ela mediu

`src/backend/jobs/probe-com308-cobertura.ts` (read-only; endpoint único
`POST com308/financeiroAPagar/list/{docCod}`), executada em **produção** contra 20 invoices reais /
22 títulos. Re-executável: `PROBE_ALLOW_PRD=1 npx tsx jobs/probe-com308-cobertura.ts`.

1. **O mecanismo da falha está provado.** **19 das 20** invoices devolveram títulos
   `titVldStatus = 1` com face cheia e aberto **zero**. Pior caso: doc **9320** (filial 2), face
   **USD 83.476,12**, aberto **0**, devolvido como ATIVO. Somar a face teria aprovado uma cobertura
   inexistente de oitenta e três mil dólares.
2. **A saída server-side não existe.** `filterList: {'pago#NE': '1'}` responde **HTTP 500**. O ERP
   não filtra por `pago` — a opção que teria dispensado toda a aritmética foi testada e morreu.
3. **`pago` é retornável** no `fieldList` (confirmado em row real), mesmo não sendo filtrável.
4. **`titMnyTotPagoMneg` não existe** no schema — só `titMnyTotPago`, em BRL. Derivar é a única via.

### Uma objeção minha que a medição derrubou

Argumentei, ao modelar, que derivar o aberto dividindo o pago (BRL) pela taxa meteria **ruído de
arredondamento dentro de uma guarda que RECUSA** — e que uma guarda que erra por centavo barra baixa
legítima. Era o mesmo raciocínio que obrigou o teto absoluto de R$1,00 da âncora I-Write-6 a existir,
e eu o transportei por analogia.

**A medição derrubou isso.** Nos 19 casos a conta fechou em **zero exato**, não em ±centavos:
`titMnyTotPago / titFltTaxaMneg` reproduz o valor negociado com precisão. Consistente com o schema,
que declara `titFltTaxaMneg` com formato `30,12` — não é a taxa exibida a 3 casas que motivou
I-Write-6. **A suposição era minha, por analogia, e não sobreviveu ao contato com o ERP.** Fica
registrado como tal: a analogia com I-Write-6 era plausível e estava errada.

### Ressalva metodológica (não pular)

A amostra veio de `permuta_alocacao_execucao` — **invoices que nós já baixamos**, portanto
tendentes a estar pagas. Os 19/20 provam o **mecanismo** (a face mente sobre a cobertura), **não a
frequência** com que um candidato real de pré-checagem estaria quitado. **Nada aqui autoriza estimar
uma taxa esperada de disparo de 8a.**

### Truncamento: inconclusivo, e portanto rebaixado

A guarda contra lista truncada cai de **requisito** para **defensiva opcional**. Na população medida
o cenário é teórico: 1–2 títulos por invoice, 22 no total, e `count` nunca divergiu de
`rows.length`. Se implementada, o critério é `count !== rows.length` — **não** `rows.length ===
pageSize`, que é frágil (há medição no repo de o ERP impor página menor que a pedida).

### Forma decidida

```
abertoUsd(titulo) = titMnyValorMneg − (titMnyTotPago / titFltTaxaMneg)
cobertura         = Σ abertoUsd sobre os títulos ATIVOS (titVldStatus = 1)
8a dispara quando   cobertura < valorAlocado − 0,005
```

`pago` entra no `fieldList` como **corroboração, nunca como gate**: `pago === 1` com `abertoUsd`
derivado ≠ ~0 é **`BUSINESS_WARN`** (divergência de contrato do ERP), **jamais** recusa da baixa.
Dois campos do ERP discordando é problema de quem mantém o contrato — não motivo para bloquear o
trabalho da analista.

Consequência de implementação: o `fieldList` do `ConexosTitulosClient` precisará pedir `pago`, além
de `titMnyTotPago` e `titFltTaxaMneg`. Texto normativo em `fin010-write-contract.md`, I-Write-8a.

### O gatilho verdadeiro do R-2

A redação original atribuía o resíduo silencioso a "título vivo baixado externamente antes do POST".
**Corrigido:** esse caso **lança erro** hoje, no passo 2 (`baixarTitulo` recusa em-aberto ≤ 0,
I-Recon-3), e é uma das 12 falhas reais de produção. Falha ruidosa não é silêncio. O que produz
resíduo **mudo** é o título **renegociado ou cancelado após a alocação** — sai do filtro
`titVldStatus = 1` e desaparece da soma sem erro algum — ou uma **lista incompleta**.

## Fora de escopo (deliberado)

- As 5 âncoras `file:line` stale de `entities/permuta.md` (card `modifiability-9`).
- Os outros 55 cards do run `2026-09-08-1414-permutas`.
- Revisão do comportamento de re-alocação (follow-up).

## Emenda 2026-09-08 (fechamento) — a ontologia deixou de estar à frente do código

> Mesma data da ADR e da emenda acima. **A decisão não muda; muda o estado do mundo.** O bullet
> "Ontologia à frente do código neste ciclo", na lista de impacto, descrevia o instante em que esta
> ADR foi escrita e **caducou no mesmo dia**: a implementação entrou.

I-Recon-5/6/7, I-Write-8a/8b e B1' estão **no código, com teste**, na branch
`fix/permutas-baixa-integridade`: `withAdvisoryLock` + `chaveDeLock`
(`ReconciliacaoPermutaService.ts:100-153`) com teste de concorrência real; `assertCobertura` antes do
1º POST (pulada no fallback de título único, via `titulosDoErp` explícito); `markParcial` irmão de
`markSettled` e `valor_residual_usd` preservado no `ON CONFLICT`
(`PermutaExecucaoRepository.ts:287-338`); migration `0054`; badge `parcial-aguardando-finalizacao`
com ramo próprio (`src/frontend/app/permutas/components/ui.tsx:124-143`). O `_coverage.json`
**não registra mais o recuo de 90 para 85** — devolveu `Permuta.impl_pct` a 90, e
`idempotencia-reconciliacao` e `status-permuta-bordero` passaram a `implemented`.

**Duas ressalvas que sobrevivem ao fechamento:**

- **Implementado ≠ em produção.** Não há commit, PR nem release: nada disso está rodando. Quem
  diagnostica incidente confere a vigência por `GET /health` (`version`) e pelo `CHANGELOG.md` — é a
  mesma nota de vigência que o runbook `docs/runbooks/fin010-write-cutover.md` já carrega. Até a
  release, R-1 e R-2 seguem abertos em produção, com as mitigações manuais do runbook.
- **I-Recon-7 está meio-cumprido.** As pernas (a) `BUSINESS_WARN` e (b) `GET
  /permutas/adiantamentos/:docCod/execucoes` entraram; a perna (c) — `parcial` como alvo do detector
  proativo — depende do card `cc-reaper-permutas`, que **não existe** (o único reaper do repo é
  `jobs/reaper-sispag-reconciling.ts`) e ficou fora do escopo por decisão registrada. Enquanto (c)
  não existir, vale o risco que esta própria ADR nomeou: `parcial` é trabalho pendente, e quem não
  abrir a trilha do adiantamento não é avisado por ninguém.

A propriedade obrigatória de B1' — **não** remover o adiantamento da elegibilidade — foi verificada e
é satisfeita **por construção**: `ElegibilidadeService` não referencia status de execução, `parcial`
nem `statusPorAdiantamento`, e o badge chega por consulta lazy separada. Não há guarda a preservar;
há um desacoplamento a **não** desfazer.
