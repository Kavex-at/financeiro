# tapar-furos-backend — follow-ups do Regis-Review

---

# Rodada 4 — varredura final: **todos os cards fecháveis, fechados**

> Pedido do Yuri: *"feche os p1 em aberto… quero revisar os mínimos detalhes e resolver, até mesmo
> os outros não prioritários"*. Fechados os 2 P1 pendentes da rodada 3 **e os P2/P3 dos dois runs**.

## Fechados nesta rodada

| Card | Run | O que foi feito |
|---|---|---|
| `availability-1` | r3 (**P1**) | Eventos do pool vão para o `LogService` (`OPERATIONAL_WARN`) via sink injetado — o módulo legado não conhece o container. Fim da assimetria com o force-exit. |
| `testability-1` | r3 (**P1**) | Mock de `pg` endurecido: `query` **rejeita** após `end()`. Era o sensor cego que deixou o defeito da rodada 2 passar verde. |
| `availability-2` | r3 | Janela mínima de 5s entre reconstruções. Sem ela, pooler fora do ar = `openPool()` por chamada, cada uma pagando 5s de `connectionTimeoutMillis`. |
| `fault-tolerance-3` | r3 | `getSessionStorePoolStats()` — contador de rebuilds, pools abertos, estado. |
| `fault-tolerance-1` | r3 | `storeClosed`/`ultimoRebuildEm`/`rebuildsTotal` resetados explicitamente na factory, com o porquê escrito. |
| `fault-tolerance-4` | r3 | A janela mínima **é** a quarentena; um circuit breaker completo seria peso sem medição que o justifique. |
| `integrability-1` | r3 | `NamedCloseable`: o drain agora diz **qual** recurso falhou. "Algo não fechou" é inútil às 2h da manhã. |
| `integrability-2` | r3 | `processResources.test.ts` — trava a contagem de recursos; acrescentar um sem atualizar o teste falha. |
| `integrability-3` | r3 | `redactErrorMessage` mudou-se para `domain/libs/redact/`; os 3 consumidores fora de `http/` repontados. `http/redact.ts` reexporta. |
| `security-2` | r3 | Padrões novos: `ECONNREFUSED <ip>:<porta>`, `ENOTFOUND <host>`, `ETIMEDOUT`, `EHOSTUNREACH`. |
| `security-3` | r3 | O `private warn` do store ganhou o redator. **Os 3 sítios de log do arquivo agora redigem** — zero assimetria. |
| `testability-3` | r3 | Pisos de cobertura **por arquivo** no `jest.config.cjs` para pool/shutdown/boot. |
| `availability-3` | r1 | Coberto pelo contador + eventos estruturados. |
| `deployability-1` | r1 | Já fechado na rodada 2 (`/health` → 503). |
| `integrability-3` | r1 | Documentado **no código** por que a sessão do Conexos não é encerrada no SIGTERM (`processResources.ts`): o `sid` é compartilhado com os 6 crons; deslogar dispararia kill-oldest em cascata. |
| `modifiability-1` | r1 | `endPoolQuietly` / `endPoolQuietlyAsync` em `domain/libs/pool/` — o idiom estava em 3 sítios. |
| `modifiability-2` | r1 | `SHUTDOWN_DRAIN_TIMEOUT_MS` por env, com fallback seguro (valor inválido → default, nunca "sem teto"). |
| `modifiability-3` | r1 | `http/buildApp.ts` extraído. **`index.ts`: 235 → 95 linhas**, só wiring. +5 testes de ordem de middleware. |
| `fault-tolerance-3` | r1 | `http/lastResortHandlers.ts` — `unhandledRejection`/`uncaughtException` drenam antes de sair, com código **1**. |
| `security-2` | r1 | 40 arquivos de job: `npx tsx` → `tsx` nas docstrings. Zero `npx` no backend. |
| `testability-3` | r1 | `scripts.gate.test.ts` — falha se qualquer script voltar a usar `npx`. Trava a classe do BE-09 em zero. |
| `testability-4` | r1 | Ratchet do frontend: 20/9/14 → **33/23/28** (o real é 35,11/25,02/29,67 — o piso estava ~15 pontos abaixo e não travava nada). |

## O que continua em aberto, e por quê

Quatro itens, todos bloqueados por **dado ou decisão que não é minha**:

