---
adr_number: 0037
title: A aba NDe do painel passa a listar de verdade — a fonte é a EXECUÇÃO (LEFT JOIN na NDe), não a tabela local, e o painel HIDRATA o estado atual no com297 a cada carga; "NDe pendente" passa a significar ciclo aberto (não emitida OU emitida sem autorização do SEFAZ)
date: 2026-08-17
status: accepted
type: change
related_entities: [NotaDebitoEletronica, SolicitacaoNumerario, TransacaoBancaria]
related_actions: [gerarSolicitacaoNumerario]
related_integrations: [conexos-nde-fiscal, conexos-com297-homologacao]
supersedes_decisions: []
amends_decisions: [0031, 0033]
---

# ADR 0037: a aba NDe lista pela execução e reconcilia o SEFAZ no com297

**Cliente:** Columbia Trading · **Entrega:** Kavex (created by Clonex) · **Branch:**
`fix/nde-painel-lista` (worktree, base `main`). **Fonte:** `/feature-tweak` com o Yuri (2026-08-17).
**`entity_changed = false`** — nenhuma coluna nova, nenhuma regra de emissão alterada. O que muda é
a **projeção de leitura** da entidade e a definição operacional de "pendente".

## Contexto

A aba NDe do painel de recebimentos estava **sempre vazia**. Não por falta de dado: o
`RecebimentosPainelService` devolvia `ndes: []` e `ndePendentes: 0` *hardcoded*, com o comentário
"Módulo 5 não existe — nenhuma NDe é emitida ainda". O comentário ficou obsoleto quando o Módulo 5
entrou: desde então toda alocação executada grava uma linha em `nota_debito_eletronica` e o
`nd_doc_cod` em `solicitacao_numerario_execucao`. A tela era o único lugar que não sabia disso.

Duas perguntas apareceram junto:

1. **Listar de onde?** A tabela `nota_debito_eletronica` só recebe linha **depois de homologar**. Uma
   cauda fiscal que morre no com300 ou no com131 deixa um documento com297 **existindo no ERP** e
   nenhuma linha local — exatamente a NDe que exige ação, e a única que ficaria invisível.
2. **Listar da onde, versão ERP?** No começo desta feature não havia endpoint de grid do com297
   mapeado — só `GET /api/com297/{docCod}`, um documento por vez. **Isso mudou no meio do ciclo:** o
   Yuri capturou o HAR de `POST /api/com297/list` (2026-08-17) e um probe read-only confirmou o
   contrato. Ver "Emenda" ao final.

## Decisão

### D1 — A fonte da aba é a EXECUÇÃO, com a NDe em LEFT JOIN

`solicitacao_numerario_execucao` dirige; `nota_debito_eletronica` entra por
`LEFT JOIN ... ON n.idempotency_key = e.idempotency_key`. Uma linha na aba significa **"existe (ou
deveria existir) um documento com297 para esta alocação"** — e é isso que o termo
`(e.nd_doc_cod IS NOT NULL OR n.id IS NOT NULL)` codifica.

Ficam **fora por definição**: execuções `dry_run` (nada foi ao ERP, logo não há documento) e as com
`nde_dispensada` (ADR-0031: `nd_doc_cod` nulo ali é "não era devida", nunca "faltou emitir").

O status da linha é derivado, não lido de um lugar só: com NDe gravada vem dela; sem NDe, execução
em `error` é `erro` e qualquer outra é `pendente`. Sem NDe local não há id local — a identidade vira
`exec:<idempotencyKey>`, prefixada para a UI nunca confundir os dois espaços de id.

### D2 — O painel HIDRATA o estado atual no com297, capado e best-effort

A autorização do SEFAZ é **assíncrona**: no instante da homologação o `vldAutorizado` ainda é `0` e o
número da NF-e em geral nem veio. O banco guarda aquele retrato. Sem reler o ERP, a aba mostraria
"aguardando SEFAZ" para sempre.

A cada carga do painel, até `PAINEL_NDE_HIDRATACAO_CAP` (20) linhas **ainda não autorizadas e com
`docCod`** são relidas via `GET com297/{docCod}`, em lotes de `FANOUT_LIMIT_RECEBIMENTOS` (4).
Quatro limites, todos deliberados:

1. **Só as não autorizadas** — uma NDe já autorizada e numerada não muda mais; reler é pagar HTTP
   por nada.
