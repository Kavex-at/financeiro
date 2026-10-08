---
type: regis-review-report
run_id: 2026-10-08-1958-sispag-titulos
generated_at: 2026-10-08T20:45:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
total_cards: 10
total_p0: 0
total_p1: 0
total_p2: 5
total_p3: 5
overall_score: 8.1
---

# Regis-Review — financeiro — 2026-10-08-1958-sispag-titulos

> Modo `--quick`: escopo restrito ao delta do commit `e832057` (branch `fix/sispag-titulos-filtro-export`, 18 arquivos, +768/−30): rota `POST /sispag/titulos/exportar`, `TitulosAPagarExportService`, `PlanilhaXlsxWriter` extraído e a aba Títulos do SISPAG (filtro de comprometidos, motivo do selecionar-todos, botão de export). Achados fora do delta não entram.

## 1. Executive scorecard

Pesos (financeiro): Security 1.5, Fault Tolerance 1.3, Availability 1.2, Modifiability 1.2, Testability 1.0, Performance 1.0, Integrability 0.9, Deployability 0.9 (total 9.0). Cálculo: (8×1.5 + 9×1.3 + 8×1.2 + 7×1.2 + 8×1.0 + 8.5×1.0 + 8×0.9 + 8×0.9) / 9.0 = 72.6 / 9.0 = **8.07 → 8.1**.

As colunas P0–P3 contam **findings** por severidade (15 no total); os 13 cards originais viraram 10 após merge (seção 7).

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 8.0 | 0 | 0 | 1 | 1 | F-availability-1: export sem `durationMs` nem statement timeout |
| Deployability | 8.0 | 0 | 0 | 0 | 1 | F-deployability-1: FE pode ir ao ar antes do BE e chamar rota inexistente (404) |
| Integrability | 8.0 | 0 | 0 | 0 | 2 | F-integrability-2: teto 5000 acoplado por convenção a `TITULOS_CAP` e ao body de 100 KB |
| Modifiability | 7.0 | 0 | 0 | 2 | 1 | F-modifiability-1: teto de 5000 duplicado em 3 pontos; F-modifiability-2: monolitos de 1257/1475 LOC |
| Performance | 8.5 | 0 | 0 | 0 | 2 | F-performance-1: relê a carteira ativa inteira para atender até 5000 chaves |
| Fault Tolerance | 9.0 | 0 | 0 | 0 | 1 | F-fault-tolerance-1: 3 leituras sem snapshot consistente |
| Security | 8.0 | 0 | 0 | 1 | 1 | F-security-1: export de carteira financeira sem identidade do usuário no log |
| Testability | 8.0 | 0 | 0 | 1 | 2 | F-testability-1: `PlanilhaXlsxWriter` extraído sem teste próprio |
| **Overall** | **8.1** | **0** | **0** | **5** | **10** | — |

Leitura: todos os QAs estão na faixa 7–9 (saudável com oportunidades pontuais). Não há P0 nem P1. O menor score (Modifiability, 7.0) vem de dívida pré-existente que o delta agrava (+43 LOC em `routes/sispag.ts`, +42 líquidas em `page.tsx`), não de defeito do código novo.

## 2. Top riscos (cross-QA)

Como o delta é read-only e sem I/O externo, nenhum risco move dinheiro; o ranking privilegia o que é difícil de recuperar depois.

1. **R-1 — Export sem atribuição de usuário** (security-1, P2). O log `títulos a pagar exportados` carrega `{ requestId, pedidos, titulos, ignorados }` e nenhum `userId` (0 de 2 exports SISPAG). A planilha lista credores, valores e bancos; um vazamento interno não é atribuível sem cruzar logs. Correção S, vale para os 2 exports.
2. **R-2 — Monolitos `routes/sispag.ts` (1257 LOC) e `page.tsx` (1475 LOC)** contra alvo de 600 (modifiability-2, P2, L). Delta somou +43 e +46/−4. Split Module incremental no próximo tweak.
3. **R-3 — Teto de 5000 em 3 cópias** (`TITULOS_CAP`, `MAX_TITULOS_EXPORT` FE e BE/rota) sem fonte única (modifiability-1, P2). Subir o cap do painel sem o do export faz o export divergir da tela sem teste vermelho.
4. **R-4 — Export sem `durationMs` nem `statement_timeout`** (availability-1, P2). 3 queries em `Promise.all` no pool compartilhado; latência real não medida; serialização .xlsx em memória.
5. **R-5 — `PlanilhaXlsxWriter` sem teste direto** (testability-1, P2). 0 testes para 2 consumidores.
6. **R-6 — Releitura da carteira inteira** (~1,5 mil linhas) a cada export (availability-2, P3). Contido por `heavyRouteLimiter` e `SISPAG_VER`; agir só se availability-1 mostrar p95 > 2s.
7. **R-7 — Chave `fil:doc:tit` duplicada FE/BE sem teste de paridade** (integrability-1, P3).
8. **R-8 — Dedupe e lista vazia sem asserção** no service (testability-2, P3).
9. **R-9 — Janela de 404** se o Vercel publicar antes do Render (deployability-1, P3). Mitigação: regra "backend primeiro" no `DEPLOY.md`.
10. **R-10 — Leitura best-effort sem decisão registrada** (fault-tolerance-1, P3). Coluna "Lote" pode divergir em uma linha por milissegundos; documentar para não reusar o service num fluxo de escrita.