1. **Probe de sessões do Supabase** (`performance-1`, r2). O budget está no `DEPLOY.md` (49 no pior
   caso). Falta o alerta a 70% do teto — e o **teto real** só existe no dashboard do Supabase
   (Project Settings → Database → Connection pooling → **Pool size**). Sem esse número o alerta não
   tem contra o que comparar, e inventá-lo seria pior que não ter.
2. **Histograma p50/p95/p99 de latência** (`performance-2`, r1). Exige infra de métrica que o
   projeto não tem (hoje é `console.log` de duração). Fazer direito é escolher destino — Prometheus,
   OTel, tabela própria — e isso é decisão de arquitetura, não card de follow-up.
3. **Timeout do axios do Conexos × teto de drenagem** (r2). O ERP tem `timeout: 40000` e o drain
   agora é 25s: uma chamada que passe de 25s ainda é cortada. Alinhar exige **medir** a latência
   real do Conexos; baixar 40s→20s às cegas é mudança de comportamento de negócio.
4. **Upgrade de plano do Render** (`deployability-3`, opção (a)). Decisão comercial.

---

# Rodada 3 — Regis-Review `2026-09-03-2015-session-store-pool`

**Veredito: 0 P0 → o gate passa.** Escopo: 1 arquivo (`services/conexosSessionStore.ts`).
Seções em `docs/regis-review/2026-09-03-2015-session-store-pool/`.

> **Desvio de processo declarado:** rodei **5 dos 8 QAs** (fault-tolerance, availability,
> integrability, security, testability). Deployability, modifiability e performance não têm o que
> dizer sobre ~50 linhas num único módulo cuja infra de deploy não mudou, e o mesmo código já passou
> pelo pipeline completo no run `2026-09-03-1901`. Não rodei o `qa-consolidator`, que exige as 8
> seções — por isso não há `REPORT.md`/`KANBAN.md` neste run. Se o Yuri quiser o run canônico, peça.

| QA | Score | P0 | P1 | P2 | P3 |
|---|---:|---:|---:|---:|---:|
| Fault Tolerance | 8,4 | 0 | 0 | 1 | 3 |
| Integrability | 8,4 | 0 | 0 | 2 | 1 |
| Availability | 7,5 | 0 | **1** | 2 | 0 |
| Security | 7,5 | 0 | 0 | 2 | 1 |
| Testability | 7,5 | 0 | **2** | 2 | 1 |

## Fechado ainda na rodada (dívida que eu criei ou toquei)

- **`security-1` (P2)** — o `console.warn` do `catch` da construção do Pool logava `${detail}` cru.
  É o caminho **mais** perigoso dos dois: quem lança ali é o parser da connection string, e ele põe
  a URL de entrada, **com a senha**, dentro da mensagem. A linha era pré-existente, mas foi este
  delta que criou a inconsistência (redigido a 25 linhas de distância) — migração proporcional de
  dívida, conforme o CLAUDE.md. Coberto por teste com asserção negativa sobre a senha.
- **`testability-4` (P2)** — `poolHolders` nunca era esvaziado; o Set crescia a cada
  `buildSessionStoreFromEnv` e nunca encolhia. Bug **meu, desta rodada**. `poolHolders.clear()`.
- **`testability-2` (P1)** — o fail-open da construção do Pool não tinha teste. É o contrato que a
  docstring do módulo promete ("o store NUNCA pode derrubar a integração com o Conexos") e que
  ninguém garantia. Coberto pelo mesmo teste da redação acima.

## Em aberto

### P1

- **`availability-1`** — o `console.warn` do rebuild fica fora do canal estruturado, enquanto o
  force-exit do shutdown, **no mesmo delta**, vai para `LogService` com `OPERATIONAL_WARN`. A
  assimetria é real: shutdown estourado aparece em `/operacao`, pool flapando não. Um pooler que
  reinicia clientes ociosos a cada 30s produziria dezenas de rebuilds por hora afogados no drain de
  logs do Render. **Não implementei** porque o coordenador pediu escopo mínimo e "não logar de forma
  ruidosa" — decidir o que merece alerta no painel é escolha de produto, não de infra. Recomendo
  fazer: é o mesmo hook que o `onForceExit` já usa.