2. **Cap + lotes** — o teto de concorrência é o mesmo do fan-out da ingestão, derivado do incidente
   real `LOGIN_ERROR_MAX_SESSIONS`; um número próprio aqui reviveria o incidente.
3. **Orçamento de tempo** — `lerDocParaPolling` roda sob `runWithRetry` e o axios tem 40 s **por
   tentativa**: um documento pendurado custaria ~2 min, e os lotes em série passariam de 8 min
   segurando o GET do painel. `PAINEL_NDE_HIDRATACAO_TIMEOUT_MS` (8 s, alinhado ao
   `ERP_WRITE_TIMEOUT_MS`) corta cada leitura; `..._BUDGET_MS` (12 s) corta a fase inteira.
4. **Best-effort, mas não silencioso** — ERP fora do ar degrada para "o que o banco sabe" (doutrina
   do `enriquecerComModalidade`), e toda falha vira `logService.warn`. Degradar sem deixar rastro
   esconderia uma regressão do com297 atrás de uma tela que "funciona".

A hidratação **reconcilia** duas coisas no banco local (nada é escrito no ERP): o `numero_nde` na
NDe e o flag `nde_autorizado` no ledger — **nessa ordem**. O número não é cosmético: sem ele a linha
sairia da fila de hidratação (por já estar autorizada) e voltaria a exibir "—" na carga seguinte. E
a ordem é a garantia: **o flag é o ponto de commit**. Enquanto ele não está gravado, a linha segue
candidata; na ordem inversa, uma falha ao gravar o número deixaria a linha autorizada e sem número
para sempre.

**O número passa por um filtro.** `docEspNumero` é a *melhor aposta* para o número da NF-e e **não
está confirmado por HAR** — o único HAR observado mostra o documento com `"0"` logo após homologar.
Como a linha autorizada sai da fila, um `"0"` gravado viraria o número da nota para sempre. O guard
`numeroNdeUtilizavel()` rejeita vazio e zero; a autorização é gravada mesmo sem número, e a tela
mostra "—" em vez de um número fiscal falso.

### D3 — "NDe pendente" é ciclo aberto, não a coluna `status_emissao`

O KPI conta o que **não fechou**: não emitida **ou** emitida com o SEFAZ ainda em silêncio —
`NOT (status_emissao = 'emitida' AND nde_autorizado)`. A leitura literal da coluna contaria zero para
sempre (o service só grava `emitida`), deixando o card morto na tela.

O COUNT sai do **banco**, não da lista capada (doutrina 1 do painel), e desconta o que o próprio
request acabou de reconciliar — senão o card contaria como pendente uma NDe que a tela ao lado já
mostra autorizada.

### D4 — Emissão e autorização são colunas SEPARADAS na tela

"Aguardando SEFAZ" é o curso **normal** de uma NDe recém-emitida. Fundir os dois eventos num chip só
faria a espera parecer falha de emissão — e levaria o analista a reprocessar uma NDe perfeitamente
emitida. Para a NDe que não fechou, a tela mostra **onde parou** (`etapa`): é o que diz por onde
retomar.

## Consequências

- A aba lista **apenas as NDes emitidas pela nossa ferramenta**. Uma NDe que um analista emitiu
  direto no Conexos não aparece — não há como enumerá-las sem o grid do com297.
- Abrir o painel passa a custar até 20 `GET com297` extras quando há NDes aguardando SEFAZ, com teto
  de ~12 s de espera. É o preço de a aba refletir o ERP; cap, lotes e orçamento contêm o pior caso.
- Um `GET /recebimentos/painel` agora pode **escrever no banco local** (reconciliação). Não escreve
  no ERP e não muda nenhum estado de negócio: converge o que o poll pós-homologação não pôde esperar.
  É uma violação consciente de *safe method*; o caminho de saída (mover a reconciliação para um job
  dedicado) está registrado como card no Regis-Review desta feature.
- Migration **0046** (aditiva, só um índice parcial) — sem ela as duas queries da aba fazem seq scan
  em `solicitacao_numerario_execucao`, que só tinha índice em `pri_cod`, `status` e `txn_id`.

## O que o Regis-Review mudou nesta decisão

O gate rodou sobre a implementação e **alterou o desenho** em cinco pontos, todos já no código:
prazo por leitura + orçamento da fase (o pior caso medido era ~8 min segurando o painel); lote 5 → 4
para respeitar o teto de concorrência do módulo; inversão da ordem de escrita para dar um ponto de
commit à reconciliação; o guard do `docEspNumero`; e o `LogService`, que faltava por inteiro no
serviço. Relatório completo em `docs/regis-review/2026-08-17-1402/`.

