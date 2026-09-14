---
type: regis-review-report
run_id: 2026-09-14-1624-metricas-ciclo
generated_at: 2026-09-14T18:30:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: backend --quick, delta git 14ca71a..HEAD (migration 0058 + testes vwMetricasCiclo)
total_cards: 26
total_p0: 1
total_p1: 1
total_p2: 16
total_p3: 8
overall_score: 7.5
---

# Regis-Review — financeiro — 2026-09-14-1624-metricas-ciclo

Escopo: delta `metricas-ciclo` (`git diff 14ca71a..HEAD`), 3 arquivos de produção — `src/backend/migrations/0058_vw_metricas_ciclo.sql` (271 LOC), `vwMetricasCiclo.test.ts` (109 LOC), `vwMetricasCiclo.integration.test.ts` (277 LOC). Zero dependências novas, zero TS de produção. O delta expõe um read-model puro para o consumidor externo `kavex-report-ciclo/scripts/metrics.py` (leitura semanal).

Contexto de qualidade prévio (do orquestrador):
- PatternGuardian: **PASSOU** (1 nota de estilo não-bloqueante, corrigida no loop).
- SpecVerifier cego: **APROVADO** — 14/14 critérios de aceitação.
- Comparação contra o ledger vivo em produção: **EQUIVALENTE** (48 comparações, 0 divergências).
- Sondagem read-only em produção (2026-09-14): o boot user `postgres` do Supabase tem `rolcreaterole = true`, e nem o role `metricas_ciclo_leitor` nem o schema `metricas` existem ainda → **F-fault-tolerance-3 não se materializa em produção**; card mantido em P3 como salvaguarda para ambientes novos.

## 1. Executive scorecard

Pesos (SaaS financeiro que executa escritas que movem dinheiro): Security 1.5, Fault Tolerance 1.3, Availability 1.2, Modifiability 1.2, Testability 1.0, Performance 1.0, Integrability 0.9, Deployability 0.9. Soma = 9.0.

`overall_score = (8×1.5 + 8×1.3 + 7×1.2 + 7×1.2 + 6×1.0 + 9×1.0 + 8×0.9 + 7×0.9) / 9.0 = 67.7 / 9.0 = 7.52`

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 7 | 0 | 0 | 2 | 2 | F-availability-1: nenhum monitor sobre a saúde do leitor de `vw_metricas_ciclo`; janela de detecção = cadência do report (7 dias) |
| Deployability | 7 | 0 | 0 | 2 | 1 | F-deployability-1: passo humano `ALTER ROLE ... LOGIN PASSWORD` não instrumentado; primeiro ciclo pós-deploy em ambiente novo sai vazio |
| Integrability | 8 | 0 | 0 | 3 | 2 | F-integrability-1: 0 pact tests cross-repo — SWAP de colunas passa no CI e quebra o render do report |
| Modifiability | 7 | 0 | 1 | 3 | 2 | F-modifiability-1: regra "borderô desfeito" duplicada SQL↔TS sem cinta; tela e report podem divergir |
| Performance | 9 | 0 | 0 | 0 | 2 | F-performance-1: `AT TIME ZONE` no predicado impede índice em `criado_em` — irrelevante hoje (190 linhas), gatilho a 50 k+ |
| Fault Tolerance | 8 | 0 | 0 | 3 | 1 | F-fault-tolerance-1: `DELETE` no ledger apaga tentativa já reportada; ADR-0045 aceita, mas nenhum evento append-only guarda o número lido |
| Security | 8 | 0 | 0 | 3 | 2 | F-security-1: guarda de host do teste de integração é só hostname — túnel SSH para produção passaria e reescreveria a senha do role |
| Testability | 6 | 1 | 0 | 3 | 0 | F-testability-1 (P0): 13 asserts comportamentais existem, 0/13 rodam em CI — regressão semântica chega ao report antes de um humano ver |
| **Overall** | **7.5** | **1** | **1** | **19*** | **12*** | — |

\* Contagem antes da deduplicação (soma direta por seção). Após consolidar cards convergentes: **P0=1, P1=1, P2=16, P3=8 → 26 cards únicos** (ver §7 e KANBAN.md).

