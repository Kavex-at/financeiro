---
qa: Performance
qa_slug: performance
run_id: 2026-10-09-1636-favorecido-busca
agent: qa-performance
generated_at: 2026-10-09T16:50:00-03:00
scope: all
score: 7
findings_count: 4
cards_count: 3
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Solicitante (`sispag:executar`) digitando no diálogo de pedido de autorização | Termo de texto (>=3 letras), CPF/CNPJ ou código; um POST `/sispag/favorecidos-autorizados/busca` por pausa de 350 ms | `PayeeSearchService.buscar` -> `ConexosSispagClient.buscarPessoas` (1-3 leituras `cmn025/list`) + `listarVigentesPorPesCods` (1 SELECT) | Express/Render, sessão Conexos por usuário com teto de sessões, Conexos com p99 de 2-10 s | Devolve até 20 linhas por leitura, sem N+1 e sem escrita; cancela requisições obsoletas no cliente | Leituras Conexos por busca <= 2 (texto) / <= 2 (documento, 1 no caso comum); SELECT local = 1; p95 da busca <= 3 s com Conexos saudável |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Leituras Conexos por busca de texto | 2 (razão social + fantasia), sequenciais | <= 2 | ✅ (latência soma as duas) | `ConexosSispagClient.ts` `buscarPessoas`, laço `for ... await ler` |
| Leituras Conexos por busca de documento | 1 (EQ em dígitos); 2 se nada achar (formatado) | <= 2 | ✅ | idem |
| Leituras Conexos por busca de código | 1 | 1 | ✅ | idem |
| Consultas ao Postgres por busca | 1, em lote (`pes_cod = ANY($pesCods)`), 0 se sem resultado | 1 | ✅ sem N+1 | `AuthorizedPayeeRepository.listarVigentesPorPesCods` |
| Índice para o SELECT local | `ux_sispag_favorecido_autorizado_vigente (pes_cod, modalidade) WHERE estado IN (vigentes)` cobre o predicado | índice presente | ✅ | `migrations/0080_sispag_favorecido_autorizado.sql:122` |
| Linhas por leitura | `pageSize` 20, página 1 fixa; `truncado` sinalizado | limitado | ✅ | `BUSCA_PESSOAS_LIMITE` |
| Linhas locais por busca | <= 40 linhas Conexos (2 leituras) -> <= 40 pesCods, <= 2 modalidades vigentes cada | limitado | ✅ | `PayeeSearchService.ts` |
| Debounce / cancelamento no frontend | 350 ms + `AbortController`, mínimo de 3 letras | presente | ✅ | `SolicitarAutorizacaoDialog.tsx:38,126,136` |
| Rate limit no servidor da rota de busca | ausente (só o debounce do cliente) | limite por usuário | ⚠️ | `routes/sispag.ts` rota `/busca` |
| Timeout explícito na leitura Conexos usada | ⚠️ Não verificado: `ConexosBaseClient.ts` não declara timeout; o que existe fica em outra camada | timeout em 100% das chamadas externas | ⚠️ | `grep timeout ConexosBaseClient.ts` -> vazio |
| Bundle / cold start / pool | N/A: Express no Render, sem Lambda, delta não adiciona dependências | - | N/A | `_shared-metrics.md` |
| Latência real (p50/p95) da busca | ⚠️ Não medível localmente: requer Conexos vivo; HML recusou o usuário (Bad Credentials) e a sonda em produção derrubaria sessão | p95 <= 3 s | ⚠️ | `_shared-metrics.md` gaps |

## 3. Tactics - Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | Debounce de 350 ms no cliente | ✅ presente | `SolicitarAutorizacaoDialog.tsx:38` |
| Limit Event Response | Mínimo 3 letras; abort de requisição obsoleta; sem limite no servidor | ⚠️ parcial | `PayeeSearchService.ts` `TEXTO_MINIMO`; ausência de rate limit |
| Prioritize Events | N/A: leitura interativa única, sem fila | N/A | sem SQS/Lambda |
| Reduce Overhead | SELECT local em lote; fallback de formato só quando EQ não acha; `Cache-Control: no-store` correto (dados sensíveis) | ✅ presente | `buscarPessoas`, `listarVigentesPorPesCods` |
| Bound Execution Times | Retry via `runWithRetry`; timeout total da busca não definido nesta camada | ⚠️ parcial | `ConexosBaseClient.ts:221` |
| Increase Resource Efficiency | `pageSize` 20, `fieldList` mínima (5 campos), dedupe por `pesCod` | ✅ presente | `BUSCA_PESSOAS_CAMPOS` |
| Increase Resources | N/A: Render single-instance, sem Lambda | N/A | - |
| Increase Concurrency | Duas leituras de texto sequenciais; independentes, poderiam ser paralelas | ⚠️ parcial | `for (const filterList of leituras) await ler(...)` |
| Maintain Multiple Copies of Computations | N/A | N/A | - |
| Maintain Multiple Copies of Data | Sem cache de resultado de busca (correto: cadastro muda e há mascaramento) | N/A | cache de busca agregaria risco de dado velho sem ganho medido |
| Bound Queue Sizes | N/A: sem fila | N/A | - |
| Schedule Resources | Teto de sessões Conexos por usuário não é respeitado por limitador local | ⚠️ parcial | ver F-performance-2 |
| Cold start budget / Bundle leanness | Sem novas dependências no delta | ✅ | `package.json` inalterado |
| Index discipline | Índice parcial existente cobre o SELECT; `cmn025` é do ERP | ✅ | `0080_...sql:122` |

