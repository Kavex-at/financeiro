# Métricas do ciclo — antes/depois da data pelo encerramento (ADR-0051)

**Status:** rodada contra produção em 2026-09-28 (read-only, a pedido do usuário). Resultado no fim.
Mudou o delta: a SN ficou **sem backfill** (ver "Resultado").

## O que conferir

1. Semana `2026-09-11 18:00 → 2026-09-18 18:00` (liquidação do id 341): ganha a tentativa; o R$ só
   entra se o borderô do id 341 estiver FINALIZADO no cache (gap G2).
2. Semana onde liquidou o id 270 (14/08 15:42, sexta antes das 18:00 → semana `07/08 → 14/08`):
   ganha R$ 353.004,88; a semana de julho onde ele nasceu fica fora da tela.
4. Soma das diferenças = só as linhas cuja semana de `criado_em` ≠ semana de `atualizado_em`
   (esperado em 18/09: 2 linhas settled, R$ 503.066,69 — pode ter crescido desde então).
5. Linhas de `%`: registrar as que mudam — nenhuma delas é "chave nova".

## Consulta (read-only, roda ANTES ou DEPOIS da 0064)

Antes da migration, `encerrado_em` não existe: a consulta usa a mesma regra do backfill
(`atualizado_em` das permutas terminais; SN sem backfill), então o "depois" dela é o que a 0064 vai
produzir.

```sql
BEGIN READ ONLY;

WITH janelas AS (
    SELECT g AS ini, g + INTERVAL '7 days' AS fim
    FROM generate_series(TIMESTAMP '2026-08-07 18:00', now() AT TIME ZONE 'America/Sao_Paulo',
                         INTERVAL '7 days') g
),
p AS (
    SELECT x.status, x.valor_baixado,
           x.criado_em AT TIME ZONE 'America/Sao_Paulo' AS antes,
           (CASE WHEN x.status IN ('settled', 'parcial', 'error') THEN x.atualizado_em
                 ELSE x.criado_em END) AT TIME ZONE 'America/Sao_Paulo' AS depois,
           EXISTS (SELECT 1 FROM permuta_bordero b
                    WHERE b.fil_cod = x.fil_cod AND b.bor_cod = x.bor_cod
                      AND b.bor_vld_finalizado = 1 AND b.bor_cod_estornado IS NULL) AS fin
    FROM permuta_alocacao_execucao x
    WHERE x.dry_run = false
),
s AS (
    -- SN sem backfill (ver Resultado): o "depois" histórico é o próprio `criado_em`.
    SELECT status, valor,
           criado_em AT TIME ZONE 'America/Sao_Paulo' AS antes,
           criado_em AT TIME ZONE 'America/Sao_Paulo' AS depois
    FROM solicitacao_numerario_execucao
    WHERE dry_run = false
)
SELECT j.ini AS janela_inicio,
       (SELECT COALESCE(SUM(valor_baixado), 0) FROM p
         WHERE status IN ('settled', 'parcial') AND fin AND antes  >= j.ini AND antes  < j.fim) AS perm_rs_antes,
       (SELECT COALESCE(SUM(valor_baixado), 0) FROM p
         WHERE status IN ('settled', 'parcial') AND fin AND depois >= j.ini AND depois < j.fim) AS perm_rs_depois,
       (SELECT format('%s/%s', COUNT(*) FILTER (WHERE status = 'settled' AND fin), COUNT(*)) FROM p
         WHERE antes  >= j.ini AND antes  < j.fim) AS perm_pct_antes,
       (SELECT format('%s/%s', COUNT(*) FILTER (WHERE status = 'settled' AND fin), COUNT(*)) FROM p
         WHERE depois >= j.ini AND depois < j.fim) AS perm_pct_depois,
       (SELECT COALESCE(SUM(valor), 0) FROM s
         WHERE status = 'settled' AND antes  >= j.ini AND antes  < j.fim) AS sn_rs_antes,
       (SELECT COALESCE(SUM(valor), 0) FROM s
         WHERE status = 'settled' AND depois >= j.ini AND depois < j.fim) AS sn_rs_depois,
       (SELECT format('%s/%s', COUNT(*) FILTER (WHERE status = 'settled'), COUNT(*)) FROM s
         WHERE antes  >= j.ini AND antes  < j.fim) AS sn_pct_antes,
       (SELECT format('%s/%s', COUNT(*) FILTER (WHERE status = 'settled'), COUNT(*)) FROM s
         WHERE depois >= j.ini AND depois < j.fim) AS sn_pct_depois
FROM janelas j
ORDER BY j.ini;

ROLLBACK;
```

Depois do deploy, o "depois" também sai direto da função:
`SELECT * FROM metricas.metricas_ciclo(metricas.historico_inicio(), now() AT TIME ZONE 'America/Sao_Paulo');`

## Resultado (produção, 2026-09-28)

Janelas sexta 18:00 (horário de São Paulo). R$ = só borderô FINALIZADO; `%` = concluídas/tentativas.

| Semana | Permutas R$ antes | Permutas R$ depois | Permutas % antes → depois | SN |
|---|---:|---:|---|---|
| 07/08 → 14/08 | 9.970.581,14 | **10.323.586,02** (+353.004,88, id 270) | 19/26 → 20/25 | inalterada (R$ 789.490,08; 9/9) |
| 14/08 → 21/08 | 5.336.716,58 | 5.336.716,58 | 8/8 → 8/8 | inalterada |
| 21/08 → 28/08 | 8.127.035,61 | 8.127.035,61 | 24/24 → 24/25 | — |
| 28/08 → 04/09 | 15.049.319,88 | 15.049.319,88 | 2/4 → 2/4 | — |
| 04/09 → 11/09 | 1.283.986,92 | 1.283.986,92 | 12/13 → 12/13 | — |
| **11/09 → 18/09** | **0,00** | **0,00** | sem linha → **0/1** | — |
| 18/09 → 25/09 | 0,00 | 0,00 | — | — |

Os deslocamentos de `%` em 07/08 e 21/08 são linhas `error` que passam para a semana da última falha.

**Linhas `settled` que mudam de semana:**

- Permutas: só as duas retentativas reais. Id 270 (R$ 353.004,88; nasceu 03/07, liquidou 14/08
  15:42) e id 341 (R$ 150.061,81; nasceu 10/08, liquidou 14/09 12:43).
- SN: 11 linhas (ids 28–45, R$ 1.025.490,08). **Todas** com `atualizado_em` entre 18:15:08 e
  18:15:14 de 17/08: uma escrita em lote (`nde_autorizado`/`revisao_humana` = true), não a
  liquidação. Nenhuma SN foi reexecutada de fato. **Decisão: a SN fica sem backfill** (0064 corrigida).
  O backfill por `atualizado_em` teria movido R$ 789.490,08 de 07/08 para 14/08 sem motivo.

**Por que 11–18/09 continua R$ 0,00:** o id 341 está no borderô **2466 da filial 1**, e o cache
(`permuta_bordero`, última mudança 15/09 11:07) o tem **não finalizado** (`bor_vld_finalizado = 0`).
O 2466 finalizado é o da **filial 4**, outro borderô. Pela regra G2 (2026-09-14), baixa em borderô não
finalizado é tentativa, não conclusão, e o R$ não entra. A premissa "11–18/09 vai de R$ 0,00 para
R$ 150.061,81" só vale se esse borderô for finalizado no Conexos (ou se o cache estiver defasado:
"Atualizar" na tela de Borderôs refaz a leitura).
