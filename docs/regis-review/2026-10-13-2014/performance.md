---
qa: Performance
qa_slug: performance
run_id: 2026-10-13-2014
agent: qa-performance
generated_at: 2026-10-13T20:14:00-03:00
scope: backend
score: 7
findings_count: 5
cards_count: 4
---

# Performance — Regis-Review

> Escopo: delta `git diff 5a17d3e HEAD` (sincronização DDA dentro da ingestão de pagamentos, ADR-0067).
> **Todo número de tempo abaixo é ESTIMATIVA derivada de constantes do código e dos números de pool
> das notas do repo (≈173 arquivos, ≈25k boletos, ≈40 arquivos na janela de 60 d). Nada foi medido em
> produção.** A latência por chamada ao `fin124` não é dado do repo; está parametrizada (L).

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Cron 07h/12h/16h BRT, abertura de tela (TTL 30 min) ou botão manual | Ingestão de pagamentos dispara `BoletoDdaService.sincronizar` antes da leitura de títulos | `IngestaoPagamentosService.runIngestion` → `BoletoDdaService.executarSincronizacao` → `ConexosDdaClient` + `BoletoDdaRepository.salvarArquivo` | Dia útil, Conexos com latência normal a degradada (2–10 s p99), pool pg de 5 conexões, lock de ingestão e lock DDA ocupados | Reler só o que pode ter mudado, respeitar o prazo, não degradar leitura da carteira nem outras rotas | Fase DDA ≤ 60 s (cota do ADR) incl. cauda em voo; ≤ 5 arquivos relidos sem mudança por sync; 0 requisição web falhando por falta de conexão no pool |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos alvo por sync (novos + relidos) | ≈40 relidos + novos do dia (estimativa, notas do repo) | só novos + relidos com mudança provável | ⚠️ | `BoletoDdaService.ts:129-133` |
| Ondas de leitura por sync | ceil(40/3) = 14 (FANOUT_LIMIT 3) | — | ℹ️ | `BoletoDdaService.ts:29,144` |
| Tempo da fase DDA, L = 1 s por arquivo (estimativa) | ≈14–20 s | ≤ 60 s | ✅ | cálculo: 14 ondas × L + listarArquivos |
| Tempo da fase DDA, L = 5 s (estimativa) | 14 × 5 = 70 s > prazo → ~36 arquivos lidos, ~4 adiados; total ≈ 60 s + cauda ≤ 5 s | ≤ 60 s | ⚠️ | idem |
| Tempo da fase DDA, L = 10 s (p99 citado no contexto; estimativa) | ≈ 60 s + cauda ≤ 10 s; ~18–21 arquivos lidos, ~20 adiados | ≤ 60 s | ⚠️ | idem |
| Teto teórico de uma chamada Conexos | timeout 40 s × 3 tentativas (retries 2) + backoff 0,5 s ≈ 121 s por página | prazo respeitado | ❌ | `services/conexos.ts:121`, `ConexosBaseClient.ts:154-157` |
| Latência pior caso da fase DDA (estimativa) | 60 s + 1 página em voo (até ≈121 s) = ≈ 3 min; antes de entrar no loop, `listarArquivos` também não é limitada pelo prazo | 60 s + ≤ 10 s | ⚠️ | `BoletoDdaService.ts:116-145` |
| Latência da requisição de abertura de tela (ingestão ~10 s medida no cron + fase DDA) | ≈ 10 s → ≈ 70 s (caso L=10 s); teórico ≈ 190 s | ≤ 30 s | ⚠️ | `routes/sispag.ts:834-843` |
| Boletos regravados por sync (estimativa: ≈25k/173 ≈ 145 por arquivo × 40) | ≈ 5,8k linhas, upsert incondicional com `now()` | só linhas alteradas | ⚠️ | `BoletoDdaRepository.ts:48-75` |
| Syncs por dia útil (3 crons + aberturas, TTL 30 min; limite superior estimado) | ≈ 3 a ≈ 20 | — | ℹ️ | `EnvironmentProvider.ts:355` |
| Leituras `fin124/itens` por dia útil (estimativa, 40 × syncs) | ≈ 120 a ≈ 800, das quais quase todas reconfirmam dado idêntico | ≈ novos do dia | ⚠️ | cálculo |
| Conexões do pool pg (max 5) tomadas pela fase DDA | 1 (lock ingestão) + 1 (lock DDA) + até 3 (tx de `salvarArquivo`, uma por worker, curtas) = até 5/5 | folga ≥ 2 | ⚠️ | `PostgreeDatabaseClient.ts:37`, `:218`, `BoletoDdaRepository.ts:49` |
| Duração da fase DDA exposta no resultado/log | ausente | presente | ❌ | `SincronizacaoDdaResultado`, `DdaNaIngestao` |
| Timers manuais / N+1 introduzidos | 0 / 0 (fan-out via `BoundedConcurrency`; 1 chamada por arquivo é inerente ao `fin124/itens/list/{ddcCod}`) | 0 | ✅ | delta |
| Índices para o que o delta consulta | `boleto_dda` PK (ddc_cod, dit_cod) + idx vencimento/valor; `listArquivosSincronizados` lê a tabela de arquivos (≈173 linhas) | — | ✅ | `migrations/*boleto_dda*` |
| Bundle / cold start | N/A — runtime Express no Render, sem Lambda; delta não adiciona dependência | — | N/A | `package.json` (só bump de versão) |

