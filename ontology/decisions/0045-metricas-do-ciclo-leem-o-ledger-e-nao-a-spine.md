---
adr_number: 0045
title: As métricas do ciclo leem os ledgers de execução — a trilha da SN, e não a spine `recebimento` — com série a partir do ciclo 6 e só janela fechada
date: 2026-09-14
status: accepted
type: new
related_entities: [Permuta, SolicitacaoNumerario]
related_actions: []
related_integrations: [kavex-report-ciclo]
evidence:
  - src/backend/migrations/0058_vw_metricas_ciclo.sql
  - src/backend/migrations/vwMetricasCiclo.integration.test.ts
  - docs/impacto/dados/h0-recebimentos-kpis.json
supersedes_decisions: []
amends_decisions: []
---

# ADR 0045: o report mede o que o sistema gravou, onde ele gravou

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Branch:** `feat/metricas-ciclo`.
**Status: aceita** — G1, G2 e G3 respondidos pelo Yuri em 2026-09-14
(`ontology/_inbox/metricas-ciclo-gap.md`). Enquanto proposta, nenhuma
chave de `metrica` é permanente até o merge. **`entity_changed = false`**: é read-model, sem entidade,
ação ou estado novo.

## Contexto

A Seção 3 do report semanal mostrava ritmo (commits, PRs, versões), não efeito. O
`kavex-report-ciclo/scripts/metrics.py` lê `vw_metricas_ciclo` de cada solução por forma fixa (9
colunas) e não conhece a semântica. O brief pedia duas métricas por frente: Permutas pela
`permuta_alocacao_execucao`; Recebimentos por `recebimento`, `recebimento_execucao` e
`rateio_recebimento`, com "% de créditos alocados sem toque humano".

A sondagem read-only da produção em 2026-09-14 mostrou quatro coisas que o brief não tinha como saber.

## Decisões

### D1 — Frente IV mede a trilha da SN, não a spine

`recebimento`, `recebimento_execucao` e `rateio_recebimento` têm **0 linhas**, já tinham em
2026-08-20. A alocação de crédito de cliente acontece em `solicitacao_numerario_execucao`: 23
execuções reais, 12 concluídas, R$ 2,03 mi. Uma view sobre a spine teria reportado "0 alocados" na
semana de 2026-08-07, em que a SN alocou R$ 789.490,08.

**Descartado:** medir pela spine "porque é o modelo-alvo". Seria um número verdadeiro sobre a tabela e
falso sobre a operação. Quando a spine passar a ser escrita, entra chave nova. As atuais não são
renomeadas.

### D2 — "% sem toque humano" não é emitido

Nenhuma coluna registra esse fato. Toda SN é disparada por analista, e há 0 regras automáticas. O único
flag vizinho, `revisao_humana`, quer dizer "a homologação voltou com validação pendente no com194". Hoje
daria 0%, e por outro motivo. Métrica emitida provisoriamente: taxa de conclusão
(`recebimentos_alocacoes_concluidas_pct`), simétrica à de Permutas. **G1 (2026-09-14): descartado.** Se
todo registro é disparado por alguém, a métrica não existe; não há chave reservada para ela.

### D3 — Só baixa em borderô FINALIZADO conta como concluída

Concluída = `settled` com borderô FINALIZADO (`bor_vld_finalizado = 1` e `bor_cod_estornado IS NULL`),
a mesma derivação de `BorderoGestaoService.situacaoDoItem`. CANCELADO, ESTORNADO e **EM CADASTRO**
(G2, 2026-09-14: "pode ser outra métrica, mas não concluída") ficam fora do numerador e do R$, e dentro
do denominador. Borderô ausente do cache também não conta, porque situação desconhecida não é
finalizada.

Em 2026-09-14, das 177 baixas `settled`: 150 finalizadas (R$ 57,00 mi), 20 canceladas (R$ 3,03 mi),
3 em cadastro (R$ 0,30 mi) e 4 sem cache (R$ 2,76 mi; borderôs 2466 e 19254–19256, de agosto,
ausentes mesmo com o cache atualizado no dia). Na semana de 2026-06-19, contar as desfeitas levaria a
taxa de 39% para 80%. Na de 2026-08-07, a regra estrita leva de 92,3% para 73,1%.

### D4 — Série desde 2026-09-11 20:00, só janela fechada, `timestamp` de São Paulo

- **Sem backfill**, embora o ledger tenha dado desde junho. O ledger de permutas apaga linha quando o
  borderô é excluído, e as definições não existiam. Número reconstruído parece medido e não é.
- **Só janela fechada.** Semana em curso seria número incompleto com cara de fechado.
- **`timestamp` sem fuso, em horário de São Paulo.** A sessão do Supabase é UTC. Com `timestamptz`,
  o texto `'2026-09-11T20:00:00'` que o `metrics.py` envia viraria 17:00 local.
- Tentativa atribuída ao `criado_em` (imutável). O desfecho é o estado atual do ledger, e o report
  congela o número no ciclo em que o leu.

### D5 — Acesso: schema próprio, função vigente DEFINER, role só-leitura

Schema `metricas`, fora do PostgREST. `metricas.metricas_ciclo(serie, agora)` (INVOKER, EXECUTE
revogado) carrega a lógica e é o que o teste chama com "agora" fixo. `metricas_ciclo_vigente()` (sem
parâmetro, DEFINER, `search_path = ''`) fixa série e `now()`. A view lê a vigente.

A vigente existe por um detalhe que **o teste de integração pegou**: função dentro de view checa
`EXECUTE` e roda com o privilégio de quem consulta. Revogar a função parametrizada trancava o leitor;
conceder a ela deixava o leitor recuar a série.

Role `metricas_ciclo_leitor`: `NOLOGIN` na migration, `default_transaction_read_only`,
`search_path = metricas`, `statement_timeout = 30s`, e só USAGE + EXECUTE na vigente + SELECT na
view. O `LOGIN PASSWORD` é passo humano, no próprio role: `ALTER ROLE … SET` não é herdado por membro.

## Consequências

- **+** A Seção 3 passa a ter número de operação com origem auditável, lido por um role que não enxerga
  `erp_response` nem e-mail.
- **+** Validado contra o ledger vivo: 12 semanas, 48 comparações com consulta independente, 0
  divergência.
- **−** O número de uma semana passada muda se um borderô for cancelado depois. O conserto de fundo é
  uma tabela de eventos append-only (follow-up), não esta view.
- **−** O critério "`metrics.py --inicio 2026-09-11 --fim 2026-09-18`" devolve **zero linhas** com data
  sem hora. Precisa de `--fim 2026-09-18T20:00:00` ou de ajuste no filtro do script (gap K1).
- **−** Frente IV sem execução desde a semana de 2026-08-07: o ciclo 6 mostrará R$ 0 e nenhum %. É
  verdade, e é tema de Seção 4.
