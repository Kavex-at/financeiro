---
type: regis-review-report
run_id: 2026-09-03-1901-tapar-furos-backend
generated_at: 2026-09-03T19:45:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: gate pós-implementação de tweak (5 arquivos, commit e575221) — NÃO é review de repo inteiro
total_cards: 24
total_p0: 0
total_p1: 1
total_p2: 11
total_p3: 12
overall_score: 8.07
---

# Regis-Review — financeiro — 2026-09-03-1901-tapar-furos-backend

> **Este NÃO é um review do repositório inteiro.** É o gate pós-implementação de um tweak
> defensivo de 5 arquivos (`fix/tapar-furos-backend`, commit `e575221`) que corrigiu três
> furos: BE-05 (vazamento de sessões Supabase pelo handler de `error` do pool), BE-06
> (ausência de shutdown gracioso deixando runs órfãs em `reconciling`) e BE-09 (script de
> lint que passava verde em worktree sem `node_modules`). Todo achado deste run deve ser
> lido como "o que o delta *quase* cobriu" ou "vizinhança que o delta expôs em novo
> ângulo". Findings de repositório mais amplos ficam para runs sem `--quick`.

## 1. Executive scorecard

**Pesos aplicados (financeiro — SaaSo que executa escritas que movem dinheiro):**
Security 1.5 · Fault Tolerance 1.3 · Availability 1.2 · Modifiability 1.2 · Testability 1.0 ·
Performance 1.0 · Integrability 0.9 · Deployability 0.9 · **total = 9.0**.

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---:|---:|---:|---:|---:|---|
| Availability | 8.0 | 0 | 0 | 2 | 1 | F-availability-1: `/health` continua 200 durante drain — LB sem sinal de readiness |
| Deployability | 8.0 | 0 | 0 | 2 | 1 | F-deployability-2: rollback é manual no dashboard, sem runbook versionado |
| Integrability | 7.5 | 0 | 1 | 1 | 1 | **F-integrability-2: segundo pool Postgres no `conexosSessionStore` bypassa o shutdown — mesma classe do BE-05** |
| Modifiability | 8.5 | 0 | 0 | 0 | 3 | F-modifiability-3: `index.ts` a 198 LOC / 30 imports — próximo do teto de boot |
| Performance | 8.5 | 0 | 0 | 1 | 2 | F-performance-2: teto real de sessões Supabase não documentado (35 teóricas × plano desconhecido) |
| Fault Tolerance | 8.0 | 0 | 0 | 2 | 1 | F-fault-tolerance-2: force-exit por drain timeout é invisível ao painel — só `console.log` |
| Security | 8.0 | 0 | 0 | 1 | 1 | F-security-1: log de falha do pool no shutdown não passa pelo `redactErrorMessage` |
| Testability | 8.0 | 0 | 0 | 2 | 2 | F-testability-3: `index.ts` sem teste — `start()` monolítico dispara no import |
| **Overall** | **8.07** | **0** | **1** | **11** | **12** | — |

**Score interpretation:**
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais
- 9–10: estado-da-arte para o estágio atual

**Contagem de P0: ZERO.** Verificado lendo cada seção. Os três furos que motivaram o
tweak (BE-05, BE-06, BE-09) estão corrigidos e verificados por teste; nenhum agente
levantou finding P0 residual. **O gate do pipeline passa.** O maior achado do run é um P1
(integrability-2) que reproduz a classe do BE-05 num segundo sítio — não corrigido — e
que **deve** ser o primeiro item de trabalho na janela pós-merge.

## 2. Top 10 risks (cross-QA)

Rankeado por severidade × leverage × business impact. Escopo do run é o delta;
"impacto de negócio" é lido contra as escritas financeiras (SISPAG, permuta, recebimentos)
que motivam o produto.

### R-1: Segundo pool Postgres do `conexosSessionStore` reproduz o BE-05 num segundo sítio