⚠️ **Não medível localmente**: latência real por arquivo do `fin124`, duração real da fase DDA, tamanho real dos arquivos recentes. Recomendação: card performance-1 (instrumentar) antes de ajustar `releituraDias`.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | Ingestão 3x/dia + TTL 30 min na abertura; porém a releitura de 40 arquivos roda em TODA ingestão, mesma frequência para dado que muda pouco (vínculo só de boletos a vencer) | ⚠️ parcial | `BoletoDdaService.ts:34,130-132` |
| Limit Event Response | TTL + cooldown + `RUN_PRESA_MS` limitam disparos; nada limita a releitura por arquivo (não usa `sincronizado_em`) | ⚠️ parcial | `CarteiraAtualizacaoService.ts:13,89-95` |
| Prioritize Events | Novos antes de relidos (`[...novos, ...relidos]`); entre os relidos a ordem é a da listagem do ERP, sem prioridade por idade | ⚠️ parcial | `BoletoDdaService.ts:133` |
| Reduce Overhead | Upsert em chunks de 200 e DELETE por `ANY` evitam N statements; mas regrava linhas idênticas | ⚠️ parcial | `BoletoDdaRepository.ts:8,67-73` |
| Bound Execution Times | Prazo de 60 s só antes de iniciar cada arquivo; `listarArquivos`, login e a página em voo não são limitados (40 s × 3 por chamada) | ⚠️ parcial | `BoletoDdaService.ts:116,139` |
| Increase Resource Efficiency | Sem skip de arquivo inalterado (`total_itens`/`sincronizado_em` existem e não são consultados); upsert sem `IS DISTINCT FROM` | ❌ ausente | `BoletoDdaService.ts:130-132` |
| Increase Resources | Pool pg fixo em 5; fan-out Conexos fixo em 3 por cap de sessões do robô | ⚠️ parcial | `PostgreeDatabaseClient.ts:37` |
| Increase Concurrency | `BoundedConcurrency` limit 3; sequencial com a leitura de títulos por decisão (cap de sessões, ADR-0066 §3) | ✅ | `BoletoDdaService.ts:135-145` |
| Maintain Multiple Copies of Computations | N/A — leitura de ERP não se beneficia de réplica de cálculo | N/A | — |
| Maintain Multiple Copies of Data | O próprio pool `boleto_dda` é a cópia local do fin124; a leitura da aba/carteira usa o snapshot, não o ERP | ✅ | `BoletoDdaService.ts:62-88` |
| Bound Queue Sizes | `RUN_PRESA_MS`, lock não bloqueante (`pg_try_advisory_lock`) → `ocupada`, sem fila de espera; `MAX_PAGINAS` 60 | ✅ | `PostgreeDatabaseClient.ts:221`, `ConexosDdaClient.ts:9` |
| Schedule Resources | Sync serializada sob dois advisory locks; pool de 5 sem reserva para leitura web | ⚠️ parcial | `BoletoDdaService.ts:101-109` |
| Cache strategy | Snapshot em Postgres funciona como cache; falta invalidação por mudança (hoje por tempo) | ⚠️ parcial | `BoletoDdaRepository.ts` |
| Index discipline | PK + índices em vencimento/valor cobrem `listBoletos`; delta não adiciona consulta nova sem índice (coluna `doc_esp_numero` é só escrita) | ✅ | migration 0083 |

## 4. Findings

### F-performance-1: a fase DDA tem teto "60 s" só no papel; cauda em voo e pré-loop não são limitados e a requisição de abertura espera tudo

