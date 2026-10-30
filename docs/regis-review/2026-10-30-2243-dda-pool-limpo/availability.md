---
qa: Availability
qa_slug: availability
run_id: 2026-10-30-2243-dda-pool-limpo
agent: qa-availability
generated_at: 2026-10-30T22:43:00-03:00
scope: backend
score: 7
findings_count: 3
cards_count: 2
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abre aba "Boletos DDA" em dia operacional comum | Chamada de consolidação dispara 4 leituras em paralelo (`listBoletos`, `listAtivos`, `listInativosRecentes` novo, `listTitulosEmLotesAbertos`) ao Postgres do tenant | `BoletoDdaService.carregar` → consolidação em memória | Operação normal (sem retry layer; apenas `Promise.all` sobre quatro repos) | Devolver página consolidada ou falhar atômicamente — nenhuma linha dever ser mostrada parcialmente, nenhum título inativo deve "poluir" a lista padrão | Latência adicional da nova query ≤ p95 da já existente `listAtivos`; indisponibilidade da aba por falha de uma query ≤ janela do refresh (cache + retry do cliente) |

Observação: o diff é puramente *in-process* (dedupe por `codbar`, novas situações `FORA_JANELA` / `TITULO_SAIU_CARTEIRA`, filtragem padrão) + **uma** nova query parametrizada read-only em `TituloAPagarRepository.listInativosRecentes`. Não há novas chamadas a sistema externo (Conexos, Nexxera, GED).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Nº de novas chamadas a sistema externo introduzidas pelo diff | 0 | 0 | ✅ | `git diff HEAD -- src/backend` (nenhum `axios.*`, nenhum SDK AWS novo) |
| Nº de novas queries SQL parametrizadas introduzidas | 1 (`listInativosRecentes`) | ≥1 c/ `$de`/`$ate`, sem interpolação | ✅ | `src/backend/domain/repository/sispag/TituloAPagarRepository.ts:252-269` |
| Uso de `RetryExecutor`/`FallbackExecutor`/`PollExecutor` nas novas chamadas | 0 | ≥1 em dependência considerada "degradável" | ⚠️ | `BoletoDdaService.carregar` usa `Promise.all` direto sobre repos |
| Idempotência das novas situações (`FORA_JANELA`, `TITULO_SAIU_CARTEIRA`) | Puras (função dos insumos; sem write) | Pura | ✅ | `ConsolidacaoBoletoDda.situacaoLivre:357-370` |
| Dedupe por `codbar` (`colapsarCopias`) determinístico | Sim (ordenação total por `vinculado?`, `ddcCod`, `ditCod`) | Determinístico sob reexecução | ✅ | `ConsolidacaoBoletoDda.ts:189-224` |
| Guarda contra mutação de estado em lote finalizado | N/A no diff (sem writes) | N/A | ✅ | `git diff` — só leitura |
| Backend typecheck / lint / testes sispag | typecheck ok, lint 0, 1760 testes passam | 0 falha | ✅ | `_shared-metrics.md` |

> ⚠️ **Não medível localmente**: p95 de latência da nova `listInativosRecentes` em PRD. Requer CloudWatch Logs Insights / monitor do Supabase (hoje) sobre `titulo_a_pagar` com índice em `(vencimento) WHERE ativo = FALSE`. Recomendação: instrumentar `LogService` com `durationMs` em `BoletoDdaService.carregar` separando as 4 queries.

> ⚠️ **Não medível localmente**: existência de índice que cubra `ativo = FALSE AND vencimento BETWEEN $1 AND $2`. Requer `\d+ titulo_a_pagar` no Postgres do tenant. Sem esse índice, a nova query pode ser *seq scan* numa tabela que tende a crescer indefinidamente (inativos nunca saem), inflando o tempo total de montagem da aba.

