---
qa: Performance
qa_slug: performance
run_id: 2026-10-06-1356
agent: qa-performance
generated_at: 2026-10-06T14:30:00-03:00
scope: backend
score: 5.5
findings_count: 5
cards_count: 4
---

# Performance — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG | Define a modalidade TED/PIX de um item em lote RASCUNHO, ou finaliza o lote | `LotePagamentoService.atualizarModalidadeItem` / `finalizarLote` → `VerificacaoTedPixService.verificarItens` → `ConexosSispagClient.listTitulosParaDuplicidade` (fin064) | Requisição HTTP síncrona no Express (Render), Conexos com p99 de 2–10s | A verificação reaproveita a leitura da filial e responde sem reler o ERP inteiro a cada clique | p95 da troca de modalidade ≤ 2s; leituras fin064 por lote ≤ 1 por filial por janela de reuso; 0 timeouts de proxy |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Leituras de fin064 por troca de modalidade TED/PIX | 1 leitura completa da filial (todas as páginas) por clique | ≤ 1 por filial por janela de reuso | ❌ | `LotePagamentoService.ts:181-183`, `VerificacaoTedPixService.ts:122,210` (o `Map` de leituras vive só dentro de uma chamada de `verificarItens`) |
| Tamanho de página e teto de páginas do fin064 | 1000 linhas/página, no máximo 50 páginas (50k linhas), sequencial | Pagina em paralelo ou filtra por favorecido no servidor | ⚠️ | `ConexosSispagClient.ts:112-114,507-523` |
| Filtro por favorecido no servidor | Ausente; `listTitulosFavorecidoParaDuplicidade` lê tudo e filtra em memória | Filtro `pesCod#EQ` no ERP, se existir | ⚠️ | `ConexosSispagClient.ts:535-544` (gap Q3 citado no código) |
| Leitura fin064 por filial em `finalizarLote` | 1 por filial distinta (memoizada em `Map`) | 1 por filial | ✅ | `VerificacaoTedPixService.ts:119-122,175-178` |
| Queries ao Postgres por item verificado | `findByPesCod` + 1 transação com vários writes, em loop sequencial | Mesmo, ou `findByPesCods` em lote | ⚠️ | `VerificacaoTedPixService.ts:~283-300` |
| Índices das tabelas novas | 7 índices (únicos parciais e por lote/estado) nas migrations 0076–0078 | Colunas de WHERE cobertas | ✅ | `grep INDEX migrations/007[6-8]*.sql` |
| Job semanal de perfil de canal: duração máxima | `timeout-minutes: 45`, cron `17 6 * * 0` (domingo) | Fora do horário de uso | ✅ | `.github/workflows/calcular-perfil-canal.yml:26,36` |
| Job semanal: leituras fin095 | Sequencial por conta × fatia de 30 dias; sem teto de conta ou fatia | Teto e paralelismo limitado | ⚠️ | `PerfilCanalService.ts:151-181` |
| Job semanal: leituras fin010 baixas | Paralelismo limitado por `bounded.run` (`PARALELO_BAIXAS`) | Limitado | ✅ | `PerfilCanalService.ts:200-204` |
| Dependências runtime backend | 16 | ≤ 15 | ⚠️ | `_shared-metrics.md` (a feature não adicionou dependência pelo que se vê na lista de arquivos; `package.json` aparece no delta) |
| Volume real de títulos fin064 por filial em PRD | ⚠️ **Não medível localmente**. Requer leitura de PRD, e o orquestrador proibiu consultas ao Conexos. Recomendação: o job `probe-duplicidade-titulos.ts` já existe, então rodar com `count` apenas e registrar o número. | — | ⚠️ | — |
| Latência real da troca de modalidade | ⚠️ **Não medível localmente**. Recomendação: log de duração em `verificação TED/PIX concluída`. | — | ⚠️ | — |
| Cold start e bundle Lambda | N/A, o runtime é Express/Render e não há `infra/` | — | N/A | CLAUDE.md |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | Perfil de canal é semanal e não por requisição | ✅ presente | `calcular-perfil-canal.yml:26` |
| Limit Event Response | Cada troca de modalidade dispara a verificação inteira, sem debounce | ❌ ausente | `LotePagamentoService.ts:181-183` |
| Prioritize Events | N/A: não há fila de prioridades neste fluxo | N/A | — |
| Reduce Overhead | Leitura memoizada por filial dentro de uma rodada; cache de cadastro (`novoCache`) por rodada. Nada entre requisições. | ⚠️ parcial | `VerificacaoTedPixService.ts:119-122`, `DestinoPagamentoResolver.ts:67-69` |
| Bound Execution Times | Teto de 50 páginas e `timeout-minutes: 45` no job. A verificação síncrona na rota não tem orçamento de tempo. | ⚠️ parcial | `ConexosSispagClient.ts:114` |
| Increase Resource Efficiency | Filtro por favorecido em memória; recorte `titDtaVencimento#GE` aplicado no servidor | ⚠️ parcial | `ConexosSispagClient.ts:505,535-544` |
| Increase Resources | N/A: sem infra gerenciável neste repo | N/A | — |
| Increase Concurrency | Páginas do fin064 em série; baixas fin010 com paralelismo limitado | ⚠️ parcial | `ConexosSispagClient.ts:507`, `PerfilCanalService.ts:200` |
| Maintain Multiple Copies of Computations | N/A | N/A | — |
| Maintain Multiple Copies of Data | Sem cache de fin064 entre requisições. O `perfil_canal_fornecedor` local já é cópia materializada do Conexos, bom. | ⚠️ parcial | `PerfilCanalFornecedorRepository.ts:54-62` |
| Bound Queue Sizes | N/A: sem fila | N/A | — |
| Schedule Resources | Cron do job escolhido fora das janelas de outros jobs que leem o ERP | ✅ presente | `calcular-perfil-canal.yml:18-19` |
| Cache strategy | Cache só por rodada; não há TTL | ❌ ausente | ver F-performance-1 |
| Index discipline | Índices criados junto das tabelas novas | ✅ presente | migrations 0076–0078 |

