Aplicado em 2026-09-29, aprovado pelo usuário.

# Ontology Diff Proposal — `sync-status-lote-sispag`

> **PROPOSTA — nada aplicado.** Autor: OntologyCurator, 2026-09-29. Branch
> `fix/sync-status-lote-sispag`. `/feature-tweak lote-pagamento` — `entity_changed = true` (mudança
> de regra). Decisões de base aprovadas pelo usuário em 2026-09-29 (P0-1, P0-2, P0-3, P1-4, P1-5,
> P1-6). Números de linha referem-se ao estado do worktree em 2026-09-29.

---

## 1. Análise de candidatos

| # | Candidato | Filtros (A/B/C/D/E) | Decisão |
|---|---|---|---|
| 1 | Baixa do título **de qualquer origem** é evidência suficiente de pagamento do item | A:Y (todo contas-a-pagar concilia pelo título baixado, não pelo arquivo) · B:onto · C:Y · D:emenda L9 · E:regra | **ACCEPT** — nova business rule `sincronizacao-status-lote-sispag` (I11) |
| 2 | Hierarquia de evidência: `fin064` (pago) > `fin052` (evento) > nada; leitura que falha não decide | A:Y · B:onto (a *fonte* é Conexos, mas a doutrina "falha ≠ ausência" já é da ontologia) · C:Y · D:estende `retomada-remessa-sispag` §Falha de leitura · E:invariante | **ACCEPT** (dentro da regra nova) |
| 3 | Transição L11 `sincronizarStatus` (read-only no ERP) | A:Y · C:Y · D:nova · E:ação (verbo), não estado | **ACCEPT** |
| 4 | Estado novo de lote "parcialmente pago"/"agendado" | D:decisão l.223 já recusou · E:é **situação derivada do item** | **REJECT-DUPLICATE** → `situacao` derivada no `ItemLote` |
| 5 | `situacao` do item (`AGENDADO`/`PAGO`/`REJEITADO`/`SEM_RETORNO`) | A:Y · E:estado derivado de item, não entidade | **ACCEPT** (propriedade derivada, não persistida) |
| 6 | Props do item `pagoEm`, `pagoObservadoEm`, `valorPago`, `origemBaixa`, `baixaFonte`, `divergencia`, `sincronizadoEm` | A:Y · E:propriedades | **ACCEPT** |
| 7 | `BAIXADO` terminal mesmo com estorno posterior → divergência + `Alerta` | A:Y · C:Y | **ACCEPT** (P1-4) |
| 8 | Aposentar L7 `marcarRetorno` (rota 410) | D:já marcada LEGADO l.94/140-152 | **ACCEPT** (P1-6) |
| 9 | Cron GH Actions de hora em hora, dias úteis, minuto :35 | A:N (cadência é operacional da Columbia) · C:volátil | **REJECT-NOT-DOMAIN** — vai no workflow `.github/`; a ontologia só diz "gatilho agendado + manual" |
| 10 | Botão "Sincronizar agora" no card | UI | **REJECT-NOT-DOMAIN** (a ação L11 cobre; o botão é gatilho) |
| 11 | `findByChaveNativa` com o `filCod` da **linha** (`.RET` mistura filiais) | Bug; o invariante (chave composta) já existe l.229-231 | **REJECT-WORKAROUND** como regra; vira nota no ADR + reforço de texto em "Chave nativa é composta" |
| 12 | Precedência de evento por item `REJEITADO > PAGO(00) > AGENDADO(BD) > outro` | Bug (last-write-wins sobre fan-out) mas o **resultado** é regra de domínio | **ACCEPT** como parte de I11 (I11d) |
| 13 | Escritas locais da sync não gated por `conexosWriteEnabled`/`sispagLiveWriteEnabled`/`conexosDryRun` | A:Y (gate é de escrita no ERP, não de observação) | **ACCEPT** como invariante I11g |
| 14 | Idempotência: sync sem mudança não incrementa `versao` | Refina I6 | **ACCEPT** (I11h) |
| 15 | Novos `tipo` de `Alerta`: `sispag-baixa-divergente`, `sispag-lote-retornado` | A:Y · B:onto (tipos são enum da entidade `Alerta`) | **ACCEPT** (emenda pequena em `entities/alerta.md`) |
| 16 | `fin015.flpVldRet` como sinal de retorno | Medido inútil (false em todos os lotes nativos) | **REJECT-PREMATURE** → nota no ADR (não usar) |
| 17 | Distinguir baixa "manual" × "processamento nativo do `fin052`" | Não observável com segurança (PSQ_018 dá borderô+usuário, não o canal) | **REJECT-PREMATURE** → `origemBaixa` fica `REMESSA \| FORA_DO_RETORNO \| NAO_IDENTIFICADA` |

**Trade-off para o Yuri (não decidido — default proposto):** item com evento de **rejeição** cujo
título aparece **baixado** depois (pago à mão fora da remessa). Pela precedência aprovada a situação
fica `REJEITADO` e o lote `RETORNADO`; proponho **também** marcar `divergencia = true` (a
contradição é real e a analista precisa ver). Alternativa: `PAGO` vence e o lote pode fechar. Default
= `REJEITADO` + divergência, coerente com "o fin052 pode vetar".

---

## 2. Arquivos alterados

