# sispag-situacao-lotes — follow-ups do Regis-Review

**Run:** `2026-10-22-1647-sispag-situacao-lotes`
**Relatório:** `docs/regis-review/2026-10-22-1647-sispag-situacao-lotes/REPORT.md`
**Kanban:** `docs/regis-review/2026-10-22-1647-sispag-situacao-lotes/KANBAN.md`
**Branch:** `worktree-sispag-situacao-lotes` · PR C do plano `sispag-situacao-pagamento` · ADR-0076 · regra `prontidao-lote` I20

Score consolidado **7.1** (ponderado nos 3 QAs rodados: Fault Tolerance 1.3 · Modifiability 1.2 · Testability 1.0; soma 3.5). 13 cards: P0=0 · P1=3 · P2=9 · P3=1.
**Review reduzido por desenho** — 3 de 8 QAs rodados (testability, modifiability, fault-tolerance). Os cinco não rodados (availability, deployability, integrability, performance, security) não foram medidos nesta rodada e não implicam ausência de dívida nesses eixos; o CLAUDE.md manda rodá-los quando um PR tocar os artefatos correspondentes.
Por Inviolable Rule #11, como **não há P0**, nenhum card re-entrou no loop deste PR. Todos os 13 estão aqui.

## P0 — status

_Nenhum card P0 nesta rodada. Rule #11 não dispara re-loop._

## P1 (3) — não implementados

| Card | QA | Esforço | Uma linha |
|---|---|---|---|
| `finalizar-idempotency` (MERGED) | FT + Testability | M | `Idempotency-Key` opcional em `/sispag/lotes/:id/finalizar` + tabela leve de dedupe (TTL 24h) + teste de rota com 2 chamadas concorrentes + teste cliente `finalizarEmSequencia([L1, L1])`; substitui `testability-2` + `fault-tolerance-1` do agent output |
| `modifiability-1` | Modifiability | M | Dividir `LotePagamentoService.ts` (956 LOC, aviso Biome 17) em agregado + `LoteFinalizacaoVerificador` + `IncluirTituloEmLote`; alvo ≤ 600 LOC |
| `modifiability-2` | Modifiability | L | Quebrar `src/frontend/app/sispag/page.tsx` (1.905 LOC, 46 imports) em roteador de abas + 4 páginas de aba; alvo ≤ 400 LOC |

## P2 (9) — não implementados

| Card | QA | Esforço | Uma linha |
|---|---|---|---|
| `modifiability-4` | Modifiability | S | Centralizar `chaveDe`/`chaveItem` (11 cópias em `domain/service/sispag/`) em `domain/core/chaveTitulo.ts` |
| `modifiability-5` | Modifiability | S | Encapsular `lerItensAoVivo` em `LeitorTitulosAoVivo` injetável — pré-requisito do `fault-tolerance-2` |
| `modifiability-3` | Modifiability | M | Gerar `src/frontend/lib/sispag.ts` a partir do contrato BE (codegen ou workspace); 1 fonte de verdade |
| `fault-tolerance-2` | Fault Tolerance | M | Deadline agregado (`AbortController` 15s) + concorrência bounded (5) em `lerItensAoVivo`; par com `modifiability-5` |
| `fault-tolerance-3` | Fault Tolerance | S | Botão "Parar" no diálogo bulk + `AbortSignal` em `finalizarEmSequencia` |
| `testability-1` (reajustado) | Testability | S | Caso novo cobrindo mix no caminho `conexos.getTituloAPagar` (resolve/reject) combinado com bloqueio por status em outro item do mesmo lote — assert `BatchHasBlockedItemsError.details.itens` por ordem/identificacao. **Downgrade P1→P2** aplicado na consolidação (ver §C2) |
| `testability-3` | Testability | S | 2 testes de rota em `routes/sispag.test.ts` garantem `prontidao` no payload de `GET /lotes` e `GET /lotes/:id` |
| `testability-4` | Testability | S | 2 casos em `ProntidaoLoteService.test.ts` cobrem propagação de `fontesIndisponiveis` do service → resolver (hoje mock sempre `[]`) |
| `testability-5` | Testability | M | Dividir `LotePagamentoService.test.ts` (1.517 LOC, 95 `it()`, 7 áreas) em 3 arquivos + `__fixtures__/`; superset do `modifiability-3` do review anterior |

