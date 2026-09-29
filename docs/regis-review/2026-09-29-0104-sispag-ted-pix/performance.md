---
qa: Performance
qa_slug: performance
run_id: 2026-09-29-0104
agent: qa-performance
generated_at: 2026-09-29T01:30:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 3
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG (Express/Render) | Clica "Gerar remessa" num lote com N itens TED/PIX, flags ligadas | `RemessaService.resolverDestinosAntesDaEscrita` -> Conexos fin064/cmn025 | Produção, Conexos com p99 de 2–10s | Pré-voo resolve o destino de todos os itens antes de escrever, com fan-out limitado e sem repetir leituras | Pré-voo de lote com 50 itens < 15s; nenhuma requisição HTTP > 100s (limite de proxy) |
| Painel SISPAG | Abre/oferece modalidades de um lote | `SispagPainelService` (oferta de TED/PIX) | Flags ligadas | Oferta lê o cadastro por favorecido (memo por fluxo) | Leituras Conexos por favorecido distinto = 1–2, não por item |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Leituras Conexos extras por item TED/PIX no envio (flags ON) | 1 `getTituloAPagar` por item, sem memo + 1 `getDocumentoFavorecido` por item MANUAL, sem memo; contas/chaves com memo por (filial, favorecido) | 1 por favorecido distinto | ⚠️ | `RemessaService.ts:1341,1352` |
| Concorrência do pré-voo do envio | 1 (`for ... await` sequencial) | <= `CONEXOS_FANOUT_LIMIT` (4) | ⚠️ | `RemessaService.ts:1395-1419` |
| Concorrência da oferta no painel | 4, via `bounded.run` + memo por fluxo | <= 4 | ✅ | `LotePagamentoService.ts` (delta), `SispagPainelService.ts:57` |
| Com flags OFF, custo extra vs main | 0 (`usaRegraNova` filtra; paridade testada) | 0 | ✅ | `_shared-metrics.md`, `RemessaService.ts:1396` |
| Índice do JOIN LATERAL da trilha de destino | `idx_destino_audit_item (lote_id, fil_cod, doc_cod, tit_cod, alterado_em DESC)` cobre o lookup | índice cobrindo o predicado | ✅ | `0066_sispag_destino_manual.sql:45` |
| SELECT dos itens do lote | `WHERE i.lote_id = $id`, escopo por lote (limitado) | limitado | ✅ | `LotePagamentoRepository.ts` (delta) |
| Timeout explícito nos clients Conexos | não encontrado por `grep timeout:` em `domain/client/Conexos*.ts` (só `BcbClient`) | 100% | ⚠️ PRE_EXISTING, não verificado a fundo | grep |
| Bundle Lambda / cold start / SQS / pool sizing / bundle Next | ⚠️ **Não medível localmente**: sem `infra/`, sem Lambda, sem SQS (Express/Render); `--quick` sem build | n/a | n/a | CLAUDE.md |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A: sem stream/telemetria neste caminho | N/A | n/a |
| Limit Event Response | Fan-out limitado a 4 na oferta; o envio é serializado por lote | ⚠️ parcial | `SispagPainelService.ts:57` |
| Prioritize Events | N/A: fluxo por ação de analista | N/A | n/a |
| Reduce Overhead | Memo de contas/chaves por (filial, favorecido) por fluxo; flags OFF = custo zero. Falta memo do título e do documento | ⚠️ parcial | `DestinoPagamentoResolver.ts:219-231` |
| Bound Execution Times | Sem deadline global do pré-voo sequencial; timeout dos clients não verificado | ❌ ausente | `RemessaService.ts:1395` |
| Increase Resource Efficiency | Lookup por índice composto; memo | ✅ | `0066...sql:45` |
| Increase Resources | N/A: Render, escala fora do escopo | N/A | n/a |
| Increase Concurrency | Oferta concorrente (4); pré-voo do envio sequencial | ⚠️ parcial | `RemessaService.ts:1395` |
| Maintain Multiple Copies of Computations | N/A | N/A | n/a |
| Maintain Multiple Copies of Data | Memo por fluxo (não entre requisições, deliberado: cadastro muda) | ✅ | `DestinoPagamentoResolver.ts:46-50` |
| Bound Queue Sizes | N/A: sem fila | N/A | n/a |
| Schedule Resources | Serialização da remessa por lote (`gerarRemessaSerializado`) | ✅ | `RemessaService.ts` |
| Cold start / Bundle leanness | Não medível (sem Lambda) | N/A | n/a |
| Index discipline | Índice na tabela nova; `destino_manual` JSONB sem índice (nunca filtrado por ele) | ✅ | `0066...sql` |
| Cache strategy | Memo por fluxo, sem cache entre requisições | ✅ | `DestinoPagamentoResolver.ts` |