1. `ontology/state-machines/lote-pagamento.md` — L11, L7 aposentada, quadro de fechamento reescrito, l.239-243 revisto.
2. `ontology/entities/lote-pagamento.md` — enum de status, props do item, texto velho de I1/I5/Fatia 1+2.
3. `ontology/entities/titulo-a-pagar.md` — `pago` depois da remessa vem do `fin064` ao vivo.
4. `ontology/business-rules/retomada-remessa-sispag.md` — a sync nunca processa.
5. `ontology/integrations/conexos.md` — `com308` baixas (PSQ_018 / `cpoCod` 815), `fin064` por `docCod`, `fin052` detalhe.
6. `ontology/entities/alerta.md` — dois tipos novos.
7. **NOVO** `ontology/business-rules/sincronizacao-status-lote-sispag.md` (I11).
8. **NOVO** `ontology/decisions/0055-status-do-lote-sispag-segue-a-baixa-do-titulo.md`.

---

## 3. Diffs

### 3.1 `ontology/state-machines/lote-pagamento.md`

**Frontmatter l.5, l.21-23, l.32**

- ANTES: `ontology_version: "0.19.1"` · `last_review: 2026-09-28`
- DEPOIS: `ontology_version: "0.31.0"` · `last_review: 2026-09-29`; acrescentar em `related_files`:
  `src/backend/domain/service/sispag/SincronizacaoLoteService.ts` *(a criar)*,
  `src/backend/domain/client/ConexosTitulosClient.ts`, `src/backend/jobs/sincronizar-lotes-sispag.ts` *(a criar)*.

**Vigência — após l.44 acrescentar:**

> **2026-09-29 (ADR-0055) — o status do lote passa a seguir a baixa do título.** Nova transição L11
> `sincronizarStatus` (read-only no ERP); o fechamento de L9/L10/L11 é uma **única** função
> (`business-rules/sincronizacao-status-lote-sispag.md`, I11); L7 `marcarRetorno` **aposentada**.

**Tabela de estados, l.63-64**

- ANTES (l.63): `| RETORNADO | ... O .RET foi conciliado, mas o lote **não fechou**: houve rejeição, ou algum item não tem baixa, ou a varredura de eventos veio incompleta. ...`
- DEPOIS: `| RETORNADO | RETORNADO | Algum item tem **rejeição lida** no fin052 (fbeVldTpret = 2). **Exige tratamento humano** (sanear cadastro e reenviar). Item sem baixa e varredura incompleta **não** levam mais a RETORNADO (ADR-0055) — o lote espera em REMESSA_GERADA. Re-sincronizável (L9/L10/L11 partem dele). |`
- ANTES (l.64): `| BAIXADO | ... Todo item não-rejeitado tem baixa confirmada no fin010 (bxa_cod_seq), sem nenhuma rejeição e com varredura completa. **Terminal.** |`
- DEPOIS: `| BAIXADO | BAIXADO | **Todo** item tem o título pago no fin064 (vldPago = 1 e aberto = 0), **qualquer que seja a origem da baixa** (remessa, fin010 manual, processamento nativo do fin052), e nenhum item tem rejeição lida. **Terminal** — estorno posterior não reabre; vira divergência no item (I11f). |`

**Transições — l.94 (L7)**

- ANTES: `| L7 | FINALIZADO → RETORNADO | marcarRetorno **(LEGADO — ver aviso)** | Marca manualmente ... | 2026-07-08 (obsoleta desde 2026-08-25) |`
- DEPOIS: `| ~~L7~~ | ~~FINALIZADO → RETORNADO~~ | ~~marcarRetorno~~ **APOSENTADA** | Botão removido do LoteCard; POST /sispag/lotes/:id/retorno responde **410 Gone**. Nenhum lote em RETORNADO em produção (2026-09-29) — sem limpeza de dados. O número L7 não é reaproveitado. | 2026-07-08 → aposentada em 2026-09-29 (ADR-0055) |`

**Transições — l.96-97 (L9/L10) substituídas, e L11 acrescentada**

- ANTES (l.96): `| L9 | {REMESSA_GERADA, RETORNADO} → BAIXADO | conciliarRetorno ... | Fecha o lote **somente se**: todo item não-rejeitado tem bxa_cod_seq, **nenhum** item rejeitado e a **varredura de eventos foi completa**. ... | 2026-08-25 |`
- ANTES (l.97): `| L10 | {REMESSA_GERADA, RETORNADO} → RETORNADO | conciliarRetorno ... | ... qualquer rejeição, item sem baixa **ou varredura incompleta** ... | 2026-08-25 |`
- DEPOIS:

```
| L9  | {REMESSA_GERADA, RETORNADO} → BAIXADO | conciliarRetorno (admin, `processar=true`) | **Escreve no ERP** (`processar` do `fin052`) e em seguida aplica o **mesmo fechamento de L11** (I11). Mantida como caminho administrativo. | 2026-08-25; fechamento por I11 em 2026-09-29 |
| L10 | {REMESSA_GERADA, RETORNADO} → RETORNADO | conciliarRetorno (admin) | Idem L9, destino RETORNADO quando há rejeição lida. | 2026-08-25; idem |
| L11 | {REMESSA_GERADA, RETORNADO} → BAIXADO \| RETORNADO \| (mesmo) | `sincronizarStatus` (cron agendado + "Sincronizar agora") | **Read-only no ERP** — nunca chama `carregar`/`processar`. Lê o título no `fin064` por `docCod`, os eventos do `fin052` e, se legível, as baixas do título (`com308`, PSQ_018); deriva a `situacao` de cada item e decide o destino pelo quadro abaixo. Falha de leitura **não decide** (I11c). Sem mudança observada, **não** incrementa `versao` (I11h). Escritas locais **não** passam por `conexosWriteEnabled`/`sispagLiveWriteEnabled`/`conexosDryRun` (I11g). | 2026-09-29 (ADR-0055) |
```

**Diagrama l.99-138** — substituir o ramo de L7 (l.114-116, l.129 seta `◀──┘`) e o rótulo de L9/L10:

