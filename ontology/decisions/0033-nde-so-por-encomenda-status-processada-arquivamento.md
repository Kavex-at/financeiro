---
adr_number: 0033
title: A Nota de Débito Eletrônica passa a ser devida em UMA única modalidade (POR ENCOMENDA) — PRÓPRIA deixa de emitir e código desconhecido BLOQUEIA; a modalidade vira campo persistido no ledger e coluna do painel (real ou prevista); TransacaoBancaria ganha o terminal `processada` e o ARQUIVAMENTO, que tira o crédito da listagem e dos KPIs
date: 2026-08-10
status: accepted
type: change
related_entities: [TransacaoBancaria, NotaDebitoEletronica, SolicitacaoNumerario]
related_actions: [gerarSolicitacaoNumerario, importarTransacoesExtrato]
related_integrations: [conexos-com299-gerdoc, conexos-nde-fiscal]
supersedes_decisions: []
amends_decisions: [0031, 0032]
---

# ADR 0033: só POR ENCOMENDA emite NDe; `processada` e arquivamento na carteira

**Cliente:** Columbia Trading · **Entrega:** Kavex (created by Clonex) · **Branch:**
`feat/recebimentos-modalidade-processada` (worktree, base `fix/extrato-dup-filial`). **Fonte:**
`/feature-tweak` com o Yuri (2026-08-10), decidido sobre medição da carteira real.
**`entity_changed = true`** — a regra de emissão da NDe muda, `TransacaoBancaria` ganha um estado e
dois campos, e a modalidade deixa de ser efêmera.

## Contexto

Quatro problemas na mesma tela, que se resolvem juntos.

### 1. A modalidade era resolvida e jogada fora

`imp021.priVldTipo` era lido no gate 0.5, decidia a NDe e **desaparecia**. Nenhuma tabela o guardava.
"Por que este recebimento fechou sem nota?" só se respondia reconsultando o `imp021` — que pode ter
mudado desde então.

### 2. `PRÓPRIA` emitia NDe por omissão

A ADR-0031 tratou explicitamente `CONTA E ORDEM` (2) e deixou `PRÓPRIA` (1) e `POR ENCOMENDA` (3) no
ramo completo. Medição da carteira real (`imp021`, 7 filiais, 5.755 processos, 2026-08-10):

| `priVldTipo` | Rótulo | Processos | Clientes |
|---|---|---|---|
| 3 | POR ENCOMENDA | 2.925 | 64 |
| 2 | CONTA E ORDEM | 2.787 | 40 |
| **1** | **PRÓPRIA** | **43 (0,7%)** | **9** |

E o cliente dominante de `PRÓPRIA` é a **própria Columbia Trading S/A** (31 dos 43). Os outros oito
são one-offs que sequer parecem processos de importação de cliente (LinkedIn Ireland, EcoVadis,
Deutsche Börse, SeaRates). Importação em nome próprio, para si: **não há terceiro a quem debitar**, e
a NDe ali é uma nota contra si mesma — irreversível, porque a homologação com297 não tem teardown.

### 3. Nada nunca tirava uma transação de `importada`

`TransacaoRepository` não tinha método de update de status e a máquina de estados
(`recebimentoTransitions.ts`) **nunca era acionada**. Por isso o painel mostrava centenas de
`importada` e zero conciliações mesmo com alocações executadas por trás. A tela mentia sobre o
próprio trabalho.

### 4. O ruído de tesouraria inflava o "a distribuir"

Resgate de aplicação, transferência entre contas, vencimento de compromissada — crédito que **nunca**
será conciliado contra processo e que o analista não tinha como tirar da frente.

## Decisões

### D1 — A NDe é devida em UMA modalidade: POR ENCOMENDA

`ndeEDevida(priVldTipo) === priVldTipo === POR_ENCOMENDA`, num ponto só
(`interface/recebimentos/constants.ts`). `PRÓPRIA` (1) e `CONTA E ORDEM` (2) quitam com SN + baixa
`fin014` e param, no terminal `quitado-sem-nde` que a ADR-0031 já criou.

Emenda a ADR-0031: onde ela dizia "processos POR CONTA E ORDEM não geram", passa a valer "só POR
ENCOMENDA gera".

### D2 — Código DESCONHECIDO bloqueia, não dispensa

A regra **não** é `!== POR_ENCOMENDA`. Um `priVldTipo` fora do mapa (`isPriVldTipoConhecido`) cai no
mesmo `BLOCKED_CADASTRO` do nulo. Implementar por negação faria um código novo do ERP quitar em
silêncio um caso que talvez devesse nota — e o princípio da ADR-0031 (D2) é **parar quando não se
sabe**, nunca adivinhar. O motivo nomeia o valor recebido.

### D3 — A modalidade vira campo, gravado na ABERTURA da execução

`solicitacao_numerario_execucao` ganha `pri_vld_tipo` e `nde_dispensada`, escritos no mesmo
`beginExecution` que abre a execução — não no settle. Gravar só no settle deixaria uma janela em que
a linha existe sem registrar por que a nota (não) vai sair, que é exatamente a pergunta da auditoria
quando a execução morre no meio.

