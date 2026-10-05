# Ontology Diff Proposal — sispag-excecao-destino

**Tweak:** `sispag-ted-pix` (continuação; branch `worktree-sispag-ted-pix-conexos-fonte-excecao`) ·
**Status:** RASCUNHO, aguardando aprovação do Yuri. Nada em `ontology/` próprio, `_index.json`,
`_coverage.json` ou código foi alterado. `entity_changed = true`.
**Base:** 5 respostas confirmadas pelo usuário (entrevista real) + item 6 (refactor do fluxo por item).
Numeração conferida em `origin/main`: último ADR = 0059 → este é o **0060**; última migration = 0074 →
a nova é a **0075** (reconfirmar contra `origin/main` antes do commit; sessões paralelas colidem).

## 1. Candidate analysis

| Candidato | Filtros | Decisão |
|---|---|---|
| Nova entidade `ExcecaoDestino` (por favorecido, reutilizável, não por item) | A: Y (destino de favorecido diferente do cadastro existe em qualquer pagador; confirmado pelo usuário); B: estrutura no ontology, valores (contas) são dados operacionais; C: Y (controle antifraude, regulatório-operacional); D: não duplica `DestinoManual` (value object por item, que é **substituído**) nem `ExcecaoPermuta` (outro domínio); E: substantivo com ciclo de vida | ACCEPT (flag: universalidade de 1 cliente + usuário; marcar `NEEDS-FRANCINEI` só no ponto "dupla validação" se quiserem confirmar que é prática comum) |
| Máquina de estados da exceção (`PENDENTE → APROVADA → SUBSTITUIDA\|REVOGADA`, `PENDENTE → REJEITADA`) | A/C: Y; E: estados de uma entidade, transições = ações nomeadas (P3) | ACCEPT (novo `state-machines/excecao-destino.md`) |
| Regra de dupla validação rígida (aprovador ≠ cadastrante, permissão nova) | A: Y; C: Y | ACCEPT (invariante nova I12, ver §2) |
| Ações `registrarExcecaoDestino`, `aprovarExcecaoDestino`, `rejeitarExcecaoDestino`, `revogarExcecaoDestino`, `carregarExcecoesDestinoPlanilha`, `aposentarExcecoesSubstituidas` | E: verbos | ACCEPT (um arquivo por ação em `actions/sispag/`) |
| Cadastro Conexos (`cmn025`) como fonte principal; exceção só como fallback | Reforça ADR-0054 D1; inverte D2 (precedência) | ACCEPT — **superseda** ADR-0054 D2, D3 (parcial), D10, D11 |
| Conflito: cadastro válido aposenta a exceção (`SUBSTITUIDA`), divergência é logada | A: Y | ACCEPT. Divergência logada = evento da trilha, **não** entidade nova |
| Trilha só-inclusão, máscara, I10i (titularidade), `DestinoManualValidator` | Já modelados | MANTER (reaproveitar; D: não duplicar) |
| Flag de colunas da planilha da Columbia (nome, layout) | A: N (nunca vista) | REJECT-PREMATURE → watchlist + pergunta aberta Q1; **não inventar colunas** |
| Planilha como entidade (`CargaExcecao`) | B: é mecanismo de entrada, não substantivo do domínio; C: volátil | REJECT-WORKAROUND — a carga é uma **ação** (`carregarExcecoesDestinoPlanilha`) cujo rastro é o campo `origem` + trilha, sem entidade |
| `DestinoManual` por item como entidade/estado paralelo | D: duplica a Exceção | REJECT-DUPLICATE — é **retirado** (ver §2.3) |
| "Cadastro errado/ausente é problema operacional da Columbia no Conexos" | Hábito/processo | REJECT-NOT-DOMAIN — vai só como nota na ADR |
| Limite de valor por exceção, observação do retorno do banco | Adiado em 0054 adendo; sem decisão nova | REJECT-PREMATURE → watchlist |