- ANTES (l.114): `      L8 gerarRemessa   │        │  L7 marcarRetorno  ⚠ LEGADO — beco sem saída`
- DEPOIS: remover o ramo L7 (e as colunas `│` à direita, l.115-129).
- ANTES (l.124-128): `L9 / L10  conciliarRetorno (fin052 → baixas no fin010)` … `rejeição / item sem baixa / varredura INCOMPLETA`
- DEPOIS:

```
      L11 sincronizarStatus (read-only)  ·  L9/L10 conciliarRetorno (admin, processa)
      mesmo fechamento I11 — REMESSA_GERADA → REMESSA_GERADA enquanto há item sem baixa
                  ┌─────┴─────┐
   todo título    │           │  rejeição LIDA no fin052
   pago (fin064), │           │  (fbeVldTpret = 2)
   sem rejeição   ▼           ▼
            ┌───────────┐   ┌───────────────┐
            │  BAIXADO  │◀──│   RETORNADO   │──┐  RETORNADO → RETORNADO
            │ (terminal)│   │ (exige olho   │◀─┘  (nova sincronização)
            └───────────┘   │    humano)    │
                            └───────────────┘
```

**Aviso l.140-152** — ANTES: `> ⚠️ **L7 é dívida viva, e é um beco sem saída.** ... > **Follow-up aberto:** remover a ação, ou restringi-la a ambiente de teste.`
DEPOIS:

> **L7 aposentada (ADR-0055, 2026-09-29).** Era um beco sem saída: levava o lote a `RETORNADO` sem
> `.REM`, sem chave nativa e sem baixa, e dali nenhuma transição o tirava. O botão saiu e a rota
> responde `410`. O retorno real chega por L11 (e, administrativamente, L9/L10).

**Seção l.154-174 "Quando a conciliação FECHA o lote (L9 vs. L10)" — substituída por:**

```markdown
## Quando o lote FECHA (L9 / L10 / L11 — uma só função, I11)

A decisão é por **item** primeiro, depois por lote. Situação do item (derivada, precedência de cima
para baixo — I11d):

| Evidência lida | `situacao` do item |
|---|---|
| Algum evento do `fin052` com `fbeVldTpret = 2` para o item | `REJEITADO` |
| Título no `fin064` com `vldPago = 1` **e** `aberto = 0` | `PAGO` |
| Evento `BD` (agendado) ou `00` (efetuado) no `fin052`, título ainda não pago | `AGENDADO` |
| Nenhuma das anteriores | `SEM_RETORNO` |

| Situação dos itens | Destino do lote |
|---|---|
| Algum `REJEITADO` | `RETORNADO` |
| **Todos** `PAGO` | `BAIXADO` |
| Qualquer outra combinação | **permanece** onde está (`REMESSA_GERADA`, ou `RETORNADO` se já estava) |
| Leitura do `fin064` de algum item falhou | **permanece** (I11c) — o item guarda a última situação observada |

**O que mudou (ADR-0055).** Antes, o lote só fechava com `bxa_cod_seq` copiado da linha de detalhe
do `fin052` **e** varredura completa de eventos; qualquer lacuna o mandava para `RETORNADO`. Em
produção isso nunca fechou nada: o retorno de 24/09 foi processado nativamente só com o evento
`BD`, e a baixa foi feita à mão no `fin010` horas depois. Agora a evidência de pagamento é o
**título**, não o arquivo. A varredura incompleta do `fin052` perde o poder de bloquear
`BAIXADO` **quando a baixa está confirmada no título**: o dinheiro saiu, qualquer que tenha sido o
caminho. Ela continua sem poder afirmar *ausência* de rejeição — por isso só a rejeição **lida**
veta, e o que não foi lido não produz `REJEITADO` nem `PAGO`.

`00` sem baixa no título é `AGENDADO`, não `PAGO`: o banco confirmou, o ERP ainda não baixou, e a
ontologia não afirma pagamento que o ERP não registra.

**A transição acontece na MESMA transação de banco** que grava a situação dos itens (herdado de
L9/L10).
```

**"Decisões de modelagem", l.220-225** — ANTES:
`- **BAIXADO é terminal e conservador.** Fecha só com evidência positiva de baixa (bxa_cod_seq) para **todos** os itens não-rejeitados. ...`
DEPOIS:
`- **BAIXADO é terminal e conservador.** Fecha só com evidência positiva de pagamento no **título** (fin064) para **todos** os itens. Estorno posterior não reabre: vira divergencia no item e Alerta (ADR-0055, I11f). Lote com rejeição fica em RETORNADO de propósito: exige sanear cadastro e reenviar.`

l.223-225 **mantido** e reforçado — acrescentar ao fim:
` Reafirmado na ADR-0055: "agendado no banco, aguardando baixa" também é situação do item, não estado do lote.`

**"Chave nativa é composta", l.229-231** — acrescentar:
` A filial da chave é a **da linha do .RET**, não a do arquivo: um mesmo arquivo de retorno mistura filiais (gar 9: fil 1/flp 8 e fil 2/flp 24, ADR-0055).`

**"Relação com o painel e o ERP", l.239-243** — ANTES:
`De L8 em diante a máquina passa a **dirigir** o lote nativo do fin015 e a **absorver** o resultado do fin052/fin010. Ela não *espelha* o estado do ERP — ela guarda o que o ERP não guarda: o elo lote → borderô → baixa. Medido em produção (2026-08-20): ... O vínculo só existe na linha de detalhe do retorno — e some se ninguém copiar.`
DEPOIS:

