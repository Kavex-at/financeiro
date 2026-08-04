---
adr_number: 0022
title: Bootstrap Frente IV — Conciliação de Recebimentos + Nota de Débito Eletrônica (NDe); modelagem SKELETON (Fase 0); NDe emitida pelo Conexos ERP; write de recebível O3 (assume fin010 + parametriza); CreditoCliente entidade nova (distinta do Adiantamento); Nexxera direto com canal desconhecido → spike O7; estende o escopo de 3 frentes (ADR-0002) para uma 4ª frente
date: 2026-07-24
status: accepted
type: addition
related_entities: [TransacaoBancaria, DocumentoAReceber, Recebimento, RateioRecebimento, CreditoCliente, NotaDebitoEletronica, RegraRecebimento]
related_actions: [importarTransacoesNexxera, atribuirBaixa, ratearRecebimento, aplicarRegrasRecebimento, executarRecebimento]
supersedes_decisions: []
---

# ADR 0022: Bootstrap Frente IV — Conciliação de Recebimentos + NDe (modelagem SKELETON, Fase 0)

**Cliente:** Columbia Trading · **Entrega:** Kavex (created by Clonex) · **Branch:** `feat/frente-iv-recebimentos`
**Relacionado:** ADR-0002 (propósito Kavex/Financeiro + human-in-the-loop — este ADR **estende** o
escopo de 3 frentes para uma 4ª), ADR-0013/`business-rules/fin010-write-contract.md` +
`business-rules/idempotencia-reconciliacao.md` (handshake `fin010` + write-ahead — **template** do
write O3 e da idempotência da Frente IV), ADR-0015/0016/0018/0019/0021 (SISPAG — a frente **espelhada**
outbound). **Fonte:** `ontology/_inbox/frente-iv-recebimentos-interview.md` (deep, 4 eixos) +
`ontology/_inbox/frente-iv-recebimentos-nde-plan.md` (roadmap 6 módulos / mapa de reúso).
**`entity_changed = true`** — 7 entidades novas, 5 ações novas, 2 state-machines novas, 1 integração
nova (Nexxera) + superfícies novas no Conexos, 5 business-rule STUBS.

## Contexto

A Frente IV é o **inbound / receivables** — o espelho da Frente II (SISPAG, outbound / payments). O
usuário enquadrou o objetivo como "automatizar a NDe", mas a **Nota de Débito Eletrônica** é o passo
**terminal** de um pipeline de **conciliação de recebimentos de 6 módulos** (import Nexxera → matching
→ rateio → regras → borderô/quitação/NDe → observabilidade). O plano trata a frente como
**"Frente IV — Conciliação de Recebimentos"**, com a NDe como ação terminal do Módulo 5.

Esta é a **Fase 0**: modelar o **esqueleto** do domínio (entidades/ações/state-machines/integrações no
nível estrutural) e **abrir os spikes de contrato** (O7 Nexxera, O3 write de recebível, contrato de
emissão NDe). As **regras de negócio profundas** (encomenda %, adiantamento de cliente, multa/juros)
são **DEFERIDAS à Fase 4** (uma OfficeHours por regra). Nada é implementado ainda — tudo nasce
`planned`.

## Escopo (Fase 0)

Modelado como SKELETON:
- **7 entidades:** `TransacaoBancaria` (movimento bancário raw+normalizado, correlation id, deduped),
  `DocumentoAReceber` (read-model de recebível em aberto), `Recebimento` (agregado de conciliação;
  `rascunho → aprovado → executado → estornado`), `RateioRecebimento` (rascunho revisável de alocação,
  espelha `permuta_alocacao`), `CreditoCliente` (adiantamento DE cliente — NOVO), `NotaDebitoEletronica`
  (artefato terminal, emitida pelo ERP), `RegraRecebimento` (regra configurável+versionada — só forma).
