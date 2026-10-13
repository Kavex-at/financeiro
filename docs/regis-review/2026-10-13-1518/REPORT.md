---
type: regis-review-report
run_id: 2026-10-13-1518
scope: delta fix/sispag-sync-ao-abrir (ADR-0066), --quick
overall_score: 7.6
total_cards: 23
total_p0: 0
total_p1: 0
total_p2: 16
total_p3: 7
---

# Regis-Review 2026-10-13-1518 — lotes SISPAG sincronizam ao abrir a tela

> Consolidado pelo orquestrador a partir do resumo do `qa-consolidator` (a escrita do agente foi
> recusada pela ferramenta; o `KANBAN.md` foi gravado por ele). Seções por QA nos 8 arquivos ao lado.

## 1. Scorecard (média ponderada 7,6/10)

| QA | Score | P2 | P3 | Finding principal |
|---|---|---|---|---|
| Availability | 8,0 | 2 | 1 | Passada L11 sem prazo máximo sob a trava |
| Fault Tolerance | 8,0 | 2 | 1 | Cron sai 0 com a trava ocupada (trava presa = skip silencioso) |
| Security | 8,0 | 1 | 1 | Botão forçado sem teto por ator sobre a sessão do robô |
| Integrability | 7,5 | 3 | 0 | Cap de sessões do Conexos coordenado só no frontend |
| Modifiability | 7,5 | 2 | 1 | Política TTL/cooldown duplicada (carteira × lotes) |
| Performance | 7,5 | 1 | 2 | Passada sem teto de duração |
| Deployability | 7,0 | 2 | 1 | Sem kill switch do gatilho de abertura |
| Testability | 7,0 | 3 | 0 | Fronteiras de TTL/run presa/cooldown sem teste no valor exato |

**Zero P0/P1.** O teto de severidade do delta é P2 por construção: a passada é read-only no ERP
(I11a), idempotente (I11h) e serializada por advisory lock.

## 2. Top riscos

1. **Passada sem prazo máximo** (availability-1 = performance-1; fault-tolerance-4). Uma leitura
   pendurada no Conexos segura a trava; toda abertura responde `em_andamento` e o cron sai 0. Nenhum
   timeout explícito foi encontrado nos clients Conexos (verificação rápida do orquestrador, não
   exaustiva) — o risco se mantém.
2. **Sessão do robô governada no cliente** (integrability-2, security-1). A ordem carteira → lotes
   só vale na abertura; botão forçado e cron podem coincidir com uma ingestão.
3. **Falha sem sinal fora da tela** (availability-3 = fault-tolerance-2): sem alerta de idade da
   última passada bem-sucedida.
4. **Sem kill switch** (deployability-1): TTL ≤ 0 volta ao default; desligar exige revert.
5. **Fronteiras sem teste exato e trava só por mock** (testability-1..3).

Demais: pool de 5 conexões com requisição de ~25 s; runs `running` mortas nunca fechadas; contrato
BE↔FE sem Zod; arquivos SISPAG > 1500 LOC.

## 3. O que está bem

Exclusão mútua por advisory lock; 0 escrita no ERP; sem migration (rollback = revert); falha total
vira `error` e o cron sai ≠ 0; dentro do TTL, 0 chamada ao Conexos; rota antiga 410 com `code`
estável; 3/3 rotas com `exigirPermissao` e `heavyRouteLimiter`; erro redigido; job de 117 → 49 LOC;
gates 4058/4058 (BE) e 893/893 (FE).

## 4. Próximos 30 dias

1. availability-1, deployability-1, security-1, integrability-2 (todos S).
2. fault-tolerance-2, fault-tolerance-1, availability-2.
3. integrability-3, testability-1.
4. modifiability-1 + testability-2 + fault-tolerance-3 numa mudança só.

## 5. Limitações

`--quick`, escopo restrito ao delta; cobertura, `npm audit`, p95 e MTTR não medidos; sem `infra/`;
frontend avaliado por tamanho e gates.