> De L8 em diante a máquina **dirige** o lote nativo do `fin015` e **observa** o resultado no ERP.
> O que ela guarda que o ERP não guarda é o elo **lote → item → título**; o elo **título → borderô →
> baixa** o ERP guarda, e é legível por título no `com308` (PSQ_018, `listBaixasTitulo`) quando o
> usuário tem permissão. Medido em 2026-08-20: `borCod` nulo no `finItemSispag` e
> `vldHasRemessaPgto = 0` mesmo em baixa de remessa — então o `fin015` não serve de ponte, mas o
> título serve. Em 2026-09-24 a baixa do 38682/1 (borderô 22320) não passou por retorno nenhum:
> o `fin052` não teria o vínculo para copiar. Por isso `borCod`/`bxaCodSeq` no item são
> **enriquecimento** com fonte registrada (`baixaFonte`), nunca a prova de pagamento.

---

### 3.2 `ontology/entities/lote-pagamento.md`

**Frontmatter** — l.4 `"0.30.0"` → `"0.31.0"`; l.45 `last_review` mantém `2026-09-29`; `properties`
(l.25-39) acrescentar: `itens[].situacao`, `itens[].pagoEm`, `itens[].pagoObservadoEm`,
`itens[].valorPago`, `itens[].origemBaixa`, `itens[].baixaFonte`, `itens[].divergencia`,
`itens[].sincronizadoEm`. `related_files` + `src/backend/migrations/0049_sispag_remessa_retorno.sql`,
`src/backend/domain/service/sispag/SincronizacaoLoteService.ts` *(a criar)*. `universality_evidence` +
`"sincronização pelo título (ADR-0055): o pagamento de um título a pagar é observável no próprio título em qualquer ERP (saldo aberto zero); o arquivo de retorno bancário é uma das origens possíveis da baixa, não a única — caso PG230901.REM, baixa manual 38682/1 em 24/09"`.

**Intro l.59-63** — ANTES: `... É **persistido localmente** (...), **NÃO** no ERP — nesta fatia nada é escrito no Conexos (I1). O lote FINALIZADO é o "pronto para processar"; o processamento real (remessa/pasta/Nexxera/baixa) é a **próxima feature** (ADR-0015).`
DEPOIS: `... É **persistido localmente** (lote_pagamento + lote_pagamento_item). Até FINALIZADO nada é escrito no Conexos; a partir de L8 o lote dirige o fin015 (remessa) e, depois, **acompanha a baixa dos títulos** no ERP (L11, ADR-0055). Ver state-machines/lote-pagamento.md.`

**l.115 (`status`)** — ANTES:
`| status | enum | lote_pagamento.status | RASCUNHO \| FINALIZADO \| RETORNADO \| CANCELADO — constantes tipadas. RETORNADO (ADR-0019, migration 0027) = retorno do Nexxera recebido; FINALIZADO passou a significar **"aguardando o retorno do Nexxera"**. ... |`
DEPOIS:
`| status | enum | lote_pagamento.status | RASCUNHO \| FINALIZADO \| REMESSA_GERADA \| RETORNADO \| BAIXADO \| CANCELADO — LOTE_STATUS (P3; CHECK da 0049). FINALIZADO = gate passado, sem remessa. REMESSA_GERADA = .REM gerado, aguardando baixa dos títulos. RETORNADO = rejeição lida no fin052. BAIXADO = todo título pago (terminal). Ver state-machines/lote-pagamento.md. |`

**Tabela `ItemLote`, após l.138 acrescentar:**

```
| `situacao` | enum (derivado) | — | `AGENDADO \| PAGO \| REJEITADO \| SEM_RETORNO` — derivada pela sincronização (I11d); **não** é estado do lote (decisão "sem estado parcialmente pago"). Constantes tipadas (`ITEM_SITUACAO`). Só existe de `REMESSA_GERADA` em diante. |
| `rejeitado` · `retornoEvento` · `retornoDescricao` | boolean · string? · string? | `rejeitado`, `retorno_evento`, `retorno_descricao` (0049) | Evento do `fin052` **escolhido por precedência** `REJEITADO > 00 > BD > outro` sobre todas as linhas do item (I11d), nunca a última lida. *Existiam desde a 0049 e faltavam nesta doc.* |
| `borCod` · `bxaCodSeq` | number? | `bor_cod`, `bxa_cod_seq` (0049) | Borderô/baixa da baixa do título. **Enriquecimento**, não prova de pagamento. Nulo quando nenhuma fonte legível os trouxe. |
| `baixaFonte` | enum? | `baixa_fonte` *(a criar)* | De onde vieram `borCod`/`bxaCodSeq`: `RETORNO` (linha de detalhe do `fin052`) \| `TITULO` (`com308` baixas, PSQ_018). |
| `origemBaixa` | enum? | `origem_baixa` *(a criar)* | `REMESSA` (baixa ligada a um retorno deste lote) \| `FORA_DO_RETORNO` (baixa no título sem vínculo com o retorno — `fin010` manual ou processamento nativo) \| `NAO_IDENTIFICADA` (pago no `fin064`, PSQ_018 ilegível). Manual × nativo **não** é distinguido (não observável com segurança). |
| `pagoEm` · `valorPago` | Date? · number? | `pago_em`, `valor_pago` *(a criar)* | Data e valor da baixa, do PSQ_018 quando legível; nulos caso contrário. |
| `pagoObservadoEm` | Date? | `pago_observado_em` *(a criar)* | Primeira sincronização que viu o título pago no `fin064`. Não nulo ⇔ `situacao = PAGO` foi observada. |
| `divergencia` | boolean + detalhe | `divergencia`, `divergencia_detalhe` *(a criar)* | Contradição observada que a máquina **não** resolve sozinha: título antes pago voltou a aberto (estorno) ou item `REJEITADO` com título pago. Gera `Alerta` `sispag-baixa-divergente` (I11f). |
| `sincronizadoEm` | Date? | `sincronizado_em` *(a criar)* | Última leitura **bem-sucedida** do título. Atualizá-la **não** incrementa `versao` (I11h). |
```

