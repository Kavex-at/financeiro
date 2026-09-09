---
name: fidelidade-snapshot-eleicao
type: business-rule
entity: PermutaCandidata
ontology_version: "0.2"
implementation_status: implemented
status: accepted
owners: [yuri]
invariant: I5
related_files:
  - src/backend/domain/repository/permutas/PermutaSnapshotRepository.ts
  - src/backend/domain/service/permutas/EleicaoPermutasService.ts
  - src/backend/domain/service/permutas/ElegibilidadeService.ts
  - src/backend/migrations/0054_estado_ja_permutado.sql
canonical_test: src/backend/domain/service/permutas/EleicaoPermutasService.test.ts
last_review: 2026-09-08
has_canonical_test: true
---

# Regra: fidelidade-snapshot-eleicao (o registro de auditoria não contradiz o header)

> **Invariante I5 — Observable.** O snapshot por execução é o registro de auditoria da eleição.
> Um registro de auditoria que **perde informação** na gravação, ou que **discorda do header da
> própria execução**, não audita nada: ele apenas parece auditar.

## Enunciado (duas cláusulas)

```
(1) FIDELIDADE — projeção sem perda
    ∀ run r, ∀ candidata c ∈ r:
        snapshot(c).status = c.estadoElegibilidade

(2) CONVERGÊNCIA — header e snapshot da MESMA run batem por construção
    ∀ run r, ∀ estado s ∈ ESTADO_ELEGIBILIDADE:
        header(r).total_<s> = | { c ∈ snapshot(r) : c.status = s } |
```

A cláusula (2) é satisfeita **por construção**, não por conferência posterior: header e snapshot
usam **o mesmo predicado e a mesma fonte de contagem**. Uma implementação em que os dois números
são computados por caminhos diferentes viola esta regra mesmo quando por acaso coincidem.

## Contra-exemplo histórico (o bug que originou a regra)

Run `1c1acefe-398e-4b5d-9c82-49ff5e061e83` (`finished_at` 2026-09-08 18:16 UTC), medida ao vivo,
read-only:

| Fonte | `elegivel` | `bloqueada` |
|---|---|---|
| header `permuta_eleicao_run` (predicado estrito, `EleicaoPermutasService.ts:336-338`) | 27 | **329** |
| snapshot da **mesma** run (`permuta_candidata_snapshot`) | 27 | **677** |

**2,06× de divergência dentro da mesma transação.** Causa: a CHECK binária da migration 0001
(`status IN ('elegivel','bloqueada')`) somada a duas gravações catch-all —
`PermutaSnapshotRepository.ts:320-323` (escrita) e `:353` (`mapSnapshotRow`, leitura) — que
achatavam `casamento-manual`, `permuta-manual` e `ja-permutado` em `bloqueada`.

Custo real: 348 itens que são a **nossa** fila de trabalho (300 cross-process + 48 N:M) apareciam
como passivo de terceiro; o passivo externo verdadeiro era 249, e 677/249 = **2,72× de inflação**.
O relatório de impacto v1 alarmou com "backlog bloqueado crescente" e teve de ser corrigido
(`docs/impacto/CORRECOES-2026-08-24.md` §1). Ver ADR-0043.

## Teste canônico (escrito e verde — ciclo `permuta-snapshot-estados`, 2026-09-08)

`src/backend/domain/service/permutas/EleicaoPermutasService.test.ts`, describe
**"fidelidade e convergência do snapshot (I5)"** — 3 casos, todos sobre uma run com **exatamente 1
candidata em cada um dos 5 estados**, rodando o serviço REAL contra o repositório REAL (só o cliente
de banco é mock), porque a convergência é propriedade da GRAVAÇÃO: contra um `persistRun` mockado o
teste não provaria nada.

1. **Fidelidade (cláusula 1):** 5 candidatas → 5 linhas de snapshot com 5 status DISTINTOS.
2. **Contagem estrita:** `run.total_bloqueadas === 1` — não 3, não 2.
3. **Convergência (cláusula 2):** para os 5 estados, o parâmetro `total_<s>` do INSERT do header
   é igual ao `COUNT` das linhas de snapshot com aquele status, na MESMA transação; e
   `total_candidatas` é igual ao número de linhas gravadas.

Testes de regressão do achatamento, em
`src/backend/domain/repository/permutas/PermutaSnapshotRepository.test.ts`:
`casamento-manual` gravada volta `casamento-manual` (round-trip dos 5 estados), e um status fora do
enum **falha alto** na leitura em vez de virar `bloqueada` em silêncio.

Como a convergência é satisfeita **por construção**: `EleicaoPermutasService.contarPorEstado` é a
única agregação da run, e o header é gravado com `...totals` — o mesmo objeto, espalhado — sobre a
mesma coleção `candidatas` que vai ao snapshot. Não há segundo lugar contando.

## Generalização — NOTA, não regra

A mesma classe de bug pode existir em `recebimento_ingestao_run` e `pagamento_ingestao_run` (ambos
persistem contagens de header ao lado de linhas de detalhe). **Isso não foi medido**, e por isso
esta regra fica escopada a `PermutaCandidata`: promover a um invariante transversal exigiria
evidência nos outros dois pipelines. Registrado em `ontology/_inbox/_watchlist.md` para o próximo
`/retro-ontology`.
