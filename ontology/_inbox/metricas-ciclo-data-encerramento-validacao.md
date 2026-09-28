# Métricas do ciclo — antes/depois da data pelo encerramento (ADR-0051)

**Status:** aberto — a consulta não foi rodada contra produção nesta sessão (acesso de leitura ao
banco de produção negado ao agente em 2026-09-28). Rodar antes do merge, ou logo depois do deploy, e
colar o resultado aqui e no report do ciclo em que o delta entra.

## O que conferir

1. Semana `2026-09-11 18:00 → 2026-09-18 18:00`, Permutas R$: **0,00 → 150.061,81**.
2. Semana `2026-08-07 18:00 → 2026-08-14 18:00` (onde nasceu o id 341): perde R$ 150.061,81.
3. Semana `2026-08-14 18:00 → 2026-08-21 18:00` (onde liquidou o id 270): ganha R$ 353.004,88; a
   semana de julho onde ele nasceu fica fora da tela (antes do piso de 07/08).
4. Soma das diferenças = só as linhas cuja semana de `criado_em` ≠ semana de `atualizado_em`
   (esperado em 18/09: 2 linhas settled, R$ 503.066,69 — pode ter crescido desde então).
5. Linhas de `%`: registrar as que mudam — nenhuma delas é "chave nova".

## Consulta (read-only, roda ANTES ou DEPOIS da 0064)

Antes da migration, `encerrado_em` não existe: a consulta usa a mesma regra do backfill
(`atualizado_em` das linhas terminais), então o "depois" dela é o que a 0064 vai produzir.

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
    SELECT status, valor,
           criado_em AT TIME ZONE 'America/Sao_Paulo' AS antes,
           (CASE WHEN status IN ('settled', 'error') THEN atualizado_em
                 ELSE criado_em END) AT TIME ZONE 'America/Sao_Paulo' AS depois
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

## Resultado

_(colar aqui)_
