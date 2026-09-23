# Regis-Review — follow-ups de `sispag-reter-titulo-lote`

Executado em 2026-09-22 sobre o delta da branch `fix/sispag-reter-titulo-lote` (ADR-0050), rebaseado
sobre `main @3864b76` (v0.40.0, ADR-0049). Escopo restrito aos arquivos tocados, 8 QAs +
consolidador. Relatório: `docs/regis-review/2026-09-22-2209-sispag-reter-titulo-lote/REPORT.md` e
`KANBAN.md`.

**Score geral 8,1/10** — Availability 8,3 · Deployability 8,2 · Integrability 8,6 · Modifiability 8,4
· Performance 6,5 · Fault Tolerance 8,6 · Security 8,2 · Testability 7,9.

**Nenhum P0.** Nada foi remediado neste ciclo; tudo abaixo é follow-up e **não** foi implementado.
18 cards (2 P1 / 9 P2 / 7 P3), já deduplicados pelo consolidador — 3 fusões cross-QA registradas:
- `[migration-0062-integration]` absorve os cards paralelos de Availability, Deployability e Testability
  (mesmo integration test da 0062 contra Postgres real).
- `[audit-trail-lote]` absorve os cards paralelos de Fault Tolerance e Security (mesma causa raiz:
  auditoria só em `stdout`).
- `[mttr-rollback-history]` absorve os cards paralelos de Availability e Deployability (mesmo
  histórico real de MTTR de rollback).

## P1

### P1 — `performance-1` — Tirar o refresh do painel (Conexos) do caminho de escrita das ações de lote
`page.tsx:428-432` trocou `await recarregarLotes()` por `await Promise.all([recarregarLotes(),
recarregarPainel()])` em `acaoLote`. `recarregarPainel` faz fan-out `listLotes` no Conexos
(`CONEXOS_FANOUT_LIMIT=4`) e devolve ~410 KB de carteira — agora bloqueia toda ação de lote local
(finalizar, cancelar, reabrir, marcar retorno, trocar conta pagadora, trocar modalidade, remover
item), inclusive as 100% locais. Alternativa 1 (S): `recarregarPainel()` não-bloqueante.
Alternativa 2 (M): rotas devolvem `emLote`/`retencaoFormacao` atualizados junto com o `lote`, e o
frontend faz patch otimista.

### P1 — `security-1` — Aplicar `assertUserCanActOnFilial` às rotas de retenção do SISPAG
As 2 rotas novas (`POST .../retirar-do-lote`, `DELETE .../retencao`) validam `role='admin'` mas
não o escopo de filial — 0/11 rotas mutantes SISPAG usam o guard, contra 8/10 em `recebimentos.ts`.
O próprio `filialAuthz.ts:19` já pedia paridade com SISPAG antes deste delta. Um admin de uma
filial pode reter/liberar título de outra trocando `filCod` na URL. Esforço S para as 2 rotas do
delta; M para as 9 rotas mutantes pré-existentes do mesmo arquivo (fora do escopo, mas mesma
correção mecânica).

## P2

- **`availability-1`** — trocar `Promise.all` por `Promise.allSettled` no `SispagPainelService.montarPainel`
  para as leituras ornamentais (`retencaoRepo.listAtivas`, `runRepo.findLatestSuccessFinishedAt`);
  hoje a nova leitura da retenção derruba o painel inteiro quando o Postgres saturar
  transitoriamente. O padrão já existe no mesmo arquivo (`linhasDigitaveisDoLote`,
  `contarExecucoesParadas`). S.

- **`migration-0062-integration`** — integration test da migration 0062 e do
  `RetencaoFormacaoRepository` contra Postgres real (`postgres:17-alpine` já em CI). Cobrir
  índice único parcial (segunda ativa rejeitada, reter de novo após `removido_em IS NOT NULL`),
  `ON CONFLICT DO NOTHING`, CHECK de `char_length` em code points (500 emojis passa; 501 falha),
  pareamento de `removido_em`/`removido_por`/`motivo_remocao`. Reusa script `test:sql` já pronto.
  Card mesclado — resolve F-availability-1, F-deployability-1, F-testability-2 simultaneamente. S.

- **`audit-trail-lote`** — persistir a trilha de auditoria das transições de lote em tabela
  consultável (`sispag_lote_evento` com `lote_id`, `acao`, `ator`, `criado_em`, `dados` jsonb),
  gravada dentro da MESMA transação de cada `withTransaction` do `LotePagamentoService`. Estende o
  padrão que o delta introduziu para `titulo_retencao_formacao` às 5 transições restantes
  (`criarLote`, `finalizarLote`, `cancelarLote`, `atualizarContaPagadora`,
  `atualizarModalidadeItem`). Card mesclado — resolve F-fault-tolerance-2 e F-security-2. M.

