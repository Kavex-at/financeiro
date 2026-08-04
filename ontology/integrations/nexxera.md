---
name: nexxera
type: integration
direction: read (import de extrato bancário — DIRETO; canal UNKNOWN, spike O7)
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-07-24
endpoints_read:
  - "extrato bancário / movimentações (canal a confirmar — API JSON vs SFTP/CNAB240 vs OFX; spike O7)"
endpoints_write: []
open-gap:
  - "O7 — Nexxera DIRETO: canal (API vs SFTP/CNAB), formato do extrato (CNAB240 / OFX / JSON), método de auth, sandbox. BLOQUEIA o Módulo 1 (importarTransacoesNexxera). Spike na Fase 0; port channel-agnostic na Fase 1."
---

# Integração: Nexxera (import de extrato bancário — DIRETO) — SKELETON

> **SKELETON (Fase 0). Integração NOVA.** A Frente IV importa as movimentações bancárias
> **diretamente do Nexxera** (decisão Yuri, 2026-07-24) — **não** via Conexos (o SISPAG assume que o
> ERP fala com o Nexxera; aqui é um **client direto novo**). O **canal é DESCONHECIDO**: pode ser
> **API** (JSON) ou **SFTP/arquivo** (CNAB240/OFX). Por isso a integração é modelada com um **port de
> ingestão channel-agnostic** — API/SFTP/arquivo é um **adaptador pluggable** —, e o canal concreto é
> resolvido pelo **spike O7** na Fase 0. Ver `entities/transacao-bancaria.md` e
> `actions/recebimentos/importar-transacoes-nexxera.md`.

## Direção e escopo

- **READ (import) — DIRETO.** Lê o extrato/movimentações da conta da trading. Nesta frente **não há
  escrita** no Nexxera (só importa). A remessa de pagamento (SISPAG) via Nexxera é assunto da Frente II
  (transporte, futuro) — **não** desta integração.
- **Novo `NexxeraClient`** (`@singleton() @injectable()`, direto) na Fase 1 — não existe código Nexxera
  direto hoje (o SISPAG assume o ERP↔Nexxera). Reúsa a doutrina de client externo já validada
  (`RetryExecutor`, Zod/guard nos boundaries, SSM em prod).

## Port channel-agnostic (decisão de modelagem, O7)

O extrato entra por um **port de ingestão** com um contrato interno estável (normalização para
`TransacaoBancaria.normalized`), atrás do qual vive o **adaptador do canal**:

| Adaptador | Quando | Formato provável |
|-----------|--------|------------------|
| API | se o Nexxera expõe API de extrato | JSON |
| SFTP / arquivo | se for troca de arquivo | CNAB240 / OFX |

Trocar de canal (ou suportar os dois) é trocar o adaptador — o resto do Módulo 1 (dedup, correlation
id, run de auditoria, normalização) **não muda**. É o que protege a frente enquanto o O7 não fecha.

## Estado do gap (O7)

- **O7 — ABERTO (BLOQUEIA o Módulo 1).** Canal (API vs SFTP/CNAB), formato do extrato (CNAB240 / OFX /
  JSON), método de auth, disponibilidade de sandbox — **não confirmados**. Resolução: **contrato do
  vendor + probe/spike na Fase 0**; o port channel-agnostic garante que a escolha vira um adaptador.
  Enquanto aberto, a `TransacaoBancaria` e o `importarTransacoesNexxera` seguem `planned` (só forma).

## Constantes de tenant (Columbia) — a definir na Fase 1

Credenciais, contas/agências, layout do arquivo (se CNAB) são da instalação Columbia — **constantes
tipadas via `EnvironmentProvider`/SSM**, nunca hardcode em service (Inviolable Rule #2). Outra trading
recalibra.

## Por que está na ontologia (universalidade)

Universal: importar o extrato bancário de um provedor (VAN/banco) é a fonte de qualquer conciliação de
recebimentos. A estrutura (import direto + port channel-agnostic + dedup + correlation id) é do
domínio; o **canal/formato/credenciais** são config/contrato do tenant (o que o O7 resolve).
