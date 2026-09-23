---
name: formarLotesAutomaticos
type: action
entity: LotePagamento
ontology_version: "0.8"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0026_lote_automatico.sql
  - src/backend/domain/service/sispag/FormacaoLotesService.ts
  - src/backend/domain/repository/sispag/LotePagamentoRepository.ts
  - src/backend/domain/repository/sispag/TituloAPagarRepository.ts
  - src/backend/jobs/formar-lotes.ts
  - src/backend/routes/sispag.ts
  - src/frontend/app/sispag/page.tsx
last_review: 2026-07-18
preconditions:
  - "Carteira de títulos a pagar já ingerida/persistida (titulo_a_pagar) — roda logo APÓS o cron de ingestão."
  - "Mutações via cron ('cron', job:formar-lotes) ou trigger manual autenticado (POST /sispag/lotes/formar) — requireRole('admin') no manual."
  - "Advisory lock (FORMACAO_LOCK_KEY) livre — uma rodada de formação por vez (contenção → rodada em andamento vence)."
postconditions:
  - "Lotes automáticos RASCUNHO com ≥1 título VENCIDO são DESFEITOS (deletados) e seus títulos LIBERADOS (só a-vencer é elegível) — desfazerAutomaticosVencidos."
  - "Novos lotes automáticos RASCUNHO criados (criarLote(automatico=true)) agrupando títulos elegíveis por FILIAL (I4) — internacional fora do escopo (ADR-0021), sem divisão por classe."
  - "Só entram títulos A VENCER ≤ maxDias (7) — vencidos excluídos — e ainda não presentes em NENHUM lote RASCUNHO (anti-join)."
  - "Lotes manuais e lotes FINALIZADOS/CANCELADOS NUNCA são tocados — o cron só mexe nos automáticos RASCUNHO."
  - "Nenhuma escrita no ERP (I1) — leitura Conexos + escrita LOCAL (Postgres: lote_pagamento/_item)."
side_effects:
  - "DELETE dos lotes automáticos RASCUNHO vencidos + INSERT dos novos lotes/itens (lote_pagamento com automatico=true, lote_pagamento_item)."
  - "Advisory lock (FORMACAO_LOCK_KEY) serializa a rodada; roda encadeado ao cron de ingestão (job:formar-lotes)."
  - "READ do banco (titulo_a_pagar) — sem fan-out ao ERP nesta ação (a carteira já foi ingerida)."
---

# formarLotesAutomaticos — formação automática de lotes candidatos (cron pós-ingestão + manual)

> **Vigência:** 2026-07-08 (v0.8.0, ADR-0018). Um **cron** (`job:formar-lotes`, encadeado **logo após**
> o cron de ingestão) mais um **trigger manual** (`POST /sispag/lotes/formar`) que **montam
> automaticamente** lotes candidatos a partir da carteira já persistida — poupando a analista de abrir
> e preencher cada lote à mão. Os lotes nascem **RASCUNHO** e caem em **"Lotes candidatos"** para a
> analista **revisar** (incluir/remover) antes de aprovar. É **READ-ONLY no ERP** (I1) — a única
> escrita é o Postgres próprio. Espelha a ingestão ([`ingerirPagamentos`](./ingerir-pagamentos.md)):
> mesmo compute para cron e manual, advisory-lock, operação idempotente/convergente.

## Gatilhos

| Gatilho | Caminho | `triggered_by` |
|---------|---------|----------------|
| **Cron (pós-ingestão)** | `job:formar-lotes` (`src/backend/jobs/formar-lotes.ts`) — encadeado logo após o cron de ingestão | `'cron'` |
| **Manual** | `POST /sispag/lotes/formar` (`src/backend/routes/sispag.ts`) — botão FE "Formar lotes automáticos" | username do analista (JWT verificado, server-side) |

Ambos rodam o **mesmo** compute (`FormacaoLotesService.formar`). O manual é uma **interface humana**
(*human-in-the-loop*) para a mesma formação — não um segundo caminho de domínio.

## Fluxo

`FormacaoLotesService.formar`:

1. Adquire o **advisory lock** (`FORMACAO_LOCK_KEY`, `pg_try_advisory_lock`). Se já há uma rodada de
   formação em andamento, a corrente cede (uma formação por vez) — espelha o lock da ingestão.
2. **Desfazer os automáticos vencidos** — `LotePagamentoRepository.desfazerAutomaticosVencidos()`:
   todo lote **automático** ainda em **RASCUNHO** que contém **≥1 título VENCIDO** é **deletado**
   (desfeito), **liberando** seus títulos. Só título **a-vencer** é elegível a lote automático; um
   título que venceu desde a última rodada não pode continuar num lote auto. **Não** vira status
   `VENCIDO` — o lote é desfeito e os títulos voltam ao pool. Não toca lote **manual** nem
   **FINALIZADO/CANCELADO**.