## 2. Arquivos afetados e diffs

### 2.1 NOVO `ontology/decisions/0060-excecao-de-destino-sispag-cadastro-primeiro.md` (rascunho completo na §3)

### 2.2 `ontology/decisions/0054-destino-de-pagamento-sispag-digitado-no-item.md`

Só frontmatter + marca de superseção; o corpo histórico fica (ADR é registro). Fica `status: accepted`
(D1, D4–D9 e adendos de 29/09 sobre documento e tipos de chave seguem vigentes).

```diff
-supersedes_decisions: []
-amends_decisions: [0039, 0049]
+supersedes_decisions: []
+amends_decisions: [0039, 0049]
+superseded_in_part_by: [0060]   # D2, D3, D10, D11 e D12-tela (ver 0060 §Superseção)
```
```diff
 ## Decisões
+
+> **Superseção parcial (ADR-0060, 2026-10-05).** D2 (digitado vence o cadastro), D10 (aprovação
+> pela própria pessoa) e D11 (PIX CPF/CNPJ sem aprovação) **deixam de valer**: o cadastro do
+> Conexos é a fonte principal e o destino fora dele só existe como `ExcecaoDestino` aprovada por
+> segunda pessoa, para TED **e** PIX. D1 (nunca escrever no `cmn025`), D5 (congelamento), I10g/h/i
+> seguem. O destino por item (`destinoManual`) é substituído pela exceção por favorecido.
```
Marcar também, inline, `D2`, `D10`, `D11` com `*(superseded por 0060)*` no título de cada seção.

### 2.3 `ontology/business-rules/destino-pagamento-sispag.md` (invariante I10, `ontology_version` 0.30.0 → 0.31.0)

**Resolução do destino**
```diff
-destino(item) =
-    item.destinoManual                              se existe     → origem MANUAL
-    senão, TED: conta ATIVA do favorecido no cmn025/ctcorr, ...
-           PIX: chave ATIVA ... (I10k)
-                                                                   → origem CADASTRO
-    senão: nenhum
+destino(item) =
+    1. cadastro: TED conta ATIVA do favorecido no cmn025/ctcorr (qualquer banco, default primeiro)
+                 PIX chave ATIVA do favorecido no cmn025/cmnPessoasPix, ordem I10k   → origem CADASTRO
+    2. senão, ExcecaoDestino do favorecido em estado APROVADA, do tipo da modalidade → origem EXCECAO
+    3. senão: nenhum
```
```diff
-- **Precedência:** o digitado vence o cadastro (ADR-0054 D2). ...
+- **Precedência (ADR-0060):** o cadastro vence. A exceção APROVADA é fallback **só quando o
+  cadastro não tem destino válido** para a modalidade. Cadastro com destino válido nunca é
+  substituído por exceção (decisão de segurança/fraude).
+- **A exceção nunca é escrita no cadastro** (ADR-0054 D1, mantida). Vai no item do `fin015` sem
+  `pctCodSeq`, como o antigo destino digitado.
+- **Cadastro ruim ou ausente é problema operacional da Columbia, a corrigir no Conexos.** A exceção
+  é ponte, não substituto do cadastro.
```
**Invariantes**
```diff
-| **I10e** (D5) | Digitar ou alterar `destinoManual` só com o lote em RASCUNHO ... | edição |
+| **I10e** (ADR-0060) | A exceção **não é editada no item nem no lote**: é cadastrada/aprovada/revogada na entidade `ExcecaoDestino` (I12). No lote, a analista só **vê** a origem do destino. | — |
 | **I10f** (D6) | Congelamento ... | retomada |
+|   | *(texto: "o destino" passa a ser o resolvido, com `excecaoId` da exceção usada, gravado no ledger/assinatura da marca d'água)* | |
-| **I10g** ... trilha ... `lote_pagamento_item_destino_audit`
+| **I10g** | trilha só-inclusão passa a registrar também eventos da exceção (cadastro, aprovação, rejeição, revogação, substituição, divergência, uso) — ver I12e. A tabela `lote_pagamento_item_destino_audit` é mantida (histórico) e **deixa de receber novas linhas**; a nova trilha reaproveita o padrão (trigger recusa UPDATE/DELETE/TRUNCATE). | sempre |
 | **I10h** mascaramento | mantido; `MaskDestino` reaproveitado |
 | **I10i** titularidade | mantido: CPF/CNPJ da exceção = `pdcDocFederal` do favorecido; chave PIX só CPF/CNPJ (ou, quando a Q5 for respondida, ver abaixo); aplicada **no cadastro da exceção e de novo no envio** |
-| **I10j** aprovação pela própria pessoa ... | **REVOGADA.** Substituída por I12 (dupla validação rígida, TED e PIX). |
-| **I10k** | mantido para a ordem das chaves do **cadastro**; a sugestão de aba PIX na tela fica sobre o cadastro, sem referência a "digitar" |
```
**Nova seção "Exceção de destino (I12)"** (mesmo arquivo, ou arquivo próprio `business-rules/excecao-destino-sispag.md` — preferência: arquivo próprio, mantendo este curto; decidir na aprovação):