- **QA(s) afetados**: Integrability, Availability, Fault Tolerance, Deployability
- **Findings de origem**: F-integrability-2 (P1) — sinalizado por `qa-availability` e `qa-fault-tolerance` como cross-QA
- **Evidência sintetizada**: `src/backend/services/conexosSessionStore.ts:242-256` cria um segundo `Pool` (`max: 2`) com handler `pool.on('error', () => undefined)` — exata assinatura do bug BE-05 que o delta corrigiu no cliente primário. Esse pool não é conhecido pelo `gracefulShutdown`, então cada SIGTERM deixa até 2 sessões penduradas no pooler Supabase até `idleTimeoutMillis=10s`.
- **Impacto técnico**: mesmo laço de retro-alimentação do BE-05 (esgotamento → erro tratado como transitório → mais conexões) permanece armado em escala menor. Adicionalmente, cada deploy vaza até 2 sessões extras somando ao pico do primário.
- **Impacto de negócio**: o BE-05 corrigido era o vetor mais provável de saturar o `MaxClientsInSessionMode` do Supavisor; o secundário ainda pode participar. Sob rollout rápido (v0.29→v0.34 = 5 releases em janela curta), o total (`Σ processos × max_pool = 35 teóricas`) fica exposto sem alarme.
- **Card(s) Kanban relacionados**: `integrability-2` (P1, S), `integrability-1` (P2, S — habilita o `integrability-2` via contrato `IClient.close()`)
- **Custo de inação em 6 meses**: se o pool secundário quebrar em janela de contenção do Supavisor, primeiro sintoma é 5xx em rotas que dependem do `conexosSessionStore` (auth, `/painel`), com o mesmo padrão de "detector virando amplificador" — MTTR forçado a redeploy manual. Premissa: 1 janela de contenção por trimestre.

### R-2: `/health` responde 200 durante o drain — o próprio delta pode permitir a órfã que ele existe para eliminar

- **QA(s) afetados**: Availability, Deployability
- **Findings de origem**: F-availability-1 (P2), F-deployability-1 (P3) — mesma causa raiz, severidades diferentes por perspectiva (Availability lê "vetor ativo agora"; Deployability lê "irrelevante em single-instance Render")
- **Evidência sintetizada**: a flag `shuttingDown` vive no closure de `createShutdownHandler` (`gracefulShutdown.ts:52,57-61`); nenhum endpoint HTTP consulta. `/health` (`index.ts:79`) retorna `{status:'ok'}` incondicionalmente. Entre o SIGTERM chegar e o `server.close` fechar o socket, o LB do Render pode rotear novas requisições por conexões keep-alive já abertas.
- **Impacto técnico**: uma requisição que entra na janela de drain pode cair exatamente na fatia crítica `createRun → finishRun` do SISPAG — que é o cenário que motivou o BE-06.
- **Impacto de negócio**: reduz o ganho do BE-06 em cenários de deploy no meio do expediente. O `reaper-sispag` (a cada 15 min) segue como rede final, mas é justamente o trabalho que o BE-06 se propôs a apagar.
- **Card(s) Kanban relacionados**: `availability-1` (P2, S) — cobre também F-deployability-1
- **Custo de inação em 6 meses**: 1 órfã atribuível a deploy por janela de contenção do Conexos (frequência estimada, requer instrumentação — ver R-3). Cada órfã custa 15 min de latência de detecção + intervenção manual do analista.

### R-3: Force-exit por drain timeout é invisível ao painel — regressão de perf passa despercebida

- **QA(s) afetados**: Fault Tolerance, Availability, Performance
- **Findings de origem**: F-fault-tolerance-2 (P2), F-availability-3 (P3), F-performance-3 (P3) — três agentes, mesma causa raiz (observabilidade do shutdown ausente)
- **Evidência sintetizada**: `gracefulShutdown.ts:73-75` sai por force-exit imprimindo `console.log('[shutdown] drenagem excedeu...')` com `exit(0)`. Não vira alerta, não vira métrica, não passa por `LogService`. O ADR-0042 gastou um workflow inteiro (`detect-staleness`) para não deixar falhas invisíveis — este é uma reintrodução dentro do próprio delta que deveria melhorá-la.
- **Impacto técnico**: uma rota patológica que consistentemente ultrapasse 10 s de drain (deadlock em cliente Conexos, retry sem `shouldRetry`) trunca requisições em voo a cada restart, sem sinal para `/operacao`. Cross-cutting com R-4: se `DEFAULT_DRAIN_TIMEOUT_MS=10s` for pequeno para o envelope real, o force-exit vira caminho comum sem que ninguém saiba.
- **Impacto de negócio**: regressão de perf de escrita financeira só é detectada por subida indireta de linhas em `reconciling`, com atraso de 15 min–1 h.
- **Card(s) Kanban relacionados**: `fault-tolerance-2` (P2, S), `availability-3` (P3, M — coleta série temporal), `performance-2` (P3, M — histograma p50/p95/p99)
- **Custo de inação em 6 meses**: se a próxima regressão de perf de escrita chegar a produção, MTTR mínimo = 15 min (esperar o reaper) — comparado com "próximo deploy" se o alerta existir.

### R-4: Teto de drenagem 10 s consome 33% do envelope Render; clientes Conexos sem `timeout:` no axios podem ultrapassar