## 4. Findings (achados)

### F-performance-1: Leituras de texto no Conexos são sequenciais

- **Severidade**: P2
- **Tactic violada**: Increase Concurrency
- **Localização**: `src/backend/domain/client/ConexosSispagClient.ts` (`buscarPessoas`, laço `for (const filterList of leituras) await ler(filterList)`)
- **Evidência (objetiva)**:
  ```
  leituras.push({ 'dpeNomPessoa#LIKE': texto }, { 'dpeNomFantasia#LIKE': texto });
  for (const filterList of leituras) await ler(filterList);
  ```
- **Impacto técnico**: latência da busca de texto = soma das duas leituras; com Conexos em 2-10 s de p99 isso chega a 4-20 s no pior caso, contra 2-10 s em paralelo.
- **Impacto de negócio**: o campo de busca é o caminho principal do pedido; digitação com atraso estimula novas buscas (mitigado pelo abort).
- **Métrica de baseline**: 2 leituras seriais por busca de texto (latência ~ 2x a de uma leitura). Sem medição ao vivo (ver Seção 6). Por isso P2.

### F-performance-2: Sem limite de taxa no servidor e interação com o teto de sessões Conexos

- **Severidade**: P2
- **Tactic violada**: Limit Event Response
- **Localização**: `src/backend/routes/sispag.ts` (rota `/favorecidos-autorizados/busca`)
- **Evidência (objetiva)**: a única contenção é `DEBOUNCE_BUSCA_MS = 350` no cliente; o servidor aceita qualquer taxa de POST e cada uma faz 1-3 leituras Conexos (3 no pior caso de documento: não achou em dígitos, não achou formatado - na verdade 2; texto = 2).
- **Impacto técnico**: um cliente sem debounce (ou vários usuários digitando) multiplica leituras no Conexos, que tem teto de sessões por usuário; o abort do navegador não cancela a leitura já enviada ao ERP.
- **Impacto de negócio**: contenção de sessão/lentidão do ERP afeta as demais frentes SISPAG que compartilham o mesmo Conexos.
- **Métrica de baseline**: pico teórico com debounce 350 ms = ~2,9 buscas/s/usuário x 2 leituras = ~5,7 leituras/s/usuário. Cálculo, não medição de produção, por isso P2.

### F-performance-3: Timeout da leitura Conexos não verificado nesta camada

