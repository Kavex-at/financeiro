# Kanban — Regis-Review reduzido 2026-10-19 (`sispag-ajuste-centavos`, ADR-0073)

Ordem: severidade, depois risco operacional. Detalhe de cada card na seção do QA.

| # | Card | Sev. | Estado | Origem |
|---|---|---|---|---|
| 1 | Rodar a Task 13 (GT3 `.REM` 30 dias, GT4 pendentes) e fixar `MODO_GUARDA_VALOR_J` antes do merge | P0 | portão de merge (Task 13, go do maintainer) | fault-tolerance-1 |
| 2 | Provar `its*` no fin064 e tornar o sinal de lote nativo fail-closed antes de `shadow` | P1 | follow-up | integrability-1 |
| 3 | Reabrir ledger encerrado (cancelado/recusado) por ação humana auditada | P1 | parcial (retry não mente mais) | fault-tolerance-2 |
| 4 | Fila durável/painel para `indeterminado` | P1 | parcial (bloqueia `finalizarLote`) | fault-tolerance-3 |
| 5 | Alerta de ledger não terminal por idade + reconciliação com fin070/fin064 | P1 | follow-up | fault-tolerance-4 |
| 6 | Provar em HML o cancelamento (G3) e os status `fbaVldStatus`/`ftbVldStatus` | P2 | follow-up (Task 15) | integrability-2, -3 |
| 7 | Unificar leitura do fin064 e gravar fixtures de contrato | P2 | follow-up | integrability-3, testability-2 |
| 8 | Logar linha descartada por `safeParse` | P2 | parcial (soma não é mais parcial) | integrability-4 |
| 9 | Advisory lock: conexão dedicada por fluxo inteiro; unlock garantido | P2 | follow-up | fault-tolerance-5 |
| 10 | Corrida `finalizarLote` × início do ajuste | P2 | follow-up | fault-tolerance-6 |
| 11 | Scrub de código formatado (com pontos/espaços) em mensagens | P2 | follow-up | security-1 |
| 12 | Varredura `retomar` sem guarda de concorrência | P2 | follow-up | security-2 |
| 13 | Teste de contrato ledger fake × repositório real | P2 | follow-up | testability-1 |
| 14 | Escopo por filial nas rotas de ajuste | P3 | follow-up | security-3 |
| 15 | Runbook de kill-switch e de recuperação para a frente | P3 | follow-up | security-4, fault-tolerance-7 |
| 16 | Seam de id no repositório; dividir o service por etapa | P3 | follow-up | testability-3, -4 |
