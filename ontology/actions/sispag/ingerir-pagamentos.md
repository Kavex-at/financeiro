---
name: ingerirPagamentos
type: action
entity: TituloAPagar
ontology_version: "0.6"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0024_pagamento_ingestao.sql
  - src/backend/domain/client/ConexosSispagClient.ts
  - src/backend/domain/repository/sispag/TituloAPagarRepository.ts
  - src/backend/domain/repository/sispag/PagamentoIngestaoRunRepository.ts
  - src/backend/domain/service/sispag/IngestaoPagamentosService.ts
  - src/backend/domain/service/sispag/CarteiraAtualizacaoService.ts
  - src/frontend/app/sispag/useCarteiraAoAbrir.ts
  - src/backend/domain/service/sispag/SispagPainelService.ts
  - src/backend/routes/sispag.ts
  - src/backend/jobs/ingest-pagamentos.ts
last_review: 2026-10-05
preconditions:
  - "Sessão Conexos ativa (SID compartilhado)."
  - "Escopo de filiais definido (multi-filial, I4)."
  - "Mutações via cron ('cron'), trigger manual autenticado (POST /sispag/ingestao) ou refresh ao abrir a tela (POST /sispag/carteira/atualizar, ADR-0060); histórico via GET /sispag/ingestao/runs."
postconditions:
  - "Carteira de títulos a pagar (dados básicos) persistida em titulo_a_pagar via UPSERT (chave natural filCod:docCod:titCod)."
  - "Títulos ausentes da run atual marcados ativo=false (anti-fantasma) — somem do painel."
  - "Run de auditoria gravada em pagamento_ingestao_run (quem/quando/status/total_titulos/total_inativados)."
  - "Nenhuma escrita no ERP (I1) — leitura Conexos + escrita LOCAL (Postgres)."
  - "Título que fica ativo = false (sumiu do fin064) encerra o BloqueioDuplicidade ATIVO dele (ATIVO → ENCERRADO, ator sistema; I13g, ADR-0063)."
side_effects:
  - "Leitura paginada do fin064 + alçada com308 (rate-limit — fan-out com concorrência LIMITADA/BoundedConcurrency)."
  - "UPSERT em titulo_a_pagar + marcarInativosForaDaRun; INSERT em pagamento_ingestao_run."
  - "Advisory lock (IngestLockBusyError → HTTP 409) bloqueia rodada concorrente; idempotência por Idempotency-Key (pagamento_ingestao_idempotency)."
---

# ingerirPagamentos — ingestão da carteira SISPAG (cron + manual)

> **Vigência:** 2026-07-08 (v0.6.0, ADR-0016). Lê a carteira de títulos a pagar do Conexos (`fin064`
> + alçada `com308`) e **persiste os dados básicos** em `titulo_a_pagar`, numa **cadência diária**
> (cron) mais um **trigger manual**. Espelha a ingestão de Permutas ([`elegerAdiantamentos`](../eleger-adiantamentos.md)
> + ADR-0006): mesmo compute para cron e manual, run de auditoria, advisory-lock/idempotência,
> anti-fantasma. É **READ-ONLY no ERP** (I1) — a única escrita é o banco próprio.

## Gatilhos

| Gatilho | Caminho | `triggered_by` |
|---------|---------|----------------|
| **Cron** | `job:ingest-pagamentos` (`src/backend/jobs/ingest-pagamentos.ts`): 07:00 BRT todo dia + 12:00 e 16:00 BRT em dia útil (ADR-0060) | `'cron'` |
| **Manual** | `POST /sispag/ingestao` (`src/backend/routes/sispag.ts`) | username do analista (JWT verificado, server-side, não spoofável) |
| **Ao abrir a tela** (ADR-0060) | `POST /sispag/carteira/atualizar` (`sispag:ver`) — só roda se a carteira tem > 30 min | `abertura:<username>` |
| **Histórico** | `GET /sispag/ingestao/runs` | — (READ-ONLY, últimas N runs) |

Ambos os gatilhos rodam o **mesmo** compute (`IngestaoPagamentosService`). O manual é uma **interface
humana** para a ingestão existente (*human-in-the-loop*), não um segundo caminho de domínio.

## Fluxo

`IngestaoPagamentosService.executar`:

1. Adquire o **advisory lock** (`pg_try_advisory_lock`). Se já há uma rodada em andamento (cron ou
   outro analista), lança `IngestLockBusyError` (tipado) → **HTTP 409**, **sem** gravar run de erro
   (contenção ≠ falha — não polui a auditoria). Espelha ADR-0006 §3.
