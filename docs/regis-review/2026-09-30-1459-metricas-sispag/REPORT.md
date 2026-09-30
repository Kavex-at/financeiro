---
type: regis-review-report
run_id: 2026-09-30-1459-metricas-sispag
generated_at: 2026-09-30T16:00:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
total_cards: 13
total_p0: 0
total_p1: 0
total_p2: 8
total_p3: 5
overall_score: 8.0
---

# Regis-Review — financeiro — 2026-09-30-1459-metricas-sispag

**Escopo.** Gate de feature, não varredura do repositório: delta de `fix/metricas-sispag` contra
`origin/main` (commit 882cc82) — SISPAG nas métricas do ciclo, migration 0070, ADR-0056. Volume: 12
arquivos, +788/−8; produção tocada em 4 arquivos (migration 0070, 264 linhas;
`RemessaExecucaoRepository.ts` +6; `page.tsx`; `lib/metricas.ts`). Achados pré-existentes aparecem
marcados e não pontuam contra o delta.

**Gates medidos antes da revisão:** backend typecheck, lint e jest (178 suites / 3242 testes) verdes;
`test:sql` em Postgres 17 real (4 suites / 48 testes) verde; frontend typecheck, lint, jest (64 suites /
658 testes) e `next build` verdes; PatternGuardian PASS (3× P3); DesignSystemReviewer aprovado após fix.

**Existe P0?** Não. Os 8 QAs não reportaram P0 e a consolidação não encontrou base para promover
nenhum: o delta não adiciona escrita em sistema externo, não move dinheiro e não altera a semântica de
`settled` no ledger `remessa_execucao`. Critério 8 do gate satisfeito sem re-loop; P1/P2/P3 seguem como
follow-ups (`ontology/_inbox/metricas-sispag-regis-followups.md`).

## 1. Executive scorecard

Pesos: Security 1.5, Fault Tolerance 1.3, Availability 1.2, Modifiability 1.2, Testability 1.0,
Performance 1.0, Integrability 0.9, Deployability 0.9 (soma 9.0). Overall = 72.3 / 9.0 = 8.03.

| QA | Score | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 8.0 | 0 | 0 | 2 | 1 | aceite depende do cron de sync sem sinal de defasagem (0 de 11 aceitos na semana corrente) |
| Deployability | 8.0 | 0 | 0 | 1 | 1 | 0070 com backfill e rollback só em prosa |
| Integrability | 7.0 | 0 | 0 | 2 | 0 | contrato `/metricas/ciclo` sem teste de contrato nem versão (2 consumidores, 0 testes) |
| Modifiability | 7.0 | 0 | 0 | 2 | 1 | função inteira recopiada por migration (3 cópias) |
| Performance | 9.0 | 0 | 0 | 0 | 1 | LATERAL por item sem janela (~300 comparações; irrelevante hoje) |
| Fault Tolerance | 8.5 | 0 | 0 | 2 | 0 | efeito de `settle`/`fail` sobre `encerrado_em` só testado por regex |
| Security | 8.5 | 0 | 0 | 1 | 1 | valor SISPAG visível a quem tem `metricas:ver` sem `sispag:ver` |
| Testability | 8.0 | 0 | 0 | 2 | 1 | borda de fuso da semana sem caso |
| **Overall** | **8.0** | **0** | **0** | **8** | **5** | 13 cards únicos (18 brutos) |

Nenhum QA abaixo de 7. Integrability e Modifiability (7.0) refletem custo recorrente por frente nova e
contrato não pinado, não risco operacional.

## 2. Top riscos (cross-QA)

Nenhum é P0/P1. Todos são de painel gerencial, exceto R-7 (pré-existente, sem caminho de disparo).

- **R-1 — KPI de aceite em 0% sem distinguir "banco não respondeu" de "cron parado"** (Availability,
  Fault Tolerance, Integrability). `situacao` é NULL até o cron `sincronizar-lotes-sispag` rodar; hoje
  0 aceitos nas duas semanas. O rótulo já diz "Z aguardando retorno", mas não a idade do último sync.
  Precedente: Bad Credentials congelou a carteira em 23/09. Card: availability-1.
- **R-2 — `encerrado_em` decide a semana e só é provado por regex, sem teste de fuso** (Fault Tolerance,
  Testability). 3 testes assertam o texto do SQL; 0 executam em Postgres. Cards: fault-tolerance-1,
  testability-2.
- **R-3 — contrato `/metricas/ciclo` por chaves em string** consumido pelo frontend e pelo
  `kavex-report-ciclo`, sem Zod, fixture nem versão (pré-existente; o delta soma 2 chaves). Ausência de
  chave degrada para "—" (verificado). Cards: integrability-1, deployability-2.
- **R-4 — 0070 sem reverse executável** (Deployability). Mitigante: mudança aditiva, coluna nullable,
  10 linhas de backfill. Cards: deployability-1, availability-3.
- **R-5 — valor SISPAG semanal exposto a quem tem `metricas:ver` sem `sispag:ver`** (Security). Só
  agregados (R$ 2.131,16 e R$ 8.832,91 por semana hoje), sem título nem CNPJ; decisão implícita a
  registrar. Card: security-1.
- **R-6 — função monolítica recopiada por migration** (Modifiability, Availability): 0058, 0065 e 0070;
  erro em uma CTE derruba as três frentes. Card: modifiability-1 (fazer junto com a próxima frente).
- **R-7 — `fail` sem guarda `status <> 'settled'`** (pré-existente, Fault Tolerance). Sem chamador que
  alcance o caminho hoje (`RemessaService.ts:740` fica atrás do `alreadySettled`). Único risco ligado a
  escrita irreversível; promover a card no próximo `/feature-tweak` que tocar o ledger.