3. **Eleger os títulos** — `TituloAPagarRepository.listElegiveisParaFormacao(maxDias=7)`: títulos
   **A VENCER** com vencimento ≤ 7 dias (vencidos **excluídos**), aprovados (alçada) e não pagos, que
   **ainda não estão em nenhum lote RASCUNHO** (**anti-join** — não rouba título de lote manual/auto
   já existente; respeita a não-duplicação I3).
4. **Agrupar** os elegíveis por **filial** (I4) e **criar** um lote por grupo —
   `LotePagamentoRepository.criarLote(automatico=true)` + itens com snapshot (valor/venc/credor),
   coerente com I4 (uma filial). *(Internacional saiu do escopo — ADR-0021: câmbio manual da tesouraria,
   filtrado na ingestão; não há mais dimensão de classe no agrupamento.)*
5. Os lotes criados nascem **RASCUNHO** e aparecem em **"Lotes candidatos"** com o **badge
   "automático"** — a analista revisa (inclui/remove títulos, cancela) e depois **finaliza**
   ([`finalizarLote`](./finalizar-lote.md)).

## Regras de agrupamento e elegibilidade

- **I4 (uma filial por lote):** cada lote automático é de uma única filial. Ver
  `business-rules/lote-uma-filial.md`.
- **~~I7 (lote uniforme nacional × internacional)~~ — APOSENTADO (ADR-0021):** internacional é câmbio
  manual da tesouraria, **fora do escopo** do SISPAG, e é **filtrado na ingestão** — não há títulos
  internacionais na carteira, logo **não há mais dimensão de classe** no agrupamento (o agrupamento é
  só por filial). Ver `business-rules/lote-uniforme-nacional-internacional.md` (retirado) e ADR-0021.
- **A-vencer ≤ 7 dias apenas:** vencidos **não** entram e **desfazem** um lote auto que os contenha
  (passo 2). O horizonte de 7 dias é o valor do tenant (config) sobre a estrutura universal
  "montar o lote das obrigações que vencem em breve".
- **Anti-join (I3):** título já em qualquer lote RASCUNHO (manual ou auto) não é re-agrupado.

## Caveat — `banco` nulo na carteira a-pagar (degenera para filial)

O `banco` é **nulo** nos títulos **a pagar** — o `fin064` não carrega o banco **antes do pagamento**
(o banco/conta só se define no trilho de remessa, downstream). Logo, na prática **hoje o agrupamento
por banco degenera** e a formação agrupa **só por filial** (a dimensão de classe também saiu — ADR-0021,
internacional fora do escopo). `banco` fica registrado como dimensão de agrupamento **estrutural** (para
quando uma fonte de banco/conta existir), mas não particiona os lotes nesta fatia. Coerente com a decisão
da fatia de montagem (banco/conta = metadado opcional, `lote-uma-filial.md`) e com o detalhe de remessa
hidratado ao vivo no envio (ADR-0016).

## Idempotência / convergência

- **Convergente por design:** cada rodada **desfaz** os automáticos vencidos e **re-forma** a partir
  do pool elegível corrente (anti-join). Rodar o cron e o manual no mesmo dia converge ao mesmo
  conjunto de lotes automáticos, **sem** duplicar (o anti-join impede repescar título já em RASCUNHO)
  e **sem** mexer no que a analista já montou à mão.
- **Concorrência:** o advisory lock (`FORMACAO_LOCK_KEY`) garante uma formação por vez — protege de
  desfazer/re-criar concorrente.
- **Preserva o trabalho manual:** a formação só cria/desfaz lotes **automáticos** RASCUNHO. Um lote que
  a analista finalizou, cancelou, ou montou manualmente é **intocável**.

## Segurança / consistência

- **READ-ONLY no ERP (I1):** a formação lê a carteira **do banco** (já ingerida) e escreve **só** no
  Postgres (`lote_pagamento`/`lote_pagamento_item`). Nenhum verbo mutante no Conexos.
- `requireRole('admin')` no trigger manual; SQL parametrizado; auditoria (`criado_por='cron'` ou o
  analista).

## Por que está na ontologia (universalidade)

Universal: **pré-montar** os lotes de pagamento das obrigações que vencem em breve, agrupados pela
mesma chave do arquivo de remessa (filial), e deixá-los como **candidatos** para o analista
revisar, é o próximo passo natural do human-in-the-loop de qualquer contas-a-pagar de trading — reduz
o trabalho manual mantendo o controle na finalização. A **estrutura** (formação periódica idempotente,
desfazer o que venceu, anti-join contra o que já está em rascunho, nascer RASCUNHO para revisão) é do
domínio; os **valores** (janela de 7 dias, cadência do cron, dimensões de agrupamento efetivas) são
config do tenant. Estende `gerenciarLoteCandidato` (montagem manual) com a montagem assistida — não
reinventa o agregado nem as invariantes.