2. Abre a run em `pagamento_ingestao_run` (`status='running'`, `triggered_by`, `started_at`).
3. **Fan-out LIMITADO** (BoundedConcurrency) sobre as filiais/páginas do `fin064`, enriquecendo com a
   alçada `com308`. `ConexosSispagClient.mapTitulo` (compartilhado com o painel) mapeia cada título
   e computa `aprovado` (AND das flags de alçada), `pago`, `prontoParaRemessa` (heurística),
   `pesCod`, `tpdCod`.
4. `TituloAPagarRepository.upsertMany` — UPSERT dos títulos da run (chave natural
   `filCod:docCod:titCod`), gravando `ingestao_run_id` e `atualizado_em`.
5. `TituloAPagarRepository.marcarInativosForaDaRun(runId)` — títulos cuja última run **não** é a
   atual viram `ativo=false` (**anti-fantasma**; somem do painel).
6. Fecha a run (`status='success'`, `total_titulos`, `total_inativados`, `finished_at`) — ou
   `status='error'` + `error_message` na falha.

## Atualização ao abrir a tela (ADR-0060)

A tela mostra a carteira gravada e pede o refresh; `CarteiraAtualizacaoService.atualizarSeDefasada`
decide, nesta ordem, e devolve um **estado**:

| Estado | Condição | Roda a ingestão? |
|---|---|---|
| `fresca` | última run `success` com menos de `SISPAG_CARTEIRA_TTL_MIN` (30 min) | não |
| `em_andamento` | run `running` iniciada há < 10 min, ou o advisory lock está ocupado | não |
| `falha_recente` | última run `error` há < `SISPAG_CARTEIRA_COOLDOWN_MIN` (5 min) | não (evita uma tentativa por abertura quando o robô toma 403) |
| `atualizada` | nenhuma das anteriores | **sim**, o mesmo `executar` do cron e do manual |

Invariantes: (a) basta `sispag:ver` — a rota só lê o Conexos (I1) e escreve no Postgres próprio;
(b) **nunca forma lotes** (formação continua só no cron e no botão); (c) contenção não é erro
(`IngestLockBusyError` vira `em_andamento`); (d) run `running` com mais de 10 min é run morta e não
bloqueia. A tela recarrega o painel quando o estado é `atualizada` e reconfere a cada 8 s (até 6
vezes) quando `em_andamento`.

## Idempotência

- **Manual:** `Idempotency-Key` → `pagamento_ingestao_idempotency` (retorna a run existente em vez de
  refazer o fan-out).
- **Semântica:** idempotente por design — recomputa a carteira a cada run via UPSERT + anti-fantasma;
  rodar 2× no mesmo dia converge ao mesmo estado persistido (sem duplicação, sem título-fantasma).
- **Concorrência:** o advisory lock garante uma rodada por vez — protege o Conexos de fan-out
  duplicado (rate-limit/sessão) e a auditoria de ruído.

## Persistir básico, hidratar detalhe ao vivo (ADR-0016)

- A ingestão persiste apenas os **dados básicos** da carteira (credor, valor, venc, aprovado, pago,
  banco, aging). O **detalhe pesado de remessa** (modalidade/barras/PIX/CNPJ/conta) **não** é
  persistido — é lido **AO VIVO no envio** (Fatia 3), evitando **drift** entre o snapshot e a
  realidade do ERP na hora de gerar o arquivo.
- `prontoParaRemessa` gravado aqui é **heurística informativa**; a validação real do que vira remessa
  é no envio, ao vivo. Ver `entities/titulo-a-pagar.md`.

## Segurança / consistência

- **READ-ONLY no ERP (I1):** o `ConexosSispagClient` não importa nenhum verbo mutante; a única
  escrita é o Postgres próprio.
- **Auditoria (I5):** cada rodada grava quem/quando/status/contagens (`pagamento_ingestao_run`).
- Zod/guard nos boundaries do ERP (`fin064`/`com308`) antes de mapear; SQL parametrizado no UPSERT.

## Por que está na ontologia (universalidade)

Universal: materializar a carteira de pagamentos numa **cadência confiável** (com auditoria e
anti-fantasma) é a base de qualquer operação SISPAG assistida — o gargalo declarado é **visibilidade
+ cadência**. A estrutura (ingestão periódica + manual, UPSERT, run de auditoria, anti-fantasma,
persistir-básico/hidratar-detalhe) é do domínio; os valores (janela, horário do cron, níveis de
alçada, IDs de banco) são config do tenant. Espelha a doutrina já validada em Permutas.