- **Severidade**: P2
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/backend/domain/client/ConexosBaseClient.ts:221` (`runWithRetry`), `buscarPessoas`
- **Evidência (objetiva)**: `grep -n "timeout" ConexosBaseClient.ts` -> vazio; o retry (`RetryExecutor`) multiplica o tempo de uma leitura lenta pelo número de tentativas, sem teto de tempo total da requisição de busca.
- **Impacto técnico**: uma leitura pendurada segura a requisição Express e o diálogo (spinner) até o timeout de plataforma; retry empilha tentativas na rota interativa.
- **Impacto de negócio**: diálogo travado no pedido de autorização; analista abandona e abre o Conexos (o que a feature quer evitar).
- **Métrica de baseline**: ⚠️ não medida (timeout efetivo e nº de tentativas do `RetryExecutor` não coletados nesta rodada). Sem número, permanece P2.

### F-performance-4: Fallback de formato do documento custa uma leitura extra quando o cadastro não casa

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead
- **Localização**: `ConexosSispagClient.ts` (`buscarPessoas`, bloco `porCodigo.size === 0 && 'pdcDocFederal#EQ'`)
- **Evidência (objetiva)**: documento inexistente no ERP gasta sempre 2 leituras; o formato guardado não foi medido ao vivo.
- **Impacto técnico**: +1 leitura (+~100% da latência) apenas em busca sem resultado de CPF/CNPJ.
- **Impacto de negócio**: baixo; some quando a sonda confirmar o formato.
- **Métrica de baseline**: 2 leituras para documento sem resultado (vs. 1 se o formato fosse conhecido).

## 5. Cards Kanban

### [performance-1] Paralelizar as duas leituras de texto da busca de favorecido

- **Problema**
  > `buscarPessoas` lê razão social e nome fantasia em série; a latência soma duas leituras do Conexos (p99 2-10 s).

- **Melhoria Proposta**
  > Executar as `leituras` com `Promise.all` (cada uma já passa por `runWithRetry`), mantendo o merge por `pesCod` na ordem original (razão social primeiro) para resultado determinístico. Tocar `ConexosSispagClient.ts` e o teste de ordem. Antes, confirmar que 2 leituras simultâneas do mesmo usuário não estouram o teto de sessões (usam a mesma sessão).

- **Resultado Esperado**
  > Latência da busca de texto de ~2x para ~1x a de uma leitura (ex.: 2 x 600 ms = 1,2 s -> ~0,6 s, a validar na sonda).

- **Tactic alvo**: Increase Concurrency
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Tempo da busca de texto (p95): ~2 x T_leitura -> ~1 x T_leitura
  - Leituras por busca de texto: 2 -> 2 (inalterado)
- **Risco de não fazer**: busca lenta no horário em que o ERP está carregado; sem corrupção de dado.
- **Dependências**: nenhuma; medir após a sonda `probe-cmn025-busca-hml.ts`.

### [performance-2] Limitar a taxa da busca por usuário e propagar cancelamento

- **Problema**
  > A rota `/busca` não tem limite no servidor; cada POST dispara 1-2 leituras no Conexos, que tem teto de sessões por usuário.

- **Melhoria Proposta**
  > Limite simples em memória por usuário autenticado (ex.: 5 buscas / 5 s, 429 com `Retry-After`) via middleware já existente, se houver; senão um Map com janela deslizante no próprio router. Opcional: deduplicar buscas idênticas em voo (mesmo termo+usuário) reaproveitando a Promise. Tactic: Limit Event Response.

- **Resultado Esperado**
  > Teto de 1 leitura/s sustentada por usuário em vez de ~5,7 leituras/s teóricas; teste cobre 429 acima do limite.

- **Tactic alvo**: Limit Event Response
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Leituras Conexos/s por usuário (teto): ~5,7 -> <= 1,2
  - Teste de rota: 6a requisição em 5 s -> 429
- **Risco de não fazer**: uso por cliente sem debounce ou script pressiona o Conexos compartilhado com o resto do SISPAG.
- **Dependências**: nenhuma.

### [performance-3] Estabelecer teto de tempo da busca e confirmar o timeout do cliente Conexos

- **Problema**
  > Não há timeout explícito visível em `ConexosBaseClient.ts` e o retry roda na rota interativa; uma leitura lenta prende a requisição e o diálogo.

- **Melhoria Proposta**
  > Medir o timeout efetivo e as tentativas do `RetryExecutor` na leitura; envolver a busca num teto total (ex.: 8 s) via executor de timeout existente ou `AbortSignal`, devolvendo erro tipado que a UI mostra como "Conexos lento, tente de novo". Reduzir tentativas do retry nesta rota (interativa) para 1 retry. Registrar duração e nº de leituras no log (`LogService`) para ter p50/p95 reais.

- **Resultado Esperado**
  > Pior caso da requisição de busca: sem teto conhecido -> <= 8 s; p95 e p50 passam a existir nos logs.

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-performance-3, F-performance-4
- **Métricas de sucesso**:
  - Tempo máximo da requisição `/busca`: indefinido -> <= 8 s
  - Duração da busca nos logs: ausente -> p50/p95 disponíveis
- **Risco de não fazer**: diálogo travado em dia de Conexos degradado, e nenhum número para decidir paralelização ou cache.
- **Dependências**: sonda em HML com credencial válida (gap em `_shared-metrics.md`).

## 6. Notas do agente

- Sem P0/P1: nenhum finding tem baseline medido ao vivo (HML recusou credencial; sonda em produção derrubaria sessão), então tudo foi mantido em P2/P3 conforme a regra.
- Escopo: só o delta; bundle, cold start, SQS e pool de conexão são N/A (Express/Render, sem Lambda, delta sem dependências novas). O SELECT local usa índice existente e é único por busca (sem N+1); o mesmo vale para a prévia `destino-atual` (leituras do resolvedor I10, reaproveitadas, não re-analisadas aqui).
- Cross-QA: timeout/rate limit sobrepõem Availability e Fault Tolerance (teto de sessões Conexos); F-performance-2 toca Security (abuso de endpoint de busca por CPF/CNPJ).