- **R-8 — 5 pontos de edição no frontend por frente nova** (Modifiability). Card: modifiability-2.
- **R-9 — migration sem transação explícita** (Availability); passos idempotentes, runner não
  verificado. Card: availability-3.
- **R-10 — função sem janela nem `statement_timeout`** (Performance; pré-existente). Card condicional
  performance-1 (gatilho: > ~5k itens ou > 100 ms).

## 3. Achados transversais

- **CC-1 — dependência do cron de sync sem sinal de idade** (3 QAs): a semântica NULL/SEM_RETORNO =
  "aguardando" está certa; falta telemetria do produtor. Uma correção (availability-1) atende os três.
- **CC-2 — regras de "quando" e "quem conta" verificadas por texto, não por efeito**: o delta é forte
  onde há Postgres real e fraco no CASE de `settle`/`fail` e na borda de fuso. fault-tolerance-1 +
  testability-2 no mesmo PR `test:sql`.
- **CC-3 — contrato SQL ↔ frontend ↔ skill por strings**: a leitura tolerante evita quebra visível e,
  pelo mesmo motivo, esconde a quebra. integrability-1, depois modifiability-2.
- **CC-4 — função monolítica recopiada**: a 0070 repete o padrão da 0065, não o introduziu.
  modifiability-1 com a próxima frente; deployability-1 antes como mitigação.
- **CC-5 — reversibilidade da migration em prosa**: deployability-1 + availability-3.

## 4. Quick wins (≤ 5 dias úteis, todos S/P2)

| Card | QAs | Resultado esperado |
|---|---|---|
| availability-1 | Availability, Fault Tolerance, Integrability | sync parado detectado em ≤ 1 dia útil (hoje indetectável) |
| fault-tolerance-1 | Fault Tolerance, Testability | casos de `settle`/`fail` em PG real: 0 → 3 |
| security-1 | Security | usuários com `metricas:ver` sem `sispag:ver`: contado e aceito por escrito |
| deployability-1 | Deployability | reverse da 0070 executável |
| integrability-1 | Integrability, Modifiability | chaves de `METRICA` cobertas por teste de contrato: 0 → 100% |
| testability-2 | Testability | casos de borda de fuso no SISPAG: 0 → 2 |
| modifiability-2 | Modifiability | pontos editados por frente nova no frontend: 5 → 1 |

## 5. Movimentos estratégicos

- **modifiability-1 (M)** — uma função por frente, `metricas_ciclo` como união. Fazer junto com a
  próxima frente de métrica, não isolado.
- **performance-1 (S, condicional)** — só com gatilho; medir com `EXPLAIN ANALYZE` antes.

## 6. O que está bem

1. Semântica de aceite conservadora: só AGENDADO/PAGO contam; NULL e SEM_RETORNO são "aguardando",
   nunca rejeição; CANCELADO, dry-run e `error` fora.
2. Ledger de remessa intacto: `settle` mantém `status='settled'` e o `WHERE idempotency_key`;
   `beginExecution` fora do delta; +6 linhas, 0 round-trips extras.
3. Migration idempotente e de baixo impacto; backfill de 10 linhas conferido em produção.
4. Prova em Postgres real no CI (`test:sql`, 48 testes, transação desfeita por caso, `agora` injetável).
5. Hardening da função: sem SECURITY DEFINER, `search_path = ''`, `REVOKE ... FROM PUBLIC`, rota com
   `metricas:ver` e Zod na query.
6. Contrato aditivo: 2 chaves novas, nada renomeado; CTEs de Permutas/Recebimentos idênticas à 0065.
7. Deploy fora de ordem não quebra: sem as chaves `sispag_*` a tela mostra "—" e "sem remessa na
   semana" (verificado pelo orquestrador).
8. Build não perde o `.sql` (gotcha de 23/09 coberto pelo `copy-to-dist`).

## 7. Limitações

- Gate de feature: métricas de repo inteiro (top-10 arquivos, fan-in, cobertura por diretório) não
  medidas.
- Não medíveis localmente: MTTR e disponibilidade real de `/metricas/ciclo`, tempo da função em
  produção, nº de usuários com `metricas:ver` sem `sispag:ver`, idade real do último sync; nada de
  DLQ/CloudWatch/IAM (não há `infra/`).
- Verificado por leitura: os agentes não reexecutaram o backfill nem consultaram produção; se o runner
  envolve cada arquivo em transação não foi verificado.
- Consolidação: 18 cards → 13 (availability-1 ⊃ fault-tolerance-2 + integrability-2;
  fault-tolerance-1 ⊃ testability-1; integrability-1 ⊃ modifiability-3; modifiability-1 ⊃
  availability-2); deployability-2 rebaixado a P3 após a verificação do orquestrador; integrability-2
  já implementado no rótulo, restando só o sinal de idade do sync (em availability-1).
- Snapshot de 2026-09-30 sobre 882cc82.

## 8. Ações recomendadas

1. Sem P0: o gate não reabre o loop. Merge do delta; P2 como follow-ups.
2. PR de testes pós-merge: fault-tolerance-1 + testability-2 (+ testability-3).
3. PR de sinal de sync: availability-1.
4. Decisões baratas em paralelo: security-1 (registrar a audiência na ADR-0056) e deployability-1
   (+ availability-3).
5. Antes da próxima frente: integrability-1 e modifiability-2; planejar modifiability-1 junto. Promover
   a guarda `status <> 'settled'` em `fail` no próximo `/feature-tweak` do ledger.
