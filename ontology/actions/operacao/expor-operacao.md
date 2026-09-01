---
name: exporOperacao
type: action
entity: JobRun
ontology_version: "0.22"
implementation_status: implemented
status: draft
owners: [yuri]
related_files: []
last_review: 2026-09-01
preconditions:
  - "Pelo menos um adapter de pipeline registrado."
postconditions:
  - "Painel devolve, por pipeline: última run, status, idade desde o último sucesso, métricas."
  - "Painel devolve o diagnóstico de configuração e os alertas abertos."
side_effects: []
---

# exporOperacao

> **READ-ONLY, e read-only de verdade.** Lê o read-model `JobRun`, o diagnóstico de configuração e
> os `Alerta` abertos.

## Invariante I4 — não toca o ERP

Esta é a tela que se abre **quando o Conexos está fora**. Se ela precisar do Conexos para
renderizar, ela falha exatamente no momento em que é necessária. Tudo vem do Postgres e do ambiente
do processo.

Isto a distingue do painel de Recebimentos, que legitimamente enriquece contra o ERP (ADR-0038):
lá o ERP acrescenta informação a uma tela que já é útil sem ele; aqui o ERP não tem nada a dizer.

## Invariante I6 — staleness é computado aqui, não só no cron

A idade desde o último sucesso é calculada **na leitura**. Consequência direta de hospedar o
detector em GH Actions (ADR-0042): se o detector não rodar — inclusive porque o GH Actions parou de
disparar — o painel ainda mostra a verdade para quem o abrir.

O cron **alerta**; o painel **sempre sabe**. São caminhos independentes de propósito, e é essa
independência que sustenta parte do ponto cego aceito.
