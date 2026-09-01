---
name: notificarFalha
type: action
entity: Alerta
ontology_version: "0.22"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-09-01
preconditions:
  - "Incidente detectado (run error/partial, staleness, ou config ausente)."
postconditions:
  - "Alerta persistido, salvo dedup na mesma janela."
  - "Cada AlertSink configurado recebe o Alerta."
side_effects:
  - "Escrita em alerta; efeitos externos por sink."
---

# notificarFalha

> Emite um `Alerta` por um ou mais `AlertSink`, com deduplicação.

## Invariante I5 — nunca derruba um job

Best-effort de ponta a ponta, exatamente como o `LogService` já é hoje. Um sink fora do ar não pode
falhar a ingestão que ele existe para vigiar — seria o alerting causando o incidente.

Falha de sink não passa em silêncio, porém: fica registrada em `sinkResultados` do próprio
`Alerta`, para que "o alerta não chegou" seja distinguível de "não houve alerta".

## Sinks

| Sink | Estado | Precisa de credencial |
|---|---|---|
| `DbAlertSink` | **neste slice** | não |
| `EmailAlertSink` | atrás de config, quando o acesso existir | sim |

O port existe para que ligar e-mail seja um flip de configuração e não uma reescrita — o canal
preferido do Yuri é e-mail, mas o acesso é mais difícil de obter e **não pode bloquear este slice**
(decisão, 2026-09-01). Vendor deliberadamente não escolhido agora.
