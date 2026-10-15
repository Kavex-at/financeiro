# Medição — desfecho da sugestão por título (ADR-0072)

Job: `src/backend/jobs/medir-desfecho-sugestao-boleto.ts --alvo=prd` (SOMENTE LEITURA: só `SELECT` pelos
repositórios + motor puro; sessão com `default_transaction_read_only = on` conferida por `SHOW`; sem
Conexos; sem `LogService`; saída só com contagens e chaves de título, nunca barras nem linha digitável).
O banco do `.env` local é remoto (classificado `prd` pelo job); nada foi gravado.

## Antes (motor atual, commit base `6bc4e89`; Task 1)

- Execução: 2026-10-15T21:41:20Z (data civil BRT 2026-10-15)
- `sincronizadoEm` do pool DDA: 1792096865104 (epoch ms)
- Títulos ativos: 1290 · boletos no pool: 25802
- **Elegíveis** (BOLETO, ativo, não pago, `tem_boleto != true`, com vencimento): **917**
- Com linha de sugestão: **234** (25,5 %) · **Sem linha: 683 (74,5 %)**

| Resultado do motor | Títulos |
|--------------------|---------|
| FORTE | 202 |
| VENCIDO_INFORMATIVO | 29 |
| ATENCAO (ancorado) | 3 |
| CONHECIDO / CONFIRMADA / ORFA | 0 |

| Filial | Elegíveis | Sem linha |
|--------|-----------|-----------|
| 1 | 29 | 16 |
| 2 | 530 | 390 |
| 3 | 2 | 2 |
| 4 | 127 | 103 |
| 5 | 18 | 15 |
| 6 | 208 | 156 |
| 7 | 3 | 1 |

## Depois (motor novo; Task 16)

_(pendente)_