**Invariantes — l.176-177 (I5)** ANTES: `... reversível por reabrirLote **enquanto** não houver etapa downstream (não há nesta fatia). ...`
DEPOIS: `- **I5 (gate reversível + auditoria):** finalizarLote é reversível por reabrirLote **só em FINALIZADO**; depois da remessa não há volta local. Toda transição registra ator + timestamp (a sincronização grava ator 'sync').`

**l.180 (I1)** ANTES: `- **I1 (sem escrita no ERP):** o lote é rascunho na tabela própria; nenhuma remessa/baixa no ERP.`
DEPOIS: `- **I1 (sem escrita no ERP até FINALIZADO):** a montagem (L1–L6) é 100% local. L8 escreve no fin015; L9/L10 no fin052. **L11 é read-only no ERP** e nunca baixa, processa ou carrega nada (I11a).`

**Após l.203 acrescentar:**
`- **I11 (sincronização pelo título — ADR-0055, 2026-09-29):** pagamento do item = título pago no fin064, de qualquer origem (I11b); fin052 só enriquece e veta por rejeição lida; falha de leitura não decide (I11c); precedência de evento (I11d); BAIXADO terminal com divergência (I11f); escritas locais sem gate de ERP (I11g); sem mudança, sem versao (I11h). Ver business-rules/sincronizacao-status-lote-sispag.md.`

**Seção l.211-220 "Retorno do Nexxera (RETORNADO, ADR-0019)"** — substituída por:

```markdown
## Retorno e baixa (ADR-0019 → ADR-0039 → ADR-0055)

`RETORNADO` nasceu (ADR-0019) como simulação manual (`marcarRetorno`, L7). A Fatia 3 (2026-08-25)
trouxe o retorno real (`fin052`) e `BAIXADO`. A ADR-0055 (2026-09-29) muda a **prova**: o lote segue
a baixa dos **títulos** no ERP, de qualquer origem, e L7 foi aposentada (rota `410`). Ver
`state-machines/lote-pagamento.md` e `business-rules/sincronizacao-status-lote-sispag.md`.
```

**Seção l.240-245 "Fora de escopo (Fatia 1+2)"** — substituída por:

```markdown
## Fora de escopo

- Transporte ao banco (pasta de rede → VAN Nexxera): externo e manual, não observado.
- Baixar, processar ou carregar retorno **a partir da sincronização** (I11a).
- Reabrir lote `BAIXADO` por estorno (vira divergência, I11f).
```

**l.209 (Cardinalidade)** — ANTES `... se o anterior for CANCELADO ou (na próxima fatia) processado.` → DEPOIS `... se o anterior for CANCELADO, ou em qualquer lote não-RASCUNHO (I3 só vale entre RASCUNHOs).`

---

### 3.3 `ontology/entities/titulo-a-pagar.md`

**l.101 (`pago`)** — ANTES:
`| pago | boolean | derivado: título já quitado (vldPago/baixa fin010) ou saldo = 0 → pago | Título já pago **não** entra no lote (I2). |`
DEPOIS:
`| pago | boolean | derivado: fin064.vldPago = 1 e aberto = 0 | Título já pago **não** entra no lote (I2). **Duas leituras distintas:** na carteira, é o snapshot da ingestão (que filtra vldPago = 0, então título pago some); **depois da remessa**, a sincronização lê o título ao vivo no fin064 **por docCod, sem filtro de vldPago** (getTituloAPagar) — o snapshot da carteira nunca prova pagamento de item de lote (I11b). Campo ilegível ≠ false (I11c). |`

**l.192-193 ("Fora de escopo")** — ANTES: `- Nenhuma escrita no ERP. O título nunca é liberado/baixado/enviado por nós aqui — isso é a Fatia de transporte (...), gated como em Permutas.`
DEPOIS: `- Nenhuma escrita no ERP a partir desta entidade. A baixa do título é observada (L11, ADR-0055), nunca feita por nós fora de L9.`

`last_review` → `2026-09-29`.

---

### 3.4 `ontology/business-rules/retomada-remessa-sispag.md`

**Após l.87 (tabela da conciliação) acrescentar:**

> **A sincronização (L11, ADR-0055) não entra nesta máquina.** Ela é read-only no ERP: nunca
> `carregar`, nunca `processar`, não abre linha em `conciliacao_execucao`. Um arquivo sem
> `processadoEm` continua sendo decisão do caminho administrativo (`conciliarRetorno`,
> `processar=true`), que segue mantido. Consequência: um `.RET` carregado e nunca processado
> (gar 10, 25/09) não bloqueia `BAIXADO` se os títulos estão baixados por outra via.

**l.107-110 ("Falha de leitura ≠ ausência")** — acrescentar item:
`, e getTituloAPagar/listBaixasTitulo na sincronização: falha de leitura nunca vira "pago" nem "não pago" — o lote fica onde está (I11c).`

`last_review` l.17 → `2026-09-29`; `related_files` + `SincronizacaoLoteService.ts`.

---

### 3.5 `ontology/integrations/conexos.md`

**Tabela SISPAG (após l.282) acrescentar duas linhas:**