`nde_dispensada` é gravada **junto**, e não derivada de `pri_vld_tipo` na leitura: a regra de quem
emite acabou de mudar e vai poder mudar de novo. O que aconteceu naquela execução é fato histórico;
recalcular com a regra de hoje reescreveria o passado. Uma linha já `settled` nunca tem a modalidade
reescrita (mesma guarda de `status`/`dry_run`/`executado_por`).

### D4 — A coluna do painel mostra FATO ou PREVISÃO, e nunca confunde os dois

A modalidade pertence ao **processo**, não ao crédito: um crédito do extrato só ganha uma quando é
alocado. Então a coluna tem duas fontes:

- **Fato** (`previsao: false`) — do ledger, para crédito já alocado. Sempre vence.
- **Previsão** (`previsao: true`) — pelos processos abertos do cliente que aparenta ter pago,
  reusando o índice do cache do `ProcessoProviderConexos` (sem chamada extra ao ERP por linha).

**Ambiguidade vira ausência, nunca maioria.** Cliente não determina modalidade: PERNOD RICARD tem 204
processos POR ENCOMENDA e 2 PRÓPRIA; SKECHERS tem 469 CONTA E ORDEM e 1 PRÓPRIA. A maioria acertaria
~99% e erraria justamente nos raros — que são os fiscalmente delicados. Cliente com mais de uma
modalidade, prefixo casando com mais de um cliente, ou nenhum casamento: a coluna mostra "—".

A previsão é marcada com `~` e borda tracejada. Ela **nunca** decide emissão — quem decide é o gate
0.5, no servidor, lendo o `imp021` do processo escolhido (ADR-0031 D3).

### D5 — `processada` é o terminal operacional da transação

Novo valor no enum de `TransacaoBancaria`, escrito quando o ledger da alocação settla — nos **dois**
ramos, `concluido` (com NDe) e `quitado-sem-nde` (sem). As duas são trabalho concluído para o
analista; a diferença entre elas é fiscal, e quem a carrega é a coluna de modalidade.

A escrita **não propaga falha**: quando ela roda, o dinheiro já se moveu no ERP. Derrubar a resposta
porque o status da tela não atualizou transformaria um sucesso em erro aparente e convidaria o
analista a reprocessar uma baixa que já aconteceu. Divergência vira `BUSINESS_WARN`; o ledger, que é
a fonte da verdade da execução, segue correto.

### D6 — O default da tabela é a FILA, não o histórico

O filtro nasce em `A processar` (tudo que não é `processada`). A tela é uma fila de trabalho: o que
se abre para ver é o que falta fazer. `Todas` continua a um clique.

### D7 — Arquivar tira da listagem E dos KPIs

`arquivada_em` + `arquivada_por` (timestamp e autor, não um boolean: quando um arquivamento se revela
errado, a primeira pergunta é quem). A cláusula mora no `buildFiltro` compartilhado por
list/contar/somar — um KPI e uma tabela que discordam sobre o que existe é pior que qualquer um dos
dois errado.

Não é "incluir também": ver as arquivadas é uma leitura à parte, senão o ruído que o analista acabou
de esconder volta misturado. Reversível.

Authz por filial não se aplica: desde a ADR-0032 o crédito do `fin095` é corporativo (`fil_cod`
nulo). Quem enxerga a carteira pode organizá-la.

## Consequências

- Os 43 processos `PRÓPRIA` deixam de gerar NDe. Nenhuma nota já emitida é afetada — não há teardown
  no com297, e a mudança é para frente.
- O painel para de mostrar como pendente o que já foi executado.
- O menu de 3 pontinhos é construído sobre o `Popover` do design system: o projeto não tem
  `DropdownMenu` e adicionar `@radix-ui/react-dropdown-menu` por um item de menu não se paga.
- Linhas de ledger anteriores à migration têm `pri_vld_tipo` nulo; a frase do motivo cai para a forma
  genérica ("processo que não é POR ENCOMENDA") em vez de inventar um rótulo.

## Alternativas rejeitadas

| Alternativa | Por que não |
|-------------|-------------|
| Manter `PRÓPRIA` emitindo | Deixaria a Columbia emitindo nota de débito contra si mesma em 31 processos. |
| Bloquear `PRÓPRIA` em vez de dispensar | Trataria como exceção a inspecionar o que é uma modalidade legítima e cadastrada; travaria a quitação de 43 processos sem ganho. |
| Regra por negação (`!== POR_ENCOMENDA`) | Um código novo do ERP viraria "dispensada" em silêncio (D2). |
| Prever a modalidade pela maioria dos processos do cliente | Erra exatamente nos casos raros, que são os que decidem uma nota irreversível (D4). |
| Derivar `nde_dispensada` de `pri_vld_tipo` na leitura | Reescreveria o passado a cada mudança de regra (D3). |
| Arquivar só escondendo da tabela | O "a distribuir" continuaria inflado pelo ruído — o problema que motivou a tarefa. |
