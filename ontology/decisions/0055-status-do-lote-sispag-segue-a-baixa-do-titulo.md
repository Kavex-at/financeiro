---
adr_number: 0055
title: O status do lote SISPAG segue a baixa do título no ERP, de qualquer origem; o retorno do fin052 só enriquece e veta
date: 2026-09-29
status: accepted
type: change
related_entities: [LotePagamento, TituloAPagar, Alerta]
related_actions: [sincronizarStatus, conciliarRetorno, marcarRetorno]
related_business_rules: [sincronizacao-status-lote-sispag, retomada-remessa-sispag]
related_integrations: [conexos]
supersedes_partially: [ADR-0019]
evidence:
  - PG230901.REM (Itaú, bnc 4, débito 24/09) — itens 38682/1 e 4030/7
  - fin052 gar 9 e gar 10; fin010 borderô 22320
  - ontology/_inbox/sync-status-lote-sispag-ontology-diff.md (proposta aprovada em 2026-09-29)
---

# ADR 0055: o status do lote SISPAG segue a baixa do título

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Branch:** `fix/sync-status-lote-sispag`
(`/feature-tweak lote-pagamento`, slug `sync-status-lote-sispag`). `entity_changed = true`.

## Contexto

Dois lotes locais (um por filial, I4), cada um com um item e cada um com o seu arquivo
`PG230901.REM` (mesmo nome, remessas nº 17 e nº 10): fil 2/flp 24 ATLANTIS 38682/1 (R$ 275,00) e
fil 1/flp 8 LATTINE 4030/7 (R$ 1.856,16), Itaú, débito em 24/09.

- O retorno `PAG_341_557954_260924_00000.RET` (gar 9) foi **processado nativamente** em 24/09 às
  08:33, só com o evento `BD` ("PAGAMENTO AGENDADO"), **sem borderô**.
- O retorno de 25/09 (gar 10) foi **carregado e nunca processado**.
- A baixa do 38682/1 existe: borderô 22320, criado e finalizado **à mão** por ERICA_VIANA em 24/09
  às 12:47 (`fin010`).
- O nosso app mostra o lote em `REMESSA_GERADA`; `conciliacao_execucao` está vazia.
- `fin015.flpVldRet` é `false` em todos os lotes nativos medidos: não serve de sinal.

O fechamento vigente (L9/L10) exigia `bxa_cod_seq` copiado do detalhe do `fin052` e varredura
completa. Nenhuma das duas coisas acontece quando a baixa é feita à mão ou o processamento é
nativo, que é o caso real. O lote nunca fecharia.

Dois bugs de implementação vêm junto e não precisam de regra nova além dos invariantes: (1)
`findByChaveNativa` usava a filial do arquivo, mas um `.RET` mistura filiais (gar 9: fil 1/flp 8 e
fil 2/flp 24), e tem de usar o `filCod` da linha; (2) o evento por item era last-write-wins sobre
um fan-out não determinístico, e agora vale a precedência de I11d. Também: o schema do `fin064`
coage `vldPago` ilegível a `false` (`.catch(false)`), o que violaria I11c no caminho da
sincronização.

## Decisões

### D1 — Baixa de qualquer origem basta para `BAIXADO` (P0-1)

Remessa, `fin010` manual e processamento nativo são equivalentes. O `fin052` enriquece (registra
`BD`/`00` no item) e **veta** por rejeição lida (`fbeVldTpret = 2` → `RETORNADO`). Com a baixa
confirmada no título, evento não lido **não** bloqueia `BAIXADO`.

### D2 — Prova de pagamento = `fin064` por `docCod` (P0-2)

`getTituloAPagar`, sem filtro de `vldPago`: `vldPago = 1 ∧ aberto = 0`. `borCod`/`bxaCodSeq`/data/
usuário vêm do PSQ_018 (`com308/financeiroAPagar/baixas/list/{doc}/{tit}/0`) **quando legível**
(o robô recebeu 403 em 22/09); são nulos e só enriquecimento. Falha de leitura é fail-closed:
nunca "pago", nunca "não pago"; o lote fica onde está.

### D3 — Sem estado novo de lote (P0-3)

O lote espera em `REMESSA_GERADA`. Cada item tem situação **derivada**: `AGENDADO` / `PAGO` /
`REJEITADO` / `SEM_RETORNO`. Mantém a decisão "não se criou estado parcialmente pago".

### D4 — Gatilho agendado + manual, read-only no ERP (P1-5)

Nova transição L11 `sincronizarStatus`. Nunca chama `carregar`/`processar`. O
`POST /sispag/retornos/conciliar` com `processar=true` é **mantido** como caminho administrativo e
passa a usar o mesmo fechamento.

### D5 — `BAIXADO` terminal; contradições viram divergência (P1-4)

Se `vldPago` volta a 0 depois de pago, não há transição: `divergencia` no item + `Alerta`
`sispag-baixa-divergente`. Item com rejeição lida cujo título aparece pago **continua
`REJEITADO`**, o lote fica em `RETORNADO`, e o item recebe `divergencia` + o mesmo `Alerta`
(decisão do usuário, 2026-09-29): o `fin052` vetou, e a contradição precisa de olho humano.

### D6 — L7 `marcarRetorno` aposentada (P1-6)

Botão e rota removidos (a rota responde `410`). Rejeição aparece como lote `RETORNADO` destacado +
`Alerta` `sispag-lote-retornado`. Produção não tem lote em `RETORNADO`: sem limpeza.

### D7 — Escrita local não é gated por flag de ERP

`conexosWriteEnabled`/`sispagLiveWriteEnabled`/`conexosDryRun` controlam escrita no Conexos, não a
gravação do que foi observado.

### D8 — Idempotência

Sincronização sem mudança não incrementa `versao` (I6).

## Alternativas consideradas

- **Exigir o vínculo do `fin052` (status quo).** Rejeitada: o caso real não o produz.
- **Processar o `.RET` automaticamente na sincronização.** Rejeitada: escrita não idempotente
  disparada por cron; e a baixa manual já existe, então processar em cima dela arrisca baixa dupla.
- **Estado `AGENDADO`/`PARCIAL` no lote.** Rejeitada: duplicaria o que é derivável dos itens.
- **`fin015.flpVldRet` como sinal.** Rejeitada: medido inútil.
- **`PAGO` vencer a rejeição.** Rejeitada pelo usuário (D5): deixaria o lote fechar em cima de um
  veto do banco sem que ninguém olhasse.
- **Distinguir baixa manual × nativa.** Adiada (watchlist): não observável com segurança;
  `origemBaixa` fica `REMESSA | FORA_DO_RETORNO | NAO_IDENTIFICADA`.

## Consequências

- Supersede em parte a ADR-0019 (L7) e emenda o fechamento da Fatia 3 (L9/L10).
- Nova regra `sincronizacao-status-lote-sispag` (I11). Novas colunas no item (a criar em
  migration): `baixa_fonte`, `origem_baixa`, `pago_em`, `valor_pago`, `pago_observado_em`,
  `divergencia`, `divergencia_detalhe`, `sincronizado_em`.
- Dois tipos novos de `Alerta`: `sispag-baixa-divergente` e `sispag-lote-retornado`.
- Aberto: permissão do robô no PSQ_018. Sem ela a trilha de borderô fica nula, mas o status fecha
  corretamente.
