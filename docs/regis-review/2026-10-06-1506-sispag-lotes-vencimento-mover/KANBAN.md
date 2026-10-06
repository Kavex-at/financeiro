# KANBAN — sispag-lotes-vencimento-mover

| Ordem | Card | Prioridade | Esforço |
|---|---|---|---|
| 1 | testability-1 — testes de integração dos 4 métodos SQL novos | P1 | M |
| 2 | testability-2 — concorrência/rollback do mover em Postgres | P1 | M |
| 3 | availability-1 — revalidar/travar lote destino e origem dentro da tx | P2 | S |
| 4 | fault-tolerance-2 — corrida finalizar × incluir sem mover | P2 | S |
| 5 | fault-tolerance-1 / security-1 — auditoria persistida do mover | P2 | M |
| 6 | performance-1 — limitar `listTitulosEmLotesComprometidos` à carteira ativa | P2 | S |
| 7 | integrability-1 — teste de contrato do 409 e de `loteComprometido` | P2 | S |
| 8 | deployability-1 — backend antes do frontend | P2 | S |
| 9 | fault-tolerance-3 — criação 1+N sem idempotência | P2 | S |
| 10 | modifiability-1 — extrair o mover do serviço | P2 | M |
| 11 | performance-2 — endpoint em lote (rejeitado na ADR-0064; revisitar com medição) | P2 | M |
| 12 | testability-3 — testes de componente do diálogo/hook | P2 | M |
| 13 | availability-2, deployability-2, integrability-2, modifiability-2, modifiability-3, security-2, testability-4, availability-3 | P3 | S/M |