- **QA(s) afetados**: Fault Tolerance, Availability, Performance
- **Findings de origem**: F-fault-tolerance-1 (P2)
- **Evidência sintetizada**: `DEFAULT_DRAIN_TIMEOUT_MS = 10_000` em `gracefulShutdown.ts:26` contra ~30 s do envelope SIGTERM→SIGKILL do Render (número declarado no comentário, não confirmado neste run). `ConexosSispagWriteClient`, `ConexosBaixaClient`, `ConexosFin014Client`, `ConexosSispagClient` — nenhum tem `timeout:` explícito no `axios.create`. Sob contenção do Conexos (~3 sessões simultâneas com fila), `POST /sispag/remessa/gerar` pode ultrapassar 10 s.
- **Impacto técnico**: requisição de escrita financeira entre 10 s e ~28 s é força-cortada pelo próprio handler — reproduz o órfão `reconciling` que o BE-06 existe para eliminar, agora com log em vez de morte silenciosa. Ganho residual real fica em ~1/3 do envelope disponível.
- **Impacto de negócio**: durante deploy em horário de contenção, 1 lote órfão no `fin015` por deploy sob carga (frequência estimada; requer produção para confirmar).
- **Card(s) Kanban relacionados**: `fault-tolerance-1` (P2, S)
- **Custo de inação em 6 meses**: ~4 lotes órfãos/mês em rollout típico (2–3 deploys/dia observados no changelog v0.29→v0.34). Cada um requer intervenção manual do analista.

### R-5: `server.close` não força fechamento de keep-alive — drain sempre estoura mesmo sem requisição em voo

- **QA(s) afetados**: Availability, Deployability
- **Findings de origem**: F-availability-2 (P2)
- **Evidência sintetizada**: `grep closeIdleConnections|closeAllConnections src/backend` → 0 ocorrências. Node ≥18.2 expõe essas APIs; o handler atual chama apenas `server.close(callback)`, que aguarda cada keep-alive fechar sozinho.
- **Impacto técnico**: no caso comum (sem requisição real em voo), o LB mantém keep-alive aberta e o `server.close` estoura os 10 s, caindo no force-exit. O caminho feliz vira o caminho degenerado — cada deploy é, na prática, teste do force-exit.
- **Impacto de negócio**: perde-se a evidência de que o drain funciona no dia em que ele **precisar** funcionar. Combinado com R-3, tira o próprio ROI do BE-06.
- **Card(s) Kanban relacionados**: `availability-2` (P2, S) — idealmente depois de `availability-1`
- **Custo de inação em 6 meses**: baixo em incidente ativo; alto em confiança. O 10 s vira "número mágico" sem verificação.

### R-6: Boot do `index.ts` monolítico e sem teste — ordem crítica sobrevive só por convenção documentada

- **QA(s) afetados**: Testability, Modifiability
- **Findings de origem**: F-testability-3 (P2), F-modifiability-3 (P3) — mesma causa raiz
- **Evidência sintetizada**: `src/backend/index.ts` — 198 LOC, 30 imports, 0% cobertura, `void start()` no topo dispara servidor no `import`. `start()` faz 5 passos ordenados (register token → `BootMigrator` → `diagnosticarConfiguracao` → `app.listen` → `registerGracefulShutdown`) cuja ordem já causou incidente em 2026-08-10 (ADR-0032 chegou antes da ADR-0044 — chave natural nova contra banco velho).
- **Impacto técnico**: o próprio delta extraiu `gracefulShutdown.ts` **porque** `index.ts` não é testável. A extração parou aí; o `start()` continua monolítico. Qualquer reordenação regride sem defensor.
- **Impacto de negócio**: repetição do padrão do incidente 2026-08-10. Impacto por evento = deploy quebrado em produção detectado só quando bater tabela.
- **Card(s) Kanban relacionados**: `testability-2` (P2, M), `modifiability-3` (P3, M)
- **Custo de inação em 6 meses**: 1 incidente similar ao de 2026-08-10 = 1 rollback emergencial + horas de diagnóstico. Frequência estimada baixa mas custo por evento alto.

### R-7: Contrato `IClient` não cobre `close()` — cada nova integração é uma micro-decisão manual sobre shutdown

- **QA(s) afetados**: Integrability, Modifiability
- **Findings de origem**: F-integrability-1 (P2)
- **Evidência sintetizada**: `IClient` declara só `init()`. `grep implements IClient` → 1 arquivo (`PostgreeDatabaseClient`). `index.ts:161` referencia a classe concreta (`container.resolve(PostgreeDatabaseClient).close()`). Adicionar `NexxeraClient`, `GedClient`, `SharePointClient` (previstos no domínio) exige editar `index.ts` e replicar padrão à mão — estatisticamente, uma vai ser esquecida (foi exatamente o que aconteceu com o `conexosSessionStore` — ver R-1).
- **Impacto técnico**: acoplamento do shutdown ao concreto cresce linearmente com integrações. `PatternGuardian` não tem âncora estrutural para exigir `close()` em novos clients.
- **Impacto de negócio**: cada uma das 3 integrações previstas (Frentes III/IV) vira negociação nova sobre "isso precisa fechar?".
- **Card(s) Kanban relacionados**: `integrability-1` (P2, S) — habilita `integrability-2`
- **Custo de inação em 6 meses**: se a Frente IV (recebimentos/Nexxera) adicionar um `NexxeraClient` com FTP pool sem shutdown coordenado, o vetor do BE-05 volta em superfície nova.