| # | Regra |
|---|---|
| **I12a** | `ExcecaoDestino` é **por favorecido** (`pesCod`) e por tipo (`CONTA` \| `CHAVE_PIX`), reutilizável em qualquer lote; não é por item. No máximo **1 APROVADA por (favorecido, tipo)**; nova aprovada move a anterior para `SUBSTITUIDA`. |
| **I12b** | **Dupla validação (hard, no backend, não só na UI):** `aprovadoPor ≠ cadastradoPor` (comparado pelo id do usuário autenticado, não pelo e-mail digitado) e o aprovador tem a permissão nova (nome em Q2). Vale para **TED e PIX**. Violação = `ExcecaoAprovacaoProprioCadastranteError` / `ExcecaoAprovacaoSemPermissaoError`. |
| **I12c** | **Cadastro vence:** só entra na resolução se o cadastro não tem destino válido para a modalidade. Na transição, se o cadastro passa a ter destino válido, a exceção APROVADA vai a `SUBSTITUIDA` (nunca usada). Se o valor do cadastro **difere** da exceção, grava evento `DIVERGENCIA_CADASTRO` e levanta `Alerta` de revisão (valores mascarados). Se for igual, só `SUBSTITUIDA`. |
| **I12d** | **Carga em lote (planilha):** cria só `PENDENTE`, com `origem = PLANILHA` e id da carga; **recarga** não aprova nem altera aprovadas: linha idêntica a exceção existente = ignorada; linha diferente = nova `PENDENTE` (a aprovada vigente continua valendo até aprovação da nova). Nenhum caminho cria `APROVADA` direto. |
| **I12e** | **Trilha só-inclusão** de todos os eventos (quem, quando, antes/depois mascarados na leitura, completos no banco), mesmo padrão e trigger de `lote_pagamento_item_destino_audit`. |
| **I12f** | **Falha fechada:** `finalizarLote` barra item TED/PIX sem destino resolvível (cadastro ou exceção APROVADA); o envio reconfere ao vivo (cadastro primeiro, depois exceção + I10i) antes do `criarLote`. Exceção `PENDENTE`/`REJEITADA`/`REVOGADA`/`SUBSTITUIDA` **nunca** resolve. |
| **I12g** | Revogar (`REVOGADA`) vale para lotes ainda não importados no `fin015`; lote com destino já congelado (I10f) segue o regime de cancelamento do lote nativo, sem reescrita. |

Premissas H3/H5 (fin015 aceita destino sem `pctCodSeq`) **continuam valendo e não estão provadas**; as flags `SISPAG_TED_ENABLED`/`SISPAG_PIX_ENABLED` seguem. `SISPAG_DESTINO_MANUAL_ENABLED` passa a significar "exceção de destino habilitada" — ver Q6 (renomear ou manter o nome).