## Gap deixado aberto

**Listar as NDes que existem no Conexos e não passaram por nós** exige mapear o endpoint de
grid/pesquisa do `com297` — captura de HAR da tela de Fiscais de Saída, como foi feito para o
`fin095` do extrato. Registrado em `ontology/_inbox/nde-painel-lista-gap.md`.

## Alternativas descartadas

- **Listar só `nota_debito_eletronica`.** Menor e mais simples, mas esconde justamente a NDe que
  morreu no meio da cauda fiscal — a única linha da aba que pede ação humana.
- **Hidratar só sob demanda (botão por linha).** Painel mais barato, porém o estado default da tela
  seria permanentemente desatualizado num fluxo cuja conclusão é assíncrona por natureza.
- **Contar pendentes pela coluna `status_emissao`.** Fiel ao nome da coluna e inútil na prática: o
  contador ficaria em zero para sempre.


## Emenda (2026-08-17, mesmo ciclo) — o grid do com297 apareceu

O `POST /api/com297/list` foi capturado por HAR e confirmado por probe read-only
(`jobs/probe-com297-list.ts`, PRD). Três consequências, todas já no código:

### E1 — A hidratação virou 1 POST por filial

O grid projeta `vldAutorizado` e `docEspNumero` de toda a família NDe de uma vez. Os até 20
`GET com297/{docCod}` por carga (D2 acima) saíram: `ConexosNdeFiscalClient.listNdes` faz UMA leitura
por filial, com o mesmo prazo e o mesmo orçamento de fase. O fan-out passou a ser por filial,
limitado a `FANOUT_LIMIT_RECEBIMENTOS`.

### E2 — O filtro é por CÓDIGO, não por nome

O HAR filtrava `tpdDesNome#LIKE:"NOTA DE DEBITO ELETRÔNICA"` — o **nome** do tipo de documento. O
probe descobriu o código (`tpdCod = 167`) e **provou a equivalência**: mesmo `count`, nenhum outro
`tpdDesNome` no resultado, estável entre as filiais 2 e 4. Filtramos pelo código porque:

- nome de cadastro é editável, e este módulo já pagou por isso duas vezes (a env
  `COM297_GCD_NOTA_DEBITO` existe como escape do `NDE_CONFIG_NOME`, e há ADR dedicado a tirar o `gcd`
  da SN do nome);
- `#LIKE` sobre string acentuada (`Ô`) falha em silêncio se a normalização Unicode divergir — **zero
  linhas, sem erro**, indistinguível de "não há NDe". Era exatamente o bug que esta feature veio
  consertar, entrando por outra porta.

O `docVldTipo` do documento é **7** — NÃO confundir com `NDE_GLOBAL_DOC_VLD_TIPO = 0`, que é o
`globalDocVldTipo` do ConfigDocProcesso. Trocar um pelo outro já fez o ERP rejeitar a config 248.

### E3 — As NDes emitidas FORA da ferramenta passam a aparecer

Era o gap `integrability-4`. Uma linha do grid sem execução nossa é uma nota fiscal real que a
ferramenta não emitiu, e esconder isso do analista seria pior que mostrá-la incompleta. A projeção
ganhou `origem: 'ferramenta' | 'erp'`:

- `'ferramenta'` — tem `correlationId`, `etapa`, transação bancária, rastro completo;
- `'erp'` — não tem NADA disso, e a tela **diz isso** (chip "fora da ferramenta"). A identidade dela
  é **cliente + processo** (`dpeNomPessoa`, `priEspRefcliente`), que o grid fornece.

`correlationId`, `recebimentoId` e `idempotencyKey` viraram opcionais no `NdePainelRow` — a alternativa
seria preencher com placeholder, o que é mentira em um campo de rastro.

**KPI:** as externas não autorizadas entram em `ndePendentes`. O `COUNT` do banco não as conhece (não
há linha nossa), e o grid não é uma página — é a família inteira da filial —, então somá-las em
memória é exato, não estimativa.

### O que a emenda NÃO mudou

A fonte da lista continua sendo a **execução** (D1): é ela que traz `etapa` e o diagnóstico da NDe que
não saiu. O grid entra como enriquecimento e como segunda fonte, não como substituto. E o guard do
`docEspNumero` continua — migrou para o boundary do client, onde o dado entra.