---
name: recebimento
type: state-machine
entity: Recebimento
ontology_version: "0.16"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-08-03
states: [rascunho, aprovado, executado, estornado]
out_of_scope_states: []
---

# Ciclo de vida — `Recebimento` (agregado de conciliação — Frente IV) — SKELETON

> **SKELETON (Fase 0).** Modela o estado do **agregado de conciliação** que a analista monta, aprova
> e executa. É estado **local/persistido** (`recebimento.status`), não do ERP — espelha a doutrina do
> `LotePagamento` (rascunho → gate → downstream). O gate humano (`rascunho → aprovado`) é o ponto
> irredutível *human-in-the-loop* (ADR-0002). A semântica profunda das transições (execução no ERP +
> NDe, estorno) é modelada nas ações (`executarRecebimento`, Fase 5). Ver `entities/recebimento.md`.

## Estados (constantes tipadas)

| Constante | Valor | Significado |
|-----------|-------|-------------|
| `rascunho` | `rascunho` | Conciliação em montagem — match + rateio + regras revisáveis pela analista. Estado inicial. |
| `aprovado` | `aprovado` | A analista **aprovou** (gate human-in-the-loop). Registra `aprovadoPor`. Pronto para executar. **Reversível** enquanto não executado (volta a `rascunho`). |
| `executado` | `executado` | Baixa/quitação registrada no ERP **+ NDe emitida quando devida** (via Conexos). Em processo POR CONTA E ORDEM DE TERCEIROS (`imp021.priVldTipo=2`) a execução é completa **sem** NDe — `ndeId` fica nulo por regra, não por lacuna (ADR-0031, I-Receb-4). Idempotente. Registra `resultadoExecucao`/`ndeId`. |
| `estornado` | `estornado` | **Undo controlado** (estorno bancário / erro operacional / conciliação incorreta). Terminal. |

Tipo: `RecebimentoStatus = 'rascunho' | 'aprovado' | 'executado' | 'estornado'`
(constantes tipadas — nunca strings cruas; princípio P3 da ontologia).

## Transições (SKELETON — regras detalhadas na Fase 3/5)

Cada transição é uma **ação nomeada** com regra explícita e registro de vigência. Grava ator + timestamp
(auditoria) e incrementa `versao` (concorrência otimista, espelha o I6 do lote).

| # | De → Para | Ação (gatilho) | Regra (SKELETON) | Vigência |
|---|-----------|----------------|------------------|----------|
| R1 | `(novo) → rascunho` | `atribuirBaixa` → `ratearRecebimento` → `aplicarRegrasRecebimento` | Conciliação montada (match confiável + rateio balanceado + regras aplicadas). A alocação pode GERAR uma SN nova OU alvo uma SN EXISTENTE do processo (docCod, listarSolicitacoesNumerario) — é um RAMO do settle, **NÃO** um estado novo (ADR-0027, invariante I-Receb-3). | 2026-08-03 |
| R2 | `rascunho → aprovado` | `aprovarRecebimento` **(GATE human-in-the-loop)** | Rateio balanceado (invariante-rateio) + itens válidos. Registra `aprovadoPor`. | 2026-07-24 |
| R3 | `aprovado → rascunho` | `reabrirRecebimento` | Reversão do gate — enquanto **não executado** (espelha `reabrirLote` do SISPAG). | 2026-07-24 |
| R4 | `aprovado → executado` | `executarRecebimento` | Baixa/quitação no ERP + emissão NDe **quando devida**: `priVldTipo=2` (conta e ordem) quita com SN + baixa e para, terminal `quitado-sem-nde` — outro RAMO do settle, **NÃO** um estado novo (ADR-0031, I-Receb-4). Modalidade indeterminável ⇒ bloqueio fail-closed, sem escrita. **Idempotente** (write-ahead ledger; retry nunca duplica). Gated (dry-run/homologação-first). | 2026-08-07 |
| R5 | `executado → estornado` | `estornarRecebimento` | **Undo controlado** (estorno bancário / erro operacional / conciliação incorreta). Terminal. | 2026-07-24 |

```
   atribuirBaixa+ratear+aplicarRegras (R1)
              │
              ▼
        ┌───────────┐  aprovarRecebimento (R2)  ┌───────────┐  executarRecebimento (R4)  ┌────────────┐  estornarRecebimento (R5)  ┌────────────┐
        │  rascunho │ ────────────────────────▶ │  aprovado │ ─────────────────────────▶ │  executado │ ─────────────────────────▶ │  estornado │
        │           │ ◀──────────────────────── │  (gate    │   (baixa+NDe, idempotente, │            │      (undo controlado,      │ (terminal) │
        │           │   reabrirRecebimento (R3)  │  humano)  │    gated, homologação-1º)  │            │       reversível)           │            │
        └───────────┘                           └───────────┘                            └────────────┘                             └────────────┘
```

> **SKELETON — transições e granularidade podem refinar na Fase 3/5.** O gate `rascunho → aprovado`
> (human-in-the-loop) e a execução idempotente+reversível são os invariantes travados; nomes de
> transição e sub-estados de execução (ex.: `executando`) são detalhe de implementação da Fase 5
> (write-ahead ledger, espelha `permuta_alocacao_execucao`).

## Distinção — inbound (esta) × outbound (`lote-pagamento`)

Espelha a máquina do `LotePagamento` (SISPAG): estado local, gate humano, reversibilidade condicionada
ao downstream, concorrência otimista. Direção oposta (conciliar crédito recebido × montar lote a
pagar). Ver `state-machines/lote-pagamento.md`.