Interpretação:
- 0–3: risco estrutural — bloqueia escalonamento.
- 4–6: dívida defensável — endereçar nesta janela de planejamento.
- **7–8: saudável com oportunidades pontuais.** ← posição atual.
- 9–10: estado da arte para o estágio atual.

Leitura em uma frase: o delta é conservador (read-model, idempotente, 0 dependências, comparado contra o ledger vivo), com um único P0 sobre o pipeline de teste e um único P1 sobre duplicação de regra. O resto é P2/P3 — melhoria operacional, não risco de produção.

## 2. Top 5 risks (cross-QA)

Ranking = severidade × impacto de negócio × alavancagem. Cada risco carrega o card que o resolve.

### R-1: Regressão semântica no SQL chega ao report do cliente sem passar por gate automatizado
- **QAs afetados**: Testability, Availability
- **Findings de origem**: F-testability-1 (P0), F-availability-2 (P2)
- **Evidência**: `jest.config.cjs:7` casa `\.integration\.test\.ts$` no `testPathIgnorePatterns`, e `.github/workflows/ci.yml` só roda `npm test -- --coverage`. **0 dos 13 asserts** de `vwMetricasCiclo.integration.test.ts` rodam em PR. A mutação validada no ciclo (`< janela_fim` → `<=`) derrubou 2 asserts no Postgres 17-alpine descartável — só porque alguém rodou `docker run` à mão.
- **Impacto técnico**: um refactor SQL (`AND NOT e.desfeita` → `AND e.desfeita = false`, semanticamente diferente com LEFT JOIN nulável) passa no CI. Schema drift de migrations posteriores também.
- **Impacto de negócio**: a Seção 3 do report semanal da Columbia lê `vw_metricas_ciclo`. Uma regressão introduzida na segunda aparece na sexta 20:00 — o cliente lê `100.0%` falso antes de qualquer humano notar.
- **Card**: `CI-1` (consolidado — testability-1 + availability-2)
- **Custo de inação em 6 meses**: com 2–3 PRs/mês tocando SQL de agregação, é realista ≥ 1 regressão silenciosa chegar ao cliente. Não bloqueia a operação; bloqueia a credibilidade da Seção 3.

### R-2: Regra "borderô desfeito" duplicada em duas linguagens sem cinta de sincronia
- **QAs afetados**: Modifiability, Integrability (fronteira SQL↔TS)
- **Findings de origem**: F-modifiability-1 (P1)
- **Evidência**: `0058_vw_metricas_ciclo.sql:117-123` usa `EXISTS ... (b.bor_vld_finalizado = 2 OR b.bor_cod_estornado IS NOT NULL)`; `BorderoGestaoService.situacaoDoItem:596-604` usa `if (borCodEstornado != null) return 'ESTORNADO'; if (borVldFinalizado === 2) return 'CANCELADO'`. Dois sítios, duas linguagens, zero cinta (typecheck, lint e PatternGuardian não pegam).
- **Impacto técnico**: uma situação futura (`bor_vld_finalizado = 3`) exige editar 2 arquivos em sincronia; se o SQL ficar para trás, a taxa da Frente I diverge do que o analista vê na UI.
- **Impacto de negócio**: 20 baixas / R$ 3,03 mi já estão em borderôs CANCELADOS no snapshot (`_shared-metrics.md`). Report e tela com números diferentes sobre o mesmo evento corroem o argumento de "número auditável".
- **Card**: `MOD-1`
- **Custo de inação em 6 meses**: ~1 ajuste de semântica por semestre × ~30% de chance de esquecer um sítio → 1 divergência SQL↔TS em produção; meia manhã de retrabalho por incidente, mais a erosão de confiança.

