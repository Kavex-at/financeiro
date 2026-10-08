---
qa: Performance
qa_slug: performance
run_id: 2026-10-08-2012-favorecido-autorizado
agent: qa-performance
generated_at: 2026-10-08T20:30:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 3
---

# Performance — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG | Abre o relatório de candidatos (100 por página) ou dispara a verificação/geração de remessa de um lote com dezenas de TED/PIX | `AuthorizationCandidatesService.listar`, `AuthorizedPayeeService.verificarDestinoAutorizado`, `RemessaService.exigirFavorecidosAutorizados` | Express/Render, Conexos com teto de sessões (leituras sequenciais), Postgres | Lê o cmn025 só do necessário, uma vez por favorecido, com cache por rodada; Postgres em consulta única por lote | Relatório p95 < 5s para 50 linhas; leituras Conexos por requisição ≤ 3 × favorecidos distintos da página; 0 consultas SQL por item |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Leituras cmn025 sequenciais por página de candidatos (limite default 50, máx 100) | até 3 por favorecido x modalidade (documento, dados, chaves PIX), cache por `pesCod`: pior caso ~100 favorecidos => ordem de 200-300 chamadas seriais | ≤ 50 por página, orçamento p95 < 5s | ⚠️ | `AuthorizationCandidatesService.ts:91-95,129-130`; `http/schemas.ts:56` |
| Consultas SQL por item na verificação | 0 (`listarVigentesPorPesCods` com `ANY($pesCods)`, uma por rodada) | 0 | ✅ | `AuthorizedPayeeRepository.ts:145-155` |
| `selectMany` sem LIMIT no delta | 1 (`listarVigentesPorPesCods`, limitada pela chave parcial única: no máx 1 vigente por par => ≤ 2 x pesCods) | 0 em rotas de API | ✅ (limitada por construção) | `AuthorizedPayeeRepository.ts:151` |
| Listagem de autorizações | `LIMIT 1000` sem paginação | paginada | ⚠️ | `AuthorizedPayeeRepository.ts:138` |
| Chamadas Conexos `getTituloAPagar` por item na guarda de remessa | N sequenciais, sem cache (já existia em main, linha 1463) | N distintas com cache | ⚠️ | `RemessaService.ts:1240-1245` |
| Índices do delta | vigência única parcial `(pes_cod, modalidade)`, `(estado, solicitado_em)`, trilha `(autorizacao_id, ocorrido_em)` | cobrir WHERE | ✅ | `0080_sispag_favorecido_autorizado.sql` |
| Índice p/ filtro do relatório (`grupo_dominante`, `contagens->>'TED_PIX'`) | sem índice; tabela pequena (1 linha por fornecedor) | seq scan aceitável | ✅ (P3 se crescer) | `PerfilCanalFornecedorRepository.ts:73-82` |
| Timers manuais no delta | 0 | 0 | ✅ | grep setTimeout no delta |
| Dependências novas / bundle | nenhuma dependência nova (`package.json` só muda versão) | 0 | ✅ | `git diff` |
| Cold start / bundle Lambda | ⚠️ Não medível: runtime é Express no Render, sem `infra/` | — | — | CLAUDE.md |
| Frontend First Load JS | ⚠️ Não medível sem `next build` neste run | ≤ 200KB | — | — |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | Verificação só no momento da ação (lote/remessa); reconferência manual | ✅ | `VerificacaoTedPixService.ts`, rota `reconferir` |
| Limit Event Response | Relatório limitado a `limite<=100` e página<=1000 | ✅ | `schemas.ts:55-56` |
| Prioritize Events | N/A: sem fila nem classes de prioridade neste delta | N/A | — |
| Reduce Overhead | Cache de cmn025 por rodada (`novoCache`), pares distintos, vigentes em 1 query | ✅ | `DestinoPagamentoResolver.ts:106,248`; `AuthorizedPayeeService.ts:299-312` |
| Bound Execution Times | Sem orçamento de tempo na página de candidatos nem na guarda de remessa | ❌ | `AuthorizationCandidatesService.ts:91` |
| Increase Resource Efficiency | Leituras seriais deliberadas (teto de sessões Conexos); `Promise.all` apenas em SELECT+COUNT | ✅ | `PerfilCanalFornecedorRepository.ts:74` |
| Increase Resources | N/A: Render fixo | N/A | — |
| Increase Concurrency | Deliberadamente evitada no Conexos; SQL em paralelo onde cabe | ✅ | idem |
| Maintain Multiple Copies of Computations | N/A | N/A | — |
| Maintain Multiple Copies of Data | Cache por requisição apenas; sem cache entre requisições (intencional: destino sensível, falha fechada) | ⚠️ | `DestinoPagamentoResolver.ts:53` |
| Bound Queue Sizes | N/A: sem SQS neste delta | N/A | — |
| Schedule Resources | N/A | N/A | — |
| Index discipline | índices parciais corretos na migração 0080 | ✅ | migração |
| Cold start / bundle | sem deps novas | ✅ | package.json |