### R-8: Três branches reais de `gracefulShutdown.ts` sem teste — a máquina de estados pode regredir silenciosa

- **QA(s) afetados**: Testability, Fault Tolerance
- **Findings de origem**: F-testability-1 (P2), F-testability-2 (P2), F-testability-5 (P3)
- **Evidência sintetizada**: cobertura de branches = 58,82% (10/17). Extração linha-a-linha do lcov identificou 3 branches "reais" descobertos: (a) callback de `server.close` com `err` — 0 dos 8 testes exercita; (b) guarda `if (exited) return` do `exitOnce` — 0 hit, alguém que remova `clearTimeout` faz `onExit` ser chamado 2×; (c) default `target = process` — wire com sinal real nunca testado.
- **Impacto técnico**: refactor que troque `if (err) log(...)` por `if (err) return` passa em todos os 8 testes. `onExit` duplo pode gerar race com handlers `beforeExit`.
- **Impacto de negócio**: baixo em blast radius, mas exatamente o tipo de bug que só aparece durante um incidente — o handler existe justamente para funcionar sob pressão.
- **Card(s) Kanban relacionados**: `testability-1` (P2, S)
- **Custo de inação em 6 meses**: 1 regressão silenciosa em refactor futuro do handler = 1 deploy patológico que morre sem drain e ninguém percebe.

### R-9: Log de falha do pool no shutdown não passa pelo `redactErrorMessage` — usuário do Postgres pode vazar para drain externo

- **QA(s) afetados**: Security
- **Findings de origem**: F-security-1 (P2)
- **Evidência sintetizada**: `gracefulShutdown.ts:94` — `log('[shutdown] falha ao encerrar o pool: ${asMessage(error)}')` sem redator. O projeto tem `redactErrorMessage` (`http/redact.ts:79`) já usado em `JobExecucaoRepository.ts:92` e `StalenessDetector.ts:165` — os dois outros sítios onde erro de banco pode vazar. Erros do `pg` em `pool.end()` podem trazer `password authentication failed for user "financeiro"`, `connect ECONNREFUSED <host_supabase>:5432` ou connection string embrulhada.
- **Impacto técnico**: stdout do container vai para drain de logs do Render, que pode ser enviado a agregador SaaS terceiro. Baixa probabilidade de execução (só shutdown com pool já quebrado), custo de fix = 1 linha.
- **Impacto de negócio**: exposição de detalhe de infraestrutura em destino com nível de controle possivelmente menor que o processo original. Padrão inconsistente ("uns redigem, outros não") normaliza esquecimento em novos módulos.
- **Card(s) Kanban relacionados**: `security-1` (P2, S)
- **Custo de inação em 6 meses**: baixo direto; alto no padrão — 6 meses = 1 novo módulo `http/` que loga erro do `pg` sem redator porque "o `gracefulShutdown.ts` também não faz".

### R-10: Rollback é manual sem runbook versionado

- **QA(s) afetados**: Deployability
- **Findings de origem**: F-deployability-2 (P2)
- **Evidência sintetizada**: `ls docs/runbooks/ | grep -i rollback` → vazio. `render.yaml` declara `autoDeploy: true`. `DEPLOY.md` não descreve o passo. Rollback existe (dashboard Render), mas depende de memória do operador.
- **Impacto técnico**: quando o deploy passa CI e quebra em prod (cenário típico: Conexos/Supabase só aparecem em prod), o operador reverte pelo dashboard sem passo-a-passo. Sob pressão às 2h da manhã, é onde se erra — especialmente com migrations irreversíveis (a Frente IV vem escrevendo em tabelas novas: reverter código sem reverter schema é seguro; o contrário não é).
- **Impacto de negócio**: MTTR maior em cada incidente pós-deploy.
- **Card(s) Kanban relacionados**: `deployability-2` (P2, S)
- **Custo de inação em 6 meses**: o próximo deploy que quebrar em prod é só questão de tempo; improvisação em rollback de schema é como se descobre corrupção de dados.

## 3. Cross-cutting findings

Pontos onde a mesma causa-raiz aparece em múltiplos QAs. As Notas do agente de cada seção
sinalizaram esses cross-links; os agrupei aqui para o consolidator dar 1 card por
causa-raiz onde faz sentido.

### CC-1: Ciclo de vida de recursos externos não uniformizado no contrato — o delta corrigiu 1 sítio, deixou 1 (identificado) e a próxima integração vai repetir