```
| `fin064/list` filtrado por `docCod` | **situação de pagamento** de um título de lote (L11) | `ConexosSispagClient.getTituloAPagar(filCod, docCod, titCod)` | `vldPago`, `aberto` | **READ.** **Sem** `vldPago#EQ: 0` (≠ carteira). Prova de pagamento: `vldPago = 1 ∧ aberto = 0`. Campo ausente/ilegível **não** é coagido a `false` (I11c). |
| `com308/financeiroAPagar/baixas/list/{docCod}/{titCod}/0` | **baixas do título** — borderô, `bxaCodSeq`, data, usuário (PSQ_018, `cpoCod` 815) | `ConexosTitulosClient.listBaixasTitulo({docCod, titCod, filCod})` | `borCod`, `bxaCodSeq`, data e usuário da baixa | **READ, enriquecimento.** Filtra `borVldFinalizado#IN [1]`; corpo vazio dá 400. ⚠ **Permissão:** o robô CLONEX recebeu **403** em 2026-09-22 — tratado como ilegível (campos nulos), nunca como "sem baixa". Mesmo bloqueio registrado na ADR-0047. |
```

**Seção l.329-336 "ESCRITA SISPAG — FUTURO/gated"** — ANTES: título + parágrafo "... são o **motor nativo** que a próxima fatia vai **dirigir** ...".
DEPOIS: título `### ESCRITA SISPAG (vigente desde 2026-08-25)` e parágrafo:
`fin015 (L8) e fin052 processar (L9/L10, admin) são escritas gated por conexosWriteEnabled/sispagLiveWriteEnabled/conexosDryRun. A sincronização (L11, ADR-0055) é LEITURA — fin064 + fin052 (arquivos/detalhe) + com308 baixas — e suas gravações locais não passam por esses gates. fin015.flpVldRet **não** é sinal de retorno (false em todos os lotes nativos medidos).`

`last_review` → `2026-09-29`.

---

### 3.6 `ontology/entities/alerta.md`

**Tabela de tipos, após l.55 acrescentar:**

```
| `sispag-baixa-divergente` | id do lote | `sincronizarStatus` — título antes pago voltou a aberto, ou item REJEITADO com título pago (I11f) |
| `sispag-lote-retornado` | id do lote | transição para RETORNADO (L10/L11) |
```

`dedupKey` segue `(tipo, alvo, janela)` — sync de hora em hora não repete alerta.

---

## 4. Arquivos NOVOS (texto integral)

### 4.1 `ontology/business-rules/sincronizacao-status-lote-sispag.md`

```markdown
---
name: sincronizacao-status-lote-sispag
type: business-rule
entity: LotePagamento
invariant: I11
ontology_version: "0.31.0"
implementation_status: planned
status: active
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/SincronizacaoLoteService.ts
  - src/backend/domain/service/sispag/ConciliacaoRetornoService.ts
  - src/backend/domain/client/ConexosSispagClient.ts
  - src/backend/domain/client/ConexosTitulosClient.ts
  - src/backend/domain/client/ConexosSispagRetornoClient.ts
  - src/backend/domain/repository/sispag/LotePagamentoRepository.ts
  - src/backend/jobs/sincronizar-lotes-sispag.ts
  - src/frontend/app/sispag/components/LoteCard.tsx
last_review: 2026-09-29
has_canonical_test: false
---

# Business Rule — o status do lote SISPAG segue a baixa do título (I11)

> **Vigência:** 2026-09-29 (ADR-0055). Emenda o fechamento de L9/L10 e cria L11
> `sincronizarStatus`. Ver `state-machines/lote-pagamento.md`.

## O princípio

> **O pagamento de um item é um fato do título, não do arquivo de retorno.** O retorno bancário é
> uma das origens possíveis da baixa; a analista pode baixar à mão no `fin010`, e o `fin052` pode
> ser processado nativamente sem gerar borderô. O lote observa o título.

## Hierarquia de evidência

| Nível | Fonte | O que prova | O que **não** prova |
|---|---|---|---|
| 1 — pagamento | `fin064` por `docCod` (`vldPago = 1 ∧ aberto = 0`) | o item foi pago, **qualquer origem** | quem baixou, com que borderô |
| 2 — veto | evento do `fin052` com `fbeVldTpret = 2` | o banco rejeitou o item | que os **outros** itens não foram rejeitados |
| 3 — agenda | evento `BD` / `00` do `fin052` | o banco aceitou/agendou | que o ERP baixou |
| 4 — enriquecimento | `com308` baixas (PSQ_018) · detalhe do `fin052` | `borCod`, `bxaCodSeq`, data, usuário, valor | nada sobre o status — é trilha |

## Invariantes

- **I11a — read-only no ERP.** `sincronizarStatus` só lê. Nunca `carregar`, `processar`, baixar,
  nem abre ledger de execução. O `processar` continua exclusivo de `conciliarRetorno` (admin).
- **I11b — baixa de qualquer origem basta.** Item é `PAGO` se o nível 1 diz pago. Remessa, `fin010`
  manual ou processamento nativo são equivalentes. Com baixa confirmada no título, um evento do
  `fin052` **não lido** (varredura incompleta) **não** impede `BAIXADO`.
- **I11c — falha de leitura não decide.** Leitura do `fin064` que falha (rede, 4xx, 5xx, campo
  ausente, schema inválido) nunca produz "pago" nem "não pago": o item mantém a situação anterior e
  o lote não transiciona nesta passada. Leitura do PSQ_018 que falha (inclusive 403) deixa os
  campos de enriquecimento nulos e **não** bloqueia `BAIXADO`. Evento não lido não produz
  `REJEITADO`.
- **I11d — precedência por item.** Sobre todas as linhas do `fin052` que casam o item (casamento pela
  chave composta com o `filCod` **da linha**), o evento registrado é o de maior precedência:
  `REJEITADO > 00 > BD > outro`. Nunca a última linha lida. `situacao` = `REJEITADO` se há
  rejeição; senão `PAGO` se nível 1; senão `AGENDADO` se `BD`/`00`; senão `SEM_RETORNO`.
- **I11e — fechamento do lote.** Algum `REJEITADO` → `RETORNADO`. Todos `PAGO` → `BAIXADO`. Qualquer
  outra combinação → permanece. Sem estado novo de lote.
- **I11f — `BAIXADO` é terminal.** Se um título antes pago volta a aberto (estorno), ou se um item
  `REJEITADO` aparece com título pago, a sincronização **não** transiciona: marca `divergencia` no
  item e emite `Alerta` `sispag-baixa-divergente`. Resolver é decisão humana.
- **I11g — observação não é escrita no ERP.** As gravações locais da sincronização e da conciliação
  (situação, enriquecimento, transição) **não** são condicionadas a `conexosWriteEnabled`,
  `sispagLiveWriteEnabled` nem `conexosDryRun`; esses gates valem só para escrita no Conexos.
- **I11h — idempotência.** Uma passada que não muda status nem situação de nenhum item **não**
  incrementa `versao` e não emite evento/alerta. Atualiza apenas `sincronizadoEm`. Transição usa o
  optimistic lock (I6); conflito de versão = pular o lote nesta passada.

## Gatilho

Agendado (cron) + manual ("Sincronizar agora" no card do lote). A cadência é configuração
operacional, não regra — hoje GitHub Actions, dias úteis, de hora em hora.

## Rejeição

Lote em `RETORNADO` aparece destacado na tela e gera `Alerta` `sispag-lote-retornado`. Tratamento:
sanear cadastro e reenviar em lote novo.

## Verificação

- Unitário: tabela de verdade de I11d/I11e, incluindo falha de leitura (I11c) e sync sem mudança
  sem bump de `versao` (I11h).
- **Ao vivo (ground truth):** PG230901.REM — 38682/1 (fil 2/flp 24) deve sair `PAGO` com
  `origemBaixa = FORA_DO_RETORNO` (borderô 22320 se o PSQ_018 for legível); 4030/7 (fil 1/flp 8)
  conforme o `fin064` do dia; o lote só vai a `BAIXADO` se os dois estiverem pagos.
```

