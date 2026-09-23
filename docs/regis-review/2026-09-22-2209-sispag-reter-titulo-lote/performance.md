---
qa: Performance
qa_slug: performance
run_id: 2026-09-22-2209-sispag-reter-titulo-lote
agent: qa-performance
generated_at: 2026-09-22T22:09:00-03:00
scope: backend+frontend (delta only)
score: 6.5
findings_count: 4
cards_count: 3
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao Financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista revisando um lote candidato na aba "Lotes candidatos" (troca a forma de pagamento título a título, ou finaliza/cancela/reabre o lote) | Cada clique dispara uma escrita local (Postgres) seguida — desde este delta — de um refetch completo de `GET /sispag/painel` | `LoteCard.tsx` → `acaoLote` (`page.tsx`) → `SispagPainelService.montarPainel` (fan-out Conexos `listLotes` por filial, `CONEXOS_FANOUT_LIMIT=4`) | Horário comercial, Conexos com p99 documentado de 2–10s (contexto da missão), lote com dezenas de itens | A troca de modalidade/ação do lote deveria depender só do Postgres (rápido, sub-segundo) — não deveria reintroduzir latência externa no caminho de escrita local | P95 do round-trip de uma ação de lote (clique → spinner desliga): antes do delta apenas Postgres (~100–300ms); depois do delta, bloqueado também pelo fan-out Conexos do painel |

Nota de escopo: este é o cenário dominante do delta. O resto da feature (repositório `RetencaoFormacaoRepository`, migration 0062, rotas `retirar-do-lote`/`retencao`) é escrita local pura (I1: nenhuma chamada ao Conexos), bem dentro do orçamento de latência.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Nº de fetches Conexos-dependentes (`GET /sispag/painel`) disparados por 1 ação de lote (finalizar/cancelar/reabrir/marcar retorno/trocar conta/trocar modalidade/remover item) | 0 → **1** (introduzido neste delta) | 0 (ação de lote não deveria depender do Conexos) | ❌ | `src/frontend/app/sispag/page.tsx:428-432` (`acaoLote`: `await Promise.all([recarregarLotes(), recarregarPainel()])`, antes só `recarregarLotes()`); chamado de `LoteCard.tsx:140-142,280,288,332,340,377,462` |
| Concorrência do fan-out Conexos em `montarPainel` (`listLotes` por filial) | `CONEXOS_FANOUT_LIMIT = 4` (inalterado pelo delta) | manter ≤ 4 (evita `LOGIN_ERROR_MAX_SESSIONS`, comentário do próprio código) | ✅ | `src/backend/domain/service/sispag/SispagPainelService.ts:49` |
| Payload da carteira (`titulos`) devolvida em CADA `GET /sispag/painel`, inclusive nos refreshes disparados pela ação de lote | ~410 KB / ~1511 títulos hoje (278 B/título, documentado no próprio código) | não recarregar a carteira inteira para atualizar 1 badge de retenção/lote | ⚠️ | `src/backend/domain/service/sispag/SispagPainelService.ts:29-40` (comentário `TITULOS_CAP`) |
| `RetencaoFormacaoRepository.listAtivas()` — `LIMIT` explícito | ausente | ter um teto defensivo, mesmo que hoje autolimitado pelo índice parcial | ⚠️ | `src/backend/domain/repository/sispag/RetencaoFormacaoRepository.ts:42-49` |
| Cobertura de índice para as 3 queries da tabela nova (`listAtivas`, `insertAtiva` ON CONFLICT, `liberarAtiva`) | 1 índice único parcial cobre as 3 | 1 índice cobrindo todos os acessos | ✅ | `src/backend/migrations/0062_titulo_retencao_formacao.sql:68-70` |
| Cobertura de índice para as queries de escrita em `retirarDoLote`/`removerTitulo` (`loteRascunhoComTitulo`, `removerItem`) | `idx_lote_pagamento_item_titulo(fil_cod,doc_cod,tit_cod)` + UNIQUE implícito `(lote_id,fil_cod,doc_cod,tit_cod)` (pré-existentes, migration 0023) | índice cobrindo o predicado da query | ✅ | `src/backend/migrations/0023_lote_pagamento.sql:42,48-49`; queries em `LotePagamentoRepository.ts:282-296,371-379` |
| N+1 SQL/Conexos no código novo do delta (`RetencaoFormacaoRepository`, `retirarDoLote`, `removerItemDoLote`) | 0 sítios | 0 | ✅ | leitura manual de `LotePagamentoService.ts:293-360,464-491` — 1 SELECT/UPDATE por operação, sem loop com chamada de rede/DB dentro |
| Loop sequencial de chamadas Conexos por título selecionado (`incluirTitulo` dentro de `for` em `criarLoteComSelecionados`) | N chamadas sequenciais (1 `getTituloAPagar` + 1 transação por título) | fan-out limitado (padrão já usado em `modalidadesDisponiveisDoLote`, `CONEXOS_FANOUT_LIMIT`) | ⚠️ **pré-existente, fora do delta** | `src/frontend/app/sispag/page.tsx:392-401` (código idêntico ao `origin/main`, confirmado via `git diff origin/main...HEAD`) |
| Bundle/cold start (Lambda) | não aplicável — runtime atual é Express/Render (CLAUDE.md, "Estado Atual vs. Alvo") | — | ⚠️ **Não medível/não aplicável**: infraestrutura Lambda é estado-alvo, ainda não existe (`infra/` não existe neste repo). O delta adiciona 2 classes de erro + 1 repositório + poucos componentes React — peso desprezível mesmo no cenário-alvo. |