### 2.4 `ontology/entities/lote-pagamento.md`

```diff
-  - itens[].destinoManual
+  - itens[].destinoOrigem
 relationships:
-  - "ItemLote 0..1—1 DestinoManual (value object ...; ADR-0054)"
+  - "ItemLote N—0..1 ExcecaoDestino (a exceção APROVADA usada como destino; ADR-0060; vazio quando o destino vem do cadastro)"
```
Propriedades do `ItemLote`:
```diff
-| `destinoOrigem` | enum? (derivado) | — | `MANUAL` se há `destinoManual`; `CADASTRO` ... |
-| `destinoManual` | DestinoManual? | `lote_pagamento_item.destino_*` | Destino digitado ... |
+| `destinoOrigem` | enum? (derivado) | — | `CADASTRO` (cmn025 ao vivo) \| `EXCECAO` (ExcecaoDestino aprovada, fallback) \| `null` para boleto. Dirige o selo "exceção" na tela. |
+| `excecaoDestinoId` | string? | `lote_pagamento_item.excecao_destino_id` *(a criar)* | FK lógica para a exceção usada, **gravada na hora em que o destino congela** (I10f) — liga o item à exceção sem copiar o valor. |
```
Remover a tabela "Value object `DestinoManual`" (movida para `entities/excecao-destino.md`; campos `tipo`, `bancoCod`, `agencia*`, `conta*`, `chavePixTipo`, `chavePix`, `titularDocumento` seguem iguais; `aprovacao`/`aprovadoPor`/`aprovadoEm` viram estado/atributos da exceção). Em "Invariantes aplicáveis", reescrever o bullet I10: tirar "`destinoManual` editável só em RASCUNHO", "conta digitada só sai aprovada por quem tem `sispag:aprovar_destino`", "O digitado prevalece sobre o cadastro"; incluir "cadastro primeiro, exceção APROVADA como fallback (I10, I12)". Ajustar `universality_evidence` (linha do `destinoManual` → "ExcecaoDestino; ADR-0060"). `last_review` e `ontology_version` bump.

### 2.5 NOVO `ontology/entities/excecao-destino.md` (frontmatter pelo padrão da Parte 8)

```yaml
---
name: ExcecaoDestino
type: entity
ontology_version: "0.1"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []   # preenchido na implementação
properties: [id, pesCod, filCod?, tipo, bancoCod, agencia, agenciaDv, conta, contaDv, chavePixTipo, chavePix, titularDocumento, estado, origem, cargaId?, justificativa, cadastradoPor, cadastradoEm, decididoPor, decididoEm, motivoDecisao, substituidaEm, substituidaPorCadastro?, versao]
relationships:
  - "ExcecaoDestino N—1 Favorecido (pesCod no cmn025; sem entidade local, como em TituloAPagar)"
  - "ItemLote N—0..1 ExcecaoDestino (a exceção usada, congelada no import)"
  - "ExcecaoDestino 1—N EventoExcecaoDestino (trilha só-inclusão; não é entidade de domínio, é o ledger)"
last_review: 2026-10-05
universality_evidence:
  - "Entrevista do usuário (Columbia), 2026-10-05: cadastro desatualizado/ausente (12/21 favorecidos sem conta, 0 chave PIX — PRD 2026-09-28, ADR-0054) exige caminho controlado fora do cadastro"
  - "Conceito: toda trading que paga a fornecedor com conta diferente da cadastrada precisa de exceção com dupla aprovação (controle antifraude). Forma (registro por favorecido, 2 pessoas, auditoria) é estrutura; valores (contas) são dado operacional. 1 cliente apenas — revisar universalidade quando aparecer o 2º"
---
```
Corpo: tabela de propriedades (valor completo no banco, mascarado na API — I10h), estados (§2.6), regra de unicidade (I12a), diferença para `DestinoManual` ("era por item; foi substituído"), diferença para `ExcecaoPermuta` ("outro domínio, outro ciclo de vida").

