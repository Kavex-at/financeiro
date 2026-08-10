---
adr_number: 0032
title: Extrato do fin095 é escopado por CONTA, não por filial — a chave natural perde o filCod, o fan-out da ingestão deixa de ser (filial × conta) e a TransacaoBancaria do canal automático nasce CORPORATIVA (filCod nulo)
date: 2026-08-10
status: accepted
type: fix
related_entities: [TransacaoBancaria]
related_actions: [importarTransacoesExtrato]
related_integrations: [conexos-fin095-extrato]
supersedes_decisions: []
amends_decisions: [0022, 0023, 0028]
---

# ADR 0032: extrato é por conta, não por filial

**Cliente:** Columbia Trading · **Entrega:** Kavex (created by Clonex) · **Branch:**
`fix/extrato-dup-filial` (worktree, base `main`). **Fonte:** `/feature-tweak` a partir de duplicatas
observadas no painel em produção (2026-08-10).
**`entity_changed = true`** — a invariante `filCod` da `TransacaoBancaria` e a fórmula da chave
natural de `importarTransacoesExtrato` mudam. Nenhuma entidade nova.

## Contexto — o bug

O analista reportou o mesmo crédito repetido na carteira (`PRO NOVA INDUSTR`, R$ 106.781,75,
07/08/2026, cinco linhas com `correlationId` diferentes). Não era caso isolado.

A ingestão faz fan-out sobre **(filial × conta)** e a chave natural era
`fin095:{filCod}:{gerNum}:{extCod}:{exiCodSeq}` (ADR-0023). A premissa por trás disso — registrada em
`entities/transacao-bancaria.md` como *"`filCod`: filial da conta, nunca null"* — **é falsa**.

Sonda read-only em produção (`fin133/list` + `fin095/list`, 2026-08-10):

```
fin133 filCod=1 → 19 contas · com movimento = [38,138,212,213,215,246]
fin133 filCod=2 → 18 contas · com movimento = [38,138,212,213,215,246]
fin133 filCod=5 → 17 contas · com movimento = [38,138,212,213,215,246]

fin095 gerNum=38 filCod=1 → 71 lançamentos (907/1, 907/10, 907/11, …)
fin095 gerNum=38 filCod=2 → 71 lançamentos  ← idênticos
fin095 gerNum=38 filCod=5 → 71 lançamentos  ← idênticos
```

O `filCod` viaja **só como header de sessão** (`defaultHeaders`, ADR-0009). O `fin095/list` filtra
por `gerNum` + janela `exiDtaLcto` e **ignora a filial**: as contas com movimento são corporativas,
enxergadas de qualquer filial. O `fin133` até varia o total de contas visíveis por filial (19/18/17),
mas as seis que têm movimento aparecem em todas.

Como o `filCod` do *parâmetro* entrava na chave natural, cada lançamento virava **N linhas distintas**
— uma por filial configurada. Estado do banco antes da correção:

| Métrica | Valor |
|---------|-------|
| Linhas do canal `fin095` | 728 |
| Lançamentos reais (`extCod`,`exiCodSeq`,`gerNum` distintos) | **104** |
| Linhas excedentes | **624 (86%)** |
| Grupos duplicados | 104 — todos com `fil_cod = {1,2,3,4,5,6,7}` exatos |
| Soma dos valores | R$ 1.006.155.967 → real R$ 143.736.566 (**7×**) |
| `total_contas` por run | 42 = 7 filiais × 6 contas (**7× de chamadas ao ERP**) |

O canal manual (`xlsx_bradesco`, 4 linhas) **não** é afetado: lá o analista escolhe a filial no
upload e a chave já é namespaced por conteúdo.

## Decisões

### D1 — A chave natural perde o `filCod`

`fin095:{gerNum}:{extCod}:{exiCodSeq}`. Essa é a identidade real do lançamento na fonte: o extrato
pertence à conta, e `(extCod, exiCodSeq)` identifica a linha dentro dele. O `filCod` nunca foi
identidade — era o contexto de leitura vazando para dentro da chave.