## P3 (1) — não implementados

| Card | QA | Esforço | Uma linha |
|---|---|---|---|
| `fault-tolerance-4` | Fault Tolerance | S | Flag `prontidao: { degradado: true, motivo? }` quando o catch amplo de `comProntidao` dispara + banner na aba "Lotes candidatos" |

## Cross-cutting (consolidados no REPORT.md)

- **CC-1 — Idempotência & reentrância no finalize (merge canônico).** `finalizar-idempotency` (merged `testability-2` + `fault-tolerance-1`). 1 PR dedicado.
- **CC-2 — Hotspots herdados que o delta continuou a inchar.** `modifiability-1` + `modifiability-2` + `testability-5`. Gating: `modifiability-1` antes da próxima guarda; `modifiability-2` quando entrar 5ª aba/filtro.
- **CC-3 — Caminho crítico do finalize precisa de abstração de I/O.** `modifiability-5` + `fault-tolerance-2` em sequência (extrai, depois aplica política).
- **CC-4 — Fronteira HTTP + caminhos degradados sem assert explícito.** `testability-3` + `fault-tolerance-4` como 1 PR.
- **CC-5 — Contrato BE↔FE duplicado + helpers copiados.** `modifiability-4` (S, antes) + `modifiability-3` (M, precisa decisão arquitetural).

## Correções de premissa aplicadas na consolidação

Registradas porque as seções individuais dos agents mantêm os textos originais:

1. **C1** — F-modifiability-6 (ontologia `prontidao-lote.md` com `related_files` incompleto) **foi corrigido pelo orquestrador antes desta consolidação**; marcado como **RESOLVIDO** no REPORT §7 e **não gera card**. Nenhum item em P2/P3 referencia essa dívida nesta rodada.
2. **C2** — F-testability-1 teve a premissa parcialmente reajustada. O agent file (`testability.md` §4) afirma que "os quatro testes aplicam a MESMA resposta a TODOS os itens". Verificação direta em `src/backend/domain/service/sispag/LotePagamentoService.test.ts:715-767` mostra que DOIS testes já cobrem mix em `avaliarVivos` por item: `'item BLOQUEADO recusa com TODOS os itens bloqueados'` usa `[bloqueada, pronta]` (linha 717) e `'fora da carteira e fonte caída'` usa `[{resultado:'FORA_DA_CARTEIRA'}, {...pronta, fontesIndisponiveis:['BOLETO']}]` (linha 755). O gap REAL remanescente é mais estreito: **mix no caminho da leitura Conexos — um item com `getTituloAPagar` resolvendo, outro rejeitando (`mockResolvedValueOnce` + `mockRejectedValueOnce`) — combinado com um bloqueio por status em terceiro item do mesmo lote**. Priorizado como **P2 (S)** em vez do P1 original. Card `testability-1` reescrito no KANBAN.md para refletir esse recorte.
3. **C3** — `testability-2` e `fault-tolerance-1` **foram merged** no card `finalizar-idempotency` (P1, M). Mesma causa-raiz (`Idempotency-Key` + teste de reentrância no `/finalizar`); o merge preserva as três entregas (header no handler, teste de rota, teste client-side) num único PR dedicado.
4. **C4** — Review reduzido por desenho. Cinco QAs (availability, deployability, integrability, performance, security) **não foram executados** nesta rodada por escolha de escopo, não por ausência de dados; isso está explicitado na §0 do REPORT.md e aqui no cabeçalho. Reviews futuros devem cobrir esses eixos quando um PR tocar os artefatos correspondentes.

## QAs não rodados nesta rodada

- `availability` — não rodado (feature não altera job de ingestão, EventBridge, scheduler nem endpoint monetário novo).
- `deployability` — não rodado (sem mudança de pipeline, Render hook, Terraform ou SSM).
- `integrability` — não rodado (nenhum contrato novo com Conexos; `fin064` e `com298` já existiam; paridade BE↔FE coberta em Modifiability).
- `performance` — não rodado (sem endpoint de alta carga novo; latência da releitura `fin064` entrou como débito em FT/Modifiability — ver `fault-tolerance-2`, `modifiability-5`).
- `security` — não rodado (nenhuma mudança em AuthZ/AuthN; reuso de `SISPAG_EXECUTAR` existente).