## 3. Tactics — Cobertura no nf-projects (delta)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — delta não lida com telemetria/amostragem | N/A | — |
| Limit Event Response | `busy`/`salvandoRetencao` desabilitam os botões durante a chamada (evita duplo-clique), mas não limitam a FREQUÊNCIA com que cada clique dispara o refetch caro do painel | ⚠️ parcial | `page.tsx:132,144`, `LoteCard.tsx` (`disabled={busy}` em todos os botões) |
| Prioritize Events | N/A — não há fila/evento priorizável neste delta (Express síncrono) | N/A | — |
| Reduce Overhead | Índice parcial único cobre leitura+escrita da retenção com 1 estrutura só (evita scan da tabela inteira); mas `acaoLote` agora soma overhead do fan-out Conexos a toda ação de lote, mesmo quando a ação não precisa de dado do Conexos (ex.: trocar modalidade é 100% local) | ⚠️ misto (ganho no schema novo, perda no `acaoLote`) | `0062_titulo_retencao_formacao.sql:68-70`; `page.tsx:428-432` |
| Bound Execution Times | Nenhum timeout específico foi adicionado para o refetch de painel disparado por `acaoLote`; ele herda o timeout (se houver) do client Conexos usado por `montarPainel` — fora do escopo deste delta (ver Fault Tolerance/Availability) | ⚠️ parcial — cross-QA | `page.tsx:428-432` chama `recarregarPainel` sem timeout próprio no frontend |
| Increase Resource Efficiency | `adicionarItens` (multi-row INSERT) já existia e não foi tocado; a escrita nova (`insertAtiva`/`liberarAtiva`) é 1 linha por operação, compatível com a granularidade da ação do usuário (1 título por vez) | ✅ | `RetencaoFormacaoRepository.ts:55-90` |
| Increase Resources | N/A — sem mudança de infraestrutura/dimensionamento neste delta | N/A | — |
| Increase Concurrency | Reaproveita `BoundedConcurrency`/`CONEXOS_FANOUT_LIMIT=4` já existente; delta não altera o mecanismo, mas aumenta a FREQUÊNCIA com que ele é acionado (cada ação de lote agora entra no fan-out) | ⚠️ parcial | `SispagPainelService.ts:49,116-120` |
| Maintain Multiple Copies of Computations | N/A neste delta | N/A | — |
| Maintain Multiple Copies of Data | `titulo_a_pagar` já é a cópia local (cache) da carteira do Conexos (pré-existente); a retenção não duplica dado do ERP, é estado 100% local, coerente com a doutrina do ADR-0050 (comentário na migration explica por que NÃO é coluna do espelho) | ✅ | `0062_titulo_retencao_formacao.sql:10-14` |
| Bound Queue Sizes | N/A — não existe fila (SQS) neste repo hoje | N/A | — |
| Schedule Resources | N/A neste delta | N/A | — |
| **Cold start budget** | N/A — runtime é Express/Render, não Lambda (estado-alvo ainda não implantado) | N/A | CLAUDE.md, seção "Estado Atual vs. Alvo" |
| **Cache strategy** | Delta não introduz nova leitura de SSM; não se aplica | N/A | — |
| **Index discipline** | Índice parcial único novo cobre as 3 queries da tabela nova; índices pré-existentes de `lote_pagamento_item` cobrem as queries de escrita reaproveitadas por `retirarDoLote` | ✅ | ver tabela de métricas acima |
| **Bundle leanness** | 2 classes de erro + 1 repositório + poucos componentes React; nenhuma dependência nova em `package.json` (confirmado em `_shared-metrics.md`: "não medido nesta rodada (sem dependência nova no delta)") | ✅ | `_shared-metrics.md:51` |