> ⚠️ **Não medível localmente**: MTTR real de incidente ligado à aba DDA. Requer histórico de alarmes CloudWatch — e **infra não existe** neste repositório (`infra/` ausente, ver `_shared-metrics.md`). Toda métrica de alarme/dashboard/DLQ é não aplicável até a materialização do estado-alvo.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | N/A no diff (sem chamada remota nova) | N/A | — |
| Heartbeat | N/A no diff | N/A | — |
| Monitor | Sem métrica de latência por repo-call na nova montagem | ⚠️ parcial | `BoletoDdaService.carregar:131-150` (sem `LogService` por sub-query) |
| Timestamp | Preservado (`importadoEm`, `vencimento` via `BankingCalendar.fromErpEpoch`) | ✅ | `ConsolidacaoBoletoDda.ts:243-249` |
| Sanity Checking | Precedência explícita CANDIDATO > FORA_JANELA > TITULO_SAIU_CARTEIRA > SEM_TITULO; filtro vencimento null-safe | ✅ | `ConsolidacaoBoletoDda.ts:357-370` + `situacaoDoLivre:139-150` |
| Condition Monitoring | `FORA_JANELA` e `TITULO_SAIU_CARTEIRA` **são** monitores condicionais sobre o boleto — detectam que o insumo saiu dos limites da carteira | ✅ | `ConsolidacaoBoletoDda.situacaoDoLivre:141-150` |
| Voting | N/A (não há múltiplas fontes a conciliar aqui) | N/A | — |
| Exception Detection | `TITULO_SAIU_CARTEIRA` surge quando faltaria dado operacional (título quitado/cancelado); PaginacaoBoletoDda esconde por padrão | ✅ | `ConsolidacaoBoletoDda.saiuDaCarteira:231-258`; `PaginacaoBoletoDda.ts:68-72` |
| Self-Test | Ausente nas novas estruturas (sem health probe) | N/A | fora do escopo da feature |
| Active Redundancy | N/A | N/A | — |
| Passive Redundancy | N/A | N/A | — |
| Spare | N/A | N/A | — |
| Exception Handling | Nenhum `try/catch` novo; `Promise.all` propaga falha | ⚠️ parcial | `BoletoDdaService.carregar:136-144` |
| Rollback | Operações só-leitura; não há estado a reverter | N/A | — |
| Software Upgrade | N/A | N/A | — |
| Retry | Nenhum `RetryExecutor` embrulhando a nova query | ⚠️ parcial | `TituloAPagarRepository.listInativosRecentes` chamado direto |
| Ignore Faulty Behavior | N/A | N/A | — |
| Degradation | A nova dimensão `TITULO_SAIU_CARTEIRA` é **escondida da lista padrão** e **não entra em `contagem.todas` nem na urgência** — se o cálculo saiu ruidoso, não "polui" o fluxo principal. Isso é degradação intencional da nova feature | ✅ | `PaginacaoBoletoDda.ts:68-72,236-240,352-367` |
| Reconfiguration | N/A | N/A | — |
| Shadow | N/A | N/A | — |
| State Resynchronization | N/A (sem estado persistido novo) | N/A | — |
| Escalating Restart | N/A | N/A | — |
| Non-Stop Forwarding | N/A | N/A | — |
| Removal from Service | Fora do escopo | N/A | — |
| Transactions | Query só-leitura, sem transação necessária | N/A | — |
| Predictive Model | N/A | N/A | — |
| Exception Prevention | `colapsarCopias` com ordenação total previne colapso não-determinístico quando houver duplicatas do mesmo `codbar`; precedência explícita de situação previne combinações inválidas | ✅ | `ConsolidacaoBoletoDda.ts:195-224`, `:357-370` |
| Increase Competence Set | Novas situações aumentam o conjunto de estados nomeados que o sistema reconhece (antes caía tudo em `SEM_TITULO`, inclusive casos recuperáveis) | ✅ | `BoletoDda.ts:51-66` |

## 4. Findings

### F-availability-1: Nova query `listInativosRecentes` é dependência rígida no `Promise.all` sem fallback