- **5 ações** (`actions/recebimentos/`): `importarTransacoesNexxera`, `atribuirBaixa`,
  `ratearRecebimento`, `aplicarRegrasRecebimento`, `executarRecebimento`.
- **2 state-machines:** `transacao-bancaria` (`importada → conciliada/parcial/manual/erro`) e
  `recebimento` (`rascunho → aprovado → executado → estornado`).
- **1 integração nova** (`integrations/nexxera.md`, direto) + **superfícies novas no Conexos**
  (leitura de recebíveis + write O3 + emissão NDe, adicionadas em `integrations/conexos.md`).
- **5 business-rule STUBS** (`planned`, sem teste canônico): `encomenda-percentuais`,
  `adiantamento-cliente`, `separacao-multa-juros` (spec Fase 4); `invariante-rateio` (I-Receb-1) e
  `idempotencia-quitacao-nde` (I-Receb-2) — invariantes travados, enforcement Fase 3/5.

## Decisões

### D1 — A NDe é EMITIDA pelo Conexos ERP (não sistema fiscal separado, não auto-gerada)
A `NotaDebitoEletronica` é emitida **pelo próprio ERP Conexos** (decisão Yuri). Modelamos: (1) a
emissão como **ação disparada no ERP** dentro de `executarRecebimento`; (2) um **registro local** só
para **idempotência** ("já emitida") + auditoria — a fonte da verdade é o ERP. Consequência de
convenção: a emissão vira uma **superfície de escrita do Conexos** (como a baixa `fin010`), **não** uma
integração separada. **Alternativa rejeitada:** `integrations/nde-conexos.md` dedicado — a NDe sai do
**mesmo** sistema (Conexos), então cabe em `integrations/conexos.md` (uma integração por sistema
externo). O endpoint/trigger de emissão é confirmado na Fase 5 (junto do O3).

### D2 — Write de recebível O3: assume `fin010` + parametriza; confirma no build
Para a baixa/quitação do recebível, **assume-se o módulo `fin010`** e **parametriza-se** o write: os
campos hoje específicos de Permuta (`borVldTipo`, códigos de conta, flag de adiantamento) viram
**parâmetros**. A **maquinaria reusável** do handshake `fin010` de Permutas (write-ahead ledger,
escrita single-attempt, anti-drift, dry-run gate; `ConexosBaixaClient`) **carrega**; o **shape do
payload/endpoint** do lado recebível é **confirmado durante o build** (capturar uma baixa real de
recebível se a aposta parametrizada não fechar). Reúsa o gating de Permutas
(`CONEXOS_WRITE_ENABLED` + `CONEXOS_DRY_RUN`, homologação-first). Ver `business-rules/fin010-write-contract.md`
(template) e `business-rules/idempotencia-quitacao-nde.md`.

### D3 — `CreditoCliente` é ENTIDADE NOVA (distinta do `Adiantamento`)
O adiantamento **DE cliente** (cliente paga a trading antes do recebível maturar — inbound) é
**entidade nova**, **explicitamente distinta** do `Adiantamento` de Permutas (adiantamento **A** um
exportador — outbound, documento PROFORMA `com298`). Direção do dinheiro, contraparte, documento de
origem e ciclo de consumo são diferentes; reusar `Adiantamento` poluiria a semântica outbound. A
distinção fica **cross-linkada** em ambos os arquivos (`entities/credito-cliente.md` ↔
`entities/adiantamento.md`). Critério de identificação e ciclo detalhados: Fase 4
(`business-rules/adiantamento-cliente.md`).

### D4 — Nexxera DIRETO, canal DESCONHECIDO → spike O7 + port channel-agnostic
O extrato bancário é importado **diretamente do Nexxera** (novo `NexxeraClient`), **não** via Conexos.
O **canal é desconhecido** (API JSON vs SFTP/CNAB240 vs OFX) — resolvido pelo **spike O7** na Fase 0.
Decisão de modelagem: um **port de ingestão channel-agnostic** (API/SFTP/arquivo = adaptador
pluggable), para que a escolha do canal não vaze para o resto do Módulo 1. Ver `integrations/nexxera.md`.