### 2.6 NOVO `ontology/state-machines/excecao-destino.md`

| # | Transição | Ação | Guarda / efeito |
|---|---|---|---|
| E1 | `(novo) → PENDENTE` | `registrarExcecaoDestino` (manual) / `carregarExcecoesDestinoPlanilha` (lote) | Valida formato (`DestinoManualValidator`), titularidade I10i (lê `pdcDocFederal` ao vivo). Exceção por favorecido+tipo; permissão de cadastrar (Q2). Nunca nasce `APROVADA`. |
| E2 | `PENDENTE → APROVADA` | `aprovarExcecaoDestino` | I12b (aprovador ≠ cadastrante + permissão). Reconfere I10i. Move a `APROVADA` anterior (mesmo favorecido+tipo) para `SUBSTITUIDA`. |
| E3 | `PENDENTE → REJEITADA` | `rejeitarExcecaoDestino` | Mesma permissão; motivo obrigatório. Terminal. |
| E4 | `APROVADA → SUBSTITUIDA` | `aposentarExcecoesSubstituidas` (varredura/ao resolver) **ou** E2 de outra exceção | Cadastro passou a ter destino válido (I12c) ou nova exceção aprovada. Terminal. Registra se houve divergência. |
| E5 | `APROVADA → REVOGADA` | `revogarExcecaoDestino` | Permissão de aprovar; motivo obrigatório; qualquer um, inclusive o cadastrante, pode **revogar** (reduz risco; ver Q7). Terminal. |

Estados terminais: `REJEITADA`, `SUBSTITUIDA`, `REVOGADA`. `PENDENTE` nunca é usada no envio.

### 2.7 `ontology/state-machines/lote-pagamento.md`

L2 (linha 96): tirar `informarDestinoItem (ADR-0054)` da lista de ações; remover "destino manual ... só mudam em RASCUNHO ... exige titularidade (I10i), grava trilha (I10g) e é recusado se o item já foi importado". L3 (linha 97): "destino resolvível (I10a — cadastro ou manual)" → "(I10a/I12f — cadastro primeiro, ou exceção APROVADA)"; remover a menção a "conta digitada pendente". Sem mudança nos estados do lote.

### 2.8 `ontology/actions/sispag/finalizar-lote.md`

```diff
-  - "Todo item TED/PIX com destino resolvível — destinoManual ou conta/chave ativa do cadastro cmn025 (I10a, ADR-0054; ...)."
+  - "Todo item TED/PIX com destino resolvível — conta/chave ativa do cadastro cmn025 ou, na falta, ExcecaoDestino APROVADA do favorecido (I10a, I12f; ADR-0054, ADR-0060)."
```
Remover a precondição de "conta digitada pendente" (`DestinoAprovacaoPendenteError`), se existir no corpo.

### 2.9 NOVOS `ontology/actions/sispag/`
`registrar-excecao-destino.md`, `aprovar-excecao-destino.md`, `rejeitar-excecao-destino.md`, `revogar-excecao-destino.md`, `carregar-excecoes-destino-planilha.md`, `aposentar-excecoes-substituidas.md` (frontmatter da Parte 8, `entity: ExcecaoDestino`, `implementation_status: planned`). Pré/pós-condições = transições E1–E5 + I12. `informarDestinoItem` e `aprovarDestinoItem` ficam marcadas como **deprecated** (ver §4) em `gerenciar-lote-candidato.md` se citadas.

### 2.10 `ontology/entities/usuario.md`

