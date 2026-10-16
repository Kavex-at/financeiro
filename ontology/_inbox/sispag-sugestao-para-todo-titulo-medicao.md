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

Mesmo job, uma única passada: o contrato legado (`sugerir`, inalterado) e o desfecho novo
(`desfechos`) saem do MESMO snapshot — a comparação antes × depois é exata dentro da execução.
A carteira andou entre as duas execuções (a de "antes" é do início da tarde, esta da noite), então
os totais absolutos diferem ligeiramente; a comparação válida é a das colunas "legado" × "novo"
desta execução.

- Execução: 2026-10-16T00:55:35Z (data civil BRT 2026-10-15)
- `sincronizadoEm` do pool DDA: 1792111849239 (a execução "antes" foi 1792096865104; o pool tem os
  mesmos 25802 boletos nas duas)
- Títulos ativos: 1270 · boletos no pool: 25802 · **elegíveis: 894**

| Contagem (elegíveis = 894) | Legado (`sugerir`) | Novo (`desfechos`) |
|----------------------------|--------------------|--------------------|
| Com linha / desfecho | 229 (25,6 %) | **894 (100 %)** |
| Sem linha / **sem desfecho** | 665 (74,4 %) | **0** |

| Situação do título | Títulos | % |
|--------------------|---------|---|
| UNICA_SEGURA | 196 | 21,9 |
| SO_ATENCAO | 3 | 0,3 |
| AMBIGUA | 281 | 31,4 |
| SO_FRACA | 233 | 26,1 |
| SO_VENCIDA | 78 | 8,7 |
| DISPUTADA | 61 | 6,8 |
| SEM_CANDIDATO | 42 | 4,7 |
| CONFIRMADA / ORFA | 0 | 0 |
| **Soma** | **894** | 100 |

- **Limiar de ruído (Q8):** `SO_FRACA` = 26,1 % dos elegíveis (< 50 %); não para o loop. Reportado.
- As 665 linhas que faltavam no legado viram: AMBIGUA 281, SO_FRACA 233, SO_VENCIDA 78 (parte dos 30
  vencidos já tinha linha), DISPUTADA 61, SEM_CANDIDATO 42 (a soma confere com 894 − 229).
- `AMBIGUA` é a maior fatia (281): 2+ boletos seguros de mesma força para o mesmo título — padrão de
  cobrança recorrente (filial 6: 105 de 208 elegíveis). Antes sumia em silêncio; agora aparece e se
  resolve rejeitando os outros.
- Identificadores: contagem e chaves de título apenas; nada de barras nem linha digitável.

| Filial | Elegíveis | UNICA | ATENCAO | AMBIGUA | FRACA | VENCIDA | DISPUTADA | SEM_CAND |
|--------|-----------|-------|---------|---------|-------|---------|-----------|----------|
| 1 | 29 | 11 | 2 | 5 | 6 | 1 | 4 | 0 |
| 2 | 529 | 118 | 1 | 154 | 148 | 32 | 40 | 36 |
| 3 | 2 | 0 | 0 | 2 | 0 | 0 | 0 | 0 |
| 4 | 105 | 16 | 0 | 12 | 53 | 11 | 10 | 3 |
| 5 | 18 | 2 | 0 | 3 | 2 | 8 | 1 | 2 |
| 6 | 208 | 47 | 0 | 105 | 23 | 26 | 6 | 1 |
| 7 | 3 | 2 | 0 | 0 | 1 | 0 | 0 | 0 |

A linha de log `sugestao_boleto.cenario_calculado` registra `situacoes` com a mesma contagem
(`contarSituacoes` sobre os desfechos do cenário; coincide com o job quando não há órfã de título
inelegível, que é o caso desta execução).