### 4.2 `ontology/decisions/0055-status-do-lote-sispag-segue-a-baixa-do-titulo.md`

```markdown
---
adr_number: 0055
title: O status do lote SISPAG segue a baixa do título no ERP, de qualquer origem; o retorno do fin052 só enriquece e veta
date: 2026-09-29
status: accepted
type: change
related_entities: [LotePagamento, TituloAPagar, Alerta]
related_actions: [sincronizarStatus, conciliarRetorno, marcarRetorno]
related_business_rules: [sincronizacao-status-lote-sispag, retomada-remessa-sispag]
related_integrations: [conexos]
supersedes_partially: [ADR-0019]
evidence:
  - PG230901.REM (Itaú, bnc 4, débito 24/09) — itens 38682/1 e 4030/7
  - fin052 gar 9 e gar 10; fin010 borderô 22320
---

# ADR 0055: o status do lote SISPAG segue a baixa do título

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Branch:** `fix/sync-status-lote-sispag`
(`/feature-tweak lote-pagamento`, slug `sync-status-lote-sispag`). `entity_changed = true`.

## Contexto

A remessa `PG230901.REM` teve dois itens: fil 2/flp 24 ATLANTIS 38682/1 (R$ 275,00) e fil 1/flp 8
LATTINE 4030/7 (R$ 1.856,16), Itaú, débito em 24/09.

- O retorno `PAG_341_557954_260924_00000.RET` (gar 9) foi **processado nativamente** em 24/09 às
  08:33, só com o evento `BD` ("PAGAMENTO AGENDADO"), **sem borderô**.
- O retorno de 25/09 (gar 10) foi **carregado e nunca processado**.
- A baixa do 38682/1 existe: borderô 22320, criado e finalizado **à mão** por ERICA_VIANA em 24/09
  às 12:47 (`fin010`).
- O nosso app mostra o lote em `REMESSA_GERADA`; `conciliacao_execucao` está vazia.
- `fin015.flpVldRet` é `false` em todos os lotes nativos medidos — não serve de sinal.

O fechamento vigente (L9/L10) exigia `bxa_cod_seq` copiado do detalhe do `fin052` e varredura
completa. Nenhuma das duas coisas acontece quando a baixa é feita à mão ou o processamento é nativo
— que é o caso real. O lote nunca fecharia.

Dois bugs de implementação vêm junto e não precisam de regra nova além dos invariantes: (1)
`findByChaveNativa` usava a filial do arquivo, mas um `.RET` mistura filiais (gar 9: fil 1/flp 8 e
fil 2/flp 24) — tem de usar o `filCod` da linha; (2) o evento por item era last-write-wins sobre
um fan-out não determinístico — agora vale a precedência de I11d. Também: o schema do `fin064`
coage `vldPago` ilegível a `false`, o que violaria I11c no caminho da sincronização.

## Decisões

### D1 — Baixa de qualquer origem basta para `BAIXADO` (P0-1)
Remessa, `fin010` manual e processamento nativo são equivalentes. O `fin052` enriquece (registra
`BD`/`00` no item) e **veta** por rejeição lida (`fbeVldTpret = 2` → `RETORNADO`). Com a baixa
confirmada no título, evento não lido **não** bloqueia `BAIXADO`.

### D2 — Prova de pagamento = `fin064` por `docCod` (P0-2)
`getTituloAPagar`, sem filtro de `vldPago`: `vldPago = 1 ∧ aberto = 0`. `borCod`/`bxaCodSeq`/data/
usuário vêm do PSQ_018 (`com308/financeiroAPagar/baixas/list/{doc}/{tit}/0`) **quando legível** —
o robô recebeu 403 em 22/09 — e são nulos e só enriquecimento. Falha de leitura é fail-closed:
nunca "pago", nunca "não pago"; o lote fica onde está.

### D3 — Sem estado novo de lote (P0-3)
O lote espera em `REMESSA_GERADA`. Cada item tem situação **derivada**: `AGENDADO` / `PAGO` /
`REJEITADO` / `SEM_RETORNO`. Mantém a decisão "não se criou estado parcialmente pago".

### D4 — Gatilho agendado + manual, read-only no ERP (P1-5)
Nova transição L11 `sincronizarStatus`. Nunca chama `carregar`/`processar`. O
`POST /sispag/retornos/conciliar` com `processar=true` é **mantido** como caminho administrativo e
passa a usar o mesmo fechamento.

### D5 — `BAIXADO` terminal; estorno vira divergência (P1-4)
Se `vldPago` volta a 0, não há transição: `divergencia` no item + `Alerta`.

### D6 — L7 `marcarRetorno` aposentada (P1-6)
Botão e rota removidos (rota responde `410`). Rejeição aparece como lote `RETORNADO` destacado +
`Alerta`. Produção não tem lote em `RETORNADO`: sem limpeza.

### D7 — Escrita local não é gated por flag de ERP
`conexosWriteEnabled`/`sispagLiveWriteEnabled`/`conexosDryRun` controlam escrita no Conexos, não a
gravação do que foi observado.

### D8 — Idempotência
Sincronização sem mudança não incrementa `versao` (I6).

## Alternativas consideradas

- **Exigir o vínculo do `fin052` (status quo).** Rejeitada: o caso real não o produz.
- **Processar o `.RET` automaticamente na sincronização.** Rejeitada: escrita não idempotente
  disparada por cron; e a baixa manual já existe — processar em cima dela arrisca baixa dupla.
- **Estado `AGENDADO`/`PARCIAL` no lote.** Rejeitada: duplicaria o que é derivável dos itens.
- **`fin015.flpVldRet` como sinal.** Rejeitada: medido inútil.
- **Distinguir baixa manual × nativa.** Adiada: não observável com segurança; `origemBaixa` fica
  `REMESSA | FORA_DO_RETORNO | NAO_IDENTIFICADA`.

## Consequências

- Supersede em parte a ADR-0019 (L7) e emenda o fechamento da Fatia 3 (L9/L10).
- Nova regra `sincronizacao-status-lote-sispag` (I11). Novas colunas no item (a criar em migration):
  `baixa_fonte`, `origem_baixa`, `pago_em`, `valor_pago`, `pago_observado_em`, `divergencia`,
  `divergencia_detalhe`, `sincronizado_em`.
- Dois tipos novos de `Alerta`.
- Aberto: permissão do robô no PSQ_018 (ver memória "Permissões do robô CLONEX"). Sem ela, a trilha
  de borderô fica nula, mas o status fecha corretamente.
- Trade-off registrado: item `REJEITADO` com título pago fica `REJEITADO` + divergência (default;
  revisável).
```