- **Severidade**: P2
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:116-145`; `src/backend/routes/sispag.ts:834-843`; `src/backend/domain/service/sispag/CarteiraAtualizacaoService.ts:98`
- **Evidência (objetiva)**:
  ```
  const limite = Date.now() + prazoMs;            // :116
  ... await this.dda.listarArquivos(...)          // :120, sem checagem de prazo
  if (limite !== undefined && Date.now() > limite) return null;   // :139, só ANTES de listarItens
  // services/conexos.ts:121  timeout: 40000 ; ConexosBaseClient.ts:154  retries: 2
  // routes/sispag.ts:841  res.json(await service.atualizarSeDefasada(...))
  ```
- **Impacto técnico**: o prazo de 60 s vira "60 s + a página em voo". Estimativa: com L = 10 s, ≈ 70 s; teórico com Conexos degradado (40 s × 3 tentativas) ≈ 3 min. A requisição `POST /carteira/atualizar` fica aberta o tempo todo, segurando 2 conexões do pool (locks) e um slot do `heavyRouteLimiter`. A ADR promete "até ~60 s a mais".
- **Impacto de negócio**: o analista que abre a tela na janela de Conexos lento vê o refresh pendurado por mais de 1 min (a tela mostra o gravado, então o efeito é espera/indicador ocupado, não tela vazia). Sem perda de dado: tudo é idempotente.
- **Métrica de baseline**: 10 s (ingestão, medido no cron) → ≈ 70 s (estimado, L = 10 s) / ≈ 190 s (teórico, constantes).

### F-performance-2: releitura de ~40 arquivos a cada sync, mesmo sem mudança, com regravação incondicional

- **Severidade**: P2
- **Tactic violada**: Increase Resource Efficiency / Limit Event Response / Manage Sampling Rate
- **Localização**: `BoletoDdaService.ts:34,129-133`; `BoletoDdaRepository.ts:48-75`
- **Evidência (objetiva)**:
  ```
  relidos = arquivos.filter(a => conhecidos.has(a.ddcCod) && (a.importadoEm ?? 0) >= corte)
  // sem consulta a sincronizado_em; upsert: ON CONFLICT ... DO UPDATE SET ..., sincronizado_em = now()
  ```
- **Impacto técnico**: ≈ 40 chamadas `fin124/itens` + 40 transações + ≈ 5,8k linhas reescritas por sync (estimativa). Com até ≈ 20 syncs por dia útil (3 cron + aberturas a cada 30 min), ≈ 800 leituras/dia contra um punhado de arquivos realmente novos. Cada reescrita gera tuplas mortas em `boleto_dda` (≈ 25k linhas), trabalho de autovacuum e consumo de sessões do robô (cap por usuário) que a Frente I/II também usam.
- **Impacto de negócio**: o tempo extra de cada abertura de tela e a pressão sobre o robô do Conexos não compram frescor: o dado relido é, na maioria, idêntico.
- **Métrica de baseline**: ≈ 40 arquivos / ≈ 5,8k linhas por sync (estimativa); alvo ≤ 5 arquivos sem mudança.

### F-performance-3: relidos sem ordem de prioridade: sob prazo estourado repetido, a cauda da listagem nunca é atualizada

- **Severidade**: P2
- **Tactic violada**: Prioritize Events
- **Localização**: `BoletoDdaService.ts:133`
- **Evidência (objetiva)**:
  ```
  const alvo = [...novos, ...relidos];   // relidos na ordem do fin124/list
  ```
- **Impacto técnico**: com L ≥ 5 s o prazo corta a mesma cauda toda vez; os mesmos arquivos ficam sempre `arquivosAdiados` e nunca são relidos (inanição). Cada sync paga o custo e não converge.
- **Impacto de negócio**: vínculo (`docCod`/`titCod`) gravado pelo Conexos em boleto de arquivo na cauda não chega ao Postgres → "boleto sem DDA" falso persistente, o defeito que a ADR quer eliminar.
- **Métrica de baseline**: com L = 10 s, ≈ 20 de 40 relidos adiados por sync, sempre os mesmos (estimativa).

### F-performance-4: pool pg de 5 sem folga na fase DDA

- **Severidade**: P2
- **Tactic violada**: Schedule Resources
- **Localização**: `PostgreeDatabaseClient.ts:37,218`; `IngestaoPagamentosService.ts:69-77`; `BoletoDdaService.ts:101`; `BoletoDdaRepository.ts:49`
- **Evidência (objetiva)**:
  ```
  poolMaxConnections = 5; connectionTimeoutMillis = 5000
  withAdvisoryLock -> connectionPool.connect()  // 1 cliente dedicado por lock; 2 locks aninhados
  salvarArquivo -> withTransaction -> connect()  // até 3 workers simultâneos
  ```
- **Impacto técnico**: 2 conexões presas pelos locks + até 3 transações de worker = 5/5 no processo web quando a abertura de tela dispara a sync. As transações são curtas (ms), então a janela de saturação é estreita; uma rota web concorrente que pegue conexão nesse instante espera até 5 s e falha com timeout de conexão. Nos crons (processo próprio) não há contenção.
- **Impacto de negócio**: risco baixo, mas intermitente e difícil de reproduzir: 500 esporádico em outra rota SISPAG exatamente quando alguém abre a tela.
- **Métrica de baseline**: 5/5 conexões no pico (constantes); sem medição de ocorrência.

### F-performance-5: duração da fase DDA não é medida

- **Severidade**: P2
- **Tactic violada**: Manage Sampling Rate / Bound Execution Times (pré-requisito de ajuste)
- **Localização**: `BoletoDdaService.ts:166-177`; `SispagInterface.ts` (`DdaNaIngestao`)
- **Evidência (objetiva)**:
  ```
  resultado = { arquivosNovos, arquivosRelidos, boletos, falhas, arquivosAdiados }  // sem duracaoMs
  ADR-0067: "a medir em produção — se for lenta, reduzir releituraDias"
  ```
- **Impacto técnico**: a própria ADR condiciona o ajuste a uma medição que o código não produz; sem `duracaoMs` (total e por arquivo) não há como distinguir L = 1 s de L = 10 s.
- **Impacto de negócio**: o ajuste de `releituraDias`/prazo vira decisão por palpite; um prazo estourado vira só "parcial" no `error_message`.
- **Métrica de baseline**: 0 campos de duração (hoje); alvo: `duracaoMs`, `p95 por arquivo` e `adiados` no log por sync.

## 5. Cards Kanban

### [performance-1] Medir duração da fase DDA e por arquivo antes de afinar o prazo

- **Problema**
  > A ADR-0067 manda "medir em produção" a fase DDA, mas `SincronizacaoDdaResultado`/`DdaNaIngestao` não carregam duração. Sem ela, F-2/F-3 e o prazo de 60 s são decididos por estimativa.

- **Melhoria Proposta**
  > Acrescentar `duracaoMs` ao resultado da sync e ao `dda` da ingestão, mais `maxArquivoMs`, medidos com `Date.now()` ao redor de `listarItens`+`salvarArquivo`; logar no `info` final. Tactic: Manage Sampling Rate (instrumentar para dimensionar). Tocar `BoletoDdaService.ts`, `BoletoDda.ts`, `SispagInterface.ts`.

- **Resultado Esperado**
  > Cada run da ingestão registra a duração da fase DDA. Duração da fase DDA: não medida → medida em 100% das runs; p95 e % de runs `parcial` consultáveis após 1 semana.

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-5
- **Métricas de sucesso**:
  - Runs com duração da fase DDA registrada: 0% → 100%
  - Decisão sobre `releituraDias` baseada em p95 real (≥ 1 semana de dados)
- **Risco de não fazer**: o prazo e a janela continuam calibrados por palpite; uma degradação do `fin124` só aparece como aviso genérico "parcial".
- **Dependências**: nenhuma

### [performance-2] Pular releitura de arquivo recém-sincronizado e ordenar relidos pelo mais antigo

- **Problema**
  > Cada sync relê ≈ 40 arquivos (estimativa) e regrava ≈ 5,8k linhas mesmo sem mudança, até ≈ 20x por dia útil; sob prazo estourado a mesma cauda é adiada sempre.

- **Melhoria Proposta**
  > Em `executarSincronizacao`, usar `sincronizado_em` de `boleto_dda_arquivo` (já gravado): na ingestão, só relê arquivo cujo `sincronizado_em` seja mais velho que N min (ex.: 120 min; aberturas de tela dentro do TTL pulam), e ordenar `relidos` por `sincronizado_em` ASC (round-robin, elimina inanição). Botão manual e job avulso continuam relendo tudo. Em `salvarArquivo`, `ON CONFLICT ... DO UPDATE ... WHERE` linha realmente diferente (`IS DISTINCT FROM`). Tactic: Increase Resource Efficiency + Prioritize Events. Tocar `BoletoDdaService.ts`, `BoletoDdaRepository.ts` (`listArquivosSincronizados` devolve o timestamp).

- **Resultado Esperado**
  > Arquivos relidos por sync em abertura de tela: ≈ 40 → ≤ 5 (estimativa); leituras `fin124/itens` por dia útil: ≈ 800 → ≈ 120–200 (estimativa); linhas regravadas por sync: ≈ 5,8k → só as alteradas; arquivos adiados repetidamente: 0 (todos rodam em ≤ 2 syncs).

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-performance-2, F-performance-3
- **Métricas de sucesso**:
  - Arquivos relidos por sync de abertura: ≈ 40 → ≤ 5
  - Idade máxima do último `sincronizado_em` dentro da janela de 60 d: ilimitada sob prazo → ≤ 2 intervalos de ingestão
  - Tempo da fase DDA (L=5 s, estimativa): ≈ 60 s → ≤ 15 s
- **Risco de não fazer**: a cada aumento do volume de arquivos o prazo corta mais, o vínculo atrasa e o robô do Conexos gasta sessão relendo dado idêntico.
- **Dependências**: performance-1 (para validar o N de minutos com dado real)

### [performance-3] Fazer o prazo da fase DDA valer também para pré-loop e cauda em voo

- **Problema**
  > O prazo de 60 s só é checado antes de iniciar cada arquivo; `listarArquivos` e a página em voo podem levar até ≈ 121 s (40 s × 3 tentativas), e a requisição de abertura de tela espera tudo. Estimado: 10 s → ≈ 70 s típico-ruim, ≈ 190 s teórico.

- **Melhoria Proposta**
  > Passar o orçamento restante ao `ConexosDdaClient` (sem retry quando o prazo restante < timeout) ou envolver a fase com `Promise.race` contra o prazo (`sincronizarDda` devolve `parcial` e deixa a cauda terminar sem bloquear a ingestão); reduzir tentativas na leitura DDA da ingestão. Considerar que `POST /carteira/atualizar` responda `em_andamento` e deixe a ingestão terminar em segundo plano quando passar de ~30 s. Tactic: Bound Execution Times. Tocar `BoletoDdaService.ts`, `ConexosDdaClient.ts`, `IngestaoPagamentosService.ts`.

- **Resultado Esperado**
  > Duração da fase DDA: pior caso ≈ 190 s → ≤ 65 s; latência da requisição de abertura de tela no caso L = 10 s: ≈ 70 s → ≤ 40 s.

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Pior caso da fase DDA (constantes): ≈ 190 s → ≤ 65 s
  - p95 da requisição `POST /sispag/carteira/atualizar` (após performance-1): medir → ≤ 40 s
- **Risco de não fazer**: uma degradação do Conexos transforma a abertura da tela em espera de minutos e mantém 2 conexões pg + o lock da ingestão presos, bloqueando a próxima rodada de cron (`ocupada`/`em_andamento`).
- **Dependências**: performance-1

### [performance-4] Reservar folga no pool pg durante a sync DDA

- **Problema**
  > No processo web, 2 locks (ingestão + DDA) + até 3 transações de worker somam 5/5 do pool; outra rota SISPAG concorrente pode estourar o `connectionTimeoutMillis` de 5 s.

- **Melhoria Proposta**
  > Opções, em ordem de custo: (a) limitar a 2 as gravações simultâneas (`salvarArquivo` serializado por semáforo, a leitura do ERP continua em 3); (b) reutilizar a conexão do lock DDA para a transação; (c) subir o pool para 6–8 se o Supabase pooler permitir (checar limite por usuário). Tactic: Schedule Resources.

- **Resultado Esperado**
  > Conexões pg tomadas pela fase DDA no pico: 5/5 → ≤ 3/5; timeouts de conexão em rotas web durante sync: indeterminado → 0 (verificar nos logs após 2 semanas).

- **Tactic alvo**: Schedule Resources
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-4
- **Métricas de sucesso**:
  - Pico de conexões pg da fase DDA: 5 → ≤ 3
  - Erros "timeout exceeded when trying to connect" coincidentes com sync DDA: 0
- **Risco de não fazer**: 500 esporádico em rotas SISPAG ao abrir tela; difícil de reproduzir e de atribuir.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo só do delta. Nenhuma mudança é P0/P1: sem medição real de latência do `fin124`, e a ingestão nunca é derrubada pela fase DDA (falha/prazo viram `parcial`/`falhou`). As severidades acima refletem isso.
- `FANOUT_LIMIT` 3 e a sequência sync-antes-de-títulos são coerentes com o cap de sessões do robô (ADR-0066 §3); não recomendei paralelizar.
- Cross-QA: prazo/timeouts sobrepõem **Availability/Fault Tolerance** (F-1, performance-3); regravação incondicional e tuplas mortas sobrepõem **Modifiability** só no sentido de schema (sem novo índice necessário); contenção de sessões do robô sobrepõe **Integrability**; `duracaoMs` sobrepõe **Testability/observabilidade**.
- Bundle/cold start: N/A (Express no Render; o delta não adiciona dependências).