## 4. Findings

### F-performance-1: Cada troca de modalidade TED/PIX relê a fin064 inteira da filial, de forma síncrona na requisição HTTP

- **Severidade**: P1
- **Tactic violada**: Maintain Multiple Copies of Data / Reduce Overhead / Limit Event Response
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.ts:181-183`; `src/backend/domain/service/sispag/VerificacaoTedPixService.ts:119-122,191-215`; `src/backend/domain/client/ConexosSispagClient.ts:501-532`
- **Evidência (objetiva)**:
  ```
  const leituras = new Map<number, LeituraFilial>();   // vive só dentro de verificarItens
  ...
  await this.verificacao.verificarItens(input.loteId, { itens: [chave] });  // por clique
  for (pagina = 1; pagina <= DUPLICIDADE_MAX_PAGINAS(50); ...)  // 1000 linhas/página
  ```
- **Impacto técnico**: o custo de uma troca é de ⌈N/1000⌉ chamadas sequenciais ao Conexos, até 50. Com p99 de 2–10s por chamada, o teto teórico é de 100–500s de bloqueio, acima do timeout de proxy do Render (~100s). Preencher a modalidade de um lote com M itens custa M leituras completas. Falha de leitura vira `PENDENTE` (falha fechada, correto), mas o analista só descobre depois. O `find` do item próprio usa a mesma leitura, então o custo não diminui para um único item.
- **Impacto de negócio**: a tela de montagem de lote fica lenta ou trava justamente no passo de revisão obrigatória, e cada clique carrega o ERP compartilhado com os outros crons e o robô (sessão única, ver memória de sessões Conexos).
- **Métrica de baseline**: 1 leitura completa de fin064 por clique (teto 50 chamadas). **Volume real em PRD não medido**: o N de títulos por filial com vencimento ≥ 2026-01-01 não foi coletado. A severidade é P1 e não P0 por falta desse número. Medir com o probe (só `count`) antes de decidir o tamanho do cache.

### F-performance-2: Filtro por favorecido em memória, sem tentar o filtro no servidor

- **Severidade**: P2
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `src/backend/domain/client/ConexosSispagClient.ts:535-544`
- **Evidência (objetiva)**:
  ```
  return (await this.listTitulosParaDuplicidade(filCod, desde)).filter((t) => t.favorecido === alvo);
  ```
- **Impacto técnico**: traz até 50k linhas para usar poucas. O detector precisa da filial toda (duplicidade por número de nota/valor entre favorecidos), então o filtro por favorecido só serve a chamadores que não precisam disso. Verificar se há chamadores reais de `listTitulosFavorecidoParaDuplicidade`.
- **Impacto de negócio**: tráfego e memória desnecessários, sem incidente direto.
- **Métrica de baseline**: até 50.000 linhas por chamada (teto do código); média real não medida.

### F-performance-3: Páginas da fin064 lidas em série, sem orçamento de tempo total

- **Severidade**: P2
- **Tactic violada**: Bound Execution Times / Increase Concurrency
- **Localização**: `src/backend/domain/client/ConexosSispagClient.ts:507-523`
- **Evidência (objetiva)**: laço `for` com `await` por página; `runWithRetry` por página, sem deadline global.
- **Impacto técnico**: o retry por página multiplica a latência no pior caso. A rota HTTP não tem teto e depende do timeout do proxy.
- **Impacto de negócio**: erro 502 do proxy com o lote em estado ambíguo (modalidade gravada, verificação incompleta). Isso é seguro (falha fechada no finalizar), mas ruim de operar.
- **Métrica de baseline**: ≤ 50 chamadas seriais; deadline global ausente.

### F-performance-4: Verificação serial item a item, com leitura de perfil e transação por item

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/backend/domain/service/sispag/VerificacaoTedPixService.ts:118-132,~283-300`
- **Evidência (objetiva)**: `for (const item of alvo) { await lerFilial; await verificarItem }` e dentro `perfilRepo.findByPesCod` + `withTransaction`.
- **Impacto técnico**: um lote de K itens TED/PIX gera K leituras de perfil e K transações, sem paralelismo. A leitura do cadastro (cmn025) é deduplicada por `cache` de rodada, o que mitiga a parte cara. O custo em Postgres é pequeno perto do fin064.
- **Impacto de negócio**: marginal, soma-se à latência do `finalizarLote`.
- **Métrica de baseline**: K × (1 SELECT + 1 transação). Sem medição de K típico.

