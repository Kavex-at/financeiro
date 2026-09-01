---
name: JobRun
type: entity
ontology_version: "0.22"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0001_permuta_eleicao.sql
  - src/backend/migrations/0024_pagamento_ingestao.sql
  - src/backend/migrations/0040_recebimento_ingestao.sql
  - src/backend/migrations/0053_job_execucao.sql
  - src/backend/domain/interface/operacao/JobRun.ts
  - src/backend/domain/service/operacao/JobRunReadModel.ts
  - src/backend/domain/repository/operacao/JobExecucaoRepository.ts
properties:
  - runId
  - pipeline
  - status
  - triggeredBy
  - startedAt
  - finishedAt
  - duracaoMs
  - idadeDesdeUltimoSucesso
  - metricas
  - errorMessage
---

# JobRun

> **Read-model, NÃO tabela.** `JobRun` é uma projeção normalizada sobre as tabelas de run que já
> existem. Nenhuma migration cria `job_run`; **nenhum writer atual é tocado** (ADR-0042).
>
> Jobs **novos** são o caso separado: eles nascem escrevendo `job_execucao` (migration `0053`),
> tabela aditiva com `partial` desde o início. A restrição da ADR-0042 é sobre não MIGRAR writers
> vivos, não sobre proibir trilha para código novo — e um job novo sem trilha seria mais um reaper.

## Por que read-model e não tabela unificada

As três fontes são de frentes diferentes, escritas por caminhos de código que movem dinheiro, e
divergem de propósito. Unificá-las exigiria migrar três writers vivos e fazer backfill — a mudança
mais arriscada possível de se fazer justamente enquanto ainda não existe alerta nenhum para avisar
se ela quebrar algo. O read-model entrega a mesma tela com risco zero.

## Fontes

| `pipeline` | Tabela | Vocabulário de status | Métricas próprias |
|---|---|---|---|
| `permutas-eleicao` | `permuta_eleicao_run` | `success/partial/error` | candidatas, elegíveis, bloqueadas |
| `recebimentos-extratos` | `recebimento_ingestao_run` | `running/success/partial/error` | lidas, inseridas, deduplicadas, contas, contas falhas |
| `sispag-pagamentos` | `pagamento_ingestao_run` | `running/success/error` | títulos, inativados |

## Invariante — `partial` não vira `success`

Duas das três fontes distinguem `partial` (`permuta_eleicao_run` e `recebimento_ingestao_run`);
**`pagamento_ingestao_run` (SISPAG) não** — ele fecha `success` mesmo com filial falhada, o que é
uma divergência real e deliberada entre as frentes, registrada no próprio comentário da migration
`0040`.

O read-model **preserva** o estado de quem o tem. Achatar `partial` em `success` apagaria
exatamente o sinal das runs com contas falhas — hoje 5 runs com 77 contas falhas que ninguém
investigou (`docs/impacto/h0-recebimentos-achados.md` §1).

E o read-model **não inventa** o estado onde a fonte não o distingue: SISPAG nunca reporta
`partial`. Isso é uma **cegueira herdada**, não um sinal de saúde — uma run SISPAG com filial
falhada é indistinguível de uma run limpa. Fica registrado como follow-up (dar `partial` ao
`pagamento_ingestao_run`), fora deste slice porque mexeria num writer vivo, que é precisamente o
que a ADR-0042 decidiu não fazer agora.

## `metricas` é um saco aberto

Cada fonte projeta as suas próprias chaves. O read-model não força um denominador comum — forçar
faria a tela mentir sobre pipelines cujo trabalho não é comparável (eleger candidatas × inserir
lançamentos × inativar títulos).

## Extensão

Um pipeline novo entra escrevendo um adapter. Não há migration a fazer, mas também não há herança
automática: **pipeline sem adapter é invisível no painel.** É a dívida conhecida deste desenho, e o
preço de não tocar nos writers atuais.

**Caso concreto já existente:** `jobs/reaper-sispag-reconciling.ts` não escreve linha de run nenhuma
— sem fonte, não há adapter possível. O painel o lista como `sem trilha de execução` em vez de
omiti-lo, porque omitir afirmaria cobertura completa sobre 3 de 4 jobs. Ver
`business-rules/staleness-por-pipeline.md`.