### R-3: Contrato de 9 colunas com `kavex-report-ciclo/metrics.py` existe só como convenção
- **QAs afetados**: Integrability, Modifiability, Deployability
- **Findings de origem**: F-integrability-1 (P2), F-modifiability-4 (P2), F-deployability-3 (P3)
- **Evidência**: `metrics.py:16` mantém `COLUNAS = [...]` como cópia literal do `RETURNS TABLE`. Dois repositórios, duas cópias, nenhum lint ou CI cross-repo. Quatro gaps (K1..K4) já estão abertos entre a view e o consumidor.
- **Impacto técnico**: um `DROP` de coluna falha ruidosamente no `SELECT`; um `SWAP` passa despercebido — `dict(zip(COLUNAS, r))` desalinha em silêncio.
- **Impacto de negócio**: o report da sexta sai com rótulo trocado por número. Invisível até alguém conferir o HTML.
- **Card**: `CROSS-CONTRACT` (consolidado — modifiability-4 + integrability-1 + deployability-3)
- **Custo de inação em 6 meses**: em 6 PRs de manutenção da view, ≈ 25% de chance de renomeação ou SWAP; se ocorrer, 1 ciclo de report perdido.

### R-4: Habilitar o leitor exige passo humano fora do controle do repositório
- **QAs afetados**: Deployability, Availability, Security (tangencial)
- **Findings de origem**: F-deployability-1 (P2), F-availability-3 (P3)
- **Evidência**: `0058_vw_metricas_ciclo.sql:60-69` documenta em comentário o passo `ALTER ROLE metricas_ciclo_leitor WITH LOGIN PASSWORD '<gerada>'`. Zero automação, probe ou runbook.
- **Impacto técnico**: o primeiro deploy num ambiente novo (staging, próximo tenant) tem 100% de chance de report vazio no primeiro ciclo.
- **Impacto de negócio**: para a Columbia (ambiente único), custo zero depois do provisionamento inicial. No alvo SaaSo, o custo se repete a cada tenant.
- **Card**: `HAB-LEITOR` (consolidado — deployability-1 + availability-3)
- **Custo de inação em 6 meses**: 1 ambiente novo ⇒ 1 ciclo perdido com recuperação manual.

### R-5: Não há observabilidade sobre a leitura do read-model — a falha só aparece no próximo report
- **QAs afetados**: Availability, Security, Integrability
- **Findings de origem**: F-availability-1 (P2), F-security-4 (P2), F-integrability-3 (P2)
- **Evidência**: `grep -rn "vw_metricas_ciclo\|metricas_ciclo_leitor" src/backend` fora das migrations = 0. Zero heartbeat, zero alerta de `authentication failure`/`permission denied` do leitor, zero canal semântico. `metrics.py` só preenche `frentes_sem_instrumentacao` quando lança exceção — `metricas: []` cobre, sem distinção, filtro errado, série futura e schema quebrado.
- **Impacto técnico**: MTTR silencioso ≈ 7 dias para qualquer falha do leitor.
- **Impacto de negócio**: Seção 3 vazia numa reunião de fechamento com o cliente, sem alarme prévio.
- **Cards**: `AVAIL-1`, `SEC-4`, `INTEG-3`
- **Custo de inação em 6 meses**: ≈ 10% de probabilidade em 26 ciclos, contando 1 migration futura que toque os ledgers de origem.

## 3. Cross-cutting findings

### CC-1: Suíte de integração fora do CI é a causa-raiz de meia dúzia de findings
- **Aparece em**: Testability (F-1), Availability (F-2), Security (F-1 depende disso), Integrability (F-5), Modifiability (F-5)
- **Diagnóstico**: `vwMetricasCiclo.integration.test.ts` é a única prova comportamental (13 asserts, testada por mutação). Estava atrás do `testPathIgnorePatterns`, sem service Postgres no `ci.yml` e sem script npm. As guardas estáticas restantes são regex frágeis; sem o teste de integração, o gate real do delta desaparece. `security-1` (guarda só por hostname) importa mais quando o teste passa a rodar com mais frequência.
- **Recomendação**: `CI-1` + `SEC-1` + `TEST-5`.

### CC-2: Contrato de 9 colunas atravessa 2 repositórios sem cinta cross-repo
- **Aparece em**: Integrability (F-1, F-3, F-4), Modifiability (F-4), Deployability (F-3)
- **Diagnóstico**: a view expõe 9 colunas ao `metrics.py`; o outro repo mantém a lista literal. K1..K4 já mostram desalinhamentos vivos sem nenhuma mudança de schema. Não há pact test, versão de contrato nem canal de diagnóstico.
- **Recomendação**: `CROSS-CONTRACT` + `INTEG-3`.