- **`testability-1`** — o mock de `pg` **não simula pool encerrado**: `pool.query` segue resolvendo
  depois do `end()`. Foi por isso que o defeito da rodada 2 passou verde. O teste novo discrimina
  contando `createdPools`, mas por **convenção do autor**, não por construção. Endurecer o mock para
  rejeitar query após `end()` cobriria a classe inteira.

### P2/P3

`fault-tolerance-3` (nenhum contador de rebuild — o único sinal de que a frota caiu em "miss" é
stdout) · `availability-2` (Retry sem backoff nem teto: pooler indisponível faz `openPool()` a cada
query, cada uma pagando ~5s de `connectionTimeoutMillis`) · `integrability-1` (o drain perde a
identidade do closeable no log de erro) · `integrability-2` (`resources()` do `processResources.ts`
não tem teste — nada impede o segundo esquecimento) · `integrability-3` (`services/` importando de
`http/redact.js` inverte camada; já são 3 sítios, resolver movendo o redator para `utils/`) ·
`security-2` (o redator não cobre `ECONNREFUSED <ip>:<porta>` nem `ENOTFOUND <host>.supabase.com` —
topologia, não credencial) · `security-3` (o `private warn` do store, pré-existente, sem redator) ·
`testability-3` (sem threshold de cobertura específico do arquivo) · `fault-tolerance-1`
(`buildSessionStoreFromEnv` reseta `storeClosed = false` incondicionalmente — inofensivo em produção,
onde a factory roda uma vez no import, mas derrotaria o drain se alguém a reinvocasse) ·
`fault-tolerance-4` (quarentena / circuit breaker).

## O julgamento honesto que o QA de Fault Tolerance devolveu

> *"É parcialmente teatro, sim."*

O `pg` **se cura sozinho** de erro em cliente ocioso: remove o cliente e segue com os restantes do
`max: 2`. O ganho **real** desta rodada sobre o `() => undefined` original é o **warn redigido** — o
erro deixou de ser invisível. O `end()` + reconstrução é defensável se o cenário dominante em
produção for restart do pooler Supabase, e é churn se for socket ocioso isolado. **Ninguém sabe qual
domina, porque não medimos.** Vale instrumentar (`fault-tolerance-2`) antes de defender o design.

O que **não** é teatro, e era o furo de verdade: as 2 conexões agora voltam no SIGTERM, e a rodada 2
sozinha teria deixado o store cego para sempre.

---

**Run:** `2026-09-03-1901-tapar-furos-backend`
**Relatórios:** `docs/regis-review/2026-09-03-1901-tapar-furos-backend/REPORT.md` e `KANBAN.md`
**Branch:** `fix/tapar-furos-backend` · commits `e575221` + `e974796`
**Escopo do review:** restrito ao delta (5 arquivos), `--quick`.

## Veredito do gate

**Score consolidado 8,07/10. ZERO findings P0 → o gate do pipeline PASSA.**

| QA | Score | P0 | P1 | P2 | P3 |
|---|---:|---:|---:|---:|---:|
| Availability | 8,0 | 0 | 0 | 2 | 1 |
| Deployability | 8,0 | 0 | 0 | 2 | 1 |
| Integrability | 7,5 | 0 | **1** | 1 | 1 |
| Modifiability | 8,5 | 0 | 0 | 0 | 3 |
| Performance | 8,5 | 0 | 0 | 1 | 2 |
| Fault Tolerance | 8,0 | 0 | 0 | 2 | 1 |
| Security | 8,0 | 0 | 0 | 1 | 1 |
| Testability | 8,0 | 0 | 0 | 2 | 2 |
| **Total** | **8,07** | **0** | **1** | **11** | **12** |

