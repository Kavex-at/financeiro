# KANBAN — `sispag-boletos-dda` (PR #85)

Ordenado por prioridade, depois esforço. Detalhe de cada card (Problema / Melhoria Proposta /
Resultado Esperado) na seção do QA de origem. Execução reduzida: só Security, Integrability e
Performance.

| # | Card | Prioridade | Esforço | QA | Título |
|---|---|---|---|---|---|
| 1 | performance-1 **+ security-2** | **P1** | M | Performance, Security | Paginar/filtrar no servidor o `GET /sispag/boletos-dda?escopo=todos` (hoje 24.137 linhas com código de barras num só GET) |
| 2 | security-1 | P2 | S | Security | Persistir cada sincronização DDA em `boleto_dda_sync_run` (+ `GET …/runs`), como `pagamento_ingestao_run` |
| 3 | integrability-1 | P2 | S | Integrability | Reusar `ConexosBaseClient.paginate` no `ConexosDdaClient` e propagar `onCapHit` |
| 4 | integrability-3 | P2 | S | Integrability | Telemetria de truncamento silencioso na paginação DDA (resolvido junto com #3) |
| 5 | performance-2 | P2 | S | Performance | Cachear a consolidação de `BoletoDdaService.listar` por `sincronizadoEm` |
| 6 | performance-3 | P2 | S | Performance | Pré-computar o texto de busca do `BoletosDdaTab` (hoje recalculado por tecla, 24k linhas em "todos") |
| 7 | performance-6 | P2 | S | Performance | Confirmar (e, se preciso, ativar) compressão HTTP no caminho SISPAG |
| 8 | integrability-2 | P2 | M | Integrability | Contrato Boletos DDA como fonte única entre back e front (fim do espelho manual) |
| 9 | integrability-4 | P2 | M | Integrability | Segregar sessão Conexos por caminho (ou reduzir concorrência) nos syncs DDA |
| 10 | performance-4 | P3 | S | Performance | Pular releitura de arquivos DDA já cancelados no sync |
| 11 | performance-5 | P3 | S | Performance | Trocar `idx_boleto_dda_valor` (sem uso) por índice parcial em `boleto_dda_arquivo.cancelado_em` |
| 12 | security-3 | P3 | S | Security | Alarme para admin chamando `escopo=todos` repetidamente |
| 13 | security-4 | P3 | L | Security | JWT do `localStorage` para cookie HttpOnly/SameSite (pré-existente; link para o backlog) |

**Totais:** 14 cards (13 após fundir performance-1 e security-2) — P0 0 · P1 1 · P2 9 · P3 4.
