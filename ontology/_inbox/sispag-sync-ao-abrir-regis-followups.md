# sispag-sync-ao-abrir — follow-ups do Regis-Review (2026-10-13-1518)

Nenhum P0/P1. Nada abaixo foi implementado neste ciclo. Fonte: `docs/regis-review/2026-10-13-1518/`
(`REPORT.md`, `KANBAN.md` com os 23 cards).

| Card | Prio | Finding | Nota |
|---|---|---|---|
| availability-1 (= performance-1) | P2 | Passada L11 sem prazo máximo sob a trava | Nenhum timeout explícito achado nos clients Conexos (busca rápida). Mais urgente da lista. |
| fault-tolerance-4 | P2 | Cron sai 0 com trava ocupada: trava presa vira skip silencioso | Casar com o item acima |
| deployability-1 | P2 | Sem kill switch do gatilho de abertura (TTL ≤ 0 volta ao default) | S |
| security-1 / integrability-2 | P2 | Botão forçado sem teto por ator; ordem carteira → lotes só no frontend | S |
| availability-3 (= fault-tolerance-2) | P2 | Sem alerta de idade da última passada bem-sucedida | |
| fault-tolerance-1 / availability-2 | P2 | Run `running` morta nunca fechada; abertura diz `em_andamento` até 10 min | |
| integrability-3 | P2 | Resposta lida com `as`, sem Zod nem teste de contrato | |
| testability-1..3 | P2 | Fronteiras exatas sem teste; relógio por parâmetro; trava só por mock | |
| modifiability-1 (= integrability-1) | P2 | Política stale-while-revalidate duplicada (carteira × lotes) | |
| deployability-2 | P2 | Trava ocupa 1 das 5 conexões do pool por ~25 s | |
| modifiability-2 | P2 | `lib/sispag.ts` 1807 LOC, `page.tsx` 1582, `routes/sispag.ts` 1270 | migração proporcional |
| — (orquestrador) | P3 | `SincronizacaoLoteService.sincronizarLote` sem rota desde ADR-0066; os testes de decisão por lote ainda o usam | Migrar os testes para `sincronizarTodos` e remover |
| P3 restantes | P3 | 410 sem critério de remoção; `RUN_PRESA_MS` fixo; log de erro sem assert; TTL não rechecado sob a trava | ver KANBAN |