Catálogo de permissões: `sispag:aprovar_destino` → substituída/renomeada pela permissão de aprovar exceção (nome em Q2); decidir também se há permissão separada de **cadastrar** exceção (Q2). Papel `Administrador` recebe; `Analista` (migration 0074: sispag somente leitura) **não** cadastra nem aprova, salvo decisão em Q2. Ajustar `related_files` (nova migration, mantendo a 0068 como histórico). ADR-0053 R11 (botão só para quem tem permissão) continua.

### 2.11 Demais

- `ontology/relationships.md`: trocar `ItemLote → DestinoManual` por `ItemLote → ExcecaoDestino (0..1)`; adicionar `ExcecaoDestino → Favorecido(pesCod)`.
- `ontology/glossary.md`: verbetes **Exceção de destino**, **Cadastro (cmn025) como fonte principal de destino**; remover/anotar "destino manual".
- `ontology/_inbox/_watchlist.md` (seção SISPAG, linhas ~117–123): atualizar "Quatro olhos" → agora **implementado em outra forma** (dupla validação por exceção, ADR-0060); "Atualizar `cmn025`" segue fora; adicionar "limite de valor por exceção" e "observação do retorno do banco" como watchlist; adicionar "campos/regras da planilha de exceções" (aguarda Q1).
- `ontology/_index.json`, `ontology/_coverage.json`: **só após aprovação** — entidade nova (`ExcecaoDestino`, planned), 6 ações, 1 state-machine, 1 rule (se arquivo próprio); `ontology_version` minor bump. Contagens "20 entities, ~25 actions, 3 state-machines" do CLAUDE.md serão recalculadas na gravação.
- `ontology/CHANGELOG.md`: entrada `0.31.0`.
- `docs-contexto/03_ontologia_financeiro.md`: grep não achou "destino manual" em `docs/` nem README; verificar `docs-contexto/03_ontologia_financeiro.md` por "ItemLote"/"destino" (não alterado nesta etapa; incluir na aprovação se houver referência).
- `ontology/_inbox/sispag-ted-pix-tasks.md`: as Tasks 2–6 que descrevem `destinoManual`/aprovação por item ficam superadas; o TaskScoper gera `sispag-excecao-destino-tasks.md` novo (o arquivo velho não é editado agora).

## 3. Rascunho do ADR (a criar na aprovação)

