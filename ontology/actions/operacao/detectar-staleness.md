---
name: detectarStaleness
type: action
entity: JobRun
ontology_version: "0.22"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-09-01
preconditions:
  - "Limite de staleness definido para o pipeline (business-rule staleness-por-pipeline)."
postconditions:
  - "Pipeline sem run 'success' dentro do limite gera Alerta tipo 'job-parado' (sujeito a dedup)."
side_effects:
  - "Escreve Alerta (via notificarFalha)."
---

# detectarStaleness

> Compara a idade da última run **`success`** de cada pipeline com o limite **daquele** pipeline.

## Por que a última `success`, e não a última run

Uma run que terminou `error` há cinco minutos não prova que o pipeline está saudável — prova o
contrário. E uma run `partial` não conta como sucesso pleno (ver `JobRun`): ela alimenta o alerta
`job-parcial`, que é um incidente diferente, não um substituto do sinal de vida.

## Onde roda — e o que isso não cobre

Quinto workflow em GitHub Actions (decisão do Yuri, 2026-09-01).

**Ponto cego aceito e documentado:** um detector hospedado em GH Actions não enxerga o cenário em
que o próprio GH Actions deixa de disparar — e schedules do GH são best-effort, podendo atrasar ou
ser descartados sob carga. Mitigação parcial: I6 (`exporOperacao` computa staleness na leitura), que
garante que um humano abrindo o painel veja a verdade. Mitigação completa exigiria um dead-man's
switch externo, registrado como follow-up (ADR-0042).
