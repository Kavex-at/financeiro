---
name: TransacaoBancaria
type: entity
ontology_version: "0.12"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0032_transacao_bancaria.sql
  - src/backend/migrations/0040_recebimento_ingestao.sql
  - src/backend/domain/interface/recebimentos/TransacaoBancaria.ts
  - src/backend/domain/repository/recebimentos/TransacaoRepository.ts
  - src/backend/domain/service/recebimentos/normalizarLancamento.ts
properties:
  - id
  - correlationId
  - filCod
  - dataMovimento
  - tipo
  - valor
  - moeda
  - contraparte
  - referenciaBancaria
  - naturalKey
  - rawPayload
  - normalized
  - status
  - importRunId
  - importadoEm
relationships:
  - "TransacaoBancaria N—0..1 Filial (via filCod; ausente no canal fin095 — conta corporativa, ADR-0032)"
  - "TransacaoBancaria 1—1 Recebimento (um crédito conciliável dá origem a no máximo um Recebimento vivo)"
  - "TransacaoBancaria N—1 ImportacaoTransacoesRun (via importRunId — a run Nexxera que gravou este movimento)"
last_review: 2026-07-24
universality_evidence:
  - "docs-contexto/03_ontologia_financeiro.md — Frente IV (Conciliação de Recebimentos): o extrato bancário é o insumo primário do inbound"
  - "ontology/_inbox/frente-iv-recebimentos-interview.md — Eixo 1: TransacaoBancaria (raw + normalizado, correlation id, deduped)"
  - "ontology/_inbox/frente-iv-recebimentos-nde-plan.md §4 — Módulo 1 (import Nexxera): TransacaoBancaria raw+normalizado"
  - "Conceito universal de financeiro: um movimento bancário (crédito/débito/estorno/tarifa) importado do extrato é a unidade de conciliação de qualquer contas-a-receber"
---

# TransacaoBancaria (movimento bancário importado — Frente IV)

> **SKELETON (Fase 0).** Um `TransacaoBancaria` é um **movimento bancário único** importado do
> **Nexxera** (crédito, débito, estorno, tarifa, juros, …). É o **espelho inbound** do
> `TituloAPagar` do SISPAG (outbound): a unidade da carteira de conciliação de recebimentos. Guarda
> o **payload cru original** (`rawPayload`) + uma **forma normalizada** interna (`normalized`),
> carrega um **correlation id** desde o nascimento (observabilidade ponta-a-ponta, Módulo 6) e é
> **deduplicado** por chave natural. A modelagem profunda (mapeamento wire, formato do extrato) é
> **Fase 1 (Módulo 1) — IMPLEMENTADA.** O spike **O7 foi encerrado**: a fonte é o Conexos
> (`fin133` → `fin095`), não a Nexxera direto. Ver ADR-0023. Referência original: ver
> `integrations/nexxera.md`.

## Definição de domínio

Um `TransacaoBancaria` representa **dinheiro que entrou (ou saiu/estornou)** na conta da trading,
lido do extrato via Nexxera. O crédito é o gatilho da conciliação: cada crédito é candidato a ser
atribuído (baixado) a um ou mais `DocumentoAReceber` (ação `atribuirBaixa`). Débitos/tarifas/juros
compõem o extrato completo (auditoria) mas não geram baixa de recebível por si.

Esta entidade **lê e persiste** o movimento importado; nesta frente a origem é o **banco via
Nexxera** (não o ERP). É **READ-ONLY no Nexxera** (só importa) e a única escrita é o banco próprio.

## Propriedades (SKELETON — wire a confirmar na Fase 1, spike O7)