> **ATUALIZAÇÃO — rodada 2.** O Yuri autorizou explicitamente fechar o P1 e os P2 ("close the p1
> and p2"), suspendendo a política padrão do pipe para esta rodada. **O P1 e os 11 P2 foram
> implementados** — ver "Fechados na rodada 2". Restam os **12 P3**, mais **3 follow-ups novos** que
> a própria remediação produziu.

Política padrão do pipe (suspensa aqui por autorização direta): P1/P2/P3 viram follow-up.

---

## Fechados na rodada 2

| Card | Prio | O que foi feito |
|---|---|---|
| `integrability-2` | **P1** | O pool do `conexosSessionStore` passou a encerrar-se no handler de `error` (era `() => undefined`, a assinatura do BE-05) e entrou no shutdown via `closeConexosSessionStorePool()`. Pools cobertos: **1 de 2 → 2 de 2**. |
| `integrability-1` | P2 | `IClient` ganhou `close?()`; `http/lifecycle.ts` fecha a coleção em paralelo sem nunca rejeitar. O `index.ts` deixou de acoplar o shutdown à classe concreta. |
| `availability-1` | P2 | `http/readinessState.ts`; `/health` responde **503** durante o drain. `/health/pipelines` intocado. |
| `availability-2` | P2 | `server.closeIdleConnections()` antes do `server.close`, com guarda para runtimes sem o método. |
| `fault-tolerance-1` | P2 | `DEFAULT_DRAIN_TIMEOUT_MS` **10s → 25s** (~83% do envelope do Render). **Divergência do card** — ver abaixo. |
| `fault-tolerance-2` | P2 | `onForceExit` publica o estouro de drenagem como `OPERATIONAL_WARN` no `LogService`; exit code segue 0. |
| `security-1` | P2 | `redactErrorMessage` aplicado em todo log de erro do shutdown. Caminhos em `http/` sem redator: **1 → 0**. |
| `testability-1` | P2 | Os 3 branches reais cobertos (erro no `server.close`, guarda de `exitOnce`, default `target = process`). |
| `testability-2` | P2 | `http/bootstrap.ts` + 5 testes de **ordem** do boot; `index.ts` deixou de conter a sequência. |
| `performance-1` | P2 | Tabela de budget de sessões no `DEPLOY.md` (49 no pior caso). Probe fica como follow-up. |
| `deployability-2` | P2 | `docs/runbooks/rollback.md`, com a regra código-vs-schema no topo. |
| `deployability-3` | P2 | `preDeployCommand` órfão removido do `render.yaml`; `DEPLOY.md` corrigido (dizia a mesma coisa errada). Fontes divergentes: **2 → 1**. |

### Follow-ups NOVOS gerados pela rodada 2

1. **Timeout do axios do Conexos × teto de drenagem** (do `fault-tolerance-1`). O card mandava somar
   `timeout: 20_000` a quatro clients e derivar `drain = maior_timeout + 5s`. **Medido: os clients
   não criam instância axios** — há **uma**, em `src/backend/services/conexos.ts:121`, já com
   `timeout: 40000`. Seguir o card daria drain de 45s, acima do envelope de ~30s do Render. E baixar
   40s→20s é mudança de comportamento de negócio (chamadas longas ao ERP passariam a abortar), que
   não se faz sem medir a distribuição real de latência do Conexos. **Feito:** drain em 25s.
   **Pendente:** medir a latência do ERP e então alinhar os dois números. Enquanto isso, uma chamada
   que passe de 25s ainda é cortada no drain.
2. **Probe de sessões do Supabase** (do `performance-1`). O budget está documentado; falta o alerta
   a 70% do teto. **Bloqueado por um dado que eu não tenho:** o **Pool size** do Session pooler, em
   Project Settings → Database → Connection pooling no dashboard do Supabase. Preencher o
   `DEPLOY.md §1` primeiro; sem o teto real, o alerta não tem contra o que comparar.
3. **Upgrade de plano do Render** (opção (a) do `deployability-3`). Habilitaria `preDeployCommand`
   de verdade e tornaria o `BootMigrator` dispensável. É decisão comercial, não técnica.

### Critério cumprido apenas em parte — `testability-2`

O card pedia duas coisas, e só uma foi feita:

| Critério do card | Situação |
|---|---|
| ≥ 4 testes cobrindo a ordem do boot | ✅ **5 testes** em `http/bootstrap.test.ts` |
| Passos do boot fora de teste: 5 → 0 | ✅ os 5 passos são asserção executável |
| LOC de `src/backend/index.ts`: ~180 → ≤ 40 | ❌ **209 linhas** |

O que importava — a **sequência** de boot, invariante documentada e não testada que já causou o
incidente de 2026-08-10 — está extraída e coberta. O que não caiu foi o tamanho do arquivo, porque
o que sobra no `index.ts` é o wiring do Express (middlewares, CORS, rate-limit, ~12 routers), que
não é boot e não estava no escopo deste card. Extraí-lo é o card **`modifiability-3`** (`buildApp()`
+ `startServer()`), que é **P3 e segue aberto**. Contar o LOC como cumprido aqui seria contar o
trabalho do outro card.

---

## Resolvido DENTRO deste ciclo (não é follow-up)

### `[performance-3]` — pool congelado antes das retentativas → **FEITO** (commit `e974796`)

Este card não é dívida: era uma **regressão que o próprio BE-05 introduzia**, e por isso foi
remediado ainda no ciclo em vez de virar follow-up. `query` congelava
`const pool = this.connectionPool` fora do `RetryExecutor`. Enquanto o handler de `error` apenas
soltava a referência, o pool congelado seguia utilizável e a retentativa funcionava; depois de
passar a encerrá-lo de fato, a 2ª tentativa bateria em `Cannot use a pool after calling end on the
pool` — trocando erro recuperável por definitivo exatamente no caminho que o retry existe para
salvar. A `init()` passou para dentro do executor e há teste de regressão
(`retries against a NEW pool after the broken one was ended`).

---

## P1 — entra primeiro na janela pós-merge

### `[integrability-2]` Encerrar o pool secundário do `conexosSessionStore` no shutdown

- **Origem:** `F-integrability-2` (Integrability 7,5). Cross-QA: Availability, Fault Tolerance, Deployability. É o **R-1** do REPORT.
- **Achado:** `src/backend/services/conexosSessionStore.ts:242-256` cria um **segundo** `Pool` Postgres (`max: 2`) no load do módulo, com handler `pool.on('error', () => undefined)` — **literalmente a assinatura do BE-05 que este tweak acabou de corrigir no cliente primário**. Esse pool não é conhecido pelo `gracefulShutdown`, então cada SIGTERM deixa até 2 sessões penduradas no pooler até o `idleTimeoutMillis`.
- **Por que importa:** o laço de retro-alimentação do BE-05 (esgotamento → erro classificado como transitório → mais conexões) continua **armado** num segundo sítio, em escala menor (`max: 2` vs `max: 5`).
- **Esforço:** S. Aplicar o mesmo `pool.end()` com guarda de reentrada e plugar no shutdown.
- **Nota do agente Backend:** este é o achado mais valioso do run. O tweak corrigiu o sítio que eu fui mandado corrigir; a busca por outros sítios da mesma classe não estava no escopo e encontrou este. Recomendo tratá-lo como continuação direta, não como backlog.

---

## P2 — janela seguinte

| Card | QA | Achado | Esforço |
|---|---|---|---|
| `[availability-1]` | Availability | `/health` responde 200 durante o drain; a flag `shuttingDown` vive num closure isolado e nenhum endpoint a lê. Sem sinal de readiness, o LB pode mandar requisição nova para uma instância que está descendo. | S |
| `[availability-2]` | Availability | `server.close()` não fecha conexões keep-alive **ociosas** (`closeIdleConnections`/`closeAllConnections`: 0 ocorrências no repo). Isso pode fazer o caminho feliz virar o degenerado — todo drain estourando os 10s. | S |
| `[deployability-2]` | Deployability | Rollback é manual no dashboard do Render, sem runbook versionado (`docs/runbooks/` não tem rollback). | M |
| `[deployability-3]` | Deployability | `render.yaml:24` declara `preDeployCommand` que **nunca roda** (feature de plano pago; serviço criado pelo dashboard). O `BootMigrator` mitiga, mas duas fontes divergem. | S |
| `[integrability-1]` | Integrability | `IClient` (`src/backend/domain/core/client/IClient.ts`) declara só `init()`. O `close()` novo é convenção informal, e o shutdown referencia a **classe concreta**. Só 1 de 17 clients declara `implements IClient`. | S |
| `[performance-1]` | Performance | Teto real de sessões do plano Supabase não documentado. Teto teórico de 35 (7 processos × 5) contra um `max_client_conn` desconhecido — o próximo bump legítimo de `poolMaxConnections` pode estourar sem aviso. | S |
| `[fault-tolerance-1]` | Fault Tolerance | Teto de drenagem de 10s usa só ~33% do envelope de ~30s do Render. Requisições mais longas que 10s reproduzem o **mesmo** órfão `reconciling`, agora com log. Propõe ~25s amarrado aos timeouts dos clientes. | S |
| `[fault-tolerance-2]` | Fault Tolerance | Force-exit por estouro do drain só deixa `console.log`. Uma rota patológica que **sempre** estoura ficaria invisível para `/operacao`, `job_execucao` e `alerta` — reintroduz a categoria de falha invisível que a ADR-0042 gastou um workflow para eliminar. | S |
| `[security-1]` | Security | `src/backend/http/gracefulShutdown.ts:94` loga `falha ao encerrar o pool: ${asMessage(error)}` sem passar pelo `redactErrorMessage` (`src/backend/http/redact.ts:79`), cuja docstring nomeia `password authentication failed for user "financeiro"` como alvo — exatamente o que o `pg` emite. Fix de 1 linha. | S |
| `[testability-1]` | Testability | 3 branches "reais" descobertas em `gracefulShutdown.ts` (58,82% de branches): o `if (err)` do callback de `server.close`, a guarda `if (exited) return` de `exitOnce`, e o default `target = process`. **Consequência concreta:** remover o `clearTimeout` deixaria os 8 testes verdes com `onExit(0)` chamado 2×. | S |
| `[testability-2]` | Testability | `index.ts` continua sem teste (`void start()` no top-level, 0% de cobertura), com 5 passos de boot ordenados cuja sequência já causou incidente em 2026-08-10. Propõe extrair `bootstrap.ts`. | M |

---

## P3 — backlog

`[availability-3]` instrumentar duração do drain e frequência de force-exit ·
`[deployability-1]` `/health` → 503 durante o drain ·
`[integrability-3]` documentar por que a sessão do Conexos **não** é encerrada no SIGTERM ·
`[modifiability-1]` extrair `endPoolQuietly(pool)` (o idiom `pool.end().catch(...)` aparece em 2 sítios) ·
`[modifiability-2]` amarrar `drainTimeoutMs` a `process.env` ·
`[modifiability-3]` extrair `buildApp()`/`startServer()` do `index.ts` (198 LOC, 30 imports) ·
`[performance-2]` histograma p50/p95/p99 de latência HTTP e de query ·
`[fault-tolerance-3]` instalar `unhandledRejection`/`uncaughtException` como último handler ·
`[security-2]` ~40 docstrings `Run:` em `src/backend/jobs/*.ts` ainda ensinam `npx tsx jobs/...` ·
`[testability-3]` sanity-test que falha se um script crítico voltar a começar com `npx ` (trava a classe do BE-09 em 0) ·
`[testability-4]` ratchet mensal no threshold de cobertura do frontend.

---

## Estágio de aprendizado (obrigatório no pipe v2)

> *"Que regra teria evitado estes bugs?"* — proposta de diff para o `CLAUDE.md`, a decidir com o Yuri.

1. **Todo recurso de processo que é aberto precisa de dono que o feche.** O BE-05 e o
   `[integrability-2]` são o mesmo defeito em dois sítios: um `Pool` criado sem ninguém responsável
   por `end()`. Uma regra candidata: *"Client que abre pool/socket/handle expõe `close()` e é
   registrado no shutdown; handler de `error` que descarta um recurso deve encerrá-lo, nunca só
   soltar a referência."* Isso teria pego os dois de uma vez.
2. **Gate que não pode falhar não é gate.** O BE-09 passou despercebido porque `npx` transforma
   ausência de ferramenta em sucesso silencioso. Regra candidata: *"Script de gate invoca o binário
   local pelo nome (`biome`, `jest`, `tsc`), nunca via `npx` — o modo de falha correto de um gate sem
   dependência é exit ≠ 0, não exit 0."* O card `[testability-3]` automatiza a verificação.
3. **Divergência entre regra escrita e prática medida.** O `CLAUDE.md` exige *commit subjects em
   inglês*, mas os commits recentes da `main` são em português (`feat(sispag): a analista copia a
   linha digitável…`, `feat(operacao): painel recortado por identidade…`), inclusive depois da
   ADR-0042 — que revisou justamente esse bloco e **manteve** a exigência em inglês. Segui a regra
   escrita (subject em inglês, corpo em português), mas a divergência precisa de decisão: ou a
   ADR-0042 ganha um adendo admitindo a prática (como fez com as mensagens de log), ou os commits
   passam a seguir a regra. Hoje ela tem o mesmo defeito que a ADR-0042 diagnosticou: *"uma regra
   que 40% do código viola não é uma regra, é ruído"*.