## 4. Findings (achados)

### F-performance-1: Pré-voo do envio lê o título de cada item em série, sem memo (IN_DELTA)

- **Severidade**: P2
- **Tactic violada**: Increase Concurrency / Reduce Overhead
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:1395-1419, 1341`
- **Evidência (objetiva)**:
  ```
  for (const item of p.itens) { ... await this.destinoConferidoDoItem(...) }   // sequencial
  const lido = await this.sispag.getTituloAPagar(item.filCod, item.docCod, item.titCod);
  ```
  A oferta do painel (mesma regra, 'oferta = envio') usa `bounded.run` com limite 4. O envio não.
- **Impacto técnico**: Latência do pré-voo = N x (leitura de título + eventual leitura de cadastro). Com Conexos a 2–10s no p99, um lote de 50 itens TED/PIX pode chegar a 50 x ~1s = ~50s típico e passar de 100s no pior caso (estimativa, sem medição real). Corre dentro da requisição HTTP do "Gerar remessa", antes de qualquer escrita, então não corrompe estado, só expira.
- **Impacto de negócio**: Analista vê timeout ao gerar remessa em lote grande e repete a ação. A trava serializada por lote evita duplicação, mas queima sessão Conexos.
- **Métrica de baseline**: concorrência 1; 1 leitura de título por item; sem medição de p95 (não medível localmente). Severidade P2 por falta de baseline numérico medido.

### F-performance-2: `getDocumentoFavorecido` sem memo para itens MANUAL do mesmo favorecido (IN_DELTA)

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead
- **Localização**: `RemessaService.ts:1350-1353`; `LotePagamentoService.ts` (`exigirTitularidade`)
- **Evidência (objetiva)**: `await this.sispag.getDocumentoFavorecido(contexto.pesCod, item.filCod)` por item MANUAL. O `cache` do resolver cobre só contas e chaves.
- **Impacto técnico**: Lote com vários títulos do mesmo favorecido repete a leitura cmn025.
- **Impacto de negócio**: Latência e carga desnecessárias no Conexos, sem efeito funcional.
- **Métrica de baseline**: até M leituras iguais para M itens MANUAL do mesmo favorecido; alvo 1.

### F-performance-3: Sem deadline global no pré-voo (IN_DELTA)

- **Severidade**: P2
- **Tactic violada**: Bound Execution Times
- **Localização**: `RemessaService.ts:1376-1422`
- **Evidência (objetiva)**: nenhum `RetryExecutor`/orçamento de tempo em torno do loop. Não achei `timeout:` nos clients Conexos (`grep timeout: domain/client/Conexos*.ts` = 0 ocorrências fora de comentários). O timeout pode estar em outra camada (HTTP compartilhado), o que não verifiquei.
- **Impacto técnico**: Uma leitura Conexos pendurada segura a requisição e a trava do lote.
- **Impacto de negócio**: Lote travado até a expiração da requisição.
- **Métrica de baseline**: deadline do pré-voo = nenhum; timeout por chamada = não verificado (PRE_EXISTING quanto ao client).

### F-performance-4: Flags OFF preservam o desempenho do main (IN_DELTA, positivo, sem card)

- **Severidade**: P3
- **Tactic violada**: nenhuma
- **Localização**: `RemessaService.ts:1396` (`usaRegraNova`)
- **Evidência (objetiva)**: itens sem regra nova saem do loop antes de qualquer leitura; testes de paridade com as flags OFF.
- **Impacto técnico**: nenhum extra com flags OFF.
- **Impacto de negócio**: nenhum.
- **Métrica de baseline**: 0 leituras extras com flags OFF. Sem card por ser achado positivo.

## 5. Cards Kanban

### [performance-1] Paralelizar o pré-voo de destino do envio com fan-out limitado

- **Problema**
  > O pré-voo lê o título de cada item TED/PIX em série (`for ... await`, `RemessaService.ts:1395`), enquanto a oferta usa fan-out 4. Com Conexos lento, o tempo cresce linearmente com N.

- **Melhoria Proposta**
  > Trocar o loop por `bounded.run(itens, ..., CONEXOS_FANOUT_LIMIT)`, como no painel, preservando a ordem da lista `ausentes`, o `assinatura` determinístico e o cache compartilhado. Mover `CONEXOS_FANOUT_LIMIT` para constante compartilhada. Tactic: Increase Concurrency.

- **Resultado Esperado**
  > Pré-voo de lote com 50 itens TED/PIX: ~50 leituras seriais para ~13 rodadas de 4 (tempo estimado ÷ ~4). Medir antes e depois com o probe supervisionado.

- **Tactic alvo**: Increase Concurrency
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Concorrência do pré-voo: 1 → 4
  - Latência do pré-voo (50 itens): medir no probe; meta ≥ 3x mais rápido
- **Risco de não fazer**: Lotes grandes com flags ligadas expiram a requisição de gerar remessa.
- **Dependências**: nenhuma; validar no PRD supervisionado.

### [performance-2] Memoizar leitura do título e do documento do favorecido no fluxo

- **Problema**
  > `getTituloAPagar` e `getDocumentoFavorecido` não passam pelo `CacheCadastroDestino`; só contas e chaves passam.

- **Melhoria Proposta**
  > Estender `memo` do resolver (ou um memo irmão) para `documento:{filCod}:{pesCod}`. O título é lido uma vez por item e já é a unidade mínima, então basta o documento. Tactic: Reduce Overhead.

- **Resultado Esperado**
  > Leituras cmn025 por lote: 1 por item MANUAL para 1 por favorecido distinto.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Leituras `getDocumentoFavorecido` por lote com M itens do mesmo favorecido: M → 1
- **Risco de não fazer**: Carga desnecessária no Conexos, sem impacto funcional.
- **Dependências**: nenhuma.

### [performance-3] Impor orçamento de tempo ao pré-voo e confirmar timeout dos clients Conexos

- **Problema**
  > O pré-voo não tem deadline global e não confirmei timeout explícito nos clients Conexos.

- **Melhoria Proposta**
  > Confirmar o timeout por chamada na camada HTTP compartilhada do Conexos e documentar. Adicionar orçamento (ex.: 60s) ao pré-voo que aborta com erro operacional em português, sem escrita (o pré-voo é read-only, então é seguro). Tactic: Bound Execution Times.

- **Resultado Esperado**
  > Pior caso do pré-voo limitado a 60s (hoje sem limite); erro claro no lugar de timeout do proxy (100s).

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Deadline do pré-voo: nenhum → 60s
  - Clients Conexos com timeout explícito: não verificado → 100%
- **Risco de não fazer**: Uma chamada travada segura a trava do lote até a requisição expirar.
- **Dependências**: [performance-1] reduz a chance de estourar o orçamento.

## 6. Notas do agente

- Rodada `--quick`: sem rede, sem build, sem Conexos. Todas as latências são estimativas a partir da estrutura do código, não medições.
- Sem P0/P1: não há baseline numérico medido. Bundle, cold start, SQS, pool e Next First Load: não medíveis (sem `infra/`/Lambda).
- Cross-QA: timeout (F-performance-3) sobrepõe Availability e Fault Tolerance; o índice da 0066 está correto e cobre o LATERAL.
- PRE_EXISTING: ausência de `timeout:` nos clients Conexos e complexidade cognitiva de `gerarRemessaSerializado` (91 para 93) não são novas.
