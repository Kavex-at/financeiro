---
qa: Performance
qa_slug: performance
run_id: 2026-10-14-1330
agent: qa-performance
generated_at: 2026-10-14T13:30:00-03:00
scope: all
score: 6
findings_count: 5
cards_count: 5
---

# Performance — Regis-Review (reduzido, delta feat/sispag-sugestao-boleto-dda)

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG abrindo a aba de títulos / decidindo sugestões | Carga da página e cada Confirmar/Rejeitar disparam `fetchTodasSugestoesBoleto` (1 a N páginas de 100) | `GET /sispag/sugestoes-boleto` → `BoletoSuggestionService.sugerirAgora` → `MotorSugestaoBoleto` (Express único, síncrono) | Carteira ≈1.100 títulos × pool ≈6.000 boletos, horário comercial, vários analistas | Servir o selo/evidência sem bloquear o event loop do processo que também atende as demais rotas | p95 da listagem completa ≤ 1 s; CPU síncrona por requisição ≤ 150 ms; ≤ 1 execução do motor por carga de página |

## 2. Métricas observadas

> Todos os tempos de motor abaixo são **SINTÉTICOS** (script descartável em `/tmp/perfbench/b2.mts`, dados gerados, 1 CPU local, Node 22, via tsx, mediana de 4 execuções após a 1ª). **Não** são medições de produção. Os custos de banco e rede **não foram medidos**.

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Motor 1.100 × 1.500, 400 valores distintos (SINTÉTICO) | 113–140 ms | < 1 s (teste) | ✅ | `tsx /tmp/perfbench/b2.mts 1100 1500 400` |
| Motor 1.100 × 6.000, 400 valores distintos (SINTÉTICO) | 412–464 ms | ≤ 150 ms por requisição | ⚠️ | idem `1100 6000 400` |
| Motor 1.100 × 6.000, 100 valores distintos (≈60 boletos/valor) (SINTÉTICO) | 1.019–1.061 ms | ≤ 150 ms | ❌ | idem `1100 6000 100` |
| Motor 1.100 × 6.000, 25 valores distintos (≈240 boletos/valor, pior caso agrupado) (SINTÉTICO) | 4.304–4.420 ms | ≤ 150 ms | ❌ | idem `1100 6000 25` |
| Escala 1.500 → 6.000 boletos (mesma distribuição) | ×3,5 (≈ linear em B no mesmo valor/faixa; o custo é T·k, k = boletos na faixa de valor) | linear | ⚠️ | comparação das linhas acima |
| Execuções do motor por carga de página (ESTIMATIVA) | ≈ ⌈sugestões/100⌉ = 3 a 11 (≈250–300 sugestões segundo `_shared-metrics.md`; teto 1.100 títulos elegíveis → 11) | 1 | ❌ | `lib/sispag.ts:2064-2075`; `BoletoSuggestionService.ts:110,651` |
| Bloqueio de event loop por carga de página (ESTIMATIVA = execuções × custo sintético) | ≈ 1,2 s (3 págs × 0,41 s) a ≈ 4,6 s (11 págs) no cenário espalhado; multiplicar se houver agrupamento de valores | ≤ 150 ms | ❌ | derivado |
| Cache de resultado do motor | nenhum | TTL curto + invalidação | ❌ | `sugerirAgora` sem cache |
| `selectMany` sem janela/limite em caminho de API | 2 (`listBoletos({})` sem `vencimentoDesde`, sem LIMIT; `listAtivos` sem LIMIT, limitado só pelo volume da carteira) | 0 | ⚠️ | `BoletoDdaRepository.ts:115-127`, `TituloAPagarRepository.ts:158-167` |
| Listagens do repositório novo com LIMIT | 100% (`LIMIT 10000`, falha alto se atingir) | 100% | ✅ | `SugestaoBoletoRepository.ts:40,145,161,356` |
| Índices das tabelas 0084 | 8 (únicos parciais por par vigente, decisão confirmada por título e por boleto, rejeitada; btree por estado/ator/título) | cobrir WHERE das listagens | ✅ | `0084_sispag_sugestao_boleto.sql:69-163` |
| Índices em `boleto_dda` usados pelo pool | `vencimento`, `valor` (0062); JOIN por `ddc_cod` | filtro por janela de vencimento usa `idx_boleto_dda_vencimento` | ⚠️ (existe, mas a consulta do motor não filtra) | `0062_boleto_dda.sql:42-43` |
| N+1 no delta | 0 (leituras em `Promise.all`, 6 consultas por requisição; motor em memória) | 0 | ✅ | `BoletoSuggestionService.ts:656-664` |
| Rate limit da leitura | só `globalLimiter` 100/min por IP; limiter dedicado (30/min) cobre só confirmar/copiar | leitura ≥ 3 págs × decisões/min < 100 | ⚠️ | `rateLimit.ts:145-163`, `buildApp.ts:59` |
| Dependências novas (frontend/backend) | 0 (apenas bump de versão nos package.json) | 0 | ✅ | `git diff --stat` |
| Bundle do frontend (First Load JS da rota `/sispag`) | ⚠️ **Não medível localmente**: `next build` não executado nesta rodada reduzida (módulo `@radix-ui/react-dropdown-menu` ausente do `node_modules` compartilhado). Recomendação: rodar `next build` no CI e registrar o First Load da rota. | ≤ 200 KB p95 | ⚠️ | — |
| Latência real da consulta (listBoletos, listAtivos, decisões) e tamanho do pool | ⚠️ **Não medível localmente**: sem acesso ao banco de produção nesta revisão; "≈6.000" vem do enunciado. Recomendação: log de duração por etapa de `sugerirAgora`. | — | ⚠️ | — |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | Frontend refaz a leitura inteira a cada decisão (`onAlterado`/`onDecidido`) e a cada carga; sem debounce | ⚠️ parcial | `page.tsx:238-247,357,1262,1622` |
| Limit Event Response | Limiter por usuário em confirmar/copiar (30/min); leitura só no global | ⚠️ parcial | `rateLimit.ts:145-163` |
| Prioritize Events | N/A — carga interativa única, sem fila | N/A | classe de tráfego única |
| Reduce Overhead | Motor puro, indexado por valor com busca binária (faixa de valor), sem I/O; mas recomputa tudo por página e a regra roda por candidato | ⚠️ parcial | `MotorSugestaoBoleto.ts:~300-330` |
| Bound Execution Times | Teto de 20 págs no cliente e `LIMIT 10000` nas listagens; sem orçamento de tempo/CPU no motor | ⚠️ parcial | `lib/sispag.ts:2058`, repo `:40` |
| Increase Resource Efficiency | Complexidade documentada O((T+B) log B + T·k); sem pré-agrupamento além da faixa | ✅ algoritmo / ⚠️ degrada com valores repetidos | bench acima |
| Increase Resources | N/A — processo Express único em Render; não há escala horizontal que ajude CPU síncrona de uma requisição | N/A | CLAUDE.md |
| Increase Concurrency | Sem; motor síncrono monopoliza o event loop | ❌ ausente | bench |
| Maintain Multiple Copies of Computations | Nenhum cache do cenário (títulos+pool+decisões) | ❌ ausente | `sugerirAgora` |
| Maintain Multiple Copies of Data | Pool e carteira já persistidos localmente (sincronização), mas relidos integralmente a cada chamada | ⚠️ parcial | `BoletoDdaRepository.ts:115` |
| Bound Queue Sizes | N/A — sem fila | N/A | — |
| Schedule Resources | N/A — sem scheduler; a computação poderia ser pré-gerada pelo sync, mas não é | ❌ ausente | — |
| Cold start / bundle leanness | Nenhuma dependência nova no delta | ✅ | `package.json` diff |
| Cache strategy | Sem cache de resultado nem `Cache-Control`/ETag na leitura | ❌ ausente | rota `routes/sispag.ts:790-807` |
| Index discipline | Índices parciais cobrem os WHERE das tabelas novas; pool de boletos lido sem janela | ⚠️ parcial | migration 0084; repo boleto |