## 4. Findings

### F-performance-1: Relatório de candidatos faz até centenas de leituras Conexos seriais numa requisição GET

- **Severidade**: P1
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/backend/domain/service/sispag/AuthorizationCandidatesService.ts:91-95,129-130`
- **Evidência (objetiva)**:
  ```
  for (const perfil of perfis) { candidatos.push(await this.linha(...)) }   // linha: TED + PIX, cada um resolve() -> cmn025
  ```
  Página aceita `limite` até 100; cada favorecido faz leitura de dados + chaves PIX (+ documento). Sem timeout agregado.
- **Impacto técnico**: Com Conexos a 2-10s p99, uma página cheia pode passar de 1 min e estourar o timeout do Render/proxy; ocupa a sessão Conexos do robô e disputa o teto de sessões.
- **Impacto de negócio**: Tela de autorização lenta ou com 502; analista abandona e cadastra no escuro.
- **Métrica de baseline**: ≤ 100 favorecidos x ~2-3 chamadas = 200-300 chamadas seriais; medição real: não medível localmente.

### F-performance-2: Guarda da remessa lê o título de cada item ao vivo, sequencial e sem deduplicar

- **Severidade**: P2
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:1240-1245`
- **Evidência (objetiva)**:
  ```
  for (const item of alvo) { await this.sispag.getTituloAPagar(item.filCod, item.docCod, item.titCod).catch(() => null) }
  ```
  Padrão já existente em main (linha 1463), agora repetido por item antes de verificar pares. A verificação em seguida usa cache só entre pares; este laço não.
- **Impacto técnico**: Latência da geração de remessa cresce linear com TED/PIX do lote (N x 1-3s).
- **Impacto de negócio**: Geração de remessa de lote grande demora; janela de corte bancário apertada.
- **Métrica de baseline**: N chamadas seriais (N = itens TED/PIX do lote).

### F-performance-3: Listagem de autorizações limitada a 1000 sem paginação

- **Severidade**: P3
- **Tactic violada**: Limit Event Response
- **Localização**: `src/backend/domain/repository/sispag/AuthorizedPayeeRepository.ts:131-141`
- **Evidência (objetiva)**: `ORDER BY solicitado_em DESC ... LIMIT 1000`; filtro `estado` usa `idx(estado, solicitado_em)`, sem filtro cai em sort completo.
- **Impacto técnico**: Payload e parse Zod de 1000 linhas por GET após acumular histórico (REVOGADO/REJEITADO nunca somem).
- **Impacto de negócio**: Tela lenta em ~anos de uso.
- **Métrica de baseline**: teto 1000 linhas por resposta.

