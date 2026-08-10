---
name: importarTransacoesExtrato
type: action
entity: TransacaoBancaria
ontology_version: "0.15"
implementation_status: implemented
status: active
owners: [yuri]
related_files:
  - src/backend/domain/service/recebimentos/IngestaoTransacoesService.ts
  - src/backend/domain/service/recebimentos/normalizarLancamento.ts
  - src/backend/domain/client/ConexosExtratoClient.ts
  - src/backend/domain/repository/recebimentos/TransacaoRepository.ts
  - src/backend/jobs/ingest-extratos.ts
  - .github/workflows/ingest-extratos.yml
last_review: 2026-08-04
preconditions:
  - "Conexos alcançável; leitura fin133 (contas) → fin095 (lançamentos). READ-ONLY no ERP."
  - "Escopo de filiais por RECEBIMENTO_INGEST_FIL_CODS (vazio = todas as do ERP)."
  - "Gatilho: cron horário (GitHub Actions) ou trigger manual autenticado (admin)."
postconditions:
  - "Lançamentos persistidos em transacao_bancaria (raw + normalizado), deduplicados por chave natural."
  - "Cada transação nasce com correlation id determinístico (observabilidade ponta-a-ponta)."
  - "Run de auditoria gravada (quem/quando/status/lidas/inseridas/deduplicadas/contas com falha)."
  - "NENHUM lançamento anterior ao piso de ingestão é gravado (ADR-0028)."
  - "Nenhuma escrita no ERP — a única escrita é o Postgres próprio."
side_effects:
  - "Leitura paginada do fin095 por conta, com a janela fatiada em blocos de 30 dias."
  - "UPSERT em transacao_bancaria (ON CONFLICT natural_key); INSERT na run de importação."
  - "Advisory lock (contenção → 409) + idempotência por Idempotency-Key no trigger manual."
---

# importarTransacoesExtrato — ingestão do extrato bancário (Módulo 1)

> Importa os **créditos do extrato bancário** do **Conexos** (`fin133` contas → `fin095`
> lançamentos), guarda o **payload cru + a forma normalizada**, **deduplica** por chave natural e
> grava uma **run de auditoria**. É o **espelho inbound de `ingerirPagamentos`** (SISPAG).
>
> ⚠️ **A fonte é o Conexos, não a Nexxera** — ADR-0023 (D1/D2) supersede a D4 do ADR-0022 e encerra
> o spike O7. O nome antigo (`importarTransacoesNexxera`) está aposentado.
>
> Ver `entities/transacao-bancaria.md`, `state-machines/transacao-bancaria.md` e
> `integrations/conexos-fin095-extrato.md`.

## Gatilhos

| Gatilho | Caminho | `triggered_by` |
|---------|---------|----------------|
| **Cron horário** | `.github/workflows/ingest-extratos.yml` (`20 * * * *`) → `npm run job:ingest-extratos` | `'cron'` |
| **Manual** | `POST /recebimentos/ingestao` (admin, `Idempotency-Key`) | username do analista |
| **Upload `.xlsx`** | `POST /recebimentos/ingestao/upload` (canal manual Bradesco) | username do analista |
| **Histórico** | `GET /recebimentos/ingestao/runs` | — (READ-ONLY) |

Todos rodam o **mesmo compute** (o manual é a interface humana da mesma importação —
*human-in-the-loop*).

## Janela de leitura — piso de go-live (ADR-0028)

A janela é `RECEBIMENTO_INGEST_DIAS` (default 90) **recortada pelo piso**
`CONEXOS_EXTRATO_SYNC_START_DATE` (default **2026-08-03**): a janela efetiva é a **interseção** das
duas.

O piso é **duro** e vale para **todos** os caminhos, inclusive o backfill explícito (`DIAS=` no job e
`{ dias }` na rota). Motivo: crédito anterior ao go-live pertence ao processo manual antigo e
entraria na carteira do analista como **pendência falsa** que ninguém vai conciliar. Ir mais atrás
exige mudar a env — decisão consciente, não efeito colateral de um número grande digitado no painel.

O piso é um **mínimo, não uma data fixa**: passado o tempo, a janela volta a ser a pedida (senão a
ingestão releria 2026-08-03 em diante para sempre, crescendo sem fim).

## Fluxo

1. Adquire o **advisory lock** (`RECEBIMENTO_INGEST_LOCK_KEY`) **uma vez no topo** — nunca por
   filial: `pg_try_advisory_lock` é session-scoped e o aninhamento faria toda filial virar 409.