- **Aparece em**: Integrability, Modifiability, Availability, Fault Tolerance, Deployability
- **Findings**: F-integrability-1 (P2, contrato `IClient` só tem `init()`), F-integrability-2 (P1, `conexosSessionStore` bypassa shutdown), F-modifiability-3 (P3, `index.ts` acopla shutdown ao concreto)
- **Diagnóstico unificado**: o delta ensinou o `PostgreeDatabaseClient` a fechar (BE-05) e o processo a solicitar fechamento (BE-06), mas fez isso por acoplamento direto no `index.ts:161`. O contrato do que "é um client" continua declarando apenas `init()`. O `conexosSessionStore` prova, no primeiro sítio verificado, que o custo dessa lacuna é real e imediato: `pool.on('error', () => undefined)` **é** o padrão que o BE-05 mostrou insuficiente. As três integrações previstas (Nexxera, GED, SharePoint) vão negociar cada uma seu próprio padrão de shutdown.
- **Recomendação consolidada**: **par de cards `integrability-1` + `integrability-2`.** O primeiro (P2, S) estende `IClient` com `close?()` opcional e introduz `LifecycleRegistry`; o segundo (P1, S) coloca o pool secundário sob o contrato e replica a defesa do BE-05 (chamar `pool.end()` no handler de `error`, não só `() => undefined`). Ordem sugerida: `integrability-1` primeiro (habilita), `integrability-2` em cima.

### CC-2: Observabilidade do shutdown ausente — o BE-06 corrigiu o mecanismo, mas não o instrumento

- **Aparece em**: Fault Tolerance, Availability, Performance, (parcialmente) Testability
- **Findings**: F-fault-tolerance-2 (P2, force-exit invisível), F-availability-3 (P3, duração de drain não instrumentada), F-performance-3 (P3, latência HTTP/query sem histograma), F-testability-1 (P2, wire real com `process.on` sem cobertura E2E)
- **Diagnóstico unificado**: o handler emite 4 logs `[shutdown] ...` para `console.log`; nenhum vira contador/histograma/alerta. `DEFAULT_DRAIN_TIMEOUT_MS = 10_000` foi calibrado contra uma janela SIGTERM→SIGKILL declarada como "~30 s" em comentário — não verificada aqui. Sem série temporal, calibração é palpite; sem alerta, regressão de performance de escrita passa até o `reaper-sispag` limpar (15 min–1 h de latência).
- **Recomendação consolidada**: **card único preferencial `fault-tolerance-2` (P2, S)** — leva o force-exit ao `LogService` (`OPERATIONAL_WARN`), com dedupe via `AlertaService`. Como investimento maior e complementar, `availability-3` (P3, M) cria tabela `shutdown_event` com `duracao_drain_ms`/`motivo_saida` + painel; `performance-2` (P3, M) instrumenta histograma p50/p95/p99. O `fault-tolerance-2` sozinho já resolve o cenário "regressão silenciosa de deploy"; os outros dois são pré-requisito para calibração baseada em número, não em teoria.

### CC-3: `/health` durante drain não coordena com o LB — F-availability-1 e F-deployability-1 são a mesma coisa

- **Aparece em**: Availability, Deployability
- **Findings**: F-availability-1 (P2), F-deployability-1 (P3)
- **Diagnóstico unificado**: a flag `shuttingDown` vive no closure do handler; `/health` (a rota do LB do Render, `healthCheckPath: /health` em `render.yaml:22`) não consulta. Availability leu como P2 porque, mesmo em single-instance, requisições podem entrar por keep-alive já abertas na janela. Deployability leu como P3 porque, em single-instance, o próprio Render só faz cutover quando o novo container está verde — a resposta 200 no antigo é ignorada. **Ambas as leituras estão corretas**; a divergência de severidade é útil: hoje é P3, no dia do upgrade de plano vira P2 sem aviso.
- **Recomendação consolidada**: **card único `availability-1` (P2, S)** — expor módulo `readinessState` com `isDraining()`, chamar `markDraining()` no início do handler, `/health` devolve 503 quando `isDraining()`. Torna irrelevante a topologia (single-instance ou não) e resolve os dois findings de uma vez.

### CC-4: `index.ts` monolítico — ordem crítica sobrevive só por convenção; a extração começou pelo shutdown mas não terminou