## 4. Findings (achados)

### F-performance-1: `acaoLote` reintroduz latência do Conexos no caminho de escrita local do lote

- **Severidade**: P1
- **Tactic violada**: Reduce Overhead / Bound Execution Times
- **Localização**: `src/frontend/app/sispag/page.tsx:422-432`; disparado por `src/frontend/app/sispag/components/LoteCard.tsx:140-142,280,288,332,340,377,462`
- **Evidência (objetiva)**:
  ```diff
  -      await recarregarLotes()
  +      // O painel também muda: a linha do título mostra o lote e a retenção (ADR-0050).
  +      await Promise.all([recarregarLotes(), recarregarPainel()])
  ```
  `recarregarPainel` chama `GET /sispag/painel` → `SispagPainelService.montarPainel`, que faz fan-out `listLotes` no Conexos (`CONEXOS_FANOUT_LIMIT=4`, comentário do próprio código: "Evita o burst que pressiona o pool de sessões do Conexos") e devolve a carteira inteira (~410 KB documentados). Isso agora roda a CADA clique em finalizar, cancelar, reabrir, marcar retorno, trocar conta pagadora, trocar modalidade de UM item, ou remover UM item do lote — inclusive ações que são 100% locais (ex.: `atualizarModalidadeItem` não toca o Conexos, mas o refresh que a segue, sim).
- **Impacto técnico**: o botão fica com spinner ativo (`busy=true`) até o MAIOR dos dois fetches resolver. Como `recarregarLotes()` é Postgres-only (rápido) e `recarregarPainel()` depende de N chamadas ao Conexos (p99 documentado de 2–10s no contexto da missão), uma ação que antes do delta era quase instantânea passa a ficar refém da latência/instabilidade do ERP externo. Um lote com 20 itens, revisado modalidade a modalidade, dispara 20 fan-outs completos do painel.
- **Impacto de negócio**: a tela de montagem de lote (etapa que precede o envio de pagamentos, Frente II) fica visivelmente mais lenta e "travada" durante justamente o fluxo de trabalho mais repetitivo do analista (ajustar item a item antes de finalizar). Em pico de Conexos lento, a sensação é de tela travada — sem indicação de que a causa é uma leitura desnecessária do ERP, não a escrita que o analista pediu.
- **Métrica de baseline**: 0 fetches Conexos-dependentes por ação de lote antes do delta → 1 depois (medido no diff, `page.tsx:428-432`); payload devolvido em cada um desses fetches: ~410 KB (comentário `TITULOS_CAP`, `SispagPainelService.ts:34-36`).

### F-performance-2: `RetencaoFormacaoRepository.listAtivas()` sem `LIMIT` explícito

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead (guard-rail ausente)
- **Localização**: `src/backend/domain/repository/sispag/RetencaoFormacaoRepository.ts:42-49`
- **Evidência (objetiva)**:
  ```sql
  SELECT fil_cod, doc_cod, tit_cod, motivo, marcado_por, marcado_em
  FROM titulo_retencao_formacao
  WHERE removido_em IS NULL
  ```
  Sem `LIMIT`. O índice parcial único `uq_titulo_retencao_formacao_ativa (fil_cod, doc_cod, tit_cod) WHERE removido_em IS NULL` mantém a query eficiente hoje (o índice só contém linhas ativas — no máximo 1 por título, bounded pelo tamanho da carteira, hoje ~1511 títulos), mas não há teto explícito como o `TITULOS_CAP=5000` que o mesmo arquivo de serviço já usa para `titulo_a_pagar`.
- **Impacto técnico**: baixo hoje (tabela nova, volume pequeno, índice parcial evita scan da tabela inteira). Risco cresce se a definição de "retenção ativa" mudar no futuro (ex.: múltiplas retenções por título) sem que alguém reavalie este ponto.
- **Impacto de negócio**: nenhum imediato — é dívida defensiva, não um problema observado.
- **Métrica de baseline**: 1 `selectMany` sem `LIMIT` na tabela nova; 0 no restante do delta.