### CC-3: Rollback e provisionamento cluster-level da 0058 sem script versionado
- **Aparece em**: Availability (F-4), Deployability (F-2), Fault Tolerance (F-4)
- **Diagnóstico**: a 0058 cria schema, 2 funções, 1 view **e** um role cluster-level (`metricas_ciclo_leitor` + 3 `ALTER ROLE ... SET`). A política de `rollbacks/README.md` só exige reverse para `UPDATE > 1000 linhas` — a 0058 está conforme, mas reverter num incidente seria improviso.
- **Recomendação**: `ROLLBACK-0058`.

### CC-4: Passo humano `ALTER ROLE ... LOGIN PASSWORD` não instrumentado
- **Aparece em**: Deployability (F-1), Availability (F-3), Security (F-2, rotação)
- **Diagnóstico**: manter a senha fora da migration é a escolha certa; a falta de runbook, script e probe é a dívida.
- **Recomendação**: `HAB-LEITOR` + `SEC-2`.

### CC-5: Ausência de observabilidade sobre o leitor externo
- **Aparece em**: Availability (F-1), Security (F-4), Integrability (F-3), Fault Tolerance (F-2)
- **Diagnóstico**: o backend não consulta a view, então nenhuma métrica de runtime alarma. Falha de autenticação, `permission denied` e cache defasado passam em silêncio.
- **Recomendação**: `AVAIL-1` + `SEC-4` + `INTEG-3` + `FT-2`.

## 4. Quick wins (≤ 5 dias úteis)

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| `CI-1` | Testability + Availability | S | **P0** | 13/13 asserts comportamentais rodam em cada PR; regressão detectada em < 5 min (vs. 7 dias) |
| `MOD-1` | Modifiability | S | **P1** | Regra "borderô desfeito" com teste de espelho contra `situacaoDoItem` |
| `SEC-1` | Security | S | P2 | Guarda de host + fingerprint do banco descartável |
| `SEC-2` | Security | S | P2 | Runbook versionado de rotação e revogação; revogação em incidente ≤ 15 min |
| `SEC-4` | Security | S | P2 | 2 alertas no Supabase Log Explorer; detecção de escalada ≤ 5 min |
| `AVAIL-1` | Availability | S | P2 | Heartbeat sobre `vw_metricas_ciclo`; MTTR do leitor de 7 d para ≤ 24 h |
| `HAB-LEITOR` | Deployability + Availability | S | P2 | Habilitar o leitor num ambiente novo deixa de depender de memória |
| `INTEG-2` | Integrability | S | P2 | `metrics.py --fim` sem hora gera aviso explícito, não `0 métrica(s)` |
| `INTEG-3` | Integrability | S | P2 | `metricas.diagnostico()` distingue "janela vazia por design" de "quebrou" |
| `MOD-3` | Modifiability | S | P2 | 4× `'America/Sao_Paulo'` + 3× `INTERVAL '7 days'` → constantes nomeadas |
| `ROLLBACK-0058` | Availability + Deployability + Fault Tolerance | S | P2 | `0058_*.rollback.sql` versionado |
| `TEST-2` | Testability | S | P2 | Teste com `now()` controlado exercita `metricas_ciclo_vigente()` sem tautologia |
| `TEST-3` | Testability | S | P2 | Asserção comportamental de `statement_timeout = 30s` na sessão do leitor |

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| `CROSS-CONTRACT` | Integrability + Modifiability + Deployability | M | Contract testing / Encapsulate / Versioning strategy | 0 pact tests para 1 consumidor real + 4 gaps K1..K4 vivos; o template prevê ≥ 3 soluções no mesmo contrato |
| `MOD-2` | Modifiability | M | Split Module / Increase Semantic Coherence | Corpo da função-topo = 138 LOC; a próxima frente (SISPAG) força reescrita completa via `CREATE OR REPLACE` |
| `TEST-5` | Testability | M | Sandbox | 15 `*.integration.test.ts` no backend, 0 orquestrados |
| `FT-1` | Fault Tolerance | M | Rollback + Timestamp (evento preservado) | 190 linhas de `permuta_alocacao_execucao` podem sofrer `DELETE`; reprocessar ciclo passado devolve número diferente, sem trilha |
| `INTEG-5` | Integrability | M | Contract testing (robustez) | 4 regex frágeis; reformatação derruba a guarda sem mudança lógica |

