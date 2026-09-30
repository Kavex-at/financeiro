# metricas-sispag — mapa do trabalho (feature-tweak, 2026-09-29)

Branch `fix/metricas-sispag`, worktree `.claude/worktrees/metricas-sispag`.

## Por quê

Report do ciclo 7 (2026-09-25), Seção 3: *"O SISPAG ainda não é medido. Com os testes de remessa em
andamento, incluí-lo na medição vai ser importante quando a frente passar a operar."* A Frente II
levou a maior parte da capacidade no ciclo 7 e é a única frente sem número. Em 28/09 a Columbia
informou 2 remessas geradas por nós e aceitas pelo banco (21–25/09), mas nada disso aparece na tela.

## Onde a métrica nasce hoje (cadeia única, tela e report leem a mesma coisa)

| Camada | Arquivo | O que muda |
|---|---|---|
| SQL | `metricas.metricas_ciclo()` (última versão: `migrations/0065_…`) | nova CTE `sispag` + linhas no `UNION ALL` → migration nova `0067_…` com `CREATE OR REPLACE` |
| Ledger | `remessa_execucao` (0049) | **não tem `encerrado_em`** → mesmo defeito que a ADR-0052 corrigiu nas outras frentes |
| Repo | `domain/repository/sispag/RemessaExecucaoRepository.ts` (`markSettled` l.174, `markError` l.198) | carimbar `encerrado_em` |
| Valor | `lote_pagamento_item.valor` (snapshot na inclusão), via `remessa_execucao.lote_id` | `remessa_execucao` não guarda R$ |
| Backend | `MetricasCicloRepository` / `Service` / `routes/metricas.ts` | nada: são agnósticos de frente (só contrato Zod; conferir) |
| Front | `lib/metricas.ts` (`METRICA`, 4 chaves fixas) e `app/metricas/page.tsx` (4 KPIs fixos, 4 colunas fixas) | + chaves SISPAG; grid e tabela passam de 4 para 6 (ou agrupar por frente) |
| Testes | `vwMetricasCiclo.test.ts`, `vwMetricasCiclo.integration.test.ts` (Postgres real), `page.test.tsx`, `metricas.test.ts`, `RemessaExecucaoRepository.test.ts` | casos SISPAG + regressão "nenhum número já reportado muda" |
| Report | skill `kavex-report-ciclo` (`metrics.py`, `render.py`) | fora do repo; lê a rota, então a frente nova entra sozinha. A frase "SISPAG ainda não é medido" sai do texto |

## Proposta de métricas (espelha as outras frentes: % + R$)

- `sispag_remessas_geradas_pct` — "remessas geradas sem erro — X de Y tentativas" (`remessa_execucao`,
  `dry_run = false`, `status = 'settled'` sobre todas).
- `sispag_valor_remessado` — soma de `lote_pagamento_item.valor` dos lotes com remessa `settled`.
- Frente: `'SISPAG (Frente II)'`, mesmo rótulo do report.

## O que o nosso banco NÃO sabe (limite da medição)

- **Aceite pelo banco e retorno**: o `.RET` é processado nativamente do lado Columbia/Nexxera/Conexos;
  a nossa `conciliacao_execucao` só roda por `POST /sispag/retornos/conciliar` manual. "Remessa
  aceita" não é medível pelo nosso ledger — seria leitura do ERP (fin052/fin015) ou nova integração.
- **Valor efetivamente pago**: o item guarda snapshot da inclusão, não o valor liquidado (juros/desconto).

## Gates previstos

- Ontologia: métrica nova de frente → OntologyCurator + ADR (continuação de 0045/0048/0052).
- Ground-Truth: é R$ vindo do Conexos → GroundTruthValidator (valor do lote nativo `fin015` × soma local).
- DesignSystemReviewer (tela), PatternGuardian, Regis-Review, bump `feat` → minor.
- Invariante a preservar: grade de sextas 18:00 e pisos `serie_inicio`/`historico_inicio` intocados;
  nenhum número já reportado de Permutas/Recebimentos muda.

## Decisões da entrevista (2026-09-29)