### F-performance-5: Job semanal lê extrato sem teto de contas nem de fatias

- **Severidade**: P3
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/backend/domain/service/sispag/PerfilCanalService.ts:151-181`; `.github/workflows/calcular-perfil-canal.yml:36`
- **Evidência (objetiva)**: laço duplo conta × fatia de 30 dias, `await` serial. A janela vem de `config`. O workflow protege com `timeout-minutes: 45`.
- **Impacto técnico**: o job roda aos domingos, então não compete com usuário, mas usa a sessão Conexos compartilhada. O estouro de 45 min mata o job no meio. A falha parcial é registrada por `falhou` (contagem e etapa), o que é bom.
- **Impacto de negócio**: perfil de canal defasado, o que só afeta o alerta de canal habitual (não bloqueia, por I13i).
- **Métrica de baseline**: nº de contas × nº de fatias; não medido (requer execução em PRD). Duração real do job: ⚠️ não medível localmente, ver `job_run` no painel de operação.

## 5. Cards Kanban

### [performance-1] Reaproveitar a leitura da fin064 entre cliques (cache curto por filial) e medir o volume real

- **Problema**
  > Cada troca de modalidade TED/PIX relê a fin064 da filial inteira (até 50 chamadas seriais) dentro da requisição HTTP. O `Map` de leituras só vive durante uma chamada.

- **Melhoria Proposta**
  > Primeiro rodar o `probe-duplicidade-titulos` só para obter o `count` por filial (não rodado nesta revisão). Depois criar um cache em memória por filial com TTL curto (por exemplo 60–120s) em `ConexosSispagClient` ou num `FilialTitulosCache` injetável, com invalidação ao finalizar. Falha de leitura nunca vai para o cache (preserva I13b, falha fechada). No `finalizarLote`, ignorar o cache (leitura fresca) para não aprovar sobre dado velho. Alternativa: verificar em lote ao final da revisão, em vez de por clique.

- **Resultado Esperado**
  > Leituras de fin064 por lote editado: M (um por item) → 1 por filial dentro do TTL. p95 da troca de modalidade: medir (baseline) → ≤ 2s.

- **Tactic alvo**: Maintain Multiple Copies of Data
- **Severidade**: P1
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Leituras fin064 por troca: 1 completa → 0 dentro do TTL
  - p95 da rota de modalidade: a medir → ≤ 2s
- **Risco de não fazer**: com volume maior em PRD, a revisão obrigatória do lote passa a estourar timeout e sobrecarrega a sessão Conexos compartilhada.
- **Dependências**: medir o `count` real de fin064 por filial (probe).

### [performance-2] Dar um orçamento de tempo à leitura da fin064 e paginar com paralelismo limitado

- **Problema**
  > A leitura serial de até 50 páginas não tem deadline global. Em lentidão do ERP, a rota excede o timeout do proxy e deixa a verificação incompleta.

- **Melhoria Proposta**
  > Deadline global (por exemplo 20s) em `listTitulosParaDuplicidade` com erro tipado que vira `PENDENTE`. Depois da página 1, que dá o `count`, buscar as demais com `bounded.run` (paralelismo 3–4, o mesmo utilitário do `PerfilCanalService`). Cuidado com o limite de sessão do Conexos.

- **Resultado Esperado**
  > Tempo da leitura completa para N=10 páginas: ~10 × p50 → ~3 × p50. Nenhuma requisição acima de 25s.

- **Tactic alvo**: Bound Execution Times / Increase Concurrency
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Duração máxima da leitura: sem teto → ≤ 25s
  - Páginas em voo: 1 → ≤ 4
- **Risco de não fazer**: 502 intermitente na tela de lote quando o Conexos degradar.
- **Dependências**: nenhuma.

### [performance-3] Remover ou usar o filtro de favorecido no servidor para `listTitulosFavorecidoParaDuplicidade`

- **Problema**
  > O recorte por favorecido lê a filial inteira e filtra em memória.

- **Melhoria Proposta**
  > Confirmar quem chama o método. Se ninguém, apagar. Se houver chamador, testar em ambiente seguro (não rodar contra Conexos nesta revisão) se o fin064 aceita `pesCod#EQ`, e passar o filtro no corpo.

