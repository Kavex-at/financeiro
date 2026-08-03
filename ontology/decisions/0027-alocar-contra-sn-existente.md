---
adr_number: 0027
title: Alocar contra SN existente — listar as SNs de um processo (READ com299/list) + ramo do settle (pula com299/completar; baixa fin014 + NDe contra o docCod selecionado); invariante I-Receb-3 (teto ≤ saldo do TÍTULO, sem duplicata, humano confirma); saldo NÃO vem da lista (document-level) e sim do título que a baixa já lê
date: 2026-08-03
status: accepted
type: addition
related_entities: [SolicitacaoNumerario, Recebimento]
related_actions: [listarSolicitacoesNumerario, gerarSolicitacaoNumerario]
related_integrations: [conexos-com299-gerdoc]
supersedes_decisions: []
amends_decisions: [0022, 0024, 0025]
---

# ADR 0027: alocar contra uma SN existente (listar + ramo do settle + I-Receb-3)

**Cliente:** Columbia Trading · **Entrega:** Kavex (created by Clonex) · **Branch:**
`fix/alocar-sn-select` (worktree, base `fix/erp-4xx-nao-retentavel`). **Fonte:** feature-tweak
aprovado com o usuário + HAR REAL da listagem (Columbia, 2026-08-03).
**`entity_changed = true`** — 1 ação READ nova, 1 ramo novo na ação de settle, 1 invariante novo, 1
superfície de LEITURA nova na integração com299. Nenhuma entidade nova (a `SolicitacaoNumerario` já é
first-class desde v0.11/v0.12).

## Contexto

Até aqui o botão **"Processar"** (modal "Alocar processos" em `/recebimentos`) **SEMPRE gerava uma SN
nova** (`com299/gerDocProcesso` → `completarSnAdiantamento` → `fin014` → `com297` + cauda fiscal). Não
havia como **listar** as SNs **já existentes** de um processo — o sistema só **escrevia** SNs. Na
prática, um processo pode já ter uma SN aberta (ex.: "Frete internacional", nº "26.0141") contra a qual
o crédito recebido deveria ser baixado, sem mintar um documento duplicado.

O delta aprovado: após selecionar o processo, a UI **lista as SNs existentes** (docCod, numero, data,
descricao, status, solicitado, saldo) + a opção **"Criar novo SN"**; a analista **seleciona**; e
"Processar" passa a ser **gated na seleção**. Se uma SN existente for escolhida, o settle **pula** a
geração/completação e roda `fin014` + `com297` contra o `docCod` selecionado.

## Decisões

### D1 — A SN vira LISTÁVEL/SELECIONÁVEL (nova superfície de LEITURA), não só escrita
Nova ação READ `listarSolicitacoesNumerario` (`actions/recebimentos/listar-solicitacoes-numerario.md`,
`planned` até o código pousar). A `SolicitacaoNumerario` ganha uma **projeção de leitura** (docCod,
numero, data, descricao, status, solicitado) — ela deixa de ser um documento que o sistema só escreve.
**Contrato HAR-confirmado (2026-08-03):** `POST /api/com299/list` (mesma família/host do com299 de
escrita), `filterList = { "priCod#EQ": priCod, "docVldTipo#EQ": 9, "docVldTipoAdto#EQ": 1,
"vldStatus#IN": ["1","3"] }`, ordenado `docCod` desc, paginado; envelope `{ count, pageNumber, rows[] }`.
**Discriminador SN:** `docVldTipo=9` **E** `docVldTipoAdto=1` — uma NC/ND no mesmo processo é
`docVldTipoAdto=0`, então **excluída**.

### D2 — O settle GANHA um ramo "SN existente" (não é uma ação nova, é um branch de `gerarSolicitacaoNumerario`)
"Criar novo SN" = fluxo completo inalterado (com299 gera + completa + finaliza → fin014 → com297). "SN
existente" = **pula** `com299/gerDocProcesso` **e** `completarSnAdiantamento`; referencia o `docCod`
selecionado; entra direto em `fin014` + `com297` + cauda fiscal contra ele. Modelado como **um ramo da
ação existente** (default "Action before workflow" + "existing before new"), não como ação/entidade nova.

### D3 — Invariante I-Receb-3 (`business-rules/alocacao-sn-existente.md`)
Novo invariante para o caminho existente: **(a)** valor alocado ≤ **saldo do TÍTULO** da SN; **(b)** o
caminho existente **não cria** um segundo documento (sem duplicata); **(c)** a seleção é **confirmada
pelo humano** (gate, ADR-0002/0022). Mantido **separado** de I-Receb-1 (`invariante-rateio`): I-Receb-1
limita Σ das alocações ≤ `transacao.valor`; I-Receb-3 limita **uma** alocação ≤ saldo do título da SN.
Tetos distintos, empilhados.

