---
name: TituloAprovacao
type: entity
ontology_version: "0.10"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0049_aprovacao_trilha.sql
  - src/backend/domain/interface/aprovacoes/TituloAprovacao.ts
  - src/backend/domain/interface/aprovacoes/ports.ts
  - src/backend/domain/repository/aprovacoes/TituloAprovacaoRepository.ts
  - src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts
  - src/backend/domain/client/ConexosAprovacoesClient.ts
  - src/backend/routes/aprovacoes.ts
  - src/backend/jobs/ingest-aprovacoes.ts
  - src/frontend/app/aprovacoes/page.tsx
properties:
  - filCod
  - docCod
  - titCod
  - documentoNumero
  - tituloNumero
  - fornecedorCod
  - fornecedorNome
  - valor
  - moeda
  - dataEmissao
  - dataVencimento
  - dataFinalizacao
  - statusWorkflow
  - etapasConcluidas
  - etapasTotais
  - primeiraEtapaEm
  - ultimaAcaoEm
  - tempoTotalSegundos
  - lacunas
  - ativo
  - ingestaoRunId
  - observadoEm
relationships:
  - "TituloAprovacao 1—N EtapaAprovacao (via filCod:docCod:titCod — a trilha do título)"
  - "TituloAprovacao N—1 AprovacaoIngestaoRun (via ingestaoRunId — a run que observou este título)"
  - "TituloAprovacao 0—1 TituloAPagar (mesmo título no ERP, universos DIFERENTES — ver §Relação com a Frente II)"
last_review: 2026-08-19
universality_evidence:
  - "Sondagem read-only em produção (2026-08-18): filial 2, amostra de 300 títulos sobre universo de 23.632 — 49,3% possuem trilha de aprovação"
  - "ontology/_inbox/frente-v-probe-resultado.md §2 — 11 etapas distintas, 14 aprovadores, mediana 2,5h e cauda de 234h"
  - "Conceito universal de financeiro: um título a pagar passa por alçadas antes de ser liberado; medir esse trânsito é diagnóstico de gargalo"
---

# TituloAprovacao (cabeçalho observado da trilha de aprovação)

> **Snapshot local** de um título de contas a pagar do ERP Conexos, sob a ótica do **workflow de
> aprovação**. Guarda a identificação do título, o **status agregado** do workflow e os números
> derivados da trilha (quantas etapas, quanto tempo). A trilha em si vive em
> [`EtapaAprovacao`](etapa-aprovacao.md). É **read-only no ERP** (I1) — a única escrita é no nosso
> Postgres.

## Definição de domínio

Um `TituloAprovacao` é a **linha do painel da Frente V**: um título a pagar observado com o
propósito de responder *"este documento precisou de aprovação? de quem? quanto tempo levou? em que
pé está?"*.

Ele existe mesmo quando o título **não tem workflow nenhum** — nesse caso `statusWorkflow` é
`SEM_WORKFLOW` e não há etapas. Isso é informação, não ausência de informação: cerca de metade dos
títulos da filial 2 não passa por aprovação, e saber quais é parte do diagnóstico.

## Relação com a Frente II (`TituloAPagar`) — entidades distintas de propósito

`TituloAPagar` (SISPAG) e `TituloAprovacao` (Frente V) descrevem títulos do mesmo ERP, mas **não são
a mesma coisa** e **não compartilham tabela**:

| | `TituloAPagar` (Frente II) | `TituloAprovacao` (Frente V) |
|---|---|---|
| Pergunta que responde | "o que pago hoje?" | "quem aprovou, e quanto demorou?" |
| Fonte | `fin064/list` (carteira corrente) | `psq014/list` (pesquisa, histórico) |
| Recorte | janela de vencimento, sem internacional | janela de **emissão**, histórico |
| Cadência | diária, volátil | histórica, imutável após resolvida |

**Evidência de que os universos diferem:** o doc 4156 (filial 1), que tem trilha completa, **não
aparece** no `fin064`/carteira corrente. Unificar as duas entidades faria a Frente V herdar as regras
de elegibilidade de lote (I2/I4, ADR-0021) que nada têm a ver com aprovação.

> **Follow-up para a Frente II:** `ontology/entities/titulo-a-pagar.md` afirma que `aprovado` deriva
> do AND de `titVld1/2/3libera`. A sondagem provou que essas flags valem `1` em 100% dos títulos, sem
> timestamps — são **vestigiais**. O código real usa `vldLib` do `fin064`
> (`src/backend/domain/client/ConexosSispagClient.ts:150`), então o comportamento está correto, mas a
> ontologia descreve o campo errado.

