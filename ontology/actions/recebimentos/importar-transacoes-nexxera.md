---
name: importarTransacoesNexxera
type: action
entity: TransacaoBancaria
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-07-24
preconditions:
  - "Canal Nexxera configurado (API vs SFTP/CNAB) — spike O7 (integrations/nexxera.md)."
  - "Escopo de filiais/contas definido (multi-filial)."
  - "Gatilho: cron (cadência diária) ou trigger manual autenticado (mirror de ingerirPagamentos)."
postconditions:
  - "Movimentos importados persistidos em transacao_bancaria (raw + normalizado), deduplicados por chave natural."
  - "Cada movimento nasce com correlation id (observabilidade ponta-a-ponta, Módulo 6)."
  - "Run de auditoria gravada (quem/quando/status/total_importados/total_deduplicados)."
  - "Nenhuma escrita no Nexxera (só importa) — escrita LOCAL (Postgres)."
side_effects:
  - "Leitura do extrato via Nexxera pelo port channel-agnostic (API/SFTP/CNAB pluggable, O7)."
  - "UPSERT/INSERT em transacao_bancaria (dedup por natural key); INSERT na run de importação."
  - "Advisory lock (contenção → 409) + idempotência por Idempotency-Key (espelha ingerirPagamentos)."
---

# importarTransacoesNexxera — ingestão do extrato bancário (Módulo 1) — SKELETON

> **SKELETON (Fase 0). Implementação = Fase 1 (Módulo 1), gated pelo spike O7.** Importa as
> movimentações bancárias do **Nexxera** (direto), guarda o **payload cru + a forma normalizada**,
> **deduplica** por chave natural e grava uma **run de auditoria**. É o **espelho inbound de
> `ingerirPagamentos`** (SISPAG): mesma doutrina de cron + trigger manual, advisory-lock,
> idempotência, run de auditoria e anti-fantasma. Ver `entities/transacao-bancaria.md`,
> `state-machines/transacao-bancaria.md` e `integrations/nexxera.md`.

## Gatilhos (SKELETON — Fase 1)

| Gatilho | Caminho | `triggered_by` |
|---------|---------|----------------|
| **Cron diário** | job de importação (a definir na Fase 1) | `'cron'` |
| **Manual** | endpoint autenticado (a definir) | username do analista |
| **Histórico** | listagem de runs de importação | — (READ-ONLY) |

Ambos rodam o **mesmo compute** (o manual é a interface humana da mesma importação — *human-in-the-loop*).

## Fluxo (SKELETON — Fase 1)

1. Adquire o **advisory lock** (uma importação por vez — protege o canal Nexxera de fan-out duplicado).
2. Abre a run de importação (`running`, `triggered_by`, `started_at`).
3. Lê o extrato pelo **port channel-agnostic** (adaptador API **ou** SFTP/CNAB, resolvido no O7).
4. **Normaliza** cada movimento para a forma interna; guarda o `rawPayload` cru.
5. **Deduplica** por `naturalKey` (não reimporta o mesmo movimento); atribui `correlationId`.
6. Persiste em `transacao_bancaria`; fecha a run (`success`/`error` + contagens).

## Idempotência / dedup (SKELETON)

- Dedup por **chave natural** (fórmula na Fase 1) — reimportar o mesmo extrato converge ao mesmo estado.
- `Idempotency-Key` no manual (retorna a run existente em vez de reimportar). Espelha `ingerirPagamentos`.

## Por que está na ontologia (universalidade)

Universal: importar o extrato bancário numa **cadência confiável** (raw + normalizado, deduplicado,
auditado, com correlation id) é a base de qualquer conciliação de recebimentos. A estrutura (importação
periódica + manual, dedup por chave natural, run de auditoria, port channel-agnostic) é do domínio; os
valores (canal, formato, horário do cron, contas) são config do tenant / decisão de contrato (O7).

## Fora de escopo (Fase 0 — SKELETON)

- Canal/formato/auth do Nexxera (O7), wire do extrato, fórmula da chave natural: **Fase 1**.
</content>
</invoke>