- **Severidade**: P2 (médio — débito defensável, não é regressão em relação ao estado anterior)
- **Tactic violada**: Degradation / Exception Handling
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:136-144`
- **Evidência (objetiva)**:
  ```typescript
  const [boletos, titulos, titulosSaidos, titulosEmLote] = await Promise.all([
      this.repo.listBoletos(vencimentoDesde ? { vencimentoDesde } : {}),
      this.tituloRepo.listAtivos(),
      this.tituloRepo.listInativosRecentes({ ... }),
      this.loteRepo.listTitulosEmLotesAbertos(),
  ]);
  ```
- **Impacto técnico**: `titulosSaidos` é **informativo** (alimenta uma situação escondida por padrão) mas sua falha derruba toda a montagem da aba. Uma lentidão/timeout em `titulo_a_pagar WHERE ativo=FALSE` (tabela que tende a crescer indefinidamente e cuja cobertura por índice é não medível localmente) impede o analista de ver `VINCULADO`/`CANDIDATO`/`AMBIGUO` — exatamente os estados que **pedem ação**.
- **Impacto de negócio**: aba "Boletos DDA" indisponível quando a feature nova é a que falha; analista perde visão de boletos que precisam ser conciliados **hoje** por conta de uma funcionalidade acessória.
- **Métrica de baseline**: 1/4 das queries da montagem é a nova e não-essencial; peso ~25% da superfície de falha na nova carga, com 0% de blindagem (`Promise.allSettled` ausente, `FallbackExecutor` ausente).

### F-availability-2: Faixa consultada em `listInativosRecentes` não limita quantidade de linhas

- **Severidade**: P2
- **Tactic violada**: Exception Prevention / Monitor
- **Localização**: `src/backend/domain/repository/sispag/TituloAPagarRepository.ts:252-269`
- **Evidência (objetiva)**:
  ```sql
  WHERE ativo = FALSE AND vencimento IS NOT NULL
    AND (vencimento AT TIME ZONE 'UTC')::date BETWEEN $de::date AND $ate::date
  ORDER BY vencimento ASC
  ```
  (sem `LIMIT`)
- **Impacto técnico**: dentro da janela `[hoje − (15+10), hoje + (45+10)]` dias um tenant com volume alto pode retornar milhares de títulos inativos ao Lambda/Node — todos trafegam por rede, viram objetos em memória e são indexados por `indexarSaidos`. Sem `LIMIT` nem *streaming*, cresce linearmente com o histórico operacional do tenant.
- **Impacto de negócio**: pressão de memória no backend sob tenants grandes; na infra atual (Render / Express) traduz-se em potencial OOM do processo, que afeta **todas** as rotas e não só a aba DDA.
- **Métrica de baseline**: tamanho máximo observado da resposta não medível localmente (sem acesso a PRD); limite superior teórico = cardinalidade de `titulo_a_pagar` com `ativo=FALSE` na janela de 70 dias.

### F-availability-3: Ausência de instrumentação por sub-query dificulta diagnóstico de lentidão

- **Severidade**: P3
- **Tactic violada**: Monitor
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.carregar:131-150`
- **Evidência (objetiva)**: nenhum `LogService.message` novo cerca a sub-query `listInativosRecentes`; só o tempo total da montagem (quando logado em outro lugar) está disponível.
- **Impacto técnico**: quando um analista reclamar que "a aba demorou", não há como atribuir ao repo certo sem reproduzir em ambiente instrumentado — e a feature adicionou uma 4ª query cujo custo é desconhecido.
- **Impacto de negócio**: MTTR de investigação cresce; o time gasta ciclos a mais para localizar a causa.
- **Métrica de baseline**: 0 `LogService.message` com `durationMs` por repo-call no caminho novo.

## 5. Cards Kanban

### [availability-1] Degradar graciosamente quando `listInativosRecentes` falha

- **Problema**
  > A nova query de títulos inativos alimenta uma dimensão (`TITULO_SAIU_CARTEIRA`) que é **escondida por padrão** e não aparece em `contagem.todas`. Mesmo assim, uma falha dela mata a aba inteira porque está no `Promise.all` junto das queries essenciais. É débito desproporcional: o acessório derruba o principal.