### D5 — Estende o escopo de 3 frentes (ADR-0002) para uma 4ª frente
Não supersede nada. **Estende** o escopo definido no ADR-0002 (Permutas, SISPAG, Popula GED) para uma
**quarta frente** (Conciliação de Recebimentos + NDe), mantendo os invariantes transversais:
**human-in-the-loop** (analista aprova match/rateio/exceções), **sem baixa incorreta** (incerto → fila
manual), **execução idempotente + reversível**, **auditoria + correlation id ponta-a-ponta**, **regras
configuráveis + versionadas + explicáveis**.

## Consequências

- O domínio ganha uma frente inteira em nível **estrutural**: 7 entidades, 5 ações, 2 state-machines,
  1 integração, 5 business-rule stubs — todas **`planned`** (Fase 0 é ontologia + contratos, quase sem
  código). A implementação corre nas Fases 1–6 (uma ou mais `/feature-new` por fase).
- **Reúso alto (~60% pattern-isomórfico a SISPAG + Permutas):** ingestão (cron+manual, advisory-lock,
  idempotência, run de auditoria, anti-fantasma), agregado local revisável com gate humano, alocação
  rascunho (`permuta_alocacao`), write idempotente `fin010` + write-ahead ledger, gating dry-run.
- **Espelhamento explícito** documentado: `TransacaoBancaria`↔`TituloAPagar`,
  `Recebimento`↔`LotePagamento`, `RateioRecebimento`↔`permuta_alocacao`,
  `idempotencia-quitacao-nde`↔`idempotencia-reconciliacao`.
- **Spikes abertos (gates de Fase):** O7 (Nexxera canal/formato/auth) bloqueia o Módulo 1; O3 (write de
  recebível) + contrato de emissão NDe são confirmados na Fase 5; O4 (scheduler inexistente) herdado do
  SISPAG afeta a cadência.
- **Deferido à Fase 4 (OfficeHours por regra):** encomenda %, adiantamento de cliente, multa/juros — os
  stubs marcam o lugar sem fixar semântica (evita modelar antes da hora).

## Universalidade

A conciliação de recebimentos é universal em qualquer contas-a-receber de trading com comex: importar o
extrato, casar crédito↔recebível, ratear, aplicar regras, quitar e emitir o documento terminal. A
**estrutura** modelada aqui (import direto + port channel-agnostic; agregado de conciliação com gate
humano; rateio balanceado; write idempotente/reversível; regras versionadas) é do domínio. Os **valores**
(canal/credenciais Nexxera, códigos de conta do write, alíquotas de encomenda, critérios de adiantamento)
são **config do cliente / contrato do tenant** — a confirmar nas fases seguintes. A Fase 0 deliberadamente
**não** os fixa: modela a forma universal, deixa os valores para as fatias.

## Índice / coverage a regenerar

Esta mudança **adiciona** (Fase 0, tudo `planned`): entities 9 → **16**; actions 16 → **21**;
state_machines 3 → **5**; business_rules 11 → **16** (implemented 8 inalterado, planned 3 → **8**;
with_tests inalterado; retired 1 inalterado); integrations 1 → **2**. `ontology/_index.json` e
`ontology/_coverage.json` atualizados nesta curadoria (versão 0.10.0 → **0.11.0**). Se um contador
divergir de uma regeneração automática futura, esta é a fonte da verdade da adição.

## Reúso / linhagem

Estende ADR-0002 (4ª frente). Herda como **template** o handshake `fin010` (ADR-0013 +
`fin010-write-contract.md`), a idempotência write-ahead (`idempotencia-reconciliacao.md`), a alocação
rascunho (`permuta_alocacao`, ADR-0008) e a doutrina de ingestão + agregado local + gate humano do
SISPAG (ADR-0015/0016/0018/0019). Não reinventa — **espelha** o outbound para o inbound.
