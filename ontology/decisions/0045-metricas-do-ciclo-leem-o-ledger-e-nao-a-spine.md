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
- **Semana em curso: lida, mas marcada** *(revisto em 2026-09-14, antes do merge)*. A primeira
  versão só emitia semana fechada. Mas o report é feito na sexta à tarde, antes do fechamento das
  20:00, e sairia sem número; o Yuri não aceitou. Agora a função também devolve a semana em curso,
  com `parcial = true` e o horário de corte em `apurado_ate`. A regra que protege a série virou
  outra: **número parcial nunca aparece sem o horário** (card do report, título dos KPIs, linha do
  histórico). A view segue só com semanas fechadas e as 9 colunas; a parcial sai pela API. O report
  **não** reconcilia a semana anterior (decisão do Yuri); o número fechado fica na tela Métricas.
  Descartado: adiantar o corte para sexta 12:00. Não resolve relatório feito de manhã e mudaria a
  fronteira da série.
- **`timestamp` sem fuso, em horário de São Paulo.** A sessão do Supabase é UTC. Com `timestamptz`,
  o texto `'2026-09-11T20:00:00'` que o `metrics.py` envia viraria 17:00 local.
- Tentativa atribuída ao `criado_em` (imutável). O desfecho é o estado atual do ledger, e o report
  congela o número no ciclo em que o leu.

### D5 — Acesso: a métrica é da aplicação (API + tela), não de um DSN à parte

**Decisão do Yuri (2026-09-14):** as métricas fazem parte da aplicação. `GET /metricas/ciclo`
(route → `MetricasCicloService` → `MetricasCicloRepository` → `metricas.vw_metricas_ciclo`) serve
as linhas no formato do contrato. Duas consumidoras leem a mesma coisa: a tela **Métricas** (grupo
Plataforma) e o `kavex-report-ciclo`. Este último faz login em `POST /auth/login` com um usuário da
aplicação e deixa de conectar no Postgres.

Na migration ficam o schema `metricas` (fora do PostgREST), `metricas.serie_inicio()` (fonte única
da data, que a API devolve para "série iniciada em"), `metricas.metricas_ciclo(serie, agora)`
(INVOKER, EXECUTE revogado de PUBLIC, e é o que o teste chama com "agora" fixo) e a view.

**Descartado:** um role só-leitura (`metricas_ciclo_leitor`) com DSN próprio para o report. Foi a
primeira versão deste delta, removida antes de ir para produção. Exigia um passo manual de senha no
Supabase, um segredo a mais para distribuir e rotacionar, e um segundo caminho de acesso que a
aplicação não enxerga. O ganho, um leitor que não vê `erp_response`, também existe na API: a rota
só devolve agregados.

A API também fecha o gap K1. `fim` só com data cobre o dia inteiro, então `fim=2026-09-18` inclui a
janela que fecha às 20:00. Fuso explícito na query é recusado (400): a janela é hora de São Paulo
por contrato.

## Consequências

- **+** A Seção 3 e a tela Métricas mostram o mesmo número, com origem auditável, pela mesma rota
  autenticada. Nenhum segredo novo, nenhum passo manual no banco.
- **+** Validado contra o ledger vivo: 12 semanas, 48 comparações com consulta independente, 0
  divergência.
- **−** O número de uma semana passada muda se um borderô for cancelado depois. O conserto de fundo é
  uma tabela de eventos append-only (follow-up), não esta view.
- **−** O report passa a depender de a aplicação estar no ar e de um usuário da aplicação (variáveis
  `FINANCEIRO_API_URL`, `FINANCEIRO_API_USUARIO`, `FINANCEIRO_API_SENHA` onde o report roda). Com a
  API fora, a frente aparece como lacuna declarada no report, não como número.
- **−** Frente IV sem execução desde a semana de 2026-08-07: o ciclo 6 mostrará R$ 0 e nenhum %. É
  verdade, e é tema de Seção 4.
