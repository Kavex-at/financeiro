# tasks.md — SISPAG: retomar sem correção manual no Conexos

> `/feature-tweak sispag "user should be able to retry the sispag workflow and continue from
> where the flow stopped, and not need manual fixes in Conexos to do so"`
> Branch: `fix/sispag-fin015-import-shape` (Step 0 dispensado — a base está aqui, ver §Dispensas)

## Estado de partida

O commit `da2714e` já implementou a retomada por consulta ao ERP. Dos 8 desfechos possíveis,
5 continuam sozinhos. **Este tweak fecha os 3 que ainda mandam a pessoa no fin015** — que é a
segunda metade do pedido.

| Desfecho | `da2714e` | Depois deste tweak |
|---|---|---|
| Lote inexistente | recomeça | recomeça |
| Aberto e vazio | retoma no import | retoma no import |
| Aberto com títulos | pula import | pula import |
| Finalizado | pula import+finalizar | pula import+finalizar |
| Arquivo já existe | fecha o ledger | fecha o ledger |
| **Import parcial** | **409** | **T1** — importa só o que falta |
| **Lote cancelado** | **409** | **T2** — cria novo, com confirmação na tela |
| **Órfão sem `flpCod`** | **409** | **T3** — adota por marca d'água |

---

## T1 — Import parcial vira retomada determinística

**Problema.** `0 < titulosCount < esperados` é fail-closed hoje porque re-importar tudo
duplicaria o que já entrou. Mas o ERP diz exatamente o que entrou — não há nada a adivinhar.

**Mudança.**
- `ConexosSispagWriteClient.listarItensDoLote({filCod,bncCod,flpCod})` — lê
  `fin015/finItemSispag/list/{fil}/{bnc}/{flp}` e devolve as chaves `docCod:titCod` presentes.
- `sincronizarComErp` no caso parcial: retorna `{ etapa: 'importar', apenas: <chaves faltantes> }`.
- `montarItensImport` aceita filtro opcional de chaves e monta só essas.

**Critérios de aceite.**
- Lote local com 2 títulos, ERP com 1 → `importarTitulos` recebe exatamente 1 item, o que falta.
- Nenhuma chave já presente é reenviada.
- ERP com os 2 → import é pulado inteiro (comportamento atual preservado).
- Chave presente no ERP que NÃO está no lote local → fail-closed (alguém mexeu no lote na mão).

---

## T2 — Lote cancelado retoma com confirmação explícita

**Problema.** Hoje é 409 sob o argumento de "não desfazer decisão humana". Mas a nossa própria
mensagem de erro manda cancelar o órfão antes de tentar de novo — cancelar é a remediação que
prescrevemos, então o retry seguinte deveria funcionar.

**Decisão do Yuri (2026-08-25):** retomar, **mas com confirmação na tela**. O cancelamento
também pode ter sido uma decisão de abortar o pagamento, e um segundo clique separa os dois
casos sem custar uma ida ao ERP.

**Mudança.**
- `sincronizarComErp`: status 2/3 → `{ etapa: 'criar_lote', motivo: 'lote-anterior-cancelado' }`.
- Novo `LoteAnteriorCanceladoError` (HTTP 409, `code: 'LOTE_ANTERIOR_CANCELADO'`), lançado
  quando `input.confirmarNovoLote !== true`. Carrega o `flpCod` cancelado na mensagem.