---

## 5. Metadados (a aplicar na aprovação — NÃO tocados agora)

**`ontology/_index.json`**
- `_meta.version` `0.30.0` → `0.31.0`; `generated` → `2026-09-29`; `last_feature` → `sync-status-lote-sispag`; `note` prefixada com o resumo v0.31.0.
- `business_rules` + `sincronizacao-status-lote-sispag` `{file, status: planned, has_canonical_test: false, impl_files: [...], resolved_by: [ADR-0055]}`.
- `business_rules.retomada-remessa-sispag.amended_by` + `ADR-0055`.
- `state_machines.lote-pagamento`: `status` `planned` → `partial` (drift pré-existente: L8–L10 existem no código); `impl_files` + `SincronizacaoLoteService.ts`, `ConciliacaoRetornoService.ts`, `RemessaService.ts`; `note` + ADR-0055 (L11, L7 aposentada, estados corrigidos — a nota atual ainda diz "BAIXADO fora de escopo").
- `entities.LotePagamento.note` + ADR-0055; `entities.TituloAPagar.note` + leitura ao vivo pós-remessa.
- `actions`: + `sincronizarStatus` (entity LotePagamento, planned); `marcarRetorno` → `status: retired`.

**`ontology/_coverage.json`**
- `summary.business_rules_total` 24 → 25; `business_rules_planned` 10 → 11.
- `summary.actions_total` 27 → 28 (+ `sincronizarStatus`, planned) e `actions_planned` 6 → 7 **se** `marcarRetorno` estiver contada; se estiver, sai para `retired` (conferir na aplicação).
- `by_entity.LotePagamento.resolved_by` + `ADR-0055`; `open_gaps` + `"ADR-0055 à frente do código (L11/I11 planned)"`; `note` sem ADR-0017/I7 como vigente (drift).
- `by_business_rule` + `sincronizacao-status-lote-sispag`.

## 6. Watchlist (`_inbox/_watchlist.md`)
- Distinção baixa manual × processamento nativo do `fin052` — revisitar se o PSQ_018 voltar a ser legível e trouxer o canal.

## 7. Docs (Part 9)
- `CLAUDE.md` §"Domain State Machines" diz "Vazio no bootstrap" — drift anterior, fora deste escopo; sugerir follow-up.
- `docs-contexto/03_ontologia_financeiro.md` — conferir menção a `marcarRetorno`/`RETORNADO` na aplicação.

---
Responder: **approve** · **edit [arquivo] [instrução]** · **reject [motivo]** · **partial [...]**
