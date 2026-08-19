# Frente V — Workflow de Aprovação · Rascunho de proposta de ontologia

> **Status:** rascunho do `OntologyCurator` (Onda 0, item S3). **Não é diff aprovado.** Nenhum arquivo
> da ontologia foi escrito — tudo abaixo é conteúdo pronto para virar arquivo quando o Yuri aprovar.
> **Data:** 2026-08-19.
> **Fontes de verdade usadas:** `frente-v-probe-resultado.md` (fatos CONFIRMADOS contra produção —
> **vence** onde divergir), `frente-v-aprovacoes-conexos-spike.md` (análise estática, parcialmente
> corrigida), `frente-v-orquestracao.md` (escopo, contrato de fronteira v0, riscos).
> **Escopo travado (Yuri):** somente **Contas a Pagar** (`docTip=2`), somente **leitura/track**
> (zero escrita no ERP), histórico **materializado no nosso Postgres** por job de ingestão.
> **Fase 2** (analítico por fornecedor / cliente final / funcionário) está **FORA de escopo**, mas o
> modelo abaixo a suporta sem reescrita — a disciplina que garante isso está marcada `[FASE-2]`.

---

## Índice

1. [O formato aprendido — seções obrigatórias por tipo de artefato](#1-o-formato-aprendido)
2. [Análise de candidatos (filtros A→E)](#2-análise-de-candidatos)
3. [O delta completo, em conteúdo pronto](#3-o-delta-completo)
4. [Trade-offs que precisam da decisão do Yuri](#4-trade-offs-que-precisam-da-decisão-do-yuri)
5. [PENDENTE DE VALIDAÇÃO COM O TIME DA COLUMBIA](#5-pendente-de-validação-com-o-time-da-columbia)

---

## 1. O formato aprendido

Levantado lendo `entities/recebimento.md`, `entities/titulo-a-pagar.md`, `entities/lote-pagamento.md`,
`actions/recebimentos/{importar-transacoes-extrato,atribuir-baixa,listar-solicitacoes-numerario}.md`,
`actions/expor-no-painel.md`, `state-machines/{recebimento,lote-pagamento}.md`,
`business-rules/{idempotencia-quitacao-nde,aging-anchor}.md`,
`integrations/conexos-fin095-extrato.md`, `glossary.md`, `relationships.md`, `_index.json`,
`_coverage.json`, `decisions/0022-*.md` e `decisions/0037-*.md`.

### 1.1 Entidade (`ontology/entities/<kebab>.md`)

**Frontmatter obrigatório:**
`name` (PascalCase) · `type: entity` · `ontology_version` · `implementation_status`
(`implemented|partial|planned`) · `status` (`draft|stable|deprecated`) · `owners` · `related_files`
(lista de caminhos de código; `[]` quando `planned`) · `properties` (lista de nomes) ·
`relationships` (lista de frases `"A N—1 B (via chave — motivo)"`) · `last_review` (YYYY-MM-DD) ·
`universality_evidence` (lista de fontes concretas — **vazio = a entidade não deveria existir**).

**Corpo obrigatório (ordem observada):**
1. `# Nome (subtítulo que diz o papel)` — H1.
2. **Blockquote de abertura** com o *pitch* de uma frase, marcação de fase (`SKELETON`, `Vigência`,
   `PERSISTIDA`…) e ponteiros para state-machine/ações.
3. `## Definição de domínio` — o que é em linguagem de negócio (P1).
4. `## Propriedades` — **tabela** `| Propriedade | Tipo | Origem (wire/coluna) | Notas |`.
5. `## Invariantes aplicáveis` — lista com link para cada `business-rules/*.md`.
6. `## Fonte e persistência` (ou equivalente) — de onde lê, onde grava, o que **não** escreve.
7. `## Distinção — X × Y` — desambiguação explícita contra entidades vizinhas (quando houver risco
   de confusão). Padrão forte no repo (`Recebimento` × `LotePagamento`, `CreditoCliente` ×
   `Adiantamento`).
8. `## Fora de escopo (fatia/fase)` — o que deliberadamente **não** está modelado ainda.

### 1.2 Ação (`ontology/actions/<familia>/<kebab>.md`)

**Frontmatter obrigatório:**
`name` (camelCase) · `type: action` · `entity` · `ontology_version` · `implementation_status` ·
`status` · `owners` · `related_files` · `last_review` · `preconditions` (lista) · `postconditions`
(lista) · `side_effects` (lista). Opcional e usado: `resolved-by` (perguntas P0 que a ação fechou).

**Corpo obrigatório:**
1. `# nomeDaAcao — frase que diz o que faz (Módulo/Etapa N)`.
2. Blockquote de abertura com o resumo + ponteiros (entidade, state-machine, integração).
3. `## Gatilhos` — tabela `| Gatilho | Caminho | triggered_by |` quando houver mais de um.
4. `## Fluxo` — passos numerados.
5. `## Idempotência / dedup` — quando a ação escreve.
6. `## Contrato de leitura`/`## Cadência e resiliência` — conforme o tipo.
7. **`## Por que está na ontologia (universalidade)`** — seção presente em quase toda ação recente;
   separa explicitamente **estrutura (domínio)** de **valores (config do tenant)**.
8. `## Débito conhecido` / `## Fora de escopo`.

### 1.3 State machine (`ontology/state-machines/<kebab>.md`)

**Frontmatter obrigatório:** `name` · `type: state-machine` · `entity` · `ontology_version` ·
`implementation_status` · `status` · `owners` · `related_files` · `last_review` · `states` (lista) ·
`out_of_scope_states` (lista — pode ser `[]`).

**Corpo obrigatório:**
1. `# Ciclo de vida — \`Entidade\` (contexto)`.
2. Blockquote com **vigência datada** de cada revisão + ADR que a motivou.
3. `## Estados (constantes tipadas)` — tabela `| Constante | Valor | Significado |` **seguida da
   linha do tipo TS** (`type X = 'A' | 'B'`) e da nota "constantes tipadas — nunca strings cruas
   (P3)".
4. `## Transições` — tabela `| # | De → Para | Ação (gatilho) | Regra | Vigência |`. **Cada transição
   tem um id (`L1`, `R1`…), uma ação nomeada, uma regra explícita e uma data de vigência.** Isto é o
   princípio P3 materializado.
5. **Diagrama ASCII** do fluxo.
6. `## Decisões de modelagem (ADR-XXXX)` — incluindo alternativas descartadas.
7. `## Relação com o ERP` — se o estado é local ou espelhado.

### 1.4 Business rule (`ontology/business-rules/<kebab>.md`)

**Frontmatter obrigatório:** `name` · `type: business-rule` · `entity` · `ontology_version` ·
`implementation_status` · `status` · `owners` · `invariant` (id curto, ex. `I-Receb-2`) ·
`related_files` · `last_review` · `has_canonical_test` (bool). Opcional: `resolved-by`.

**Corpo obrigatório:**
1. `# Regra: <slug> (frase do invariante)`.
2. Blockquote com o **enunciado do invariante em uma frase**, em negrito.
3. `## Regra canônica` — pseudocódigo ou fórmula quando aplicável.
4. `## Impacto` — o que muda na tela/no job se a regra valer.
5. **`## Teste canônico (a escrever no TDD)`** — casos concretos; espelha `has_canonical_test`.
6. `## Universalidade` — por que é domínio e não config.

### 1.5 Integração (`ontology/integrations/<sistema>-<superficie>.md`)

**Frontmatter obrigatório:** `name` · `type: integration` · `system` · `ontology_version` ·
`implementation_status` · `status` · `owners` · `direction` (`read|write|read+write`) ·
`related_files` · `endpoints_read` (lista `"servico/rota — o que devolve"`) e/ou `endpoints_write` ·
`related_decisions` (lista de números de ADR).

**Corpo obrigatório:**
1. `## O que esta integração faz`.
2. `## A cadeia` — bloco de código com o encadeamento das chamadas.
3. `## Campos que importam` — tabela `| Campo wire | Vira | Nota |`.
4. `## Filtros obrigatórios` / armadilhas descobertas ao vivo.
5. `## Volume medido` (quando houver probe).
6. `## O que NÃO está aqui` — endpoints vizinhos que **não** servem, com o motivo.
7. `## Limitação operacional` / `⚠ Débito ABERTO`.

### 1.6 ADR (`ontology/decisions/NNNN-<kebab>.md`)

**Frontmatter obrigatório:** `adr_number` · `title` (frase longa, descreve a decisão inteira) ·
`date` · `status` (`accepted|superseded|deprecated`) · `type`
(`addition|change|rejection|naming`) · `related_entities`. Usados também: `related_actions`,
`related_integrations`, `supersedes_decisions`, `amends_decisions`.

**Corpo obrigatório:** `# ADR NNNN: título curto` → linha de metadados (Cliente / Entrega / Branch /
Relacionado / Fonte / `entity_changed`) → `## Contexto` → `## Escopo` → `## Decisões` (D1, D2, …
cada uma com **alternativa rejeitada**) → `## Consequências` → `## Universalidade` →
`## Índice / coverage a regenerar` (contadores antes → depois) → `## Reúso / linhagem`.

### 1.7 Artefatos gerados

- `_index.json` — `entities` / `actions` / `business_rules` / `state_machines` / `integrations` /
  `ui_flows` / `workflows`; cada entrada tem `file`, `status`, `impl_files[]`, e opcionalmente
  `entity`, `resolved_by[]`, `open_gap[]`, `note`.
- `_coverage.json` — `_meta` (com `note` narrativa da última mudança), `summary` (contadores),
  `by_entity`, `by_business_rule`, `health_flags` (incl. `watchlist[]`).
- `relationships.md` — uma seção por frente, tabela
  `| Origem | Relação | Destino | Cardinalidade |`.
- `glossary.md` — uma seção por frente, tabela `| Termo | Definição |`, com desambiguação explícita
  contra termos homônimos de outras frentes.
- `CHANGELOG.md` — entrada `## vX.Y.0 — título (data, ADR-NNNN)` com bullets do que entrou.

---

## 2. Análise de candidatos

Cada candidato passou pelos filtros **A** (universalidade), **B** (ontologia × config), **C**
(permanência), **D** (já modelado?), **E** (ação × estado).

> ⚠️ **Nota honesta de universalidade.** A Frente V foi observada em **um único cliente**
> (Columbia) e em **um único ERP** (Conexos). O argumento de universalidade aqui **não** é
> "apareceu em 2+ clientes" — é: (i) o mecanismo é **feature de produto do Conexos**
> (`FinTituloBloq` está declarado em quatro famílias de schema: `fin0`, `fin1`, `com3`, `psq0`), não
> uma customização da Columbia; e (ii) "todo título acima de um limite passa por uma cadeia de
> aprovações nomeada, com responsável e carimbo de hora, e o controller quer saber onde ela parou" é
> pergunta padrão de contas a pagar. Onde esse argumento **não** se sustenta, o candidato foi
> rebaixado para config ou rejeitado — está marcado abaixo.

### 2.1 Aceitos

| # | Candidato | A | B | C | D | E | Decisão |
|---|---|---|---|---|---|---|---|
| 1 | Entidade `TrilhaAprovacao` (raiz por título) | Y (mecanismo do ERP + conceito de CAP) | ontologia | Y | novo | substantivo | **ACCEPT** |
| 2 | Entidade `EtapaAprovacao` (instância de bloqueio) | Y | ontologia | Y | novo | substantivo com identidade própria (`fblCod`+`ftbCod`) e ciclo de vida | **ACCEPT** (com trade-off T1 no §4) |
| 3 | Entidade `EventoAprovacao` (log append-only) | Y | ontologia | Y | novo | substantivo (o evento observado é o fato durável) | **ACCEPT** |
| 4 | Ação `ingerirTrilhaAprovacao` | Y | ontologia | Y | novo | verbo | **ACCEPT** |
| 5 | Ação `exporPainelAprovacoes` | Y | ontologia | Y | novo | verbo | **ACCEPT** |
| 6 | Ação `detalharTrilhaAprovacao` | Y | ontologia | Y | novo | verbo | **ACCEPT** |
| 7 | State machine do **status de aprovação do título** | Y | ontologia | novo | — | estado | **ACCEPT** |
| 8 | State machine do **status de uma etapa** | Y | ontologia | novo | — | estado | **ACCEPT** |
| 9 | Regra `duracao-etapa-aprovacao` (I-Aprov-1) | Y | ontologia (a fórmula) / config (fuso, SLA) | Y | novo | — | **ACCEPT** |
| 10 | Regra `sem-workflow-vs-indeterminado` (I-Aprov-2) | Y | ontologia | Y | novo | — | **ACCEPT** |
| 11 | Regra `idempotencia-ingestao-trilha` (I-Aprov-3) | Y | ontologia | Y | espelha `idempotencia-quitacao-nde` mas é outro objeto | — | **ACCEPT** |
| 12 | Regra `trilha-regerada` (I-Aprov-4) | Y | ontologia | Y | novo | — | **ACCEPT** |
| 13 | Regra `origem-erp-vs-derivado` (I-Aprov-5) | Y | ontologia | Y | novo | — | **ACCEPT** |
| 14 | Regra `filcod-da-trilha` (I-Aprov-6) | Y | ontologia | Y | novo | — | **ACCEPT** (ver nota) |
| 15 | Integração `conexos-fin026-fin103-aprovacao` | Y | ontologia (a superfície) | Y | novo | — | **ACCEPT** |
| 16 | **Correção** em `entities/titulo-a-pagar.md`: `aprovado` **não** deriva de `titVld1/2/3libera` | Y | ontologia | Y | **já modelado — e errado** | — | **ACCEPT** (correção, não adição) |
| 17 | Relação `TituloAPagar 0..1 TrilhaAprovacao` | Y | ontologia | Y | novo | — | **ACCEPT** |

> **Nota sobre o #14.** `filcod-da-trilha` parece "detalhe de integração", o que normalmente seria
> REJECT-NOT-DOMAIN. Está aceita como **business rule** porque o efeito é **semântico, não técnico**:
> a consulta com `filCod` errado devolve `count: 0` sem erro, e o sistema classificaria o título como
> **SEM_WORKFLOW** — uma afirmação de negócio falsa, indistinguível de uma verdadeira. É o mesmo tipo
> de armadilha que o ADR-0037/E2 registrou para o `#LIKE` acentuado do `com297` ("zero linhas, sem
> erro"), e lá também virou regra e não nota de rodapé.

### 2.2 Rejeitados

| # | Candidato | Filtro que reprovou | Decisão |
|---|---|---|---|
| 18 | Estender `TituloAPagar` com as propriedades de aprovação | D + B — universos e ciclos de vida **diferentes** (ver §3.0) | **REJECT-DUPLICATE (por extensão errada)** → nova raiz `TrilhaAprovacao` + relação |
| 19 | Entidade nova `TituloEmAprovacao` / `DocumentoAPagarV` | D — duplicaria o conceito de título | **REJECT-DUPLICATE** → o cabeçalho vive como **snapshot** dentro de `TrilhaAprovacao` |
| 20 | Modelar a **escada `titVld1/2/3Libera`** como trilha de 3 níveis | A/C — o probe provou que é **vestigial** (vale `1` em 100% dos títulos, sem timestamps, sem nomes) | **REJECT-WORKAROUND** (era leitura errada do spec estático) — vira **nota de advertência** na integração + correção no `titulo-a-pagar.md` |
| 21 | Entidade `Aprovador` / `Pessoa` | B + C — hoje a identidade é o **nome** (`usnDesNomeCmd`); `usnCodCmd` não vem na projeção. Uma entidade com chave instável apodrece | **REJECT-PREMATURE** → watchlist; promover quando o `fin103` liberar `usnCodCmd` |
| 22 | Entidades `Alcada` / `Bloqueio` (cadastro `FinBloq`, `FinBloqAlca`, `FinBloqHier`) | A/E + escopo — é **configuração do ERP**, e a Frente V é track, não motor de alçada | **REJECT-PREMATURE** → watchlist (necessário só se quisermos exibir "quantas etapas ainda faltam") |
| 23 | Os 11 nomes de etapa (`CONTROLLER`, `TI`, `WALTER`, `DIRETORIA II`…) | B — universal em forma, específico em valor | **REJECT-CONFIG** → cadastro do tenant, lido do ERP; a ontologia modela `nomeEtapa: string`, não o enum |
| 24 | Os 14 aprovadores nominais | B | **REJECT-CONFIG** |
| 25 | O vocabulário `LIBERAR` / `APROVAR` como **enum fechado** da ontologia | B + PENDENTE V2 — são valores de `fbaDesNome`, cadastro por bloqueio (`FinBloqCmd`) | **REJECT-CONFIG** → propriedade `acao: string` + mapeamento `acaoClasse` configurável |
| 26 | O mapa `ftbVldStatus 1/2/7 → enum` como constante de domínio | B — é legenda de **versão do ERP**, não regra de negócio | **REJECT-CONFIG** → tabela de mapeamento por tenant; o **valor cru é sempre preservado** na entidade |
| 27 | "DANILO_LARA é o gargalo (48% das etapas)" | C/E — é **achado de diagnóstico**, não modelo | **REJECT-NOT-DOMAIN** → fica no probe e no relatório ao cliente |
| 28 | "Mediana 2,5 h / p90 70 h / máx 234 h" como metas/SLA | C + PENDENTE V13 — número medido numa amostra não-aleatória | **REJECT-CONFIG** (quando virar SLA) / **REJECT-NOT-DOMAIN** (como está) |
| 29 | Entidade/ação para `aplicarComando`, `trocaBloqueio`, `bloqueioManual`, `regerarBloqueios` (escrita) | Escopo D2 (Yuri): **zero escrita no ERP** | **REJECT-VOLATILE** (fora de escopo) — `regerarBloqueios` entra **apenas** como fenômeno observado (I-Aprov-4), nunca como ação nossa |
| 30 | Entidade `Filial` própria | D — `filCod` já é invariante transversal em todas as frentes | **REJECT-DUPLICATE** |
| 31 | Workflow (`ontology/workflows/`) "processarAprovacoesDiarias" | E + Part 11.5 — é **uma** ação de ingestão em cron, não uma composição | **REJECT-PREMATURE** |
| 32 | Ação `exportarAprovacoes` (CSV/Excel) | D — já existe `ui-flows/relatorios-export.md` | **REJECT-DUPLICATE** → estender o ui-flow existente se a exportação for pedida |
| 33 | Modelar "Fase 2 — analítico por fornecedor/funcionário" agora | C + escopo | **REJECT-PREMATURE** → suportado por **materialização de dimensões** no `EventoAprovacao`, não por entidade nova |
| 34 | Entidade `SnapshotIngestao` própria | D — o repo já tem o padrão `*_ingestao_run` (`pagamento_ingestao_run`) documentado dentro da entidade que ele alimenta | **REJECT-DUPLICATE** → `IngestaoTrilhaRun` documentada **dentro** de `entities/trilha-aprovacao.md`, como `ItemLote` vive dentro de `lote-pagamento.md` |

### 2.3 `NEEDS-FRANCINEI` / precisa de resposta humana antes de virar verdade

Nenhum candidato está **bloqueado** — todos entram como `planned` com premissa declarada. Mas
**seis pontos do modelo mudam de forma** conforme a resposta da Columbia. Estão no §5, com premissa
e impacto, e replicados no arquivo do ADR como riscos abertos.

---

## 3. O delta completo

### 3.0 A decisão de fundo: estender `TituloAPagar` ou criar raiz nova?

**Decisão proposta: criar `TrilhaAprovacao` como raiz nova; `TituloAPagar` ganha apenas uma relação
`0..1` e uma correção de texto.**

Quatro razões, todas verificáveis nos arquivos atuais:

1. **Universos diferentes.** `TituloAPagar` é a **carteira corrente** ingerida do `fin064`/`com298`,
   com janela de painel (−15d..+45d) e **anti-fantasma** (`ativo=false` quando o título some da run).
   A Frente V precisa do **histórico** — o universo é `psq014/list` (23.632 títulos só na filial 2), e
   o doc 4156 é a prova de que existe no `psq014` e **não** aparece no `fin026`. Pendurar a trilha na
   carteira corrente perderia exatamente os títulos que já foram liberados — que são a maioria do
   dado (49,3% de trilha na amostra).
2. **Filtros incompatíveis.** `TituloAPagar` **exclui internacional na ingestão** (ADR-0021,
   `ufEspSigla='EX'` como filtro-out). Nada indica que o workflow de aprovação exclua títulos de
   exterior — se excluirmos, o painel mente por omissão; se não excluirmos, quebramos o invariante da
   Frente II.
3. **Ciclo de vida diferente.** O `ativo=false` da Frente II faria uma trilha histórica **sumir do
   painel** da Frente V. O extrato da Frente IV já enfrentou isso e resolveu do mesmo jeito: **sem
   anti-fantasma**, porque "inativar por ausência mascararia falha de leitura como conciliação"
   (`actions/recebimentos/importar-transacoes-extrato.md`). Aqui: mascararia falha de leitura como
   "sem workflow".
4. **Acoplamento perverso.** Frente II e Frente V rodariam crons distintos escrevendo na mesma tabela
   com regras opostas de retenção. É o tipo de acoplamento que o repo evita com **contêiner por
   frente** (`domain/recebimentosContainer.ts`).

**Alternativa considerada e rejeitada:** uma tabela `titulo_a_pagar` unificada com `origem_frente`.
Rejeitada por 1–4 acima; e porque promover config a estrutura compartilhada é barato de fazer e caro
de desfazer (Part 11.2).

**Consequência prática:** a `TrilhaAprovacao` guarda um **snapshot do cabeçalho do título**
(fornecedor, valor, vencimento, emissão) lido do `psq014`. Isso **não** é uma segunda entidade
`Titulo` — é a mesma doutrina do `ItemLote`, que congela `credor`/`valor`/`vencimento` no momento da
inclusão ("preservando o que a analista viu"). Aqui preserva **o que o painel mostrou naquele
snapshot**.

---


### 3.1 `ontology/entities/trilha-aprovacao.md` — NOVO

````markdown
---
name: TrilhaAprovacao
type: entity
ontology_version: "0.20"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
properties:
  - id
  - filCod
  - docTip
  - docCod
  - titCod
  - documentoNumero
  - fornecedorNome
  - fornecedorCod
  - clienteFinalCod
  - clienteFinalNome
  - valor
  - moeda
  - dataEmissao
  - dataVencimento
  - dataFinalizacao
  - statusAprovacao
  - etapasConhecidas
  - etapasConcluidas
  - etapaAtualFblCod
  - etapaAtualFtbCod
  - tempoTotalDecorridoSegundos
  - wffUuid
  - lacunas
  - snapshotHash
  - snapshotEm
  - ingestaoRunId
relationships:
  - "TrilhaAprovacao 1—N EtapaAprovacao (agregado — as etapas de bloqueio do título, chave fblCod:ftbCod)"
  - "TrilhaAprovacao 1—N EventoAprovacao (log append-only do que foi observado sobre esta trilha)"
  - "TrilhaAprovacao 0..1—1 TituloAPagar (via filCod:docCod:titCod — MESMO título do ERP; NÃO é FK: o universo da trilha (psq014, histórico) é MAIOR que a carteira SISPAG (fin064, corrente + filtro-out internacional))"
  - "TrilhaAprovacao N—1 Filial (via filCod — invariante multi-filial; NUNCA de default, ver I-Aprov-6)"
last_review: 2026-08-19
universality_evidence:
  - "ontology/_inbox/frente-v-probe-resultado.md §2 — produção, filial 2, amostra de 300 títulos a pagar: 148 (49,3%) têm trilha de aprovação; 177 etapas; 11 etapas distintas; 14 aprovadores; mediana 2,5 h, p90 70 h, máximo 234 h"
  - "ontology/_inbox/frente-v-probe-resultado.md §3 — contrato de leitura confirmado em produção: psq014/list (universo) + fin026/infoTitulo/list (trilha), com etapa, alçada, ação, pessoa e timestamps com hora"
  - "ontology/_inbox/frente-v-aprovacoes-conexos-spike.md §1.2 — FinTituloBloq é a instância de uma etapa de aprovação sobre um título; o schema é declarado em QUATRO famílias do Conexos (090-fin0, 100-fin1, 070-com3, 190-psq0), ou seja, é feature de produto do ERP e não customização deste cliente"
  - "ontology/_inbox/frente-v-orquestracao.md §1 — o pedido do cliente é auditável por título: quando o documento foi finalizado, quem recebeu cada etapa e quando, quem respondeu e quando, quanto tempo levou, e o status agregado"
  - "Conceito universal de contas a pagar: um título acima de um limite passa por uma cadeia nomeada de aprovações, com responsável e carimbo de hora; medir onde ela parou é a pergunta padrão do controller. Os NOMES das etapas, as pessoas e os limites são config do cliente"
---

# TrilhaAprovacao (a trilha de aprovação de UM título a pagar — Frente V)

> **PLANNED (Onda 1).** Uma `TrilhaAprovacao` é o **agregado de rastreamento** do workflow de
> aprovação de **um título a pagar** do ERP Conexos: as etapas por que ele passou (ou não passou),
> quem respondeu cada uma, quando, e o **status agregado** resultante. É um agregado **LOCAL
> persistido** — um **snapshot materializado** do que o ERP mostrava, mais o **log de eventos**
> derivado da comparação entre snapshots. **ZERO escrita no ERP** (decisão D2 da orquestração).
> Ciclo de vida do status agregado em `state-machines/aprovacao-titulo.md`; ciclo de vida de cada
> etapa em `state-machines/etapa-aprovacao.md`.

## Definição de domínio

O workflow de aprovação da Columbia **não é um módulo "workflow"** no Conexos — é implementado como
**bloqueio de título por alçada**: uma regra cria um *bloqueio* nomeado sobre o título (`CONTROLLER`,
`FISCAL`, `DIRETORIA II`…), alguém com a alçada correspondente aplica um *comando* (`LIBERAR`,
`APROVAR`), e o título anda. A `TrilhaAprovacao` é a leitura de negócio disso: **a fila de bloqueios
de um título, lida como uma trilha de aprovação com relógio.**

A entidade existe para responder, com precisão auditável e por título:

- **Existe workflow?** (`SEM_WORKFLOW` é uma resposta legítima — 50,7% da amostra)
- **Onde parou?** (etapa atual, desde quando, há quanto tempo)
- **Quem respondeu o quê e quando?** (pessoa + ação + carimbo com hora)
- **Quanto tempo levou cada etapa e o total?**

## Por que é um agregado LOCAL (e não um read-through do ERP)

Três razões, todas do escopo travado (decisão D3 da orquestração):

1. **Duração exige série temporal.** Mesmo que hoje o ERP entregue `ftbTimBloq`/`ftbTimCmd`, o
   *aging* de uma etapa pendente e a detecção de **trilha regerada** só existem comparando
   snapshots.
2. **Custo.** Sem acesso ao `fin103`, a trilha custa **1 chamada por título** (23.632 títulos só na
   filial 2, 12 meses). Ler ao vivo a cada request é inviável; o painel lê do banco, como o SISPAG
   passou a fazer no ADR-0016.
3. **`[FASE-2]`** O analítico por fornecedor / cliente final / funcionário vira `GROUP BY` sobre
   `EventoAprovacao` em vez de recomputar trilhas — sem reescrita.

## Propriedades

| Propriedade | Tipo | Origem (wire/coluna) | Notas |
|-------------|------|----------------------|-------|
| `id` | string (uuid) | `trilha_aprovacao.id` | **Determinístico** a partir da chave natural — insert e update convergem, e a identidade não depende do `runId` (doutrina do `correlationId` da `TransacaoBancaria`). |
| `filCod` | number | `psq014` → `fil_cod` | **Invariante multi-filial.** Nunca `null`, **nunca de default** — ver `business-rules/filcod-da-trilha.md` (I-Aprov-6). |
| `docTip` | number | `psq014` → `doc_tip` | Sempre **2** (ENTRADA A PAGAR) nesta fase. `1` (SAÍDA A RECEBER) está fora de escopo. |
| `docCod` | string | `psq014` → `doc_cod` | Documento. Parte da chave natural. |
| `titCod` | string | `psq014` → `tit_cod` | Título/parcela. Parte da chave natural. |
| `documentoNumero` | string? | `psq014.docEspNumero` | **Snapshot** — é o "documento 123" do caso canônico do cliente. |
| `fornecedorNome` | string? | `psq014` (nome do credor) | **Snapshot.** `[FASE-2]` dimensão do analítico. |
| `fornecedorCod` | string? | `psq014.pesCod` | `[FASE-2]` **chave** da dimensão fornecedor. Gravar já na Fase 1 — um join retroativo depois pode não achar o dado histórico. |
| `clienteFinalCod` | string? | `FinTituloBloq.pesCodProc` | `[FASE-2]` cliente do processo. ⚠️ **NÃO vem na projeção atual** → `null` + lacuna. |
| `clienteFinalNome` | string? | `FinTituloBloq.dpeNomPessoaProc` | idem. |
| `valor` | number? | `psq014` | **Snapshot** do valor na leitura. |
| `moeda` | string? | `psq014` | **Snapshot.** |
| `dataEmissao` | Date? | `psq014.docDtaEmissao` (epoch ms) | Campo `Dta*` → **data pura**, sem hora. |
| `dataVencimento` | Date? | `psq014.titDtaVencimento` (epoch ms) | Campo `Dta*` → data pura. |
| `dataFinalizacao` | Date? | `FinTituloBloq.docDtaFinalizacao` | **O marco zero do relógio do cliente.** ⚠️ **NÃO vem na projeção do `fin026/infoTitulo/list`** — hoje é `null` e gera lacuna explícita. Ver PENDENTE **V3**. |
| `statusAprovacao` | enum | `trilha_aprovacao.status_aprovacao` | `SEM_WORKFLOW \| AGUARDANDO \| APROVADO \| REJEITADO \| INDETERMINADO`. **Derivado** do conjunto de etapas — constantes tipadas. Ver `state-machines/aprovacao-titulo.md`. |
| `etapasConhecidas` | number | derivado | Etapas **presentes no snapshot**. ⚠️ **Não** é "total planejado": o total exigiria a hierarquia `FinBloqHier` (`fin102`), a que não temos acesso. O contrato de API expõe `etapasTotais: number \| null` — aqui é sempre "conhecidas", e o campo do contrato recebe `null` quando `INDETERMINADO`. |
| `etapasConcluidas` | number | derivado | Etapas em `RESPONDIDA`. |
| `etapaAtualFblCod` | number? | derivado | Etapa `PENDENTE` mais antiga. `null` quando não há pendente. |
| `etapaAtualFtbCod` | number? | derivado | idem. |
| `tempoTotalDecorridoSegundos` | number? | derivado | De `dataFinalizacao` (ou do fallback declarado, ver I-Aprov-1) até a conclusão ou até agora. **Segundos corridos.** `null` quando não há marco zero utilizável. |
| `wffUuid` | string? | `FinTituloBloq.wffUuid` | Correlaciona etapas da mesma execução de workflow. ⚠️ **Não vem na projeção atual** → `null`. Modelado porque é a chave natural correta para distinguir "esta trilha" de "a trilha regerada" quando o `fin103` liberar. |
| `lacunas` | string[] | `trilha_aprovacao.lacunas` (jsonb) | **Avisos estruturados** exibidos na UI: `"sem data de finalização (docDtaFinalizacao não projetado)"`, `"etapa 6/1 sem timestamp de atribuição"`, `"status 7 sem legenda"`. Ponto não-negociável nº 2 do contrato de fronteira: quando o dado não existe, **o painel diz isso** — não estima em silêncio. |
| `snapshotHash` | string | `trilha_aprovacao.snapshot_hash` | Hash canônico do conjunto de etapas. **Base da idempotência da ingestão** (I-Aprov-3): hash igual ⇒ nenhum evento novo. |
| `snapshotEm` | Date | `trilha_aprovacao.snapshot_em` | Quando o job leu esta trilha pela última vez. **Exibido na UI** (ponto não-negociável nº 3: o usuário precisa saber que vê o snapshot das 14h, não o ERP agora). |
| `ingestaoRunId` | string? (uuid) | FK → `trilha_ingestao_run.id` | A run que gravou/atualizou (auditoria de cadência). |

## `IngestaoTrilhaRun` (membro de auditoria — NÃO é entidade própria)

Espelha `pagamento_ingestao_run` (SISPAG) e a run do extrato (Frente IV). Documentada aqui, como
`ItemLote` é documentado dentro de `lote-pagamento.md`.

| Propriedade | Tipo | Notas |
|-------------|------|-------|
| `id` | uuid | Identidade da rodada. |
| `triggeredBy` | string | `'cron'` \| `'backfill'` \| username do trigger manual. |
| `filCods` | number[] | Filiais varridas. |
| `janelaDe` / `janelaAte` | Date | Janela de `docDtaEmissao` lida. |
| `cursor` | jsonb | **Ponto de retomada** (filial + página + último `docCod:titCod`). O backfill é longo e **precisa ser interrompível** (risco R14 da orquestração). |
| `status` | enum | `running \| success \| partial \| error`. `partial` quando alguma filial/página falhou — **a run fecha `partial` e nada é apagado**, como na ingestão do extrato. |
| `titulosLidos` / `trilhasComEtapa` / `etapasGravadas` / `eventosGerados` | number | Contagens da rodada. |
| `iniciadaEm` / `terminadaEm` | Date | — |

## Invariantes aplicáveis

- **I-Aprov-2 — `SEM_WORKFLOW` × `INDETERMINADO`:** nunca colapsar os dois; nunca derivar
  `SEM_WORKFLOW` de uma leitura que falhou. Ver `business-rules/sem-workflow-vs-indeterminado.md`.
- **I-Aprov-3 — idempotência por snapshot:** reingerir o mesmo estado **não** gera evento novo nem
  duplica etapa. Ver `business-rules/idempotencia-ingestao-trilha.md`.
- **I-Aprov-4 — trilha regerada:** etapa que some do snapshot vira `SUBSTITUIDA`, **nunca é
  apagada**. Ver `business-rules/trilha-regerada.md`.
- **I-Aprov-6 — `filCod` do próprio registro:** consultar com a filial errada devolve `count: 0`
  **sem erro** e produziria um `SEM_WORKFLOW` falso. Ver `business-rules/filcod-da-trilha.md`.
- **ZERO escrita no ERP** (decisão D2): nenhum `aplicarComando`, nenhum `trocaBloqueio`, nenhum
  `regerarBloqueios`. A única escrita é o Postgres próprio.

## Sem anti-fantasma — e por quê

Diferença **deliberada** em relação ao `TituloAPagar` (que marca `ativo=false` quando o título some
da run). Aqui, um título que sai do recorte da janela **não** é inativado: a trilha histórica é o
produto. Inativar por ausência transformaria "não li desta vez" em "não tem workflow" — exatamente o
falso negativo que a I-Aprov-6 existe para impedir. Mesmo raciocínio já registrado para o extrato
bancário em `actions/recebimentos/importar-transacoes-extrato.md`.

## Distinção — `TrilhaAprovacao` (V) × `TituloAPagar` (II)

| | `TituloAPagar` (Frente II) | `TrilhaAprovacao` (Frente V) |
|---|---|---|
| Universo | carteira **corrente** (`fin064`/`com298`), janela −15d..+45d | **histórico** (`psq014/list`), 12 meses ou mais |
| Internacional | **filtrado-out** na ingestão (ADR-0021) | **não** filtrado (nada indica que o WF exclua exterior) |
| Retenção | anti-fantasma (`ativo=false`) | **sem** anti-fantasma |
| Propósito | montar o lote de pagamento | auditar a cadeia de aprovação |
| Escrita | nenhuma no ERP | nenhuma no ERP |

**São o mesmo título do ERP** (`filCod:docCod:titCod`), em dois recortes diferentes. A relação é
`0..1—1` **por chave natural, sem FK** — a trilha existe para títulos que a carteira SISPAG nem
ingere.

> ⚠️ **Correção que esta frente força na Frente II.** `entities/titulo-a-pagar.md` afirma hoje que a
> propriedade `aprovado` deriva do AND de `titVld1/2/3libera`. O probe em produção provou que essa
> escada é **vestigial**: vale `1` em **100%** dos títulos, sem timestamps e sem nomes —
> `titVldNLibera = 1` **não** significa "o nível N aprovou". O **código está correto** (usa `vldLib`
> do `fin064`, `ConexosSispagClient.ts:150`); é a **ontologia** que descreve errado. Ver §3.4.

## Fora de escopo (Fase 1)

- **Contas a Receber** (`docTip=1`) e pedidos — decisão D1 (Yuri).
- **Qualquer escrita** no ERP — decisão D2.
- **Motor de alçada** (quem *pode* aprovar): é `FinBloqAlca`/`ComAlcada`, cadastro, e a ferramenta
  não decide nada.
- **Analítico da Fase 2** — preparado (dimensões materializadas no evento), não implementado.
````

---

### 3.2 `ontology/entities/etapa-aprovacao.md` — NOVO

````markdown
---
name: EtapaAprovacao
type: entity
ontology_version: "0.20"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
properties:
  - id
  - trilhaId
  - filCod
  - docCod
  - titCod
  - fblCod
  - ftbCod
  - nomeEtapa
  - alcadaRotulo
  - acao
  - acaoClasse
  - pessoaNome
  - pessoaNomeNormalizado
  - pessoaCod
  - statusEtapa
  - statusOrigemBruto
  - recebidaEm
  - respondidaEm
  - duracaoSegundos
  - observacao
  - motivoCancelamento
  - ordem
  - vigenteDesde
  - vigenteAte
  - substituidaPor
relationships:
  - "EtapaAprovacao N—1 TrilhaAprovacao (via trilhaId — membro do agregado; não existe fora de uma trilha)"
  - "EtapaAprovacao 1—N EventoAprovacao (os eventos observados sobre esta etapa)"
  - "EtapaAprovacao N—1 (contexto) Bloqueio do ERP / FinBloq (via fblCod — CADASTRO do Conexos, deliberadamente NÃO modelado: a Frente V é track, não motor de alçada)"
last_review: 2026-08-19
universality_evidence:
  - "ontology/_inbox/frente-v-probe-resultado.md §3 — contrato de uma etapa resolvida, confirmado em produção: fblCod/ftbCod (chave), fblDesNome (etapa), aprovador (alçada), fbaDesNome (ação), usnDesNomeCmd (pessoa), ftbVldStatus (situação), ftbTimBloq / ftbTimCmd (carimbos COM HORA)"
  - "ontology/_inbox/frente-v-probe-resultado.md §2 — 177 etapas em 148 títulos (≈29 títulos com mais de uma etapa): a etapa tem cardinalidade própria, não é um campo do título"
  - "ontology/_inbox/frente-v-probe-resultado.md §0 — exemplo real (doc 4156/1, filial 1): CONTROLLER · COMPRAS · LIBERAR · DANILO_LARA · recebeu 2026-05-14 07:12:46 → liberou 2026-05-15 06:41:40 (23h29m)"
  - "Conceito universal de contas a pagar: a unidade de medida de um workflow de aprovação é a ETAPA (quem, o quê, quando, quanto tempo) — é sobre ela que qualquer SLA ou gargalo se mede"
---

# EtapaAprovacao (uma etapa da trilha — o bloqueio de um título)

> **PLANNED (Onda 1).** Uma `EtapaAprovacao` é **uma instância de bloqueio** sobre um título
> (`FinTituloBloq`): a etapa nomeada que alguém precisa responder para o título andar. É o **membro
> do agregado** `TrilhaAprovacao` — não existe fora dela — e é a **unidade de medida** de todo o
> produto: é aqui que "quem" e "quanto tempo" moram. Ciclo de vida em
> `state-machines/etapa-aprovacao.md`.

## Definição de domínio

Chave natural: `filCod` + `docTip` + `docCod` + `titCod` + **`fblCod`** + **`ftbCod`** — onde
`fblCod` identifica **o tipo de bloqueio** (a etapa: `CONTROLLER`, `FISCAL`…) e `ftbCod` identifica
**a instância** daquele bloqueio sobre aquele título. O par é a identidade estável usada por
I-Aprov-4 para detectar trilha regerada.

Uma etapa carrega três papéis que o vocabulário do ERP mistura e que a ontologia **separa**:

- **A etapa** (`fblDesNome`) — *onde* o título está na cadeia. Ex.: `CONTROLLER`.
- **A alçada** (`aprovador`) — *o rótulo de quem deveria responder*. Mistura setor e pessoa
  (`COMPRAS`, mas também `RICARDO DO PRADO`). **É rótulo, não identidade.**
- **A pessoa** (`usnDesNomeCmd`) — *quem efetivamente respondeu*. Ex.: `DANILO_LARA`. **Esta** é a
  chave do analítico por funcionário `[FASE-2]`.

## Propriedades

| Propriedade | Tipo | Origem (wire/coluna) | Notas |
|-------------|------|----------------------|-------|
| `id` | string (uuid) | `etapa_aprovacao.id` | Determinístico a partir da chave natural. |
| `trilhaId` | string (uuid) | FK → `trilha_aprovacao.id` | Raiz do agregado. |
| `filCod` / `docCod` / `titCod` | — | idem da trilha | Parte da chave natural; redundante por desempenho e para o `GROUP BY` da Fase 2. |
| `fblCod` | number | `FinTituloBloq.fblCod` | **Tipo de bloqueio** (a etapa). |
| `ftbCod` | number | `FinTituloBloq.ftbCod` | **Instância** do bloqueio. |
| `nomeEtapa` | string | `FinTituloBloq.fblDesNome` | Ex.: `CONTROLLER` (105/177 na amostra), `TI`, `WALTER`, `DIRETORIA II`, `FISCAL`… **Os 11 valores são CONFIG do cliente**, não enum de domínio. |
| `alcadaRotulo` | string? | `FinTituloBloq.aprovador` | **Rótulo de alçada** — mistura setor (`COMPRAS`, 127/177) e pessoa (`RICARDO DO PRADO`, 22). Exibição e agrupamento grosseiro; **nunca** identidade de pessoa. |
| `acao` | string? | `FinTituloBloq.fbaDesNome` | O comando aplicado: `LIBERAR` (122), `APROVAR` (34), **vazio** (21 — etapa sem ação tomada). Guardado **cru**. |
| `acaoClasse` | enum? | derivado por mapeamento **configurável** | `APROVACAO \| REJEICAO \| ENCAMINHAMENTO \| DESCONHECIDA`. Hoje `LIBERAR` e `APROVAR` → `APROVACAO` (**premissa**, ver PENDENTE **V2**). Nenhum valor de rejeição foi observado (**V7**). |
| `pessoaNome` | string? | `FinTituloBloq.usnDesNomeCmd` | **Quem agiu.** 14 pessoas na amostra; `DANILO_LARA` responde por 48% das resolvidas. Vazio nas 8 pendentes. |
| `pessoaNomeNormalizado` | string? | derivado | Trim + upper + colapso de separadores. **Chave de agrupamento provisória** `[FASE-2]` enquanto `usnCodCmd` não vier. Risco de homônimo declarado (**V9**). |
| `pessoaCod` | number? | `FinTituloBloq.usnCodCmd` | **Código estável da pessoa.** ⚠️ **Não vem na projeção atual** → `null`. Depende do acesso ao `fin103`. Modelado agora para que a Fase 2 não exija migration. |
| `statusEtapa` | enum | derivado de `ftbVldStatus` | `PENDENTE \| RESPONDIDA \| CANCELADA \| DESCONHECIDA \| SUBSTITUIDA`. Constantes tipadas. Ver `state-machines/etapa-aprovacao.md`. |
| `statusOrigemBruto` | number? | `FinTituloBloq.ftbVldStatus` | **O valor cru, SEMPRE preservado.** `1` = pendente (8), `2` = respondido (156), `7` = **legenda desconhecida** (13). Guardar o cru é o que permite reclassificar 13 etapas sem reingerir 23 mil títulos quando a Columbia responder **V1**. |
| `recebidaEm` | Date? | `FinTituloBloq.ftbTimBloq` | **Campo `Tim*` → preserva hora/minuto/segundo** (confirmado em produção). Premissa: "quando o aprovador recebeu a etapa" (**V4**). |
| `respondidaEm` | Date? | `FinTituloBloq.ftbTimCmd` | Quando o comando foi aplicado. Nas etapas **pendentes**, `ftbTimCmd == ftbTimBloq` — nesse caso é `null`, **não** o valor repetido (senão a duração viraria 0 falso). |
| `duracaoSegundos` | number? | derivado | `respondidaEm − recebidaEm`, **relógio corrido**. `null` quando falta timestamp. Ver `business-rules/duracao-etapa-aprovacao.md`. |
| `observacao` | string? | `FinTituloBloq.ftbEspInfo` / `ftbEspObsCmd` | ⚠️ **Não vem na projeção atual** → `null`. |
| `motivoCancelamento` | string? | `FinTituloBloq.motCodCanc` / `motDesNomeCanc` | ⚠️ **Não vem na projeção atual** → `null`. Consequência: `CANCELADA` é hoje **inobservável** diretamente (ver state-machine). |
| `ordem` | number | derivado | Ordem cronológica por `recebidaEm`, desempate por `fblCod:ftbCod`. **Não** implica sequencialidade — ver PENDENTE **V14**. |
| `vigenteDesde` | Date | `etapa_aprovacao.vigente_desde` | Quando esta versão da etapa foi observada pela primeira vez (P5 — tempo é parte da ontologia). |
| `vigenteAte` | Date? | `etapa_aprovacao.vigente_ate` | Preenchido quando a etapa deixa de aparecer no snapshot (trilha regerada). `null` = vigente. |
| `substituidaPor` | string? (uuid) | `etapa_aprovacao.substituida_por` | Aponta para a etapa que a sucedeu numa regeração, quando identificável. Ver I-Aprov-4. |

## Invariantes aplicáveis

- **I-Aprov-1 — duração:** relógio corrido; sem timestamp ⇒ `null` + lacuna, **nunca** estimativa
  silenciosa. Ver `business-rules/duracao-etapa-aprovacao.md`.
- **I-Aprov-4 — trilha regerada:** identidade é `(fblCod, ftbCod)`; etapa ausente vira `SUBSTITUIDA`
  com `vigenteAte`, nunca `DELETE`.
- **Status cru preservado:** `statusOrigemBruto` nunca é descartado, mesmo quando mapeado.

## Distinção — "etapa" (V) × os termos vizinhos

- **≠ "nível de alçada" da Frente II** (`titVld1/2/3libera`): aquilo é a **escada vestigial**, sem
  nomes e sem timestamps. A etapa da Frente V é a fila de bloqueios, e é o mecanismo real.
- **≠ "gate de finalização" do `LotePagamento`** (Frente II): o gate é uma ação **da analista na
  nossa ferramenta**; a etapa é um estado **do ERP**, que só observamos.
- **≠ `aprovarRecebimento`** (Frente IV): também é gate local nosso, não etapa do ERP.

## Fora de escopo (Fase 1)

- O **cadastro** que define a etapa (`FinBloq`) e as alçadas que a atendem (`FinBloqAlca`) — leitura
  útil para exibir "quantas etapas faltam", mas depende de `fin102`/`fin106`, aos quais também não
  temos acesso. Ver watchlist.
- Qualquer comando sobre a etapa (aprovar, cancelar, encaminhar).
````

---

### 3.3 `ontology/entities/evento-aprovacao.md` — NOVO

````markdown
---
name: EventoAprovacao
type: entity
ontology_version: "0.20"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
properties:
  - id
  - dedupKey
  - trilhaId
  - etapaId
  - filCod
  - docCod
  - titCod
  - fblCod
  - ftbCod
  - tipo
  - origem
  - ocorridoEm
  - observadoEm
  - atorNome
  - atorCod
  - nomeEtapa
  - alcadaRotulo
  - fornecedorCod
  - clienteFinalCod
  - duracaoDesdeEventoAnteriorSegundos
  - observacao
  - snapshotHash
  - ingestaoRunId
relationships:
  - "EventoAprovacao N—1 TrilhaAprovacao (via trilhaId — o título cuja trilha o evento descreve)"
  - "EventoAprovacao N—0..1 EtapaAprovacao (via etapaId — nulo nos eventos de trilha: DOCUMENTO_FINALIZADO, WORKFLOW_REGERADO, TITULO_LIBERADO)"
last_review: 2026-08-19
universality_evidence:
  - "ontology/_inbox/frente-v-orquestracao.md §5 — o contrato de fronteira define EventoTrilha com tipo, ocorridoEm, ator, etapa, duração, observação e origem ERP|DERIVADO como a unidade da timeline de detalhe"
  - "ontology/_inbox/frente-v-orquestracao.md §5, ponto não-negociável 1 — 'origem: ERP | DERIVADO em todo evento. Nunca apresentar um tempo inferido como se fosse registro do ERP. Auditoria financeira exige essa distinção'"
  - "ontology/_inbox/frente-v-orquestracao.md §8 — tabela de eventos append-only com ator, fornecedor, filial e duração materializados é a decisão da Fase 1 que determina se a Fase 2 é barata ou uma reescrita"
  - "ontology/_inbox/frente-v-probe-resultado.md §5 — o fin026/log (auditoria nativa do ERP) veio VAZIA em todos os títulos: o log de eventos precisa ser NOSSO, derivado de snapshots"
  - "Conceito universal: uma trilha de auditoria financeira é um log append-only de fatos datados com proveniência declarada; é a mesma disciplina do write-ahead ledger já usada nas Frentes I e IV"
---

# EventoAprovacao (log append-only do que observamos sobre a trilha)

> **PLANNED (Onda 1).** Um `EventoAprovacao` é **um fato datado** sobre a trilha de um título, com
> **proveniência declarada** (`ERP` × `DERIVADO`). É a fonte da **timeline de detalhe** e o
> substrato do analítico `[FASE-2]`. **Append-only:** nunca `UPDATE`, nunca `DELETE`. Nasce da
> ingestão (`ingerirTrilhaAprovacao`), por comparação entre o snapshot anterior e o atual.

## Por que uma entidade, e não uma projeção calculada

1. **O `fin026/log` do ERP veio VAZIO** em todos os títulos do probe. A auditoria nativa não serve
   como fonte — o log tem de ser nosso.
2. **`regerarBloqueios` reescreve a trilha no ERP.** Se só guardássemos o estado atual, uma regeração
   apagaria o histórico que o cliente quer auditar. O evento é o que sobrevive.
3. **`[FASE-2]`** Com fornecedor, cliente final, filial, etapa, ator e duração **materializados no
   próprio evento**, o analítico é um `GROUP BY`. Sem isso, exige recomputar trilhas e fazer join
   retroativo contra um ERP que talvez já não tenha o dado histórico.

## Tipos de evento

O enum vem do contrato de fronteira travado na orquestração (§5). A coluna **"observável hoje"** é o
que o probe confirmou — e é a diferença entre o modelo e a implementação da Fase 1.

| `tipo` | Significado | Fonte | Observável hoje? |
|--------|-------------|-------|------------------|
| `DOCUMENTO_FINALIZADO` | O marco zero do relógio do cliente | `docDtaFinalizacao` | ❌ **não** — campo não projetado. Depende do `fin103`. Ver PENDENTE **V3** |
| `ETAPA_CRIADA` | O bloqueio entrou na fila | `ftbTimBloq` | ✅ **sim** (`origem: ERP`) |
| `ETAPA_ATRIBUIDA` | A etapa foi atribuída a um aprovador | — | ❌ **não emitido na Fase 1.** Hoje é indistinguível de `ETAPA_CRIADA`; emitir os dois com o mesmo timestamp seria inventar um fato. Ver **V4** |
| `ETAPA_APROVADA` | Comando de aprovação/liberação aplicado | `ftbTimCmd` + `fbaDesNome` | ✅ **sim** (`origem: ERP`). Carrega `acao` cru (`LIBERAR`/`APROVAR`) — a distinção de negócio é **V2** |
| `ETAPA_REJEITADA` | Comando de recusa | `fbaDesNome` / `fbaVldAcao` | ⚠️ **declarado, nunca observado.** Nenhuma recusa apareceu na amostra. Ver **V7** |
| `ETAPA_CANCELADA` | Etapa cancelada | `motCodCanc` (não projetado) ou **inferido por ausência** | ⚠️ só como `origem: DERIVADO` |
| `WORKFLOW_REGERADO` | O conjunto de etapas mudou de identidade | comparação de snapshots | ⚠️ só como `origem: DERIVADO`. Ver I-Aprov-4 e **V6** |
| `TITULO_LIBERADO` | O título saiu de bloqueio | `titDtaLibera` / `titVldBloq` | ⚠️ **condicional** — vem no `fin026/list`, **não** na projeção do `infoTitulo`. Emitir só quando a fonte estiver disponível |

Tipo TS: `TipoEventoAprovacao = 'DOCUMENTO_FINALIZADO' | 'ETAPA_CRIADA' | 'ETAPA_ATRIBUIDA' |
'ETAPA_APROVADA' | 'ETAPA_REJEITADA' | 'ETAPA_CANCELADA' | 'WORKFLOW_REGERADO' | 'TITULO_LIBERADO'`
(constantes tipadas — nunca strings cruas; P3).

## Propriedades

| Propriedade | Tipo | Origem (wire/coluna) | Notas |
|-------------|------|----------------------|-------|
| `id` | string (uuid) | `evento_aprovacao.id` | Determinístico a partir de `dedupKey`. |
| `dedupKey` | string | `evento_aprovacao.dedup_key` **UNIQUE** | `{trilhaId}:{fblCod}:{ftbCod}:{tipo}:{ocorridoEm epoch}`. **A garantia é no BANCO** (`UNIQUE` + `ON CONFLICT DO NOTHING`), não checagem em memória — mesma doutrina do `natural_key` da `TransacaoBancaria`. Sem isso, um cron horário duplicaria a timeline 24× por dia. |
| `trilhaId` | string (uuid) | FK | — |
| `etapaId` | string? (uuid) | FK | `null` nos eventos de trilha. |
| `filCod` / `docCod` / `titCod` | — | denormalizado | `[FASE-2]` dimensão + evita join. |
| `fblCod` / `ftbCod` | number? | denormalizado | `null` nos eventos de trilha. |
| `tipo` | enum | — | Ver tabela acima. |
| `origem` | enum | `'ERP' \| 'DERIVADO'` | **Ponto não-negociável nº 1 do contrato.** Ver `business-rules/origem-erp-vs-derivado.md` (I-Aprov-5). |
| `ocorridoEm` | Date | — | **Quando o fato aconteceu.** Em `origem: ERP`, vem de um campo do ERP. Em `DERIVADO`, é o melhor instante que sabemos afirmar — e a UI mostra isso. |
| `observadoEm` | Date | — | Quando **nós** vimos. Em `DERIVADO`, `ocorridoEm` costuma ser igual a `observadoEm`; a distância entre os dois é a **incerteza declarada**. |
| `atorNome` | string? | `usnDesNomeCmd` | `null` em eventos sem ator (regeração, criação por regra). |
| `atorCod` | number? | `usnCodCmd` | `null` hoje. `[FASE-2]` |
| `nomeEtapa` | string? | `fblDesNome` | `[FASE-2]` dimensão materializada. |
| `alcadaRotulo` | string? | `aprovador` | `[FASE-2]` |
| `fornecedorCod` | string? | `psq014.pesCod` | `[FASE-2]` **gravar já na Fase 1** — o join retroativo pode não existir depois. |
| `clienteFinalCod` | string? | `pesCodProc` | `[FASE-2]` `null` hoje (não projetado). |
| `duracaoDesdeEventoAnteriorSegundos` | number? | derivado | Segundos corridos desde o evento anterior **da mesma trilha**. `null` no primeiro e quando falta timestamp. |
| `observacao` | string? | `ftbEspObsCmd` | `null` hoje. |
| `snapshotHash` | string | — | O snapshot que originou o evento (rastreio). |
| `ingestaoRunId` | string (uuid) | FK | Auditoria de cadência. |

## Invariantes aplicáveis

- **I-Aprov-3 — idempotência:** `UNIQUE(dedup_key)`; reingerir o mesmo snapshot gera **zero** eventos.
- **I-Aprov-5 — proveniência:** `origem = 'ERP'` **⟺** `ocorridoEm` veio de um campo do ERP. Sem
  exceção.
- **Append-only:** a tabela **não** tem caminho de `UPDATE`/`DELETE` no repositório. Correção de
  interpretação (ex.: `ftbVldStatus=7` ganhar legenda) gera **evento novo**, não reescrita.

## Distinção — `EventoAprovacao` (V) × os ledgers das outras frentes

`permuta_alocacao_execucao` e `recebimento_execucao` são **write-ahead ledgers**: registram a
**intenção NOSSA de escrever no ERP** antes de escrever. O `EventoAprovacao` é o oposto: registra o
**fato observado no ERP**, e a Frente V **não escreve nada**. Mesma disciplina (append-only,
idempotente, auditável), papéis opostos.

## Fora de escopo (Fase 1)

- Agregações materializadas (tempo médio por pessoa/fornecedor) — `[FASE-2]`. O evento carrega as
  dimensões; a *view* de agregação é da Fase 2.
- Retenção/particionamento — dimensionar quando o backfill medir o volume real.
````

---

### 3.4 `ontology/entities/titulo-a-pagar.md` — **CORREÇÃO** (não é adição)

O probe deixou isto explícito no §5 ("Follow-up fora desta frente"). É uma correção de **descrição
errada**, não uma mudança de comportamento: o código já usa a fonte certa.

**Diff proposto — seção `## \`aprovado\` (aprovado pela alçada) — evidência`:**

```diff
- - A aprovação para pagamento **não** é um único campo: são as flags de **alçada de liberação**
-   `titVld1libera` / `titVld2libera` / `titVld3libera` (`com308`), com
-   `titTim*libera`/`titUsn*libera` registrando **quando/quem** em cada nível. Governadas por `fin102`
-   (bloqueio), `fin103` (liberação), `fin106` (alçadas), `fin007/liberar`.
- - **Quantos níveis a Columbia usa de fato** é pergunta operacional aberta (Flávia). A ingestão
-   computa `aprovado` como o **AND das flags presentes** e **persiste** o booleano — recalibrável por
-   tenant/config sem mudar a estrutura.
+ - ⚠️ **CORRIGIDO (2026-08-19, ADR-0038 — probe em produção).** A descrição anterior estava errada:
+   dizia que `aprovado` derivava do AND de `titVld1/2/3libera`. A **escada de 3 liberações é
+   VESTIGIAL** na Columbia — vale `1` em **100%** dos títulos, **sem** timestamps e **sem** nomes.
+   `titVldNLibera = 1` **NÃO** significa "o nível N aprovou".
+ - **A fonte real que o código usa** é `vldLib` do `fin064`
+   (`src/backend/domain/client/ConexosSispagClient.ts:150`). O **comportamento sempre esteve
+   correto**; era a ontologia que descrevia o campo errado.
+ - **O mecanismo real de aprovação** da Columbia é a **fila de bloqueios por alçada**
+   (`FinTituloBloq`): 11 etapas nomeadas, duas ações (`LIBERAR`/`APROVAR`), 14 aprovadores, com
+   carimbos de hora. Isso é o objeto da **Frente V** — ver `entities/trilha-aprovacao.md`.
+ - **Consequência para a Frente II:** a pergunta aberta "quantos níveis de alçada a Columbia usa"
+   está **respondida e era mal formulada** — não são níveis, são bloqueios nomeados. Fechar o item
+   `níveis-de-alçada (Flávia)` do `open_gap` de `elegibilidade-titulo-lote` no `_coverage.json`.
```

**Adicionar à lista `relationships` do frontmatter:**

```yaml
  - "TituloAPagar 1—0..1 TrilhaAprovacao (via filCod:docCod:titCod — a trilha de aprovação do MESMO título, Frente V; relação por chave natural, SEM FK: o universo da Frente V (psq014, histórico) é maior que a carteira SISPAG)"
```

**Também bumpar** `ontology_version: "0.7"` → `"0.20"` e `last_review: 2026-07-18` → `2026-08-19`.

> **Nada mais muda na Frente II.** Nenhuma coluna, nenhuma migration, nenhuma regra de elegibilidade
> de lote. `aprovado` continua vindo de `vldLib`.

---


### 3.5 `ontology/actions/aprovacoes/ingerir-trilha-aprovacao.md` — NOVO

````markdown
---
name: ingerirTrilhaAprovacao
type: action
entity: TrilhaAprovacao
ontology_version: "0.20"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-08-19
preconditions:
  - "Conexos alcançável; leitura psq014/list (universo) → fin026/infoTitulo/list (trilha por título). READ-ONLY no ERP."
  - "Escopo de filiais por APROVACAO_INGEST_FIL_CODS (vazio = todas as filiais do ERP); docTip fixo em 2 (ENTRADA A PAGAR)."
  - "Janela de docDtaEmissao definida por APROVACAO_INGEST_DIAS (incremental) ou pelo cursor da run de backfill."
  - "Gatilho: cron, trigger manual autenticado (admin) ou run de backfill retomável."
postconditions:
  - "TrilhaAprovacao persistida (UPSERT por chave natural filCod:docTip:docCod:titCod) com snapshotHash e snapshotEm."
  - "EtapaAprovacao persistida (UPSERT por filCod:docTip:docCod:titCod:fblCod:ftbCod); etapa ausente do snapshot atual recebe vigenteAte e statusEtapa=SUBSTITUIDA — NUNCA DELETE (I-Aprov-4)."
  - "EventoAprovacao gerado apenas quando o snapshotHash MUDA; INSERT com ON CONFLICT(dedup_key) DO NOTHING (I-Aprov-3)."
  - "statusAprovacao recomputado a cada snapshot a partir do conjunto de etapas vigentes (state-machines/aprovacao-titulo.md)."
  - "Título lido com sucesso e sem nenhuma etapa → SEM_WORKFLOW. Leitura que FALHOU → INDETERMINADO, NUNCA SEM_WORKFLOW (I-Aprov-2)."
  - "Run de auditoria gravada (quem/quando/janela/filiais/cursor/status/contagens)."
  - "NENHUMA escrita no ERP — a única escrita é o Postgres próprio."
side_effects:
  - "Leitura paginada do psq014/list por filial (universo) + 1 chamada fin026/infoTitulo/list POR TÍTULO (custo dominante enquanto o fin103 estiver bloqueado)."
  - "UPSERT em trilha_aprovacao e etapa_aprovacao; INSERT append-only em evento_aprovacao; INSERT/UPDATE em trilha_ingestao_run."
  - "Advisory lock por escopo de ingestão (contenção → 409), como na ingestão do extrato."
---

# ingerirTrilhaAprovacao — materializar a trilha de aprovação (Fatia F1)

> Varre o **universo de títulos a pagar** (`psq014/list`), lê a **trilha de bloqueios** de cada um
> (`fin026/infoTitulo/list`), **materializa** trilha + etapas no Postgres próprio e **deriva os
> eventos** por comparação com o snapshot anterior. É o espelho da `ingerirPagamentos` (SISPAG) e da
> `importarTransacoesExtrato` (Frente IV) — mesma doutrina: cron + manual, advisory lock, chave
> natural, run de auditoria, `partial` em vez de silêncio.
>
> **READ-ONLY no ERP.** Ver `entities/trilha-aprovacao.md`,
> `integrations/conexos-fin026-fin103-aprovacao.md`.

## Gatilhos

| Gatilho | Caminho (proposto) | `triggered_by` |
|---------|--------------------|----------------|
| **Cron** | GitHub Actions → `npm run job:ingest-aprovacoes` | `'cron'` |
| **Manual** | `POST /aprovacoes/ingestao` (admin, `Idempotency-Key`) | username |
| **Backfill** | `POST /aprovacoes/ingestao/backfill` (janela explícita, retomável) | `'backfill'` |
| **Histórico** | `GET /aprovacoes/ingestao/runs` | — (READ-ONLY) |

Todos rodam o **mesmo compute**. O minuto do cron deve evitar `:00` e `:20` — já ocupados por
Permutas (`0 9,15,21`), SISPAG (`0 10`) e extratos (`20 * * * *`) — porque o Conexos limita
**sessões simultâneas por usuário** (`LOGIN_ERROR_MAX_SESSIONS`).

## Fluxo

1. Adquire o **advisory lock** da ingestão de aprovações **uma vez no topo** — nunca por filial
   (`pg_try_advisory_lock` é *session-scoped*; aninhar faria toda filial virar 409).
2. Abre a run (`running`, `triggered_by`, janela, filiais, cursor inicial).
3. **Universo:** para cada filial do escopo, `POST psq014/list` com
   `filCod#EQ` + `docTip#EQ: 2` + `docDtaEmissao#GE` (epoch ms), paginado. **Nunca `fin026/list`** —
   é a carteira corrente e perde o histórico (o doc 4156 é a prova).
4. **Trilha:** para cada linha do universo, `POST fin026/infoTitulo/list/{filCod}/{docTip}/{docCod}/{titCod}`
   — com o **`filCod` vindo da própria linha** (I-Aprov-6). Fan-out **achatado** num único
   `BoundedConcurrency` (`FANOUT_LIMIT_APROVACOES`), nunca aninhado (dois níveis dariam FANOUT² de
   sessões e reproduziriam o incidente `LOGIN_ERROR_MAX_SESSIONS`).
5. **Normaliza** cada etapa (mapeia `ftbVldStatus` → `statusEtapa`, **preservando o cru**), calcula
   `duracaoSegundos` (I-Aprov-1) e monta o `snapshotHash` canônico do conjunto.
6. **Compara** com o snapshot anterior:
   - etapa nova → `EtapaAprovacao` + `ETAPA_CRIADA` (+ `ETAPA_APROVADA` se já resolvida);
   - etapa que mudou de `PENDENTE` → `RESPONDIDA` → `ETAPA_APROVADA` (`origem: ERP`);
   - etapa que **sumiu** → `vigenteAte` + `SUBSTITUIDA` + `WORKFLOW_REGERADO` (`origem: DERIVADO`);
   - `snapshotHash` igual → **nenhum evento** (I-Aprov-3).
7. Recomputa `statusAprovacao`, `etapasConhecidas`, `etapasConcluidas`, `etapaAtual*`,
   `tempoTotalDecorrido*` e **`lacunas[]`**.
8. **UPSERT** trilha + etapas; **INSERT** eventos com `ON CONFLICT (dedup_key) DO NOTHING`; grava o
   cursor; fecha a run (`success` / `partial` / `error` + contagens).

## Idempotência / dedup

- **Chave natural da trilha:** `filCod:docTip:docCod:titCod`. **Nunca** inclui campo mutável
  (status, timestamps) — senão a mesma trilha reingeriria como nova a cada mudança.
- **Chave natural da etapa:** trilha + `fblCod:ftbCod`.
- **Chave de dedup do evento:** `{trilhaId}:{fblCod}:{ftbCod}:{tipo}:{ocorridoEm epoch}`, com
  **`UNIQUE` no banco** — não checagem em memória.
- **`id` determinístico** em trilha, etapa e evento: insert e update convergem, a identidade não
  depende do `runId`. Sem isso, um cron horário multiplicaria a timeline por 24 todo dia.
- `Idempotency-Key` no trigger manual (retorna a run existente em vez de reingerir).

## Custo, cadência e retomada

- **Custo dominante:** 1 chamada `fin026/infoTitulo/list` **por título**. Filial 2 tem **23.632**
  títulos em 12 meses. Enquanto o **`fin103` estiver bloqueado** (§4 do probe), esse é o piso.
- **O backfill é uma run de primeira classe, interrompível e retomável** — o `cursor` da run
  (filial + página + último `docCod:titCod`) é gravado a cada página. Risco R14.
- **Ingestão incremental** roda numa janela curta de `docDtaEmissao` e revisita apenas as trilhas com
  etapa `PENDENTE` (as resolvidas raramente mudam — exceto por `regerarBloqueios`, que a comparação
  de hash pega quando a trilha for revisitada). **Política de revisita a calibrar** com o volume real.
- **Falha parcial não corrompe:** a filial/página que falhou é logada com identificação, a run fecha
  `partial` e **nada é apagado**. O painel não anuncia carteira completa quando não está.
- **Truncamento de paginação lança** em vez de devolver lista incompleta em silêncio (doutrina do
  `ExtratoTruncadoError`).

## Por que está na ontologia (universalidade)

Universal: materializar localmente a trilha de aprovação lida de um ERP — com dedup por chave
natural, log de eventos append-only com proveniência e run de auditoria — é a única forma de medir
**duração** e sobreviver a um ERP que reescreve a fila (`regerarBloqueios`) e cuja auditoria nativa
vem vazia. A **estrutura** é do domínio. São **config do tenant**: os endpoints e a grafia dos
campos, as filiais, a janela, a cadência, o mapa `ftbVldStatus → enum` e o mapa `fbaDesNome →
acaoClasse`.

## Fora de escopo / débito conhecido

- **Sem acesso ao `fin103`** — com ele a varredura vira paginação (duas ordens de grandeza mais
  barata) e traz `docDtaFinalizacao`, `usnCodCmd`, `acdCod`, `wffUuid`. **Pedido de provisionamento
  aberto** ao admin do Conexos da Columbia. Ver PENDENTE **V8**.
- **Usuário-robô dedicado** no Conexos segue como débito herdado (P1, Frente IV): mais um cron
  disputando os slots de sessão.
````

---

### 3.6 `ontology/actions/aprovacoes/expor-painel-aprovacoes.md` — NOVO

````markdown
---
name: exporPainelAprovacoes
type: action
entity: TrilhaAprovacao
ontology_version: "0.20"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-08-19
preconditions:
  - "Ao menos uma run de ingestão concluída (success ou partial) para as filiais consultadas."
  - "Usuário autenticado e autorizado nas filiais consultadas (assertUserCanActOnFilial)."
postconditions:
  - "Retorna a lista paginada de títulos a pagar com statusWorkflow, etapa atual, aging da etapa e tempo total — TUDO calculado no BACKEND."
  - "Retorna snapshotEm — o painel declara de quando é o retrato que está mostrando."
  - "INDETERMINADO e SEM_WORKFLOW aparecem como status de primeira classe, nunca como erro nem como linha oculta."
  - "Nenhuma escrita — nem no ERP, nem no Postgres."
side_effects:
  - "Leitura do Postgres próprio (trilha_aprovacao + etapa_aprovacao). NENHUMA leitura ao vivo do Conexos."
---

# exporPainelAprovacoes — o grid do painel de aprovações (Fatia F2)

> **Etapa de leitura.** Agrega as `TrilhaAprovacao` materializadas e devolve a linha do grid:
> status do workflow, etapa atual, há quanto tempo está parada, tempo total decorrido. **READ-ONLY
> em tudo** — nem ERP, nem banco. Ver o contrato `AprovacoesListResponse` na orquestração §5.

## Regra de ouro: todo campo derivado é calculado no BACKEND

Sem exceção. O motivo é a Fase 2: se a duração for calculada no frontend, o analítico de amanhã usará
**outros números** que os do painel de hoje, e ninguém saberá qual está certo. Isso já está registrado
como regra de ouro do contrato de fronteira.

## Comportamento

- **Nada é escondido.** `SEM_WORKFLOW` (50,7% da amostra) e `INDETERMINADO` são **status de primeira
  classe** — o painel os mostra, como o painel de Permutas mostra as candidatas bloqueadas "como
  visibilidade, não como falha".
- **`snapshotEm` visível na UI.** O usuário precisa saber que vê o retrato das 14h e não o ERP agora
  (ponto não-negociável nº 3).
- **`lacunas[]` visíveis.** Quando falta `dataFinalizacao` ou o timestamp de atribuição, a linha
  **diz isso**; a coluna correspondente mostra `—`, nunca um valor estimado.
- **Aging da etapa atual** = `agora − recebidaEm` da etapa `PENDENTE` mais antiga, em **segundos
  corridos** (I-Aprov-1). É a coluna que ordena o backlog por default (mais parado primeiro),
  espelhando o ordenamento do painel de Permutas por aging.
- **Ordenação e filtros propostos:** por aging da etapa (default), filtros por filial, status,
  nome da etapa, pessoa e faixa de valor.

## Contrato de leitura

`GET /aprovacoes` → `AprovacoesListResponse` (ver orquestração §5). Rotas montadas na **raiz**
(`app.use('/aprovacoes', ...)`), não sob `/api` — `/api/fin026/...` é o **ERP**, coisa diferente.

## Por que está na ontologia (universalidade)

Universal: expor a carteira de aprovações com status agregado, aging da etapa atual e proveniência do
snapshot é a tela padrão de qualquer contas a pagar com workflow. A **estrutura** (status de primeira
classe para "sem workflow" e "indeterminado", derivação no backend, snapshot declarado, lacunas
explícitas) é do domínio; **colunas, filtros e ordenação default** são config/UX do tenant.

## Fora de escopo

- Qualquer ação de execução na linha (aprovar, cobrar, escalar) — a Frente V é **track** (decisão D2).
- Exportação — reusar `ui-flows/relatorios-export.md` se pedida.
- Agregações por pessoa/fornecedor — `[FASE-2]`.
````

---

### 3.7 `ontology/actions/aprovacoes/detalhar-trilha-aprovacao.md` — NOVO

````markdown
---
name: detalharTrilhaAprovacao
type: action
entity: TrilhaAprovacao
ontology_version: "0.20"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-08-19
preconditions:
  - "Trilha existente no banco (id opaco filCod:docTip:docCod:titCod); usuário autorizado na filial da trilha."
postconditions:
  - "Retorna a timeline cronológica de EventoAprovacao com tipo, ocorridoEm, ator, etapa, duração desde o evento anterior e ORIGEM (ERP | DERIVADO) em CADA evento."
  - "Retorna lacunas[] — os avisos do que o ERP não informou (ex.: 'sem timestamp de atribuição da etapa X')."
  - "Etapas SUBSTITUIDAS (trilha regerada) aparecem na timeline marcadas como tal — nunca são omitidas."
  - "Nenhuma escrita — nem no ERP, nem no Postgres."
side_effects:
  - "Leitura do Postgres próprio (evento_aprovacao + etapa_aprovacao + trilha_aprovacao)."
---

# detalharTrilhaAprovacao — a timeline de um título (Fatia F3)

> **Etapa de leitura.** Devolve a **timeline completa** de um título: cada evento com quem, quando,
> quanto tempo e **de onde veio o dado**. É a tela que fecha o caso canônico do cliente. Ver o
> contrato `TrilhaResponse` na orquestração §5.

## O caso canônico do cliente (critério de aceite)

> "O documento 123 foi finalizado às 10:00 de 18/08; o Fulano recebeu o WF de aprovação às 18:09
> desse mesmo dia e aprovou às 10:00 do dia 19/08."

| Elemento | Campo | Situação hoje |
|----------|-------|---------------|
| documento 123 | `documentoNumero` (`docEspNumero`) | ✅ confirmado |
| "finalizado às 10:00 de 18/08" | `dataFinalizacao` (`docDtaFinalizacao`) | ❌ **não projetado** → lacuna. PENDENTE **V3** |
| "Fulano" | `pessoaNome` (`usnDesNomeCmd`) | ✅ confirmado |
| "recebeu às 18:09" | `recebidaEm` (`ftbTimBloq`) | ✅ confirmado **com hora**; semântica é premissa (**V4**) |
| "aprovou às 10:00 do dia 19/08" | `respondidaEm` (`ftbTimCmd`) | ✅ confirmado com hora |
| "quanto tempo levou" | `duracaoSegundos` | ✅ derivável (exemplo real: 23h29m) |

**Veredito:** o caso fecha inteiro **exceto o marco zero**. Enquanto **V3** não for respondido, a
timeline começa em `ETAPA_CRIADA` e a linha do "documento finalizado" aparece como **lacuna
explícita** — não como um `docDtaEmissao` disfarçado de finalização.

## Comportamento

- **`origem` em cada evento**, sem exceção (ponto não-negociável nº 1). A UI diferencia visualmente
  `ERP` de `DERIVADO`. Nunca apresentar um tempo inferido como registro do ERP — auditoria financeira
  exige a distinção.
- **Etapas substituídas aparecem.** Uma trilha regerada mostra as etapas antigas marcadas
  `SUBSTITUIDA` + o evento `WORKFLOW_REGERADO`. Ocultá-las apagaria justamente o que o cliente quer
  auditar.
- **Durações em segundos corridos** no contrato; formatação (`23h29m`) é decisão de apresentação.
- **`lacunas[]` no topo do detalhe**, não escondidas em tooltip.

## Contrato de leitura

`GET /aprovacoes/:id/trilha` → `TrilhaResponse` (`cabecalho` + `eventos[]` + `lacunas[]`).

## Por que está na ontologia (universalidade)

Universal: a timeline auditável de uma cadeia de aprovações — fato, ator, carimbo, duração e
**proveniência** — é o entregável de qualquer rastreamento de workflow financeiro. A **estrutura** é
do domínio; os rótulos de etapa, os nomes das pessoas e a formatação de duração são config.

## Fora de escopo

- Ação sobre a etapa (aprovar/cobrar/escalar) — track only (D2).
- Comparação entre trilhas / benchmark por etapa — `[FASE-2]`.
````

---


### 3.8 `ontology/state-machines/aprovacao-titulo.md` — NOVO

````markdown
---
name: aprovacao-titulo
type: state-machine
entity: TrilhaAprovacao
ontology_version: "0.20"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-08-19
states: [SEM_WORKFLOW, AGUARDANDO, APROVADO, REJEITADO, INDETERMINADO]
out_of_scope_states: []
---

# Ciclo de vida — status de aprovação de um título (`TrilhaAprovacao`)

> **Vigência:** 2026-08-19 (v0.20.0, ADR-0038 — bootstrap da Frente V). Modela o **status agregado
> de aprovação** de um título a pagar, **derivado** do conjunto de etapas vigentes.
>
> ⚠️ **Esta máquina é REFLETIDA, não dirigida.** O estado é do **ERP**; nós **observamos**. Nenhuma
> transição aqui é causada por uma ação nossa — todas são disparadas por
> `ingerirTrilhaAprovacao` ao **constatar** uma mudança entre snapshots. É a diferença fundamental
> em relação a `lote-pagamento` e `recebimento`, cujos estados são **locais e dirigidos por nós**.
> Mesmo assim, **cada transição é nomeada, com regra explícita e vigência datada** (princípio P3): a
> regra diz *o que constatamos*, não *o que mandamos fazer*.

## Estados (constantes tipadas)

| Constante | Valor | Significado |
|-----------|-------|-------------|
| `SEM_WORKFLOW` | `SEM_WORKFLOW` | O título **não tem nenhuma etapa de aprovação**, e isso foi **constatado por uma leitura bem-sucedida** com o `filCod` do próprio registro. **50,7% da amostra.** Não é falha nem lacuna — é o curso normal de metade dos títulos. |
| `AGUARDANDO` | `AGUARDANDO` | Há **≥1 etapa `PENDENTE`**. É o estado onde o aging importa: a etapa mais antiga pendente é a `etapaAtual`. |
| `APROVADO` | `APROVADO` | Todas as etapas conhecidas estão **`RESPONDIDA`**, com **≥1** etapa respondida, **nenhuma** `PENDENTE` e **nenhuma** `DESCONHECIDA`. |
| `REJEITADO` | `REJEITADO` | ≥1 etapa terminou com `acaoClasse = REJEICAO` não sucedida por aprovação posterior. ⚠️ **Declarado, mas NUNCA OBSERVADO** — na amostra só apareceram `LIBERAR`, `APROVAR` e vazio. Ver PENDENTE **V7**. |
| `INDETERMINADO` | `INDETERMINADO` | **Dado insuficiente para afirmar qualquer um dos outros.** Cobre: leitura falhou; ≥1 etapa em `DESCONHECIDA` (`ftbVldStatus=7`); só restaram etapas `CANCELADA`. **É status de primeira classe, nunca um erro** (ponto não-negociável nº 4 do contrato). |

Tipo: `StatusAprovacao = 'SEM_WORKFLOW' | 'AGUARDANDO' | 'APROVADO' | 'REJEITADO' | 'INDETERMINADO'`
(constantes tipadas — nunca strings cruas; P3).

## Transições

Toda transição é disparada por `ingerirTrilhaAprovacao` ao comparar o snapshot novo com o anterior.
Toda transição grava evento(s) em `EventoAprovacao` com `origem` declarada (I-Aprov-5) e atualiza
`snapshotEm`.

| # | De → Para | Ação (gatilho) | Regra | Vigência |
|---|-----------|----------------|-------|----------|
| **W1** | `(novo) → SEM_WORKFLOW` | `ingerirTrilhaAprovacao` (primeira leitura) | O título existe no `psq014/list` **E** `fin026/infoTitulo/list` — consultado **com o `filCod` da própria linha** — devolveu `count: 0` **sem erro**. Se o `filCod` não veio do registro, **W1 é PROIBIDA** e o resultado é W5 (I-Aprov-6). | 2026-08-19 |
| **W2** | `(novo) → AGUARDANDO` | `ingerirTrilhaAprovacao` | A leitura devolveu ≥1 etapa com `statusEtapa = PENDENTE` (`ftbVldStatus = 1`). Emite `ETAPA_CRIADA` por etapa nova (`origem: ERP`, `ocorridoEm = ftbTimBloq`). | 2026-08-19 |
| **W3** | `(novo) → APROVADO` | `ingerirTrilhaAprovacao` (título já resolvido no backfill) | Todas as etapas vieram `RESPONDIDA`; ≥1 respondida; nenhuma `PENDENTE`/`DESCONHECIDA`. Emite `ETAPA_CRIADA` + `ETAPA_APROVADA` por etapa (`origem: ERP`). Caminho dominante do **backfill histórico**. | 2026-08-19 |
| **W4** | `AGUARDANDO → APROVADO` | `ingerirTrilhaAprovacao` (constatou resposta) | A última etapa `PENDENTE` passou a `RESPONDIDA` (`ftbVldStatus 1 → 2`) com `acaoClasse = APROVACAO`. Emite `ETAPA_APROVADA` (`origem: ERP`, `ocorridoEm = ftbTimCmd`) e fecha `duracaoSegundos` da etapa. | 2026-08-19 |
| **W5** | `{qualquer} → INDETERMINADO` | `ingerirTrilhaAprovacao` (dado insuficiente) | Dispara em **qualquer** destes: (a) a leitura da trilha **falhou** (timeout/erro/sessão); (b) ≥1 etapa vigente tem `statusEtapa = DESCONHECIDA` (hoje: `ftbVldStatus = 7`, 13 casos na amostra); (c) todas as etapas vigentes estão `CANCELADA` — cancelamento **não é aprovação nem rejeição**, e afirmar `APROVADO` aí seria inventar. **`INDETERMINADO` é reversível**: quando o dado suficiente aparecer, W2/W4 reclassificam. | 2026-08-19 |
| **W6** | `{qualquer} → REJEITADO` | `ingerirTrilhaAprovacao` (constatou recusa) | ≥1 etapa vigente com `acaoClasse = REJEICAO` sem aprovação posterior na mesma trilha. Emite `ETAPA_REJEITADA` (`origem: ERP`). ⚠️ **Caminho não exercitado**: nenhuma recusa foi observada em produção. O mapeamento `fbaDesNome → REJEICAO` é **config vazia** até a Columbia responder **V7**. | 2026-08-19 |
| **W7** | `{APROVADO, REJEITADO, INDETERMINADO} → AGUARDANDO` | `ingerirTrilhaAprovacao` (**trilha regerada**) | O snapshot novo trouxe etapas com **identidade `(fblCod, ftbCod)` diferente** das vigentes, e ≥1 delas está `PENDENTE`. As etapas anteriores recebem `vigenteAte` + `SUBSTITUIDA`; emite `WORKFLOW_REGERADO` (`origem: DERIVADO` — o ERP não nos conta que regerou, **nós constatamos**). **Um título aprovado pode voltar a aguardar** — a máquina **não** é monotônica, e isso é deliberado. Ver `business-rules/trilha-regerada.md` e PENDENTE **V6**. | 2026-08-19 |
| **W8** | `SEM_WORKFLOW → AGUARDANDO` | `ingerirTrilhaAprovacao` | O título passou a ter etapa (regra de bloqueio disparou depois; ou o WF foi criado manualmente). Trata-se de W2 aplicada a um título antes sem trilha — registrada à parte porque **contradiz a leitura ingênua de que "sem workflow" é terminal**. | 2026-08-19 |
| **W9** | `AGUARDANDO → SEM_WORKFLOW` | — | **PROIBIDA.** Uma trilha que já teve etapa **nunca** volta a `SEM_WORKFLOW`: a etapa que sumiu vira `SUBSTITUIDA` (W7) ou o estado vira `INDETERMINADO` (W5). Registrada explicitamente porque é o caminho que uma implementação ingênua tomaria ao ler `count: 0` com o `filCod` errado — o falso negativo da I-Aprov-6. | 2026-08-19 |

```
                       leitura OK + count:0
   (novo) ────────────────────────────────────────▶ ┌──────────────┐
      │                                    W1        │ SEM_WORKFLOW │
      │                                              └──────┬───────┘
      │                                          W8 (surgiu │ etapa)
      │  W2 (≥1 pendente)                                   ▼
      ├───────────────────────────────────────────▶ ┌──────────────┐
      │                                              │  AGUARDANDO  │◀────┐
      │  W3 (backfill: tudo resolvido)               └──────┬───────┘     │
      └──────────────────────────────────┐                  │ W4          │ W7
                                         │                  ▼             │ (trilha
                                         └────────▶ ┌──────────────┐      │  regerada,
                                                     │   APROVADO   │─────┤  DERIVADO)
                                                     └──────────────┘      │
                                                     ┌──────────────┐      │
                          W6 (nunca observado) ─────▶│   REJEITADO  │──────┤
                                                     └──────────────┘      │
                                                     ┌──────────────┐      │
   W5 (falha de leitura | status 7 | só canceladas) ▶│ INDETERMINADO│──────┘
                                                     └──────────────┘
                                                     (reversível: W2/W4 reclassificam)

   W9  AGUARDANDO ──✗──▶ SEM_WORKFLOW   PROIBIDA (seria o falso negativo do filCod)
```

## Decisões de modelagem (ADR-0038)

- **`INDETERMINADO` não é erro, e é reversível.** É a única resposta honesta quando o ERP entrega um
  código sem legenda (`ftbVldStatus = 7`) ou quando a leitura falhou. Colapsá-lo em `SEM_WORKFLOW`
  seria afirmar ausência de workflow a partir de ignorância. *Alternativa rejeitada:* usar `null` —
  rejeitada porque `null` na UI vira célula vazia, indistinguível de "ainda não carregou".
- **A máquina não é monotônica** (W7). Um título `APROVADO` volta a `AGUARDANDO` se a trilha for
  regerada. Forçar monotonicidade esconderia exatamente o evento que o controller quer ver.
- **W9 é proibida por escrito.** Uma transição *proibida* documentada vale mais que a sua ausência:
  é o teste de regressão que impede o falso negativo do `filCod`.
- **`REJEITADO` entra mesmo sem ter sido observado.** *Alternativa considerada:* omiti-lo até a
  Columbia confirmar. Rejeitada porque a máquina precisa ter o caminho de recusa desde o desenho —
  acrescentá-lo depois mudaria o enum público do contrato e a UI. Fica declarado, com o mapeamento
  vazio e a pendência **V7** anotada.

## Relação com o ERP

**Reflexo, não espelho de mão dupla.** Nenhuma transição escreve no Conexos. Se o ERP e o nosso
status divergirem, **o ERP tem razão** e a próxima ingestão corrige — a nossa contribuição é o
**histórico** que o ERP não guarda (duração, regeração, aging).
````

---

### 3.9 `ontology/state-machines/etapa-aprovacao.md` — NOVO

````markdown
---
name: etapa-aprovacao
type: state-machine
entity: EtapaAprovacao
ontology_version: "0.20"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-08-19
states: [PENDENTE, RESPONDIDA, CANCELADA, DESCONHECIDA, SUBSTITUIDA]
out_of_scope_states: []
---

# Ciclo de vida — uma etapa da trilha (`EtapaAprovacao`)

> **Vigência:** 2026-08-19 (v0.20.0, ADR-0038). Modela o estado de **uma etapa de bloqueio** sobre um
> título. Como a máquina do título, é **refletida**: quatro dos cinco estados vêm do ERP
> (`ftbVldStatus`) e um — `SUBSTITUIDA` — é **nosso**, e existe justamente porque o ERP não tem
> conceito para ele.

## Mapeamento `ftbVldStatus` → estado

⚠️ **Este mapa é CONFIG do tenant/versão do ERP, não regra de domínio.** O `ftbVldStatus` **cru** é
sempre preservado em `statusOrigemBruto`, o que permite reclassificar sem reingerir.

| `ftbVldStatus` | Ocorrências (amostra) | Estado | Confiança |
|---|---|---|---|
| `1` | 8 | `PENDENTE` | ✅ confirmado (nos pendentes, `ftbTimCmd == ftbTimBloq` e não há pessoa) |
| `2` | 156 | `RESPONDIDA` | ✅ confirmado (bate com o "Respondido" visto na tela pelo Yuri) |
| `7` | 13 | `DESCONHECIDA` | ❌ **legenda desconhecida** — ver PENDENTE **V1** |
| ausente / outro | — | `DESCONHECIDA` | fail-closed |

## Estados (constantes tipadas)

| Constante | Valor | Significado |
|-----------|-------|-------------|
| `PENDENTE` | `PENDENTE` | Etapa criada e ainda **sem comando aplicado**. `respondidaEm` é `null` (mesmo que o ERP repita `ftbTimCmd == ftbTimBloq`), `pessoaNome` é `null`, `duracaoSegundos` é `null` e o **aging corre**. |
| `RESPONDIDA` | `RESPONDIDA` | Comando aplicado. Tem `acao` (`LIBERAR`/`APROVAR`), `pessoaNome` e `respondidaEm`. `duracaoSegundos` fecha. ⚠️ 21 etapas da amostra vieram com `fbaDesNome` **vazio** — ver PENDENTE **V11**. |
| `CANCELADA` | `CANCELADA` | Etapa cancelada no ERP (`motCodCanc`). ⚠️ **Hoje INOBSERVÁVEL diretamente** — `motCodCanc` não vem na projeção. Alcançável só via `fin103` ou por inferência (que classificamos como `SUBSTITUIDA`, não `CANCELADA`, para não inventar causa). |
| `DESCONHECIDA` | `DESCONHECIDA` | O ERP devolveu um status sem legenda (`7`) ou não devolveu status. **Contamina o título para `INDETERMINADO`** (W5). Estado honesto, não estado de erro. |
| `SUBSTITUIDA` | `SUBSTITUIDA` | **Estado NOSSO.** A etapa deixou de aparecer no snapshot — tipicamente por `regerarBloqueios`. Recebe `vigenteAte`; **o registro não é apagado** e continua na timeline, marcado. |

Tipo: `StatusEtapaAprovacao = 'PENDENTE' | 'RESPONDIDA' | 'CANCELADA' | 'DESCONHECIDA' |
'SUBSTITUIDA'` (constantes tipadas — nunca strings cruas; P3).

## Transições

| # | De → Para | Ação (gatilho) | Regra | Vigência |
|---|-----------|----------------|-------|----------|
| **E1** | `(nova) → PENDENTE` | `ingerirTrilhaAprovacao` | Etapa nova no snapshot com `ftbVldStatus = 1`. Grava `recebidaEm = ftbTimBloq`, `vigenteDesde = agora`. Emite `ETAPA_CRIADA` (`origem: ERP`). | 2026-08-19 |
| **E2** | `(nova) → RESPONDIDA` | `ingerirTrilhaAprovacao` (backfill) | Etapa nova já com `ftbVldStatus = 2`. Emite `ETAPA_CRIADA` + `ETAPA_APROVADA`, ambas `origem: ERP` com os carimbos do ERP. Caminho dominante do backfill (156/177 na amostra). | 2026-08-19 |
| **E3** | `PENDENTE → RESPONDIDA` | `ingerirTrilhaAprovacao` (constatou comando) | `ftbVldStatus` passou de `1` para `2`. Grava `respondidaEm = ftbTimCmd`, `acao`, `pessoaNome`, e **fecha `duracaoSegundos`** (I-Aprov-1). Emite `ETAPA_APROVADA` ou `ETAPA_REJEITADA` conforme `acaoClasse`. | 2026-08-19 |
| **E4** | `{PENDENTE, RESPONDIDA} → CANCELADA` | `ingerirTrilhaAprovacao` | O ERP informou cancelamento (`motCodCanc` preenchido). **Não alcançável hoje** — depende do `fin103`. Emite `ETAPA_CANCELADA` (`origem: ERP`). Uma etapa `CANCELADA` **não conta** como aprovação nem como rejeição: se sobrarem só canceladas, o título vai a `INDETERMINADO` (W5c). | 2026-08-19 |
| **E5** | `{qualquer} → DESCONHECIDA` | `ingerirTrilhaAprovacao` | `ftbVldStatus` sem legenda (`7`) ou ausente. **Fail-closed**: preserva o cru, marca a lacuna `"status N sem legenda"` e contamina o título para `INDETERMINADO`. **Reversível** por E6 quando a legenda for conhecida. | 2026-08-19 |
| **E6** | `DESCONHECIDA → {PENDENTE, RESPONDIDA, CANCELADA}` | reclassificação (mudança do mapa de config) | Quando a Columbia responder **V1**, o mapa `ftbVldStatus → estado` muda e as etapas são reclassificadas **a partir do `statusOrigemBruto` já gravado** — **sem reingerir** os 23 mil títulos. Emite evento novo (`origem: DERIVADO`), **nunca reescreve** eventos antigos. É o retorno concreto de guardar o valor cru. | 2026-08-19 |
| **E7** | `{PENDENTE, RESPONDIDA, DESCONHECIDA} → SUBSTITUIDA` | `ingerirTrilhaAprovacao` (**trilha regerada**) | A etapa **sumiu** do snapshot atual, mas a leitura foi **bem-sucedida** e a trilha **tem outras etapas**. Grava `vigenteAte`; tenta preencher `substituidaPor`; emite `WORKFLOW_REGERADO` (`origem: DERIVADO`) uma vez por trilha por regeração. Ver `business-rules/trilha-regerada.md`. | 2026-08-19 |
| **E8** | `{qualquer} → (deletado)` | — | **PROIBIDA.** Nenhuma etapa é apagada, jamais. Ausência no snapshot vira E7. Se a leitura **falhou**, **nenhuma** transição ocorre — a etapa fica como estava e o título vai a `INDETERMINADO` (W5a). Distinguir "sumiu" de "não li" é o ponto inteiro. | 2026-08-19 |

```
                     ftbVldStatus=1                  ftbVldStatus 1→2
   (nova) ──── E1 ──────────────▶ ┌───────────┐ ──── E3 ──────────▶ ┌─────────────┐
      │                            │ PENDENTE  │                     │ RESPONDIDA  │
      │                            └─────┬─────┘                     └──────┬──────┘
      │  E2 (backfill, já =2)             │                                  │
      └───────────────────────────────────┼──────────────────────────────────┘
                                          │ E4 (motCodCanc — não observável hoje)
                                          ▼
                                   ┌────────────┐
                                   │  CANCELADA │
                                   └────────────┘
      E5 (status 7 / ausente)      ┌──────────────┐   E6 (mapa de config mudou)
   ──────────────────────────────▶ │ DESCONHECIDA │ ──────────────▶ (reclassifica)
                                   └──────────────┘

      E7 (sumiu do snapshot, leitura OK)   ┌──────────────┐
   ─────────────────────────────────────▶  │ SUBSTITUIDA  │  (vigenteAte; fica na timeline)
                                            └──────────────┘

      E8  {qualquer} ──✗──▶ (deletado)   PROIBIDA — "sumiu" ≠ "não li"
```

## Decisões de modelagem (ADR-0038)

- **`SUBSTITUIDA` é estado, não deleção.** *Alternativa rejeitada:* apagar a etapa e reinserir a
  nova, como o ERP faz. Rejeitada porque destruiria o histórico de duração — exatamente o dado que a
  ferramenta existe para produzir, e que o ERP não guarda.
- **`DESCONHECIDA` é estado, não `null`.** Torna os 13 casos **contáveis e reclassificáveis**, e
  força o título a `INDETERMINADO` em vez de deixá-lo silenciosamente `APROVADO`.
- **Nas etapas pendentes, `respondidaEm` é `null`, não `ftbTimCmd`.** O ERP repete `ftbTimCmd ==
  ftbTimBloq` nas pendentes; copiar isso produziria `duracaoSegundos = 0` — uma etapa que "levou zero
  segundo" e destruiria qualquer média. Ver I-Aprov-1.
- **`E6` existe por causa de `statusOrigemBruto`.** É a justificativa concreta de guardar o valor cru:
  responder **V1** custa uma mudança de config, não um backfill de 23 mil chamadas.
````

---


### 3.10 Business rules — 6 arquivos novos em `ontology/business-rules/`

#### 3.10.1 `duracao-etapa-aprovacao.md` (I-Aprov-1)

````markdown
---
name: duracao-etapa-aprovacao
type: business-rule
entity: EtapaAprovacao
ontology_version: "0.20"
implementation_status: planned
status: draft
owners: [yuri]
invariant: I-Aprov-1
related_files: []
last_review: 2026-08-19
has_canonical_test: false
---

# Regra: duracao-etapa-aprovacao (relógio corrido, e `null` quando não se sabe)

> **Invariante I-Aprov-1 — A duração de uma etapa é medida em SEGUNDOS CORRIDOS entre dois carimbos
> do ERP. Quando um dos carimbos falta, a duração é `null` acompanhada de uma lacuna explícita —
> NUNCA uma estimativa silenciosa.**

## Regra canônica

```
duracaoSegundos(etapa) =
    (etapa.statusEtapa == RESPONDIDA
     ∧ etapa.recebidaEm   != null
     ∧ etapa.respondidaEm != null)
        ? floor((etapa.respondidaEm − etapa.recebidaEm) / 1000)
        : null

agingSegundos(etapa) =                       // só para etapa PENDENTE
    (etapa.recebidaEm != null)
        ? floor((agora − etapa.recebidaEm) / 1000)
        : null                                // + lacuna "etapa X sem timestamp de atribuição"

tempoTotalDecorridoSegundos(trilha) =
    (trilha.dataFinalizacao != null)
        ? floor(((ultimaRespostaOuAgora) − trilha.dataFinalizacao) / 1000)
        : null                                // + lacuna "sem marco zero (docDtaFinalizacao)"
```

- **`recebidaEm` = `ftbTimBloq`**, **`respondidaEm` = `ftbTimCmd`**. Ambos são campos `Tim*` do
  Conexos e **preservam hora/minuto/segundo** (confirmado em produção). Campos `Dta*` são data pura
  (meia-noite) e **não servem** para medir duração.
- **Epoch em milissegundos.** Os `Tim*` **não** sofrem o `BR_NOON_SHIFT_MS` (+15h) que o
  `ConexosBaseClient` aplica a datas puras — aplicá-lo aqui deslocaria toda a série. **Teste de
  regressão obrigatório.**

## Fuso horário — `America/Sao_Paulo`

- **A duração em si é fuso-independente** (diferença de dois instantes).
- **`America/Sao_Paulo` importa em três lugares:** (a) formatação (`14/05/2026 07:12:46 BRT`);
  (b) bucketização por dia/semana/mês `[FASE-2]`; (c) qualquer futura regra de dias úteis.
- **Fuso é config do tenant** (`APROVACAO_TIMEZONE`, default `America/Sao_Paulo`); o **uso de um
  fuso único e declarado** é a regra de domínio.

## Etapa PENDENTE: `duracaoSegundos` é `null`, não zero

Nas etapas pendentes o ERP devolve **`ftbTimCmd == ftbTimBloq`**. Copiar isso produziria uma etapa
com duração **0 s** — que entraria nas médias e as destruiria (8 zeros em 177 etapas puxariam a
mediana). Regra: se `statusEtapa != RESPONDIDA`, `duracaoSegundos = null` e o que se mede é o
**aging**, marcado como **em curso** e `origem: DERIVADO` (o "agora" é nosso, não do ERP).

## Sem timestamp de atribuição — o que fazer

**Nunca inventar um marco zero.** Ordem de decisão:

1. `recebidaEm` presente → usar (caminho normal, `origem: ERP`).
2. `recebidaEm` ausente → `duracaoSegundos = null` **+** lacuna
   `"etapa {fblCod}/{ftbCod} sem timestamp de atribuição"`, **+** a etapa é **excluída** dos
   agregados `[FASE-2]` (não entra como zero nem como média).
3. **Proibido**: usar `docDtaEmissao`, `dataVencimento`, `snapshotEm` ou o `recebidaEm` da etapa
   anterior como substituto. Cada um produziria um número plausível e **falso**, e a auditoria
   financeira não distingue "estimado" de "medido" depois que o número entra na planilha.

Mesma disciplina do `tempoTotalDecorridoSegundos`: sem `docDtaFinalizacao` (**hoje, sempre** — o
campo não é projetado), o total é `null` + lacuna. **Não** cair para `docDtaEmissao` sem que a
Columbia confirme a equivalência (PENDENTE **V3**).

## Relógio corrido, não dias úteis

O contrato expõe **segundos corridos**. Se a Columbia tiver SLA em dias úteis (PENDENTE **V13**), o
cálculo entra como **campo adicional** calculado no backend — **nunca substituindo** o corrido. Duas
razões: (a) o corrido é o único número não-configurável, comparável entre clientes; (b) calendário de
feriados é config volátil, e uma métrica que muda quando alguém edita o calendário não é auditável.

## Impacto

Define a coluna "tempo da etapa", o aging que ordena o painel por default, e a base do analítico
`[FASE-2]`. Também define **o que o painel mostra como `—`**: toda célula vazia tem uma lacuna
correspondente que a explica.

## Teste canônico (a escrever no TDD)

`has_canonical_test: false`. Casos:

1. Etapa resolvida real (doc 4156/1, filial 1): `recebidaEm 2026-05-14 07:12:46 BRT`,
   `respondidaEm 2026-05-15 06:41:40 BRT` → **84.534 s** (23h29m). Âncora de regressão.
2. Etapa pendente com `ftbTimCmd == ftbTimBloq` → `duracaoSegundos = null` **e** `aging > 0`.
   **Nunca 0.**
3. Etapa sem `ftbTimBloq` → `null` + lacuna presente + excluída dos agregados.
4. Trilha sem `docDtaFinalizacao` → `tempoTotalDecorridoSegundos = null` + lacuna; **não** cai para
   `docDtaEmissao`.
5. Anti-shift: um `ftbTimBloq` epoch-ms **não** sofre `BR_NOON_SHIFT_MS`.

## Universalidade

Universal: medir a duração de uma etapa entre dois carimbos, recusar-se a estimar quando um falta, e
separar "corrido" de qualquer calendário de negócio é o mínimo de uma métrica auditável. **Config do
tenant:** o fuso, o calendário de dias úteis, os limiares de SLA.
````

---

#### 3.10.2 `sem-workflow-vs-indeterminado.md` (I-Aprov-2)

````markdown
---
name: sem-workflow-vs-indeterminado
type: business-rule
entity: TrilhaAprovacao
ontology_version: "0.20"
implementation_status: planned
status: draft
owners: [yuri]
invariant: I-Aprov-2
related_files: []
last_review: 2026-08-19
has_canonical_test: false
---

# Regra: sem-workflow-vs-indeterminado ("não tem" ≠ "não sei")

> **Invariante I-Aprov-2 — `SEM_WORKFLOW` é uma AFIRMAÇÃO, e só pode ser feita a partir de uma
> leitura BEM-SUCEDIDA com o `filCod` do próprio registro. Qualquer ignorância — leitura que falhou,
> status sem legenda, só etapas canceladas — é `INDETERMINADO`. Os dois NUNCA se colapsam.**

## Por que a regra existe

Metade dos títulos (50,7% da amostra) **legitimamente não tem workflow**. Se o sistema disser
"sem workflow" também quando não conseguiu ler, o estado mais comum do painel vira o esconderijo
perfeito de toda falha de integração — e ninguém percebe, porque o número parece plausível.

É a mesma armadilha já registrada no ADR-0037/E2 para o `com297`: *"zero linhas, sem erro,
indistinguível de 'não há NDe'"*.

## Regra canônica

```
SEM_WORKFLOW  ⟺  leituraOk(trilha)
                 ∧ filCodVeioDoRegistro(trilha)      // I-Aprov-6
                 ∧ etapasVigentes(trilha) == 0
                 ∧ nuncaTeveEtapa(trilha)            // uma trilha que já teve etapa não volta

INDETERMINADO ⟸  ¬leituraOk(trilha)                                  // (a) falhou
              ∨  ∃ etapa vigente com statusEtapa == DESCONHECIDA     // (b) legenda ausente
              ∨  (etapasVigentes > 0 ∧ todas CANCELADA)              // (c) só canceladas
              ∨  ¬filCodVeioDoRegistro(trilha)                       // (d) fail-closed
```

- **`leituraOk`** = o `fin026/infoTitulo/list` respondeu **200 com envelope válido**. Timeout, erro
  de sessão, 4xx/5xx e resposta fora do envelope **não** são `leituraOk`.
- **`count: 0` só significa "sem workflow" se `leituraOk` for verdadeiro** — e é exatamente por isso
  que a I-Aprov-6 existe: com o `filCod` errado, `leituraOk` é verdadeiro e `count` é 0, e a
  afirmação sai falsa. Por isso a conjunção inclui `filCodVeioDoRegistro`.
- **`INDETERMINADO` é reversível.** A próxima ingestão bem-sucedida reclassifica.

## Como cada um aparece na UI

| Status | Chip | Texto de apoio | Ação sugerida |
|--------|------|----------------|---------------|
| `SEM_WORKFLOW` | neutro | "Este título não passa por aprovação" | nenhuma — é o curso normal |
| `INDETERMINADO` | atenção | o **motivo específico** (`falha de leitura` / `status 7 sem legenda` / `só etapas canceladas`) | reingerir / abrir chamado / perguntar à analista |

**`INDETERMINADO` nunca é renderizado como erro de tela** (ponto não-negociável nº 4 do contrato) — é
uma linha normal do grid com chip próprio. E **nunca é filtrado para fora do default**: esconder o
"não sei" transforma a métrica de cobertura em ficção.

## Impacto

Define o KPI de cobertura do painel (`% com workflow` / `% sem` / `% indeterminado`), e é o que
permite detectar regressão de integração: um salto em `INDETERMINADO` é alarme; um salto em
`SEM_WORKFLOW` **sem** salto em `INDETERMINADO` é mudança de operação.

## Teste canônico (a escrever no TDD)

`has_canonical_test: false`. Casos:

1. Título real sem trilha, `filCod` correto, leitura 200 → `SEM_WORKFLOW`.
2. Mesmo título, cliente forçado a **timeout** → `INDETERMINADO`, **jamais** `SEM_WORKFLOW`.
3. Título com uma etapa `ftbVldStatus = 7` → `INDETERMINADO` (mesmo que as demais estejam `2`).
4. Título só com etapas `CANCELADA` → `INDETERMINADO`, **não** `APROVADO`.
5. Doc 4156 (filial 1) consultado como filial 2 → nunca `SEM_WORKFLOW` (ver I-Aprov-6).
6. Trilha que já teve etapa e agora vem vazia → `INDETERMINADO`/`SUBSTITUIDA`, nunca `SEM_WORKFLOW`.

## Universalidade

Universal: distinguir "o fato não ocorreu" de "não consegui observar" é requisito de qualquer
sistema de auditoria. Sem a distinção, a taxa de cobertura mede a saúde da integração e é lida como
comportamento do negócio. **Config:** os rótulos de UI. **Domínio:** a distinção.
````

---

#### 3.10.3 `idempotencia-ingestao-trilha.md` (I-Aprov-3)

````markdown
---
name: idempotencia-ingestao-trilha
type: business-rule
entity: TrilhaAprovacao
ontology_version: "0.20"
implementation_status: planned
status: draft
owners: [yuri]
invariant: I-Aprov-3
related_files: []
last_review: 2026-08-19
has_canonical_test: false
---

# Regra: idempotencia-ingestao-trilha (o snapshot é a unidade de idempotência)

> **Invariante I-Aprov-3 — Reingerir uma trilha cujo estado NÃO mudou produz ZERO evento novo e ZERO
> linha duplicada. A comparação é feita por um `snapshotHash` canônico, e a garantia de unicidade é
> do BANCO — nunca checagem em memória.**

## Regra canônica

```
snapshotHash(trilha) = sha256( canonical(
    etapasVigentes
      .sortBy(fblCod, ftbCod)
      .map(e => [e.fblCod, e.ftbCod, e.nomeEtapa, e.alcadaRotulo, e.acao,
                 e.pessoaNome, e.statusOrigemBruto, e.recebidaEm, e.respondidaEm])
))

se snapshotHash(novo) == trilha.snapshotHash:
    → atualiza APENAS snapshotEm e ingestaoRunId
    → NENHUM evento é gerado, NENHUMA etapa é reescrita

senão:
    → diff etapa a etapa por (fblCod, ftbCod) → transições E1..E7
    → INSERT dos eventos com ON CONFLICT (dedup_key) DO NOTHING
    → grava snapshotHash novo
```

**O hash NÃO inclui** `snapshotEm`, `ingestaoRunId`, `duracaoSegundos` nem qualquer derivado nosso —
senão toda rodada pareceria mudança. Inclui **só** o que veio do ERP.

## Três camadas de garantia (nesta ordem)

1. **Chave natural com `UNIQUE` no banco:**
   `trilha_aprovacao (fil_cod, doc_tip, doc_cod, tit_cod)` e
   `etapa_aprovacao (fil_cod, doc_tip, doc_cod, tit_cod, fbl_cod, ftb_cod)`, com `UPSERT`
   (`ON CONFLICT ... DO UPDATE`). **Nunca** campo mutável na chave — senão a mesma trilha reingeriria
   como nova a cada mudança de status.
2. **`UNIQUE (dedup_key)` em `evento_aprovacao`** + `ON CONFLICT DO NOTHING`. Sem isso, um cron
   horário multiplicaria a timeline por 24 todo dia — o mesmo defeito que a Frente IV mediu e
   corrigiu (728 linhas para 104 lançamentos, 86% de excedente).
3. **`id` determinístico** em trilha, etapa e evento, derivado da chave natural / `dedupKey`: insert
   e update convergem e a identidade **não depende do `runId`**.

## Idempotência dos gatilhos

- **Trigger manual:** `Idempotency-Key` retorna a run existente em vez de reingerir.
- **Advisory lock** único no topo (nunca por filial) barra sobreposição entre cron, manual e backfill.
- **Backfill retomável:** o `cursor` da run é gravado por página; retomar **não** reprocessa o que já
  passou, e reprocessar **é seguro** de qualquer forma (é o que esta regra garante).

## O que a regra NÃO cobre

**Trilha regerada** (`regerarBloqueios`) muda o hash **legitimamente** e **deve** gerar eventos. Não
é violação de idempotência — é mudança real. Ver `business-rules/trilha-regerada.md` (I-Aprov-4).

## Impacto

Permite rodar o cron com frequência alta sem inflar a timeline, e torna o backfill **seguro de
reexecutar** — o que é pré-condição de um job de 23.632 chamadas que vai ser interrompido.

## Teste canônico (a escrever no TDD)

`has_canonical_test: false`. Casos:

1. Ingerir a mesma trilha 2× sem mudança → 1 linha de trilha, N linhas de etapa, **0 eventos novos**
   na segunda; `snapshotEm` atualizado.
2. Etapa passa de `1` para `2` → **exatamente 1** `ETAPA_APROVADA` novo, `duracaoSegundos` fechado.
3. Rodar a mesma ingestão 24× (simulando o dia) → contagem de eventos **constante** após a primeira.
4. Backfill interrompido no meio e retomado → nenhuma duplicata, nenhum buraco.
5. `dedupKey` colidindo (mesmo evento, duas runs concorrentes) → `ON CONFLICT DO NOTHING`, sem erro.

## Universalidade

Universal: ingestão periódica de estado externo exige idempotência por chave natural + dedup no
banco. É a mesma doutrina já validada em `importarTransacoesExtrato` (I-Receb) e `ingerirPagamentos`.
A novidade aqui é o **`snapshotHash` como gate barato**: evita o diff completo quando nada mudou.
````

---

#### 3.10.4 `trilha-regerada.md` (I-Aprov-4)

````markdown
---
name: trilha-regerada
type: business-rule
entity: EtapaAprovacao
ontology_version: "0.20"
implementation_status: planned
status: draft
owners: [yuri]
invariant: I-Aprov-4
related_files: []
last_review: 2026-08-19
has_canonical_test: false
---

# Regra: trilha-regerada (o ERP pode reescrever a fila; nós nunca apagamos)

> **Invariante I-Aprov-4 — A identidade de uma etapa é o par `(fblCod, ftbCod)`. Uma etapa que
> desaparece de um snapshot BEM-SUCEDIDO é marcada `SUBSTITUIDA` com `vigenteAte` — NUNCA apagada. A
> constatação gera um evento `WORKFLOW_REGERADO` com `origem: DERIVADO`.**

## O problema

O Conexos expõe `POST com308/.../infoTitulo/regerarBloqueios`, que **reescreve as etapas de um
título**. Também há `trocaBloqueio`. Nós **não chamamos** nenhum dos dois (track only) — mas um
analista pode chamar pela tela, e nesse caso a trilha que materializamos ontem some.

Se seguíssemos o ERP e apagássemos, perderíamos: as durações já medidas, quem já tinha respondido, e
o próprio fato da regeração — que é **informação de negócio** (alguém reabriu uma aprovação).

## Regra canônica

```
seja A = etapas vigentes no snapshot ANTERIOR
seja N = etapas do snapshot NOVO           (leitura BEM-SUCEDIDA — senão nada acontece)

sumiram   = A \ N   por (fblCod, ftbCod)
surgiram  = N \ A   por (fblCod, ftbCod)

se sumiram ≠ ∅ ∧ N ≠ ∅:
    ∀ e ∈ sumiram:  e.vigenteAte  = observadoEm
                    e.statusEtapa = SUBSTITUIDA          // transição E7
                    e.substituidaPor = match(e, surgiram) por fblCod, quando único
    emitir UM EventoAprovacao WORKFLOW_REGERADO por trilha por regeração
           (origem: DERIVADO, ocorridoEm = observadoEm, etapaId = null)
    recomputar statusAprovacao (transição W7)

se sumiram ≠ ∅ ∧ N = ∅:
    → NÃO é regeração; é ausência total.
      Se leituraOk → INDETERMINADO (nunca SEM_WORKFLOW, I-Aprov-2)
      Se ¬leituraOk → nada acontece (E8 proibida)
```

**`substituidaPor` só é preenchido quando o `match` é inequívoco** (mesmo `fblCod`, exatamente um
candidato novo). Na dúvida fica `null` — melhor uma correlação ausente que uma inventada.

> **Quando o `wffUuid` chegar** (depende do `fin103`), ele passa a ser a chave natural da *execução*
> de workflow e torna a detecção exata em vez de inferida. O campo já está modelado por isso.

## Efeito nos agregados `[FASE-2]`

Etapas `SUBSTITUIDA` **ficam na timeline** (o auditor vê o que aconteceu) mas são **excluídas por
default dos agregados** de tempo médio — senão uma aprovação contada duas vezes (a substituída e a
nova) enviesaria a média. A exclusão é um **flag da consulta**, não um `DELETE`: quem quiser medir
"quanto retrabalho a regeração custa" tem o dado.

## `SUBSTITUIDA` ≠ `CANCELADA`

- **`CANCELADA`** é um fato do ERP, com motivo (`motCodCanc`), `origem: ERP`.
- **`SUBSTITUIDA`** é uma **inferência nossa** a partir de ausência, `origem: DERIVADO`, **sem
  motivo conhecido**.

Colapsar os dois atribuiria ao ERP uma causa que ele nunca informou. Mesmo espírito do
`DESFAZER ≠ CANCELADO` já registrado na state-machine do `LotePagamento` (L6 × L5).

## Impacto

Torna a máquina de status **não-monotônica** (W7: `APROVADO → AGUARDANDO`) e obriga a UI a ter um
marcador de regeração na timeline. Também é a razão pela qual a política de revisita da ingestão não
pode ignorar trilhas já resolvidas para sempre — **PENDENTE V6** dimensiona a frequência.

## Teste canônico (a escrever no TDD)

`has_canonical_test: false`. Casos:

1. Snapshot 1 com etapa `(6,1)` `RESPONDIDA`; snapshot 2 com `(6,2)` `PENDENTE` → `(6,1)` vira
   `SUBSTITUIDA` com `vigenteAte`, `(6,2)` nasce `PENDENTE`, **1** `WORKFLOW_REGERADO`, título
   `APROVADO → AGUARDANDO`.
2. Snapshot 2 **idêntico** ao 1 → nenhuma `SUBSTITUIDA`, nenhum evento (I-Aprov-3).
3. Snapshot 2 **vazio** com leitura OK → `INDETERMINADO`, **nenhuma** deleção.
4. Snapshot 2 **falhou** → **nada** muda (E8 proibida).
5. Agregado de tempo médio ignora `SUBSTITUIDA` por default e a inclui com o flag.

## Universalidade

Universal: um sistema de origem que reescreve seu próprio histórico obriga o sistema de
rastreamento a versionar em vez de espelhar. É a mesma escolha do `vigenteDesde/vigenteAte` (P5 —
tempo é parte da ontologia) e do append-only do write-ahead ledger. **Config:** a frequência de
revisita. **Domínio:** nunca apagar.
````

---

#### 3.10.5 `origem-erp-vs-derivado.md` (I-Aprov-5)

````markdown
---
name: origem-erp-vs-derivado
type: business-rule
entity: EventoAprovacao
ontology_version: "0.20"
implementation_status: planned
status: draft
owners: [yuri]
invariant: I-Aprov-5
related_files: []
last_review: 2026-08-19
has_canonical_test: false
---

# Regra: origem-erp-vs-derivado (nunca vender inferência como registro)

> **Invariante I-Aprov-5 — TODO `EventoAprovacao` declara `origem`. `origem = 'ERP'` se e somente se
> `ocorridoEm` vier de um campo do ERP. Tudo o mais é `'DERIVADO'`, e a UI mostra a diferença.**

## Regra canônica

```
origem(evento) = 'ERP'       ⟺  evento.ocorridoEm foi lido de um campo do Conexos
                                (ftbTimBloq, ftbTimCmd, docDtaFinalizacao, titDtaLibera)
origem(evento) = 'DERIVADO'  ⟺  evento.ocorridoEm é o nosso observadoEm
                                (constatação por comparação de snapshots)
```

Não há terceira opção, e não há evento sem `origem`. O campo é **NOT NULL** no banco e obrigatório
no contrato de API.

## Classificação de cada tipo

| `tipo` | `origem` | `ocorridoEm` vem de |
|--------|----------|---------------------|
| `ETAPA_CRIADA` | **ERP** | `ftbTimBloq` |
| `ETAPA_APROVADA` | **ERP** | `ftbTimCmd` |
| `ETAPA_REJEITADA` | **ERP** | `ftbTimCmd` |
| `DOCUMENTO_FINALIZADO` | **ERP** | `docDtaFinalizacao` (indisponível hoje) |
| `TITULO_LIBERADO` | **ERP** | `titDtaLibera` (fonte condicional) |
| `ETAPA_CANCELADA` | **ERP** se `motCodCanc`; **DERIVADO** se inferido por ausência | conforme |
| `WORKFLOW_REGERADO` | **DERIVADO** | `observadoEm` |
| `ETAPA_ATRIBUIDA` | — | **não emitido na Fase 1** (indistinguível de `ETAPA_CRIADA`, PENDENTE **V4**) |

## O aging também é derivado

O aging de uma etapa pendente (`agora − recebidaEm`) mistura um carimbo do ERP com o **nosso**
relógio. Na UI ele é exibido **em curso** ("parada há 3d 4h"), nunca como um fato consumado do ERP.
Idem `tempoTotalDecorridoSegundos` de trilha ainda aberta.

## Por que isto é regra e não estilo de UI

Auditoria financeira: um número apresentado como registro do ERP pode virar prova em discussão
interna ou externa. Se metade dos timestamps for inferência nossa e a tela não disser qual é qual, a
ferramenta passa a **fabricar evidência**. O contrato de fronteira registra isso como **ponto
não-negociável nº 1** — e a regra existe para que a implementação não o trate como sugestão.

Também é o que impede a degradação silenciosa: quando o `fin103` liberar `docDtaFinalizacao`, os
eventos migram de "ausentes" para `origem: ERP` — e a mudança é **visível e datável**, não uma
melhora invisível de qualidade de dado.

## Impacto

- `EventoAprovacao.origem` é `NOT NULL`.
- A timeline diferencia visualmente `ERP` de `DERIVADO`.
- Exportações e o analítico `[FASE-2]` **carregam a coluna `origem`** — um `GROUP BY` de tempo médio
  que misture as duas origens sem dizer é relatório enganoso.

## Teste canônico (a escrever no TDD)

`has_canonical_test: false`. Casos:

1. `ETAPA_APROVADA` gerada de `ftbTimCmd` → `origem = 'ERP'`, `ocorridoEm == ftbTimCmd`.
2. `WORKFLOW_REGERADO` → `origem = 'DERIVADO'`, `ocorridoEm == observadoEm`.
3. Nenhum evento pode ser gravado com `origem = null` (constraint).
4. Nenhum evento `origem = 'ERP'` pode ter `ocorridoEm == observadoEm` quando não há campo de ERP
   correspondente (guard).
5. A resposta de `GET /aprovacoes/:id/trilha` traz `origem` em **100%** dos eventos.

## Universalidade

Universal: proveniência declarada por fato é requisito de qualquer trilha de auditoria. É a mesma
doutrina que já levou a Frente IV a marcar `origem: 'ferramenta' | 'erp'` nas NDes do painel
(ADR-0037/E3) e a recusar preencher campos de rastro com placeholder ("seria mentira em um campo de
rastro").
````

---

#### 3.10.6 `filcod-da-trilha.md` (I-Aprov-6)

````markdown
---
name: filcod-da-trilha
type: business-rule
entity: TrilhaAprovacao
ontology_version: "0.20"
implementation_status: planned
status: draft
owners: [yuri]
invariant: I-Aprov-6
related_files: []
last_review: 2026-08-19
has_canonical_test: false
---

# Regra: filcod-da-trilha (o falso negativo silencioso do `filCod`)

> **Invariante I-Aprov-6 — O `filCod` usado para consultar a trilha de um título DEVE vir do próprio
> registro que originou a consulta. Nunca de um default, de uma env, de um loop por filial ou do
> contexto de sessão. Consultar com o `filCod` errado devolve `count: 0` SEM ERRO — e produziria a
> afirmação falsa "este título não tem workflow".**

## O fato medido

Do probe em produção (§3):

> ⚠️ **Cuidado com falso negativo silencioso:** consultar a trilha com o `filCod` errado devolve
> `count: 0` **sem erro**. O doc 4156 mora na filial 1; consultá-lo como filial 2 retorna vazio.

Não há código de erro, não há aviso, não há diferença observável entre "este título não tem etapas"
e "você perguntou na filial errada". A única defesa é **estrutural**.

## Regra canônica

```
∀ título t lido do psq014/list:
    trilha(t) = fin026/infoTitulo/list( t.filCod, t.docTip, t.docCod, t.titCod )
                                        ^^^^^^^^
                                        DO REGISTRO t, sempre

PROIBIDO:  filCod de env/config/default
PROIBIDO:  filCod do "contexto de filial" da sessão
PROIBIDO:  varrer todas as filiais até uma responder (mascara o erro e multiplica o custo)
PROIBIDO:  assumir que docCod é globalmente único
```

## Enforcement — por assinatura, não por disciplina

A regra é enforçada no **tipo**, não em revisão de código:

- O método do client **não tem parâmetro `filCod` avulso**: recebe a **chave natural inteira**
  (`{ filCod, docTip, docCod, titCod }`) extraída da linha do `psq014`, de modo que não existe
  caminho onde alguém *possa* passar um `filCod` de outra origem.
- **Sem valor default** em nenhuma assinatura da cadeia (`filCod?: number` é proibido).
- A chave natural persistida carrega o `filCod`, e o `UNIQUE` da tabela o inclui.

Esta é a mesma lição do ADR-0037/E2 (`#LIKE` acentuado no `com297`: *"zero linhas, sem erro"*),
resolvida do mesmo jeito: **eliminar a possibilidade**, não confiar em cuidado.

## Interação com I-Aprov-2

Se, por qualquer razão, não for possível garantir a procedência do `filCod`, o resultado **não pode**
ser `SEM_WORKFLOW`: é `INDETERMINADO` (cláusula (d) da I-Aprov-2). **Fail-closed.**

## Impacto

- Assinatura do `ConexosAprovacoesClient` e do serviço de ingestão.
- Teste de regressão obrigatório (risco R15 da orquestração).
- Também impede o anti-padrão de custo: varrer 3 filiais por título triplicaria uma ingestão que já
  custa 23.632 chamadas.

## Teste canônico (a escrever no TDD)

`has_canonical_test: false`. Casos:

1. **Âncora real:** doc 4156, título 1, `filCod = 1` → trilha `CONTROLLER · COMPRAS · LIBERAR ·
   DANILO_LARA` presente.
2. Mesmo doc consultado com `filCod = 2` → `count: 0`. O sistema **não pode** classificar como
   `SEM_WORKFLOW`.
3. Teste de assinatura: não existe overload do client que aceite `filCod` sem a chave natural
   completa; nenhum `filCod` opcional na cadeia.
4. Ingestão de 2 filiais em paralelo: nenhum título recebe o `filCod` da outra filial.

## Universalidade

Universal por **forma**: toda API multi-tenant/multi-filial que responde "vazio" em vez de "não
autorizado"/"não existe" cria falso negativo silencioso, e a defesa é sempre a mesma — chave de
escopo tirada do próprio registro, e fail-closed quando não dá para garantir. **Config:** o nome do
campo (`filCod`) e o endpoint. **Domínio:** a proibição de default e o fail-closed.
````

---


### 3.11 `ontology/integrations/conexos-fin026-fin103-aprovacao.md` — NOVO

````markdown
---
name: conexos-fin026-fin103-aprovacao
type: integration
system: Conexos ERP (Financeiro — Bloqueio/Liberação de Títulos)
ontology_version: "0.20"
implementation_status: planned
status: draft
owners: [yuri]
direction: read
related_files:
  - src/backend/jobs/probe-aprovacoes-fin026.ts
  - src/backend/jobs/probe-aprovacoes-trilha.ts
endpoints_read:
  - "psq014/list — CONFIRMADO. Universo de títulos (tela de PESQUISA, cobre o histórico). Filtros filCod#EQ, docTip#EQ (2 = a pagar), docDtaEmissao#GE (epoch ms)"
  - "fin026/infoTitulo/list/{filCod}/{docTip}/{docCod}/{titCod} — CONFIRMADO. Trilha (etapas de bloqueio) de UM título. Corpo CnxListRequest vazio basta"
  - "com308/financeiroAPagar/infoTitulo/list/{docCod}/{titCod} — CONFIRMADO. Devolve EXATAMENTE o mesmo que o anterior (equivalente, não complementar)"
  - "psq014/infoTitulo/list/{...} — equivalente pela tela de pesquisa; EXIGE os filtros fExibirPrevisao e fExibirRenegociados"
  - "fin103/list — ⛔ BLOQUEADO. Devolve count:0 em TODAS as filiais, em PRD e HML: o usuário de API não tem acesso à TELA. Exige filCod#EQ (sem ele, 400)"
  - "fin026/log/{docTip}/{docCod}/{titCod} — NÃO SERVE como fonte da trilha (logList veio VAZIA em todos os títulos). Útil só pelo configList, que traz as legendas dos enums"
endpoints_write: []
related_decisions: ["0038"]
---

## O que esta integração faz

Fonte de leitura do **workflow de aprovação de títulos a pagar** (Frente V). **READ-ONLY** — a única
escrita da ingestão é o Postgres próprio (`trilha_aprovacao`, `etapa_aprovacao`, `evento_aprovacao`).

**Não existe um módulo "workflow" no Conexos.** A aprovação é implementada como **bloqueio de título
por alçada**: o schema `FinTituloBloq` (declarado em `090-fin0.json`, `100-fin1.json`,
`070-com3.json`, `190-psq0.json`).

## A cadeia (confirmada contra PRODUÇÃO, 2026-08-18)

```
POST psq014/list   { filCod#EQ, docTip#EQ: 2, docDtaEmissao#GE }   ← UNIVERSO (histórico)
   └── uma linha por título a pagar; 23.632 títulos na filial 2
       │
       │  para CADA linha, com o filCod DA PRÓPRIA LINHA (I-Aprov-6)
       ▼
POST fin026/infoTitulo/list/{filCod}/{docTip}/{docCod}/{titCod}    ← TRILHA (etapas)
   └── { count, pageNumber, rows: [FinTituloBloq] }
```

> ⚠️ **O universo NÃO é o `fin026/list`.** Aquele é a **carteira corrente** e mede só os títulos
> **bloqueados agora** (`vldIsBloqueado = 1`). Um título já liberado sai desse recorte — mas a trilha
> dele **continua gravada**. O doc 4156 é a prova: existe no `psq014` e não aparece no `fin026`. Uma
> rodada anterior do spike concluiu "3 títulos com workflow em toda a produção" por causa disso; a
> realidade é **49,3%**.

## Campos que importam (`FinTituloBloq`, projeção real do `infoTitulo/list`)

| Campo wire | Vira | Nota |
|---|---|---|
| `fblCod` + `ftbCod` | chave natural da `EtapaAprovacao` | `fblCod` = tipo de bloqueio; `ftbCod` = instância |
| `fblDesNome` | `nomeEtapa` | 11 valores distintos na amostra: `CONTROLLER` (105), `TI` (22), `WALTER` (14), `DIRETORIA II` (7), `COMERCIAL/MARKETING` (7), `FISCAL` (6), `OPERACIONAL` (6), `COORDENADOR FISCAL` (4), `FINANCEIRO` (3), `DIRETOR DE NEGOCIOS - PRICING` (2), `RECURSOS HUMANOS` (1). **Config do cliente** |
| `aprovador` | `alcadaRotulo` | **Mistura setor e pessoa** (`COMPRAS` 127, `RICARDO DO PRADO` 22, `FISCAL` 5…). É rótulo de alçada, **não identidade** |
| `fbaDesNome` | `acao` | `LIBERAR` (122), `APROVAR` (34), **vazio** (21). São **duas ações distintas** — a diferença de negócio é PENDENTE **V2** |
| `usnDesNomeCmd` | `pessoaNome` | **Quem agiu.** 14 pessoas; `DANILO_LARA` = 48% das resolvidas. Vazio nas pendentes |
| `ftbVldStatus` | `statusOrigemBruto` → `statusEtapa` | `1` pendente (8) · `2` respondido (156) · **`7` sem legenda (13)**. Mapa é **config** |
| `ftbTimBloq` | `recebidaEm` | **epoch ms, com HORA.** Campo `Tim*` |
| `ftbTimCmd` | `respondidaEm` | **epoch ms, com HORA.** Nas pendentes vem igual a `ftbTimBloq` → tratar como `null` |

## O que o `psq014/list` fornece (cabeçalho do snapshot)

`docEspNumero`, `docDtaEmissao`, `titDtaVencimento`, valor, moeda, credor/`pesCod`,
`usnDesNomeFimDoc`. É a origem do cabeçalho da `TrilhaAprovacao` e das dimensões `[FASE-2]`.

## ⛔ O que está BLOQUEADO — `fin103/list`

`POST fin103/list` devolve **`count = 0`** em **todas as filiais, em produção e em homologação**,
mesmo havendo títulos bloqueados. O spec do Conexos explica: o usuário precisa ser *"liberado para a
empresa (filial) e a **tela** onde a API está relacionada"*. **Nosso usuário de API não tem
`fin103`.**

**O acesso resolveria três coisas de uma vez:**

1. **Custo.** Hoje a trilha custa **1 chamada por título** (23.632 títulos só na filial 2, 12 meses).
   Com o `fin103/list` viraria **uma varredura paginada** — duas ordens de grandeza mais barata.
2. **Campos que faltam.** `docDtaFinalizacao` (**o marco zero do relógio do cliente**), `usnCodCmd`
   (código estável da pessoa, chave do analítico `[FASE-2]`), `acdCod`, `wffUuid`, `fbaVldAcao`,
   `motCodCanc`, `ftbEspInfo`/`ftbEspObsCmd`.
3. **Legendas dos enums**, via o `configList` do endpoint de log da tela.

**Ação em aberto:** pedir ao administrador do Conexos da Columbia a liberação do usuário de
integração para **`fin103`** (e, se formos ler configuração de alçadas, **`fin102`** e **`fin106`**).
É o item de maior prazo e **não depende de nós**. Ver PENDENTE **V8**.

## O que NÃO está aqui (e por quê)

- **`fin026/list`** — carteira **corrente**; perde o histórico. **Não é o universo.**
- **`fin026/log`** — é auditoria de verdade (`logList`), mas veio **VAZIA em todos os títulos**. Não
  serve como fonte da trilha. O `configList` da mesma resposta, sim, traz as legendas dos enums.
- **`psq027`** — a tela onde o Yuri viu a trilha **existe** (responde 405, não 404), mas não aceita
  `POST` nos paths testados. **Não é necessária**: o `fin026/infoTitulo/list` entrega o mesmo dado.
- **`fin102` / `fin106`** — cadastro de bloqueios e alçadas (`FinBloq`, `FinBloqAlca`, `FinBloqHier`).
  Sem acesso, e fora de escopo: a Frente V é track, não motor de alçada. Consequência: **não sabemos
  o total de etapas planejadas** de um título, só as conhecidas.
- **Endpoints de ESCRITA** — `fin103/aplicarComando`, `com308/.../trocaBloqueio`,
  `com308/.../regerarBloqueios`, `fin103/bloqueioManual` e `.../cancela`. **Documentados e
  deliberadamente NÃO usados** (decisão D2: track only). `regerarBloqueios` entra na ontologia
  **apenas como fenômeno observado** (I-Aprov-4).

## Armadilhas confirmadas (todas medidas, nenhuma hipotética)

1. **`filCod` errado → `count: 0` SEM ERRO.** O doc 4156 mora na filial 1; consultá-lo como filial 2
   retorna vazio. O `filCod` tem de vir do próprio registro. → `business-rules/filcod-da-trilha.md`.
2. **A escada `titVld1/2/3Libera` é VESTIGIAL.** Vale `1` em **100%** dos títulos, sem timestamps e
   sem nomes. **`titVldNLibera = 1` NÃO significa "o nível N aprovou".** Não modelar como trilha.
3. **Grafia varia por endpoint e não é intercambiável.** `fin026/list` usa `titVld1Libera`
   (L maiúsculo); `fin026/infoTitulo` usa `titVld1libera` (minúsculo). Trocar devolve **500**. Zod
   tolerante a ambas as grafias no boundary.
4. **`Tim*` preserva hora; `Dta*` é data pura** (meia-noite). O `configList` confirma:
   `titTim1Libera → DATETIME`, `titDtaVencimento → DATE`. **Não aplicar o `BR_NOON_SHIFT_MS` (+15h)
   aos `Tim*`** — deslocaria a série inteira.
5. **Operadores de intervalo existem, com epoch ms:** `#GE` `#GT` `#LE` `#LT` funcionam.
   **`#BETWEEN` NÃO existe.** String ISO é recusada (`ECnxDataType can't be converted to Date`).
6. **`fin103/list` exige `filCod#EQ`** — sem filtro, ou só com `docTip#EQ`, devolve **400**.
7. **`psq014/infoTitulo/list` exige** os filtros `fExibirPrevisao` e `fExibirRenegociados`.

## Volume medido (produção, filial 2, emissão desde 2025-08-01)

| Métrica | Valor |
|---|---|
| Universo total de títulos a pagar no ERP | **23.632** |
| Amostra detalhada (1ª página do `psq014/list`) | 300 |
| Com trilha de aprovação | **148 (49,3%)** |
| Etapas encontradas | 177 (169 resolvidas + 8 pendentes) |
| Etapas distintas / aprovadores distintos | **11 / 14** |
| Duração: média / mediana / p90 / máx | **20,4 h / 2,5 h / 70 h / 234,4 h** |

> ⚠️ A amostra é a **primeira página**, não uma amostra aleatória. Serve para dimensionar e
> caracterizar; **não** é estimativa estatística com intervalo de confiança.

## Limitação operacional

O Conexos limita **sessões simultâneas por usuário** (`LOGIN_ERROR_MAX_SESSIONS`). A Frente V
adiciona **mais um cron** disputando os mesmos ~3 slots com o app, com Permutas (`0 9,15,21`), SISPAG
(`0 10`) e extratos (`20 * * * *`). O **usuário-robô dedicado** (débito P1 aberto desde a Frente IV)
deixa de ser conveniência e passa a ser **pré-requisito prático** do backfill de 23 mil chamadas.

## Subproduto sugerido

`docs/conexos-api/screens/` documenta hoje `cmn023`, `cmn025`, `cmn156`, `com006`, `com014`, `com015`,
`com016`, `com017`, `com034`. **Nenhuma tela de aprovação/bloqueio está documentada.** A Frente V
deve produzir `screens/psq014.md` e `screens/fin026.md` no template existente, alimentados pelo probe.
````

---

### 3.12 `ontology/glossary.md` — nova seção (inserir após a Frente IV, antes de "Transversais")

````markdown
## Frente V — Workflow de Aprovação (rastreamento, read-only)

Rastreamento da cadeia de aprovações dos **títulos a pagar** no Conexos. **Somente leitura** — nada
é aprovado, liberado ou escrito pela ferramenta. Ver
[ADR-0038](decisions/0038-bootstrap-frente-v-workflow-aprovacao.md).

| Termo | Definição |
|-------|-----------|
| **Bloqueio** | O mecanismo com que o Conexos implementa aprovação: uma **trava nomeada** sobre um título (`FinTituloBloq`), que só sai quando alguém com a alçada certa aplica um comando. **Não confundir com "pendência bloqueada" da Frente I** (que é um caso de permuta que depende de terceiros, sem relação com alçada) nem com o "rascunho" da Frente III (NC/ND travada por falta de PDF). Aqui, bloqueio **é** a etapa de aprovação. |
| **Etapa (de aprovação)** | Uma instância de bloqueio sobre um título — a unidade da trilha (`fblCod`+`ftbCod`), com nome (`fblDesNome`), alçada, ação, pessoa e dois carimbos de hora. **Não confundir com "nível de alçada" da Frente II** (`titVld1/2/3libera`), que é a **escada vestigial** e não corresponde a etapa nenhuma. |
| **Trilha (de aprovação)** | O conjunto das etapas de **um** título, com o status agregado e o relógio. É a entidade `TrilhaAprovacao`. **Não confundir com "trilha de auditoria"** (transversal, registro de tudo que a *ferramenta* fez) nem com o "write-ahead ledger" (Frentes I/IV), que registra intenção **nossa** de escrever. |
| **Alçada** | O **rótulo do responsável** por uma etapa (campo `aprovador`). Mistura setor (`COMPRAS`) e pessoa (`RICARDO DO PRADO`) — é rótulo, **não identidade**. Quem efetivamente agiu é `usnDesNomeCmd`. **Não confundir com "níveis de alçada" da Frente II**: a escada `titVld1/2/3libera` é vestigial e **não** é alçada de verdade. |
| **Aprovador** | Dois sentidos, deliberadamente separados na ontologia: (a) **o rótulo de alçada** (campo `aprovador` do ERP — quem *deveria* responder); (b) **a pessoa** que respondeu (`usnDesNomeCmd`, propriedade `pessoaNome`). O analítico da Fase 2 usa **(b)**. Quando este documento diz "aprovador" sem qualificar, é (b). |
| **Comando** | A ação aplicada pelo aprovador sobre um bloqueio (`fbaDesNome` / `fbaVldAcao`); o instante fica em `ftbTimCmd`. Observados na Columbia: **`LIBERAR`** e **`APROVAR`**. **Não confundir com "gate de finalização" (Frente II)** nem com **`aprovarRecebimento` (Frente IV)** — esses são decisões **da analista dentro da nossa ferramenta**; comando é ato **dentro do ERP**, que só observamos. |
| **LIBERAR × APROVAR** | Os dois comandos observados (122 × 34 na amostra). **A diferença de negócio ainda NÃO foi confirmada** — a premissa vigente é que ambos classificam como `APROVACAO`. Ver PENDENTE V2. |
| **Liberação** | O efeito de um comando que tira o bloqueio, deixando o título andar. **Não confundir com "baixa"** (Frentes I e IV — quitação do título no `fin010`/`fin014`), nem com **"liberado para remessa"** (Frente II — título elegível a entrar no lote SISPAG). Liberar ≠ pagar. |
| **Escada de 3 liberações** | `titVld1/2/3Libera` + `titTim*` + `usnDesNome*Lib`, gravados no próprio título. **VESTIGIAL na Columbia:** vale `1` em 100% dos títulos, sem timestamps e sem nomes. **`titVldNLibera = 1` NÃO significa "o nível N aprovou".** Termo mantido no glossário **para que ninguém volte a modelá-la como trilha**. |
| **`wffUuid`** | UUID do workflow no `FinTituloBloq` — correlaciona as etapas de **uma mesma execução** de workflow. Seria a chave natural exata para distinguir "esta trilha" de "a trilha regerada". ⚠️ **Não vem na projeção acessível hoje**; a detecção de regeração é feita por inferência (I-Aprov-4) até o `fin103` ser liberado. |
| **Trilha regerada** | O ERP reescreveu as etapas de um título (`regerarBloqueios`). As etapas antigas viram `SUBSTITUIDA` no nosso modelo — **nunca apagadas** — e o título pode voltar de `APROVADO` a `AGUARDANDO`. Ver I-Aprov-4. |
| **`SEM_WORKFLOW` × `INDETERMINADO`** | `SEM_WORKFLOW` = **afirmação** ("este título não passa por aprovação"), possível só após leitura bem-sucedida com o `filCod` do próprio registro; **metade dos títulos**. `INDETERMINADO` = **ignorância declarada** (leitura falhou, status sem legenda, só etapas canceladas). **Nunca se colapsam.** Ver I-Aprov-2. |
| **Origem `ERP` × `DERIVADO`** | Marcação obrigatória em cada evento da timeline: `ERP` quando o carimbo veio de um campo do Conexos; `DERIVADO` quando é constatação nossa por comparação de snapshots. Nunca apresentar inferência como registro do ERP. Ver I-Aprov-5. |
| **Snapshot** | O retrato da trilha de um título numa rodada de ingestão, identificado por `snapshotHash`. O painel **declara** de quando é o retrato que está mostrando (`snapshotEm`). |

> **Desambiguação transversal — a palavra "aprovação" aparece em quatro frentes com sentidos
> diferentes:**
>
> | Onde | O que significa | Quem decide |
> |---|---|---|
> | **Frente I** — aprovação de borderô / alocação N:M | a analista confirma o casamento adto↔invoice antes da baixa | **nós** (gate na ferramenta) |
> | **Frente II** — "aprovado para baixa" / gate de finalização do lote | (a) `vldLib` do `fin064` marca o título elegível; (b) a analista finaliza o lote | (a) **ERP** · (b) **nós** |
> | **Frente IV** — `aprovarRecebimento` | a analista aprova a conciliação antes de executar | **nós** (gate na ferramenta) |
> | **Frente V** — etapa de aprovação / comando | um gestor libera/aprova um bloqueio **dentro do Conexos** | **ERP** — nós só **observamos** |
>
> E, para fechar: **a Frente V não emite documento algum.** Não há NC/ND (Frente III) nem NDe
> (Frente IV) envolvidas — o único elo entre elas e esta frente é a palavra "aprovação", que aqui não
> produz papel nenhum.
````

---

### 3.13 `ontology/decisions/0038-bootstrap-frente-v-workflow-aprovacao.md` — NOVO

> ⚠️ **Numeração — DUPLICATAS ENCONTRADAS em `ontology/decisions/`.** Confirmado por listagem:
>
> | Número | Arquivos | Situação |
> |---|---|---|
> | **0034** | `0034-gcd-da-sn-resolvido-por-historico-do-processo.md` **e** `0034-maquina-de-estados-da-transacao-ganha-writers.md` | **duplicado** |
> | **0036** | `0036-descricao-item-nde-no-documento.md` **e** `0036-homologacao-da-nde-medida-pelo-estado-gravado.md` | **duplicado** |
>
> O maior número em uso é **0037**. **Próximo livre: `0038`** — usado abaixo. **As duplicatas não são
> resolvidas por este rascunho** (renumerar quebra referências cruzadas em `_coverage.json`,
> `_index.json` e em vários `.md`); ficam registradas como item de higiene no §4.

````markdown
---
adr_number: 0038
title: Bootstrap Frente V — Workflow de Aprovação (rastreamento read-only de Contas a Pagar); a trilha REAL é a fila de bloqueios FinTituloBloq e a escada titVld1/2/3Libera é VESTIGIAL (corrige entities/titulo-a-pagar.md); o universo é psq014/list e NÃO fin026/list; histórico materializado localmente em 3 entidades novas (TrilhaAprovacao, EtapaAprovacao, EventoAprovacao) com evento append-only e proveniência ERP|DERIVADO; INDETERMINADO é estado de primeira classe e SEM_WORKFLOW nunca é derivado de erro; fin103 BLOQUEADO por falta de acesso do usuário de API; estende o escopo de 4 frentes (ADR-0022) para uma 5ª
date: 2026-08-19
status: accepted
type: addition
related_entities: [TrilhaAprovacao, EtapaAprovacao, EventoAprovacao, TituloAPagar]
related_actions: [ingerirTrilhaAprovacao, exporPainelAprovacoes, detalharTrilhaAprovacao]
related_integrations: [conexos-fin026-fin103-aprovacao]
supersedes_decisions: []
amends_decisions: []
---

# ADR 0038: Bootstrap Frente V — Workflow de Aprovação (track read-only)

**Cliente:** Columbia Trading · **Entrega:** Kavex (created by Clonex) · **Branch:** a definir
(worktree próprio, base `main`).
**Relacionado:** ADR-0002 (propósito, 3 frentes) e ADR-0022 (4ª frente) — este ADR **estende** para
uma **5ª**. Herda como template a doutrina de ingestão + agregado local + run de auditoria do SISPAG
(ADR-0016) e da Frente IV (ADR-0023/0028), e a disciplina de proveniência do ADR-0037.
**Fonte:** `ontology/_inbox/frente-v-probe-resultado.md` (probe em **produção**, 2026-08-18, com
autorização explícita do Yuri, **zero escritas**), `frente-v-aprovacoes-conexos-spike.md` (análise
estática, parcialmente corrigida pelo probe), `frente-v-orquestracao.md` (escopo, contrato, riscos).
**`entity_changed = true`** — 3 entidades novas, 3 ações novas, 2 state-machines novas, 6
business-rules novas, 1 integração nova, 1 **correção** em entidade existente.

## Contexto

O cliente pediu um painel que responda, por título: quando o documento foi finalizado, quais etapas
de aprovação existem (ou que **não existe workflow**), quem recebeu cada etapa e quando, quem
respondeu e quando, quanto tempo cada um levou, e o status agregado.

Um primeiro spike, feito por **análise estática dos specs**, concluiu que a trilha era a escada de
três liberações gravada no título e que o workflow era raríssimo (3 títulos em toda a produção). O
Yuri derrubou a conclusão ao ver a trilha completa de uma nota antiga na tela `PSQ_027`. O probe
contra **produção** confirmou: o erro foi de **método** — a varredura usara o `fin026/list`, que
projeta a **carteira corrente** e mede só os títulos **bloqueados agora**.

A realidade medida: **49,3% dos títulos têm trilha**, com **11 etapas** distintas, **14 aprovadores**,
carimbos com **hora**, e **backfill possível**. A distribuição de duração é fortemente assimétrica —
mediana **2,5 h**, p90 **70 h**, máximo **234 h** (≈10 dias) — que é precisamente a dispersão que
justifica o painel: a média sozinha (20,4 h) esconde o problema.

## Escopo (Fase 1)

**Somente Contas a Pagar** (`docTip = 2`), **somente leitura/track** (zero escrita no ERP),
**histórico materializado** no nosso Postgres. **Fase 2** (analítico por fornecedor / cliente final /
funcionário) está **fora de escopo**, mas o modelo a suporta sem reescrita.

Modelado: **3 entidades**, **3 ações** (`actions/aprovacoes/`), **2 state-machines**, **6
business-rules** (I-Aprov-1..6), **1 integração**, **1 correção** em `entities/titulo-a-pagar.md`.
Tudo nasce `planned`.

## Decisões

### D1 — A trilha REAL é a fila de bloqueios; a escada de 3 liberações é VESTIGIAL

`FinTituloBloq` é a instância de uma etapa de aprovação; `fblDesNome` é a etapa, `aprovador` é a
alçada, `fbaDesNome` é a ação, `usnDesNomeCmd` é a pessoa, `ftbTimBloq`/`ftbTimCmd` são os carimbos.
A escada `titVld1/2/3Libera` vale `1` em **100%** dos títulos, **sem** timestamps e **sem** nomes —
**`titVldNLibera = 1` NÃO significa "o nível N aprovou"**.
**Consequência retroativa:** `entities/titulo-a-pagar.md` (Frente II) descreve `aprovado` como o AND
dessas flags. Está **errado** e é corrigido aqui — o **código sempre esteve certo** (usa `vldLib` do
`fin064`). Fecha também a pergunta aberta "quantos níveis de alçada a Columbia usa": não são níveis,
são bloqueios nomeados.
*Alternativa rejeitada:* modelar os dois mecanismos como trilhas paralelas — rejeitada porque um
deles não carrega informação nenhuma e daria a falsa impressão de redundância saudável.

### D2 — O universo é `psq014/list`, não `fin026/list`

`fin026/list` é a **carteira corrente** (só bloqueados agora). `psq014/list` é a tela de **pesquisa**
e cobre o histórico. O doc 4156 existe no `psq014` e não aparece no `fin026`.
*Alternativa rejeitada:* usar a carteira SISPAG já ingerida como universo — rejeitada porque ela
exclui internacional (ADR-0021) e aplica anti-fantasma, e perderia a maior parte das trilhas.

### D3 — `TrilhaAprovacao` é raiz NOVA; `TituloAPagar` NÃO é estendida

Universos, filtros, retenção e propósito diferentes (detalhado em §3.0 do rascunho). A relação é
`0..1—1` **por chave natural, sem FK**, e o cabeçalho do título vive como **snapshot** dentro da
trilha — mesma doutrina do `ItemLote`.
*Alternativa rejeitada:* tabela unificada com `origem_frente` — acoplaria dois crons com regras de
retenção opostas.

### D4 — Histórico materializado: snapshot + evento append-only com proveniência

Três entidades: `TrilhaAprovacao` (raiz + snapshot), `EtapaAprovacao` (a unidade de medida) e
`EventoAprovacao` (log append-only). O evento existe porque (a) o `fin026/log` do ERP veio **vazio**;
(b) `regerarBloqueios` reescreve a fila; (c) `[FASE-2]` com dimensões materializadas o analítico é um
`GROUP BY`.
*Alternativa rejeitada:* derivar a timeline por projeção sobre as etapas — não sobreviveria a uma
regeração e exigiria join retroativo contra dados que o ERP talvez já não tenha.

### D5 — Track only: ZERO escrita no ERP

Nenhum `aplicarComando`, `trocaBloqueio`, `bloqueioManual` ou `regerarBloqueios`. `regerarBloqueios`
entra na ontologia **apenas como fenômeno observado** (I-Aprov-4). Dispensa gates de write-back,
alçada e homologação de escrita.

### D6 — `INDETERMINADO` é estado de primeira classe; `SEM_WORKFLOW` nunca é derivado de erro

Metade dos títulos legitimamente não tem workflow. Se "não consegui ler" também virar
`SEM_WORKFLOW`, o estado mais comum do painel vira o esconderijo de toda falha de integração.
Formalizado em I-Aprov-2 e na transição **proibida W9**.
*Alternativa rejeitada:* usar `null` para o desconhecido — vira célula vazia na UI, indistinguível de
"ainda não carregou".

### D7 — A identidade da pessoa é o NOME normalizado, com dívida declarada

`usnCodCmd` **não vem** na projeção acessível. A chave provisória do analítico é
`pessoaNomeNormalizado`; a coluna `pessoaCod` já existe no modelo para não exigir migration quando o
`fin103` liberar. Risco de homônimo **declarado**, não escondido (PENDENTE V9).

### D8 — `REJEITADO` é declarado, mas nunca foi observado

Nenhuma recusa apareceu na amostra (só `LIBERAR`, `APROVAR` e vazio). O estado e a transição W6 ficam
no desenho — acrescentá-los depois mudaria o enum público do contrato e a UI — com o mapeamento
`fbaDesNome → REJEICAO` **vazio** até a Columbia responder (PENDENTE V7).

### D9 — A Fase 2 é preparada por disciplina de schema, não por código

Três decisões da Fase 1 determinam se a Fase 2 é barata: evento append-only com **duração
materializada**; **chave estável de ator** (declarada como dívida); **dimensões de negócio**
(`fornecedorCod`, `clienteFinalCod`) gravadas **no momento da ingestão**. Nenhuma UI, nenhuma API e
nenhuma agregação de Fase 2 são implementadas agora.

### D10 — Estende o escopo de 4 frentes (ADR-0022) para uma 5ª

Não supersede nada. Mantém os invariantes transversais: human-in-the-loop (aqui, trivialmente — a
ferramenta não decide nada), auditoria com proveniência, idempotência da ingestão, multi-filial.

## Consequências

- O domínio ganha uma frente inteira em nível **estrutural**, tudo `planned`.
- **Reúso alto** com o que já existe: ingestão (cron + manual + advisory lock + chave natural + run
  de auditoria + `partial`), agregado local persistido, painel que lê do banco, `BoundedConcurrency`
  achatado, `ports` + `Symbol` tokens + contêiner por frente para o paralelismo das 3 fatias.
- **Correção retroativa** na Frente II (`titulo-a-pagar.md`) e fechamento de um `open_gap`
  ("níveis-de-alçada (Flávia)") que estava mal formulado.
- **Custo operacional novo:** enquanto o `fin103` estiver bloqueado, a ingestão custa **1 chamada por
  título** e o backfill precisa ser **interrompível e retomável**. Mais um cron disputando os slots
  de `LOGIN_ERROR_MAX_SESSIONS` — o **usuário-robô dedicado** deixa de ser conveniência.
- **Seis pontos do modelo dependem de resposta humana** (V1–V6 no rascunho), com premissa adotada e
  impacto declarado para cada um. Nenhum bloqueia o desenho; todos podem mudar rótulo, enum ou
  cálculo.

## Universalidade

O rastreamento de uma cadeia de aprovações de contas a pagar é universal: todo ERP de médio porte
implementa aprovação como trava por alçada, e "onde parou / há quanto tempo / com quem" é a pergunta
padrão do controller. A **estrutura** modelada aqui — trilha por título, etapa como unidade de
medida, evento append-only com proveniência, "não tem" ≠ "não sei", duração corrida com recusa a
estimar — é do domínio.

São **config do cliente**: os 11 nomes de etapa, as 14 pessoas, os rótulos de alçada, o vocabulário
`LIBERAR`/`APROVAR`, o mapa `ftbVldStatus → estado`, as filiais, a janela, a cadência, o fuso e
qualquer SLA.

⚠️ **Ressalva honesta:** a frente foi observada em **um** cliente e **um** ERP. O argumento de
universalidade se apoia em (i) o mecanismo ser feature de produto do Conexos (schema declarado em
quatro famílias), e (ii) o conceito ser genérico de contas a pagar. Se a segunda observação (outro
cliente, outro ERP) contrariar, o candidato a revisão é a **granularidade** (trilha/etapa/evento),
não o conceito.

## Índice / coverage a regenerar

Esta mudança **adiciona** (tudo `planned`): entities **+3**; actions **+3**; state_machines **+2**;
business_rules **+6**; integrations **+1**. Versão da ontologia **0.19.1 → 0.20.0**.

⚠️ **Drift detectado a corrigir junto:** `_index.json` lista **17** entidades e **20** business-rules,
enquanto `_coverage.json` declara `entities_total: 16` e `business_rules_total: 19` — `_coverage`
está **uma entidade e uma regra atrás** (`SolicitacaoNumerario` está no índice e não no coverage).
Ver §3.15 do rascunho.

## Reúso / linhagem

Estende ADR-0002 e ADR-0022 (5ª frente). Herda: doutrina de ingestão persistida do **ADR-0016**
(SISPAG); dedup por chave natural + `UNIQUE` no banco + `id` determinístico do **ADR-0023/0032**
(extrato); cadência/piso/`partial` do **ADR-0028**; proveniência declarada por linha do **ADR-0037**
(`origem: 'ferramenta' | 'erp'`); armadilha de "zero linhas sem erro" do **ADR-0037/E2**. **Corrige**
a descrição de `aprovado` introduzida no **ADR-0016**. Não reinventa — aplica o inbound/outbound já
validado a um terceiro eixo: **observação**.
````

---


### 3.14 `ontology/relationships.md` — nova seção (acrescentar ao fim)

````markdown
## Frente V — Workflow de Aprovação

> Sync 2026-08-19 (ADR-0038). Relações do rastreamento de aprovação. **Nenhuma FK atravessa a
> fronteira com a Frente II** — a ligação `TrilhaAprovacao ↔ TituloAPagar` é por **chave natural**,
> porque o universo da Frente V (`psq014`, histórico) é maior que a carteira SISPAG (`fin064`,
> corrente + filtro-out internacional).

| Origem | Relação | Destino | Cardinalidade |
|--------|---------|---------|---------------|
| `TrilhaAprovacao` | agrega as etapas de bloqueio do título | `EtapaAprovacao` | 1—N (chave `fblCod:ftbCod`; 177 etapas em 148 trilhas na amostra) |
| `TrilhaAprovacao` | registra o que foi observado (append-only) | `EventoAprovacao` | 1—N |
| `EtapaAprovacao` | origina os eventos da sua própria vida | `EventoAprovacao` | 1—N (`etapaId` nulo nos eventos de trilha) |
| `TrilhaAprovacao` | descreve o MESMO título do ERP | `TituloAPagar` | 0..1—1 (via `filCod:docCod:titCod`; **sem FK** — a trilha existe para títulos que a carteira SISPAG não ingere) |
| `TrilhaAprovacao` | pertence a | `Filial` | N—1 (via `filCod`; **nunca de default** — I-Aprov-6) |
| `EtapaAprovacao` | instancia um bloqueio configurado no ERP | `FinBloq` (cadastro Conexos) | N—1 (via `fblCod`) — **deliberadamente NÃO modelado**: `fin102`/`fin106` sem acesso e fora de escopo (track, não motor de alçada) |
| `EtapaAprovacao` | foi respondida por | `Pessoa` | N—1 (via `pessoaNomeNormalizado`) — **NÃO modelada como entidade**: `usnCodCmd` indisponível, identidade instável. Ver watchlist |
| `EventoAprovacao` | carrega dimensões materializadas de | `Fornecedor` / `ClienteFinal` | N—1 cada (via `fornecedorCod` / `clienteFinalCod`) — `[FASE-2]`, gravadas na ingestão para evitar join retroativo |

> **Fase 2 (fora de escopo):** o analítico (tempo médio por fornecedor / cliente final / funcionário)
> é um `GROUP BY` sobre `EventoAprovacao` — nenhuma entidade nova é necessária, desde que a Fase 1
> materialize as dimensões e a duração no evento.
````

---

### 3.15 `_index.json` e `_coverage.json` — impacto

#### Drift a corrigir junto (não é da Frente V, mas é detectado por ela)

| Contador | `_index.json` | `_coverage.json` | Situação |
|---|---|---|---|
| entidades | **17** | `entities_total: 16` | `_coverage` está atrás — falta `SolicitacaoNumerario` em `by_entity` |
| business rules | **20** | `business_rules_total: 19` | `_coverage` está atrás — falta `descricao-item-nde` no `summary` |
| ações | 24 | `actions_total: 23` | idem (`gerarSolicitacaoNumerarioPermuta`) |

**Proposta:** reconciliar o `_coverage.json` para a base do `_index.json` **antes** de somar a Frente
V, para que os números novos não herdem o erro. Os totais abaixo assumem a base reconciliada.

#### `_index.json` — entradas a adicionar

```jsonc
"entities": {
  "TrilhaAprovacao": {
    "file": "entities/trilha-aprovacao.md",
    "status": "planned",
    "impl_files": [],
    "resolved_by": ["ADR-0038", "probe PRD 2026-08-18 (frente-v-probe-resultado.md)"],
    "note": "Frente V (PLANNED): agregado de rastreamento do workflow de aprovacao de UM titulo a pagar. Universo = psq014/list (historico), NAO fin026/list (carteira corrente). Snapshot local + evento append-only. SEM anti-fantasma. ZERO escrita no ERP."
  },
  "EtapaAprovacao": {
    "file": "entities/etapa-aprovacao.md",
    "status": "planned",
    "impl_files": [],
    "resolved_by": ["ADR-0038"],
    "note": "Frente V (PLANNED): instancia de bloqueio (FinTituloBloq), chave fblCod+ftbCod. Unidade de medida do produto (quem + quanto tempo). ftbVldStatus cru SEMPRE preservado (permite reclassificar sem reingerir 23k titulos)."
  },
  "EventoAprovacao": {
    "file": "entities/evento-aprovacao.md",
    "status": "planned",
    "impl_files": [],
    "resolved_by": ["ADR-0038"],
    "note": "Frente V (PLANNED): log append-only com proveniencia ERP|DERIVADO. Existe porque o fin026/log do ERP veio VAZIO e porque regerarBloqueios reescreve a fila. Dimensoes materializadas habilitam a Fase 2 sem reescrita."
  }
},
"actions": {
  "ingerirTrilhaAprovacao":  { "file": "actions/aprovacoes/ingerir-trilha-aprovacao.md",  "entity": "TrilhaAprovacao", "status": "planned", "impl_files": [], "resolved_by": ["ADR-0038"] },
  "exporPainelAprovacoes":   { "file": "actions/aprovacoes/expor-painel-aprovacoes.md",   "entity": "TrilhaAprovacao", "status": "planned", "impl_files": [], "resolved_by": ["ADR-0038"] },
  "detalharTrilhaAprovacao": { "file": "actions/aprovacoes/detalhar-trilha-aprovacao.md", "entity": "TrilhaAprovacao", "status": "planned", "impl_files": [], "resolved_by": ["ADR-0038"] }
},
"state_machines": {
  "aprovacao-titulo": { "file": "state-machines/aprovacao-titulo.md", "entity": "TrilhaAprovacao", "status": "planned", "impl_files": [], "note": "REFLETIDA (estado e do ERP). W9 (AGUARDANDO -> SEM_WORKFLOW) e PROIBIDA: seria o falso negativo do filCod. Nao-monotonica (W7, trilha regerada)." },
  "etapa-aprovacao":  { "file": "state-machines/etapa-aprovacao.md",  "entity": "EtapaAprovacao",  "status": "planned", "impl_files": [], "note": "4 estados do ERP + SUBSTITUIDA (nosso). E8 (delete) PROIBIDA: 'sumiu' != 'nao li'." }
},
"business_rules": {
  "duracao-etapa-aprovacao":     { "file": "business-rules/duracao-etapa-aprovacao.md",     "entity": "EtapaAprovacao",   "invariant": "I-Aprov-1", "status": "planned", "has_test": false, "impl_files": [] },
  "sem-workflow-vs-indeterminado":{ "file": "business-rules/sem-workflow-vs-indeterminado.md","entity": "TrilhaAprovacao", "invariant": "I-Aprov-2", "status": "planned", "has_test": false, "impl_files": [] },
  "idempotencia-ingestao-trilha":{ "file": "business-rules/idempotencia-ingestao-trilha.md", "entity": "TrilhaAprovacao", "invariant": "I-Aprov-3", "status": "planned", "has_test": false, "impl_files": [] },
  "trilha-regerada":             { "file": "business-rules/trilha-regerada.md",              "entity": "EtapaAprovacao",   "invariant": "I-Aprov-4", "status": "planned", "has_test": false, "impl_files": [] },
  "origem-erp-vs-derivado":      { "file": "business-rules/origem-erp-vs-derivado.md",       "entity": "EventoAprovacao",  "invariant": "I-Aprov-5", "status": "planned", "has_test": false, "impl_files": [] },
  "filcod-da-trilha":            { "file": "business-rules/filcod-da-trilha.md",             "entity": "TrilhaAprovacao", "invariant": "I-Aprov-6", "status": "planned", "has_test": false, "impl_files": [] }
},
"integrations": {
  "conexos-fin026-fin103-aprovacao": {
    "file": "integrations/conexos-fin026-fin103-aprovacao.md",
    "direction": "read",
    "status": "planned",
    "impl_files": ["src/backend/jobs/probe-aprovacoes-fin026.ts", "src/backend/jobs/probe-aprovacoes-trilha.ts"],
    "resolved_by": ["ADR-0038", "probe PRD 2026-08-18"],
    "open_gap": [
      "fin103 BLOQUEADO (P0 operacional) — usuario de API sem acesso a TELA; count:0 em todas as filiais, PRD e HML. Sem ele: 1 chamada por titulo (23.632 na filial 2) e faltam docDtaFinalizacao, usnCodCmd, acdCod, wffUuid, fbaVldAcao, motCodCanc",
      "docDtaFinalizacao ausente (P0 de produto) — o 'marco zero' do caso canonico do cliente nao e projetado; candidatos docDtaEmissao / usnDesNomeFimDoc NAO confirmados",
      "ftbVldStatus=7 sem legenda (13 casos na amostra)",
      "LIBERAR x APROVAR — diferenca de negocio nao confirmada"
    ],
    "note": "Superficie de LEITURA do workflow de aprovacao. ARMADILHAS: (1) filCod errado => count:0 SEM ERRO (falso SEM_WORKFLOW); (2) escada titVld1/2/3Libera e VESTIGIAL (=1 em 100%, sem timestamps/nomes); (3) grafia varia por endpoint (titVld1Libera x titVld1libera) e trocar devolve 500; (4) Tim* preserva hora, Dta* nao — NAO aplicar BR_NOON_SHIFT_MS aos Tim*; (5) #GE/#GT/#LE/#LT com epoch ms, #BETWEEN NAO existe. Universo = psq014/list, NAO fin026/list."
  }
}
```

#### `_coverage.json` — `summary` (a partir da base reconciliada)

| Campo | Antes (reconciliado) | Depois |
|---|---|---|
| `entities_total` | 17 | **20** |
| `entities_planned` | 5 → 6 (com `SolicitacaoNumerario`, a confirmar) | **+3** |
| `actions_total` | 24 | **27** |
| `actions_planned` | 6 | **9** |
| `state_machines_total` | 5 | **7** |
| `state_machines_planned` | 3 | **5** |
| `business_rules_total` | 20 | **26** |
| `business_rules_planned` | 9 → 10 | **+6** |
| `business_rules_with_tests` | 6 | 6 (nenhuma nova nasce com teste) |
| `integrations_total` | 5 | **6** |
| `integrations_planned` | 1 | **2** |

`_meta.version`: `0.19.1` → **`0.20.0`** · `_meta.last_feature`: `"frente-v-aprovacoes"`.

#### `_coverage.json` — `health_flags.watchlist[]` (acrescentar)

```
"FRENTE V (ADR-0038) — universalidade observada em UM cliente e UM ERP. O argumento se apoia em (i) FinTituloBloq ser feature de produto do Conexos (schema em 4 familias) e (ii) o conceito ser generico de contas a pagar. Revisitar a GRANULARIDADE (trilha/etapa/evento) se um 2o cliente/ERP contrariar.",
"FRENTE V — entidade Pessoa/Aprovador NAO modelada (REJECT-PREMATURE): a identidade hoje e o NOME (usnDesNomeCmd); usnCodCmd nao vem na projecao. Promover a entidade quando o fin103 for liberado. Risco de homonimo declarado no analitico da Fase 2.",
"FRENTE V — entidades de CADASTRO de alcada (FinBloq, FinBloqAlca, FinBloqHier; telas fin102/fin106) NAO modeladas (REJECT-PREMATURE): sem acesso e fora de escopo (track, nao motor de alcada). Consequencia: nao sabemos o TOTAL de etapas planejadas de um titulo, so as conhecidas — etapasTotais do contrato de API fica null.",
"FRENTE V — REJEITADO declarado e NUNCA OBSERVADO (transicao W6, evento ETAPA_REJEITADA). Nenhuma recusa apareceu na amostra de 177 etapas. O mapa fbaDesNome -> REJEICAO nasce VAZIO. Se a Columbia confirmar que recusa nao existe, avaliar retirar o estado numa curadoria futura.",
"FRENTE V — acesso do usuario de API a tela fin103 e PRE-REQUISITO OPERACIONAL (nao depende de nos): derruba o custo da ingestao em 2 ordens de grandeza e traz docDtaFinalizacao (marco zero), usnCodCmd, acdCod, wffUuid, fbaVldAcao, motCodCanc. Pedir tambem fin102 e fin106 se formos ler configuracao de alcadas.",
"FRENTE V — as 6 business-rules I-Aprov-1..6 nascem SEM teste canonico (planned); testes a fixar pelo TaskScoper/TDD na fatia F1. Ancoras reais ja disponiveis: doc 4156/1 filial 1 (23h29m) e o falso negativo do mesmo doc consultado como filial 2.",
"HIGIENE — ADRs DUPLICADOS em ontology/decisions/: 0034 aparece 2x (gcd-da-sn... e maquina-de-estados-da-transacao...) e 0036 aparece 2x (descricao-item-nde... e homologacao-da-nde...). Maior numero em uso: 0037. Renumerar quebra referencias cruzadas em _index/_coverage/*.md — decidir se renumera com sweep de referencias ou se documenta a colisao.",
"HIGIENE — DRIFT _index x _coverage: _index lista 17 entidades / 24 acoes / 20 business-rules; _coverage declara 16 / 23 / 19. Falta SolicitacaoNumerario em by_entity, gerarSolicitacaoNumerarioPermuta e descricao-item-nde nos contadores. Reconciliar ANTES de somar a Frente V."
```

#### `_coverage.json` — `by_entity` (acrescentar)

```jsonc
"TrilhaAprovacao": { "status": "planned", "actions": ["ingerirTrilhaAprovacao", "exporPainelAprovacoes", "detalharTrilhaAprovacao"], "impl_pct": 0, "resolved_by": ["ADR-0038"], "note": "Frente V Fase 1 (track read-only). Universo psq014/list. 49,3% dos titulos tem trilha (amostra PRD filial 2). SEM anti-fantasma. ZERO escrita no ERP." },
"EtapaAprovacao":  { "status": "planned", "actions": [], "impl_pct": 0, "resolved_by": ["ADR-0038"], "note": "Frente V: FinTituloBloq, chave fblCod+ftbCod. 11 etapas distintas, 14 aprovadores, mediana 2,5h / p90 70h / max 234h. statusOrigemBruto sempre preservado." },
"EventoAprovacao": { "status": "planned", "actions": [], "impl_pct": 0, "resolved_by": ["ADR-0038"], "note": "Frente V: log append-only, origem ERP|DERIVADO obrigatoria. UNIQUE(dedup_key) no banco. Dimensoes materializadas para a Fase 2." }
```

#### `ontology/CHANGELOG.md` — nova entrada

```markdown
## v0.20.0 — Frente V: rastreamento do workflow de aprovação (2026-08-19, ADR-0038)

Feature: `frente-v-aprovacoes`. Bootstrap da **5ª frente** — painel de rastreamento da cadeia de
aprovações dos títulos a pagar. **Track read-only**, histórico materializado localmente.

- **3 entidades novas:** `TrilhaAprovacao`, `EtapaAprovacao`, `EventoAprovacao` (todas `planned`).
- **3 ações novas** (`actions/aprovacoes/`): `ingerirTrilhaAprovacao`, `exporPainelAprovacoes`,
  `detalharTrilhaAprovacao`.
- **2 state-machines novas:** `aprovacao-titulo` (5 estados, W9 **proibida**) e `etapa-aprovacao`
  (5 estados, E8 **proibida**).
- **6 business-rules novas:** I-Aprov-1..6.
- **1 integração nova:** `conexos-fin026-fin103-aprovacao` (`fin103` **BLOQUEADO**).
- **CORREÇÃO na Frente II:** `entities/titulo-a-pagar.md` descrevia `aprovado` como o AND de
  `titVld1/2/3libera`. A escada é **vestigial** (=1 em 100% dos títulos). O código sempre esteve
  certo (`vldLib` do `fin064`); a ontologia é que estava errada. Fecha o `open_gap`
  "níveis-de-alçada (Flávia)".
```

---

### 3.16 Documentação-as-code — arquivos fora de `ontology/` que precisam de diff

Não existe `docs/ontologia.md` neste repo; o documento narrativo é
`docs-contexto/03_ontologia_financeiro.md`.

| Arquivo | O que muda | Prioridade |
|---|---|---|
| `README.md` | "quatro frentes" → **cinco**; nova linha na tabela: **V. Workflow de Aprovação** — "Rastrear a cadeia de aprovações dos títulos a pagar: onde parou, com quem, há quanto tempo. Read-only" · Integra `psq014` + `fin026` (Conexos) | **alta** — é a porta de entrada |
| `CLAUDE.md` | Overview: "quatro frentes" → **cinco**; nova linha na tabela; menção ao ADR-0038 ao lado de 0002/0022; seção **Domain State Machines** deixa de estar vazia (`aprovacao-titulo`, `etapa-aprovacao`) | **alta** |
| `docs-contexto/03_ontologia_financeiro.md` | Nova seção da Frente V (narrativa), com a **correção da escada vestigial** — o doc alimenta o bootstrap da ontologia e propagaria o erro | **alta** |
| `ontology/README.md` | Contadores da linha "20 entidades, ~25 ações…" → atualizar; menção às 5 frentes | média |
| `ontology/glossary.md` | Nova seção (§3.12) | **alta** (parte do delta) |
| `ontology/relationships.md` | Nova seção (§3.14) | **alta** (parte do delta) |
| `docs/conexos-api/screens/` | **Subproduto:** criar `psq014.md` e `fin026.md` no template existente (`_TEMPLATE.md`) — nenhuma tela de aprovação/bloqueio está documentada | média |
| `ontology/_inbox/_watchlist.md` | Acrescentar os itens de watchlist do §3.15 | média |

> **Um aviso de sincronia:** a frase "**quatro frentes**" aparece em `README.md`, `CLAUDE.md` e
> `docs-contexto/03_ontologia_financeiro.md`. Trocar em um e esquecer os outros é o começo do drift
> que a regra documentation-as-code existe para evitar — trocar os três no mesmo commit.

---

## 4. Trade-offs que precisam da decisão do Yuri

Nenhum destes é bloqueante para o rascunho, mas todos mudam o resultado e não devem ser decididos em
silêncio pelo curador.

### T1 — `EtapaAprovacao` como entidade própria × como membro documentado dentro da trilha

- **Como está (proposto):** entidade própria, com arquivo, state-machine e entrada no índice.
- **Alternativa:** documentá-la **dentro** de `entities/trilha-aprovacao.md`, como `ItemLote` vive
  dentro de `lote-pagamento.md` — o que reduziria o delta de 3 para 2 entidades.
- **Por que a proposta é entidade própria:** (a) tem **identidade natural própria**
  (`fblCod`+`ftbCod`) que sobrevive à regeração; (b) tem **ciclo de vida próprio**, e um arquivo de
  state-machine exige um `entity:` no frontmatter; (c) é a **unidade de medida** do produto e do
  analítico da Fase 2. `ItemLote` não tem nada disso — é um snapshot congelado sem ciclo.
- **Custo se estiver errado:** um arquivo a mais e uma linha a mais no índice. Barato de reverter.

### T2 — `EventoAprovacao` na Fase 1 × só na Fase 2

- **Como está:** entra agora.
- **Alternativa:** guardar só snapshots e derivar a timeline por projeção.
- **Por que agora:** o `fin026/log` do ERP veio **vazio**, `regerarBloqueios` reescreve a fila, e o
  §8 da orquestração diz explicitamente que é a decisão da Fase 1 que determina se a Fase 2 é barata
  ou uma reescrita. Adiar significaria não ter histórico de duração para o período entre o go-live e
  a Fase 2.
- **Custo se estiver errado:** uma tabela append-only pouco consultada. Barato.

### T3 — `REJEITADO` no enum sem nunca ter sido observado

Ver D8 do ADR. **Decisão pedida:** manter (proposto) ou retirar até a Columbia confirmar? Retirar
depois é mais caro que manter (enum público do contrato + UI).

### T4 — Política de revisita da ingestão

Uma trilha `APROVADO` pode voltar a `AGUARDANDO` por regeração (W7). Revisitar **todas** as trilhas
resolvidas custa 23.632 chamadas por rodada. Opções: (a) revisitar só `AGUARDANDO`/`INDETERMINADO` +
uma amostra rotativa das resolvidas; (b) revisitar tudo numa cadência baixa (semanal). **Depende de
PENDENTE V6** (com que frequência `regerarBloqueios` é usado). Proposta provisória: **(a)**.

### T5 — Renumerar os ADRs duplicados (0034, 0036)

Renumerar quebra referências cruzadas em `_index.json`, `_coverage.json` e vários `.md`. Opções:
(a) deixar como está e registrar a colisão; (b) renumerar os mais recentes de cada par com sweep de
referências. **Proposta:** (a) por ora — a Frente V usa **0038** e não agrava o problema.

### T6 — Reconciliar `_coverage.json` com `_index.json` no mesmo commit ou em separado

**Proposta:** commit separado **antes** do delta da Frente V, para que os números novos não herdem o
erro e o diff da frente fique legível.

---


## 5. PENDENTE DE VALIDAÇÃO COM O TIME DA COLUMBIA

> **Como ler esta seção.** Cada item traz: a **pergunta** (para quem), a **premissa adotada** no
> rascunho (o modelo funciona hoje assumindo isso) e o **impacto** caso a resposta seja outra —
> quantificado em *o que muda no modelo*. Nenhum item **bloqueia** o desenho; todos podem mudar
> rótulo, enum, cálculo ou custo.
>
> **Prioridade:** 🔴 muda o modelo · 🟠 muda o produto/UI · 🟡 muda operação/custo.
>
> Os quatro primeiros são os que eu levaria à analista **na mesma conversa**, junto com os números do
> §2 do probe — que já são um diagnóstico entregável por si só (11 etapas, 14 aprovadores, mediana
> 2,5 h, cauda de 10 dias).

---

### 🔴 V1 — O que significa `ftbVldStatus = 7`?

**Pergunta (analista / tela do ERP):** `1` = pendente e `2` = respondido estão confirmados. Sobram
**13 etapas** com `ftbVldStatus = 7`. O que a tela mostra nesses casos?

**PREMISSA ADOTADA:** `7` é mapeado para o estado **`DESCONHECIDA`**, que **contamina o título para
`INDETERMINADO`** (transição W5b). O valor cru é **sempre preservado** em `statusOrigemBruto`.

**IMPACTO se a resposta for outra:**
- Se `7` = **cancelado/anulado** → mapear para `CANCELADA`. As 13 etapas saem de `INDETERMINADO`;
  se forem as **únicas** de um título, ele continua `INDETERMINADO` (W5c — cancelamento não é
  aprovação). **Custo: mudança de config**, via transição **E6**, **sem reingerir** os 23.632
  títulos. Foi exatamente para isto que o cru é guardado.
- Se `7` = **aprovado por outra via** (ex.: e-mail — ver V5) → mapear para `RESPONDIDA`, e uma parte
  dos `INDETERMINADO` vira `APROVADO`. Mesma mudança de config.
- Se `7` for **estado transitório** → pode virar `PENDENTE`, e o aging desses 13 títulos passa a
  correr. Muda o KPI de "parados".
- **Em nenhum cenário há migration ou reingestão.** É o retorno concreto de `statusOrigemBruto`.

---

### 🔴 V2 — Qual é a diferença de negócio entre `LIBERAR` e `APROVAR`?

**Pergunta (analista):** são **duas ações distintas** (122 × 34 na amostra). Elas significam coisas
diferentes? Uma é "libera o bloqueio" e a outra é "aprova o valor"? Uma delas pode ser **negativa**
(recusar)?

**PREMISSA ADOTADA:** ambas classificam como **`acaoClasse = APROVACAO`**. O texto cru
(`fbaDesNome`) é **sempre preservado** e **exibido** na timeline; o mapa
`fbaDesNome → acaoClasse` é **config do tenant**, não enum de domínio.

**IMPACTO se a resposta for outra:**
- Se uma delas for **encaminhamento** (passar adiante sem decidir) → nova `acaoClasse =
  ENCAMINHAMENTO`. Uma etapa encaminhada **não** conta como `etapasConcluidas`, e o título **não**
  vai a `APROVADO` só por ela. Muda o KPI de conclusão e a leitura de duração (o relógio da etapa
  seguinte começa no encaminhamento).
- Se uma delas puder ser **negativa** → o mapa passa a produzir `REJEICAO`, a transição **W6**
  (hoje nunca exercitada) ganha vida e o estado `REJEITADO` sai do papel. **Custo: config + testes**;
  nenhuma migration.
- Se forem **etapas de alçadas diferentes com o mesmo efeito** → nada muda; a distinção fica só na
  exibição.
- **Custo em qualquer cenário: mudança de config** — porque o modelo deliberadamente **não** fechou
  o enum em `LIBERAR|APROVAR`.

---

### 🔴 V3 — Qual campo é o "documento finalizado" do exemplo do cliente?

**Pergunta (analista + admin do Conexos):** o caso canônico começa em *"o documento 123 foi
finalizado às 10:00 de 18/08"*. O campo `docDtaFinalizacao` existe no schema **mas não vem** na
projeção acessível. Na tela, "documento finalizado" é qual carimbo? É `docDtaEmissao`? É o momento em
que `usnDesNomeFimDoc` fecha o documento? É outra coisa?

**PREMISSA ADOTADA:** `dataFinalizacao` fica **`null`**, com **lacuna explícita** na trilha
(`"sem marco zero (docDtaFinalizacao não projetado)"`). A timeline **começa em `ETAPA_CRIADA`** e o
`tempoTotalDecorridoSegundos` é **`null`**. **Deliberadamente NÃO caímos** para `docDtaEmissao`
(I-Aprov-1 proíbe substituto silencioso).

**IMPACTO se a resposta for outra:**
- Se **`docDtaEmissao` for equivalente** → o marco zero passa a existir para **100%** dos títulos
  imediatamente, o `tempoTotalDecorrido` popula e o caso canônico fecha **sem depender do `fin103`**.
  ⚠️ Atenção: `docDtaEmissao` é campo `Dta*` (**data pura, sem hora**) — o "às 10:00" viraria
  meia-noite. O total teria granularidade de **dia**, e isso precisa aparecer como lacuna
  (`"marco zero com granularidade de dia"`).
- Se for **`docDtaFinalizacao` mesmo** → depende do **acesso ao `fin103`** (V8). Até lá, a coluna
  fica `—`.
- Se for **outro campo do `psq014`** → passa a ser lido no cabeçalho do snapshot; **custo baixo**
  (uma coluna a mais na projeção), e o `DOCUMENTO_FINALIZADO` vira `origem: ERP`.
- **Este é o item de maior impacto no PRODUTO:** é a única parte do caso canônico do cliente que
  **não fecha hoje**.

---

### 🔴 V4 — `ftbTimBloq` é mesmo "quando o aprovador recebeu"?

**Pergunta (analista):** `ftbTimBloq` é o momento em que **a pessoa recebeu** a etapa, ou é "quando a
**regra** criou o bloqueio" — que pode preceder a atribuição a alguém?

**PREMISSA ADOTADA:** `ftbTimBloq` = **`recebidaEm`**, o início do relógio da etapa. Sustentação
indireta: nas etapas pendentes `ftbTimCmd == ftbTimBloq`, o que é consistente com "criada e à espera
desde então". Por causa da dúvida, o evento **`ETAPA_ATRIBUIDA` NÃO é emitido** na Fase 1 — emitir
dois eventos com o mesmo carimbo seria inventar um fato.

**IMPACTO se a resposta for outra:**
- Se `ftbTimBloq` for **criação pela regra** e a atribuição vier depois → **toda a métrica de duração
  fica inflada**: passaria a medir "criação → resposta" em vez de "recebimento → resposta". A
  mediana de 2,5 h e o p90 de 70 h **mudam de significado** (e o número que já foi mostrado ao
  cliente precisa de ressalva).
- Nesse caso: renomear `recebidaEm` → `criadaEm`, adicionar `atribuidaEm` (só disponível via
  `fin103`), e a duração passa a ter **duas leituras** — "tempo na fila" e "tempo com a pessoa" —
  com a segunda em lacuna até o acesso sair.
- **Custo: renomeação de propriedade + coluna nova + revisão da regra I-Aprov-1.** Nenhum dado é
  perdido (o carimbo continua o mesmo); muda o **rótulo** e o **significado**.
- **Risco de comunicação:** este é o número que mais aparece no relatório ao cliente. Vale confirmar
  **antes** de publicá-lo como "tempo de aprovação".

---

### 🟠 V5 — Aprovação por e-mail conta como etapa?

**Pergunta (analista):** existe `FinBloqEmail` / `fblVldEmailDaprovar` no ERP. Se o aprovador
responde **por e-mail**, isso vira uma etapa com `ftbTimCmd`? E o carimbo é o do **e-mail** ou o do
**processamento** pelo ERP?

**PREMISSA ADOTADA:** toda aprovação que **produz `ftbTimCmd`** é tratada igualmente, independentemente
do canal. O canal **não é modelado** (não há campo acessível que o revele).

**IMPACTO se a resposta for outra:**
- Se o e-mail gerar `ftbTimCmd` com o carimbo do **processamento** (não do envio) → a duração de
  etapas aprovadas por e-mail está **superestimada** pelo tempo de fila do processador. Se o volume
  for material, isso enviesa o p90.
- Se aprovações por e-mail **não** aparecerem na trilha → há um **canal invisível** e o painel
  mostraria como `AGUARDANDO` etapas que já foram respondidas. **Isso seria falso negativo de
  produto** e mudaria a promessa da ferramenta. Mitigação: exibir a lacuna e cruzar com a tela.
- Se houver campo que identifique o canal (via `fin103`) → acrescentar `canalResposta` à
  `EtapaAprovacao` e permitir segmentar as métricas.
- **Custo: uma propriedade nova + segmentação nas métricas.** Estrutural, não disruptivo.

---

### 🟡 V6 — `regerarBloqueios` é usado na operação? Com que frequência?

**Pergunta (analista):** alguém regera a trilha de um título? Em que situações (correção de alçada,
mudança de valor, erro)? É raro ou rotineiro?

**PREMISSA ADOTADA:** **acontece, mas é raro.** O modelo trata regeração como cidadã de primeira
classe (I-Aprov-4, estado `SUBSTITUIDA`, evento `WORKFLOW_REGERADO`, transição não-monotônica W7),
e a **política de revisita** proposta é conservadora: revisitar só `AGUARDANDO`/`INDETERMINADO` +
uma amostra rotativa das resolvidas (trade-off **T4**).

**IMPACTO se a resposta for outra:**
- Se for **rotineiro** → a política de revisita precisa cobrir **todas** as trilhas, e o custo da
  ingestão sobe para **23.632 chamadas por rodada** na filial 2. Isso torna o **acesso ao `fin103`
  (V8) praticamente obrigatório**, não apenas desejável. Também aumenta a proeminência do
  `WORKFLOW_REGERADO` na UI (deixa de ser exceção e vira coluna).
- Se **nunca acontecer** → I-Aprov-4 vira defesa barata (mantém-se: custa uma coluna `vigenteAte`) e
  a revisita pode ser ainda mais espaçada. **Nada é retirado** — a regra continua sendo o que impede
  um `DELETE` acidental.
- **Custo: cadência do cron + orçamento de chamadas.** Não muda estrutura.

---

### 🔴 V7 — Existe **rejeição/recusa** neste workflow?

**Pergunta (analista):** um aprovador pode **recusar** um título, ou só liberar/aprovar (eventualmente
deixando parado)? Se recusa existe, o que aparece na tela?

**PREMISSA ADOTADA:** o estado **`REJEITADO`** e o evento `ETAPA_REJEITADA` estão **declarados** no
modelo, mas o mapa `fbaDesNome → REJEICAO` nasce **vazio** — nenhuma recusa foi observada em 177
etapas.

**IMPACTO se a resposta for outra:**
- Se **recusa existe** e tem um `fbaDesNome` próprio → basta **preencher o mapa de config**; o
  estado, a transição W6 e o evento já existem. **Custo ~zero** — foi exatamente por isso que foram
  declarados (D8).
- Se **recusa não existe** (o título simplesmente fica parado) → `REJEITADO` é código morto. Decisão
  a tomar numa curadoria futura: retirar do enum (quebra o contrato público) ou manter documentado
  como "não aplicável a este tenant". **Proposta: manter** — o enum é do domínio, não do tenant.
- Se recusa for expressa **como cancelamento** (`motCodCanc`) → então `CANCELADA` cobre o caso, e
  `REJEITADO` seria redundante. Isso muda W5c: "só canceladas" deixaria de ser `INDETERMINADO` e
  passaria a ser `REJEITADO`. **Custo: uma transição reescrita.**

---

### 🟡 V8 — O acesso do usuário de API à tela `fin103` será liberado?

**Pergunta (admin do Conexos da Columbia — NÃO é a analista):** liberar o usuário de integração para
a tela **`fin103`** (e, se formos ler configuração de alçadas, `fin102` e `fin106`).

**PREMISSA ADOTADA:** **não será liberado a tempo da Fase 1.** O desenho funciona sem ele: universo
pelo `psq014/list`, trilha por `fin026/infoTitulo/list` (1 chamada por título), backfill
**interrompível e retomável**, e os campos ausentes tratados como **lacuna explícita**.

**IMPACTO se for liberado:**
- **Custo da ingestão cai duas ordens de grandeza** (varredura paginada em vez de 1 chamada por
  título). O backfill deixa de ser um projeto e vira uma rodada.
- **`docDtaFinalizacao`** aparece → resolve **V3** e fecha o caso canônico do cliente.
- **`usnCodCmd`** aparece → resolve **V9**; a chave do analítico `[FASE-2]` deixa de ser o nome.
- **`wffUuid`** aparece → a detecção de regeração deixa de ser inferência e vira exata (I-Aprov-4
  ganha precisão; o evento pode virar `origem: ERP`).
- **`motCodCanc`, `fbaVldAcao`, `ftbEspInfo`** aparecem → `CANCELADA` vira observável (E4 sai do
  papel), e o `configList` do log traz as **legendas dos enums** (resolve **V1** sem depender da
  analista).
- **Nenhuma dessas mudanças exige migration** — todas as propriedades já estão modeladas como
  `null`. É a razão de terem sido modeladas assim.

**É o item de maior prazo e o único que não depende de nós. Pedir hoje.**

---

### 🟠 V9 — Como identificar a pessoa de forma estável (homônimos, mudança de nome)?

**Pergunta (analista / TI):** os nomes vêm como `DANILO_LARA`, `WALTER_CROCE`. Existe risco de duas
pessoas com o mesmo nome de usuário? Nomes mudam (casamento, correção de cadastro)?

**PREMISSA ADOTADA:** `pessoaNomeNormalizado` (trim + upper + colapso de separadores) é a chave de
agrupamento **provisória**. `pessoaCod` (`usnCodCmd`) já existe no modelo, `null` por ora.

**IMPACTO se a resposta for outra:**
- Se houver **homônimos** → o analítico `[FASE-2]` por funcionário fica **incorreto** e não há como
  detectar. Mitigação sem `fin103`: cruzar com o cadastro de usuários (`wrk0`/`com1`), se acessível —
  ou aceitar a limitação e **declará-la no relatório**.
- Se nomes **mudarem** → a série histórica de uma pessoa **quebra em duas**. Mitigação: tabela de
  alias por tenant (config), mantida manualmente.
- **A Fase 1 não é afetada** — o painel mostra o nome que o ERP deu, e está certo. O impacto é
  inteiramente `[FASE-2]`.

---

### 🟡 V10 — Quais filiais entram no escopo e qual é a janela de histórico?

**Pergunta (Yuri + analista):** o probe cobriu filiais 1/2/3. Quantas filiais a Columbia tem, quais
importam para o painel, e quanto histórico o cliente quer ver (12 meses? desde sempre?)?

**PREMISSA ADOTADA:** filiais por config (`APROVACAO_INGEST_FIL_CODS`, vazio = todas), janela de
**12 meses** para o backfill inicial, ingestão incremental por janela curta de `docDtaEmissao`.

**IMPACTO se a resposta for outra:**
- Cada filial adicional **multiplica** o custo do backfill (23.632 títulos foi só a filial 2).
- "Desde sempre" pode tornar o backfill inviável sem o `fin103` (**V8**) — nesse caso, propor um
  **piso de go-live** explícito, como a Frente IV fez com `CONEXOS_EXTRATO_SYNC_START_DATE`
  (ADR-0028): histórico anterior pertence ao processo manual antigo.
- **Custo: config + tempo de backfill.** Não muda estrutura.

---

### 🟠 V11 — O que significa uma etapa **respondida sem ação** (`fbaDesNome` vazio)?

**Pergunta (analista):** 21 das 177 etapas vieram com `fbaDesNome` **vazio**. Algumas delas com
status resolvido. O que aconteceu ali?

**PREMISSA ADOTADA:** a etapa é classificada pelo **`ftbVldStatus`** (que é o campo de estado), e
`acaoClasse` fica **`DESCONHECIDA`**. Se o status for `2`, a etapa é `RESPONDIDA` e **conta** como
concluída; a ação exibida é `—`.

**IMPACTO se a resposta for outra:**
- Se "sem ação" significar **etapa criada e nunca respondida** (apesar do status) → essas etapas
  **não** deveriam contar como concluídas, e alguns títulos hoje `APROVADO` na nossa leitura estão de
  fato `AGUARDANDO`. **Muda o KPI principal do painel.**
- Se significar **liberação automática por regra** (sem pessoa) → é um caminho legítimo, e vale um
  `acaoClasse = AUTOMATICA` para não misturar com aprovação humana no analítico (senão o "tempo médio
  do funcionário" inclui etapas que ninguém tocou).
- **Custo: uma classe a mais no enum de `acaoClasse` + revisão da contagem de `etapasConcluidas`.**

---

### 🟡 V12 — O rótulo de alçada (`aprovador`) é dado de negócio a exibir?

**Pergunta (analista):** o campo mistura setor (`COMPRAS`) e pessoa (`RICARDO DO PRADO`). Isso faz
sentido para vocês na tela, ou é ruído interno do ERP?

**PREMISSA ADOTADA:** é **exibido** como "alçada" ao lado da etapa e serve como filtro secundário;
**não** é usado como identidade nem como chave de agrupamento do analítico.

**IMPACTO se a resposta for outra:**
- Se for **ruído** → sai da tela (fica só no detalhe/exportação). Custo: UI.
- Se for **a dimensão que o controller quer** (ex.: "tempo médio por área") → então o analítico
  `[FASE-2]` precisa de uma **normalização setor × pessoa**, provavelmente com tabela de config, e a
  qualidade dessa dimensão passa a importar. Custo: config + regra de normalização.

---

### 🟡 V13 — Existe SLA? É em horas corridas ou dias úteis?

**Pergunta (controller / analista):** existe um prazo esperado para cada etapa? O relógio para fora
do horário comercial e nos feriados?

**PREMISSA ADOTADA:** **relógio corrido, em segundos**, sem SLA. A formatação usa
`America/Sao_Paulo`. Dias úteis, se existirem, entram como **campo adicional** — nunca substituindo o
corrido (I-Aprov-1).

**IMPACTO se a resposta for outra:**
- Se houver SLA em **dias úteis** → precisa de calendário de feriados (config volátil, por filial) e
  de um segundo campo calculado no backend. **O corrido permanece** — é o único número não
  configurável e comparável.
- Se houver **limiar de alerta** (ex.: "etapa parada > 48 h é crítica") → vira config de UI
  (semáforo) e um KPI novo. Baixo custo.
- ⚠️ **Consequência de comunicação:** a mediana de **2,5 h** e o p90 de **70 h** são **corridos**. Em
  dias úteis, o p90 encolhe bastante. Alinhar antes de publicar o diagnóstico.

---

### 🟠 V14 — As etapas de um título são sequenciais ou paralelas?

**Pergunta (analista):** ~29 títulos têm mais de uma etapa. Quando isso acontece, elas correm **em
série** (uma só começa quando a anterior é respondida) ou **em paralelo** (várias pessoas recebem ao
mesmo tempo)?

**PREMISSA ADOTADA:** o modelo **não assume sequencialidade**. `ordem` é apenas ordenação cronológica
por `recebidaEm`; a `etapaAtual` é a **pendente mais antiga**; e o `tempoTotalDecorrido` é medido de
ponta a ponta (não é a soma das durações das etapas).

**IMPACTO se a resposta for outra:**
- Se forem **estritamente sequenciais** → o "tempo de fila entre etapas" (gap entre a resposta de uma
  e a criação da seguinte) vira uma métrica com significado próprio, e a soma das durações **deveria**
  bater com o total. Divergência viraria sinal de qualidade de dado.
- Se forem **paralelas** (como o modelo assume) → somar durações **superestima** o tempo total, e
  qualquer relatório que faça essa soma está errado. Vale marcar isso explicitamente no analítico
  `[FASE-2]`.
- Se houver **hierarquia declarada** (`FinBloqHier`, `fblCodEnc`) → poderíamos exibir "faltam N
  etapas", o que hoje é impossível (`etapasTotais = null`). Depende de `fin102` (**V8**).
- **Custo: nenhuma mudança estrutural** — muda a interpretação e o que a UI promete.

---

### 🟡 V15 — Contas a Receber e outros tipos de documento ficam mesmo fora?

**Pergunta (Yuri + analista):** o escopo travado é `docTip = 2` (a pagar). Contas a **receber**
(`docTip = 1`) e pedidos usam o mesmo mecanismo de bloqueio. Há demanda?

**PREMISSA ADOTADA:** **fora de escopo** (decisão D1). `docTip` é **propriedade da entidade**, não
constante embutida — o filtro `docTip#EQ: 2` vive na config da ingestão.

**IMPACTO se a resposta for outra:**
- Se a receber entrar → **nenhuma mudança de modelo**: muda a config do filtro, o volume dobra
  (aproximadamente) e o painel ganha um filtro por tipo. Foi por isso que `docTip` é propriedade.
- Se aparecerem **outros mecanismos de aprovação** (ex.: aprovação de pedido em outro schema) → aí
  sim é frente nova, e a granularidade trilha/etapa/evento deveria ser reavaliada contra o novo
  mecanismo antes de reusar.

---

### Resumo — o que levar a quem

| Para | Itens |
|---|---|
| **Analista da Columbia** (uma conversa) | 🔴 **V1** (status 7) · 🔴 **V2** (LIBERAR × APROVAR) · 🔴 **V3** (documento finalizado) · 🔴 **V4** (ftbTimBloq) · 🟠 V5 (e-mail) · 🟡 V6 (regerarBloqueios) · 🔴 V7 (recusa) · 🟠 V11 (etapa sem ação) · 🟠 V14 (paralelo × série) |
| **Admin do Conexos** (pedido, hoje) | 🟡 **V8** — acesso a `fin103` (+ `fin102`/`fin106`) |
| **Controller / gestão** | 🟡 V12 (alçada na tela) · 🟡 V13 (SLA e dias úteis) |
| **TI da Columbia** | 🟠 V9 (identidade estável de usuário) |
| **Yuri** | 🟡 V10 (filiais + janela) · 🟡 V15 (escopo a receber) · e os trade-offs **T1–T6** do §4 |

---

## Fim do rascunho

**Nenhum arquivo da ontologia foi criado ou alterado.** Este documento é a proposta completa; a
escrita acontece quando o Yuri aprovar (integralmente, parcialmente ou com edições).

**Delta proposto, em números:** 3 entidades · 3 ações · 2 state-machines · 6 business-rules ·
1 integração · 1 ADR (**0038**) · 1 correção em entidade existente (`titulo-a-pagar.md`) ·
2 seções novas (`glossary.md`, `relationships.md`) · atualização de `_index.json`, `_coverage.json`,
`CHANGELOG.md` · 6 diffs de documentação fora de `ontology/`.
**Versão da ontologia:** `0.19.1` → **`0.20.0`**.
