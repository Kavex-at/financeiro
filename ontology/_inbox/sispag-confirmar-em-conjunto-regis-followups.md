# sispag-confirmar-em-conjunto — follow-ups do Regis-Review (ADR-0080)

Run: `docs/regis-review/2026-10-29-1628-sispag-confirmar-em-conjunto/` (REPORT.md, KANBAN.md).
Score 7,5; **P0: 0** (nada re-entra no loop). 32 cards: P1 4 · P2 18 · P3 10. Não implementados aqui.

## P1

1. **[fault-tolerance-1] Decisões do conjunto sem ledger de ajuste após restart.** A fila de ajustes do
   conjunto é em processo (`agendarEmSequencia`); `retomarPendentes` só varre `listarNaoTerminais`.
   Restart com a fila cheia deixa decisões `CONFIRMADA` com Δ de centavos sem ledger; hoje a saída é o
   "tentar novamente" por título (`POST /sispag/ajustes-centavos/tentar-novamente`). O confirmar
   individual tem a mesma janela, em milissegundos; o conjunto a alonga ao tamanho da fila. Proposta:
   varredura que encontra `CONFIRMADA` elegível à I18a sem ledger e enfileira (ou abrir a intenção no
   ledger dentro da transação da linha). Junta com [cents-queue-durability] e [performance-2].
2. **[security-1] Rate limiter amplificado 30×.** O conjunto usa o mesmo `limiteDecisaoBoleto` do
   confirmar individual; um pedido carrega até 30 confirmações. Proposta: cobrar N slots por N linhas
   ou balde próprio (junta com [security-4]).
3. **[deployability-1] Kill-switch próprio da rota em conjunto** (`SISPAG_CONFIRMACAO_EM_CONJUNTO_ENABLED`),
   em vez de só o `SISPAG_LIVE_WRITE_ENABLED` global (que desliga o ajuste, não a confirmação).
4. **[testability-1] Teste de integração do `confirmar-em-conjunto`** em Postgres (estilo
   `GrupoBoletoService.integration.test.ts`): hoje a prova de ponta a ponta foi manual, num clone
   descartável da cópia de PRD.

## P2 / P3

Ver KANBAN.md. Destaques: métrica de duração e recusas por `conjuntoId` ([availability-3],
[deployability-3]); runbook em `DEPLOY.md`; trilha durável das linhas `RECUSADA` ([security-2]);
`Idempotency-Key` no POST ([fault-tolerance-2]); snapshot único de lotes por conjunto ([performance-1]);
timeout no `fetch` do front ([fault-tolerance-3]); teto HTTP 200 → 30 ([security-3]).

## Fora do Regis (achado no QA manual, ambiente local)

- **A cópia local de PRD perde `pes_cod`.** Abrir a tela do SISPAG contra o stub do Conexos reingeriu a
  carteira e gravou `pes_cod = ''` em ~2 mil títulos ativos (o stub não devolve o credor). Sem credor,
  a I15s não ancora nada e a confirmação em conjunto fica vazia. Foi o que esvaziou a âncora na cópia
  compartilhada em 2026-10-28 12:26. Não afeta PRD; afeta toda medição local. Corrigir o stub (ou não
  sobrescrever `pes_cod` com vazio na ingestão).
- **Emenda da I18a(4)** (renegociar automaticamente a faixa centavos + 1..5 dias): segue como PR próprio,
  decisão do Yuri (follow-up P1 do ADR-0079).