1. **Evento medido: remessa gerada E aceita pelo banco.** Não basta o que o nosso ledger já sabe.
2. **Cards: % + R$**, como as outras frentes.
3. **Lotes `CANCELADO` ficam fora** (sai a `PG160901.REM` de 16/09; entram os aceites de 21–25/09).
4. **`remessa_execucao` ganha `encerrado_em`**, com a mesma regra da ADR-0052 e backfill dos terminais.

## Consequência da decisão 1: uma fatia nova de ingestão do retorno

Hoje o aceite só chega ao nosso banco quando alguém roda `POST /sispag/retornos/conciliar` (manual,
admin), e a Columbia processa o `.RET` nativamente. Por isso as colunas que já existem em
`lote_pagamento_item` (0049: `retorno_evento`, `retorno_descricao`, `rejeitado`, `bxa_cod_seq`) estão
vazias para os lotes reais. A peça que falta:

- **Job read-only `sync-retorno-sispag`**, um cron novo no GH Actions (padrão `ingest-sispag.yml`).
  Ele lista os arquivos do `fin052` (`ConexosSispagRetornoClient.listArquivosRetorno`), lê o detalhe,
  casa pela chave nativa `filCod+bncCod+flpCod+itsCodSeq` (já é o casamento do
  `ConciliacaoRetornoService`, sem heurística) e grava o evento/rejeição no item.
  **Nunca chama `processar`/`carregar`.** Reaproveita a classificação de eventos do `fin050`.
- Coluna nova de data do retorno no item (ex. `retornado_em`), para saber quando o aceite chegou.
- Atenção aos secrets: os crons usam credenciais próprias do Conexos, que já ficaram desatualizadas
  uma vez (23/09).

## Proposta de definição (a confirmar, ver P1–P3)

- `sispag_titulos_aceitos_pct`: títulos aceitos pelo banco ÷ títulos enviados em remessa gerada.
  O rótulo diz "X de Y títulos, Z aguardando retorno". O CNAB aceita e rejeita **por título**, não por arquivo.
- `sispag_valor_aceito`: soma de `lote_pagamento_item.valor` dos títulos aceitos.
- A janela é a semana em que a **remessa foi gerada** (`encerrado_em`). O aceite que chega depois
  recalcula aquela semana, o que é coerente com a ADR-0052 (série recalculada, não remendada).

## Perguntas abertas

- **P0 (ground truth, ao vivo):** o `fin052` devolve o detalhe (com `flpCod`/`itsCodSeq`) de um `.RET`
  que a Columbia já processou nativamente? Validar com as 2 remessas aceitas de 21–25/09 antes de
  codar o job. Se não devolver, a fonte passa a ser a baixa no `fin010`/status do lote nativo `fin015`.
- **P1:** % por título (proposta) ou por arquivo de remessa?
- **P2:** semana da geração (proposta) ou do retorno?
- **P3:** o R$ é o snapshot do item ou o valor pago que volta no `.RET`?

## Atualização 2026-09-30 (handoff após PR #97 / v0.46.0 / ADR-0055)

- **A fatia `sync-retorno-sispag` não é mais necessária.** O cron `sincronizar-lotes-sispag` (#97)
  grava `lote_pagamento_item.situacao` ∈ AGENDADO | PAGO | REJEITADO | SEM_RETORNO. Em 30/09 ele
  ainda não tinha rodado em produção: 13 itens em `REMESSA_GERADA` (R$ 10.964,07), todos com
  `situacao` NULL. Conferir contagem antes de medir.
- **P0 respondido** (29/09, conferido à mão): o fin052 devolve detalhe do `.RET` processado
  nativamente, filtrando por código de evento. O `.RET` traz só BD "PAGAMENTO AGENDADO"; a baixa
  veio depois, manual (borderô 22320). Aceite e pagamento são momentos e fontes diferentes.

## Decisões P1–P3 (usuário, 2026-09-30)

- **P1: % por título.** "X de Y títulos aceitos, Z aguardando retorno".
- **P2: semana da geração da remessa** (`remessa_execucao.encerrado_em`); aceite tardio recalcula.
- **P3: aceito = `situacao` ∈ {AGENDADO, PAGO}; R$ = `lote_pagamento_item.valor`** (snapshot).