- **Aparece em**: Testability, Modifiability
- **Findings**: F-testability-3 (P2), F-modifiability-3 (P3)
- **Diagnóstico unificado**: o delta extraiu `gracefulShutdown.ts` para módulo próprio **porque** `index.ts` executa `start()` no top-level. O `start()` mesmo continua monolítico: 5 passos ordenados cuja ordem já causou incidente em 2026-08-10 (ADR-0032 chegou antes da ADR-0044). Testability leu como P2 porque o efeito colateral é "0 cobertura em `index.ts`, 0 defensor de ordem"; Modifiability leu como P3 porque 198 LOC ainda cabem no p95 do repo. Cross-cutting com R-6.
- **Recomendação consolidada**: **card único `testability-2` (P2, M)** — extrair `startServer(deps)` para `http/bootstrap.ts` (padrão espelhado do próprio `gracefulShutdown.ts` do delta), com teste que valida a ordem via array `order.push(...)`. `modifiability-3` (P3, M) é a próxima etapa do mesmo split, saindo do escopo mínimo do tweak.

### CC-5: BE-09 fecha um vetor real de supply chain — mas a lição pode ser esquecida sem contrato do package.json

- **Aparece em**: Deployability, Security, Testability
- **Findings**: cross-QA sinalizado em `qa-security` §6, `qa-deployability` §2 (métrica `grep '"npx ' src/backend/package.json' → 0`), `qa-testability` §2.2 (reprodução controlada: `lint` era o único gate falso-verde). Sem finding numerado — o problema **foi corrigido** pelo delta.
- **Diagnóstico unificado**: `npx <bin>` em worktree sem `node_modules` baixa e executa código do registry (supply chain) **e** sai 0 quando o cache está vazio de forma inesperada (gate que mente). Como worktree é a Inviolable Rule #10, o vetor mordia toda feature nova. O delta corrigiu os scripts oficiais; sobram ~40 docstrings `Run: npx tsx jobs/...` (F-security-2, P3) e a possibilidade de qualquer dev reintroduzir `"lint:extra": "npx biome ..."` sem gate.
- **Recomendação consolidada**: **par preventivo `testability-3` (P3, S)** — teste que carrega `package.json` e falha se algum script crítico começa com `npx `; e **`security-2` (P3, M)** — reescrever docstrings `Run:` para `node --loader tsx` ou promover jobs recorrentes para `scripts` do `package.json`. Ambos baratos, cobrem a superfície residual.

## 4. Quick wins (≤5 dias úteis)

Cards com esforço S e severidade ≥ P2, ordenados por leverage (impacto ÷ esforço):

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| `integrability-2` | Integrability | S | **P1** | Segundo pool Postgres do `conexosSessionStore` fecha no SIGTERM; handler `error` chama `end()` como o primário; **0 → 0** sessões residuais por deploy no pooler Supabase (baseline a instrumentar) |
| `integrability-1` | Integrability + Modifiability | S | P2 | `IClient` cobre `close?()`; `LifecycleRegistry` desacopla shutdown do concreto; próximas 3 integrações (Nexxera, GED, SharePoint) participam automaticamente do shutdown |
| `availability-1` | Availability + Deployability | S | P2 | `/health` devolve 503 durante drain; LB tira instância do pool antes do drain; resolve F-availability-1 e F-deployability-1 num só card |
| `availability-2` | Availability | S | P2 | `server.closeIdleConnections()` no início do drain; drain termina em ~100 ms no caso comum em vez de sempre estourar 10 s |
| `fault-tolerance-1` | Fault Tolerance + Availability | S | P2 | `DEFAULT_DRAIN_TIMEOUT_MS` sobe de 10 s para 25 s; 4 clientes Conexos ganham `timeout: 20_000` no `axios.create`; envelope Render usado passa de 33% para 83% |
| `fault-tolerance-2` | Fault Tolerance + Availability + Performance | S | P2 | Force-exit vira `OPERATIONAL_WARN` no `LogService` → aparece em `/operacao`; regressão de perf de escrita financeira deixa de ser invisível |
| `security-1` | Security | S | P2 | `redactErrorMessage` aplicado no log de falha do pool no shutdown; 0 de 1 → 1 de 1 caminhos de log de erro em `http/` seguem o padrão |
| `performance-1` | Performance + Availability | S | P2 | Budget de sessões Supabase documentado em `DEPLOY.md`; alerta `sessoes_ativas > 0.7 × teto` no painel |
| `testability-1` | Testability | S | P2 | Branches "reais" de `gracefulShutdown.ts` cobertos: 3 → 0; cobertura de branches sobe de 58,82% para ≥82% |
| `deployability-2` | Deployability | S | P2 | `docs/runbooks/rollback.md` versionado; operador reverte deploy quebrado em ≤5 min sem consultar terceiros |
| `deployability-3` | Deployability | S (opção b) | P2 | Divergência `render.yaml` × dashboard eliminada (comentário no YAML apontando para `BootMigrator`) |

**11 cards, todos S.** Aceitáveis como primeira sprint pós-aprovação. O `integrability-2`
é o único P1 — deve ser o primeiro do lote.

## 5. Strategic moves (M / L / XL)

