# Regis-Review follow-ups — sispag-lotes-vencimento-mover (ADR-0064)

> Run `docs/regis-review/2026-10-06-1506-sispag-lotes-vencimento-mover/`. **P0 = 0.** Nada abaixo
> foi implementado neste ciclo (P1/P2/P3 → inbox). Os achados de revisão de design/padrão que eram
> baratos já entraram no commit `1ea71cb` (lote manual vazio é descartado, plural, diálogo não fecha
> durante o salvamento, motivo do bloqueio no `aria-label`) e um teste da origem cancelada.

## P1

- **testability — SQL novo sem teste em Postgres real.** `loteComprometidoComTitulo`,
  `listTitulosEmLotesComprometidos` (`ANY($status)`), `removerItemDeRascunho` (`DELETE … USING`) e
  `cancelarSeVazio` (`NOT EXISTS`) só são exercitados com repo mockado. Escrever teste de integração
  no padrão `*.integration.test.ts` (CI já roda Postgres).
- **testability — atomicidade/corrida do `mover` só simulada.** Rollback do DELETE da origem quando o
  INSERT no destino falha não é exercitado de verdade.

## P2

- **availability/fault-tolerance — corrida com `finalizar`.** O lock é por título; `finalizarLote` não
  o toma. O destino não é revalidado como RASCUNHO dentro da transação (pré-existente), e o DELETE da
  origem não trava a linha do lote (`FOR UPDATE`). Janela pequena; considerar `SELECT … FOR UPDATE` no
  lote origem/destino dentro da transação.
- **fault-tolerance/security — auditoria fora da transação.** `moverTitulo` (e a origem cancelada) só
  vai para `LogService` depois do commit. Padrão pré-existente do serviço; avaliar trilha persistida.
- **performance — `listTitulosEmLotesComprometidos` lê todo o histórico** de lotes FINALIZADO/
  REMESSA_GERADA a cada carga do painel. Restringir aos títulos ativos da carteira (JOIN em
  `titulo_a_pagar`) / `DISTINCT ON`.
- **performance/fault-tolerance — criação do lote manual é 1 + N chamadas** (sem idempotência; duplo
  clique pode criar dois lotes — o botão fica desabilitado durante a criação). Endpoint em lote
  avaliado e rejeitado na ADR-0064 por causa das re-leituras no Conexos; revisitar se a latência
  incomodar.
- **integrability — sem teste de contrato** do payload 409 `TITULO_EM_LOTE_COMPROMETIDO` e do
  `loteComprometido` do painel (tipo do front escrito à mão).
- **deployability — ordem de deploy.** Front novo com back antigo descarta `mover` (Zod não-estrito) e
  a analista recebe o 409 antigo. Subir o backend antes do frontend.
- **modifiability — `LotePagamentoService` (651 LOC) e `LotePagamentoRepository` (1144 LOC)** seguem
  acima do alvo; extrair o mover para um método/serviço próprio quando o arquivo for tocado de novo.

## P3

- `incluirTitulo` acumula três caminhos (comprometido / incluir / mover) — `moverTitulo` separado.
- Sem métrica para `TitleInCommittedBatchError` / conflitos de versão.
- Regra de agrupamento sem flag; rollback = redeploy. Horizonte 7d segue constante (o teto de 25 saiu na revisão pós-QA).
- 409 expõe `loteId`/`status` do lote comprometido (relevante só quando houver escopo por filial).
- Movimentos cruzados simultâneos entre dois lotes podem gerar deadlock; o Postgres aborta um lado.

## Domínio (em aberto, não é achado técnico)

- `RETORNADO` fora do conjunto comprometido de propósito (ADR-0064 D4): como um item rejeitado sai do
  lote retornado para um lote novo.
- ~~D2: "sem lote extra"~~ — resolvido no QA: sem teto, boletos / resto sempre separados.
- ~~"Selecionar todos" reaplica filial + busca por conta própria (`filtrarComoAba`)~~ — resolvido
  no rebase do PR #109 (2026-10-07): o `useTabelaFiltro` expõe `filtrados` e o "todos" usa essa lista,
  com os filtros de data e de boleto; `filtrarComoAba` removido.