```markdown
---
adr_number: 0060
title: Cadastro do Conexos é a fonte principal do destino de pagamento SISPAG; destino fora do cadastro só como Exceção de destino aprovada por segunda pessoa
date: 2026-10-05
status: accepted
type: change
related_entities: [ExcecaoDestino, LotePagamento]
related_actions: [registrarExcecaoDestino, aprovarExcecaoDestino, rejeitarExcecaoDestino, revogarExcecaoDestino, carregarExcecoesDestinoPlanilha, aposentarExcecoesSubstituidas, finalizarLote, gerarRemessa]
related_business_rules: [destino-pagamento-sispag]
related_integrations: [conexos]
supersedes_decisions: []
superseded_parts_of: [0054]   # D2, D3 (a ressalva "permissão específica pode vir depois"), D10, D11
amends_decisions: [0053]      # catálogo de permissões: nova permissão
evidence:
  - entrevista do usuário, 2026-10-05 (respostas 1 a 6)
  - ontology/decisions/0054-... (D1, adendos de 2026-09-28 e 2026-09-29)
---

# ADR 0060: cadastro primeiro; exceção de destino aprovada por segunda pessoa como fallback

## Contexto
A ADR-0054 deixou a analista digitar o destino no item, com precedência sobre o cadastro (D2),
confirmação pela própria pessoa para conta (D10) e sem aprovação para chave PIX CPF/CNPJ (D11).
O risco foi reconhecido na época: trocar o destino de um pagamento é o vetor clássico de fraude.
Em 2026-10-05 o usuário reavaliou: o cadastro do Conexos é a fonte principal por segurança/fraude,
e quem digita não pode, sozinho, mover dinheiro para um destino novo.

## Decisão
1. **Cadastro (cmn025: conta do favorecido e chaves PIX) é a fonte principal.** Nunca escrevemos no
   `cmn025` (D1 da 0054 mantida). Enviar no item do `fin015` um destino de exceção aprovado
   continua permitido. Cadastro ausente ou errado é problema operacional da Columbia, a corrigir
   no Conexos.
2. **Cadastro primeiro, exceção aprovada só como fallback** quando o cadastro não tem destino válido
   para a modalidade. Substitui D2 da 0054 (o digitado deixa de vencer o cadastro).
3. **Entidade `ExcecaoDestino`**, por favorecido, reutilizável, não por item. Estados `PENDENTE →
   APROVADA → {SUBSTITUIDA, REVOGADA}` e `PENDENTE → REJEITADA`. Analista não digita dado direto
   no item: só se cadastra uma exceção.
4. **Dupla validação rígida, no backend:** aprovador ≠ cadastrante; aprovador com permissão nova
   (catálogo ADR-0053). **TED e PIX igualmente** — substitui D10 (autoaprovação) e D11 (PIX sem
   aprovação).
5. **Conflito:** se o cadastro passa a ter destino válido, a exceção vai a `SUBSTITUIDA` e nunca é
   usada; se o valor do cadastro difere da exceção, registra-se divergência para revisão.
6. **Carga por planilha** (a Columbia mantém uma): cria só `PENDENTE`; carga e recarga nunca
   aprovam. Cada exceção exige segunda pessoa.
7. **Mantidos:** trilha só-inclusão (padrão `lote_pagamento_item_destino_audit`), máscara
   (`MaskDestino`), titularidade I10i (CPF/CNPJ = `pdcDocFederal` do favorecido), validação de
   formato (`DestinoManualValidator`), congelamento no import (I10f), flags desligadas por padrão.
8. **O fluxo por item (`destinoManual`, aprovação por item) é retirado** e refatorado para este modelo.

## Alternativas consideradas
| Alternativa | Por que não |
|---|---|
| Manter o digitado por item e só exigir segunda pessoa | Continua digitando dado de pagamento na ponta; sem reuso; cadastro deixa de ser a fonte principal |
| Gravar no `cmn025` (opção A da 0054) | Escrita em cadastro mestre; usuário reafirmou que não |
| Exceção por item | Obriga recadastrar a cada lote; contraria "por favorecido, reutilizável" |
| Exceção com precedência sobre o cadastro | Reabre o vetor de fraude que motivou a revisão |

## Consequências
- Entidade, estados, 6 ações, migration nova e permissão nova (ver diff proposal).
- Tela: sai o diálogo "Informar destino" por item; entra tela de Exceções (cadastrar, aprovar,
  rejeitar, revogar, carregar planilha).
- Migração de dados: ver Q4 (contar linhas antes de decidir).
- H3/H5 do HML continuam sem prova; as flags seguem desligadas até o teste supervisionado.
- Risco residual: cadastrante e aprovador conluiados, e o DICT não é consultado (titular de chave
  não-CPF/CNPJ não é conferível; I10i). Limite de valor e observação do retorno ficam fora.
```

## 4. Refactor do fluxo por item e migração de dados (item 6)

O que sai/vira: coluna `lote_pagamento_item.destino_manual` (0067), tabela `lote_pagamento_item_destino_audit` (0067/0068, histórico preservado, sem novas linhas), `DestinoPagamentoResolver` (inverte a ordem), `DestinoAprovacaoRule`, `DestinoAprovacaoPendenteError`, rota `.../destino/aprovar`, `InformarDestinoDialog` (`SISPAG_DESTINO_MANUAL_ENABLED`). Mantém `DestinoManualValidator`, `MaskDestino`, I10i.