### F-performance-3: Sem política de purge/arquivamento para `titulo_retencao_formacao`

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead (dado histórico sem TTL)
- **Localização**: `src/backend/migrations/0062_titulo_retencao_formacao.sql` (comentário linhas 16-21)
- **Evidência (objetiva)**: soft delete (`removido_em`/`removido_por`/`motivo_remocao`) sem job de purge; a própria migration reconhece o padrão ("Mesmo padrão de `cliente_filtro` (0013) e `permuta_excecao_manual` (0059)") — ou seja, é uma dívida já aceita em outras tabelas do mesmo domínio, não uma novidade negativa deste delta.
- **Impacto técnico**: nenhum a curto/médio prazo — `listAtivas()` só varre a partição ativa do índice parcial, então o histórico acumulado não pesa nas leituras do painel. Pesaria em `VACUUM`/tamanho físico da tabela em horizonte de anos.
- **Impacto de negócio**: nenhum hoje; é a mesma dívida já assumida conscientemente pelo time em tabelas irmãs.
- **Métrica de baseline**: não medível localmente (não há dado de produção neste repo). Recomendação: revisar junto com o mesmo trabalho de arquivamento já pendente para `cliente_filtro`/`permuta_excecao_manual`, se/quando esse trabalho for priorizado.

### F-performance-4: Loop sequencial de chamadas ao Conexos ao criar lote manual com múltiplos títulos selecionados

- **Severidade**: P2 — **pré-existente, fora do delta** (nunca P0/P1 para esta feature)
- **Tactic violada**: Increase Concurrency
- **Localização**: `src/frontend/app/sispag/page.tsx:392-401` (`criarLoteComSelecionados`)
- **Evidência (objetiva)**: `for (const t of selTitulos) { await incluirTitulo(...) }` — N chamadas HTTP sequenciais, cada uma disparando `getTituloAPagar` no Conexos dentro do backend (`LotePagamentoService.incluirTitulo`, linha 195). Confirmado idêntico em `origin/main` via `git diff origin/main...HEAD -- src/frontend/app/sispag/page.tsx` (nenhuma mudança nesse trecho neste delta).
- **Impacto técnico**: ao selecionar muitos títulos de uma vez para um lote manual, o tempo de criação escala linearmente com N × latência Conexos, sem o fan-out limitado que o mesmo arquivo já usa em `modalidadesDisponiveisDoLote`.
- **Impacto de negócio**: fricção de UX em lotes manuais grandes; não é uma regressão desta feature.
- **Métrica de baseline**: não medível localmente (depende da latência real do Conexos); não gera card nesta rodada — sinalizado para follow-up separado, fora do escopo do ADR-0050.

## 5. Cards Kanban

### [performance-1] Tirar o refresh do painel (Conexos) do caminho de escrita das ações de lote

- **Problema**
  > Desde este delta, toda ação de lote (finalizar, cancelar, reabrir, marcar retorno, trocar conta pagadora, trocar modalidade de item, remover item) passou a aguardar também um `GET /sispag/painel` completo — que inclui fan-out ao Conexos e ~410 KB de carteira — antes de liberar o botão. Ações que são 100% locais (ex.: trocar modalidade de um item) ficam reféns da latência do ERP externo (`page.tsx:428-432`).

- **Melhoria Proposta**
  > Tactic alvo: **Reduce Overhead** / **Bound Execution Times**. Duas alternativas, da mais barata à mais completa:
  > 1. (S) Fazer `recarregarPainel()` rodar em paralelo sem bloquear `busy`/o spinner do botão — atualizar `painel` quando resolver, sem segurar a UI. O usuário já vê o `lote` atualizado (resposta da própria ação); o badge de retenção/lote na aba "Títulos" pode chegar um instante depois.
  > 2. (M) Fazer as rotas de mutação do lote (`finalizar`, `atualizarModalidadeItem`, `removerTitulo`, etc.) devolverem, junto com o `lote`, os dados mínimos que hoje só vêm do painel (ex.: se o título alvo ficou `emLote`/`retencaoFormacao`), e o frontend faz um patch otimista local em vez de re-buscar a carteira inteira.
  > Tocar: `src/frontend/app/sispag/page.tsx` (`acaoLote`), opcionalmente `LotePagamentoService`/rotas em `src/backend/routes/sispag.ts` se for a alternativa 2.

- **Resultado Esperado**
  > Nº de fetches Conexos-dependentes por ação de lote local: 1 → 0 (ou, no mínimo, não-bloqueante). P95 do round-trip de uma troca de modalidade (clique → spinner desliga): hoje potencialmente múltiplos segundos (herda o p99 de 2–10s do Conexos) → alvo < 300ms (mesmo perfil de antes do delta, Postgres-only).

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P1
- **Esforço estimado**: S (alternativa 1) / M (alternativa 2)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Fetches Conexos por ação de lote local: 1 → 0
  - P95 de `atualizarModalidadeItem` (clique → UI liberada): não medido localmente (depende do Conexos) → alvo < 300ms, independente da saúde do Conexos