## 6. O que está bem (e por quê)

1. **Encapsulamento externo exemplar** (*Encapsulate* + *Restrict Communication Paths*). Schema `metricas` fora do PostgREST; o role tem `USAGE` no schema, `EXECUTE` só na `vigente`, `SELECT` só na view; **0 tabelas de origem legíveis pelo leitor** (provado no teste de integração).
2. **Comparação contra o ledger vivo** (*Sanity Checking*). 48 comparações, 0 divergências, em produção e read-only.
3. **Idempotência provada** — `reaplicar a migration é no-op` verde.
4. **Zero DML e zero PII na view** (*Limit Exposure*). As 9 colunas são só agregados e rótulos.
5. **`statement_timeout = 30s` + `default_transaction_read_only = on` no leitor** (*Bound Execution Times*). O mesmo controle aparece em Performance, Availability, Fault Tolerance e Security.
6. **SECURITY DEFINER com `SET search_path = ''` e nomes qualificados**. Sequestro de `search_path` bloqueado por construção.
7. **Testes de integração discriminantes**. Fixtures nomeadas (`p-cancelado`, `p-parcial`, `p-utc-na-A`) + mutação `<` → `<=` derrubando 2 casos.
8. **Zero dependências novas**.

## 7. Limitações da análise

**Não medível localmente**:
- MTTR real do leitor externo — depende do histórico do `metrics.py` no repo `kavex-report-ciclo`.
- Latência p50/p95 no Supabase — exige `pg_stat_statements`.
- Falha de `CREATE ROLE` no Supabase — **verificado read-only**: boot user tem `rolcreaterole = true` → F-fault-tolerance-3 em P3.
- `npm audit` — `--quick`; o delta tem 0 dependências novas.
- Cobertura por linha SQL — Postgres não emite coverage; proxy = asserts comportamentais executados / existentes (0/13 antes da remediação do P0).

**Fora do escopo**: chaos engineering, threat modeling formal, custo de cloud, UX; backend Express legado e clients Conexos/Nexxera; o repo `kavex-report-ciclo` (K1..K4 pertencem a ele).

**Deduplicação**: 32 cards de origem → **26 únicos**.
- `CI-1` = testability-1 + availability-2.
- `CROSS-CONTRACT` = modifiability-4 + integrability-1 + deployability-3.
- `ROLLBACK-0058` = availability-4 + deployability-2 + fault-tolerance-4 (severidade final P2).
- `HAB-LEITOR` = deployability-1 + availability-3 (severidade final P2).

**Janela temporal**: snapshot de 2026-09-14 sobre o delta `metricas-ciclo`. Refazer na próxima migration que tocar a superfície `metricas`.

## 8. Ações recomendadas

1. **Antes do PR (loop atual)**: remediar `CI-1` (P0), obrigatório pelo gate (CLAUDE.md, Inviolable Rule #11). `MOD-1` (P1) segue a regra do pipeline: follow-up no inbox, não entra no loop.
2. **Sprint 1 pós-merge**: `SEC-1`, `SEC-2`, `SEC-4`, `AVAIL-1`, `HAB-LEITOR`, `INTEG-2`, `INTEG-3`, `MOD-3`, `MOD-1`.
3. **Sprint 2**: `ROLLBACK-0058`, `TEST-2`, `TEST-3`.
4. **Sprints 3–4**: `CROSS-CONTRACT` (com `kavex-report-ciclo`, fechando K1..K4), `MOD-2` (antes de SISPAG), `TEST-5`.
5. **Trimestral**: `FT-1` e `PERF-1` — revisitar se `permuta_alocacao_execucao` passar de 50 000 linhas ou surgir um 2º leitor do contrato.