- **`integrability-1`** — extrair `SispagLeituraConexosFacade` (4 clients Conexos diretos → 1),
  reduzindo `SispagPainelService` de 14 para ≤11 colaboradores injetados. Fazer ANTES do próximo
  `/feature-new` de Nexxera. M.

- **`integrability-2`** — Zod validando `loteRascunho` e `retencaoFormacao` em `GET /sispag/painel`
  (0% de cobertura Zod no frontend antes/depois do delta; `body as T` sem checagem). S para os
  campos do delta; M para o arquivo inteiro.

- **`modifiability-1`** — Split de `LotePagamentoRepository.ts` (633 LOC / 26 métodos, primeiro
  arquivo do repo a atravessar o teto de 600 LOC) em `LoteRepository` + `ItemLoteRepository`.
  Fazer ANTES da Fatia 3 SISPAG. M.

- **`modifiability-3`** — extrair as abas de `src/frontend/app/sispag/page.tsx` (1229 LOC, 3º
  maior arquivo do repo depois do delta) em `TitulosTab`, `LotesCandidatosTab`,
  `LotesFinalizadosTab`, `RetornosTab`, `IngestaoBloco`. Precedente que funciona:
  `recebimentos/page.tsx` (727 LOC). Fazer ANTES da Fatia 4. L.

- **`security-3`** — alarme agregado para 401/403 (hoje: `console.warn`, sem contador nem
  threshold). Dobra de valor quando combinado com `security-1` (também cobre
  `FILIAL_NAO_AUTORIZADA`). M.

- **`testability-1`** — testar `RetirarDoLoteDialog.tsx` (reset por chave, limite 500, trim antes
  de `onConfirmar`, aria-live) e `RetencaoBadge.tsx` (foco por teclado, aria-label). Padrão pronto
  em `GerarRemessaDialog.test.tsx` (222 LOC) da feature-irmã ADR-0049. S.

## P3

- **`mttr-rollback-history`** — registrar 1 linha por rollback real no runbook (`data`, `hora do
  deploy quebrado`, `hora do /health 200`, `cumpriu ≤5min?`). Card mesclado — cobre a lacuna que
  Availability e Deployability apontaram do mesmo ângulo. S.

- **`fault-tolerance-2`** — fault injection Postgres durante `withTransaction.COMMIT` para
  confirmar o `ROLLBACK` do driver `pg` sob falha de I/O real. Depende de infra testcontainers
  (hoje ausente). Sinergia com `migration-0062-integration`. M.

- **`fault-tolerance-3`** — desabilitação síncrona no `RetirarDoLoteDialog` (`useRef` antes do
  primeiro `await`) para eliminar o tick de render em que duplo-clique pode disparar 2 requests.
  Backend já neutraliza; o custo é só UX (toast espúrio). S.

- **`modifiability-2`** — centralizar `MOTIVO_RETENCAO_MAX = 500` em `SispagInterface.ts` (backend)
  e comentar as 3 fontes (Zod, frontend, CHECK 0062) apontando para ela. XS.

- **`performance-2`** — `LIMIT` defensivo em `RetencaoFormacaoRepository.listAtivas()` (convenção
  já usada no mesmo serviço para `TITULOS_CAP=5000`). S.

- **`performance-3`** — política de purge unificada para as 3 tabelas soft-delete de decisão local
  (`titulo_retencao_formacao`, `cliente_filtro`, `permuta_excecao_manual`). Decisão de produto/dados,
  não só técnica. M.

- **`testability-3`** — anexar cobertura % por diretório do delta ao `_shared-metrics.md` do
  próximo Regis-Review (`--coverage` já roda no CI, só recortar) e ratchetar o `coverageThreshold`
  do `domain/service/` para "medido menos 2 pontos". XS.

## Fora do Regis, mas pendente desta feature

- **DesignSystemReviewer** apontou drift do template: `DateFormatter` de `@/shared/lib/datetime`
  não existe no repo (referência do doc de design system). Não bloqueou a feature; corrigir o doc
  ou provisionar o helper num próximo `/feature-tweak` de UI SISPAG.
- **`retencaoRepo.listAtivas()`** entra num `Promise.all` de 4 leituras em `SispagPainelService`
  — o card `availability-1` (P2 acima) endereça, mas o padrão herdado (`Promise.all` sem
  `allSettled`) já existia com 3 leituras. Se o próximo `/feature-tweak` do painel adicionar uma
  5ª, revisitar o card antes de mesclar.
- **9 rotas mutantes pré-existentes** de `routes/sispag.ts` sem `assertUserCanActOnFilial`
  (fora do escopo do delta, mas mesma correção mecânica que `security-1`). Abrir como
  `/feature-tweak sispag-filial-authz` dedicado.