- Rota: `confirmarNovoLote` no Zod do body de `POST /lotes/:id/remessa`.
- Frontend: trata o código, abre diálogo ("O lote 99 foi cancelado no Conexos. Gerar um lote
  novo?") e repete o POST com a flag.

**Critérios de aceite.**
- Sem a flag → 409 com `code: LOTE_ANTERIOR_CANCELADO`, `criarLote` NÃO chamado.
- Com a flag → `criarLote` chamado uma vez, lote novo criado, ledger reaberto.
- O lote cancelado permanece cancelado (não tentamos reativar — não existe endpoint).

---

## T3 — Órfão sem `flpCod`: adoção por marca d'água

**Problema.** Morte entre o `criarLote` responder e o ledger gravar. Sem o número, não há como
identificar o lote — hoje é o único caso genuinamente indeterminável.

**Mudança.** Estreitar a janela com informação gravada ANTES do POST:
- Antes de `criarLote`, ler o maior `flpCod` de `(filCod, bncCod)` e gravar no write-ahead
  junto com `ccoCod` e `dataDebito`.
- Na retomada sem `flpCod`, candidato = lote com `flpCod > marca` **E** `status = 0` **E**
  `titulosCount = 0` **E** mesmo `ccoCod` **E** mesma `flpDtaCredito`.
- **Exatamente 1 candidato** → adota (persiste como `nativeFlpCod`) e retoma no import.
- **0 candidatos** → o `criarLote` não valeu; recomeça do zero.
- **2 ou mais** → fail-closed, com a lista dos candidatos na mensagem.

> A regra do "exatamente um" é a salvaguarda: dois lotes vazios, mesma conta e mesma data de
> débito, criados depois da marca, é ambíguo o bastante para não escolher no lugar de alguém.

**Critérios de aceite.**
- Os três ramos cobertos por teste.
- A marca é gravada ANTES do POST (asserção de ordem, como no `marcarProcessado`).
- Candidato adotado é persistido no ledger e no `lote_pagamento` antes do próximo POST.

---

## T4 — Ontologia (entity_changed = true)

`ontology/business-rules/idempotencia-reconciliacao.md` codifica a doutrina atual:
*"a linha fica em `reconciling` — sinal explícito de verificar no ERP (reconciliação manual)"*.
Este tweak muda isso para o SISPAG, então **precisa de diff aprovado e ADR**.

- **Novo** `ontology/business-rules/retomada-remessa-sispag.md` — a máquina de retomada, os 8
  desfechos, e o critério de quando retomar é legítimo.
- **Atualizar** `ontology/entities/lote-pagamento.md`.
- **ADR** — por que o SISPAG retoma e a permuta não: o critério é *o ERP expõe estado verificável
  daquela escrita?* (`flpVldStatus`/`titulosCount` no fin015, `processadoEm` no fin052 → sim;
  baixa fin010 do fluxo de permuta → a avaliar). Onde não expõe, a doutrina antiga vale.

---

## T5 — Ground-Truth Validation (HML, AO VIVO)

**Decisão do Yuri (2026-08-25):** entra no escopo. Todos os testes da retomada são mockados —
a mecânica nunca foi exercida contra o ERP.

`jobs/validate-retomada-remessa-v1.ts` — **escreve em HML**, recusa rodar fora dela sem
`PERMITIR_PRD=1`. Para cada ponto de interrupção:

1. Cria o lote, apaga o `flpCod` do ledger → roda de novo → **prova T3** (adota, não cria outro).
2. Importa 1 de 2 títulos → roda de novo → **prova T1** (importa só o que falta).
3. Finaliza → mata antes de gerar → roda de novo → pula import e finalizar.
4. Gera a remessa → mata antes do settle → roda de novo → devolve o mesmo arquivo.
5. Cancela o lote no ERP → roda de novo → 409; com a flag, cria novo → **prova T2**.

**Critério de aceite (o gate):** ao final, `fin015/list` da filial de teste tem **exatamente os
lotes esperados** — nenhum lote a mais. Um lote duplicado reprova o gate (P0).

> Pendência conhecida: o fixture `fin015-item-lote` voltou SEM AMOSTRA (o lote da filial 2 em
> PRD está vazio). O shape do item de lote será confirmado por este job em HML.

---

## T6 — Regis-Review

Escopo restrito a `domain/service/sispag/`, `domain/client/`, `routes/sispag.ts` e
`app/sispag/`. P0 re-entra no loop; P1/P2/P3 → `sispag-retomada-regis-followups.md`.

---

## Dispensas registradas (vão para o corpo do PR)

- **Step 0 (worktree):** dispensado por decisão do Yuri. A implementação base
  (`da2714e`) está em `fix/sispag-fin015-import-shape`, ainda não mergeada; um worktree da
  `main` começaria sem ela.

## Fora de escopo (deliberado)

- Reativar lote cancelado no ERP — não existe endpoint.
- Retomada do lado da **permuta** (`fin010`) — o critério do ADR do T4 decide se cabe; se
  couber, é outro tweak.