- **Melhoria Proposta**
  > Trocar `Promise.all` por `Promise.allSettled` no bloco de `BoletoDdaService.carregar` (ou envolver só `listInativosRecentes` em `FallbackExecutor` que retorne `[]`). Logar `LogService.message` com `LOG_TYPE.WARN` quando a sub-query falhar, mantendo a aba viva sem a dimensão `TITULO_SAIU_CARTEIRA`. Essencial: as outras três queries continuam falhando "duro" — só a nova degrada.

- **Resultado Esperado**
  > Falha isolada em `listInativosRecentes` não indisponibiliza a aba. Observabilidade: `% montagens com fallback acionado` passa a ser medível. Valor atual (indisponibilidade da aba quando a nova query falha) → valor alvo: aba continua carregando sem a dimensão opcional.

- **Tactic alvo**: Degradation / Exception Handling
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1, F-availability-3
- **Métricas de sucesso**:
  - Falhas de `listInativosRecentes` que indisponibilizam a aba: 100% → 0%
  - Logs `WARN` emitidos quando a query falha: 0 → 1 por ocorrência
- **Risco de não fazer**: incidente onde `titulo_a_pagar` com `ativo=FALSE` fica lenta (crescimento histórico sem poda) tira do ar o painel de DDA inteiro, inclusive os `CANDIDATO` que o analista precisa resolver no dia.
- **Dependências**: nenhuma.

### [availability-2] Limitar e cobrir por índice a nova query de inativos

- **Problema**
  > `listInativosRecentes` roda sem `LIMIT` sobre uma faixa de ~70 dias de `titulo_a_pagar WHERE ativo = FALSE`. A tabela cresce indefinidamente (inativos não são expurgados), e não há garantia local de que exista índice que cubra o filtro. Para `TITULO_SAIU_CARTEIRA`, só interessa um punhado de linhas por boleto DDA (`MAX_INFORMATIVOS = 5`).

- **Melhoria Proposta**
  > (i) Confirmar/criar índice parcial `titulo_a_pagar (vencimento) WHERE ativo = FALSE` (migration SQL em `src/backend/migrations/`); (ii) Avaliar `LIMIT` de defesa (ex.: 2000) com log `WARN` quando o limite for atingido — é sinal operacional de que a janela está sobrecarregando a feature; (iii) Documentar na ontologia o teto esperado.

- **Resultado Esperado**
  > Latência da nova query previsível e observável. Valor atual (não medível localmente, risco de *seq scan*) → alvo: p95 ≤ p95 de `listAtivos` da mesma montagem.

- **Tactic alvo**: Exception Prevention / Monitor
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-2, F-availability-3
- **Métricas de sucesso**:
  - Índice cobrindo o predicado: ausente/desconhecido → presente e usado (`EXPLAIN`)
  - `LIMIT` de defesa: ausente → presente, com log quando saturado
- **Risco de não fazer**: tenant com histórico longo passa a sofrer latência crescente na aba DDA (sintoma lento, de origem silenciosa) e, no limite, pressão de memória no processo Node compartilhado.
- **Dependências**: visibilidade do schema do tenant (coordenar com DBA/responsável pelo PRD).

## 6. Notas do agente

- Escopo é **só o diff não-commitado**; não revisei o resto do SISPAG. O diff não introduz nenhuma chamada externa nova (Conexos/Nexxera/GED): a análise de Availability concentra-se na nova query ao Postgres e na forma como ela é composta no `Promise.all`.
- Nota positiva: o diff **ganha** três tactics (Condition Monitoring, Exception Detection, Degradation) ao introduzir `FORA_JANELA`/`TITULO_SAIU_CARTEIRA` escondidos por padrão. Isso é o motivo do score 7 apesar das três fraquezas.
- Infra não existe (`_shared-metrics.md`): toda métrica de alarme/DLQ/MTTR é não aplicável, não omitida — declarada em §2.
- Cross-QA: F-availability-2 (sem `LIMIT`) tem overlap com `qa-performance`; o consolidator pode mesclar com achado de performance se existir.