2. Abre a run de importação (`running`, `triggered_by`, `started_at`, janela, filiais).
3. Resolve os alvos `(filial × conta)` pelo `fin133`, **pulando contas sem movimento**.
4. Fan-out **achatado** num único `BoundedConcurrency` (`FANOUT_LIMIT_RECEBIMENTOS`) — dois níveis
   aninhados dariam FANOUT² sessões e reproduziriam o incidente `LOGIN_ERROR_MAX_SESSIONS`.
5. Por conta, fatia a janela em blocos de 30 dias e lê o `fin095` (`exiDtaLcto#GE/#LE` em epoch-ms).
6. **Normaliza** cada lançamento; guarda o `rawPayload` cru.
7. **UPSERT** em `transacao_bancaria` por `naturalKey`; fecha a run (`success` / `partial` / `error`
   + contagens).

**Sem anti-fantasma** (diferença deliberada em relação ao `titulo_a_pagar`): extrato bancário é
imutável — um lançamento não some da fonte. Inativar por ausência mascararia falha de leitura como
conciliação.

## Idempotência / dedup

- **Chave natural:** `fin095:{gerNum}:{extCod}:{exiCodSeq}`. **Nunca** inclui campo mutável
  (`vldConciliado`, `dtaConc`, valor): o ERP os atualiza ao conciliar e a mesma linha reingeriria
  como transação nova. **Nunca inclui `filCod`** (ADR-0032): o `fin095` é escopado por conta e
  ignora a filial do header — o `filCod` na chave duplicava cada lançamento uma vez por filial
  configurada (medido: 728 linhas para 104 lançamentos reais, 86% de excedente).
- **Fan-out por CONTA, não por (filial × conta):** os alvos são deduplicados por `gerNum`; a filial
  serve só como contexto de sessão do header. Uma conta é lida uma vez por run (6 leituras, não 42).
- **Garantia no BANCO:** `UNIQUE (natural_key)` (migration 0032) + `ON CONFLICT (natural_key)`. Não é
  checagem em memória.
- `id` e `correlationId` são **determinísticos** (derivados da chave natural), então insert e update
  convergem e a identidade não depende do `runId` da execução — sem isso o cron horário duplicaria a
  carteira 24× por dia.
- O UPDATE do conflito é guardado por `WHERE status = 'importada'`: reingestão **nunca** devolve para
  `importada` uma transação que o analista já moveu para `conciliada`/`parcial`/`manual`.
- `Idempotency-Key` no trigger manual (retorna a run existente em vez de reimportar).
- Medido em produção: reingestão **100% deduplicada** (1.759 créditos, filial 1, 90 dias).

## Cadência e resiliência

- **De hora em hora** (`20 * * * *`). O minuto `:20` é deliberado: os outros crons rodam no `:00`
  (Permutas `0 9,15,21`; SISPAG `0 10`) e o Conexos limita sessões simultâneas por usuário.
- **Sobreposição** barrada em duas camadas: `concurrency` do workflow (entre runs do cron) e advisory
  lock (contra trigger manual e upload `.xlsx`, que compartilham a mesma chave).
- **Até 3 tentativas** com backoff no workflow. Retentar é seguro pela dedupe por chave natural, e
  recupera tanto falha transitória do Conexos quanto o 409 de lock ocupado.
- **Falha parcial** não corrompe: a conta que falhou é logada com identificação, a run fecha como
  `partial` e nada é apagado. O painel não anuncia carteira completa quando não está.
- Truncamento de paginação **lança** `ExtratoTruncadoError` em vez de devolver lista incompleta em
  silêncio.

## Por que está na ontologia (universalidade)

Universal: importar o extrato bancário numa **cadência confiável** (raw + normalizado, deduplicado,
auditado, com correlation id) é a base de qualquer conciliação de recebimentos. A estrutura
(importação periódica + manual, dedup por chave natural, run de auditoria, piso de go-live) é do
domínio; os valores (ERP de origem, cadência, piso, contas) são config do tenant.

## Débito conhecido

- **Usuário-robô dedicado no Conexos** (P1, `_inbox/frente-iv-fase1-followups.md` item 1): cada
  processo Node faz login próprio e disputa os ~3 slots de `LOGIN_ERROR_MAX_SESSIONS` com o app e com
  jobs manuais. Passar de "não agendado" para "de hora em hora" aumenta essa pressão; o `:20` e o
  fan-out bounded mitigam, mas o usuário dedicado é a correção real.