| Propriedade | Tipo | Origem (wire/coluna) | Notas |
|-------------|------|----------------------|-------|
| `id` | string (uuid) | `transacao_bancaria.id` | Identidade interna. |
| `correlationId` | string | `transacao_bancaria.correlation_id` | **Nasce aqui** — rastreia o movimento Nexxera → baixa → quitação → NDe (Módulo 6, observabilidade). Invariante de auditoria. |
| `filCod` | number? | `transacao_bancaria.fil_cod` | **`null` = conta CORPORATIVA** (ADR-0032). O `fin095` é escopado por conta, não por filial: um crédito do canal automático não tem filial até ser alocado a um processo — quem carrega a filial da operação é `recebimento.fil_cod`. O canal `xlsx_bradesco` **mantém** preenchido (a filial é escolha do analista no upload). NÃO é mais a invariante I4 do SISPAG. |
| `dataMovimento` | Date | extrato → `data_movimento` | Data do lançamento no extrato. |
| `tipo` | enum | extrato → `tipo` | `CREDITO \| DEBITO \| ESTORNO \| TARIFA \| JUROS \| …` — constantes tipadas (enum exato na Fase 1). |
| `valor` | number | extrato → `valor` | Valor do movimento. |
| `moeda` | string | extrato → `moeda` | Moeda (doméstico esperado; confirmar na Fase 1). |
| `contraparte` | string? | extrato → pagador/CNPJ/nome | Quem pagou (insumo do matching por cliente/CNPJ, Módulo 2). |
| `referenciaBancaria` | string? | extrato → ref/histórico/id Pix | Referência livre do banco (insumo do matching). |
| `naturalKey` | string | derivado (dedup) | **Chave natural de deduplicação** — `fin095:{gerNum}:{extCod}:{exiCodSeq}` (ADR-0023, corrigida pela ADR-0032: o `filCod` era contexto de leitura, não identidade, e duplicava cada lançamento uma vez por filial). NUNCA inclui campo mutável (`vldConciliado`, `dtaConc`, valor): o ERP os atualiza ao conciliar e a mesma linha reingeriria como nova. |
| `gerNum` | number? | `fin133`/parâmetro | Conta financeira de origem. É a **"Conta Financeira de Baixa"** que o `fin014` exigirá na Fase 5 — por isso é coluna, não JSONB. |
| `categoria` / `categoriaDesc` | string? | `exiEspCategoria` | Discriminador do RUÍDO DE TESOURARIA (resgate de aplicação, ações, transferência entre contas). Filtro de exibição; a ingestão persiste tudo. |
| `rawPayload` | json | `transacao_bancaria.raw_payload` | **Payload cru original** do Nexxera (auditoria + reprocessamento sem re-fetch). |
| `normalized` | json | `transacao_bancaria.normalized` | Forma **normalizada** interna (independe do canal API/SFTP/CNAB — port channel-agnostic, O7). |
| `status` | enum | `transacao_bancaria.status` | Ciclo de vida da conciliação — ver `state-machines/transacao-bancaria.md` (`importada → conciliada/parcial/manual/erro`). |
| `importRunId` | string? (uuid) | FK → run de importação | A run Nexxera que gravou o movimento (auditoria de cadência). |
| `importadoEm` | Date | `importado_em` | Quando foi importado. |

## Distinção — inbound (esta) × outbound (`TituloAPagar`)

`TransacaoBancaria` é o **crédito recebido** (dinheiro que ENTROU); `TituloAPagar` (SISPAG) é a
**obrigação a pagar** (dinheiro que SAI). São frentes espelhadas: a Frente IV é o *inbound /
receivables* da Frente II (*outbound / payments*). Ver `entities/titulo-a-pagar.md`.

## Fora de escopo (Fase 0 — SKELETON) — resolvido

- ~~Mapeamento wire do extrato, formato (CNAB240 / OFX / JSON API), auth e canal (API vs SFTP),
  gated pelo spike **O7**~~ → **resolvido pelo ADR-0023**: a fonte é o **Conexos**
  (`fin133` contas → `fin095` lançamentos), **não** a Nexxera. Ver
  `integrations/conexos-fin095-extrato.md`.
- A importação real é a ação **`importarTransacoesExtrato`** (`implemented`), com cadência **horária**
  e piso de janela em **2026-08-03** (ADR-0028).