Cards de maior fôlego. "Por que vale" precisa amarrar a número — não a boa prática.

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| `testability-2` | Testability + Modifiability | M | Limit Structural Complexity + Executable Assertions | `index.ts:198 LOC / 30 imports / 0% cobertura`. Já causou incidente documentado em 2026-08-10 (ADR-0032 antes da ADR-0044). Extração de `bootstrap.ts` reduz `index.ts` para ≤40 LOC e habilita ≥4 testes de ordem. Sem isso, próxima reordenação de boot é regressão silenciosa. |
| `modifiability-3` | Modifiability + Testability | M | Split Module | Continuação natural do `testability-2` — separa `buildApp()` de `startServer()`. Preparo para o alvo Lambda do CLAUDE.md §"Estado Atual vs. Alvo": `app.ts` vira o handler wrapper, `server.ts` fica de fora. Reduz cognitiva de cada tweak futuro que toque boot. |
| `availability-3` | Availability + Fault Tolerance | M | Monitor | `DEFAULT_DRAIN_TIMEOUT_MS = 10_000` foi calibrado contra "~30 s" declarado em comentário, não medido. Tabela `shutdown_event` (padrão do `job_run`) + painel = 0 métricas de shutdown exportadas → ≥3. Sem isso, se o Render mudar a janela (a fonte é comentário, não docs), o time só descobre por incidente. |
| `performance-2` | Performance + Availability | M | Monitor | 0 métricas p95/p99 exportadas hoje; o único registro de duração é `console.log('[RES] ... (Xms)')`. Qualquer card futuro fica sem `p95 antes → p95 depois` para provar/refutar. O próprio delta corrigiu um P1 (BE-05) sem que fosse possível validar por métrica de produção. |
| `security-2` | Security | M | Limit Exposure | ~40 docstrings `Run: npx tsx` em jobs one-off — mesmo vetor do BE-09, em superfície residual. Custo mecânico: reescrever `Run:` para `node --loader tsx` **ou** promover jobs recorrentes para `job:*` no `package.json`. Mantém a lição do BE-09 valendo em toda a superfície, não só em CI. |
| `testability-4` | Testability | S–M | Executable Assertions | Threshold FE fixo em 20%/9%/14% desde 2026-06-26. Ratchet mensal (script + workflow) transforma o piso em executável evolutivo. Meta 6 meses: 20% → 40% linhas. Sem isso, a dívida de cobertura FE vira permanente sem que ninguém veja. |

## 6. O que está bem (e por quê)

Reuniões defensivas frequentemente caem em "tudo está ruim". Aqui não está. **Este delta é
um exemplar do que deveria acontecer todo mês**:

1. **`gracefulShutdown.ts` é um exemplar canônico de 3 tactics do Bass simultaneamente**
   (Reduce Coupling / Use an Intermediary + Encapsulate + Split Module). Contrato
   `GracefulShutdownDeps` com 3+2 parâmetros; fan-in 1; 0 imports do próprio repo; 100%
   lines cobertas. — cf. Modifiability §6.
2. **BE-05 corrigido com prova de teste do modo de falha antes inalcançável.** O mock antigo
   descartava `pool.on('error')`. O delta refez o mock para capturar listeners e emite o
   evento de dentro do teste — 4 testes novos exercitam o caminho pelo primeira vez. —
   cf. Testability §2.
3. **Idempotência do handler testada explicitamente.** `gracefulShutdown.test.ts:74-90`
   "ignores a second signal"; `PostgreeDatabaseClient.test.ts` "ends the pool only once
   when the error event fires repeatedly". Invariante temporal virou spec. — cf.
   Testability §3.
4. **BE-09 foi um gate que mentia — corrigido no repositório inteiro, não só no arquivo do
   incidente.** `grep '"npx ' src/backend/package.json src/frontend/package.json .github/workflows/`
   → 0. Reprodução controlada confirmou: 7 dos 8 gates já falhavam corretamente;
   o 8º (lint backend) subiu de "silêncio → 0" para "biome: not found → 127". — cf.
   Testability §2.2, Security §2.
5. **Ordem `close → drain → pool.end → exit(0)` validada por teste com `order.push(...)`.**
   Sequência não é convenção documentada — é asserção executável. — cf. Testability §3.
6. **`unref()` no timer de force-exit** garante que o próprio timer não segura o event
   loop — teste dedicado (`gracefulShutdown.test.ts:151-165`). Não vira zumbi.
   — cf. Fault Tolerance §2.
7. **Guarda de identidade `if (this.connectionPool === pool)`** no handler `error` do pool
   — evita zerar pool novo criado pelo `init()` no meio. Comentário de 8 linhas contextualiza.
   Coberto por teste. — cf. Availability §3 (Sanity Checking), Fault Tolerance §3 (Comparison).