## Propriedades

| Propriedade | Tipo | Origem (wire → coluna) | Notas |
|-------------|------|------------------------|-------|
| `filCod` | number | `psq014.filCod` → `fil_cod` | **Invariante I5** — vem sempre do registro, nunca de default. Consultar a trilha com a filial errada devolve `count: 0` **sem erro** |
| `docCod` | number | `psq014.docCod` → `doc_cod` | Parte da chave natural |
| `titCod` | number | `psq014.titCod` → `tit_cod` | Parte da chave natural |
| `documentoNumero` | string? | `psq014.docEspNumero` → `documento_numero` | Número visível do documento |
| `tituloNumero` | string? | `psq014.titEspNumero` → `titulo_numero` | Número visível do título |
| `fornecedorCod` | number? | `psq014.pesCod` → `fornecedor_cod` | **Dimensão da Fase 2** |
| `fornecedorNome` | string? | `psq014.dpeNomPessoa` → `fornecedor_nome` | Exibição |
| `valor` | number? | `psq014.titMnyValor` → `valor` | `NUMERIC`; comparação de dinheiro nunca em ponto flutuante |
| `moeda` | string? | → `moeda` | |
| `dataEmissao` | Date? | `psq014.docDtaEmissao` (epoch ms) → `data_emissao` | Campo `Dta*` = **data pura**, sem hora |
| `dataVencimento` | Date? | `psq014.titDtaVencimento` → `data_vencimento` | idem |
| `dataFinalizacao` | Date? | `docDtaFinalizacao` → `data_finalizacao` | **Hoje sempre `null`** — não vem na projeção acessível. Ver **PV-04** e **PV-07** |
| `statusWorkflow` | enum | derivado das etapas → `status_workflow` | Ver [máquina de estados](../state-machines/aprovacao-titulo.md) |
| `etapasConcluidas` | number | derivado → `etapas_concluidas` | Etapas com ação aplicada |
| `etapasTotais` | number | derivado → `etapas_totais` | Etapas conhecidas. **Não** é "quantas o fluxo exige" — o ERP não expõe isso |
| `primeiraEtapaEm` | Date? | `min(etapa.recebidoEm)` → `primeira_etapa_em` | **Marco zero do relógio** enquanto PV-04 estiver aberta |
| `ultimaAcaoEm` | Date? | `max(etapa.agidoEm)` → `ultima_acao_em` | |
| `tempoTotalSegundos` | number? | derivado → `tempo_total_segundos` | De `primeiraEtapaEm` até `ultimaAcaoEm`, ou até agora se pendente |
| `lacunas` | string[] | derivado → `lacunas` (`jsonb`) | **Transparência obrigatória**: o que não sabemos deste título e por quê. Ver I3/I4 |
| `ativo` | boolean | anti-fantasma → `ativo` | Título fora da run mais recente vira inativo |
| `ingestaoRunId` | string? (UUID) | FK → `aprovacao_ingestao_run.id` | Auditoria de cadência |
| `observadoEm` | Date | → `observado_em` | Quando este snapshot foi lido do ERP. **Exposto na UI (I7)** |

## `lacunas` — por que existe

Um painel financeiro auditável não pode apresentar um número inferido como se fosse registro do ERP.
Quando algo não pode ser afirmado, o título carrega a lacuna explícita e a UI a mostra. Casos hoje:

- `ftbVldStatus` fora de `{1, 2}` → status da etapa indeterminado (**PV-01**, 13 ocorrências reais).
- `dataFinalizacao` ausente → o relógio começa na primeira etapa, não na finalização (**PV-04**).
- Etapa sem `agidoEm` → pendente, **sem duração calculada** (I3).

## Fonte e persistência

- **Leitura (READ-ONLY no Conexos, I1):** universo por `POST psq014/list`
  (`filCod#EQ`, `docTip#EQ: 2`, `docDtaEmissao#GE` em **epoch ms**); trilha por
  `POST fin026/infoTitulo/list/{filCod}/{docTip}/{docCod}/{titCod}`.
- **Escrita (LOCAL):** `TituloAprovacaoRepository` — UPSERT por `(fil_cod, doc_cod, tit_cod)`.
- Nenhuma escrita no ERP, em nenhuma circunstância.

## Fora de escopo

- Aprovar/liberar pelo painel (decisão D2 — read-only).
- Contas a receber (`docTip = 1`).
- Agregações da Fase 2 — o schema as suporta (`fornecedorCod`, `filCod` e a pessoa por etapa estão
  materializados), mas nenhuma tela ou endpoint de análise é entregue agora.