Continua valendo a regra de ADR-0023: **nenhum campo mutável** na chave (`vldConciliado`, `dtaConc`,
valor), porque o ERP os atualiza ao conciliar.

### D2 — O fan-out é por CONTA, não por (filial × conta)

`resolverAlvos` deduplica os alvos por `gerNum`. Uma conta é lida **uma vez por run**, usando a
primeira filial resolvida apenas como contexto de sessão do header. Efeito colateral bem-vindo: as
chamadas ao `fin095` caem de 42 para 6 por run — o mesmo tipo de pressão de sessão que causou o
incidente `LOGIN_ERROR_MAX_SESSIONS` do SISPAG.

### D3 — `TransacaoBancaria.filCod` passa a ser OPCIONAL; `null` = conta CORPORATIVA

A invariante *"nunca null"* cai para esta entidade. Um crédito que cai numa conta corporativa **não
tem filial** no momento da ingestão — ele só ganha uma quando o analista o aloca a um processo, e
`recebimento.fil_cod` (NOT NULL) já é quem carrega essa informação, inclusive para o
`ConexosNdeEmitter`.

Carimbar uma filial arbitrária (a matriz, por exemplo) foi rejeitado: `fil_cod` é **fronteira de
autorização** em `routes/recebimentos.ts` (`filiaisPermitidas`), e um crédito carimbado como filial 1
**desapareceria silenciosamente** da carteira de um analista restrito a outra filial. Sumiço mudo de
dinheiro a conciliar é pior que ruído.

O canal `xlsx_bradesco` **mantém** `filCod` preenchido — lá a filial é escolha explícita do analista
no upload, não inferência.

### D4 — Filial deixa de filtrar a LISTAGEM; segue filtrando a AÇÃO

`buildFiltro` passa a aceitar a transação corporativa em qualquer conjunto de filiais permitidas
(`fil_cod IS NULL OR fil_cod = ANY($filCods)`). O crédito corporativo é visível para todo usuário
autorizado em qualquer filial.

A autorização por filial **não** foi enfraquecida: ela continua onde move dinheiro — `pipeline/run`,
`alocar` e a emissão da NDe validam `assertUserCanActOnFilial` contra a filial **do processo
escolhido**, que é a filial real da operação.

### D5 — As 624 duplicatas são colapsadas por migração, não truncadas

`0044` reescreve `natural_key`/`id`/`correlation_id` para a chave nova, mantém a linha **mais antiga**
de cada grupo (preserva `importado_em` e `import_run_id` originais) e apaga as demais.

Seguro na janela em que foi aplicada: `recebimento` = 0 linhas, `rateio_recebimento` = 0, todas as
transações ainda em `importada`, e a única FK (`recebimento.transacao_id`) vazia. A migração é
idempotente e **restrita a `canal IS NULL`**.

## Consequências

- O painel deixa de inflar `a distribuir` em 7×.
- A ingestão faz 6 leituras de conta por run em vez de 42.
- O dropdown de filial da aba **Transações** fica vazio para o canal automático (nenhuma transação
  tem filial). É consequência esperada de D3, não regressão: a filial passa a aparecer no momento da
  alocação, onde ela realmente existe.
- Se um dia o ERP expuser a filial do lançamento no `fin095`, ela entra como **enriquecimento**
  (coluna), nunca de volta na chave natural — reintroduzi-la duplicaria a carteira outra vez.

## Alternativas rejeitadas

| Alternativa | Por que não |
|-------------|-------------|
| Mapa `gerNum → filial dona` (env/tabela) | Conhecimento externo que o ERP não fornece e alguém teria que manter à mão; um mapa desatualizado volta a esconder crédito de quem precisa vê-lo. |
| Carimbar a matriz (`filCod = 1`) | Some silenciosamente da carteira de analistas de outras filiais (D3). |
| Só corrigir daqui pra frente | Deixaria 624 duplicatas e o KPI 7× inflado na carteira do analista. |
| Truncar o canal `fin095` e reingerir | Simples, mas descarta `importado_em`/`import_run_id` e o histórico de runs. |