8. **Nenhum warning novo de complexidade cognitiva do Biome nos 3 arquivos do delta.**
   Total do repo permanece em 66 warnings (mesmo número do baseline com 447 arquivos, agora
   com 449). O delta é neutro-a-limpo para o linter. — cf. `_shared-metrics.md`, Modifiability §2.

## 7. Limitações da análise

Explicitando o que este run **não** cobre:

**Métricas declaradas como "não medíveis localmente" pelos agentes** — todas registradas
como recomendação para instrumentação nos cards indicados:

- Duração real do drain em produção (`gracefulShutdown` loga, mas ninguém agrega). Card
  cobre: `availability-3`, `fault-tolerance-2`.
- Janela real SIGTERM→SIGKILL do Render (número "~30 s" está em comentário do código,
  não em docs verificadas neste run).
- Contagem histórica de runs órfãs em `reconciling` atribuíveis a deploy — requer query em
  `job_run` cruzada com timestamps de deploy do Render. Sem baseline, o efeito do BE-06 é
  argumentado, não medido.
- Sessões residuais reais no pooler Supabase por deploy — requer `pg_stat_activity` recortado
  por janela SIGTERM. Card cobre: `integrability-2` (com validação).
- Teto real do plano Supabase (`max_client_conn` do Session pooler) — requer print do
  dashboard Supabase. Card cobre: `performance-1`.
- p50/p95/p99 de latência HTTP e de query Postgres — o app loga `RES ... (Xms)` mas não há
  APM/CloudWatch. Card cobre: `performance-2`.

**O que o pipe NÃO cobre** (fora do escopo do Regis-Review Bass & Clements):

- Chaos engineering (nenhum teste de injeção de falha em produção).
- Threat modeling formal (o QA de Security cobriu vetores do delta, não STRIDE completo do repo).
- Custo/orçamento cloud (não há métrica de $/mês do Supabase/Render/Vercel neste review).
- UX / acessibilidade (frontend fora do escopo do delta).

**Janela temporal**: snapshot do dia 2026-09-03; código é vivo — refazer trimestralmente,
ou sempre que um tweak tocar `PostgreeDatabaseClient`, `gracefulShutdown`, `index.ts` ou o
`conexosSessionStore`.

**Nenhum card foi renomeado nem editado.** IDs no KANBAN.md batem 1:1 com os IDs das
seções (`availability-1..3`, `deployability-1..3`, `integrability-1..3`, `modifiability-1..3`,
`performance-1..3`, `fault-tolerance-1..3`, `security-1..2`, `testability-1..4`).

## 8. Ações recomendadas

Ordem de execução para os 30 dias seguintes. Referências cruzadas com os cards. **Nenhum
P0 → o gate do pipeline passa; a lista abaixo é o próximo bloco de trabalho, não pré-condição
para merge.**

1. **Fechar o par CC-1 antes de qualquer feature nova de integração** — `integrability-1` (P2,
   S) + `integrability-2` (P1, S). O segundo é o único P1 do run e é a mesma classe de bug
   que o delta corrigiu, em outro sítio. Custo total: ≤2 dias.
2. **Endereçar o cluster de observabilidade de shutdown** — `fault-tolerance-2` (P2, S) é
   o mínimo essencial: leva o force-exit ao `LogService` e ao painel. Sem ele, cards R-3/R-4/R-5
   ficam sem prova antes/depois. `availability-3` (P3, M) e `performance-2` (P3, M) são a
   camada seguinte, sem urgência.
3. **Coordenar o drain com o LB** — `availability-1` (P2, S) resolve F-availability-1 e
   F-deployability-1 num só card, com custo de 1 dia. Combina com `availability-2` (P2, S) —
   ordem: `availability-1` primeiro (LB tira do pool), `availability-2` depois (keep-alive
   fecha).
4. **Recalibrar timeouts do stack** — `fault-tolerance-1` (P2, S) sobe `DEFAULT_DRAIN_TIMEOUT_MS`
   para 25 s **e** adiciona `timeout:` explícito nos 4 clientes Conexos. Não fazer as duas
   coisas juntas cria assimetria: subir só o drain estica o problema; subir só o axios pode
   deixar drain estourar antes do timeout do client. Custo: ≤1 dia.
5. **Documentar o rollback e destravar operações noturnas** — `deployability-2` (P2, S) +
   `deployability-3` (P2, S opção b). Ambos custos de horas; ambos removem improvisação sob
   pressão.

**Fora do bloco de 30 dias**, entra a agenda de M (Split do `index.ts` — `testability-2` +
`modifiability-3`) e a instrumentação série-temporal (`availability-3`, `performance-2`).
Essas são as decisões arquiteturais que o delta preparou o terreno para tomar; não são urgentes,
mas ancoram o próximo trimestre.