### D4 — O SALDO (teto do I-Receb-3) NÃO vem da lista — é DOCUMENT-level; enforcement na baixa/título
`com299/list` é **document-level**: devolve `mnyBruto` (solicitado) e `docMnyValor` (valor do doc), mas
**não** o saldo remanescente por-título — o "Saldo" do mockup. Esse saldo vem da leitura do título
(`lov/TituloBorderoReceber`) que a **baixa `fin014` já executa**. Consequência de modelagem: a lista
serve para **escolher** a SN; o **ponto de enforcement** do teto ≤ saldo é a **baixa/título**, não o
valor da lista. Registrado no invariante, na integração (open-gap `sn-list-saldo-document-level`, P1) e
na ação.

## Alternativas consideradas (rejeitadas)

- **Novo estado na state-machine `recebimento` para o caminho existente:** REJEITADO (REJECT-DUPLICATE).
  É um **ramo da transição R1** (montagem da conciliação), não um estado de ciclo de vida novo — o
  agregado continua `rascunho → aprovado → executado → estornado`. Anotado em R1.
- **Duas ações separadas (`settleContraSnExistente` × `settleCriandoSn`):** REJEITADO. Uma única ação
  `gerarSolicitacaoNumerario` com um branch parametrizado pelo `docCod` selecionado — evita duplicar
  postconditions e a idempotência.
- **Usar o valor da lista (`docMnyValor`) como saldo/teto:** REJEITADO (D4). É document-level e
  divergiria do saldo real do título; over-allocation passaria na UI e só falharia na baixa apontando
  para o lugar errado. O teto se afere no título.
- **Modelar a ordenação "Processar depois da seleção" como estado de UI:** REJEITADO (REJECT-NOT-DOMAIN).
  É a superfície da nova **precondição** (seleção existe) — modelada como precondition da ação, não como
  estado de UI.
- **Valores de exibição da SN (formato do `numero`, rótulos de status, códigos `gcdCod`):** REJEITADO na
  ontologia (REJECT-CONFIG) — instância/config do tenant. Só os campos abstratos entram.

## Consequências

- +1 ação READ (`listarSolicitacoesNumerario`, planned), +1 business-rule (`alocacao-sn-existente`,
  I-Receb-3, planned), +1 superfície de LEITURA na integração `conexos-com299-gerdoc` (direction
  write → read-write). A entidade `SolicitacaoNumerario` ganha a projeção de leitura + a relação
  N—1 `Recebimento` (settle contra existente).
- A escrita irreversível **diminui** no caminho existente: pula a geração `com299` e a completação — só
  `fin014` + `com297` correm. Menos POST irreversível quando a SN já existe.
- **Gap registrado:** `sn-list-saldo-document-level` (P1) — a lista não carrega saldo; o teto se afere
  no título via a baixa. Não é bloqueante (a baixa já lê o título).
- Contagens (Fase de índice): actions 22 → **23**; business_rules 16 → **17** (planned 8 → 9);
  integrations inalteradas em total (com299-gerdoc passa a read-write); `ontology_version` 0.13.0 →
  **0.14.0** nesta curadoria. Se um contador divergir de uma regeneração automática, esta é a fonte da
  verdade da adição.

## Universalidade

Universal em contas-a-receber de comex com encomenda: uma requisição de numerário de um processo pode
já existir — **listar e reutilizar** o documento antes de mintar um novo, respeitando o saldo que ele
ainda comporta, sem duplicar, com o humano confirmando. A **estrutura** (superfície de leitura;
existente × nova; teto ≤ saldo do título; enforcement na baixa) é do domínio; os **valores** (endpoint
`com299/list`, filtros `docVldTipo=9`/`docVldTipoAdto=1`, `gcdCod`, fonte do saldo
`lov/TituloBorderoReceber`, rótulos) são instância/config do tenant.

## Reúso / linhagem

Emenda ADR-0022 (bootstrap Frente IV), ADR-0024 (NDe fiscal com297) e ADR-0025 (ciclo de vida do título
/ sequência da SN) — não supersede nenhum. Reusa a maquinaria já implementada de
`gerarSolicitacaoNumerario` (fin014 + com297 + cauda fiscal, write-ahead, gating dry-run) e a idempotência
`sn-real:{txnId}:{priCod}:{valor}`.
