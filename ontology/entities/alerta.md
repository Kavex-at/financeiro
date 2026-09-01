---
name: Alerta
type: entity
ontology_version: "0.22"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0052_alerta.sql
properties:
  - id
  - tipo
  - alvo
  - severidade
  - dedupKey
  - janelaInicio
  - detalhe
  - criadoEm
  - notificadoEm
  - sinkResultados
---

# Alerta

> Um incidente operacional detectado pelo sistema, **persistido** antes de ser notificado.

## Por que persistir

Três razões, nesta ordem:

1. **Deduplicação (I1).** Um staleness que dispara a cada rodada do detector vira ruído, e um canal
   ruidoso é um canal que o time aprende a ignorar. O `dedupKey` é o que impede isso.
2. **O próprio painel é um sink.** `DbAlertSink` é o que faz o alerting funcionar no dia 1, sem
   credencial nenhuma — o alerta aparece no Painel de Operação (ADR-0042).
3. **Histórico.** "Isso já aconteceu antes?" é a primeira pergunta de qualquer investigação, e hoje
   ela não tem resposta.

## `dedupKey`

Derivado de `(tipo, alvo, janela)`. Mesmo incidente na mesma janela → o `Alerta` já existe e nada
novo é emitido. Janela nova → alerta novo, porque um pipeline parado há dois dias merece ser dito
de novo.

## Tipos

| `tipo` | `alvo` | Origem |
|---|---|---|
| `job-falhou` | `pipeline` | run terminou `error` |
| `job-parcial` | `pipeline` | run terminou `partial` (contas/filiais falhadas) |
| `job-parado` | `pipeline` | `detectarStaleness` — sem `success` dentro do limite |
| `config-ausente` | nome da var | `validarConfiguracao` — var obrigatória não configurada |

## Teto conhecido deste desenho

`DbAlertSink` não pode alertar sobre o backend estar fora — se o processo não sobe, ninguém escreve
a linha. Mesma classe do ponto cego do detector em GH Actions (ADR-0042). É o argumento mais forte
para o pinger externo, registrado como follow-up e fora deste slice.