## 3. Cross-cutting findings

- **CC-1 — Releitura da carteira inteira** é causa-raiz de F-availability-2, F-performance-1, F-security-2, F-testability-3. Medir primeiro (availability-1), otimizar depois (availability-2: `= ANY($1)` ou cache curto) se p95 > 2s.
- **CC-2 — Log do export só tem contagens**: faltam `durationMs` (Monitor) e `userId` (Audit Trail). Mesmo ponto de código; availability-1 + security-1 num PR, estendendo ao `RemessaTitulosExportService`.
- **CC-3 — Constantes/contratos duplicados FE/BE** (teto e formato da chave): modifiability-1 + integrability-1 juntos, com teste de paridade.
- **CC-4 — Concentração em monolitos**: modifiability-2 acompanhado de testability-1. O delta acertou ao extrair `PlanilhaXlsxWriter` e criar service próprio.

## 4. Quick wins (≤5 dias úteis)

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| availability-1 (+ performance-1) | Availability / Performance | S | P2 | `durationMs` no log + `statement_timeout`; alvo p95 < 2s observável |
| security-1 | Security | S | P2 | Exports SISPAG com `userId` no log: 0 de 2 → 2 de 2 |
| modifiability-1 (+ integrability-2) | Modifiability / Integrability | S | P2 | Cópias do teto: 3 → 1 fonte + teste de paridade |
| testability-1 | Testability | S | P2 | Testes diretos de `PlanilhaXlsxWriter`: 0 → 3 |

## 5. Strategic moves

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| modifiability-2 | Modifiability, Testability | L | Split Module | 1257 e 1475 LOC contra alvo 600 (2,1× e 2,5×); meta < 600 de forma incremental |

## 6. O que está bem

1. **Zero escrita e zero I/O externo no export** (Limit Exposure): 0 chamadas Conexos/Nexxera; falha isolada em erro HTTP.
2. **Entrada validada na borda** (Validate Input): Zod com regex por chave, `.min(1).max(5000)`, `heavyRouteLimiter`, `SISPAG_VER` coberto em `routePermissions.test.ts`.
3. **Valores vêm do banco, não do cliente** (Verify Message Integrity): payload só com chaves; chave obsoleta ignorada e contada.
4. **Encapsulamento do exceljs** (Encapsulate): 1 arquivo, reusado pelos 2 exports.
5. **Serviço testável** (Sandbox, Limit Non-Determinism): DI 5/5, relógio via `BankingCalendar`, `montar()` separado de `exportar()`.
6. **Deploy aditivo e reversível**: 0 migrations, 0 env vars, 0 deps novas.
7. **Gates verdes**: BE 225 suites / 4072 testes, FE 90 suites / 908 testes, typecheck e lint 0 erros.
8. **Sem injeção de fórmula**: ExcelJS grava `credor` como string.

## 7. Limitações da análise

- **Não medível localmente**: latência/erro reais e MTTR (logs do Render), cobertura (`--quick`), `npm audit`, varredura global de segredos, bundle/build, fan-in e ciclos fora do delta.
- **Não existe `infra/`**: Terraform, tenants, DLQ, CloudWatch, IAM, CloudTrail são N/A.
- **Escopo**: delta de `e832057`; código pré-existente só entra quando agravado.
- **Consolidação de cards**: 13 → 10. `performance-1` → `availability-1`; `integrability-2` → `modifiability-1`; `security-2` → `availability-2`.
- **Inconsistências entre agentes**: Modifiability situa `MAX_TITULOS_EXPORT` no FE e Integrability no BE — ambos existem (`frontend/lib/sispag.ts` espelha `backend/domain/interface/sispag/TitulosAPagarExport.ts`), o que confirma o próprio F-modifiability-1. `run_id` truncado no frontmatter de Deployability e Fault Tolerance; mesmo run.
- **Escrita deste arquivo**: o consolidator não pôde gravar o REPORT (restrição do harness a subagents); o orquestrador gravou o conteúdo devolvido, condensando a seção 2.

## 8. Ações recomendadas

1. **Um único PR pós-merge**: availability-1 + security-1 (CC-2).
2. **Mesmo ciclo**: modifiability-1 + integrability-1 (CC-3) e testability-1.
3. **Próximo `/feature-tweak` em SISPAG**: iniciar modifiability-2 (Split Module).
4. **Housekeeping**: deployability-1, fault-tolerance-1, testability-2.
5. **Só se p95 > 2s**: availability-2.