- **Resultado Esperado**
  > Linhas trazidas por chamada de recorte: até 50.000 → apenas as do favorecido (ordem de dezenas).

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Linhas por chamada: ≤ 50.000 → ≤ 100
- **Risco de não fazer**: código morto ou caro fica como armadilha para o próximo chamador.
- **Dependências**: confirmar o campo de filtro no ERP.

### [performance-4] Instrumentar duração da verificação e do job de perfil, e agrupar leituras de perfil

- **Problema**
  > Nenhum volume ou duração real foi medido: a feature não registra quanto tempo a verificação leva nem quantas linhas do fin064 leu. Sem isso as decisões dos cards 1 e 2 são palpite.

- **Melhoria Proposta**
  > Acrescentar `duracaoMs`, `linhasFin064` e `paginas` em `data` do log `verificação TED/PIX concluída`. No job de perfil, logar nº de contas, fatias e borderôs. Opcionalmente trocar `findByPesCod` por busca em lote de `pes_cod` antes do laço (F-performance-4) e limitar a janela de contas/fatias.

- **Resultado Esperado**
  > Percentis p50/p95 de duração disponíveis nos logs após 1 semana em PRD; baseline medido em vez de estimado. Leituras de perfil por finalização: K → 1.

- **Tactic alvo**: Manage Sampling Rate / Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-4, F-performance-5
- **Métricas de sucesso**:
  - Campos de duração no log: ausente → presente
  - SELECTs de perfil por finalização: K → 1
- **Risco de não fazer**: degradação silenciosa sem número para priorizar.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: só o delta (modo `--quick`). Não rodei nada contra o Conexos nem o build do frontend. Bundle e cold start de Lambda são N/A (runtime Express/Render).
- Nenhum P0: o ponto conhecido (leitura total da fin064 por clique) é real, mas o volume de PRD não está medido, então P1 e não P0. O teto de código é 50.000 linhas.
- O pool e o timeout do axios de `ConexosBaseClient` não foram verificados (`PostgreeDatabaseClient.ts` não está nesse caminho). Cruzar com Availability e Fault Tolerance (timeout, sessão única do Conexos).
- Cross-QA: card 1 interage com Fault Tolerance (cache jamais guarda falha, I13b) e Security (dado velho na verificação de duplicidade).