- **Risco de não fazer**: em dias de Conexos lento (p99 documentado até 10s), a tela de montagem de lote — o fluxo mais repetitivo da Frente II — fica praticamente inutilizável para revisão item a item, e ninguém vai suspeitar do painel como causa.
- **Dependências**: nenhuma.

### [performance-2] Adicionar teto defensivo em `RetencaoFormacaoRepository.listAtivas()`

- **Problema**
  > A query de retenções ativas não tem `LIMIT`, ao contrário da convenção já usada no mesmo serviço (`TITULOS_CAP=5000` para a carteira). Hoje é inofensivo (índice parcial mantém o conjunto pequeno), mas é uma exceção silenciosa à convenção do arquivo.

- **Melhoria Proposta**
  > Tactic alvo: **Reduce Overhead**. Adicionar `ORDER BY marcado_em DESC LIMIT $N` (ex. 10.000) em `listAtivas`, com um comentário explicando que é guard-rail, não limite de trabalho — mesmo padrão do comentário de `TITULOS_CAP`.

- **Resultado Esperado**
  > `RetencaoFormacaoRepository.listAtivas()` ganha teto explícito, coerente com o restante do arquivo; nenhuma mudança de comportamento observável hoje (volume atual bem abaixo do teto).

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - `selectMany` sem `LIMIT` no arquivo: 1 → 0
- **Risco de não fazer**: baixo — só materializa se a semântica de "retenção ativa" mudar para permitir múltiplas por título sem revisar este ponto.
- **Dependências**: nenhuma.

### [performance-3] Revisar em conjunto a política de purge das tabelas de decisão local (`titulo_retencao_formacao`, `cliente_filtro`, `permuta_excecao_manual`)

- **Problema**
  > `titulo_retencao_formacao` soma-se a um padrão já existente de tabelas soft-delete sem purge. Isoladamente inofensivo (o índice parcial isola a leitura quente do histórico), mas o time já reconhece a dívida nas tabelas irmãs — não faz sentido resolver uma tabela de cada vez sem uma política comum.

- **Melhoria Proposta**
  > Tactic alvo: **Reduce Overhead**. Não é ação isolada desta feature — recomenda-se um item de backlog único cobrindo as 3 tabelas (`cliente_filtro`, `permuta_excecao_manual`, `titulo_retencao_formacao`): decidir horizonte de retenção do histórico (`removido_em IS NOT NULL`) e, se necessário, um job de arquivamento.

- **Resultado Esperado**
  > Política de retenção documentada (mesmo que a decisão seja "não arquivar, monitorar tamanho"); se decidir arquivar, tamanho físico das 3 tabelas com teto conhecido em vez de crescimento indefinido.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: M (2–5d, cobre as 3 tabelas)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Política de purge documentada: ausente → existente (ADR ou nota em `ontology/`)
- **Risco de não fazer**: baixo/médio em horizonte de anos — custo de armazenamento e `VACUUM`, não latência de leitura (a leitura quente já está isolada pelo índice parcial).
- **Dependências**: decisão de produto/dados sobre horizonte de retenção — não é só técnica.

## 6. Notas do agente

- Escopo: avaliei o delta (`git diff origin/main...HEAD`) e o entorno imediato que ele modifica; não reavaliei `PostgreeDatabaseClient` (pool sizing), `bootstrapAppContainer` por request, nem os demais N+1/timeout de clients Conexos pré-existentes — já cobertos (ou a cobrir) por rodadas anteriores/outras QAs.
- F-performance-1 é cross-QA com **Availability**/**Fault Tolerance**: o mesmo `recarregarPainel` sem timeout próprio no frontend significa que uma falha/lentidão do Conexos durante uma ação de lote agora também deixa o botão "preso" — vale conferir se `apiFetch`/o client HTTP do frontend tem timeout, e se a Availability já sinalizou isso para os clients Conexos usados por `montarPainel`.
- Índices (F-performance-2) são cross-QA com **Modifiability**: a convenção "schema documentado nas migrations, sem `infra/` Terraform" já é avaliada lá; aqui só confirmei que a migration 0062 documenta a razão de cada índice/constraint.
- Não consegui medir latência real (sem acesso a Conexos/Postgres de produção neste ambiente) — todas as métricas de latência acima são derivadas do código (constantes, comentários dos próprios autores) e do contexto documentado da missão (Conexos p99 2–10s), não de profiling ao vivo.