**Migração (verificação read-only, não feita aqui):** as flags `SISPAG_DESTINO_MANUAL_ENABLED`/`SISPAG_TED_ENABLED` estão desligadas por padrão e as hipóteses H3/H5 nunca foram provadas em PRD; portanto é **esperado** que `destino_manual` esteja vazia em produção, mas isso **não foi confirmado** (sem acesso ao banco nesta tarefa; o MCP do Supabase não é o banco do financeiro). **Tarefa para a implementação (TaskScoper, 1ª task):** contar, read-only e via `.env` local do financeiro, `SELECT count(*) FROM lote_pagamento_item WHERE destino_manual IS NOT NULL` (e por status do lote) e `SELECT count(*), evento FROM lote_pagamento_item_destino_audit GROUP BY evento`. Se 0 → migration 0075 só **cria** `excecao_destino` + trilha + permissão e **dropa nada** (a coluna fica inerte até uma limpeza posterior). Se > 0 → decidir com o Yuri: converter cada destino manual em `ExcecaoDestino PENDENTE` (nunca `APROVADA`, nem as já aprovadas por item, que foram autoaprovadas) por favorecido+tipo, deduplicando, ou ignorar os de lotes já remetidos/cancelados.

## 5. Perguntas abertas

- **Q1 (bloqueia a carga):** colunas, nome do arquivo/aba, chave de identificação do favorecido (CNPJ? `pesCod`? nome?) e como a planilha distingue TED × PIX **não foram vistas**. Pedir amostra (sem dados reais, ou mascarada) à Columbia. Nada foi inventado aqui.
- **Q2:** nome e granularidade das permissões. Proposta: renomear `sispag:aprovar_destino` → `sispag:aprovar_excecao` (migration 0075 troca o `CHECK`, como a 0068) e tratar **cadastrar** como `sispag:executar` ou nova `sispag:cadastrar_excecao`? O `Analista` (0074) cadastra? Quem aprova hoje: só `Administrador`.
- **Q3:** "cadastro tem destino válido" = ao vivo no `cmn025` na hora do envio e da varredura de substituição? Qual a **cadência** da varredura `aposentarExcecoesSubstituidas` (a cada resolução, cron diário, ou no `finalizarLote`)? Sem scheduler hoje (só jobs à mão/crons de GH Actions).
- **Q4:** contagem de dados (§4). Também: lotes RASCUNHO com `destino_manual` aberto na virada.
- **Q5:** chave PIX de exceção segue só CPF/CNPJ (I10i, adendo 29/09) ou, com dupla validação, e-mail/telefone/aleatória passam a ser aceitas? A segunda pessoa não confere o titular no DICT.
- **Q6:** nome da flag `SISPAG_DESTINO_MANUAL_ENABLED`: renomear para `SISPAG_EXCECAO_DESTINO_ENABLED` ou manter por compatibilidade de deploy?
- **Q7:** quem pode **revogar** — só o aprovador, qualquer quem tem a permissão, ou também o cadastrante? E há validade (expiração) da exceção aprovada?
- **Q8:** `DIVERGENCIA_CADASTRO` gera `Alerta` visível a quem, e quem "resolve" a revisão? Basta o evento na trilha?
- **Q9:** uma exceção por favorecido+tipo, ou por favorecido+tipo+filial (`filCod`, o cadastro `cmn025` usa `Cnx-filCod`)?
- **Q10:** a recarga da planilha, quando a linha difere de uma exceção APROVADA, cria nova `PENDENTE` (proposta) ou rejeita como conflito?
- **Q11 (Francinei):** a dupla validação para destino de pagamento é prática em outras tradings? Hoje a evidência de universalidade é só Columbia + decisão do usuário.

## 6. Pedido de resposta

- **approve** — grava ADR-0060, marca superseções na 0054, cria entidade/state-machine/ações, atualiza as demais, `_index.json`, `_coverage.json`, CHANGELOG e watchlist; hand-off ao TaskScoper.
- **edit [arquivo] [instrução]** · **reject [motivo]** · **partial [itens]**.