## 4. Findings

### F-performance-1: Motor roda inteiro a cada requisição de página, sem cache, e o cliente pede todas as páginas

- **Severidade**: P1
- **Tactic violada**: Maintain Multiple Copies of Computations / Reduce Overhead
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:110-146,651-690`; `src/frontend/lib/sispag.ts:2057-2075`; `src/frontend/app/sispag/page.tsx:238-247,357`
- **Evidência (objetiva)**:
  ```
  listarSugestoes -> sugerirAgora() (6 consultas + motor.sugerir(T títulos, B boletos))
                  -> filtra -> contagem -> .slice((pagina-1)*tamanho, ...)   // paginação DEPOIS do cálculo
  fetchTodasSugestoesBoleto: while (sugestoes.length < total && pagina < 20) fetchSugestoesBoleto({pagina, tamanho: 100})
  bench SINTÉTICO 1100x6000: 412-464 ms (400 valores), 1,02-1,06 s (100 valores), 4,3-4,4 s (25 valores)
  ```
- **Impacto técnico**: cada carga de página custa ≈ 3–11 execuções completas e síncronas do motor + 18 leituras de tabela; o event loop do Express (compartilhado com todas as rotas) fica bloqueado de ~0,4 s por página no cenário espalhado a vários segundos com valores repetidos (cobranças recorrentes, valores redondos). Cada Confirmar/Rejeitar repete tudo (`onAlterado`/`onDecidido`).
- **Impacto de negócio**: tela do analista e todas as demais rotas (remessa, lotes) ficam lentas quando 2+ analistas operam juntos; piora conforme o pool cresce.
- **Métrica de baseline**: 412–464 ms/execução (sintético, 1100×6000) × ≈3 páginas (estimativa) ≈ 1,2–1,4 s de CPU síncrona por carga; 3–11 execuções por carga.

### F-performance-2: Pool DDA lido inteiro, sem janela de vencimento nem LIMIT, em toda requisição

- **Severidade**: P2 (sem medida de produção: rebaixado de P1 por regra de baseline)
- **Tactic violada**: Bound Execution Times / Index discipline
- **Localização**: `src/backend/domain/repository/sispag/BoletoDdaRepository.ts:115-127`; chamada em `BoletoSuggestionService.ts:657-658` (`listBoletos({})`)
- **Evidência (objetiva)**:
  ```
  WHERE a.cancelado_em IS NULL AND ($desde::date IS NULL OR b.vencimento >= $desde::date)  -- desde = null
  ORDER BY b.vencimento ASC NULLS LAST, b.ddc_cod DESC, b.dit_cod ASC                       -- sem LIMIT
  ```
- **Impacto técnico**: o enunciado fala em janela de 60 dias, mas a consulta não a aplica: o pool cresce com o histórico de arquivos DDA não cancelados (incl. `codbar` por linha), trafega e é parseado a cada chamada, e `T·k` cresce com ele. O `OR $desde IS NULL` também impede uso previsível do índice de vencimento.
- **Impacto de negócio**: degradação silenciosa mês a mês, sem alarme, na tela mais usada.
- **Métrica de baseline**: Não medível localmente (tamanho real do pool em produção desconhecido); estimativa do enunciado ≈6.000 linhas por chamada.

### F-performance-3: Decisões REJEITADAS acumulam sem expirar e a leitura falha alto em 10.000 linhas

- **Severidade**: P2
- **Tactic violada**: Bound Queue Sizes (crescimento ilimitado de dado em caminho quente)
- **Localização**: `src/backend/domain/repository/sispag/SugestaoBoletoRepository.ts:40,356-376`
- **Evidência (objetiva)**:
  ```
  LIMITE_LISTAGEM = 10000 ; if (linhas >= LIMITE_LISTAGEM) throw SuggestionListingTruncatedError
  ```
- **Impacto técnico**: a tabela de decisões é append-only; rejeições nunca saem do conjunto lido por `sugerirAgora`. Ao atingir o teto o endpoint inteiro passa a falhar (comportamento correto contra decisão "ausente", mas é um cliff de disponibilidade). A leitura traz todas as linhas (com evidência) para montar só um Set de chaves.
- **Impacto de negócio**: tela de sugestões some de uma vez após meses de uso intenso.
- **Métrica de baseline**: contagem atual de REJEITADA não medida (tabela nova em produção); teto fixo 10.000.

### F-performance-4: Cliente pagina em série e refaz tudo a cada decisão; truncamento silencioso no teto de 20 páginas

- **Severidade**: P2
- **Tactic violada**: Manage Sampling Rate / Limit Event Response
- **Localização**: `src/frontend/lib/sispag.ts:2064-2075`; `src/frontend/app/sispag/page.tsx:1262,1622`; `src/backend/http/rateLimit.ts:145-163`
- **Evidência (objetiva)**:
  ```
  await fetchSugestoesBoleto(...) dentro de while (sequencial, sem Promise.all)
  onAlterado={carregarSugestoes}   // toda decisão → 1..N GETs
  limiter dedicado: 30/min só confirmar/copiar; leitura sob globalLimiter 100/min por IP
  ```
- **Impacto técnico**: latência percebida = soma serial de N respostas de ≈0,4 s+ (estimativa); com 11 páginas, ≈9 decisões/min já saturam os 100/min do IP global (11 GET + 1 POST por decisão ≈ 12 req) e geram 429 também nas demais telas. Se `total > 2.000` o loop para sem avisar (listagem parcial como se completa); hoje o teto prático é 1.100 elegíveis, então é latente.
- **Impacto de negócio**: analista em lote de decisões vê tela travar e 429 em rotas não relacionadas (mesmo IP de escritório).
- **Métrica de baseline**: 3–11 GET por carga (estimativa); 12 req/decisão no pior caso.

### F-performance-5: Rerender e bundle do frontend sem evidência de problema (observação)

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead (oportunidade)
- **Localização**: `src/frontend/app/sispag/page.tsx:245-247`; `components/SugestaoBoletoPainel.tsx`, `ConfirmacoesEmissorPainel.tsx`, `MotivoDecisaoDialog.tsx`
- **Evidência (objetiva)**:
  ```
  agruparPorTitulo memoizado por [sugestoes]; imports estáticos de componentes de dialog; ícones lucide em import nomeado; 0 deps novas
  ```
- **Impacto técnico**: `setSugestoes` substitui a lista inteira a cada refetch → rerender da tabela de títulos (≈1.100 linhas) por decisão; sem virtualização. Painéis/diálogos entram no chunk da rota `/sispag` em vez de carga sob demanda. Custo não medido (sem `next build`/profiler).
- **Impacto de negócio**: baixo; relevante só se o First Load da rota já estiver perto de 200 KB.
- **Métrica de baseline**: Não medível localmente (`next build` não rodou).

## 5. Cards Kanban

### [performance-1] Calcular o cenário de sugestões uma vez e reutilizá-lo entre páginas e decisões

- **Problema**
  > Cada GET de página recalcula o motor inteiro (≈0,4 s síncrono sintético em 1100×6000, >1 s com valores repetidos) e o cliente chama de 3 a 11 páginas por carga e de novo a cada decisão. O event loop do Express é bloqueado por todos.

- **Melhoria Proposta**
  > Cache em memória do resultado de `sugerirAgora` (singleton), chave = versão do estado (`max(sincronizado_em)` do DDA + contador/`max(decidido_em)` das decisões + `max(atualizado_em)` da carteira) com TTL de 30–60 s; invalidar explicitamente em confirmar/rejeitar/revogar e coalescer chamadas concorrentes (single-flight). Paginação/filtro passam a atuar sobre o resultado em cache. Arquivos: `BoletoSuggestionService.ts`.

- **Resultado Esperado**
  > 1 execução do motor por mudança de estado, não por página. CPU síncrona por carga de página 1,2–4,6 s (estimativa sintética) → ≤ 0,5 s; GET de página com cache quente p95 ≤ 50 ms.

- **Tactic alvo**: Maintain Multiple Copies of Computations
- **Severidade**: P1
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Execuções do motor por carga de página: 3–11 → 1
  - Bloqueio de event loop por carga: ≈1,2 s (sintético×estimativa) → ≤ 0,5 s
  - p95 do GET com cache quente: ≈0,4 s+ → ≤ 50 ms
- **Risco de não fazer**: conforme o pool e a repetição de valores crescem, a tela passa de 1 s por requisição e degrada as rotas de remessa no mesmo processo.
- **Dependências**: definição do sinal de invalidação (decisão com o mantenedor; confirmação continua relendo ao vivo, ADR-0040).

### [performance-2] Aplicar janela de vencimento e projeção enxuta na leitura do pool DDA

- **Problema**
  > `listBoletos({})` lê todos os boletos de arquivos não cancelados, sem `vencimentoDesde` e sem LIMIT, a cada requisição; a janela de 60 dias descrita não é aplicada na consulta.

- **Melhoria Proposta**
  > Passar `vencimentoDesde = hoje − 60 d` (BRT) vinda do `BankingCalendar` em `sugerirAgora`, trocar `($desde IS NULL OR …)` por predicado simples para o planner usar `idx_boleto_dda_vencimento`, e logar contagem de linhas/duração. Só boletos livres precisam entrar (filtrar `fil_cod/doc_cod/tit_cod IS NULL` no SQL, mantendo os vinculados apenas se necessários à reserva I15e — validar com o teste do motor).

- **Resultado Esperado**
  > Linhas lidas por requisição limitadas à janela (valor de produção a medir; meta ≤ 6.000 estável ao longo dos meses) e consulta com plano `Index Scan`/`Bitmap` em `vencimento`.

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Linhas do pool por chamada: crescimento sem teto → ≤ 6.000 (janela)
  - Duração da etapa `listBoletos`: não medida → registrada em log, p95 ≤ 100 ms
- **Risco de não fazer**: lentidão progressiva e silenciosa; `T·k` do motor cresce junto.
- **Dependências**: confirmar com o mantenedor que boletos fora da janela de 60 dias não influenciam a regra (VENCIDO_INFORMATIVO, reserva do ERP).

### [performance-3] Tornar a leitura de decisões REJEITADAS limitada e sem cliff

- **Problema**
  > Rejeições acumulam para sempre e são lidas integralmente; ao chegar a 10.000 linhas o endpoint inteiro lança `SuggestionListingTruncatedError`.

- **Melhoria Proposta**
  > Selecionar só as colunas de chave (sem evidência) para o motor, restringir às rejeições de títulos/boletos ainda ativos (JOIN/`EXISTS` na carteira e na janela do pool) e/ou arquivar rejeições de títulos pagos/inativos; emitir métrica/aviso a 70% do teto.

- **Resultado Esperado**
  > Linhas lidas proporcionais à carteira ativa (≤ ~1.100 × poucas rejeições) em vez do histórico; alerta antes do teto. Cliff de 10.000 deixa de ser alcançável.

- **Tactic alvo**: Bound Queue Sizes
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Linhas lidas de REJEITADA por requisição: histórico total → apenas ativas (≤ 2.000)
  - Aviso emitido a 7.000 linhas: ausente → presente
- **Risco de não fazer**: após alguns meses de uso a tela de sugestões deixa de carregar de uma vez, em produção.
- **Dependências**: performance-1 (a leitura passa a ocorrer por invalidação, não por página).

### [performance-4] Carregar sugestões do cliente em 1 requisição, com patch local após decisão

- **Problema**
  > O cliente pagina em série até 20×100 e refaz tudo após cada decisão; pode gerar 12 req/decisão sob o limite global de 100/min por IP e trunca silenciosamente acima de 2.000.

- **Melhoria Proposta**
  > Endpoint/parâmetro de leitura completa para a aba (resposta única, ≈1.100 itens, sem `contagem` repetida) ou paralelizar páginas com `Promise.all` após a primeira; após Confirmar/Rejeitar aplicar o `ResultadoDecisao` no estado local e revalidar em segundo plano com debounce; sinalizar na UI quando `sugestoes.length < total`. Opcional: limiter de leitura dedicado (60/min por usuário) para não consumir o global.

- **Resultado Esperado**
  > GET por carga 3–11 → 1; requisições por decisão 12 → 2 (POST + 1 revalidação); latência percebida de carga ≈ soma serial → 1 round-trip.

- **Tactic alvo**: Manage Sampling Rate
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-performance-4, F-performance-5
- **Métricas de sucesso**:
  - GET por carga de página: 3–11 → 1
  - Requisições por decisão: ≈12 (pior caso) → ≤ 2
  - Listagem parcial sinalizada: não → sim
- **Risco de não fazer**: 429 em telas não relacionadas para analistas atrás do mesmo IP; lista parcial sem aviso se a carteira crescer.
- **Dependências**: performance-1 (reduz o custo de cada chamada) — pode ser feito em paralelo.

### [performance-5] Proteger o motor contra agrupamento de valores (custo T·k) e registrar tempo por execução

- **Problema**
  > O custo cresce com `k` (boletos na faixa de valor do título): sintético 1100×6000 vai de 0,41 s (valores espalhados) a 4,4 s (≈240 boletos por valor). Não há log de duração nem orçamento, então a regressão só aparece como lentidão da tela.

- **Melhoria Proposta**
  > Medir e logar duração/`T`/`B`/candidatos avaliados por execução em `sugerirAgora`; reduzir a avaliação por candidato (pré-filtrar por janela de vencimento na faixa antes de chamar `RegraSugestaoBoleto`, curto-circuitar quando já há ≥2 seguros de mesma força); adicionar teste de desempenho com agrupamento de valores (T=1100, B=6000, 25 valores) com orçamento. Se ainda exceder, mover o cálculo para o job de sincronização e persistir o snapshot.

- **Resultado Esperado**
  > Pior caso sintético 4,4 s → ≤ 1 s; log de duração disponível para alarmar acima de 500 ms.

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Motor 1100×6000, 25 valores: ≈4,4 s → ≤ 1 s (sintético)
  - Motor 1100×6000, 400 valores: ≈0,43 s → ≤ 0,2 s (sintético)
  - Duração por execução: não registrada → logada
- **Risco de não fazer**: o primeiro dia com muitos boletos de valor repetido (parcelas, tarifas) trava a rota para todos.
- **Dependências**: nenhuma; preservar determinismo e I15e (os testes do motor cobrem).

## 6. Notas do agente

- Escopo: só o delta. Cross-QA: performance-1 e -5 tocam Fault Tolerance (event loop bloqueado afeta remessa/lotes); performance-3 (cliff de 10.000 → 500) e performance-4 (429 colateral) tocam Availability/Fault Tolerance; o índice/janela do pool (performance-2) toca Modifiability (schema 0062 fora do delta).
- Não medi: banco real, First Load JS (`next build` não rodou), latência de rede. Tempos de motor são sintéticos (dados gerados, máquina local), mediana de execuções repetidas; a estimativa de ≈3 páginas por carga vem de ≈250–300 sugestões em `_shared-metrics.md`.
- Observação favorável: sem N+1, leituras em paralelo, listagens com LIMIT e falha alto, índices parciais corretos para as tabelas novas, nenhuma dependência nova.