### F-performance-4: Falha de cmn025 fica memoizada no cache da rodada

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/backend/domain/service/sispag/DestinoPagamentoResolver.ts:248-255`
- **Evidência (objetiva)**: `cache.set(chave, lendo)` guarda a Promise, inclusive rejeitada; todo item do mesmo favorecido na rodada repete a falha sem retentar (falha fechada, correto, mas sem retry de transitório).
- **Impacto técnico**: Um 5xx transitório pendura todos os itens do favorecido naquela rodada.
- **Impacto de negócio**: Reexecução manual da verificação.
- **Métrica de baseline**: 0 retentativas por leitura.

## 5. Cards Kanban

### [performance-1] Limitar e orçar a leitura do cmn025 no relatório de candidatos

- **Problema**
  > O relatório lê o cmn025 de cada favorecido da página em série, TED e PIX, com `limite` até 100. Com Conexos lento a requisição pode passar de 1 minuto.
- **Melhoria Proposta**
  > Bound Execution Times: reduzir default/máximo do `limite` (ex.: 25/50), adicionar orçamento de tempo na página (itens além do orçamento voltam como `FALHA_LEITURA`/"não lido" com botão de reconferir), reutilizar a leitura entre TED e PIX do mesmo favorecido. Manter leitura sequencial (teto de sessões). Tocar `AuthorizationCandidatesService.ts` e `schemas.ts`.
- **Resultado Esperado**
  > Relatório responde em tempo limitado mesmo com Conexos lento.
- **Tactic alvo**: Bound Execution Times
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Chamadas Conexos por página: ~200-300 (pior caso) → ≤ 75
  - p95 da rota candidatos (pior caso): não medido (> 60s estimado) → < 5s
- **Risco de não fazer**: Timeout do Render na tela principal de autorização quando a base de fornecedores crescer.
- **Dependências**: nenhuma

### [performance-2] Deduplicar e cachear leitura de título na guarda de remessa

- **Problema**
  > A guarda L8 chama `getTituloAPagar` por item, em série e sem cache.
- **Melhoria Proposta**
  > Reduce Overhead: reaproveitar o `pesCod`/favorecido já obtido na verificação do lote (fin064 por filial, uma leitura por filial, como em `VerificacaoTedPixService.lerFilial`) em vez de uma leitura por título.
- **Resultado Esperado**
  > Leituras de título na remessa de N itens: N → nº de filiais (tipicamente 1-3).
- **Tactic alvo**: Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Chamadas Conexos na guarda: N → ≤ 3 por lote
  - Tempo da guarda para lote de 40 TED/PIX: 40 x ~1-3s → < 5s
- **Risco de não fazer**: Remessa lenta e consumo de sessão Conexos durante a janela de envio.
- **Dependências**: nenhuma

### [performance-3] Paginar a listagem de autorizações e não memoizar falha

- **Problema**
  > `listar` devolve até 1000 linhas; o cache do resolver memoiza rejeição sem retry.
- **Melhoria Proposta**
  > Limit Event Response: `LIMIT/OFFSET` com total via query-string do schema; no `memo`, remover a entrada do cache ao rejeitar (ou usar RetryExecutor para 5xx).
- **Resultado Esperado**
  > Resposta com ≤ 50 linhas por página; 5xx transitório não contamina o restante da rodada.
- **Tactic alvo**: Limit Event Response
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-3, F-performance-4
- **Métricas de sucesso**:
  - Linhas por resposta: ≤ 1000 → ≤ 50
  - Itens pendentes por falha transitória única: todos do favorecido → 1 retentativa antes
- **Risco de não fazer**: Degradação lenta da tela com histórico acumulado.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: serviços/repositórios/migração do delta; sem P0 de performance (nenhuma chamada sem timeout nova, nenhum SELECT sem limite em tabela crescente, sem N+1 SQL).
- Não medível: bundle Lambda, cold start, First Load JS (runtime Express/Render, sem `next build` neste run); latência real do Conexos.
- Cross-QA: F-performance-1/2 tocam Availability (timeout Render) e Fault Tolerance (retry); F-performance-4 é Fault Tolerance. Migração 0080 com guarda de contagem é Modifiability/Deployability.
