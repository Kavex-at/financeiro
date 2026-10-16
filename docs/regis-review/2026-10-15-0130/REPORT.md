# Regis-Review reduzido 2026-10-15-0130 — `feat/sispag-sugestao-para-todo-titulo` (ADR-0072)

Escopo: delta contra `origin/main` (v0.68.1). 3 QAs escolhidos pelo risco: Security, Testability,
Performance. Fault Tolerance/Integrability não rodaram: a mudança não escreve no ERP nem cria
integração nova (a confirmação já existia; o passo 2 ficou intocado e tem teste de não-regressão).

| QA | Nota | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| Security | 8,5 | 0 | 0 | 1 | 2 |
| Testability | 8 | 0 | 0 | 1 | 2 |
| Performance | 8 | 0 | 0 | 2 | 2 |

**Nenhum P0.** Nenhum bypass: `confirmar` relê o banco e recalcula o cenário ao vivo; só o candidato
`confirmavel` do motor passa (fraco/ambíguo/disputado → 409; vencido no débito → 422); o reconhecimento
é validado contra a avaliação recalculada e gravado na decisão.

Medição somente leitura (PRD, 894 títulos elegíveis): com desfecho 25,5% → 100%. Distribuição:
UNICA_SEGURA 196 · SO_ATENCAO 3 · AMBIGUA 281 · SO_FRACA 233 · SO_VENCIDA 78 · DISPUTADA 61 ·
SEM_CANDIDATO 42. AMBIGUA (31%) é a maior fatia: cobranças recorrentes de mesmo valor que antes
sumiam em silêncio e agora pedem decisão.

Achados em `ontology/_inbox/sispag-sugestao-para-todo-titulo-regis-followups.md`.
