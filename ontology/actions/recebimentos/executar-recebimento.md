---
name: executarRecebimento
type: action
entity: Recebimento
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-07-24
preconditions:
  - "Recebimento aprovado (human-in-the-loop) com rateio balanceado e regras aplicadas."
  - "Contrato de escrita de recebível confirmado ou parametrizado (O3, assume fin010) + contrato de emissão NDe (Fase 5)."
  - "Guard-rails de escrita ligados (write-enabled + dry-run gate, homologação-first — reúso do gating de Permutas)."
postconditions:
  - "Borderô + quitação (total/parcial) registrados no ERP via write parametrizado (O3)."
  - "NDe EMITIDA pelo Conexos ERP; registro local para idempotência."
  - "Recebimento rascunho/aprovado → executado (state-machines/recebimento.md)."
  - "Idempotente: retry NUNCA gera duas quitações nem duas NDe (write-ahead ledger + single-attempt)."
  - "Reversível: estorno controlado (estorno bancário / erro operacional / conciliação incorreta)."
side_effects:
  - "ESCRITA no Conexos (baixa/quitação do recebível + emissão NDe) — gated, dry-run por padrão, homologação-first."
  - "Write-ahead ledger local (recebimento_execucao) — intenção antes do POST; settled só com confirmação do ERP."
---

# executarRecebimento — borderô + quitação + NDe (Módulo 5) — SKELETON

> **SKELETON (Fase 0). Implementação = Fase 5 (Módulo 5) — MAIOR RISCO, homologação-first, gated.**
> Executa a conciliação aprovada: cria/atualiza o **borderô**, faz a **quitação** (total/parcial) do
> recebível no ERP e **emite a NDe via Conexos**. É **idempotente** (retry nunca produz duas
> quitações ou duas NDe) e **reversível** (estorno controlado). **Reúsa a maquinaria de handshake do
> `ConexosBaixaClient`** de Permutas — write-ahead ledger, escrita single-attempt, anti-drift,
> dry-run gate (`CONEXOS_WRITE_ENABLED` + `CONEXOS_DRY_RUN`, homologação-first). Ver
> `business-rules/idempotencia-quitacao-nde.md`, `state-machines/recebimento.md` e
> `integrations/conexos.md` (superfícies de write O3 + emissão NDe).

## Contrato de escrita (SKELETON — O3, confirmar no build)

- **Decisão O3 (interview):** **assume o módulo `fin010`** e **parametriza** o write — `borVldTipo`,
  códigos de conta e o flag de adiantamento (que são **específicos de Permuta**) viram **parâmetros**.
  A maquinaria reusável (write-ahead ledger, single-attempt, anti-drift, dry-run gate) **carrega**;
  o shape do payload/endpoint é **confirmado durante o build** (capturar uma baixa real de recebível
  se a aposta parametrizada não fechar). Ver `integrations/conexos.md`.
- **Emissão NDe:** a NDe é **emitida pelo ERP** (decisão Yuri) — precisa do endpoint/trigger de
  emissão (confirmar junto do O3, Fase 5). Ver `entities/nota-debito-eletronica.md`.

## Invariantes (SKELETON — spec na Fase 5)

- **Idempotência:** `idempotency_key` por `Recebimento`; write-ahead ledger (`recebimento_execucao`,
  `pending → executing → settled/error`); um retry pula o já `settled`. **Uma quitação e uma NDe por
  recebimento.** Ver `business-rules/idempotencia-quitacao-nde.md` (espelha
  `business-rules/idempotencia-reconciliacao.md` de Permutas).
- **Reversibilidade:** estorno controlado (undo) para estorno bancário, erro operacional ou
  conciliação incorreta.
- **Anti-super-baixa:** o valor a quitar vem do **em-aberto vivo do ERP**, não do nosso rascunho
  (espelha o anti-super-pagamento de Permutas).
- **Human-in-the-loop:** só executa `Recebimento` **aprovado** (ADR-0002).

## Por que está na ontologia (universalidade)

Universal: fechar a conciliação com uma **escrita idempotente e reversível** no ERP (baixa/quitação) +
o **artefato terminal** (a NDe) é o passo irredutível de qualquer contas-a-receber automatizado. A
estrutura (write-ahead + idempotência + reversibilidade + gate humano + dry-run) é do domínio — é a
mesma doutrina já validada em Permutas; os códigos/contas/endpoints são config/contrato do tenant.

## Fora de escopo (Fase 0 — SKELETON)

- Shape exato do payload/endpoint do write de recebível (O3) e do trigger de emissão NDe: **Fase 5**
  (confirmar no build). Observabilidade transversal (Módulo 6) é consolidada na Fase 6.
